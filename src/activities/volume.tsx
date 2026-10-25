import { useEffect, type CSSProperties } from "react";
import { createStore, useUntil } from "../lib/store";
import { inTauri, ipc, onEvent } from "../lib/ipc";
import { SpeakerIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** How long the level pill stays on screen, in milliseconds. */
const SHOW_MS = 1500;

/** Latest volume and the time until which the level pill stays on screen. */
const store = createStore({ level: 0, muted: false, until: 0 });

onEvent<{ level: number; muted: boolean }>("audio://volume", ({ level, muted }) =>
  store.set({ level, muted, until: Date.now() + SHOW_MS }),
);

/** Returns the volume as a whole percentage, or 0 while muted. */
const percent = (s: { level: number; muted: boolean }) => (s.muted ? 0 : Math.round(s.level * 100));

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 18 }: { size?: number }) {
  const s = store.use();
  return <SpeakerIcon size={size} level={s.level} muted={s.muted} />;
}

/** Value shown on the right of the compact pill. Level bar and percentage. */
function Trailing() {
  const s = store.use();
  return (
    <div className="volume-meter">
      <div className="volume-track" aria-hidden="true">
        <div className="volume-fill" style={{ width: `${percent(s)}%` }} />
      </div>
      <span className="num">{percent(s)}</span>
    </div>
  );
}

/**
 * Mute button, slider and percentage readout, used by the Volume tab and the Now playing panel.
 *
 * Reads the system volume when mounted and writes it on every change.
 *
 * @param props.className Extra class names for the outer element.
 */
export function VolumeSlider({ className = "" }: { className?: string }) {
  const s = store.use();

  // Events arrive only on change, so read the current level when mounted.
  useEffect(() => {
    if (!inTauri) return;
    void ipc
      .getVolume()
      .then((v) => v && store.set((p) => ({ ...p, level: v.level, muted: v.muted })))
      .catch(() => undefined);
  }, []);

  const set = (level: number) => {
    store.set((p) => ({ ...p, level, muted: false, until: 0 }));
    void ipc.setVolume(level).catch(() => undefined);
  };

  return (
    <div className={`volume-meter volume-meter-large ${className}`}>
      <button
        type="button"
        className="ctl ctl-small"
        aria-label={s.muted ? "Unmute" : "Mute"}
        onClick={() => void ipc.quickAction("mute")}
      >
        <SpeakerIcon size={20} level={s.level} muted={s.muted} />
      </button>
      <input
        className="vslider"
        type="range"
        min={0}
        max={100}
        value={percent(s)}
        aria-label="Volume"
        style={{ "--fill": `${percent(s)}%` } as CSSProperties}
        onChange={(e) => set(Number(e.target.value) / 100)}
      />
      <span className="num volume-readout">{s.muted ? "Muted" : `${percent(s)}%`}</span>
    </div>
  );
}

/** Panel shown in the expanded island. Volume slider. */
function Expanded() {
  return (
    <div className="panel panel-volume">
      <div className="panel-title">Volume</div>
      <VolumeSlider />
    </div>
  );
}

/** Volume activity: a level pill when the volume changes, and a slider tab. */
export const volume: ActivityModule = {
  id: "volume",
  useActivity(settings) {
    const s = store.use();
    const showing = useUntil(s.until);
    return {
      id: "volume",
      label: "Volume",
      priority: 100,
      live: settings.activities.volume && showing,
      available: settings.activities.volume,
      expandedHeight: 84,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
