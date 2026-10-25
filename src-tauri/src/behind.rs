//! Detects a web browser under the cursor.
//!
//! While the island is closed its window is click-through, so `WindowFromPoint` skips it and
//! returns the window a click would actually reach. The island fades instead of opening when
//! that window belongs to a browser, because the browser's tab strip sits where the island is.

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, POINT};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT};

/// Executable names (lowercase) treated as web browsers.
const BROWSERS: [&str; 12] = [
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
    "arc.exe",
    "zen.exe",
    "chromium.exe",
    "librewolf.exe",
    "waterfox.exe",
    "thorium.exe",
];

/// Returns whether the window under the screen coordinate `point` belongs to a known browser.
///
/// Windows owned by this process, and windows whose process cannot be queried, count as
/// not a browser.
pub fn browser_behind(point: POINT) -> bool {
    unsafe {
        let hit = WindowFromPoint(point);
        if hit.0.is_null() {
            return false;
        }
        let root = GetAncestor(hit, GA_ROOT);
        let root = if root.0.is_null() { hit } else { root };

        let mut pid = 0u32;
        GetWindowThreadProcessId(root, Some(&mut pid));
        if pid == 0 || pid == GetCurrentProcessId() {
            return false;
        }
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(process);
        if !ok {
            return false;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
        let exe = path.rsplit('\\').next().unwrap_or("");
        BROWSERS.contains(&exe)
    }
}
