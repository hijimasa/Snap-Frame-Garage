// 下部ステータスバー:おもさ/重心/安定/電力/パワーボックス/書き出し
import { useMemo } from "react";
import { buildAssembly } from "../core/assembly";
import { robotMassSummary } from "../core/mass";
import { exportGate } from "../core/power";
import { computeStability } from "../core/stability";
import { useStore } from "../state/store";
import { labels, powerReasonText } from "./labels";

export function StatusBar() {
  const model = useStore((s) => s.model);
  const adult = useStore((s) => s.adultMode);
  const linkMode = useStore((s) => s.linkMode);
  const setLinkMode = useStore((s) => s.setLinkMode);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const showToast = useStore((s) => s.showToast);
  const L = labels(adult);

  const asm = useMemo(() => buildAssembly(model), [model]);
  const summary = useMemo(() => robotMassSummary(model, asm), [model, asm]);
  const stability = useMemo(
    () => computeStability(model, asm, summary.cogWorldMm),
    [model, asm, summary]
  );
  const gate = useMemo(() => exportGate(model), [model]);
  const power = gate.power;

  const statusLabel = {
    stable: `🟢 ${L.stable}`,
    warning: `🟡 ${L.warning}`,
    unstable: `🔴 ${L.unstable}`,
    none: `⚪ ${L.none}`,
  }[stability.status];

  const boxPlaced = power.placedBoxes[0];

  return (
    <div className="statusbar">
      <span className="stat">
        ⚖ {L.mass} <b>{summary.totalMassG.toFixed(0)} g</b>
      </span>
      <span className="stat" title={`${L.cog}の高さ`}>
        🎯 {L.cog} <b>高さ {stability.status === "none" ? "-" : (summary.cogWorldMm.z - stability.minZMm).toFixed(0)}mm</b>
      </span>
      <span className="stat">{statusLabel}</span>
      <span className="stat">
        ⚡ {L.powerCost} <b>{power.totalCost}</b>
        {power.requiredBox && (
          <span className="dim">(必要: {power.requiredBox.id.replace("PB-", "")}箱)</span>
        )}
      </span>
      <span className="stat">
        🔋 {boxPlaced ? `${boxPlaced.def.id.replace("PB-", "")}箱 のせた` : "パワーボックスなし"}
      </span>
      {gate.islands > 1 && (
        <span className="stat warn-text" title="ピンでつながっていないかたまりがある(書き出すには1つにつなげる)">
          🧩 バラバラ {gate.islands}こ
        </span>
      )}
      <span className="spacer" />
      <button
        className={`toolbtn${linkMode ? " active" : ""}`}
        onClick={() => setLinkMode(!linkMode)}
        title="重なっている2つの穴をピンで留める(からくり用)"
      >
        📌 {L.linkTool}
      </button>
      <button
        className="toolbtn primary"
        onClick={() => {
          if (!gate.ok) {
            showToast(gate.reasons.map((r) => powerReasonText(r, adult)).join(" / "));
            return;
          }
          setExportOpen(true);
        }}
        title={gate.ok ? "" : gate.reasons.map((r) => powerReasonText(r, adult)).join("\n")}
      >
        📦 {L.exportBtn}
      </button>
    </div>
  );
}
