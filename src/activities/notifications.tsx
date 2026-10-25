import { createStore, useUntil } from "../lib/store";
import { onEvent } from "../lib/ipc";
import { BellIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Payload of the `notif://new` event. */
interface Toast {
  id: number;
  app: string;
  title: string;
  body: string;
}

/** How long a toast stays on the pill, in milliseconds. */
const SHOW_MS = 5000;

/** Last toast and the time until which it stays on the pill. */
const store = createStore<{ last: Toast | null; until: number }>({ last: null, until: 0 });

onEvent<Toast>("notif://new", (last) => store.set({ last, until: Date.now() + SHOW_MS }));

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return <BellIcon size={size} />;
}

/** Value shown on the right of the compact pill. The toast title, or the app name if it has none. */
function Trailing() {
  const { last } = store.use();
  return (
    <span className="notif-line" title={last?.title}>
      {last?.title || last?.app}
    </span>
  );
}

/** Panel shown in the expanded island. App name, title and a two-line body. */
function Expanded() {
  const { last } = store.use();
  if (!last) return null;
  return (
    <div className="panel panel-notif">
      <div className="panel-title">{last.app || "Notification"}</div>
      <div className="notif-title">{last.title}</div>
      {last.body && <div className="notif-body">{last.body}</div>}
    </div>
  );
}

/** Notifications activity: mirrors Windows toasts. Disabled by default; see `notify.rs` for platform limits. */
export const notifications: ActivityModule = {
  id: "notifications",
  useActivity(settings) {
    const { last, until } = store.use();
    const showing = useUntil(until);
    const enabled = settings.activities.notifications;
    return {
      id: "notifications",
      label: "Notifications",
      priority: 95,
      live: enabled && showing,
      available: enabled && !!last,
      expandedHeight: 112,
      Glyph,
      Trailing,
      Expanded,
    };
  },
};
