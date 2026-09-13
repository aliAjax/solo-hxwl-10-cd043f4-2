import {
  buildSequences,
  KIND_LABEL,
  STATUS_LABEL,
  type AppState,
} from "../domain";
import { fmtDepth } from "./format";
import { EmptyState } from "./widgets";

export function SequencePanel({
  state,
  activeSquare,
  highlightCodes,
}: {
  state: AppState;
  activeSquare: string | "all";
  highlightCodes: Set<string>;
}) {
  const sequences = buildSequences(state);
  const shown =
    activeSquare === "all"
      ? sequences
      : sequences.filter((s) => s.square === activeSquare);

  if (state.units.length === 0) {
    return (
      <EmptyState
        icon="🧱"
        title="尚无地层序列"
        hint="登记遗迹单位并建立叠压关系后，将按探方自动生成由上至下的序列"
      />
    );
  }

  return (
    <div className="seq-grid">
      {shown.map((seq) => (
        <div key={seq.square} className="seq-column">
          <h3 className="seq-title">
            探方 {seq.square}
            <span className="seq-count">{seq.levels.filter((l) => !l.blocked).length} 层位</span>
            {seq.cyclic && <span className="seq-cyclic">环路异常</span>}
          </h3>
          <ol className="seq-list">
            {seq.levels.map((l, i) => (
              <li
                key={l.unit.id}
                className={`seq-item ${l.blocked ? "seq-blocked" : ""} ${highlightCodes.has(l.unit.code) ? "seq-hi" : ""}`}
              >
                <span className="seq-index">{l.blocked ? "⚠" : i + 1}</span>
                <div className="seq-body">
                  <strong>
                    {l.unit.code || <em className="no-code">未编号</em>}
                    <em>{KIND_LABEL[l.unit.kind]}</em>
                  </strong>
                  <span>
                    顶深 {fmtDepth(l.unit.depthTop)} · {STATUS_LABEL[l.unit.status]}
                    {l.blocked && " · 信息缺失，暂不参与层位"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
