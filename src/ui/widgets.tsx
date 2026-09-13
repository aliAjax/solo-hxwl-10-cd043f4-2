import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: string;
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function NumInput({
  value,
  onValue,
  placeholder,
  step = "0.01",
}: {
  value: number | null;
  onValue: (v: number | null) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      inputMode="decimal"
      placeholder={placeholder}
      value={value === null ? "" : String(value)}
      onChange={(e) => {
        if (e.target.value.trim() === "") {
          onValue(null);
        } else {
          const n = Number(e.target.value);
          onValue(Number.isFinite(n) ? n : null);
        }
      }}
    />
  );
}
