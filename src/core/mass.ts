// 質量・重心・慣性の計算(剛体の合成則)。企画書§5.2:精密さより破綻しないことを優先。
import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { getDef } from "../data/catalog";
import type { Assembly } from "./assembly";
import type { Geom, PartDef, PartInstance, RobotModel } from "./types";
import { partMass } from "./types";

export function geomVolumeMm3(g: Geom): number {
  switch (g.type) {
    case "box":
      return g.sizeMm[0] * g.sizeMm[1] * g.sizeMm[2];
    case "cylinder":
      return Math.PI * g.radiusMm ** 2 * g.heightMm;
    case "sphere":
      return (4 / 3) * Math.PI * g.radiusMm ** 3;
    case "triprism":
      return 0.5 * g.sideMm ** 2 * g.thickMm;
  }
}

export function geomCenterMm(g: Geom): Vector3 {
  const p = new Vector3(...(g.posMm ?? [0, 0, 0]));
  if (g.type === "triprism") p.add(new Vector3(g.sideMm / 3, g.sideMm / 3, 0));
  return p;
}

/** ジオメトリ単体の慣性テンsoル(質量m、自身の重心まわり、パーツ座標系) */
export function geomInertiaGmm2(g: Geom, massG: number): Matrix3 {
  let dxx = 0, dyy = 0, dzz = 0;
  let axis: Vector3 | null = null;
  switch (g.type) {
    case "box": {
      const [a, b, c] = g.sizeMm;
      dxx = (massG / 12) * (b * b + c * c);
      dyy = (massG / 12) * (a * a + c * c);
      dzz = (massG / 12) * (a * a + b * b);
      break;
    }
    case "triprism": {
      // 箱近似(辺 0.7s × 0.7s × t)
      const a = 0.7 * g.sideMm, b = 0.7 * g.sideMm, c = g.thickMm;
      dxx = (massG / 12) * (b * b + c * c);
      dyy = (massG / 12) * (a * a + c * c);
      dzz = (massG / 12) * (a * a + b * b);
      break;
    }
    case "cylinder": {
      const r = g.radiusMm, h = g.heightMm;
      dxx = dyy = (massG / 12) * (3 * r * r + h * h);
      dzz = (massG / 2) * r * r;
      axis = new Vector3(...(g.axis ?? [0, 0, 1])).normalize();
      break;
    }
    case "sphere": {
      dxx = dyy = dzz = (2 / 5) * massG * g.radiusMm ** 2;
      break;
    }
  }
  const I = new Matrix3().set(dxx, 0, 0, 0, dyy, 0, 0, 0, dzz);
  if (axis && Math.abs(axis.z) < 0.9999) {
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), axis);
    return rotateInertia(I, q);
  }
  return I;
}

export function rotateInertia(I: Matrix3, q: Quaternion): Matrix3 {
  const R = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(q));
  const Rt = R.clone().transpose();
  return R.clone().multiply(I).multiply(Rt);
}

/** 平行軸の定理:重心まわり慣性Iを、d(mm)だけ離れた点まわりに移す */
export function parallelAxis(I: Matrix3, massG: number, d: Vector3): Matrix3 {
  const d2 = d.lengthSq();
  const shift = new Matrix3().set(
    massG * (d2 - d.x * d.x), -massG * d.x * d.y, -massG * d.x * d.z,
    -massG * d.y * d.x, massG * (d2 - d.y * d.y), -massG * d.y * d.z,
    -massG * d.z * d.x, -massG * d.z * d.y, massG * (d2 - d.z * d.z)
  );
  return addM3(I, shift);
}

function addM3(a: Matrix3, b: Matrix3): Matrix3 {
  const e = a.elements.map((v, i) => v + b.elements[i]);
  return new Matrix3().fromArray(e as unknown as number[]);
}

export interface PartMassProps {
  massG: number;
  comLocalMm: Vector3; // パーツ座標系での重心
}

