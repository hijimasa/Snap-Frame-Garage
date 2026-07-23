// 3D組立ビュー:穴スナップ接続・自由配置(床タップ)・ゴーストプレビュー・
// ドラッグ移動・ピン結合・重心表示・支持多角形・ポーズプレビュー
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Color,
  DoubleSide,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Ray,
  Shape,
  Vector3,
} from "three";
import {
  buildAssembly,
  bodyDisplayMatrix,
  islandRootOf,
  linkDeltas,
  type Assembly,
} from "../core/assembly";
import {
  computeAttachment,
  defaultAttachHole,
  floorPlacementQuaternion,
  holesOf,
  mountingFacesOf,
  type HoleInfo,
} from "../core/holes";
import { solveDisplayAngles } from "../core/linkage";
import { robotMassSummary } from "../core/mass";
import {
  buildDragSnapData,
  findCoincidentHole,
  findSnap,
  type DragSnapData,
  type SnapResult,
} from "../core/snap";
import { computeStability, defBBoxCorners } from "../core/stability";
import type { Geom, PartInstance } from "../core/types";
import { getDef } from "../data/catalog";
import { useStore } from "../state/store";
import { setCaptureCanvas } from "./viewportCapture";

const STATUS_COLOR: Record<string, string> = {
  stable: "#2ec27e",
  warning: "#e5a50a",
  unstable: "#e01b24",
  none: "#888888",
};

const snap5 = (v: number) => Math.round(v / 5) * 5;
const HOLE_MARKER_LENGTH_MM = 8;

/** 穴マーカーを中心面から部品の両表面まで届かせるための奥行き倍率。 */
export const holeMarkerDepthScale = (thicknessMm: number) =>
  (thicknessMm + 2) / HOLE_MARKER_LENGTH_MM;

function TriGeometry({ side, thick }: { side: number; thick: number }) {
  const geo = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side, 0);
    shape.lineTo(0, side);
    shape.closePath();
    const g = new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
    g.translate(0, 0, -thick / 2);
    return g;
  }, [side, thick]);
  return <primitive object={geo} attach="geometry" />;
}

function GeomMesh({
  geom,
  aluminum,
  selected,
  ghost,
  tint,
}: {
  geom: Geom;
  aluminum: boolean;
  selected: boolean;
  ghost?: boolean;
  tint?: string;
}) {
  const color = aluminum ? "#b9bfc9" : tint ?? geom.color ?? "#cccccc";
  const mat = ghost ? (
    <meshStandardMaterial
      color={color}
      transparent
      opacity={0.45}
      depthWrite={false}
      emissive="#35c5e4"
      emissiveIntensity={0.25}
    />
  ) : (
    <meshStandardMaterial
      color={color}
      metalness={aluminum ? 0.85 : 0.1}
      roughness={aluminum ? 0.3 : 0.55}
      emissive={selected ? "#3584e4" : "#000000"}
      emissiveIntensity={selected ? 0.35 : 0}
    />
  );
  const noRay = ghost ? { raycast: () => null } : {};
  const pos = (geom.posMm ?? [0, 0, 0]) as [number, number, number];
  switch (geom.type) {
    case "box":
      return (
        <mesh position={pos} castShadow={!ghost} {...noRay}>
          <boxGeometry args={geom.sizeMm} />
          {mat}
        </mesh>
      );
    case "sphere":
      return (
        <mesh position={pos} castShadow={!ghost} {...noRay}>
          <sphereGeometry args={[geom.radiusMm, 24, 16]} />
          {mat}
        </mesh>
      );
    case "cylinder": {
      const axis = new Vector3(...(geom.axis ?? [0, 0, 1])).normalize();
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), axis);
      return (
        <group position={pos} quaternion={q}>
          {/* three.jsのcylinder軸はY → Zへ回す */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={!ghost} {...noRay}>
            <cylinderGeometry args={[geom.radiusMm, geom.radiusMm, geom.heightMm, 28]} />
            {mat}
          </mesh>
        </group>
      );
    }
    case "triprism":
      return (
        <mesh position={pos} castShadow={!ghost} {...noRay}>
          <TriGeometry side={geom.sideMm} thick={geom.thickMm} />
          {mat}
        </mesh>
      );
  }
}

