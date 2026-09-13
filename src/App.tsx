import { useMemo, useState } from "react";
import "./styles.css";
import { ROLE_LABEL, type Role } from "./domain";
import { useWorkbench } from "./ui/useWorkbench";
import { UnitForm, RelationForm } from "./ui/Forms";
import { ConflictPanel } from "./ui/Conflicts";
import { StrataGraph } from "./ui/Graph";
import { defaultFilters, type Filters, UnitsPanel } from "./ui/UnitsPanel";
import { SequencePanel } from "./ui/Sequence";
import { StatsBar } from "./ui/StatsBar";

export default function App() {
  const wb = useWorkbench();
  const { state, store, run, role, setRole } = wb;

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [graphSquare, setGraphSquare] = useState<string>("all");
  const [highlightCodes, setHighlightCodes] = useState<Set<string>>(new Set());

  const squares = useMemo(
    () => [...new Set(state.units.map((u) => u.square))].sort(),
    [state.units]
  );
  const effectiveSquare =
    graphSquare !== "all" && squares.includes(graphSquare)
      ? graphSquare
      : squares[0] ?? "all";

  // 筛选探方时，关系图跟随到同一探方
  const onFiltersChange = (f: Filters) => {
    setFilters(f);
    if (f.square !== "all") setGraphSquare(f.square);
  };

  const focusCodes = (codes: string[], square?: string) => {
    setHighlightCodes(new Set(codes));
    if (square && squares.includes(square)) setGraphSquare(square);
    window.setTimeout(() => setHighlightCodes(new Set()), 6000);
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <h1>探方地层关系工作台</h1>
          <p>按探方管理遗迹单位、上下层叠压关系、状态流转与版本档案</p>
        </div>
        <div className="role-switch" role="radiogroup" aria-label="当前角色">
          <span className="role-label">当前角色</span>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={role === r}
              className={`role-btn ${role === r ? "role-on" : ""} ${r === "leader" ? "role-leader" : ""}`}
              onClick={() => setRole(r)}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
          <button
            className="reset-btn"
            title="清空浏览器中的本地数据并重置为示例"
            onClick={() => {
              if (window.confirm("确定清空全部本地记录并恢复示例数据？该操作不可撤销。")) {
                wb.resetAll();
              }
            }}
          >
            重置数据
          </button>
        </div>
      </header>

      {role !== "leader" ? (
        <div className="role-hint">
          当前为「{ROLE_LABEL[role]}」视角：可登记与编辑草稿、退回待复核记录；
          <b>提交复核 / 封存只有领队可执行</b>。
        </div>
      ) : (
        <div className="role-hint role-hint-leader">
          当前为「领队」视角：可推进全部状态流转；封存后记录与关系一律锁定，退回与回退均自动保留版本。
        </div>
      )}

      <StatsBar state={state} />

      <div className="layout-cols">
        <div className="col-main">
          <div className="form-row">
            <UnitForm store={store} run={run} squares={squares} />
            <RelationForm store={store} run={run} units={state.units} />
          </div>

          <section className="panel">
            <header className="panel-head">
              <h2>③ 地层序列与关系图</h2>
              <p>关系变化即时重排；点击冲突记录的「在图中定位」可高亮具体单位与连线</p>
            </header>
            <div className="square-tabs">
              <button
                className={`sq-tab ${effectiveSquare === "all" ? "on" : ""}`}
                onClick={() => setGraphSquare("all")}
              >
                全部分组
              </button>
              {squares.map((s) => (
                <button
                  key={s}
                  className={`sq-tab ${effectiveSquare === s ? "on" : ""}`}
                  onClick={() => setGraphSquare(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            {squares.length === 0 ? (
              <div className="graph-empty">
                <p>暂无探方</p>
                <p className="dim">新增第一个遗迹单位后，这里会出现按探方分组的关系图</p>
              </div>
            ) : effectiveSquare === "all" ? (
              <SequencePanel state={state} activeSquare="all" highlightCodes={highlightCodes} />
            ) : (
              <>
                <StrataGraph
                  state={state}
                  store={store}
                  run={run}
                  square={effectiveSquare}
                  highlightCodes={highlightCodes}
                />
                <SequencePanel
                  state={state}
                  activeSquare={effectiveSquare}
                  highlightCodes={highlightCodes}
                />
              </>
            )}
          </section>

          <UnitsPanel
            state={state}
            store={store}
            run={run}
            role={role}
            filters={filters}
            onFiltersChange={onFiltersChange}
            highlightCodes={highlightCodes}
          />
        </div>

        <aside className="col-side">
          <ConflictPanel state={state} store={store} run={run} focusCodes={focusCodes} />
        </aside>
      </div>

      <footer className="app-foot">
        数据实时保存在本机浏览器（localStorage）：刷新或重开页面后，关系、状态、版本与冲突记录均不丢失。
      </footer>

      <div className="toast-stack" aria-live="polite">
        {wb.toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.ok ? "toast-ok" : "toast-err"}`}
            onClick={() => wb.dismissToast(t.id)}
          >
            {t.ok ? "✓ " : "⛔ "}
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}
