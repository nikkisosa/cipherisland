/** Logical size of the transparent native window. Must match `CANVAS_W` and `CANVAS_H` in `window.rs`. */
export const CANVAS = { w: 420, h: 290 } as const;

/** Pill dimensions in pixels. */
export const SHAPES = {
  collapsed: { w: 126, h: 37 },
  compact: { w: 250, h: 37 },
  expandedW: 370,
  expandedRadius: 42,
  tabStrip: 36,
  splitGap: 8,
} as const;

/** Default spring for shape changes. Damping ratio is about 0.75, giving a slight overshoot. */
export const SPRING = { type: "spring", stiffness: 400, damping: 30, mass: 1 } as const;

/** Spring used while opening. Softer than [SPRING], so the height visibly overshoots. */
export const OPEN_SPRING = { type: "spring", stiffness: 280, damping: 17, mass: 1 } as const;

/** Content transitions: entering starts after the shape begins to move; leaving finishes first. */
export const CONTENT_IN = { delay: 0.1, duration: 0.18, ease: [0.2, 0.8, 0.2, 1] } as const;
/** Exit transition for content leaving the pill. */
export const CONTENT_OUT = { duration: 0.08, ease: "easeIn" } as const;
