import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { getDef } from "../data/catalog";
import { computeAttachment, floorPlacementQuaternion, mountingFacesOf } from "./holes";

describe("配置前の取付面", () => {
  it("車輪用サーボでは底面とうしろ面を選べる", () => {
    const faces = mountingFacesOf(getDef("SV-WHEEL"));
    expect(faces).toHaveLength(2);
    expect(faces.map((face) => face.normal.toArray())).toEqual([
      [0, 0, -1],
      [0, -1, 0],
    ]);
  });

  it("うしろ面を床へ向けるとサーボ軸が水平になる", () => {
    const def = getDef("SV-WHEEL");
    const back = mountingFacesOf(def)[1];
    const q = floorPlacementQuaternion(back, 0);
    const driveAxis = new Vector3(...def.specialHoles![0].normal).applyQuaternion(q);
    expect(Math.abs(driveAxis.z)).toBeLessThan(1e-6);
  });

  it("取付前の180度回転で左右用のサーボ軸を反対向きにできる", () => {
    const servo = getDef("SV-WHEEL");
    const back = mountingFacesOf(servo)[1];
    const parentHole = mountingFacesOf(getDef("FR-P0606"))[0];
    const drive = new Vector3(...servo.specialHoles![0].normal);
    const left = computeAttachment(new Matrix4(), parentHole, back, 0, 1);
    const right = computeAttachment(new Matrix4(), parentHole, back, 180, 1);
    const leftAxis = drive.clone().applyQuaternion(new Quaternion().setFromRotationMatrix(left));
    const rightAxis = drive.clone().applyQuaternion(new Quaternion().setFromRotationMatrix(right));

    expect(leftAxis.dot(rightAxis)).toBeLessThan(-0.999);
    expect(Math.abs(leftAxis.z)).toBeLessThan(1e-6);
    expect(Math.abs(rightAxis.z)).toBeLessThan(1e-6);
  });

  it("ころキャスターの設計時姿勢を保つと球が床側を向く", () => {
    const caster = getDef("WH-CAST");
    const face = mountingFacesOf(caster)[0];
    const q = floorPlacementQuaternion(face, 0, 0, 0, true);
    const ball = new Vector3(...caster.geoms[1].posMm!).applyQuaternion(q);
    expect(ball.z).toBeLessThan(0);
  });

  it("床配置で板やほねをX軸まわりに立てられる", () => {
    const beam = getDef("FR-B060");
    const face = mountingFacesOf(beam)[0];
    const q = floorPlacementQuaternion(face, 0, 90, 0);
    const thicknessAxis = face.normal.clone().applyQuaternion(q);
    expect(Math.abs(thicknessAxis.y)).toBeGreaterThan(0.999);
    expect(Math.abs(thicknessAxis.z)).toBeLessThan(1e-6);
  });
});
