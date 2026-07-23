// リンク機構(からくり)の拘束ソルバ。
// ループピン(kind=loop, pins=1)の「2つの穴が重なったまま」という拘束を保ちながら、
// 受動関節の角度を数値的に解く(ガウス・ニュートン+減衰)。
//  - 掴んで回す:掴んだ関節の角度を固定入力に、残りの受動関節を連動させる(rest姿勢を解く)
//  - ポーズプレビュー:サーボ角を固定入力に、受動関節の表示角を連動させる(表示のみ)
// linksimのCanMove(拘束伝播)に相当する機能の数値版。
import { Matrix4, Quaternion, Vector3 } from "three";
import { getDef } from "../data/catalog";
import {
  bodyOfHole,
  computePoses,
  linkDeltas,
  type Assembly,
} from "./assembly";
import { findHole, type HoleInfo } from "./holes";
import type { Connection, RobotModel } from "./types";

const DEG = Math.PI / 180;

// ピン拘束の残差は「穴間の差ベクトルがrest時から変わらない」の3成分で表す。
// 平面機構ではピン軸が一定なので、差ベクトル(=軸方向の積層オフセット)は不変。
// ノルム(距離)を残差にすると解の点で微分不能になりソルバが振動する。

interface LoopC {
  aPart: string;
  bPart: string;
  aHole: HoleInfo;
  bHole: HoleInfo;
}

function isPlainHole(model: RobotModel, partId: string, ref: Connection["parentHole"]): HoleInfo | null {
  const inst = model.parts.find((p) => p.id === partId);
  if (!inst) return null;
  const h = findHole(getDef(inst.defId), ref);
  if (!h || h.kind !== "plain") return null;
  return h;
}

/** ループ拘束(受動の追いピン)を集める。特別穴への追いピンは剛結合済みなので除外 */
function collectLoops(model: RobotModel, partFilter?: Set<string>): LoopC[] {
  const out: LoopC[] = [];
  for (const c of model.connections) {
    if (c.kind !== "loop" || c.pins !== 1) continue;
    if (partFilter && !partFilter.has(c.parentPart) && !partFilter.has(c.childPart)) continue;
    const ha = isPlainHole(model, c.parentPart, c.parentHole);
    const hb = isPlainHole(model, c.childPart, c.childHole);
    if (!ha || !hb) continue;
    out.push({ aPart: c.parentPart, bPart: c.childPart, aHole: ha, bHole: hb });
  }
  return out;
}

/** すべての接続でつながったパーツの連結成分(対象パーツと同じ機構だけを解くため) */
function componentOf(model: RobotModel, seedPart: string): Set<string> {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const c of model.connections) {
    add(c.parentPart, c.childPart);
    add(c.childPart, c.parentPart);
  }
  const seen = new Set<string>([seedPart]);
  const stack = [seedPart];
  while (stack.length) {
    const p = stack.pop()!;
    for (const q of adj.get(p) ?? []) {
      if (!seen.has(q)) {
        seen.add(q);
        stack.push(q);
      }
    }
  }
  return seen;
}

/** 小さい連立一次方程式のガウス消去(JᵀJ+λI)dx = -Jᵀr 用 */
function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/** 汎用ガウス・ニュートン(数値ヤコビアン・減衰・ステップ制限つき)。exportはテスト用 */
export function solveGN(
  nVars: number,
  evalR: (x: Float64Array) => number[],
  maxIter = 15,
  x0?: Float64Array
): { x: Float64Array; maxErr: number } {
  const x = x0 ? new Float64Array(x0) : new Float64Array(nVars);
  let r = evalR(x);
  const maxAbs = (v: number[]) => v.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
  let best = maxAbs(r);
  if (nVars === 0) return { x, maxErr: best };
  const h = 0.01; // rad
  for (let iter = 0; iter < maxIter && best > 0.05; iter++) {
    const m = r.length;
    // J: m×n(前進差分)
    const J: number[][] = Array.from({ length: m }, () => new Array(nVars).fill(0));
    for (let i = 0; i < nVars; i++) {
      const x2 = new Float64Array(x);
      x2[i] += h;
      const r2 = evalR(x2);
      for (let k = 0; k < m; k++) J[k][i] = (r2[k] - r[k]) / h;
    }
    // (JᵀJ + λI) dx = -Jᵀ r
    const A: number[][] = Array.from({ length: nVars }, () => new Array(nVars).fill(0));
    const b: number[] = new Array(nVars).fill(0);
    for (let i = 0; i < nVars; i++) {
      for (let j = 0; j < nVars; j++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += J[k][i] * J[k][j];
        A[i][j] = s + (i === j ? 0.02 : 0);
      }
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k][i] * r[k];
      b[i] = -s;
    }
    const dx = gaussSolve(A, b);
    if (!dx) break;
    for (let i = 0; i < nVars; i++) x[i] += Math.max(-0.35, Math.min(0.35, dx[i]));
    r = evalR(x);
    best = maxAbs(r);
  }
  return { x, maxErr: best };
}

