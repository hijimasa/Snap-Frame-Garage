// ロボットパッケージ(*.robopkg.zip = 素のzip)書き出し(企画書§5.3)と、プロジェクト保存/読込。
// 拡張子を.zipのままにすることで、他のシミュレータやROSツールでもそのまま解凍して使える。
import JSZip from "jszip";
import { Quaternion, Vector3 } from "three";
import { getDef } from "../../data/catalog";
import type { RobotModel } from "../types";
import { buildExportData, servoEffortNm, servoVelocityRadS, type ExportData } from "./exportData";
import { exportMjcf } from "./mjcf";
import { exportUrdf } from "./urdf";

export const APP_VERSION = "0.1.0";

export function buildManifest(data: ExportData): object {
  const { model, asm } = data;
  const actuators = data.allJoints
    .filter((j) => j.type === "active" && j.servo && j.servoPartId)
    .map((j) => {
      const inst = model.parts.find((p) => p.id === j.servoPartId)!;
      const def = getDef(inst.defId);
      return {
        jointName: j.name,
        partId: inst.id,
        defId: def.id,
        refRealPart: def.refRealPart ?? null,
        torqueKgCm: j.servo!.torqueKgCm,
        effortNm: servoEffortNm(j.servo!),
        maxVelocityRadS: servoVelocityRadS(j.servo!),
        rangeDeg: j.servo!.rangeDeg,
        continuous: !!j.servo!.continuous,
      };
    });

  const sensors = model.parts
    .filter((p) => getDef(p.defId).sensorRole)
    .map((p) => {
      const def = getDef(p.defId);
      const M = asm.poses.get(p.id);
      const pos = M ? new Vector3().setFromMatrixPosition(M) : new Vector3();
      const q = M ? new Quaternion().setFromRotationMatrix(M) : new Quaternion();
      return {
        partId: p.id,
        defId: def.id,
        role: def.sensorRole,
        refRealPart: def.refRealPart ?? null,
        posM: [pos.x / 1000, pos.y / 1000, pos.z / 1000],
        quatWxyz: [q.w, q.x, q.y, q.z],
        // カメラの視線はパーツローカル+Z(カタログの約束事)
        viewAxisLocal: def.sensorRole === "camera" ? [0, 0, 1] : undefined,
      };
    });

  const box = data.power.placedBoxes[0];
  const boxPose = box ? asm.poses.get(box.partId) : undefined;
  const boxPos = boxPose ? new Vector3().setFromMatrixPosition(boxPose) : null;

  return {
    app: "Snap Frame Garage",
    appVersion: APP_VERSION,
    formatVersion: 1,
    modelName: model.name,
    author: model.author || "ななしのビルダー",
    controlMappings: model.mappings,
    actuators,
    sensors,
    powerBox: box
      ? {
          defId: box.def.id,
          grade: box.def.id.replace("PB-", ""),
          capacity: box.def.powerCapacity,
          totalPowerCost: data.power.totalCost,
          posM: boxPos ? [boxPos.x / 1000, boxPos.y / 1000, boxPos.z / 1000] : null,
        }
      : null,
    totals: {
      massKg: data.totalMassG / 1000,
      cogM: [data.cogMm.x / 1000, data.cogMm.y / 1000, data.cogMm.z / 1000],
      stability: data.stability.status,
      stabilityMarginMm: data.stability.marginMm,
      danglingPassiveJoints: asm.danglingCount,
      hasClosedLoop: data.loopJoints.length > 0,
    },
    geometry: { meshes: "primitives-only" },
    warnings: data.warnings,
  };
}

export interface RobopkgResult {
  blob: Blob;
  fileName: string;
  urdf: string;
  mjcf: string;
  manifest: object;
  warnings: string[];
}

export async function buildRobopkg(
  model: RobotModel,
  thumbnailPngDataUrl?: string
): Promise<RobopkgResult> {
  const data = buildExportData(model);
  const urdf = exportUrdf(data);
  const mjcf = exportMjcf(data);
  const manifest = buildManifest(data);

  const zip = new JSZip();
  zip.file("robot.urdf", urdf);
  zip.file("robot.mjcf.xml", mjcf);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  if (thumbnailPngDataUrl?.startsWith("data:image/png;base64,")) {
    zip.file("thumbnail.png", thumbnailPngDataUrl.split(",")[1], { base64: true });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const safe = (model.name || "mybot").replace(/[\\/:*?"<>|]/g, "_");
  return { blob, fileName: `${safe}.robopkg.zip`, urdf, mjcf, manifest, warnings: data.warnings };
}

// ---- プロジェクト保存/読込(ローカルファースト) ----

export function serializeProject(model: RobotModel): string {
  return JSON.stringify({ app: "Snap Frame Garage", appVersion: APP_VERSION, model }, null, 2);
}

export function deserializeProject(json: string): RobotModel {
  const obj = JSON.parse(json);
  const m = obj.model ?? obj;
  if (!Array.isArray(m.parts) || !Array.isArray(m.connections)) {
    throw new Error("プロジェクトファイルの形式が違うみたい");
  }
  return {
    version: m.version ?? 1,
    name: m.name ?? "マイロボット",
    author: m.author ?? "",
    parts: m.parts,
    connections: m.connections,
    mappings: m.mappings ?? [],
    nextSeq: m.nextSeq ?? m.parts.length + 1,
  };
}
