import { useMemo, useState } from "react";
import {
  isUnitBlocked,
  KIND_LABEL,
  STATUS_LABEL,
  type AppState,
  type FeatureKind,
  type FeatureUnit,
  type Role,
  type Store,
  type UnitInput,
  type UnitStatus,
} from "../domain";
import { fmtDepth, fmtTime, statusClass } from "./format";
import { EmptyState, NumInput } from "./widgets";

export interface Filters {
  square: string;
  kind: FeatureKind | "all";
  status: UnitStatus | "all";
  keyword: string;
  blockedOnly: boolean;
}

export const defaultFilters: Filters = {
  square: "all",
  kind: "all",
  status: "all",
  keyword: "",
  blockedOnly: false,
};

export function FilterBar({
  filters,
  onChange,
  squares,
  total,
  shown,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  squares: string[];
  total: number;
  shown: number;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    onChange({ ...filters, [k]: v });
  return (
    <div className="filter-bar">
      <select value={filters.square} onChange={(e) => set("square", e.target.value)}>
        <option value="all">全部探方</option>
        {squares.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select value={filters.kind} onChange={(e) => set("kind", e.target.value as Filters["kind"])}>
        <option value="all">全部类型</option>
        {(Object.keys(KIND_LABEL) as FeatureKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <select value={filters.status} onChange={(e) => set("status", e.target.value as Filters["status"])}>
        <option value="all">全部状态</option>
        <option value="draft">草稿</option>
        <option value="review">待复核</option>
        <option value="sealed">已封存</option>
      </select>
      <input
        className="filter-search"
        placeholder="搜索编号 / 土色 / 备注"
        value={filters.keyword}
        onChange={(e) => set("keyword", e.target.value)}
      />
      <label className="filter-check">
        <input
          type="checkbox"
          checked={filters.blockedOnly}
          onChange={(e) => set("blockedOnly", e.target.checked)}
        />
        仅看阻断
      </label>
      <span className="filter-count">
        {shown}/{total}
      </span>
    </div>
  );
}

export function UnitsPanel({
  state,
  store,
  run,
  role,
  filters,
  onFiltersChange,
  highlightCodes,
}: {
  state: AppState;
  store: Store;
  run: <T extends { ok: boolean }>(fn: () => T) => T;
  role: Role;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  highlightCodes: Set<string>;
}) {
  const [editing, setEditing] = useState<FeatureUnit | null>(null);
  const [historyOf, setHistoryOf] = useState<FeatureUnit | null>(null);

  const squares = useMemo(
    () => [...new Set(state.units.map((u) => u.square))].sort(),
    [state.units]
  );

  const kw = filters.keyword.trim().toUpperCase();
  const shown = state.units.filter((u) => {
    if (filters.square !== "all" && u.square !== filters.square) return false;
    if (filters.kind !== "all" && u.kind !== filters.kind) return false;
    if (filters.status !== "all" && u.status !== filters.status) return false;
    if (filters.blockedOnly && !isUnitBlocked(u)) return false;
    if (
      kw &&
      !`${u.code} ${u.soil} ${u.note}`.toUpperCase().includes(kw)
    )
      return false;
    return true;
  });

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          遗迹单位台账
          <span className="count-pill">{state.units.length}</span>
        </h2>
        <p>筛选、统计与状态即时联动；阻断记录以 ⚠ 标出</p>
      </header>

      <FilterBar
        filters={filters}
        onChange={onFiltersChange}
        squares={squares}
        total={state.units.length}
        shown={shown.length}
      />

      {state.units.length === 0 ? (
        <EmptyState icon="🗂️" title="还没有任何遗迹单位" hint="在左上方「新增遗迹单位」录入第一条记录" />
      ) : shown.length === 0 ? (
        <EmptyState icon="🔎" title="当前筛选没有匹配记录" hint="试试调整探方、类型或关键字条件" />
      ) : (
        <div className="table-wrap">
          <table className="units-table">
            <thead>
              <tr>
                <th>探方</th>
                <th>编号</th>
                <th>类型</th>
                <th>顶深</th>
                <th>底深</th>
                <th>坐标(E,N)</th>
                <th>土色</th>
                <th>状态</th>
                <th className="col-ops">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <UnitRow
                  key={u.id}
                  u={u}
                  role={role}
                  highlight={highlightCodes.has(u.code)}
                  store={store}
                  run={run}
                  onEdit={() => setEditing(u)}
                  onHistory={() => setHistoryOf(u)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal
          unit={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            const r = run(() => store.editUnit(editing.id, patch));
            if (r.ok) setEditing(null);
          }}
        />
      )}
      {historyOf && (
        <HistoryModal
          state={state}
          unit={historyOf}
          onClose={() => setHistoryOf(null)}
          onRollback={(versionId) =>
            run(() => store.rollback(historyOf.id, versionId))
          }
        />
      )}
    </section>
  );
}

function UnitRow({
  u,
  role,
  highlight,
  store,
  run,
  onEdit,
  onHistory,
}: {
  u: FeatureUnit;
  role: Role;
  highlight: boolean;
  store: Store;
  run: <T extends { ok: boolean }>(fn: () => T) => T;
  onEdit: () => void;
  onHistory: () => void;
}) {
  const blocked = isUnitBlocked(u);
  const isLeader = role === "leader";
  return (
    <tr className={`${blocked ? "row-blocked" : ""} ${highlight ? "row-hi" : ""}`}>
      <td data-label="探方">{u.square}</td>
      <td className="cell-code" data-label="编号">
        {u.code || <em className="no-code">未编号（阻断）</em>}
        {blocked && <span className="blocked-tag" title="缺编号或深度，阻断">⚠ 阻断</span>}
      </td>
      <td data-label="类型">{KIND_LABEL[u.kind]}</td>
      <td data-label="顶深" className={u.depthTop === null ? "dim-cell" : ""}>{fmtDepth(u.depthTop)}</td>
      <td data-label="底深">{fmtDepth(u.depthBottom)}</td>
      <td data-label="坐标">{u.x === null || u.y === null ? "—" : `${u.x}, ${u.y}`}</td>
      <td data-label="土色" className="cell-soil">{u.soil || "—"}</td>
      <td data-label="状态">
        <span className={`status-badge ${statusClass(u.status)}`}>
          {STATUS_LABEL[u.status]}
        </span>
      </td>
      <td className="col-ops" data-label="操作">
        <div className="row-ops">
          {u.status === "draft" && (
            <>
              <button className="btn-mini" onClick={onEdit} title="编辑草稿">
                编辑
              </button>
              <button
                className="btn-mini"
                disabled={!isLeader}
                title={isLeader ? "提交复核" : "只有领队可推进状态"}
                onClick={() => run(() => store.transition(u.id, "review", role))}
              >
                提交复核
              </button>
              <button className="btn-mini btn-mini-danger" onClick={() => run(() => store.deleteUnit(u.id))}>
                删除
              </button>
            </>
          )}
          {u.status === "review" && (
            <>
              {isLeader ? (
                <button className="btn-mini btn-seal" onClick={() => run(() => store.transition(u.id, "sealed", role))}>
                  封存
                </button>
              ) : (
                <button className="btn-mini" disabled title="只有领队可封存">
                  封存
                </button>
              )}
              <button
                className="btn-mini btn-mini-ghost"
                onClick={() => run(() => store.transition(u.id, "draft", role))}
                title="退回草稿（自动保留版本）"
              >
                退回草稿
              </button>
            </>
          )}
          {u.status === "sealed" &&
            (isLeader ? (
              <button
                className="btn-mini"
                onClick={() => run(() => store.transition(u.id, "draft", role))}
                title="领队将封存记录退回草稿（封存前版本自动保留，退回后可编辑）"
              >
                退回草稿
              </button>
            ) : (
              <button className="btn-mini" disabled title="只有领队可将封存记录退回草稿">
                退回草稿
              </button>
            ))}
          {u.status === "sealed" && <span className="sealed-note">封存锁定</span>}
          <button className="btn-mini btn-mini-ghost" onClick={onHistory} title="查看版本">
            版本
          </button>
        </div>
      </td>
    </tr>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function EditModal({
  unit,
  onClose,
  onSave,
}: {
  unit: FeatureUnit;
  onClose: () => void;
  onSave: (patch: Partial<UnitInput>) => void;
}) {
  const [f, setF] = useState<UnitInput>({
    code: unit.code,
    square: unit.square,
    kind: unit.kind,
    depthTop: unit.depthTop,
    depthBottom: unit.depthBottom,
    x: unit.x,
    y: unit.y,
    soil: unit.soil,
    note: unit.note,
  });
  const set = <K extends keyof UnitInput>(k: K, v: UnitInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  return (
    <ModalShell title={`编辑草稿 ${unit.square} · ${unit.code}`} onClose={onClose}>
      <div className="form-grid">
        <label>
          <span>探方编号 *</span>
          <input value={f.square} onChange={(e) => set("square", e.target.value)} />
        </label>
        <label>
          <span>遗迹编号 *</span>
          <input value={f.code} onChange={(e) => set("code", e.target.value)} />
        </label>
        <label>
          <span>类型</span>
          <select value={f.kind} onChange={(e) => set("kind", e.target.value as FeatureKind)}>
            {(Object.keys(KIND_LABEL) as FeatureKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>顶层深度 (m) *</span>
          <NumInput value={f.depthTop} onValue={(v) => set("depthTop", v)} />
        </label>
        <label>
          <span>底部深度 (m)</span>
          <NumInput value={f.depthBottom} onValue={(v) => set("depthBottom", v)} />
        </label>
        <label>
          <span>坐标 E</span>
          <NumInput value={f.x} onValue={(v) => set("x", v)} />
        </label>
        <label>
          <span>坐标 N</span>
          <NumInput value={f.y} onValue={(v) => set("y", v)} />
        </label>
        <label className="span-2">
          <span>土色 / 质地</span>
          <input value={f.soil} onChange={(e) => set("soil", e.target.value)} />
        </label>
        <label className="span-2">
          <span>备注</span>
          <input value={f.note} onChange={(e) => set("note", e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <button className="btn-primary" onClick={() => onSave(f)}>
          保存修改
        </button>
        <button className="btn-ghost" onClick={onClose}>
          取消
        </button>
      </div>
    </ModalShell>
  );
}

function HistoryModal({
  state,
  unit,
  onClose,
  onRollback,
}: {
  state: AppState;
  unit: FeatureUnit;
  onClose: () => void;
  onRollback: (versionId: string) => void;
}) {
  const versions = state.versions
    .filter((v) => v.unitId === unit.id)
    .sort((a, b) => b.at - a.at);
  const sealed = unit.status === "sealed";

  return (
    <ModalShell title={`版本历史 ${unit.square} · ${unit.code}`} onClose={onClose}>
      <p className="modal-note">
        建档、提交复核、退回草稿、封存、封存退回与版本回退均留存版本；回退会把所选内容恢复为新草稿，且不删除任何旧版本。
        {sealed && " 该单位已封存，领队需先在台账中执行「退回草稿」，才能编辑或回退。"}
      </p>
      <ul className="version-list">
        {versions.map((v) => (
          <li key={v.id} className="version-row">
            <div className="version-info">
              <span className={`version-reason vr-${v.reason}`}>{v.label}</span>
              <time>{fmtTime(v.at)}</time>
              <p className="version-data">
                {v.data.code} · 顶深 {fmtDepth(v.data.depthTop)} ·{" "}
                {STATUS_LABEL[v.data.status]}
                {v.data.note ? ` · ${v.data.note}` : ""}
              </p>
            </div>
            {v.reason !== "create" && !sealed && (
              <button
                className="btn-mini"
                onClick={() => onRollback(v.id)}
                title="恢复该版本为新草稿"
              >
                回退到此版本
              </button>
            )}
            {sealed && <span className="sealed-note">封存中</span>}
          </li>
        ))}
      </ul>
    </ModalShell>
  );
}
