//! System actions behind the quick-action buttons and the author link.

use windows::core::w;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_ESCAPE, VK_LWIN, VK_SHIFT,
    VK_VOLUME_MUTE,
};

/// Virtual-key code for the S key, which the `windows` crate does not export.
const VK_S: VIRTUAL_KEY = VIRTUAL_KEY(0x53);
/// Virtual-key code for the D key.
const VK_D: VIRTUAL_KEY = VIRTUAL_KEY(0x44);
/// Virtual-key code for the E key.
const VK_E: VIRTUAL_KEY = VIRTUAL_KEY(0x45);
/// Virtual-key code for the period key, used by the emoji picker chord.
const VK_PERIOD: VIRTUAL_KEY = VIRTUAL_KEY(0xBE);

/// Sender whose existence keeps the "keep awake" thread alive; dropping it ends the request.
static AWAKE: Mutex<Option<Sender<()>>> = Mutex::new(None);

/// Turns the "keep awake" request on or off.
///
/// `SetThreadExecutionState` applies to the calling thread, so a dedicated thread holds it until
/// the sender is dropped, then clears it.
pub fn set_keep_awake(on: bool) {
    let mut slot = AWAKE.lock().unwrap();
    if !on {
        *slot = None;
        return;
    }
    if slot.is_some() {
        return;
    }
    let (tx, rx) = channel::<()>();
    std::thread::spawn(move || {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED) };
        let _ = rx.recv();
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    });
    *slot = Some(tx);
}

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
/// Recognised names are `mute`, `snip` (Win+Shift+S), `tasks` (Ctrl+Shift+Esc), `lock`,
/// `desktop` (Win+D), `files` (Win+E) and `emoji` (Win+.).
/// Any other name is ignored.
pub fn run(name: &str) {
    match name {
        "mute" => chord(&[VK_VOLUME_MUTE]),
        "snip" => chord(&[VK_LWIN, VK_SHIFT, VK_S]),
        "tasks" => chord(&[VK_CONTROL, VK_SHIFT, VK_ESCAPE]),
        "desktop" => chord(&[VK_LWIN, VK_D]),
        "files" => chord(&[VK_LWIN, VK_E]),
        "emoji" => chord(&[VK_LWIN, VK_PERIOD]),
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
