import partsJson from "./parts.json";
import type { PartDef } from "../core/types";

export const PARTS: PartDef[] = partsJson as unknown as PartDef[];

const byId = new Map(PARTS.map((p) => [p.id, p]));

export function getDef(id: string): PartDef {
  const d = byId.get(id);
  if (!d) throw new Error(`unknown part def: ${id}`);
  return d;
}

export const POWERBOXES = PARTS.filter((p) => p.category === "powerbox").sort(
  (a, b) => (a.powerCapacity ?? 0) - (b.powerCapacity ?? 0)
);

export interface CatalogCategory {
  key: string;
  label: { kids: string; adult: string };
  parts: PartDef[];
}

export const CATEGORIES: CatalogCategory[] = [
  { key: "actuator", label: { kids: "モーター(サーボ)", adult: "アクチュエータ" }, parts: [] },
  { key: "frame", label: { kids: "ほね・いた", adult: "フレーム" }, parts: [] },
  { key: "bracket", label: { kids: "むきかえ金具", adult: "ブラケット" }, parts: [] },
  { key: "wheel", label: { kids: "足まわり", adult: "ホイール・足" }, parts: [] },
  { key: "hand", label: { kids: "ハンド", adult: "エンドエフェクタ" }, parts: [] },
  { key: "sensor", label: { kids: "センサ", adult: "センサ" }, parts: [] },
  { key: "weight", label: { kids: "おもり", adult: "ウェイト" }, parts: [] },
  { key: "decor", label: { kids: "かざり", adult: "デコレーション" }, parts: [] },
  { key: "powerbox", label: { kids: "パワーボックス", adult: "パワーボックス" }, parts: [] },
];
for (const c of CATEGORIES) c.parts = PARTS.filter((p) => p.category === c.key);
