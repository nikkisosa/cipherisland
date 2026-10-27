import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Activity, ActivityId } from "../activities/types";
import type { TabStyleId } from "../lib/ipc";
import { SHAPES } from "../lib/metrics";

/** Props of [ExpandedView]. */
interface Props {
  tabs: Activity[];
  active: Activity;
  tabStyle: TabStyleId;
  onSelect: (id: ActivityId) => void;
}

/** Slide variants for a panel entering or leaving; `custom` is the direction, 1 or -1. */
const SLIDE = {
  enter: (dir: number) => ({ x: dir * 56, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -56, opacity: 0 }),
};

/**
 * Expanded content: the active activity's panel and a tab strip.
 *
 * Changing tab slides the new panel in from the side it is on: right for later tabs, left for
 * earlier ones. Every panel has the same height. The strip keeps its space when there is only one tab,
 * so the open island never changes size between activities.
 *
 * @param props.tabs Activities that have a tab.
 * @param props.active The activity whose panel is shown.
 * @param props.tabStyle `icons`, `labels` (the selected tab also shows its name) or `dots`.
 * @param props.onSelect Called with an activity id when its tab is clicked.
 */
export function ExpandedView({ tabs, active, tabStyle, onSelect }: Props) {
  const { Expanded } = active;

  // Direction of the last tab change, so the panels slide the way the tabs are ordered.
  const index = tabs.findIndex((t) => t.id === active.id);
  const swipeOk = useRef(true);
  const previous = useRef(index);
  const direction = useRef(1);
  if (index !== previous.current) direction.current = index > previous.current ? 1 : -1;
  useEffect(() => {
    previous.current = index;
  }, [index]);

  return (
    <div className="expanded">
      <motion.div
        className="expanded-body"
        style={{ height: SHAPES.expandedBody }}
        onPointerDownCapture={(e) => {
          // Dragging a slider or seek bar must not also change tab.
          swipeOk.current = !(e.target as HTMLElement).closest("input, .progress-track, .volume-track, button");
        }}
        onPanEnd={(_, info) => {
          if (!swipeOk.current || tabs.length < 2) return;
          const { x, y } = info.offset;
          if (Math.abs(x) < 48 || Math.abs(x) < Math.abs(y) * 1.5) return;
          const next = (index + (x < 0 ? 1 : -1) + tabs.length) % tabs.length;
          onSelect(tabs[next].id);
        }}
      >
        <AnimatePresence initial={false} custom={direction.current} mode="popLayout">
          <motion.div
            key={active.id}
            className="slide"
            custom={direction.current}
            variants={SLIDE}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Expanded />
          </motion.div>
        </AnimatePresence>
      </motion.div>
      {tabs.length > 1 ? (
        <div className="tabs" data-style={tabStyle} role="tablist" aria-label="Activities">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={t.id === active.id}
              aria-label={t.label}
              title={t.label}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t.id);
              }}
            >
              <t.Glyph size={16} />
              <span className="tab-label">{t.label}</span>
              <span className="tab-dot" />
            </button>
          ))}
        </div>
      ) : (
        <div className="tabs" aria-hidden="true" />
      )}
    </div>
  );
}
