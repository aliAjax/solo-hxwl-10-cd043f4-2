import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  createInitialState,
  computeStats,
  normalizeInput,
  buildSeedState,
  loadState,
  saveState,
  buildSequences,
  isUnitBlocked,
} from "../src/domain/index";
import type { AppState, Store, UnitInput, StorageLike } from "../src/domain/index";/** 确定性时钟与内存存储，避免测试依赖真实时间/localStorage */
function makeHarness(startState?: AppState) {
  let clock = 1_700_000_000_000;
  const store = createStore(startState ?? createInitialState(clock), {
    now: () => clock,
  });
  return {
    store,
    tick: (ms = 1) => {
      clock += ms;
    },
  };
}

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const baseUnit = (over: Partial<UnitInput> = {}): UnitInput =>
  normalizeInput({
    code: "H1",
    square: "T0101",
    kind: "pit",
    depthTop: 1.2,
    depthBottom: 1.6,
    x: 2,
    y: 3,
    soil: "灰土",
    note: "",
    ...over,
  });

/** 新增单位并断言成功，返回 id */
function addOk(store: Store, input: Partial<UnitInput>): string {
  const r = store.addUnit(input);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; unitId: string }).unitId;
}

function findByCode(store: Store, square: string, code: string) {
  const u = store
    .getState()
    .units.find((u) => u.square === square && u.code === code);
  assert.ok(u, `单位 ${square}/${code} 应存在`);
  return u!;
}

// ---------- 新增：正常数据 ----------
describe("新增遗迹单位与关系（正常数据）", () => {
  let store: Store;
  beforeEach(() => {
    store = makeHarness().store;
  });

  test("可新增信息完整的单位，默认进入草稿并生成首个版本", () => {
    const id = addOk(store, baseUnit());
    const u = store.getState().units.find((x) => x.id === id)!;
    assert.equal(u.status, "draft");
    const vers = store.getState().versions.filter((v) => v.unitId === id);
    assert.equal(vers.length, 1);
    assert.equal(vers[0].reason, "create");
  });

  test("可在同探方建立叠压关系并出现在关系列表", () => {
    const a = addOk(store, baseUnit({ code: "H1", depthTop: 0.5 }));
    const b = addOk(store, baseUnit({ code: "H2", depthTop: 1.0, x: 4, y: 4 }));
    const r = store.addRelation(a, b);
    assert.equal(r.ok, true);
    assert.equal(store.getState().relations.length, 1);
  });

  test("关系按探方分组生成地层序列：上层在前", () => {
    const h3 = addOk(store, baseUnit({ code: "H3", depthTop: 2.0, depthBottom: null, x: 5, y: 5 }));
    const h1 = addOk(store, baseUnit({ code: "H1", depthTop: 0.5, depthBottom: null, x: 2, y: 3 }));
    const h2 = addOk(store, baseUnit({ code: "H2", depthTop: 1.2, depthBottom: null, x: 4, y: 4 }));
    assert.equal(store.addRelation(h1, h2).ok, true);
    assert.equal(store.addRelation(h2, h3).ok, true);

    const seqs = buildSequences(store.getState());
    assert.equal(seqs.length, 1);
    assert.deepEqual(
      seqs[0].levels.map((l) => l.unit.code),
      ["H1", "H2", "H3"]
    );
  });

  test("多个探方分别成组，互不影响", () => {
    const a = addOk(store, baseUnit({ code: "H1", square: "T0101", x: 1, y: 1 }));
    const b = addOk(store, baseUnit({ code: "H1", square: "T0102", x: 1, y: 1 }));
    assert.equal(a === b, false);
    const seqs = buildSequences(store.getState());
    assert.deepEqual(seqs.map((s) => s.square).sort(), ["T0101", "T0102"]);
  });
});

