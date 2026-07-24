// サンプルロボットのテンプレート(改造スタート用)。
// 実際の接続ルール(穴とピン)だけで組み上げる=手組みと同じデータになる。
// 向きは「子パーツのローカル軸が目標方向を向く angle/side/flip を候補から探索」で決める
// (座標を直接置かないので、カタログ寸法が変わってもテンプレートが壊れにくい)。
import { Matrix4, Quaternion, Vector3 } from "three";
import { computePoses } from "../core/assembly";
import { computeAttachment, findHole, holesOf, solveAttachParams } from "../core/holes";
import { settleLoops } from "../core/linkage";
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
  intent?: "decorative";
  tint?: string;
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

  /** 直近のattachで作られた接続ID(脚モジュールのsettle対象を集めるのに使う) */
  lastConnId = "";

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
    this.model.parts.push({
      id,
      defId,
      material: opts.material ?? "plastic",
      tint: opts.tint,
    });
    this.lastConnId = `c${this.seq}`;
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
      intent: opts.intent,
    };
    this.model.connections.push(conn);
    this.poses.set(id, computeAttachment(parentM, ph, ch, angle, side, flip));
    return id;
  }

  map(servoPartId: string, input: (typeof INPUT_OPTIONS)[number]) {
    this.model.mappings.push({ jointId: servoPartId, input });
  }

  done(): RobotModel {
    // テンプレートの組立計算は部品グリッドに沿った従来座標で行い、完成した島を
    // -90°回して old +Y(進行方向) → ROS +X、old +X(右) → ROS -Y に合わせる。
    const rosYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
    const rosM = new Matrix4().makeRotationFromQuaternion(rosYaw);
    const oldPoses = computePoses(this.model).poses;
    const desiredPoses = new Map<string, Matrix4>();
    for (const [id, pose] of oldPoses) desiredPoses.set(id, rosM.clone().multiply(pose));
    const children = new Set(
      this.model.connections.filter((c) => c.kind === "tree").map((c) => c.childPart)
    );
    for (const part of this.model.parts) {
      if (children.has(part.id) || !part.basePose) continue;
      const p = new Vector3(...part.basePose.posMm).applyQuaternion(rosYaw);
      const [w, x, y, z] = part.basePose.quatWxyz;
      const q = rosYaw.clone().multiply(new Quaternion(x, y, z, w)).normalize();
      part.basePose = { posMm: [p.x, p.y, p.z], quatWxyz: [q.w, q.x, q.y, q.z] };
    }
    // angleDegはworld基準のため、ルート姿勢だけ変えると一部の子が同じ回転にならない。
    // 各接続について回転後の目標姿勢を再現するside/flip/angleを親から順に逆算する。
    for (const connection of this.model.connections) {
      if (connection.kind !== "tree") continue;
      const parentPose = desiredPoses.get(connection.parentPart);
      const childPose = desiredPoses.get(connection.childPart);
      const parent = this.model.parts.find((p) => p.id === connection.parentPart);
      const child = this.model.parts.find((p) => p.id === connection.childPart);
      if (!parentPose || !childPose || !parent || !child) continue;
      const parentHole = findHole(getDef(parent.defId), connection.parentHole);
      const childHole = findHole(getDef(child.defId), connection.childHole);
      if (!parentHole || !childHole) continue;
      const solved = solveAttachParams(parentPose, parentHole, childHole, childPose);
      if (!solved) throw new Error(`template: ROS transform failed at ${connection.id}`);
      connection.angleDeg = Math.round(solved.angleDeg * 100) / 100;
      connection.side = solved.side;
      connection.flip = solved.flip || undefined;
    }
    this.model.nextSeq = this.seq;
    return this.model;
  }

  posOf(id: string): Vector3 {
    return new Vector3().setFromMatrixPosition(this.poses.get(id)!);
  }

  /** パーツのworld行列でローカル点を変換 */
  worldPoint(id: string, localMm: Vec3): Vector3 {
    return new Vector3(...localMm).applyMatrix4(this.poses.get(id)!);
  }

  /** world座標(y,z)に一致する穴を探す(側板のように穴が1平面に並ぶパーツ用) */
  holeAtYZ(partId: string, y: number, z: number): HoleRef {
    const inst = this.model.parts.find((p) => p.id === partId)!;
    const M = this.poses.get(partId)!;
    let nearest: { ref: HoleRef; y: number; z: number; distance: number } | undefined;
    for (const h of holesOf(getDef(inst.defId))) {
      const w = h.posMm.clone().applyMatrix4(M);
      if (Math.abs(w.y - y) < 0.6 && Math.abs(w.z - z) < 0.6) return h.ref;
      const distance = Math.hypot(w.y - y, w.z - z);
      if (!nearest || distance < nearest.distance) nearest = { ref: h.ref, y: w.y, z: w.z, distance };
    }
    throw new Error(
      `template: no hole at yz=(${y},${z}) on ${inst.defId}; nearest=(${nearest?.y},${nearest?.z})`
    );
  }

  /** 追いピン(ループ接続)。テンプレートではsettleで厳密に閉じるので位置チェックはしない */
  pin(aPart: string, aHole: HoleRef, bPart: string, bHole: HoleRef): string {
    const id = `c${this.seq++}`;
    this.model.connections.push({
      id,
      kind: "loop",
      parentPart: aPart,
      parentHole: aHole,
      childPart: bPart,
      childHole: bHole,
      pins: 1,
      angleDeg: 0,
      side: 1,
    });
    return id;
  }

  /** 指定の受動関節角を、指定ループが閉じるように微調整(組立時の仕上げ) */
  settle(varConnIds: string[], loopConnIds: string[]): number {
    const res = settleLoops(this.model, varConnIds, loopConnIds);
    this.model.connections = this.model.connections.map((c) => {
      const a = res.angles.get(c.id);
      return a === undefined ? c : { ...c, angleDeg: Math.round(a * 100) / 100 };
    });
    // 姿勢キャッシュを取り直す
    this.poses = computePoses(this.model).poses;
    return res.maxErrMm;
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
  t.attach(body, gi("FR-P0612", 0, 5, 1), "DC-ANT", g(0, 0), {
    pins: 1,
    intent: "decorative",
  }); // ぶらぶら尻尾
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
    intent: "decorative",
    orient: [{ axisLocal: [1, 0, 0], targetWorld: DOWN }],
    trySide: true,
  });
  t.attach(shoulder, g(0, 11), "FR-B030", g(0, 0), {
    pins: 1,
    intent: "decorative",
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
  t.attach(body, gi("FR-P0612", 0, 3, 22), "DC-ANT", g(0, 0), { pins: 1, intent: "decorative" });
  t.attach(body, gi("FR-P0612", 0, 8, 22), "DC-ANT", g(0, 0), { pins: 1, intent: "decorative" });
  const inputs: (typeof INPUT_OPTIONS)[number][] = [
    "rightStickY", "rightStickX", "buttonsAB", "leftStickY", "leftStickX", "buttonsXY",
  ];
  servos.forEach((s, i) => t.map(s, inputs[i % inputs.length]));
  return t.done();
}

// ---------------------------------------------------------------------------
// テオヤンセン機構 8足(前後に分離した4足モジュール・左右前後モータ各1つ)
// リンク長はホーリーナンバーを5mmグリッドで再設計したもの。
// 全回転ジャムなし・特異マージン7.7mm(原寸の6倍=ソルバが安定)・歩幅51mm・リフト13mm
// を2D掃引の総当たり探索で確認済み:
//   a40 l15 m15 b50 c40 d35 e55 f40 g40 h70 i50 j55 k60
// ---------------------------------------------------------------------------
const JN = { a: 40, l: 15, m: 15, b: 50, c: 40, d: 35, e: 55, f: 40, g: 40, h: 70, i: 50, j: 55, k: 60 };

type P2 = [number, number];

/** 円と円の交点(テンプレートのリンク長は掃引検証済みなので、交点なしは組立バグ) */
function ci(c1: P2, r1: number, c2: P2, r2: number, pick: (p1: P2, p2: P2) => P2): P2 {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  const A = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - A * A;
  if (h2 < 0 || d === 0) throw new Error(`jansen: no circle intersection (d=${d.toFixed(1)})`);
  const h = Math.sqrt(h2);
  const mx = c1[0] + (A * dx) / d;
  const my = c1[1] + (A * dy) / d;
  return pick([mx + (h * dy) / d, my - (h * dx) / d], [mx - (h * dy) / d, my + (h * dx) / d]);
}

/**
 * ヤンセン脚の節点座標(u=進行方向, v=上。クランク軸原点、Qu=クランクピン位置)。
 * 鏡像脚は呼び出し側で u→-u に反転する。
 */
function jansenNodes(Qu: P2): { P: P2; Q: P2; B1: P2; B2: P2; C1: P2; C2: P2; F: P2 } {
  const P: P2 = [-JN.a, -JN.l];
  const up = (p1: P2, p2: P2) => (p1[1] > p2[1] ? p1 : p2);
  const down = (p1: P2, p2: P2) => (p1[1] < p2[1] ? p1 : p2);
  const B1 = ci(P, JN.b, Qu, JN.j, up);
  const leftOfPB1 = (p1: P2, p2: P2) => {
    const s = (p: P2) => (B1[0] - P[0]) * (p[1] - P[1]) - (B1[1] - P[1]) * (p[0] - P[0]);
    return s(p1) > s(p2) ? p1 : p2;
  };
  const B2 = ci(P, JN.d, B1, JN.e, leftOfPB1);
  const C1 = ci(P, JN.c, Qu, JN.k, down);
  const C2 = ci(B2, JN.f, C1, JN.g, down);
  const leftOfC1C2 = (p1: P2, p2: P2) => {
    const s = (p: P2) => (C2[0] - C1[0]) * (p[1] - C1[1]) - (C2[1] - C1[1]) * (p[0] - C1[0]);
    return s(p1) > s(p2) ? p1 : p2;
  };
  const F = ci(C2, JN.h, C1, JN.i, leftOfC1C2);
  return { P, Q: Qu, B1, B2, C1, C2, F };
}

const FINE_ANGLES = Array.from({ length: 180 }, (_, i) => i * 2); // 2°刻み(settleで仕上げる)

/**
 * ヤンセン脚1本を組む。sidePlate上のP穴とクランクピンQから10本のほねを張り、
 * 5箇所の追いピンでループを閉じ、settleで厳密に整える。
 */
function buildJansenLeg(
  t: Tpl,
  sidePlate: string,
  crank: string,
  crankHole: HoleRef,
  axle: { y: number; z: number },
  Qworld: { y: number; z: number },
  my: 1 | -1, // +1=前向き脚 / -1=後向き(鏡像)脚
  sx: 1 | -1, // 体の左右(ほねの重ね方向にだけ使う)
  tint: string
): void {
  const Qu: P2 = [my * (Qworld.y - axle.y), Qworld.z - axle.z];
  const n = jansenNodes(Qu);
  // u空間 → world(y,z)
  const W = (p: P2) => ({ y: axle.y + my * p[0], z: axle.z + p[1] });
  const dir = (from: P2, to: P2): Vec3 => {
    const a = W(from);
    const b = W(to);
    const len = Math.hypot(b.y - a.y, b.z - a.z);
    return [0, (b.y - a.y) / len, (b.z - a.z) / len];
  };
  const Phole = t.holeAtYZ(sidePlate, W(n.P).y, W(n.P).z);

  const vars: string[] = [];
  const bar = (
    parent: string,
    pHole: HoleRef,
    defId: string,
    from: P2,
    to: P2,
    side: 1 | -1
  ): string => {
    const id = t.attach(parent, pHole, defId, g(0, 0), {
      pins: 1,
      side,
      orient: [{ axisLocal: [1, 0, 0], targetWorld: dir(from, to) }],
      angles: FINE_ANGLES,
      tint,
    });
    vars.push(t.lastConnId);
    return id;
  };

  const bJ = bar(crank, crankHole, "FR-B060", n.Q, n.B1, -sx as 1 | -1); // j=55
  const bB = bar(sidePlate, Phole, "FR-B060", n.P, n.B1, sx); // b=50
  const bE = bar(bB, g(0, 10), "FR-B060", n.B1, n.B2, sx); // e=55
  const bD = bar(bE, g(0, 11), "FR-B045", n.B2, n.P, -sx as 1 | -1); // d=35
  const bC = bar(sidePlate, Phole, "FR-B045", n.P, n.C1, sx); // c=40
  const bK = bar(crank, crankHole, "FR-B075", n.Q, n.C1, -sx as 1 | -1); // k=60
  const bG = bar(bC, g(0, 8), "FR-B045", n.C1, n.C2, sx); // g=40
  const bH = bar(bG, g(0, 8), "FR-B075", n.C2, n.F, sx); // h=70
  const bI = bar(bH, g(0, 14), "FR-B060", n.F, n.C1, -sx as 1 | -1); // i=50
  const bF = bar(bD, g(0, 0), "FR-B045", n.B2, n.C2, sx); // f=40

  const loops = [
    t.pin(sidePlate, Phole, bD, g(0, 7)), // 三角B(b,e,d)をPで閉じる
    t.pin(bE, g(0, 0), bJ, g(0, 11)), // B1: jの先端
    t.pin(bC, g(0, 8), bK, g(0, 12)), // C1: kの先端
    t.pin(bC, g(0, 8), bI, g(0, 10)), // C1: 足三角(g,h,i)を閉じる
    t.pin(bG, g(0, 8), bF, g(0, 8)), // C2: fの先端
  ];
  const err = t.settle(vars, loops);
  if (err > 0.5) throw new Error(`jansen leg settle failed: ${err.toFixed(2)}mm`);
}

/** 本体前後から垂直材を下ろし、脚より少し高い位置に補助キャスターを置く。 */
function buildJansenAssistCaster(t: Tpl, body: string, bodyCol: number, forward: 1 | -1): void {
  const top = t.attach(body, gi("FR-P0612", 0, 5, bodyCol), "FR-L030", g(0, 0), {
    orient: [
      { axisLocal: [1, 0, 0], targetWorld: [0, forward, 0], weight: 2 },
      { axisLocal: [0, 1, 0], targetWorld: [1, 0, 0] },
    ],
  });
  const drop = t.attach(top, g(1, 4), "FR-B090", g(0, 0), {
    orient: [{ axisLocal: [1, 0, 0], targetWorld: DOWN, weight: 2 }],
    angles: [0, 90, 180, 270],
    trySide: true,
  });
  // 端から2穴内側(75mm落差)を使い、球底を脚の最下点と約1mm以内にそろえる。
  const bottom = t.attach(drop, g(0, 15), "FR-L030", g(1, 4), {
    orient: [
      { axisLocal: [0, 0, -1], targetWorld: DOWN, weight: 2 },
      { axisLocal: [1, 0, 0], targetWorld: [0, forward, 0] },
    ],
    angles: [0, 90, 180, 270],
    trySide: true,
  });
  t.attach(bottom, g(0, 2), "WH-CAST", g(0, 0), {
    orient: [{ axisLocal: [0, 0, -1], targetWorld: DOWN, weight: 2 }],
    trySide: true,
  });
}

function buildStrandbeest(): RobotModel {
  const t = new Tpl("ヤンセンの4ほんあし＋補助輪");
  const body = t.free("FR-P0612", [0, 0, 1.5]);
  // 左右のダブルクランクに180°差の前後脚を1本ずつ取り付ける。
  const modules = [{ bodyCol: 11, theta: 0 }];
  const legColors = ["#4aa3df", "#f28e2b", "#59a14f", "#e15759"];
  const servos: string[] = [];
  for (const [moduleIndex, module] of modules.entries()) {
    for (const sx of [1, -1] as const) {
      // 本体からL字アングルを外へ伸ばし、その立ち上がり面で側板を支える。
      // 駆動穴へ直接つながるのは後述のcrankだけで、この支持経路はサーボ本体側に固定される。
      const outrigger = t.attach(
        body,
        gi("FR-P0612", 0, sx === 1 ? 11 : 0, module.bodyCol),
        "FR-L030",
        g(0, 0),
        {
          pins: 2,
          orient: [
            { axisLocal: [1, 0, 0], targetWorld: [sx, 0, 0], weight: 2 },
            { axisLocal: [0, 1, 0], targetWorld: [0, 1, 0] },
          ],
        }
      );
      // 90°位相側は足軌跡の最下点が約4mm低いため、5mmグリッド1段ぶん
      // 側板を持ち上げる。柔らかい実機の脚と違い剛体シミュレータでも、
      // 前後の足先がほぼ同じ床面に載るようにする補正。
      const sidePlate = t.attach(
        outrigger,
        g(1, 4),
        "FR-P0612",
        gi("FR-P0612", 0, moduleIndex === 0 ? 0 : 1, 11),
        {
          orient: [
            { axisLocal: [0, 0, 1], targetWorld: [sx, 0, 0], weight: 2 },
            { axisLocal: [1, 0, 0], targetWorld: [0, 0, -1] },
          ],
          trySide: true,
        }
      );
      const servo = t.attach(sidePlate, gi("FR-P0612", 0, 2, 11), "SV-WHEEL", sx === 1 ? g(0, 0) : g(0, 1), {
        orient: [
          { axisLocal: [0, 0, 1], targetWorld: [sx, 0, 0], weight: 2 },
          { axisLocal: [1, 0, 0], targetWorld: [0, 1, 0] },
        ],
        trySide: true,
      });
      servos.push(servo);
      const drivePoint = t.worldPoint(servo, [0, 0, 13]);
      const axle = { y: drivePoint.y, z: drivePoint.z };
      const thetaRad = (module.theta * Math.PI) / 180;
      const crank = t.attach(servo, { special: "drive" }, "FR-B075", g(0, 7), {
        pins: 2,
        orient: [{ axisLocal: [1, 0, 0], targetWorld: [0, Math.cos(thetaRad), Math.sin(thetaRad)] }],
        angles: FINE_ANGLES,
      });
      const pins: { Q: Vector3; hole: HoleRef }[] = [
        { Q: t.worldPoint(crank, [15, 0, 0]), hole: g(0, 10) },
        { Q: t.worldPoint(crank, [-15, 0, 0]), hole: g(0, 4) },
      ];
      const colorBase = moduleIndex * 4 + (sx === 1 ? 0 : 2);
      buildJansenLeg(
        t, sidePlate, crank, pins[0].hole, axle, { y: pins[0].Q.y, z: pins[0].Q.z },
        1, sx, legColors[colorBase]
      );
      buildJansenLeg(
        t, sidePlate, crank, pins[1].hole, axle, { y: pins[1].Q.y, z: pins[1].Q.z },
        -1, sx, legColors[colorBase + 1]
      );
    }
  }

  buildJansenAssistCaster(t, body, 1, -1);
  buildJansenAssistCaster(t, body, 22, 1);

  // パワーボックスS(コスト2)としょっかく
  t.attach(body, gi("FR-P0612", 0, 5, 11), "PB-S", g(0, 2), {});
  t.attach(body, gi("FR-P0612", 0, 3, 22), "DC-ANT", g(0, 0), { pins: 1, intent: "decorative" });
  t.attach(body, gi("FR-P0612", 0, 8, 22), "DC-ANT", g(0, 0), { pins: 1, intent: "decorative" });
  servos.forEach((servo, i) => t.map(servo, i % 2 === 0 ? "rightStickY" : "leftStickY"));
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
  {
    id: "strandbeest",
    emoji: "🦕",
    name: "ヤンセンの4ほんあし＋補助輪",
    desc: "おすすめ軽量版。2モータ・4足を前後キャスターで支え、組みやすさと安定性を両立",
    build: buildStrandbeest,
  },
];

export function buildTemplate(id: string): RobotModel {
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (!tpl) throw new Error(`unknown template: ${id}`);
  return tpl.build();
}
