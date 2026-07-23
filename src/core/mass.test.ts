import { describe, expect, it } from "vitest";
import { buildAssembly } from "./assembly";
import { robotMassSummary } from "./mass";
import { computeStability } from "./stability";
import { ModelBuilder, g } from "./testUtils";

describe("質量・重心", () => {
  it("プレート単体:質量はカタログ値、重心は中心", () => {
    const b = new ModelBuilder();
    b.add("FR-P0606"); // 9g プラ
    const asm = buildAssembly(b.model);
    const s = robotMassSummary(b.model, asm);
    expect(s.totalMassG).toBeCloseTo(9, 3);
    expect(s.cogWorldMm.x).toBeCloseTo(0, 3);
    expect(s.cogWorldMm.y).toBeCloseTo(0, 3);
  });

  it("アルミ切替で質量が変わる", () => {
    const b = new ModelBuilder();
    b.add("FR-P0606", "aluminum"); // 14g
    const s = robotMassSummary(b.model, buildAssembly(b.model));
    expect(s.totalMassG).toBeCloseTo(14, 3);
  });

  it("プレート+おもり:合成重心がおもり側へ動き、上に載る", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606"); // 9g 中心(0,0,0)
    const wt = b.add("WT-050"); // 50g
    // プレートの端の穴(group0 index0 = 原点(-27.5,-27.5))に載せる
    b.attach(plate, g(0, 0), wt, g(0, 0));
    const asm = buildAssembly(b.model);
    const s = robotMassSummary(b.model, asm);
    expect(s.totalMassG).toBeCloseTo(59, 3);
    // 重心はおもり側(負のX/Y方向)へ
    expect(s.cogWorldMm.x).toBeLessThan(-10);
    expect(s.cogWorldMm.y).toBeLessThan(-10);
    // おもりはプレートの上(z>プレート上面)
    const wtCom = s.perPart.get(wt)!.comWorldMm;
    expect(wtCom.z).toBeGreaterThan(1.5); // プレート厚3mmの上面=1.5
  });
});

describe("安定判定", () => {
  it("プレート直置きは安定(重心が支持多角形の中)", () => {
    const b = new ModelBuilder();
    b.add("FR-P0606");
    const asm = buildAssembly(b.model);
    const s = robotMassSummary(b.model, asm);
    const st = computeStability(b.model, asm, s.cogWorldMm);
    expect(st.status).toBe("stable");
    expect(st.supportPolygonXY.length).toBeGreaterThanOrEqual(3);
  });

  it("端に重いおもりを積み増すと不安定側へ動く", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0306"); // 30x60 小プレート
    let prev = plate;
    // 端の穴に、おもり(大)をどんどん縦積み
    const w1 = b.add("WT-050");
    b.attach(plate, g(0, 0), w1, g(0, 0));
    prev = w1;
    const st0 = (() => {
      const asm = buildAssembly(b.model);
      const s = robotMassSummary(b.model, asm);
      return computeStability(b.model, asm, s.cogWorldMm);
    })();
    // 重心は端の穴方向へ寄っているが、まだ多角形の中にはある
    expect(st0.status).not.toBe("none");
    expect(Math.abs(st0.cogXY[0]) + Math.abs(st0.cogXY[1])).toBeGreaterThan(5);
  });
});
