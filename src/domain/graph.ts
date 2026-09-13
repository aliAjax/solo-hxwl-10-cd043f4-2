// 图算法：阻断判定、关系冲突、环路定位、按探方拓扑生成地层序列
import type {
  AppState,
  ConflictType,
  FeatureUnit,
  Relation,
} from "./types";

export interface GraphIssue {
  type: ConflictType;
  message: string;
  upperId?: string;
  lowerId?: string;
  cyclePath?: string[];
}

/** 阻断记录：编号、探方、深度（顶层深度）任一缺失，或深度数值非法 */
export function isUnitBlocked(u: FeatureUnit): boolean {
  if (!u.code.trim() || !u.square.trim()) return true;
  if (u.depthTop === null || !Number.isFinite(u.depthTop)) return true;
  if (u.depthTop < 0) return true;
  if (
    u.depthBottom !== null &&
    (u.depthBottom < u.depthTop || !Number.isFinite(u.depthBottom))
  ) {
    return true;
  }
  return false;
}

export function unitKey(u: { code: string; square: string }): string {
  return `${u.square.trim()}::${u.code.trim().toUpperCase()}`;
}

export function coordKey(u: {
  square: string;
  x: number | null;
  y: number | null;
}): string | null {
  if (u.x === null || u.y === null) return null;
  return `${u.square.trim()}@${round(u.x)},${round(u.y)}`;
}

function round(n: number): string {
  // 坐标按 1cm 精度判重，规避浮点尾差
  return String(Math.round(n * 100) / 100);
}

function byId(state: AppState, id: string): FeatureUnit | undefined {
  return state.units.find((u) => u.id === id);
}

/**
 * 校验一条“待新增”的上下层关系，返回冲突列表（空数组表示通过）。
 * 校验顺序即定位优先级：端点 → 阻断 → 自指 → 跨探方 → 重复 → 环路。
 */
export function validateRelation(
  state: AppState,
  upperId: string,
  lowerId: string
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const upper = byId(state, upperId);
  const lower = byId(state, lowerId);

  if (!upper || !lower) {
    issues.push({
      type: "MISSING_ENDPOINT",
      message: "关系端点不存在，请先新增对应的遗迹单位",
      upperId,
      lowerId,
    });
    return issues;
  }

  if (isUnitBlocked(upper) || isUnitBlocked(lower)) {
    const bad = isUnitBlocked(upper) ? upper : lower;
    issues.push({
      type: "BLOCKED_ENDPOINT",
      message: `端点「${bad.code || "未编号"}」信息不完整（缺编号或深度），属于阻断记录，暂不能建立关系`,
      upperId: upper.id,
      lowerId: lower.id,
    });
  }

  if (upperId === lowerId) {
    issues.push({
      type: "SELF_REFERENCE",
      message: `遗迹「${upper.code}」不能与自身构成上下层关系（自指）`,
      upperId: upper.id,
      lowerId: lower.id,
    });
    return issues; // 自指之后无需再查
  }

  if (upper.square.trim() !== lower.square.trim()) {
    issues.push({
      type: "CROSS_SQUARE",
      message: `跨探方关系被拦截：「${upper.code}」属 ${upper.square}，「${lower.code}」属 ${lower.square}，上下层关系只允许在同一探方内建立`,
      upperId: upper.id,
      lowerId: lower.id,
    });
  }

  const dup = state.relations.find(
    (r) => r.upperId === upperId && r.lowerId === lowerId
  );
  if (dup) {
    issues.push({
      type: "DUPLICATE_RELATION",
      message: `重复关系：「${upper.code}」叠压「${lower.code}」已存在`,
      upperId: upper.id,
      lowerId: lower.id,
    });
  }
  const rev = state.relations.find(
    (r) => r.upperId === lowerId && r.lowerId === upperId
  );
  if (rev) {
    issues.push({
      type: "REVERSE_EXISTS",
      message: `冲突关系：已存在反向叠压「${lower.code} → ${upper.code}」，二者不能同时成立`,
      upperId: upper.id,
      lowerId: lower.id,
    });
  }

  // 环路：试探性加入后在同探方子图内 DFS
  const trial: Relation = {
    id: "__trial__",
    upperId,
    lowerId,
    square: upper.square,
    createdAt: 0,
  };
  const cycle = findCycle([...state.relations, trial], upperId, (id) =>
    byId(state, id)?.square === upper.square
  );
  if (cycle) {
    issues.push({
      type: "CYCLE",
      message: `地层环路被拦截：${cycle
        .map((id) => byId(state, id)?.code ?? "?")
        .join(" → ")}，叠压关系必须由上至下无环`,
      upperId: upper.id,
      lowerId: lower.id,
      cyclePath: cycle.map((id) => byId(state, id)?.code ?? "?"),
    });
  }

  return issues;
}

