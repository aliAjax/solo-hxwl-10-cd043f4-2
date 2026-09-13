// 示例数据：两个探方、正常叠压链与一条待补深度的阻断记录
import { type AppState, type FeatureUnit, type Relation, type VersionSnapshot } from "./types";

interface SeedUnitSpec {
  code: string;
  square: string;
  kind: FeatureUnit["kind"];
  depthTop: number | null;
  depthBottom?: number | null;
  x?: number | null;
  y?: number | null;
  soil?: string;
  note?: string;
  status?: FeatureUnit["status"];
}

export function buildSeedState(now = 1_700_000_000_000): AppState {
  const specs: SeedUnitSpec[] = [
    // T0203：① → ② → ③(H12) 的正常叠压链
    { code: "①", square: "T0203", kind: "layer", depthTop: 0.2, depthBottom: 0.5, x: 2, y: 3, soil: "耕土，灰褐", note: "表土层" },
    { code: "②", square: "T0203", kind: "layer", depthTop: 0.5, depthBottom: 0.9, x: 3, y: 3, soil: "黄褐土", note: "扰乱层" },
    { code: "③", square: "T0203", kind: "layer", depthTop: 0.9, depthBottom: 1.3, x: 4, y: 3, soil: "灰褐土", note: "文化层" },
    { code: "H12", square: "T0203", kind: "pit", depthTop: 1.3, depthBottom: 1.8, x: 4, y: 5, soil: "黑褐土，夹炭屑", note: "见动物骨骼，开口于③层下" },
    // T0204：F2 房址与柱洞
    { code: "F2", square: "T0204", kind: "house", depthTop: 0.8, depthBottom: 1.1, x: 1, y: 1, soil: "夯土面", note: "柱洞关系需复核" },
    { code: "D5", square: "T0204", kind: "other", depthTop: 0.85, depthBottom: 1.0, x: 3, y: 1, soil: "黄花夯土", note: "F2 柱洞" },
    // 阻断示例：缺深度，仍可建档但不进序列、不能建关系
    { code: "G3", square: "T0204", kind: "ditch", depthTop: null, x: 5, y: 5, soil: "待辨认", note: "深度待补（阻断记录示例）" },
  ];

  let seq = 0;
  const id = (p: string) => `${p}_seed_${++seq}`;
  const units: FeatureUnit[] = specs.map((s, i) => ({
    id: `u_seed_${i + 1}`,
    code: s.code,
    square: s.square,
    kind: s.kind,
    depthTop: s.depthTop,
    depthBottom: s.depthBottom ?? null,
    x: s.x ?? null,
    y: s.y ?? null,
    soil: s.soil ?? "",
    note: s.note ?? "",
    status: s.status ?? "draft",
    createdAt: now + i,
    updatedAt: now + i,
  }));
  const find = (square: string, code: string) =>
    units.find((u) => u.square === square && u.code === code)!;

  const relSpec: Array<[string, string, string]> = [
    ["T0203", "①", "②"],
    ["T0203", "②", "③"],
    ["T0203", "③", "H12"],
    ["T0204", "F2", "D5"],
  ];
  const relations: Relation[] = relSpec.map(([sq, up, low], i) => ({
    id: `r_seed_${i + 1}`,
    square: sq,
    upperId: find(sq, up).id,
    lowerId: find(sq, low).id,
    createdAt: now + 100 + i,
  }));

  const versions: VersionSnapshot[] = units.map((u) => ({
    id: id("sv"),
    unitId: u.id,
    reason: "create",
    label: "建档（草稿 v1）",
    at: u.createdAt,
    data: JSON.parse(JSON.stringify(u)) as FeatureUnit,
  }));

  return {
    version: 1,
    units,
    relations,
    versions,
    conflicts: [],
    seededAt: now,
  };
}
