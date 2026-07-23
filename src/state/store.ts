// アプリ状態(zustand)。モデル変更は必ずcommit経由でアンドゥ履歴に積む。
// (例外:ドラッグ中の一時移動はcommitせず、離した時に1回だけ積む)
import { Quaternion, Vector3 } from "three";
import { create } from "zustand";
import { getDef } from "../data/catalog";
import {
  defaultAttachHole,
  findHole,
  floorPlacementQuaternion,
  holesOf,
  holeKey,
  mountingFacesOf,
} from "../core/holes";
import { islandRootOf, subtreeParts } from "../core/assembly";
import * as edit from "../core/edit";
import { solveRestLinkage } from "../core/linkage";
import { defBBoxCorners } from "../core/stability";
import type { Connection, HoleRef, Material, RobotModel } from "../core/types";
import { emptyModel } from "../core/types";
import { deserializeProject, serializeProject } from "../core/export/robopkg";
import { buildTemplate } from "../data/templates";

export { INPUT_OPTIONS } from "../core/types";
import { INPUT_OPTIONS } from "../core/types";

export function parseHoleKey(key: string): HoleRef {
  if (key.startsWith("s:")) return { special: key.slice(2) as "drive" | "idler" };
  const [, g, i] = key.split(":");
  return { group: Number(g), index: Number(i) };
}

const AUTOSAVE_KEY = "sfg-autosave";

interface Store {
  model: RobotModel;
  past: RobotModel[];
  future: RobotModel[];
  selection: string | null;
  pendingDefId: string | null; // 取付待ちのカタログパーツ
  pendingMountFace: number; // 配置前に選んだ取付面
  pendingAngleDeg: number; // 配置前の取付面まわりの向き
  linkFirstHole: { partId: string; holeKey: string; side: 1 | -1 } | null; // ピン留めの1点目
  linkMode: boolean;
  poseAngles: Record<string, number>;
  /** ドラッグ開始時のモデル(1回のドラッグを1つのアンドゥ単位にする) */
  dragStartModel: RobotModel | null;
  adultMode: boolean;
  tutorialOpen: boolean;
  exportOpen: boolean;
  toast: { message: string; undoable: boolean } | null;

  commit: (m: RobotModel) => void;
  undo: () => void;
  redo: () => void;
  setSelection: (id: string | null) => void;
  setPendingDef: (id: string | null) => void;
  cyclePendingMountFace: () => void;
  rotatePending: (deltaDeg: number) => void;
  setLinkMode: (on: boolean) => void;
  setLinkFirstHole: (h: { partId: string; holeKey: string; side: 1 | -1 } | null) => void;
  placeFreePart: (defId: string, xMm: number, yMm: number, floorZMm: number) => void;
  attachPart: (parentPartId: string, parentHoleKey: string, side: 1 | -1) => void;
  /** ピン留めツールの2点目:同じ島なら追いピン(loop)、別の島なら島ごと吸着して結合 */
  pinHoles: (
    a: { partId: string; holeKey: string; side: 1 | -1 },
    b: { partId: string; holeKey: string },
    coincident: boolean
  ) => boolean;
  moveFreePart: (partId: string, xMm: number, yMm: number, save: boolean) => void;
  /** グリッド吸着なしの正確な位置指定(ドラッグ中の穴スナップ用) */
  setFreePartPos: (partId: string, posMm: [number, number, number], save: boolean) => void;
  rotateFreePart: (partId: string, axis: "x" | "y" | "z", deltaDeg: number) => void;
  liftFreePart: (partId: string, deltaZMm: number) => void;
  /** 受動関節(ピン1本のtree接続)のねじり角を直接変更(掴んで回す用) */
  rotateConnAngle: (connId: string, angleDeg: number, save: boolean) => void;
  /**
   * 連動つき回転:同じ機構内にループピン(からくり)があれば、
   * 他の受動関節も拘束を保つように連動して動く。可動限界では動かない。
   */
  rotateConnAngleLinked: (connId: string, angleDeg: number, save: boolean) => void;
  detachPart: (partId: string) => void;
  rotateChild: (childPartId: string, deltaDeg: number) => void;
  flipChild: (childPartId: string) => void;
  /** 同じ面のまま180°ひっくり返す(3DCADの合致反転に相当。接続のflipを切替) */
  flipChildOver: (childPartId: string) => void;
  cycleChildHole: (childPartId: string) => void;
  setPins: (connId: string, pins: number) => void;
  deletePart: (partId: string) => void;
  deleteConnection: (connId: string) => void;
  setMaterial: (partId: string, m: Material) => void;
  setName: (name: string) => void;
  setAuthor: (name: string) => void;
  setMapping: (jointId: string, input: string, invert?: boolean) => void;
  setPoseAngle: (jointId: string, deg: number) => void;
  resetPose: () => void;
  setAdultMode: (v: boolean) => void;
  setTutorialOpen: (v: boolean) => void;
  setExportOpen: (v: boolean) => void;
  showToast: (msg: string, undoable?: boolean) => void;
  clearToast: () => void;
  newProject: () => void;
  loadTemplate: (id: string) => void;
  loadProjectJson: (json: string) => void;
  saveProjectJson: () => string;
}

