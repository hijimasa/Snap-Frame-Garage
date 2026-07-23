// ドラッグ中の穴スナップ(linksim流:近くの穴に吸い付く)。
// 動かしている島の穴と、動かない側の穴が「軸が合っていて距離が近い」とき、
// 板厚ぶんのオフセットで面がぴったり重なる位置に島の根の座標を補正する。
// スナップ結果は穴のIDを持ち、そのままピン結合(joinIslands)に使える。
import { Quaternion, Vector3 } from "three";
import { getDef } from "../data/catalog";
import { subtreeParts, type Assembly } from "./assembly";
import { holesOf, type HoleInfo } from "./holes";
import type { RobotModel } from "./types";

export const SNAP_RADIUS_MM = 7;
const BUCKET_MM = 20;

export interface HoleId {
  partId: string;
  holeKey: string;
}

interface SnapHole {
  p: Vector3;
  n: Vector3;
  t: number;
  id: HoleId;
}

export interface DragSnapData {
  dragHoles: { rel: Vector3; n: Vector3; t: number; id: HoleId }[]; // 島の根からの相対位置
  buckets: Map<string, SnapHole[]>; // 動かない側の穴(XY空間バケット)
}

export function buildDragSnapData(model: RobotModel, asm: Assembly, rootId: string): DragSnapData {
  const island = subtreeParts(model, rootId);
  const rootM = asm.poses.get(rootId);
  const rootPos = rootM ? new Vector3().setFromMatrixPosition(rootM) : new Vector3();
  const dragHoles: DragSnapData["dragHoles"] = [];
  const buckets = new Map<string, SnapHole[]>();
  for (const p of model.parts) {
    const M = asm.poses.get(p.id);
    if (!M) continue;
    const q = new Quaternion().setFromRotationMatrix(M);
    for (const h of holesOf(getDef(p.defId))) {
      const pw = h.posMm.clone().applyMatrix4(M);
      const n = h.normal.clone().applyQuaternion(q).normalize();
      const id = { partId: p.id, holeKey: h.key };
      if (island.has(p.id)) {
        dragHoles.push({ rel: pw.clone().sub(rootPos), n, t: h.thicknessMm, id });
      } else {
        const key = `${Math.round(pw.x / BUCKET_MM)}:${Math.round(pw.y / BUCKET_MM)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push({ p: pw, n, t: h.thicknessMm, id });
      }
    }
  }
  return { dragHoles, buckets };
}

export interface SnapResult {
  pos: Vector3; // スナップ後の島の根の位置
  holeP: Vector3; // 吸着先(相手の穴・表面オフセット済みの合わせ位置)
  n: Vector3;
  dist: number;
  staticHole: HoleId; // 相手側(動かない)の穴
  dragHole: HoleId; // 動かした島側の穴
  side: 1 | -1; // 相手穴のどちらの面に付いたか
}

/** raw = 島の根の仮位置。近くに軸の合う穴ペアがあれば補正後の位置を返す */
export function findSnap(raw: Vector3, data: DragSnapData): SnapResult | null {
  let best: SnapResult | null = null;
  for (const dh of data.dragHoles) {
    const pw = dh.rel.clone().add(raw);
    const bx = Math.round(pw.x / BUCKET_MM);
    const by = Math.round(pw.y / BUCKET_MM);
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        for (const sh of data.buckets.get(`${bx + gx}:${by + gy}`) ?? []) {
          if (Math.abs(dh.n.dot(sh.n)) < 0.9) continue; // 軸が合っていない
          const dist = pw.distanceTo(sh.p);
          if (dist > SNAP_RADIUS_MM) continue;
          if (best && dist >= best.dist) continue;
          const sideSign = (Math.sign(pw.clone().sub(sh.p).dot(sh.n)) || 1) as 1 | -1;
          const target = sh.p.clone().addScaledVector(sh.n, (sideSign * (sh.t + dh.t)) / 2);
          best = {
            dist,
            pos: raw.clone().add(target).sub(pw),
            holeP: target,
            n: sh.n.clone(),
            staticHole: sh.id,
            dragHole: dh.id,
            side: sideSign,
          };
        }
      }
    }
  }
  return best;
}

/**
 * 指定した穴と「重なっている」穴を全パーツから探す(ワンクリックピン用)。
 * 重なり = 距離が板厚の和/2+ゆとり以内、かつ軸が平行。
 */
export function findCoincidentHole(
  model: RobotModel,
  asm: Assembly,
  partId: string,
  hole: HoleInfo
): { id: HoleId; side: 1 | -1 } | null {
  const M = asm.poses.get(partId);
  if (!M) return null;
  const q = new Quaternion().setFromRotationMatrix(M);
  const p0 = hole.posMm.clone().applyMatrix4(M);
  const n0 = hole.normal.clone().applyQuaternion(q).normalize();

  let best: { id: HoleId; side: 1 | -1; dist: number } | null = null;
  for (const other of model.parts) {
    if (other.id === partId) continue;
    const Mo = asm.poses.get(other.id);
    if (!Mo) continue;
    const qo = new Quaternion().setFromRotationMatrix(Mo);
    for (const h of holesOf(getDef(other.defId))) {
      const pw = h.posMm.clone().applyMatrix4(Mo);
      const tol = (hole.thicknessMm + h.thicknessMm) / 2 + 1.5;
      const dist = p0.distanceTo(pw);
      if (dist > tol) continue;
      const nw = h.normal.clone().applyQuaternion(qo).normalize();
      if (Math.abs(n0.dot(nw)) < 0.9) continue;
      if (best && dist >= best.dist) continue;
      const side = (Math.sign(pw.clone().sub(p0).dot(n0)) || 1) as 1 | -1;
      best = { id: { partId: other.id, holeKey: h.key }, side, dist };
    }
  }
  return best ? { id: best.id, side: best.side } : null;
}
