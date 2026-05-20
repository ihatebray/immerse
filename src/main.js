import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } from 'electron';

// Squirrel.Windows install/update/uninstall hooks. When Squirrel runs
// any of these lifecycle events (install, first-run, update, uninstall),
// it spawns the app with a special arg like --squirrel-firstrun or
// --squirrel-updated. If we don't quit immediately on these events,
// the spawned instance hangs around and a SECOND copy of the app gets
// launched after the update — which is the "new instance opens by
// itself after the download finishes" bug.
//
// `electron-squirrel-startup` handles all four lifecycle events
// (--squirrel-install, --squirrel-updated, --squirrel-uninstall,
// --squirrel-obsolete) by creating/removing shortcuts and quitting
// the spawned process. This MUST be the first thing in main.js, before
// any IPC handlers or window code — if we don't return early, we'll
// double-launch on every install/update.
//
// In dev (`npm start`) it always returns false so this is a no-op.
// eslint-disable-next-line global-require
if (require('electron-squirrel-startup')) {
  app.quit();
  // Returning here at the top level only works under CJS bundling.
  // For ESM-style imports we explicitly skip the rest by checking
  // app.isQuitting later in createWindow if needed, but app.quit()
  // fires before anything else gets a chance to run.
}

import path from 'path';
import fs from 'fs';
import {
  ensureLibraryOpen,
  loadAllTracks,
  upsertTracks,
  removeTracksByIds,
  clearAllLibraryData,
  updateTrackMetadata,
  updateAlbumMetadata,
  loadAllPlaylists,
  loadPlaylistTrackIds,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  closeLibraryDb,
  isPlaybackPathAllowed,
  loadCachedLyrics,
  saveCachedLyrics,
  deleteCachedLyrics,
  setTrackFavorite,
  recordTrackPlay,
  loadPlayEvents,
  clearAllStats,
  loadFollowedArtistOverrides,
  addFollowedArtist,
  excludeFollowedArtist,
  clearFollowedArtistOverride,
  setItunesArtistIdForArtist,
  loadCachedReleases,
  upsertArtistReleases,
} from './libraryDb.js';
import { toolsInstalled } from './binPaths.js';
import {
  spotifyCredentialsConfigured,
  loadSpotifyCredentials,
  saveSpotifyCredentials,
  spotifySearchTracks,
  spotifySearchAlbums,
  spotifyGetAlbumTracks,
  spotifyGetTrack,
  spotifyGetArtist,
  getSpotifyAccessToken,
  // User-OAuth (PKCE) — used by the playlist endpoint, which Spotify
  // locked down for client-credentials apps in Nov 2024.
  buildAuthorizeUrl,
  generatePkcePair,
  generateOAuthState,
  exchangeAuthCode,
  loadUserToken,
  clearUserToken,
  hasUserToken,
  getValidUserToken,
  SPOTIFY_OAUTH_PORT,
} from './spotifyClient.js';
import {
  itunesSearchTracks,
  itunesSearchAlbums,
  itunesGetAlbumTracks,
  itunesCrossCheck,
} from './itunesClient.js';
import http from 'http';
import { downloadYoutubeAudioForQuery, downloadYoutubeAudioById, searchCandidatesForPicker } from './ytdlpImport.js';
import {
  loadSoulseekCredentials,
  saveSoulseekCredentials,
  soulseekCredentialsConfigured,
  soulseekStatus,
  soulseekTestConnection,
  soulseekDisconnect,
  soulseekSearch,
  soulseekDownload,
  soulseekCancelDownload,
} from './soulseekClient.js';
import { resolveCoverFilePath, mimeForCoverPath } from './coverArtStore.js';
import * as discordPresence from './discordPresence.js';
import { resolveForDiscord as resolveImgurCover } from './coverUploader.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'studio-cover',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.opus', '.webm']);

const MIME_TYPES = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma', '.opus': 'audio/opus', '.webm': 'audio/webm',
};

async function handleStudioMediaRequest(request) {
  await ensureLibraryOpen();

  let u;
  try {
    u = new URL(request.url);
  } catch {
    return new Response('Bad URL', { status: 400 });
  }

  const encoded = u.searchParams.get('path');
  if (!encoded) return new Response('Missing path', { status: 400 });

  let filePath;
  try {
    filePath = decodeURIComponent(encoded);
  } catch {
    return new Response('Bad encoding', { status: 400 });
  }

  filePath = path.normalize(filePath);
  if (!path.isAbsolute(filePath)) return new Response('Path not absolute', { status: 400 });

  if (!isPlaybackPathAllowed(filePath)) {
    return new Response('Not in library', { status: 403 });
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return new Response('Unsupported extension', { status: 403 });

  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) return new Response('Not a file', { status: 404 });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const fileSize = stat.size;
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const rangeHeader = request.headers.get('range');

  // Handle Range requests for seeking support
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const buf = Buffer.alloc(chunkSize);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buf, 0, chunkSize, start);
      } finally {
        fs.closeSync(fd);
      }

      return new Response(buf, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }

  // Full file response with Accept-Ranges so the browser knows it can seek
  const buf = fs.readFileSync(filePath);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
    },
  });
}

/** Serve cover-art images from the userData cover-cache folder. */
function handleStudioCoverRequest(request) {
  const filePath = resolveCoverFilePath(request.url);
  if (!filePath) return new Response('Bad cover URL', { status: 400 });
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) return new Response('Not a file', { status: 404 });
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const buf = fs.readFileSync(filePath);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': mimeForCoverPath(filePath),
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

let mainWindow;

/** Vite+Forge emits preload next to main (`.vite/build/preload.js`); older templates used `../preload/preload.js`. */
function resolvePreloadPath() {
  const sibling = path.join(__dirname, 'preload.js');
  const legacy = path.join(__dirname, '..', 'preload', 'preload.js');
  if (fs.existsSync(sibling)) return sibling;
  if (fs.existsSync(legacy)) return legacy;
  return sibling;
}

