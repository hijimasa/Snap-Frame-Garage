import { useEffect, useRef, useState } from "react";
import { getDef } from "./data/catalog";
import { TEMPLATES } from "./data/templates";
import { useStore } from "./state/store";
import { CatalogPanel } from "./ui/CatalogPanel";
import { EmptyCanvasStart } from "./ui/EmptyCanvasStart";
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
  const placeFreePart = useStore((s) => s.placeFreePart);
  const toast = useStore((s) => s.toast);
  const clearToast = useStore((s) => s.clearToast);
  const loadTemplate = useStore((s) => s.loadTemplate);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [tabletDrawer, setTabletDrawer] = useState<"catalog" | "inspector" | null>(null);
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
        setFileMenuOpen(false);
        setHelpMenuOpen(false);
        setTabletDrawer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, setPendingDef, setLinkMode]);

  useEffect(() => {
    if (pendingDefId) setTabletDrawer(null);
  }, [pendingDefId]);

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
        <span className="logo">
          <span aria-hidden="true">🔩</span>
          <span className="logo-text">Snap Frame Garage</span>
        </span>
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
        <button
          className={`toolbtn drawer-toggle${tabletDrawer === "catalog" ? " active" : ""}`}
          aria-label="パーツカタログを開く"
          aria-controls="catalog-drawer"
          aria-expanded={tabletDrawer === "catalog"}
          onClick={() => setTabletDrawer((v) => (v === "catalog" ? null : "catalog"))}
        >
          🧱 <span>パーツ</span>
        </button>
        <button
          className={`toolbtn drawer-toggle${tabletDrawer === "inspector" ? " active" : ""}`}
          aria-label="パーツの調整を開く"
          aria-controls="inspector-drawer"
          aria-expanded={tabletDrawer === "inspector"}
          onClick={() => setTabletDrawer((v) => (v === "inspector" ? null : "inspector"))}
        >
          🛠 <span>調整</span>
        </button>
        <span className="spacer" />
        <button
          className="toolbtn"
          onClick={() => {
            setTemplateOpen(true);
            setFileMenuOpen(false);
            setHelpMenuOpen(false);
          }}
        >
          🤖 ひながた
        </button>
        <div className="toolbar-menu">
          <button
            className={`toolbtn${fileMenuOpen ? " active" : ""}`}
            aria-expanded={fileMenuOpen}
            aria-haspopup="menu"
            onClick={() => {
              setFileMenuOpen((open) => !open);
              setHelpMenuOpen(false);
            }}
          >
            📁 ファイル
          </button>
          {fileMenuOpen && (
            <div className="toolbar-menu-popover" role="menu" aria-label="ファイル">
              <button
                role="menuitem"
                onClick={() => {
                  if (model.parts.length && !confirm("いまのロボットを消して、新しく作る?")) return;
                  newProject();
                  setFileMenuOpen(false);
                }}
              >
                ✨ 新しく作る
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  saveFile();
                  setFileMenuOpen(false);
                }}
              >
                💾 保存
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  fileRef.current?.click();
                  setFileMenuOpen(false);
                }}
              >
                📂 ひらく
              </button>
            </div>
          )}
        </div>
        <div className="toolbar-menu">
          <button
            className={`toolbtn${helpMenuOpen ? " active" : ""}`}
            aria-expanded={helpMenuOpen}
            aria-haspopup="menu"
            onClick={() => {
              setHelpMenuOpen((open) => !open);
              setFileMenuOpen(false);
            }}
          >
            ❓ ヘルプ
          </button>
          {helpMenuOpen && (
            <div className="toolbar-menu-popover" role="menu" aria-label="ヘルプ">
              <button
                role="menuitem"
                onClick={() => {
                  setTutorialOpen(!tutorialOpen);
                  setHelpMenuOpen(false);
                }}
              >
                🛠 組み立てガイド
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setOnboardOpen(true);
                  setHelpMenuOpen(false);
                }}
              >
                ❓ アプリのせつめい
              </button>
            </div>
          )}
        </div>
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
          <span className="mode-label">おとなモード</span>
        </label>
      </header>

      <div className="main">
        <aside
          id="catalog-drawer"
          className={`left drawer-panel${tabletDrawer === "catalog" ? " drawer-open" : ""}`}
        >
          <CatalogPanel />
        </aside>
        <div className="center">
          <Viewport />
          {model.parts.length === 0 &&
            !onboardOpen &&
            !templateOpen &&
            !tutorialOpen &&
            !pendingDefId &&
            !linkMode && (
              <EmptyCanvasStart
                onPlaceBase={() => placeFreePart("FR-P0606", 0, 0, 0)}
                onPickTemplate={() => setTemplateOpen(true)}
              />
            )}
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
          {toast && (
            <div className="toast" role="status">
              <span>{toast.message}</span>
              {toast.undoable && (
                <button
                  className="mini toast-undo"
                  onClick={() => {
                    undo();
                    clearToast();
                  }}
                >
                  ↶ 元に戻す
                </button>
              )}
            </div>
          )}
        </div>
        {tabletDrawer && (
          <button
            className="drawer-scrim"
            aria-label="パネルを閉じる"
            onClick={() => setTabletDrawer(null)}
          />
        )}
        <aside
          id="inspector-drawer"
          className={`right drawer-panel${tabletDrawer === "inspector" ? " drawer-open" : ""}`}
        >
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
