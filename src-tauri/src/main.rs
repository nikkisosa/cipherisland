#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod audio;
mod behind;
mod battery;
mod clickthrough;
mod clipboard;
mod fullscreen;
mod media;
mod notify;
mod settings;
mod sysinfo;
mod topmost;
mod tray;
mod window;

use std::sync::OnceLock;

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::MacosLauncher;

/// Application handle, set once during `setup`.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Returns the application handle.
///
/// Worker threads, window hooks and WinRT callbacks have no `AppHandle` argument, so they use
/// this instead.
///
/// # Panics
///
/// Panics if called before `setup` has stored the handle.
pub fn app() -> &'static AppHandle {
    APP.get().expect("app handle is set during setup")
}

/// Returns the current settings.
#[tauri::command]
fn get_settings() -> settings::Settings {
    settings::get()
}

/// Validates, saves and applies `settings`, then notifies every window.
#[tauri::command]
fn set_settings(app: AppHandle, settings: settings::Settings) -> Result<(), String> {
    settings::apply(&app, settings)
}

/// Lists the connected monitors for the monitor picker.
#[tauri::command]
fn list_monitors() -> Vec<window::MonitorDto> {
    window::list_monitors()
}

/// Receives the island's rectangles from the frontend.
///
/// `rects` are where clicks must reach the webview, `hover` is where the island is drawn, and
/// `pass_clicks` makes the window ignore the mouse everywhere (island closed).
#[tauri::command]
fn report_hit_regions(rects: Vec<clickthrough::Rect>, hover: Vec<clickthrough::Rect>, pass_clicks: bool) {
    clickthrough::set_pass_clicks(pass_clicks);
    clickthrough::set_rects(rects, hover);
}

/// Arms or disarms outside-click and Esc reporting.
#[tauri::command]
fn set_outside_watch(watch: bool) {
    clickthrough::set_watch(watch);
}

/// Returns CPU and memory load for the System tab.
#[tauri::command]
fn system_stats() -> sysinfo::Stats {
    sysinfo::read()
}

/// Runs a quick action by name (see `actions::run`).
#[tauri::command]
fn quick_action(name: String) {
    actions::run(&name);
}

/// Turns the keep-awake request on or off.
#[tauri::command]
fn set_keep_awake(on: bool) {
    actions::set_keep_awake(on);
}

/// Copies `text` back onto the clipboard. Returns whether it worked.
#[tauri::command]
fn copy_text(text: String) -> bool {
    clipboard::write_text(&text)
}

/// Returns the master volume and mute state, or `None` without an audio device.
#[tauri::command]
fn get_volume() -> Option<audio::VolumeEvent> {
    audio::get_volume()
}

/// Sets the master volume from a scalar in `0.0..=1.0`.
#[tauri::command]
fn set_volume(level: f32) {
    audio::set_volume(level);
}

/// Seeks the current media session to `position_ms`.
#[tauri::command]
fn media_seek(position_ms: i64) {
    media::seek(position_ms);
}

/// Opens the author's GitHub profile in the default browser.
#[tauri::command]
fn open_github() {
    actions::open_github();
}

/// Sends `play_pause`, `next` or `previous` to the current media session.
#[tauri::command]
fn media_control(action: String) {
    media::control(&action);
}

/// Re-emits cached state (media, battery, notification status) once the island's event
/// listeners are attached.
#[tauri::command]
fn frontend_ready() {
    media::refresh();
    battery::resend();
    notify::emit_status();
}

/// Shows the settings window, creating it if needed.
#[tauri::command]
fn open_settings(app: AppHandle) {
    window::open_settings(&app);
}

/// Pauses or resumes the island.
#[tauri::command]
fn toggle_pause(app: AppHandle) {
    settings::toggle_pause(&app);
}

/// Exits the application.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Builds the Tauri application, registers plugins and commands, and starts the native worker threads.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::open_settings(app);
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            list_monitors,
            report_hit_regions,
            set_outside_watch,
            media_control,
            open_github,
            media_seek,
            get_volume,
            set_volume,
            quick_action,
            set_keep_awake,
            copy_text,
            system_stats,
            frontend_ready,
            open_settings,
            toggle_pause,
            quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = APP.set(handle.clone());
            settings::load(&handle);
            settings::reconcile_autostart(&handle);

            let main = app.get_webview_window("main").expect("main window is declared in tauri.conf.json");
            window::init(&main)?;
            clickthrough::start();
            topmost::start();
            fullscreen::refresh();
            media::start();
            audio::start();
            battery::start();
            if settings::get().activities.notifications {
                notify::start();
            }
            tray::build(&handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CipherIsland");
}
