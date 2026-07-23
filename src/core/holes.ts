// 穴の展開と座標計算。
// holesの座標系定義がスナップ実装とURDF/MJCFフレーム変換の共通ソース(別紙2§5)。
import { Matrix4, Quaternion, Vector3 } from "three";
import type { HoleRef, PartDef, Vec3 } from "./types";

export interface HoleInfo {
  ref: HoleRef;
  key: string; // 一意キー(接続レコードの照合用)
  posMm: Vector3; // パーツローカル(中心面)
  normal: Vector3; // 単位ベクトル
  uAxis: Vector3;
  thicknessMm: number;
  body: "main" | "horn";
  kind: "plain" | "drive" | "idler";
}

export function holeKey(ref: HoleRef): string {
  return "special" in ref ? `s:${ref.special}` : `g:${ref.group}:${ref.index}`;
}

export function sameHole(a: HoleRef, b: HoleRef): boolean {
  return holeKey(a) === holeKey(b);
}

const v = (a: Vec3) => new Vector3(a[0], a[1], a[2]);

/** パーツ定義から全穴を展開(ローカル座標) */
export function expandHoles(def: PartDef): HoleInfo[] {
  const out: HoleInfo[] = [];
  (def.holes ?? []).forEach((g, gi) => {
    const n = v(g.normal).normalize();
    const u = v(g.uAxis).normalize();
    const w = new Vector3().crossVectors(n, u); // v軸 = normal × uAxis
    const origin = v(g.originMm);
    if (g.ring) {
      for (let i = 0; i < g.ring.count; i++) {
        const th = (2 * Math.PI * i) / g.ring.count;
        const p = origin
          .clone()
          .addScaledVector(u, g.ring.radiusMm * Math.cos(th))
          .addScaledVector(w, g.ring.radiusMm * Math.sin(th));
        out.push({
          ref: { group: gi, index: i },
          key: `g:${gi}:${i}`,
          posMm: p,
          normal: n.clone(),
          uAxis: u.clone(),
          thicknessMm: g.thicknessMm,
          body: g.body ?? "main",
          kind: "plain",
        });
      }
      return;
    }
    let idx = 0;
    for (let i = 0; i < g.rows; i++) {
      for (let j = 0; j < g.cols; j++) {
        // rows*cols全マスでindexを振る(maskはスキップしてもindexは進める→定義変更に強い)
        const masked = g.maskTriangle && i + j > g.rows - 1;
        if (!masked) {
          const p = origin
            .clone()
            .addScaledVector(u, i * g.pitchMm)
            .addScaledVector(w, j * g.pitchMm);
          out.push({
            ref: { group: gi, index: idx },
            key: `g:${gi}:${idx}`,
            posMm: p,
            normal: n.clone(),
            uAxis: u.clone(),
            thicknessMm: g.thicknessMm,
            body: g.body ?? "main",
            kind: "plain",
          });
        }
        idx++;
      }
    }
  });
  for (const s of def.specialHoles ?? []) {
    const n = v(s.normal).normalize();
    // uAxisは法線に直交する適当な軸
    const u = Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1).cross(n).normalize() : new Vector3(1, 0, 0);
    out.push({
      ref: { special: s.kind },
      key: `s:${s.kind}`,
      posMm: v(s.posMm),
      normal: n,
      uAxis: u,
      thicknessMm: s.thicknessMm,
      body: "horn", // 駆動穴・アイドラー穴への接続はホーン(回転体)側につく
      kind: s.kind,
    });
  }
  return out;
}

const holeCache = new Map<string, HoleInfo[]>();
export function holesOf(def: PartDef): HoleInfo[] {
  let h = holeCache.get(def.id);
  if (!h) {
    h = expandHoles(def);
    holeCache.set(def.id, h);
  }
  return h;
}

export function findHole(def: PartDef, ref: HoleRef): HoleInfo | undefined {
  const k = holeKey(ref);
  return holesOf(def).find((h) => h.key === k);
}

/** 取付時に子パーツ側として使うデフォルトの穴(通常穴の先頭) */
export function defaultAttachHole(def: PartDef): HoleInfo | undefined {
  const hs = holesOf(def);
  return hs.find((h) => h.kind === "plain" && h.body === "main") ?? hs[0];
}

/**
 * 配置前に選べる取付面。同じ向きの穴グループは1面としてまとめる。
 * サーボなら「底面」と「背面」、L字金具なら各直交面が返る。
 */
