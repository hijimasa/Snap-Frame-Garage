// はじめてのユーザー向けチュートリアル:2輪走行ロボを1体組む(付録A シナリオ1)
// 達成条件はモデルから自動判定(ガイド付きチェックリスト方式)
// ポイント:いたの穴はぜんぶ垂直なので、むきかえ金具でサーボの軸を横向きにする
import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import { computePoses } from "../core/assembly";
import { exportGate } from "../core/power";
import { getDef } from "../data/catalog";
import { useStore } from "../state/store";

interface Ctx {
  count: (defId: string) => number;
  horizontalWheelServos: number;
  wheelOnDrive: number;
  gateOk: boolean;
}

interface Step {
  text: string;
  hint?: string;
  done: (ctx: Ctx) => boolean;
}

const STEPS: Step[] = [
  {
    text: "カタログから「いた(中)」を選んで、床をタップして置く",
    hint: "半透明のプレビューが出るよ。好きな場所でタップ!",
    done: (c) => c.count("FR-P0606") + c.count("FR-P0612") + c.count("FR-P0306") > 0,
  },
  {
    text: "「むきかえ金具(小)」を2個、いたの左右のはしに付ける",
    hint: "いたの穴はぜんぶ上向きだから、そのままだとサーボの軸も上を向いちゃう。金具で90°向きを変えるのがコツ!",
    done: (c) => c.count("JT-BRmic") >= 2,
  },
  {
    text: "車輪用サーボを2個、金具の「たての面」の穴に付ける(軸が横向きになる)",
    hint: "サーボの向きは「くるっと回す」「うら側につけかえ」で調整できるよ",
    done: (c) => c.count("SV-WHEEL") >= 2 && c.horizontalWheelServos >= 2,
  },
  {
    text: "タイヤを、サーボの金色の穴(回る穴)に付ける ×2",
    hint: "金色のリングが駆動穴。ここにつけるとサーボが回してくれる",
    done: (c) => c.wheelOnDrive >= 2,
  },
  {
    text: "ころキャスターを、いたのうしろ側のうらにつける",
    hint: "うら側の穴をタップ(下からのぞきこむとタップしやすい)",
    done: (c) => c.count("WH-CAST") >= 1,
  },
  {
    text: "パワーボックスSを、いたの上にのせる",
    hint: "バランスのまんなか(重心マーカー)が緑になる場所をさがそう。バラバラのパーツが残ってたら📌ピンでつないでね",
    done: (c) => c.count("PB-S") + c.count("PB-M") + c.count("PB-L") >= 1 && c.gateOk,
  },
  {
    text: "「ロボットをおくり出す」ボタンで書き出す",
    hint: "できた .robopkg をシミュレータで読みこめば、運転できる!",
    done: () => false, // 書き出しダイアログを開いたらゴール(下で上書き)
  },
];

export function Tutorial() {
  const open = useStore((s) => s.tutorialOpen);
  const setOpen = useStore((s) => s.setTutorialOpen);
  const model = useStore((s) => s.model);
  const exportOpen = useStore((s) => s.exportOpen);

  const ctx: Ctx = useMemo(() => {
    const count = (defId: string) => model.parts.filter((p) => p.defId === defId).length;
    let wheelOnDrive = 0;
    for (const c of model.connections) {
      if ("special" in c.parentHole && c.parentHole.special === "drive") {
        const child = model.parts.find((p) => p.id === c.childPart);
        if (child && getDef(child.defId).category === "wheel") wheelOnDrive++;
      }
    }
    // 車輪用サーボの駆動軸が水平になっているか(金具で向きを変えられた証拠)
    let horizontalWheelServos = 0;
    const { poses } = computePoses(model);
    for (const p of model.parts) {
      if (p.defId !== "SV-WHEEL") continue;
      const def = getDef(p.defId);
      const drive = def.specialHoles?.find((s) => s.kind === "drive");
      const M = poses.get(p.id);
      if (!drive || !M) continue;
      const axis = new Vector3(...drive.normal)
        .applyQuaternion(new Quaternion().setFromRotationMatrix(M))
        .normalize();
      if (Math.abs(axis.z) < 0.5) horizontalWheelServos++;
    }
    return { count, wheelOnDrive, horizontalWheelServos, gateOk: exportGate(model).ok };
  }, [model]);

  if (!open) return null;
  const doneFlags = STEPS.map((s, i) => (i === STEPS.length - 1 ? exportOpen : s.done(ctx)));
  const current = doneFlags.findIndex((d) => !d);

  return (
    <div className="tutorial">
      <div className="dialog-title">
        🛠 はじめてのロボット(2輪車)
        <button className="mini" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      {STEPS.map((s, i) => (
        <div key={i} className={`tut-step${doneFlags[i] ? " done" : ""}${i === current ? " now" : ""}`}>
          <span className="tut-check">{doneFlags[i] ? "✅" : i === current ? "👉" : "・"}</span>
          <div>
            <div>{s.text}</div>
            {i === current && s.hint && <div className="hint">{s.hint}</div>}
          </div>
        </div>
      ))}
      {current === -1 && <div className="ok-text">🎉 かんせい!シミュレータで走らせよう!</div>}
    </div>
  );
}
