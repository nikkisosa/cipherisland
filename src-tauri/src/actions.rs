//! System actions behind the quick-action buttons and the author link.

use windows::core::w;
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_ESCAPE, VK_LWIN, VK_SHIFT,
    VK_VOLUME_MUTE,
};

/// Virtual-key code for the S key, which the `windows` crate does not export.
const VK_S: VIRTUAL_KEY = VIRTUAL_KEY(0x53);

/// Presses `keys` in order, then releases them in reverse order, producing a key chord.
///
/// Input is injected with `keybd_event` into the current desktop session.
fn chord(keys: &[VIRTUAL_KEY]) {
    unsafe {
        for k in keys {
            keybd_event(k.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        }
        for k in keys.iter().rev() {
            keybd_event(k.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}

/// Runs the quick action called `name`.
///
/// Recognised names are `mute`, `snip` (Win+Shift+S), `tasks` (Ctrl+Shift+Esc) and `lock`.
/// Any other name is ignored.
pub fn run(name: &str) {
    match name {
        "mute" => chord(&[VK_VOLUME_MUTE]),
        "snip" => chord(&[VK_LWIN, VK_SHIFT, VK_S]),
        "tasks" => chord(&[VK_CONTROL, VK_SHIFT, VK_ESCAPE]),
        "lock" => unsafe {
            let _ = LockWorkStation();
        },
        _ => {}
    }
}

/// Opens the author's GitHub profile in the default browser.
///
/// The URL is a constant, so the webview cannot use this command to open arbitrary addresses.
pub fn open_github() {
    unsafe {
        ShellExecuteW(None, w!("open"), w!("https://github.com/nikkisosa"), None, None, SW_SHOWNORMAL);
    }
}
