import { createStore, useUntil } from "../lib/store";
import { inTauri, ipc, onEvent } from "../lib/ipc";
import { ClipboardIcon, CopyIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** How long copied text stays on the pill, in milliseconds. */
const SHOW_MS = 3000;
/** Number of entries kept in the history. */
const HISTORY = 4;
/** The backend reads at most this many UTF-16 units, so an entry this long may be cut off. */
const MAX_READ = 400;
/** How long after copying an entry back its echo from the clipboard listener is ignored, in milliseconds. */
const ECHO_MS = 1500;

/** Clipboard history (newest first) and the time until which the newest entry stays on the pill. */
const store = createStore<{ text: string; until: number; items: string[]; echoText: string; echoUntil: number; copied: string }>({
  text: "",
  until: 0,
  items: [],
  echoText: "",
  echoUntil: 0,
  copied: "",
});

onEvent<{ text: string }>("clipboard://text", ({ text }) =>
  store.set((s) => {
    const items = [text, ...s.items.filter((t) => t !== text)].slice(0, HISTORY);
    // Copying an entry back from the history triggers this event too; it should not flash the pill.
    if (text === s.echoText && Date.now() < s.echoUntil) return { ...s, items };
    return { ...s, items, text, until: Date.now() + SHOW_MS };
  }),
);

/** Collapses runs of whitespace so multi-line text fits one row. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Copies a history entry back onto the clipboard and marks it as copied for a moment. */
function copyBack(text: string) {
  if (!inTauri) return;
  store.set((s) => ({ ...s, echoText: text, echoUntil: Date.now() + ECHO_MS, copied: text }));
  void ipc.copyText(text).catch(() => undefined);
  window.setTimeout(() => store.set((s) => (s.copied === text ? { ...s, copied: "" } : s)), 1200);
}

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return <ClipboardIcon size={size} />;
}

/** Value shown on the right of the compact pill. */
function Trailing() {
  const { text } = store.use();
  return <span className="notif-line">{oneLine(text)}</span>;
}

/** Panel shown in the expanded island. The recent copied texts; click one to copy it again. */
function Expanded() {
  const { items, copied } = store.use();
  return (
    <div className="panel panel-clip">
      <div className="panel-title">Clipboard history</div>
      <ul className="clip-list">
        {items.map((text) => {
          const cut = text.length >= MAX_READ;
          return (
            <li key={text}>
              <button
                type="button"
                className="clip-item"
                disabled={cut}
                title={cut ? "Too long to copy back from here" : "Copy again"}
                onClick={() => copyBack(text)}
              >
                <span className="clip-item-text">{oneLine(text)}</span>
                <span className="clip-item-icon">{copied === text ? "Copied" : <CopyIcon size={14} />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Clipboard activity: previews copied text briefly and keeps a short history. Disabled by default. */
export const clipboard: ActivityModule = {
  id: "clipboard",
  useActivity(settings) {
    const { items, until } = store.use();
    const showing = useUntil(until);
    const enabled = settings.activities.clipboard;
    return {
      id: "clipboard",
      label: "Clipboard",
      priority: 92,
      live: enabled && showing,
      available: enabled && items.length > 0,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
