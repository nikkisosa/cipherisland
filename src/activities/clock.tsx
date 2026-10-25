import { useEffect, useReducer } from "react";
import { ClockIcon } from "../components/Icons";
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

/** Formats `d` as a short local time, for example `9:41 AM`. */
const time = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return <ClockIcon size={size} />;
}

/** Value shown on the right of the compact pill. */
function Trailing() {
  useMinute();
  return <span className="num">{time(new Date())}</span>;
}

/** Panel shown in the expanded island. Large time and the full date. */
function Expanded() {
  useMinute();
  const now = new Date();
  return (
    <div className="panel panel-clock">
      <div className="clock-big num">{time(now)}</div>
      <div className="panel-title">
        {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
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
      expandedHeight: 96,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
