//! CPU, memory, disk and network load for the System tab.
//!
//! Sampled only while that tab is on screen: the frontend calls [`read`] once a second.

use std::mem::size_of;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use windows::core::HSTRING;
use windows::core::PCWSTR;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
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
    /// Used space on the system drive, in bytes.
    pub disk_used: u64,
    /// Size of the system drive, in bytes.
    pub disk_total: u64,
    /// Download rate in bytes per second, summed over the active network adapters.
    pub net_down: u64,
    /// Upload rate in bytes per second, summed over the active network adapters.
    pub net_up: u64,
}

/// Idle, kernel and user times from the previous sample. Kernel time includes idle time.
static PREV: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

/// Time and received/sent byte totals from the previous network sample.
static NET_PREV: Mutex<Option<(Instant, u64, u64)>> = Mutex::new(None);

/// `IF_TYPE` of the software loopback interface.
const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
/// `IF_TYPE` of tunnel interfaces, whose traffic is already counted on the physical adapter.
const IF_TYPE_TUNNEL: u32 = 131;

/// Returns the used and total bytes of the system drive, or zeros if it cannot be queried.
fn disk() -> (u64, u64) {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let root = HSTRING::from(format!("{drive}\\"));
    let (mut free, mut total) = (0u64, 0u64);
    let ok = unsafe { GetDiskFreeSpaceExW(PCWSTR(root.as_ptr()), None, Some(&mut total), Some(&mut free)).is_ok() };
    if ok {
        (total.saturating_sub(free), total)
    } else {
        (0, 0)
    }
}

/// Returns the bytes received and sent so far by all active, non-loopback, non-tunnel adapters.
fn network_totals() -> Option<(u64, u64)> {
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    unsafe {
        if GetIfTable2(&mut table).is_err() || table.is_null() {
            return None;
        }
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let (mut rx, mut tx) = (0u64, 0u64);
        for r in rows {
            if r.OperStatus == IfOperStatusUp && r.Type != IF_TYPE_SOFTWARE_LOOPBACK && r.Type != IF_TYPE_TUNNEL {
                rx += r.InOctets;
                tx += r.OutOctets;
            }
        }
        FreeMibTable(table as *const _);
        Some((rx, tx))
    }
}

/// Returns the (download, upload) rate in bytes per second since the previous call, or zeros
/// on the first call.
fn network_rates() -> (u64, u64) {
    let Some((rx, tx)) = network_totals() else { return (0, 0) };
    let now = Instant::now();
    match NET_PREV.lock().unwrap().replace((now, rx, tx)) {
        Some((then, prev_rx, prev_tx)) => {
            let secs = now.duration_since(then).as_secs_f64().max(0.001);
            ((rx.saturating_sub(prev_rx) as f64 / secs) as u64, (tx.saturating_sub(prev_tx) as f64 / secs) as u64)
        }
        None => (0, 0),
    }
}

/// Converts a `FILETIME` to a 64-bit tick count.
fn ticks(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

/// Samples CPU, memory, disk and network load.
///
/// CPU use and the network rates are the change since the previous call, so the first call
/// reports 0 for them.
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
    let (disk_used, disk_total) = disk();
    let (net_down, net_up) = network_rates();
    Stats { cpu, mem_used, mem_total, disk_used, disk_total, net_down, net_up }
}
