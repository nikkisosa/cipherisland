import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type WheelEvent } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import type { CSSProperties } from "react";
import { accentStyle } from "../lib/appearance";
import { listen } from "@tauri-apps/api/event";
import { useActivities } from "../activities";
import type { ActivityId } from "../activities/types";
import { inTauri, ipc, type Rect } from "../lib/ipc";
import { CANVAS, CONTENT_IN, CONTENT_OUT, OPEN_WIDTHS, RADII, SHAPES, SPRINGS } from "../lib/metrics";
import { useSettings } from "../lib/settings";
import { CollapsedView } from "./CollapsedView";
import { CompactView } from "./CompactView";
import { Dock } from "./Dock";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { ContextMenu } from "./ContextMenu";
import { ExpandedView } from "./ExpandedView";

/** Diameter of the arrow buttons beside the open island, in pixels. */
const SIDE_BUTTON = 36;
/** Gap between the open island and the arrow buttons, in pixels. */
const SIDE_GAP = 8;
/** Accumulated wheel movement, in pixels, that changes the tab. */
const WHEEL_STEP = 50;
/** Minimum time between wheel-driven tab changes, in milliseconds. */
const WHEEL_COOLDOWN_MS = 280;

/** Which content the pill is showing. */
type View = "collapsed" | "compact" | "expanded";

/**
 * Returns the pill geometry for a view.
 *
 * @param view Which view the pill is showing.
 * @param expandedHeight Height of the expanded view, including the tab strip.
 * @param compactWidth Width of the compact view.
 * @param openWidth Width of the expanded view.
 * @param radii Corner radii for the chosen shape.
 * @returns Width, height and corner radius in pixels.
 */
function shapeFor(
  view: View,
  expandedHeight: number,
  compactWidth: number,
  openWidth: number,
  radii: { open: number; closed: number | null },
) {
  const closed = (h: number) => radii.closed ?? h / 2;
  switch (view) {
    case "expanded":
      return { w: openWidth, h: expandedHeight, r: radii.open };
    case "compact":
      return { w: compactWidth, h: SHAPES.compact.h, r: closed(SHAPES.compact.h) };
    default:
      return { w: SHAPES.collapsed.w, h: SHAPES.collapsed.h, r: closed(SHAPES.collapsed.h) };
  }
}

/**
 * Returns an element's layout box in canvas coordinates.
 *
 * Uses `offset*` values, which ignore CSS transforms, so animated elements report their
 * settled position.
 *
 * @param el The element, or `null`.
 * @returns The box, or `null` when `el` is `null`.
 */
