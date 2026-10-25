import { createStore, formatClock } from "../lib/store";
import { MinusIcon, PauseIcon, PlayIcon, PlusIcon, CloseIcon, TimerIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Timer lifecycle. `done` is shown briefly after the countdown reaches zero. */
type Status = "idle" | "running" | "paused" | "done";

/** State of the countdown timer. */
interface TimerState {
  status: Status;
  /** Length chosen in the picker, in milliseconds. Kept between runs. */
  setMs: number;
  endsAt: number;
  remainingMs: number;
  /** Incremented each second while running, to re-render subscribers. */
  tick: number;
}

/** Milliseconds in one minute. */
const MINUTE = 60_000;
/** How long the finished state stays on the pill, in milliseconds. */
const DONE_VISIBLE_MS = 10_000;
/** Preset lengths in minutes. */
const PRESETS = [1, 5, 10, 25];

/** Timer state shared by the compact pill and the expanded panel. */
const store = createStore<TimerState>({ status: "idle", setMs: 5 * MINUTE, endsAt: 0, remainingMs: 0, tick: 0 });

let tickTimer: number | undefined;
let doneTimer: number | undefined;

/**
 * Returns the time left.
 *
 * @param s Timer state.
 * @returns Milliseconds remaining; computed from the end time while running.
 */
function remaining(s: TimerState): number {
  return s.status === "running" ? Math.max(0, s.endsAt - Date.now()) : s.remainingMs;
}

/** Schedules the next display update for the next whole second. Does nothing unless running. */
function schedule() {
  window.clearTimeout(tickTimer);
  const s = store.get();
  if (s.status !== "running") return;
  const left = s.endsAt - Date.now();
  if (left <= 0) return finish();
  tickTimer = window.setTimeout(() => {
    store.set((p) => ({ ...p, tick: p.tick + 1 }));
    schedule();
  }, left % 1000 || 1000);
}

/** Marks the timer as done and returns it to idle after `DONE_VISIBLE_MS`. */
function finish() {
  window.clearTimeout(tickTimer);
  store.set((s) => ({ ...s, status: "done", remainingMs: 0, tick: s.tick + 1 }));
  window.clearTimeout(doneTimer);
  doneTimer = window.setTimeout(() => {
    if (store.get().status === "done") store.set((s) => ({ ...s, status: "idle" }));
  }, DONE_VISIBLE_MS);
}

/** Operations on the timer: `start`, `pause`, `resume`, `cancel`, `adjust` (change the picked length by minutes) and `preset`. */
const actions = {
  start() {
    const ms = store.get().setMs;
    store.set((s) => ({ ...s, status: "running", endsAt: Date.now() + ms, remainingMs: ms }));
    schedule();
  },
  pause() {
    store.set((s) => ({ ...s, status: "paused", remainingMs: remaining(s) }));
    window.clearTimeout(tickTimer);
  },
  resume() {
    store.set((s) => ({ ...s, status: "running", endsAt: Date.now() + s.remainingMs }));
    schedule();
  },
  cancel() {
    window.clearTimeout(tickTimer);
    window.clearTimeout(doneTimer);
    store.set((s) => ({ ...s, status: "idle", remainingMs: 0 }));
  },
  adjust(deltaMin: number) {
    store.set((s) => ({ ...s, setMs: Math.min(180, Math.max(1, s.setMs / MINUTE + deltaMin)) * MINUTE }));
  },
  preset(min: number) {
    store.set((s) => ({ ...s, setMs: min * MINUTE }));
  },
};

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return (
    <span style={{ color: "var(--timer)" }}>
      <TimerIcon size={size} />
    </span>
  );
}

/** Value shown on the right of the compact pill. Remaining time, or `Done`. */
function Trailing() {
  const s = store.use();
  if (s.status === "done") return <span className="timer-readout timer-done">Done</span>;
  return (
    <span className="timer-readout num" data-paused={s.status === "paused"}>
      {formatClock(Math.ceil(remaining(s) / 1000) * 1000)}
    </span>
  );
}

/** Panel shown in the expanded island. Length picker when idle; remaining time and controls otherwise. */
function Expanded() {
  const s = store.use();

  if (s.status === "idle") {
    const min = s.setMs / MINUTE;
    return (
      <div className="panel panel-timer">
        <div className="timer-picker">
          <button type="button" className="ctl ctl-small" aria-label="One minute less" onClick={() => actions.adjust(-1)}>
            <MinusIcon size={18} />
          </button>
          <div className="timer-set num" aria-live="polite">
            {formatClock(s.setMs)}
          </div>
          <button type="button" className="ctl ctl-small" aria-label="One minute more" onClick={() => actions.adjust(1)}>
            <PlusIcon size={18} />
          </button>
        </div>
        <div className="timer-presets" role="group" aria-label="Preset durations">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={min === p}
              onClick={() => actions.preset(p)}
            >
              {p} min
            </button>
          ))}
        </div>
        <button type="button" className="btn-start" onClick={actions.start}>
          Start timer
        </button>
      </div>
    );
  }

  const left = remaining(s);
  const total = Math.max(s.setMs, 1);
  const ratio = s.status === "done" ? 0 : Math.min(1, left / total);
  return (
    <div className="panel panel-timer">
      <div className="timer-running">
        <div className="timer-big num" data-done={s.status === "done"}>
          {s.status === "done" ? "Time's up" : formatClock(Math.ceil(left / 1000) * 1000)}
        </div>
        <div className="progress-track timer-track" aria-hidden="true">
          <div className="progress-fill timer-fill" style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>
      <div className="timer-actions">
        <button type="button" className="btn-secondary" onClick={actions.cancel}>
          <CloseIcon size={16} /> {s.status === "done" ? "Dismiss" : "Cancel"}
        </button>
        {s.status !== "done" && (
          <button type="button" className="btn-primary" onClick={s.status === "running" ? actions.pause : actions.resume}>
            {s.status === "running" ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            {s.status === "running" ? "Pause" : "Resume"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Timer activity. Always available as a tab so a countdown can be started from it. */
export const timer: ActivityModule = {
  id: "timer",
  useActivity(settings) {
    const s = store.use();
    const enabled = settings.activities.timer;
    return {
      id: "timer",
      label: "Timer",
      priority: s.status === "done" ? 97 : s.status === "running" ? 60 : 55,
      live: enabled && s.status !== "idle",
      available: enabled,
      expandedHeight: 140,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
