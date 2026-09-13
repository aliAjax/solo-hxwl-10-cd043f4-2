import { useState } from "react";
import {
  KIND_LABEL,
  type FeatureKind,
  type FeatureUnit,
  type Store,
  type UnitInput,
} from "../domain";
import { NumInput } from "./widgets";

const KIND_ORDER = Object.keys(KIND_LABEL) as FeatureKind[];

function blankForm(): UnitInput {
  return {
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
}

export function UnitForm({
  store,
  run,
  squares,
}: {
  store: Store;
  run: <T extends { ok: boolean }>(fn: () => T) => T;
  squares: string[];
}) {
  const [form, setForm] = useState<UnitInput>(blankForm);
  const set = <K extends keyof UnitInput>(k: K, v: UnitInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    const r = run(() => store.addUnit(form));
    if (r.ok) setForm(blankForm());
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>① 新增遗迹单位</h2>
        <p>缺编号或缺深度也可登记，会明确标为阻断；同探方编号 / 坐标不可重复</p>
      </header>
      <div className="form-grid">
        <label>
          <span>探方编号 *</span>
          <input
            list="square-options"
            placeholder="如 T0203"
            value={form.square}
            onChange={(e) => set("square", e.target.value)}
          />
          <datalist id="square-options">
            {squares.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          <span>遗迹编号 *</span>
          <input
            placeholder="如 H12 / F2"
            value={form.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </label>
        <label>
          <span>遗迹类型</span>
          <select
            value={form.kind}
            onChange={(e) => set("kind", e.target.value as FeatureKind)}
          >
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>顶层深度 (m) *</span>
          <NumInput
            value={form.depthTop}
            onValue={(v) => set("depthTop", v)}
            placeholder="如 0.8"
          />
        </label>
        <label>
          <span>底部深度 (m)</span>
          <NumInput
            value={form.depthBottom}
            onValue={(v) => set("depthBottom", v)}
            placeholder="选填"
          />
        </label>
        <label className="coord-x">
          <span>坐标 E (x)</span>
          <NumInput value={form.x} onValue={(v) => set("x", v)} placeholder="选填" />
        </label>
        <label className="coord-y">
          <span>坐标 N (y)</span>
          <NumInput value={form.y} onValue={(v) => set("y", v)} placeholder="选填" />
        </label>
        <label className="span-2">
          <span>土色 / 质地</span>
          <input
            placeholder="如 黑褐土，夹炭屑"
            value={form.soil}
            onChange={(e) => set("soil", e.target.value)}
          />
        </label>
        <label className="span-2">
          <span>备注</span>
          <input
            placeholder="出土物、开口层位等"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="btn-primary" onClick={submit}>
          登记为草稿
        </button>
        <button className="btn-ghost" onClick={() => setForm(blankForm)}>
          清空
        </button>
      </div>
    </section>
  );
}

export function RelationForm({
  store,
  run,
  units,
}: {
  store: Store;
  run: <T extends { ok: boolean }>(fn: () => T) => T;
  units: FeatureUnit[];
}) {
  const [upper, setUpper] = useState("");
  const [lower, setLower] = useState("");
  const [sameSquare, setSameSquare] = useState(true);

  const upperUnit = units.find((u) => u.id === upper);
  const lowerChoices = sameSquare
    ? units.filter((u) => u.square === upperUnit?.square)
    : units;

  const submit = () => {
    if (!upper || !lower) return;
    const r = run(() => store.addRelation(upper, lower));
    if (r.ok) {
      setUpper("");
      setLower("");
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>② 建立上下层关系</h2>
        <p>上层叠压下层；自指、环路、跨探方、重复关系都会被拦截</p>
      </header>
      <div className="rel-form">
        <label>
          <span>上层单位（晚）</span>
          <select value={upper} onChange={(e) => { setUpper(e.target.value); setLower(""); }}>
            <option value="">选择上层…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.square} · {u.code || "未编号（阻断）"}（{KIND_LABEL[u.kind]}）
              </option>
            ))}
          </select>
        </label>
        <div className="rel-arrow" aria-hidden>
          叠压 ↓
        </div>
        <label>
          <span>下层单位（早）</span>
          <select value={lower} onChange={(e) => setLower(e.target.value)} disabled={!upper}>
            <option value="">{upper ? "选择下层…" : "请先选上层"}</option>
            {lowerChoices
              .filter((u) => u.id !== upper)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.square} · {u.code || "未编号（阻断）"}（{KIND_LABEL[u.kind]}）
                </option>
              ))}
          </select>
        </label>
        <label className="rel-check">
          <input
            type="checkbox"
            checked={sameSquare}
            onChange={(e) => setSameSquare(e.target.checked)}
          />
          <span>只显示同探方（取消可尝试跨探方，将被拦截）</span>
        </label>
      </div>
      <div className="form-actions">
        <button className="btn-primary" onClick={submit} disabled={!upper || !lower}>
          建立关系
        </button>
      </div>
    </section>
  );
}
