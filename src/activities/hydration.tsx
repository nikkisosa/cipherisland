import { createStore, useUntil } from "../lib/store";
import { DropIcon, MinusIcon, PlusIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Glasses of water per day to aim for. */
const GOAL = 8;
/** How long the pill shows the count after a change, in milliseconds. */
const SHOW_MS = 2500;
/** localStorage key for the saved count. */
const KEY = "island.hydration";
/** Ring geometry. */
const RADIUS = 38;
const CIRC = 2 * Math.PI * RADIUS;

/** Today's date as `YYYY-MM-DD` in local time. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Loads today's count; a count saved on an earlier day starts again from zero. */
function load(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { day: string; glasses: number } | null;
    return saved && saved.day === today() ? Math.max(0, Math.min(99, saved.glasses | 0)) : 0;
  } catch {
    return 0;
  }
}

/** Glasses today, the day they belong to, and the time until which the pill shows the count. */
const store = createStore({ glasses: load(), day: today(), until: 0 });

/** Changes the count by `delta`, starting a new day at zero when the date has moved on. */
function add(delta: number) {
  store.set((s) => {
    const base = s.day === today() ? s.glasses : 0;
    const glasses = Math.max(0, Math.min(99, base + delta));
    try {
      localStorage.setItem(KEY, JSON.stringify({ day: today(), glasses }));
    } catch {
      /* storage can be unavailable; the count then lasts until the app closes */
    }
    return { glasses, day: today(), until: Date.now() + SHOW_MS };
  });
}

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return (
    <span style={{ color: "#4da3ff" }}>
      <DropIcon size={size} />
    </span>
  );
}

/** Value shown on the right of the compact pill. */
function Trailing() {
  const { glasses } = store.use();
  return (
    <span className="num" style={{ color: "#4da3ff" }}>
      {glasses}/{GOAL}
    </span>
  );
}

/** Panel shown in the expanded island. A progress ring and buttons to add or remove a glass. */
function Expanded() {
  const { glasses } = store.use();
  const ratio = Math.min(1, glasses / GOAL);
  return (
    <div className="panel panel-water">
      <div className="water-ring" data-done={glasses >= GOAL}>
        <svg viewBox="0 0 90 90" aria-hidden="true">
          <circle className="water-track" cx="45" cy="45" r={RADIUS} />
          <circle
            className="water-arc"
            cx="45"
            cy="45"
            r={RADIUS}
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - ratio)}
            transform="rotate(-90 45 45)"
          />
        </svg>
        <div className="water-count num" aria-live="polite">
          {glasses}
          <small>/{GOAL}</small>
        </div>
      </div>
      <div className="water-side">
        <div className="panel-title">{glasses >= GOAL ? "Goal reached" : "Water today"}</div>
        <div className="water-note">{glasses >= GOAL ? "Nicely done." : `${GOAL - glasses} more to go`}</div>
        <div className="water-actions">
          <button type="button" className="ctl ctl-small" aria-label="Remove a glass" onClick={() => add(-1)} disabled={glasses === 0}>
            <MinusIcon size={18} />
          </button>
          <button type="button" className="btn-primary water-add" onClick={() => add(1)}>
            <PlusIcon size={16} /> Glass
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hydration activity. A tab when enabled; flashes the count on the pill after each change. */
export const hydration: ActivityModule = {
  id: "hydration",
  useActivity(settings) {
    const { until } = store.use();
    const showing = useUntil(until);
    const enabled = settings.activities.hydration;
    return {
      id: "hydration",
      label: "Water",
      priority: 88,
      live: enabled && showing,
      available: enabled,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
