import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Which widgets are enabled. Mirrors `Activities` in `settings.rs`. */
export interface ActivitiesSettings {
  nowPlaying: boolean;
  volume: boolean;
  battery: boolean;
  timer: boolean;
  notifications: boolean;
  clock: boolean;
  systemStats: boolean;
  clipboard: boolean;
  calendar: boolean;
  quickActions: boolean;
  stopwatch: boolean;
  hydration: boolean;
}

/** Edge style where the island meets the top of the screen. `flared` adds curved shoulders. */
export type NotchId = "flat" | "flared";

/** Look of the closed island when idle. */
export type IdleStyleId = "plain" | "dot" | "glow" | "breathe" | "aurora";

/** Corner style of the island and its buttons. */
export type ShapeId = "round" | "soft" | "sharp";

/** How the island surface is drawn. */
export type SurfaceId = "solid" | "glass" | "outline";

/** Width of the open island. */
export type OpenWidthId = "narrow" | "standard" | "wide";

/** How tabs are shown in the open island. */
export type TabStyleId = "icons" | "labels" | "dots";

/** Animation feel. */
export type MotionId = "bouncy" | "smooth" | "snappy";

/** Island theme. */
export type ThemeId = "classic" | "graphite" | "midnight" | "light" | "forest" | "rose" | "sunset" | "ocean" | "violet" | "gold";
/** Accent color for progress bars and highlights. `auto` follows the theme. */
export type AccentId = "auto" | "blue" | "green" | "orange" | "pink" | "teal" | "purple" | "red" | "yellow" | "custom";

/** User settings. Mirrors `Settings` in `settings.rs`. */
export interface Settings {
  monitor: string;
  topOffset: number;
  hideInFullscreen: boolean;
  autostart: boolean;
  paused: boolean;
  clockIdle: boolean;
  openOnHover: boolean;
  attachTop: boolean;
  theme: ThemeId;
  accent: AccentId;
  motion: MotionId;
  shape: ShapeId;
  surface: SurfaceId;
  openWidth: OpenWidthId;
  tabStyle: TabStyleId;
  sideButtons: boolean;
  accentCustom: string;
  opacity: number;
  idleStyle: IdleStyleId;
  notchClosed: NotchId;
  notchOpen: NotchId;
  activities: ActivitiesSettings;
}

/** A monitor in the monitor picker. */
export interface MonitorOption {
  id: string;
  label: string;
  primary: boolean;
}

/** Rectangle in canvas-relative CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** CPU, memory, disk and network load. Network rates are in bytes per second. */
export interface SystemStats {
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  netDown: number;
  netUp: number;
}

/** Quick actions the backend can run. */
export type QuickAction = "mute" | "snip" | "lock" | "tasks" | "desktop" | "files" | "emoji";

/** Transport commands for the current media session. */
export type MediaAction = "play_pause" | "next" | "previous";

/** Typed wrappers for the backend commands. */
export const ipc = {
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),
  listMonitors: () => invoke<MonitorOption[]>("list_monitors"),
  reportHitRegions: (rects: Rect[], hover: Rect[], passClicks: boolean) =>
    invoke<void>("report_hit_regions", { rects, hover, passClicks }),
  setOutsideWatch: (watch: boolean) => invoke<void>("set_outside_watch", { watch }),
  systemStats: () => invoke<SystemStats>("system_stats"),
  quickAction: (name: QuickAction) => invoke<void>("quick_action", { name }),
  setKeepAwake: (on: boolean) => invoke<void>("set_keep_awake", { on }),
  copyText: (text: string) => invoke<boolean>("copy_text", { text }),
  mediaSeek: (positionMs: number) => invoke<void>("media_seek", { positionMs }),
  getVolume: () => invoke<{ level: number; muted: boolean } | null>("get_volume"),
  setVolume: (level: number) => invoke<void>("set_volume", { level }),
  mediaControl: (action: MediaAction) => invoke<void>("media_control", { action }),
  frontendReady: () => invoke<void>("frontend_ready"),
  openSettings: () => invoke<void>("open_settings"),
  togglePause: () => invoke<void>("toggle_pause"),
  openGithub: () => invoke<void>("open_github"),
  quit: () => invoke<void>("quit_app"),
};

/** True when running inside the Tauri webview rather than a plain browser. */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Outside Tauri (plain `npm run dev` in a browser) events come from a mock bus. In the
// console, `window.__emit("audio://volume", { level: 0.4, muted: false })` simulates one.
const mockBus = new EventTarget();
if (!inTauri && import.meta.env.DEV) {
  (window as unknown as { __emit: (event: string, payload: unknown) => void }).__emit = (event, payload) =>
    mockBus.dispatchEvent(new CustomEvent(event, { detail: payload }));
}

/**
 * Subscribes to a backend event for the lifetime of the page.
 *
 * @param event Event name, for example `audio://volume`.
 * @param handler Called with each event's payload.
 */
export function onEvent<T>(event: string, handler: (payload: T) => void) {
  if (inTauri) void listen<T>(event, (e) => handler(e.payload));
  else mockBus.addEventListener(event, (e) => handler((e as CustomEvent<T>).detail));
}
