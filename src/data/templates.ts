// サンプルロボットのテンプレート(改造スタート用)。
// 実際の接続ルール(穴とピン)だけで組み上げる=手組みと同じデータになる。
// 向きは「子パーツのローカル軸が目標方向を向く angle/side/flip を候補から探索」で決める
// (座標を直接置かないので、カタログ寸法が変わってもテンプレートが壊れにくい)。
import { Matrix4, Quaternion, Vector3 } from "three";
import { computeAttachment, findHole } from "../core/holes";
import type { Connection, HoleRef, Material, RobotModel, Vec3 } from "../core/types";
import { emptyModel, INPUT_OPTIONS } from "../core/types";
import { getDef } from "./catalog";

const g = (group: number, index: number): HoleRef => ({ group, index });
const drive = (): HoleRef => ({ special: "drive" });

/** グリッド穴のindexを行列位置(i=行=uAxis方向, j=列)から求める */
function gi(defId: string, group: number, i: number, j = 0): HoleRef {
  const hg = getDef(defId).holes![group];
  return { group, index: i * hg.cols + j };
}

interface OrientGoal {
  /** 子パーツのこのローカル軸が… */
  axisLocal: Vec3;
  /** …このworld方向を向くように */
  targetWorld: Vec3;
  weight?: number;
}

interface AttachOpts {
  pins?: number;
  side?: 1 | -1;
  angleDeg?: number;
  flip?: boolean;
  material?: Material;
  /** 向き探索(angleDeg指定時は使わない) */
  orient?: OrientGoal[];
  angles?: number[]; // 探索候補(既定 0/90/180/270)
  trySide?: boolean;
  tryFlip?: boolean;
}

class Tpl {
  model: RobotModel;
  poses = new Map<string, Matrix4>();
  private seq = 1;

  constructor(name: string) {
    this.model = { ...emptyModel(), name };
  }

  free(defId: string, posMm: Vec3, material: Material = "plastic"): string {
    const id = `p${this.seq++}`;
    this.model.parts.push({
      id,
      defId,
      material,
      basePose: { posMm, quatWxyz: [1, 0, 0, 0] },
    });
    this.poses.set(id, new Matrix4().makeTranslation(...posMm));
    return id;
  }

  attach(parentId: string, parentHole: HoleRef, defId: string, childHole: HoleRef, opts: AttachOpts = {}): string {
    const parentInst = this.model.parts.find((p) => p.id === parentId)!;
    const ph = findHole(getDef(parentInst.defId), parentHole);
    const ch = findHole(getDef(defId), childHole);
    if (!ph || !ch) throw new Error(`template: hole not found ${parentInst.defId}/${defId}`);
    const parentM = this.poses.get(parentId)!;

    let side: 1 | -1 = opts.side ?? 1;
    let flip = opts.flip ?? false;
    let angle = opts.angleDeg ?? 0;

    if (opts.orient) {
      const angles = opts.angles ?? [0, 90, 180, 270];
      const sides: (1 | -1)[] = opts.trySide ? [1, -1] : [side];
      const flips = opts.tryFlip ? [false, true] : [flip];
      let best = -Infinity;
      for (const s of sides) {
        for (const f of flips) {
          for (const a of angles) {
            const M = computeAttachment(parentM, ph, ch, a, s, f);
            const q = new Quaternion().setFromRotationMatrix(M);
            let score = 0;
            for (const goal of opts.orient) {
              const v = new Vector3(...goal.axisLocal).normalize().applyQuaternion(q);
              score += (goal.weight ?? 1) * v.dot(new Vector3(...goal.targetWorld).normalize());
            }
            if (score > best) {
              best = score;
              side = s;
              flip = f;
              angle = a;
            }
          }
        }
      }
    }

    const id = `p${this.seq++}`;
    this.model.parts.push({ id, defId, material: opts.material ?? "plastic" });
    const conn: Connection = {
      id: `c${this.seq++}`,
      kind: "tree",
      parentPart: parentId,
      parentHole,
      childPart: id,
      childHole,
      pins: opts.pins ?? 2,
      angleDeg: angle,
      side,
      flip,
    };
    this.model.connections.push(conn);
    this.poses.set(id, computeAttachment(parentM, ph, ch, angle, side, flip));
    return id;
  }

  map(servoPartId: string, input: (typeof INPUT_OPTIONS)[number]) {
    this.model.mappings.push({ jointId: servoPartId, input });
  }

  done(): RobotModel {
    this.model.nextSeq = this.seq;
    return this.model;
  }

  posOf(id: string): Vector3 {
    return new Vector3().setFromMatrixPosition(this.poses.get(id)!);
  }
}

