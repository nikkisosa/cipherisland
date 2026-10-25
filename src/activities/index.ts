import type { Settings } from "../lib/ipc";
import { battery } from "./battery";
import { calendar } from "./calendar";
import { clipboard } from "./clipboard";
import { clock } from "./clock";
import { notifications } from "./notifications";
import { nowPlaying } from "./nowPlaying";
import { systemStats } from "./systemStats";
import { timer } from "./timer";
import type { Activity, ActivityModule } from "./types";
import { volume } from "./volume";

/** All activity modules. The list is constant so their hooks run in the same order on every render. */
const modules: readonly ActivityModule[] = [volume, notifications, clipboard, battery, timer, nowPlaying, systemStats, calendar, clock];

/** Result of [useActivities]. */
export interface ActivityView {
  /** Activities wanting the pill, highest priority first. Index 0 takes the compact pill, index 1 the split circle. */
  live: Activity[];
  /** Activities that have a tab in the expanded view, highest priority first. */
  tabs: Activity[];
}

/**
 * Evaluates every activity module for the current settings.
 *
 * @param settings Current user settings.
 * @returns The activities wanting the pill and those offering a tab.
 */
export function useActivities(settings: Settings): ActivityView {
  const all = modules.map((m) => m.useActivity(settings));
  return {
    live: all.filter((a) => a.live).sort((a, b) => b.priority - a.priority),
    tabs: all.filter((a) => a.available).sort((a, b) => b.priority - a.priority),
  };
}
