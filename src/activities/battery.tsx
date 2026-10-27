import { motion } from "framer-motion";
import { createStore, useUntil } from "../lib/store";
import { onEvent } from "../lib/ipc";
import { BatteryIcon, BoltIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Payload of the `battery://state` event. */
interface BatteryState {
  hasBattery: boolean;
  level: number | null;
  charging: boolean;
  pluggedIn: boolean;
  secondsLeft: number | null;
}

/** Transient states that take the compact pill: plug-in animation and low-battery warnings. */
type AlertKind = "charging" | "low20" | "low10";

/** Latest battery state and the active alert, if any. */
const store = createStore<{ state: BatteryState | null; alert: { kind: AlertKind; until: number } | null }>({
  state: null,
  alert: null,
});

/** How long each alert stays on screen, in milliseconds. */
const ALERT_MS: Record<AlertKind, number> = { charging: 4000, low20: 6000, low10: 8000 };

onEvent<BatteryState>("battery://state", (next) => {
  const { state: prev, alert: current } = store.get();
  let alert = current;
  const raise = (kind: AlertKind) => (alert = { kind, until: Date.now() + ALERT_MS[kind] });

  if (next.hasBattery) {
    if (prev && !prev.pluggedIn && next.pluggedIn) raise("charging");
    if (!next.pluggedIn && next.level !== null) {
      // With no previous reading, assume the battery was full so a low level at launch warns once.
      const before = prev?.level ?? 100;
      if (next.level <= 10 && before > 10) raise("low10");
      else if (next.level <= 20 && before > 20) raise("low20");
    }
  }
  store.set({ state: next, alert });
});

/**
 * Returns the CSS color for the battery glyph and text.
 *
 * @param state Current battery state, or `null` before the first reading.
 * @returns Green when plugged in, red at 10% or below, yellow at 20% or below, otherwise the text color.
 */
function tone(state: BatteryState | null) {
  if (!state) return "currentColor";
  if (state.pluggedIn) return "var(--ok)";
  const level = state.level ?? 100;
  if (level <= 10) return "var(--danger)";
  if (level <= 20) return "var(--warn)";
  return "currentColor";
}

/** Leading glyph of the compact pill and the tab strip. Shows a pulsing bolt during the plug-in alert. */
function Glyph({ size = 20 }: { size?: number }) {
  const { state, alert } = store.use();
  const charging = alert?.kind === "charging" && Date.now() < alert.until;
  return (
    <span className="battery-glyph" style={{ color: tone(state) }}>
      <BatteryIcon size={size} level={state?.level ?? 0} color={tone(state)} />
      {charging && (
        <motion.span
          className="battery-bolt"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <BoltIcon size={size * 0.62} />
        </motion.span>
      )}
    </span>
  );
}

/** Value shown on the right of the compact pill. Shows the percentage, with a label for low-battery alerts. */
function Trailing() {
  const { state, alert } = store.use();
  const label = alert?.kind === "low10" ? "Critical" : alert?.kind === "low20" ? "Low" : null;
  return (
    <span className="battery-readout" style={{ color: tone(state) }}>
      {label && <span className="battery-label">{label}</span>}
      <span className="num">{state?.level ?? "--"}%</span>
    </span>
  );
}

/**
 * Describes the power state in words.
 *
 * @param state Current battery state, or `null` before the first reading.
 * @returns For example `Charging` or `On battery, 2 h 10 min left`.
 */
function describe(state: BatteryState | null): string {
  if (!state) return "Reading battery";
  if (state.pluggedIn && state.charging) return "Charging";
  if (state.pluggedIn) return "Plugged in";
  if (state.secondsLeft !== null) {
    const h = Math.floor(state.secondsLeft / 3600);
    const m = Math.round((state.secondsLeft % 3600) / 60);
    return `On battery, ${h > 0 ? `${h} h ` : ""}${m} min left`;
  }
  return "On battery";
}

/** Panel shown in the expanded island. */
function Expanded() {
  const { state } = store.use();
  const level = state?.level ?? 0;
  return (
    <div className="panel panel-battery">
      <div className="battery-big" style={{ color: tone(state) }}>
        <Glyph size={34} />
        <span className="num battery-percent">{state?.level ?? "--"}%</span>
      </div>
      <div className="battery-detail">
        <div className="panel-title">{describe(state)}</div>
        <div className="battery-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
          <div className="battery-fill" style={{ width: `${level}%`, background: tone(state) }} />
        </div>
      </div>
    </div>
  );
}

/** Battery activity. Raises a pill on plug-in and at 20% and 10%, and offers a tab when a battery exists. */
export const battery: ActivityModule = {
  id: "battery",
  useActivity(settings) {
    const { state, alert } = store.use();
    const showing = useUntil(alert?.until ?? 0);
    const enabled = settings.activities.battery && !!state?.hasBattery;
    return {
      id: "battery",
      label: "Battery",
      priority: 90,
      live: enabled && showing,
      available: enabled,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
