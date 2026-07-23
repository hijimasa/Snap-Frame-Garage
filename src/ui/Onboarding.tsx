// 初回起動時の説明ポップアップ(スライド式)。
// 画像は実アプリのスクリーンショット(public/help/)、概念図はインラインSVG。
import { useState } from "react";

/** ピンの文法:1本=回る / 2本=固定 の図解 */
function PinRuleSvg() {
  return (
    <svg viewBox="0 0 360 125" className="onboard-svg" role="img" aria-label="ピンのルール">
      {/* 左:1本=回る */}
      <g transform="translate(20,10)">
        <rect x="0" y="30" width="130" height="22" rx="4" fill="#eee8dc" />
        <rect x="20" y="44" width="130" height="22" rx="4" fill="#d8d2c4" transform="rotate(-18 30 55)" />
        <circle cx="30" cy="52" r="6" fill="#35c5e4" stroke="#1c1f26" strokeWidth="2" />
        <path d="M 95 18 A 42 42 0 0 1 118 44" fill="none" stroke="#35c5e4" strokeWidth="4" strokeLinecap="round" />
        <path d="M 118 44 l -10 -2 l 7 -8 z" fill="#35c5e4" />
        <text x="65" y="100" textAnchor="middle" fill="#e8eaf0" fontSize="14" fontWeight="bold">
          ピン1本 = くるくる回る
        </text>
      </g>
      {/* 右:2本=固定 */}
      <g transform="translate(210,10)">
        <rect x="0" y="30" width="130" height="22" rx="4" fill="#eee8dc" />
        <rect x="0" y="44" width="130" height="22" rx="4" fill="#d8d2c4" />
        <circle cx="30" cy="52" r="6" fill="#8a93a8" stroke="#1c1f26" strokeWidth="2" />
        <circle cx="100" cy="52" r="6" fill="#8a93a8" stroke="#1c1f26" strokeWidth="2" />
        <text x="65" y="20" textAnchor="middle" fontSize="16">🔒</text>
        <text x="65" y="100" textAnchor="middle" fill="#e8eaf0" fontSize="14" fontWeight="bold">
          ピン2本 = がっちり固定
        </text>
      </g>
    </svg>
  );
}

/** パワーボックスの図解:モーターが電気をつかう → 大きい箱が必要 */
function PowerSvg() {
  return (
    <svg viewBox="0 0 360 130" className="onboard-svg" role="img" aria-label="パワーボックスのルール">
      {/* サーボたち */}
      <g transform="translate(15,18)">
        <rect x="0" y="0" width="34" height="30" rx="4" fill="#3d7dd8" />
        <circle cx="17" cy="7" r="6" fill="#f2efe6" />
        <rect x="44" y="0" width="34" height="30" rx="4" fill="#3d7dd8" />
        <circle cx="61" cy="7" r="6" fill="#f2efe6" />
        <rect x="22" y="40" width="40" height="34" rx="4" fill="#333a44" />
        <circle cx="42" cy="48" r="7" fill="#f2efe6" />
        <text x="40" y="98" textAnchor="middle" fill="#e8eaf0" fontSize="13">モーター</text>
      </g>
      <text x="112" y="65" textAnchor="middle" fill="#f5c211" fontSize="26">⚡</text>
      <text x="138" y="65" textAnchor="middle" fill="#8a93a8" fontSize="22">→</text>
      {/* 箱 S M L */}
      <g transform="translate(155,30)">
        <rect x="0" y="34" width="36" height="24" rx="4" fill="#e8842a" />
        <text x="18" y="50" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="bold">S</text>
        <rect x="48" y="20" width="52" height="38" rx="4" fill="#e8842a" />
        <text x="74" y="44" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="bold">M</text>
        <rect x="112" y="2" width="72" height="56" rx="4" fill="#e8842a" />
        <text x="148" y="36" textAnchor="middle" fill="#fff" fontSize="17" fontWeight="bold">L</text>
        <text x="92" y="86" textAnchor="middle" fill="#e8eaf0" fontSize="13">
          つかう電気がふえるほど、大きくて重い箱になる
        </text>
      </g>
    </svg>
  );
}

interface Slide {
  title: string;
  img?: string;
  svg?: "pin" | "power";
  body: React.ReactNode;
}

