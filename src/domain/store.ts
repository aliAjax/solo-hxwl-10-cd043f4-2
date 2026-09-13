// 工作台 Store：唯一数据入口，所有非法操作在此拦截并写入冲突日志
import {
  type AppState,
  type ConflictLog,
  type ConflictType,
  type FeatureUnit,
  type Role,
  type Store,
  type UnitInput,
  type UnitStatus,
  type VersionSnapshot,
} from "./types";
import {
  buildSequences,
  coordKey,
  isUnitBlocked,
  unitKey,
  validateRelation,
} from "./graph";

export function createInitialState(now = 0): AppState {
  return {
    version: 1,
    units: [],
    relations: [],
    versions: [],
    conflicts: [],
    seededAt: now || null,
  };
}

function nextId(prefix: string, ctx: { n: number }): string {
  ctx.n += 1;
  return `${prefix}_${ctx.n.toString(36)}`;
}

const blankInput: UnitInput = {
  code: "",
  square: "",
  kind: "layer",
  depthTop: null,
  depthBottom: null,
  x: null,
  y: null,
  soil: "",
  note: "",
};

export function normalizeInput(
  input: Partial<UnitInput>
): UnitInput {
  return {
    ...blankInput,
    ...input,
    code: (input.code ?? "").trim(),
    square: (input.square ?? "").trim().toUpperCase(),
    soil: (input.soil ?? "").trim(),
    note: (input.note ?? "").trim(),
  };
}

export interface StoreOptions {
  now?: () => number;
  onChange?: (state: AppState) => void;
}

