import type { IdleStyleId } from "../lib/ipc";

/**
 * Content of the idle pill.
 *
 * The text gives screen readers an accessible name. With the `dot` style a small accent light
 * is drawn on the right; `glow` is drawn by the stylesheet around the pill itself.
 *
 * @param props.idleStyle The selected idle look.
 */
export function CollapsedView({ idleStyle }: { idleStyle: IdleStyleId }) {
  return (
    <>
      <span className="sr-only">CipherIsland, idle</span>
      {idleStyle === "dot" && <span className="idle-dot" aria-hidden="true" />}
    </>
  );
}
