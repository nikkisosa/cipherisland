import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  inTauri,
  ipc,
  onEvent,
  type AccentId,
  type ActivitiesSettings,
  type MonitorOption,
  type Settings,
  type ThemeId,
} from "../lib/ipc";
import { useSettings } from "../lib/settings";
import {
  BatteryIcon,
  BellIcon,
  CalendarIcon,
  ChipIcon,
  ClipboardIcon,
  ArrowUpRightIcon,
  ClockIcon,
  GearIcon,
  GridIcon,
  MusicIcon,
  NextIcon,
  PauseIcon,
  PreviousIcon,
  SpeakerIcon,
  TimerIcon,
} from "../components/Icons";

/** A page of the settings window. */
type Page = "appearance" | "widgets" | "behavior" | "about";

/** Sidebar pages, with the heading blurb shown on each. */
const PAGES: { id: Page; label: string; blurb: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: "appearance", label: "Appearance", blurb: "How the island looks and where it sits.", Icon: GridIcon },
  { id: "widgets", label: "Widgets", blurb: "Choose what the island can show.", Icon: ClockIcon },
  { id: "behavior", label: "Behavior", blurb: "When it opens, which screen it uses, and startup.", Icon: GearIcon },
  { id: "about", label: "About", blurb: "Quick tips and who made this.", Icon: BellIcon },
];

/** Selectable island themes. */
const THEMES: { id: ThemeId; label: string; note: string }[] = [
  { id: "classic", label: "Classic", note: "Pure black" },
  { id: "graphite", label: "Graphite", note: "Soft charcoal" },
  { id: "midnight", label: "Midnight", note: "Deep blue" },
  { id: "light", label: "Light", note: "Bright surface" },
];

/** Selectable accent colors; `swatch` is the CSS background of the color chip. */
const ACCENTS: { id: AccentId; label: string; swatch: string }[] = [
  { id: "auto", label: "Match theme", swatch: "linear-gradient(135deg, #fff 50%, #1d1d1f 50%)" },
  { id: "blue", label: "Blue", swatch: "#0a84ff" },
  { id: "green", label: "Green", swatch: "#30d158" },
  { id: "orange", label: "Orange", swatch: "#ff9f0a" },
  { id: "pink", label: "Pink", swatch: "#ff375f" },
  { id: "teal", label: "Teal", swatch: "#40c8e0" },
];

const WIDGETS: {
  key: keyof ActivitiesSettings;
  title: string;
  description: string;
  Icon: ComponentType<{ size?: number }>;
  hue: string;
}[] = [
  { key: "nowPlaying", title: "Now playing", description: "Track, artwork, seek bar and controls from any media app.", Icon: MusicIcon, hue: "#ff375f" },
  { key: "volume", title: "Volume", description: "A level pill on change, plus a slider and mute in the open island.", Icon: SpeakerIcon, hue: "#0a84ff" },
  { key: "battery", title: "Battery", description: "Plug-in animation and warnings at 20% and 10%.", Icon: BatteryIcon, hue: "#30d158" },
  { key: "timer", title: "Timer", description: "Start a countdown from the open island.", Icon: TimerIcon, hue: "#ff9f0a" },
  { key: "clock", title: "Clock", description: "Time and date in the open island.", Icon: ClockIcon, hue: "#8e8e93" },
  { key: "calendar", title: "Calendar", description: "Month view with today highlighted.", Icon: CalendarIcon, hue: "#ff453a" },
  { key: "systemStats", title: "System", description: "CPU and memory load, sampled only while open.", Icon: ChipIcon, hue: "#64d2ff" },
  { key: "clipboard", title: "Clipboard", description: "Preview copied text. Private content from password managers is skipped.", Icon: ClipboardIcon, hue: "#bf5af2" },
  { key: "notifications", title: "Notifications", description: "Mirror incoming toasts. Windows usually blocks this for unpackaged apps.", Icon: BellIcon, hue: "#ffd60a" },
  { key: "quickActions", title: "Quick buttons", description: "Mute, screenshot, lock, Task Manager and settings under the open island.", Icon: GridIcon, hue: "#5e5ce6" },
];

/**
 * Settings row with a title, optional description and a toggle switch.
 *
 * @param props.title Row title, also the switch's accessible name.
 * @param props.description Secondary text.
 * @param props.checked Current value.
 * @param props.onChange Called with the new value.
 * @param props.disabled Greys out the row and blocks changes.
 */
