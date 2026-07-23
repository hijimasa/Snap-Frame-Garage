// テスト用のモデル組立ヘルパ
import type { Connection, HoleRef, RobotModel } from "./types";
import { emptyModel } from "./types";

export class ModelBuilder {
  model: RobotModel = emptyModel();
  private seq = 1;

  add(defId: string, material: "plastic" | "aluminum" = "plastic"): string {
    const id = `p${this.seq++}`;
    this.model.parts.push({ id, defId, material });
    return id;
  }

  attach(
    parent: string,
    parentHole: HoleRef,
    child: string,
    childHole: HoleRef,
    opts: Partial<Pick<Connection, "pins" | "angleDeg" | "side">> = {}
  ): string {
    const id = `c${this.seq++}`;
    this.model.connections.push({
      id,
      kind: "tree",
      parentPart: parent,
      parentHole,
      childPart: child,
      childHole,
      pins: opts.pins ?? 2,
      angleDeg: opts.angleDeg ?? 0,
      side: opts.side ?? 1,
    });
    return id;
  }

  loop(a: string, aHole: HoleRef, b: string, bHole: HoleRef, pins = 1): string {
    const id = `c${this.seq++}`;
    this.model.connections.push({
      id,
      kind: "loop",
      parentPart: a,
      parentHole: aHole,
      childPart: b,
      childHole: bHole,
      pins,
      angleDeg: 0,
      side: 1,
    });
    return id;
  }
}

export const g = (group: number, index: number): HoleRef => ({ group, index });
export const drive = (): HoleRef => ({ special: "drive" });
