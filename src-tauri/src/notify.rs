//! Optional toast mirroring through `UserNotificationListener`.
//!
//! Windows grants listener access only to apps with package identity (MSIX or a sparse
//! package). An unpackaged build is normally refused or gets an error from `RequestAccessAsync`.
//! In that case [`start`] reports `notif://status` with `supported: false` and a reason, and the
//! rest of the island is unaffected. Nothing runs unless the setting is on.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// Payload of the `notif://status` event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Status {
    supported: bool,
    reason: String,
}

/// Payload of the `notif://new` event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Toast {
    id: u32,
    app: String,
    title: String,
    body: String,
}

/// Guards against starting the listener thread twice.
static STARTED: AtomicBool = AtomicBool::new(false);
/// Last status, re-emitted by [`emit_status`].
static STATUS: Mutex<Option<Status>> = Mutex::new(None);

/// Stores and emits the listener status.
fn set_status(supported: bool, reason: impl Into<String>) {
    let s = Status { supported, reason: reason.into() };
    *STATUS.lock().unwrap() = Some(s.clone());
    let _ = crate::app().emit("notif://status", s);
}

/// Re-emits the last status, if any, for a window that has just attached.
pub fn emit_status() {
    if let Some(s) = STATUS.lock().unwrap().clone() {
        let _ = crate::app().emit("notif://status", s);
    }
}

/// Extracts the app name, title and body from a notification.
fn to_toast(n: &UserNotification) -> windows::core::Result<Toast> {
    let app = n
        .AppInfo()
        .and_then(|a| a.DisplayInfo())
        .and_then(|d| d.DisplayName())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let binding = n
        .Notification()?
        .Visual()?
        .GetBinding(&KnownNotificationBindings::ToastGeneric()?)?;
    let texts = binding.GetTextElements()?;
    let text_at = |i: u32| {
        if i < texts.Size().unwrap_or(0) {
            texts.GetAt(i).and_then(|t| t.Text()).map(|s| s.to_string()).unwrap_or_default()
        } else {
            String::new()
        }
    };
    Ok(Toast { id: n.Id()?, app, title: text_at(0), body: text_at(1) })
}

/// Requests access, then emits each new toast until the channel closes.
///
/// # Errors
///
/// Fails when the listener cannot be created or access is refused by an error.
fn run() -> windows::core::Result<()> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    let listener = UserNotificationListener::Current()?;
    match listener.RequestAccessAsync()?.get()? {
        UserNotificationListenerAccessStatus::Allowed => {}
        _ => {
            set_status(
                false,
                "Windows did not grant notification access. Reading other apps' notifications \
                 needs package identity, which this unpackaged build does not have.",
            );
            return Ok(());
        }
    }

    let (tx, rx) = channel::<()>();
    listener.NotificationChanged(&TypedEventHandler::new(move |_, _| {
        let _ = tx.send(());
        Ok(())
    }))?;
    set_status(true, "");

    let mut seen: HashSet<u32> = HashSet::new();
    let mut first = true;
    loop {
        let list = listener.GetNotificationsAsync(NotificationKinds::Toast)?.get()?;
        let mut current = HashSet::new();
        for i in 0..list.Size()? {
            let n = list.GetAt(i)?;
            let Ok(id) = n.Id() else { continue };
            current.insert(id);
            // The first pass only records notifications already in Action Center.
            if !first && !seen.contains(&id) {
                if let Ok(toast) = to_toast(&n) {
                    let _ = crate::app().emit("notif://new", toast);
                }
            }
        }
        seen = current;
        first = false;

        if rx.recv().is_err() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
        while rx.try_recv().is_ok() {}
    }
}

/// Starts the listener thread. Calling it again has no effect.
pub fn start() {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::Builder::new()
        .name("island-notify".into())
        .spawn(|| {
            if let Err(e) = run() {
                // Unpackaged apps typically fail with 0x80070490 (ERROR_NOT_FOUND).
                let reason = if e.code().0 as u32 == 0x8007_0490 {
                    "Windows does not offer notification access to apps without package identity                      (error 0x80070490). This build is unpackaged, so the island cannot read                      notifications; turn this setting off, or package the app as MSIX to enable it."
                        .to_string()
                } else {
                    format!("Notification access failed: {e}")
                };
                set_status(false, reason);
            }
        })
        .expect("spawn notify thread");
}
