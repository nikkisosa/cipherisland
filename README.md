# CipherIsland

A small black pill that sits at the top of your Windows screen and opens up to show what's playing, the volume, battery, a timer and a few other things. It's a Windows take on the phone "dynamic island" idea, built with Tauri 2 (Rust), React and Framer Motion.

Hover it to open it. Click to keep it open. Move away, press Esc, or click elsewhere and it closes. Everything it shows is drawn from system events, so it sits at about 0.3% CPU when nothing is happening.

## What it shows

| Widget | What you get |
| --- | --- |
| Now playing | Title, artist, artwork, a seek bar, previous/play/next and a volume slider, for any app that reports to Windows media controls. The title scrolls in the closed pill while music plays. |
| Volume | A level pill for a moment when the volume changes, plus a slider and mute button in the open island. |
| Battery | A plug-in animation, and warnings at 20% and 10%. Only appears on machines with a battery. |
| Timer | Pick a length (or a preset), start, pause. The remaining time shows in the closed pill. |
| Clock and calendar | Time and date, and a month grid. The clock can also sit in the closed pill when nothing else is going on. |
| System | CPU and memory load, sampled once a second and only while that tab is open. |
| Clipboard | A short preview of text you just copied. Off by default. Anything a password manager marks as private is skipped. |
| Notifications | Mirrors Windows toasts. Off by default, and usually blocked, see [Limits](#limits). |

When more than one thing is happening, the most important one takes the pill and the next one gets a small circle beside it. Five round buttons (mute, screenshot, lock, Task Manager, settings) drop out under the island when it's open.

Four looks (Classic, Graphite, Midnight, Light) and six accent colors are in Settings, with a live preview.

## Installing a release

Download a file from the Releases page:

- `CipherIsland_<version>_x64-setup.exe` is the installer most people want.
- `CipherIsland_<version>_x64_en-US.msi` does the same for machine-wide installs and asks for admin rights.
- `CipherIsland_<version>_x64-portable.exe` is the bare app with nothing to install.

You need 64-bit Windows 10 version 1809 or newer, and the WebView2 runtime. Windows 11 and up-to-date Windows 10 already have it. The installers download it if it's missing (so they need an internet connection); the portable exe doesn't, and won't start without it. No Visual C++ redistributable is needed.

Things to know on first run:

- **SmartScreen will warn.** The files aren't code-signed. Click "More info", then "Run anyway".
- **The Notifications widget won't work.** Windows only allows it for packaged (MSIX) apps. Everything else does.
- **Keep the portable exe in one place.** "Start with Windows" registers the exe's current path, so moving or deleting it breaks auto-start.

## Requirements for building

- Windows 10 1809 or newer (the media controls API needs it). Windows 11 is what it's developed on.
- Node.js 20+
- Rust, stable, MSVC toolchain: `winget install Rustlang.Rustup`, then `rustup default stable-x86_64-pc-windows-msvc`
- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload and a Windows SDK
- The WebView2 runtime. It's already on Windows 11, and the installer fetches it on older systems.

## Getting started

```bash
npm install
npm run winland dev
```

The first run compiles the Rust side and takes a few minutes. After that, UI changes hot-reload and Rust changes rebuild on save.

`npm run winland` is just the Tauri CLI under another name, so `npm run winland build` is `tauri build`. A release build writes the installers to `src-tauri/target/release/bundle/` (`nsis/` and `msi/`) and the bare executable to `src-tauri/target/release/cipherisland.exe`.

`npm run dev` on its own serves only the UI, with no native backend. It's handy for styling: open the browser console and fire fake events, for example `__emit("audio://volume", { level: 0.4, muted: false })`. Placement, click-through, media and hover all need `npm run winland dev`.

## Using it

- **Hover** to open, **click** to pin it open, **Esc** or a click outside to close. Esc isn't swallowed, so the app in front still gets it.
- The tabs along the bottom switch widgets. A right-click on the open island gives Settings, Pause and Quit. The tray icon has the same three and works from the keyboard.
- While it's closed, clicks go through to whatever is behind it, so it never blocks a title bar or a browser tab.
- Over a web browser, hovering fades the island instead of opening it, so you can see the tabs. Hold **Ctrl** while hovering to open it anyway. Browsers it recognises: Chrome, Edge, Firefox, Brave, Opera, Vivaldi, Arc, Zen, Chromium, LibreWolf, Waterfox, Thorium. The list is in `src-tauri/src/behind.rs`.
- It hides itself while a fullscreen app or game is in front on the same monitor.

Settings has four pages: Appearance (theme, accent, docked or floating, offset), Widgets, Behavior (hover, monitor, fullscreen, start with Windows, pause) and About. They're saved with `tauri-plugin-store` to `%APPDATA%\dev.winland.cipherisland\settings.json`, and changes apply immediately.

## Project layout

```
src/                    React front end
  components/           Island, compact and expanded views, dock, menu, icons
  activities/           one file per widget, each exporting an ActivityModule
  settings/             the settings window
  styles/               tokens.css, themes.css, island.css, settings.css
src-tauri/src/          Rust back end
  window.rs             window styles, per-monitor placement, system messages
  topmost.rs            keeps the island above other windows
  clickthrough.rs       cursor polling: click-through, hover, Esc, click outside
  behind.rs             is a browser under the cursor?
  fullscreen.rs         fullscreen detection
  media.rs audio.rs battery.rs clipboard.rs notify.rs sysinfo.rs
  settings.rs tray.rs actions.rs
.github/workflows/      release workflow
```

A widget returns an `Activity` from `useActivity(settings)`: a priority, whether it wants the pill (`live`), whether it gets a tab (`available`), and three small components for the glyph, the closed-pill value and the open panel. To add one, create a file in `src/activities/`, add the id to `types.ts` and the module to the list in `index.ts`. Add a switch for it in `SettingsApp.tsx` and a field in `settings.rs` if it needs one.

## How the window works

The native window is a fixed 420 x 290 transparent canvas, and the pill is drawn inside it. Only CSS and Framer Motion move; the window itself never resizes during an animation. Details worth knowing before you change anything:

- **Placement.** Positions are worked out in physical pixels for the chosen monitor (centered on the monitor, flush with the top of its work area, or offset if docking is off). It re-places itself after display, DPI and taskbar changes.
- **No focus, no Alt+Tab.** The window has `WS_EX_NOACTIVATE` and `WS_EX_TOOLWINDOW`. The windowing layer rewrites extended styles when it toggles things, so `enforce_styles()` puts them back after every show and on a 2 second heartbeat.
- **Click-through by polling, not `SetWindowRgn`.** The pill springs and overshoots, so a window region would need rebuilding every frame and would clip the soft edge and shadow to a hard mask. Instead the front end reports its hit rectangles, and a Rust thread reads the cursor and flips `WS_EX_TRANSPARENT`. It polls at about 30 Hz near the island and about 7 Hz otherwise.
- **Hover isn't a pointer event.** A click-through window gets no pointer events, so hover comes from the same cursor loop. It uses only the drawn pill (plus the gap to the buttons below), never the larger rectangles used during animation, or the empty space around the island would reopen it.
- **Staying on top.** `SetWinEventHook` re-asserts topmost on every foreground change, with the heartbeat as a backstop.

## Releases

`.github/workflows/release.yml` builds on a Windows runner and publishes a GitHub release. There are two ways to start it:

- Push a tag: `git tag v0.1.0` then `git push origin v0.1.0`. The release uses that tag.
- Run it by hand from the Actions tab. It publishes a release tagged `v<version>`, where `version` comes from `src-tauri/tauri.conf.json`. Untick "Publish a GitHub release" to build without publishing; the files are then kept as a build artifact.

The release gets the NSIS installer, the MSI, a portable `CipherIsland_<version>_x64-portable.exe`, a `CipherIsland_<version>_x64-portable.zip` with the same exe, and `SHA256SUMS.txt`. Bump `version` in `tauri.conf.json` before releasing again; a second run with the same version updates the existing release. The files aren't code-signed, so SmartScreen will warn on first run.

If the publish step fails with a permissions error, open the repository's Settings, then Actions, then General, and set "Workflow permissions" to "Read and write permissions".

## Limits

- **Notifications.** Windows only lets an app read other apps' notifications if it has package identity (an MSIX package). This build is unpackaged, so access is normally refused (error `0x80070490`) and Settings says so. Packaging it as MSIX would fix that; it hasn't been done.
- **No keyboard navigation inside the island.** It never takes focus, so you can't Tab through it. The tray menu is the keyboard route.
- **Right-click on the closed island** reaches the app behind it, because closed means click-through. Open it first, or use the tray.
- **Elevated windows.** An app running as administrator can sit above the island; a normal process can't place a window over it.
- **Media apps differ.** Some don't publish artwork or a timeline, so you'll see a note icon or a position that doesn't move. Seeking is ignored by apps that don't support it. Artwork over 4 MB is skipped.
- Only tested on 100% display scaling and a single Windows 11 machine so far. Mixed-DPI setups are handled in code but haven't been exercised.
