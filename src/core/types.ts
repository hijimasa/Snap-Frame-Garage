// Snap Frame Garage — コア型定義
// 内部表現(独自ロボット記述モデル)を正とする(企画書§5.1)。
// 単位:長さ mm / 質量 g / 角度 deg(エクスポート時に m・kg・rad へ変換)
// 座標系:ROS REP-103準拠(+X=正面、+Y=左、+Z=上、床=XY平面)。
// URDF/MJCFと同一で変換不要。

export type Vec3 = [number, number, number];

export type Material = "plastic" | "aluminum";

/** 形状プリミティブ(表示・衝突・慣性計算の共通ソース) */
export interface GeomBox {
  type: "box";
  sizeMm: Vec3;
  posMm?: Vec3;
  color?: string;
}
export interface GeomCylinder {
  type: "cylinder";
  radiusMm: number;
  heightMm: number; // 軸はローカルZ
  posMm?: Vec3;
  axis?: Vec3; // 省略時 [0,0,1]
  color?: string;
}
export interface GeomSphere {
  type: "sphere";
  radiusMm: number;
  posMm?: Vec3;
  color?: string;
}
/** 直角二等辺三角の板(からくり用)。直角の頂点が原点、脚は+X/+Y方向 */
export interface GeomTriPrism {
  type: "triprism";
  sideMm: number;
  thickMm: number; // 厚みはZ
  posMm?: Vec3;
  color?: string;
}
export type Geom = GeomBox | GeomCylinder | GeomSphere | GeomTriPrism;

/**
 * 穴グループ:5mmピッチのグリッド穴(別紙2§2.1)。
 * 穴位置はパーツの中心面で定義し、thicknessMm = その面の板厚(表面オフセット計算に使用)。
 * body: この穴がどの剛体に属すか(サーボのみ horn を持つ)
 */
export interface HoleGroup {
  originMm: Vec3; // グリッド原点(中心面上)
  normal: Vec3; // 穴の軸(単位ベクトル)
  uAxis: Vec3; // グリッドの行方向(単位ベクトル)
  pitchMm: number;
  rows: number; // uAxis方向の数
  cols: number; // vAxis(normal×uAxis)方向の数
  thicknessMm: number;
  body?: "main" | "horn";
  maskTriangle?: boolean; // u+v がグリッド範囲の対角線内のみ有効(さんかくいた)
  ring?: { radiusMm: number; count: number }; // リング配置(サーボホーン周囲穴)。rows/cols無視
}

/** 特別穴(別紙2§2.2):駆動穴とアイドラー穴 */
export interface SpecialHole {
  kind: "drive" | "idler";
  posMm: Vec3;
  normal: Vec3;
  thicknessMm: number;
}

export interface ServoSpec {
  torqueKgCm: number;
  speedSecPer60Deg: number;
  rangeDeg: number; // ±range
  continuous?: boolean; // 車輪用(連続回転)
}

export interface PartDef {
  id: string;
  category:
    | "actuator"
    | "sensor"
    | "frame"
    | "bracket"
    | "wheel"
    | "hand"
    | "weight"
    | "decor"
    | "powerbox";
  displayName: { kids: string; adult: string };
  refRealPart?: string;
  materialOptions?: Material[];
  /** 数値なら固定質量、オブジェクトなら材質別 */
  massG: number | { plastic: number; aluminum: number };
  powerCost: number;
  geoms: Geom[];
  /** ホーン(回転側)の表示ジオメトリ(サーボのみ) */
  hornGeoms?: Geom[];
  holes?: HoleGroup[];
  specialHoles?: SpecialHole[];
  servo?: ServoSpec;
  /** 接地パーツ種別(支持多角形の基準点。別紙2§3.4) */
  contact?: "wheel" | "caster" | "foot";
  /** パワーボックスのみ:収容できる電力コスト */
  powerCapacity?: number;
  sensorRole?: "imu" | "distance" | "camera";
  description?: string;
}

/** 穴の一意参照:グループ番号 + グリッド内index(特別穴は "drive"/"idler") */
export type HoleRef =
  | { group: number; index: number }
  | { special: "drive" | "idler" };

/** 配置済みパーツ */
export interface PartInstance {
  id: string; // "p1", "p2", ...
  defId: string;
  material: Material;
  /** 機構のリンク群を見分けるための任意表示色 */
  tint?: string;
  /**
   * 島(どのtree接続の子でもないパーツ)の基準姿勢。
   * 自由配置(仮置き)を許すための土台。省略時は原点・無回転。
   */
  basePose?: { posMm: Vec3; quatWxyz: [number, number, number, number] };
}

/**
 * 接続レコード(別紙2§5)。
 * tree接続:childはparentの穴に取り付く(姿勢は接続パラメータから導出)
 * loop接続:既存パーツ同士の追い留め(閉ループ=からくり)。姿勢には影響しない
 */
export interface Connection {
  id: string;
  kind: "tree" | "loop";
  parentPart: string;
  parentHole: HoleRef;
  childPart: string;
  childHole: HoleRef;
  /** ピン本数:1=回る(受動関節)、2+=固定。駆動穴接続では無視(常に能動関節) */
  pins: number;
  /** tree接続のみ:穴軸まわりの回転(90°刻み。島結合の再ルート時は任意角) */
  angleDeg: number;
  /** tree接続のみ:親穴のどちらの面に付くか(+1=法線側 / -1=裏側) */
  side: 1 | -1;
  /**
   * tree接続のみ:子穴の法線を取付方向と「同じ向き」に合わせる(通常は逆向き)。
   * 島の再ルート(接続の親子反転)を厳密に表現するために必要。UIからは直接触らない。
   */
  flip?: boolean;
  /** テンプレートなどで意図的に揺らす尻尾・腕・触角 */
  intent?: "decorative";
}

export interface ControlMapping {
  jointId: string; // 能動関節ID(= サーボインスタンスID)
  input: string; // "leftStickY" 等
  invert?: boolean;
}

export interface RobotModel {
  version: number;
  name: string;
  author: string;
  parts: PartInstance[];
  connections: Connection[];
  mappings: ControlMapping[];
  nextSeq: number;
}

/** 操縦入力の選択肢(manifestの操作マッピングに使う) */
export const INPUT_OPTIONS = [
  "leftStickX",
  "leftStickY",
  "rightStickX",
  "rightStickY",
  "dpadX",
  "dpadY",
  "buttonsAB",
  "buttonsXY",
  "keysQA",
  "keysWS",
  "keysED",
  "none",
] as const;

export const emptyModel = (): RobotModel => ({
  version: 1,
  name: "マイロボット",
  author: "",
  parts: [],
  connections: [],
  mappings: [],
  nextSeq: 1,
});

export function partMass(def: PartDef, material: Material): number {
  return typeof def.massG === "number"
    ? def.massG
    : def.massG[material] ?? def.massG.plastic;
}
