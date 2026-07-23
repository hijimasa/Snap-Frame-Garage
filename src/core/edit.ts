// モデル編集の純ロジック:島の再ルート・島同士のピン結合・切り離し。
// 「適当に置いてから、あとでピンでつなぐ」ワークフローの中核。
import { Matrix4, Quaternion, Vector3 } from "three";
import { getDef } from "../data/catalog";
import { computePoses, islandRootOf, subtreeParts } from "./assembly";
import { computeAttachment, findHole, solveAttachParams } from "./holes";
import type { Connection, HoleRef, PartInstance, RobotModel } from "./types";

function poseToBase(m: Matrix4): PartInstance["basePose"] {
  const p = new Vector3().setFromMatrixPosition(m);
  const q = new Quaternion().setFromRotationMatrix(m);
  return { posMm: [p.x, p.y, p.z], quatWxyz: [q.w, q.x, q.y, q.z] };
}

/**
 * 島の再ルート:partIdを島の根にする(親子chainのtree接続を反転)。
 * 全パーツのworld姿勢は変わらない。失敗時はnull。
 */
export function rerootIsland(model: RobotModel, partId: string): RobotModel | null {
  const byChild = new Map<string, Connection>();
  for (const c of model.connections) if (c.kind === "tree") byChild.set(c.childPart, c);
  if (!byChild.has(partId)) return model; // すでに根

  const { poses } = computePoses(model);
  const chain: Connection[] = [];
  let cur = partId;
  const seen = new Set<string>();
  while (byChild.has(cur)) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const c = byChild.get(cur)!;
    chain.push(c);
    cur = c.parentPart;
  }
  const oldRoot = cur;

  const chainIds = new Set(chain.map((c) => c.id));
  const newConns: Connection[] = model.connections.filter((c) => !chainIds.has(c.id));
  for (const c of chain) {
    // 反転:旧child→新parent
    const newParentInst = model.parts.find((p) => p.id === c.childPart);
    const newChildInst = model.parts.find((p) => p.id === c.parentPart);
    if (!newParentInst || !newChildInst) return null;
    const ph = findHole(getDef(newParentInst.defId), c.childHole);
    const ch = findHole(getDef(newChildInst.defId), c.parentHole);
    const parentM = poses.get(c.childPart);
    const desired = poses.get(c.parentPart);
    if (!ph || !ch || !parentM || !desired) return null;
    const params = solveAttachParams(parentM, ph, ch, desired);
    if (!params) return null;
    newConns.push({
      id: c.id,
      kind: "tree",
      parentPart: c.childPart,
      parentHole: c.childHole,
      childPart: c.parentPart,
      childHole: c.parentHole,
      pins: c.pins,
      angleDeg: params.angleDeg,
      side: params.side,
      flip: params.flip,
    });
  }

  const newRootPose = poses.get(partId);
  if (!newRootPose) return null;
  const parts = model.parts.map((p) => {
    if (p.id === partId) return { ...p, basePose: poseToBase(newRootPose) };
    if (p.id === oldRoot) {
      const { basePose: _drop, ...rest } = p;
      return rest as PartInstance;
    }
    return p;
  });
  return { ...model, parts, connections: newConns };
}

/**
 * 島同士のピン結合:aの穴(親側)にbの穴(子側)を吸着させ、bの島ごと移動して結合。
 * ユーザーが結合前に合わせた「今の姿勢」をできるだけ保つ:
 *  - side/flip は、bの穴法線の現在の向きに最も近い組を選ぶ(同点ならクリックした面)
 *  - ねじり角は、現在の姿勢へのスイング・ツイスト分解のツイスト成分をそのまま使う
 * 同じ島なら null(呼び出し側で「追いピン(loop)」として扱う)。
 */