/**
 * 掴んで回す用:targetの接続角を固定し、同じ機構内の他の受動関節(tree・ピン1本)の
 * rest角を、ループ拘束を保つように解く。
 * 戻り値 null = この機構にループ拘束がない(呼び出し側は単独回転にフォールバック)。
 */
export function solveRestLinkage(
  model: RobotModel,
  target: { connId: string; angleDeg: number }
): { angles: Map<string, number>; maxErrMm: number } | null {
  const targetConn = model.connections.find((c) => c.id === target.connId);
  if (!targetConn) return null;
  const comp = componentOf(model, targetConn.childPart);
  const loops = collectLoops(model, comp);
  if (loops.length === 0) return null;

  // 保つべき穴間差ベクトル=いまのrest姿勢での値(intactなら軸方向の積層オフセットのみ)
  const restPoses = computePoses(model).poses;
  const diff0 = loops.map((l) => {
    const Ma = restPoses.get(l.aPart);
    const Mb = restPoses.get(l.bPart);
    if (!Ma || !Mb) return new Vector3();
    return l.aHole.posMm
      .clone()
      .applyMatrix4(Ma)
      .sub(l.bHole.posMm.clone().applyMatrix4(Mb));
  });

  const vars = model.connections.filter(
    (c) =>
      c.kind === "tree" &&
      c.pins === 1 &&
      c.id !== target.connId &&
      comp.has(c.childPart) &&
      isPlainHole(model, c.parentPart, c.parentHole) &&
      isPlainHole(model, c.childPart, c.childHole)
  );

  // 連続化:大きな角度ジャンプは8°刻みに分割して逐次解く。
  // 連続な枝(実際に手で回したときの動き)を追跡し、交差解への飛び移りを防ぐ
  const startDeg = targetConn.angleDeg;
  const totalDelta = target.angleDeg - startDeg;
  const steps = Math.max(1, Math.ceil(Math.abs(totalDelta) / 8));
  const running = new Map<string, number>(vars.map((c) => [c.id, c.angleDeg]));
  let maxErr = 0;
  // 速度外挿:前ステップの各関節の変化量を次の初期値にする。
  // 特異姿勢(リンクが一直線)を通過するときも、運動が連続な枝を追跡できる
  let prevStep: Float64Array | null = null;

  for (let s = 1; s <= steps; s++) {
    const tgt = startDeg + (totalDelta * s) / steps;
    const overrides = new Map<string, number>([[target.connId, tgt]]);
    const evalR = (x: Float64Array): number[] => {
      vars.forEach((c, i) => overrides.set(c.id, running.get(c.id)! + x[i] / DEG));
      const { poses } = computePoses(model, overrides);
      const r: number[] = [];
      loops.forEach((l, k) => {
        const Ma = poses.get(l.aPart);
        const Mb = poses.get(l.bPart);
        if (!Ma || !Mb) {
          r.push(0, 0, 0);
          return;
        }
        const diff = l.aHole.posMm
          .clone()
          .applyMatrix4(Ma)
          .sub(l.bHole.posMm.clone().applyMatrix4(Mb))
          .sub(diff0[k]);
        r.push(diff.x, diff.y, diff.z);
      });
      return r;
    };
    const { x, maxErr: err } = solveGN(vars.length, evalR, 15, prevStep ?? undefined);
    vars.forEach((c, i) => running.set(c.id, running.get(c.id)! + x[i] / DEG));
    prevStep = x;
    maxErr = err;
    if (err > 3) break; // 可動限界:これ以上は解けない
  }

  const angles = new Map<string, number>([[target.connId, target.angleDeg]]);
  for (const [id, a] of running) angles.set(id, a);
  return { angles, maxErrMm: maxErr };
}

/**
 * テンプレート組立用:指定した受動関節(varConnIds)の角度を、
 * 指定ループピン(loopConnIds)の穴が「軸方向オフセットを除いて一致」するように解く。
 * ビルド時の約1°精度の初期角を、厳密に閉じた角度へ磨き上げる。
 */
export function settleLoops(
  model: RobotModel,
  varConnIds: string[],
  loopConnIds: string[]
): { angles: Map<string, number>; maxErrMm: number } {
  const varSet = new Set(varConnIds);
  const loopSet = new Set(loopConnIds);
  const vars = model.connections.filter((c) => varSet.has(c.id));
  const loops: LoopC[] = [];
  for (const c of model.connections) {
    if (!loopSet.has(c.id)) continue;
    const ha = isPlainHole(model, c.parentPart, c.parentHole);
    const hb = isPlainHole(model, c.childPart, c.childHole);
    if (!ha || !hb) continue;
    loops.push({ aPart: c.parentPart, bPart: c.childPart, aHole: ha, bHole: hb });
  }
  const overrides = new Map<string, number>();
  const evalR = (x: Float64Array): number[] => {
    vars.forEach((c, i) => overrides.set(c.id, c.angleDeg + x[i] / DEG));
    const { poses } = computePoses(model, overrides);
    const r: number[] = [];
    for (const l of loops) {
      const Ma = poses.get(l.aPart);
      const Mb = poses.get(l.bPart);
      if (!Ma || !Mb) {
        r.push(0, 0, 0);
        continue;
      }
      const pa = l.aHole.posMm.clone().applyMatrix4(Ma);
      const pb = l.bHole.posMm.clone().applyMatrix4(Mb);
      const qa = new Quaternion().setFromRotationMatrix(Ma);
      const na = l.aHole.normal.clone().applyQuaternion(qa).normalize();
      const diff = pa.sub(pb);
      diff.addScaledVector(na, -na.dot(diff)); // 軸方向成分を除いた面内誤差
      r.push(diff.x, diff.y, diff.z);
    }
    return r;
  };
  const { x, maxErr } = solveGN(vars.length, evalR, 30);
  const angles = new Map<string, number>();
  vars.forEach((c, i) => angles.set(c.id, c.angleDeg + x[i] / DEG));
  return { angles, maxErrMm: maxErr };
}

