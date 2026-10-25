import { useEffect, useReducer, useSyncExternalStore } from "react";

/**
 * Creates a minimal external store, so modules can keep state outside React.
 *
 * @param initial Initial state.
 * @returns `get`, `set` (value or updater), `subscribe`, and `use`, a hook that re-renders on change.
 */
export function createStore<T>(initial: T) {
  let state = initial;
  const subscribers = new Set<() => void>();

  const get = () => state;
  const subscribe = (cb: () => void) => {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  };
  const set = (next: T | ((prev: T) => T)) => {
    state = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
    subscribers.forEach((cb) => cb());
  };
  const use = () => useSyncExternalStore(subscribe, get);

  return { get, set, subscribe, use };
}

/**
 * Reports whether a deadline is still in the future, re-rendering once when it passes.
 *
 * @param until Deadline as a Unix timestamp in milliseconds.
 * @returns True while `Date.now()` is before `until`.
 */
export function useUntil(until: number): boolean {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const wait = until - Date.now();
    if (wait <= 0) return;
    const id = window.setTimeout(rerender, wait + 5);
    return () => window.clearTimeout(id);
  }, [until]);
  return Date.now() < until;
}

/**
 * Re-renders the calling component at a fixed interval while `active`.
 *
 * @param active Whether the interval runs.
 * @param ms Interval in milliseconds.
 */
export function useTicker(active: boolean, ms: number) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(rerender, ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
}

/**
 * Formats a duration as `m:ss`, or `h:mm:ss` from one hour up.
 *
 * @param totalMs Duration in milliseconds; negative values are treated as zero.
 * @returns The formatted string, rounded to the nearest second.
 */
export function formatClock(totalMs: number): string {
  const total = Math.max(0, Math.round(totalMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
