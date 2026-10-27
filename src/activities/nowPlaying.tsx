import { createStore, formatClock, useTicker, useUntil } from "../lib/store";
import { ipc, onEvent } from "../lib/ipc";
import { Marquee } from "../components/Marquee";
import { VolumeSlider } from "./volume";
import { MusicIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Payload of the `media://state` event. */
interface MediaState {
  hasSession: boolean;
  title: string;
  artist: string;
  album: string;
  status: "playing" | "paused" | "stopped";
  positionMs: number;
  durationMs: number;
  sampledAt: number;
  artKey: string;
}

/** Payload of the `media://art` event. */
interface ArtEvent {
  key: string;
  mime: string;
  data: string;
}

/** How long a paused session keeps the pill, in milliseconds. */
const PAUSE_LINGER_MS = 8000;

/** Current media session, its artwork as a data URI, and when playback last stopped. */
const store = createStore<{ media: MediaState | null; art: string | null; artKey: string; pausedAt: number; tint: string | null }>({
  media: null,
  art: null,
  tint: null,
  artKey: "",
  pausedAt: 0,
});

onEvent<MediaState>("media://state", (media) => {
  const prev = store.get();
  const wasPlaying = prev.media?.status === "playing";
  store.set({ ...prev, media, pausedAt: wasPlaying && media.status !== "playing" ? Date.now() : prev.pausedAt });
});
/**
 * Finds a vivid average color of an image, for the glow behind the player.
 *
 * Pixels are averaged on an 8 by 8 copy, weighted toward saturated ones so a mostly grey cover
 * with a colored subject still gives that color.
 *
 * @param src Image URL or data URI.
 * @param done Called with an `r, g, b` string, or `null` when the image cannot be read.
 */
function dominantColor(src: string, done: (rgb: string | null) => void) {
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return done(null);
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        const weight = 0.15 + (max - min) / 255;
        r += d[i] * weight;
        g += d[i + 1] * weight;
        b += d[i + 2] * weight;
        w += weight;
      }
      done(`${Math.round(r / w)}, ${Math.round(g / w)}, ${Math.round(b / w)}`);
    } catch {
      done(null);
    }
  };
  img.onerror = () => done(null);
  img.src = src;
}

onEvent<ArtEvent>("media://art", (e) => {
  const art = e.data ? `data:${e.mime || "image/png"};base64,${e.data}` : null;
  store.set((s) => ({ ...s, artKey: e.key, art, tint: art ? s.tint : null }));
  if (art) dominantColor(art, (tint) => store.set((s) => (s.art === art ? { ...s, tint } : s)));
});

/**
 * Estimates the current playback position.
 *
 * @param m Last reported state; position is extrapolated from `sampledAt` while playing.
 * @returns Position in milliseconds, capped at the track length.
 */
function positionNow(m: MediaState): number {
  const elapsed = m.status === "playing" ? Date.now() - m.sampledAt : 0;
  const pos = m.positionMs + elapsed;
  return m.durationMs > 0 ? Math.min(pos, m.durationMs) : pos;
}

/**
 * Square album art, or a note icon when there is none.
 *
 * @param size Edge length in pixels.
 * @param radius Corner radius in pixels.
 */
function Cover({ size, radius }: { size: number; radius: number }) {
  const { art } = store.use();
  return (
    <span className="cover" style={{ width: size, height: size, borderRadius: radius }}>
      {art ? <img src={art} alt="" draggable={false} /> : <MusicIcon size={size * 0.5} />}
    </span>
  );
}

/** Leading glyph of the compact pill and the tab strip. Album art. */
function Glyph({ size = 24 }: { size?: number }) {
  return <Cover size={size} radius={Math.round(size * 0.28)} />;
}

/** Scrolling track title for the compact pill. */
function TrackTitle() {
  const { media } = store.use();
  return <Marquee>{media?.title || "Unknown title"}</Marquee>;
}

/** Value shown on the right of the compact pill. Animated bars, still while paused. */
function Bars() {
  const { media } = store.use();
  return (
    <span className="bars" data-playing={media?.status === "playing"} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** Panel shown in the expanded island. Artwork, title, artist, seek bar, transport controls and volume. */
function Expanded() {
  const { media, tint } = store.use();
  const playing = media?.status === "playing";
  // Redraws the progress bar twice a second, only while this panel is mounted and playing.
  useTicker(playing, 500);
  if (!media) return null;

  const pos = positionNow(media);
  const ratio = media.durationMs > 0 ? pos / media.durationMs : 0;

  return (
    <div className="panel panel-media">
      <div className="media-aura" style={{ ["--aura" as string]: tint ?? "120, 120, 130" }} aria-hidden="true" />
      <div className="media-head">
        <Cover size={64} radius={14} />
        <div className="media-text">
          <div className="media-title" title={media.title}>
            <Marquee>{media.title || "Unknown title"}</Marquee>
          </div>
          <div className="media-artist" title={media.artist}>
            {media.artist || media.album || "Unknown artist"}
          </div>
        </div>
        <Bars />
      </div>
      <div className="media-progress">
        <span className="num">{formatClock(pos)}</span>
        <div
          className="scrub"
          onPointerDown={(e) => {
            if (media.durationMs <= 0) return;
            const box = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
            const ms = Math.round(ratio * media.durationMs);
            // Update the bar optimistically; the session's next update corrects it.
            store.set((s) => (s.media ? { ...s, media: { ...s.media, positionMs: ms, sampledAt: Date.now() } } : s));
            void ipc.mediaSeek(ms).catch(() => undefined);
          }}
        >
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={Math.round(media.durationMs / 1000)}
            aria-valuenow={Math.round(pos / 1000)}
          >
            <div className="progress-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        </div>
        <span className="num">{media.durationMs > 0 ? `-${formatClock(media.durationMs - pos)}` : "--:--"}</span>
      </div>
      <div className="media-controls">
        <button type="button" className="ctl" aria-label="Previous track" onClick={() => void ipc.mediaControl("previous")}>
          <PreviousIcon size={22} />
        </button>
        <button
          type="button"
          className="ctl ctl-main"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => void ipc.mediaControl("play_pause")}
        >
          {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </button>
        <button type="button" className="ctl" aria-label="Next track" onClick={() => void ipc.mediaControl("next")}>
          <NextIcon size={22} />
        </button>
      </div>
      <VolumeSlider className="media-volume" />
    </div>
  );
}

/** Thin line along the bottom of the compact pill showing the playback position. */
function Progress() {
  const { media } = store.use();
  useTicker(media?.status === "playing", 1000);
  if (!media || media.durationMs <= 0) return null;
  const ratio = Math.min(1, positionNow(media) / media.durationMs);
  return (
    <span className="pill-progress" aria-hidden="true">
      <i style={{ width: `${ratio * 100}%`, background: "var(--accent)" }} />
    </span>
  );
}

/** Now playing activity. Takes the pill while playing and for a few seconds after pausing. */
export const nowPlaying: ActivityModule = {
  id: "nowPlaying",
  useActivity(settings) {
    const { media, pausedAt } = store.use();
    const lingering = useUntil(pausedAt + PAUSE_LINGER_MS);
    const enabled = settings.activities.nowPlaying && !!media?.hasSession;
    const live = enabled && (media?.status === "playing" || (media?.status === "paused" && lingering));
    return {
      id: "nowPlaying",
      label: "Now playing",
      priority: 50,
      live,
      available: enabled,

      Glyph,
      Trailing: Bars,
      Title: TrackTitle,
      compactWidth: 320,
      Progress,
      Expanded,
    };
  },
};
