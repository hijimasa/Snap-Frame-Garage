import { useEffect, useRef, useState } from "react";
import { getDef } from "./data/catalog";
import { TEMPLATES } from "./data/templates";
import { useStore } from "./state/store";
import { CatalogPanel } from "./ui/CatalogPanel";
import { ExportDialog } from "./ui/ExportDialog";
import { Inspector } from "./ui/Inspector";
import { Onboarding } from "./ui/Onboarding";
import { StatusBar } from "./ui/StatusBar";
import { Tutorial } from "./ui/Tutorial";
import { Viewport } from "./ui/Viewport";

export default function App() {
  const model = useStore((s) => s.model);
  const setName = useStore((s) => s.setName);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const adult = useStore((s) => s.adultMode);
  const setAdultMode = useStore((s) => s.setAdultMode);
  const tutorialOpen = useStore((s) => s.tutorialOpen);
  const setTutorialOpen = useStore((s) => s.setTutorialOpen);
  const newProject = useStore((s) => s.newProject);
  const saveProjectJson = useStore((s) => s.saveProjectJson);
  const loadProjectJson = useStore((s) => s.loadProjectJson);
  const showToast = useStore((s) => s.showToast);
  const pendingDefId = useStore((s) => s.pendingDefId);
  const setPendingDef = useStore((s) => s.setPendingDef);
  const linkMode = useStore((s) => s.linkMode);
  const setLinkMode = useStore((s) => s.setLinkMode);
  const toast = useStore((s) => s.toast);
  const loadTemplate = useStore((s) => s.loadTemplate);
  const [templateOpen, setTemplateOpen] = useState(false);
  // はじめての起動では説明ポップアップを開く
  const [onboardOpen, setOnboardOpen] = useState(() => {
    try {
      return !localStorage.getItem("sfg-onboarded");
    } catch {
      return true;
    }
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT")
        return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        setPendingDef(null);
        setLinkMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, setPendingDef, setLinkMode]);

  const saveFile = () => {
    const json = saveProjectJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${model.name || "mybot"}.sfg.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">🔩 Snap Frame Garage</span>
        <input
          className="name-input"
          value={model.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ロボットのなまえ"
        />
        <button className="toolbtn" onClick={undo} disabled={past.length === 0} title="もとに戻す (Ctrl+Z)">
          ↶
        </button>
        <button className="toolbtn" onClick={redo} disabled={future.length === 0} title="やり直す (Ctrl+Y)">
          ↷
        </button>
        <span className="spacer" />
        <button className="toolbtn" onClick={() => setTemplateOpen(true)}>
          🤖 ひながた
        </button>
        <button className="toolbtn" onClick={() => setTutorialOpen(!tutorialOpen)}>
          🛠 ガイド
        </button>
        <button className="toolbtn" onClick={() => setOnboardOpen(true)} title="このアプリの説明">
          ❓ せつめい
        </button>
        <button
          className="toolbtn"
          onClick={() => {
            if (model.parts.length && !confirm("いまのロボットを消して、新しく作る?")) return;
            newProject();
          }}
        >
          ✨ 新しく作る
        </button>
        <button className="toolbtn" onClick={saveFile}>
          💾 保存
        </button>
        <button className="toolbtn" onClick={() => fileRef.current?.click()}>
          📂 ひらく
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.sfg.json"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              loadProjectJson(await f.text());
              showToast("読みこんだよ!");
            } catch (err) {
              showToast(`読みこめなかった… ${err}`);
            }
            e.target.value = "";
          }}
        />
        <label className="mode-toggle" title="正式用語+詳細数値の表示">
          <input type="checkbox" checked={adult} onChange={(e) => setAdultMode(e.target.checked)} />
          おとなモード
        </label>
      </header>

      <div className="main">
        <aside className="left">
          <CatalogPanel />
        </aside>
        <div className="center">
          <Viewport />
          {pendingDefId && (
            <div className="mode-banner">
              「{adult ? getDef(pendingDefId).displayName.adult : getDef(pendingDefId).displayName.kids}
              」— 光った穴をタップ=くっつける / 床をタップ=置く(Escでやめる)
              <button className="mini" onClick={() => setPendingDef(null)}>
                やめる
              </button>
            </div>
          )}
          {linkMode && (
            <div className="mode-banner link">
              📌 つなぎたい2つの穴をじゅんばんにタップ(別のかたまり=吸着してくっつく/同じかたまり=からくりの追いピン)
              <button className="mini" onClick={() => setLinkMode(false)}>
                やめる
              </button>
            </div>
          )}
          <Tutorial />
          {toast && <div className="toast">{toast}</div>}
        </div>
        <aside className="right">
          <Inspector />
        </aside>
      </div>

      <StatusBar />
      <ExportDialog />
      <Onboarding
        open={onboardOpen}
        onClose={() => setOnboardOpen(false)}
        onPickTemplate={() => setTemplateOpen(true)}
        onStartGuide={() => setTutorialOpen(true)}
      />

      {templateOpen && (
        <div className="overlay" onClick={() => setTemplateOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">
              🤖 ひながたから始める
              <button className="mini" onClick={() => setTemplateOpen(false)}>
                ✕
              </button>
            </div>
            <div className="hint">
              できあがったロボットを読みこんで、そこから自由に改造できるよ
            </div>
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                className="part-card template-card"
                onClick={() => {
                  if (
                    model.parts.length > 0 &&
                    !confirm("いまのロボットを消して、ひながたを読みこむ?")
                  )
                    return;
                  loadTemplate(tpl.id);
                  setTemplateOpen(false);
                }}
              >
                <div className="part-name">
                  {tpl.emoji} {tpl.name}
                </div>
                <div className="part-meta">{tpl.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
