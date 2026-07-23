// 右パネル:選択パーツの編集、ポーズスライダー、操作割当
import { useMemo } from "react";
import { buildAssembly } from "../core/assembly";
import { holeKey } from "../core/holes";
import { mountingFacesOf } from "../core/holes";
import { partMassProps } from "../core/mass";
import { exportGate } from "../core/power";
import { getDef } from "../data/catalog";
import { INPUT_OPTIONS, useStore } from "../state/store";
import { INPUT_LABELS, labels } from "./labels";

function SelectedPartSection() {
  const model = useStore((s) => s.model);
  const selection = useStore((s) => s.selection);
  const adult = useStore((s) => s.adultMode);
  const rotateChild = useStore((s) => s.rotateChild);
  const flipChild = useStore((s) => s.flipChild);
  const flipChildOver = useStore((s) => s.flipChildOver);
  const cycleChildHole = useStore((s) => s.cycleChildHole);
  const setPins = useStore((s) => s.setPins);
  const deletePart = useStore((s) => s.deletePart);
  const deleteConnection = useStore((s) => s.deleteConnection);
  const setMaterial = useStore((s) => s.setMaterial);
  const detachPart = useStore((s) => s.detachPart);
  const rotateFreePart = useStore((s) => s.rotateFreePart);
  const liftFreePart = useStore((s) => s.liftFreePart);
  const setLinkMode = useStore((s) => s.setLinkMode);
  const L = labels(adult);

  const inst = model.parts.find((p) => p.id === selection);
  if (!inst) return null;
  const def = getDef(inst.defId);
  const props = partMassProps(def, inst.material);
  const treeConn = model.connections.find((c) => c.kind === "tree" && c.childPart === inst.id);
  const loopConns = model.connections.filter(
    (c) => c.kind === "loop" && (c.parentPart === inst.id || c.childPart === inst.id)
  );
  const isFreeRoot = !treeConn;
  const treeSpecial =
    treeConn && "special" in treeConn.parentHole;

  return (
    <div className="section">
      <div className="section-title">
        {adult ? def.displayName.adult : def.displayName.kids}
        <span className="part-id">{inst.id}</span>
      </div>
      {adult && def.refRealPart && <div className="part-ref">{def.refRealPart} 相当</div>}
      {def.description && !adult && <div className="hint">{def.description}</div>}
      <div className="kv">
        <span>{L.mass}</span>
        <b>{props.massG} g</b>
      </div>
      {def.powerCost > 0 && (
        <div className="kv">
          <span>{L.powerCost}</span>
          <b>⚡{def.powerCost}</b>
        </div>
      )}
      {def.servo && (
        <div className="kv">
          <span>{L.torque}</span>
          <b>{def.servo.continuous ? "連続回転" : `${def.servo.torqueKgCm} kg・cm`}</b>
        </div>
      )}
      {def.materialOptions && (
        <div className="kv">
          <span>{L.material}</span>
          <span className="btn-row">
            <button
              className={inst.material === "plastic" ? "mini active" : "mini"}
              onClick={() => setMaterial(inst.id, "plastic")}
            >
              {L.plastic}
            </button>
            <button
              className={inst.material === "aluminum" ? "mini active" : "mini"}
              onClick={() => setMaterial(inst.id, "aluminum")}
            >
              {L.aluminum}
            </button>
          </span>
        </div>
      )}

      {isFreeRoot && (
        <>
          <div className="sub-title">じゆうなパーツ(まだ本体とつながってない)</div>
          <div className="hint">
            選んだままドラッグで移動。📌ピンでとめると他のパーツとつながるよ
          </div>
          <button className="mini primary-action" onClick={() => setLinkMode(true)}>
            📌 ほかのパーツとつなぐ
          </button>
          <details className="control-fold">
            <summary>向きと位置を調整</summary>
            <div className="control-fold-body">
              <div className="kv">
                <span>くるっと(水平)</span>
                <span className="btn-row">
                  <button className="mini" onClick={() => rotateFreePart(inst.id, "z", 90)}>↺ 90°</button>
                  <button className="mini" onClick={() => rotateFreePart(inst.id, "z", -90)}>↻ 90°</button>
                </span>
              </div>
              <div className="kv">
                <span>ぱたんと(前後)</span>
                <span className="btn-row">
                  <button className="mini" onClick={() => rotateFreePart(inst.id, "x", 90)}>↺ 90°</button>
                  <button className="mini" onClick={() => rotateFreePart(inst.id, "x", -90)}>↻ 90°</button>
                </span>
              </div>
              <div className="kv">
                <span>ぱたんと(左右)</span>
                <span className="btn-row">
                  <button className="mini" onClick={() => rotateFreePart(inst.id, "y", 90)}>↺ 90°</button>
                  <button className="mini" onClick={() => rotateFreePart(inst.id, "y", -90)}>↻ 90°</button>
                </span>
              </div>
              <div className="btn-row wrap">
                <button className="mini" onClick={() => liftFreePart(inst.id, 5)}>
                  ⬆ 5mm上げる
                </button>
                <button className="mini" onClick={() => liftFreePart(inst.id, -5)}>
                  ⬇ 5mm下げる
                </button>
              </div>
            </div>
          </details>
        </>
      )}
      {treeConn && (
        <>
          <div className="sub-title">とりつけ</div>
          {!treeSpecial && (
            <div className="kv">
              <span>とめかた</span>
              <span className="btn-row">
                <button
                  className={treeConn.pins >= 2 ? "mini active" : "mini"}
                  onClick={() => setPins(treeConn.id, 2)}
                  title={L.fixedJoint}
                >
                  📌📌 固定
                </button>
                <button
                  className={treeConn.pins === 1 ? "mini active" : "mini"}
                  onClick={() => setPins(treeConn.id, 1)}
                  title={L.passiveJoint}
                >
                  📌 回る
                </button>
              </span>
            </div>
          )}
          {treeSpecial && <div className="hint">{L.driveHole}につながっている(サーボが回す)</div>}
          {!treeSpecial && treeConn.pins === 1 && (
            <div className="hint">
              💡 ピン1本のパーツは、3Dビューで直接つかんでくるくる回せるよ
            </div>
          )}
          <details className="control-fold">
            <summary>取り付けを調整</summary>
            <div className="control-fold-body">
              <div className="btn-row wrap">
                <button className="mini" onClick={() => rotateChild(inst.id, 90)}>
                  {L.rotate} ↺
                </button>
                <button className="mini" onClick={() => rotateChild(inst.id, -90)}>
                  {L.rotate} ↻
                </button>
                <button className="mini" onClick={() => flipChild(inst.id)}>
                  {L.flip}
                </button>
                <button className="mini" onClick={() => flipChildOver(inst.id)}>
                  {L.flipOver}
                </button>
                <button className="mini" onClick={() => cycleChildHole(inst.id)}>
                  {L.cycleHole}
                </button>
              </div>
              <button
                className="mini"
                onClick={() => detachPart(inst.id)}
                title="削除せずに親から切り離して、自由に動かせるようにする"
              >
                🔓 はずして自由にする
              </button>
            </div>
          </details>
        </>
      )}
      {loopConns.length > 0 && (
        <>
          <div className="sub-title">追いピン(からくり)</div>
          {loopConns.map((c) => (
            <div className="kv" key={c.id}>
              <span>
                {c.parentPart}↔{c.childPart} / 穴{holeKey(c.parentHole)}
              </span>
              <span className="btn-row">
                <button
                  className={c.pins === 1 ? "mini active" : "mini"}
                  onClick={() => setPins(c.id, c.pins === 1 ? 2 : 1)}
                >
                  {c.pins === 1 ? "📌 回る" : "📌📌 固定"}
                </button>
                <button className="mini danger" onClick={() => deleteConnection(c.id)}>
                  ✕
                </button>
              </span>
            </div>
          ))}
        </>
      )}
      <details className="control-fold danger-fold">
        <summary>その他の操作</summary>
        <div className="control-fold-body">
          <button
            className="mini danger"
            onClick={() => {
              const hasChildren = model.connections.some(
                (c) => c.kind === "tree" && c.parentPart === inst.id
              );
              if (hasChildren) {
                if (!confirm("くっついている子パーツもいっしょに消えるよ。いい?(残したい子は先に「はずして自由にする」)")) return;
              }
              deletePart(inst.id);
            }}
          >
            🗑 {L.del}
          </button>
        </div>
      </details>
    </div>
  );
}