// ---------- 新增：非法数据拦截 ----------
describe("非法关系与字段拦截", () => {
  let store: Store;
  beforeEach(() => {
    store = makeHarness().store;
  });

  test("自指被拦截并定位到具体单位", () => {
    const a = addOk(store, baseUnit());
    const r = store.addRelation(a, a);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "SELF_REFERENCE");
    const cf = store.getState().conflicts.at(-1)!;
    assert.equal(cf.type, "SELF_REFERENCE");
    assert.equal(cf.upperCode, "H1");
    assert.equal(cf.lowerCode, "H1");
    assert.equal(store.getState().relations.length, 0);
  });

  test("跨探方关系被拦截", () => {
    const a = addOk(store, baseUnit({ code: "H1", square: "T0101", x: 1, y: 1 }));
    const b = addOk(store, baseUnit({ code: "H9", square: "T0102", x: 9, y: 9 }));
    const r = store.addRelation(a, b);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "CROSS_SQUARE");
    assert.equal(store.getState().relations.length, 0);
  });

  test("环路被拦截且冲突日志给出完整环路路径 H1→H2→H3→H1", () => {
    const h1 = addOk(store, baseUnit({ code: "H1", depthTop: 0.4, x: 1, y: 1 }));
    const h2 = addOk(store, baseUnit({ code: "H2", depthTop: 0.8, x: 2, y: 1 }));
    const h3 = addOk(store, baseUnit({ code: "H3", depthTop: 1.2, x: 3, y: 1 }));
    assert.equal(store.addRelation(h1, h2).ok, true);
    assert.equal(store.addRelation(h2, h3).ok, true);
    // 试图让 H3 反过来叠压 H1 → 成环
    const r = store.addRelation(h3, h1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "CYCLE");
    const cf = store.getState().conflicts.at(-1)!;
    assert.ok(cf.cyclePath);
    assert.deepEqual(cf.cyclePath, ["H3", "H1", "H2", "H3"]);
    assert.equal(store.getState().relations.length, 2); // 环路关系未落库
  });

  test("重复关系与反向关系都被拦截", () => {
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1 }));
    const b = addOk(store, baseUnit({ code: "H2", x: 2, y: 2 }));
    assert.equal(store.addRelation(a, b).ok, true);
    const dup = store.addRelation(a, b);
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.equal(dup.type, "DUPLICATE_RELATION");
    const rev = store.addRelation(b, a);
    assert.equal(rev.ok, false);
    if (!rev.ok) assert.equal(rev.type, "REVERSE_EXISTS");
    assert.equal(store.getState().relations.length, 1);
  });

  test("同探方重复编号被拦截（跨探方同号允许）", () => {
    addOk(store, baseUnit({ code: "H1", square: "T0101", x: 1, y: 1 }));
    const dup = store.addUnit(baseUnit({ code: "h1", square: "T0101", x: 2, y: 2 }));
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.equal(dup.type, "DUPLICATE_CODE");
    const otherSquare = store.addUnit(baseUnit({ code: "H1", square: "T0909", x: 2, y: 2 }));
    assert.equal(otherSquare.ok, true);
  });

  test("同探方重复坐标被拦截并指出占用者", () => {
    addOk(store, baseUnit({ code: "H1", x: 5.25, y: 3.0 }));
    const dup = store.addUnit(baseUnit({ code: "H2", x: 5.25, y: 3 }));
    assert.equal(dup.ok, false);
    if (!dup.ok) {
      assert.equal(dup.type, "DUPLICATE_COORD");
      assert.match(dup.message, /H1/);
    }
  });

  test("深度负数非法", () => {
    const r = store.addUnit(baseUnit({ depthTop: -0.1 }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "INVALID_DEPTH");
  });
});

