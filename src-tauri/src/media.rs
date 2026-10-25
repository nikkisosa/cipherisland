//! Now playing, through the Windows media transport controls (`Windows.Media.Control`).
//!
//! One worker thread owns the session manager. WinRT events (current session, media properties,
//! playback info, timeline) only post a message to that thread, which coalesces bursts, builds a
//! snapshot and emits it. Transport commands from the UI use the same channel, so every WinRT
//! call happens on that thread.
//!
//! Events: `media://state` carries the metadata and timeline, and `media://art` carries the
//! artwork, sent only when the track changes.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::Emitter;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Props,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// Offset between the Windows epoch (1601) and the Unix epoch, in 100 ns ticks.
const EPOCH_DELTA_TICKS: i64 = 116_444_736_000_000_000;
/// Largest artwork, in bytes, that is read and sent to the frontend.
const MAX_ART_BYTES: u32 = 4_000_000;

/// Messages handled by the media worker thread.
#[derive(Debug)]
enum Msg {
    Refresh,
    Rebind,
    Resend,
    Control(Action),
}

/// Transport command sent to the current media session.
#[derive(Debug, Clone, Copy)]
enum Action {
    PlayPause,
    Next,
    Previous,
    /// Absolute position in milliseconds.
    Seek(i64),
}

/// Payload of the `media://state` event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MediaState {
    has_session: bool,
    title: String,
    artist: String,
    album: String,
    status: &'static str,
    position_ms: i64,
    duration_ms: i64,
    /// Unix ms at which `position_ms` was valid, so the UI can extrapolate.
    sampled_at: u64,
    art_key: String,
}

/// Payload of the `media://art` event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ArtEvent {
    key: String,
    mime: String,
    /// Base64 image bytes; empty when the session has no artwork.
    data: String,
}

/// Sender for the worker thread, set by [`start`].
static TX: OnceLock<Sender<Msg>> = OnceLock::new();

/// Sends a transport command by name: `play_pause`, `next` or `previous`. Other names are ignored.
pub fn control(action: &str) {
    let action = match action {
        "play_pause" => Action::PlayPause,
        "next" => Action::Next,
        "previous" => Action::Previous,
        _ => return,
    };
    send(Msg::Control(action));
}

/// Seeks the current session to `position_ms` (negative values are treated as zero).
pub fn seek(position_ms: i64) {
    send(Msg::Control(Action::Seek(position_ms.max(0))));
}

/// Asks the worker to emit the current state and artwork again.
pub fn refresh() {
    send(Msg::Resend);
}

/// Posts `m` to the worker thread if it is running.
fn send(m: Msg) {
    if let Some(tx) = TX.get() {
        let _ = tx.send(m);
    }
}

/// A media session with this module's change handlers attached.
struct Attached {
    session: Session,
    /// Event registration tokens: media properties, playback info and timeline.
    tokens: [i64; 3],
}

impl Attached {
    /// Attaches change handlers to `session` that post [`Msg::Refresh`].
    fn new(session: Session, tx: &Sender<Msg>) -> windows::core::Result<Self> {
        let (a, b, c) = (tx.clone(), tx.clone(), tx.clone());
        let t0 = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
            let _ = a.send(Msg::Refresh);
            Ok(())
        }))?;
        let t1 = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
            let _ = b.send(Msg::Refresh);
            Ok(())
        }))?;
        let t2 = session.TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| {
            let _ = c.send(Msg::Refresh);
            Ok(())
        }))?;
        Ok(Self { session, tokens: [t0, t1, t2] })
    }

    /// Removes the handlers added by [`Attached::new`].
    fn detach(&self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.tokens[0]);
        let _ = self.session.RemovePlaybackInfoChanged(self.tokens[1]);
        let _ = self.session.RemoveTimelinePropertiesChanged(self.tokens[2]);
    }
}

/// Remembers which track's artwork was last sent.
#[derive(Default)]
struct ArtCache {
    key: String,
    has_art: bool,
}

