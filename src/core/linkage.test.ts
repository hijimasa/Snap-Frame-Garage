import { describe, expect, it } from "vitest";
import { buildAssembly, computePoses } from "./assembly";
import { findHole } from "./holes";
import { solveDisplayAngles, solveRestLinkage } from "./linkage";
import { getDef } from "../data/catalog";
import { ModelBuilder, g } from "./testUtils";
import type { RobotModel } from "./types";

// 平行四辺形の4節リンク(全回転軸がZの平面機構):
// 土台(90mm)の両端ピボットに55mmのアーム2本(受動)、上を60mmピッチのカプラでつなぐ。
// アームを30°起こした姿勢で組む(全リンク一直線の特異姿勢を避ける)
function fourBar() {
  const b = new ModelBuilder();
  const ground = b.add("FR-B090");
  const left = b.add("FR-B060");
  const right = b.add("FR-B060");
  const cLeft = b.attach(ground, g(0, 0), left, g(0, 0), { pins: 1, angleDeg: 30 });
  const cRight = b.attach(ground, g(0, 12), right, g(0, 0), { pins: 1, angleDeg: 30 });
  const top = b.add("FR-B090");
  // 両アームが同角のとき、右アーム先端の穴は左アーム先端の穴の平行移動先。
  // カプラは角度0で組むと土台と平行になり、ループがぴったり閉じる(積層3mm)
  const cTop = b.attach(left, g(0, 11), top, g(0, 0), { pins: 1, angleDeg: 0 });
  b.loop(right, g(0, 11), top, g(0, 12), 1);
  return { model: b.model, ground, left, right, top, cLeft, cRight, cTop };
}

function loopGapMm(model: RobotModel, overrides?: Map<string, number>): number {
  const loop = model.connections.find((c) => c.kind === "loop")!;
  const { poses } = computePoses(model, overrides);
  const ha = findHole(getDef(model.parts.find((p) => p.id === loop.parentPart)!.defId), loop.parentHole)!;
  const hb = findHole(getDef(model.parts.find((p) => p.id === loop.childPart)!.defId), loop.childHole)!;
  return ha.posMm
    .clone()
    .applyMatrix4(poses.get(loop.parentPart)!)
    .distanceTo(hb.posMm.clone().applyMatrix4(poses.get(loop.childPart)!));
}

describe("リンク機構ソルバ(からくり連動)", () => {
  it("4節リンク:片方のアームを回すと、もう片方が連動して回りループが保たれる", () => {
    const { model, cLeft, cRight } = fourBar();
    const gapBefore = loopGapMm(model);
    expect(gapBefore).toBeLessThan(3.5); // restでループが本当に閉じている(積層3mm)

    // 30° → 50°(+20°)
    const res = solveRestLinkage(model, { connId: cLeft, angleDeg: 50 });
    expect(res).not.toBeNull();
    expect(res!.maxErrMm).toBeLessThan(0.2);
    // 平行四辺形なので、右アームも同じ角度になるはず
    expect(res!.angles.get(cRight)!).toBeCloseTo(50, 0);

    // 解いた角度を実際に適用してもループの穴間距離が変わらない
    const gapAfter = loopGapMm(model, res!.angles);
    expect(Math.abs(gapAfter - gapBefore)).toBeLessThan(0.2);
  });

  it("大きく回しても追従する(30°→-15°の45°ジャンプ)", () => {
    const { model, cLeft, cRight } = fourBar();
    const res = solveRestLinkage(model, { connId: cLeft, angleDeg: -15 });
    expect(res).not.toBeNull();
    expect(res!.maxErrMm).toBeLessThan(0.2);
    expect(res!.angles.get(cRight)!).toBeCloseTo(-15, 0);
  });

  it("ループのない機構では null(単独回転にフォールバック)", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    const conn = b.attach(plate, g(0, 0), beam, g(0, 0), { pins: 1 });
    expect(solveRestLinkage(b.model, { connId: conn, angleDeg: 30 })).toBeNull();
  });

  it("別の島のからくりには影響しない(対象の機構だけを解く)", () => {
    const { model, cLeft } = fourBar();
    // 離れた場所に独立したパーツ(別の島)
    model.parts.push({
      id: "pX",
      defId: "FR-B060",
      material: "plastic",
      basePose: { posMm: [300, 300, 10], quatWxyz: [1, 0, 0, 0] },
    });
    const res = solveRestLinkage(model, { connId: cLeft, angleDeg: 15 });
    expect(res).not.toBeNull();
    expect(res!.maxErrMm).toBeLessThan(0.2);
  });

  it("表示ソルバ:拘束が満たされた状態では受動関節はほぼ動かない", () => {
    const { model } = fourBar();
    const asm = buildAssembly(model);
    const out = solveDisplayAngles(model, asm, {});
    for (const v of Object.values(out)) expect(Math.abs(v)).toBeLessThan(0.5);
  });
});