// ---------- 阻断记录 ----------
describe("阻断记录：缺编号或缺深度", () => {
  test("缺编号：允许登记，但明确标为阻断", () => {
    const { store } = makeHarness();
    const r = store.addUnit(baseUnit({ code: "  " }));
    assert.equal(r.ok, true, JSON.stringify(r));
    const id = (r as { ok: true; unitId: string }).unitId;
    const u = store.getState().units.find((x) => x.id === id)!;
    assert.equal(u.code, "");
    assert.equal(isUnitBlocked(u), true);
    // 阻断登记写入冲突日志，说明缺什么
    const cf = store.getState().conflicts.at(-1)!;
    assert.equal(cf.type, "BLOCKED_UNIT");
    assert.match(cf.message, /编号/);
  });

  test("缺编号阻断记录：不进正常层位、不能建关系、领队也不能推进", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit({ code: "" }));

    const seqs = buildSequences(store.getState());
    const level = seqs[0].levels.find((l) => l.unit.id === id)!;
    assert.equal(level.blocked, true); // 单列并标记阻断

    const other = addOk(store, baseUnit({ code: "H2", x: 9, y: 9, depthTop: 0.6 }));
    const rel = store.addRelation(other, id);
    assert.equal(rel.ok, false);
    if (!rel.ok) assert.equal(rel.type, "BLOCKED_ENDPOINT");

    // 即使是领队，阻断记录也不能提交复核
    const submit = store.transition(id, "review", "leader");
    assert.equal(submit.ok, false);
    if (!submit.ok) assert.equal(submit.type, "BLOCKED_UNIT");
  });

  test("同探方可有多条未编号记录；补编号时撞号仍被拦截", () => {
    const { store } = makeHarness();
    const a = addOk(store, baseUnit({ code: "", x: 1, y: 1 }));
    const b = addOk(store, baseUnit({ code: "", x: 2, y: 2 }));
    assert.notEqual(a, b);
    addOk(store, baseUnit({ code: "H9", x: 3, y: 3 }));
    const dup = store.editUnit(a, { code: "H9" });
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.equal(dup.type, "DUPLICATE_CODE");
    // 换一个不重复的编号可以补齐
    assert.equal(store.editUnit(a, { code: "H7" }).ok, true);
  });

  test("补齐编号后阻断解除：可建关系、可提交复核", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit({ code: "" }));
    assert.equal(isUnitBlocked(store.getState().units[0]), true);
    assert.equal(store.editUnit(id, { code: "H1" }).ok, true);
    assert.equal(isUnitBlocked(store.getState().units[0]), false);

    const other = addOk(store, baseUnit({ code: "H2", x: 9, y: 9, depthTop: 0.5 }));
    assert.equal(store.addRelation(other, id).ok, true);
    assert.equal(store.transition(id, "review", "leader").ok, true);
    // 补号后进入正常序列（不再带阻断标记）
    const level = buildSequences(store.getState())[0].levels.find(
      (l) => l.unit.id === id
    )!;
    assert.equal(level.blocked, false);
  });

  test("缺深度：允许建档但标记阻断，不进序列、不能建关系、不能提交复核", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit({ depthTop: null }));
    const u = store.getState().units.find((x) => x.id === id)!;
    assert.equal(isUnitBlocked(u), true);

    const seqs = buildSequences(store.getState());
    const level = seqs[0].levels.find((l) => l.unit.id === id)!;
    assert.equal(level.blocked, true); // 单列在末尾并标记阻断

    const other = addOk(store, baseUnit({ code: "H2", x: 9, y: 9, depthTop: 0.6 }));
    const rel = store.addRelation(other, id);
    assert.equal(rel.ok, false);
    if (!rel.ok) assert.equal(rel.type, "BLOCKED_ENDPOINT");

    const submit = store.transition(id, "review", "leader");
    assert.equal(submit.ok, false);
    if (!submit.ok) assert.equal(submit.type, "BLOCKED_UNIT");
  });

  test("补齐深度后阻断解除，可正常建关系", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit({ depthTop: null }));
    assert.equal(store.editUnit(id, { depthTop: 1.0 }).ok, true);
    const u = store.getState().units.find((x) => x.id === id)!;
    assert.equal(isUnitBlocked(u), false);
    const other = addOk(store, baseUnit({ code: "H2", x: 9, y: 9, depthTop: 0.5 }));
    assert.equal(store.addRelation(other, id).ok, true);
  });
});

