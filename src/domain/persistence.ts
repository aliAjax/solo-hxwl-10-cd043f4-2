// localStorage 持久化：刷新后关系、状态与版本均不丢失
import { type AppState, STATE_KEY } from "./types";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadState(storage: StorageLike | undefined): AppState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || !Array.isArray(parsed.units) || !Array.isArray(parsed.relations))
      return null;
    return {
      version: parsed.version ?? 1,
      units: parsed.units ?? [],
      relations: parsed.relations ?? [],
      versions: parsed.versions ?? [],
      conflicts: parsed.conflicts ?? [],
      seededAt: parsed.seededAt ?? null,
    };
  } catch {
    return null;
  }
}

export function saveState(storage: StorageLike | undefined, state: AppState): void {
  if (!storage) return;
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // 配额或隐私模式下静默失败，不影响内存中的工作台
  }
}

export function clearState(storage: StorageLike | undefined): void {
  if (!storage) return;
  storage.removeItem(STATE_KEY);
}