function loadAutosave(): RobotModel {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return deserializeProject(raw);
  } catch {
    /* こわれた保存データは無視して新規開始 */
  }
  return emptyModel();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<Store>((set, get) => ({
  model: loadAutosave(),
  past: [],
  future: [],
  selection: null,
  pendingDefId: null,
  pendingMountFace: 0,
  pendingAngleDeg: 0,
  linkFirstHole: null,
  linkMode: false,
  poseAngles: {},
  dragStartModel: null,
  adultMode: false,
  tutorialOpen: false,
  exportOpen: false,
  toast: null,

  commit(m) {
    const { model, past } = get();
    set({ model: m, past: [...past.slice(-99), model], future: [] });
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(m));
    } catch {
      /* ストレージ不可でも組立は続行(ローカルファースト) */
    }
  },
  undo() {
    const { past, model, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      model: prev,
      past: past.slice(0, -1),
      future: [model, ...future],
      selection: null,
      toast: null,
    });
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(prev));
    } catch {
      /* ローカルファースト */
    }
  },
  redo() {
    const { past, model, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      model: next,
      past: [...past, model],
      future: future.slice(1),
      selection: null,
      toast: null,
    });
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(next));
    } catch {
      /* ローカルファースト */
    }
  },
  setSelection: (id) => set({ selection: id, pendingDefId: null }),
  setPendingDef: (id) =>
    set({
      pendingDefId: id,
      pendingMountFace: 0,
      pendingAngleDeg: 0,
      selection: null,
      linkMode: false,
      linkFirstHole: null,
    }),
  cyclePendingMountFace() {
    const { pendingDefId, pendingMountFace } = get();
    if (!pendingDefId) return;
    const count = mountingFacesOf(getDef(pendingDefId)).length;
    if (count > 1) set({ pendingMountFace: (pendingMountFace + 1) % count });
  },
  rotatePending: (deltaDeg) =>
    set((s) => ({
      pendingAngleDeg: ((s.pendingAngleDeg + deltaDeg) % 360 + 360) % 360,
    })),
  setLinkMode: (on) =>
    set({ linkMode: on, linkFirstHole: null, pendingDefId: null, selection: null }),
  setLinkFirstHole: (h) => set({ linkFirstHole: h }),

  placeFreePart(defId, xMm, yMm, floorZMm) {
    const { model, commit, pendingMountFace, pendingAngleDeg, showToast } = get();
    const def = getDef(defId);
    const faces = mountingFacesOf(def);
    const child = faces[pendingMountFace % Math.max(1, faces.length)] ?? defaultAttachHole(def);
    const q = child
      ? floorPlacementQuaternion(child, pendingAngleDeg)
      : new Quaternion();
    const minZ = Math.min(
      ...defBBoxCorners(def).map((corner) => corner.clone().applyQuaternion(q).z)
    );
    const id = `p${model.nextSeq}`;
    const snap = (v: number) => Math.round(v / 5) * 5;
    const mappings = [...model.mappings];
    if (def.servo) {
      const used = new Set(mappings.map((m) => m.input));
      const free = INPUT_OPTIONS.find((o) => o !== "none" && !used.has(o)) ?? "none";
      mappings.push({ jointId: id, input: free });
    }
    commit({
      ...model,
      parts: [
        ...model.parts,
        {
          id,
          defId,
          material: "plastic",
          basePose: {
            posMm: [snap(xMm), snap(yMm), floorZMm - minZ],
            quatWxyz: [q.w, q.x, q.y, q.z],
          },
        },
      ],
      mappings,
      nextSeq: model.nextSeq + 1,
    });
    set({ selection: id });
    showToast("置いたよ!向きや位置はあとからでも変えられる", true);
  },

  attachPart(parentPartId, parentHoleKey, side) {
    const {
      model,
      pendingDefId,
      pendingMountFace,
      pendingAngleDeg,
      commit,
      showToast,
    } = get();
    if (!pendingDefId) return;
    const def = getDef(pendingDefId);
    // 取付に使う子側の穴:通常穴(main)の先頭(ゴーストプレビューと同じ規則)
    const faces = mountingFacesOf(def);
    const child = faces[pendingMountFace % Math.max(1, faces.length)] ?? defaultAttachHole(def);
    if (!child) {
      showToast("このパーツには取付穴がないよ。床に置くか、穴のあるパーツを選んでね");
      return;
    }
    const parentRef = parseHoleKey(parentHoleKey);
    const parentInst = model.parts.find((p) => p.id === parentPartId);
    if (!parentInst) {
      showToast("選んだパーツが見つからなくなったよ。光っている穴をもう一度選んでね");
      return;
    }
    const parentHole = findHole(getDef(parentInst.defId), parentRef);
    if (!parentHole) {
      showToast("選んだ穴が見つからなくなったよ。光っている穴をもう一度選んでね");
      return;
    }

    const id = `p${model.nextSeq}`;
    const conn: Connection = {
      id: `c${model.nextSeq}`,
      kind: "tree",
      parentPart: parentPartId,
      parentHole: parentRef,
      childPart: id,
      childHole: child.ref,
      pins: 2, // デフォルトは固定(別紙2§7.2:回るは明示的な切替)
      angleDeg: pendingAngleDeg,
      side,
    };
    const mappings = [...model.mappings];
    if (def.servo) {
      const used = new Set(mappings.map((m) => m.input));
      const free = INPUT_OPTIONS.find((o) => o !== "none" && !used.has(o)) ?? "none";
      mappings.push({ jointId: id, input: free });
    }
    commit({
      ...model,
      parts: [...model.parts, { id, defId: pendingDefId, material: "plastic" }],
      connections: [...model.connections, conn],
      mappings,
      nextSeq: model.nextSeq + 1,
    });
    set({ selection: id });
    showToast(
      parentHole.kind === "drive"
        ? "駆動穴につけたよ!サーボが回すと一緒に動く"
        : "ガチャン!パーツをくっつけた",
      true
    );
  },

  pinHoles(a, b, coincident) {
    const { model, commit, showToast } = get();
    if (a.partId === b.partId) {
      showToast("同じパーツの穴どうしはつなげないよ。別のパーツの穴を選んでね");
      return false;
    }
    const sameIsland = islandRootOf(model, a.partId) === islandRootOf(model, b.partId);
    if (sameIsland) {
      // 追いピン(からくり):穴が実際に重なっている必要がある
      if (!coincident) {
        showToast("穴が重なっていないよ。パーツを近づけて、穴が光ってからもう一度選んでね");
        return false;
      }
      const conn: Connection = {
        id: `c${model.nextSeq}`,
        kind: "loop",
        parentPart: a.partId,
        parentHole: parseHoleKey(a.holeKey),
        childPart: b.partId,
        childHole: parseHoleKey(b.holeKey),
        pins: 1, // 追いピンはからくり用途が主なので「回る」で開始
        angleDeg: 0,
        side: 1,
      };
      commit({ ...model, connections: [...model.connections, conn], nextSeq: model.nextSeq + 1 });
      showToast("ピンで留めた!(1本=くるくる回る)", true);
      return true;
    }
    // 別の島 → 2つめの穴を1つめの穴に吸着させて島ごと結合
    const joined = edit.joinIslands(
      model,
      { partId: a.partId, holeRef: parseHoleKey(a.holeKey) },
      { partId: b.partId, holeRef: parseHoleKey(b.holeKey) },
      a.side,
      2
    );
    if (!joined) {
      showToast("この向きのままではつなげられなかったよ。動かすパーツをいったん外し、穴へ近づけて試してね");
      return false;
    }
    commit(joined);
    showToast("ガチャン!自動でくっつけた(ピン2本=固定)", true);
    return true;
  },

  moveFreePart(partId, xMm, yMm, save) {
    const { model, past, dragStartModel } = get();
    const snap = (v: number) => Math.round(v / 5) * 5;
    const parts = model.parts.map((p) => {
      if (p.id !== partId) return p;
      const bp = p.basePose ?? { posMm: [0, 0, 0] as [number, number, number], quatWxyz: [1, 0, 0, 0] as [number, number, number, number] };
      return { ...p, basePose: { ...bp, posMm: [snap(xMm), snap(yMm), bp.posMm[2]] as [number, number, number] } };
    });
    const next = { ...model, parts };
    if (save) {
      // 1回のドラッグ全体を1つのアンドゥ単位に(開始時点のモデルを履歴に積む)
      const base = dragStartModel ?? model;
      set({ model: next, past: [...past.slice(-99), base], future: [], dragStartModel: null });
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializeProject(next));
      } catch {
        /* ローカルファースト:保存失敗でも続行 */
      }
    } else {
      if (!dragStartModel) set({ dragStartModel: model });
      set({ model: next }); // ドラッグ中は履歴に積まない
    }
  },

  setFreePartPos(partId, posMm, save) {
    const { model, past, dragStartModel } = get();
    const parts = model.parts.map((p) => {
      if (p.id !== partId) return p;
      const bp = p.basePose ?? { posMm: [0, 0, 0] as [number, number, number], quatWxyz: [1, 0, 0, 0] as [number, number, number, number] };
      return { ...p, basePose: { ...bp, posMm: [...posMm] as [number, number, number] } };
    });
    const next = { ...model, parts };
    if (save) {
      const base = dragStartModel ?? model;
      set({ model: next, past: [...past.slice(-99), base], future: [], dragStartModel: null });
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializeProject(next));
      } catch {
        /* ローカルファースト:保存失敗でも続行 */
      }
    } else {
      if (!dragStartModel) set({ dragStartModel: model });
      set({ model: next });
    }
  },

  rotateFreePart(partId, axis, deltaDeg) {
    const { model, commit } = get();
    const axisVec =
      axis === "x" ? new Vector3(1, 0, 0) : axis === "y" ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const parts = model.parts.map((p) => {
      if (p.id !== partId) return p;
      const bp = p.basePose ?? { posMm: [0, 0, 0] as [number, number, number], quatWxyz: [1, 0, 0, 0] as [number, number, number, number] };
      const [w, x, y, z] = bp.quatWxyz;
      const q = new Quaternion(x, y, z, w);
      const rot = new Quaternion().setFromAxisAngle(axisVec, (deltaDeg * Math.PI) / 180);
      const nq = rot.clone().multiply(q).normalize();
      // 回転で床にめり込まないよう、最下点の高さを回転前と同じに保つ
      const corners = defBBoxCorners(getDef(p.defId));
      const minOld = Math.min(...corners.map((c) => c.clone().applyQuaternion(q).z));
      const minNew = Math.min(...corners.map((c) => c.clone().applyQuaternion(nq).z));
      return {
        ...p,
        basePose: {
          posMm: [bp.posMm[0], bp.posMm[1], bp.posMm[2] + (minOld - minNew)] as [number, number, number],
          quatWxyz: [nq.w, nq.x, nq.y, nq.z] as [number, number, number, number],
        },
      };
    });
    commit({ ...model, parts });
  },

  rotateConnAngle(connId, angleDeg, save) {
    const { model, past, dragStartModel } = get();
    const connections = model.connections.map((c) =>
      c.id === connId ? { ...c, angleDeg: Math.round(angleDeg * 10) / 10 } : c
    );
    const next = { ...model, connections };
    if (save) {
      const base = dragStartModel ?? model;
      set({ model: next, past: [...past.slice(-99), base], future: [], dragStartModel: null });
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializeProject(next));
      } catch {
        /* ローカルファースト:保存失敗でも続行 */
      }
    } else {
      if (!dragStartModel) set({ dragStartModel: model });
      set({ model: next });
    }
  },

  liftFreePart(partId, deltaZMm) {
    const { model, commit } = get();
    const parts = model.parts.map((p) => {
      if (p.id !== partId) return p;
      const bp = p.basePose ?? { posMm: [0, 0, 0] as [number, number, number], quatWxyz: [1, 0, 0, 0] as [number, number, number, number] };
      return {
        ...p,
        basePose: {
          ...bp,
          posMm: [bp.posMm[0], bp.posMm[1], bp.posMm[2] + deltaZMm] as [number, number, number],
        },
      };
    });
    commit({ ...model, parts });
  },

  rotateConnAngleLinked(connId, angleDeg, save) {
    const { model, past, dragStartModel, rotateConnAngle } = get();
    const solved = solveRestLinkage(model, { connId, angleDeg });
    if (!solved) {
      // この機構にループ拘束はない → 単独回転
      rotateConnAngle(connId, angleDeg, save);
      return;
    }
    if (solved.maxErrMm > 3) {
      // 可動限界:ループを保てない角度には動かさない(離した時は現状で確定)
      if (save) {
        const cur = model.connections.find((c) => c.id === connId);
        if (cur) rotateConnAngle(connId, cur.angleDeg, true);
      }
      return;
    }
    const connections = model.connections.map((c) => {
      const a = solved.angles.get(c.id);
      return a === undefined ? c : { ...c, angleDeg: Math.round(a * 10) / 10 };
    });
    const next = { ...model, connections };
    if (save) {
      const base = dragStartModel ?? model;
      set({ model: next, past: [...past.slice(-99), base], future: [], dragStartModel: null });
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializeProject(next));
      } catch {
        /* ローカルファースト:保存失敗でも続行 */
      }
    } else {
      if (!dragStartModel) set({ dragStartModel: model });
      set({ model: next });
    }
  },

  detachPart(partId) {
    const { model, commit, showToast } = get();
    const next = edit.detachPart(model, partId);
    if (!next) {
      showToast("もう自由なパーツだよ(ドラッグで動かせる)");
      return;
    }
    commit(next);
    showToast("はずして自由にしたよ。ドラッグで動かして、📌ピンでとめ直せる", true);
  },

  rotateChild(childPartId, deltaDeg) {
    const { model, commit } = get();
    const conns = model.connections.map((c) =>
      c.kind === "tree" && c.childPart === childPartId
        ? { ...c, angleDeg: ((c.angleDeg + deltaDeg) % 360 + 360) % 360 }
        : c
    );
    commit({ ...model, connections: conns });
  },

  flipChild(childPartId) {
    const { model, commit } = get();
    const conns = model.connections.map((c) =>
      c.kind === "tree" && c.childPart === childPartId
        ? { ...c, side: (c.side === 1 ? -1 : 1) as 1 | -1 }
        : c
    );
    commit({ ...model, connections: conns });
  },

  flipChildOver(childPartId) {
    const { model, commit } = get();
    const conns = model.connections.map((c) =>
      c.kind === "tree" && c.childPart === childPartId ? { ...c, flip: !c.flip } : c
    );
    commit({ ...model, connections: conns });
  },

  cycleChildHole(childPartId) {
    const { model, commit } = get();
    const inst = model.parts.find((p) => p.id === childPartId);
    if (!inst) return;
    const holes = holesOf(getDef(inst.defId)).filter((h) => h.kind === "plain" && h.body === "main");
    if (holes.length < 2) return;
    const conns = model.connections.map((c) => {
      if (!(c.kind === "tree" && c.childPart === childPartId)) return c;
      const cur = holes.findIndex((h) => h.key === holeKey(c.childHole));
      const next = holes[(cur + 1) % holes.length];
      return { ...c, childHole: next.ref };
    });
    commit({ ...model, connections: conns });
  },

  setPins(connId, pins) {
    const { model, commit } = get();
    commit({
      ...model,
      connections: model.connections.map((c) => (c.id === connId ? { ...c, pins } : c)),
    });
  },

  deletePart(partId) {
    const { model, commit, showToast } = get();
    const doomed = subtreeParts(model, partId);
    commit({
      ...model,
      parts: model.parts.filter((p) => !doomed.has(p.id)),
      connections: model.connections.filter(
        (c) => !doomed.has(c.parentPart) && !doomed.has(c.childPart)
      ),
      mappings: model.mappings.filter((m) => !doomed.has(m.jointId)),
    });
    set({ selection: null });
    showToast("パーツを消したよ", true);
  },

  deleteConnection(connId) {
    const { model, commit } = get();
    const conn = model.connections.find((c) => c.id === connId);
    if (!conn || conn.kind !== "loop") return; // tree接続はパーツ削除でのみ消せる
    commit({ ...model, connections: model.connections.filter((c) => c.id !== connId) });
  },

  setMaterial(partId, m) {
    const { model, commit } = get();
    commit({
      ...model,
      parts: model.parts.map((p) => (p.id === partId ? { ...p, material: m } : p)),
    });
  },
  setName(name) {
    const { model, commit } = get();
    commit({ ...model, name });
  },
  setAuthor(author) {
    const { model, commit } = get();
    commit({ ...model, author });
  },
  setMapping(jointId, input, invert) {
    const { model, commit } = get();
    const rest = model.mappings.filter((m) => m.jointId !== jointId);
    commit({ ...model, mappings: [...rest, { jointId, input, invert }] });
  },
  setPoseAngle: (jointId, deg) =>
    set((s) => ({ poseAngles: { ...s.poseAngles, [jointId]: deg } })),
  resetPose: () => set({ poseAngles: {} }),
  setAdultMode: (v) => set({ adultMode: v }),
  setTutorialOpen: (v) => set({ tutorialOpen: v }),
  setExportOpen: (v) => set({ exportOpen: v }),
  showToast(msg, undoable = false) {
    set({ toast: { message: msg, undoable } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), undoable ? 6000 : 3200);
  },
  clearToast: () => set({ toast: null }),
  newProject() {
    const { commit } = get();
    commit(emptyModel());
    set({ selection: null, pendingDefId: null, poseAngles: {} });
  },
  loadTemplate(id) {
    const { commit, showToast } = get();
    const template = buildTemplate(id);
    const children = new Set(
      template.connections.filter((c) => c.kind === "tree").map((c) => c.childPart)
    );
    const representative =
      template.parts.find((p) => !children.has(p.id))?.id ?? template.parts[0]?.id ?? null;
    commit(template);
    set({
      selection: representative,
      pendingDefId: null,
      linkMode: false,
      linkFirstHole: null,
      poseAngles: {},
    });
    showToast("胴体を選んだよ。近くのボタンか右の調整から改造できるよ");
  },
  loadProjectJson(json) {
    const { commit } = get();
    commit(deserializeProject(json));
    set({ selection: null, pendingDefId: null, poseAngles: {} });
  },
  saveProjectJson: () => serializeProject(get().model),
}));