const DOWN: Vec3 = [0, 0, -1];
const UP: Vec3 = [0, 0, 1];

// ---------------------------------------------------------------------------
// 脚モジュール(犬型・2足で共用):
// 股サーボ(背面マウントで直付け・軸±X) → ほね(短)↓ → ひざサーボ →
// ほね(短)↓ → まがりほね(足首) → あしうら
// ---------------------------------------------------------------------------
function buildLeg(
  t: Tpl,
  bodyId: string,
  bracketHole: HoleRef,
  sx: 1 | -1, // 右脚=+1(外向き+X) / 左脚=-1
  bodyDir: 1 | -1 = 1 // サーボ本体を寝かせる向き
): { hip: string; knee: string } {
  // 股サーボ:背面マウントで胴体に直付け。シャフト外向き(±X)。
  // 左右で取付穴を鏡像に選ぶと、回転だけでも軸線が左右そろう
  const hip = t.attach(bodyId, bracketHole, "SV-MICRO", sx === 1 ? g(1, 3) : g(1, 5), {
    orient: [
      { axisLocal: [0, 0, 1], targetWorld: [sx, 0, 0], weight: 2 }, // シャフト外向き
      { axisLocal: [-1, 0, 0], targetWorld: [0, bodyDir, 0] },
    ],
    angles: [0, 90, 180, 270],
  });
  // もも:ホーンの十字穴に2ピン固定、下向き
  const thigh = t.attach(hip, g(2, 0), "FR-B030", g(0, 0), {
    orient: [{ axisLocal: [1, 0, 0], targetWorld: DOWN }],
    angles: [0, 45, 90, 135, 180, 225, 270, 315],
  });
  // ひざサーボ:底面マウントをももの面に取付(シャフトは自動で±X)、ホーンは外側、
  // 本体は下向き=ひざ軸がももの下端より下に来る(すねが正しくももの続きになる)
  const knee = t.attach(thigh, g(0, 4), "SV-MICRO", sx === 1 ? g(0, 0) : g(0, 1), {
    orient: [
      { axisLocal: [0, 0, 1], targetWorld: [sx, 0, 0], weight: 2 },
      { axisLocal: [1, 0, 0], targetWorld: DOWN },
    ],
    trySide: true,
  });
  // すね:ひざホーンから下向き
  const shin = t.attach(knee, g(2, 0), "FR-B030", g(0, 0), {
    orient: [{ axisLocal: [1, 0, 0], targetWorld: DOWN }],
    angles: [0, 45, 90, 135, 180, 225, 270, 315],
  });
  // 足首:まがりほね(水平面が下端・つま先は内側へ=足が体の下に入る)
  const ankle = t.attach(shin, g(0, 5), "FR-L030", g(1, 0), {
    orient: [
      { axisLocal: [0, 0, -1], targetWorld: DOWN, weight: 2 }, // 水平面のうら=下
      { axisLocal: [-1, 0, 0], targetWorld: [-sx, 0, 0] }, // 面はからだの内側へ
    ],
    trySide: true,
  });
  // あしうら(長辺を前後に)
  t.attach(ankle, g(0, 2), "WH-FOOT", gi("WH-FOOT", 0, 2, 3), {
    orient: [{ axisLocal: [0, 1, 0], targetWorld: [0, 1, 0] }],
    trySide: true,
  });
  return { hip, knee };
}

// ---------------------------------------------------------------------------
// 2輪車(チュートリアルと同じ構成の完成形)
// ---------------------------------------------------------------------------
function buildWheeler(): RobotModel {
  const t = new Tpl("にりんしゃ");
  const plate = t.free("FR-P0606", [0, 0, 1.5]);

  for (const sx of [1, -1] as const) {
    // 車輪サーボは背面マウントで、いたのふちに直付け(金具いらず)
    const servo = t.attach(plate, gi("FR-P0606", 0, sx === 1 ? 11 : 0, 8), "SV-WHEEL", sx === 1 ? g(1, 3) : g(1, 5), {
      orient: [
        { axisLocal: [0, 0, 1], targetWorld: [sx, 0, 0], weight: 2 }, // シャフト外向き
        { axisLocal: [-1, 0, 0], targetWorld: [0, -1, 0] }, // 本体はうしろ向きに寝かせる
      ],
    });
    t.attach(servo, drive(), "WH-065", g(0, 0), {});
    t.map(servo, sx === 1 ? "rightStickY" : "leftStickY");
  }

  // うしろのキャスター(全高20mm=タイヤ(大)の接地とほぼ一致)
  t.attach(plate, gi("FR-P0606", 0, 5, 1), "WH-CAST", g(0, 0), { side: -1 });

  // パワーボックスSはキャスター寄り(重心をタイヤとキャスターの間に)
  t.attach(plate, gi("FR-P0606", 0, 5, 2), "PB-S", g(0, 3), {});
  // ドームあたま
  t.attach(plate, gi("FR-P0606", 0, 5, 8), "DC-DOME", g(0, 0), {});
  return t.done();
}

