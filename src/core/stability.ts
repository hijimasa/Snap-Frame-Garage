// 接地安定性:支持多角形(たおれない範囲)と重心投影の判定(企画書§3.2)。
// 静的判定のみ。基本姿勢のみ(v0.3決定:ポーズごとの判定は敢えて搭載しない)。
import { Matrix4, Vector3 } from "three";
import { getDef } from "../data/catalog";
import type { Assembly } from "./assembly";
import type { Geom, RobotModel } from "./types";
import { geomCenterMm } from "./mass";

export interface StabilityResult {
  minZMm: number; // 機体最下点(rest姿勢・world)
  contactPointsMm: Vector3[]; // 接地候補点
  supportPolygonXY: [number, number][]; // 凸包(反時計回り)
  cogXY: [number, number];
  marginMm: number; // 重心投影から多角形の縁までの符号付き距離(正=内側)
  status: "stable" | "warning" | "unstable" | "none";
}

function geomBBoxCorners(g: Geom): Vector3[] {
  let min: Vector3, max: Vector3;
  const c = new Vector3(...(g.posMm ?? [0, 0, 0]));
  switch (g.type) {
    case "box": {
      const h = new Vector3(...g.sizeMm).multiplyScalar(0.5);
      min = c.clone().sub(h); max = c.clone().add(h);
      break;
    }
    case "cylinder": {
      const axis = new Vector3(...(g.axis ?? [0, 0, 1])).normalize();
      // 軸方向h/2、半径方向rの箱で包む(緩い近似で十分)
      const h = new Vector3(
        Math.abs(axis.x) * g.heightMm / 2 + (1 - Math.abs(axis.x)) * g.radiusMm,
        Math.abs(axis.y) * g.heightMm / 2 + (1 - Math.abs(axis.y)) * g.radiusMm,
        Math.abs(axis.z) * g.heightMm / 2 + (1 - Math.abs(axis.z)) * g.radiusMm
      );
      min = c.clone().sub(h); max = c.clone().add(h);
      break;
    }
    case "sphere": {
      const h = new Vector3(g.radiusMm, g.radiusMm, g.radiusMm);
      min = c.clone().sub(h); max = c.clone().add(h);
      break;
    }
    case "triprism": {
      min = c.clone().add(new Vector3(0, 0, -g.thickMm / 2));
      max = c.clone().add(new Vector3(g.sideMm, g.sideMm, g.thickMm / 2));
      break;
    }
  }
  const out: Vector3[] = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) out.push(new Vector3(x, y, z));
  return out;
}

/** パーツ定義ローカルのバウンディングボックス角(8点×ジオメトリ数) */
export function defBBoxCorners(def: { geoms: Geom[]; hornGeoms?: Geom[] }): Vector3[] {
  const out: Vector3[] = [];
  for (const g of [...def.geoms, ...(def.hornGeoms ?? [])])
    for (const c of geomBBoxCorners(g)) out.push(c);
  return out;
}

/** パーツ定義ローカルでの最下点(自由配置で床に置くときのZ計算に使う) */
export function defLocalMinZ(def: { geoms: Geom[]; hornGeoms?: Geom[] }): number {
  let minZ = 0;
  for (const c of defBBoxCorners(def)) minZ = Math.min(minZ, c.z);
  return minZ;
}

export function partWorldBBoxCorners(model: RobotModel, asm: Assembly, partId: string): Vector3[] {
  const inst = model.parts.find((p) => p.id === partId);
  const M = asm.poses.get(partId);
  if (!inst || !M) return [];
  const def = getDef(inst.defId);
  const out: Vector3[] = [];
  const pushAligned = (c: Vector3, ext: Vector3) => {
    for (const dx of [-ext.x, ext.x])
      for (const dy of [-ext.y, ext.y])
        for (const dz of [-ext.z, ext.z]) out.push(new Vector3(c.x + dx, c.y + dy, c.z + dz));
  };
  for (const g of [...def.geoms, ...(def.hornGeoms ?? [])]) {
    // 球・円筒はローカルキューブ角を回すと最下点が最大√2〜√3倍深く出てしまう
    // (回した脚パーツで顕著)。world軸での正確な範囲を取る(接地判定の精度に効く)
    if (g.type === "sphere") {
      const c = new Vector3(...(g.posMm ?? [0, 0, 0])).applyMatrix4(M);
      pushAligned(c, new Vector3(g.radiusMm, g.radiusMm, g.radiusMm));
      continue;
    }
    if (g.type === "cylinder") {
      const c = new Vector3(...(g.posMm ?? [0, 0, 0])).applyMatrix4(M);
      const a = new Vector3(...(g.axis ?? [0, 0, 1])).normalize().transformDirection(M);
      const ext = new Vector3(
        (g.heightMm / 2) * Math.abs(a.x) + g.radiusMm * Math.sqrt(Math.max(0, 1 - a.x * a.x)),
        (g.heightMm / 2) * Math.abs(a.y) + g.radiusMm * Math.sqrt(Math.max(0, 1 - a.y * a.y)),
        (g.heightMm / 2) * Math.abs(a.z) + g.radiusMm * Math.sqrt(Math.max(0, 1 - a.z * a.z))
      );
      pushAligned(c, ext);
      continue;
    }
    for (const c of geomBBoxCorners(g)) out.push(c.applyMatrix4(M));
  }
  return out;
}