function layoutBox(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** Returns `r` grown by `by` pixels on every side. */
const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/**
 * Sends the island's rectangles to the backend.
 *
 * @param rects Areas that must receive clicks.
 * @param hover Areas where the island is drawn, used for hover.
 * @param passClicks Whether mouse input should fall through the window entirely.
 */
const report = (rects: Rect[], hover: Rect[], passClicks: boolean) => {
  if (inTauri) void ipc.reportHitRegions(rects, hover, passClicks).catch(() => undefined);
};

/**
 * Round arrow button beside the open island that changes tab.
 *
 * @param props.side Which side of the island the button sits on.
 * @param props.offset Distance from the island's center line to the button's inner edge, in pixels.
 * @param props.top Distance from the top of the canvas, in pixels.
 * @param props.label Accessible name.
 * @param props.onClick Called when the button is pressed.
 */
function SideButton({
  side,
  offset,
  top,
  label,
  onClick,
}: {
  side: "left" | "right";
  offset: number;
  top: number;
  label: string;
  onClick: () => void;
}) {
  const dir = side === "left" ? -1 : 1;
  const style = side === "left" ? { right: `calc(50% + ${offset}px)` } : { left: `calc(50% + ${offset}px)` };
  return (
    <motion.button
      type="button"
      className="side-btn"
      style={{ ...style, top }}
      aria-label={label}
      title={label}
      initial={{ opacity: 0, x: -dir * 18, scale: 0.6 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -dir * 18, scale: 0.6, transition: { duration: 0.12 } }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
    >
      {side === "left" ? <ChevronLeftIcon size={20} /> : <ChevronRightIcon size={20} />}
    </motion.button>
  );
}

/**
 * Cross-fades between the collapsed, compact and expanded content.
 *
 * @param props.id Key identifying the content, so a change triggers the exit and enter animations.
 */
function Swap({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.div
      key={id}
      className="view"
      initial={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: CONTENT_IN }}
      exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)", transition: CONTENT_OUT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The island: a pill that morphs between closed and open shapes and hosts every activity.
 *
 * Tracks hover (reported by the backend), pinning, the right-click menu and the geometry
 * reported for click-through.
 */
export function Island() {
  const settings = useSettings();
  const { live, tabs } = useActivities(settings);

  const [expanded, setExpanded] = useState(false);
  const [tabId, setTabId] = useState<ActivityId | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  // While a browser is under the cursor, hover fades the island instead of opening it. Ctrl overrides.
  const [appBehind, setAppBehind] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  // Set by a click: the island stays open when the cursor leaves.
  const [pinned, setPinned] = useState(false);
  // Set by closing while the cursor is still over the island, so it does not reopen at once.
  const suppressHover = useRef(false);

  const primary = live[0];
  // A short pulse when a different activity takes the pill, so a change is noticed.
  const [bump, setBump] = useState(false);
  const lastPrimary = useRef(primary?.id);
  useEffect(() => {
    if (primary?.id === lastPrimary.current) return;
    const arrived = !!primary;
    lastPrimary.current = primary?.id;
    if (!arrived) return;
    setBump(true);
    const id = window.setTimeout(() => setBump(false), 650);
    return () => window.clearTimeout(id);
  }, [primary?.id]);
  const secondary = live[1];
  const activeTab = tabs.find((t) => t.id === tabId) ?? tabs.find((t) => t.id === primary?.id) ?? tabs[0];
  const isExpanded = expanded && !!activeTab;
  const springs = SPRINGS[settings.motion] ?? SPRINGS.bouncy;
  const closedView: View = primary ? "compact" : "collapsed";
  const compactW = primary?.compactWidth ?? SHAPES.compact.w;
  const bodyHeight = SHAPES.expandedBody + SHAPES.tabStrip;
  const openWidth = OPEN_WIDTHS[settings.openWidth] ?? OPEN_WIDTHS.standard;
  const radii = RADII[settings.shape] ?? RADII.round;
  const closedShape = shapeFor(closedView, 0, compactW, openWidth, radii);
  const openShape = shapeFor("expanded", bodyHeight, compactW, openWidth, radii);

  const targetView: View = isExpanded ? "expanded" : closedView;
  const shape = isExpanded ? openShape : closedShape;
  const view = targetView;
  // Docked to the top edge, only the bottom corners are rounded.
  const top = settings.attachTop ? 0 : shape.r;

  const showDock = isExpanded && settings.activities.quickActions;
  // Curved shoulders join the island to the top edge. Only when attached, and chosen per state.
  const ears = settings.attachTop && (isExpanded ? settings.notchOpen : settings.notchClosed) === "flared";
  const showSides = isExpanded && settings.sideButtons && tabs.length > 1;
  // While closed (and opening on hover), clicks go to the app behind the island.
  const peek = hovered && appBehind && !ctrlHeld && !isExpanded && !menuOpen && settings.openOnHover;
  const passClicks = !isExpanded && !menuOpen && settings.openOnHover;
  const menuRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const lastRects = useRef<Rect[]>([]);

  const collapse = useCallback(() => {
    suppressHover.current = true;
    setPinned(false);
    setExpanded(false);
    setTabId(null);
    setMenuOpen(false);
  }, []);

  // Esc and outside clicks come from the backend; the window has no keyboard focus and its
  // transparent area receives no clicks.
  useEffect(() => {
    if (!inTauri) return;
    const pending = [
      listen("island://outside-click", collapse),
      listen("island://escape", collapse),
      // The backend reports hover because click-through windows get no pointer events.
      listen<{ over: boolean; behind: boolean; ctrl: boolean }>("island://hover", (e) => {
        setHovered(e.payload.over);
        setAppBehind(e.payload.behind);
        setCtrlHeld(e.payload.ctrl);
      }),
    ];
    void ipc.frontendReady();
    return () => pending.forEach((p) => void p.then((off) => off()));
  }, [collapse]);

  useEffect(() => {
    if (inTauri) void ipc.setOutsideWatch(isExpanded || menuOpen).catch(() => undefined);
  }, [isExpanded, menuOpen]);

  useEffect(() => {
    if (expanded && !activeTab) collapse();
  }, [expanded, activeTab, collapse]);

  // Reports the island's rectangles. They are computed from the target shape, not measured
  // mid-animation. While the pill moves, the old and new rectangles (grown for spring
  // overshoot) are both interactive; after it settles only the final one is.
  useLayoutEffect(() => {
    const pillRect: Rect = { x: (CANVAS.w - shape.w) / 2, y: 0, w: shape.w, h: shape.h };
    const next: Rect[] = [pillRect];
    if (secondary && !isExpanded && !menuOpen) {
      next.push({ x: (CANVAS.w + shape.w) / 2 + SHAPES.splitGap, y: 0, w: 37, h: 37 });
    }
    // Ignore the menu and dock while they animate out; they are still in the page then.
    const dock = showDock ? layoutBox(dockRef.current) : null;
    for (const found of [menuOpen ? layoutBox(menuRef.current) : null, dock]) {
      if (found) next.push(found);
    }
    // Arrow buttons beside the open island, sized from constants since they animate in.
    const sideTop = Math.round(pillRect.h / 2 - SIDE_BUTTON / 2);
    const sides: Rect[] = showSides
      ? [
          { x: pillRect.x - SIDE_GAP - SIDE_BUTTON, y: sideTop, w: SIDE_BUTTON, h: SIDE_BUTTON },
          { x: pillRect.x + pillRect.w + SIDE_GAP, y: sideTop, w: SIDE_BUTTON, h: SIDE_BUTTON },
        ]
      : [];
    next.push(...sides);
    const previous = lastRects.current;
    lastRects.current = next;
    // Hover uses only the drawn rectangles plus the gap to the dock, never the larger
    // transition rectangles.
    const hover = [...next];
    if (dock) hover.push({ x: dock.x, y: pillRect.h, w: dock.w, h: dock.y - pillRect.h });
    // Cover the gap between the island and each arrow so crossing it does not close the island.
    for (const side of sides) hover.push(inflate(side, SIDE_GAP / 2));
    report([...previous, ...next].map((r) => inflate(r, 16)), hover, passClicks);
    const settle = window.setTimeout(() => report(next, hover, passClicks), 600);
    return () => window.clearTimeout(settle);
  }, [view, shape.w, shape.h, !!secondary, menuOpen, tabs.length, activeTab?.id, showDock, showSides, passClicks]);

  /**
   * Moves to the next or previous tab, wrapping around at either end.
   *
   * @param delta 1 for the next tab, -1 for the previous one.
   */
  const stepTab = (delta: number) => {
    if (!activeTab || tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === activeTab.id);
    setTabId(tabs[(i + delta + tabs.length) % tabs.length].id);
  };

  const wheel = useRef({ sum: 0, last: 0 });
  /** Changes tab with the mouse wheel or a horizontal scroll while the island is open. */
  const onWheel = (e: WheelEvent) => {
    if (!isExpanded) return;
    const w = wheel.current;
    w.sum += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(w.sum) >= WHEEL_STEP && Date.now() - w.last > WHEEL_COOLDOWN_MS) {
      stepTab(w.sum > 0 ? 1 : -1);
      w.sum = 0;
      w.last = Date.now();
    }
  };

  const openTab = (id: ActivityId | undefined, pin = true) => {
    if (!id || !tabs.some((t) => t.id === id)) return;
    setMenuOpen(false);
    setTabId(id);
    setExpanded(true);
    if (pin) setPinned(true);
  };

  // Opens after a short rest and closes after a grace period, to avoid flicker at the edge.
  const hoverTarget = primary?.id ?? tabs[0]?.id;
  useEffect(() => {
    if (!settings.openOnHover) return;
    if (!hovered) suppressHover.current = false;
    let id: number | undefined;
    if (hovered && !expanded && !menuOpen && !suppressHover.current && (!appBehind || ctrlHeld)) {
      id = window.setTimeout(() => openTab(hoverTarget, false), 130);
    } else if (!hovered && expanded && !pinned) {
      id = window.setTimeout(collapse, 380);
    }
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, expanded, pinned, menuOpen, settings.openOnHover, hoverTarget, appBehind, ctrlHeld]);

  const onPillClick = () => {
    if (isExpanded) return setPinned(true);
    if (menuOpen) return setMenuOpen(false);
    openTab(primary?.id ?? tabs[0]?.id);
  };

  const onPillKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPillClick();
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="stage" data-peek={peek} data-theme={settings.theme} data-accent={settings.accent} data-shape={settings.shape} data-surface={settings.surface} data-idle={settings.idleStyle} data-view={view} data-ears={ears} data-bump={bump && !isExpanded}
        style={{ ...accentStyle(settings.accent, settings.accentCustom), ["--island-alpha" as string]: settings.opacity, ["--open-w" as string]: `${openWidth}px` } as CSSProperties} onContextMenu={(e) => e.preventDefault()}>
        <div className="row">
          <div />
          <motion.div
            className="pill-wrap"
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            aria-label="CipherIsland"
            whileHover={isExpanded || peek ? undefined : { scale: 1.04 }}
            whileTap={isExpanded ? undefined : { scale: 0.98 }}
            transition={springs.close}
            onPointerEnter={() => !inTauri && setHovered(true)}
            onPointerLeave={() => !inTauri && setHovered(false)}
            onClick={onPillClick}
            onWheel={onWheel}
            onKeyDown={onPillKey}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(false);
              setMenuOpen(true);
            }}
          >
            <motion.div
              className="pill"
              initial={false}
              animate={{
                width: shape.w,
                height: shape.h,
                borderTopLeftRadius: top,
                borderTopRightRadius: top,
                borderBottomLeftRadius: shape.r,
                borderBottomRightRadius: shape.r,
              }}
              transition={isExpanded ? springs.open : springs.close}
            >
              <AnimatePresence initial={false}>
                {view === "collapsed" && (
                  <Swap key="collapsed" id="collapsed">
                    <CollapsedView idleStyle={settings.idleStyle} />
                  </Swap>
                )}
                {view === "compact" && primary && (
                  <Swap key="compact" id="compact">
                    <CompactView activity={primary} />
                  </Swap>
                )}
                {view === "expanded" && activeTab && (
                  <Swap key="expanded" id="expanded">
                    <ExpandedView tabs={tabs} active={activeTab} tabStyle={settings.tabStyle} onSelect={setTabId} />
                  </Swap>
                )}
              </AnimatePresence>
            </motion.div>
            {ears && (
              <>
                <span className="ear ear-left" aria-hidden="true" />
                <span className="ear ear-right" aria-hidden="true" />
              </>
            )}
          </motion.div>

          <div className="side-right">
            <AnimatePresence>
              {secondary && !isExpanded && !menuOpen && (
                <motion.button
                  key="split"
                  type="button"
                  className="split-dot"
                  aria-label={secondary.label}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0, transition: { duration: 0.12 } }}
                  transition={springs.close}
                  onClick={() => openTab(secondary.id)}
                >
                  <motion.span layoutId={`glyph-${secondary.id}`} className="split-glyph">
                    <secondary.Glyph size={18} />
                  </motion.span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {showSides && (
            <>
              <SideButton key="prev" side="left" offset={(shape.w / 2) + SIDE_GAP} top={shape.h / 2 - SIDE_BUTTON / 2} label="Previous tab" onClick={() => stepTab(-1)} />
              <SideButton key="next" side="right" offset={(shape.w / 2) + SIDE_GAP} top={shape.h / 2 - SIDE_BUTTON / 2} label="Next tab" onClick={() => stepTab(1)} />
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>{showDock && <Dock ref={dockRef} top={shape.h + 12} />}</AnimatePresence>

        <AnimatePresence>
          {menuOpen && (
            <ContextMenu
              ref={menuRef}
              paused={settings.paused}
              onSettings={() => {
                collapse();
                void ipc.openSettings();
              }}
              onPause={() => {
                collapse();
                void ipc.togglePause();
              }}
              onQuit={() => void ipc.quit()}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
