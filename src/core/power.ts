// パワーボックスメカニクス(企画書§3.3):電力コスト1軸、ボックス自動グレード判定。
import { getDef, POWERBOXES } from "../data/catalog";
import { countIslands } from "./assembly";
import type { PartDef, RobotModel } from "./types";

export interface PowerStatus {
  totalCost: number;
  requiredBox: PartDef | null; // コストに対して必要な最小グレード(null=容量超過)
  placedBoxes: { partId: string; def: PartDef }[];
  ok: boolean; // 書き出し可能か
  reasons: string[]; // NGの理由(子ども向け文言はUI側で変換)
}

export function computePower(model: RobotModel): PowerStatus {
  let totalCost = 0;
  const placedBoxes: { partId: string; def: PartDef }[] = [];
  for (const p of model.parts) {
    const def = getDef(p.defId);
    totalCost += def.powerCost;
    if (def.category === "powerbox") placedBoxes.push({ partId: p.id, def });
  }
  const requiredBox =
    totalCost === 0
      ? POWERBOXES[0]
      : POWERBOXES.find((b) => (b.powerCapacity ?? 0) >= totalCost) ?? null;

  const reasons: string[] = [];
  if (model.parts.length === 0) reasons.push("empty");
  if (placedBoxes.length === 0) reasons.push("no-box");
  if (placedBoxes.length > 1) reasons.push("multi-box");
  if (requiredBox === null) reasons.push("over-capacity");
  if (
    placedBoxes.length === 1 &&
    requiredBox !== null &&
    (placedBoxes[0].def.powerCapacity ?? 0) < totalCost
  )
    reasons.push("box-too-small");

  return { totalCost, requiredBox, placedBoxes, ok: reasons.length === 0, reasons };
}

export interface ExportGate {
  ok: boolean;
  reasons: string[];
  power: PowerStatus;
  islands: number;
}

/** 書き出し可否の総合判定:電力条件+「全部品がピンでつながっていること」 */
export function exportGate(model: RobotModel): ExportGate {
  const power = computePower(model);
  const islands = countIslands(model);
  const reasons = [...power.reasons];
  if (model.parts.length > 0 && islands > 1) reasons.push("not-connected");
  return { ok: reasons.length === 0, reasons, power, islands };
}