/**
 * 在关系图中从 startId 出发找环（DFS）。
 * 边方向 upper → lower；新增边 startUpper→lower 后，若 lower 能沿现有边回到 startUpper 即成环。
 * 返回包含首尾同一节点的编号 id 路径，无环返回 null。
 */
export function findCycle(
  relations: Relation[],
  startId: string,
  inScope: (id: string) => boolean = () => true
): string[] | null {
  const adj = new Map<string, string[]>();
  for (const r of relations) {
    if (!inScope(r.upperId) || !inScope(r.lowerId)) continue;
    const list = adj.get(r.upperId) ?? [];
    list.push(r.lowerId);
    adj.set(r.upperId, list);
  }
  const stack: string[] = [];
  const onStack = new Set<string>();

  function dfs(node: string): string[] | null {
    stack.push(node);
    onStack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (next === startId && stack.length >= 1) {
        return [...stack, startId];
      }
      if (!onStack.has(next)) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    onStack.delete(node);
    stack.pop();
    return null;
  }

  return dfs(startId);
}

/** 对整张图做一次全量环路体检，返回任意一条环（用于存量数据自检） */
export function findAnyCycle(state: AppState): string[] | null {
  const seen = new Set<string>();
  for (const r of state.relations) {
    if (seen.has(r.upperId)) continue;
    const path = findCycle(state.relations, r.upperId);
    if (path) return path;
    seen.add(r.upperId);
  }
  return null;
}

export interface SequenceLevel {
  unit: FeatureUnit;
  /** 0 = 最上层；深度越大层位越下 */
  level: number;
  blocked: boolean;
}
export interface SquareSequence {
  square: string;
  levels: SequenceLevel[];
  /** 该探方内关系是否成环（正常数据下不应出现，因新增已拦截） */
  cyclic: boolean;
}

/**
 * 按探方分组生成地层序列。
 * 同一探方内：拓扑序（上层→下层）；无关系连接的单位，按顶层深度降序兜底；
 * 被阻断的单位不参与拓扑排序，单列在序列末尾。
 */
export function buildSequences(state: AppState): SquareSequence[] {
  const squares = [
    ...new Set(state.units.map((u) => u.square.trim()).filter(Boolean)),
  ].sort();

  return squares.map((square) => {
    const inSquare = state.units.filter((u) => u.square.trim() === square);
    const good = inSquare.filter((u) => !isUnitBlocked(u));
    const blocked = inSquare.filter(isUnitBlocked);
    const goodIds = new Set(good.map((u) => u.id));
    const rels = state.relations.filter(
      (r) => goodIds.has(r.upperId) && goodIds.has(r.lowerId)
    );

    // Kahn 拓扑
    const indeg = new Map<string, number>(good.map((u) => [u.id, 0]));
    const adj = new Map<string, string[]>();
    for (const r of rels) {
      adj.set(r.upperId, [...(adj.get(r.upperId) ?? []), r.lowerId]);
      indeg.set(r.lowerId, (indeg.get(r.lowerId) ?? 0) + 1);
    }
    const depthOf = (id: string): number => {
      const u = good.find((x) => x.id === id);
      return u?.depthTop ?? 0;
    };
    const order: string[] = [];
    // 同层候选：入度 0，优先顶层深度小（更靠地表 = 更上层）
    let frontier = good
      .filter((u) => (indeg.get(u.id) ?? 0) === 0)
      .map((u) => u.id);
    const consumed = new Set<string>();
    while (frontier.length) {
      frontier.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
      const id = frontier.shift()!;
      if (consumed.has(id)) continue;
      consumed.add(id);
      order.push(id);
      for (const nxt of adj.get(id) ?? []) {
        const d = (indeg.get(nxt) ?? 0) - 1;
        indeg.set(nxt, d);
        if (d === 0) frontier.push(nxt);
      }
    }

    const cyclic = order.length !== good.length;
    if (cyclic) {
      // 成环时剩余单位用深度兜底，保证仍可展示
      for (const u of good) {
        if (!consumed.has(u.id)) order.push(u.id);
      }
      order.sort(
        (a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b)
      );
    }

    const byIdMap = new Map(inSquare.map((u) => [u.id, u]));
    const levels: SequenceLevel[] = order.map((id, i) => ({
      unit: byIdMap.get(id)!,
      level: i,
      blocked: false,
    }));
    blocked
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((u) =>
        levels.push({ unit: u, level: levels.length, blocked: true })
      );

    return { square, levels, cyclic };
  });
}
