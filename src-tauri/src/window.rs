//! Native window management: extended styles, per-monitor placement, visibility, system
//! messages (display, DPI, work area, power, clipboard) and the settings window.

use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, TRUE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

/// Width of the transparent canvas the island is drawn into, in logical pixels.
/// Must match `CANVAS` in `src/lib/metrics.ts`.
pub const CANVAS_W: f64 = 500.0;
/// Height of the transparent canvas, in logical pixels.
pub const CANVAS_H: f64 = 290.0;

/// Sent when the display resolution or layout changes.
const WM_DISPLAYCHANGE: u32 = 0x007E;
/// Sent when a system-wide setting changes; `SPI_SETWORKAREA` means the work area moved.
const WM_SETTINGCHANGE: u32 = 0x001A;
/// Sent when the window's DPI changes.
const WM_DPICHANGED: u32 = 0x02E0;
/// Sent for power events, including the settings registered in `battery.rs`.
const WM_POWERBROADCAST: u32 = 0x0218;
/// Sent when the clipboard contents change.
const WM_CLIPBOARDUPDATE: u32 = 0x031D;
/// `wParam` of `WM_SETTINGCHANGE` when the work area changes.
const SPI_SETWORKAREA: usize = 0x002F;
/// `MONITORINFO.dwFlags` bit marking the primary monitor.
const MONITORINFOF_PRIMARY: u32 = 1;

/// The island window handle as an integer; zero until [`init`] runs.
static HWND_RAW: AtomicIsize = AtomicIsize::new(0);
/// Whether the island is currently shown.
static VISIBLE: AtomicBool = AtomicBool::new(false);
/// True while a debounced reposition is waiting to run.
static REPOSITION_PENDING: AtomicBool = AtomicBool::new(false);
/// True while the settings window is being created, to ignore repeated requests.
static SETTINGS_BUILDING: AtomicBool = AtomicBool::new(false);

/// Returns the island window handle, or `None` before [`init`].
pub fn hwnd() -> Option<HWND> {
    match HWND_RAW.load(Ordering::SeqCst) {
        0 => None,
        raw => Some(HWND(raw as *mut c_void)),
    }
}

/// Returns whether the island is currently shown.
pub fn is_visible() -> bool {
    VISIBLE.load(Ordering::SeqCst)
}

/// A monitor as shown in the monitor picker.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitorDto {
    /// Device name, for example `\\.\DISPLAY1`.
    pub id: String,
    /// Human-readable description with resolution and scale.
    pub label: String,
    /// Whether this is the primary monitor.
    pub primary: bool,
}

/// Geometry of a monitor in physical pixels.
struct MonitorGeom {
    id: String,
    label: String,
    primary: bool,
    /// Full monitor rectangle.
    rect: RECT,
    /// Work area, which excludes the taskbar.
    work: RECT,
    /// Effective DPI.
    dpi: u32,
}

/// `MONITORENUMPROC` that appends each monitor to the `Vec<MonitorGeom>` pointed to by `data`.
///
/// # Safety
///
/// `data` must point to a live `Vec<MonitorGeom>`; [`enumerate`] guarantees this.
unsafe extern "system" fn enum_proc(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let list = &mut *(data.0 as *mut Vec<MonitorGeom>);
    let mut mi = MONITORINFOEXW::default();
    mi.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    if !GetMonitorInfoW(h, &mut mi as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
        return TRUE;
    }
    let (mut dx, mut dy) = (96u32, 96u32);
    let _ = GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);

    let len = mi.szDevice.iter().position(|&c| c == 0).unwrap_or(mi.szDevice.len());
    let id = String::from_utf16_lossy(&mi.szDevice[..len]);
    let primary = mi.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0;
    let number: String = id.chars().filter(|c| c.is_ascii_digit()).collect();
    let r = mi.monitorInfo.rcMonitor;
    let label = format!(
        "Display {} - {}x{} at {}%{}",
        if number.is_empty() { "?" } else { &number },
        r.right - r.left,
        r.bottom - r.top,
        dx * 100 / 96,
        if primary { " (primary)" } else { "" }
    );
    list.push(MonitorGeom { id, label, primary, rect: r, work: mi.monitorInfo.rcWork, dpi: dx });
    TRUE
}

/// Returns every connected monitor.
fn enumerate() -> Vec<MonitorGeom> {
    let mut list: Vec<MonitorGeom> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(enum_proc), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

/// Returns the connected monitors for the monitor picker.
pub fn list_monitors() -> Vec<MonitorDto> {
    enumerate()
        .into_iter()
        .map(|m| MonitorDto { id: m.id, label: m.label, primary: m.primary })
        .collect()
}

/// Positions and sizes the canvas on the chosen monitor.
///
/// The canvas is centred horizontally on the monitor and sits `top_offset` logical pixels
/// below the top of its work area (zero when attached to the top edge). Its size is scaled by
/// that monitor's DPI. Falls back to the primary monitor if the chosen one is missing.
pub fn place() {
    let Some(h) = hwnd() else { return };
    let s = crate::settings::get();
    let mons = enumerate();
    let Some(m) = mons
        .iter()
        .find(|m| m.id == s.monitor)
        .or_else(|| mons.iter().find(|m| m.primary))
        .or_else(|| mons.first())
    else {
        return;
    };
    let scale = m.dpi as f64 / 96.0;
    let w = (CANVAS_W * scale).round() as i32;
    let ht = (CANVAS_H * scale).round() as i32;
    let x = m.rect.left + ((m.rect.right - m.rect.left) - w) / 2;
    let offset = if s.attach_top { 0 } else { s.top_offset };
    let y = m.work.top + (offset as f64 * scale).round() as i32;
    unsafe {
        let _ = SetWindowPos(h, None, x, y, w, ht, SWP_NOACTIVATE | SWP_NOZORDER);
    }
}

/// Reads the extended window style of `h`.
fn ex_style(h: HWND) -> isize {
    unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) }
}

