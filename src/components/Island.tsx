import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { useActivities } from "../activities";
import type { ActivityId } from "../activities/types";
import { inTauri, ipc, type Rect } from "../lib/ipc";
import { CANVAS, CONTENT_IN, CONTENT_OUT, OPEN_SPRING, SHAPES, SPRING } from "../lib/metrics";
import { useSettings } from "../lib/settings";
import { CollapsedView } from "./CollapsedView";
import { CompactView } from "./CompactView";
import { Dock } from "./Dock";
import { ContextMenu } from "./ContextMenu";
import { ExpandedView } from "./ExpandedView";

/** Which content the pill is showing. */
type View = "collapsed" | "compact" | "expanded";

/**
 * Returns the pill geometry for a view.
 *
 * @param view Which view the pill is showing.
 * @param expandedHeight Height of the expanded view, including the tab strip.
 * @param compactWidth Width of the compact view.
 * @returns Width, height and corner radius in pixels. Closed views are fully rounded.
 */
function shapeFor(view: View, expandedHeight: number, compactWidth: number) {
  switch (view) {
    case "expanded":
      return { w: SHAPES.expandedW, h: expandedHeight, r: SHAPES.expandedRadius };
    case "compact":
      return { w: compactWidth, h: SHAPES.compact.h, r: SHAPES.compact.h / 2 };
    default:
      return { w: SHAPES.collapsed.w, h: SHAPES.collapsed.h, r: SHAPES.collapsed.h / 2 };
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
  const secondary = live[1];
  const activeTab = tabs.find((t) => t.id === tabId) ?? tabs.find((t) => t.id === primary?.id) ?? tabs[0];
  const isExpanded = expanded && !!activeTab;
  const closedView: View = primary ? "compact" : "collapsed";
  const compactW = primary?.compactWidth ?? SHAPES.compact.w;
  const bodyHeight = activeTab ? activeTab.expandedHeight + (tabs.length > 1 ? SHAPES.tabStrip : 0) : 0;
  const closedShape = shapeFor(closedView, 0, compactW);
  const openShape = shapeFor("expanded", bodyHeight, compactW);

  const targetView: View = isExpanded ? "expanded" : closedView;
  const shape = isExpanded ? openShape : closedShape;
  const view = targetView;
  // Docked to the top edge, only the bottom corners are rounded.
  const top = settings.attachTop ? 0 : shape.r;

  const showDock = isExpanded && settings.activities.quickActions;
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
    const previous = lastRects.current;
    lastRects.current = next;
    // Hover uses only the drawn rectangles plus the gap to the dock, never the larger
    // transition rectangles.
    const hover = [...next];
    if (dock) hover.push({ x: dock.x, y: pillRect.h, w: dock.w, h: dock.y - pillRect.h });
    report([...previous, ...next].map((r) => inflate(r, 16)), hover, passClicks);
    const settle = window.setTimeout(() => report(next, hover, passClicks), 600);
    return () => window.clearTimeout(settle);
  }, [view, shape.w, shape.h, !!secondary, menuOpen, tabs.length, activeTab?.id, showDock, passClicks]);

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
      <div className="stage" data-peek={peek} data-theme={settings.theme} data-accent={settings.accent} onContextMenu={(e) => e.preventDefault()}>
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
            transition={SPRING}
            onPointerEnter={() => !inTauri && setHovered(true)}
            onPointerLeave={() => !inTauri && setHovered(false)}
            onClick={onPillClick}
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
              transition={isExpanded ? OPEN_SPRING : SPRING}
            >
              <AnimatePresence initial={false}>
                {view === "collapsed" && (
                  <Swap key="collapsed" id="collapsed">
                    <CollapsedView />
                  </Swap>
                )}
                {view === "compact" && primary && (
                  <Swap key="compact" id="compact">
                    <CompactView activity={primary} />
                  </Swap>
                )}
                {view === "expanded" && activeTab && (
                  <Swap key="expanded" id="expanded">
                    <ExpandedView tabs={tabs} active={activeTab} onSelect={setTabId} />
                  </Swap>
                )}
              </AnimatePresence>
            </motion.div>
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
                  transition={SPRING}
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
