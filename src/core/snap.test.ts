import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildAssembly } from "./assembly";
import { findHole } from "./holes";
import { buildDragSnapData, findCoincidentHole, findSnap, SNAP_RADIUS_MM } from "./snap";
import { getDef } from "../data/catalog";
import { ModelBuilder, g } from "./testUtils";

describe("ドラッグ中の穴スナップ", () => {
  // プレート(原点・床上)+ 自由配置のビーム(上空)
  function setup(beamPos: [number, number, number], beamQuat: [number, number, number, number] = [1, 0, 0, 0]) {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    b.model.parts = b.model.parts.map((p) =>
      p.id === beam ? { ...p, basePose: { posMm: beamPos, quatWxyz: beamQuat } } : p
    );
    const asm = buildAssembly(b.model);
    return { model: b.model, asm, plate, beam };
  }

  it("近くの穴に吸着:板厚の和/2のオフセットでぴったり重なる", () => {
    const { model, asm, beam } = setup([100, 100, 20]);
    const data = buildDragSnapData(model, asm, beam);
    expect(data.dragHoles.length).toBe(12); // ビームの12穴
    // プレートの穴(-27.5,-27.5,0)グリッドの真上ちかく(3mmずれ)へ持っていく
    // ビームの穴0はローカル(-12.5,0,0) → rel=(-12.5,0,0)。根がraw=(x,y,z)なら穴は(x-12.5,y,z)
    // プレート穴(2.5, -7.5, 0) に合わせたい → raw=(15, -7.5, z)。3mmずらして与える
    const raw = new Vector3(15 + 2, -7.5 + 1, 4);
    const snap = findSnap(raw, data);
    expect(snap).not.toBeNull();
    // 吸着後:ビーム穴のworld位置 = プレート穴 + (3+3)/2 = z=3
    const holeAfter = data.dragHoles[0].rel.clone().add(snap!.pos);
    expect(Math.abs(holeAfter.z - 3)).toBeLessThan(1e-6);
    // XYはプレートのどれかの穴に一致(5mmグリッド上、.5端数)
    expect(Math.abs((holeAfter.x - 2.5) % 5)).toBeCloseTo(0, 6);
    expect(Math.abs((holeAfter.y - 2.5) % 5)).toBeCloseTo(0, 6);
  });

  it("遠ければ吸着しない", () => {
    const { model, asm, beam } = setup([100, 100, 20]);
    const data = buildDragSnapData(model, asm, beam);
    const raw = new Vector3(200, 200, SNAP_RADIUS_MM + 30);
    expect(findSnap(raw, data)).toBeNull();
  });

  it("軸が合わない(90°立てた)ビームは水平の穴に吸着しない", () => {
    // Yまわり90°:穴法線 -z → +x向き
    const s45 = Math.SQRT1_2;
    const { model, asm, beam } = setup([15, -7.5, 4], [s45, 0, s45, 0]);
    const data = buildDragSnapData(model, asm, beam);
    const raw = new Vector3(15, -7.5, 4);
    expect(findSnap(raw, data)).toBeNull();
  });

  it("ワンクリックピン:重なっている相手の穴を自動で見つける", () => {
    // スナップ位置(板厚オフセット済み)にビームを置く:
    // ビーム穴0(rel -12.5,0,0)がプレート穴(2.5,-7.5,0)の真上 z=3 に来る根位置
    const { model, asm, beam, plate } = setup([15, -7.5, 3]);
    const beamHole = findHole(getDef("FR-B060"), g(0, 0))!;
    const co = findCoincidentHole(model, asm, beam, beamHole);
    expect(co).not.toBeNull();
    expect(co!.id.partId).toBe(plate);
    // ビーム穴(法線+z)から見てプレートは下(-z)側 → side=-1
    expect(co!.side).toBe(-1);
    // 遠い穴では見つからない
    const { model: m2, asm: a2, beam: b2 } = setup([200, 200, 50]);
    const co2 = findCoincidentHole(m2, a2, b2, beamHole);
    expect(co2).toBeNull();
  });
});
