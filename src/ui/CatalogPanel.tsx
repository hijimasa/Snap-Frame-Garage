// パーツカタログブラウザ(カテゴリ別、性能・質量の比較表示)
import { useState } from "react";
import type { PartDef } from "../core/types";
import { CATEGORIES } from "../data/catalog";
import { useStore } from "../state/store";
import { labels } from "./labels";

function PartCard({ def }: { def: PartDef }) {
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
      {adult && def.refRealPart && <div className="part-ref">{def.refRealPart} 相当</div>}
    </button>
  );
}

export function CatalogPanel() {
  const adult = useStore((s) => s.adultMode);
  const [open, setOpen] = useState<Record<string, boolean>>({ actuator: true, frame: true });
  return (
    <div className="catalog">
      <div className="panel-title">パーツカタログ</div>
      {CATEGORIES.map((cat) => (
        <div key={cat.key} className="cat-group">
          <button
            className="cat-header"
            onClick={() => setOpen((o) => ({ ...o, [cat.key]: !o[cat.key] }))}
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
      ))}
    </div>
  );
}