function convexHullXY(pts: [number, number][]): [number, number][] {
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length <= 2) return P;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...P].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 多角形内なら正、外なら負の、縁までの距離 */
function signedDistanceToHull(hull: [number, number][], p: [number, number]): number {
  if (hull.length === 0) return -Infinity;
  if (hull.length === 1) return -Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1]);
  let inside = hull.length >= 3;
  let minEdge = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if (hull.length >= 3) {
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (cr < 0) inside = false;
    }
    // 線分abまでの距離
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby || 1)));
    const dx = p[0] - (a[0] + t * abx), dy = p[1] - (a[1] + t * aby);
    minEdge = Math.min(minEdge, Math.hypot(dx, dy));
  }
  return inside ? minEdge : -minEdge;
}

// 接地とみなす高さの許容。3mm板の上に載った部品(浮き3mm)を接地扱いに
// しないよう板厚より小さく、意図的な0.5mm浮き(キャスター等)は拾える値にする
const CONTACT_TOL_MM = 1.4;
const WARN_MARGIN_MM = 8;

export function computeStability(
  model: RobotModel,
  asm: Assembly,
  cogWorldMm: Vector3
): StabilityResult {
  // 機体全体の最下点
  let minZ = Infinity;
  const bboxOf = new Map<string, Vector3[]>();
  for (const p of model.parts) {
    const cs = partWorldBBoxCorners(model, asm, p.id);
    if (cs.length) {
      bboxOf.set(p.id, cs);
      for (const c of cs) minZ = Math.min(minZ, c.z);
    }
  }
  if (!isFinite(minZ)) {
    return { minZMm: 0, contactPointsMm: [], supportPolygonXY: [], cogXY: [0, 0], marginMm: -Infinity, status: "none" };
  }

  const contacts: Vector3[] = [];
  for (const p of model.parts) {
    const def = getDef(p.defId);
    const corners = bboxOf.get(p.id);
    if (!corners) continue;
    const partMin = Math.min(...corners.map((c) => c.z));
    if (partMin > minZ + CONTACT_TOL_MM) continue; // 浮いている
    if (def.contact === "wheel" || def.contact === "caster") {
      // 接地点は中心直下の1点
      const cx = corners.reduce((s, c) => s + c.x, 0) / corners.length;
      const cy = corners.reduce((s, c) => s + c.y, 0) / corners.length;
      contacts.push(new Vector3(cx, cy, partMin));
    } else if (def.contact === "foot") {
      // 足裏は底面の4隅
      const bottom = corners.filter((c) => c.z < partMin + 1);
      for (const c of bottom) contacts.push(c.clone());
      if (bottom.length < 4) {
        const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
        contacts.push(
          new Vector3(Math.min(...xs), Math.min(...ys), partMin),
          new Vector3(Math.min(...xs), Math.max(...ys), partMin),
          new Vector3(Math.max(...xs), Math.min(...ys), partMin),
          new Vector3(Math.max(...xs), Math.max(...ys), partMin)
        );
      }
    } else {
      // 接地専用パーツ以外も、最下点に触れていれば接地扱い(箱を直置きした場合など)
      for (const c of corners) if (c.z < partMin + 1) contacts.push(c.clone());
    }
  }

  const hull = convexHullXY(contacts.map((c) => [c.x, c.y] as [number, number]));
  const cogXY: [number, number] = [cogWorldMm.x, cogWorldMm.y];
  const margin = signedDistanceToHull(hull, cogXY);
  let status: StabilityResult["status"];
  if (hull.length < 3) status = contacts.length ? "unstable" : "none";
  else if (margin > WARN_MARGIN_MM) status = "stable";
  else if (margin > 0) status = "warning";
  else status = "unstable";
  return { minZMm: minZ, contactPointsMm: contacts, supportPolygonXY: hull, cogXY, marginMm: margin, status };
}
