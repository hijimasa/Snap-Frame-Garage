import { describe, expect, it } from "vitest";
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
  });
});

describe("ヤンセン8足:クランク一回転の連動", () => {
  it("全周でループが保たれ、足が持ち上がる", () => {
    const model = buildTemplate("strandbeest");
    const asm = buildAssembly(model);
    const servoIds = model.parts.filter((p) => p.defId === "SV-WHEEL").map((p) => p.id);
    expect(servoIds).toHaveLength(2);

    // 追跡する足先:rest時いちばん低いパーツ(h=65mmのほね)
    let footId = "";
    let footLow = Infinity;
    const zero = linkDeltas(asm, {});
    for (const p of model.parts) {
      const M = bodyDisplayMatrix(asm, zero, p.id, false);
      if (!M) continue;
      const z = M.elements[14];
      if (z < footLow) {
        footLow = z;
        footId = p.id;
      }
    }

    let warm: Record<string, number> = {};
    let footMin = Infinity;
    let footMax = -Infinity;
    for (let th = 0; th <= 360; th += 10) {
      const active: Record<string, number> = {};
      for (const s of servoIds) active[s] = th;
      const angles = solveDisplayAngles(model, asm, active, warm);
      warm = angles;
      // ループ拘束の破れが小さいまま
      expect(loopErrorMm(model, asm, angles), `θ=${th}`).toBeLessThan(1.5);
      const deltas = linkDeltas(asm, angles);
      const M = bodyDisplayMatrix(asm, deltas, footId, false)!;
      const z = M.elements[14];
      footMin = Math.min(footMin, z);
      footMax = Math.max(footMax, z);
    }
    // 足が10mm以上持ち上がる=歩行の足運びになっている
    expect(footMax - footMin).toBeGreaterThan(10);
  });
});