function PoseSection() {
  const model = useStore((s) => s.model);
  const adult = useStore((s) => s.adultMode);
  const poseAngles = useStore((s) => s.poseAngles);
  const setPoseAngle = useStore((s) => s.setPoseAngle);
  const resetPose = useStore((s) => s.resetPose);
  const L = labels(adult);

  const servos = model.parts.filter((p) => getDef(p.defId).servo);
  if (servos.length === 0) return null;
  return (
    <details className="section inspector-fold">
      <summary>{L.pose}</summary>
      <div className="inspector-fold-body">
        <div className="section-title">
          サーボを動かして確認
        <button className="mini" onClick={resetPose}>
          もとに戻す
        </button>
        </div>
      {servos.map((p) => {
        const def = getDef(p.defId);
        const range = def.servo!.continuous ? 180 : def.servo!.rangeDeg;
        return (
          <div className="pose-row" key={p.id}>
            <span className="pose-name">
              {adult ? def.displayName.adult : def.displayName.kids}({p.id})
            </span>
            <input
              type="range"
              min={-range}
              max={range}
              step={1}
              value={poseAngles[p.id] ?? 0}
              onChange={(e) => setPoseAngle(p.id, Number(e.target.value))}
            />
            <span className="pose-val">{Math.round(poseAngles[p.id] ?? 0)}°</span>
          </div>
        );
      })}
      <div className="hint">
        うごかして転びそうかは、シミュレータでたしかめてね(わざと転ぶのも面白い)
      </div>
      </div>
    </details>
  );
}

