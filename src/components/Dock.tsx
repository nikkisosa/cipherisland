import { motion } from "framer-motion";
import { forwardRef, type ComponentType } from "react";
import { createStore } from "../lib/store";
import { ipc, type QuickAction } from "../lib/ipc";
import { CoffeeIcon, DesktopIcon, FolderIcon, GearIcon, LockIcon, ScissorsIcon, SmileIcon, SpeakerIcon, PulseIcon } from "./Icons";

/** A quick-action button. `toggle` buttons keep a pressed state. */
interface Item {
  label: string;
  Icon: ComponentType<{ size?: number }>;
  run: () => void;
  toggle?: "awake";
}

/** Whether keep awake is on. The backend holds the request for as long as the app runs. */
const awake = createStore(false);

/** Creates a click handler that runs the quick action `name`. */
const send = (name: QuickAction) => () => void ipc.quickAction(name).catch(() => undefined);

/** Flips keep awake. */
const toggleAwake = () => {
  const next = !awake.get();
  awake.set(next);
  void ipc.setKeepAwake(next).catch(() => awake.set(!next));
};

/** Buttons shown under the open island, in order. */
const ITEMS: Item[] = [
  { label: "Mute", Icon: (p) => <SpeakerIcon {...p} muted />, run: send("mute") },
  { label: "Keep awake", Icon: CoffeeIcon, run: toggleAwake, toggle: "awake" },
  { label: "Screenshot", Icon: ScissorsIcon, run: send("snip") },
  { label: "Show desktop", Icon: DesktopIcon, run: send("desktop") },
  { label: "File Explorer", Icon: FolderIcon, run: send("files") },
  { label: "Emoji", Icon: SmileIcon, run: send("emoji") },
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
  const keepAwake = awake.use();
  return (
    <div ref={ref} className="dock" style={{ top }} role="toolbar" aria-label="Quick actions">
      {ITEMS.map(({ label, Icon, run, toggle }, i) => (
        <motion.button
          key={label}
          type="button"
          className="dock-btn"
          aria-label={label}
          aria-pressed={toggle === "awake" ? keepAwake : undefined}
          title={toggle === "awake" ? `${label}: ${keepAwake ? "on" : "off"}` : label}
          initial={{ opacity: 1, scale: 0.35, y: -(top + 4) }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
            transition: { type: "spring", stiffness: 320, damping: 15, mass: 0.9, delay: 0.08 + i * 0.04 },
          }}
          exit={{ opacity: 1, scale: 0.35, y: -(top + 4), transition: { duration: 0.16, ease: "easeIn" } }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          onClick={run}
        >
          <Icon size={19} />
        </motion.button>
      ))}
    </div>
  );
});
