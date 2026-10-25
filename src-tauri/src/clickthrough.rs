//! Click-through, hover and outside-click detection for the transparent canvas.
//!
//! The window is click-through (`WS_EX_TRANSPARENT`) except over the island's hit rectangles,
//! which the frontend reports in canvas-relative CSS pixels. A polling thread reads the cursor
//! and toggles the style. `SetWindowRgn` is not used: the pill springs and overshoots, so a
//! region would have to be rebuilt every frame, and regions are not anti-aliased, which would
//! clip the pill's rounded edge and shadow.
//!
//! The same thread reports hover, because a click-through window receives no pointer events,
//! and, while armed with [`set_watch`], mouse presses outside the island and the Esc key.
//!
//! Polling runs at about 30 Hz while the cursor is near the window or a watch is armed, and at
//! about 7 Hz otherwise.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::Emitter;
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};

/// Rectangle in canvas-relative logical (CSS) pixels.
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Payload of the `island://hover` event.
#[derive(serde::Serialize, Clone)]
struct HoverEvent {
    /// The cursor is over the drawn island.
    over: bool,
    /// A web browser is under the cursor (decided when the hover starts).
    behind: bool,
    /// Ctrl is held: open the island even with a browser behind it.
    ctrl: bool,
}

/// Areas that must receive clicks. Larger than the drawn island while it is animating.
static RECTS: Mutex<Vec<Rect>> = Mutex::new(Vec::new());
/// Areas where the island is actually drawn. Used only to decide hover, so transparent
/// space around or left behind by the island never opens it.
static HOVER_RECTS: Mutex<Vec<Rect>> = Mutex::new(Vec::new());
/// Whether outside clicks and Esc should be reported. Set while the island is open.
static WATCH: AtomicBool = AtomicBool::new(false);
/// When true, mouse input always falls through the window. Set while the island is closed so
/// the app behind it keeps receiving clicks.
static PASS_CLICKS: AtomicBool = AtomicBool::new(false);

/// Margin in logical pixels added around each click rectangle, covering hover scaling and
/// spring overshoot.
const PAD: f64 = 6.0;
/// Margin in logical pixels added around each hover rectangle.
const HOVER_PAD: f64 = 2.0;
/// Distance in logical pixels from the window within which the fast poll rate applies.
const NEAR_MARGIN: f64 = 48.0;

/// Sets whether mouse input falls through the window regardless of the click rectangles.
pub fn set_pass_clicks(pass: bool) {
    PASS_CLICKS.store(pass, Ordering::SeqCst);
}

/// Replaces the click rectangles (`rects`) and hover rectangles (`hover`) reported by the frontend.
pub fn set_rects(rects: Vec<Rect>, hover: Vec<Rect>) {
    *RECTS.lock().unwrap() = rects;
    *HOVER_RECTS.lock().unwrap() = hover;
}

/// Returns whether the screen point (`px`, `py`) lies in any of `rects`, each grown by `pad`.
///
/// `wr` is the window's screen rectangle in physical pixels and `scale` its DPI scale factor.
fn contains(rects: &[Rect], pad: f64, wr: &RECT, scale: f64, px: f64, py: f64) -> bool {
    rects.iter().any(|r| {
        let left = wr.left as f64 + (r.x - pad) * scale;
        let top = wr.top as f64 + (r.y - pad) * scale;
        px >= left && px < left + (r.w + 2.0 * pad) * scale && py >= top && py < top + (r.h + 2.0 * pad) * scale
    })
}

/// Arms or disarms the outside-click and Esc watcher.
pub fn set_watch(watch: bool) {
    WATCH.store(watch, Ordering::SeqCst);
}

/// Returns whether the virtual key `vk` is currently held.
fn down(vk: i32) -> bool {
    unsafe { GetAsyncKeyState(vk) as u16 & 0x8000 != 0 }
}

/// Spawns the cursor polling thread.
pub fn start() {
    std::thread::Builder::new()
        .name("island-cursor".into())
        .spawn(|| {
            let mut armed = false;
            let (mut prev_mouse, mut prev_esc) = (false, false);
            let mut hovering = false;
            let mut ctrl_held = false;
            let mut behind_now = false;

            loop {
                let Some(h) = crate::window::hwnd() else {
                    std::thread::sleep(Duration::from_millis(200));
                    continue;
                };
                let mut sleep_ms = 150;

                if crate::window::is_visible() {
                    let mut pt = POINT::default();
                    let mut wr = RECT::default();
                    let ok = unsafe { GetCursorPos(&mut pt).is_ok() && GetWindowRect(h, &mut wr).is_ok() };
                    if ok {
                        let scale = unsafe { GetDpiForWindow(h) }.max(96) as f64 / 96.0;
                        let m = NEAR_MARGIN * scale;
                        let near = (pt.x as f64) >= wr.left as f64 - m
                            && (pt.x as f64) <= wr.right as f64 + m
                            && (pt.y as f64) <= wr.bottom as f64 + m;

                        let (px, py) = (pt.x as f64, pt.y as f64);
                        let inside = contains(&RECTS.lock().unwrap(), PAD, &wr, scale, px, py);
                        let over = contains(&HOVER_RECTS.lock().unwrap(), HOVER_PAD, &wr, scale, px, py);

                        // Writes the style only when it differs, which also restores the flag if the
                        // windowing layer rewrote the style.
                        crate::window::set_click_through(!inside || PASS_CLICKS.load(Ordering::SeqCst));
                        // Hover comes from here because a click-through window gets no pointer events.
                        let ctrl = over && down(VK_CONTROL.0 as i32);
                        if over != hovering || ctrl != ctrl_held {
                            if over && !hovering {
                                // Evaluated once per hover, while the window is still click-through.
                                behind_now = crate::behind::browser_behind(pt);
                            }
                            hovering = over;
                            ctrl_held = ctrl;
                            let _ = crate::app().emit_to(
                                "main",
                                "island://hover",
                                HoverEvent { over, behind: over && behind_now, ctrl },
                            );
                        }

                        let watch = WATCH.load(Ordering::SeqCst);
                        if watch {
                            let mouse = down(VK_LBUTTON.0 as i32)
                                || down(VK_RBUTTON.0 as i32)
                                || down(VK_MBUTTON.0 as i32);
                            let esc = down(VK_ESCAPE.0 as i32);
                            if !armed {
                                // Ignore a press that began before the watcher was armed.
                                (prev_mouse, prev_esc) = (mouse, esc);
                                armed = true;
                            }
                            if mouse && !prev_mouse && !inside {
                                let _ = crate::app().emit_to("main", "island://outside-click", ());
                            }
                            if esc && !prev_esc {
                                let _ = crate::app().emit_to("main", "island://escape", ());
                            }
                            (prev_mouse, prev_esc) = (mouse, esc);
                        } else {
                            armed = false;
                        }

                        if near || watch {
                            sleep_ms = 33;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(sleep_ms));
            }
        })
        .expect("spawn cursor thread");
}