function Switch({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="row" data-disabled={disabled}>
      <label className="row-text" htmlFor={id}>
        <span className="row-title">{title}</span>
        {description && <span className="row-desc">{description}</span>}
      </label>
      <input
        id={id}
        className="switch"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

/** Rounded container for related rows, with an optional uppercase heading. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={title ? id : undefined}>
      {title && <h3 id={id}>{title}</h3>}
      <div className="group">{children}</div>
    </section>
  );
}

/** Miniature of the island, in compact and open form, drawn with the selected theme and accent. */
function Preview({ theme, accent }: { theme: ThemeId; accent: AccentId }) {
  return (
    <div className="preview" data-theme={theme} data-accent={accent} aria-hidden="true">
      <div className="pv-compact">
        <span className="pv-art">
          <MusicIcon size={12} />
        </span>
        <span className="pv-title">Night Drive</span>
        <span className="pv-bars">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="pv-open">
        <div className="pv-head">
          <span className="pv-cover">
            <MusicIcon size={22} />
          </span>
          <span className="pv-text">
            <b>Night Drive</b>
            <span>Okonkwo Quartet</span>
          </span>
        </div>
        <div className="pv-bar">
          <i />
        </div>
        <div className="pv-controls">
          <PreviousIcon size={18} />
          <PauseIcon size={22} />
          <NextIcon size={18} />
        </div>
      </div>
    </div>
  );
}

/** Radio group of theme cards, each previewing the theme with the current accent. */
function ThemePicker({ value, accent, onChange }: { value: ThemeId; accent: AccentId; onChange: (t: ThemeId) => void }) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Island theme">
      {THEMES.map((t) => (
        <label key={t.id} className="theme-card">
          <input type="radio" name="theme" value={t.id} checked={value === t.id} onChange={() => onChange(t.id)} />
          <span className="theme-swatch" data-theme={t.id} data-accent={accent}>
            <span className="theme-pill">
              <i />
              <i />
            </span>
          </span>
          <span className="theme-label">{t.label}</span>
          <span className="theme-note">{t.note}</span>
        </label>
      ))}
    </div>
  );
}