// ---------- 状态流转与权限 ----------
describe("状态流转：草稿→待复核→已封存", () => {
  test("非领队不能推进状态，冲突日志记录角色原因", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit());
    const r = store.transition(id, "review", "worker");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "NOT_LEADER");
    assert.equal(findByCode(store, "T0101", "H1").status, "draft");
    // 资料整理员同样不能推进
    assert.equal(store.transition(id, "review", "curator").ok, false);
  });

  test("领队可推进至待复核与封存，每步保留版本", () => {
    const { store, tick } = makeHarness();
    const id = addOk(store, baseUnit());
    tick();
    assert.equal(store.transition(id, "review", "leader").ok, true);
    assert.equal(findByCode(store, "T0101", "H1").status, "review");
    tick();
    assert.equal(store.transition(id, "sealed", "leader").ok, true);
    assert.equal(findByCode(store, "T0101", "H1").status, "sealed");
    const reasons = store
      .getState()
      .versions.filter((v) => v.unitId === id)
      .map((v) => v.reason);
    assert.deepEqual(reasons, ["create", "submit", "seal"]);
  });

  test("已封存禁止改动：编辑、删除、加关系均被拦截", () => {
    const { store } = makeHarness();
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1, depthTop: 0.5 }));
    const b = addOk(store, baseUnit({ code: "H2", x: 2, y: 2, depthTop: 1.0 }));
    store.transition(a, "review", "leader");
    store.transition(a, "sealed", "leader");

    const edit = store.editUnit(a, { note: "试图篡改" });
    assert.equal(edit.ok, false);
    if (!edit.ok) assert.equal(edit.type, "SEALED_UNIT");
    const del = store.deleteUnit(a);
    assert.equal(del.ok, false);
    if (!del.ok) assert.equal(del.type, "SEALED_UNIT");
    const rel = store.addRelation(a, b);
    assert.equal(rel.ok, false);
    assert.equal(findByCode(store, "T0101", "H1").note, "");
  });

  test("非法跳转被拦截：草稿不能直接封存", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit());
    const r = store.transition(id, "sealed", "leader");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "BAD_TRANSITION");
  });

  // ---- 已封存 → 领队退回草稿（新需求）----
  function sealUnit(store: Store, id: string) {
    assert.equal(store.transition(id, "review", "leader").ok, true);
    assert.equal(store.transition(id, "sealed", "leader").ok, true);
  }

  test("封存后：非领队不能退回；领队退回成功并回到草稿", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit({ note: "封存内容" }));
    sealUnit(store, id);

    const worker = store.transition(id, "draft", "worker");
    assert.equal(worker.ok, false);
    if (!worker.ok) assert.equal(worker.type, "NOT_LEADER");
    const curator = store.transition(id, "draft", "curator");
    assert.equal(curator.ok, false);
    if (!curator.ok) assert.equal(curator.type, "NOT_LEADER");
    assert.equal(findByCode(store, "T0101", "H1").status, "sealed");

    const unseal = store.transition(id, "draft", "leader");
    assert.equal(unseal.ok, true, JSON.stringify(unseal));
    assert.equal(findByCode(store, "T0101", "H1").status, "draft");
  });

  test("封存退回必须保留封存前版本，且退回后才可编辑", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit({ note: "封存时备注" }));
    sealUnit(store, id);
    const sealVersion = store
      .getState()
      .versions.find((v) => v.unitId === id && v.reason === "seal")!;
    assert.ok(sealVersion, "必须存在封存版本");
    assert.equal(sealVersion.data.status, "sealed");
    assert.equal(sealVersion.data.note, "封存时备注");

    // 退回前编辑仍被拦截
    const editBefore = store.editUnit(id, { note: "退回前篡改" });
    assert.equal(editBefore.ok, false);
    if (!editBefore.ok) assert.equal(editBefore.type, "SEALED_UNIT");

    assert.equal(store.transition(id, "draft", "leader").ok, true);
    const unsealVersion = store
      .getState()
      .versions.find((v) => v.unitId === id && v.reason === "unseal")!;
    assert.ok(unsealVersion, "退回动作本身也留存版本");
    assert.equal(unsealVersion.data.status, "sealed"); // 留存的是退回前的封存快照

    // 封存版本仍在，未被覆盖
    const sealStillThere = store
      .getState()
      .versions.some((v) => v.id === sealVersion.id && v.data.note === "封存时备注");
    assert.equal(sealStillThere, true);

    // 退回后可以编辑
    assert.equal(store.editUnit(id, { note: "退回后更正" }).ok, true);
    assert.equal(findByCode(store, "T0101", "H1").note, "退回后更正");

    // 退回后可重新走流程
    sealUnit(store, id);
    assert.equal(findByCode(store, "T0101", "H1").status, "sealed");
  });

  test("封存退回后关系编辑恢复：可给退回为草稿的单位删关系", () => {
    const { store } = makeHarness();
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1, depthTop: 0.5 }));
    const b = addOk(store, baseUnit({ code: "H2", x: 2, y: 2, depthTop: 1.0 }));
    store.addRelation(a, b);
    const relId = store.getState().relations[0].id;
    sealUnit(store, a);
    // 封存时删关系被拦截
    assert.equal(store.removeRelation(relId).ok, false);
    // 领队退回 a 后，关系恢复可删
    assert.equal(store.transition(a, "draft", "leader").ok, true);
    assert.equal(store.removeRelation(relId).ok, true);
  });

  test("未编号记录：封存入口本就不可达（阻断不能提交复核）", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit({ code: "" }));
    assert.equal(store.transition(id, "review", "leader").ok, false);
    // 因此也不存在封存版本
    assert.equal(
      store.getState().versions.filter((v) => v.unitId === id && v.reason === "seal").length,
      0
    );
  });

  test("退回草稿必须保留版本：再编辑不覆盖封存/复核快照", () => {
    const { store, tick } = makeHarness();
    const id = addOk(store, baseUnit({ note: "初录" }));
    tick();
    store.transition(id, "review", "leader");
    tick();
    const reject = store.transition(id, "draft", "leader");
    assert.equal(reject.ok, true);
    const before = store.getState().versions.filter((v) => v.unitId === id).length;
    tick();
    assert.equal(store.editUnit(id, { note: "退回后更正" }).ok, true);
    const after = store.getState().versions.filter((v) => v.unitId === id).length;
    // 普通编辑不产生版本；退回快照 (reject) 仍然保留
    assert.equal(after, before);
    const labels = store
      .getState()
      .versions.filter((v) => v.unitId === id)
      .map((v) => v.reason);
    assert.deepEqual(labels, ["create", "submit", "reject"]);
    // 退回产生的快照是变更前（待复核）内容
    const rejectSnap = store
      .getState()
      .versions.filter((v) => v.unitId === id)
      .find((v) => v.reason === "reject")!;
    assert.equal(rejectSnap.data.status, "review");
    assert.equal(rejectSnap.data.note, "初录");
  });
});

