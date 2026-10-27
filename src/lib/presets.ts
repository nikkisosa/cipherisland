import type { Settings } from "./ipc";

/** The appearance settings a preset controls. Everything else (widgets, monitor, startup) is left alone. */
export type PresetValues = Pick<
  Settings,
  | "theme"
  | "accent"
  | "motion"
  | "shape"
  | "surface"
  | "openWidth"
  | "tabStyle"
  | "idleStyle"
  | "notchClosed"
  | "notchOpen"
  | "attachTop"
  | "topOffset"
  | "opacity"
>;

/** A ready-made look: a name, a one-line description and the settings it applies. */
export interface Preset {
  id: string;
  label: string;
  note: string;
  values: PresetValues;
}

/** Fields shared by every preset unless it overrides them. */
const BASE: PresetValues = {
  theme: "classic",
  accent: "auto",
  motion: "smooth",
  shape: "round",
  surface: "solid",
  openWidth: "standard",
  tabStyle: "icons",
  idleStyle: "plain",
  notchClosed: "flared",
  notchOpen: "flared",
  attachTop: true,
  topOffset: 8,
  opacity: 100,
};

/**
 * Ready-made looks, shown as cards in Settings. The first is the default recommendation.
 *
 * Every preset sets every appearance field, so applying one fully replaces the previous look.
 */
export const PRESETS: Preset[] = [
  {
    id: "notch",
    label: "Notch",
    note: "Black, docked, wide shoulders",
    values: { ...BASE },
  },
  {
    id: "island",
    label: "Island",
    note: "Floating black pill, springy",
    values: { ...BASE, motion: "bouncy", attachTop: false, topOffset: 10, notchClosed: "flat", notchOpen: "flat" },
  },
  {
    id: "graphite-pro",
    label: "Graphite Pro",
    note: "Soft charcoal with blue accents",
    values: { ...BASE, theme: "graphite", accent: "blue", shape: "soft", tabStyle: "labels" },
  },
  {
    id: "midnight-glass",
    label: "Midnight Glass",
    note: "Deep blue, see-through",
    values: { ...BASE, theme: "midnight", accent: "teal", surface: "glass", tabStyle: "dots", opacity: 90 },
  },
  {
    id: "light-studio",
    label: "Light Studio",
    note: "Bright and clean",
    values: { ...BASE, theme: "light", accent: "blue", shape: "soft", tabStyle: "labels" },
  },
  {
    id: "sunset-float",
    label: "Sunset Float",
    note: "Warm amber, floating, outlined",
    values: {
      ...BASE,
      theme: "sunset",
      accent: "orange",
      motion: "bouncy",
      surface: "outline",
      attachTop: false,
      topOffset: 10,
      notchClosed: "flat",
      notchOpen: "flat",
    },
  },
  {
    id: "forest-minimal",
    label: "Forest Minimal",
    note: "Green, sharp corners, quick",
    values: { ...BASE, theme: "forest", accent: "green", motion: "snappy", shape: "sharp", openWidth: "narrow", tabStyle: "dots" },
  },
  {
    id: "violet-neon",
    label: "Violet Neon",
    note: "Purple glow, wide, outlined",
    values: { ...BASE, theme: "violet", accent: "purple", motion: "bouncy", surface: "outline", openWidth: "wide", idleStyle: "glow" },
  },
];

/**
 * Finds the preset whose values equal the given settings.
 *
 * @param settings Current settings.
 * @returns The matching preset, or `undefined` when the look has been customized.
 */
export function activePreset(settings: Settings): Preset | undefined {
  return PRESETS.find((p) => (Object.keys(p.values) as (keyof PresetValues)[]).every((k) => settings[k] === p.values[k]));
}
