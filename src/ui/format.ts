import { STATUS_LABEL, type ConflictType, type UnitStatus } from "../domain";

export function fmtTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export function fmtDepth(v: number | null): string {
  return v === null ? "缺失" : `${v.toFixed(2)}m`;
}

export const CONFLICT_META: Record<
  ConflictType,
  { label: string; tone: "danger" | "warn" }
> = {
  SELF_REFERENCE: { label: "自指", tone: "danger" },
  CROSS_SQUARE: { label: "跨探方", tone: "danger" },
  DUPLICATE_RELATION: { label: "重复关系", tone: "warn" },
  REVERSE_EXISTS: { label: "反向冲突", tone: "danger" },
  CYCLE: { label: "地层环路", tone: "danger" },
  MISSING_ENDPOINT: { label: "端点缺失", tone: "danger" },
  BLOCKED_ENDPOINT: { label: "阻断端点", tone: "warn" },
  DUPLICATE_CODE: { label: "编号重复", tone: "warn" },
  DUPLICATE_COORD: { label: "坐标重复", tone: "warn" },
  MISSING_CODE: { label: "缺编号", tone: "danger" },
  MISSING_SQUARE: { label: "缺探方", tone: "danger" },
  SEALED_UNIT: { label: "封存禁改", tone: "warn" },
  INVALID_DEPTH: { label: "深度非法", tone: "danger" },
  BLOCKED_UNIT: { label: "阻断记录", tone: "warn" },
  NOT_LEADER: { label: "权限不足", tone: "warn" },
  BAD_TRANSITION: { label: "非法状态跳转", tone: "warn" },
  RELATION_TOUCHES_SEALED: { label: "封存端点", tone: "warn" },
  RELATION_EXISTS_CROSS: { label: "跨探方关系", tone: "danger" },
  DRAFT_ONLY: { label: "仅草稿可操作", tone: "warn" },
  ROLLBACK_DUPLICATE: { label: "回退冲突", tone: "danger" },
  NOT_FOUND: { label: "目标不存在", tone: "warn" },
};

export const STATUS_ORDER: UnitStatus[] = ["draft", "review", "sealed"];

export function statusClass(s: UnitStatus): string {
  return `st-${s}`;
}

export { STATUS_LABEL };
