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
      strandbeest: 2, // しょっかく(脚の受動関節40個はすべてループ内=0扱い)
    };
    expect(asm.danglingCount).toBe(EXPECTED[tpl.id]);
    const decorative = asm.danglingConnectionIds.filter(
      (id) => model.connections.find((c) => c.id === id)?.intent === "decorative"
    );
    expect(decorative).toHaveLength(EXPECTED[tpl.id]);
  });
});

describe("ヤンセン4足＋前後補助キャスター", () => {
  it("8足版より軽量な4脚・2モータ・2キャスター構成になる", () => {
    const model = buildTemplate("strandbeest");
    expect(model.name).toBe("ヤンセンの4ほんあし＋補助輪");
    expect(model.parts).toHaveLength(60);
    expect(model.connections).toHaveLength(79);
    expect(model.parts.filter((p) => p.defId === "SV-WHEEL")).toHaveLength(2);
    expect(model.parts.filter((p) => p.defId === "WH-CAST")).toHaveLength(2);
    expect(new Set(model.parts.map((p) => p.tint).filter(Boolean))).toHaveProperty("size", 4);
  });

  it("前後キャスターを含む支持多角形で基本姿勢が安定する", () => {
    const model = buildTemplate("strandbeest");
    const asm = buildAssembly(model);
    const stability = computeStability(model, asm, robotMassSummary(model, asm).cogWorldMm);
    expect(stability.status).toBe("stable");
    expect(stability.supportPolygonXY.length).toBeGreaterThanOrEqual(4);
    expect(stability.marginMm).toBeGreaterThan(8);
  });

  it("4脚の閉ループを保ったままクランクが一回転する", () => {
    const model = buildTemplate("strandbeest");
    const asm = buildAssembly(model);
    const servoIds = model.parts.filter((p) => p.defId === "SV-WHEEL").map((p) => p.id);
    let warm: Record<string, number> = {};
    for (let th = 0; th <= 360; th += 10) {
      const angles = solveDisplayAngles(
        model,
        asm,
        Object.fromEntries(servoIds.map((id) => [id, th])),
        warm
      );
      warm = angles;
      expect(loopErrorMm(model, asm, angles), `θ=${th}`).toBeLessThan(1.5);
    }
  });

  it("MuJoCoでは2つのキャスター球を低摩擦接触として出力する", () => {
    const mjcf = exportMjcf(buildExportData(buildTemplate("strandbeest")));
    expect(mjcf.match(/friction="0\.05 0\.001 0\.0001"/g)).toHaveLength(2);
    expect(mjcf.match(/<velocity name="act_servo_/g)).toHaveLength(2);
    expect(mjcf.match(/<connect name="loop_/g)).toHaveLength(20);
  });
});