/** 半透明の実寸プレビュー(取付前に大きさ・形・向きがわかる) */
function GhostPart({ defId, matrix }: { defId: string; matrix: Matrix4 }) {
  const def = getDef(defId);
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {[...def.geoms, ...(def.hornGeoms ?? [])].map((g, i) => (
        <GeomMesh key={i} geom={g} aluminum={false} selected={false} ghost />
      ))}
    </group>
  );
}

interface HoverHole {
  partId: string;
  hole: HoleInfo;
  worldM: Matrix4;
  side: 1 | -1;
}
type Hover =
  | { kind: "hole"; h: HoverHole }
  | { kind: "floor"; x: number; y: number }
  | null;

/** 1パーツ分の穴をInstancedMeshで描画(取付モード・ピン留めモード時) */
function HoleLayer({
  inst,
  displayM,
  onHover,
  onPick,
}: {
  inst: PartInstance;
  displayM: { main: Matrix4; horn: Matrix4 | null };
  onHover: (h: HoverHole | null) => void;
  onPick: (h: HoverHole) => void;
}) {
  const def = getDef(inst.defId);
  const holes = useMemo(() => holesOf(def), [def]);
  const ref = useRef<InstancedMesh>(null);
  const matrices = useMemo(() => {
    return holes.map((h) => {
      const base = h.body === "horn" && displayM.horn ? displayM.horn : displayM.main;
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), h.normal);
      const local = new Matrix4().compose(
        h.posMm.clone(),
        q,
        new Vector3(1, 1, holeMarkerDepthScale(h.thicknessMm))
      );
      // cylinderのY軸をZへ
      const rotX = new Matrix4().makeRotationX(Math.PI / 2);
      return base.clone().multiply(local).multiply(rotX);
    });
  }, [holes, displayM]);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices]);

  const pick = (e: ThreeEvent<MouseEvent>): HoverHole | null => {
    if (e.instanceId === undefined || e.instanceId >= holes.length) return null;
    const hole = holes[e.instanceId];
    const base = hole.body === "horn" && displayM.horn ? displayM.horn : displayM.main;
    const worldM = base.clone();
    const center = hole.posMm.clone().applyMatrix4(worldM);
    const q = new Quaternion().setFromRotationMatrix(worldM);
    const n = hole.normal.clone().applyQuaternion(q);
    const side: 1 | -1 = e.point.clone().sub(center).dot(n) >= 0 ? 1 : -1;
    return { partId: inst.id, hole, worldM, side };
  };

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, holes.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(pick(e));
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        const p = pick(e);
        if (p) onPick(p);
      }}
    >
      <cylinderGeometry args={[1.7, 1.7, 8, 10]} />
      <meshBasicMaterial color="#35c5e4" transparent opacity={0.45} depthWrite={false} />
    </instancedMesh>
  );
}

function holeWorldPos(asm: Assembly, partId: string, hole: HoleInfo): { p: Vector3; n: Vector3 } | null {
  const M = asm.poses.get(partId);
  if (!M) return null;
  const p = hole.posMm.clone().applyMatrix4(M);
  const n = hole.normal.clone().applyQuaternion(new Quaternion().setFromRotationMatrix(M));
  return { p, n };
}

function rayToFloor(ray: Ray, floorZ: number): { x: number; y: number } | null {
  if (Math.abs(ray.direction.z) < 1e-6) return null;
  const t = (floorZ - ray.origin.z) / ray.direction.z;
  if (t < 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t };
}

// ドラッグ中の穴スナップの純ロジックは core/snap.ts(単体テスト対象)