export function joinIslands(
  model: RobotModel,
  a: { partId: string; holeRef: HoleRef },
  b: { partId: string; holeRef: HoleRef },
  clickedSide: 1 | -1,
  pins: number
): RobotModel | null {
  if (islandRootOf(model, a.partId) === islandRootOf(model, b.partId)) return null;
  // bを自分の島の根にしてから、aの子としてぶら下げる
  const rerooted = rerootIsland(model, b.partId);
  if (!rerooted) return null;

  // 現在の姿勢に最も近い取付パラメータを選ぶ
  const aInst = rerooted.parts.find((p) => p.id === a.partId);
  const bInst = rerooted.parts.find((p) => p.id === b.partId);
  if (!aInst || !bInst) return null;
  const holeA = findHole(getDef(aInst.defId), a.holeRef);
  const holeB = findHole(getDef(bInst.defId), b.holeRef);
  if (!holeA || !holeB) return null;
  const posesR = computePoses(rerooted).poses;
  const Ma = posesR.get(a.partId);
  const Mb = posesR.get(b.partId);
  if (!Ma || !Mb) return null;
  const qa = new Quaternion().setFromRotationMatrix(Ma);
  const qb = new Quaternion().setFromRotationMatrix(Mb);
  const na = holeA.normal.clone().applyQuaternion(qa).normalize();
  const nbCur = holeB.normal.clone().applyQuaternion(qb).normalize();

  let best: { score: number; side: 1 | -1; flip: boolean; angleDeg: number } | null = null;
  for (const side of [1, -1] as const) {
    for (const flip of [false, true]) {
      const d = na.clone().multiplyScalar(side);
      const targetN = flip ? d.clone() : d.clone().negate();
      const score = targetN.dot(nbCur) + (side === clickedSide ? 1e-3 : 0);
      if (best && score <= best.score) continue;
      // ツイスト角:現在姿勢と angle=0 姿勢の差分の、d軸まわり成分
      const m0 = computeAttachment(Ma, holeA, holeB, 0, side, flip);
      const q0 = new Quaternion().setFromRotationMatrix(m0);
      const qDelta = qb.clone().multiply(q0.clone().invert()).normalize();
      const proj = new Vector3(qDelta.x, qDelta.y, qDelta.z).dot(d);
      let angleDeg = (2 * Math.atan2(proj, qDelta.w) * 180) / Math.PI;
      angleDeg = ((angleDeg + 180) % 360 + 360) % 360 - 180;
      best = { score, side, flip, angleDeg: Math.round(angleDeg * 10) / 10 };
    }
  }
  if (!best) return null;

  const conn: Connection = {
    id: `c${rerooted.nextSeq}`,
    kind: "tree",
    parentPart: a.partId,
    parentHole: a.holeRef,
    childPart: b.partId,
    childHole: b.holeRef,
    pins,
    angleDeg: best.angleDeg,
    side: best.side,
    flip: best.flip,
  };
  const parts = rerooted.parts.map((p) => {
    if (p.id !== b.partId) return p;
    const { basePose: _drop, ...rest } = p;
    return rest as PartInstance;
  });
  return {
    ...rerooted,
    parts,
    connections: [...rerooted.connections, conn],
    nextSeq: rerooted.nextSeq + 1,
  };
}

/**
 * 切り離し:partIdを親から外して自由な島にする(その場に留まる。子孫はついてくる)。
 * 島をまたぐことになるloop接続は取り除く。
 */
export function detachPart(model: RobotModel, partId: string): RobotModel | null {
  const conn = model.connections.find((c) => c.kind === "tree" && c.childPart === partId);
  if (!conn) return null; // すでに島の根
  const { poses } = computePoses(model);
  const pose = poses.get(partId);
  if (!pose) return null;
  const withoutConn = model.connections.filter((c) => c.id !== conn.id);
  const island = subtreeParts({ ...model, connections: withoutConn }, partId);
  const connections = withoutConn.filter((c) => {
    if (c.kind !== "loop") return true;
    const aIn = island.has(c.parentPart);
    const bIn = island.has(c.childPart);
    return aIn === bIn; // 島をまたぐ追いピンは削除
  });
  const parts = model.parts.map((p) =>
    p.id === partId ? { ...p, basePose: poseToBase(pose) } : p
  );
  return { ...model, parts, connections };
}
