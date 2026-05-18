# Studio - Local Music Player

Electron + React music player built with Electron Forge and Vite.

## Prerequisites

- **Node.js** 18+ (https://nodejs.org)

## Setup & Run

```bash
cd studio-player
npm install
npm start
```

That's it. `npm start` handles everything — Vite dev server, Electron, hot reload. 
No separate terminals needed.

## Windows: yt-dlp + ffmpeg bundling

On **Windows**, `npm install` will automatically download `yt-dlp.exe` and `ffmpeg.exe`
into `bin/win-x64/` (if missing) so imports work out of the box.

If you ever want to run it manually:

```bash
npm run setup:binaries
```

Packaged Windows builds bundle `bin/win-x64/` into the installer (see `forge.config.cjs`).

## Build for Windows

```bash
npm run make
```

Creates a distributable installer in `out/`.

## Features

- Import files or folders (MP3, WAV, FLAC, OGG, M4A, AAC, etc.)
- Reads ID3 metadata and embedded cover art automatically
- Play / Pause / Next / Previous
- Shuffle and Repeat (off / all / one)
- Seekable progress bar
- Volume control with mute toggle
- Double-click any track to play
- Currently playing track highlighted in green
- Frameless window with custom title bar controls

## Discord Rich Presence

Rich Presence runs in the **Electron main process** via IPC (renderer never imports Discord RPC).
The implementation lives in `src/discordPresence.js` and is controlled by IPC channels:
`discord:connect`, `discord:setActivity`, `discord:disconnect`, `discord:status`.