export function createStore(
  initial?: AppState,
  opts: StoreOptions = {}
): Store {
  const nowFn = opts.now ?? (() => Date.now());
  const ctx = { n: Math.floor(nowFn() % 1_000_000) };
  let state: AppState = initial
    ? structuredCloneSafe(initial)
    : createInitialState(nowFn());

  const emit = () => opts.onChange?.(state);

  function logConflict(
    c: Omit<ConflictLog, "id" | "at" | "dismissed">
  ): ConflictLog {
    const entry: ConflictLog = {
      ...c,
      id: nextId("cf", ctx),
      at: nowFn(),
      dismissed: false,
    };
    state = { ...state, conflicts: [...state.conflicts, entry] };
    return entry;
  }

  function fail(
    type: ConflictType,
    message: string,
    meta?: Omit<
      ConflictLog,
      "id" | "at" | "dismissed" | "type" | "message"
    >
  ): { ok: false; type: ConflictType; message: string } {
    logConflict({ type, message, ...meta });
    emit();
    return { ok: false, type, message };
  }

  function snapshot(
    unit: FeatureUnit,
    reason: VersionSnapshot["reason"],
    label: string
  ): VersionSnapshot {
    return {
      id: nextId("sv", ctx),
      unitId: unit.id,
      reason,
      label,
      at: nowFn(),
      data: JSON.parse(JSON.stringify(unit)) as FeatureUnit,
    };
  }

  function validateUnitFields(
    input: UnitInput,
    selfId?: string
  ):
    | { ok: true }
    | { ok: false; type: ConflictType; message: string } {
    if (!input.square) {
      return {
        ok: false,
        type: "MISSING_SQUARE",
        message: "缺少探方编号，无法登记遗迹单位（阻断）",
      };
    }
    if (!input.code) {
      return {
        ok: false,
        type: "MISSING_CODE",
        message: "缺少遗迹编号，该记录将无法进入地层序列（阻断），请补全后再提交",
      };
    }
    if (
      input.depthTop !== null &&
      (!Number.isFinite(input.depthTop) || input.depthTop < 0)
    ) {
      return {
        ok: false,
        type: "INVALID_DEPTH",
        message: "顶层深度必须是不小于 0 的数字（米）",
      };
    }
    if (
      input.depthBottom !== null &&
      (!Number.isFinite(input.depthBottom) ||
        input.depthBottom < (input.depthTop ?? 0))
    ) {
      return {
        ok: false,
        type: "INVALID_DEPTH",
        message: "底部深度非法：必须为不小于顶层深度的数字",
      };
    }
    const dupCode = state.units.find(
      (u) =>
        u.id !== selfId &&
        unitKey(u) === unitKey({ code: input.code, square: input.square })
    );
    if (dupCode) {
      return {
        ok: false,
        type: "DUPLICATE_CODE",
        message: `编号重复：探方 ${input.square} 内已存在遗迹「${input.code}」`,
      };
    }
    const ck = coordKey({
      square: input.square,
      x: input.x,
      y: input.y,
    });
    if (ck) {
      const dupCoord = state.units.find(
        (u) => u.id !== selfId && coordKey(u) === ck
      );
      if (dupCoord) {
        return {
          ok: false,
          type: "DUPLICATE_COORD",
          message: `坐标重复：探方 ${input.square} 的坐标 (${input.x}, ${input.y}) 已被遗迹「${dupCoord.code}」占用`,
        };
      }
    }
    return { ok: true };
  }

  const store: Store = {
    getState: () => state,

    addUnit(raw) {
      const input = normalizeInput(raw);
      const checked = validateUnitFields(input);
      if (!checked.ok) {
        return fail(checked.type, checked.message, {
          square: input.square || undefined,
        });
      }
      const now = nowFn();
      const unit: FeatureUnit = {
        id: nextId("u", ctx),
        ...input,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      const sv = snapshot(unit, "create", "建档（草稿 v1）");
      state = {
        ...state,
        units: [...state.units, unit],
        versions: [...state.versions, sv],
      };
      emit();
      // 信息不完整仍允许建档，但直接标记说明（阻断单位不进序列）
      if (isUnitBlocked(unit)) {
        logConflict({
          type: "BLOCKED_UNIT",
          message: `遗迹「${unit.code}」深度缺失，已登记为阻断记录：补齐深度前不能建立关系或提交复核`,
          upperCode: unit.code,
          square: unit.square,
        });
        emit();
      }
      return { ok: true, unitId: unit.id };
    },

    editUnit(id, patch) {
      const unit = state.units.find((u) => u.id === id);
      if (!unit)
        return fail("NOT_FOUND", "要修改的遗迹单位不存在");
      if (unit.status === "sealed")
        return fail(
          "SEALED_UNIT",
          `遗迹「${unit.code}」已封存，禁止任何改动；如需更正请由领队退回草稿（将保留版本）`,
          { upperCode: unit.code, square: unit.square }
        );

      const merged = normalizeInput({
        code: patch.code ?? unit.code,
        square: patch.square ?? unit.square,
        kind: patch.kind ?? unit.kind,
        depthTop:
          patch.depthTop === undefined ? unit.depthTop : patch.depthTop,
        depthBottom:
          patch.depthBottom === undefined
            ? unit.depthBottom
            : patch.depthBottom,
        x: patch.x === undefined ? unit.x : patch.x,
        y: patch.y === undefined ? unit.y : patch.y,
        soil: patch.soil ?? unit.soil,
        note: patch.note ?? unit.note,
      });
      const checked = validateUnitFields(merged, id);
      if (!checked.ok)
        return fail(checked.type, checked.message, {
          square: merged.square,
        });

      const next: FeatureUnit = {
        ...unit,
        ...merged,
        updatedAt: nowFn(),
      };
      state = {
        ...state,
        units: state.units.map((u) => (u.id === id ? next : u)),
      };
      emit();
      return { ok: true };
    },

    deleteUnit(id) {
      const unit = state.units.find((u) => u.id === id);
      if (!unit) return fail("NOT_FOUND", "要删除的遗迹单位不存在");
      if (unit.status === "sealed")
        return fail(
          "SEALED_UNIT",
          `遗迹「${unit.code}」已封存，禁止删除`,
          { upperCode: unit.code, square: unit.square }
        );
      const linked = state.relations.filter(
        (r) => r.upperId === id || r.lowerId === id
      );
      if (linked.length)
        return fail(
          "RELATION_TOUCHES_SEALED",
          `遗迹「${unit.code}」仍连接 ${linked.length} 条上下层关系，请先删除关系`,
          { upperCode: unit.code, square: unit.square }
        );
      state = {
        ...state,
        units: state.units.filter((u) => u.id !== id),
        versions: state.versions.filter((v) => v.unitId !== id),
      };
      emit();
      return { ok: true };
    },

    addRelation(upperId, lowerId) {
      const upper = state.units.find((u) => u.id === upperId);
      const lower = state.units.find((u) => u.id === lowerId);
      if (upper?.status === "sealed" || lower?.status === "sealed") {
        const sealedOne = upper?.status === "sealed" ? upper : lower!;
        return fail(
          "RELATION_TOUCHES_SEALED",
          `关系端点「${sealedOne.code}」已封存，封存后禁止新增关系`,
          {
            upperCode: upper?.code,
            lowerCode: lower?.code,
            square: sealedOne.square,
          }
        );
      }
      const issues = validateRelation(state, upperId, lowerId);
      if (issues.length) {
        for (const iss of issues) {
          logConflict({
            type: iss.type,
            message: iss.message,
            upperCode: upper?.code,
            lowerCode: lower?.code,
            square: upper?.square ?? lower?.square,
            cyclePath: iss.cyclePath,
          });
        }
        emit();
        return { ok: false, type: issues[0].type, message: issues[0].message };
      }
      const rel = {
        id: nextId("r", ctx),
        upperId,
        lowerId,
        square: upper!.square,
        createdAt: nowFn(),
      };
      state = { ...state, relations: [...state.relations, rel] };
      emit();
      return { ok: true, relationId: rel.id };
    },

    removeRelation(id) {
      const rel = state.relations.find((r) => r.id === id);
      if (!rel) return fail("NOT_FOUND", "要删除的关系不存在");
      const touched = [rel.upperId, rel.lowerId].some((uid) => {
        const u = state.units.find((x) => x.id === uid);
        return u?.status === "sealed";
      });
      if (touched)
        return fail(
          "RELATION_TOUCHES_SEALED",
          "该关系连接已封存单位，禁止改动",
          { square: rel.square }
        );
      state = {
        ...state,
        relations: state.relations.filter((r) => r.id !== id),
      };
      emit();
      return { ok: true };
    },

    transition(id, to, role: Role) {
      const unit = state.units.find((u) => u.id === id);
      if (!unit) return fail("NOT_FOUND", "单位不存在");
      const from = unit.status;
      if (from === to)
        return fail(
          "BAD_TRANSITION",
          `遗迹「${unit.code}」当前已是「${statusLabel(to)}」状态`,
          { upperCode: unit.code, square: unit.square }
        );

      const forward: Record<UnitStatus, UnitStatus | null> = {
        draft: "review",
        review: "sealed",
        sealed: null,
      };
      const isForward = forward[from] === to;
      const isReject = from === "review" && to === "draft";

      if (!isForward && !isReject) {
        return fail(
          "BAD_TRANSITION",
          `不允许从「${statusLabel(from)}」直接变为「${statusLabel(to)}」`,
          { upperCode: unit.code, square: unit.square }
        );
      }
      // 只有领队可推进；退回（待复核→草稿）发掘队员也可发起
      if (isForward && role !== "leader") {
        return fail(
          "NOT_LEADER",
          `只有领队可以推进状态（当前角色：${roleLabel(role)}），「${unit.code}」停留在「${statusLabel(from)}」`,
          { upperCode: unit.code, square: unit.square }
        );
      }
      if (to === "review" && isUnitBlocked(unit)) {
        return fail(
          "BLOCKED_UNIT",
          `遗迹「${unit.code}」缺少编号或深度，属于阻断记录，不能提交复核`,
          { upperCode: unit.code, square: unit.square }
        );
      }
      if (to === "sealed") {
        // 封存要求：同探方序列无环（新增已拦截，这里做兜底）且无阻断
        if (isUnitBlocked(unit)) {
          return fail(
            "BLOCKED_UNIT",
            `遗迹「${unit.code}」信息不完整，不能封存`,
            { upperCode: unit.code, square: unit.square }
          );
        }
      }

      const nextUnit: FeatureUnit = { ...unit, status: to, updatedAt: nowFn() };
      const reason: VersionSnapshot["reason"] = isReject
        ? "reject"
        : to === "sealed"
          ? "seal"
          : "submit";
      const labelMap: Record<VersionSnapshot["reason"], string> = {
        submit: `提交复核（草稿 → 待复核）`,
        seal: `封存（待复核 → 已封存）`,
        reject: `退回草稿（待复核 → 草稿）`,
        rollback: "版本回退",
        create: "建档",
      };
      const sv = snapshot(nextUnit, reason, labelMap[reason]);
      state = {
        ...state,
        units: state.units.map((u) => (u.id === id ? nextUnit : u)),
        versions: [...state.versions, sv],
      };
      emit();
      return { ok: true, snapshotId: sv.id };
    },

    rollback(unitId, versionId) {
      const unit = state.units.find((u) => u.id === unitId);
      if (!unit) return fail("NOT_FOUND", "单位不存在");
      if (unit.status === "sealed")
        return fail(
          "SEALED_UNIT",
          `遗迹「${unit.code}」已封存，不能直接回退；如需更正请先由领队退回草稿`,
          { upperCode: unit.code, square: unit.square }
        );
      const target = state.versions.find(
        (v) => v.id === versionId && v.unitId === unitId
      );
      if (!target)
        return fail("NOT_FOUND", "历史版本不存在或不属于该遗迹单位");

      const restored: FeatureUnit = {
        ...JSON.parse(JSON.stringify(target.data)) as FeatureUnit,
        id: unit.id,
        createdAt: unit.createdAt,
        status: "draft",
        updatedAt: nowFn(),
      };
      // 回退后的字段仍需满足唯一约束
      const checked = validateUnitFields(
        {
          code: restored.code,
          square: restored.square,
          kind: restored.kind,
          depthTop: restored.depthTop,
          depthBottom: restored.depthBottom,
          x: restored.x,
          y: restored.y,
          soil: restored.soil,
          note: restored.note,
        },
        unitId
      );
      if (!checked.ok)
        return fail(
          checked.type === "DUPLICATE_CODE" ||
            checked.type === "DUPLICATE_COORD"
            ? "ROLLBACK_DUPLICATE"
            : checked.type,
          `无法回退：${checked.message}`,
          { upperCode: unit.code, square: unit.square }
        );

      const sv = snapshot(
        restored,
        "rollback",
        `回退到历史版本「${target.label}」；回退前内容已另存为新版本`,
      );
      state = {
        ...state,
        units: state.units.map((u) => (u.id === unitId ? restored : u)),
        versions: [...state.versions, sv],
      };
      emit();
      return { ok: true, snapshotId: sv.id };
    },

    dismissConflict(id) {
      state = {
        ...state,
        conflicts: state.conflicts.map((c) =>
          c.id === id ? { ...c, dismissed: true } : c
        ),
      };
      emit();
    },

    clearDismissed() {
      state = {
        ...state,
        conflicts: state.conflicts.filter((c) => !c.dismissed),
      };
      emit();
    },
  };

  return store;
}

function statusLabel(s: UnitStatus): string {
  return { draft: "草稿", review: "待复核", sealed: "已封存" }[s];
}
function roleLabel(r: Role): string {
  return { worker: "发掘队员", leader: "领队", curator: "资料整理员" }[r];
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 统计指标（界面与测试共用） */
export function computeStats(state: AppState) {
  const sequences = buildSequences(state);
  const blockedUnits = state.units.filter(isUnitBlocked);
  const activeConflicts = state.conflicts.filter((c) => !c.dismissed);
  const conflictTypeCounts = new Map<ConflictType, number>();
  for (const c of activeConflicts) {
    conflictTypeCounts.set(c.type, (conflictTypeCounts.get(c.type) ?? 0) + 1);
  }
  return {
    squareCount: sequences.length,
    unitCount: state.units.length,
    relationCount: state.relations.length,
    blockedCount: blockedUnits.length,
    draftCount: state.units.filter((u) => u.status === "draft").length,
    reviewCount: state.units.filter((u) => u.status === "review").length,
    sealedCount: state.units.filter((u) => u.status === "sealed").length,
    activeConflictCount: activeConflicts.length,
    conflictTypeCounts,
    versionCount: state.versions.length,
    cyclicSquares: sequences.filter((s) => s.cyclic).map((s) => s.square),
  };
}
