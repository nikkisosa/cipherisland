import { useEffect, useReducer } from "react";
import { CalendarIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Re-renders just after local midnight so the highlighted day stays current. */
function useToday() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const id = window.setTimeout(rerender, midnight.getTime() - now.getTime());
    return () => window.clearTimeout(id);
  }, []);
}

/** First day of the week as a `Date.getDay()` value (1 = Monday). */
const WEEK_START = 1;

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return <CalendarIcon size={size} />;
}

/** Panel shown in the expanded island. Month grid with today highlighted. */
function Expanded() {
  useToday();
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const lead = (new Date(year, month, 1).getDay() - WEEK_START + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  // Locale-aware narrow weekday labels starting on `WEEK_START`; 2024-01-01 is a Monday.
  const labels = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + ((i + WEEK_START - 1) % 7)).toLocaleDateString([], { weekday: "narrow" }),
  );

  return (
    <div className="panel panel-calendar">
      <div className="cal-day">
        <span className="cal-weekday">{today.toLocaleDateString([], { weekday: "long" })}</span>
        <span className="cal-date num">{today.getDate()}</span>
        <span className="cal-month">{today.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
      </div>
      <div className="cal-grid" role="grid" aria-label={today.toLocaleDateString([], { month: "long", year: "numeric" })}>
        {labels.map((l, i) => (
          <span key={`h${i}`} className="cal-label" role="columnheader">
            {l}
          </span>
        ))}
        {cells.map((d, i) => (
          <span key={i} className="cal-cell num" role="gridcell" data-today={d === today.getDate()} aria-current={d === today.getDate() ? "date" : undefined}>
            {d ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Calendar activity: a month view available as a tab. */
export const calendar: ActivityModule = {
  id: "calendar",
  useActivity(settings) {
    const enabled = settings.activities.calendar;
    return {
      id: "calendar",
      label: "Calendar",
      priority: 4,
      live: false,
      available: enabled,
      expandedHeight: 156,
      Glyph,
      Trailing: () => null,
      Expanded,
    };
  },
};
