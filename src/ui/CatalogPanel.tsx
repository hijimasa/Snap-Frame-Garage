// パーツカタログブラウザ(カテゴリ別、性能・質量の比較表示)
import { useState } from "react";
import type { PartDef } from "../core/types";
import { CATEGORIES, getDef, PARTS } from "../data/catalog";
import { useStore } from "../state/store";
import { labels } from "./labels";

const RECOMMENDED: { id: string; reason: string }[] = [
  { id: "FR-P0606", reason: "まず置く土台におすすめ" },
  { id: "FR-B060", reason: "体や足をのばす" },
  { id: "SV-MICRO", reason: "関節を動かす" },
  { id: "JT-BRmic", reason: "モーターの向きを変える" },
  { id: "SV-WHEEL", reason: "タイヤを回す" },
  { id: "WH-040", reason: "小さな車を作る" },
  { id: "WH-CAST", reason: "車を倒れにくくする" },
  { id: "PB-S", reason: "モーターへ電気を送る" },
];

function PartCard({ def, reason }: { def: PartDef; reason?: string }) {
  const adult = useStore((s) => s.adultMode);
  const pending = useStore((s) => s.pendingDefId);
  const setPendingDef = useStore((s) => s.setPendingDef);
  const showToast = useStore((s) => s.showToast);
  const L = labels(adult);
  const active = pending === def.id;

  const onClick = () => {
    if (active) {
      setPendingDef(null);
    } else {
      setPendingDef(def.id);
      showToast("光った穴をタップ=くっつける / 床をタップ=そのへんに置く(あとで📌ピンでつなげる)");
    }
  };

  return (
    <button className={`part-card${active ? " active" : ""}`} onClick={onClick} title={def.description ?? ""}>
      <div className="part-name">{adult ? def.displayName.adult : def.displayName.kids}</div>
      {reason && !adult && <div className="part-reason">{reason}</div>}
      {(!reason || adult) && (
        <div className="part-meta">
          <span>
            {L.mass}: {typeof def.massG === "number" ? def.massG : `${def.massG.plastic}/${def.massG.aluminum}`}g
          </span>
          {def.powerCost > 0 && <span className="chip power">⚡{def.powerCost}</span>}
          {def.servo && (
            <span className="chip torque">
              {L.torque} {def.servo.continuous ? "回転" : `${def.servo.torqueKgCm}kg・cm`}
            </span>
          )}
          {def.powerCapacity && <span className="chip cap">容量{def.powerCapacity}</span>}
        </div>
      )}
      {adult && def.refRealPart && <div className="part-ref">{def.refRealPart} 相当</div>}
    </button>
  );
}

export function CatalogPanel() {
  const adult = useStore((s) => s.adultMode);
  const [view, setView] = useState<"recommended" | "all">("recommended");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = normalizedQuery
    ? PARTS.filter((part) =>
        [
          part.id,
          part.displayName.kids,
          part.displayName.adult,
          part.refRealPart,
          part.description,
        ]
          .filter(Boolean)
          .some((text) => text!.toLocaleLowerCase().includes(normalizedQuery))
      )
    : [];

  return (
    <div className="catalog">
      <div className="panel-title">パーツカタログ</div>
      <div className="catalog-controls">
        <div className="catalog-tabs" role="group" aria-label="パーツの表示">
          <button
            className={view === "recommended" ? "mini active" : "mini"}
            onClick={() => setView("recommended")}
            aria-pressed={view === "recommended"}
          >
            ⭐ おすすめ
          </button>
          <button
            className={view === "all" ? "mini active" : "mini"}
            onClick={() => setView("all")}
            aria-pressed={view === "all"}
          >
            すべて
          </button>
        </div>
        <label className="catalog-search">
          <span className="sr-only">パーツを検索</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 名前や型番でさがす"
          />
        </label>
      </div>

      {normalizedQuery ? (
        <div className="catalog-results" aria-live="polite">
          <div className="catalog-result-count">{results.length}個みつかったよ</div>
          <div className="cat-parts">
            {results.map((part) => (
              <PartCard key={part.id} def={part} />
            ))}
          </div>
          {results.length === 0 && <div className="catalog-empty">ちがう名前でもさがしてみよう</div>}
        </div>
      ) : view === "recommended" ? (
        <div className="catalog-recommended">
          <div className="catalog-lead">はじめによく使うパーツ</div>
          <div className="cat-parts">
            {RECOMMENDED.map(({ id, reason }) => (
              <PartCard key={id} def={getDef(id)} reason={reason} />
            ))}
          </div>
        </div>
      ) : (
        CATEGORIES.map((cat) => (
          <div key={cat.key} className="cat-group">
            <button
              className="cat-header"
              onClick={() => setOpen((o) => ({ ...o, [cat.key]: !o[cat.key] }))}
              aria-expanded={!!open[cat.key]}
            >
              {open[cat.key] ? "▾" : "▸"} {adult ? cat.label.adult : cat.label.kids}
              <span className="cat-count">{cat.parts.length}</span>
            </button>
            {open[cat.key] && (
              <div className="cat-parts">
                {cat.parts.map((p) => (
                  <PartCard key={p.id} def={p} />
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
