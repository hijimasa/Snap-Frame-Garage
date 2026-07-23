// MJCFエクスポータ(シミュレータ主経路。企画書§5・§6)。
// アクチュエータはposition actuator + forcerangeで実トルク上限を表現(§3.4)。
// 閉ループ(からくり)はequality/connectで表現(別紙2§7.1)。
import { Quaternion, Vector3 } from "three";
import { getDef } from "../../data/catalog";
import type { Geom } from "../types";
import {
  fmt,
  servoEffortNm,
  servoVelocityRadS,
  v3str,
  MM,
  G,
  GMM2,
  type ExpLink,
  type ExportData,
} from "./exportData";

function rgba(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return `${fmt(r, 3)} ${fmt(g, 3)} ${fmt(b, 3)} 1`;
}

function quatStr(q: Quaternion): string {
  return `${fmt(q.w)} ${fmt(q.x)} ${fmt(q.y)} ${fmt(q.z)}`;
}

function geomAttrs(g: Geom): string {
  switch (g.type) {
    case "box":
      return `type="box" size="${fmt((g.sizeMm[0] / 2) * MM)} ${fmt((g.sizeMm[1] / 2) * MM)} ${fmt((g.sizeMm[2] / 2) * MM)}"`;
    case "cylinder":
      return `type="cylinder" size="${fmt(g.radiusMm * MM)} ${fmt((g.heightMm / 2) * MM)}"`;
    case "sphere":
      return `type="sphere" size="${fmt(g.radiusMm * MM)}"`;
    case "triprism":
      return `type="box" size="${fmt((g.sideMm / 2) * MM)} ${fmt((g.sideMm / 2) * MM)} ${fmt((g.thickMm / 2) * MM)}"`;
  }
}

function geomOffset(g: Geom): Vector3 {
  if (g.type === "triprism") return new Vector3(g.sideMm / 2, g.sideMm / 2, 0);
  return new Vector3();
}

export function exportMjcf(data: ExportData): string {
  const { model, allLinks, allJoints, loopJoints, asm, stability } = data;
  const out: string[] = [];
  out.push(`<mujoco model="${model.name || "robot"}">`);
  out.push(`  <compiler angle="radian" inertiafromgeom="false"/>`);
  out.push(`  <option gravity="0 0 -9.81" timestep="0.002"/>`);
  out.push(`  <default>`);
  out.push(`    <geom friction="1.0 0.005 0.0001" condim="3"/>`);
  out.push(`    <joint damping="0.01"/>`);
  out.push(`  </default>`);
  out.push(`  <worldbody>`);
  out.push(
    `    <geom name="floor" type="plane" size="5 5 0.1" rgba="0.85 0.85 0.8 1" friction="1.0 0.005 0.0001"/>`
  );

  // 接地クリアランス:機体最下点を床に合わせる
  const dropMm = -stability.minZMm + 1;

  const jointOfChild = new Map<number, (typeof allJoints)[number]>();
  for (const j of allJoints) jointOfChild.set(j.childLinkIdx, j);

  const emitBody = (link: ExpLink, depth: number) => {
    const ind = "  ".repeat(depth);
    const j = jointOfChild.get(link.idx);
    let pos: Vector3;
    if (!j) {
      pos = new Vector3(0, 0, dropMm);
    } else {
      const parent = allLinks[j.parentLinkIdx];
      pos = link.anchorMm.clone().sub(parent.anchorMm);
    }
    out.push(`${ind}<body name="${link.name}" pos="${v3str(pos, MM)}">`);
    if (!j) out.push(`${ind}  <freejoint name="root"/>`);
    else {
      const damping = j.type === "passive" ? 0.001 : 0.05;
      let rangeAttr = "";
      if (j.type === "active" && j.servo && !j.continuous) {
        const r = (j.servo.rangeDeg * Math.PI) / 180;
        rangeAttr = ` range="${fmt(-r)} ${fmt(r)}" limited="true"`;
      }
      out.push(
        `${ind}  <joint name="${j.name}" type="hinge" pos="0 0 0" axis="${v3str(j.axis)}"${rangeAttr} damping="${damping}"/>`
      );
    }
    const massG = Math.max(link.massG, 0.5); // 質量0のリンクはMuJoCoが嫌うため下限
    const I = link.inertiaGmm2.elements;
    // 対角優位を保証する最小慣性(数値安定用)
    const minI = 1e-9;
    const ixx = Math.max(I[0] * GMM2, minI);
    const iyy = Math.max(I[4] * GMM2, minI);
    const izz = Math.max(I[8] * GMM2, minI);
    out.push(
      `${ind}  <inertial pos="${v3str(link.comMm, MM)}" mass="${fmt(massG * G)}" fullinertia="${fmt(ixx, 10)} ${fmt(iyy, 10)} ${fmt(izz, 10)} ${fmt(I[3] * GMM2, 10)} ${fmt(I[6] * GMM2, 10)} ${fmt(I[7] * GMM2, 10)}"/>`
    );
    link.geoms.forEach((eg, gi) => {
      const off = geomOffset(eg.geom).applyQuaternion(eg.quat);
      const p = eg.posMm.clone().add(off);
      const inst = model.parts.find((pp) => pp.id === eg.partId);
      const def = inst ? getDef(inst.defId) : undefined;
      let friction = "";
      if (def?.contact === "foot") friction = ` friction="1.6 0.01 0.0001"`;
      else if (def?.contact === "wheel") friction = ` friction="1.3 0.005 0.0001"`;
      out.push(
        `${ind}  <geom name="${link.name}_g${gi}" ${geomAttrs(eg.geom)} pos="${v3str(p, MM)}" quat="${quatStr(eg.quat)}" rgba="${rgba(eg.color)}" mass="0"${friction}/>`
      );
    });
    for (const c of link.children) emitBody(c.link, depth + 1);
    out.push(`${ind}</body>`);
  };

  if (allLinks.length > 0 && data.root) emitBody(data.root, 2);
  out.push(`  </worldbody>`);

  if (loopJoints.length > 0) {
    out.push(`  <equality>`);
    for (const lj of loopJoints) {
      const a = allLinks[lj.linkA];
      const b = allLinks[lj.linkB];
      if (!a || !b) continue;
      const anchorLocal = lj.anchorMm.clone().sub(a.anchorMm);
      out.push(
        `    <connect name="loop_${lj.id}" body1="${a.name}" body2="${b.name}" anchor="${v3str(anchorLocal, MM)}"/>`
      );
    }
    out.push(`  </equality>`);
  }

  const actives = allJoints.filter((j) => j.type === "active" && j.servo);
  if (actives.length > 0) {
    out.push(`  <actuator>`);
    for (const j of actives) {
      const effort = servoEffortNm(j.servo!);
      const vel = servoVelocityRadS(j.servo!);
      if (j.continuous) {
        out.push(
          `    <velocity name="act_${j.name}" joint="${j.name}" kv="0.05" forcerange="${fmt(-effort)} ${fmt(effort)}" ctrlrange="${fmt(-vel)} ${fmt(vel)}"/>`
        );
      } else {
        const r = ((j.servo!.rangeDeg || 90) * Math.PI) / 180;
        out.push(
          `    <position name="act_${j.name}" joint="${j.name}" kp="${fmt(effort * 8, 3)}" forcerange="${fmt(-effort)} ${fmt(effort)}" ctrlrange="${fmt(-r)} ${fmt(r)}"/>`
        );
      }
    }
    out.push(`  </actuator>`);
  }

  out.push(`</mujoco>`);
  return out.join("\n");
}