/** Radio group of accent color chips. */
function AccentPicker({ value, onChange }: { value: AccentId; onChange: (a: AccentId) => void }) {
  return (
    <div className="accent-row" role="radiogroup" aria-label="Accent color">
      {ACCENTS.map((a) => (
        <label key={a.id} className="accent-chip" title={a.label}>
          <input type="radio" name="accent" value={a.id} checked={value === a.id} onChange={() => onChange(a.id)} />
          <span className="accent-dot" style={{ background: a.swatch }} />
          <span className="sr-only">{a.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * The settings window: sidebar navigation and four pages.
 *
 * Changes are applied immediately and saved after a short debounce.
 */
export function SettingsApp() {
  const stored = useSettings();
  const [draft, setDraft] = useState<Settings>(stored);
  const [page, setPage] = useState<Page>("appearance");
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const [notifStatus, setNotifStatus] = useState<{ supported: boolean; reason: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<number>();
  const offsetId = useId();
  const monitorId = useId();

  // The backend owns the settings; the tray and island menu can change them as well.
  useEffect(() => setDraft(stored), [stored]);

  useEffect(() => {
    if (!inTauri) return;
    void ipc.listMonitors().then(setMonitors);
    onEvent<{ supported: boolean; reason: string }>("notif://status", setNotifStatus);
    void ipc.frontendReady();
  }, []);

  const commit = (next: Settings) => {
    setDraft(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void ipc.setSettings(next).then(() => setSaved(true));
    }, 150);
  };

  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(id);
  }, [saved]);

  const current = PAGES.find((p) => p.id === page)!;
  const monitorMissing = draft.monitor !== "primary" && !monitors.some((m) => m.id === draft.monitor);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
          </span>
          <span className="brand-name">CipherIsland</span>
        </div>
        <nav aria-label="Settings sections">
          {PAGES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className="nav-item"
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <p className="sidebar-foot">Changes apply instantly.</p>
      </aside>

      <main className="content">
        <header className="page-head">
          <h1>{current.label}</h1>
          <p>{current.blurb}</p>
        </header>

        {page === "appearance" && (
          <>
            <Preview theme={draft.theme} accent={draft.accent} />

            <Group title="Theme">
              <div className="pad">
                <ThemePicker value={draft.theme} accent={draft.accent} onChange={(theme) => commit({ ...draft, theme })} />
              </div>
            </Group>

            <Group title="Accent">
              <div className="pad accent-wrap">
                <AccentPicker value={draft.accent} onChange={(accent) => commit({ ...draft, accent })} />
                <span className="row-desc">Used for progress bars, the volume slider and highlights.</span>
              </div>
            </Group>

            <Group title="Position">
              <Switch
                title="Attach to top edge"
                description="Sit flush against the top of the screen like a notch. Turn off to float below it."
                checked={draft.attachTop}
                onChange={(attachTop) => commit({ ...draft, attachTop })}
              />
              <div className="row" data-disabled={draft.attachTop}>
                <label className="row-text" htmlFor={offsetId}>
                  <span className="row-title">Distance from the top</span>
                  <span className="row-desc">Applies when the island floats.</span>
                </label>
                <div className="offset">
                  <input
                    type="range"
                    min={0}
                    max={64}
                    value={draft.topOffset}
                    aria-label="Distance from the top, slider"
                    disabled={draft.attachTop}
                    onChange={(e) => commit({ ...draft, topOffset: Number(e.target.value) })}
                  />
                  <input
                    id={offsetId}
                    className="control num"
                    type="number"
                    min={0}
                    max={96}
                    value={draft.topOffset}
                    disabled={draft.attachTop}
                    onChange={(e) => commit({ ...draft, topOffset: Math.min(96, Math.max(0, Number(e.target.value) || 0)) })}
                  />
                </div>
              </div>
            </Group>
          </>
        )}

        {page === "widgets" && (
          <>
            <div className="widget-grid">
              {WIDGETS.map(({ key, title, description, Icon, hue }) => {
                const on = draft.activities[key];
                return (
                  <div key={key} className="widget" data-on={on}>
                    <span className="widget-icon" style={{ background: hue }}>
                      <Icon size={20} />
                    </span>
                    <WidgetToggle
                      title={title}
                      description={description}
                      checked={on}
                      onChange={(v) => commit({ ...draft, activities: { ...draft.activities, [key]: v } })}
                    />
                    {key === "notifications" && on && notifStatus && !notifStatus.supported && (
                      <p className="notice" role="note">
                        {notifStatus.reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <Group>
              <Switch
                title="Show the time when idle"
                description="Display the clock in the closed island while nothing else is happening."
                checked={draft.clockIdle}
                onChange={(clockIdle) => commit({ ...draft, clockIdle })}
              />
            </Group>
          </>
        )}

        {page === "behavior" && (
          <>
            <Group title="Opening">
              <Switch
                title="Open on hover"
                description="Expand when the cursor rests on the island and collapse when it leaves. Over a web browser, hovering fades the island so you can see the tabs; hold Ctrl to open it."
                checked={draft.openOnHover}
                onChange={(openOnHover) => commit({ ...draft, openOnHover })}
              />
              <Switch
                title="Hide in fullscreen"
                description="Hide while a fullscreen app or game is in front on the same display."
                checked={draft.hideInFullscreen}
                onChange={(hideInFullscreen) => commit({ ...draft, hideInFullscreen })}
              />
            </Group>

            <Group title="Display">
              <div className="row">
                <label className="row-text" htmlFor={monitorId}>
                  <span className="row-title">Monitor</span>
                  <span className="row-desc">Where the island appears.</span>
                </label>
                <select
                  id={monitorId}
                  className="control"
                  value={draft.monitor}
                  onChange={(e) => commit({ ...draft, monitor: e.target.value })}
                >
                  <option value="primary">Primary display</option>
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {monitorMissing && <option value={draft.monitor}>{draft.monitor} (not connected)</option>}
                </select>
              </div>
            </Group>

            <Group title="General">
              <Switch
                title="Start with Windows"
                description="Launch CipherIsland when you sign in."
                checked={draft.autostart}
                onChange={(autostart) => commit({ ...draft, autostart })}
              />
              <Switch
                title="Pause"
                description="Hide the island without quitting. Also in the tray menu."
                checked={draft.paused}
                onChange={(paused) => commit({ ...draft, paused })}
              />
            </Group>
          </>
        )}

        {page === "about" && (
          <>
            <Group title="Using the island">
              <ul className="tips">
                <li>
                  <b>Hover</b> the island to open it. <b>Click</b> to keep it open.
                </li>
                <li>
                  <b>Esc</b> or a <b>click outside</b> closes it. Right-click for Settings, Pause and Quit.
                </li>
                <li>
                  The tabs along the bottom switch between widgets. Buttons below the open island run quick actions.
                </li>
                <li>
                  The tray icon works the same way and is reachable by keyboard.
                </li>
              </ul>
            </Group>
            <Group title="Author">
              <div className="row author">
                <span className="avatar" aria-hidden="true">
                  N
                </span>
                <span className="row-text author-text">
                  <span className="row-title">nikkisosa</span>
                  <span className="row-desc">github.com/nikkisosa</span>
                </span>
                <button type="button" className="btn-gh" onClick={() => void ipc.openGithub()}>
                  GitHub
                  <ArrowUpRightIcon size={16} />
                </button>
              </div>
            </Group>
          </>
        )}
      </main>

      <div className="toast" role="status" aria-live="polite" data-show={saved}>
        {saved ? "Saved" : ""}
      </div>
    </div>
  );
}

/** Title, description and switch for a widget card. Same as `Switch`, without the row container. */
function WidgetToggle(props: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <>
      <label className="widget-text" htmlFor={id}>
        <span className="row-title">{props.title}</span>
        <span className="row-desc">{props.description}</span>
      </label>
      <input
        id={id}
        className="switch"
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </>
  );
}
