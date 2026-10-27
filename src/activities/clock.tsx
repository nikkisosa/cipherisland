import { useEffect, useReducer, useState } from "react";
import { ClockIcon } from "../components/Icons";
import { useTicker } from "../lib/store";
import type { ActivityModule } from "./types";

/** Re-renders at the start of every minute while the calling component is mounted. */
function useMinute() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let id: number;
    const arm = () => {
      id = window.setTimeout(() => {
        rerender();
        arm();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    arm();
    return () => window.clearTimeout(id);
  }, []);
}

/** Time zones the clock panel cycles through when clicked. `null` is the local zone. */
const ZONES: { label: string; tz: string | null }[] = [
  { label: "Local", tz: null },
  { label: "UTC", tz: "UTC" },
  { label: "New York", tz: "America/New_York" },
  { label: "London", tz: "Europe/London" },
  { label: "Dubai", tz: "Asia/Dubai" },
  { label: "Singapore", tz: "Asia/Singapore" },
  { label: "Tokyo", tz: "Asia/Tokyo" },
  { label: "Sydney", tz: "Australia/Sydney" },
];
/** localStorage key for the selected zone. */
const ZONE_KEY = "island.clock.zone";

/** Formats `d` as a short local time, for example `9:41 AM`. */
const time = (d: Date, tz?: string | null) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return <ClockIcon size={size} />;
}

/** Value shown on the right of the compact pill. */
function Trailing() {
  useMinute();
  return <span className="num">{time(new Date())}</span>;
}

/**
 * Analog clock face with a sweeping second hand.
 *
 * @param props.now The time to show, in the local zone.
 */
function Face({ now }: { now: Date }) {
  const s = now.getSeconds();
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  return (
    <svg className="clock-face" viewBox="0 0 100 100" role="img" aria-label={`Analog clock, ${time(now)}`}>
      <circle className="face-rim" cx="50" cy="50" r="47" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} className={i % 3 === 0 ? "face-tick face-tick-major" : "face-tick"} x1="50" y1="6" x2="50" y2={i % 3 === 0 ? 14 : 11} transform={`rotate(${i * 30} 50 50)`} />
      ))}
      <line className="hand hand-h" x1="50" y1="50" x2="50" y2="28" transform={`rotate(${h * 30} 50 50)`} />
      <line className="hand hand-m" x1="50" y1="50" x2="50" y2="17" transform={`rotate(${m * 6} 50 50)`} />
      <line className="hand hand-s" x1="50" y1="56" x2="50" y2="13" transform={`rotate(${s * 6} 50 50)`} />
      <circle className="face-pin" cx="50" cy="50" r="2.6" />
    </svg>
  );
}

/** Panel shown in the expanded island. Analog face, digital time, date and a world-clock line. */
function Expanded() {
  useTicker(true, 1000);
  const [zone, setZone] = useState(() => {
    try {
      return Math.min(ZONES.length - 1, Math.max(0, Number(localStorage.getItem(ZONE_KEY)) || 0));
    } catch {
      return 0;
    }
  });
  const now = new Date();
  const z = ZONES[zone];
  const cycle = () => {
    const next = (zone + 1) % ZONES.length;
    setZone(next);
    try {
      localStorage.setItem(ZONE_KEY, String(next));
    } catch {
      /* the choice then lasts until the app closes */
    }
  };

  return (
    <div className="panel panel-clock">
      <Face now={now} />
      <div className="clock-text">
        <div className="clock-big num">{time(now)}</div>
        <div className="panel-title">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
        <button type="button" className="zone-chip" onClick={cycle} title="Show another city">
          <span>{z.label}</span>
          <span className="num">{z.tz ? time(now, z.tz) : time(now)}</span>
        </button>
      </div>
    </div>
  );
}

/** Clock activity. Always available as a tab; can also occupy the compact pill when idle. */
export const clock: ActivityModule = {
  id: "clock",
  useActivity(settings) {
    const enabled = settings.activities.clock;
    return {
      id: "clock",
      label: "Clock",
      priority: 10,
      live: enabled && settings.clockIdle,
      available: enabled,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
