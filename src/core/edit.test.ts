import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { computePoses, countIslands, islandRootOf } from "./assembly";
import { detachPart, joinIslands, rerootIsland } from "./edit";
import { findHole } from "./holes";
import { exportGate } from "./power";
import { getDef } from "../data/catalog";
import { ModelBuilder, g } from "./testUtils";
import type { RobotModel } from "./types";

function poseOf(model: RobotModel, id: string): Matrix4 {
  const m = computePoses(model).poses.get(id);
  expect(m, `pose of ${id}`).toBeDefined();
  return m!;
}

function expectSamePose(a: Matrix4, b: Matrix4, label: string) {
  const pa = new Vector3().setFromMatrixPosition(a);
  const pb = new Vector3().setFromMatrixPosition(b);
  expect(pa.distanceTo(pb), `${label} 位置`).toBeLessThan(0.1);
  const qa = new Quaternion().setFromRotationMatrix(a);
  const qb = new Quaternion().setFromRotationMatrix(b);
  expect(Math.abs(qa.dot(qb)), `${label} 姿勢`).toBeGreaterThan(0.9999);
}

describe("自由配置(basePose)と島", () => {
  it("basePoseを持つ複数の島がそれぞれの位置に置かれる", () => {
    const b = new ModelBuilder();
    const p1 = b.add("FR-P0606");
    const p2 = b.add("FR-B060");
    b.model.parts = b.model.parts.map((p) =>
      p.id === p2
        ? { ...p, basePose: { posMm: [100, 50, 10], quatWxyz: [1, 0, 0, 0] } }
        : p
    );
    const { poses, orphans } = computePoses(b.model);
    expect(orphans).toHaveLength(0);
    expect(new Vector3().setFromMatrixPosition(poses.get(p2)!).x).toBeCloseTo(100, 3);
    expect(countIslands(b.model)).toBe(2);
    expect(exportGate(b.model).reasons).toContain("not-connected");
  });

  it("切り離し:その場に留まり、島が増える", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    b.attach(plate, g(0, 0), beam, g(0, 0));
    const before = poseOf(b.model, beam);
    const detached = detachPart(b.model, beam)!;
    expect(detached).not.toBeNull();
    expect(countIslands(detached)).toBe(2);
    expectSamePose(poseOf(detached, beam), before, "切り離し後のビーム");
    expect(islandRootOf(detached, beam)).toBe(beam);
  });
});

