import { createStore, useUntil } from "../lib/store";
import { onEvent } from "../lib/ipc";
import { ClipboardIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** How long copied text stays on the pill, in milliseconds. */
const SHOW_MS = 3000;

/** Last copied text and the time until which it stays on the pill. */
const store = createStore<{ text: string; until: number }>({ text: "", until: 0 });

onEvent<{ text: string }>("clipboard://text", ({ text }) => store.set({ text, until: Date.now() + SHOW_MS }));

/** Collapses runs of whitespace so multi-line text fits the compact pill. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return <ClipboardIcon size={size} />;
}

/** Value shown on the right of the compact pill. */
function Trailing() {
  const { text } = store.use();
  return <span className="notif-line">{oneLine(text)}</span>;
}

/** Panel shown in the expanded island. The last copied text. */
function Expanded() {
  const { text } = store.use();
  return (
    <div className="panel panel-notif">
      <div className="panel-title">Last copied text</div>
      <div className="notif-body clip-text">{text.trim()}</div>
    </div>
  );
}

/** Clipboard activity: previews copied text briefly. Disabled by default. */
export const clipboard: ActivityModule = {
  id: "clipboard",
  useActivity(settings) {
    const { text, until } = store.use();
    const showing = useUntil(until);
    const enabled = settings.activities.clipboard;
    return {
      id: "clipboard",
      label: "Clipboard",
      priority: 92,
      live: enabled && showing,
      available: enabled && text !== "",
      expandedHeight: 96,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