// ---------- 版本回退 ----------
describe("版本回退", () => {
  test("可回退到历史版本，回退本身生成新版本且旧版本链不删", () => {
    const { store, tick } = makeHarness();
    const id = addOk(store, baseUnit({ depthBottom: null, depthTop: 1.2, note: "初录深度1.2" }));
    tick();
    store.transition(id, "review", "leader");
    const submitVersion = store
      .getState()
      .versions.find((v) => v.unitId === id && v.reason === "submit")!;
    tick();
    store.transition(id, "draft", "leader");
    tick();
    assert.equal(store.editUnit(id, { depthTop: 1.9, note: "误改深度1.9" }).ok, true);

    const beforeCount = store.getState().versions.filter((v) => v.unitId === id).length;
    const rb = store.rollback(id, submitVersion.id);
    assert.equal(rb.ok, true, JSON.stringify(rb));

    const u = findByCode(store, "T0101", "H1");
    assert.equal(u.depthTop, 1.2);
    assert.equal(u.note, "初录深度1.2");
    assert.equal(u.status, "draft"); // 回退一律回到草稿

    const versions = store.getState().versions.filter((v) => v.unitId === id);
    assert.equal(versions.length, beforeCount + 1); // 新增了 rollback 版本
    assert.equal(versions.at(-1)!.reason, "rollback");
    // 旧的 submit 版本仍在
    assert.ok(versions.some((v) => v.id === submitVersion.id));
  });

  test("已封存单位不能直接回退", () => {
    const { store } = makeHarness();
    const id = addOk(store, baseUnit());
    store.transition(id, "review", "leader");
    store.transition(id, "sealed", "leader");
    const anyVersion = store.getState().versions[0].id;
    const r = store.rollback(id, anyVersion);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "SEALED_UNIT");
  });

  test("不能用别的单位的版本号回退", () => {
    const { store } = makeHarness();
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1 }));
    const b = addOk(store, baseUnit({ code: "H2", x: 2, y: 2 }));
    const bVersion = store
      .getState()
      .versions.find((v) => v.unitId === b)!;
    const r = store.rollback(a, bVersion.id);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "NOT_FOUND");
  });
});

