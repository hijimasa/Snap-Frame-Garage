// UI文言ポリシー(企画書 付録B):子ども向け文言が第一言語、おとなモードで正式用語。
export function labels(adult: boolean) {
  return {
    cog: adult ? "重心(CoG)" : "バランスのまんなか",
    supportPolygon: adult ? "支持多角形" : "たおれない範囲",
    torque: adult ? "トルク" : "ちから",
    actuator: adult ? "アクチュエータ" : "モーター(サーボ)",
    exportBtn: adult ? "エクスポート" : "ロボットをおくり出す",
    mass: adult ? "質量" : "おもさ",
    powerCost: adult ? "電力コスト" : "つかう電気",
    stable: adult ? "安定" : "たおれない",
    warning: adult ? "限界付近" : "ギリギリ!",
    unstable: adult ? "不安定" : "たおれちゃう!",
    none: adult ? "接地なし" : "まだ床にとどいてない",
    dangling: adult ? "拘束されていない受動自由度" : "ぶらぶらの関節",
    passiveJoint: adult ? "受動関節(ピン1本)" : "くるくる回る(ピン1本)",
    fixedJoint: adult ? "剛結合(ピン2本)" : "しっかり固定(ピン2本)",
    activeJoint: adult ? "能動関節(サーボ駆動)" : "サーボが回すところ",
    driveHole: adult ? "駆動穴" : "サーボの回る穴",
    material: adult ? "材質" : "ざいりょう",
    plastic: adult ? "プラスチック" : "プラ(かるい)",
    aluminum: adult ? "アルミ" : "アルミ(重いけどカッコいい)",
    rotate: adult ? "90°回転" : "くるっと回す",
    flip: adult ? "反対面に取付" : "うら側につけかえ",
    flipOver: adult ? "反転(同一面で180°)" : "ひっくり返す(おもて面のまま)",
    cycleHole: adult ? "取付穴を変更" : "もちかたを変える",
    del: adult ? "削除(子パーツも)" : "はずす(くっついてる物も)",
    pose: adult ? "関節ポーズ(可動域プレビュー)" : "うごかしてみる",
    mapping: adult ? "操作割当" : "コントローラのわりあて",
    linkTool: adult ? "追加ピン留め(閉ループ)" : "ピンでとめる(からくり)",
  };
}

export const INPUT_LABELS: Record<string, string> = {
  leftStickX: "左スティック ←→",
  leftStickY: "左スティック ↑↓",
  rightStickX: "右スティック ←→",
  rightStickY: "右スティック ↑↓",
  dpadX: "十字キー ←→",
  dpadY: "十字キー ↑↓",
  buttonsAB: "A/Bボタン",
  buttonsXY: "X/Yボタン",
  keysQA: "キーボード Q/A",
  keysWS: "キーボード W/S",
  keysED: "キーボード E/D",
  none: "わりあて無し",
};

export function powerReasonText(reason: string, adult: boolean): string {
  switch (reason) {
    case "empty":
      return "まだパーツがないよ。カタログから選んでね";
    case "no-box":
      return adult
        ? "パワーボックスが未搭載です(搭載しないと書き出せません)"
        : "パワーボックスをのせてね(のせないと おくり出せないよ)";
    case "multi-box":
      return "パワーボックスは1台だけにしてね";
    case "over-capacity":
      return adult
        ? "電力コストが最大ボックス(L)の容量を超えています"
        : "電気を使いすぎ!いちばん大きい箱にも入らないよ。サーボをへらそう";
    case "box-too-small":
      return adult
        ? "パワーボックスの容量が不足しています。グレードを上げてください"
        : "箱が小さすぎるよ。もっと大きいパワーボックスにのせかえよう";
    case "not-connected":
      return adult
        ? "他の部品とピンで接合されていない部品があります(全部品が1つにつながると書き出せます)"
        : "まだピンでつながっていないパーツがあるよ。📌ピンでとめて、ぜんぶ1つにつなげてね";
    default:
      return reason;
  }
}