function MappingSection() {
  const model = useStore((s) => s.model);
  const adult = useStore((s) => s.adultMode);
  const setMapping = useStore((s) => s.setMapping);
  const L = labels(adult);
  const servos = model.parts.filter((p) => getDef(p.defId).servo);
  if (servos.length === 0) return null;
  return (
    <details className="section inspector-fold">
      <summary>{L.mapping}</summary>
      <div className="inspector-fold-body">
      {servos.map((p) => {
        const def = getDef(p.defId);
        const m = model.mappings.find((mm) => mm.jointId === p.id);
        return (
          <div className="kv" key={p.id}>
            <span>
              {adult ? def.displayName.adult : def.displayName.kids}({p.id})
            </span>
            <select
              value={m?.input ?? "none"}
              onChange={(e) => setMapping(p.id, e.target.value, m?.invert)}
            >
              {INPUT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {INPUT_LABELS[o]}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      </div>
    </details>
  );
}

function DanglingSection() {
  const model = useStore((s) => s.model);
  const adult = useStore((s) => s.adultMode);
  const asm = useMemo(() => buildAssembly(model), [model]);
  const L = labels(adult);
  if (model.parts.length === 0) return null;
  const decorative = asm.danglingConnectionIds.filter(
    (id) => model.connections.find((c) => c.id === id)?.intent === "decorative"
  ).length;
  const needsAttention = asm.danglingCount - decorative;
  return (
    <div className="section">
      <div className="section-title">ぶらぶらメーター</div>
      <div className="kv">
        <span>{L.dangling}</span>
        <b className={needsAttention > 0 ? "warn-text" : "ok-text"}>{needsAttention}</b>
      </div>
      {needsAttention > 0 && (
        <div className="hint">
          ⚠ 固定されていない関節があるよ。動かしたいならそのまま、固定するなら対象を選んで「固定する」を押そう
        </div>
      )}
      {decorative > 0 && (
        <div className="hint decor-ok">
          🎀 飾りとして動く関節 {decorative}（尻尾・腕・触角なので、このままでOK）
        </div>
      )}
      {asm.hasLoop && <div className="hint">🎡 からくり(閉ループ)発見!MJCFでは動くよ</div>}
      {asm.warnings.map((w, i) => (
        <div className="hint warn-text" key={i}>
          ⚠ {w}
        </div>
      ))}
    </div>
  );
}

function NextActionSection() {
  const model = useStore((s) => s.model);
  const selection = useStore((s) => s.selection);
  const pendingDefId = useStore((s) => s.pendingDefId);
  const linkMode = useStore((s) => s.linkMode);
  const linkFirstHole = useStore((s) => s.linkFirstHole);
  const adult = useStore((s) => s.adultMode);
  const gate = useMemo(() => exportGate(model), [model]);

  let icon = "👉";
  let title = "つぎにすること";
  let body = "左のカタログから、つぎにつけたいパーツを選ぼう。";

  if (pendingDefId) {
    icon = "✨";
    const def = getDef(pendingDefId);
    const name = adult ? def.displayName.adult : def.displayName.kids;
    body = `「${name}」を置く場所を決めよう。光っている穴なら接続、床なら仮置きできるよ。`;
  } else if (linkMode) {
    icon = "📌";
    body = linkFirstHole
      ? "つなぐ相手の穴を選ぼう。Escキーか「やめる」でキャンセルできるよ。"
      : "まず、つなぎたい穴を1つ選ぼう。重なった穴ならすぐに留められるよ。";
  } else if (model.parts.length === 0) {
    icon = "🔩";
    body = "中央の案内からおすすめの土台を置くか、ひながたを選ぼう。";
  } else if (selection) {
    icon = "🛠";
    body = "選んだパーツを改造しよう。3Dの近くのボタンで回す・つなぐ、下の調整で細かく変更できるよ。";
  } else if (gate.ok) {
    icon = "🚀";
    title = "おくり出す準備ができたよ";
    body = "重さとバランスを確認したら、右下の「ロボットをおくり出す」へ進もう。";
  } else if (gate.islands > 1) {
    icon = "🧩";
    body = `まだ${gate.islands}つのかたまりに分かれているよ。📌ピンで1つにつなげよう。`;
  } else if (gate.reasons.includes("no-box")) {
    icon = "🔋";
    body = "パワーボックスを選んでロボットにつけよう。おくり出すために必要だよ。";
  }

  return (
    <section className="section next-action" aria-live="polite">
      <div className="next-action-label">
        <span aria-hidden="true">{icon}</span>
        {title}
      </div>
      <div className="next-action-body">{body}</div>
    </section>
  );
}

function mountFaceLabel(normal: { x: number; y: number; z: number }, index: number): string {
  if (normal.z < -0.8) return "底面";
  if (normal.z > 0.8) return "上面";
  if (normal.y < -0.8) return "うしろ面";
  if (normal.y > 0.8) return "まえ面";
  return `よこ面${index + 1}`;
}

function PendingPlacementSection() {
  const pendingDefId = useStore((s) => s.pendingDefId);
  const pendingMountFace = useStore((s) => s.pendingMountFace);
  const pendingAngleDeg = useStore((s) => s.pendingAngleDeg);
  const cyclePendingMountFace = useStore((s) => s.cyclePendingMountFace);
  const rotatePending = useStore((s) => s.rotatePending);
  if (!pendingDefId) return null;

  const faces = mountingFacesOf(getDef(pendingDefId));
  const face = faces[pendingMountFace % Math.max(1, faces.length)];

  return (
    <section className="section pending-placement" aria-label="配置する向き">
      <div className="sub-title">置く前に向きを決める</div>
      {faces.length > 1 && face && (
        <button className="mini mount-face-button" onClick={cyclePendingMountFace}>
          取付面: {mountFaceLabel(face.normal, pendingMountFace)} ↻
        </button>
      )}
      <div className="pending-rotation">
        <span>向き {pendingAngleDeg}°</span>
        <span className="btn-row">
          <button className="mini" onClick={() => rotatePending(-90)} aria-label="配置する向きを左へ90度">
            ↺ 90°
          </button>
          <button className="mini" onClick={() => rotatePending(90)} aria-label="配置する向きを右へ90度">
            ↻ 90°
          </button>
        </span>
      </div>
      <div className="hint">半透明のプレビューを見ながら変えられるよ</div>
    </section>
  );
}

export function Inspector() {
  return (
    <div className="inspector">
      <div className="panel-title">パーツのようす</div>
      <NextActionSection />
      <PendingPlacementSection />
      <SelectedPartSection />
      <DanglingSection />
      <PoseSection />
      <MappingSection />
    </div>
  );
}
