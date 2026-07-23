// 組立グラフの解決:
//  - tree接続から各パーツの基準姿勢(rest pose)を導出
//  - 「ピン2本以上=剛結合」で結ばれたパーツ群を1リンクに合成(別紙2§5)
//  - ピン1本=受動関節、サーボのホーン=能動関節としてリンク境界を作る
//  - 閉ループ(からくり)の検出、ぶらぶらメーター(橋である受動関節の数)
//  - ポーズプレビュー用FK
import { Matrix4, Quaternion, Vector3 } from "three";
import { getDef } from "../data/catalog";
import { computeAttachment, findHole, holesOf, type HoleInfo } from "./holes";
import type { Connection, RobotModel } from "./types";

export type BodyId = string; // "p3" (main) | "p3#horn"

export interface AssemblyJoint {
  id: string; // 能動: サーボのpartId / 受動: connectionId
  type: "active" | "passive";
  servoPartId?: string;
  connectionId?: string;
  linkA: number;
  linkB: number;
  anchorMm: Vector3; // rest時world
  axisMm: Vector3; // rest時world(単位)
  locked: boolean; // 両端が同一リンク(回るはずの所が固定されている)
  isLoop: boolean; // 全域木に入らない=閉ループを閉じる関節
  /** 木構造での向き:parentLink→childLink(isLoop時は未定義) */
  parentLink?: number;
  childLink?: number;
}

export interface Assembly {
  poses: Map<string, Matrix4>; // partId → rest world matrix
  bodies: BodyId[];
  linkOfBody: Map<BodyId, number>;
  linkBodies: BodyId[][]; // link index → bodies
  rootLink: number;
  joints: AssemblyJoint[];
  treeOrder: number[]; // rootから幅優先のリンク順
  parentJointOfLink: Map<number, AssemblyJoint>;
  danglingCount: number; // ぶらぶらメーター(橋になっている受動関節の数)
  danglingConnectionIds: string[];
  hasLoop: boolean;
  warnings: string[];
  orphanParts: string[]; // tree接続が壊れて姿勢を導出できなかったパーツ
}

export function bodyOfHole(partId: string, hole: HoleInfo): BodyId {
  return hole.body === "horn" ? `${partId}#horn` : partId;
}

export function basePoseMatrix(inst: { basePose?: { posMm: [number, number, number]; quatWxyz: [number, number, number, number] } }): Matrix4 {
  if (!inst.basePose) return new Matrix4();
  const [w, x, y, z] = inst.basePose.quatWxyz;
  return new Matrix4().compose(
    new Vector3(...inst.basePose.posMm),
    new Quaternion(x, y, z, w),
    new Vector3(1, 1, 1)
  );
}

/**
 * rest姿勢の導出。
 * どのtree接続の子でもないパーツ=「島の根」は basePose(自由配置)を使い、
 * 子はtree接続のパラメータから連鎖的に解決する。複数の島を許す。
 * angleOverrides: 接続ID→角度の上書き(リンク機構ソルバが候補角を評価するときに使う)
 */
export function computePoses(
  model: RobotModel,
  angleOverrides?: Map<string, number>
): {
  poses: Map<string, Matrix4>;
  orphans: string[];
} {
  const poses = new Map<string, Matrix4>();
  if (model.parts.length === 0) return { poses, orphans: [] };

  const byChild = new Map<string, Connection>();
  for (const c of model.connections) if (c.kind === "tree") byChild.set(c.childPart, c);

  const pending = new Set<string>();
  for (const p of model.parts) {
    if (byChild.has(p.id)) pending.add(p.id);
    else poses.set(p.id, basePoseMatrix(p)); // 島の根
  }

  // 幅優先で親の姿勢が決まったものから子を解決
  let progress = true;
  while (progress) {
    progress = false;
    for (const pid of [...pending]) {
      const conn = byChild.get(pid)!;
      const parentM = poses.get(conn.parentPart);
      if (!parentM) continue;
      const parentInst = model.parts.find((p) => p.id === conn.parentPart);
      const childInst = model.parts.find((p) => p.id === pid);
      if (!parentInst || !childInst) continue;
      const ph = findHole(getDef(parentInst.defId), conn.parentHole);
      const ch = findHole(getDef(childInst.defId), conn.childHole);
      if (!ph || !ch) continue;
      const angle = angleOverrides?.get(conn.id) ?? conn.angleDeg;
      poses.set(pid, computeAttachment(parentM, ph, ch, angle, conn.side, conn.flip));
      pending.delete(pid);
      progress = true;
    }
  }
  return { poses, orphans: [...pending] };
}