const SLIDES: Slide[] = [
  {
    title: "🔩 Snap Frame Garage へようこそ!",
    img: "help/hero_dog.png",
    body: (
      <>
        ここは、<b>ほんとうに売っている部品</b>(モーター・センサ・ほね・いた)で、
        じぶんだけのロボットを組み立てるガレージ。
        できあがったロボットは<b>「おくり出し」</b>て、シミュレータで運転できるよ。
      </>
    ),
  },
  {
    title: "🔧 くみたては「穴とピン」だけ",
    img: "help/build_ghost.png",
    body: (
      <>
        カタログで部品を選ぶと<b>半透明のプレビュー</b>が出る。
        <b>光った穴をタップ=くっつく</b>/<b>床をタップ=仮置き</b>(あとで📌ピンでつなぐ)。
        置いた部品はドラッグで動かせて、近くの穴に吸いつくよ。
      </>
    ),
  },
  {
    title: "📌 ピンのルールは2行だけ",
    svg: "pin",
    body: (
      <>
        とめた場所の丸いバッジを押すと切りかえられる。
        ピン1本の「くるくる」をうまく使うと、<b>からくり(リンク機構)</b>も作れる。
        <b>金色のリング</b>はサーボが回す特別な穴だよ。
      </>
    ),
  },
  {
    title: "🎯 たおれないロボットにしよう",
    img: "help/balance_red.png",
    body: (
      <>
        まるいマーカーが<b>「バランスのまんなか」(重心)</b>。
        床の色つきエリアが<b>「たおれない範囲」</b>。
        マーカーが<b style={{ color: "#e01b24" }}>赤</b>くなったら、たおれちゃうサイン。
        重いものは<b>低く・まんなか</b>に置くのがコツ。
      </>
    ),
  },
  {
    title: "🔋 パワーボックスをわすれずに",
    svg: "power",
    body: (
      <>
        モーターとセンサは電気をつかう。つかうぶんの<b>パワーボックス</b>をのせないと
        おくり出せない。強いモーターをたくさん積むと箱が重くなってバランスがくずれる……
        ここがうでの見せどころ!
      </>
    ),
  },
];

export function Onboarding({
  open,
  onClose,
  onPickTemplate,
  onStartGuide,
}: {
  open: boolean;
  onClose: () => void;
  onPickTemplate: () => void;
  onStartGuide: () => void;
}) {
  const [page, setPage] = useState(0);
  if (!open) return null;
  const last = page === SLIDES.length; // 最終ページ=「さあつくろう」
  const slide = SLIDES[page];

  const finish = (then?: () => void) => {
    try {
      localStorage.setItem("sfg-onboarded", "1");
    } catch {
      /* ローカルファースト */
    }
    setPage(0);
    onClose();
    then?.();
  };

  return (
    <div className="overlay" onClick={() => finish()}>
      <div className="dialog onboard" onClick={(e) => e.stopPropagation()}>
        {!last ? (
          <>
            <div className="dialog-title">
              {slide.title}
              <button className="mini" onClick={() => finish()}>
                スキップ
              </button>
            </div>
            {slide.img && <img className="onboard-img" src={slide.img} alt="" />}
            {slide.svg === "pin" && <PinRuleSvg />}
            {slide.svg === "power" && <PowerSvg />}
            <div className="onboard-body">{slide.body}</div>
          </>
        ) : (
          <>
            <div className="dialog-title">🚀 さあ、つくろう!</div>
            <div className="onboard-body">はじめかたを選んでね(あとから変えてもいいよ)</div>
            <div className="onboard-actions">
              <button className="toolbtn primary big" onClick={() => finish(onPickTemplate)}>
                🤖 ひながたから始める(おすすめ)
              </button>
              <button className="toolbtn big" onClick={() => finish(onStartGuide)}>
                🛠 ガイドつきで2輪車を作る
              </button>
              <button className="toolbtn big" onClick={() => finish()}>
                ✨ じゆうにつくる
              </button>
            </div>
          </>
        )}
        <div className="onboard-nav">
          <button className="mini" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            ← もどる
          </button>
          <span className="onboard-dots">
            {[...SLIDES, null].map((_, i) => (
              <span key={i} className={`dot${i === page ? " on" : ""}`} onClick={() => setPage(i)} />
            ))}
          </span>
          {!last ? (
            <button className="mini primary-mini" onClick={() => setPage(page + 1)}>
              つぎへ →
            </button>
          ) : (
            <span style={{ width: 70 }} />
          )}
        </div>
      </div>
    </div>
  );
}
