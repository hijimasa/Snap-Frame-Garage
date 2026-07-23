import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { bodyDisplayMatrix, buildAssembly, linkDeltas } from "../core/assembly";
import { buildExportData } from "../core/export/exportData";
import { exportMjcf } from "../core/export/mjcf";
import { exportUrdf } from "../core/export/urdf";
import { loopErrorMm, solveDisplayAngles } from "../core/linkage";
import { robotMassSummary } from "../core/mass";
import { exportGate } from "../core/power";
import { computeStability } from "../core/stability";
import { buildTemplate, TEMPLATES } from "./templates";

describe.each(TEMPLATES)("テンプレート: $id", (tpl) => {
  const model = tpl.build();
  const asm = buildAssembly(model);
  const summary = robotMassSummary(model, asm);
  const stability = computeStability(model, asm, summary.cogWorldMm);

  it("全パーツが接続されていて書き出せる", () => {
    expect(asm.orphanParts).toHaveLength(0);
    const gate = exportGate(model);
    expect(gate.islands).toBe(1);
    expect(gate.ok, `gate reasons: ${gate.reasons.join()}`).toBe(true);
  });

  it("基本姿勢で安定して立つ", () => {
    expect(stability.status).toBe("stable");
    expect(stability.supportPolygonXY.length).toBeGreaterThanOrEqual(3);
  });

  it("ROS座標で左右対称(重心Yがほぼ0)", () => {
    expect(Math.abs(summary.cogWorldMm.y)).toBeLessThan(6);
  });

  it("ROS座標系(+X正面・+Y左・+Z上)で配置される", () => {
    const rootPose = asm.poses.get(model.parts[0].id)!;
    const q = new Quaternion().setFromRotationMatrix(rootPose);
    const oldForward = new Vector3(0, 1, 0).applyQuaternion(q);
    const oldRight = new Vector3(1, 0, 0).applyQuaternion(q);
    expect(oldForward.x).toBeGreaterThan(0.999);
    expect(oldRight.y).toBeLessThan(-0.999);
  });

  it("サーボの駆動軸はすべて水平(歩行・走行の回転軸)", () => {
    for (const j of asm.joints) {
      if (j.type !== "active") continue;
      expect(Math.abs(j.axisMm.z), `joint ${j.id} axis`).toBeLessThan(0.1);
    }
  });

  it("URDF/MJCFが生成できる", () => {
    const data = buildExportData(model);
    expect(exportUrdf(data)).toContain("<robot");
    expect(exportMjcf(data)).toContain("<mujoco");
  });

  it("ぶらぶらは意図した飾りだけ(からくりの受動関節は数えない)", () => {
    // 尻尾・触角・腕など「輪に入っていない1ピン」だけがぶらぶらとして残る
    const EXPECTED: Record<string, number> = {
      wheeler: 0,
      dog: 1, // しっぽ
      biped: 2, // 両腕
      hexapod: 2, // しょっかく
      strandbeest: 2, // しょっかく(脚の受動関節80個はすべてループ内=0扱い)
    };
    expect(asm.danglingCount).toBe(EXPECTED[tpl.id]);
    const decorative = asm.danglingConnectionIds.filter(
      (id) => model.connections.find((c) => c.id === id)?.intent === "decorative"
    );
    expect(decorative).toHaveLength(EXPECTED[tpl.id]);
  });
});

