// 探方地层关系工作台 —— 领域类型定义

/** 记录生命周期状态 */
export type UnitStatus = "draft" | "review" | "sealed";
/** 草稿 / 待复核 / 已封存 */
export const STATUS_LABEL: Record<UnitStatus, string> = {
  draft: "草稿",
  review: "待复核",
  sealed: "已封存",
};

/** 当前操作者角色 */
export type Role = "worker" | "leader" | "curator";
export const ROLE_LABEL: Record<Role, string> = {
  worker: "发掘队员",
  leader: "领队",
  curator: "资料整理员",
};

/** 遗迹类型 */
export type FeatureKind =
  | "layer"
  | "pit"
  | "tomb"
  | "house"
  | "ditch"
  | "other";
export const KIND_LABEL: Record<FeatureKind, string> = {
  layer: "地层",
  pit: "灰坑",
  tomb: "墓葬",
  house: "房址",
  ditch: "沟状遗迹",
  other: "其他",
};

/** 遗迹单位 */
export interface FeatureUnit {
  id: string;
  /** 遗迹编号，如 H12；同探方内不可重复 */
  code: string;
  /** 所属探方，如 T0203 */
  square: string;
  kind: FeatureKind;
  /** 顶部深度（米，正数）；缺失即为阻断记录 */
  depthTop: number | null;
  /** 底部深度（米，选填） */
  depthBottom: number | null;
  /** 平面坐标，选填；同探方内不可重复占用 */
  x: number | null;
  y: number | null;
  soil: string;
  note: string;
  status: UnitStatus;
  createdAt: number;
  updatedAt: number;
}

/** 版本快照：封存与退回草稿都必须保留版本 */
export interface VersionSnapshot {
  id: string;
  unitId: string;
  /** 触发版本留存的动作 */
  reason: "submit" | "seal" | "reject" | "rollback" | "create";
  label: string;
  at: number;
  data: FeatureUnit;
}

/**
 * 上下层关系：upperId 叠压 lowerId（上层晚于下层）
 * 仅允许同探方、禁止自指与环路、同一有序对不可重复
 */
export interface Relation {
  id: string;
  upperId: string;
  lowerId: string;
  square: string;
  createdAt: number;
}

export type ConflictType =
  | "SELF_REFERENCE"
  | "CROSS_SQUARE"
  | "DUPLICATE_RELATION"
  | "REVERSE_EXISTS"
  | "CYCLE"
  | "MISSING_ENDPOINT"
  | "BLOCKED_ENDPOINT"
  | "DUPLICATE_CODE"
  | "DUPLICATE_COORD"
  | "MISSING_CODE"
  | "MISSING_SQUARE"
  | "SEALED_UNIT"
  | "INVALID_DEPTH"
  | "BLOCKED_UNIT"
  | "NOT_LEADER"
  | "BAD_TRANSITION"
  | "RELATION_TOUCHES_SEALED"
  | "RELATION_EXISTS_CROSS"
  | "DRAFT_ONLY"
  | "ROLLBACK_DUPLICATE"
  | "NOT_FOUND";

/** 被拦截的非法关系 / 操作 */
export interface ConflictLog {
  id: string;
  at: number;
  type: ConflictType;
  /** 可读说明 */
  message: string;
  /** 涉及的关系端点（编号），便于在列表与图中定位 */
  upperCode?: string;
  lowerCode?: string;
  square?: string;
  /** 环路定位：从起点回到起点的编号序列，如 ["H1","H3","H2","H1"] */
  cyclePath?: string[];
  dismissed: boolean;
}

export interface AppState {
  version: number;
  units: FeatureUnit[];
  relations: Relation[];
  versions: VersionSnapshot[];
  conflicts: ConflictLog[];
  seededAt: number | null;
}

export interface UnitInput {
  code: string;
  square: string;
  kind: FeatureKind;
  depthTop: number | null;
  depthBottom: number | null;
  x: number | null;
  y: number | null;
  soil: string;
  note: string;
}

export interface ActionContext {
  now: number;
  /** 可注入的 id 生成器（测试用确定性序列） */
  idCounter: { n: number };
}

export type StepResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; type: ConflictType; message: string };

export interface Store {
  getState(): AppState;
  addUnit(input: Partial<UnitInput>): StepResult<{ unitId: string }>;
  editUnit(id: string, patch: Partial<UnitInput>): StepResult;
  deleteUnit(id: string): StepResult;
  addRelation(upperId: string, lowerId: string): StepResult<{ relationId: string }>;
  removeRelation(id: string): StepResult;
  /** 推进 / 退回状态，仅领队可推进 */
  transition(
    id: string,
    to: UnitStatus,
    role: Role
  ): StepResult<{ snapshotId: string }>;
  /** 把草稿回退到某个历史版本；回退本身也生成版本，原版本链不删 */
  rollback(unitId: string, versionId: string): StepResult<{ snapshotId: string }>;
  dismissConflict(id: string): void;
  clearDismissed(): void;
}

export const STATE_KEY = "strata-workbench:v1";
