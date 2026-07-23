import { describe, expect, it } from "vitest";
import { buildExportData } from "./export/exportData";
import { exportMjcf } from "./export/mjcf";
import { exportUrdf } from "./export/urdf";
import { buildManifest } from "./export/robopkg";
import { ModelBuilder, drive, g } from "./testUtils";
import type { RobotModel } from "./types";

function twoWheeler(): RobotModel {
  // チュートリアルと同じ2輪車:いた+車輪サーボ×2+タイヤ×2+キャスター+箱S
  const b = new ModelBuilder();
  const plate = b.add("FR-P0606");
  const sv1 = b.add("SV-WHEEL");
  const sv2 = b.add("SV-WHEEL");
  b.attach(plate, g(0, 0), sv1, g(0, 0), { angleDeg: 90 });
  b.attach(plate, g(0, 11), sv2, g(0, 0), { angleDeg: 270 });
  const w1 = b.add("WH-040");
  const w2 = b.add("WH-040");
  b.attach(sv1, drive(), w1, g(0, 0));
  b.attach(sv2, drive(), w2, g(0, 0));
  const cast = b.add("WH-CAST");
  b.attach(plate, g(0, 140), cast, g(0, 0), { side: -1 });
  const box = b.add("PB-S");
  b.attach(plate, g(0, 70), box, g(0, 0));
  b.model.mappings = [
    { jointId: sv1, input: "leftStickY" },
    { jointId: sv2, input: "rightStickY" },
  ];
  b.model.name = "テスト2輪車";
  return b.model;
}

function tagBalanced(xml: string, tag: string): boolean {
  const open = (xml.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
  const close = (xml.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
  const selfClose = (xml.match(new RegExp(`<${tag}[^>]*/>`, "g")) ?? []).length;
  return open === close + selfClose;
}

describe("エクスポート", () => {
  const model = twoWheeler();
  const data = buildExportData(model);

  it("リンク構造:本体1+ホイール2の3リンク・能動関節2", () => {
    expect(data.allJoints.filter((j) => j.type === "active").length).toBe(2);
    expect(data.allLinks.filter((l) => l.massG > 0).length).toBe(3);
    expect(data.totalMassG).toBeCloseTo(9 + 9 + 9 + 8 + 8 + 10 + 40, 1);
  });

  it("URDF:整形式・continuousジョイント・実効トルク", () => {
    const urdf = exportUrdf(data);
    expect(urdf).toContain("<robot");
    expect(urdf).toContain('type="continuous"');
    for (const t of ["robot", "link", "joint", "visual", "collision", "inertial"]) {
      expect(tagBalanced(urdf, t), `tag <${t}> balanced`).toBe(true);
    }
    // FS90R 1.5kg・cm → 0.147 Nm
    expect(urdf).toMatch(/effort="0\.147/);
  });

  it("MJCF:actuator/velocityと慣性・freejointを含む", () => {
    const mjcf = exportMjcf(data);
    expect(mjcf).toContain("<mujoco");
    expect(mjcf).toContain("<freejoint");
    expect((mjcf.match(/<velocity /g) ?? []).length).toBe(2);
    expect(mjcf).toContain("fullinertia");
    expect(tagBalanced(mjcf, "body")).toBe(true);
  });

  it("manifest:操作割当・アクチュエータ・パワーボックス情報", () => {
    const m = buildManifest(data) as Record<string, unknown>;
    expect((m.controlMappings as unknown[]).length).toBe(2);
    expect((m.actuators as unknown[]).length).toBe(2);
    expect((m.powerBox as Record<string, unknown>).defId).toBe("PB-S");
  });

  it("からくり(閉ループ)はMJCFのequality/connectになりURDFでは警告", () => {
    const b = new ModelBuilder();
    const ground = b.add("FR-B090");
    const left = b.add("FR-B060");
    const right = b.add("FR-B060");
    b.attach(ground, g(0, 0), left, g(0, 0), { pins: 1 });
    b.attach(ground, g(0, 12), right, g(0, 0), { pins: 1 });
    const top = b.add("FR-B090");
    b.attach(left, g(0, 11), top, g(0, 0), { pins: 1 });
    b.loop(right, g(0, 11), top, g(0, 12), 1);
    const d = buildExportData(b.model);
    const mjcf = exportMjcf(d);
    expect(mjcf).toContain("<equality>");
    expect(mjcf).toContain("<connect");
    expect(d.warnings.join()).toContain("URDF");
    const urdf = exportUrdf(d);
    expect(urdf).toContain("閉ループ関節");
  });
});
