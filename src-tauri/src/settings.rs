//! Settings model, persistence and the side effects of changing settings.
//!
//! Settings are kept in memory behind a mutex and saved with `tauri-plugin-store`.

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_store::StoreExt;

/// File name of the settings store.
const STORE_FILE: &str = "settings.json";
/// Key under which the settings are stored.
const STORE_KEY: &str = "settings";

/// Which widgets are enabled.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Activities {
    pub now_playing: bool,
    pub volume: bool,
    pub battery: bool,
    pub timer: bool,
    pub notifications: bool,
    pub clock: bool,
    pub system_stats: bool,
    pub clipboard: bool,
    pub calendar: bool,
    pub quick_actions: bool,
}

impl Default for Activities {
    fn default() -> Self {
        Self { now_playing: true, volume: true, battery: true, timer: true, notifications: false, clock: true, system_stats: true, clipboard: false, calendar: true, quick_actions: true }
    }
}

/// User settings. Missing fields fall back to their defaults when loading.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Monitor device name (e.g. `\\.\DISPLAY1`) or `"primary"`.
    pub monitor: String,
    /// Logical pixels between the top of the work area and the pill.
    pub top_offset: i32,
    pub hide_in_fullscreen: bool,
    pub autostart: bool,
    pub paused: bool,
    /// Show the time in the compact pill when nothing else is live.
    pub clock_idle: bool,
    /// Expand when the cursor rests on the island, collapse when it leaves.
    pub open_on_hover: bool,
    /// Sit flush against the top edge of the screen instead of floating below it.
    pub attach_top: bool,
    /// Island look: classic, graphite, midnight or light.
    pub theme: String,
    /// Accent for progress bars and highlights: auto, blue, green, orange, pink or teal.
    pub accent: String,
    pub activities: Activities,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            monitor: "primary".into(),
            top_offset: 8,
            hide_in_fullscreen: true,
            autostart: false,
            paused: false,
            clock_idle: false,
            open_on_hover: true,
            attach_top: true,
            theme: "classic".into(),
            accent: "auto".into(),
            activities: Activities::default(),
        }
    }
}

/// Returns the process-wide settings cell.
fn cell() -> &'static Mutex<Settings> {
    static CELL: OnceLock<Mutex<Settings>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(Settings::default()))
}

/// Returns a copy of the current settings.
pub fn get() -> Settings {
    cell().lock().unwrap().clone()
}

/// Loads saved settings, keeping the defaults if nothing valid is stored.
pub fn load(app: &AppHandle) {
    let loaded = app
        .store(STORE_FILE)
        .ok()
        .and_then(|s| s.get(STORE_KEY))
        .and_then(|v| serde_json::from_value::<Settings>(v).ok());
    if let Some(s) = loaded {
        *cell().lock().unwrap() = s;
    }
}

/// Writes `s` to the settings store.
fn persist(app: &AppHandle, s: &Settings) {
    if let Ok(store) = app.store(STORE_FILE) {
        if let Ok(v) = serde_json::to_value(s) {
            store.set(STORE_KEY, v);
            let _ = store.save();
        }
    }
}

/// Applies `next`: clamps values, saves them, syncs autostart, updates the tray, window
/// placement and visibility, and emits `settings://changed`.
///
/// # Errors
///
/// Currently always returns `Ok`; the `Result` keeps the command signature stable.
pub fn apply(app: &AppHandle, mut next: Settings) -> Result<(), String> {
    next.top_offset = next.top_offset.clamp(0, 96);
    let prev = get();
    *cell().lock().unwrap() = next.clone();
    persist(app, &next);

    if prev.autostart != next.autostart {
        let launcher = app.autolaunch();
        let result = if next.autostart { launcher.enable() } else { launcher.disable() };
        if let Err(e) = result {
            eprintln!("autostart update failed: {e}");
        }
    }

    crate::tray::sync_pause(app, next.paused);
    crate::window::place();
    crate::window::apply_visibility();
    crate::fullscreen::refresh();
    if next.activities.notifications {
        crate::notify::start();
    }
    let _ = app.emit("settings://changed", &next);
    Ok(())
}

/// Flips the `paused` setting and applies it.
pub fn toggle_pause(app: &AppHandle) {
    let mut s = get();
    s.paused = !s.paused;
    let _ = apply(app, s);
}

/// Makes the autostart registration match the saved setting. Called once at startup.
pub fn reconcile_autostart(app: &AppHandle) {
    let want = get().autostart;
    if let Ok(actual) = app.autolaunch().is_enabled() {
        if actual != want {
            let _ = if want { app.autolaunch().enable() } else { app.autolaunch().disable() };
        }
    }
}