describe("ヤンセン8足:クランク一回転の連動", () => {
  it("前後に分離した8本の脚が色分けされた構成になる", () => {
    const model = buildTemplate("strandbeest");
    expect(model.name).toBe("ヤンセンの8ほんあし");
    expect(model.parts).toHaveLength(100);
    expect(model.connections).toHaveLength(139);
    const groups = new Map<string, number>();
    for (const part of model.parts) {
      if (part.tint) groups.set(part.tint, (groups.get(part.tint) ?? 0) + 1);
    }
    expect([...groups.values()].sort((a, b) => a - b)).toEqual(Array(8).fill(10));
  });

  it("全周でループが保たれ、足が持ち上がる", () => {
    const model = buildTemplate("strandbeest");
    const asm = buildAssembly(model);
    const servoIds = model.parts.filter((p) => p.defId === "SV-WHEEL").map((p) => p.id);
    expect(servoIds).toHaveLength(4);

    // 各色の脚について、rest時に原点が最も低いリンク(足先Fから始まるiリンク)を追跡。
    const footByTint = new Map<string, { id: string; z: number }>();
    const zero = linkDeltas(asm, {});
    for (const p of model.parts) {
      if (!p.tint) continue;
      const M = bodyDisplayMatrix(asm, zero, p.id, false);
      if (!M) continue;
      const z = M.elements[14];
      const current = footByTint.get(p.tint);
      if (!current || z < current.z) footByTint.set(p.tint, { id: p.id, z });
    }
    expect(footByTint.size).toBe(8);

    let warm: Record<string, number> = {};
    const ranges = new Map(
      [...footByTint.keys()].map((tint) => [tint, { min: Infinity, max: -Infinity }])
    );
    for (let th = 0; th <= 360; th += 10) {
      const active: Record<string, number> = {};
      for (const s of servoIds) active[s] = th;
      const angles = solveDisplayAngles(model, asm, active, warm);
      warm = angles;
      // ループ拘束の破れが小さいまま
      expect(loopErrorMm(model, asm, angles), `θ=${th}`).toBeLessThan(1.5);
      const deltas = linkDeltas(asm, angles);
      for (const [tint, foot] of footByTint) {
        const z = bodyDisplayMatrix(asm, deltas, foot.id, false)!.elements[14];
        const range = ranges.get(tint)!;
        range.min = Math.min(range.min, z);
        range.max = Math.max(range.max, z);
      }
    }
    for (const range of ranges.values()) {
      // 8本すべてが10mm以上持ち上がる=飾りではなく歩行の足運びになっている
      expect(range.max - range.min).toBeGreaterThan(10);
    }
  });

  it("駆動角が大きく飛んでも直前姿勢から連続解を追跡する", () => {
    const model = buildTemplate("strandbeest");
    const asm = buildAssembly(model);
    const servoIds = model.parts.filter((p) => p.defId === "SV-WHEEL").map((p) => p.id);
    const zero = solveDisplayAngles(
      model,
      asm,
      Object.fromEntries(servoIds.map((id) => [id, 0]))
    );
    const jumped = solveDisplayAngles(
      model,
      asm,
      Object.fromEntries(servoIds.map((id) => [id, 170])),
      zero
    );
    expect(loopErrorMm(model, asm, jumped)).toBeLessThan(1.5);
    for (const id of servoIds) expect(jumped[id]).toBeCloseTo(170, 6);
  });

  it("MuJoCo向けに4駆動軸と40個の閉ループ拘束を書き出す", () => {
    const data = buildExportData(buildTemplate("strandbeest"));
    expect(data.allJoints.filter((joint) => joint.type === "active")).toHaveLength(4);
    expect(data.loopJoints).toHaveLength(40);

    const mjcf = exportMjcf(data);
    expect(mjcf.match(/<velocity name="act_servo_/g)).toHaveLength(4);
    expect(mjcf.match(/<connect name="loop_/g)).toHaveLength(40);
    expect(mjcf).toContain('<freejoint name="root"/>');
    expect(mjcf).toContain('name="floor"');
  });

  it("4本のL字支持材は本体側に固定され、駆動ホーンから分離される", () => {
    const model = buildTemplate("strandbeest");
    const asm = buildAssembly(model);
    const supports = model.parts.filter((part) => part.defId === "FR-L030");
    const servos = model.parts.filter((part) => part.defId === "SV-WHEEL");
    expect(supports).toHaveLength(4);
    expect(servos).toHaveLength(4);

    const fixedLink = asm.linkOfBody.get(model.parts[0].id);
    for (const support of supports) expect(asm.linkOfBody.get(support.id)).toBe(fixedLink);
    for (const servo of servos) {
      expect(asm.linkOfBody.get(servo.id)).toBe(fixedLink);
      expect(asm.linkOfBody.get(`${servo.id}#horn`)).not.toBe(fixedLink);
    }
  });
});
