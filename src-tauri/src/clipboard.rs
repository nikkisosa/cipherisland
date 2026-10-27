//! Clipboard text preview.
//!
//! Driven by `AddClipboardFormatListener`, which delivers `WM_CLIPBOARDUPDATE` to the main window
//! (handled in `window.rs`). Content that password managers mark as excluded from clipboard
//! monitoring is never read. The preview is emitted as `clipboard://text`.

use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use windows::core::w;
use windows::Win32::Foundation::{GlobalFree, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
    OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

/// Clipboard format id for UTF-16 text (`CF_UNICODETEXT`).
const CF_UNICODETEXT: u32 = 13;
/// Maximum number of UTF-16 units read from the clipboard.
const MAX_CHARS: usize = 400;

/// Payload of the `clipboard://text` event.
#[derive(Serialize, Clone)]
struct ClipEvent {
    text: String,
}

/// Registers the window `h` to receive `WM_CLIPBOARDUPDATE`.
pub fn register(h: HWND) {
    unsafe {
        if let Err(e) = AddClipboardFormatListener(h) {
            eprintln!("AddClipboardFormatListener failed: {e}");
        }
    }
}

/// Handles a clipboard change on the UI thread.
///
/// Does nothing unless the clipboard widget is enabled. The read itself runs on a short-lived
/// thread so the UI thread never waits on another process.
pub fn changed() {
    if !crate::settings::get().activities.clipboard {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(60));
        if let Some(text) = read_text() {
            let _ = crate::app().emit("clipboard://text", ClipEvent { text });
        }
    });
}

/// Reads up to [`MAX_CHARS`] of Unicode text from the clipboard.
///
/// Returns `None` for non-text content, blank text, content marked private, or when the
/// clipboard stays locked by another process.
fn read_text() -> Option<String> {
    unsafe {
        let excluded = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        if excluded != 0 && IsClipboardFormatAvailable(excluded).is_ok() {
            return None;
        }
        if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
            return None;
        }
        // The copying app can still hold the clipboard briefly, so retry a few times.
        let mut opened = false;
        for _ in 0..8 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        if !opened {
            return None;
        }
        let mut out = None;
        if let Ok(handle) = GetClipboardData(CF_UNICODETEXT) {
            let g = HGLOBAL(handle.0);
            let p = GlobalLock(g) as *const u16;
            if !p.is_null() {
                let mut len = 0;
                while len < MAX_CHARS && *p.add(len) != 0 {
                    len += 1;
                }
                out = Some(String::from_utf16_lossy(std::slice::from_raw_parts(p, len)));
                let _ = GlobalUnlock(g);
            }
        }
        let _ = CloseClipboard();
        out.filter(|s| !s.trim().is_empty())
    }
}

/// Puts `text` on the clipboard as Unicode text, replacing its contents.
///
/// Used by the clipboard history to copy an earlier entry back. Returns `false` when the
/// clipboard could not be opened or the text could not be stored.
pub fn write_text(text: &str) -> bool {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut opened = false;
        for _ in 0..8 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        if !opened {
            return false;
        }
        let _ = EmptyClipboard();
        let mut stored = false;
        if let Ok(mem) = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2) {
            let p = GlobalLock(mem) as *mut u16;
            if !p.is_null() {
                std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
                let _ = GlobalUnlock(mem);
                // On success the system owns the memory; on failure it must be freed here.
                stored = SetClipboardData(CF_UNICODETEXT, Some(windows::Win32::Foundation::HANDLE(mem.0))).is_ok();
            }
            if !stored {
                let _ = GlobalFree(Some(mem));
            }
        }
        let _ = CloseClipboard();
        stored
    }
}