export function mountingFacesOf(def: PartDef): HoleInfo[] {
  const seen = new Set<string>();
  return holesOf(def).filter((hole) => {
    if (hole.kind !== "plain" || hole.body !== "main") return false;
    const key = [hole.normal.x, hole.normal.y, hole.normal.z]
      .map((n) => Math.round(n * 1000))
      .join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 選んだ取付面を床へ向け、Z軸まわりに向きを調整した自由配置姿勢。 */
export function floorPlacementQuaternion(childHole: HoleInfo, angleDeg: number): Quaternion {
  const down = new Vector3(0, 0, -1);
  const align = new Quaternion().setFromUnitVectors(childHole.normal.clone().normalize(), down);
  const twist = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    (angleDeg * Math.PI) / 180
  );
  return twist.multiply(align).normalize();
}

/**
 * 取付変換の計算(スナップの数学的中核)。
 * 親パーツ姿勢 Pp、親穴(ローカル)、子穴(ローカル)、回転角θ、面side s から
 * 子パーツの姿勢(world)を求める:
 *  - 子穴の法線が親穴の取付方向 d = s * n_parent_world と逆向きになる(flip時は同じ向き)
 *  - 穴中心同士は d 方向に板厚の和/2 だけオフセット(面と面がぴったり重なる)
 *  - θ は d まわりのねじり
 */
export function computeAttachment(
  parentMatrix: Matrix4,
  parentHole: HoleInfo,
  childHole: HoleInfo,
  angleDeg: number,
  side: 1 | -1,
  flip = false
): Matrix4 {
  const pRot = new Quaternion().setFromRotationMatrix(parentMatrix);
  const pw = parentHole.posMm.clone().applyMatrix4(parentMatrix);
  const nw = parentHole.normal.clone().applyQuaternion(pRot).normalize();
  const d = nw.multiplyScalar(side); // 取付方向(親の表面から外向き)

  // 子の向き:childHole.normal → -d(flip時は +d)
  const targetN = flip ? d.clone() : d.clone().negate();
  const qAlign = new Quaternion().setFromUnitVectors(childHole.normal.clone().normalize(), targetN);
  const qTwist = new Quaternion().setFromAxisAngle(d, (angleDeg * Math.PI) / 180);
  const q = qTwist.multiply(qAlign);

  const offset = (parentHole.thicknessMm + childHole.thicknessMm) / 2;
  const target = pw.clone().addScaledVector(d, offset);
  const childHoleWorld = childHole.posMm.clone().applyQuaternion(q);
  const t = target.sub(childHoleWorld);

  return new Matrix4().compose(t, q, new Vector3(1, 1, 1));
}

/**
 * 逆問題:望みの子姿勢を再現する取付パラメータ(angle, side, flip)を探す。
 * 島の再ルート(親子反転)に使う。4通りの(side, flip)を総当たりし、
 * ねじり角はクォータニオン差分から解析的に求めて検算する。
 */
export function solveAttachParams(
  parentMatrix: Matrix4,
  parentHole: HoleInfo,
  childHole: HoleInfo,
  desiredChildMatrix: Matrix4
): { angleDeg: number; side: 1 | -1; flip: boolean } | null {
  const desiredPos = new Vector3().setFromMatrixPosition(desiredChildMatrix);
  const desiredQ = new Quaternion().setFromRotationMatrix(desiredChildMatrix);
  const pRot = new Quaternion().setFromRotationMatrix(parentMatrix);

  for (const side of [1, -1] as const) {
    for (const flip of [false, true]) {
      const nw = parentHole.normal.clone().applyQuaternion(pRot).normalize();
      const d = nw.multiplyScalar(side);
      const m0 = computeAttachment(parentMatrix, parentHole, childHole, 0, side, flip);
      const q0 = new Quaternion().setFromRotationMatrix(m0);
      // 残差回転はd軸まわりのはず
      const qDelta = desiredQ.clone().multiply(q0.clone().invert()).normalize();
      let angleDeg = 0;
      const w = Math.min(1, Math.max(-1, qDelta.w));
      const theta = 2 * Math.acos(Math.abs(w));
      if (theta > 1e-4) {
        const axis = new Vector3(qDelta.x, qDelta.y, qDelta.z).normalize();
        const alignment = axis.dot(d) * Math.sign(qDelta.w >= 0 ? 1 : -1);
        if (Math.abs(alignment) < 0.999) continue; // d軸まわりでない
        angleDeg = ((theta * 180) / Math.PI) * Math.sign(alignment);
      }
      const test = computeAttachment(parentMatrix, parentHole, childHole, angleDeg, side, flip);
      const tPos = new Vector3().setFromMatrixPosition(test);
      const tQ = new Quaternion().setFromRotationMatrix(test);
      if (tPos.distanceTo(desiredPos) < 0.5 && Math.abs(tQ.dot(desiredQ)) > 0.9999) {
        return { angleDeg, side, flip };
      }
    }
  }
  return null;
}