export function Viewport() {
  const model = useStore((s) => s.model);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const pendingDefId = useStore((s) => s.pendingDefId);
  const pendingMountFace = useStore((s) => s.pendingMountFace);
  const pendingAngleDeg = useStore((s) => s.pendingAngleDeg);
  const attachPart = useStore((s) => s.attachPart);
  const placeFreePart = useStore((s) => s.placeFreePart);
  const setFreePartPos = useStore((s) => s.setFreePartPos);
  const rotateFreePart = useStore((s) => s.rotateFreePart);
  const rotateChild = useStore((s) => s.rotateChild);
  const linkMode = useStore((s) => s.linkMode);
  const setLinkMode = useStore((s) => s.setLinkMode);
  const linkFirstHole = useStore((s) => s.linkFirstHole);
  const setLinkFirstHole = useStore((s) => s.setLinkFirstHole);
  const pinHoles = useStore((s) => s.pinHoles);
  const setPins = useStore((s) => s.setPins);
  const poseAngles = useStore((s) => s.poseAngles);
  const showToast = useStore((s) => s.showToast);

  const [hover, setHover] = useState<Hover>(null);
  const [dragging, setDragging] = useState(false);
  const [snapHint, setSnapHint] = useState<{ p: Vector3; n: Vector3 } | null>(null);
  const dragRef = useRef<{
    partId: string;
    dx: number;
    dy: number;
    z0: number;
    snapData: DragSnapData;
    lastPos: [number, number, number] | null;
    lastSnap: SnapResult | null;
  } | null>(null);
  // 受動関節(ピン1本)を掴んで回すドラッグ
  const rotRef = useRef<{
    connId: string;
    anchorModel: Vector3;
    d: Vector3; // 回転軸(side適用済み・world)
    u: Vector3;
    v: Vector3;
    theta0: number;
    angle0: number;
  } | null>(null);
  const rotateConnAngle = useStore((s) => s.rotateConnAngleLinked);

  const asm = useMemo(() => buildAssembly(model), [model]);
  const summary = useMemo(() => robotMassSummary(model, asm), [model, asm]);
  const stability = useMemo(
    () => computeStability(model, asm, summary.cogWorldMm),
    [model, asm, summary]
  );
  const holeMode = pendingDefId !== null || linkMode;
  // ポーズプレビュー:からくり(ループピン)があれば、受動関節を拘束を保つよう連動させる
  const displayAngles = useMemo(
    () => (holeMode ? {} : solveDisplayAngles(model, asm, poseAngles)),
    [model, asm, poseAngles, holeMode]
  );
  const deltas = useMemo(() => linkDeltas(asm, displayAngles), [asm, displayAngles]);

  const displayMs = useMemo(() => {
    const map = new Map<string, { main: Matrix4; horn: Matrix4 | null }>();
    for (const p of model.parts) {
      const main = bodyDisplayMatrix(asm, deltas, p.id, false);
      if (!main) continue;
      const horn = asm.linkOfBody.has(`${p.id}#horn`)
        ? bodyDisplayMatrix(asm, deltas, p.id, true)
        : null;
      map.set(p.id, { main, horn });
    }
    return map;
  }, [model, asm, deltas]);

  // 島の根(自由に動かせるパーツ)
  const islandRoots = useMemo(() => {
    const children = new Set(
      model.connections.filter((c) => c.kind === "tree").map((c) => c.childPart)
    );
    return new Set(model.parts.filter((p) => !children.has(p.id)).map((p) => p.id));
  }, [model]);

  // 各パーツの「いちばん近い回せる祖先接続」(ピン1本のtree接続)。
  // これを掴むと関節まわりに回せる(リンク機構シミュレータ流の直接操作)
  const rotatableConnOf = useMemo(() => {
    const byChild = new Map(
      model.connections.filter((c) => c.kind === "tree").map((c) => [c.childPart, c])
    );
    const map = new Map<string, (typeof model.connections)[number]>();
    for (const p of model.parts) {
      let cur = p.id;
      while (byChild.has(cur)) {
        const c = byChild.get(cur)!;
        const special = "special" in c.parentHole || "special" in c.childHole;
        if (!special && c.pins === 1) {
          map.set(p.id, c);
          break;
        }
        cur = c.parentPart;
      }
    }
    return map;
  }, [model]);

  const rayTheta = (ray: Ray, r: NonNullable<typeof rotRef.current>, dz: number): number | null => {
    const anchor = r.anchorModel.clone().add(new Vector3(0, 0, dz));
    const denom = ray.direction.dot(r.d);
    if (Math.abs(denom) < 1e-4) return null;
    const t = anchor.clone().sub(ray.origin).dot(r.d) / denom;
    if (t < 0) return null;
    const hit = ray.origin.clone().addScaledVector(ray.direction, t).sub(anchor);
    return Math.atan2(hit.dot(r.v), hit.dot(r.u));
  };

  const dropZ = stability.status === "none" ? 0 : -stability.minZMm;
  const floorZModel = stability.status === "none" ? 0 : stability.minZMm; // モデル座標での「床」

  const setHoleHover = (h: HoverHole | null) =>
    setHover(h ? { kind: "hole", h } : null);

  const onPickHole = (h: HoverHole) => {
    if (pendingDefId) {
      attachPart(h.partId, h.hole.key, h.side);
      return;
    }
    if (linkMode) {
      if (!linkFirstHole) {
        // 重なっている相手穴があれば自動選択して、ワンクリックでピン留め
        const co = findCoincidentHole(model, asm, h.partId, h.hole);
        if (co) {
          pinHoles(
            { partId: h.partId, holeKey: h.hole.key, side: co.side },
            { partId: co.id.partId, holeKey: co.id.holeKey },
            true
          );
          return;
        }
        setLinkFirstHole({ partId: h.partId, holeKey: h.hole.key, side: h.side });
        showToast("重なっている穴が近くにないみたい。つなぎたい相手の穴をタップ!(島ごと吸着してつながるよ)");
        return;
      }
      // 2つの穴が実際に重なっているか(同じ島の追いピンに必要)
      const firstInst = model.parts.find((p) => p.id === linkFirstHole.partId);
      if (!firstInst) return;
      const firstHole = holesOf(getDef(firstInst.defId)).find((x) => x.key === linkFirstHole.holeKey);
      if (!firstHole) return;
      if (linkFirstHole.partId === h.partId) {
        showToast("同じパーツの穴どうしはつなげないよ。別のパーツの穴を選んでね");
        return;
      }
      const sameIsland =
        islandRootOf(model, linkFirstHole.partId) === islandRootOf(model, h.partId);
      if (sameIsland) {
        const a = holeWorldPos(asm, linkFirstHole.partId, firstHole);
        const b = holeWorldPos(asm, h.partId, h.hole);
        if (!a || !b) {
          showToast("選んだ穴が見つからなくなったよ。最初の穴から選び直してね");
          setLinkFirstHole(null);
          return;
        }
        const thickOk = (firstHole.thicknessMm + h.hole.thicknessMm) / 2 + 1.5;
        if (a.p.distanceTo(b.p) > thickOk) {
          showToast("穴の中心が離れているよ。パーツをドラッグして、穴が光るまで近づけてね");
          return;
        }
        if (Math.abs(a.n.dot(b.n)) < 0.9) {
          showToast("穴の向きが合っていないよ。パーツを90°回して、正面どうしに合わせてね");
          return;
        }
      }
      const ok = pinHoles(linkFirstHole, { partId: h.partId, holeKey: h.hole.key }, true);
      if (ok) setLinkFirstHole(null);
    }
  };

  // ゴーストプレビューの行列
  const ghostMatrix = useMemo(() => {
    if (!pendingDefId || !hover) return null;
    const def = getDef(pendingDefId);
    const faces = mountingFacesOf(def);
    const child =
      faces[pendingMountFace % Math.max(1, faces.length)] ?? defaultAttachHole(def);
    if (!child) return null;
    if (hover.kind === "floor") {
      const q = floorPlacementQuaternion(child, pendingAngleDeg);
      const minZ = Math.min(
        ...defBBoxCorners(def).map((corner) => corner.clone().applyQuaternion(q).z)
      );
      return new Matrix4().compose(
        new Vector3(snap5(hover.x), snap5(hover.y), floorZModel - minZ),
        q,
        new Vector3(1, 1, 1)
      );
    }
    return computeAttachment(
      hover.h.worldM,
      hover.h.hole,
      child,
      pendingAngleDeg,
      hover.h.side
    );
  }, [pendingDefId, pendingMountFace, pendingAngleDeg, hover, floorZModel]);

  // 支持多角形の形状
  const polyPoints = stability.supportPolygonXY;

  return (
    <Canvas
      shadows="basic"
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [260, -260, 200], fov: 40, near: 1, far: 8000, up: [0, 0, 1] }}
      onCreated={({ gl, camera }) => {
        camera.up.set(0, 0, 1);
        setCaptureCanvas(gl.domElement);
      }}
      onPointerMissed={() => {
        useStore.setState({ selection: null });
      }}
      style={{ background: "linear-gradient(#20242c, #2a2f3a)" }}
    >
      <ambientLight intensity={0.65} />
      <directionalLight
        position={[220, -160, 380]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-300}
        shadow-camera-right={300}
        shadow-camera-top={300}
        shadow-camera-bottom={-300}
      />
      <directionalLight position={[-200, 200, 150]} intensity={0.4} />
      <OrbitControls
        makeDefault
        enabled={!dragging}
        target={[0, 0, 40]}
        maxDistance={2000}
        minDistance={40}
      />

      {/* 床とグリッド(5mmピッチ=タミヤ互換)。取付モードでは床タップで自由配置 */}
      <mesh
        receiveShadow
        position={[0, 0, -0.5]}
        onPointerMove={(e) => {
          if (!pendingDefId) return;
          setHover({ kind: "floor", x: e.point.x, y: e.point.y });
        }}
        onPointerOut={() => {
          setHover((h) => (h?.kind === "floor" ? null : h));
        }}
        onClick={(e) => {
          if (!pendingDefId) return;
          e.stopPropagation();
          placeFreePart(pendingDefId, e.point.x, e.point.y, floorZModel);
        }}
      >
        <boxGeometry args={[700, 700, 1]} />
        <meshStandardMaterial color="#3a4150" roughness={0.9} />
      </mesh>
      <gridHelper
        args={[700, 140, "#5a6478", "#454d5e"]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.2]}
      />

      <group position={[0, 0, dropZ]}>
        {/* パーツ本体 */}
        {model.parts.map((inst) => {
          const dm = displayMs.get(inst.id);
          if (!dm) return null;
          const def = getDef(inst.defId);
          const aluminum = inst.material === "aluminum" && !!def.materialOptions;
          const selected = selection === inst.id;
          const draggable = !holeMode && islandRoots.has(inst.id);
          return (
            <group key={inst.id}>
              <group
                matrix={dm.main}
                matrixAutoUpdate={false}
                onClick={(e) => {
                  if (holeMode) return;
                  e.stopPropagation();
                  setSelection(inst.id);
                }}
                onPointerDown={(e) => {
                  if (holeMode) return;
                  // 1) 自由なパーツ(選択中)は平行移動ドラッグ(近くの穴に吸着)
                  if (draggable && selection === inst.id) {
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    const hit = rayToFloor(e.ray, 0);
                    if (!hit) return;
                    const bp = inst.basePose?.posMm ?? [0, 0, 0];
                    dragRef.current = {
                      partId: inst.id,
                      dx: bp[0] - hit.x,
                      dy: bp[1] - hit.y,
                      z0: bp[2],
                      snapData: buildDragSnapData(model, asm, inst.id),
                      lastPos: null,
                      lastSnap: null,
                    };
                    setDragging(true);
                    return;
                  }
                  // 2) 受動関節(ピン1本)につながったパーツは、掴んで関節まわりに回す
                  const conn = rotatableConnOf.get(inst.id);
                  if (!conn) return;
                  const pInst = model.parts.find((p) => p.id === conn.parentPart);
                  const pdm = displayMs.get(conn.parentPart);
                  if (!pInst || !pdm) return;
                  const phole = holesOf(getDef(pInst.defId)).find(
                    (x) =>
                      x.key ===
                      ("special" in conn.parentHole
                        ? `s:${conn.parentHole.special}`
                        : `g:${conn.parentHole.group}:${conn.parentHole.index}`)
                  );
                  if (!phole) return;
                  const base = phole.body === "horn" && pdm.horn ? pdm.horn : pdm.main;
                  const anchorModel = phole.posMm.clone().applyMatrix4(base);
                  const q = new Quaternion().setFromRotationMatrix(base);
                  const d = phole.normal.clone().applyQuaternion(q).normalize().multiplyScalar(conn.side);
                  const u = (Math.abs(d.z) < 0.9
                    ? new Vector3(0, 0, 1).cross(d)
                    : new Vector3(1, 0, 0).cross(d)
                  ).normalize();
                  const v = new Vector3().crossVectors(d, u);
                  const r = { connId: conn.id, anchorModel, d, u, v, theta0: 0, angle0: conn.angleDeg };
                  const th = rayTheta(e.ray, r, dropZ);
                  if (th === null) return;
                  r.theta0 = th;
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  rotRef.current = r;
                  setDragging(true);
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (d && d.partId === inst.id) {
                    const hit = rayToFloor(e.ray, 0);
                    if (!hit) return;
                    const raw = new Vector3(snap5(hit.x + d.dx), snap5(hit.y + d.dy), d.z0);
                    const snap = findSnap(raw, d.snapData);
                    if (snap) {
                      d.lastPos = [snap.pos.x, snap.pos.y, snap.pos.z];
                      d.lastSnap = snap;
                      setFreePartPos(d.partId, d.lastPos, false);
                      setSnapHint({ p: snap.holeP, n: snap.n });
                    } else {
                      d.lastPos = [raw.x, raw.y, raw.z];
                      d.lastSnap = null;
                      setFreePartPos(d.partId, d.lastPos, false);
                      setSnapHint(null);
                    }
                    return;
                  }
                  const r = rotRef.current;
                  if (r) {
                    const th = rayTheta(e.ray, r, dropZ);
                    if (th === null) return;
                    const delta = ((th - r.theta0) * 180) / Math.PI;
                    rotateConnAngle(r.connId, r.angle0 + delta, false);
                  }
                }}
                onPointerUp={(e) => {
                  const d = dragRef.current;
                  if (d) {
                    (e.target as Element).releasePointerCapture?.(e.pointerId);
                    const bp = model.parts.find((p) => p.id === d.partId)?.basePose?.posMm;
                    setFreePartPos(d.partId, d.lastPos ?? (bp as [number, number, number]) ?? [0, 0, 0], true);
                    if (d.lastSnap)
                      pinHoles(
                        {
                          partId: d.lastSnap.staticHole.partId,
                          holeKey: d.lastSnap.staticHole.holeKey,
                          side: d.lastSnap.side,
                        },
                        {
                          partId: d.lastSnap.dragHole.partId,
                          holeKey: d.lastSnap.dragHole.holeKey,
                        },
                        true
                      );
                    dragRef.current = null;
                    setDragging(false);
                    setSnapHint(null);
                    return;
                  }
                  const r = rotRef.current;
                  if (r) {
                    (e.target as Element).releasePointerCapture?.(e.pointerId);
                    const cur = model.connections.find((c) => c.id === r.connId);
                    rotateConnAngle(r.connId, cur?.angleDeg ?? r.angle0, true);
                    rotRef.current = null;
                    setDragging(false);
                  }
                }}
              >
                {def.geoms.map((g, i) => (
                  <GeomMesh
                    key={i}
                    geom={g}
                    aluminum={aluminum}
                    selected={selected}
                    tint={inst.tint}
                  />
                ))}
              </group>
              {dm.horn && (
                <group matrix={dm.horn} matrixAutoUpdate={false}>
                  {(def.hornGeoms ?? []).map((g, i) => (
                    <GeomMesh key={i} geom={g} aluminum={false} selected={selected} />
                  ))}
                </group>
              )}
            </group>
          );
        })}

        {/* 駆動穴の金色マーカー(常時表示:「サーボの回る穴」) */}
        {model.parts.map((inst) => {
          const def = getDef(inst.defId);
          const drive = def.specialHoles?.find((s) => s.kind === "drive");
          const dm = displayMs.get(inst.id);
          if (!drive || !dm) return null;
          const base = dm.horn ?? dm.main;
          const q = new Quaternion().setFromUnitVectors(
            new Vector3(0, 0, 1),
            new Vector3(...drive.normal).normalize()
          );
          const local = new Matrix4().compose(
            new Vector3(...drive.posMm),
            q,
            new Vector3(1, 1, 1)
          );
          const m = base.clone().multiply(local);
          return (
            <group key={`drv-${inst.id}`} matrix={m} matrixAutoUpdate={false}>
              <mesh raycast={() => null} position={[0, 0, 1.6]}>
                <torusGeometry args={[3.2, 0.8, 8, 24]} />
                <meshBasicMaterial color="#f5c211" />
              </mesh>
            </group>
          );
        })}

        {/* 穴レイヤー(取付・ピン留めモード) */}
        {holeMode &&
          model.parts.map((inst) => {
            const dm = displayMs.get(inst.id);
            if (!dm) return null;
            return (
              <HoleLayer
                key={`holes-${inst.id}`}
                inst={inst}
                displayM={dm}
                onHover={setHoleHover}
                onPick={onPickHole}
              />
            );
          })}

        {/* ゴーストプレビュー(取付前に実寸で見える) */}
        {pendingDefId && ghostMatrix && <GhostPart defId={pendingDefId} matrix={ghostMatrix} />}

        {/* ホバー中の穴ハイライト(穴モード中のみ。残留表示を防ぐ) */}
        {holeMode && hover?.kind === "hole" && (
          <group
            matrix={hover.h.worldM
              .clone()
              .multiply(
                new Matrix4().compose(
                  hover.h.hole.posMm
                    .clone()
                    .addScaledVector(
                      hover.h.hole.normal,
                      hover.h.side * (hover.h.hole.thicknessMm / 2 + 0.8)
                    ),
                  new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), hover.h.hole.normal),
                  new Vector3(1, 1, 1)
                )
              )}
            matrixAutoUpdate={false}
          >
            <mesh raycast={() => null}>
              <torusGeometry args={[3, 1, 8, 24]} />
              <meshBasicMaterial color="#7ce38b" />
            </mesh>
          </group>
        )}

        {/* 選択したパーツのすぐそばで、よく使う操作を完結させる */}
        {selection &&
          !holeMode &&
          !dragging &&
          (() => {
            const inst = model.parts.find((p) => p.id === selection);
            const dm = displayMs.get(selection);
            if (!inst || !dm) return null;
            const tree = model.connections.find(
              (c) => c.kind === "tree" && c.childPart === selection
            );
            const special =
              tree && ("special" in tree.parentHole || "special" in tree.childHole);
            const pos = new Vector3().setFromMatrixPosition(dm.main);
            const top = Math.max(
              ...defBBoxCorners(getDef(inst.defId)).map(
                (corner) => corner.applyMatrix4(dm.main).z
              )
            );
            pos.z = top + 14;
            const free = islandRoots.has(selection);
            return (
              <Html key={`quick-${selection}`} position={pos} center zIndexRange={[12, 1]}>
                <div
                  className="part-quick-toolbar"
                  role="toolbar"
                  aria-label="選んだパーツのかんたん操作"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (free) rotateFreePart(selection, "z", 90);
                      else rotateChild(selection, 90);
                      showToast("90°回したよ", true);
                    }}
                  >
                    ↻ 90°回す
                  </button>
                  {free && (
                    <button type="button" onClick={() => setLinkMode(true)}>
                      📌 つなぐ
                    </button>
                  )}
                  {tree && !special && (
                    <button
                      type="button"
                      onClick={() => {
                        setPins(tree.id, tree.pins === 1 ? 2 : 1);
                        showToast(
                          tree.pins === 1
                            ? "ピン2本:しっかり固定"
                            : "ピン1本:くるくる回る",
                          true
                        );
                      }}
                    >
                      {tree.pins === 1 ? "🔒 固定する" : "🔄 回るようにする"}
                    </button>
                  )}
                </div>
              </Html>
            );
          })()}

        {/* ドラッグ中の穴スナップのハイライト */}
        {snapHint && (
          <group
            position={snapHint.p}
            quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), snapHint.n)}
            raycast={() => null}
          >
            <mesh raycast={() => null}>
              <torusGeometry args={[4, 1.1, 8, 24]} />
              <meshBasicMaterial color="#7ce38b" />
            </mesh>
          </group>
        )}

        {/* ピン留め1点目のマーカー */}
        {linkFirstHole &&
          (() => {
            const inst = model.parts.find((p) => p.id === linkFirstHole.partId);
            if (!inst) return null;
            const hole = holesOf(getDef(inst.defId)).find((x) => x.key === linkFirstHole.holeKey);
            if (!hole) return null;
            const w = holeWorldPos(asm, linkFirstHole.partId, hole);
            if (!w) return null;
            return (
              <mesh position={w.p} raycast={() => null}>
                <sphereGeometry args={[3.4, 12, 8]} />
                <meshBasicMaterial color="#f66151" />
              </mesh>
            );
          })()}

        {/* 接続の関節バッジ:シアン=回る(1ピン) グレー=固定。クリックで切替 */}
        {model.connections.map((c) => {
          const pInst = model.parts.find((p) => p.id === c.parentPart);
          if (!pInst) return null;
          const hole = holesOf(getDef(pInst.defId)).find(
            (x) => x.key === ("special" in c.parentHole ? `s:${c.parentHole.special}` : `g:${c.parentHole.group}:${c.parentHole.index}`)
          );
          if (!hole || hole.kind !== "plain") return null; // 駆動・アイドラー穴は切替不可
          const dm = displayMs.get(c.parentPart);
          if (!dm) return null;
          const base = hole.body === "horn" && dm.horn ? dm.horn : dm.main;
          const pos = hole.posMm.clone().applyMatrix4(base);
          const passive = c.pins === 1;
          return (
            <mesh
              key={`badge-${c.id}`}
              position={pos}
              onClick={(e) => {
                if (holeMode) return;
                e.stopPropagation();
                setPins(c.id, passive ? 2 : 1);
                showToast(
                  passive ? "ピン2本:しっかり固定" : "ピン1本:くるくる回る",
                  true
                );
              }}
            >
              <sphereGeometry args={[2.6, 12, 8]} />
              <meshStandardMaterial
                color={passive ? "#35c5e4" : c.kind === "loop" ? "#f5c211" : "#666e7c"}
                emissive={passive ? "#35c5e4" : "#000"}
                emissiveIntensity={passive ? 0.5 : 0}
              />
            </mesh>
          );
        })}

        {/* 全体重心マーカー + 鉛直線 */}
        {model.parts.length > 0 && (
          <group raycast={() => null}>
            <mesh position={summary.cogWorldMm} raycast={() => null}>
              <sphereGeometry args={[6, 16, 12]} />
              <meshBasicMaterial color={STATUS_COLOR[stability.status]} />
            </mesh>
            <Line
              points={[
                summary.cogWorldMm.toArray(),
                [summary.cogWorldMm.x, summary.cogWorldMm.y, -dropZ],
              ]}
              color={STATUS_COLOR[stability.status]}
              lineWidth={2}
              dashed
              dashSize={6}
              gapSize={4}
            />
          </group>
        )}
      </group>

      {/* 支持多角形(たおれない範囲)は床の上に描く */}
      {polyPoints.length >= 3 && (
        <group position={[0, 0, 0.6]} raycast={() => null}>
          <mesh raycast={() => null}>
            <shapeGeometry
              args={[
                (() => {
                  const s = new Shape();
                  s.moveTo(polyPoints[0][0], polyPoints[0][1]);
                  for (let i = 1; i < polyPoints.length; i++) s.lineTo(polyPoints[i][0], polyPoints[i][1]);
                  s.closePath();
                  return s;
                })(),
              ]}
            />
            <meshBasicMaterial
              color={new Color(STATUS_COLOR[stability.status])}
              transparent
              opacity={0.22}
              side={DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={[...polyPoints, polyPoints[0]].map(([x, y]) => [x, y, 0.4] as [number, number, number])}
            color={STATUS_COLOR[stability.status]}
            lineWidth={2}
          />
          {/* 重心の投影点 */}
          <mesh position={[stability.cogXY[0], stability.cogXY[1], 0.8]} raycast={() => null}>
            <circleGeometry args={[4, 20]} />
            <meshBasicMaterial color={STATUS_COLOR[stability.status]} />
          </mesh>
        </group>
      )}
    </Canvas>
  );
}