describe("再ルートと島結合", () => {
  it("再ルート:全パーツのworld姿勢が変わらない(side=-1やangle付きの接続でも)", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    const weight = b.add("WT-010");
    b.attach(plate, g(0, 5), beam, g(0, 2), { angleDeg: 90 });
    b.attach(beam, g(0, 10), weight, g(0, 0), { side: -1 });
    const before = new Map(
      b.model.parts.map((p) => [p.id, poseOf(b.model, p.id)] as const)
    );
    const rerooted = rerootIsland(b.model, weight);
    expect(rerooted).not.toBeNull();
    for (const p of rerooted!.parts) {
      expectSamePose(poseOf(rerooted!, p.id), before.get(p.id)!, p.id);
    }
    expect(islandRootOf(rerooted!, plate)).toBe(weight);
  });

  it("島結合:自由なパーツ(のツリー)が穴に吸着して1つの島になる", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    // 離れた場所に自由配置したビーム+その子のおもり
    const beam = b.add("FR-B060");
    const weight = b.add("WT-010");
    b.model.parts = b.model.parts.map((p) =>
      p.id === beam
        ? { ...p, basePose: { posMm: [200, 200, 30], quatWxyz: [1, 0, 0, 0] } }
        : p
    );
    b.attach(beam, g(0, 10), weight, g(0, 0));
    expect(countIslands(b.model)).toBe(2);

    // ビームの反対端の穴を、プレートの穴へ(おもり側=非ルートを指定しても再ルートで繋がる)
    const joined = joinIslands(
      b.model,
      { partId: plate, holeRef: g(0, 0) },
      { partId: weight, holeRef: g(0, 1) },
      1,
      2
    );
    expect(joined).not.toBeNull();
    expect(countIslands(joined!)).toBe(1);
    expect(exportGate(joined!).reasons).not.toContain("not-connected");

    // 吸着の検証:おもりの穴とプレートの穴が板厚ぶんだけ離れて同軸
    const plateDef = getDef("FR-P0606");
    const weightDef = getDef("WT-010");
    const ph = findHole(plateDef, g(0, 0))!;
    const wh = findHole(weightDef, g(0, 1))!;
    const poses = computePoses(joined!).poses;
    const pw = ph.posMm.clone().applyMatrix4(poses.get(plate)!);
    const ww = wh.posMm.clone().applyMatrix4(poses.get(weight)!);
    expect(pw.distanceTo(ww)).toBeCloseTo((ph.thicknessMm + wh.thicknessMm) / 2, 1);
    // ビーム(元の島の親)もついてくる
    const beamPos = new Vector3().setFromMatrixPosition(poses.get(beam)!);
    expect(beamPos.distanceTo(ww)).toBeLessThan(100);
  });

  it("島結合:結合前に合わせた向き(ねじり)が保たれる", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    // ビームをZまわりに90°回して自由配置(X向き→Y向き)
    const s45 = Math.SQRT1_2;
    b.model.parts = b.model.parts.map((p) =>
      p.id === beam
        ? { ...p, basePose: { posMm: [150, 150, 20], quatWxyz: [s45, 0, 0, s45] } }
        : p
    );
    const joined = joinIslands(
      b.model,
      { partId: plate, holeRef: g(0, 0) },
      { partId: beam, holeRef: g(0, 0) },
      1,
      2
    )!;
    expect(joined).not.toBeNull();
    // 結合後もビームの長手方向(ローカル+X)はworld ±Yを向いたまま
    const M = computePoses(joined).poses.get(beam)!;
    const xAxis = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromRotationMatrix(M));
    expect(Math.abs(xAxis.y)).toBeGreaterThan(0.99);
    expect(Math.abs(xAxis.z)).toBeLessThan(0.05);
  });

  it("島結合:垂直な面の穴には、立てた姿勢のまま横向きに付く", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const bracket = b.add("JT-BRmic"); // たて面(normal [1,0,0])を持つ
    b.attach(plate, g(0, 60), bracket, g(0, 0));
    // ビームをYまわりに90°立てて自由配置(法線-z → +x側)
    const s45 = Math.SQRT1_2;
    const beam = b.add("FR-B060");
    b.model.parts = b.model.parts.map((p) =>
      p.id === beam
        ? { ...p, basePose: { posMm: [100, 0, 40], quatWxyz: [s45, 0, s45, 0] } }
        : p
    );
    // 金具のたて面(group1)へピン結合
    const joined = joinIslands(
      b.model,
      { partId: bracket, holeRef: g(1, 0) },
      { partId: beam, holeRef: g(0, 3) },
      1,
      2
    )!;
    expect(joined).not.toBeNull();
    // ビームの板厚方向(ローカル-Z=穴法線)がworld ±Xを向く(=たて面に沿う)
    const M = computePoses(joined).poses.get(beam)!;
    const n = new Vector3(0, 0, -1).applyQuaternion(new Quaternion().setFromRotationMatrix(M));
    expect(Math.abs(n.x)).toBeGreaterThan(0.99);
  });

  it("flip:同じ面のまま180°ひっくり返る(取付面の高さは変わらない)", () => {
    const b = new ModelBuilder();
    const plate = b.add("FR-P0606");
    const beam = b.add("FR-B060");
    const cid = b.attach(plate, g(0, 0), beam, g(0, 0));
    const M1 = computePoses(b.model).poses.get(beam)!;
    b.model.connections = b.model.connections.map((c) =>
      c.id === cid ? { ...c, flip: true } : c
    );
    const M2 = computePoses(b.model).poses.get(beam)!;
    const z1 = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromRotationMatrix(M1));
    const z2 = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromRotationMatrix(M2));
    expect(z1.dot(z2)).toBeLessThan(-0.99); // 上下が反転している
    const p1 = new Vector3().setFromMatrixPosition(M1);
    const p2 = new Vector3().setFromMatrixPosition(M2);
    expect(Math.abs(p1.z - p2.z)).toBeLessThan(1e-6); // 同じ面に付いたまま
  });
});