// ---------- 统计随数据即时更新 ----------
describe("统计与空状态", () => {
  test("空工作台统计归零", () => {
    const { store } = makeHarness();
    const s = computeStats(store.getState());
    assert.equal(s.unitCount, 0);
    assert.equal(s.relationCount, 0);
    assert.equal(s.squareCount, 0);
    assert.equal(s.activeConflictCount, 0);
    assert.equal(s.blockedCount, 0);
    assert.deepEqual(s.cyclicSquares, []);
  });

  test("统计跟随新增/冲突/状态流转即时变化", () => {
    const { store } = makeHarness();
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1, depthTop: 0.4 }));
    const b = addOk(store, baseUnit({ code: "H2", x: 2, y: 2, depthTop: 0.9 }));
    store.addRelation(a, b);

    let s = computeStats(store.getState());
    assert.equal(s.unitCount, 2);
    assert.equal(s.relationCount, 1);
    assert.equal(s.draftCount, 2);
    assert.equal(s.squareCount, 1);

    store.addRelation(a, a); // 自指 → 冲突 +1
    s = computeStats(store.getState());
    assert.equal(s.activeConflictCount, 1);
    assert.ok(s.conflictTypeCounts.get("SELF_REFERENCE"));

    store.transition(a, "review", "leader");
    s = computeStats(store.getState());
    assert.equal(s.draftCount, 1);
    assert.equal(s.reviewCount, 1);

    // 忽略冲突后统计回落
    const cf = store.getState().conflicts[0];
    store.dismissConflict(cf.id);
    s = computeStats(store.getState());
    assert.equal(s.activeConflictCount, 0);
  });
});

