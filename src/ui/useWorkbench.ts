import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildSeedState,
  createStore,
  loadState,
  saveState,
  clearState,
  type AppState,
  type Role,
  type Store,
} from "../domain";

const ROLE_KEY = "strata-workbench:role";

function getBrowserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export interface Toast {
  id: number;
  ok: boolean;
  text: string;
}

export interface Workbench {
  state: AppState;
  store: Store;
  role: Role;
  setRole: (r: Role) => void;
  toasts: Toast[];
  /** 执行 store 动作；失败自动弹提示（冲突本身已由 store 写入冲突日志） */
  run: <T extends { ok: boolean }>(fn: () => T) => T;
  resetAll: () => void;
  dismissToast: (id: number) => void;
}

export function useWorkbench(): Workbench {
  const storage = getBrowserStorage();
  const [role, setRoleState] = useState<Role>(() => {
    const saved = storage?.getItem(ROLE_KEY);
    return saved === "leader" || saved === "curator" || saved === "worker"
      ? saved
      : "worker";
  });

  const storeRef = useRef<Store | null>(null);
  if (storeRef.current === null) {
    const loaded = loadState(storage);
    storeRef.current = createStore(loaded ?? buildSeedState());
  }
  const store = storeRef.current;
  const [state, setState] = useState<AppState>(() => store.getState());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  /** 同步内存 → React → localStorage（刷新后关系/状态/版本均保留） */
  const sync = useCallback(() => {
    const next = store.getState();
    setState(next);
    saveState(storage, next);
  }, [store, storage]);

  const pushToast = useCallback((ok: boolean, text: string) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, ok, text }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  const run = useCallback(
    <T extends { ok: boolean }>(fn: () => T): T => {
      const result = fn();
      if (!result.ok && "message" in result) {
        pushToast(false, String((result as { message: string }).message));
      }
      sync();
      return result;
    },
    [pushToast, sync]
  );

  const setRole = useCallback(
    (r: Role) => {
      setRoleState(r);
      storage?.setItem(ROLE_KEY, r);
    },
    [storage]
  );

  const resetAll = useCallback(() => {
    clearState(storage);
    window.location.reload();
  }, [storage]);

  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    []
  );

  return useMemo(
    () => ({
      state,
      store,
      role,
      setRole,
      toasts,
      run,
      resetAll,
      dismissToast,
    }),
    [state, store, role, setRole, toasts, run, resetAll, dismissToast]
  );
}