/** 部品の属する島の根(tree接続を親方向にたどった先) */
export function islandRootOf(model: RobotModel, partId: string): string {
  const byChild = new Map<string, Connection>();
  for (const c of model.connections) if (c.kind === "tree") byChild.set(c.childPart, c);
  let cur = partId;
  const seen = new Set<string>();
  while (byChild.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = byChild.get(cur)!.parentPart;
  }
  return cur;
}

/** 島の数(すべての接続=tree+loopで結ばれた連結成分の数) */
export function countIslands(model: RobotModel): number {
  if (model.parts.length === 0) return 0;
  const idx = new Map(model.parts.map((p, i) => [p.id, i]));
  const uf = new UnionFind(model.parts.length);
  for (const c of model.connections) {
    const a = idx.get(c.parentPart);
    const b = idx.get(c.childPart);
    if (a !== undefined && b !== undefined) uf.union(a, b);
  }
  const roots = new Set<number>();
  for (let i = 0; i < model.parts.length; i++) roots.add(uf.find(i));
  return roots.size;
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

export function buildAssembly(model: RobotModel): Assembly {
  const warnings: string[] = [];
  const { poses, orphans } = computePoses(model);

  // 剛体ノード(サーボはmain+horn)
  const bodies: BodyId[] = [];
  const bodyIdx = new Map<BodyId, number>();
  const addBody = (b: BodyId) => {
    if (!bodyIdx.has(b)) {
      bodyIdx.set(b, bodies.length);
      bodies.push(b);
    }
  };
  for (const p of model.parts) {
    if (orphans.includes(p.id)) continue;
    addBody(p.id);
    const def = getDef(p.defId);
    const hasHorn =
      def.specialHoles?.some((s) => s.kind === "drive") ||
      def.holes?.some((h) => h.body === "horn");
    if (hasHorn) addBody(`${p.id}#horn`);
  }

  const uf = new UnionFind(bodies.length);
  interface RawJoint {
    id: string;
    type: "active" | "passive";
    servoPartId?: string;
    connectionId?: string;
    bodyA: BodyId;
    bodyB: BodyId;
    anchorMm: Vector3;
    axisMm: Vector3;
  }
  const rawJoints: RawJoint[] = [];

  // 接続エッジ
  for (const c of model.connections) {
    if (orphans.includes(c.parentPart) || orphans.includes(c.childPart)) continue;
    const pInst = model.parts.find((p) => p.id === c.parentPart);
    const cInst = model.parts.find((p) => p.id === c.childPart);
    if (!pInst || !cInst) continue;
    const ph = findHole(getDef(pInst.defId), c.parentHole);
    const ch = findHole(getDef(cInst.defId), c.childHole);
    if (!ph || !ch) continue;
    const bA = bodyOfHole(c.parentPart, ph);
    const bB = bodyOfHole(c.childPart, ch);
    if (!bodyIdx.has(bA) || !bodyIdx.has(bB)) continue;
    const special = ph.kind !== "plain" || ch.kind !== "plain";
    if (c.pins >= 2 || special) {
      // 固定(駆動穴・アイドラー穴への接続はホーン剛体への固定)
      uf.union(bodyIdx.get(bA)!, bodyIdx.get(bB)!);
    } else {
      // ピン1本 = 受動回転関節
      const pm = poses.get(c.parentPart)!;
      const q = new Quaternion().setFromRotationMatrix(pm);
      rawJoints.push({
        id: c.id,
        type: "passive",
        connectionId: c.id,
        bodyA: bA,
        bodyB: bB,
        anchorMm: ph.posMm.clone().applyMatrix4(pm),
        axisMm: ph.normal.clone().applyQuaternion(q).normalize(),
      });
    }
  }

  // サーボ内部の能動関節(本体↔ホーン)
  for (const p of model.parts) {
    const hornBody = `${p.id}#horn`;
    if (!bodyIdx.has(hornBody)) continue;
    const def = getDef(p.defId);
    const drive = def.specialHoles?.find((s) => s.kind === "drive");
    if (!drive) continue;
    const pm = poses.get(p.id)!;
    const q = new Quaternion().setFromRotationMatrix(pm);
    rawJoints.push({
      id: p.id,
      type: "active",
      servoPartId: p.id,
      bodyA: p.id,
      bodyB: hornBody,
      anchorMm: new Vector3(...drive.posMm).applyMatrix4(pm),
      axisMm: new Vector3(...drive.normal).applyQuaternion(q).normalize(),
    });
  }

  // リンク合成
  const rootOfBody = bodies.map((_, i) => uf.find(i));
  const linkIndex = new Map<number, number>();
  const linkBodies: BodyId[][] = [];
  bodies.forEach((b, i) => {
    const r = rootOfBody[i];
    if (!linkIndex.has(r)) {
      linkIndex.set(r, linkBodies.length);
      linkBodies.push([]);
    }
    linkBodies[linkIndex.get(r)!].push(b);
  });
  const linkOfBody = new Map<BodyId, number>();
  bodies.forEach((b, i) => linkOfBody.set(b, linkIndex.get(rootOfBody[i])!));

  const connKind = new Map(model.connections.map((c) => [c.id, c.kind]));
  const joints: AssemblyJoint[] = rawJoints.map((rj) => {
    const la = linkOfBody.get(rj.bodyA)!;
    const lb = linkOfBody.get(rj.bodyB)!;
    return {
      id: rj.id,
      type: rj.type,
      servoPartId: rj.servoPartId,
      connectionId: rj.connectionId,
      linkA: la,
      linkB: lb,
      anchorMm: rj.anchorMm,
      axisMm: rj.axisMm,
      locked: la === lb,
      isLoop: false,
    };
  });

  for (const j of joints) {
    if (j.locked && j.type === "active") {
      warnings.push(`サーボ ${j.id} のホーンが本体と同じかたまりに固定されています(回れません)`);
    }
  }

  // 全域木(BFS)
  const rootLink =
    model.parts.length > 0 && linkOfBody.has(model.parts[0].id)
      ? linkOfBody.get(model.parts[0].id)!
      : 0;
  // 全域木は「tree接続の受動関節+能動関節」を優先して張る(computePosesの親子と一致させる)。
  // loop接続(追いピン)経由で先に到達すると、駆動エッジがループ扱いになりFKが壊れるため。
  const isPrimary = (j: AssemblyJoint) =>
    j.type === "active" || (j.connectionId !== undefined && connKind.get(j.connectionId) === "tree");
  const adj = new Map<number, { joint: AssemblyJoint; other: number }[]>();
  for (const j of joints) {
    if (j.locked) continue;
    if (!adj.has(j.linkA)) adj.set(j.linkA, []);
    if (!adj.has(j.linkB)) adj.set(j.linkB, []);
    adj.get(j.linkA)!.push({ joint: j, other: j.linkB });
    adj.get(j.linkB)!.push({ joint: j, other: j.linkA });
  }
  const visited = new Set<number>();
  const treeOrder: number[] = [];
  const parentJointOfLink = new Map<number, AssemblyJoint>();
  const visit = (other: number, joint: AssemblyJoint, from: number) => {
    visited.add(other);
    joint.parentLink = from;
    joint.childLink = other;
    parentJointOfLink.set(other, joint);
    treeOrder.push(other);
  };
  const bfsRoots = [rootLink, ...Array.from({ length: linkBodies.length }, (_, i) => i)];
  for (const start of bfsRoots) {
    if (visited.has(start)) continue;
    visited.add(start);
    treeOrder.push(start);
    let queue = [start];
    for (;;) {
      // tree接続+能動関節だけでBFS
      while (queue.length) {
        const l = queue.shift()!;
        for (const { joint, other } of adj.get(l) ?? []) {
          if (visited.has(other) || !isPrimary(joint)) continue;
          visit(other, joint, l);
          queue.push(other);
        }
      }
      // まだ届かないリンクがあれば、loop接続を1本だけ使って続行(フォールバック)
      let bridged = false;
      for (const j of joints) {
        if (j.locked || isPrimary(j)) continue;
        const aV = visited.has(j.linkA);
        const bV = visited.has(j.linkB);
        if (aV !== bV) {
          const from = aV ? j.linkA : j.linkB;
          const other = aV ? j.linkB : j.linkA;
          visit(other, j, from);
          queue = [other];
          bridged = true;
          break;
        }
      }
      if (!bridged) break;
    }
  }
  let hasLoop = false;
  for (const j of joints) {
    if (!j.locked && j.parentLink === undefined) {
      j.isLoop = true;
      hasLoop = true;
    }
    if (j.locked) hasLoop = true;
  }

  // ぶらぶらメーター:受動関節のうち、どのサイクルにも属さない(=橋)ものを数える。
  // 閉じたからくりの関節はサイクル上にあるので除外される(別紙2§7.2)。
  const danglingConnectionIds = bridgePassiveJointIds(linkBodies.length, joints);
  const danglingCount = danglingConnectionIds.length;

  return {
    poses,
    bodies,
    linkOfBody,
    linkBodies,
    rootLink,
    joints,
    treeOrder,
    parentJointOfLink,
    danglingCount,
    danglingConnectionIds,
    hasLoop,
    warnings,
    orphanParts: orphans,
  };
}

function bridgePassiveJointIds(nLinks: number, joints: AssemblyJoint[]): string[] {
  const edges = joints.filter((j) => !j.locked);
  const adj = new Map<number, { to: number; ei: number }[]>();
  edges.forEach((j, ei) => {
    if (!adj.has(j.linkA)) adj.set(j.linkA, []);
    if (!adj.has(j.linkB)) adj.set(j.linkB, []);
    adj.get(j.linkA)!.push({ to: j.linkB, ei });
    adj.get(j.linkB)!.push({ to: j.linkA, ei });
  });
  const disc = new Array<number>(nLinks).fill(-1);
  const low = new Array<number>(nLinks).fill(-1);
  const isBridge = new Array<boolean>(edges.length).fill(false);
  let timer = 0;
  const dfs = (u: number, parentEdge: number) => {
    disc[u] = low[u] = timer++;
    for (const { to, ei } of adj.get(u) ?? []) {
      if (ei === parentEdge) continue;
      if (disc[to] === -1) {
        dfs(to, ei);
        low[u] = Math.min(low[u], low[to]);
        if (low[to] > disc[u]) isBridge[ei] = true;
      } else {
        low[u] = Math.min(low[u], disc[to]);
      }
    }
  };
  for (let i = 0; i < nLinks; i++) if (disc[i] === -1 && (adj.get(i)?.length ?? 0) > 0) dfs(i, -1);
  return edges
    .filter((j, ei) => j.type === "passive" && isBridge[ei])
    .map((j) => j.connectionId)
    .filter((id): id is string => id !== undefined);
}

/**
 * ポーズプレビュー用FK。anglesDeg: jointId→角度。
 * 戻り値:link index → rest姿勢からの差分変換(rest=単位行列)。
 * ループを閉じる関節は無視(表示上リンクが割れるのは仕様/シミュレータでは等式制約で拘束)。
 */
export function linkDeltas(asm: Assembly, anglesDeg: Record<string, number>): Map<number, Matrix4> {
  const deltas = new Map<number, Matrix4>();
  for (const l of asm.treeOrder) {
    const j = asm.parentJointOfLink.get(l);
    if (!j) {
      deltas.set(l, new Matrix4()); // 森の根(島ごと)
      continue;
    }
    const parentDelta = deltas.get(j.parentLink!) ?? new Matrix4();
    const angle = ((anglesDeg[j.id] ?? 0) * Math.PI) / 180;
    // 子リンクが joint.linkB 側でない場合は回転方向を反転
    const sign = j.childLink === j.linkB ? 1 : -1;
    const rot = new Matrix4().makeRotationAxis(j.axisMm.clone().normalize(), angle * sign);
    const m = new Matrix4()
      .makeTranslation(j.anchorMm.x, j.anchorMm.y, j.anchorMm.z)
      .multiply(rot)
      .multiply(new Matrix4().makeTranslation(-j.anchorMm.x, -j.anchorMm.y, -j.anchorMm.z));
    deltas.set(l, parentDelta.clone().multiply(m));
  }
  return deltas;
}

/** あるパーツ(main/horn)の表示用ワールド行列 */
export function bodyDisplayMatrix(
  asm: Assembly,
  deltas: Map<number, Matrix4>,
  partId: string,
  horn: boolean
): Matrix4 | null {
  const rest = asm.poses.get(partId);
  if (!rest) return null;
  const body: BodyId = horn ? `${partId}#horn` : partId;
  const link = asm.linkOfBody.get(body);
  const delta = link !== undefined ? deltas.get(link) : undefined;
  return (delta ? delta.clone() : new Matrix4()).multiply(rest);
}

/** 削除対象:指定パーツとそのtree子孫 */
export function subtreeParts(model: RobotModel, partId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of model.connections) {
    if (c.kind !== "tree") continue;
    if (!children.has(c.parentPart)) children.set(c.parentPart, []);
    children.get(c.parentPart)!.push(c.childPart);
  }
  const out = new Set<string>();
  const stack = [partId];
  while (stack.length) {
    const p = stack.pop()!;
    if (out.has(p)) continue;
    out.add(p);
    for (const ch of children.get(p) ?? []) stack.push(ch);
  }
  return out;
}
