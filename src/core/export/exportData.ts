// URDF/MJCF共通の中間表現。
// リンクフレーム = 親関節アンカー位置・world軸揃え(rest姿勢)。ルートはworld原点。
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { getDef } from "../../data/catalog";
import { buildAssembly, type Assembly, type AssemblyJoint } from "../assembly";
import { linkMassProps, robotMassSummary } from "../mass";
import { computePower, type PowerStatus } from "../power";
import { computeStability, type StabilityResult } from "../stability";
import type { Geom, RobotModel, ServoSpec } from "../types";

export interface ExpGeom {
  geom: Geom;
  posMm: Vector3; // リンクフレーム基準
  quat: Quaternion;
  color: string;
  partId: string;
}

export interface ExpJoint {
  name: string;
  type: "active" | "passive";
  continuous: boolean;
  servo?: ServoSpec;
  servoPartId?: string;
  axis: Vector3; // world(=リンクフレーム)軸
  anchorMm: Vector3; // world
  parentLinkIdx: number;
  childLinkIdx: number;
}

export interface ExpLink {
  idx: number;
  name: string;
  anchorMm: Vector3; // リンクフレーム原点(world)
  massG: number;
  comMm: Vector3; // リンクフレーム基準
  inertiaGmm2: Matrix3; // 重心まわり・world軸
  geoms: ExpGeom[];
  children: { joint: ExpJoint; link: ExpLink }[];
}

export interface ExportData {
  model: RobotModel;
  asm: Assembly;
  root: ExpLink;
  allLinks: ExpLink[];
  allJoints: ExpJoint[];
  loopJoints: AssemblyJoint[];
  power: PowerStatus;
  stability: StabilityResult;
  totalMassG: number;
  cogMm: Vector3;
  warnings: string[];
}

export function quatToRpy(q: Quaternion): [number, number, number] {
  const e = new Euler().setFromQuaternion(q, "ZYX");
  return [e.x, e.y, e.z]; // roll pitch yaw
}

/** cylinderのaxis指定をZ軸基準のクォータニオンへ */
export function geomQuat(g: Geom, partQuat: Quaternion): Quaternion {
  if (g.type === "cylinder" && g.axis) {
    const a = new Vector3(...g.axis).normalize();
    const align = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), a);
    return partQuat.clone().multiply(align);
  }
  return partQuat.clone();
}

export function buildExportData(model: RobotModel): ExportData {
  const asm = buildAssembly(model);
  const power = computePower(model);
  const summary = robotMassSummary(model, asm);
  const stability = computeStability(model, asm, summary.cogWorldMm);
  const warnings = [...asm.warnings];

  const nLinks = asm.linkBodies.length;
  const links: ExpLink[] = [];
  for (let i = 0; i < nLinks; i++) {
    links.push({
      idx: i,
      name: i === asm.rootLink ? "base_link" : `link_${i}`,
      anchorMm: new Vector3(),
      massG: 0,
      comMm: new Vector3(),
      inertiaGmm2: new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0),
      geoms: [],
      children: [],
    });
  }

  // 関節アンカー=子リンクのフレーム原点
  const joints: ExpJoint[] = [];
  for (const j of asm.joints) {
    if (j.locked || j.isLoop || j.parentLink === undefined || j.childLink === undefined) continue;
    links[j.childLink].anchorMm = j.anchorMm.clone();
    const servoInst = j.servoPartId ? model.parts.find((p) => p.id === j.servoPartId) : undefined;
    const servoDef = servoInst ? getDef(servoInst.defId) : undefined;
    joints.push({
      name: j.type === "active" ? `servo_${j.id}` : `pin_${j.id}`,
      type: j.type,
      continuous: servoDef?.servo?.continuous ?? false,
      servo: servoDef?.servo,
      servoPartId: j.servoPartId,
      axis: j.axisMm.clone(),
      anchorMm: j.anchorMm.clone(),
      parentLinkIdx: j.parentLink,
      childLinkIdx: j.childLink,
    });
  }
  for (const j of joints) {
    links[j.parentLinkIdx].children.push({ joint: j, link: links[j.childLinkIdx] });
  }

  // 質量特性・ジオメトリ
  for (let i = 0; i < nLinks; i++) {
    const mp = linkMassProps(model, asm, i);
    links[i].massG = mp.massG;
    links[i].comMm = mp.comWorldMm.clone().sub(links[i].anchorMm);
    links[i].inertiaGmm2 = mp.inertiaWorldGmm2;
    for (const body of asm.linkBodies[i]) {
      const horn = body.endsWith("#horn");
      const partId = horn ? body.slice(0, -5) : body;
      const inst = model.parts.find((p) => p.id === partId);
      if (!inst) continue;
      const M = asm.poses.get(partId);
      if (!M) continue;
      const def = getDef(inst.defId);
      const pQuat = new Quaternion().setFromRotationMatrix(M);
      const geomSet = horn ? def.hornGeoms ?? [] : def.geoms;
      for (const g of geomSet) {
        const posW = new Vector3(...(g.posMm ?? [0, 0, 0])).applyMatrix4(M);
        links[i].geoms.push({
          geom: g,
          posMm: posW.sub(links[i].anchorMm),
          quat: geomQuat(g, pQuat),
          color: g.color ?? "#cccccc",
          partId,
        });
      }
    }
  }

  const loopJoints = asm.joints.filter((j) => j.isLoop && !j.locked);
  if (loopJoints.length > 0) {
    warnings.push(
      "リンク機構(閉ループ)が含まれています。MJCFでは等式制約で動きますが、URDFではループを1箇所切って出力します(外部ツールでは機構が正しく動かない場合があります)"
    );
  }
  if (asm.orphanParts.length > 0) {
    warnings.push(`接続が解決できないパーツがあります: ${asm.orphanParts.join(", ")}`);
  }

  return {
    model,
    asm,
    root: links[asm.rootLink] ?? links[0],
    allLinks: links,
    allJoints: joints,
    loopJoints,
    power,
    stability,
    totalMassG: summary.totalMassG,
    cogMm: summary.cogWorldMm,
    warnings,
  };
}

export const KGCM_TO_NM = 0.0980665;
export const MM = 0.001; // mm→m
export const G = 0.001; // g→kg
/** g·mm² → kg·m² */
export const GMM2 = 1e-9;

export function servoEffortNm(s: ServoSpec): number {
  return s.torqueKgCm * KGCM_TO_NM;
}
export function servoVelocityRadS(s: ServoSpec): number {
  return s.speedSecPer60Deg > 0 ? Math.PI / 3 / s.speedSecPer60Deg : 6;
}

export function fmt(n: number, digits = 6): string {
  const s = n.toFixed(digits);
  return s === "-0." + "0".repeat(digits) ? (0).toFixed(digits) : s;
}
export function v3str(v: Vector3, scale = 1, digits = 6): string {
  return `${fmt(v.x * scale, digits)} ${fmt(v.y * scale, digits)} ${fmt(v.z * scale, digits)}`;
}
