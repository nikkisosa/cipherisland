import type { ComponentType } from "react";
import type { Settings } from "../lib/ipc";

/** Identifier of an activity module. */
export type ActivityId = "volume" | "battery" | "notifications" | "timer" | "nowPlaying" | "clock" | "systemStats" | "clipboard" | "calendar" | "stopwatch" | "hydration";

/**
 * Description of an activity for the current render.
 *
 * Activities with `live` set compete for the compact pill and the split circle in order of
 * `priority`, highest first. Activities with `available` set get a tab in the expanded view.
 * The components are defined at module level and read their own state, so they keep a stable
 * identity between renders.
 */
export interface Activity {
  id: ActivityId;
  label: string;
  priority: number;
  live: boolean;
  available: boolean;
  Glyph: ComponentType<{ size?: number }>;
  Trailing: ComponentType;
  /** Optional text between glyph and value in the compact pill (e.g. the track title). */
  Title?: ComponentType;
  /** Compact pill width when this activity is primary and has a title. */
  compactWidth?: number;
  /** Optional thin progress line along the bottom of the compact pill (renders nothing when idle). */
  Progress?: ComponentType;
  Expanded: ComponentType;
}

/** An activity module. `useActivity` is a React hook and is called on every render of the island. */
export interface ActivityModule {
  id: ActivityId;
  useActivity(settings: Settings): Activity;
}
