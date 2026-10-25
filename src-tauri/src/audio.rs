//! Master volume monitoring and control.
//!
//! A worker thread registers an `IAudioEndpointVolumeCallback` on the default render endpoint
//! and blocks on a channel. An `IMMNotificationClient` signals that channel when the default
//! device changes, and the callback is registered again on the new endpoint. Changes are
//! emitted as the `audio://volume` event; nothing is polled.

use std::sync::mpsc::{channel, Sender};
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use windows::core::{implement, Result, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
    IMMNotificationClient_Impl, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// Payload of the `audio://volume` event, and the result of [`get_volume`].
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeEvent {
    /// Master volume as a scalar in `0.0..=1.0`.
    pub level: f32,
    /// Whether the endpoint is muted.
    pub muted: bool,
}

/// Forwards master-volume notifications as `audio://volume` events.
#[implement(IAudioEndpointVolumeCallback)]
struct VolumeCallback;

impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(&self, pnotify: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
        if let Some(d) = unsafe { pnotify.as_ref() } {
            let _ = crate::app().emit(
                "audio://volume",
                VolumeEvent { level: d.fMasterVolume, muted: d.bMuted.as_bool() },
            );
        }
        Ok(())
    }
}

/// Signals the worker thread when the default render device changes.
#[implement(IMMNotificationClient)]
struct DeviceWatcher {
    /// Channel the worker thread waits on.
    rebind: Sender<()>,
}

impl IMMNotificationClient_Impl for DeviceWatcher_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> Result<()> {
        Ok(())
    }
    fn OnDeviceAdded(&self, _: &PCWSTR) -> Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> Result<()> {
        Ok(())
    }
    fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _: &PCWSTR) -> Result<()> {
        if flow == eRender && role == eMultimedia {
            let _ = self.rebind.send(());
        }
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> Result<()> {
        Ok(())
    }
}

/// Registers `cb` on the default render endpoint and returns its volume interface.
///
/// # Errors
///
/// Fails when there is no active render device or the callback cannot be registered.
fn bind(en: &IMMDeviceEnumerator, cb: &IAudioEndpointVolumeCallback) -> Result<IAudioEndpointVolume> {
    unsafe {
        let device = en.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let vol: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        vol.RegisterControlChangeNotify(cb)?;
        Ok(vol)
    }
}

/// Worker loop: registers the callbacks, then rebinds each time the default device changes.
/// Returns when the channel closes.
fn run() -> Result<()> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    let (tx, rx) = channel::<()>();
    let en: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let watcher: IMMNotificationClient = DeviceWatcher { rebind: tx }.into();
    unsafe { en.RegisterEndpointNotificationCallback(&watcher)? };
    let cb: IAudioEndpointVolumeCallback = VolumeCallback.into();

    let mut current: Option<IAudioEndpointVolume> = None;
    loop {
        if let Some(old) = current.take() {
            let _ = unsafe { old.UnregisterControlChangeNotify(&cb) };
        }
        match bind(&en, &cb) {
            Ok(v) => current = Some(v),
            Err(e) => eprintln!("no audio endpoint to watch yet: {e}"),
        }
        if rx.recv().is_err() {
            return Ok(());
        }
        // Windows reports a device switch once per role; wait for the burst to end.
        std::thread::sleep(Duration::from_millis(250));
        while rx.try_recv().is_ok() {}
    }
}

/// Spawns the volume monitoring thread.
pub fn start() {
    std::thread::Builder::new()
        .name("island-audio".into())
        .spawn(|| {
            if let Err(e) = run() {
                eprintln!("volume watcher stopped: {e}");
            }
        })
        .expect("spawn audio thread");
}

/// Opens the volume interface of the default render endpoint.
///
/// Used by [`get_volume`] and [`set_volume`], which run on threads where COM is already
/// initialised.
fn endpoint() -> Result<IAudioEndpointVolume> {
    unsafe {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = en.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

/// Reads the master volume and mute state, or `None` when no device is available.
pub fn get_volume() -> Option<VolumeEvent> {
    let v = endpoint().ok()?;
    unsafe {
        Some(VolumeEvent { level: v.GetMasterVolumeLevelScalar().ok()?, muted: v.GetMute().ok()?.as_bool() })
    }
}

/// Sets the master volume to `level`, clamped to `0.0..=1.0`, and unmutes when `level` is above zero.
pub fn set_volume(level: f32) {
    if let Ok(v) = endpoint() {
        unsafe {
            let _ = v.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null());
            if level > 0.0 {
                let _ = v.SetMute(false, std::ptr::null());
            }
        }
    }
}