// ---------------------------------------------------------------------------
// 犬型4足(股+ひざ=8サーボ。パワーボックスSちょうど容量8)
// ---------------------------------------------------------------------------
function buildDog(): RobotModel {
  const t = new Tpl("いぬがた4そく");
  const body = t.free("FR-P0612", [0, 0, 1.5]);
  const servos: string[] = [];
  for (const sx of [1, -1] as const) {
    // うしろ脚は後ろへ、まえ脚は前へ寝かせて、四隅に足が来るように
    for (const [j, bodyDir] of [
      [4, -1],
      [19, 1],
    ] as const) {
      const { hip, knee } = buildLeg(t, body, gi("FR-P0612", 0, sx === 1 ? 11 : 0, j), sx, bodyDir);
      servos.push(hip, knee);
    }
  }
  // パワーボックスS(胴体中央)
  t.attach(body, gi("FR-P0612", 0, 5, 11), "PB-S", g(0, 2), {});
  // あたまとしっぽ
  t.attach(body, gi("FR-P0612", 0, 5, 22), "DC-DOME", g(0, 0), {});
  t.attach(body, gi("FR-P0612", 0, 5, 1), "DC-ANT", g(0, 0), { pins: 1 }); // ぶらぶら尻尾
  servos.forEach((s, i) => t.map(s, INPUT_OPTIONS[i % (INPUT_OPTIONS.length - 1)]));
  return t.done();
}

// ---------------------------------------------------------------------------
// 人型2足(股+ひざ×2脚、ぶらぶらの腕、せぼね+め)
// ---------------------------------------------------------------------------
function buildBiped(): RobotModel {
  const t = new Tpl("ひとがた2そく");
  const hipPlate = t.free("FR-P0306", [0, 0, 1.5]);
  const servos: string[] = [];
  for (const sx of [1, -1] as const) {
    const { hip, knee } = buildLeg(t, hipPlate, gi("FR-P0306", 0, sx === 1 ? 5 : 0, 5), sx, 1);
    servos.push(hip, knee);
  }
  // パワーボックスS:腹の下に吊り下げ(上面穴で腰プレートの裏に固定)。
  // サーボと重ならず、重心も低くなる=倒れにくいお手本
  t.attach(hipPlate, gi("FR-P0306", 0, 3, 6), "PB-S", g(1, 2), {
    side: -1,
    orient: [{ axisLocal: [1, 0, 0], targetWorld: [0, 1, 0] }], // 長辺をY向きに
  });
  // せぼね:うしろに壁が向く金具 → たてのほね(中)
  const spineBase = t.attach(hipPlate, gi("FR-P0306", 0, 2, 1), "JT-BRmic", g(0, 0), {
    orient: [{ axisLocal: [1, 0, 0], targetWorld: [0, -1, 0] }],
  });
  const spine = t.attach(spineBase, g(1, 0), "FR-B060", g(0, 0), {
    orient: [{ axisLocal: [1, 0, 0], targetWorld: UP }],
    trySide: true,
  });
  // かた:よこのほね(中)を2ピン固定
  const shoulder = t.attach(spine, g(0, 10), "FR-B060", g(0, 5), {
    orient: [{ axisLocal: [1, 0, 0], targetWorld: [1, 0, 0] }],
    trySide: true,
  });
  // うで:1ピンでぶらぶら(受動関節のデモ)
  t.attach(shoulder, g(0, 0), "FR-B030", g(0, 0), {
    pins: 1,
    orient: [{ axisLocal: [1, 0, 0], targetWorld: DOWN }],
    trySide: true,
  });
  t.attach(shoulder, g(0, 11), "FR-B030", g(0, 0), {
    pins: 1,
    orient: [{ axisLocal: [1, 0, 0], targetWorld: DOWN }],
    trySide: true,
  });
  // あたま:せぼねの上に金具で水平面を作り、前の穴に「め」、うしろの穴にドーム
  const headBase = t.attach(spine, g(0, 11), "JT-BRmic", g(1, 0), {
    orient: [
      { axisLocal: [0, 0, -1], targetWorld: DOWN, weight: 2 },
      { axisLocal: [-1, 0, 0], targetWorld: [0, 1, 0] },
    ],
    trySide: true,
  });
  t.attach(headBase, g(0, 1), "DC-DOME", g(0, 0), { trySide: true, orient: [{ axisLocal: [0, 0, 1], targetWorld: UP }] });
  t.attach(headBase, g(0, 0), "DC-EYE", g(0, 0), {
    orient: [
      { axisLocal: [0, 0, 1], targetWorld: UP, weight: 2 },
      { axisLocal: [0, 1, 0], targetWorld: [0, 1, 0] },
    ],
    trySide: true,
  });

  const inputs: (typeof INPUT_OPTIONS)[number][] = ["rightStickY", "rightStickX", "leftStickY", "leftStickX"];
  servos.forEach((s, i) => t.map(s, inputs[i % inputs.length]));
  return t.done();
}

