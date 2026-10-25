import { forwardRef } from "react";
import { motion } from "framer-motion";
import { SPRING } from "../lib/metrics";

/** Props of [ContextMenu]. */
interface Props {
  paused: boolean;
  onSettings: () => void;
  onPause: () => void;
  onQuit: () => void;
}

/**
 * Right-click menu with Settings, Pause and Quit.
 *
 * Rendered inside the canvas rather than as a native menu, because the island window never
 * takes focus. Esc and outside clicks close it through the backend watcher. The tray icon
 * offers the same commands with keyboard access.
 */
export const ContextMenu = forwardRef<HTMLDivElement, Props>(function ContextMenu(
  { paused, onSettings, onPause, onQuit },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className="menu"
      role="menu"
      aria-label="CipherIsland"
      initial={{ opacity: 0, scale: 0.92, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.08 } }}
      transition={SPRING}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={onSettings}>
        Settings
      </button>
      <button type="button" role="menuitem" onClick={onPause}>
        {paused ? "Resume" : "Pause"}
      </button>
      <hr />
      <button type="button" role="menuitem" className="danger" onClick={onQuit}>
        Quit CipherIsland
      </button>
    </motion.div>
  );
});