/// Ensures the window has `WS_EX_TOOLWINDOW` and `WS_EX_NOACTIVATE` and lacks `WS_EX_APPWINDOW`.
///
/// The windowing layer rewrites extended styles when it changes visibility or hit-testing and
/// drops bits it does not manage, so this is called after each show and from the heartbeat.
pub fn enforce_styles() {
    let Some(h) = hwnd() else { return };
    let ex = ex_style(h);
    let want = (ex | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize) & !(WS_EX_APPWINDOW.0 as isize);
    if want != ex {
        unsafe {
            SetWindowLongPtrW(h, GWL_EXSTYLE, want);
            let _ = SetWindowPos(
                h,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

/// Makes the window ignore mouse input (`ignore = true`) or receive it.
///
/// Sets `WS_EX_TRANSPARENT` directly instead of using the windowing layer, which would
/// overwrite the other extended style bits.
pub fn set_click_through(ignore: bool) {
    let Some(h) = hwnd() else { return };
    let ex = ex_style(h);
    let transparent = WS_EX_TRANSPARENT.0 as isize;
    let want = if ignore { ex | transparent | WS_EX_LAYERED.0 as isize } else { ex & !transparent };
    if want != ex {
        unsafe {
            SetWindowLongPtrW(h, GWL_EXSTYLE, want);
        }
    }
}

/// Schedules [`place`] after a 250 ms delay, merging repeated display, DPI and taskbar
/// notifications into one placement.
pub fn schedule_reposition() {
    if REPOSITION_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(250));
        REPOSITION_PENDING.store(false, Ordering::SeqCst);
        let _ = crate::app().run_on_main_thread(|| {
            place();
            crate::fullscreen::refresh();
        });
    });
}

/// Shows or hides the island: hidden while paused, or while a fullscreen app is in front and
/// `hide_in_fullscreen` is set. Does nothing if the state is unchanged.
pub fn apply_visibility() {
    let s = crate::settings::get();
    let want = !s.paused && !(s.hide_in_fullscreen && crate::fullscreen::is_fullscreen());
    if VISIBLE.swap(want, Ordering::SeqCst) == want {
        return;
    }
    let app = crate::app().clone();
    let _ = crate::app().run_on_main_thread(move || {
        if let Some(w) = app.get_webview_window("main") {
            if want {
                let _ = w.show();
                enforce_styles();
                crate::topmost::assert_topmost();
            } else {
                let _ = w.hide();
            }
        }
    });
}

/// Window subclass procedure. Reacts to display, DPI, work-area, power and clipboard messages,
/// then passes every message on to the original procedure.
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_DISPLAYCHANGE | WM_DPICHANGED => schedule_reposition(),
        WM_SETTINGCHANGE if wparam.0 == SPI_SETWORKAREA => schedule_reposition(),
        WM_POWERBROADCAST => crate::battery::refresh(),
        WM_CLIPBOARDUPDATE => crate::clipboard::changed(),
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// One-time native setup for the island window: extended styles, message subclass,
/// click-through, placement, and power and clipboard registrations.
///
/// Must run on the main thread.
///
/// # Errors
///
/// Returns an error if the native window handle cannot be obtained.
pub fn init(win: &WebviewWindow) -> tauri::Result<()> {
    HWND_RAW.store(win.hwnd()?.0 as isize, Ordering::SeqCst);
    let h = hwnd().expect("hwnd just stored");
    enforce_styles();
    unsafe {
        let _ = SetWindowSubclass(h, Some(subclass_proc), 1, 0);
    }
    // Click-through until the cursor reaches the pill (see clickthrough.rs).
    set_click_through(true);
    place();
    crate::battery::register_power_notifications(h);
    crate::clipboard::register(h);
    apply_visibility();
    Ok(())
}

/// Shows the settings window, or creates it if it does not exist.
pub fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // Building a webview window on the thread that pumps its messages can deadlock on
    // Windows, so it is built from a short-lived worker thread.
    if SETTINGS_BUILDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let built = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
            .title("CipherIsland settings")
            .inner_size(820.0, 640.0)
            .min_inner_size(640.0, 480.0)
            .center()
            .build();
        if let Err(e) = built {
            eprintln!("could not open settings window: {e}");
        }
        SETTINGS_BUILDING.store(false, Ordering::SeqCst);
    });
}
