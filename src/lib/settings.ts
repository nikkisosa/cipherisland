import { createStore } from "./store";
import { inTauri, ipc, onEvent, type Settings } from "./ipc";

/** Settings used until the backend reports the saved ones, and in a plain browser. */
export const defaultSettings: Settings = {
  monitor: "primary",
  topOffset: 8,
  hideInFullscreen: true,
  autostart: false,
  paused: false,
  clockIdle: false,
  openOnHover: true,
  attachTop: true,
  theme: "classic",
  accent: "auto",
  motion: "bouncy",
  shape: "round",
  surface: "solid",
  openWidth: "standard",
  tabStyle: "icons",
  sideButtons: true,
  accentCustom: "#0a84ff",
  opacity: 100,
  idleStyle: "plain",
  notchClosed: "flared",
  notchOpen: "flared",
  activities: {
    nowPlaying: true,
    volume: true,
    battery: true,
    timer: true,
    notifications: false,
    clock: true,
    systemStats: true,
    clipboard: false,
    calendar: true,
    quickActions: true,
    stopwatch: true,
    hydration: true,
  },
};

/** Current settings, kept in sync with the backend. */
const store = createStore<Settings>(defaultSettings);

if (inTauri) void ipc.getSettings().then(store.set);
onEvent<Settings>("settings://changed", store.set);

export const useSettings = store.use;
export const getSettings = store.get;
