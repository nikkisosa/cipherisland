//! System tray icon with Settings, Pause and Quit.

use std::sync::OnceLock;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

/// The Pause menu item, kept so its checkmark can follow the `paused` setting.
static PAUSE_ITEM: OnceLock<CheckMenuItem<Wry>> = OnceLock::new();

/// Creates the tray icon and its menu.
///
/// # Errors
///
/// Returns an error if the menu or icon cannot be created.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause CipherIsland", true, crate::settings::get().paused, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit CipherIsland", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &pause, &PredefinedMenuItem::separator(app)?, &quit])?;
    let _ = PAUSE_ITEM.set(pause);

    let mut builder = TrayIconBuilder::with_id("cipherisland")
        .tooltip("CipherIsland")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => crate::window::open_settings(app),
            "pause" => crate::settings::toggle_pause(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::window::open_settings(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Updates the Pause item's checkmark to `paused`, for changes made outside the tray menu.
pub fn sync_pause(_app: &AppHandle, paused: bool) {
    if let Some(item) = PAUSE_ITEM.get() {
        let _ = item.set_checked(paused);
    }
}
