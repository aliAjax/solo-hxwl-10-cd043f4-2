import type { AppState } from "../domain";
import { computeStats } from "../domain";

export function StatsBar({ state }: { state: AppState }) {
  const s = computeStats(state);
  const cards = [
    { label: "探方", value: s.squareCount, tone: "tone-neutral" },
    { label: "遗迹单位", value: s.unitCount, tone: "tone-neutral" },
    { label: "叠压关系", value: s.relationCount, tone: "tone-neutral" },
    { label: "草稿", value: s.draftCount, tone: "tone-draft" },
    { label: "待复核", value: s.reviewCount, tone: "tone-review" },
    { label: "已封存", value: s.sealedCount, tone: "tone-sealed" },
    { label: "阻断记录", value: s.blockedCount, tone: s.blockedCount ? "tone-danger" : "tone-ok" },
    { label: "未处理冲突", value: s.activeConflictCount, tone: s.activeConflictCount ? "tone-danger" : "tone-ok" },
    { label: "版本快照", value: s.versionCount, tone: "tone-neutral" },
  ];
  return (
    <div className="stats-grid">
      {cards.map((c) => (
        <div key={c.label} className={`stat-card ${c.tone}`}>
          <span className="stat-value">{c.value}</span>
          <span className="stat-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}