function createWindow() {
  // Resolve the icon from the project root so it works both in dev
  // (npm start / electron-forge dev) and in a packaged build.
  // macOS prefers .icns, Windows .ico — both fall back to .png gracefully.
  const iconPath = (() => {
    const base = app.getAppPath();
    const candidates = [
      path.join(base, 'src', 'assets', 'icon.icns'),
      path.join(base, 'src', 'assets', 'icon.ico'),
      path.join(base, 'src', 'assets', 'icon.png'),
    ];
    const fs = require('fs');
    return candidates.find((p) => fs.existsSync(p)) || candidates[2];
  })();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 776,
    minWidth: 1000,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000000',
    icon: iconPath,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // MAIN_WINDOW_VITE_DEV_SERVER_URL is set by electron-forge vite plugin
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // Auto-open devtools in dev mode, undocked to the right so the app
    // window keeps its layout.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Explicit F12 / Ctrl+Shift+I / Cmd+Option+I handler as a safety net. Some
  // Electron builds drop the default menu (which normally provides these),
  // so we re-bind them via webContents.on('before-input-event').
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    const mod = input.control || input.meta;
    if (k === 'f12' || (mod && input.shift && k === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(async () => {
  protocol.handle('studio-media', handleStudioMediaRequest);
  protocol.handle('studio-cover', handleStudioCoverRequest);
  try {
    await ensureLibraryOpen();
  } catch (e) {
    console.error('library db init failed', e);
  }
  createWindow();
  // Auto-updater: fire-and-forget. Failures here (no network, no
  // releases, bad cert) are non-fatal — the app should boot regardless.
  // Skipped entirely in dev (electron-forge start) since the updater
  // doesn't work without a packaged, signed app.
  if (app.isPackaged) {
    initAutoUpdater().catch((e) => {
      console.warn('[updater] init failed (non-fatal):', String(e?.message || e));
    });
  }
});

app.on('before-quit', () => {
  closeLibraryDb();
  // Cleanly tear down the Discord presence connection. Without this,
  // Discord may take ~30s to notice the app went away and the stale
  // "Listening to Immerse" status would linger on the user's profile.
  discordPresence.disconnect().catch(() => { /* ignore */ });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* =========================================================================
 *  Auto-updater (update-electron-app + Electron's native autoUpdater)
 *
 *  WHY this and not electron-updater:
 *  ----------------------------------
 *  electron-updater (the popular community package) requires a
 *  latest.yml manifest in the GitHub Release. That manifest is
 *  generated by electron-builder, NOT by Electron Forge — Forge uses
 *  Squirrel.Windows directly, which produces RELEASES + .nupkg files.
 *  So electron-updater + Forge = "Cannot find latest.yml" 404s forever.
 *
 *  update-electron-app is Electron's officially-supported updater for
 *  Forge-packaged apps. It uses Electron's built-in autoUpdater (which
 *  knows how to read Squirrel's RELEASES file directly) and points at
 *  GitHub via update.electronjs.org — a free proxy service Electron
 *  runs for exactly this use case. Public-repo updates work out of the
 *  box, no auth, no extra config.
 *
 *  Lifecycle:
 *    1. App boots → updateElectronApp() registers checks with native
 *       Electron autoUpdater, pointed at the update.electronjs.org
 *       proxy for our public GitHub repo.
 *    2. Auto-check fires on a regular interval (default 10min, we
 *       leave it default).
 *    3. When a newer version is available, native autoUpdater fires
 *       'update-available' → 'download-progress' → 'update-downloaded'
 *       events. We forward those to the renderer via IPC.
 *    4. The renderer shows a "Restart to install" toast on
 *       update-downloaded. Clicking it invokes 'update:install', which
 *       calls quitAndInstall().
 *
 *  IPC channels:
 *    update:checkNow      (invoke) — manual "check for updates" trigger
 *    update:install       (invoke) — restart and install the queued update
 *    update:getStatus     (invoke) — return current updater state for UI
 *    update:status        (event)  — broadcasts updater state changes
 *
 *  Renderer-facing state:
 *    { state: 'idle'|'checking'|'no-update'|'available'|'downloading'|
 *              'downloaded'|'error',
 *      version, progressPct, error }
 * ========================================================================= */

let nativeAutoUpdater = null;
let updaterInitialized = false;
let updaterStatus = { state: 'idle', version: '', progressPct: 0, error: '' };

function emitUpdaterStatus(patch) {
  updaterStatus = { ...updaterStatus, ...patch };
  try { mainWindow?.webContents.send('update:status', updaterStatus); }
  catch { /* window closed */ }
}

/**
 * True if an error from a Spotify call looks like a rate-limit (429).
 * Spotify's Dev-Mode rate-limit windows can last hours, so when we see
 * this we stop hitting Spotify and fall back to iTunes.
 */
function isRateLimitError(e) {
  const msg = String(e?.message || e || '');
  return msg.includes('429') || /rate.?limit/i.test(msg);
}

/**
 * Tell the renderer we've switched to the iTunes fallback. The UI shows
 * a toast/notice so the user understands why search or metadata is
 * coming from a different source. `reason` is 'ratelimit' or 'nocreds'.
 *
 * We debounce this so a burst of fallbacks (e.g. importing 30 playlist
 * tracks while Spotify is rate-limited) only notifies once per minute
 * rather than 30 times.
 */
let lastItunesNoticeAt = 0;
function emitItunesFallbackNotice(reason) {
  const now = Date.now();
  if (now - lastItunesNoticeAt < 60_000) return;
  lastItunesNoticeAt = now;
  try { mainWindow?.webContents.send('metadata:providerSwitched', { provider: 'itunes', reason }); }
  catch { /* window closed */ }
}

/**
 * Provider-agnostic track cross-check used by all import/download
 * paths. Tries Spotify first (if configured), falls back to iTunes
 * when Spotify isn't configured or returns a rate-limit error.
 *
 * `target` = { title, artist, album?, durationMs? }. Pass the file's
 * real decoded duration as durationMs whenever available — it's the
 * strongest signal for iTunes matching (separates the real track from
 * live/remix/edit versions sharing a title).
 *
 * Returns a track-shaped object (see spotifyClient/itunesClient) or
 * null if neither provider had a confident match.
 */
async function crossCheckMetadata(target) {
  const title = String(target?.title || '').trim();
  if (!title) return null;

  // Spotify path first, when creds exist.
  if (spotifyCredentialsConfigured()) {
    try {
      const cand = await spotifyCrossCheck(target);
      if (cand) return cand;
      // No Spotify match — fall through to iTunes as a second opinion.
    } catch (e) {
      // Any Spotify error (rate-limit, bad credentials, network) →
      // notify and fall through to iTunes. Rate-limit gets a more
      // specific reason for the toast.
      emitItunesFallbackNotice(isRateLimitError(e) ? 'ratelimit' : 'spotifyerror');
    }
  } else {
    // No Spotify creds at all → iTunes is the only option.
    emitItunesFallbackNotice('nocreds');
  }

  // iTunes fallback.
  try {
    return await itunesCrossCheck(target);
  } catch {
    return null;
  }
}

async function initAutoUpdater() {
  if (updaterInitialized) return;
  updaterInitialized = true;

  // The 'update-electron-app' package wraps Electron's built-in
  // autoUpdater with sane defaults and the update.electronjs.org
  // server config. The native autoUpdater is what reads Squirrel's
  // RELEASES file on Windows and Squirrel.Mac's metadata on macOS.
  let updateElectronApp;
  try {
    // eslint-disable-next-line global-require
    updateElectronApp = require('update-electron-app').updateElectronApp;
  } catch (e) {
    console.warn('[updater] update-electron-app not installed:', String(e?.message || e));
    return;
  }

  // Grab the native autoUpdater up front so we can wire event listeners.
  // Importing electron.autoUpdater directly (rather than through
  // update-electron-app's wrapper) gives us access to all the events
  // we want to forward to the renderer for status display.
  // eslint-disable-next-line global-require
  nativeAutoUpdater = require('electron').autoUpdater;

  nativeAutoUpdater.on('checking-for-update', () => {
    emitUpdaterStatus({ state: 'checking', error: '' });
  });
  nativeAutoUpdater.on('update-available', () => {
    // Native autoUpdater doesn't tell us the version here, only on
    // 'update-downloaded'. We surface a placeholder until then.
    emitUpdaterStatus({ state: 'available', progressPct: 0, error: '' });
  });
  nativeAutoUpdater.on('update-not-available', () => {
    emitUpdaterStatus({ state: 'no-update', progressPct: 0, error: '' });
  });
  nativeAutoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
    emitUpdaterStatus({
      state: 'downloaded',
      version: releaseName || updaterStatus.version || '',
      progressPct: 100,
      error: '',
    });
  });
  nativeAutoUpdater.on('error', (err) => {
    emitUpdaterStatus({
      state: 'error',
      error: String(err?.message || err),
    });
  });

  // Kick it off. updateElectronApp() registers the feed URL with the
  // native autoUpdater and schedules periodic checks. We pass an
  // explicit 'updateInterval' (default is 10 minutes, which is fine —
  // we don't need more aggressive than that).
  try {
    updateElectronApp({
      // The repo string can be 'owner/name' shorthand.
      repo: 'ihatebray/immerse',
      updateInterval: '1 hour',
      logger: console,
      notifyUser: false, // We handle the toast ourselves via IPC.
    });
  } catch (e) {
    console.warn('[updater] updateElectronApp() failed:', String(e?.message || e));
    emitUpdaterStatus({ state: 'error', error: String(e?.message || e) });
  }
}

ipcMain.handle('update:checkNow', async () => {
  if (!nativeAutoUpdater) {
    return { ok: false, error: 'Updater not initialized (dev mode or not packaged).' };
  }
  try {
    nativeAutoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('update:install', () => {
  if (!nativeAutoUpdater) return { ok: false, error: 'Updater not initialized.' };
  if (updaterStatus.state !== 'downloaded') {
    return { ok: false, error: 'No update is downloaded yet.' };
  }
  // quitAndInstall on the NATIVE autoUpdater triggers Squirrel's
  // update.exe to swap binaries and relaunch.
  setImmediate(() => nativeAutoUpdater.quitAndInstall());
  return { ok: true };
});

ipcMain.handle('update:getStatus', () => updaterStatus);

ipcMain.handle('app:getVersion', () => app.getVersion());

/**
 * "What's new" overlay support.
 *
 * The renderer wants to show a release-notes overlay the first time
 * an updated version launches. Two pieces of state we own here:
 *
 *   1. The "last seen" version: a single-line file at
 *      userData/last-whats-new.json that stores which version was the
 *      most recent one we showed notes for. Renderer compares this to
 *      app.getVersion() — if the running app is newer, show notes,
 *      then save the new version back here so we don't show them again
 *      on next launch.
 *
 *   2. Release notes themselves: we fetch on demand from GitHub's
 *      public REST API for the release matching the running version's
 *      tag (e.g. v1.0.3). Anonymous requests are rate-limited to 60/hr
 *      per IP but that's plenty for "first launch after an update".
 *
 * The renderer drives the policy (when to fetch, when to dismiss) —
 * this main-side code just provides the persistence + the GitHub
 * network call.
 */
function lastWhatsNewPath() {
  return path.join(app.getPath('userData'), 'last-whats-new.json');
}

ipcMain.handle('whatsnew:getLastSeen', () => {
  try {
    const raw = fs.readFileSync(lastWhatsNewPath(), 'utf8');
    const j = JSON.parse(raw);
    return { ok: true, version: String(j?.version || '') };
  } catch {
    // First launch ever, or file deleted — return empty.
    return { ok: true, version: '' };
  }
});

ipcMain.handle('whatsnew:setLastSeen', (_e, version) => {
  try {
    fs.mkdirSync(path.dirname(lastWhatsNewPath()), { recursive: true });
    fs.writeFileSync(
      lastWhatsNewPath(),
      JSON.stringify({ version: String(version || '') }),
      'utf8',
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

/**
 * Fetch the GitHub Release notes for a specific tag. Anonymous request
 * — the repo is public, no auth needed.
 *
 * The repo string is hardcoded to match the publisher config in
 * forge.config.cjs; if you fork this, update both places.
 *
 * Returns `{ ok, body, name, url, error }`. `body` is the raw markdown
 * release-notes string from GitHub. If the release doesn't exist yet
 * (e.g. user is running v1.0.3 but the release was deleted), returns
 * ok=false with a readable error.
 */
ipcMain.handle('whatsnew:fetchReleaseNotes', async (_e, version) => {
  const tag = String(version || '').trim();
  if (!tag) return { ok: false, error: 'No version provided.' };
  // The publisher tags releases as 'v<version>' (configurable via
  // tagPrefix in forge.config.cjs, default is 'v'). Strip a leading
  // 'v' if present, then prepend a fresh one — covers both 'v1.0.3'
  // and '1.0.3' callers.
  const tagName = tag.startsWith('v') ? tag : `v${tag}`;
  const url = `https://api.github.com/repos/ihatebray/immerse/releases/tags/${encodeURIComponent(tagName)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'immerse-app',
      },
    });
    if (res.status === 404) {
      return { ok: false, error: `No release found for ${tagName}.`, notFound: true };
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `GitHub API ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    return {
      ok: true,
      body: String(data.body || '').trim(),
      name: String(data.name || tagName),
      url: String(data.html_url || ''),
      publishedAt: data.published_at || null,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

/**
 * Fetch every GitHub Release for the repo, ordered newest-first.
 *
 * Used by the Settings → Update History overlay so users can flip
 * back through every version of the app. GitHub's default page size
 * is 30, which is plenty for the foreseeable future — we don't
 * paginate because hitting 30 releases would mean the app's been
 * iterating for a while and we'd want to rethink the UI by then
 * anyway.
 *
 * Returns `{ ok, releases: [...], error? }`. Each release entry has
 * `{ version, name, body, url, publishedAt, draft, prerelease }`.
 * Draft releases (not yet published) are filtered out client-side;
 * everything else (including pre-releases and known-broken old
 * versions) is included verbatim — the overlay shows them all so
 * users see the full timeline.
 */
ipcMain.handle('whatsnew:fetchAllReleases', async () => {
  const url = 'https://api.github.com/repos/ihatebray/immerse/releases?per_page=100';
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'immerse-app',
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `GitHub API ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false, error: 'Unexpected GitHub response.' };
    const releases = data
      .filter((r) => !r.draft)
      .map((r) => ({
        // Tag names like "v1.0.5" → "1.0.5" for comparison; keep the
        // raw tag too in case callers want it.
        version: String((r.tag_name || '').replace(/^v/, '')),
        tagName: String(r.tag_name || ''),
        name: String(r.name || r.tag_name || ''),
        body: String(r.body || '').trim(),
        url: String(r.html_url || ''),
        publishedAt: r.published_at || null,
        prerelease: !!r.prerelease,
      }));
    return { ok: true, releases };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

/**
 * Tutorial-seen storage. Single-line JSON file like the what's-new one
 * but tracks whether the user has dismissed the first-run tutorial.
 * Renderer reads on mount and shows the tutorial automatically the
 * first time; Settings has an "Open tutorial" button that triggers it
 * regardless of this flag.
 */
function tutorialSeenPath() {
  return path.join(app.getPath('userData'), 'tutorial-seen.json');
}

ipcMain.handle('tutorial:getSeen', () => {
  try {
    const raw = fs.readFileSync(tutorialSeenPath(), 'utf8');
    const j = JSON.parse(raw);
    return { ok: true, seen: !!j?.seen };
  } catch {
    return { ok: true, seen: false };
  }
});

ipcMain.handle('tutorial:setSeen', (_e, seen) => {
  try {
    fs.mkdirSync(path.dirname(tutorialSeenPath()), { recursive: true });
    fs.writeFileSync(
      tutorialSeenPath(),
      JSON.stringify({ seen: !!seen }),
      'utf8',
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

function newTrackId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Load Spotify CDN artwork into a data URL for library storage (same as embedded ID3 art). */
async function fetchSpotifyCoverAsDataUrl(imageUrl) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  const res = await fetch(imageUrl);
  if (!res.ok) return null;
  const ct = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  if (!ct.startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 1_500_000) return null;
  return `data:${ct};base64,${buf.toString('base64')}`;
}

/**
 * Try to extract a year from a filename. Looks for 4-digit years inside
 * parentheses or brackets — a common pattern for music releases:
 *   "Song (2018).mp3", "Album [2007] - Track 01.mp3"
 * Anywhere in the filename. Returns the first valid year (1900-2099)
 * or null.
 */
function yearFromFilename(filename) {
  if (typeof filename !== 'string') return null;
  // Look for 4 digits inside (parens) or [brackets]
  const m = filename.match(/[\(\[](\d{4})[\)\]]/);
  if (m) {
    const y = Number(m[1]);
    if (y >= 1900 && y <= 2099) return y;
  }
  // Stand-alone 4 digits surrounded by separators (e.g. "Album - 2007 -")
  const m2 = filename.match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/);
  if (m2) {
    const y = Number(m2[1]);
    if (y >= 1900 && y <= 2099) return y;
  }
  return null;
}

/**
 * Try to extract a track number from a filename. Common patterns:
 *   "01 - Title.mp3"   →  1
 *   "01. Title.mp3"    →  1
 *   "1-01 Title.mp3"   →  1   (the "01" after the disc number)
 *   "Track 5.mp3"      →  5
 * Returns null if no plausible track number can be parsed.
 */
function trackNumberFromFilename(filename) {
  if (typeof filename !== 'string') return null;
  // Strip extension
  const base = filename.replace(/\.[^.]+$/, '');
  // Disc-track form: "1-01" → take the second part
  const dt = base.match(/^\d+\s*[-_]\s*(\d{1,3})\b/);
  if (dt) {
    const n = Number(dt[1]);
    if (n > 0 && n < 999) return n;
  }
  // Leading digits at start of filename
  const lead = base.match(/^(\d{1,3})(?:[\s._-]|$)/);
  if (lead) {
    const n = Number(lead[1]);
    if (n > 0 && n < 999) return n;
  }
  // "Track NN" anywhere
  const labeled = base.match(/\btrack\s+(\d{1,3})\b/i);
  if (labeled) {
    const n = Number(labeled[1]);
    if (n > 0 && n < 999) return n;
  }
  return null;
}

/**
 * Sanity-check a track number from tags. Real track numbers are 1-999.
 * Anything outside that range is almost always corrupted ID3v1 data
 * being misread (the most common offender: ID3v1 stores track number
 * in a single byte at offset 125, but if that byte coincidentally
 * contains other data the parser will read junk like 63 (= '?' = 0x3F).
 */
function validTrackNumber(n) {
  return Number.isInteger(n) && n >= 1 && n <= 999;
}

/**
 * Pull a year out of music-metadata's `common` object, falling through
 * the various places a year might live. music-metadata's unified
 * `common.year` is the preferred source but it's only populated if
 * specific tag frames were present; many files store the year in
 * alternative locations like ORIGINALYEAR or RELEASEDATE.
 */
function resolveYearFromCommon(common) {
  // Direct year field
  if (Number.isInteger(common.year) && common.year > 1900 && common.year < 2100) {
    return common.year;
  }
  // Original year (TORY / TXXX:ORIGINALYEAR / etc.)
  if (Number.isInteger(common.originalyear) && common.originalyear > 1900 && common.originalyear < 2100) {
    return common.originalyear;
  }
  // ISO date strings: "2023-04-15" or "2023" or "2023-04"
  for (const key of ['releasedate', 'date', 'originaldate']) {
    const v = common[key];
    if (typeof v === 'string' && v.length >= 4) {
      const m = v.match(/^(\d{4})/);
      if (m) {
        const y = Number(m[1]);
        if (y > 1900 && y < 2100) return y;
      }
    }
  }
  return null;
}

/**
 * Pull a genre out of music-metadata's `common.genre`, falling through
 * to native tag frames if the unified field is empty. Strips numeric
 * ID3v1 genre codes (e.g. "(13)" prefix) so they don't appear in UI.
 */
function resolveGenreFromCommon(common) {
  const arr = Array.isArray(common.genre) ? common.genre : (common.genre ? [common.genre] : []);
  const cleaned = arr
    .map((g) => (typeof g === 'string' ? g : ''))
    // Strip leading "(NN)" — ID3v1-numeric prefixes that some tools
    // leave at the start of TCON frames during conversion.
    .map((g) => g.replace(/^\(\d+\)\s*/, '').trim())
    .filter(Boolean);
  if (cleaned.length > 0) return cleaned.join(', ');
  return '';
}

async function parseAudioFileToTrack(filePath) {
  const filename = path.basename(filePath, path.extname(filePath));
  try {
    const mm = await import('music-metadata');
    const metadata = await mm.parseFile(filePath);
    const common = metadata.common || {};

    let coverArt = null;
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      coverArt = `data:${pic.format};base64,${pic.data.toString('base64')}`;
    }

    const artistRaw = common.artist;
    const artist = Array.isArray(artistRaw) ? artistRaw.join(', ') : (artistRaw || '');

    const genre = resolveGenreFromCommon(common);
    const year = resolveYearFromCommon(common) ?? yearFromFilename(filename);

    // Track number — prefer the tag if it's sane, else fall back to
    // filename parsing. Anything outside 1-999 is rejected as corrupted
    // (the "track number = 63 for everything" issue is ID3v1 corruption).
    const tagTrack = common.track?.no;
    const trackNumber = validTrackNumber(tagTrack)
      ? tagTrack
      : trackNumberFromFilename(filename);

    const trackTotal = validTrackNumber(common.track?.of) ? common.track.of : null;
    const discNumber = validTrackNumber(common.disk?.no) ? common.disk.no : null;

    return {
      title: common.title || filename,
      artist,
      album: common.album || '',
      duration: metadata.format?.duration || 0,
      coverArt,
      filePath,
      genre,
      year: year != null ? year : null,
      trackNumber: trackNumber != null ? trackNumber : null,
      trackTotal: trackTotal != null ? trackTotal : null,
      discNumber: discNumber != null ? discNumber : null,
    };
  } catch {
    // Even on parse failure, try to derive what we can from the filename.
    return {
      title: filename,
      artist: '',
      album: '',
      duration: 0,
      coverArt: null,
      filePath,
      genre: '',
      year: yearFromFilename(filename),
      trackNumber: trackNumberFromFilename(filename),
      trackTotal: null,
      discNumber: null,
    };
  }
}

// --- IPC HANDLERS ---

/**
 * Open a URL in the user's default browser. Used by the Track tab's
 * "Open on YouTube" link and any other "send the user out of the app"
 * affordance. Validates the URL scheme so a spoofed file:// or
 * javascript: URL can't be smuggled through.
 */
ipcMain.handle('shell:openExternal', async (event, url) => {
  if (typeof url !== 'string') return { ok: false, error: 'invalid url' };
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'invalid url' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'unsafe protocol' };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

/* ---------- Discord rich presence ---------------------------------- */

ipcMain.handle('discord:connect', async (event, appId) => {
  return await discordPresence.connect(appId);
});

ipcMain.handle('discord:disconnect', async () => {
  return await discordPresence.disconnect();
});

ipcMain.handle('discord:setActivity', async (event, payload) => {
  return await discordPresence.setActivity(payload);
});

ipcMain.handle('discord:status', async () => {
  return discordPresence.status();
});

/**
 * Look up a public cover-art URL for a track when the Spotify URL isn't
 * available — for example, tracks imported back when albumArtUrl wasn't
 * populated, or tracks where Spotify's search row didn't carry an image.
 *
 * Hits iTunes Search (free, no auth, ~20 req/min limit). We search at
 * the SONG level (not album) because song rows carry artist + album +
 * title together, which lets us verify all three against the track
 * we're looking up. We only return a URL when artist, album, AND title
 * all match after normalization. Without that tight gate the API
 * happily returns "Greatest Hits", deluxe editions, karaoke versions,
 * or completely unrelated tracks with the same title, and that wrong
 * cover ends up on Discord. Better to show the fallback asset than the
 * wrong album.
 *
 * Results cached in-memory by `artist|album|title` lowercased so replay
 * doesn't re-hit the network, and misses are cached too so failures
 * aren't retried on every spin of the same song.
 *
 * Only used by the Discord-presence path. The on-disk artwork the UI
 * shows isn't affected — Discord needs a public URL its media proxy can
 * fetch, and that's a separate concern from what the library renders.
 */
const itunesArtworkCache = new Map(); // key: 'artist|album|title' lowercased → url string or null

/**
 * Normalize an artist/album/title for fuzzy equality:
 *   - lowercase
 *   - strip parentheticals (deluxe edition, remastered, feat.…)
 *   - strip "feat. X" / "ft. X" hanging off the end
 *   - drop punctuation
 *   - collapse whitespace
 *
 * The point isn't perfect string matching, it's catching the cases
 * where iTunes' record differs from Spotify's in stylistic ways that
 * shouldn't disqualify a match (e.g. "Song (feat. Artist)" vs "Song").
 */
function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')        // drop parentheticals/brackets
    .replace(/\b(feat|ft|featuring)\.?\s.+$/i, ' ')  // trailing feat. clause
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')        // strip punctuation (Unicode-safe)
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if `a` and `b` look like the same thing after normalization. */
function fuzzyEq(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Tolerate one side being a prefix of the other when both are
  // reasonably long — e.g. album "Born to Die" vs "Born to Die – The
  // Paradise Edition" should match. We DON'T allow this for the artist
  // field, because "Drake" being a prefix of "Drake Bell" would let
  // wrong artists through; the caller passes `strict: true` there.
  if (na.length >= 4 && nb.length >= 4) {
    if (na.startsWith(nb) || nb.startsWith(na)) return true;
  }
  return false;
}

ipcMain.handle('discord:lookupArtwork', async (event, query) => {
  try {
    const artist = String(query?.artist || '').trim();
    const album = String(query?.album || '').trim();
    const title = String(query?.title || '').trim();
    // Need at least artist + title to have any hope of a confident match.
    if (!artist || !title) return { ok: false, url: '' };
    const cacheKey = `${artist}|${album}|${title}`.toLowerCase();
    if (itunesArtworkCache.has(cacheKey)) {
      return { ok: true, url: itunesArtworkCache.get(cacheKey) || '' };
    }
    // Song-level search. Include artist + title in the term; iTunes
    // ranks by relevance so the right song usually comes back in the
    // first 5-10 rows. Album is left out of the query (some albums
    // have very different names on iTunes vs Spotify) but is verified
    // in the match check below.
    const term = `${artist} ${title}`.replace(/\s+/g, ' ').trim();
    const q = new URLSearchParams({
      term,
      entity: 'song',
      limit: '15',
      media: 'music',
    });
    const res = await net.fetch(`${ITUNES_API}/search?${q}`, {
      headers: { 'User-Agent': 'Immerse/1.0' },
    });
    if (!res.ok) {
      itunesArtworkCache.set(cacheKey, null);
      return { ok: false, url: '' };
    }
    const json = await res.json();
    const rows = Array.isArray(json?.results) ? json.results : [];

    // Find a row where ALL of artist + title (+ album if we have one)
    // match after normalization. Each is necessary — title alone is
    // useless (lots of "Forever"s), artist alone is useless (artists
    // re-record songs), album alone misses singles. Album is optional
    // because some tracks aren't part of an album in our library (no
    // album field) but it's the strongest signal we have when present.
    const match = rows.find((r) => {
      if (!fuzzyEq(r.artistName, artist)) return false;
      if (!fuzzyEq(r.trackName, title)) return false;
      if (album && !fuzzyEq(r.collectionName, album)) return false;
      return true;
    });

    // No confident match → cache the miss and bail. We do NOT fall back
    // to rows[0] — that's how wrong covers slip through to Discord.
    if (!match) {
      itunesArtworkCache.set(cacheKey, '');
      console.log(`[discord] no iTunes cover match for "${title}" by ${artist}${album ? ` (album: ${album})` : ''}`);
      return { ok: false, url: '' };
    }

    // iTunes URLs end in `100x100bb.jpg` — swap to 512x512 for crisp
    // covers on Discord. Discord's media proxy will fetch and rescale.
    const art100 = match.artworkUrl100 || match.artworkUrl60 || '';
    const art512 = art100
      ? art100.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/512x512bb.jpg')
      : '';
    itunesArtworkCache.set(cacheKey, art512 || '');
    if (art512) {
      console.log(`[discord] iTunes cover matched for "${title}" by ${artist}: ${match.collectionName}`);
    }
    return { ok: !!art512, url: art512 };
  } catch (e) {
    return { ok: false, url: '', error: String(e?.message || e) };
  }
});

ipcMain.handle('discord:resolveCoverUrl', async (event, { studioUrl, clientId } = {}) => {
  try {
    const url = await resolveImgurCover(String(studioUrl || ''), String(clientId || ''));
    return { ok: true, url: url || '' };
  } catch (e) {
    return { ok: false, url: '', error: String(e?.message || e) };
  }
});

ipcMain.handle('library:load', async () => loadAllTracks());

ipcMain.handle('library:addTracks', async (event, tracks) => upsertTracks(tracks));

ipcMain.handle('library:removeTracks', async (event, ids) => removeTracksByIds(Array.isArray(ids) ? ids : []));

/**
 * Clear the entire library. Two modes, selected by `deleteFiles`:
 *
 *   deleteFiles = false:
 *     Empty DB only. Audio files on disk are left alone. This is the safe
 *     default — user can re-import any folder they originally brought in.
 *
 *   deleteFiles = true:
 *     Empty DB AND move audio files to OS trash (recoverable). ONLY removes
 *     files located inside this app's `streaming-imports` folder — the place
 *     we download yt-dlp audio to. Files that the user imported from their
 *     own folders (via "+ Folder" / "+ Files") are NEVER touched, because
 *     those are the user's property. Those file paths are reported back as
 *     `skipped` so the UI can show an honest count.
 */
ipcMain.handle('library:clear', async (event, opts = {}) => {
  const deleteFiles = !!opts?.deleteFiles;
  try {
    await ensureLibraryOpen();
    const { ok, error, filePaths } = await clearAllLibraryData();
    if (!ok) return { ok: false, error: error || 'Failed to clear DB.' };

    const summary = { cleared: filePaths.length, deleted: 0, skipped: 0, failed: 0 };
    if (deleteFiles && filePaths.length) {
      // Only trash files that live inside the app's download folder. We DO
      // NOT touch user-imported files living elsewhere on disk.
      const appDownloadDir = path.join(app.getPath('userData'), 'streaming-imports');
      for (const fp of filePaths) {
        // Normalise to an absolute path so the startsWith check is reliable
        // across Windows/Mac/Linux path conventions.
        let absolute;
        try { absolute = path.resolve(fp); } catch { absolute = fp; }
        const inAppDir = absolute.startsWith(path.resolve(appDownloadDir));
        if (!inAppDir) {
          summary.skipped += 1;
          continue;
        }
        try {
          await shell.trashItem(absolute);
          summary.deleted += 1;
        } catch (e) {
          console.error('[library:clear] trashItem failed for', absolute, e?.message || e);
          summary.failed += 1;
        }
      }
    }
    return { ok: true, ...summary };
  } catch (e) {
    console.error('[library:clear]', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('library:updateTrack', async (event, { id, fields }) => {
  try {
    const summary = {};
    if (fields && typeof fields === 'object') {
      for (const k of Object.keys(fields)) {
        const v = fields[k];
        if (k === 'coverArt' && typeof v === 'string') {
          summary[k] = `${v.slice(0, 24)}…(${v.length} chars)`;
        } else {
          summary[k] = v;
        }
      }
    }
    console.log('[library:updateTrack]', id, summary);
    const r = await updateTrackMetadata(id, fields || {});
    console.log('[library:updateTrack] result:', r);
    return r;
  } catch (e) {
    console.error('[library:updateTrack] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('library:updateAlbum', async (event, { trackIds, fields }) => {
  try {
    const summary = {};
    if (fields && typeof fields === 'object') {
      for (const k of Object.keys(fields)) {
        const v = fields[k];
        if (k === 'coverArt' && typeof v === 'string') {
          summary[k] = `${v.slice(0, 24)}…(${v.length} chars)`;
        } else {
          summary[k] = v;
        }
      }
    }
    console.log('[library:updateAlbum]', (trackIds || []).length, 'tracks', summary);
    const r = await updateAlbumMetadata(trackIds || [], fields || {});
    console.log('[library:updateAlbum] result:', r);
    return r;
  } catch (e) {
    console.error('[library:updateAlbum] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

/* ---------- Favorites / notes / play tracking ---------- */

ipcMain.handle('library:setFavorite', async (event, { id, isFavorite }) => {
  try { return await setTrackFavorite(id, !!isFavorite); }
  catch (e) { console.error('[library:setFavorite] threw:', e); return { ok: false, error: String(e?.message || e) }; }
});

ipcMain.handle('library:recordPlay', async (event, id) => {
  try { return await recordTrackPlay(id); }
  catch (e) { console.error('[library:recordPlay] threw:', e); return { ok: false }; }
});

/**
 * Load play events for the Stats tab's Day/Week/Month aggregates.
 * Pass `sinceMs` to limit to events newer than that; pass 0 / nothing
 * to load the full log (capped at 100k rows in the DB helper).
 */
ipcMain.handle('library:loadPlayEvents', async (event, sinceMs) => {
  try { return await loadPlayEvents(sinceMs); }
  catch (e) { console.error('[library:loadPlayEvents] threw:', e); return []; }
});

/**
 * Reset all listening stats — zeros play_count, nulls last_played on
 * every track, and deletes every row in play_events. Used by the
 * "Reset stats" action in the Stats tab. Irreversible.
 */
ipcMain.handle('library:resetStats', async () => {
  try { return await clearAllStats(); }
  catch (e) { console.error('[library:resetStats] threw:', e); return { ok: false, error: String(e?.message || e) }; }
});

/**
 * Re-scan metadata for every track in the library — re-parse each file
 * and fill in missing/suspicious fields. Sends progress events back to
 * the renderer so a long re-scan can show a progress bar.
 *
 * "Missing/suspicious" fields:
 *   - artist / album are empty
 *   - year is null
 *   - genre is empty
 *   - trackNumber is null OR it equals 63 (the classic ID3v1 corruption
 *     value — the byte 0x3F = '?')
 *
 * Existing values that look fine are NEVER overwritten; this is purely
 * additive. If the user has hand-edited a track's metadata, their edits
 * stay.
 *
 * For each file we update via updateTrackMetadata, which validates
 * each field individually — if a single field rejects (e.g. invalid
 * track number) we just skip that field rather than failing the whole
 * track.
 */
ipcMain.handle('library:rescanMetadata', async (event) => {
  try {
    const all = await loadAllTracks();
    const sender = event.sender;
    const total = all.length;
    let scanned = 0;
    let updated = 0;
    let failed = 0;

    for (const t of all) {
      scanned += 1;
      // Send progress every track. The renderer can throttle if needed.
      try { sender.send('library:rescanProgress', { scanned, total, updated, failed }); }
      catch { /* renderer might be gone */ }

      if (!t.filePath || !fs.existsSync(t.filePath)) {
        failed += 1;
        continue;
      }

      let parsed;
      try { parsed = await parseAudioFileToTrack(t.filePath); }
      catch { failed += 1; continue; }
      if (!parsed) { failed += 1; continue; }

      // Build the update set: only include fields where the existing
      // value is clearly missing or suspicious AND the new parse
      // produced something better.
      const updates = {};

      if ((!t.artist || t.artist === 'Unknown Artist') && parsed.artist) {
        updates.artist = parsed.artist;
      }
      if ((!t.album || t.album === 'Unknown Album') && parsed.album) {
        updates.album = parsed.album;
      }
      if (!t.title && parsed.title) {
        updates.title = parsed.title;
      }
      if (t.year == null && parsed.year != null) {
        updates.year = parsed.year;
      }
      if ((!t.genre || !t.genre.trim()) && parsed.genre) {
        updates.genre = parsed.genre;
      }
      // Track number: also overwrite the classic-corruption value 63.
      const tNumIsBad = t.trackNumber == null || t.trackNumber === 63;
      if (tNumIsBad && parsed.trackNumber != null && parsed.trackNumber !== 63) {
        updates.trackNumber = parsed.trackNumber;
      }
      if (t.discNumber == null && parsed.discNumber != null) {
        updates.discNumber = parsed.discNumber;
      }

      if (Object.keys(updates).length === 0) continue;

      const r = await updateTrackMetadata(t.id, updates);
      if (r?.ok) updated += 1;
    }

    try { sender.send('library:rescanProgress', { scanned, total, updated, failed, done: true }); }
    catch { /* ignore */ }
    return { ok: true, total, updated, failed };
  } catch (e) {
    console.error('[library:rescanMetadata] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});


/* ---------- Playlists ---------- */

ipcMain.handle('playlists:load', async () => {
  try {
    return await loadAllPlaylists();
  } catch (e) {
    console.error('[playlists:load] threw:', e);
    return [];
  }
});

ipcMain.handle('playlists:loadTrackIds', async (event, playlistId) => {
  try {
    return await loadPlaylistTrackIds(playlistId);
  } catch (e) {
    console.error('[playlists:loadTrackIds] threw:', e);
    return [];
  }
});

ipcMain.handle('playlists:create', async (event, fields) => {
  try {
    const summary = { ...fields };
    if (typeof summary.coverArt === 'string') {
      summary.coverArt = `${summary.coverArt.slice(0, 24)}…(${summary.coverArt.length} chars)`;
    }
    console.log('[playlists:create]', summary);
    const r = await createPlaylist(fields || {});
    console.log('[playlists:create] result:', r);
    return r;
  } catch (e) {
    console.error('[playlists:create] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('playlists:update', async (event, { id, fields }) => {
  try {
    const summary = { ...fields };
    if (typeof summary.coverArt === 'string') {
      summary.coverArt = `${summary.coverArt.slice(0, 24)}…(${summary.coverArt.length} chars)`;
    }
    console.log('[playlists:update]', id, summary);
    const r = await updatePlaylist(id, fields || {});
    console.log('[playlists:update] result:', r);
    return r;
  } catch (e) {
    console.error('[playlists:update] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('playlists:delete', async (event, id) => {
  try {
    console.log('[playlists:delete]', id);
    const r = await deletePlaylist(id);
    console.log('[playlists:delete] result:', r);
    return r;
  } catch (e) {
    console.error('[playlists:delete] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('playlists:addTracks', async (event, { playlistId, trackIds }) => {
  try {
    console.log('[playlists:addTracks]', playlistId, (trackIds || []).length, 'tracks');
    const r = await addTracksToPlaylist(playlistId, trackIds || []);
    console.log('[playlists:addTracks] result:', r);
    return r;
  } catch (e) {
    console.error('[playlists:addTracks] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('playlists:removeTracks', async (event, { playlistId, trackIds }) => {
  try {
    console.log('[playlists:removeTracks]', playlistId, (trackIds || []).length, 'tracks');
    const r = await removeTracksFromPlaylist(playlistId, trackIds || []);
    console.log('[playlists:removeTracks] result:', r);
    return r;
  } catch (e) {
    console.error('[playlists:removeTracks] threw:', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Music',
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus', 'webm'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled) return [];

  const folderPath = result.filePaths[0];
  const audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.opus', '.webm'];
  const files = [];

  function scanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (audioExts.includes(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
      }
    } catch (e) { /* skip */ }
  }

  scanDir(folderPath);
  return files;
});

ipcMain.handle('file:getMetadata', async (event, filePath) => parseAudioFileToTrack(filePath));

ipcMain.handle('tools:getState', () => ({ installed: toolsInstalled() }));

ipcMain.handle('spotify:credsState', () => ({ configured: spotifyCredentialsConfigured() }));

ipcMain.handle('spotify:getCreds', () => loadSpotifyCredentials());

ipcMain.handle('spotify:setCreds', (event, { clientId, clientSecret }) => {
  if (!clientId || !clientSecret) return { ok: false, error: 'Client ID and Client Secret are required.' };
  saveSpotifyCredentials({ clientId: String(clientId), clientSecret: String(clientSecret) });
  return { ok: true };
});

/* =========================================================================
 *  Spotify User OAuth (PKCE)
 *
 *  Flow:
 *    1. Renderer calls 'spotify:beginUserAuth'.
 *    2. Main starts a one-shot loopback HTTP server on 127.0.0.1:8888,
 *       generates a PKCE verifier/challenge + state, opens the browser
 *       to Spotify's authorize URL, and returns.
 *    3. User logs in on accounts.spotify.com and approves. Spotify
 *       redirects their browser to http://127.0.0.1:8888/callback?code=…
 *    4. Our loopback server receives that, exchanges the code for tokens
 *       (PKCE: no Client Secret needed), saves them, replies to the
 *       browser with a small "you can close this tab" page, then shuts
 *       down. Renderer is notified via 'spotify:userAuthChanged'.
 *
 *  The server only lives for one request (or 5 minutes, whichever comes
 *  first). If the user cancels in their browser, the timeout cleans up.
 * ========================================================================= */

// Module-scoped so a second 'beginUserAuth' call while one is pending
// can cleanly tear down the previous attempt. Without this, port 8888
// would be stuck until the timeout fired.
let pendingOAuth = null;

function teardownPendingOAuth(reason = 'superseded') {
  if (!pendingOAuth) return;
  try {
    if (pendingOAuth.server?.listening) pendingOAuth.server.close();
  } catch { /* ignore */ }
  if (pendingOAuth.timer) {
    try { clearTimeout(pendingOAuth.timer); } catch { /* ignore */ }
  }
  console.log('[spotify-oauth] teardown:', reason);
  pendingOAuth = null;
}

ipcMain.handle('spotify:beginUserAuth', async () => {
  try {
    if (!spotifyCredentialsConfigured()) {
      return {
        ok: false,
        error: 'Save your Spotify Client ID and Secret first, then connect your account.',
      };
    }
    // Cancel any previous pending attempt — only one in-flight at a time.
    teardownPendingOAuth('new attempt started');

    const { verifier, challenge } = generatePkcePair();
    const state = generateOAuthState();
    const authorizeUrl = buildAuthorizeUrl({ challenge, state });

    // Start the loopback server BEFORE we open the browser. If port
    // 8888 is already in use (e.g. user has another OAuth dev tool
    // running), surface that as a clear error instead of opening
    // a browser that will fail to redirect.
    const server = http.createServer((req, res) => {
      const send = (status, html) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      };
      try {
        // Use a placeholder origin only to satisfy URL parsing — we
        // only care about the path + query.
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          send(404, '<h1>Not found</h1>');
          return;
        }
        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const errParam = url.searchParams.get('error');
        if (errParam) {
          send(400, `<h1>Spotify auth cancelled</h1><p>${errParam}</p><p>You can close this tab.</p>`);
          teardownPendingOAuth(`spotify returned error: ${errParam}`);
          mainWindow?.webContents.send('spotify:userAuthChanged', {
            connected: false, error: errParam,
          });
          return;
        }
        if (!returnedState || returnedState !== state) {
          send(400, '<h1>State mismatch</h1><p>This may be a stale or hijacked redirect. Please try again from Immerse.</p>');
          teardownPendingOAuth('state mismatch');
          return;
        }
        if (!code) {
          send(400, '<h1>Missing code</h1>');
          teardownPendingOAuth('missing code');
          return;
        }
        // Exchange asynchronously, but reply to the browser BEFORE
        // awaiting the exchange — keeps the browser snappy and avoids
        // a "this page took too long to load" if Spotify's token
        // endpoint is slow.
        send(200, `
          <!doctype html>
          <html><head><meta charset="utf-8"><title>Immerse</title>
          <style>
            body { font-family: -apple-system, system-ui, sans-serif;
                   background: #0a0a0a; color: #fff;
                   display: flex; align-items: center; justify-content: center;
                   height: 100vh; margin: 0; }
            .card { text-align: center; max-width: 360px; padding: 24px; }
            h1 { font-size: 20px; margin: 0 0 12px; color: #1db954; }
            p { font-size: 14px; color: rgba(255,255,255,0.7); margin: 8px 0; }
          </style></head>
          <body><div class="card">
            <h1>Spotify connected \u2713</h1>
            <p>You can close this tab and return to Immerse.</p>
          </div></body></html>
        `);
        // Now exchange and notify the renderer.
        exchangeAuthCode({ code, verifier })
          .then((tok) => {
            console.log('[spotify-oauth] connected as', tok.displayName || tok.userId || '(unknown)');
            mainWindow?.webContents.send('spotify:userAuthChanged', {
              connected: true,
              displayName: tok.displayName || '',
              userId: tok.userId || '',
            });
          })
          .catch((e) => {
            console.error('[spotify-oauth] exchange failed:', e);
            mainWindow?.webContents.send('spotify:userAuthChanged', {
              connected: false,
              error: String(e?.message || e),
            });
          })
          .finally(() => teardownPendingOAuth('exchange complete'));
      } catch (e) {
        send(500, '<h1>Server error</h1>');
        console.error('[spotify-oauth] handler threw:', e);
        teardownPendingOAuth('handler threw');
      }
    });

    // Bind explicitly to 127.0.0.1 (not '0.0.0.0', not 'localhost').
    // Spotify only allows loopback addresses in this exact form, and
    // 'localhost' resolves to ::1 first on some Ubuntu setups which
    // causes the browser redirect to land somewhere we're not listening.
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        if (err && err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${SPOTIFY_OAUTH_PORT} is already in use. Close whatever is using it (often another OAuth tool) and try again.`));
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(SPOTIFY_OAUTH_PORT, '127.0.0.1');
    });

    // 5-minute safety timer — if the user wanders off or denies the
    // request silently, the server doesn't sit forever holding the port.
    const timer = setTimeout(() => {
      console.warn('[spotify-oauth] timed out waiting for callback');
      teardownPendingOAuth('timeout');
      mainWindow?.webContents.send('spotify:userAuthChanged', {
        connected: false, error: 'Authorization timed out. Please try again.',
      });
    }, 5 * 60 * 1000);

    pendingOAuth = { server, timer, verifier, state };

    // Open the user's default browser. Don't await — shell.openExternal
    // resolves only after the OS confirms it dispatched the URL, which
    // is fine, but on Linux it can be slow if xdg-open has to figure
    // out the default browser. We catch failures via the .catch below.
    shell.openExternal(authorizeUrl).catch((e) => {
      console.error('[spotify-oauth] openExternal failed:', e);
      teardownPendingOAuth('openExternal failed');
      mainWindow?.webContents.send('spotify:userAuthChanged', {
        connected: false,
        error: 'Could not open your browser. Copy this URL manually: ' + authorizeUrl,
      });
    });

    return { ok: true };
  } catch (e) {
    teardownPendingOAuth('beginUserAuth threw');
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('spotify:userAuthState', () => {
  const tok = loadUserToken();
  if (!tok) return { connected: false };
  return {
    connected: true,
    displayName: tok.displayName || '',
    userId: tok.userId || '',
    expiresAt: tok.expiresAt || 0,
    scope: tok.scope || '',
  };
});

ipcMain.handle('spotify:disconnectUser', () => {
  clearUserToken();
  // Notify renderer so the UI updates immediately even if the user has
  // multiple Settings panes open or whatever.
  mainWindow?.webContents.send('spotify:userAuthChanged', { connected: false });
  return { ok: true };
});

/**
 * Return the connected user's playlists (owned + followed). Used by the
 * Find tab's playlist picker. Requires the user OAuth token — the
 * client-credentials flow cannot read user-scoped endpoints.
 *
 * Paginates at 50/page (Spotify max for this endpoint). Returns up to
 * 500 playlists, which is plenty for any normal user.
 */
ipcMain.handle('spotify:getMyPlaylists', async () => {
  try {
    const token = await getValidUserToken();
    if (!token) {
      return {
        ok: false,
        error: 'Connect your Spotify account in Settings first.',
        needsAuth: true,
      };
    }
    const all = [];
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
    let pageCount = 0;
    while (url && pageCount < 10) { // 10 pages * 50 = 500 playlists cap
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        if (r.status === 401) {
          // Token went stale between getValidUserToken and the call.
          // Clear it so the next attempt forces a reconnect rather
          // than silently retrying with a dead token.
          clearUserToken();
          return { ok: false, error: 'Your Spotify session expired. Reconnect in Settings.', needsAuth: true };
        }
        return { ok: false, error: `Spotify /me/playlists error ${r.status}: ${txt.slice(0, 200)}` };
      }
      const data = await r.json();
      const items = Array.isArray(data.items) ? data.items : [];
      for (const p of items) {
        if (!p?.id) continue;
        all.push({
          id: p.id,
          name: p.name || 'Untitled',
          description: p.description || '',
          owner: p.owner?.display_name || p.owner?.id || '',
          ownerId: p.owner?.id || '',
          // Cover image: pick smallest (third image, typically 60-64px)
          // for picker thumbnails when present, otherwise fall back to
          // the largest. May be empty for brand-new playlists with no
          // tracks (Spotify generates covers from track art).
          imageUrl: p.images?.[2]?.url || p.images?.[1]?.url || p.images?.[0]?.url || '',
          // Total tracks: post-Feb-2026 lives under `items.total`;
          // pre-Feb apps still get `tracks.total`. Read either.
          totalTracks: p.items?.total ?? p.tracks?.total ?? 0,
          collaborative: !!p.collaborative,
          public: p.public !== false,
          spotifyUrl: p.external_urls?.spotify || '',
        });
      }
      url = data.next || null;
      pageCount++;
    }
    return { ok: true, playlists: all };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('spotify:search', async (event, query) => {
  const q = String(query || '').trim();
  if (!q) return [];
  // Spotify first when configured; iTunes fallback on ANY Spotify
  // error (rate-limit, bad credentials, network) or missing creds. The
  // renderer is notified via metadata:providerSwitched so it can show
  // "now searching iTunes" to the user.
  if (spotifyCredentialsConfigured()) {
    try {
      const r = await spotifySearchTracks(q);
      if (Array.isArray(r) && r.length) return r;
      // Empty result — try iTunes as a second opinion rather than
      // returning nothing.
      const it = await itunesSearchTracks(q);
      return it.length ? it : r;
    } catch (e) {
      emitItunesFallbackNotice(isRateLimitError(e) ? 'ratelimit' : 'spotifyerror');
      return itunesSearchTracks(q);
    }
  }
  emitItunesFallbackNotice('nocreds');
  return itunesSearchTracks(q);
});

ipcMain.handle('spotify:searchAlbums', async (event, query) => {
  const q = String(query || '').trim();
  if (!q) return [];
  if (spotifyCredentialsConfigured()) {
    try {
      const r = await spotifySearchAlbums(q);
      if (Array.isArray(r) && r.length) return r;
      const it = await itunesSearchAlbums(q);
      return it.length ? it : r;
    } catch (e) {
      emitItunesFallbackNotice(isRateLimitError(e) ? 'ratelimit' : 'spotifyerror');
      return itunesSearchAlbums(q);
    }
  }
  emitItunesFallbackNotice('nocreds');
  return itunesSearchAlbums(q);
});

ipcMain.handle('spotify:albumTracks', async (event, albumId) => {
  const id = String(albumId || '').trim();
  if (!id) return { album: '', artists: '', albumArtUrl: '', tracks: [] };
  // iTunes albums carry an "itunes:" prefix on their ID (set in
  // itunesSearchAlbums) so we can route them to the iTunes lookup
  // endpoint instead of Spotify's album endpoint.
  if (id.startsWith('itunes:')) {
    return itunesGetAlbumTracks(id.slice('itunes:'.length));
  }
  return spotifyGetAlbumTracks(id);
});

// Session-scoped caches for Spotify enrichment lookups. When the user
// imports a whole album (or re-runs an album sync), every track shares
// the same album metadata and most share the same primary artist —
// caching these avoids hammering Spotify with redundant requests.
// All maps are reset on process restart; that's fine because they're a
// network optimization, not state we need to persist.
const spotifyTrackCache = new Map();   // trackId  → mapped track row or null
const spotifyArtistCache = new Map();  // artistId → mapped artist row or null

async function getCachedSpotifyTrack(trackId) {
  if (!trackId) return null;
  if (spotifyTrackCache.has(trackId)) return spotifyTrackCache.get(trackId);
  const data = await spotifyGetTrack(trackId);
  spotifyTrackCache.set(trackId, data);
  return data;
}

async function getCachedSpotifyArtist(artistId) {
  if (!artistId) return null;
  if (spotifyArtistCache.has(artistId)) return spotifyArtistCache.get(artistId);
  const data = await spotifyGetArtist(artistId);
  spotifyArtistCache.set(artistId, data);
  return data;
}

/**
 * Normalize a Spotify-style ISO release-date string ("2023-04-15",
 * "2023-04", or "2023") into a 4-digit year. Returns null when the
 * input doesn't carry one.
 */
function yearFromReleaseDate(s) {
  if (typeof s !== 'string' || s.length < 4) return null;
  const m = s.match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y >= 1000 && y <= 9999 ? y : null;
}

/**
 * Pick a single primary genre from Spotify's artist.genres list. Spotify
 * returns broad descriptors like ["pop punk", "emo", "metalcore"] — we
 * take the first one (Spotify's primary classification) and title-case
 * it for display. Returns '' when the list is empty.
 *
 * Title case for "pop punk" → "Pop Punk", "rap" → "Rap", "dance pop"
 * → "Dance Pop". Common lowercased connectors like "and" stay lowercase.
 */
function pickPrimaryGenre(genres) {
  if (!Array.isArray(genres) || genres.length === 0) return '';
  const raw = String(genres[0] || '').trim();
  if (!raw) return '';
  const connectors = new Set(['and', 'of', 'the', 'a', 'an']);
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (i > 0 && connectors.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

ipcMain.handle('import:fromSpotifyYoutube', async (event, meta) => {
  try {
    await ensureLibraryOpen();
    /** Library metadata comes from the Spotify / iTunes search row. yt-dlp
     *  gives us the audio bytes only — no track numbers, no album position.
     *  The search row is the authoritative source for those, and we
     *  enrich it via /v1/tracks + /v1/artists when fields are missing. */
    const title = String(meta?.title || '').trim();
    const artists = String(meta?.artists || '').trim();
    const album = String(meta?.album || '').trim();
    const albumArtUrl = String(meta?.albumArtUrl || '').trim();
    const durationMs = Number(meta?.durationMs);
    const spotifyIdRaw = String(meta?.spotifyId || '').trim();
    // The releases-from-iTunes path uses synthetic IDs like "itunes:12345";
    // only treat as a real Spotify ID when no protocol prefix is present.
    const realSpotifyId = spotifyIdRaw && !spotifyIdRaw.includes(':') ? spotifyIdRaw : '';

    // Position, year, genre, explicit — read caller-supplied first; if
    // any are missing AND we have a real Spotify ID, enrich from the
    // Spotify track + artist endpoints. Enrichment is best-effort: a
    // network failure leaves the field null instead of blocking import.
    let trackNumber = Number.isFinite(Number(meta?.trackNumber)) && Number(meta.trackNumber) > 0
      ? Number(meta.trackNumber) : null;
    let discNumber = Number.isFinite(Number(meta?.discNumber)) && Number(meta.discNumber) > 0
      ? Number(meta.discNumber) : null;
    let explicitMeta = typeof meta?.explicit === 'boolean' ? meta.explicit : null;
    let year = (() => {
      const y = Number(meta?.year);
      return Number.isFinite(y) && y >= 1000 && y <= 9999 ? Math.floor(y) : null;
    })();
    let genre = typeof meta?.genre === 'string' ? meta.genre.trim() : '';

    const needsEnrichment = !!realSpotifyId && (
      trackNumber == null
      || discNumber == null
      || explicitMeta == null
      || year == null
      || !genre
    );
    if (needsEnrichment) {
      try {
        const enriched = await getCachedSpotifyTrack(realSpotifyId);
        if (enriched) {
          if (trackNumber == null && enriched.trackNumber) trackNumber = enriched.trackNumber;
          if (discNumber == null && enriched.discNumber) discNumber = enriched.discNumber;
          if (explicitMeta == null) explicitMeta = enriched.explicit;
          if (year == null) year = yearFromReleaseDate(enriched.releaseDate);
          if (!genre && enriched.primaryArtistId) {
            const artistData = await getCachedSpotifyArtist(enriched.primaryArtistId);
            genre = pickPrimaryGenre(artistData?.genres);
          }
        }
      } catch (e) {
        console.log('[import] spotify enrichment failed (non-fatal):', String(e?.message || e));
      }
    }

    if (!title) return { ok: false, error: 'Missing title.' };
    const targetDurationSec = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
    const filePath = await downloadYoutubeAudioForQuery({
      artists: artists || 'Unknown Artist',
      title,
      targetDurationSec,
      expectedExplicit: explicitMeta,
    });
    const parsed = await parseAudioFileToTrack(filePath);
    const durationFromFile = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : 0;
    const durationFromSpotify = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
    const duration = durationFromFile > 0 ? durationFromFile : durationFromSpotify;

    let coverStored = null;
    if (albumArtUrl) {
      try {
        coverStored = (await fetchSpotifyCoverAsDataUrl(albumArtUrl)) || albumArtUrl;
      } catch {
        coverStored = albumArtUrl;
      }
    }

    // Genre fallback: if Spotify gave us nothing AND yt-dlp tagged the
    // file (usually with "Music" — YouTube's default category), prefer
    // empty over the meaningless default. The user can fill it later
    // from the metadata editor.
    const fileGenre = String(parsed.genre || '').trim();
    const useFileGenre = !genre && fileGenre && fileGenre.toLowerCase() !== 'music';

    const track = {
      id: newTrackId(),
      filePath: parsed.filePath,
      duration,
      title,
      artist: artists || 'Unknown Artist',
      album: album || 'Unknown Album',
      // Keep a remote URL for Discord RPC dynamic artwork when available.
      // UI artwork still uses coverArt (which may be a stored data URL).
      coverArtUrl: albumArtUrl || coverStored,
      coverArt: coverStored,
      // Position fields: Spotify is authoritative, fall back to whatever
      // the (probably empty) yt-dlp file tags carried.
      trackNumber: trackNumber != null ? trackNumber : (parsed.trackNumber ?? null),
      discNumber: discNumber != null ? discNumber : (parsed.discNumber ?? null),
      // Year: Spotify's release_date is authoritative. yt-dlp's date
      // tag is the upload date or some uploader's guess, which is
      // frequently wrong. Only use the file's year if Spotify gave us
      // nothing.
      year: year != null ? year : (parsed.year ?? null),
      // Genre: Spotify artist genre is the most reliable signal. If
      // Spotify came up empty AND the file tag isn't the meaningless
      // YouTube default, fall back to the file tag.
      genre: genre || (useFileGenre ? fileGenre : ''),
      explicit: explicitMeta,
    };
    const res = await upsertTracks([track]);
    if (!res.ok) return { ok: false, error: res.error || 'Could not save to library.' };
    return { ok: true, track };
  } catch (e) {
    // If yt-dlp's tier matching rejected everything, surface the candidates
    // so the renderer can pop the manual-pick modal. e.candidates is set by
    // ytdlpImport.js when it throws a 'no-tier-match' error.
    if (e?.code === 'no-tier-match' && Array.isArray(e?.candidates)) {
      return {
        ok: false,
        code: 'no-tier-match',
        error: String(e?.message || e),
        candidates: e.candidates,
      };
    }
    return { ok: false, error: String(e?.message || e) };
  }
});

/**
 * Import a track from a specific YouTube video ID, bypassing tier matching.
 * Used by the manual-pick modal: when an automatic import fails and the
 * user picks one of the surfaced candidates, we call this with the video ID
 * plus the original Spotify/iTunes metadata (so the imported track gets
 * the right title, artist, album art, track number, explicit flag, etc.).
 */
/**
 * Search YouTube for candidates without downloading. Used when the
 * "Always show video picker" setting is on — every import opens the picker
 * first regardless of whether tier matching would have succeeded.
 */
ipcMain.handle('youtube:searchCandidates', async (event, { artists, title, customQuery } = {}) => {
  try {
    const cleanCustom = String(customQuery || '').trim();
    // Either a default search (artists+title required) or a custom query
    // (just the query string). Custom takes precedence when provided.
    if (!cleanCustom && !title) return { ok: false, error: 'Missing title.' };
    const candidates = await searchCandidatesForPicker({
      artists: String(artists || '').trim(),
      title: String(title || '').trim(),
      customQuery: cleanCustom,
    });
    return { ok: true, candidates };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('import:fromYoutubeId', async (event, { videoId, meta } = {}) => {
  try {
    if (!videoId || typeof videoId !== 'string') {
      return { ok: false, error: 'Missing video ID.' };
    }
    await ensureLibraryOpen();
    const title = String(meta?.title || '').trim();
    const artists = String(meta?.artists || '').trim();
    const album = String(meta?.album || '').trim();
    const albumArtUrl = String(meta?.albumArtUrl || '').trim();
    const durationMs = Number(meta?.durationMs);
    const spotifyIdRaw = String(meta?.spotifyId || '').trim();
    const realSpotifyId = spotifyIdRaw && !spotifyIdRaw.includes(':') ? spotifyIdRaw : '';

    // Same enrichment pattern as import:fromSpotifyYoutube — see comment
    // there for the rationale. The two handlers diverge only in HOW the
    // audio is downloaded (search-query vs explicit video ID); the
    // metadata pipeline is identical.
    let trackNumber = Number.isFinite(Number(meta?.trackNumber)) && Number(meta.trackNumber) > 0
      ? Number(meta.trackNumber) : null;
    let discNumber = Number.isFinite(Number(meta?.discNumber)) && Number(meta.discNumber) > 0
      ? Number(meta.discNumber) : null;
    let explicitMeta = typeof meta?.explicit === 'boolean' ? meta.explicit : null;
    let year = (() => {
      const y = Number(meta?.year);
      return Number.isFinite(y) && y >= 1000 && y <= 9999 ? Math.floor(y) : null;
    })();
    let genre = typeof meta?.genre === 'string' ? meta.genre.trim() : '';

    const needsEnrichment = !!realSpotifyId && (
      trackNumber == null
      || discNumber == null
      || explicitMeta == null
      || year == null
      || !genre
    );
    if (needsEnrichment) {
      try {
        const enriched = await getCachedSpotifyTrack(realSpotifyId);
        if (enriched) {
          if (trackNumber == null && enriched.trackNumber) trackNumber = enriched.trackNumber;
          if (discNumber == null && enriched.discNumber) discNumber = enriched.discNumber;
          if (explicitMeta == null) explicitMeta = enriched.explicit;
          if (year == null) year = yearFromReleaseDate(enriched.releaseDate);
          if (!genre && enriched.primaryArtistId) {
            const artistData = await getCachedSpotifyArtist(enriched.primaryArtistId);
            genre = pickPrimaryGenre(artistData?.genres);
          }
        }
      } catch (e) {
        console.log('[import] spotify enrichment failed (non-fatal):', String(e?.message || e));
      }
    }

    if (!title) return { ok: false, error: 'Missing title.' };

    const filePath = await downloadYoutubeAudioById(videoId);
    const parsed = await parseAudioFileToTrack(filePath);
    const durationFromFile = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : 0;
    const durationFromSpotify = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
    const duration = durationFromFile > 0 ? durationFromFile : durationFromSpotify;

    let coverStored = null;
    if (albumArtUrl) {
      try {
        coverStored = (await fetchSpotifyCoverAsDataUrl(albumArtUrl)) || albumArtUrl;
      } catch {
        coverStored = albumArtUrl;
      }
    }

    const fileGenre = String(parsed.genre || '').trim();
    const useFileGenre = !genre && fileGenre && fileGenre.toLowerCase() !== 'music';

    const track = {
      id: newTrackId(),
      filePath: parsed.filePath,
      duration,
      title,
      artist: artists || 'Unknown Artist',
      album: album || 'Unknown Album',
      // Keep a remote URL for Discord RPC dynamic artwork when available.
      // UI artwork still uses coverArt (which may be a stored data URL).
      coverArtUrl: albumArtUrl || coverStored,
      coverArt: coverStored,
      trackNumber: trackNumber != null ? trackNumber : (parsed.trackNumber ?? null),
      discNumber: discNumber != null ? discNumber : (parsed.discNumber ?? null),
      year: year != null ? year : (parsed.year ?? null),
      genre: genre || (useFileGenre ? fileGenre : ''),
      explicit: explicitMeta,
    };
    await upsertTracks([track]);
    return { ok: true, track };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

/* =========================================================================
 *  Soulseek integration
 *
 *  Handlers exposed to the renderer for the Soulseek tab:
 *    soulseek:credsState  — { configured }
 *    soulseek:getCreds    — { username, password }
 *    soulseek:setCreds    — persist creds
 *    soulseek:status      — { state, configured, error }
 *    soulseek:test        — proactively open the connection
 *    soulseek:disconnect  — drop the connection
 *    soulseek:search      — { ok, results, albums }
 *    soulseek:download    — single-file download + Spotify metadata cross-check
 *    soulseek:downloadAlbum — multi-file sequential download (same user/folder)
 *    soulseek:cancelDownload — cancel an in-flight download (real cancel,
 *                              destroys the stream)
 *
 *  Progress events stream back on 'soulseek:downloadProgress':
 *    { id, state: 'downloading'|'done'|'failed',
 *      bytes, totalBytes, pct, throughputBps, error?, track?, label? }
 *
 *  For album downloads, progress is per-track keyed by the track's row id,
 *  plus an aggregate 'soulseek:albumProgress' event with overall %.
 *
 *  Metadata Cross-Check
 *  --------------------
 *  After a Soulseek file lands, we parse its embedded tags. If Spotify
 *  credentials are configured, we then search Spotify for "title + artist"
 *  and, if there's a confident match, overwrite our metadata with
 *  Spotify's canonical values (title, artist, album, year, track number,
 *  cover art). Tags from a random Soulseek share are often wrong, partial,
 *  or formatted weirdly; Spotify gives consistent metadata across the
 *  library. If Spotify isn't configured or doesn't match, we keep the
 *  embedded tags.
 * ========================================================================= */

// Throttle progress emissions per-download. Every chunk that arrives
// fires onProgress, which on a fast download (1MB/s+) can be 30-100
// events per second. That floods IPC and forces React to re-evaluate
// memoization shallow-compares constantly. We rate-limit to ~5/sec per
// download, which is visually identical for a progress bar (the human
// eye doesn't notice the difference past ~10 Hz) and ~95% less render
// work. Terminal states ('done' / 'failed') always pass through
// immediately — they're rare and the renderer needs them to update
// button labels.
const lastProgressEmitAt = new Map(); // id → last emit timestamp
const PROGRESS_EMIT_INTERVAL_MS = 200;

function emitSoulseekProgress(payload) {
  if (payload && payload.id && payload.state === 'downloading') {
    const now = Date.now();
    const last = lastProgressEmitAt.get(payload.id) || 0;
    if (now - last < PROGRESS_EMIT_INTERVAL_MS) return;
    lastProgressEmitAt.set(payload.id, now);
  } else if (payload && payload.id) {
    // Terminal state — clear the throttle entry. Lets a subsequent
    // restart of the same row download cleanly.
    lastProgressEmitAt.delete(payload.id);
  }
  try {
    mainWindow?.webContents.send('soulseek:downloadProgress', payload);
  } catch { /* window may be closed */ }
}

function emitSoulseekAlbumProgress(payload) {
  try {
    mainWindow?.webContents.send('soulseek:albumProgress', payload);
  } catch { /* window may be closed */ }
}

ipcMain.handle('soulseek:credsState', () => ({ configured: soulseekCredentialsConfigured() }));
ipcMain.handle('soulseek:getCreds', () => loadSoulseekCredentials());
ipcMain.handle('soulseek:setCreds', (event, { username, password }) => {
  if (!username || !password) {
    return { ok: false, error: 'Username and password are required.' };
  }
  saveSoulseekCredentials({ username: String(username), password: String(password) });
  return { ok: true };
});
ipcMain.handle('soulseek:status', () => soulseekStatus());
ipcMain.handle('soulseek:test', async () => soulseekTestConnection());
ipcMain.handle('soulseek:disconnect', () => soulseekDisconnect());

/* ---------- Album art lookup ----------
 *
 * Soulseek's search protocol doesn't return cover art. To render real
 * album thumbnails in the search results, we batch-look-up Spotify for
 * each unique album in the results. Caching by (artist + name) keeps
 * repeated searches fast and avoids burning the Spotify rate limit
 * (~180 req/min on free tier).
 *
 * The handler takes a list of { key, query } pairs where `key` is an
 * opaque identifier the renderer uses to match results back, and
 * `query` is what to look up (typically the album folder name).
 *
 * Returns { artByKey: { [key]: imageUrl | null } }. Misses (no match
 * found, or Spotify not configured) come back as null so the renderer
 * keeps its gradient placeholder.
 */

const albumArtCache = new Map(); // normalized query → imageUrl | null
const ALBUM_ART_CACHE_MAX = 500;

function normalizeForArtCache(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

ipcMain.handle('soulseek:fetchAlbumArt', async (event, queries) => {
  const result = { artByKey: {} };
  if (!Array.isArray(queries) || !queries.length) return result;
  if (!spotifyCredentialsConfigured()) {
    // Fill all keys with null so the renderer knows we tried.
    for (const q of queries) {
      if (q?.key) result.artByKey[q.key] = null;
    }
    return result;
  }

  // Sequential rather than parallel: Spotify rate-limits at ~180 req/min,
  // and the user is waiting for the UI to update. 10 sequential lookups
  // at ~150ms each is ~1.5s total, which beats running into a 429 and
  // having to retry the whole batch.
  for (const q of queries) {
    if (!q?.key) continue;
    const queryText = String(q.query || '').trim();
    if (!queryText) {
      result.artByKey[q.key] = null;
      continue;
    }
    const cacheKey = normalizeForArtCache(queryText);
    if (albumArtCache.has(cacheKey)) {
      result.artByKey[q.key] = albumArtCache.get(cacheKey);
      continue;
    }
    try {
      const albums = await spotifySearchAlbums(queryText);
      const top = Array.isArray(albums) && albums.length ? albums[0] : null;
      const url = top?.albumArtUrl || null;
      // Trim cache before inserting if full. Simple FIFO — not LRU,
      // but good enough at this scale.
      if (albumArtCache.size >= ALBUM_ART_CACHE_MAX) {
        const firstKey = albumArtCache.keys().next().value;
        albumArtCache.delete(firstKey);
      }
      albumArtCache.set(cacheKey, url);
      result.artByKey[q.key] = url;
    } catch {
      // Any Spotify error (auth, rate limit, network) — return null for
      // this key and continue with the others. We don't cache failures
      // since they might be transient.
      result.artByKey[q.key] = null;
    }
  }
  return result;
});

ipcMain.handle('soulseek:search', async (event, query) => {
  try {
    const q = String(query || '').trim();
    if (!q) return { ok: true, results: [], albums: [] };
    const { results, albums } = await soulseekSearch(q, { filter: true });
    return { ok: true, results, albums };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('soulseek:cancelDownload', (event, id) => {
  const ok = soulseekCancelDownload(String(id || ''));
  return { ok };
});

/* ---------- Helpers for metadata cross-check ---------- */

/** Trivial string normalisation for fuzzy comparison. */
function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')   // drop (feat. ...) and [Bonus Track] noise
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Try to match a parsed audio file against Spotify. Returns the canonical
 * metadata if confident, else null. Confidence rules: normalised title
 * must be a substring of (or equal to) the Spotify track's normalised
 * title in either direction, AND the artist must overlap (one of our
 * artist tokens appears in their artist tokens, or vice versa).
 *
 * Among matching candidates, prefer one with `explicit: true`. This
 * matters because Spotify often returns BOTH versions of a song (the
 * original explicit and a clean radio edit) and the renderer's logic
 * used to stop at the first hit — which was often the radio edit,
 * causing songs the user definitely has the explicit version of to
 * end up flagged clean. Bias toward explicit, since:
 *   1. Most pirated/downloaded files are the explicit version (radio
 *      edits are rarer in the wild).
 *   2. The "explicit" flag in the library is intended as a *capability
 *      indicator* ("this song exists with explicit content") rather
 *      than a per-file confirmation. Marking E for a song that has an
 *      explicit version is correct in the common case.
 *
 * If Spotify isn't configured or the search errors, returns null silently.
 */
async function spotifyCrossCheck({ title, artist, album }) {
  if (!spotifyCredentialsConfigured()) return null;
  const titleQ = (title || '').trim();
  const artistQ = (artist || '').trim();
  if (!titleQ) return null;

  // Build a Spotify search. Prefer "track + artist" since title-only
  // matches return too many cover versions.
  const q = artistQ ? `${titleQ} ${artistQ}` : titleQ;
  let candidates;
  try {
    candidates = await spotifySearchTracks(q);
  } catch (e) {
    // Re-throw rate-limit errors so callers (e.g. the rescan loop) can
    // back off explicitly. Every other error is "this track couldn't
    // be looked up" and should fall through to null — we don't want to
    // bail the entire rescan because one track had a weird title.
    const msg = String(e?.message || e);
    if (msg.includes('429')) throw e;
    return null;
  }
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const myTitle = normalizeTitle(titleQ);
  const myArtist = normalizeTitle(artistQ);
  const myArtistTokens = new Set(myArtist.split(' ').filter(Boolean));

  // Collect EVERY matching candidate (within the top 5), not just the
  // first. Then pick: explicit-version preferred, otherwise the first
  // match.
  const matches = [];
  for (const cand of candidates.slice(0, 5)) {
    const candTitle = normalizeTitle(cand.title || cand.name || '');
    const candArtist = normalizeTitle(cand.artists || cand.artist || '');
    const candArtistTokens = new Set(candArtist.split(' ').filter(Boolean));
    if (!candTitle) continue;

    const titleMatches = candTitle === myTitle
      || candTitle.includes(myTitle)
      || myTitle.includes(candTitle);
    if (!titleMatches) continue;

    // Artist overlap check. Skip if we had no artist tag and the title
    // is short (too risky to match without artist).
    let artistMatches = !artistQ;
    if (!artistMatches) {
      for (const t of myArtistTokens) {
        if (t.length >= 3 && candArtistTokens.has(t)) { artistMatches = true; break; }
      }
      if (!artistMatches) {
        for (const t of candArtistTokens) {
          if (t.length >= 3 && myArtistTokens.has(t)) { artistMatches = true; break; }
        }
      }
    }
    if (!artistMatches) continue;

    matches.push(cand);
  }

  if (matches.length === 0) return null;

  // Prefer the explicit version when multiple candidates pass.
  const explicitMatch = matches.find((c) => c.explicit === true);
  if (explicitMatch) return explicitMatch;

  // Otherwise fall back to the first match (preserves prior behavior
  // for songs where no explicit version exists).
  return matches[0];
}

/**
 * Run a downloaded Soulseek file through the full save pipeline:
 *   parse tags → optional Spotify cross-check → assemble track → upsert.
 * Returns { ok, track } on success.
 */
async function ingestSoulseekFile({ downloadedPath, originalFilename }) {
  const parsed = await parseAudioFileToTrack(downloadedPath);
  const duration = typeof parsed.duration === 'number' && parsed.duration > 0
    ? parsed.duration : 0;

  // Filename fallback for missing tags.
  const filenameFallback = (originalFilename || path.basename(downloadedPath))
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[\s.\-_]+/, '')
    .replace(/[_]+/g, ' ')
    .trim();

  let title = (parsed.title || '').trim() || filenameFallback || 'Unknown Title';
  let artist = (parsed.artist || '').trim() || 'Unknown Artist';
  let album = (parsed.album || '').trim() || 'Unknown Album';
  let trackNumber = parsed.trackNumber ?? null;
  let discNumber = parsed.discNumber ?? null;
  let year = parsed.year ?? null;
  let coverArt = parsed.coverArt || null;
  let coverArtUrl = parsed.coverArtUrl || null;
  // Explicit flag. Read from the file's own tags first, but Soulseek-
  // sourced MP3/FLAC almost never has a usable explicit tag (ID3 has
  // no standard frame for it). The Spotify cross-check below overrides
  // this with the canonical answer per download — that's cheap (one
  // API call already running for cover/metadata anyway) and avoids
  // requiring the user to mark every soulseek download manually.
  //
  // The bulk rescan that hit Spotify per library track is gone (it was
  // the rate-limit risk in v1.0.5); manual control via the metadata
  // editor handles anything the cross-check misses.
  let explicit = typeof parsed.explicit === 'boolean' ? parsed.explicit : null;

  // Metadata cross-check. Tries Spotify first, falls back to iTunes
  // when Spotify is unconfigured or rate-limited. We pass the file's
  // real decoded duration — it's the strongest signal for the iTunes
  // matcher (separates the real track from live/remix versions).
  try {
    const cand = await crossCheckMetadata({
      title, artist, album,
      durationMs: duration > 0 ? Math.round(duration * 1000) : undefined,
    });
    if (cand) {
      title = (cand.title || cand.name || title).trim();
      artist = (cand.artists || cand.artist || artist).trim();
      album = (cand.album || album).trim();
      if (cand.trackNumber != null) trackNumber = cand.trackNumber;
      if (cand.discNumber != null) discNumber = cand.discNumber;
      if (cand.year != null) year = cand.year;
      // Explicit flag from whichever provider matched. Spotify gives a
      // boolean; iTunes gives true/false/null. Files almost never carry
      // a usable explicit tag of their own, so the provider value wins
      // when present.
      if (typeof cand.explicit === 'boolean') explicit = cand.explicit;
      const art = cand.albumArtUrl || cand.imageUrl;
      if (art) {
        const dataUrl = await fetchSpotifyCoverAsDataUrl(art);
        if (dataUrl) { coverArt = dataUrl; coverArtUrl = art; }
      }
    }
  } catch {
    // Cross-check is best-effort; never let it block a save.
  }

  const track = {
    id: newTrackId(),
    filePath: parsed.filePath,
    duration,
    title,
    artist,
    album,
    coverArt,
    coverArtUrl,
    trackNumber,
    discNumber,
    year,
    genre: parsed.genre || '',
    explicit,
  };

  const res = await upsertTracks([track]);
  if (!res.ok) return { ok: false, error: res.error || 'Could not save to library.' };
  return { ok: true, track };
}

/* ---------- Single-file download ---------- */

ipcMain.handle('soulseek:download', async (event, params = {}) => {
  const id = String(params.id || '');
  const user = String(params.user || '').trim();
  const filePath = String(params.filePath || '');
  const size = Number(params.size) || 0;
  const filename = String(params.filename || '').trim();

  if (!user || !filePath) {
    return { ok: false, error: 'Missing user or file path.' };
  }

  const outDir = path.join(app.getPath('userData'), 'streaming-imports');

  try {
    await ensureLibraryOpen();
    emitSoulseekProgress({ id, state: 'downloading', pct: 0, throughputBps: 0 });

    const downloadedPath = await soulseekDownload({
      id,
      user,
      filePath,
      size,
      outDir,
      onProgress: ({ bytes, totalBytes, pct, throughputBps }) => {
        emitSoulseekProgress({ id, state: 'downloading', bytes, totalBytes, pct, throughputBps });
      },
    });

    const ingest = await ingestSoulseekFile({ downloadedPath, originalFilename: filename });
    if (!ingest.ok) {
      emitSoulseekProgress({ id, state: 'failed', error: ingest.error });
      return { ok: false, error: ingest.error };
    }
    emitSoulseekProgress({ id, state: 'done', pct: 1, track: ingest.track });
    return { ok: true, track: ingest.track };
  } catch (e) {
    const msg = String(e?.message || e);
    emitSoulseekProgress({ id, state: 'failed', error: msg });
    return { ok: false, error: msg };
  }
});

/* ---------- Album download ---------- */

ipcMain.handle('soulseek:downloadAlbum', async (event, params = {}) => {
  const albumId = String(params.albumId || '');
  const tracks = Array.isArray(params.tracks) ? params.tracks : [];
  if (!albumId || !tracks.length) {
    return { ok: false, error: 'Missing album info.' };
  }

  const outDir = path.join(app.getPath('userData'), 'streaming-imports');

  try {
    await ensureLibraryOpen();
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  const total = tracks.length;
  let completed = 0;
  const successes = [];
  const failures = [];

  emitSoulseekAlbumProgress({
    albumId, state: 'downloading', completed: 0, total,
    currentFile: tracks[0]?.filename || '',
  });

  // Sequential download. Going parallel within a single Soulseek user
  // doesn't help (peers cap per-connection bandwidth, not total) and
  // increases the chance of "no slots" rejections mid-album.
  for (const t of tracks) {
    const id = String(t.id || '');
    const user = String(t.user || '').trim();
    const filePath = String(t.filePath || '');
    if (!user || !filePath) {
      failures.push({ id, error: 'Missing user or file path.' });
      completed++;
      emitSoulseekAlbumProgress({ albumId, state: 'downloading', completed, total, currentFile: t.filename || '' });
      continue;
    }

    emitSoulseekProgress({ id, state: 'downloading', pct: 0, throughputBps: 0 });
    emitSoulseekAlbumProgress({
      albumId, state: 'downloading', completed, total,
      currentFile: t.filename || soulseekBasenameLocal(filePath),
    });

    try {
      const downloadedPath = await soulseekDownload({
        id,
        user,
        filePath,
        size: Number(t.size) || 0,
        outDir,
        onProgress: ({ bytes, totalBytes, pct, throughputBps }) => {
          emitSoulseekProgress({ id, state: 'downloading', bytes, totalBytes, pct, throughputBps });
        },
      });
      const ingest = await ingestSoulseekFile({
        downloadedPath,
        originalFilename: t.filename || '',
      });
      if (ingest.ok) {
        successes.push(ingest.track);
        emitSoulseekProgress({ id, state: 'done', pct: 1, track: ingest.track });
      } else {
        failures.push({ id, error: ingest.error });
        emitSoulseekProgress({ id, state: 'failed', error: ingest.error });
      }
    } catch (e) {
      const msg = String(e?.message || e);
      failures.push({ id, error: msg });
      emitSoulseekProgress({ id, state: 'failed', error: msg });
      // If this track failed because the user went offline, don't keep
      // hammering — bail the rest of the album.
      if (/offline|unreach|not exist/i.test(msg)) {
        emitSoulseekAlbumProgress({
          albumId, state: 'failed', completed, total,
          error: `User went offline mid-album. ${successes.length} of ${total} tracks saved.`,
        });
        return {
          ok: successes.length > 0,
          tracks: successes,
          failures,
          partial: true,
          error: `User went offline. Got ${successes.length} of ${total} tracks.`,
        };
      }
    }
    completed++;
  }

  emitSoulseekAlbumProgress({
    albumId, state: 'done', completed, total,
    successCount: successes.length, failCount: failures.length,
  });
  return {
    ok: successes.length > 0,
    tracks: successes,
    failures,
    partial: failures.length > 0,
  };
});

// Local copy of soulseekBasename — soulseekClient exports it but it's
// only used in error messages here, and re-importing it pollutes the
// top-of-file. Mini duplicate is fine.
function soulseekBasenameLocal(p) {
  const norm = String(p || '').replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

/* =========================================================================
 *  Spotify playlist import
 *
 *  Two handlers:
 *    spotify:fetchPlaylist  — parse a URL/ID, fetch metadata + track list
 *                             from Spotify, return shape ready for review
 *    playlist:importBatch   — loop through a chosen track list, importing
 *                             each via the existing yt-dlp pipeline or
 *                             Soulseek search. Emits progress on
 *                             'playlist:importProgress' channel.
 *
 *  Conflict detection happens BEFORE import starts: we check the library
 *  for existing tracks with the same title+artist and return them to the
 *  renderer for review. The user can then choose to skip / redownload /
 *  selectively import on a per-track basis from the renderer side.
 *
 *  We don't create an Immerse playlist on the user's behalf — they just
 *  end up with N new tracks in their library. The renderer can offer a
 *  playlist-creation affordance separately if desired.
 * ========================================================================= */

/**
 * Parse a Spotify playlist URL or raw ID, return the 22-char playlist ID
 * or null if not parseable. Accepts:
 *   - https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   - https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc
 *   - spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
 *   - 37i9dQZF1DXcBWIGoYBM5M (raw ID)
 */
function parseSpotifyPlaylistId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  // Already a bare 22-char base62 ID
  if (/^[a-zA-Z0-9]{22}$/.test(s)) return s;
  // URL form
  const urlMatch = s.match(/playlist[/:]([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  return null;
}

ipcMain.handle('spotify:fetchPlaylist', async (event, input) => {
  try {
    if (!spotifyCredentialsConfigured()) {
      return { ok: false, error: 'Spotify is not configured. Add Client ID and Secret in Settings.' };
    }
    const playlistId = parseSpotifyPlaylistId(input);
    if (!playlistId) {
      return { ok: false, error: 'Could not parse a Spotify playlist URL or ID from your input.' };
    }
    // Prefer the user OAuth token if available — the /v1/playlists/{id}/tracks
    // endpoint was locked down for client-credentials apps in Nov 2024 and
    // now 403s. We fall back to client-credentials only if no user token is
    // stored, so the user gets a helpful "connect your Spotify account"
    // error rather than a silent 403.
    let token = null;
    let usingUserToken = false;
    if (hasUserToken()) {
      token = await getValidUserToken();
      usingUserToken = !!token;
    }
    if (!token) {
      token = await getSpotifyAccessToken();
    }

    // Country/market parameter. Spotify enforces market restrictions
    // on playlist contents — without a market hint, playlists where
    // every track is region-locked will 403. Client-credentials tokens
    // don't support `from_token`, so we hardcode 'US' as the broadest
    // catalog. If the user's specific playlist still 403s with US,
    // it's a genuinely region-locked playlist and we surface that.
    const MARKET = 'US';

    // Fetch playlist metadata (name, owner, image).
    // Note: as of the Feb 2026 dev-mode changes, the `tracks` field on
    // the playlist metadata response was renamed to `items`. The old
    // `tracks(total)` still works for Extended Quota apps but returns
    // nothing for new dev-mode apps, so we ask for both and read
    // whichever comes back populated.
    const metaUrl = new URL(`https://api.spotify.com/v1/playlists/${playlistId}`);
    metaUrl.searchParams.set('fields', 'name,description,owner(display_name),images,items(total),tracks(total)');
    metaUrl.searchParams.set('market', MARKET);
    const metaRes = await fetch(metaUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      const txt = await metaRes.text().catch(() => '');
      if (metaRes.status === 404) {
        return { ok: false, error: 'Playlist not found. Make sure the URL is correct and the playlist is public.' };
      }
      if (metaRes.status === 403) {
        if (!usingUserToken) {
          return {
            ok: false,
            error: 'Spotify blocked access (403). Reading playlist contents requires a user login \u2014 open Settings \u2192 Spotify API and click "Connect Spotify account", then try again.',
          };
        }
        return {
          ok: false,
          error: 'Spotify blocked access (403). As of Feb 2026, you can only fetch playlists you own or collaborate on. Pick one of yours from the list, not someone else\'s.',
        };
      }
      return { ok: false, error: `Spotify API error ${metaRes.status}: ${txt.slice(0, 200)}` };
    }
    const meta = await metaRes.json();

    // Fetch the playlist's items (formerly "tracks"). Spotify paginates
    // at 100 per page; we loop until we have everything. For huge
    // playlists (1000+ tracks) this could take ~5-10 requests but the
    // user probably wants to know what they're importing before we
    // proceed.
    //
    // Important shape notes (Feb 2026):
    //   - Endpoint renamed from /playlists/{id}/tracks → /playlists/{id}/items.
    //   - Each playlist-item's payload field was renamed `track` → `item`;
    //     the legacy `track` field still appears in Extended Quota responses
    //     and is marked deprecated. We read `item` first, then `track`.
    //   - is_local lives on the PLAYLIST-ITEM wrapper (item.is_local),
    //     NOT on the inner track. Putting it inside item(...) makes
    //     Spotify return an empty items array.
    //   - The fields filter is sent via URLSearchParams so parens and
    //     commas are encoded correctly.
    //   - market=US is required to avoid 403s on region-restricted
    //     playlists.
    const tracks = [];
    const fieldsParam = 'items(is_local,item(id,name,artists(name),album(name,images,release_date),duration_ms,explicit,track_number,disc_number),track(id,name,artists(name),album(name,images,release_date),duration_ms,explicit,track_number,disc_number)),next';
    const firstUrl = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/items`);
    firstUrl.searchParams.set('limit', '50');
    firstUrl.searchParams.set('fields', fieldsParam);
    firstUrl.searchParams.set('market', MARKET);
    let next = firstUrl.toString();
    let pageCount = 0;
    while (next && pageCount < 40) { // safety cap at 2000 tracks (50/page * 40)
      const r = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        // First-page failure surfaces to the user; later-page failures
        // just stop pagination and return what we have so far.
        if (pageCount === 0) {
          if (r.status === 403) {
            return {
              ok: false,
              error: 'Spotify blocked access to this playlist\'s contents (403). Dev-mode apps can only read playlists owned by or collaborated with the connected user. Pick one of your own playlists.',
            };
          }
          return { ok: false, error: `Spotify items API error ${r.status}: ${txt.slice(0, 200)}` };
        }
        break;
      }
      const data = await r.json();
      const items = Array.isArray(data.items) ? data.items : [];
      for (const wrap of items) {
        // is_local is on the wrapper, NOT the inner track. Skip
        // user-uploaded local files with no streamable Spotify
        // metadata.
        if (wrap?.is_local) continue;
        // Read the new `item` field first; fall back to legacy `track`
        // for Extended Quota apps that still return the pre-Feb-2026
        // shape.
        const t = wrap?.item || wrap?.track;
        if (!t || !t.id) continue;
        tracks.push({
          spotifyId: t.id,
          title: t.name || '',
          artists: (t.artists || []).map((a) => a.name).filter(Boolean).join(', '),
          album: t.album?.name || '',
          albumArtUrl: t.album?.images?.[0]?.url || '',
          releaseDate: t.album?.release_date || '',
          durationMs: t.duration_ms || 0,
          explicit: t.explicit ?? null,
          trackNumber: t.track_number ?? null,
          discNumber: t.disc_number ?? null,
        });
      }
      next = data.next || null;
      pageCount++;
    }

    return {
      ok: true,
      playlist: {
        id: playlistId,
        name: meta.name || 'Untitled playlist',
        description: meta.description || '',
        owner: meta.owner?.display_name || '',
        imageUrl: meta.images?.[0]?.url || '',
        totalTracks: meta.items?.total ?? meta.tracks?.total ?? tracks.length,
        tracks,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

/**
 * Detect tracks in the import batch that already exist in the library.
 * Matching is fuzzy on normalized title+artist — this catches the
 * "I have this song already" case across Spotify ID changes, slight
 * spelling variations, etc.
 */
async function findLibraryConflicts(tracks) {
  await ensureLibraryOpen();
  // Pull the library's title+artist pairs once, build a set for O(1)
  // lookup. Re-use the same normalization the rest of the app uses
  // (lower-case, alpha-num only).
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const allTracks = await loadAllTracks();
  const existing = new Map(); // normKey → libraryTrack
  for (const t of allTracks) {
    const key = `${normalize(t.title)}||${normalize(t.artist)}`;
    if (!existing.has(key)) existing.set(key, t);
  }
  const conflicts = [];
  for (const t of tracks) {
    const key = `${normalize(t.title)}||${normalize(t.artists)}`;
    const match = existing.get(key);
    if (match) {
      conflicts.push({ spotifyId: t.spotifyId, existingId: match.id, title: t.title, artist: t.artists });
    }
  }
  return conflicts;
}

ipcMain.handle('playlist:detectConflicts', async (event, tracks) => {
  try {
    if (!Array.isArray(tracks) || !tracks.length) return { ok: true, conflicts: [] };
    const conflicts = await findLibraryConflicts(tracks);
    return { ok: true, conflicts };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

function emitPlaylistProgress(payload) {
  try { mainWindow?.webContents.send('playlist:importProgress', payload); } catch { /* window closed */ }
}

/**
 * Import a batch of tracks. `source` is either 'ytdlp' (default — use
 * the existing yt-dlp pipeline) or 'soulseek' (search Soulseek, take
 * the top result, download). Sequential — parallel imports would
 * thrash yt-dlp's rate limiting and saturate the Soulseek server
 * connection.
 *
 * Emits per-track 'playlist:importProgress' events:
 *   { spotifyId, state: 'starting'|'done'|'failed'|'skipped', error? }
 *
 * Returns a summary at the end:
 *   { ok, completed, failed, skipped, importedTracks }
 */
ipcMain.handle('playlist:importBatch', async (event, params = {}) => {
  const tracks = Array.isArray(params.tracks) ? params.tracks : [];
  const source = params.source === 'soulseek' ? 'soulseek' : 'ytdlp';
  if (!tracks.length) return { ok: false, error: 'No tracks to import.' };

  const completed = [];
  const failed = [];
  const skipped = [];

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.skip) {
      skipped.push({ spotifyId: t.spotifyId, reason: 'User chose to skip (conflict).' });
      emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'skipped', index: i, total: tracks.length });
      continue;
    }
    emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'starting', index: i, total: tracks.length });

    try {
      if (source === 'soulseek') {
        // Soulseek path: search for "artist title", take the best
        // result, download via the existing soulseekDownload helper.
        // We can't reuse the IPC handler directly (would re-emit
        // soulseek progress events into the renderer), so we use the
        // underlying function.
        const q = `${t.artists} ${t.title}`.trim();
        const searchRes = await soulseekSearch(q, { filter: true });
        const best = Array.isArray(searchRes?.results) ? searchRes.results[0] : null;
        if (!best) {
          failed.push({ spotifyId: t.spotifyId, error: 'No Soulseek match found.' });
          emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'failed', error: 'No Soulseek match', index: i, total: tracks.length });
          continue;
        }
        const outDir = path.join(app.getPath('userData'), 'streaming-imports');
        const downloadedPath = await soulseekDownload({
          user: best.user, filePath: best.filePath, size: best.size, outDir,
        });
        const parsed = await parseAudioFileToTrack(downloadedPath);
        const duration = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : 0;
        let coverStored = null;
        if (t.albumArtUrl) {
          try { coverStored = (await fetchSpotifyCoverAsDataUrl(t.albumArtUrl)) || t.albumArtUrl; }
          catch { coverStored = t.albumArtUrl; }
        }
        // Explicit flag from the Spotify playlist data. If Spotify
        // didn't supply one (null), try the cross-check (which falls
        // back to iTunes) using the file's real duration to disambiguate
        // versions. This catches tracks Spotify left unflagged.
        let plExplicit = typeof t.explicit === 'boolean' ? t.explicit : null;
        if (plExplicit === null) {
          try {
            const cand = await crossCheckMetadata({
              title: t.title || parsed.title || '',
              artist: t.artists || parsed.artist || '',
              album: t.album || parsed.album || '',
              durationMs: duration > 0 ? Math.round(duration * 1000) : undefined,
            });
            if (cand && typeof cand.explicit === 'boolean') plExplicit = cand.explicit;
          } catch { /* leave null */ }
        }
        const track = {
          id: newTrackId(),
          filePath: parsed.filePath,
          duration,
          title: t.title || (parsed.title || ''),
          artist: t.artists || (parsed.artist || 'Unknown Artist'),
          album: t.album || (parsed.album || 'Unknown Album'),
          coverArt: coverStored || parsed.coverArt || null,
          coverArtUrl: t.albumArtUrl || null,
          trackNumber: t.trackNumber ?? null,
          discNumber: t.discNumber ?? null,
          year: t.releaseDate ? Number((t.releaseDate || '').slice(0, 4)) || null : null,
          genre: parsed.genre || '',
          explicit: plExplicit,
        };
        const res = await upsertTracks([track]);
        if (!res.ok) {
          failed.push({ spotifyId: t.spotifyId, error: res.error || 'Could not save.' });
          emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'failed', error: res.error, index: i, total: tracks.length });
          continue;
        }
        completed.push(track);
        emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'done', track, index: i, total: tracks.length });
      } else {
        // yt-dlp path: invoke the existing import:fromSpotifyYoutube
        // handler synchronously via its underlying logic. To avoid
        // duplicating that whole 100-line block here, we just trigger
        // the same code path by calling it.
        //
        // ipcMain.invoke isn't exposed for the main process to call
        // its own handlers — so we replicate the import logic
        // directly. (It's only ~30 lines; cleaner than refactoring.)
        const realSpotifyId = (t.spotifyId || '').trim();
        const title = (t.title || '').trim();
        const artists = (t.artists || '').trim();
        const album = (t.album || '').trim();
        const albumArtUrl = (t.albumArtUrl || '').trim();
        const durationMs = Number(t.durationMs) || 0;

        if (!title) {
          failed.push({ spotifyId: t.spotifyId, error: 'Track has no title.' });
          emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'failed', error: 'No title', index: i, total: tracks.length });
          continue;
        }
        const targetDurationSec = durationMs > 0 ? durationMs / 1000 : 0;
        let filePath;
        try {
          filePath = await downloadYoutubeAudioForQuery({
            artists: artists || 'Unknown Artist',
            title,
            targetDurationSec,
            expectedExplicit: typeof t.explicit === 'boolean' ? t.explicit : null,
          });
        } catch (dlErr) {
          // YouTube auto-match failed. Fetch search candidates so the
          // user can pick one manually from the failures-review UI
          // after the batch completes. The candidate fetch is best-effort
          // — if THAT also fails (e.g. network died), we just record an
          // empty array and the user gets a manual "paste URL" fallback
          // in the picker modal.
          let candidates = [];
          try {
            candidates = await searchCandidatesForPicker({
              artists: artists || 'Unknown Artist',
              title,
            });
          } catch {
            /* empty array */
          }
          const errMsg = String(dlErr?.message || dlErr || 'YouTube match failed');
          // Meta payload mirrors what import:fromYoutubeId expects so
          // the renderer can hand it straight to the picker modal
          // without re-shaping.
          const pickerMeta = {
            spotifyId: realSpotifyId || null,
            title,
            artists: artists || 'Unknown Artist',
            album,
            albumArtUrl: albumArtUrl || '',
            durationMs,
            explicit: typeof t.explicit === 'boolean' ? t.explicit : null,
            trackNumber: t.trackNumber ?? null,
            discNumber: t.discNumber ?? null,
            year: t.releaseDate ? Number((t.releaseDate || '').slice(0, 4)) || null : null,
          };
          failed.push({
            spotifyId: t.spotifyId,
            error: errMsg,
            candidates,
            meta: pickerMeta,
          });
          emitPlaylistProgress({
            spotifyId: t.spotifyId,
            state: 'failed',
            error: errMsg,
            candidates,
            meta: pickerMeta,
            index: i,
            total: tracks.length,
          });
          continue;
        }
        const parsed = await parseAudioFileToTrack(filePath);
        const durationFromFile = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : 0;
        const duration = durationFromFile > 0 ? durationFromFile : targetDurationSec;
        let coverStored = null;
        if (albumArtUrl) {
          try { coverStored = (await fetchSpotifyCoverAsDataUrl(albumArtUrl)) || albumArtUrl; }
          catch { coverStored = albumArtUrl; }
        }
        const track = {
          id: newTrackId(),
          filePath: parsed.filePath,
          duration,
          title,
          artist: artists || 'Unknown Artist',
          album: album || 'Unknown Album',
          coverArt: coverStored,
          coverArtUrl: albumArtUrl || null,
          trackNumber: t.trackNumber ?? null,
          discNumber: t.discNumber ?? null,
          year: t.releaseDate ? Number((t.releaseDate || '').slice(0, 4)) || null : null,
          genre: parsed.genre || '',
          explicit: typeof t.explicit === 'boolean' ? t.explicit : null,
          spotifyId: realSpotifyId || null,
        };
        const res = await upsertTracks([track]);
        if (!res.ok) {
          failed.push({ spotifyId: t.spotifyId, error: res.error || 'Could not save.' });
          emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'failed', error: res.error, index: i, total: tracks.length });
          continue;
        }
        completed.push(track);
        emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'done', track, index: i, total: tracks.length });
      }
    } catch (e) {
      const msg = String(e?.message || e);
      failed.push({ spotifyId: t.spotifyId, error: msg });
      emitPlaylistProgress({ spotifyId: t.spotifyId, state: 'failed', error: msg, index: i, total: tracks.length });
    }
  }

  return {
    ok: true,
    completed: completed.length,
    failed: failed.length,
    skipped: skipped.length,
    importedTracks: completed,
    failures: failed,
    skips: skipped,
  };
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

/** In-memory lyrics cache keyed by "artist|title" — hot layer over persistent DB. */
const lyricsCache = new Map();

ipcMain.handle('lyrics:fetch', async (event, { title, artist, album, duration, provider, force } = {}) => {
  try {
    const cacheKey = `${(artist || '').toLowerCase().trim()}|${(title || '').toLowerCase().trim()}`;

    // The "force" flag bypasses both caches and clears any stale entry,
    // ensuring the next fetch goes all the way out to LRClib/Genius.
    // Used by the renderer's "Refetch lyrics" affordance to recover
    // from junky cached results (e.g. the Genius "Contributors" leak
    // that was cached before the scraper was fixed).
    if (force) {
      lyricsCache.delete(cacheKey);
      try {
        await ensureLibraryOpen();
        await deleteCachedLyrics(cacheKey);
      } catch { /* ignore — we'll just refetch anyway */ }
    } else {
      // 1) In-memory hot cache (survives within session)
      if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

      // 2) Persistent DB cache (survives across restarts)
      await ensureLibraryOpen();
      const dbCached = await loadCachedLyrics(cacheKey);
      if (dbCached) {
        const hit = { ok: true, ...dbCached };
        lyricsCache.set(cacheKey, hit);
        return hit;
      }
    }

    // 3) Network fetch — accuracy-first strategy
    const headers = { 'User-Agent': 'Immersive Music Player v1.0 (https://github.com/immersive)' };

    // Per-request timeout wrapper. Without this, a slow LRClib or
    // Genius response can block the whole fetch chain — we've seen
    // 20-second total fetch times in the wild because each upstream
    // stage waits indefinitely. The default is generous (10s) since
    // LRClib's search endpoint can legitimately take 4-7s on a cold
    // fuzzy query; individual call sites can override per-stage.
    const fetchWithTimeout = (url, opts = {}, ms = 10000) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      return net.fetch(url, { ...opts, signal: ctrl.signal })
        .finally(() => clearTimeout(timer));
    };
    const fmt = (r) => ({
      ok: true,
      syncedLyrics: r.syncedLyrics || null,
      plainLyrics: r.plainLyrics || null,
      instrumental: !!r.instrumental,
      source: r.__source || 'lrclib',
    });
    const none = { ok: true, syncedLyrics: null, plainLyrics: null, instrumental: false };

    const normalizeStr = (s) => (s || '')
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')        // strip parenthetical (Live), [Remastered], etc.
      .replace(/feat\.?|featuring|ft\.?/gi, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    /**
     * Score a result for how well its (title, artist, duration) matches what
     * we asked for. Higher score = better match. Returns 0 if it fails the
     * basic sanity checks (likely a totally different song).
     *
     *   - Title equality is the dominant signal. Loose substring matching is
     *     dangerous because "Love" matches "Love Me Now". We require either
     *     exact normalized equality OR mutual word-set containment with at
     *     least 80% word overlap.
     *   - Artist must share at least one significant word with what we asked
     *     for. Single short words like "the" don't count.
     *   - Duration within 5s = +3, within 15s = +1, > 30s away = -2 penalty.
     */
    const scoreMatch = (r) => {
      if (!r) return 0;
      const rTitle = normalizeStr(r.trackName || r.name || '');
      const rArtist = normalizeStr(r.artistName || r.artist || '');
      const qTitle = normalizeStr(title);
      const qArtist = normalizeStr(artist);
      if (!rTitle || !qTitle) return 0;

      // Title check — exact equality is the strongest signal
      let titleScore = 0;
      if (rTitle === qTitle) {
        titleScore = 10;
      } else {
        // Word-set check — what fraction of one's words appear in the other?
        const rWords = new Set(rTitle.split(' ').filter((w) => w.length > 2));
        const qWords = new Set(qTitle.split(' ').filter((w) => w.length > 2));
        if (qWords.size === 0 || rWords.size === 0) return 0;
        let overlap = 0;
        for (const w of qWords) if (rWords.has(w)) overlap += 1;
        const ratio = overlap / Math.max(qWords.size, rWords.size);
        if (ratio < 0.7) return 0;             // titles too different
        titleScore = Math.round(ratio * 8);
      }

      // Artist check — must share at least one significant (≥3 char) word
      let artistScore = 0;
      if (qArtist) {
        const rArtistWords = new Set(rArtist.split(' ').filter((w) => w.length >= 3));
        const qArtistWords = qArtist.split(' ').filter((w) => w.length >= 3);
        const hasOverlap = qArtistWords.some((w) => rArtistWords.has(w));
        if (!hasOverlap) return 0;             // wrong artist, reject outright
        artistScore = 3;
      }

      // Duration sanity
      let durationScore = 0;
      const rDur = Number(r.duration) || 0;
      const qDur = Number(duration) || 0;
      if (qDur > 0 && rDur > 0) {
        const diff = Math.abs(rDur - qDur);
        if (diff <= 5) durationScore = 3;
        else if (diff <= 15) durationScore = 1;
        else if (diff > 30) durationScore = -2;  // probably wrong version
      }

      // Bonus for having synced lyrics — a synced match is more useful
      const syncedBonus = r.syncedLyrics ? 2 : 0;

      return titleScore + artistScore + durationScore + syncedBonus;
    };

    /**
     * LRClib's /api/get expects exact metadata. Returns the canonical result
     * if present, otherwise null.
     */
    const tryLrclibExact = async () => {
      try {
        const p = new URLSearchParams();
        if (title) p.set('track_name', String(title));
        if (artist) p.set('artist_name', String(artist));
        if (album) p.set('album_name', String(album));
        if (typeof duration === 'number' && duration > 0) p.set('duration', String(Math.round(duration)));
        const res = await fetchWithTimeout(`https://lrclib.net/api/get?${p}`, { headers }, 10000);
        if (!res.ok) return null;
        const data = await res.json();
        if (data && (data.syncedLyrics || data.plainLyrics)) {
          return { ...data, __source: 'lrclib' };
        }
        return null;
      } catch { return null; }
    };

    /**
     * LRClib's /api/search returns up to 30 results. We score each, take the
     * best one, and reject if even the best doesn't pass the threshold.
     * Threshold: ≥ 8 (a typical good match scores 12-18; a bad one scores 0-3).
     */
    const tryLrclibSearch = async (q) => {
      try {
        const res = await fetchWithTimeout(`https://lrclib.net/api/search?${new URLSearchParams({ q })}`, { headers }, 10000);
        if (!res.ok) return null;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return null;
        const scored = data.map((r) => ({ r, score: scoreMatch(r) }));
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best || best.score < 8) return null;
        return { ...best.r, __source: 'lrclib' };
      } catch { return null; }
    };

    /**
     * Genius fallback — plain lyrics only, no sync. Uses the public search
     * endpoint (no API key required for read access). We only fetch a song
     * page if its title/artist clearly match what we asked for.
     *
     * Note: Genius scrapes lyrics from a rendered page, which is brittle and
     * slower than LRClib. We only invoke this when LRClib finds nothing AND
     * the user explicitly opted in via the provider setting.
     */
    const tryGenius = async () => {
      try {
        const q = `${artist || ''} ${title || ''}`.trim();
        if (!q) return null;
        const searchUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(q)}`;
        const sres = await fetchWithTimeout(searchUrl, { headers }, 5000);
        if (!sres.ok) return null;
        const sjson = await sres.json();
        const sections = sjson?.response?.sections || [];
        const songSection = sections.find((s) => s.type === 'song');
        const hits = songSection?.hits || [];
        if (!hits.length) return null;

        // Score each hit, take the best
        const scored = hits.map((h) => {
          const r = {
            trackName: h.result?.title,
            artistName: h.result?.primary_artist?.name,
            duration: 0,                        // Genius doesn't expose duration
            plainLyrics: null,                  // we'll fetch the page if this wins
          };
          return { r, score: scoreMatch(r), url: h.result?.url };
        });
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best || best.score < 6 || !best.url) return null;

        // Fetch the song page and extract lyrics. Genius wraps lyrics
        // in one or more <div data-lyrics-container="true">…</div>
        // blocks. There are usually 2-3 of these per page (verse/chorus
        // groups), and they each contain nested <div>s for section
        // headers like "[Verse 1]". A naive non-greedy regex would cut
        // off at the first nested </div>, so we extract by walking the
        // HTML and counting div depth.
        const pageRes = await fetchWithTimeout(best.url, { headers }, 6000);
        if (!pageRes.ok) return null;
        const html = await pageRes.text();

        // Find every lyrics-container opening tag, then for each one
        // walk forward through the HTML counting <div> opens and
        // </div> closes until depth returns to 0 — that's the matching
        // close tag. Concatenate the contents of every container.
        //
        // Genius has TWO HTML structures in the wild: the modern one
        // uses `data-lyrics-container="true"`, the older one uses a
        // class starting with "Lyrics__Container". We try modern first,
        // then fall back to legacy if nothing matched.
        const collectFragments = (containerOpenRegex) => {
          const out = [];
          let openMatch;
          containerOpenRegex.lastIndex = 0;
          while ((openMatch = containerOpenRegex.exec(html)) !== null) {
            let depth = 1;
            let i = openMatch.index + openMatch[0].length;
            const start = i;
            const tagRegex = /<\/?div\b[^>]*>/gi;
            tagRegex.lastIndex = i;
            while (depth > 0) {
              const m = tagRegex.exec(html);
              if (!m) { depth = 0; i = html.length; break; }
              if (m[0].startsWith('</')) depth -= 1;
              else depth += 1;
              i = m.index + (depth === 0 ? 0 : m[0].length);
            }
            out.push(html.slice(start, i));
            containerOpenRegex.lastIndex = i;
          }
          return out;
        };

        let fragments = collectFragments(/<div[^>]*data-lyrics-container="true"[^>]*>/gi);
        if (fragments.length === 0) {
          // Legacy structure — class starts with "Lyrics__Container".
          fragments = collectFragments(/<div[^>]*class="[^"]*Lyrics__Container[^"]*"[^>]*>/gi);
        }
        if (fragments.length === 0) return null;

        // Convert each fragment to plain text. The extracted HTML
        // typically contains <br> (line breaks), <a> (annotation
        // links), <i>/<b> (emphasis), and <div> (section headers).
        // We strip all tags, decode common HTML entities, normalize
        // whitespace, and drop the empty lines that come from header
        // boundaries.
        let plain = fragments
          .map((frag) => frag
            .replace(/<br\s*\/?>/gi, '\n')
            // Section headers like "[Verse 1]" sit inside their own
            // <div>; turning the closing </div> into a newline keeps
            // them on their own line in the final output.
            .replace(/<\/(div|p)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
          )
          .join('\n')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .join('\n');

        // Strip Genius's contributors / title header that appears at
        // the START of the lyrics container. Modern Genius pages
        // include this metadata block INSIDE the same container as
        // the lyrics, so the scraper picks it up by accident:
        //
        //   3 Contributors
        //   Translations
        //   Português / Español / Français
        //   343 Guilty Spark Lyrics
        //   <actual lyrics start>
        //
        // Walk past consecutive lines at the top that match known
        // header patterns. Stop the moment we hit a line that doesn't
        // match — that's where the real lyrics begin.
        const headerPatterns = [
          /^\d+\s+Contributors?\b/i,
          /^Translations?\b/i,
          /^Read More\b/i,
          /\bLyrics$/i,                  // "Song Title Lyrics" header
          /^[A-Z][a-zçéãíáúñ]+(\s*\/\s*[A-Z][a-zçéãíáúñ]+)+$/i,  // "Português / Español / Français"
        ];
        const lines = plain.split('\n');
        let headerEnd = 0;
        // Skip up to ~10 consecutive header lines at the top.
        while (headerEnd < lines.length && headerEnd < 10
               && headerPatterns.some((re) => re.test(lines[headerEnd]))) {
          headerEnd += 1;
        }
        if (headerEnd > 0) {
          plain = lines.slice(headerEnd).join('\n');
        }

        // Sanity-check the result. Real lyrics are at minimum a
        // verse — typically 200+ characters. If after stripping the
        // header we have almost nothing left, the page didn't contain
        // real lyrics (likely a stub or annotation page).
        if (!plain || plain.length < 60) return null;
        // Final safety net: if the entire remaining content STILL leads
        // with "N Contributors", the strip didn't work and the result
        // is junk — refuse it rather than display the leak.
        if (/^\d+\s+Contributors?\b/i.test(plain)) return null;

        return {
          trackName: best.r.trackName,
          artistName: best.r.artistName,
          syncedLyrics: null,
          plainLyrics: plain,
          instrumental: false,
          __source: 'genius',
        };
      } catch { return null; }
    };

    // Provider selection. Default: 'lrclib' (synced + plain from LRClib).
    // 'lrclib+genius' falls back to Genius when LRClib has nothing.
    // 'genius' skips LRClib entirely (faster when the user knows they
    // want Genius for the genre they're listening to — e.g. game OSTs
    // that LRClib rarely has).
    const selectedProvider = String(provider || 'lrclib').toLowerCase();
    const tryLrclibFirst = selectedProvider !== 'genius';
    const tryGeniusAfter = selectedProvider.includes('genius');

    let result = null;

    if (tryLrclibFirst) {
      // Strategy: race LRClib exact AND search in parallel, returning
      // the FIRST acceptable result rather than waiting for all to
      // finish. The exact-match endpoint is usually fastest (~300ms)
      // and most accurate when it hits — short-circuiting on its
      // success means a typical successful fetch resolves in well
      // under a second. The searches still run in the background
      // (their results discarded) but no longer block the response.
      //
      // "Acceptable" is tiered: a synced result wins instantly,
      // a plain result wins if no synced result has shown up by the
      // time another stage resolves. If everything resolves with no
      // hit, we fall through to Genius (when enabled).
      const q1 = `${artist || ''} ${title || ''}`.trim();
      // Note: we drop the secondary "title-only" search variant — in
      // practice the artist+title query handles ~99% of cases and the
      // extra call only adds latency without adding many real hits.

      result = await new Promise((resolve) => {
        let pending = 2; // exact + one search
        let bestPlain = null; // remember any plain hit while waiting for synced

        const tryResolve = (r) => {
          if (r?.syncedLyrics) {
            resolve(r);
            return true;
          }
          if (r?.plainLyrics && !bestPlain) {
            bestPlain = r;
          }
          return false;
        };

        const onDone = () => {
          pending -= 1;
          if (pending === 0) resolve(bestPlain || null);
        };

        tryLrclibExact().then((r) => {
          if (!tryResolve(r)) onDone();
        }).catch(onDone);

        if (q1.length > 0) {
          tryLrclibSearch(q1).then((r) => {
            if (!tryResolve(r)) onDone();
          }).catch(onDone);
        } else {
          onDone();
        }
      });
    }

    // Genius fallback — only if user opted in AND LRClib found nothing
    // (or LRClib was skipped entirely via 'genius' provider).
    if (!result && tryGeniusAfter) {
      result = await tryGenius();
    }

    const final = result ? fmt(result) : none;

    lyricsCache.set(cacheKey, final);
    if (lyricsCache.size > 500) lyricsCache.delete(lyricsCache.keys().next().value);
    saveCachedLyrics(cacheKey, final).catch(() => {});

    return final;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('lyrics:save', async (event, { title, artist, syncedLyrics, plainLyrics }) => {
  try {
    const cacheKey = `${(artist || '').toLowerCase().trim()}|${(title || '').toLowerCase().trim()}`;
    const data = {
      ok: true,
      syncedLyrics: syncedLyrics || null,
      plainLyrics: plainLyrics || null,
      instrumental: false,
    };
    // Update in-memory hot cache
    lyricsCache.set(cacheKey, data);
    // Persist to DB
    await ensureLibraryOpen();
    await saveCachedLyrics(cacheKey, data);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

/* =========================================================================
 *  iTunes "new releases" tracker
 *
 *  We use Apple's free, no-auth iTunes Search API:
 *    - GET /search?term=ARTIST&entity=musicArtist&limit=5
 *         → search results with `artistId`
 *    - GET /lookup?id=ARTISTID&entity=album&limit=200&sort=recent
 *         → all albums for that artist, newest first, with `releaseDate`
 *
 *  Rate limit is ~20 requests/minute. We stagger lookups with a small delay
 *  to stay well under that, and cache results in the DB.
 * ========================================================================= */

const ITUNES_API = 'https://itunes.apple.com';
const ITUNES_RATE_DELAY_MS = 300; // ≈3 req/s, safely under 20/min

// Session-scoped status so the renderer can show "Refreshing…" UI
let releasesRefreshInFlight = false;
let releasesAutoRefreshLastRunAt = 0;
const RELEASES_AUTO_REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // applies ONLY to auto-refresh
// Last refresh's per-artist outcome, so the renderer can surface a debug view
let lastRefreshDebug = null; // { resolved: [{name, id, albumCount, recentCount}], failures: [...] }

async function itunesSearchArtist(name) {
  const q = new URLSearchParams({ term: name, entity: 'musicArtist', limit: '5', media: 'music' });
  const res = await net.fetch(`${ITUNES_API}/search?${q}`, {
    headers: { 'User-Agent': 'Immerse/1.0' },
  });
  if (!res.ok) throw new Error(`iTunes search ${res.status}`);
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  // Pick the closest name match (case-insensitive equality first, then contains)
  const lower = name.trim().toLowerCase();
  const exact = results.find((r) => String(r.artistName || '').trim().toLowerCase() === lower);
  if (exact) return exact;
  return results[0] || null;
}

async function itunesLookupArtistAlbums(artistId, limit = 25) {
  const q = new URLSearchParams({
    id: String(artistId),
    entity: 'album',
    limit: String(limit),
    sort: 'recent',
  });
  const res = await net.fetch(`${ITUNES_API}/lookup?${q}`, {
    headers: { 'User-Agent': 'Immerse/1.0' },
  });
  if (!res.ok) throw new Error(`iTunes lookup ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.results) ? json.results : [];
  // First result is the artist itself, subsequent are albums
  return rows.filter((r) => r.wrapperType === 'collection' && r.collectionType === 'Album');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Refresh releases for a list of artist names. Resolves each artist's iTunes
 * ID on first call (and caches it), then fetches their recent albums and
 * upserts the results into the cache.
 *
 * @param artistNames - normalised artist names (one per artist)
 * @param knownIds    - Map<string, number> of already-resolved iTunes IDs
 * @returns           - { upserted, failures, resolved } for debugging
 */
async function refreshReleasesForArtists(artistNames, knownIds) {
  const allReleases = [];
  const failures = [];
  const resolved = [];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  console.log('[releases] refresh starting for', artistNames.length, 'artists');

  for (const name of artistNames) {
    try {
      let itunesArtistId = knownIds.get(name.toLowerCase()) ?? null;
      let wasResolved = false;
      if (!itunesArtistId) {
        const artist = await itunesSearchArtist(name);
        await sleep(ITUNES_RATE_DELAY_MS);
        if (!artist?.artistId) {
          console.log(`[releases]   "${name}" → NOT FOUND on iTunes`);
          failures.push({ name, reason: 'not found on iTunes' });
          continue;
        }
        itunesArtistId = Number(artist.artistId);
        wasResolved = true;
        console.log(`[releases]   "${name}" → iTunes ID ${itunesArtistId} (matched as "${artist.artistName}")`);
        await setItunesArtistIdForArtist(name, itunesArtistId);
      }
      const albums = await itunesLookupArtistAlbums(itunesArtistId, 25);
      await sleep(ITUNES_RATE_DELAY_MS);
      let recentCount = 0;
      for (const a of albums) {
        const releaseDate = String(a.releaseDate || '');
        const releaseMs = releaseDate ? new Date(releaseDate).getTime() : 0;
        const isRecent = releaseMs >= cutoff;
        if (isRecent) recentCount += 1;
        // Normalise artwork URL to 600x600 (the API returns 100x100 by default)
        const art100 = String(a.artworkUrl100 || '');
        const art600 = art100.replace(/100x100bb\.jpg$/i, '600x600bb.jpg');
        allReleases.push({
          itunesArtistId,
          collectionId: Number(a.collectionId),
          collectionName: String(a.collectionName || ''),
          artistName: String(a.artistName || name),
          releaseDate,
          artworkUrl: art600 || art100,
          trackCount: Number(a.trackCount) || 0,
          collectionViewUrl: String(a.collectionViewUrl || ''),
          primaryGenreName: String(a.primaryGenreName || ''),
        });
      }
      resolved.push({
        name,
        itunesArtistId,
        albumCount: albums.length,
        recentCount,
        resolvedThisRun: wasResolved,
      });
      if (recentCount > 0) {
        console.log(`[releases]   "${name}" → ${albums.length} albums total, ${recentCount} in last 30d`);
      } else if (albums.length === 0) {
        console.log(`[releases]   "${name}" → NO albums on iTunes (ID ${itunesArtistId} may be wrong)`);
      }
    } catch (e) {
      console.error('[releases] fetch failed for', name, e?.message || e);
      failures.push({ name, reason: String(e?.message || e) });
    }
  }
  if (allReleases.length) {
    await upsertArtistReleases(allReleases);
  }
  const recentTotal = resolved.reduce((s, r) => s + r.recentCount, 0);
  console.log(`[releases] refresh done — ${resolved.length}/${artistNames.length} artists resolved, ${recentTotal} recent releases, ${failures.length} failures`);

  lastRefreshDebug = { resolved, failures, at: Date.now() };
  return { upserted: allReleases.length, resolved, failures };
}

/** Load current cached releases (within last 30 days). */
ipcMain.handle('releases:loadCached', async () => {
  try {
    await ensureLibraryOpen();
    return { ok: true, releases: await loadCachedReleases({ withinDays: 30 }) };
  } catch (e) {
    console.error('[releases:loadCached]', e);
    return { ok: false, error: String(e?.message || e), releases: [] };
  }
});

/**
 * Refresh releases for a provided list of artist names (renderer computes the
 * list by combining auto-followed library artists + manual overrides). Main
 * returns after fetching completes, so the renderer can re-load the cache.
 *
 * `mode` is 'auto' (startup background refresh, subject to cooldown) or
 * 'manual' (user pressed the refresh button, always runs unless already busy).
 */
ipcMain.handle('releases:refresh', async (event, { artistNames, mode = 'manual' } = {}) => {
  if (releasesRefreshInFlight) {
    return { ok: false, error: 'Refresh already in progress' };
  }
  if (mode === 'auto') {
    const now = Date.now();
    if (now - releasesAutoRefreshLastRunAt < RELEASES_AUTO_REFRESH_COOLDOWN_MS) {
      return { ok: true, skipped: true, reason: 'Auto-refresh cooldown' };
    }
  }
  if (!Array.isArray(artistNames) || !artistNames.length) {
    return { ok: true, skipped: true, reason: 'No artists to refresh' };
  }
  releasesRefreshInFlight = true;
  try {
    await ensureLibraryOpen();
    // Look up existing ID cache so we skip search calls when we already know
    const overrides = await loadFollowedArtistOverrides();
    const knownIds = new Map();
    for (const o of overrides) {
      if (o.itunesArtistId) knownIds.set(o.artistName.toLowerCase(), o.itunesArtistId);
    }
    const result = await refreshReleasesForArtists(artistNames, knownIds);
    if (mode === 'auto') releasesAutoRefreshLastRunAt = Date.now();
    return { ok: true, mode, ...result };
  } catch (e) {
    console.error('[releases:refresh]', e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    releasesRefreshInFlight = false;
  }
});

/** Get the debug report from the most recent refresh for display in the UI. */
ipcMain.handle('releases:getDebug', async () => {
  return { ok: true, debug: lastRefreshDebug };
});

/** Get current follow-overrides (manual adds + manual excludes). */
ipcMain.handle('releases:loadOverrides', async () => {
  try {
    return { ok: true, overrides: await loadFollowedArtistOverrides() };
  } catch (e) {
    console.error('[releases:loadOverrides]', e);
    return { ok: false, error: String(e?.message || e), overrides: [] };
  }
});

ipcMain.handle('releases:addArtist', async (event, artistName) => {
  try { return await addFollowedArtist(artistName); }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

ipcMain.handle('releases:excludeArtist', async (event, artistName) => {
  try { return await excludeFollowedArtist(artistName); }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

ipcMain.handle('releases:clearOverride', async (event, artistName) => {
  try { return await clearFollowedArtistOverride(artistName); }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

/**
 * Fetch all tracks for a given iTunes collection (album). Returns track
 * metadata shaped for the importer: title, artistName, trackTimeMillis,
 * trackNumber. Used by the New Releases tab to download an album directly.
 */
ipcMain.handle('releases:lookupAlbumTracks', async (event, collectionId) => {
  const id = Number(collectionId);
  if (!Number.isFinite(id)) return { ok: false, error: 'Invalid collectionId' };
  try {
    const q = new URLSearchParams({
      id: String(id),
      entity: 'song',
      limit: '200',
    });
    const res = await net.fetch(`${ITUNES_API}/lookup?${q}`, {
      headers: { 'User-Agent': 'Immerse/1.0' },
    });
    if (!res.ok) throw new Error(`iTunes lookup ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json?.results) ? json.results : [];
    const tracks = rows
      .filter((r) => r.wrapperType === 'track' && r.kind === 'song')
      .map((r) => {
        // iTunes uses string enum: 'explicit' | 'cleaned' | 'notExplicit'.
        // Map to boolean for consistency with Spotify's flag.
        let explicit = null;
        if (r.trackExplicitness === 'explicit') explicit = true;
        else if (r.trackExplicitness === 'notExplicit' || r.trackExplicitness === 'cleaned') explicit = false;
        return {
          trackId: Number(r.trackId),
          trackName: String(r.trackName || ''),
          artistName: String(r.artistName || ''),
          collectionName: String(r.collectionName || ''),
          trackNumber: Number(r.trackNumber) || 0,
          trackTimeMillis: Number(r.trackTimeMillis) || 0,
          artworkUrl: String(r.artworkUrl100 || '').replace(/100x100bb\.jpg$/i, '600x600bb.jpg'),
          explicit,
        };
      })
      .sort((a, b) => a.trackNumber - b.trackNumber);
    return { ok: true, tracks };
  } catch (e) {
    console.error('[releases:lookupAlbumTracks]', e);
    return { ok: false, error: String(e?.message || e) };
  }
});
