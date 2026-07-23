// テンプレート4種を .robopkg として書き出す開発用ツール。
// 姉妹アプリ(Snap Frame Pilot 等)のテストフィクスチャ生成に使う。
// 使い方: ROBOPKG_OUT_DIR=/path/to/out npx vitest run src/tools/export-templates.test.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildExportData } from "../core/export/exportData";
import { exportMjcf } from "../core/export/mjcf";
import { exportUrdf } from "../core/export/urdf";
import { buildManifest } from "../core/export/robopkg";
import { TEMPLATES } from "../data/templates";

const outDir = process.env.ROBOPKG_OUT_DIR;

describe.skipIf(!outDir)("export templates to .robopkg", () => {
  it.each(TEMPLATES)("$id を書き出す", async (tpl) => {
    const model = tpl.build();
    const data = buildExportData(model);
    const zip = new JSZip();
    zip.file("robot.urdf", exportUrdf(data));
    zip.file("robot.mjcf.xml", exportMjcf(data));
    zip.file("manifest.json", JSON.stringify(buildManifest(data), null, 2));
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    mkdirSync(outDir!, { recursive: true });
    writeFileSync(join(outDir!, `${tpl.id}.robopkg`), buf);
    expect(buf.length).toBeGreaterThan(0);
  });
});