/**
 * 表示角セットに対するループ拘束の最大破れ(mm)。テスト・デバッグ用。
 * 拘束対象は組立グラフ上の「全域木に入らなかった関節」すべて
 * (追いピンだけでなく、木の張り方の都合でループ扱いになったtree接続も含む)。
 */
export function loopErrorMm(
  model: RobotModel,
  asm: Assembly,
  anglesDeg: Record<string, number>
): number {
  const loops = asm.joints.filter((j) => j.isLoop && !j.locked);
  if (loops.length === 0) return 0;
  const deltas = linkDeltas(asm, anglesDeg);
  let worst = 0;
  const pa = new Vector3();
  const pb = new Vector3();
  for (const j of loops) {
    pa.copy(j.anchorMm);
    pb.copy(j.anchorMm);
    const da = deltas.get(j.linkA);
    const db = deltas.get(j.linkB);
    if (da) pa.applyMatrix4(da);
    if (db) pb.applyMatrix4(db);
    worst = Math.max(worst, pa.distanceTo(pb));
  }
  return worst;
}

/**
 * ポーズプレビュー用:サーボ角(activeDeg)を固定入力に、受動関節の表示角を
 * ループ拘束を保つように解く(rest姿勢は変えない。表示のみ)。
 * ループが無ければ activeDeg をそのまま返す。
 * warmStart: 前回の解(連続的なスライダー操作で枝を追跡するための初期値)
 */
export function solveDisplayAngles(
  model: RobotModel,
  asm: Assembly,
  activeDeg: Record<string, number>,
  warmStart?: Record<string, number>
): Record<string, number> {
  // 拘束=全域木に入らなかった関節(アンカー点を両リンクで共有し続ける)
  const pre = asm.joints
    .filter((j) => j.isLoop && !j.locked)
    .map((j) => ({ la: j.linkA, lb: j.linkB, pa: j.anchorMm.clone(), pb: j.anchorMm.clone(), diff0: new Vector3() }));
  if (pre.length === 0) return activeDeg;

  const vars = asm.joints.filter(
    (j) => j.type === "passive" && !j.isLoop && !j.locked && j.parentLink !== undefined
  );

  const activeJoints = asm.joints.filter((j) => j.type === "active" && !j.locked);
  const previousActive = Object.fromEntries(
    activeJoints.map((j) => [j.id, warmStart?.[j.id] ?? 0])
  );
  const maxActiveDelta = activeJoints.reduce(
    (max, j) => Math.max(max, Math.abs((activeDeg[j.id] ?? 0) - previousActive[j.id])),
    0
  );
  // スライダーのトラッククリックなどで入力が大きく飛んでも、8°刻みで連続な枝を追う。
  const steps = warmStart ? Math.max(1, Math.ceil(maxActiveDelta / 8)) : 1;
  let running = warmStart ? { ...warmStart } : {};

  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const stepActive: Record<string, number> = {};
    for (const j of activeJoints) {
      const from = previousActive[j.id];
      stepActive[j.id] = from + ((activeDeg[j.id] ?? 0) - from) * t;
    }
    const tmpA = new Vector3();
    const tmpB = new Vector3();
    const evalR = (x: Float64Array): number[] => {
      const angles: Record<string, number> = { ...stepActive };
      vars.forEach((j, i) => {
        angles[j.id] = x[i] / DEG;
      });
      const deltas = linkDeltas(asm, angles);
      const r: number[] = [];
      for (const c of pre) {
        const da = deltas.get(c.la);
        const db = deltas.get(c.lb);
        tmpA.copy(c.pa);
        tmpB.copy(c.pb);
        if (da) tmpA.applyMatrix4(da);
        if (db) tmpB.applyMatrix4(db);
        r.push(tmpA.x - tmpB.x - c.diff0.x, tmpA.y - tmpB.y - c.diff0.y, tmpA.z - tmpB.z - c.diff0.z);
      }
      return r;
    };
    const x0 = Float64Array.from(vars.map((j) => (running[j.id] ?? 0) * DEG));
    const { x } = solveGN(vars.length, evalR, 25, x0);
    running = { ...stepActive };
    vars.forEach((j, i) => {
      running[j.id] = x[i] / DEG;
    });
  }
  return running;
}
