import { describe, expect, it } from "vitest";
import { buildAssembly } from "./assembly";
import { computePower } from "./power";
import { ModelBuilder, drive, g } from "./testUtils";

describe("組立グラフ:穴とピンの文法", () => {
  it("ピン2本=剛結合:プレート+ビームは1リンクに合成される", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    b.attach(plate, g(0, 0), beam, g(0, 0), { pins: 2 });
    const asm = buildAssembly(b.model);
    expect(asm.linkBodies.length).toBe(1);
    expect(asm.joints.length).toBe(0);
    expect(asm.danglingCount).toBe(0);
  });

  it("ピン1本=受動関節:リンクが2つに分かれ、ぶらぶら1", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    b.attach(plate, g(0, 0), beam, g(0, 0), { pins: 1 });
    const asm = buildAssembly(b.model);
    expect(asm.linkBodies.length).toBe(2);
    expect(asm.joints.filter((j) => j.type === "passive").length).toBe(1);
    expect(asm.danglingCount).toBe(1);
  });

  it("サーボ:本体とホーンの間に能動関節ができる", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const servo = b.add("SV-WHEEL");
    b.attach(plate, g(0, 20), servo, g(0, 0), { pins: 2 });
    const wheel = b.add("WH-040");
    b.attach(servo, drive(), wheel, g(0, 0));
    const asm = buildAssembly(b.model);
    // リンク:{プレート+サーボ本体} と {ホーン+タイヤ} の2つ
    expect(asm.linkBodies.length).toBe(2);
    const active = asm.joints.filter((j) => j.type === "active");
    expect(active.length).toBe(1);
    expect(active[0].locked).toBe(false);
    expect(asm.danglingCount).toBe(0); // 能動関節はぶらぶらに数えない
  });

  it("4節リンク:閉ループが検出され、閉じた受動関節はぶらぶらに数えない", () => {
    const b = new ModelBuilder();
    // 土台ビーム + 2本の縦ビーム(受動) + 上をつなぐビーム(受動+追いピン)
    const ground = b.add("FR-B090");
    const left = b.add("FR-B060");
    const right = b.add("FR-B060");
    b.attach(ground, g(0, 0), left, g(0, 0), { pins: 1 });
    b.attach(ground, g(0, 12), right, g(0, 0), { pins: 1 });
    const top = b.add("FR-B090");
    b.attach(left, g(0, 11), top, g(0, 0), { pins: 1 });
    // rightの先端とtopの対応穴を追いピンで留めて閉ループに
    b.loop(right, g(0, 11), top, g(0, 12), 1);
    const asm = buildAssembly(b.model);
    expect(asm.hasLoop).toBe(true);
    const loops = asm.joints.filter((j) => j.isLoop);
    expect(loops.length).toBe(1);
    // 4節リンクとして閉じている → ぶらぶら0(別紙2§7.2)
    expect(asm.danglingCount).toBe(0);
  });

  it("受動関節を固定(2ピン)に切り替えるとリンクが合成される", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    const cid = b.attach(plate, g(0, 0), beam, g(0, 0), { pins: 1 });
    b.model.connections = b.model.connections.map((c) =>
      c.id === cid ? { ...c, pins: 2 } : c
    );
    const asm = buildAssembly(b.model);
    expect(asm.linkBodies.length).toBe(1);
  });
});

describe("パワーボックス判定", () => {
  it("コスト合計から必要グレードを判定、未搭載は書き出し不可", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0612");
    const s1 = b.add("SV-HIGH"); // 4
    const s2 = b.add("SV-HIGH"); // 4
    const s3 = b.add("SV-STD"); // 3 → 計11 → M箱
    b.attach(plate, g(0, 0), s1, g(0, 0));
    b.attach(plate, g(0, 5), s2, g(0, 0));
    b.attach(plate, g(0, 10), s3, g(0, 0));
    let p = computePower(b.model);
    expect(p.totalCost).toBe(11);
    expect(p.requiredBox?.id).toBe("PB-M");
    expect(p.ok).toBe(false);
    expect(p.reasons).toContain("no-box");

    // S箱では足りない
    const box = b.add("PB-S");
    b.attach(plate, g(0, 100), box, g(0, 0));
    p = computePower(b.model);
    expect(p.ok).toBe(false);
    expect(p.reasons).toContain("box-too-small");

    // M箱に載せ替えれば OK
    b.model.parts = b.model.parts.map((pp) =>
      pp.id === box ? { ...pp, defId: "PB-M" } : pp
    );
    p = computePower(b.model);
    expect(p.ok).toBe(true);
  });
});
