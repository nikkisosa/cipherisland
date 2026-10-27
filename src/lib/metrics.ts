import type { MotionId, OpenWidthId, ShapeId } from "./ipc";

/** Logical size of the transparent native window. Must match `CANVAS_W` and `CANVAS_H` in `window.rs`. */
export const CANVAS = { w: 500, h: 290 } as const;

/** Pill dimensions in pixels. */
export const SHAPES = {
  collapsed: { w: 126, h: 37 },
  compact: { w: 250, h: 37 },
  /** Height of the expanded body for every activity, excluding the tab strip. */
  expandedBody: 188,
  tabStrip: 36,
  splitGap: 8,
} as const;

/** Width of the open island for each size option, in pixels. */
export const OPEN_WIDTHS: Record<OpenWidthId, number> = { narrow: 330, standard: 370, wide: 400 };

/**
 * Corner radii in pixels for each shape option. `closed` is `null` for a fully rounded
 * (half-height) closed pill.
 */
export const RADII: Record<ShapeId, { open: number; closed: number | null }> = {
  round: { open: 42, closed: null },
  soft: { open: 28, closed: 14 },
  sharp: { open: 16, closed: 8 },
};

/** Default spring for shape changes. Damping ratio is about 0.75, giving a slight overshoot. */
export const SPRING = { type: "spring", stiffness: 400, damping: 30, mass: 1 } as const;

/** Spring pair for one animation style: `close` for most changes, `open` while the island opens. */
interface SpringPair {
  close: { type: "spring"; stiffness: number; damping: number; mass: number };
  open: { type: "spring"; stiffness: number; damping: number; mass: number };
}

/**
 * Springs for each animation style. Bouncy overshoots the open height like a pulled drop,
 * smooth settles without overshoot, and snappy is quick and tightly damped.
 */
export const SPRINGS: Record<MotionId, SpringPair> = {
  bouncy: { close: SPRING, open: { type: "spring", stiffness: 280, damping: 17, mass: 1 } },
  smooth: {
    close: { type: "spring", stiffness: 220, damping: 28, mass: 1 },
    open: { type: "spring", stiffness: 200, damping: 26, mass: 1 },
  },
  snappy: {
    close: { type: "spring", stiffness: 520, damping: 42, mass: 1 },
    open: { type: "spring", stiffness: 540, damping: 36, mass: 1 },
  },
};

/** Content transitions: entering starts after the shape begins to move; leaving finishes first. */
export const CONTENT_IN = { delay: 0.1, duration: 0.18, ease: [0.2, 0.8, 0.2, 1] } as const;
/** Exit transition for content leaving the pill. */
export const CONTENT_OUT = { duration: 0.08, ease: "easeIn" } as const;
