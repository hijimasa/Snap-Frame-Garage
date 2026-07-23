import { describe, expect, it } from "vitest";
import { buildAssembly } from "../core/assembly";
import { buildExportData } from "../core/export/exportData";
import { exportMjcf } from "../core/export/mjcf";
import { exportUrdf } from "../core/export/urdf";
import { robotMassSummary } from "../core/mass";
import { exportGate } from "../core/power";
import { computeStability } from "../core/stability";
import { TEMPLATES } from "./templates";

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

  it("左右対称(重心Xがほぼ0)", () => {
    expect(Math.abs(summary.cogWorldMm.x)).toBeLessThan(6);
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

  it("ぶらぶらは意図した飾りだけ(サーボ脚はガタつかない)", () => {
    // 尻尾・触角・腕など1ピンの飾りのみ許容
    const decorative = model.connections.filter(
      (c) => c.pins === 1 && c.kind === "tree"
    ).length;
    expect(asm.danglingCount).toBe(decorative);
  });
});
