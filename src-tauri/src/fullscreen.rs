//! Fullscreen detection.
//!
//! The foreground window counts as fullscreen when its rectangle covers the whole monitor, not
//! just the work area, and that monitor is the island's. The desktop, shell and taskbar windows,
//! cloaked windows, this process's windows and maximized windows with a title bar are ignored.

use std::sync::atomic::{AtomicBool, Ordering};

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowLongPtrW,
    GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_STYLE, WS_CAPTION,
    WS_MAXIMIZE,
};

/// Result of the last [`detect`] run.
static FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// Window classes of the desktop and shell, which never count as fullscreen apps.
const SHELL_CLASSES: [&str; 6] = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "NotifyIconOverflowWindow",
    "XamlExplorerHostIslandWindow",
];

/// Returns the result of the last [`refresh`].
pub fn is_fullscreen() -> bool {
    FULLSCREEN.load(Ordering::SeqCst)
}

/// Re-evaluates the foreground window and updates the island's visibility if the result changed.
pub fn refresh() {
    let now = detect();
    if FULLSCREEN.swap(now, Ordering::SeqCst) != now {
        crate::window::apply_visibility();
    }
}

/// Returns the window class name of `h`, truncated to 63 characters.
fn class_name(h: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(h, &mut buf) } as usize;
    String::from_utf16_lossy(&buf[..n.min(buf.len())])
}

/// Returns whether a fullscreen window is in the foreground on the island's monitor.
fn detect() -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() || fg == GetDesktopWindow() || fg == GetShellWindow() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return false;
        }
        if !IsWindowVisible(fg).as_bool() || IsIconic(fg).as_bool() {
            return false;
        }
        if SHELL_CLASSES.contains(&class_name(fg).as_str()) {
            return false;
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(
            fg,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            std::mem::size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return false;
        }

        // A maximized window with a title bar is not fullscreen, even when an auto-hidden
        // taskbar lets it reach every monitor edge.
        let style = GetWindowLongPtrW(fg, GWL_STYLE) as u32;
        if style & WS_MAXIMIZE.0 != 0 && style & WS_CAPTION.0 == WS_CAPTION.0 {
            return false;
        }

        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONULL);
        if mon.0.is_null() {
            return false;
        }
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut mi).as_bool() {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let m = mi.rcMonitor;
        let covers = r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
        if !covers {
            return false;
        }

        // Only relevant when the fullscreen window is on the island's monitor.
        match crate::window::hwnd() {
            Some(ours) => MonitorFromWindow(ours, MONITOR_DEFAULTTONEAREST) == mon,
            None => true,
        }
    }
}
