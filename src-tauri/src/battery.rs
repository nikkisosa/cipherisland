//! Battery and AC power state.
//!
//! `RegisterPowerSettingNotification` on the main window delivers `WM_POWERBROADCAST` (handled
//! in `window.rs`) when the power source or charge level changes, and a 60 second refresh
//! covers drivers that do not report every change. State is emitted as `battery://state`.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::System::Power::{
    GetSystemPowerStatus, RegisterPowerSettingNotification, SYSTEM_POWER_STATUS,
};
use windows::Win32::System::SystemServices::{GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING};
use windows::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_WINDOW_HANDLE;

/// Payload of the `battery://state` event.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    /// False on desktops and other machines without a system battery.
    pub has_battery: bool,
    /// 0-100, or `None` when Windows cannot tell.
    pub level: Option<u8>,
    /// True while the battery is charging.
    pub charging: bool,
    /// True while the machine is on AC power.
    pub plugged_in: bool,
    /// Estimated runtime on battery in seconds, when Windows can tell.
    pub seconds_left: Option<u32>,
}

/// Last emitted state, used to skip duplicate events.
static LAST: Mutex<Option<BatteryState>> = Mutex::new(None);

/// Queries the current power status, or `None` if the query fails.
fn read() -> Option<BatteryState> {
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s).ok()? };
    let has_battery = s.BatteryFlag & 128 == 0 && s.BatteryFlag != 255;
    Some(BatteryState {
        has_battery,
        level: (s.BatteryLifePercent <= 100).then_some(s.BatteryLifePercent),
        charging: s.BatteryFlag & 8 != 0,
        plugged_in: s.ACLineStatus == 1,
        seconds_left: (s.BatteryLifeTime != u32::MAX).then_some(s.BatteryLifeTime),
    })
}

/// Emits `battery://state` if the state differs from the last one emitted.
pub fn refresh() {
    let Some(now) = read() else { return };
    {
        let mut last = LAST.lock().unwrap();
        if last.as_ref() == Some(&now) {
            return;
        }
        *last = Some(now.clone());
    }
    let _ = crate::app().emit("battery://state", now);
}

/// Emits the current state even when unchanged, for a frontend that has just attached.
pub fn resend() {
    if let Some(now) = LAST.lock().unwrap().clone().or_else(read) {
        let _ = crate::app().emit("battery://state", now);
    }
}

/// Subscribes the window `h` to power-source and battery-level change messages.
pub fn register_power_notifications(h: HWND) {
    unsafe {
        for guid in [&GUID_ACDC_POWER_SOURCE, &GUID_BATTERY_PERCENTAGE_REMAINING] {
            if let Err(e) = RegisterPowerSettingNotification(HANDLE(h.0), guid, DEVICE_NOTIFY_WINDOW_HANDLE) {
                eprintln!("RegisterPowerSettingNotification failed: {e}");
            }
        }
    }
}

/// Emits the initial state and spawns the 60 second refresh thread.
pub fn start() {
    refresh();
    std::thread::Builder::new()
        .name("island-battery".into())
        .spawn(|| loop {
            std::thread::sleep(Duration::from_secs(60));
            refresh();
        })
        .expect("spawn battery thread");
}
