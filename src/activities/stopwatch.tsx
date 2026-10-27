import { createStore, useTicker } from "../lib/store";
import { FlagIcon, PauseIcon, PlayIcon, StopwatchIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Stopwatch lifecycle. */
type Status = "idle" | "running" | "paused";

/** State of the stopwatch. */
interface WatchState {
  status: Status;
  /** Time accumulated before the current run, in milliseconds. */
  baseMs: number;
  /** Start of the current run as a Unix timestamp in milliseconds. */
  startedAt: number;
  /** Total elapsed time at each lap, oldest first. */
  laps: number[];
}

/** Number of laps kept; older ones are dropped. */
const MAX_LAPS = 50;
/** Laps visible in the panel. */
const SHOWN_LAPS = 3;
/** Color of the stopwatch glyph and readout. */
const TINT = "#32d4c0";

/** Stopwatch state shared by the compact pill and the expanded panel. */
const store = createStore<WatchState>({ status: "idle", baseMs: 0, startedAt: 0, laps: [] });

/**
 * Returns the elapsed time.
 *
 * @param s Stopwatch state.
 * @returns Milliseconds elapsed; computed from the start time while running.
 */
function elapsed(s: WatchState): number {
  return s.status === "running" ? s.baseMs + (Date.now() - s.startedAt) : s.baseMs;
}

/**
 * Formats a duration as `m:ss.t` (tenths), or `h:mm:ss.t` from one hour up.
 *
 * @param ms Duration in milliseconds.
 * @param tenths Whether to append the tenths of a second.
 */
function format(ms: number, tenths = true): string {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  const ss = String(s).padStart(2, "0");
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return tenths ? `${body}.${t}` : body;
}

/** Operations on the stopwatch. */
const actions = {
  start() {
    store.set((s) => ({ ...s, status: "running", startedAt: Date.now() }));
  },
  pause() {
    store.set((s) => ({ ...s, status: "paused", baseMs: elapsed(s) }));
  },
  lap() {
    store.set((s) => ({ ...s, laps: [...s.laps, elapsed(s)].slice(-MAX_LAPS) }));
  },
  reset() {
    store.set({ status: "idle", baseMs: 0, startedAt: 0, laps: [] });
  },
};

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return (
    <span style={{ color: TINT }}>
      <StopwatchIcon size={size} />
    </span>
  );
}

/** Value shown on the right of the compact pill. */
function Trailing() {
  const s = store.use();
  useTicker(s.status === "running", 1000);
  return (
    <span className="timer-readout num" style={{ color: TINT }} data-paused={s.status === "paused"}>
      {format(elapsed(s), false)}
    </span>
  );
}

/** Panel shown in the expanded island. Elapsed time, controls and the latest laps. */
function Expanded() {
  const s = store.use();
  useTicker(s.status === "running", 100);
  const shown = s.laps
    .map((split, i) => ({ n: i + 1, split, lap: split - (i > 0 ? s.laps[i - 1] : 0) }))
    .slice(-SHOWN_LAPS)
    .reverse();

  return (
    <div className="panel panel-stopwatch">
      <div className="timer-big num" style={{ color: TINT }}>
        {format(elapsed(s))}
      </div>
      <ul className="laps" aria-label="Laps">
        {shown.map((l) => (
          <li key={l.n} className="num">
            <span>Lap {l.n}</span>
            <span>+{format(l.lap)}</span>
            <span className="laps-split">{format(l.split)}</span>
          </li>
        ))}
      </ul>
      <div className="timer-actions">
        {s.status === "running" ? (
          <button type="button" className="btn-secondary" onClick={actions.lap}>
            <FlagIcon size={16} /> Lap
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={actions.reset} disabled={s.status === "idle"}>
            Reset
          </button>
        )}
        <button type="button" className="btn-primary" onClick={s.status === "running" ? actions.pause : actions.start}>
          {s.status === "running" ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          {s.status === "running" ? "Pause" : s.status === "paused" ? "Resume" : "Start"}
        </button>
      </div>
    </div>
  );
}

/** Stopwatch activity. A tab when enabled; takes the pill while running or paused. */
export const stopwatch: ActivityModule = {
  id: "stopwatch",
  useActivity(settings) {
    const s = store.use();
    const enabled = settings.activities.stopwatch;
    return {
      id: "stopwatch",
      label: "Stopwatch",
      priority: s.status === "running" ? 58 : 52,
      live: enabled && s.status !== "idle",
      available: enabled,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
