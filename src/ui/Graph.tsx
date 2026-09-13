import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSequences,
  isUnitBlocked,
  KIND_LABEL,
  STATUS_LABEL,
  type AppState,
  type FeatureUnit,
  type Store,
} from "../domain";

const NODE_W = 176;
const NODE_H = 58;
const GAP_Y = 36;
const PAD = 24;

/** 按序列顺序自上而下布局；同层并列时水平排列 */
function layout(state: AppState, square: string, highlightCodes: Set<string>) {
  const seq = buildSequences(state).find((s) => s.square === square);
  if (!seq) return { nodes: [], edges: [], height: 120, width: 320 };

  const ids = state.units.filter((u) => u.square === square).map((u) => u.id);
  const rels = state.relations.filter(
    (r) => ids.includes(r.upperId) && ids.includes(r.lowerId)
  );

  const orderIndex = new Map(seq.levels.map((l, i) => [l.unit.id, i]));
  const rows = new Map<number, FeatureUnit[]>();
  for (const l of seq.levels) {
    const k = orderIndex.get(l.unit.id)!;
    rows.set(k, [...(rows.get(k) ?? []), l.unit]);
  }
  const maxRowSize = Math.max(1, ...[...rows.values()].map((r) => r.length));
  const width = Math.max(300, maxRowSize * (NODE_W + 40) + PAD * 2);

  const nodes = seq.levels.map((l) => {
    const rowIdx = orderIndex.get(l.unit.id)!;
    const peers = rows.get(rowIdx)!;
    const col = peers.findIndex((u) => u.id === l.unit.id);
    const rowWidth = peers.length * (NODE_W + 40) - 40;
    const x = width / 2 - rowWidth / 2 + col * (NODE_W + 40);
    const y = PAD + rowIdx * (NODE_H + GAP_Y);
    return { unit: l.unit, x, y, blocked: l.blocked };
  });

  const pos = new Map(nodes.map((n) => [n.unit.id, n]));
  const edges = rels
    .map((r) => {
      const a = pos.get(r.upperId);
      const b = pos.get(r.lowerId);
      if (!a || !b) return null;
      return {
        id: r.id,
        x1: a.x + NODE_W / 2,
        y1: a.y + NODE_H,
        x2: b.x + NODE_W / 2,
        y2: b.y,
        hot: highlightCodes.has(a.unit.code) && highlightCodes.has(b.unit.code),
      };
    })
    .filter((e): e is NonNullable<typeof e> => !!e);

  const height = PAD * 2 + seq.levels.length * (NODE_H + GAP_Y) - GAP_Y;
  return { nodes, edges, height, width, cyclic: seq.cyclic };
}

/** 测量容器宽度：关系图整体按比例缩放适配，任何屏宽都不出现横向滚动 */
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: w };
}

export function StrataGraph({
  state,
  store,
  run,
  square,
  highlightCodes,
}: {
  state: AppState;
  store: Store;
  run: <T extends { ok: boolean }>(fn: () => T) => T;
  square: string;
  highlightCodes: Set<string>;
}) {
  const { ref, width: containerW } = useContainerWidth<HTMLDivElement>();
  const { nodes, edges, height, width, cyclic } = useMemo(
    () => layout(state, square, highlightCodes),
    [state, square, highlightCodes]
  );

  if (nodes.length === 0) {
    return (
      <div className="graph-empty">
        <p>探方 {square} 暂无遗迹单位</p>
        <p className="dim">在上方录入第一条记录后，关系图会即时出现</p>
      </div>
    );
  }

  // 容器比图窄时整体缩放（而不是横向滚动）；宽度足够时保持原尺寸
  const scale = containerW > 0 && width > containerW ? containerW / width : 1;
  const shownH = height * scale;

  return (
    <div className="graph-wrap" ref={ref}>
      {containerW > 0 && (
        <div
          className="graph-scale"
          style={{ width, height: shownH }}
        >
          <svg
            className="strata-svg"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#854d0e" />
              </marker>
              <marker id="arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
              </marker>
            </defs>

            {edges.map((e) => (
              <g key={e.id} className={`edge-group${e.hot ? " edge-hot" : ""}`}>
                <line
                  x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2 - 4}
                  className="edge-line"
                  markerEnd={e.hot ? "url(#arrow-hi)" : "url(#arrow)"}
                />
                <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2 - 4} className="edge-hit" />
                <g
                  className="edge-del"
                  transform={`translate(${(e.x1 + e.x2) / 2}, ${(e.y1 + e.y2) / 2})`}
                  onClick={() => run(() => store.removeRelation(e.id))}
                >
                  <title>删除该关系</title>
                  <circle r="11" />
                  <text textAnchor="middle" dy="4">×</text>
                </g>
              </g>
            ))}

            {nodes.map((n) => {
              const u = n.unit;
              const blocked = isUnitBlocked(u);
              const hi = u.code ? highlightCodes.has(u.code) : false;
              return (
                <g
                  key={u.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  className={`node-group node-${u.status} ${hi ? "node-hi" : ""} ${blocked ? "node-blocked" : ""}`}
                >
                  <rect width={NODE_W} height={NODE_H} rx="8" />
                  <text className="node-code" x="12" y="22">
                    {u.code || "未编号"}
                    {blocked && " ⚠"}
                  </text>
                  <text className="node-meta" x="12" y="42">
                    {KIND_LABEL[u.kind]} · {u.depthTop === null ? "深度缺失" : `${u.depthTop}m`} · {STATUS_LABEL[u.status]}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {cyclic && (
        <p className="cyclic-warning">
          ⚠ 该探方关系存在环路（正常录入会被拦截，此为存量异常提示）
        </p>
      )}
      <p className="graph-hint">箭头由上层指向下层（晚 → 早）；悬停连线点击 × 删除关系（封存端点除外）</p>
    </div>
  );
}
