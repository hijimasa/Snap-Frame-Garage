// 書き出しダイアログ:.robopkg(zip)一発ダウンロード+個別ファイル
import { useEffect, useState } from "react";
import { buildRobopkg, type RobopkgResult } from "../core/export/robopkg";
import { useStore } from "../state/store";
import { captureThumbnail } from "./viewportCapture";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function ExportDialog() {
  const open = useStore((s) => s.exportOpen);
  const setOpen = useStore((s) => s.setExportOpen);
  const model = useStore((s) => s.model);
  const [result, setResult] = useState<RobopkgResult | null>(null);
  const [thumb, setThumb] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      return;
    }
    const t = captureThumbnail();
    setThumb(t);
    buildRobopkg(model, t)
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, [open, model]);

  if (!open) return null;
  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">📦 ロボットをおくり出す</div>
        {thumb && <img className="thumb" src={thumb} alt="サムネイル" />}
        {error && <div className="warn-text">書き出しに失敗: {error}</div>}
        {!result && !error && <div className="hint">パッキング中…</div>}
        {result && (
          <>
            <button
              className="toolbtn primary big"
              onClick={() => download(result.blob, result.fileName)}
            >
              ⬇ {result.fileName} をダウンロード
            </button>
            <div className="hint">
              これをシミュレータアプリで読み込むと、あそべるよ。
              中身:robot.urdf / robot.mjcf.xml / manifest.json / thumbnail.png
            </div>
            <div className="btn-row wrap">
              <button
                className="mini"
                onClick={() =>
                  download(new Blob([result.urdf], { type: "application/xml" }), "robot.urdf")
                }
              >
                robot.urdf だけ
              </button>
              <button
                className="mini"
                onClick={() =>
                  download(new Blob([result.mjcf], { type: "application/xml" }), "robot.mjcf.xml")
                }
              >
                robot.mjcf.xml だけ
              </button>
              <button
                className="mini"
                onClick={() =>
                  download(
                    new Blob([JSON.stringify(result.manifest, null, 2)], {
                      type: "application/json",
                    }),
                    "manifest.json"
                  )
                }
              >
                manifest.json だけ
              </button>
            </div>
            {result.warnings.length > 0 && (
              <div className="warn-list">
                {result.warnings.map((w, i) => (
                  <div key={i} className="warn-text">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <button className="mini" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>
          とじる
        </button>
      </div>
    </div>
  );
}
