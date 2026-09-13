import type { AppState, ConflictLog, Store } from "../domain";
import { CONFLICT_META, fmtTime } from "./format";
import { EmptyState } from "./widgets";

export function ConflictPanel({
  state,
  store,
  run,
  focusCodes,
}: {
  state: AppState;
  store: Store;
  run: <T extends { ok: boolean }>(fn: () => T) => T;
  focusCodes: (codes: string[], square?: string) => void;
}) {
  const active = [...state.conflicts]
    .filter((c) => !c.dismissed)
    .sort((a, b) => b.at - a.at);
  const dismissed = state.conflicts.filter((c) => c.dismissed).length;

  return (
    <section className="panel panel-conflicts">
      <header className="panel-head">
        <h2>
          冲突拦截记录
          {active.length > 0 && <span className="count-pill">{active.length}</span>}
        </h2>
        <p>所有非法关系与操作在此留痕，可定位到具体单位与环路路径</p>
      </header>
      {active.length === 0 ? (
        <EmptyState
          icon="🛡️"
          title="暂无冲突"
          hint="自指、环路、跨探方、重复编号或坐标出现时会记录在这里"
        />
      ) : (
        <ul className="conflict-list">
          {active.map((c) => (
            <ConflictRow
              key={c.id}
              c={c}
              onLocate={() =>
                focusCodes(
                  [c.upperCode, c.lowerCode, ...(c.cyclePath ?? [])].filter(
                    (v, i, arr): v is string => !!v && arr.indexOf(v) === i
                  ),
                  c.square
                )
              }
              onDismiss={() => run(() => { store.dismissConflict(c.id); return { ok: true }; })}
            />
          ))}
        </ul>
      )}
      {dismissed > 0 && (
        <footer className="panel-foot">
          <span>已忽略 {dismissed} 条</span>
          <button className="btn-link" onClick={() => run(() => { store.clearDismissed(); return { ok: true }; })}>
            清除已忽略
          </button>
        </footer>
      )}
    </section>
  );
}

function ConflictRow({
  c,
  onLocate,
  onDismiss,
}: {
  c: ConflictLog;
  onLocate: () => void;
  onDismiss: () => void;
}) {
  const meta = CONFLICT_META[c.type];
  const locatable =
    !!c.upperCode || !!c.lowerCode || (c.cyclePath?.length ?? 0) > 0;
  return (
    <li className={`conflict-row tone-${meta.tone}`}>
      <div className="conflict-main">
        <div className="conflict-top">
          <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
          {c.square && <span className="conflict-square">{c.square}</span>}
          <span className="conflict-endpoint">
            {c.upperCode && c.lowerCode
              ? `${c.upperCode} → ${c.lowerCode}`
              : c.upperCode ?? c.lowerCode ?? ""}
          </span>
          <time>{fmtTime(c.at)}</time>
        </div>
        <p className="conflict-msg">{c.message}</p>
        {c.cyclePath && (
          <div className="cycle-path">
            <span className="cycle-tag">环路</span>
            {c.cyclePath.map((code, i) => (
              <span key={i} className="cycle-node">
                {i > 0 && <i>→</i>}
                {code}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="conflict-actions">
        {locatable && (
          <button className="btn-mini" onClick={onLocate}>
            在图中定位
          </button>
        )}
        <button className="btn-mini btn-mini-ghost" onClick={onDismiss}>
          忽略
        </button>
      </div>
    </li>
  );
}
