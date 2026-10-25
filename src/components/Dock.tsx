import { motion } from "framer-motion";
import { forwardRef, type ComponentType } from "react";
import { ipc, type QuickAction } from "../lib/ipc";
import { GearIcon, LockIcon, ScissorsIcon, SpeakerIcon, PulseIcon } from "./Icons";

/** A quick-action button. */
interface Item {
  label: string;
  Icon: ComponentType<{ size?: number }>;
  run: () => void;
}

/** Creates a click handler that runs the quick action `name`. */
const send = (name: QuickAction) => () => void ipc.quickAction(name).catch(() => undefined);

/** Buttons shown under the open island, in order. */
const ITEMS: Item[] = [
  { label: "Mute", Icon: (p) => <SpeakerIcon {...p} muted />, run: send("mute") },
  { label: "Screenshot", Icon: ScissorsIcon, run: send("snip") },
  { label: "Lock screen", Icon: LockIcon, run: send("lock") },
  { label: "Task Manager", Icon: PulseIcon, run: send("tasks") },
  { label: "Settings", Icon: GearIcon, run: () => void ipc.openSettings() },
];

/**
 * Round quick-action buttons below the expanded island.
 *
 * Each button springs out of the pill with a small stagger.
 *
 * @param props.top Distance from the top of the canvas, in pixels.
 */
export const Dock = forwardRef<HTMLDivElement, { top: number }>(function Dock({ top }, ref) {
  return (
    <div ref={ref} className="dock" style={{ top }} role="toolbar" aria-label="Quick actions">
      {ITEMS.map(({ label, Icon, run }, i) => (
        <motion.button
          key={label}
          type="button"
          className="dock-btn"
          aria-label={label}
          title={label}
          initial={{ opacity: 1, scale: 0.35, y: -(top + 4) }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
            transition: { type: "spring", stiffness: 320, damping: 15, mass: 0.9, delay: 0.08 + i * 0.05 },
          }}
          exit={{ opacity: 1, scale: 0.35, y: -(top + 4), transition: { duration: 0.16, ease: "easeIn" } }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          onClick={run}
        >
          <Icon size={20} />
        </motion.button>
      ))}
    </div>
  );
});