// ---------------------------------------------------------------------------
// 6足(1サーボ/脚 ×6。前後の脚は45°開き、ボールの足先)
// ---------------------------------------------------------------------------
function buildHexapod(): RobotModel {
  const t = new Tpl("むしがた6そく");
  const body = t.free("FR-P0612", [0, 0, 1.5]);
  const servos: string[] = [];
  const legDefs: { j: number; dir: Vec3; lHole: number }[] = [
    { j: 4, dir: [0, -Math.SQRT1_2, -Math.SQRT1_2], lHole: 10 }, // うしろ:45°後ろ下
    { j: 11, dir: [0, 0, -1], lHole: 7 }, // まんなか:まっすぐ下(短め=接地高さ合わせ)
    { j: 19, dir: [0, Math.SQRT1_2, -Math.SQRT1_2], lHole: 10 }, // まえ:45°前下
  ];
  for (const sx of [1, -1] as const) {
    for (const { j, dir, lHole } of legDefs) {
      // 股サーボを胴体に直付け(背面マウント)
      const servo = t.attach(body, gi("FR-P0612", 0, sx === 1 ? 11 : 0, j), "SV-MICRO", sx === 1 ? g(1, 3) : g(1, 5), {
        orient: [
          { axisLocal: [0, 0, 1], targetWorld: [sx, 0, 0], weight: 2 },
          { axisLocal: [-1, 0, 0], targetWorld: [0, 1, 0] },
        ],
      });
      servos.push(servo);
      const leg = t.attach(servo, g(2, 0), "FR-B060", g(0, 0), {
        orient: [{ axisLocal: [1, 0, 0], targetWorld: dir }],
        angles: [0, 45, 90, 135, 180, 225, 270, 315],
      });
      const ankle = t.attach(leg, g(0, lHole), "FR-L030", g(1, 0), {
        orient: [{ axisLocal: [0, 0, -1], targetWorld: DOWN, weight: 2 }],
        angles: [0, 45, 90, 135, 180, 225, 270, 315],
        trySide: true,
      });
      t.attach(ankle, g(0, 2), "WH-CAST", g(0, 0), {
        orient: [{ axisLocal: [0, 0, -1], targetWorld: DOWN, weight: 2 }],
        trySide: true,
      });
    }
  }
  // パワーボックスS(胴体中央)+ しょっかく
  t.attach(body, gi("FR-P0612", 0, 5, 11), "PB-S", g(0, 2), {});
  t.attach(body, gi("FR-P0612", 0, 3, 22), "DC-ANT", g(0, 0), { pins: 1 });
  t.attach(body, gi("FR-P0612", 0, 8, 22), "DC-ANT", g(0, 0), { pins: 1 });
  const inputs: (typeof INPUT_OPTIONS)[number][] = [
    "rightStickY", "rightStickX", "buttonsAB", "leftStickY", "leftStickX", "buttonsXY",
  ];
  servos.forEach((s, i) => t.map(s, inputs[i % inputs.length]));
  return t.done();
}

export interface TemplateInfo {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  build: () => RobotModel;
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: "wheeler",
    emoji: "🚗",
    name: "にりんしゃ",
    desc: "車輪サーボ×2+キャスター。まずはこれで走らせよう(電力2/S箱)",
    build: buildWheeler,
  },
  {
    id: "dog",
    emoji: "🐕",
    name: "いぬがた4そく",
    desc: "股+ひざで8サーボ。S箱ぎりぎり容量8!歩かせられるか?",
    build: buildDog,
  },
  {
    id: "biped",
    emoji: "🤖",
    name: "ひとがた2そく",
    desc: "2脚4サーボ+ぶらぶらの腕。転ばせないのはかなり難しいぞ",
    build: buildBiped,
  },
  {
    id: "hexapod",
    emoji: "🐜",
    name: "むしがた6そく",
    desc: "1サーボ×6脚+ボールの足先。安定感ばつぐん",
    build: buildHexapod,
  },
];

export function buildTemplate(id: string): RobotModel {
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (!tpl) throw new Error(`unknown template: ${id}`);
  return tpl.build();
}
