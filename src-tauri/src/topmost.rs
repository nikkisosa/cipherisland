//! Keeps the island above other topmost windows.
//!
//! Two triggers feed one worker thread: a `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` hook that
//! fires when the foreground window changes, and a 2 second heartbeat for windows that raise
//! themselves without changing the foreground.

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, SetWindowPos, TranslateMessage, EVENT_SYSTEM_FOREGROUND,
    HWND_TOPMOST, MSG, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WINEVENT_OUTOFCONTEXT,
    WINEVENT_SKIPOWNPROCESS,
};

/// Wakes the worker thread early when the foreground window changes.
static WAKE: OnceLock<Sender<()>> = OnceLock::new();

/// Places the island at the top of the topmost band, without activating it. Does nothing while hidden.
pub fn assert_topmost() {
    if !crate::window::is_visible() {
        return;
    }
    if let Some(h) = crate::window::hwnd() {
        unsafe {
            let _ = SetWindowPos(
                h,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

/// `WINEVENTPROC` for `EVENT_SYSTEM_FOREGROUND`. Only wakes the worker thread.
unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if let Some(tx) = WAKE.get() {
        let _ = tx.send(());
    }
}

/// Spawns the worker thread and the thread that pumps messages for the event hook.
pub fn start() {
    let (tx, rx) = channel::<()>();
    let _ = WAKE.set(tx);

    std::thread::Builder::new()
        .name("island-topmost".into())
        .spawn(move || loop {
            match rx.recv_timeout(Duration::from_secs(2)) {
                Ok(()) => {
                    // Give the new foreground window time to finish resizing.
                    std::thread::sleep(Duration::from_millis(150));
                    while rx.try_recv().is_ok() {}
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            crate::fullscreen::refresh();
            let _ = crate::app().run_on_main_thread(|| {
                crate::window::enforce_styles();
                assert_topmost();
            });
        })
        .expect("spawn topmost thread");

    // `WINEVENT_OUTOFCONTEXT` callbacks arrive through the installing thread's message
    // queue, so that thread must run a message loop.
    std::thread::Builder::new()
        .name("island-winevent".into())
        .spawn(|| unsafe {
            let hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            if hook.0.is_null() {
                eprintln!("SetWinEventHook failed; relying on the heartbeat only");
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("spawn winevent thread");
}