/// Returns the current time as Unix milliseconds.
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Reads the session thumbnail and returns its MIME type and base64 data.
///
/// Returns `None` when there is no thumbnail or it exceeds [`MAX_ART_BYTES`].
fn read_art(props: &Props) -> Option<(String, String)> {
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > MAX_ART_BYTES {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    let mime = stream.ContentType().ok()?.to_string();
    Some((mime, base64::engine::general_purpose::STANDARD.encode(buf)))
}

/// Builds the state for `session` and, when the track changed (or `force_art` is set), its artwork.
///
/// The playback position is advanced to the present using the timeline's last-update time.
fn snapshot(
    session: &Session,
    cache: &mut ArtCache,
    force_art: bool,
) -> windows::core::Result<(MediaState, Option<ArtEvent>)> {
    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let title = props.Title()?.to_string();
    let artist = props.Artist()?.to_string();
    let album = props.AlbumTitle()?.to_string();

    let status = match session.GetPlaybackInfo()?.PlaybackStatus()? {
        Status::Playing => "playing",
        Status::Paused => "paused",
        _ => "stopped",
    };

    let tl = session.GetTimelineProperties()?;
    let to_ms = |ticks: i64| ticks / 10_000;
    let start = to_ms(tl.StartTime()?.Duration);
    let end = to_ms(tl.EndTime()?.Duration);
    let mut position = to_ms(tl.Position()?.Duration) - start;
    let updated_unix_ms = to_ms(tl.LastUpdatedTime()?.UniversalTime - EPOCH_DELTA_TICKS);
    let now = now_ms();
    if status == "playing" && updated_unix_ms > 0 {
        position += (now as i64 - updated_unix_ms).max(0);
    }
    let duration = (end - start).max(0);
    if duration > 0 {
        position = position.clamp(0, duration);
    } else {
        position = position.max(0);
    }

    let key = format!("{title}\u{1}{artist}\u{1}{album}");
    let mut art_event = None;
    if force_art || key != cache.key || !cache.has_art {
        let art = read_art(&props);
        let changed = key != cache.key || force_art || art.is_some();
        cache.key = key.clone();
        cache.has_art = art.is_some();
        if changed {
            let (mime, data) = art.unwrap_or_default();
            art_event = Some(ArtEvent { key: key.clone(), mime, data });
        }
    }

    Ok((
        MediaState {
            has_session: true,
            title,
            artist,
            album,
            status,
            position_ms: position,
            duration_ms: duration,
            sampled_at: now,
            art_key: key,
        },
        art_event,
    ))
}

/// State emitted when no media session exists.
fn empty_state() -> MediaState {
    MediaState {
        has_session: false,
        title: String::new(),
        artist: String::new(),
        album: String::new(),
        status: "stopped",
        position_ms: 0,
        duration_ms: 0,
        sampled_at: now_ms(),
        art_key: String::new(),
    }
}

/// Worker loop: attaches to the current session, emits state on each change and handles
/// commands. Returns when the channel closes.
fn run(rx: Receiver<Msg>, tx: Sender<Msg>) -> windows::core::Result<()> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    let manager = Manager::RequestAsync()?.get()?;
    let t = tx.clone();
    manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
        let _ = t.send(Msg::Rebind);
        Ok(())
    }))?;

    let mut attached: Option<Attached> = None;
    let mut cache = ArtCache::default();
    let mut rebind = true;
    let mut force_art = false;

    loop {
        if rebind {
            if let Some(old) = attached.take() {
                old.detach();
            }
            attached = manager
                .GetCurrentSession()
                .ok()
                .and_then(|s| Attached::new(s, &tx).ok());
            cache = ArtCache::default();
            rebind = false;
        }

        let app = crate::app();
        match attached.as_ref().map(|a| snapshot(&a.session, &mut cache, force_art)) {
            Some(Ok((state, art))) => {
                if let Some(art) = art {
                    let _ = app.emit("media://art", art);
                }
                let _ = app.emit("media://state", state);
            }
            _ => {
                let _ = app.emit("media://state", empty_state());
            }
        }
        force_art = false;

        let Ok(first) = rx.recv() else { return Ok(()) };
        let mut pending = vec![first];
        while let Ok(m) = rx.recv_timeout(Duration::from_millis(80)) {
            pending.push(m);
        }
        for m in pending {
            match m {
                Msg::Refresh => {}
                Msg::Rebind => rebind = true,
                Msg::Resend => force_art = true,
                Msg::Control(action) => {
                    if let Some(a) = &attached {
                        let op = match action {
                            Action::PlayPause => a.session.TryTogglePlayPauseAsync(),
                            Action::Next => a.session.TrySkipNextAsync(),
                            Action::Previous => a.session.TrySkipPreviousAsync(),
                            Action::Seek(ms) => a.session.TryChangePlaybackPositionAsync(ms * 10_000),
                        };
                        if let Ok(op) = op {
                            let _ = op.get();
                        }
                    }
                }
            }
        }
    }
}

/// Spawns the media worker thread.
pub fn start() {
    let (tx, rx) = channel::<Msg>();
    let _ = TX.set(tx.clone());
    std::thread::Builder::new()
        .name("island-media".into())
        .spawn(move || {
            if let Err(e) = run(rx, tx) {
                eprintln!("media session watcher stopped: {e}");
                let _ = crate::app().emit("media://state", empty_state());
            }
        })
        .expect("spawn media thread");
}