/** パーツの質量特性:カタログ質量を体積比でジオメトリに配分 */
export function partMassProps(def: PartDef, material: PartInstance["material"]): PartMassProps {
  const m = partMass(def, material);
  const geoms = [...def.geoms, ...(def.hornGeoms ?? [])];
  const vols = geoms.map(geomVolumeMm3);
  const vtot = vols.reduce((a, b) => a + b, 0) || 1;
  const com = new Vector3();
  geoms.forEach((g, i) => com.addScaledVector(geomCenterMm(g), vols[i] / vtot));
  return { massG: m, comLocalMm: com };
}

/** パーツの慣性(パーツ重心まわり、パーツ座標系) */
export function partInertiaGmm2(def: PartDef, material: PartInstance["material"]): Matrix3 {
  const { massG: m, comLocalMm } = partMassProps(def, material);
  const geoms = [...def.geoms, ...(def.hornGeoms ?? [])];
  const vols = geoms.map(geomVolumeMm3);
  const vtot = vols.reduce((a, b) => a + b, 0) || 1;
  let I = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  geoms.forEach((g, i) => {
    const mg = (m * vols[i]) / vtot;
    const Ig = geomInertiaGmm2(g, mg);
    const d = geomCenterMm(g).sub(comLocalMm);
    I = addM3(I, parallelAxis(Ig, mg, d));
  });
  return I;
}

export interface LinkMassProps {
  massG: number;
  comWorldMm: Vector3;
  inertiaWorldGmm2: Matrix3; // 重心まわり・world軸
}

/** リンク(剛結合されたパーツ群)の合成質量特性。rest姿勢で計算 */
export function linkMassProps(model: RobotModel, asm: Assembly, linkIdx: number): LinkMassProps {
  let m = 0;
  const com = new Vector3();
  const parts: { inst: PartInstance; M: Matrix4 }[] = [];
  for (const body of asm.linkBodies[linkIdx]) {
    if (body.endsWith("#horn")) continue; // 質量はmain側で一括計上
    const inst = model.parts.find((p) => p.id === body);
    if (!inst) continue;
    const M = asm.poses.get(inst.id);
    if (!M) continue;
    parts.push({ inst, M });
    const def = getDef(inst.defId);
    const props = partMassProps(def, inst.material);
    m += props.massG;
    com.addScaledVector(props.comLocalMm.clone().applyMatrix4(M), props.massG);
  }
  if (m > 0) com.divideScalar(m);
  let I = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  for (const { inst, M } of parts) {
    const def = getDef(inst.defId);
    const props = partMassProps(def, inst.material);
    const q = new Quaternion().setFromRotationMatrix(M);
    const Ip = rotateInertia(partInertiaGmm2(def, inst.material), q);
    const d = props.comLocalMm.clone().applyMatrix4(M).sub(com);
    I = addM3(I, parallelAxis(Ip, props.massG, d));
  }
  return { massG: m, comWorldMm: com, inertiaWorldGmm2: I };
}

export interface RobotMassSummary {
  totalMassG: number;
  cogWorldMm: Vector3;
  perPart: Map<string, { massG: number; comWorldMm: Vector3 }>;
}

export function robotMassSummary(model: RobotModel, asm: Assembly): RobotMassSummary {
  let total = 0;
  const cog = new Vector3();
  const perPart = new Map<string, { massG: number; comWorldMm: Vector3 }>();
  for (const inst of model.parts) {
    const M = asm.poses.get(inst.id);
    if (!M) continue;
    const def = getDef(inst.defId);
    const props = partMassProps(def, inst.material);
    const comW = props.comLocalMm.clone().applyMatrix4(M);
    perPart.set(inst.id, { massG: props.massG, comWorldMm: comW });
    total += props.massG;
    cog.addScaledVector(comW, props.massG);
  }
  if (total > 0) cog.divideScalar(total);
  return { totalMassG: total, cogWorldMm: cog, perPart };
}
