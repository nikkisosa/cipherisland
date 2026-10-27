import type { CSSProperties } from "react";
import type { AccentId } from "./ipc";

/**
 * Returns the readable text color for a background color.
 *
 * @param hex Background as `#rrggbb`.
 * @returns Near-black for light backgrounds, white for dark ones.
 */
export function contrastOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#101114" : "#ffffff";
}

/**
 * Builds the inline style for the custom accent color.
 *
 * Preset accents are plain CSS rules, but a custom color is only known at run time, so it is
 * set as custom properties on the element.
 *
 * @param accent The selected accent.
 * @param custom The custom color as `#rrggbb`.
 * @returns Custom properties for `custom`, otherwise `undefined`.
 */
export function accentStyle(accent: AccentId, custom: string): CSSProperties | undefined {
  if (accent !== "custom") return undefined;
  return { ["--accent" as string]: custom, ["--on-accent" as string]: contrastOn(custom) } as CSSProperties;
}