// ---------- 持久化 ----------
describe("持久化：刷新后不丢", () => {
  test("单位、关系、状态、版本、冲突可完整序列化还原", () => {
    const { store } = makeHarness();
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1, note: "原样" }));
    const b = addOk(store, baseUnit({ code: "H2", x: 2, y: 2 }));
    store.addRelation(a, b);
    store.transition(a, "review", "leader");
    store.transition(a, "sealed", "leader");
    store.addRelation(a, a); // 封存后加关系被拦截，冲突日志仍持久化

    const storage = memStorage();
    saveState(storage, store.getState());
    assert.ok(storage.getItem("strata-workbench:v1"));

    const restoredState = loadState(storage);
    assert.ok(restoredState);
    const restored = createStore(restoredState!, { now: () => 999 });
    assert.equal(restored.getState().units.length, 2);
    assert.equal(restored.getState().relations.length, 1);
    assert.equal(findByCode(restored, "T0101", "H1").status, "sealed");
    assert.ok(
      restored.getState().versions.some((v) => v.unitId === a && v.reason === "submit")
    );
    assert.equal(restored.getState().conflicts.length, 1);
    // 还原后封存保护仍然生效
    const r = restored.editUnit(a, { note: "刷新后篡改" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.type, "SEALED_UNIT");
  });

  test("封存退回与未编号阻断：刷新后状态和版本不丢", () => {
    const { store } = makeHarness();
    // 正常单位：封存 → 领队退回
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1, note: "封存备注" }));
    store.transition(a, "review", "leader");
    store.transition(a, "sealed", "leader");
    store.transition(a, "draft", "leader");
    // 未编号阻断单位
    const c = addOk(store, baseUnit({ code: "", x: 6, y: 6 }));

    const storage = memStorage();
    saveState(storage, store.getState());
    const restored = createStore(loadState(storage)!, { now: () => 999 });

    const restoredA = restored.getState().units.find((u) => u.id === a)!;
    assert.equal(restoredA.status, "draft");
    const reasons = restored
      .getState()
      .versions.filter((v) => v.unitId === a)
      .map((v) => v.reason);
    assert.deepEqual(reasons, ["create", "submit", "seal", "unseal"]);
    // 封存前版本仍可查到封存内容
    const sealSnap = restored
      .getState()
      .versions.find((v) => v.unitId === a && v.reason === "seal")!;
    assert.equal(sealSnap.data.status, "sealed");
    assert.equal(sealSnap.data.note, "封存备注");
    // 退回后还原的数据可编辑
    assert.equal(restored.editUnit(a, { note: "刷新后编辑" }).ok, true);

    const restoredC = restored.getState().units.find((u) => u.id === c)!;
    assert.equal(isUnitBlocked(restoredC), true);
    // 补编号在刷新后仍然生效
    assert.equal(restored.editUnit(c, { code: "H8" }).ok, true);
    assert.equal(isUnitBlocked(restored.getState().units.find((u) => u.id === c)!), false);
  });

  test("损坏的存储内容被安全忽略", () => {
    const storage = memStorage();
    storage.setItem("strata-workbench:v1", "{not-json");
    assert.equal(loadState(storage), null);
    storage.setItem("strata-workbench:v1", JSON.stringify({ hello: "world" }));
    assert.equal(loadState(storage), null);
  });

  test("基于还原数据继续操作：关系约束仍然有效", () => {
    const { store } = makeHarness();
    const a = addOk(store, baseUnit({ code: "H1", x: 1, y: 1 }));
    const b = addOk(store, baseUnit({ code: "H2", x: 2, y: 2 }));
    store.addRelation(a, b);
    const storage = memStorage();
    saveState(storage, store.getState());

    const restored = createStore(loadState(storage)!, { now: () => 999 });
    const dup = restored.addRelation(a, b);
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.equal(dup.type, "DUPLICATE_RELATION");
  });
});

// ---------- 示例数据自检 ----------
describe("内置示例数据", () => {
  test("示例探方序列无环且包含阻断示例 G3", () => {
    const state = buildSeedState();
    const seqs = buildSequences(state);
    assert.equal(seqs.every((s) => !s.cyclic), true);
    const t203 = seqs.find((s) => s.square === "T0203")!;
    assert.deepEqual(
      t203.levels.map((l) => l.unit.code),
      ["①", "②", "③", "H12"]
    );
    const g3 = state.units.find((u) => u.code === "G3")!;
    assert.equal(isUnitBlocked(g3), true);
  });

  test("示例数据自身不违反编号/坐标唯一约束", () => {
    const state = buildSeedState();
    const codes = new Set<string>();
    const coords = new Set<string>();
    for (const u of state.units) {
      const ck = `${u.square}::${u.code.toUpperCase()}`;
      assert.equal(codes.has(ck), false, `示例编号重复 ${ck}`);
      codes.add(ck);
      if (u.x !== null && u.y !== null) {
        const pk = `${u.square}@${u.x},${u.y}`;
        assert.equal(coords.has(pk), false, `示例坐标重复 ${pk}`);
        coords.add(pk);
      }
    }
  });
});
