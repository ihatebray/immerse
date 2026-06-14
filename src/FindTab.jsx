import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icons from './Icons.jsx';
import { formatDurationMs } from './mediaUtils.js';
import { Banner } from './SettingsTab.jsx';
import { useToast } from './Toasts.jsx';

function FindTab({
  importing,
  setImporting,
  spotifyCredsRefreshKey,
  onSpotifyImportDone,
  onOpenSettings,
  accent,
  library,
  onShowCandidatePicker,
  isActive = true,
}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const pushToast = useToast();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('tracks');
  // Remembers the last Spotify sub-mode (tracks/albums/playlist) so
  // toggling out to Soulseek and back lands on the same sub-tab the
  // user was on. Tracks is the default first time.
  const lastSpotifySubModeRef = useRef('tracks');
  const [findMenuOpen, setFindMenuOpen] = useState(false);
  const findBtnRef = useRef(null);
  useEffect(() => {
    if (mode === 'tracks' || mode === 'albums' || mode === 'playlist') {
      lastSpotifySubModeRef.current = mode;
    }
  }, [mode]);
  const [trackResults, setTrackResults] = useState([]);
  const [albumResults, setAlbumResults] = useState([]);
  const [expandedAlbum, setExpandedAlbum] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toolsOk, setToolsOk] = useState(true);
  const [credsOk, setCredsOk] = useState(true);
  const [hovered, setHovered] = useState(null);
  const [okLine, setOkLine] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, title: '' });
  const [isDownloading, setIsDownloading] = useState(false);
  const downloadCancelledRef = useRef(false);

  // Track per-row downloading state and completed downloads
  const [downloadingIds, setDownloadingIds] = useState(new Set());
  const [downloadedIds, setDownloadedIds] = useState(new Set());

  // Soulseek state. Lives here (rather than in a separate component) so
  // the Tracks / Albums / Soulseek toggle can share search-input,
  // search-button, and error/log surface area with the Spotify modes.
  // Result shape mirrors what we used to render in SoulseekSearchView:
  //   slskAlbums  — auto-grouped album cards (up to 10 best)
  //   slskTracks  — individual file results (up to 10)
  //   slskExpandedId — which album is currently expanded
  //   slskDownloads  — array of { rowId, label, progress, state, ... }
  //                    for the active download queue
  //   slskAlbumDownloads — keyed map of album-level progress
  //   slskShowTracks — toggle between "tracks hidden" and "tracks shown"
  //                    when results are album-heavy
  //   slskArtByKey  — album.id → Spotify cover URL (populated async)
  //   slskStatus    — { state, configured, error } connection state
  const [slskAlbums, setSlskAlbums] = useState([]);
  const [slskTracks, setSlskTracks] = useState([]);
  const [slskExpandedId, setSlskExpandedId] = useState('');
  const [slskShowTracks, setSlskShowTracks] = useState(false);
  const [slskDownloads, setSlskDownloads] = useState([]);
  const [slskAlbumDownloads, setSlskAlbumDownloads] = useState({});
  const [slskArtByKey, setSlskArtByKey] = useState({});
  const [slskStatus, setSlskStatus] = useState({ state: 'disconnected', configured: false, error: '' });
  const slskDownloadsRef = useRef([]);
  slskDownloadsRef.current = slskDownloads;

  // Playlist import state. Lifecycle:
  //   1. User pastes URL → click Search → call spotifyFetchPlaylist
  //   2. Result populates `playlistData` (name, owner, tracks[])
  //   3. We auto-detect conflicts (tracks already in library)
  //   4. User reviews + clicks Import → call playlistImportBatch
  //   5. Per-track progress streams in via 'playlist:importProgress'
  //   6. Final summary shown when batch completes
  //
  //   playlistSource: 'ytdlp' | 'soulseek' — toggleable before import
  //   playlistConflicts: array of { spotifyId, existingId, title, artist }
  //   playlistSkipIds: Set of spotifyIds the user marked to skip (defaults
  //                    to all conflicts pre-checked)
  //   playlistProgress: { spotifyId → 'starting'|'done'|'failed'|'skipped' }
  //   playlistSummary: final result {completed,failed,skipped} or null
  const [playlistData, setPlaylistData] = useState(null);
  const [playlistSource, setPlaylistSource] = useState('ytdlp');
  const [playlistConflicts, setPlaylistConflicts] = useState([]);
  const [playlistSkipIds, setPlaylistSkipIds] = useState(() => new Set());
  const [playlistProgress, setPlaylistProgress] = useState({});
  const [playlistSummary, setPlaylistSummary] = useState(null);
  // Per-track failure detail map: spotifyId → { candidates, meta, error }.
  // Populated when the import batch reports a 'failed' state with picker
  // data attached. Used by the post-import review UI to show "Pick video"
  // affordances next to each failed track.
  const [playlistFailures, setPlaylistFailures] = useState({});
  const [playlistImporting, setPlaylistImporting] = useState(false);

  // Picker state for "Pick from your playlists". Spotify locked down
  // /v1/playlists/{id}/items for dev-mode apps in Feb 2026 — you can
  // only fetch playlists you own or collaborate on. So instead of
  // pasting a URL, the user picks one of theirs from /me/playlists.
  //   myPlaylists       — list of {id, name, imageUrl, totalTracks, owner, ...}
  //   myPlaylistsState  — '' | 'loading' | 'loaded' | 'error' | 'needs-auth'
  //   myPlaylistsError  — last error message from /me/playlists, if any
  // The list is fetched once when the user enters Playlist mode and
  // also on demand via the Refresh button.
  const [myPlaylists, setMyPlaylists] = useState([]);
  const [myPlaylistsState, setMyPlaylistsState] = useState('');
  const [myPlaylistsError, setMyPlaylistsError] = useState('');

  // Auto-clear results after 60 seconds away from the tab.
  // The timer starts when isActive goes false and is cancelled if the
  // user returns before it fires. Clears query + results so the tab
  // feels fresh on the next visit without any stale state hanging around.
  useEffect(() => {
    if (isActive) return;
    const t = setTimeout(() => {
      setQ('');
      setTrackResults([]);
      setAlbumResults([]);
      setExpandedAlbum(null);
      setSelected(new Set());
      setError('');
      setOkLine('');
      // Soulseek state. Don't wipe downloads — they may still be in
      // flight and the user might come back to check.
      setSlskAlbums([]);
      setSlskTracks([]);
      setSlskExpandedId('');
      setSlskShowTracks(false);
      setSlskArtByKey({});
      // Playlist state. Don't wipe summary mid-import.
      if (!playlistImporting) {
        setPlaylistData(null);
        setPlaylistConflicts([]);
        setPlaylistSkipIds(new Set());
        setPlaylistProgress({});
        setPlaylistSummary(null);
        setPlaylistFailures({});
      }
    }, 60_000);
    return () => clearTimeout(t);
  }, [isActive]);

  /**
   * Fetch the user's Spotify playlists for the picker. Idempotent: safe
   * to call repeatedly; the state machine guards against concurrent
   * loads.
   */
  const loadMyPlaylists = React.useCallback(async () => {
    if (!api?.spotifyGetMyPlaylists) {
      setMyPlaylistsState('error');
      setMyPlaylistsError('Playlist picker not available in this build.');
      return;
    }
    setMyPlaylistsState('loading');
    setMyPlaylistsError('');
    try {
      const r = await api.spotifyGetMyPlaylists();
      if (r?.ok && Array.isArray(r.playlists)) {
        setMyPlaylists(r.playlists);
        setMyPlaylistsState('loaded');
        setMyPlaylistsError('');
      } else if (r?.needsAuth) {
        setMyPlaylistsState('needs-auth');
        setMyPlaylistsError(r.error || 'Connect your Spotify account in Settings.');
        setMyPlaylists([]);
      } else {
        setMyPlaylistsState('error');
        setMyPlaylistsError(r?.error || 'Could not load your playlists.');
        setMyPlaylists([]);
      }
    } catch (e) {
      setMyPlaylistsState('error');
      setMyPlaylistsError(e?.message || String(e));
      setMyPlaylists([]);
    }
  }, [api]);

  // Auto-load the playlist list when entering Playlist mode for the
  // first time. We don't re-fetch on every mode switch — the user can
  // hit Refresh if they've added playlists in Spotify since they
  // opened Immerse. Re-fetch IS forced after a successful reconnect
  // (when state was 'needs-auth' and credentials change) — that's
  // handled via the api change in deps; loadMyPlaylists is stable
  // unless api flips.
  useEffect(() => {
    if (mode !== 'playlist') return;
    if (myPlaylistsState === 'loading' || myPlaylistsState === 'loaded') return;
    loadMyPlaylists();
  }, [mode, loadMyPlaylists, myPlaylistsState]);

  // When the user connects/disconnects their Spotify account (probably
  // by hopping to Settings while the picker is showing the "Connect"
  // prompt), the picker should react. On connect → reload. On
  // disconnect → reset state so a future visit prompts again rather
  // than showing the stale list.
  useEffect(() => {
    if (!api?.onSpotifyUserAuthChanged) return undefined;
    const unsub = api.onSpotifyUserAuthChanged((payload) => {
      if (payload?.connected) {
        // Force a reload regardless of current state — the user may
        // have switched accounts and we want fresh data.
        loadMyPlaylists();
      } else {
        setMyPlaylists([]);
        setMyPlaylistsState('');
        setMyPlaylistsError('');
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [api, loadMyPlaylists]);

  // Build a lookup set from the library for detecting already-downloaded tracks
  const libraryLookup = React.useMemo(() => {
    const keys = new Set();
    if (Array.isArray(library)) {
      for (const t of library) {
        // Normalize title+artist for matching
        const key = `${(t.title || '').trim().toLowerCase()}||${(t.artist || '').trim().toLowerCase()}`;
        keys.add(key);
      }
    }
    return keys;
  }, [library]);

  const isInLibrary = useCallback((row) => {
    const key = `${(row.title || '').trim().toLowerCase()}||${(row.artists || '').trim().toLowerCase()}`;
    return libraryLookup.has(key) || downloadedIds.has(row.spotifyId);
  }, [libraryLookup, downloadedIds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, c] = await Promise.all([api?.toolsGetState?.(), api?.spotifyGetCredsState?.()]);
        if (cancelled) return;
        setToolsOk(!!t?.installed);
        setCredsOk(!!c?.configured);
      } catch {
        if (!cancelled) { setToolsOk(false); setCredsOk(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [api, spotifyCredsRefreshKey]);

  /* ---------- Soulseek wiring ---------- */
  //
  // Status load + progress event listeners. We pull the connection state
  // on mount (cheap, doesn't open the socket — that happens on first
  // search/download), and subscribe to the two progress event streams
  // (per-track and per-album).

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const s = await api?.soulseekStatus?.();
        if (cancelled || !s) return;
        setSlskStatus(s);
      } catch { /* leave default */ }
    })();
    return () => { cancelled = true; };
  }, [api, spotifyCredsRefreshKey]);

  useEffect(() => {
    if (!api?.onSoulseekDownloadProgress) return undefined;
    const unsub = api.onSoulseekDownloadProgress((payload) => {
      if (!payload || !payload.id) return;
      setSlskDownloads((prev) => {
        const idx = prev.findIndex((d) => d.rowId === payload.id);
        if (idx === -1) return prev;
        const next = [...prev];
        const row = { ...next[idx] };
        if (typeof payload.pct === 'number') row.progress = payload.pct;
        if (typeof payload.throughputBps === 'number') row.throughputBps = payload.throughputBps;
        if (payload.state) row.state = payload.state;
        if (payload.error) row.error = String(payload.error);
        next[idx] = row;
        return next;
      });
    });
    return unsub;
  }, [api]);

  useEffect(() => {
    if (!api?.onSoulseekAlbumProgress) return undefined;
    const unsub = api.onSoulseekAlbumProgress((payload) => {
      if (!payload || !payload.albumId) return;
      setSlskAlbumDownloads((prev) => ({
        ...prev,
        [payload.albumId]: {
          completed: payload.completed ?? 0,
          total: payload.total ?? 0,
          currentFile: payload.currentFile || '',
          state: payload.state || 'downloading',
          error: payload.error || '',
        },
      }));
    });
    return unsub;
  }, [api]);

  // Album-art fetch — same pattern as the old standalone view. Fires
  // when slskAlbums changes; results merge into slskArtByKey as they
  // arrive so tiles swap from gradient to real cover.
  useEffect(() => {
    if (!api?.soulseekFetchAlbumArt || mode !== 'soulseek') return undefined;
    const queries = [];
    for (const alb of slskAlbums) {
      if (slskArtByKey[alb.id] !== undefined) continue;
      const queryText = `${alb.displayName} ${q}`.trim();
      queries.push({ key: alb.id, query: queryText });
    }
    if (!queries.length) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.soulseekFetchAlbumArt(queries);
        if (cancelled || !res?.artByKey) return;
        setSlskArtByKey((prev) => ({ ...prev, ...res.artByKey }));
      } catch { /* placeholders stay */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, slskAlbums, mode]);

  // Auto-disconnect when leaving the Find tab (and no downloads
  // active). Same logic as before — Soulseek keeps a chatty server
  // socket open that hurts overall app perf. We tear it down when the
  // tab isn't visible.
  useEffect(() => {
    if (!api?.soulseekDisconnect) return undefined;
    if (isActive) return undefined;
    const hasActive = slskDownloadsRef.current.some(
      (d) => d.state === 'queued' || d.state === 'downloading'
    );
    if (hasActive) return undefined;
    const t = setTimeout(() => {
      api.soulseekDisconnect().then(() => {
        setSlskStatus((s) => ({ ...s, state: 'disconnected', error: '' }));
      }).catch(() => { /* ignore */ });
    }, 30_000);
    return () => clearTimeout(t);
  }, [api, isActive, slskDownloads]);

  // Per-file Soulseek download. Mirrors the standalone view's handler.
  const slskStartDownload = useCallback(async (row) => {
    if (!api?.soulseekDownload) return;
    const existing = slskDownloadsRef.current.find(
      (d) => d.rowId === row.id && (d.state === 'queued' || d.state === 'downloading')
    );
    if (existing) return;
    setSlskDownloads((prev) => [
      ...prev,
      { rowId: row.id, label: row.filename, user: row.user,
        progress: 0, throughputBps: 0, state: 'queued', startedAt: Date.now() },
    ]);
    try {
      setImporting?.(true);
      const res = await api.soulseekDownload({
        id: row.id, user: row.user, filePath: row.filePath,
        size: row.size, bitrate: row.bitrate, filename: row.filename,
      });
      if (res?.ok && res.track) {
        onSpotifyImportDone?.(res.track);
        setOkLine(`Added "${res.track.title || row.filename}" to library.`);
        pushToast({ message: `Added “${res.track.title || row.filename}” to library`, kind: 'success', dedupeKey: `slsk:${row.id}` });
      } else if (res && res.ok === false) {
        pushToast({
          message: `Couldn’t download “${row.filename}”`, kind: 'error', dedupeKey: `slsk:${row.id}`,
          action: { label: 'Retry', onClick: () => slskStartDownload(row) },
        });
      }
    } catch (e) {
      setSlskDownloads((prev) => prev.map((d) =>
        d.rowId === row.id ? { ...d, state: 'failed', error: String(e?.message || e) } : d
      ));
      pushToast({
        message: `Download failed: “${row.filename}”`, kind: 'error', dedupeKey: `slsk:${row.id}`,
        action: { label: 'Retry', onClick: () => slskStartDownload(row) },
      });
    } finally {
      setImporting?.(false);
    }
  }, [api, onSpotifyImportDone, setImporting, pushToast]);

  // Per-album Soulseek download.
  const slskStartAlbumDownload = useCallback(async (alb) => {
    if (!api?.soulseekDownloadAlbum) return;
    setSlskDownloads((prev) => {
      const next = [...prev];
      for (const t of alb.tracks) {
        if (!next.some((d) => d.rowId === t.id)) {
          next.push({ rowId: t.id, label: t.filename, user: t.user,
            progress: 0, throughputBps: 0, state: 'queued',
            startedAt: Date.now(), albumId: alb.id });
        }
      }
      return next;
    });
    setSlskAlbumDownloads((prev) => ({
      ...prev,
      [alb.id]: { completed: 0, total: alb.tracks.length, currentFile: '', state: 'downloading' },
    }));
    try {
      setImporting?.(true);
      const res = await api.soulseekDownloadAlbum({
        albumId: alb.id,
        tracks: alb.tracks.map((t) => ({
          id: t.id, user: t.user, filePath: t.filePath,
          size: t.size, filename: t.filename,
        })),
      });
      if (res?.tracks?.length) {
        for (const tr of res.tracks) onSpotifyImportDone?.(tr);
        setOkLine(res.partial
          ? `Saved ${res.tracks.length} of ${alb.tracks.length} tracks from "${alb.displayName}".`
          : `Saved album "${alb.displayName}" (${res.tracks.length} tracks).`);
        pushToast({
          message: res.partial
            ? `Saved ${res.tracks.length} of ${alb.tracks.length} from “${alb.displayName}”`
            : `Saved album “${alb.displayName}” (${res.tracks.length} tracks)`,
          kind: res.partial ? 'warning' : 'success', dedupeKey: `slskalbum:${alb.id}`,
        });
      } else if (res?.error) {
        setError(res.error);
        pushToast({
          message: `Album download failed: “${alb.displayName}”`, kind: 'error', dedupeKey: `slskalbum:${alb.id}`,
          action: { label: 'Retry', onClick: () => slskStartAlbumDownload(alb) },
        });
      }
    } catch (e) {
      setError(e?.message || String(e));
      pushToast({
        message: `Album download failed: “${alb.displayName}”`, kind: 'error', dedupeKey: `slskalbum:${alb.id}`,
        action: { label: 'Retry', onClick: () => slskStartAlbumDownload(alb) },
      });
    } finally {
      setImporting?.(false);
    }
  }, [api, onSpotifyImportDone, setImporting, pushToast]);

  /* ---------- Playlist import ---------- */

  // Subscribe to per-track progress events. The main process emits
  // 'playlist:importProgress' once per track transition (starting →
  // done/failed/skipped). We mirror those into a per-spotifyId map
  // so the review screen can show ✓ / × / skip indicators inline.
  useEffect(() => {
    if (!api?.onPlaylistImportProgress) return undefined;
    const unsub = api.onPlaylistImportProgress((payload) => {
      if (!payload || !payload.spotifyId) return;
      setPlaylistProgress((prev) => ({ ...prev, [payload.spotifyId]: payload.state }));
      // When a track finishes successfully, also feed the imported
      // track into the parent's library callback so the library view
      // gets it incrementally rather than waiting for batch completion.
      if (payload.state === 'done' && payload.track) {
        onSpotifyImportDone?.(payload.track);
      }
      // When a track fails with picker data, stash the candidates +
      // meta so the post-import review UI can hand them to the picker
      // modal. Some failures (e.g. "No title") arrive without picker
      // data; those rows just show the error without a Pick button.
      if (payload.state === 'failed' && (payload.candidates || payload.meta)) {
        setPlaylistFailures((prev) => ({
          ...prev,
          [payload.spotifyId]: {
            candidates: payload.candidates || [],
            meta: payload.meta || null,
            error: payload.error || '',
          },
        }));
      }
    });
    return unsub;
  }, [api, onSpotifyImportDone]);

  const togglePlaylistSkip = useCallback((spotifyId) => {
    setPlaylistSkipIds((prev) => {
      const next = new Set(prev);
      if (next.has(spotifyId)) next.delete(spotifyId);
      else next.add(spotifyId);
      return next;
    });
  }, []);

  // Select all clears the skip set back to its default — everything selected
  // except tracks already in the library (the conflict auto-skips), so the
  // user doesn't accidentally re-import duplicates. Deselect all skips every
  // track, giving a clean slate to cherry-pick from.
  const selectAllPlaylist = useCallback(() => {
    setPlaylistSkipIds(new Set((playlistConflicts || []).map((c) => c.spotifyId)));
  }, [playlistConflicts]);
  const deselectAllPlaylist = useCallback(() => {
    setPlaylistSkipIds(new Set((playlistData?.tracks || []).map((t) => t.spotifyId)));
  }, [playlistData]);

  const startPlaylistImport = useCallback(async () => {
    if (!api?.playlistImportBatch || !playlistData?.tracks?.length) return;
    setError('');
    setOkLine('');
    setPlaylistProgress({});
    setPlaylistSummary(null);
    setPlaylistFailures({});
    setPlaylistImporting(true);
    setImporting?.(true);
    try {
      const tracks = playlistData.tracks.map((t) => ({
        ...t,
        skip: playlistSkipIds.has(t.spotifyId),
      }));
      const res = await api.playlistImportBatch({
        tracks,
        source: playlistSource,
      });
      if (res?.ok) {
        setPlaylistSummary({
          completed: res.completed || 0,
          failed: res.failed || 0,
          skipped: res.skipped || 0,
          failures: res.failures || [],
        });
        setOkLine(`Imported ${res.completed} of ${tracks.length} tracks.`);
        const failed = res.failed || 0;
        pushToast({
          message: failed > 0
            ? `Imported ${res.completed} of ${tracks.length} · ${failed} not found`
            : `Imported ${res.completed} track${res.completed === 1 ? '' : 's'}`,
          kind: failed > 0 ? 'warning' : 'success',
          dedupeKey: 'playlist-import',
          durationMs: failed > 0 ? 8000 : 5000,
        });
      } else {
        setError(res?.error || 'Playlist import failed.');
        pushToast({ message: res?.error || 'Playlist import failed', kind: 'error', dedupeKey: 'playlist-import' });
      }
    } catch (e) {
      setError(e?.message || String(e));
      pushToast({ message: `Playlist import failed: ${e?.message || e}`, kind: 'error', dedupeKey: 'playlist-import' });
    } finally {
      setImporting?.(false);
      setPlaylistImporting(false);
    }
  }, [api, playlistData, playlistSkipIds, playlistSource, setImporting, pushToast]);

  const runSearch = useCallback(async () => {
    const query = q.trim();
    if (!query) { setError('Enter a song or artist.'); return; }
    setError(''); setOkLine('');
    setTrackResults([]); setAlbumResults([]); setExpandedAlbum(null); setSelected(new Set());
    setSlskAlbums([]); setSlskTracks([]); setSlskExpandedId(''); setSlskShowTracks(false); setSlskArtByKey({});
    setBusy(true);
    try {
      if (mode === 'tracks') {
        if (!api?.spotifySearch) { setError('Spotify search not available.'); setBusy(false); return; }
        const list = await api.spotifySearch(query);
        setTrackResults(Array.isArray(list) ? list : []);
        if (!list?.length) setError('No tracks found.');
      } else if (mode === 'albums') {
        if (!api?.spotifySearchAlbums) { setError('Album search not available.'); setBusy(false); return; }
        const list = await api.spotifySearchAlbums(query);
        setAlbumResults(Array.isArray(list) ? list : []);
        if (!list?.length) setError('No albums found.');
      } else if (mode === 'soulseek') {
        if (!api?.soulseekSearch) { setError('Soulseek search not available.'); setBusy(false); return; }
        if (!slskStatus.configured) {
          setError('Soulseek is not configured. Add username and password in Settings.');
          setBusy(false); return;
        }
        const res = await api.soulseekSearch(query);
        if (res?.ok === false) {
          setError(res.error || 'Soulseek search failed.');
        } else {
          setSlskAlbums(Array.isArray(res?.albums) ? res.albums : []);
          setSlskTracks(Array.isArray(res?.results) ? res.results : []);
          if (!res?.albums?.length && !res?.results?.length) {
            setError('No matches. Try broader keywords (peer-to-peer responses trickle in).');
          }
        }
        // Refresh status after — soulseek may have reconnected.
        try {
          const s = await api?.soulseekStatus?.();
          if (s) setSlskStatus(s);
        } catch { /* ignore */ }
      }
      // Note: playlist mode no longer hits runSearch — it uses the
      // picker UI which calls selectPlaylist() directly. The Go button
      // is hidden in playlist mode (replaced by Refresh).
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      // Surface connection/auth failures as an actionable toast. Spotify
      // token/credential problems are the common cause; offer a jump to
      // Settings to reconnect.
      const isAuth = /token|auth|credential|401|403|unauthor/i.test(msg);
      pushToast({
        message: isAuth ? 'Spotify connection failed — check your credentials' : `Search failed: ${msg}`,
        kind: 'error', dedupeKey: 'search-error',
        action: isAuth && onOpenSettings
          ? { label: 'Settings', onClick: () => onOpenSettings() }
          : { label: 'Retry', onClick: () => runSearch() },
      });
    } finally {
      setBusy(false);
    }
  }, [q, api, mode, slskStatus.configured, pushToast, onOpenSettings]);

  /**
   * Fetch and prep a specific Spotify playlist for import. Called from
   * picker-row clicks (and previously, from runSearch when the user
   * pasted a URL — now obsolete since /v1/playlists/{id}/items is
   * locked down to playlists the user owns or collaborates on).
   *
   * Shares the conflict-detection / preview pipeline with the (now
   * removed) URL-paste path: result populates `playlistData`, then we
   * call playlistDetectConflicts and pre-check them.
   */
  const selectPlaylist = useCallback(async (playlistId) => {
    if (!api?.spotifyFetchPlaylist) {
      setError('Playlist import not available.');
      return;
    }
    setError('');
    setOkLine('');
    setBusy(true);
    setPlaylistData(null);
    setPlaylistConflicts([]);
    setPlaylistSkipIds(new Set());
    setPlaylistProgress({});
    setPlaylistSummary(null);
    setPlaylistFailures({});
    try {
      const res = await api.spotifyFetchPlaylist(playlistId);
      if (res?.ok === false || !res?.playlist) {
        setError(res?.error || 'Could not fetch playlist.');
      } else {
        setPlaylistData(res.playlist);
        try {
          const cRes = await api.playlistDetectConflicts(res.playlist.tracks || []);
          if (cRes?.ok) {
            setPlaylistConflicts(cRes.conflicts || []);
            setPlaylistSkipIds(new Set((cRes.conflicts || []).map((c) => c.spotifyId)));
          }
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [api]);

  const expandAlbum = useCallback(async (album) => {
    if (expandedAlbum?.albumId === album.albumId) { setExpandedAlbum(null); return; }
    if (!api?.spotifyGetAlbumTracks) return;
    setError(''); setBusy(true);
    try {
      const data = await api.spotifyGetAlbumTracks(album.albumId);
      setExpandedAlbum({ albumId: album.albumId, ...data });
      setSelected(new Set());
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }, [api, expandedAlbum]);

  const toggleSelect = (id) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const currentVisibleTracks = () => {
    if (mode === 'tracks') return trackResults;
    if (expandedAlbum?.tracks) return expandedAlbum.tracks;
    return [];
  };
  const selectAllVisible = () => setSelected(new Set(currentVisibleTracks().filter((t) => !isInLibrary(t)).map((t) => t.spotifyId)));
  const clearSelection = () => setSelected(new Set());

  const startBatchDownload = async () => {
    const allTracks = currentVisibleTracks();
    const toDownload = allTracks.filter((t) => selected.has(t.spotifyId) && !isInLibrary(t));
    if (!toDownload.length || !api?.importFromYoutubeSearch) return;
    downloadCancelledRef.current = false;
    setIsDownloading(true); setImporting(true);
    setDownloadProgress({ current: 0, total: toDownload.length, title: '' });
    setOkLine(''); setError('');
    let completed = 0, failed = 0;
    for (const row of toDownload) {
      if (downloadCancelledRef.current) break;
      setDownloadProgress({ current: completed + 1, total: toDownload.length, title: row.title });
      setDownloadingIds((prev) => new Set(prev).add(row.spotifyId));
      try {
        const res = await api.importFromYoutubeSearch({
          title: row.title, artists: row.artists,
          album: row.album || expandedAlbum?.album || '',
          albumArtUrl: row.albumArtUrl || expandedAlbum?.albumArtUrl || '',
          durationMs: row.durationMs ?? 0, spotifyId: row.spotifyId,
          trackNumber: row.trackNumber ?? null,
          discNumber: row.discNumber ?? null,
          explicit: row.explicit,
        });
        if (res?.ok && res.track) {
          onSpotifyImportDone?.(res.track);
          setDownloadedIds((prev) => new Set(prev).add(row.spotifyId));
          completed++;
        } else { failed++; }
      } catch { failed++; }
      finally {
        setDownloadingIds((prev) => { const next = new Set(prev); next.delete(row.spotifyId); return next; });
      }
    }
    setIsDownloading(false); setImporting(false); setSelected(new Set());
    setDownloadProgress({ current: 0, total: 0, title: '' });
    setOkLine(failed > 0 ? `Added ${completed} track${completed !== 1 ? 's' : ''}. ${failed} failed.` : `Added ${completed} track${completed !== 1 ? 's' : ''}.`);
    pushToast({
      message: failed > 0
        ? `Added ${completed} track${completed !== 1 ? 's' : ''} · ${failed} failed`
        : `Added ${completed} track${completed !== 1 ? 's' : ''} to library`,
      kind: failed > 0 ? 'warning' : 'success',
      dedupeKey: 'ytdlp-batch',
    });
  };

  const cancelDownload = () => { downloadCancelledRef.current = true; };

  const importSingle = async (row) => {
    if (!api?.importFromYoutubeSearch || isInLibrary(row) || downloadingIds.has(row.spotifyId)) return;
    setError(''); setOkLine('');
    setDownloadingIds((prev) => new Set(prev).add(row.spotifyId));
    // Build the meta payload once — used for both the auto-import and as
    // fallback context if the user opens the manual picker.
    const meta = {
      title: row.title, artists: row.artists,
      album: row.album || expandedAlbum?.album || '',
      albumArtUrl: row.albumArtUrl || expandedAlbum?.albumArtUrl || '',
      durationMs: row.durationMs ?? 0, spotifyId: row.spotifyId,
      trackNumber: row.trackNumber ?? null,
      discNumber: row.discNumber ?? null,
      explicit: row.explicit,
    };
    // Read the "always show picker" setting. When on, we skip auto-import
    // entirely and surface the picker for every download. Setting lives
    // in localStorage so it persists without DB cost.
    const alwaysShowPicker = typeof window !== 'undefined'
      && localStorage.getItem('immerse:alwaysShowPicker') === '1';

    try {
      if (alwaysShowPicker && api.searchYoutubeCandidates && onShowCandidatePicker) {
        // Picker-first mode — search-only, then surface the picker.
        const sres = await api.searchYoutubeCandidates({
          artists: row.artists,
          title: row.title,
        });
        // Free up the spinner — picker takes over the UI from here.
        setDownloadingIds((prev) => { const next = new Set(prev); next.delete(row.spotifyId); return next; });
        if (!sres?.ok) {
          setError(sres?.error || 'Search failed.');
          return;
        }
        // Always open the picker — even if no candidates were found, the
        // user can refine the search or paste a YouTube URL directly.
        // Closing the door with "no candidates" gives them no recovery path.
        onShowCandidatePicker({
          candidates: sres.candidates || [],
          meta,
          onSuccess: (track) => {
            onSpotifyImportDone?.(track);
            setDownloadedIds((prev) => new Set(prev).add(row.spotifyId));
            setOkLine(`Added "${row.title}".`);
          },
        });
        return;
      }

      // Default path — auto-import via tier matching.
      const res = await api.importFromYoutubeSearch(meta);
      if (res?.ok && res.track) {
        onSpotifyImportDone?.(res.track);
        setDownloadedIds((prev) => new Set(prev).add(row.spotifyId));
        setOkLine(`Added "${row.title}".`);
        pushToast({ message: `Added “${row.title}” to library`, kind: 'success', dedupeKey: `ytdlp:${row.spotifyId}` });
      } else if (res?.code === 'no-tier-match' && Array.isArray(res?.candidates) && res.candidates.length > 0) {
        // Auto-import found no qualifying candidate. Surface the picker so
        // the user can choose. We hand it the original meta + an onSuccess
        // that mirrors the auto-success branch above.
        onShowCandidatePicker?.({
          candidates: res.candidates,
          meta,
          onSuccess: (track) => {
            onSpotifyImportDone?.(track);
            setDownloadedIds((prev) => new Set(prev).add(row.spotifyId));
            setOkLine(`Added "${row.title}".`);
            pushToast({ message: `Added “${row.title}” to library`, kind: 'success', dedupeKey: `ytdlp:${row.spotifyId}` });
          },
        });
      } else {
        setError(res?.error || 'Import failed.');
        pushToast({
          message: `Couldn’t add “${row.title}”`, kind: 'error', dedupeKey: `ytdlp:${row.spotifyId}`,
          action: { label: 'Retry', onClick: () => importSingle(row) },
        });
      }
    } catch (e) {
      setError(e?.message || String(e));
      pushToast({
        message: `Import failed: “${row.title}”`, kind: 'error', dedupeKey: `ytdlp:${row.spotifyId}`,
        action: { label: 'Retry', onClick: () => importSingle(row) },
      });
    }
    finally {
      setDownloadingIds((prev) => { const next = new Set(prev); next.delete(row.spotifyId); return next; });
    }
  };

  const hasSelection = selected.size > 0;

  return (
    <>
      <div style={{ padding: '10px 12px 4px' }}>
        {/* Mode chip + search — single row matching LibraryTab layout */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <button ref={findBtnRef} type="button"
            onClick={() => setFindMenuOpen((v) => !v)}
            style={{
              flexShrink: 0, padding: '7px 12px', borderRadius: 9,
              border: `1px solid rgba(${accent},0.35)`,
              background: `rgba(${accent},0.12)`,
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
            }}>
            <span>{mode === 'tracks' ? 'Tracks' : mode === 'albums' ? 'Albums' : mode === 'playlist' ? 'Playlist' : 'Soulseek'}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.6, transform: findMenuOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {mode === 'playlist' ? (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={myPlaylistsState === 'loaded' && myPlaylists.length > 0
                  ? `Filter ${myPlaylists.length} playlist${myPlaylists.length === 1 ? '' : 's'}…`
                  : 'Your Spotify playlists'}
                style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 11px', borderRadius: 9, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: 12, outline: 'none' }} />
              <button type="button" onClick={loadMyPlaylists} disabled={myPlaylistsState === 'loading'}
                title="Refresh playlist list from Spotify"
                style={{ flexShrink: 0, padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(29,185,84,0.35)', background: 'rgba(29,185,84,0.18)', color: '#1db954', fontSize: 11.5, fontWeight: 700, cursor: myPlaylistsState === 'loading' ? 'wait' : 'pointer' }}>
                {myPlaylistsState === 'loading' ? '…' : 'Refresh'}
              </button>
            </>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder={mode === 'tracks' ? 'Song, artist, lyric…' : mode === 'albums' ? 'Album name, artist…' : 'Song title, album, artist…'}
                style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 11px', borderRadius: 9, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: 12, outline: 'none' }} />
              <button type="button" onClick={runSearch} disabled={busy}
                style={{ flexShrink: 0, padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(29,185,84,0.35)', background: 'rgba(29,185,84,0.18)', color: '#1db954', fontSize: 11.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? '…' : 'Go'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Portaled mode menu — renders into document.body so glass matches right-click menu */}
      {findMenuOpen && findBtnRef.current ? (() => {
        const r = findBtnRef.current.getBoundingClientRect();
        return createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={() => setFindMenuOpen(false)} />
            <div style={{
              position: 'fixed', left: r.left, top: r.bottom + 4, zIndex: 201,
              minWidth: 184, padding: 5, borderRadius: 14,
              background: 'rgba(18,18,20,0.62)',
              backdropFilter: 'blur(30px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
              animation: 'imm-ctx-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
              <style>{`@keyframes imm-ctx-in { from { opacity:0; transform:scale(0.96) translateY(-5px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
              {[
                { id: 'tracks', label: 'Tracks', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>, group: 'spotify' },
                { id: 'albums', label: 'Albums', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>, group: 'spotify' },
                { id: 'playlist', label: 'Playlist Import', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 12H3M16 6H3M16 18H3M21 12l-4-3v6z" /></svg>, group: 'spotify' },
                { divider: true },
                { id: 'soulseek', label: 'Soulseek', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>, group: 'slsk' },
              ].map((m, i) => m.divider ? (
                <div key={`d-${i}`} style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 2px' }} />
              ) : (
                <div key={m.id} role="menuitem"
                  onClick={() => { setMode(m.id); setExpandedAlbum(null); setSelected(new Set()); setFindMenuOpen(false); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.18)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 11px', borderRadius: 9,
                    color: 'rgba(255,255,255,0.92)',
                    cursor: 'pointer', background: 'transparent',
                    fontSize: 12, fontWeight: 500, userSelect: 'none',
                    transition: 'background 0.12s cubic-bezier(0.16,1,0.3,1), color 0.12s',
                  }}>
                  <span style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'currentColor' }}>{m.icon}</span>
                  <span style={{ flex: 1 }}>{m.label}</span>
                  {mode === m.id ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : null}
                </div>
              ))}
            </div>
          </>,
          document.body
        );
      })() : null}

      {(!toolsOk || !credsOk || error || okLine) ? (
        <div style={{ padding: '0 12px 6px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {!toolsOk ? (
            <Banner color="#f37272" bg="rgba(243,114,114,0.1)">
              {(() => {
                // Branch the message on platform + install context.
                // Bundled Windows builds should never see this banner
                // (binaries ship with the app), so if a Windows user
                // hits it they're either running from source or have
                // a corrupted install. Mac/Linux users need a hint
                // to install via brew/apt since we don't bundle for
                // those platforms.
                const plat = (typeof navigator !== 'undefined' && navigator.userAgentData?.platform)
                  || (typeof navigator !== 'undefined' ? navigator.platform : '');
                const isMac = /mac/i.test(plat);
                const isWin = /win/i.test(plat);
                if (isMac) {
                  return <>yt-dlp / ffmpeg not found. Install via <code style={{ fontSize: 10.5 }}>brew install yt-dlp ffmpeg</code> then restart.</>;
                }
                if (isWin) {
                  return <>yt-dlp / ffmpeg not found. Re-install Immerse, or run <code style={{ fontSize: 10.5 }}>npm run setup:binaries</code> if running from source.</>;
                }
                return <>yt-dlp / ffmpeg not found. Install them via your package manager (e.g. <code style={{ fontSize: 10.5 }}>apt install yt-dlp ffmpeg</code>) then restart.</>;
              })()}
            </Banner>
          ) : null}
          {!credsOk ? (
            <Banner color="#ffc107" bg="rgba(255,193,7,0.1)">
              <span>Spotify API not configured.</span>
              {onOpenSettings ? <button type="button" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onOpenSettings(); }} style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 10, border: 'none', background: '#ffc107', color: '#000', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>Settings</button> : null}
            </Banner>
          ) : null}
          {error ? <Banner color="#f37272" bg="rgba(243,114,114,0.1)">{error}</Banner> : null}
          {okLine ? <Banner color="#1db954" bg="rgba(29,185,84,0.1)">{okLine}</Banner> : null}
        </div>
      ) : null}

      {(isDownloading && mode !== 'soulseek') ? (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: '#1db954', fontWeight: 600, marginBottom: 3 }}>Downloading {downloadProgress.current} / {downloadProgress.total}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{downloadProgress.title}</div>
            <div style={{ marginTop: 4, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(downloadProgress.current / Math.max(1, downloadProgress.total)) * 100}%`, background: '#1db954', borderRadius: 1, transition: 'width 0.3s ease' }} />
            </div>
          </div>
          <button type="button" onClick={cancelDownload} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f37272', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Stop</button>
        </div>
      ) : (hasSelection && mode !== 'soulseek') ? (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" onClick={startBatchDownload} style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(29,185,84,0.35)', background: 'rgba(29,185,84,0.18)', color: '#1db954', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Download {selected.size} {selected.size === 1 ? 'track' : 'tracks'}
          </button>
          <button type="button" onClick={selectAllVisible} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#ccc', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>All</button>
          <button type="button" onClick={clearSelection} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#aaa', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>Clear</button>
        </div>
      ) : null}

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '2px 6px 12px' }}>
        {!busy && mode !== 'playlist'
          && trackResults.length === 0 && albumResults.length === 0 && !expandedAlbum
          && slskAlbums.length === 0 && slskTracks.length === 0 && !playlistData ? (
          <div style={{ padding: '28px 18px', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
            {mode === 'soulseek' ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Soulseek</div>
                <div style={{ marginBottom: 8 }}>
                  Search the peer-to-peer network for high-quality audio files shared by other users. Great for finding lossless FLAC, rare remixes, and live recordings.
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6 }}>
                  Results trickle in as peers respond — give it a few seconds. Clean, edited, and karaoke versions are filtered out automatically. Downloaded files are added directly to your library.
                </div>
              </div>
            ) : mode === 'albums' ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Album Search</div>
                <div style={{ marginBottom: 8 }}>
                  Search Spotify's catalog for albums. Results show the tracklist, release year, and cover art — select the ones you want, then import them all at once.
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6 }}>
                  Audio is sourced from YouTube via yt-dlp. Metadata and cover art come from Spotify. Tracks already in your library are dimmed so you don't re-import duplicates.
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Track Search</div>
                <div style={{ marginBottom: 8 }}>
                  Search Spotify for songs by title, artist, or even lyrics. Check the ones you want, then hit Import to download them into your library.
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6 }}>
                  Audio is sourced from YouTube via yt-dlp and automatically tagged with Spotify metadata and cover art. Use the sort chip above to switch between tracks, albums, and Soulseek.
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Playlist picker. Replaces the old paste-a-URL flow because
            Spotify locked /v1/playlists/{id}/items down to playlists
            the connected user owns or collaborates on (Feb 2026 change).
            Renders only in playlist mode when nothing is already loaded
            for review. Once selectPlaylist() populates playlistData,
            the existing review/import UI further below takes over. */}
        {mode === 'playlist' && !playlistData ? (
          <div>
            {myPlaylistsState === 'loading' ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                Loading your playlists…
              </div>
            ) : null}

            {myPlaylistsState === 'needs-auth' ? (
              <div style={{ padding: '28px 18px', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Playlist Import</div>
                <div style={{ marginBottom: 8 }}>
                  Import entire Spotify playlists into your local library. Immerse will download every track, match metadata, and pull cover art — so your playlists work offline, forever.
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6, marginBottom: 14 }}>
                  To get started, connect your Spotify account in Settings. You'll need a Client ID and Secret (free from Spotify's developer dashboard).
                </div>
                <button type="button" onClick={() => onOpenSettings?.()} style={{ padding: '7px 16px', borderRadius: 9, border: '1px solid rgba(29,185,84,0.35)', background: 'rgba(29,185,84,0.18)', color: '#1db954', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                  Open Settings
                </button>
              </div>
            ) : null}

            {myPlaylistsState === 'error' ? (
              <div style={{ padding: '16px 14px' }}>
                <Banner color="#f37272" bg="rgba(243,114,114,0.1)">
                  {myPlaylistsError || 'Could not load your playlists.'}
                </Banner>
                <button type="button" onClick={loadMyPlaylists} style={{ marginTop: 8, padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#ddd', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
                  Try again
                </button>
              </div>
            ) : null}

            {myPlaylistsState === 'loaded' && myPlaylists.length === 0 ? (
              <div style={{ padding: '24px 18px', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>No Playlists Found</div>
                Your Spotify account doesn't have any playlists yet. Create one in the Spotify app, add some tracks to it, then come back and hit Refresh.
              </div>
            ) : null}

            {myPlaylistsState === 'loaded' && myPlaylists.length > 0 ? (
              <>
                <div style={{ padding: '4px 12px 6px', fontSize: 10, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {(() => {
                    const filtered = q.trim()
                      ? myPlaylists.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
                      : myPlaylists;
                    return q.trim()
                      ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
                      : `${myPlaylists.length} playlist${myPlaylists.length === 1 ? '' : 's'}`;
                  })()}
                </div>
                {(() => {
                  const filtered = q.trim()
                    ? myPlaylists.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
                    : myPlaylists;
                  if (filtered.length === 0) {
                    return (
                      <div style={{ padding: '12px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                        No playlists match "{q.trim()}".
                      </div>
                    );
                  }
                  return filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPlaylist(p.id)}
                      disabled={busy}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', textAlign: 'left',
                        padding: '7px 10px', marginBottom: 2,
                        borderRadius: 8, border: '1px solid transparent',
                        background: 'transparent', color: '#fff',
                        cursor: busy ? 'wait' : 'pointer',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                    >
                      <div style={{
                        width: 40, height: 40, flexShrink: 0,
                        borderRadius: 5, overflow: 'hidden',
                        background: 'rgba(255,255,255,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, color: 'rgba(255,255,255,0.3)',
                      }}>
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : '♪'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.totalTracks} track{p.totalTracks === 1 ? '' : 's'}
                          {p.collaborative ? ' · collab' : ''}
                          {p.owner ? ` · ${p.owner}` : ''}
                        </div>
                      </div>
                    </button>
                  ));
                })()}
              </>
            ) : null}
          </div>
        ) : null}

        {mode === 'tracks' && trackResults.length > 0 ? (
          <>
            {trackResults.length > 1 && !hasSelection ? (
              <button type="button" onClick={selectAllVisible} style={{ margin: '4px 8px 6px', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 10, cursor: 'pointer' }}>
                Select all ({trackResults.length})
              </button>
            ) : null}
            {trackResults.map((row, i) => (
              <TrackRow key={row.spotifyId} row={row} index={i} isHovered={hovered === row.spotifyId} onHover={setHovered}
                isSelected={selected.has(row.spotifyId)} onToggleSelect={() => toggleSelect(row.spotifyId)}
                onImport={() => importSingle(row)} importing={importing} accent={accent} hasSelection={hasSelection}
                isDownloading={downloadingIds.has(row.spotifyId)} isDownloaded={isInLibrary(row)} />
            ))}
          </>
        ) : null}

        {mode === 'albums' && albumResults.length > 0 && !expandedAlbum ? (
          albumResults.map((album) => (
            <div key={album.albumId} onClick={() => expandAlbum(album)}
              onMouseEnter={() => setHovered(album.albumId)} onMouseLeave={() => setHovered(null)}
              style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', alignItems: 'center', gap: 10, padding: '7px 8px', cursor: 'pointer', borderRadius: 9, background: hovered === album.albumId ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
              <div style={{ width: 44, height: 44, borderRadius: 6, overflow: 'hidden', background: '#1a1a1a' }}>
                {album.albumArtUrl ? <img src={album.albumArtUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}><Icons.AlbumSidebar /></div>}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.name}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {album.artists} · {album.totalTracks} {album.totalTracks === 1 ? 'track' : 'tracks'}{album.releaseDate ? ` · ${album.releaseDate.slice(0, 4)}` : ''}
                </div>
              </div>
              <Icons.ChevronRight />
            </div>
          ))
        ) : null}

        {mode === 'albums' && expandedAlbum ? (
          <>
            <button type="button" onClick={() => { setExpandedAlbum(null); setSelected(new Set()); }}
              style={{ margin: '4px 8px 6px', padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><Icons.ChevronRight /></span> Back
            </button>
            <div style={{ padding: '4px 8px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', background: '#1a1a1a', flexShrink: 0 }}>
                {expandedAlbum.albumArtUrl ? <img src={expandedAlbum.albumArtUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{expandedAlbum.album}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{expandedAlbum.artists} · {expandedAlbum.tracks.length} tracks</div>
              </div>
            </div>
            {expandedAlbum.tracks.length > 1 && !hasSelection ? (
              <button type="button" onClick={selectAllVisible} style={{ margin: '0 8px 6px', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 10, cursor: 'pointer' }}>
                Select all ({expandedAlbum.tracks.length})
              </button>
            ) : null}
            {expandedAlbum.tracks.map((row, i) => (
              <TrackRow key={row.spotifyId} row={row} index={i} isHovered={hovered === row.spotifyId} onHover={setHovered}
                isSelected={selected.has(row.spotifyId)} onToggleSelect={() => toggleSelect(row.spotifyId)}
                onImport={() => importSingle(row)} importing={importing} accent={accent} hasSelection={hasSelection}
                isDownloading={downloadingIds.has(row.spotifyId)} isDownloaded={isInLibrary(row)} />
            ))}
          </>
        ) : null}

        {/* Soulseek mode render. */}
        {mode === 'soulseek' ? (
          <SoulseekSection
            albums={slskAlbums}
            tracks={slskTracks}
            expandedId={slskExpandedId}
            setExpandedId={setSlskExpandedId}
            showTracks={slskShowTracks}
            setShowTracks={setSlskShowTracks}
            downloads={slskDownloads}
            albumDownloads={slskAlbumDownloads}
            artByKey={slskArtByKey}
            status={slskStatus}
            importing={importing}
            onDownloadTrack={slskStartDownload}
            onDownloadAlbum={slskStartAlbumDownload}
            onOpenSettings={onOpenSettings}
          />
        ) : null}

        {/* Playlist mode render. */}
        {mode === 'playlist' && playlistData ? (
          <>
            {/* Back-to-picker bar. Disabled mid-import so the user
                doesn't accidentally lose track of an in-flight batch.
                Once the import summary is up (or before import starts),
                it clears playlistData + related state, returning to
                the picker. */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px 8px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              marginBottom: 6,
            }}>
              <button
                type="button"
                onClick={() => {
                  if (playlistImporting) return;
                  setPlaylistData(null);
                  setPlaylistConflicts([]);
                  setPlaylistSkipIds(new Set());
                  setPlaylistProgress({});
                  setPlaylistSummary(null);
                  setPlaylistFailures({});
                  setError('');
                  setOkLine('');
                }}
                disabled={playlistImporting}
                title={playlistImporting ? 'Import in progress — wait for it to finish' : 'Back to your playlists'}
                style={{
                  padding: '4px 10px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)',
                  color: playlistImporting ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
                  fontSize: 11, fontWeight: 600,
                  cursor: playlistImporting ? 'not-allowed' : 'pointer',
                }}
              >
                ← Playlists
              </button>
              <span style={{
                fontSize: 11, color: 'rgba(255,255,255,0.5)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                flex: 1, minWidth: 0,
              }}>
                {playlistData.name}
              </span>
            </div>
            <PlaylistImportSection
              playlist={playlistData}
              conflicts={playlistConflicts}
              skipIds={playlistSkipIds}
              onToggleSkip={togglePlaylistSkip}
              onSelectAll={selectAllPlaylist}
              onDeselectAll={deselectAllPlaylist}
              source={playlistSource}
              setSource={setPlaylistSource}
              progress={playlistProgress}
              summary={playlistSummary}
              importing={playlistImporting}
              onStartImport={startPlaylistImport}
              slskConfigured={slskStatus.configured}
              failures={playlistFailures}
              onPickVideo={(spotifyId) => {
                // Look up the failure record we stashed, hand it to the
                // existing CandidatePickerModal via onShowCandidatePicker.
                // On success we patch our local progress to 'done' and
                // forward the track to onSpotifyImportDone so it shows up
                // in the library tab immediately.
                const fail = playlistFailures[spotifyId];
                if (!fail || !onShowCandidatePicker) return;
                onShowCandidatePicker({
                  candidates: fail.candidates || [],
                  meta: fail.meta,
                  onSuccess: (track) => {
                    setPlaylistProgress((prev) => ({ ...prev, [spotifyId]: 'done' }));
                    setPlaylistFailures((prev) => {
                      const next = { ...prev };
                      delete next[spotifyId];
                      return next;
                    });
                    onSpotifyImportDone?.(track);
                  },
                });
              }}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

/* ---------- Soulseek sidebar section ----------
 *
 * Sidebar-sized sub-view of Soulseek search results. Sized to match the
 * existing FindTab conventions:
 *   - 36px album-art tiles (not 52px)
 *   - 12.5px title, 10.5px meta
 *   - 6-8px paddings throughout
 *   - rgba(255,255,255,0.04) hover, transparent default
 *
 * Renders an album list first, then optionally a track list (toggled
 * via a small text link). Album cards expand inline to show their
 * tracks, same pattern as the Spotify Albums mode in the parent.
 *
 * Connection status, downloads queue, and Spotify cover-art lookups
 * are all handled by the parent FindTab — this component is pure
 * presentation.
 */
function SoulseekSection({
  albums, tracks, expandedId, setExpandedId, showTracks, setShowTracks,
  downloads, albumDownloads, artByKey, status, importing,
  onDownloadTrack, onDownloadAlbum, onOpenSettings,
}) {
  // Build a lookup from rowId → download state for O(1) progress checks
  // per row. Without this, each row would scan the downloads array.
  const downloadByRowId = React.useMemo(() => {
    const m = new Map();
    for (const d of downloads) m.set(d.rowId, d);
    return m;
  }, [downloads]);

  if (!status.configured) {
    return (
      <div style={{ padding: '14px 12px', fontSize: 11, color: 'rgba(255,193,7,0.85)', lineHeight: 1.5 }}>
        Soulseek isn't configured.
        {onOpenSettings ? (
          <>
            {' '}
            <button type="button" onClick={onOpenSettings}
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,193,7,0.95)',
                fontSize: 11, padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>
              Open Settings
            </button>
            {' '}to add your username and password.
          </>
        ) : null}
      </div>
    );
  }

  if (albums.length === 0 && tracks.length === 0) return null;

  return (
    <>
      {/* Albums list — best 10, "best pick" gets a soft accent on its
          download button. */}
      {albums.map((alb, idx) => (
        <SlskAlbumRow
          key={alb.id}
          alb={alb}
          imageUrl={artByKey[alb.id] || null}
          expanded={expandedId === alb.id}
          onToggle={() => setExpandedId(expandedId === alb.id ? '' : alb.id)}
          albumProgress={albumDownloads[alb.id]}
          downloadByRowId={downloadByRowId}
          isBestPick={idx === 0 && (alb.ext === 'flac' || alb.ext === 'wav')}
          importing={importing}
          onDownloadAlbum={onDownloadAlbum}
          onDownloadTrack={onDownloadTrack}
        />
      ))}

      {/* Tracks toggle — only appears if we have BOTH albums and tracks.
          When albums are empty, tracks render unconditionally below. */}
      {albums.length > 0 && tracks.length > 0 ? (
        <button type="button"
          onClick={() => setShowTracks((v) => !v)}
          style={{ margin: '6px 8px 4px', padding: '4px 10px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'transparent', color: 'rgba(255,255,255,0.5)',
            fontSize: 10, cursor: 'pointer' }}>
          {showTracks ? `Hide ${tracks.length} individual tracks` : `Show ${tracks.length} individual tracks`}
        </button>
      ) : null}

      {/* Tracks list — shown when toggled on OR when there are no
          albums (no point hiding when nothing else is there). */}
      {tracks.length > 0 && (showTracks || albums.length === 0) ? (
        tracks.map((row) => (
          <SlskTrackRow
            key={row.id}
            row={row}
            download={downloadByRowId.get(row.id)}
            importing={importing}
            onDownload={onDownloadTrack}
          />
        ))
      ) : null}
    </>
  );
}

/* ---------- Soulseek album row (sidebar-sized) ---------- */

function SlskAlbumRow({ alb, imageUrl, expanded, onToggle, albumProgress, downloadByRowId,
                       isBestPick, importing, onDownloadAlbum, onDownloadTrack }) {
  const isDownloading = albumProgress && albumProgress.state === 'downloading';
  const isDone = albumProgress && albumProgress.state === 'done';
  const isFailed = albumProgress && albumProgress.state === 'failed';
  const pct = albumProgress && albumProgress.total
    ? Math.round((albumProgress.completed / albumProgress.total) * 100) : 0;

  return (
    <div style={{ marginBottom: 2 }}>
      <div onClick={onToggle}
        style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', alignItems: 'center',
          gap: 8, padding: '6px 8px', borderRadius: 9, cursor: 'pointer',
          background: expanded ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
        <SlskTileSmall name={alb.displayName} imageUrl={imageUrl} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alb.displayName}</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {alb.mixedBitrates ? 'Mixed' : (formatSlskBitrate(alb.bitrate, alb.ext) || '')}
            {alb.mixedBitrates || formatSlskBitrate(alb.bitrate, alb.ext) ? ' · ' : ''}
            {alb.trackCount} tracks
            {alb.totalSize ? ` · ${formatSlskBytes(alb.totalSize)}` : ''}
            {' · '}
            <span style={{ color: alb.slots ? 'rgba(120,200,150,0.85)' : 'rgba(160,160,160,0.6)' }}>
              {alb.slots ? '●' : '○'} {alb.slots ? 'Free' : 'Queued'}
            </span>
          </div>
        </div>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onDownloadAlbum(alb); }}
          disabled={importing || isDownloading}
          style={{
            padding: '7px 12px', borderRadius: 9,
            border: isFailed
              ? '1px solid rgba(243,114,114,0.3)'
              : isBestPick && !isDone && !isDownloading
                ? '1px solid rgba(120,200,150,0.3)'
                : '1px solid rgba(255,255,255,0.08)',
            background: isDone ? 'rgba(120,200,150,0.18)'
              : isFailed ? 'rgba(243,114,114,0.15)'
              : isDownloading ? 'rgba(120,200,150,0.1)'
              : isBestPick ? 'rgba(120,200,150,0.14)'
              : 'rgba(255,255,255,0.04)',
            color: isDone ? 'rgba(120,200,150,0.95)'
              : isFailed ? 'rgba(243,114,114,0.95)'
              : isDownloading ? 'rgba(120,200,150,0.85)'
              : isBestPick ? 'rgba(120,200,150,0.95)'
              : 'rgba(255,255,255,0.85)',
            fontSize: 10.5, fontWeight: 600,
            cursor: (importing || isDownloading) ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}>
          {isDone ? '✓' : isFailed ? 'Retry'
            : isDownloading ? `${pct}%` : 'Get'}
        </button>
      </div>

      {/* Per-album progress when downloading. */}
      {isDownloading || isFailed ? (
        <div style={{ padding: '0 12px 4px' }}>
          <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`,
              background: isFailed ? 'rgba(243,114,114,0.6)' : 'rgba(120,200,150,0.7)',
              transition: 'width 0.2s ease' }} />
          </div>
          {albumProgress?.currentFile ? (
            <div style={{ marginTop: 3, fontSize: 9.5, color: 'rgba(255,255,255,0.45)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isFailed ? albumProgress.error : albumProgress.currentFile}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Expanded track list. */}
      {expanded ? (
        <div style={{ padding: '2px 8px 8px 50px' }}>
          {alb.tracks.map((t) => {
            const dl = downloadByRowId.get(t.id);
            const tDone = dl && dl.state === 'done';
            const tBusy = dl && (dl.state === 'queued' || dl.state === 'downloading');
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0', fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>
                <div style={{ flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.filename}</div>
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onDownloadTrack(t); }}
                  disabled={tBusy}
                  style={{
                    padding: '2px 8px', borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: tDone ? 'rgba(120,200,150,0.15)'
                      : tBusy ? 'rgba(120,200,150,0.08)'
                      : 'rgba(255,255,255,0.04)',
                    color: tDone ? 'rgba(120,200,150,0.9)'
                      : tBusy ? 'rgba(120,200,150,0.8)'
                      : 'rgba(255,255,255,0.75)',
                    fontSize: 9.5, fontWeight: 500,
                    cursor: tBusy ? 'wait' : 'pointer',
                    minWidth: 38, textAlign: 'center',
                  }}>
                  {tDone ? '✓' : tBusy ? `${Math.round((dl.progress || 0) * 100)}%` : 'Get'}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Soulseek track row (sidebar-sized, standalone) ---------- */

function SlskTrackRow({ row, download, importing, onDownload }) {
  const isDownloading = download && (download.state === 'queued' || download.state === 'downloading');
  const isDone = download && download.state === 'done';
  const isFailed = download && download.state === 'failed';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', alignItems: 'center',
      gap: 8, padding: '6px 8px', borderRadius: 9 }}>
      <SlskTileSmall name={row.filename} imageUrl={null} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: '#fff',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.filename}</div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formatSlskBitrate(row.bitrate, row.ext) || ''}
          {formatSlskBitrate(row.bitrate, row.ext) ? ' · ' : ''}
          {formatSlskBytes(row.size)}
          {' · '}
          <span style={{ color: row.slots ? 'rgba(120,200,150,0.85)' : 'rgba(160,160,160,0.6)' }}>
            {row.slots ? '●' : '○'} {row.slots ? 'Free' : 'Queued'}
          </span>
        </div>
      </div>
      <button type="button"
        onClick={() => onDownload(row)}
        disabled={importing || isDownloading}
        title={isFailed ? download.error : ''}
        style={{
          padding: '7px 12px', borderRadius: 9,
          border: isFailed ? '1px solid rgba(243,114,114,0.3)' : '1px solid rgba(255,255,255,0.08)',
          background: isDone ? 'rgba(120,200,150,0.18)'
            : isFailed ? 'rgba(243,114,114,0.15)'
            : isDownloading ? 'rgba(120,200,150,0.1)'
            : 'rgba(255,255,255,0.04)',
          color: isDone ? 'rgba(120,200,150,0.95)'
            : isFailed ? 'rgba(243,114,114,0.95)'
            : isDownloading ? 'rgba(120,200,150,0.85)'
            : 'rgba(255,255,255,0.85)',
          fontSize: 10.5, fontWeight: 600,
          cursor: (importing || isDownloading) ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}>
        {isDone ? '✓' : isFailed ? 'Retry'
          : isDownloading ? `${Math.round((download.progress || 0) * 100)}%`
          : 'Get'}
      </button>
    </div>
  );
}

/* ---------- Soulseek tile (36px, like Spotify Find tab tiles) ---------- */

function SlskTileSmall({ name, imageUrl }) {
  // Hash-derived gradient as fallback for albums without Spotify match.
  const h = (() => {
    let x = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) {
      x = ((x << 5) - x) + s.charCodeAt(i);
      x |= 0;
    }
    return Math.abs(x);
  })();
  const gradient = `linear-gradient(135deg, hsl(${h % 360}, ${25 + h % 15}%, ${22 + (h >> 4) % 8}%), hsl(${(h + 35) % 360}, ${25 + h % 15}%, ${28 + (h >> 8) % 10}%))`;
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 5, overflow: 'hidden',
      background: gradient, position: 'relative', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(255,255,255,0.3)', fontSize: 15,
    }}>
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : '♪'}
    </div>
  );
}

/* ---------- Soulseek formatters (scoped here to keep section self-contained) ---------- */

function formatSlskBytes(n) {
  if (!n || n <= 0) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function formatSlskBitrate(b, ext) {
  if ((!b || b <= 0) && (ext === 'flac' || ext === 'wav')) return ext.toUpperCase();
  if (!b || b <= 0) return '';
  return `${b}k`;
}

/* ---------- Playlist import section ----------
 *
 * Three states visible to the user:
 *   1. PRE-IMPORT: playlist metadata + tracks list with conflict markers
 *      and skip checkboxes. Source toggle (yt-dlp / Soulseek). Import
 *      button starts the batch.
 *   2. DURING IMPORT: same track list, but each row shows a status dot
 *      (queued / downloading / done / failed). Import button disabled.
 *   3. POST-IMPORT: summary banner at top showing N/M succeeded, with
 *      failures expandable. Tracks list still visible underneath with
 *      final states.
 *
 * Sized to match the rest of FindTab (36px tile, 12.5/10.5 fonts,
 * 6-8px padding).
 */
function PlaylistImportSection({
  playlist, conflicts, skipIds, onToggleSkip, onSelectAll, onDeselectAll, source, setSource,
  progress, summary, importing, onStartImport, slskConfigured,
  failures, onPickVideo,
}) {
  const conflictIds = React.useMemo(() => {
    const s = new Set();
    for (const c of conflicts) s.add(c.spotifyId);
    return s;
  }, [conflicts]);

  const skipCount = skipIds.size;
  const importCount = playlist.tracks.length - skipCount;

  return (
    <>
      {/* Playlist header */}
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 10,
        padding: '8px 8px 6px', alignItems: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 6, overflow: 'hidden',
          background: '#1a1a1a', flexShrink: 0 }}>
          {playlist.imageUrl ? (
            <img src={playlist.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 18 }}>♪</div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {playlist.name}
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {playlist.owner ? `${playlist.owner} · ` : ''}{playlist.totalTracks} tracks
            {conflicts.length > 0 ? ` · ${conflicts.length} already in library` : ''}
          </div>
        </div>
      </div>

      {/* Summary banner (post-import). */}
      {summary ? (
        <div style={{ margin: '4px 8px 8px', padding: '8px 10px', borderRadius: 8,
          background: 'rgba(120,200,150,0.08)', border: '1px solid rgba(120,200,150,0.15)',
          fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: 'rgba(120,200,150,0.95)', fontWeight: 600 }}>
              ✓ {summary.completed} imported
            </span>
            {summary.failed > 0 ? (
              <span style={{ color: 'rgba(243,114,114,0.85)' }}>
                × {summary.failed} failed
              </span>
            ) : null}
            {summary.skipped > 0 ? (
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                — {summary.skipped} skipped
              </span>
            ) : null}
          </div>
          {summary.failures?.length ? (
            <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(243,114,114,0.7)',
              maxHeight: 80, overflowY: 'auto' }}>
              {summary.failures.slice(0, 5).map((f) => (
                <div key={f.spotifyId} style={{ overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.error}
                </div>
              ))}
              {summary.failures.length > 5 ? (
                <div>+{summary.failures.length - 5} more</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Source toggle + import button. Hidden during/after the
          import — user can't change source mid-flight. */}
      {!summary && !importing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px 10px' }}>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            <MiniToggle active={source === 'ytdlp'} onClick={() => setSource('ytdlp')}>
              YouTube
            </MiniToggle>
            <MiniToggle active={source === 'soulseek'} onClick={() => slskConfigured && setSource('soulseek')}>
              Soulseek
            </MiniToggle>
          </div>
          <button type="button"
            onClick={onStartImport}
            disabled={importCount === 0 || (source === 'soulseek' && !slskConfigured)}
            style={{
              padding: '6px 12px', borderRadius: 8,
              border: '1px solid rgba(120,200,150,0.3)',
              background: 'rgba(120,200,150,0.14)',
              color: 'rgba(120,200,150,0.95)',
              fontSize: 11, fontWeight: 600,
              cursor: importCount === 0 ? 'not-allowed' : 'pointer',
              opacity: importCount === 0 ? 0.4 : 1,
              whiteSpace: 'nowrap',
            }}>
            Import {importCount}
          </button>
        </div>
      ) : null}

      {source === 'soulseek' && !slskConfigured && !importing && !summary ? (
        <div style={{ padding: '4px 12px 8px', fontSize: 10.5, color: 'rgba(255,193,7,0.85)' }}>
          Soulseek isn't configured. Configure in Settings, or use YouTube.
        </div>
      ) : null}

      {/* Selection controls — only meaningful pre-import. Lets the user clear
          the whole list and cherry-pick, or restore the default selection. */}
      {!summary && !importing ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px 8px', gap: 8 }}>
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
            {importCount} of {playlist.tracks.length} selected
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" onClick={onSelectAll} disabled={skipCount === conflicts.length}
              style={{
                padding: '4px 9px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)',
                background: 'transparent', color: 'rgba(255,255,255,0.6)',
                fontSize: 10.5, fontWeight: 600, lineHeight: 1,
                cursor: skipCount === conflicts.length ? 'default' : 'pointer',
                opacity: skipCount === conflicts.length ? 0.4 : 1,
                whiteSpace: 'nowrap', transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { if (skipCount !== conflicts.length) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
              Select all
            </button>
            <button type="button" onClick={onDeselectAll} disabled={importCount === 0}
              style={{
                padding: '4px 9px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)',
                background: 'transparent', color: 'rgba(255,255,255,0.6)',
                fontSize: 10.5, fontWeight: 600, lineHeight: 1,
                cursor: importCount === 0 ? 'default' : 'pointer',
                opacity: importCount === 0 ? 0.4 : 1,
                whiteSpace: 'nowrap', transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { if (importCount !== 0) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
              Deselect all
            </button>
          </div>
        </div>
      ) : null}

      {/* Track list with per-track state */}
      <div>
        {playlist.tracks.map((t, idx) => {
          const isConflict = conflictIds.has(t.spotifyId);
          const isSkipped = skipIds.has(t.spotifyId);
          const state = progress[t.spotifyId];
          // Visual state precedence: in-flight progress > skipped > conflict.
          const showState = state || (isSkipped ? 'skipped' : null);
          return (
            <div key={t.spotifyId} style={{
              display: 'grid',
              gridTemplateColumns: '22px 36px 1fr auto',
              alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 9,
              opacity: isSkipped && !state ? 0.5 : 1,
            }}>
              {/* Skip checkbox — only meaningful during pre-import */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Checkbox
                  checked={!isSkipped}
                  disabled={importing || !!summary}
                  onChange={() => onToggleSkip(t.spotifyId)}
                  title={isConflict ? 'Already in library' : ''}
                />
              </div>
              {/* Album art */}
              <div style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden',
                background: '#1a1a1a', flexShrink: 0 }}>
                {t.albumArtUrl ? (
                  <img src={t.albumArtUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : null}
              </div>
              {/* Title + artist */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.title || '(no title)'}
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.artists}
                  {isConflict && !state ? (
                    <span style={{ color: 'rgba(255,193,7,0.8)', marginLeft: 6 }}>· In library</span>
                  ) : null}
                </div>
              </div>
              {/* State indicator. For failed rows with picker data
                  available, render a "Pick video" button instead of
                  the plain × — gives the user a recovery path without
                  having to leave the playlist view. */}
              <div style={{ textAlign: 'center', fontSize: 12 }}>
                {showState === 'done' ? (
                  <span style={{ color: 'rgba(120,200,150,0.95)' }}>✓</span>
                ) : showState === 'failed' ? (
                  failures && failures[t.spotifyId] ? (
                    <button
                      type="button"
                      onClick={() => onPickVideo?.(t.spotifyId)}
                      title={failures[t.spotifyId].error || 'Pick a YouTube video for this track'}
                      style={{
                        padding: '3px 9px', borderRadius: 7,
                        border: '1px solid rgba(243,114,114,0.4)',
                        background: 'rgba(243,114,114,0.12)',
                        color: 'rgba(243,114,114,0.95)',
                        fontSize: 10.5, fontWeight: 600,
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      Pick video
                    </button>
                  ) : (
                    <span style={{ color: 'rgba(243,114,114,0.85)' }} title="Failed">×</span>
                  )
                ) : showState === 'starting' ? (
                  <span style={{ color: 'rgba(120,200,150,0.7)' }}>…</span>
                ) : showState === 'skipped' ? (
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Custom checkbox matching Immerse's dark UI conventions. Native HTML
 * <input type="checkbox"> looks foreign on most OSes (we got reports of
 * a sad grey square on Ubuntu), so this renders a styled <button>
 * instead — same role, same keyboard semantics, but consistent visuals
 * across platforms.
 *
 * Sized 14×14 by default to roughly match where the native checkboxes
 * used to sit. The accent green matches the rest of the import-flow
 * buttons (rgba(29,185,84,...)).
 */
function Checkbox({ checked, onChange, disabled = false, size = 14, title = '' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(); }}
      disabled={disabled}
      title={title}
      style={{
        width: size, height: size,
        boxSizing: 'border-box',
        padding: 0, margin: 0,
        display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        borderRadius: 4,
        border: checked
          ? '1px solid rgba(29,185,84,0.7)'
          : '1px solid rgba(255,255,255,0.25)',
        background: checked
          ? 'rgba(29,185,84,0.85)'
          : 'rgba(0,0,0,0.25)',
        color: '#000',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 80ms ease, border-color 80ms ease',
      }}
    >
      {checked ? (
        // Inline SVG checkmark — sharper than a unicode "✓" at this size
        // and won't get OS font substituted into something silly.
        <svg width={size - 4} height={size - 4} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.5 L5 9 L9.5 3.5" stroke="#000" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

function MiniToggle({ children, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ flex: 1, padding: '5px 6px', borderRadius: 8, border: 'none', background: active ? 'rgba(255,255,255,0.08)' : 'transparent', color: active ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

function TrackRow({ row, index, isHovered, onHover, isSelected, onToggleSelect, onImport, importing, accent, hasSelection, isDownloading, isDownloaded }) {
  const number = String(index + 1).padStart(2, '0');
  const downloaded = isDownloaded && !isDownloading;
  return (
    <div onMouseEnter={() => onHover(row.spotifyId)} onMouseLeave={() => onHover(null)}
      style={{ display: 'grid', gridTemplateColumns: hasSelection ? '22px 22px 36px 1fr auto' : '22px 36px 1fr auto', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 9, opacity: downloaded ? 0.45 : 1, background: isSelected ? `rgba(${accent},0.18)` : isHovered && !downloaded ? 'rgba(255,255,255,0.04)' : 'transparent', transition: 'opacity 0.2s ease' }}>
      {hasSelection ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Checkbox checked={isSelected} onChange={onToggleSelect} disabled={downloaded} />
        </div>
      ) : null}
      <div style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{number}</div>
      <div style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a', flexShrink: 0 }}>
        {row.albumArtUrl ? <img src={row.albumArtUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}><Icons.AlbumSidebar /></div>}
      </div>
      <div style={{ minWidth: 0 }} onClick={() => { if (!hasSelection && !downloaded) onToggleSelect(); }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: downloaded ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: hasSelection || downloaded ? 'default' : 'pointer' }}>{row.title}</div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {downloaded ? (
            <span style={{ color: 'rgba(29,185,84,0.7)', fontWeight: 500 }}>In library</span>
          ) : (
            <>{row.artists}{row.durationMs ? ` · ${formatDurationMs(row.durationMs)}` : ''}</>
          )}
        </div>
      </div>
      {downloaded ? (
        <div title="Already in library" style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'rgba(29,185,84,0.5)', fontSize: 13 }}>
          ✓
        </div>
      ) : isDownloading ? (
        <div title="Downloading…" style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid rgba(29,185,84,0.3)', background: 'rgba(29,185,84,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'findtab-spin 1s linear infinite' }}>
            <circle cx="7" cy="7" r="5.5" fill="none" stroke="rgba(29,185,84,0.3)" strokeWidth="1.5" />
            <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" fill="none" stroke="#1db954" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <style>{`@keyframes findtab-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <button type="button" onClick={(e) => { e.stopPropagation(); hasSelection ? onToggleSelect() : onImport(); }} disabled={false}
          title={hasSelection ? (isSelected ? 'Deselect' : 'Select') : 'Download & add to library'}
          style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: isSelected ? `rgba(${accent},0.3)` : isHovered ? 'rgba(29,185,84,0.2)' : 'rgba(255,255,255,0.04)', color: isSelected ? '#1db954' : isHovered ? '#1db954' : 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
          {hasSelection ? (isSelected ? '✓' : '') : '+'}
        </button>
      )}
    </div>
  );
}


export { FindTab, SoulseekSection, SlskAlbumRow, SlskTrackRow, SlskTileSmall, PlaylistImportSection, Checkbox, MiniToggle, TrackRow };
