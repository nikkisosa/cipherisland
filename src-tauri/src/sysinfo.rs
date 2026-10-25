//! CPU and memory load for the System tab.
//!
//! Sampled only while that tab is on screen: the frontend calls [`read`] once a second.

use std::mem::size_of;
use std::sync::Mutex;

use serde::Serialize;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;

/// System load returned by [`read`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// CPU use in percent (0-100), averaged since the previous call. The first call returns 0.
    pub cpu: f32,
    /// Physical memory in use, in bytes.
    pub mem_used: u64,
    /// Installed physical memory, in bytes.
    pub mem_total: u64,
}

/// Idle, kernel and user times from the previous sample. Kernel time includes idle time.
static PREV: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

/// Converts a `FILETIME` to a 64-bit tick count.
fn ticks(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

/// Samples CPU and memory load.
///
/// CPU use is the change since the previous call, so the first call reports 0.
pub fn read() -> Stats {
    let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe {
        let _ = GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user));
    }
    let now = (ticks(idle), ticks(kernel), ticks(user));
    let cpu = match PREV.lock().unwrap().replace(now) {
        Some(prev) => {
            let idle = now.0.saturating_sub(prev.0) as f32;
            let total = (now.1.saturating_sub(prev.1) + now.2.saturating_sub(prev.2)) as f32;
            if total > 0.0 {
                ((1.0 - idle / total) * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            }
        }
        None => 0.0,
    };

    let mut mem = MEMORYSTATUSEX { dwLength: size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    let (mem_used, mem_total) = match unsafe { GlobalMemoryStatusEx(&mut mem) } {
        Ok(()) => (mem.ullTotalPhys - mem.ullAvailPhys, mem.ullTotalPhys),
        Err(_) => (0, 0),
    };
    Stats { cpu, mem_used, mem_total }
}
