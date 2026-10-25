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
  },
};

/** Current settings, kept in sync with the backend. */
const store = createStore<Settings>(defaultSettings);

if (inTauri) {
  void ipc.getSettings().then(store.set);
  onEvent<Settings>("settings://changed", store.set);
}

export const useSettings = store.use;
export const getSettings = store.get;
