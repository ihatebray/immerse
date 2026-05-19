import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useContext, startTransition } from 'react';
import Icons from './Icons.jsx';
import { sampleCoverTheme } from './coverTheme.js';
import { presetsGrouped, presetById, getCustomFonts, setCustomFonts, loadGoogleFontForPreset } from './uiFonts.js';

const titleCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Display labels for the sort menu — also defines the menu's order. */
const SORT_LABELS = {
  aToZ: 'Title (A–Z)',
  zToA: 'Title (Z–A)',
  recentlyAdded: 'Recently added',
  oldestFirst: 'Oldest first',
  recentlyPlayed: 'Recently played',
  mostPlayed: 'Most played',
  longest: 'Longest',
  shortest: 'Shortest',
  year: 'Year (newest)',
  favorites: 'Favorites first',
};

function formatTime(s) {
  if (!s || Number.isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function formatDurationMs(ms) {
  if (!ms || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Parse LRC "[mm:ss.xx] text" into sorted array of { time, text }. */
/**
 * Parse an LRC-format synced lyrics string into a sorted array of
 * { time, text } records. Handles the common LRC features:
 *
 *   - Standard timestamps: [mm:ss.xx] or [mm:ss.xxx]
 *   - Multi-timestamp lines (a line repeated at different times):
 *       [00:12.00][00:54.00][01:36.00] Chorus
 *     Each timestamp is treated as its own occurrence of the line —
 *     critical for choruses, otherwise repeated lines get dropped and
 *     the active-line lookup jumps minutes ahead of where it should be.
 *   - Global offset metadata tag: [offset:NNNN] (milliseconds, signed)
 *     Applied uniformly to every timestamp. Common in karaoke files
 *     to nudge the whole sync earlier/later without re-stamping.
 *
 * Bracketed metadata tags like [ti:Title], [ar:Artist], [length:NNN]
 * are silently skipped — they're not timestamps.
 */
function parseLRC(lrc) {
  if (!lrc) return [];
  const lines = [];
  // Global offset (in seconds, signed). LRC stores it as ms.
  let offsetSec = 0;
  // Match a single timestamp anywhere: capture min, sec, optional ms.
  const tsRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  // Match the offset metadata tag: [offset:+250] or [offset:-1000].
  const offsetRegex = /^\[offset:\s*([+-]?\d+)\s*\]/i;

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Offset metadata — single line, parsed once and applied to all
    // subsequent timestamps. Negative = lyrics appear earlier.
    const om = trimmed.match(offsetRegex);
    if (om) {
      offsetSec = -Number(om[1]) / 1000;  // convention: positive offset = delay lyrics, so subtract
      continue;
    }

    // Find ALL timestamps in this line. If at least one is found,
    // the rest of the line (after the last timestamp) is the lyric
    // text — emit one record per timestamp.
    const timestamps = [];
    let m;
    tsRegex.lastIndex = 0;
    while ((m = tsRegex.exec(trimmed)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
      timestamps.push(min * 60 + sec + frac + offsetSec);
    }
    if (timestamps.length === 0) continue;
    // Lyric text starts immediately after the last timestamp's
    // closing bracket.
    let textStart = 0;
    tsRegex.lastIndex = 0;
    while ((m = tsRegex.exec(trimmed)) !== null) {
      textStart = m.index + m[0].length;
    }
    const text = trimmed.slice(textStart).trim();
    // Drop empty-text lines (silence markers) — they cause empty
    // rows in the rendered lyrics that look like layout glitches.
    // The previous-line text carries forward visually anyway, which
    // is the desired behaviour during instrumental gaps.
    if (!text) continue;
    for (const t of timestamps) {
      lines.push({ time: t, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Find the index of the active line for the given playback time. */
function activeLyricIndex(lines, time) {
  if (!lines.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= time + 0.15) idx = i;
    else break;
  }
  return idx;
}

/**
 * Sort a stamped-lines array for the tap-to-sync editor.
 * Stamped lines (time !== null) float to the top, sorted by time ascending.
 * Unstamped lines (time === null) stay at the bottom in their original order.
 * This keeps the list in playback order so choruses/verse repeats display
 * correctly as the user works through the song.
 */
function sortStampedLines(lines) {
  const stamped = lines.filter((l) => l.time !== null).sort((a, b) => a.time - b.time);
  const unstamped = lines.filter((l) => l.time === null);
  return [...stamped, ...unstamped];
}

/** Lyrics icon (microphone / karaoke). */
function LyricsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

export default function ImmersiveLibraryPage({
  library,
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  shuffleOn,
  repeat,
  importing,
  setImporting,
  uiFontId,
  onSetUiFontId,
  uiFontStack,
  spotifyCredsRefreshKey,
  onSpotifyCredsSaved,
  onPlayTrack,
  onPlayPauseTrack,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onToggleRepeat,
  onSeek,
  onSetVolume,
  gainBoost = 1,
  onSetGainBoost,
  isMaximized = false,
  onImportFiles,
  onImportFolder,
  onSpotifyImportDone,
  onRemoveFromLibrary,
  onUpdateTrackMetadata,
  onUpdateAlbumMetadata,
  playlists = [],
  onCreatePlaylist,
  onUpdatePlaylist,
  onDeletePlaylist,
  onAddTracksToPlaylist,
  onRemoveTracksFromPlaylist,
  onLoadPlaylistTracks,
  hasEverPlayed = false,
  animateGradient = true,
  onSetAnimateGradient,
  beatReactive = false,
  onSetBeatReactive,
  coverFullscreenEnabled = true,
  onSetCoverFullscreenEnabled,
  pinnableTabsEnabled = false,
  onSetPinnableTabsEnabled,
  hiddenTabIds = [],
  onSetHiddenTabIds,
  dockCollapseAnimationEnabled = false,
  onSetDockCollapseAnimationEnabled,
  randomButtonEnabled = false,
  onSetRandomButtonEnabled,
  onPlayRandom,
  breathingDockPillEnabled = false,
  onSetBreathingDockPillEnabled,
  dockTransparentEnabled = false,
  onSetDockTransparentEnabled,
  liquidGlassDockEnabled = false,
  onSetLiquidGlassDockEnabled,
  journalTabEnabled = false,
  onSetJournalTabEnabled,
  queuePainterEnabled = false,
  onSetQueuePainterEnabled,
  recentPeekEnabled = true,
  onSetRecentPeekEnabled,
  recentPeekRange = '5',
  onSetRecentPeekRange,
  recentPeekCustomCount = 15,
  onSetRecentPeekCustomCount,
  firstTimeSparkleEnabled = false,
  onSetFirstTimeSparkleEnabled,
  trackOfMomentEnabled = false,
  onSetTrackOfMomentEnabled,
  clickToFilterEnabled = false,
  onSetClickToFilterEnabled,
  artistInfoEnabled = false,
  onSetArtistInfoEnabled,
  lastFmApiKey = '',
  onSetLastFmApiKey,
  creditsEnabled = false,
  onSetCreditsEnabled,
  videosEnabled = false,
  onSetVideosEnabled,
  edgeBleedEnabled = false,
  onSetEdgeBleedEnabled,
  ambientMode = 'idle',
  onSetAmbientMode,
  ambientCustomDelaySec = 30,
  onSetAmbientCustomDelaySec,
  twoPaneEnabled = false,
  onSetTwoPaneEnabled,
  discordPresenceEnabled = false,
  onSetDiscordPresenceEnabled,
  discordAppId = '',
  onSetDiscordAppId,
  imgbbApiKey = '',
  onSetImgbbApiKey,
  onReloadLibrary,
  panelResizableEnabled = false,
  onSetPanelResizableEnabled,
  dockDraggableEnabled = false,
  onSetDockDraggableEnabled,
  panelWidth = 340,
  onSetPanelWidth,
  dockPosition = null,
  onSetDockPosition,
  playEvents = [],
  onResetStats,
  statsRangeTabsEnabled = true,
  onSetStatsRangeTabsEnabled,
  analyserRef,
  ensureAnalyser,
  onToggleFavorite,
  queue = [],
  currentIndex = -1,
  onAddToQueue,
  onPlayNext,
  onRemoveFromQueue,
  onReorderQueue,
  onClearUpNext,
  onJumpToQueueIndex,
  releases = [],
  followedArtists = [],
  followOverrides = [],
  releasesRefreshing = false,
  onRefreshReleases,
  onAddFollowedArtist,
  onExcludeFollowedArtist,
  onClearFollowedArtistOverride,
  onClearLibrary,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [hovered, setHovered] = useState(null);

  // Dock layout: a thin always-visible NavRail (40px) on one side of the
  // window, and a content Panel that slides in/out from the rail. The rail
  // holds tab icons and a panel-toggle button; the panel holds whatever
  // tab's content (Library/Find/New/Settings).
  //
  // dockSide = which edge the rail+panel live against ('left' or 'right').
  //            Persisted in localStorage so the user's choice survives
  //            restarts. Defaults to 'right' (matches the previous SideDock
  //            position so existing users aren't disoriented).
  // dockPanelOpen = whether the panel is expanded (rail is always visible).
  //                Default: false on cold start (welcome screen feels
  //                cleaner without it; click any tab icon to open).
  const [dockSide, setDockSide] = useState(() => {
    if (typeof window === 'undefined') return 'right';
    return localStorage.getItem('immerse:dockSide') === 'left' ? 'left' : 'right';
  });
  const updateDockSide = useCallback((v) => {
    setDockSide(v);
    if (typeof window !== 'undefined') {
      localStorage.setItem('immerse:dockSide', v);
    }
  }, []);
  const [dockPanelOpen, setDockPanelOpen] = useState(false);
  // Legacy alias for places that still read 'dockCollapsed'. Inverted
  // because "not open" === "collapsed" in the old mental model.
  const dockCollapsed = !dockPanelOpen;
  const setDockCollapsed = (val) => {
    if (typeof val === 'function') setDockPanelOpen((prev) => !val(!prev));
    else setDockPanelOpen(!val);
  };

  const [dockTab, setDockTab] = useState('library'); // 'library' | 'find' | 'new' | 'settings' | 'stats' | 'queue' | 'journal' | 'playlist:<id>'

  // If the user hides the active tab via the pinnable-tabs feature, fall
  // back to 'library' so they're not stranded looking at a tab that no
  // longer has a button. Only kicks in when pinnable tabs are enabled.
  useEffect(() => {
    if (!pinnableTabsEnabled) return;
    if (Array.isArray(hiddenTabIds) && hiddenTabIds.includes(dockTab)) {
      setDockTab('library');
    }
  }, [pinnableTabsEnabled, hiddenTabIds, dockTab]);

  // --- Pinnable-tabs right-click popover -----------------------------------
  // Owned at page level so a single popover can serve clicks from either the
  // BottomDockBar or the (currently-unused-but-still-defined) NavRail. The
  // popover renders at page-root z-index above everything else.
  // Shape: { tabId, x, y } | null
  const [dockTabMenu, setDockTabMenu] = useState(null);

  // 'library' is the home base; 'settings' is the only path back from a
  // mistakenly-hidden state. Both are intentionally un-hideable.
  const isTabHideable = useCallback((id) => id !== 'library' && id !== 'settings', []);

  // Right-click handler factory. Returns undefined when the feature is off,
  // letting the browser fall back to its default behaviour. When the feature
  // is on but the tab is protected, also returns undefined.
  const handleTabContextMenu = useCallback((id) => {
    if (!pinnableTabsEnabled) return undefined;
    if (!isTabHideable(id)) return undefined;
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDockTabMenu({ tabId: id, x: e.clientX, y: e.clientY });
    };
  }, [pinnableTabsEnabled, isTabHideable]);

  // Append the menu's target tab to the hidden list (idempotent).
  const handleHideTabFromMenu = useCallback(() => {
    if (!dockTabMenu) return;
    const id = dockTabMenu.tabId;
    setDockTabMenu(null);
    if (!isTabHideable(id)) return;
    const next = Array.isArray(hiddenTabIds) ? hiddenTabIds : [];
    if (next.includes(id)) return;
    onSetHiddenTabIds?.([...next, id]);
  }, [dockTabMenu, hiddenTabIds, onSetHiddenTabIds, isTabHideable]);

  // Outside-click + Escape dismissal for the popover.
  useEffect(() => {
    if (!dockTabMenu) return undefined;
    const onDoc = () => setDockTabMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setDockTabMenu(null); };
    // Defer listener attachment by a tick so the contextmenu event that
    // opened the popover doesn't fire mousedown that would immediately
    // close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [dockTabMenu]);

  // Manual-pick modal state — opens when an automatic import fails because
  // no candidate satisfied the tier rules. The modal surfaces the top
  // YouTube candidates so the user can pick one explicitly.
  // Shape: { candidates: [...], meta: {original Spotify metadata}, onSuccess: fn }
  // The onSuccess callback is what the ORIGINAL import call site wants to
  // run with the final track (e.g. setDownloadedIds for the Find tab) —
  // we capture it so the modal can complete the same flow as a normal hit.
  const [pickerState, setPickerState] = useState(null);

  // Right-click context menu state. Lives at the page root so menus can
  // overlay every region of the UI (lists, dock panel, now-playing canvas).
  // Shape: { x: number, y: number, items: [...] } | null
  const [contextMenu, setContextMenu] = useState(null);

  // Right-click menus enabled setting. Default: true (standard expectation).
  // Stored in localStorage so it persists without DB cost.
  const [contextMenusEnabled, setContextMenusEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('immerse:contextMenus') !== '0';
  });
  const updateContextMenusEnabled = useCallback((v) => {
    setContextMenusEnabled(v);
    if (typeof window !== 'undefined') {
      if (v) localStorage.removeItem('immerse:contextMenus'); // default = on
      else localStorage.setItem('immerse:contextMenus', '0');
    }
    // Close any open menu when disabling
    if (!v) setContextMenu(null);
  }, []);

  /**
   * Open a context menu at the given event's coordinates with the given
   * item list. Suppresses the browser's native context menu via
   * preventDefault. No-ops if the user has disabled right-click menus
   * in Settings.
   *
   * Also stashes the click coordinates so menu items that open follow-up
   * popovers (like Add to playlist) can anchor themselves near the click
   * that triggered the menu.
   */
  const lastContextMenuPosRef = useRef(null);
  const openContextMenu = useCallback((event, items) => {
    if (!contextMenusEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    lastContextMenuPosRef.current = { x: event.clientX, y: event.clientY };
    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }, [contextMenusEnabled]);

  /**
   * Open the manual-pick modal with the given candidates. The original call
   * site provides the metadata (so we can re-import with the correct title /
   * album / explicit flag) and an onSuccess callback that handles whatever
   * UI bookkeeping the call site needs (mark as downloaded, add to library
   * state, etc).
   */
  const showCandidatePicker = useCallback(({ candidates, meta, onSuccess }) => {
    setPickerState({ candidates: candidates || [], meta: meta || {}, onSuccess });
  }, []);
  const [search, setSearch] = useState('');

  /** Filter the library by an arbitrary text query and open the library tab.
   * Used by the click-to-filter feature on artist / album names. Trims and
   * normalizes the input but does not lowercase here — the search filter
   * itself does the case-insensitive match. */
  const handleFilterByText = useCallback((text) => {
    if (!clickToFilterEnabled) return;
    const q = (text || '').trim();
    if (!q) return;
    setSearch(q);
    setDockTab('library');
    setDockPanelOpen(true);
  }, [clickToFilterEnabled]);
  // Track id currently being edited — renders the MetadataEditor overlay
  const [editingTrackId, setEditingTrackId] = useState(null);
  // Album + optional disc-number scope being edited — renders AlbumMetadataEditor
  const [editingAlbumScope, setEditingAlbumScope] = useState(null);
  // Playlist being created or edited — null | 'new' | <playlist-id>
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  // If non-null, after creating a new playlist we'll also add these tracks to it
  const [pendingTracksForNewPlaylist, setPendingTracksForNewPlaylist] = useState(null);
  // Add-to-playlist popover state: { trackIds, anchorRect } or null
  const [addMenu, setAddMenu] = useState(null);
  // Tracks for the currently-open playlist view — loaded on demand
  const [openPlaylistTracks, setOpenPlaylistTracks] = useState([]);
  const [openPlaylistId, setOpenPlaylistId] = useState(null);
  const [themeRgb, setThemeRgb] = useState({
    accent: '48, 48, 48', wash: '10, 10, 10', mid: '12, 12, 12', deep: '0, 0, 0',
  });

  // --- Lyrics ---
  const [lyricsVisible, setLyricsVisible] = useState(true);
  const [lyricsData, setLyricsData] = useState(null); // { synced: [{time,text}], plain: string|null, instrumental: bool }
  const [lyricsFetching, setLyricsFetching] = useState(false);
  const [lyricsTrackId, setLyricsTrackId] = useState(null);
  const lyricsCacheRef = useRef(new Map()); // renderer-side cache: trackId → lyricsData

  // Fetch lyrics when the current track changes.
  useEffect(() => {
    const track = currentTrack;
    if (!track) {
      setLyricsData(null);
      setLyricsTrackId(null);
      setLyricsFetching(false);
      return;
    }
    if (track.id === lyricsTrackId) return;

    // IMMEDIATELY clear old lyrics so stale text never lingers.
    setLyricsData(null);

    // Check renderer cache first — instant on repeated plays.
    const cached = lyricsCacheRef.current.get(track.id);
    if (cached !== undefined) {
      setLyricsData(cached);
      setLyricsTrackId(track.id);
      setLyricsFetching(false);
      return;
    }

    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.fetchLyrics) return;

    let cancelled = false;
    setLyricsFetching(true);
    // Lyrics service preference is stored in localStorage so it persists
    // without DB cost. Defaults to 'lrclib' (the original behavior).
    const lyricsProvider = (typeof window !== 'undefined' && localStorage.getItem('immerse:lyricsProvider')) || 'lrclib';
    api.fetchLyrics({
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || 0,
      provider: lyricsProvider,
    }).then((res) => {
      if (cancelled) return;
      let data = null;
      if (res?.ok) {
        data = {
          synced: parseLRC(res.syncedLyrics),
          plain: res.plainLyrics || null,
          instrumental: !!res.instrumental,
        };
      }
      lyricsCacheRef.current.set(track.id, data);
      setLyricsData(data);
      setLyricsTrackId(track.id);
      setLyricsFetching(false);
    }).catch(() => {
      if (!cancelled) {
        lyricsCacheRef.current.set(track.id, null);
        setLyricsData(null);
        setLyricsTrackId(track.id);
        setLyricsFetching(false);
      }
    });
    return () => { cancelled = true; };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

  const hasSyncedLyrics = lyricsData?.synced?.length > 0;
  const hasPlainLyrics = !!lyricsData?.plain;
  const hasAnyLyrics = hasSyncedLyrics || hasPlainLyrics;
  const showLyrics = lyricsVisible && hasAnyLyrics && currentTrack;

  /**
   * Re-fetch lyrics for the currently-playing track. Clears the
   * renderer-side cache for this track ID and re-runs the fetch from
   * the LRClib/Genius pipeline. Useful when:
   *   - The fetch returned junk (e.g. the "N Contributors" leak from
   *     the Genius scraper before the bug was fixed)
   *   - The user re-tagged the track and wants the lyrics fetch to
   *     try again with the fresh metadata
   *   - The user changed their lyrics provider preference and wants
   *     existing tracks to fetch from the new source
   */
  const handleRefetchLyrics = useCallback(async () => {
    const track = currentTrack;
    if (!track) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.fetchLyrics) return;
    // Clear cache so the next fetch is forced (without this, the
    // cache-hit path would short-circuit and we'd see the same junk).
    lyricsCacheRef.current.delete(track.id);
    setLyricsData(null);
    setLyricsFetching(true);
    const lyricsProvider = (typeof window !== 'undefined' && localStorage.getItem('immerse:lyricsProvider')) || 'lrclib';
    try {
      const res = await api.fetchLyrics({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        duration: track.duration || 0,
        provider: lyricsProvider,
        force: true,
      });
      let data = null;
      if (res?.ok) {
        data = {
          synced: parseLRC(res.syncedLyrics),
          plain: res.plainLyrics || null,
          instrumental: !!res.instrumental,
        };
      }
      lyricsCacheRef.current.set(track.id, data);
      setLyricsData(data);
      setLyricsTrackId(track.id);
    } catch {
      lyricsCacheRef.current.set(track.id, null);
      setLyricsData(null);
      setLyricsTrackId(track.id);
    } finally {
      setLyricsFetching(false);
    }
  }, [currentTrack]);

  const tracks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? [...library]
      : library.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
    base.sort((a, b) => titleCollator.compare(String(a.title || ''), String(b.title || ''))
      || titleCollator.compare(String(a.id), String(b.id)));
    return base;
  }, [library, search]);

  // Wrap play callbacks to pass the sorted track list so the queue matches visible order.
  // An explicit overrideList (e.g. from album view) takes priority over the global sorted tracks.
  const sortedPlayTrack = useCallback((track, overrideList) => {
    onPlayTrack(track, overrideList && overrideList.length > 0 ? overrideList : tracks);
  }, [onPlayTrack, tracks]);

  const sortedPlayPauseTrack = useCallback((track, overrideList) => {
    onPlayPauseTrack(track, overrideList && overrideList.length > 0 ? overrideList : tracks);
  }, [onPlayPauseTrack, tracks]);

  const focusTrack = useMemo(() => {
    if (currentTrack && library.some((t) => t.id === currentTrack.id)) return currentTrack;
    const sel = library.find((t) => t.id === selectedId);
    return sel || library[0] || null;
  }, [currentTrack, selectedId, library]);

  useEffect(() => {
    if (!library.length) {
      setSelectedId(null);
      return;
    }
    if (!library.some((t) => t.id === selectedId)) {
      setSelectedId(library[0].id);
    }
  }, [library, selectedId]);

  useEffect(() => {
    if (currentTrack && library.some((t) => t.id === currentTrack.id)) {
      setSelectedId(currentTrack.id);
    }
  }, [currentTrack?.id, library]);

  useEffect(() => {
    const src = focusTrack?.coverArt;
    if (!src) {
      setThemeRgb({ accent: '48, 48, 48', wash: '10, 10, 10', mid: '12, 12, 12', deep: '0, 0, 0' });
      return undefined;
    }
    let cancelled = false;
    sampleCoverTheme(src).then((rgb) => {
      if (!cancelled && rgb) setThemeRgb(rgb);
    });
    return () => { cancelled = true; };
  }, [focusTrack?.coverArt, focusTrack?.id]);

  const { accent, wash, mid } = themeRgb;
  const coverUrl = focusTrack?.coverArt || null;
  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  /**
   * Cover reveal — when the cover URL changes (new track), store the previous
   * URL briefly so we can render it beneath the new one during a short
   * crossfade. The outgoing cover blurs and fades; the incoming cover fades
   * in sharp. Matches Immerse's calm aesthetic — no kinetic motion, just a
   * soft reveal.
   */
  const [prevCoverUrl, setPrevCoverUrl] = useState(null);
  const [revealKey, setRevealKey] = useState(0);
  const prevCoverUrlRef = useRef(null);
  useEffect(() => {
    // Don't animate the very first render (no prior cover to fade from)
    if (prevCoverUrlRef.current != null && prevCoverUrlRef.current !== coverUrl) {
      setPrevCoverUrl(prevCoverUrlRef.current);
      setRevealKey((k) => k + 1);
      // Clear the outgoing cover after the fade-out completes (380ms + a
      // small buffer for any rendering delay).
      const t = setTimeout(() => setPrevCoverUrl(null), 420);
      prevCoverUrlRef.current = coverUrl;
      return () => clearTimeout(t);
    }
    prevCoverUrlRef.current = coverUrl;
    return undefined;
  }, [coverUrl]);

  const canRemove = typeof onRemoveFromLibrary === 'function'
    && typeof window !== 'undefined'
    && window.electronAPI
    && (typeof window.electronAPI.removeLibraryTracks === 'function'
      || typeof window.electronAPI.invokeIpc === 'function');

  const canEdit = typeof onUpdateTrackMetadata === 'function'
    && typeof window !== 'undefined'
    && window.electronAPI
    && (typeof window.electronAPI.updateLibraryTrack === 'function'
      || typeof window.electronAPI.invokeIpc === 'function');

  const canEditAlbum = typeof onUpdateAlbumMetadata === 'function'
    && typeof window !== 'undefined'
    && window.electronAPI
    && (typeof window.electronAPI.updateLibraryAlbum === 'function'
      || typeof window.electronAPI.invokeIpc === 'function');

  const canUsePlaylists = typeof onAddTracksToPlaylist === 'function'
    && typeof onCreatePlaylist === 'function';

  /** Show welcome screen when nothing has played yet in this session. */
  const showWelcome = !hasEverPlayed && !currentTrack;

  /**
   * Called from track rows, album buttons, etc. Opens the add-to-playlist
   * popover anchored to the button that triggered it.
   */
  const openAddToPlaylist = (trackIds, anchorEl) => {
    const ids = (trackIds || []).map(String).filter(Boolean);
    if (ids.length === 0 || !canUsePlaylists) return;
    const anchorRect = anchorEl?.getBoundingClientRect?.();
    setAddMenu({ trackIds: ids, anchorRect });
  };

  /**
   * Build the context-menu items for a single track row. Same set across
   * Library, Playlists, Album views, etc — the available actions depend on
   * what handlers are wired at the page level (canEdit, canRemove,
   * canUsePlaylists). Currently-playing-relevant items (toggle favorite)
   * use the latest state from the track passed in.
   *
   * The Add to Playlist submenu is built dynamically from the playlists
   * array — each playlist becomes a submenu item, plus a "New playlist…"
   * option at the top.
   */
  const buildTrackContextMenu = useCallback((track) => {
    const items = [];
    items.push({
      label: 'Play',
      icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
      onClick: () => onPlayPauseTrack?.(track, [track]),
    });
    if (typeof onPlayNext === 'function') {
      items.push({
        label: 'Play next',
        icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="17" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>,
        onClick: () => onPlayNext(track),
      });
    }
    if (typeof onAddToQueue === 'function') {
      items.push({
        label: 'Add to queue',
        icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="13" y2="18" /><line x1="17" y1="15" x2="17" y2="21" /><line x1="14" y1="18" x2="20" y2="18" /></svg>,
        onClick: () => onAddToQueue(track),
      });
    }
    items.push({ divider: true });
    if (canUsePlaylists) {
      // Add to playlist — uses the same floating popover as the `+` button
      // path (openAddToPlaylist → AddToPlaylistMenu). Submenus inside the
      // context menu were proving fragile (timing of parent-rect measurement,
      // z-index stacking, focus loss). The popover is known-working.
      items.push({
        label: 'Add to playlist',
        icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15V6" /><path d="M21 6L9 8" /><path d="M9 18V8" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="15" r="3" /></svg>,
        onClick: () => {
          // Anchor the popover near the click that opened the context menu.
          // Synthesize a tiny rect at that point so AddToPlaylistMenu can
          // place itself correctly. Using the cursor position is good enough
          // here since the context menu was opened at the same cursor.
          const x = lastContextMenuPosRef.current?.x ?? Math.round(window.innerWidth / 2);
          const y = lastContextMenuPosRef.current?.y ?? Math.round(window.innerHeight / 2);
          const anchorRect = { top: y, bottom: y + 1, left: x, right: x + 1, width: 1, height: 1 };
          setAddMenu({ trackIds: [track.id], anchorRect });
        },
      });
    }
    if (typeof onToggleFavorite === 'function') {
      items.push({
        label: track.isFavorite ? 'Remove favorite' : 'Add to favorites',
        icon: (
          <svg width="11" height="11" viewBox="0 0 24 24"
            fill={track.isFavorite ? '#f37272' : 'none'}
            stroke={track.isFavorite ? '#f37272' : 'currentColor'}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        ),
        onClick: () => onToggleFavorite(track.id),
      });
    }
    items.push({ divider: true });
    if (canEdit) {
      items.push({
        label: 'Edit metadata',
        icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M12.15.85a1.13 1.13 0 0 1 1.6 0l1.4 1.4a1.13 1.13 0 0 1 0 1.6l-1.2 1.2-3-3 1.2-1.2zM2 11l7.15-7.15 3 3L5 14H2v-3z"/></svg>,
        onClick: () => setEditingTrackId(track.id),
      });
    }
    if (canRemove) {
      items.push({
        label: 'Remove from library',
        danger: true,
        icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>,
        onClick: () => onRemoveFromLibrary?.(track.id),
      });
    }
    return items;
  }, [
    onPlayPauseTrack, onPlayNext, onAddToQueue,
    canUsePlaylists, playlists, onAddTracksToPlaylist,
    onToggleFavorite, canEdit, canRemove, onRemoveFromLibrary,
  ]);

  /**
   * onContextMenu handler factory for track rows. Combines the menu-item
   * builder above with the page-level `openContextMenu` that actually
   * displays the menu. Pass this as `onTrackContextMenu` to any list.
   */
  const handleTrackContextMenu = useCallback((event, track) => {
    if (!contextMenusEnabled) return;
    openContextMenu(event, buildTrackContextMenu(track));
  }, [contextMenusEnabled, openContextMenu, buildTrackContextMenu]);


  /** Chose an existing playlist — add tracks and close */
  const handlePickPlaylist = async (playlistId) => {
    if (!addMenu) return;
    const ids = addMenu.trackIds;
    setAddMenu(null);
    await onAddTracksToPlaylist(playlistId, ids);
  };

  /** Chose "New playlist…" — open the PlaylistEditor with the tracks queued up */
  const handleNewPlaylistFromMenu = () => {
    if (!addMenu) return;
    setPendingTracksForNewPlaylist(addMenu.trackIds);
    setAddMenu(null);
    setEditingPlaylist('new');
  };

  const editingTrack = useMemo(
    () => (editingTrackId ? library.find((t) => t.id === editingTrackId) : null),
    [editingTrackId, library],
  );

  /**
   * For playlist thumbnails — build a map of playlistId → array of unique track
   * cover URLs (up to 4). Used to render the 2x2 mosaic for playlists without a
   * custom cover. We don't prefetch every playlist's tracks here (that would be
   * slow for a big library); instead we rely on knowing the tracks are already
   * in `library`. Empty until we hydrate it.
   */
  const [playlistCoverMap, setPlaylistCoverMap] = useState(() => new Map());

  // Hydrate playlistCoverMap when playlists or library change.
  // Uses loadPlaylistTrackIds to learn which tracks belong to each playlist,
  // then looks up their cover art from the library.
  useEffect(() => {
    if (!playlists || playlists.length === 0) {
      setPlaylistCoverMap(new Map());
      return;
    }
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.loadPlaylistTrackIds) return;
    let cancelled = false;
    (async () => {
      const libMap = new Map(library.map((t) => [t.id, t]));
      const next = new Map();
      for (const pl of playlists) {
        if (pl.coverArt) {
          // Custom cover in use — no mosaic needed
          next.set(pl.id, []);
          continue;
        }
        try {
          const ids = await api.loadPlaylistTrackIds(pl.id);
          if (cancelled) return;
          const covers = [];
          const seen = new Set();
          for (const id of ids) {
            const t = libMap.get(id);
            if (t?.coverArt && !seen.has(t.coverArt)) {
              seen.add(t.coverArt);
              covers.push(t.coverArt);
              if (covers.length >= 4) break;
            }
          }
          next.set(pl.id, covers);
        } catch { /* ignore */ }
      }
      if (!cancelled) setPlaylistCoverMap(next);
    })();
    return () => { cancelled = true; };
  }, [playlists, library]);

  // Load the open playlist's tracks whenever it changes
  useEffect(() => {
    if (!openPlaylistId || typeof onLoadPlaylistTracks !== 'function') {
      setOpenPlaylistTracks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const tracks = await onLoadPlaylistTracks(openPlaylistId);
        if (!cancelled) setOpenPlaylistTracks(Array.isArray(tracks) ? tracks : []);
      } catch {
        if (!cancelled) setOpenPlaylistTracks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [openPlaylistId, onLoadPlaylistTracks, library]);

  // When the dock tab changes to a playlist, sync openPlaylistId
  useEffect(() => {
    if (typeof dockTab === 'string' && dockTab.startsWith('playlist:')) {
      setOpenPlaylistId(dockTab.slice('playlist:'.length));
    } else {
      setOpenPlaylistId(null);
    }
  }, [dockTab]);

  // If the currently-open playlist is deleted externally, fall back to library
  useEffect(() => {
    if (openPlaylistId && !playlists.some((p) => p.id === openPlaylistId)) {
      setDockTab('library');
    }
  }, [playlists, openPlaylistId]);

  const editingPlaylistObj = useMemo(() => {
    if (editingPlaylist === 'new') return { mode: 'new' };
    if (!editingPlaylist) return null;
    const p = playlists.find((pl) => pl.id === editingPlaylist);
    return p ? { mode: 'edit', playlist: p } : null;
  }, [editingPlaylist, playlists]);

  // --- Lyrics editing ---
  const [lyricsEditing, setLyricsEditing] = useState(false);
  /** Tracks whether the lyrics panel is being hovered — reveals edit pencil. */
  const [lyricsPanelHovered, setLyricsPanelHovered] = useState(false);

  // Close editor when track changes
  useEffect(() => {
    setLyricsEditing(false);
  }, [currentTrack?.id]);

  // --- Lyric-share selection ---
  /** The current selection range inside the lyrics panel for the
   *  share-card flow, or null when not selecting.
   *  Shape: { start: number, end: number } — indices into the rendered
   *  line array (synced lines for SyncedLyrics, raw split lines for
   *  PlainLyrics). `end` is always >= `start` after normalization.
   *
   *  Entered via long-press (or right-click) on a lyric line; extended
   *  by tapping further lines; cleared by the floating Cancel button or
   *  by changing tracks. */
  const [lyricsSelection, setLyricsSelection] = useState(null);
  /** Whether the LyricShareOverlay (full-screen share card) is open. */
  const [lyricShareOpen, setLyricShareOpen] = useState(false);

  // Drop selection + close the share overlay when the track changes.
  // The indices we held were referring to the old track's lyrics array,
  // so they're meaningless after a track change.
  useEffect(() => {
    setLyricsSelection(null);
    setLyricShareOpen(false);
  }, [currentTrack?.id]);

  // Also drop the selection if the user toggles into the lyrics editor —
  // editing and selecting-to-share are mutually exclusive interactions.
  useEffect(() => {
    if (lyricsEditing) setLyricsSelection(null);
  }, [lyricsEditing]);

  /** Begin a new lyric selection anchored at `idx`. Replaces any prior. */
  const handleLyricSelectStart = useCallback((idx) => {
    if (typeof idx !== 'number' || idx < 0) return;
    setLyricsSelection({ start: idx, end: idx });
  }, []);

  /** Extend or contract the current selection toward `idx`. Apple-style:
   *  tapping a line outside the range extends to it; tapping inside
   *  contracts (snapping the nearest edge to the tapped line). */
  const handleLyricSelectExtend = useCallback((idx) => {
    if (typeof idx !== 'number' || idx < 0) return;
    setLyricsSelection((cur) => {
      if (!cur) return { start: idx, end: idx };
      const { start, end } = cur;
      if (idx < start) return { start: idx, end };
      if (idx > end)   return { start, end: idx };
      // Inside the range — snap whichever edge is closer.
      const distToStart = idx - start;
      const distToEnd = end - idx;
      if (distToStart <= distToEnd) return { start: idx, end };
      return { start, end: idx };
    });
  }, []);

  /** Clear selection and dismiss the share UI. */
  const clearLyricsSelection = useCallback(() => {
    setLyricsSelection(null);
    setLyricShareOpen(false);
  }, []);

  // Esc while selecting (but with no overlay open) → cancel the selection.
  useEffect(() => {
    if (!lyricsSelection || lyricShareOpen) return undefined;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      e.preventDefault();
      setLyricsSelection(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lyricsSelection, lyricShareOpen]);

  // --- Cover fullscreen overlay ---
  /** Whether the edge-to-edge cover overlay is currently open. Toggled via
   * a click on the cover (when `coverFullscreenEnabled` is on), the keyboard
   * shortcut `f`, or the close affordance in the overlay itself. */
  const [coverFullscreenOpen, setCoverFullscreenOpen] = useState(false);
  /** Hover state on the cover, used to fade in the small "expand" pill. */
  const [coverHovered, setCoverHovered] = useState(false);

  // Close fullscreen if the feature is disabled mid-session.
  useEffect(() => {
    if (!coverFullscreenEnabled && coverFullscreenOpen) setCoverFullscreenOpen(false);
  }, [coverFullscreenEnabled, coverFullscreenOpen]);

  // Lazily create the audio analyser the first time any reactive feature
  // becomes active and we have something playing. Once created it's
  // reused; the underlying media-element source can't be reconnected so
  // calling this multiple times is safe (it short-circuits).
  useEffect(() => {
    if (!ensureAnalyser) return;
    if (!currentTrack) return;
    if (beatReactive) {
      ensureAnalyser();
    }
  }, [ensureAnalyser, currentTrack, beatReactive]);

  // Close fullscreen on track removal / no-track state.
  useEffect(() => {
    if (!currentTrack && coverFullscreenOpen) setCoverFullscreenOpen(false);
  }, [currentTrack, coverFullscreenOpen]);

  // 'f' / Escape keyboard handling for the fullscreen overlay.
  useEffect(() => {
    const handler = (e) => {
      // Don't capture in inputs / textareas.
      const tag = (e.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === 'Escape' && coverFullscreenOpen) {
        e.preventDefault();
        setCoverFullscreenOpen(false);
      } else if ((e.key === 'f' || e.key === 'F') && coverFullscreenEnabled && currentTrack) {
        e.preventDefault();
        setCoverFullscreenOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [coverFullscreenOpen, coverFullscreenEnabled, currentTrack]);

  /**
   * How much horizontal space the sidedock currently occupies on the right.
   * The dock lives at `right: 12` with width 336 (expanded) or 52 (collapsed),
   * so the space it takes up end-to-end is width + 12px margin. Any overlay
   * that renders in the immersive stage and should stay clear of the dock
   * uses this as its right inset.
   *
   * Transitions match the dock's own width transition (280ms ease) so the
   * overlay slides in/out of sync when the user collapses/expands the dock.
   */
  // Space reserved on the active side for the panel. Only the panel takes
  // horizontal space now — the bottom dock bar lives at the bottom-center
  // and doesn't reserve side space. Closed = nothing reserved (the
  // immersive view goes edge to edge); open = ~360 (panel + outer margin).
  // Reserve horizontal stage space when the panel is open so the cover
  // doesn't sit underneath it. 364 = panel width 340 + outer margin 12 +
  // breathing room. Mirrors the panel's actual width when resizable is on.
  const effectivePanelWidth = panelResizableEnabled ? panelWidth : 340;
  const dockReservedSize = dockPanelOpen ? (effectivePanelWidth + 24) : 0;
  const dockReservedRight = dockSide === 'right' ? dockReservedSize : 0;
  const dockReservedLeft = dockSide === 'left' ? dockReservedSize : 0;

  const handleLyricsSaved = (newSynced, newPlain) => {
    const data = { synced: newSynced || [], plain: newPlain || null, instrumental: false };
    lyricsCacheRef.current.set(currentTrack.id, data);
    setLyricsData(data);
    setLyricsEditing(false);
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
      position: 'relative', WebkitAppRegion: 'no-drag',
    }}
    >
      {!showWelcome && coverUrl ? (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: '-12%',
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'blur(120px) saturate(1.55)',
            opacity: 0.75, pointerEvents: 'none',
            transition: 'background-image 0.6s ease',
          }}
        />
      ) : null}
      {!showWelcome ? (
        animateGradient ? (
          <AnimatedGradientBg
            accent={accent}
            mid={mid}
            wash={wash}
            coverUrl={coverUrl}
            analyserRef={analyserRef}
            beatReactive={beatReactive}
            isPlaying={isPlaying}
          />
        ) : (
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: `
                radial-gradient(ellipse 100% 65% at 50% 0%, rgba(${accent},0.55) 0%, transparent 55%),
                radial-gradient(ellipse 90% 50% at 80% 60%, rgba(${mid},0.35) 0%, transparent 50%),
                radial-gradient(ellipse 70% 45% at 10% 80%, rgba(${wash},0.25) 0%, transparent 45%),
                linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.88) 55%, #000000 100%)
              `,
              transition: 'background 1.2s ease',
            }}
          />
        )
      ) : null}

      {/* Immersive stage */}
      {showWelcome ? (
        <WelcomeScreen
          library={library}
          playlists={playlists}
          onImportFiles={onImportFiles}
          onImportFolder={onImportFolder}
          importing={importing}
          onOpenLibrary={() => { setDockTab('library'); setDockPanelOpen(true); }}
          onOpenFind={() => { setDockTab('find'); setDockPanelOpen(true); }}
          onNewPlaylist={() => {
            setPendingTracksForNewPlaylist(null);
            setEditingPlaylist('new');
          }}
          onPlayTrack={onPlayPauseTrack}
          accent={accent}
          trackOfMomentEnabled={trackOfMomentEnabled}
          playEvents={playEvents}
        />
      ) : (
      <div style={{
        position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto', overflowX: 'hidden',
        // Padding is generous when maximized so the column sits in the
        // vertical sweet spot rather than glued to the chrome edge.
        padding: isMaximized ? '88px 24px 60px' : '56px 24px 40px',
        WebkitOverflowScrolling: 'touch',
        // When maximized, use flex centering on the scroll container
        // itself so the inner column floats vertically toward the
        // middle of the available space. This fills the bottom dead
        // zone that otherwise appears below the cover + transport
        // when there's nothing else (no lyrics panel) to stack
        // beneath them. minHeight:100% ensures the inner column has
        // something to center against even when its natural height
        // is much shorter than the viewport.
        ...(isMaximized ? {
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        } : null),
      }}
      >
        <div style={{
          // When maximized the column gets a wider cap so the cover
          // and metadata occupy the extra real estate instead of
          // leaving empty bands of background on either side.
          maxWidth: isMaximized ? 980 : 720,
          // Full width within the cap so flex centering on the parent
          // can find a definite block to align.
          width: '100%',
          margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
        >
          <div
            onMouseEnter={() => setCoverHovered(true)}
            onMouseLeave={() => setCoverHovered(false)}
            onClick={(e) => {
              if (!coverFullscreenEnabled || !currentTrack) return;
              // Avoid hijacking clicks that bubble from interactive children
              // (currently none, but defensive in case anything is added).
              if (e.target.closest('button, a, input')) return;
              setCoverFullscreenOpen(true);
            }}
            role={coverFullscreenEnabled && currentTrack ? 'button' : undefined}
            tabIndex={coverFullscreenEnabled && currentTrack ? 0 : -1}
            aria-label={coverFullscreenEnabled && currentTrack ? 'Open cover fullscreen' : undefined}
            onKeyDown={(e) => {
              if (!coverFullscreenEnabled || !currentTrack) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCoverFullscreenOpen(true);
              }
            }}
            style={{
              // In windowed mode the cover sits at a comfortable
              // ~370px max — small enough to leave room for the title
              // and dock without crowding. In fullscreen we lift the
              // cap so it can grow with the available vmin (up to 520
              // on a typical 1440p monitor), which is what actually
              // soaks up the extra space — making the cover the
              // poster-sized hero of the view instead of an island in
              // a sea of background.
              width: isMaximized ? 'min(52vmin, 520px)' : 'min(58vmin, 370px)',
              aspectRatio: '1', borderRadius: 14, overflow: 'hidden',
              boxShadow: `0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(${accent},0.35)`,
              background: '#111',
              /* Subtle 8s breathing scale while playing. Pauses in-place when
                 paused by stopping the animation (transform stays at last frame).
                 willChange hints the compositor to promote this layer to its
                 own GPU texture so the transform is cheap. */
              animation: isPlaying ? 'immerseCoverBreathe 8s ease-in-out infinite' : 'none',
              willChange: 'transform',
              transition: 'box-shadow 0.4s ease',
              position: 'relative',
              cursor: coverFullscreenEnabled && currentTrack ? 'zoom-in' : 'default',
              outline: 'none',
            }}
          >
            <style>{`
              @keyframes immerseCoverBreathe {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.022); }
              }
              @keyframes immerseCoverFadeOut {
                0%   { opacity: 1; }
                100% { opacity: 0; }
              }
              @keyframes immerseCoverFadeIn {
                0%   { opacity: 0; }
                100% { opacity: 1; }
              }
            `}</style>
            {/* Outgoing cover. Stays positioned absolute so it shares the
                same z-stack as the incoming one — both layered over the
                fallback icon, fading reciprocally. */}
            {prevCoverUrl && prevCoverUrl !== coverUrl ? (
              <img
                key={`out-${revealKey}`}
                src={prevCoverUrl}
                alt=""
                decoding="async"
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%', objectFit: 'cover',
                  imageRendering: 'high-quality',
                  // Sits on top during the fade so the OLD cover is what the
                  // user sees clearly, then fades away revealing the NEW one
                  // already at opacity 1 underneath. Single fade-out feels
                  // smoother than two simultaneous opposite animations.
                  zIndex: 2,
                  animation: 'immerseCoverFadeOut 380ms ease-in-out forwards',
                  pointerEvents: 'none',
                  willChange: 'opacity',
                }}
              />
            ) : null}
            {coverUrl ? (
              <img
                key={`in-${coverUrl}`}
                src={coverUrl}
                alt=""
                // Force the browser into its highest-quality scaling
                // algorithm (Lanczos in Chromium for moderate downscale
                // ratios, falling back to bilinear). Default 'auto' may
                // pick a faster but uglier path on some GPUs. The decode
                // hint lets the image decode off the main thread so the
                // UI stays responsive while big covers load.
                decoding="async"
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%', objectFit: 'cover',
                  zIndex: 1,
                  imageRendering: 'high-quality',
                  // Always full opacity — the outgoing cover above handles
                  // the transition by fading away from this stable base.
                  // No animation on mount or on cover change keeps things
                  // calm; the crossfade visual comes purely from the
                  // outgoing layer disappearing.
                  opacity: 1,
                }}
              />
            ) : (
              <div style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#444',
              }}
              >
                <Icons.AlbumSidebar />
              </div>
            )}

            {/* Hover-reveal "expand to fullscreen" pill — bottom-right corner.
                Fades in when the user hovers the cover and the feature is
                enabled. Uses backdrop-blur over the cover so it stays
                readable against any artwork. */}
            {coverFullscreenEnabled && currentTrack ? (
              <div
                aria-hidden
                style={{
                  position: 'absolute', bottom: 10, right: 10, zIndex: 3,
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px 5px 8px', borderRadius: 999,
                  background: 'rgba(0,0,0,0.55)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                  opacity: coverHovered ? 1 : 0,
                  transform: coverHovered ? 'translateY(0)' : 'translateY(4px)',
                  transition: 'opacity 0.18s ease, transform 0.18s ease',
                  pointerEvents: 'none',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                Fullscreen
              </div>
            ) : null}
          </div>

          <h1 style={{
            // Larger margin + font in fullscreen so the metadata column
            // doesn't look like a postage stamp under a poster-sized
            // cover. Numbers picked by eye to keep proportion with the
            // cover size at each mode.
            margin: isMaximized ? '32px 0 0' : '22px 0 0',
            fontSize: isMaximized ? 40 : 28,
            fontWeight: 800, letterSpacing: '-0.04em', color: '#fff',
            textAlign: 'center', lineHeight: 1.1, textShadow: '0 2px 20px rgba(0,0,0,0.5)',
          }}
          >
            {(focusTrack?.title || 'No track').trim()}
          </h1>
          <p style={{
            margin: isMaximized ? '14px 0 0' : '10px 0 0',
            fontSize: isMaximized ? 19 : 15,
            color: 'rgba(255,255,255,0.78)', textAlign: 'center', fontWeight: 500,
          }}>
            {clickToFilterEnabled && (focusTrack?.artist || '').trim() ? (
              <FilterableText
                text={focusTrack.artist}
                title={`Filter library by ${focusTrack.artist}`}
                onFilter={handleFilterByText}
              />
            ) : (
              (focusTrack?.artist || '').trim() || (library.length ? 'Unknown artist' : 'Import music to begin')
            )}
          </p>
          {focusTrack?.album ? (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>
              {clickToFilterEnabled ? (
                <FilterableText
                  text={focusTrack.album}
                  title={`Filter library by ${focusTrack.album}`}
                  onFilter={handleFilterByText}
                />
              ) : focusTrack.album}
            </p>
          ) : null}

          {currentTrack && !lyricsFetching && lyricsData?.instrumental ? (
            <div style={{ marginTop: 10, fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>
              ♪ instrumental
            </div>
          ) : null}

          {/* Progress */}
          <div style={{
            width: 'min(100%, 520px)', marginTop: 26, display: 'flex', alignItems: 'center', gap: 10,
          }}
          >
            <span style={{
              color: 'rgba(255,255,255,0.55)', fontSize: 10.5, fontVariantNumeric: 'tabular-nums',
              minWidth: 34, textAlign: 'right', letterSpacing: '0.02em',
            }}
            >
              {formatTime(currentTime)}
            </span>
            <HeartSlider
              value={currentTime}
              max={duration || 0}
              onChange={(v) => onSeek?.(v)}
              accent={accent}
              ariaLabel="Seek"
              thumbSize={13}
            />
            <span style={{
              color: 'rgba(255,255,255,0.55)', fontSize: 10.5, fontVariantNumeric: 'tabular-nums',
              minWidth: 34, letterSpacing: '0.02em',
            }}
            >
              {formatTime(duration)}
            </span>
          </div>

          {/* Transport — Reva UI (Lineal): no container, thin line icons, generous spacing */}
          <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
            <RevaSecondaryBtn onClick={onToggleShuffle} title="Shuffle" active={shuffleOn}>
              {/* Reva shuffle — two curves crossing in an X, with filled dots at all four corners */}
              <svg width="26" height="26" viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 9 C 12 9, 16 23, 23 23" />
                <path d="M5 23 C 12 23, 16 9, 23 9" />
                <circle cx="5" cy="9" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="5" cy="23" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="23" cy="9" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="23" cy="23" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </RevaSecondaryBtn>

            <RevaTransportBtn onClick={onPrev} title="Previous">
              {/* Reva skip-back — two nested rounded triangles pointing left */}
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {/* Back triangle (leftmost) */}
                <path d="M14 10.5 C 14 9.5, 13 9.1, 12.2 9.7 L 6 15 C 5.4 15.5, 5.4 16.5, 6 17 L 12.2 22.3 C 13 22.9, 14 22.5, 14 21.5 Z" />
                {/* Front triangle (right) */}
                <path d="M24 10.5 C 24 9.5, 23 9.1, 22.2 9.7 L 16 15 C 15.4 15.5, 15.4 16.5, 16 17 L 22.2 22.3 C 23 22.9, 24 22.5, 24 21.5 Z" />
              </svg>
            </RevaTransportBtn>

            <RevaPlayBtn onClick={onTogglePlay} isPlaying={isPlaying} />

            <RevaTransportBtn onClick={onNext} title="Next">
              {/* Reva skip-forward — two nested rounded triangles pointing right */}
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {/* Front triangle (leftmost) */}
                <path d="M8 10.5 C 8 9.5, 9 9.1, 9.8 9.7 L 16 15 C 16.6 15.5, 16.6 16.5, 16 17 L 9.8 22.3 C 9 22.9, 8 22.5, 8 21.5 Z" />
                {/* Back triangle (right) */}
                <path d="M18 10.5 C 18 9.5, 19 9.1, 19.8 9.7 L 26 15 C 26.6 15.5, 26.6 16.5, 26 17 L 19.8 22.3 C 19 22.9, 18 22.5, 18 21.5 Z" />
              </svg>
            </RevaTransportBtn>

            <RevaSecondaryBtn onClick={onToggleRepeat} title={`Repeat: ${repeat}`} active={repeat !== 'off'}>
              {/* Reva repeat — two opposing half-arcs with filled dots at the tip endpoints */}
              {repeat === 'one' ? (
                <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 20 Q 7 7, 18 7 Q 25 7, 25 13" />
                  <path d="M25 12 Q 25 25, 14 25 Q 7 25, 7 19" />
                  <circle cx="7" cy="20" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="25" cy="13" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="25" cy="12" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="7" cy="19" r="1.6" fill="currentColor" stroke="none" />
                  <text x="16" y="19" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none" fontWeight="700" fontFamily="system-ui, sans-serif">1</text>
                </svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 20 Q 7 7, 18 7 Q 25 7, 25 13" />
                  <path d="M25 12 Q 25 25, 14 25 Q 7 25, 7 19" />
                  <circle cx="7" cy="20" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="25" cy="13" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="25" cy="12" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="7" cy="19" r="1.6" fill="currentColor" stroke="none" />
                </svg>
              )}
            </RevaSecondaryBtn>
          </div>

          {/* Volume — Reva UI: small speaker on left (mute toggle), slider, speaker-with-waves on right */}
          <div style={{
            marginTop: 18, display: 'flex', alignItems: 'center', gap: 10, width: 'min(100%, 240px)',
          }}
          >
            <Tooltip label={volume > 0 ? 'Mute' : 'Unmute'} side="top">
              <button
                type="button"
                onClick={() => onSetVolume?.(volume > 0 ? 0 : 1)}
                aria-label={volume > 0 ? 'Mute' : 'Unmute'}
                style={{
                  width: 24, height: 24, border: 'none', background: 'transparent',
                  color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0,
                }}
              >
                {/* Reva small speaker — no waves */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5 L 7 9 L 4 9 C 3.4 9, 3 9.4, 3 10 L 3 14 C 3 14.6, 3.4 15, 4 15 L 7 15 L 11 19 C 11.5 19.4, 12 19.1, 12 18.5 L 12 5.5 C 12 4.9, 11.5 4.6, 11 5 Z" />
                </svg>
              </button>
            </Tooltip>
            <HeartSlider
              value={volume}
              max={1}
              onChange={(v) => onSetVolume?.(v)}
              accent={accent}
              ariaLabel="Volume"
              thumbSize={11}
            />
            <BoostButton
              boost={gainBoost}
              onSetBoost={onSetGainBoost}
              accent={accent}
            />
          </div>
        </div>
      </div>
      )}

      {/* Lyrics panel — fixed on the left side, own scroll, never affects layout.
          Renders whenever the user has the lyrics view turned on and a track
          is loaded, even if no lyrics were found — so the "add lyrics" empty
          state and pencil button are always reachable. */}
      {!showWelcome && lyricsVisible && currentTrack ? (
        <div
          onMouseEnter={() => setLyricsPanelHovered(true)}
          onMouseLeave={() => setLyricsPanelHovered(false)}
          style={{
            position: 'absolute',
            top: 56,
            bottom: 16,
            left: 16,
            width: 'min(340px, 30vw)',
            zIndex: 2,
            display: 'flex', flexDirection: 'column',
            pointerEvents: 'auto',
          }}
        >
          {lyricsEditing ? (
            <LyricsEditor
              track={currentTrack}
              currentTime={currentTime}
              existingSynced={lyricsData?.synced || []}
              existingPlain={lyricsData?.plain || ''}
              accent={accent}
              onSeek={onSeek}
              onSave={handleLyricsSaved}
              onCancel={() => setLyricsEditing(false)}
            />
          ) : hasSyncedLyrics ? (
            <SyncedLyrics
              lines={lyricsData.synced}
              currentTime={currentTime}
              accent={accent}
              onSeek={onSeek}
              selection={lyricsSelection}
              onSelectStart={handleLyricSelectStart}
              onSelectLine={handleLyricSelectExtend}
            />
          ) : hasPlainLyrics ? (
            <PlainLyrics
              text={lyricsData.plain}
              accent={accent}
              selection={lyricsSelection}
              onSelectStart={handleLyricSelectStart}
              onSelectLine={handleLyricSelectExtend}
            />
          ) : (
            // Empty state — no lyrics from LRClib / Genius and not currently
            // editing. Surfaces a clear CTA so the user can add lyrics by
            // hand instead of staring at a blank panel.
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '24px 16px', textAlign: 'center', gap: 12,
            }}>
              {lyricsFetching ? (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em' }}>
                  searching for lyrics…
                </div>
              ) : lyricsData?.instrumental ? (
                <>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em' }}>
                    ♪ Instrumental
                  </div>
                  <button type="button"
                    onClick={() => setLyricsEditing(true)}
                    style={{
                      padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}>
                    Add lyrics anyway
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5, maxWidth: 240 }}>
                    No lyrics found for this track.
                  </div>
                  <button type="button"
                    onClick={() => setLyricsEditing(true)}
                    style={{
                      padding: '8px 16px', borderRadius: 10,
                      border: `1px solid rgba(${accent},0.4)`,
                      background: `rgba(${accent},0.18)`, color: '#fff',
                      fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 7,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.28)`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = `rgba(${accent},0.18)`; }}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M12.15.85a1.13 1.13 0 0 1 1.6 0l1.4 1.4a1.13 1.13 0 0 1 0 1.6l-1.2 1.2-3-3 1.2-1.2zM2 11l7.15-7.15 3 3L5 14H2v-3z"/>
                    </svg>
                    Add lyrics
                  </button>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5, maxWidth: 220 }}>
                    Paste them in, save, then optionally tap-to-sync while the song plays.
                  </div>
                </>
              )}
            </div>
          )}
          {/* Hover-reveal edit-lyrics pencil — sits floating in the top-right,
              fading in only when the user's mouse is over the panel. Stays
              out of the way when reading, surfaces on demand. Toggles
              lyricsEditing which puts the panel into edit mode (textarea,
              save/cancel controls).

              Hidden entirely while in edit mode — the editor has its own
              Cancel button at the top, and our pencil would visually
              collide with it. Re-appears once the user cancels/saves and
              the panel returns to read mode. */}
          {currentTrack && !lyricsEditing ? (
            <button type="button"
              onClick={() => setLyricsEditing(true)}
              title="Edit lyrics"
              aria-label="Edit lyrics"
              style={{
                position: 'absolute', top: 4, right: 4,
                width: 28, height: 28, borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.45)',
                color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                opacity: lyricsPanelHovered ? 1 : 0,
                pointerEvents: lyricsPanelHovered ? 'auto' : 'none',
                transform: lyricsPanelHovered ? 'translateY(0)' : 'translateY(-4px)',
                transition: 'opacity 0.18s ease, transform 0.18s ease, background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.7)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M12.15.85a1.13 1.13 0 0 1 1.6 0l1.4 1.4a1.13 1.13 0 0 1 0 1.6l-1.2 1.2-3-3 1.2-1.2zM2 11l7.15-7.15 3 3L5 14H2v-3z"/>
              </svg>
            </button>
          ) : null}
          {/* Hover-reveal refetch button — sits to the LEFT of the edit
              pencil. Clears the cached lyrics for this track and re-runs
              the fetch from LRClib/Genius. Useful when the original fetch
              produced junk (e.g. Genius scraper leak), or when the user
              has re-tagged the track and wants a fresh attempt. Same
              hover-reveal pattern as the pencil so it stays unobtrusive
              when not needed. Spinning state during refetch. */}
          {currentTrack && !lyricsEditing ? (
            <button type="button"
              onClick={handleRefetchLyrics}
              disabled={lyricsFetching}
              title={lyricsFetching ? 'Refetching…' : 'Refetch lyrics'}
              aria-label="Refetch lyrics"
              style={{
                position: 'absolute', top: 4, right: 38,
                width: 28, height: 28, borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.45)',
                color: 'rgba(255,255,255,0.75)',
                cursor: lyricsFetching ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                opacity: lyricsPanelHovered ? 1 : 0,
                pointerEvents: lyricsPanelHovered ? 'auto' : 'none',
                transform: lyricsPanelHovered ? 'translateY(0)' : 'translateY(-4px)',
                transition: 'opacity 0.18s ease, transform 0.18s ease, background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { if (!lyricsFetching) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.7)'; } }}
              onMouseLeave={(e) => { if (!lyricsFetching) { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; } }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                style={{
                  animation: lyricsFetching ? 'immerseLyricsRefreshSpin 0.9s linear infinite' : 'none',
                }}>
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <style>{`@keyframes immerseLyricsRefreshSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </button>
          ) : null}

          {/* Lyric-share selection action bar — sits as a floating pill at
              the bottom of the lyrics column whenever the user has any
              lines selected for sharing. Shows the count of selected
              lines plus Share + Cancel actions. Animates in from below;
              clicking outside the panel doesn't dismiss the selection
              (only the explicit cancel does), so the user can scroll
              the rest of the app without accidentally losing their pick. */}
          {lyricsSelection && !lyricsEditing ? (
            <div
              role="toolbar"
              aria-label="Share lyric selection"
              style={{
                position: 'absolute',
                left: '50%', bottom: 10,
                transform: 'translateX(-50%)',
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 6px 6px 12px',
                borderRadius: 999,
                background: 'rgba(20,20,22,0.92)',
                border: `1px solid rgba(${accent},0.35)`,
                backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                boxShadow: `0 8px 28px rgba(0,0,0,0.55), 0 0 24px rgba(${accent},0.18)`,
                animation: 'immerseShareToastIn 200ms ease-out',
                zIndex: 3,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{
                fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
                letterSpacing: '0.01em',
              }}>
                {(() => {
                  const n = lyricsSelection.end - lyricsSelection.start + 1;
                  return `${n} line${n === 1 ? '' : 's'} selected`;
                })()}
              </span>
              <button
                type="button"
                onClick={() => setLyricShareOpen(true)}
                title="Share these lyrics"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 999,
                  border: 'none',
                  background: `rgba(${accent},0.85)`,
                  color: '#fff',
                  fontSize: 11.5, fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: `0 2px 10px rgba(${accent},0.4)`,
                  transition: 'background 0.15s, transform 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `rgb(${accent})`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `rgba(${accent},0.85)`; }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Share
              </button>
              <button
                type="button"
                onClick={clearLyricsSelection}
                title="Cancel selection"
                aria-label="Cancel"
                style={{
                  width: 28, height: 28, borderRadius: 999,
                  border: 'none', padding: 0,
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}


      {/* Edge-bleed colour band — when enabled, a thin gradient strip at
          the bottom of the stage tinted with the playing track's accent
          colour. Subtle and the dock pill sits above it. Hidden on the
          welcome screen because there's no playing-track context yet. */}
      {edgeBleedEnabled && !showWelcome ? (
        <EdgeBleedBand accent={accent} />
      ) : null}

      {/* Bottom dock bar — centered pill at the bottom holding tab icons
          (Find / Library / New / Settings) plus a Lyrics view-toggle.
          Queue is now a tab inside the side dock panel, not a separate
          drawer. */}
      <BottomDockBar
        tab={dockTab}
        onTabChange={setDockTab}
        panelOpen={dockPanelOpen}
        onTogglePanel={() => setDockPanelOpen((v) => !v)}
        libraryCount={library.length}
        queueCount={queue.length}
        lyricsVisible={lyricsVisible}
        onToggleLyrics={() => setLyricsVisible((v) => !v)}
        // Lyrics button is enabled whenever a track is playing OR there's
        // already a lyrics fetch in flight — covers both "show me" and
        // "I want to edit the lyrics for this song" cases.
        lyricsAvailable={!!currentTrack || hasAnyLyrics || lyricsFetching}
        accent={accent}
        pinnableTabsEnabled={pinnableTabsEnabled}
        hiddenTabIds={hiddenTabIds}
        tabContextHandler={handleTabContextMenu}
        randomButtonEnabled={randomButtonEnabled}
        onPlayRandom={onPlayRandom}
        breathingDockPillEnabled={breathingDockPillEnabled}
        dockTransparentEnabled={dockTransparentEnabled}
        liquidGlassDockEnabled={liquidGlassDockEnabled}
        journalTabEnabled={journalTabEnabled}
        recentPeekEnabled={recentPeekEnabled}
        recentPeekRange={recentPeekRange}
        recentPeekCustomCount={recentPeekCustomCount}
        library={library}
        playEvents={playEvents}
        onPlayTrack={onPlayTrack}
        isPlaying={isPlaying}
        dockDraggableEnabled={dockDraggableEnabled}
        dockPosition={dockPosition}
        onSetDockPosition={onSetDockPosition}
      />

      <SideDock
        collapsed={dockCollapsed}
        onToggleCollapsed={() => setDockCollapsed((v) => !v)}
        side={dockSide}
        tab={dockTab}
        onTabChange={setDockTab}
        tracks={tracks}
        library={library}
        libraryCount={library.length}
        search={search}
        onSearchChange={setSearch}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        lyricsData={lyricsData}
        onShowLyricsPanel={() => setLyricsVisible(true)}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        hovered={hovered}
        setHovered={setHovered}
        onPlayTrack={sortedPlayTrack}
        onPlayPauseTrack={sortedPlayPauseTrack}
        onImportFiles={onImportFiles}
        onImportFolder={onImportFolder}
        importing={importing}
        setImporting={setImporting}
        canRemove={canRemove}
        onRemoveFromLibrary={onRemoveFromLibrary}
        canEdit={canEdit}
        onEditTrack={(id) => setEditingTrackId(id)}
        canEditAlbum={canEditAlbum}
        onEditAlbum={(scope) => setEditingAlbumScope(scope)}
        playlists={playlists}
        playlistCoverMap={playlistCoverMap}
        openPlaylistId={openPlaylistId}
        openPlaylistTracks={openPlaylistTracks}
        onNewPlaylist={() => {
          setPendingTracksForNewPlaylist(null);
          setEditingPlaylist('new');
        }}
        onEditPlaylist={(id) => setEditingPlaylist(id)}
        onDeletePlaylist={onDeletePlaylist}
        onRemoveTracksFromPlaylist={onRemoveTracksFromPlaylist}
        canAddToPlaylist={canUsePlaylists}
        onAddToPlaylist={openAddToPlaylist}
        accent={accent}
        spotifyCredsRefreshKey={spotifyCredsRefreshKey}
        onSpotifyImportDone={onSpotifyImportDone}
        onSpotifyCredsSaved={onSpotifyCredsSaved}
        uiFontId={uiFontId}
        onSetUiFontId={onSetUiFontId}
        uiFontStack={uiFontStack}
        animateGradient={animateGradient}
        onSetAnimateGradient={onSetAnimateGradient}
        beatReactive={beatReactive}
        onSetBeatReactive={onSetBeatReactive}
        coverFullscreenEnabled={coverFullscreenEnabled}
        onSetCoverFullscreenEnabled={onSetCoverFullscreenEnabled}
        pinnableTabsEnabled={pinnableTabsEnabled}
        onSetPinnableTabsEnabled={onSetPinnableTabsEnabled}
        hiddenTabIds={hiddenTabIds}
        onSetHiddenTabIds={onSetHiddenTabIds}
        dockCollapseAnimationEnabled={dockCollapseAnimationEnabled}
        onSetDockCollapseAnimationEnabled={onSetDockCollapseAnimationEnabled}
        randomButtonEnabled={randomButtonEnabled}
        onSetRandomButtonEnabled={onSetRandomButtonEnabled}
        onPlayRandom={onPlayRandom}
        breathingDockPillEnabled={breathingDockPillEnabled}
        onSetBreathingDockPillEnabled={onSetBreathingDockPillEnabled}
        dockTransparentEnabled={dockTransparentEnabled}
        onSetDockTransparentEnabled={onSetDockTransparentEnabled}
        liquidGlassDockEnabled={liquidGlassDockEnabled}
        onSetLiquidGlassDockEnabled={onSetLiquidGlassDockEnabled}
        journalTabEnabled={journalTabEnabled}
        onSetJournalTabEnabled={onSetJournalTabEnabled}
        queuePainterEnabled={queuePainterEnabled}
        onSetQueuePainterEnabled={onSetQueuePainterEnabled}
        recentPeekEnabled={recentPeekEnabled}
        onSetRecentPeekEnabled={onSetRecentPeekEnabled}
        recentPeekRange={recentPeekRange}
        onSetRecentPeekRange={onSetRecentPeekRange}
        recentPeekCustomCount={recentPeekCustomCount}
        onSetRecentPeekCustomCount={onSetRecentPeekCustomCount}
        firstTimeSparkleEnabled={firstTimeSparkleEnabled}
        onSetFirstTimeSparkleEnabled={onSetFirstTimeSparkleEnabled}
        trackOfMomentEnabled={trackOfMomentEnabled}
        onSetTrackOfMomentEnabled={onSetTrackOfMomentEnabled}
        clickToFilterEnabled={clickToFilterEnabled}
        onSetClickToFilterEnabled={onSetClickToFilterEnabled}
        onFilterByText={handleFilterByText}
        artistInfoEnabled={artistInfoEnabled}
        onSetArtistInfoEnabled={onSetArtistInfoEnabled}
        lastFmApiKey={lastFmApiKey}
        onSetLastFmApiKey={onSetLastFmApiKey}
        creditsEnabled={creditsEnabled}
        onSetCreditsEnabled={onSetCreditsEnabled}
        videosEnabled={videosEnabled}
        onSetVideosEnabled={onSetVideosEnabled}
        edgeBleedEnabled={edgeBleedEnabled}
        onSetEdgeBleedEnabled={onSetEdgeBleedEnabled}
        ambientMode={ambientMode}
        onSetAmbientMode={onSetAmbientMode}
        ambientCustomDelaySec={ambientCustomDelaySec}
        onSetAmbientCustomDelaySec={onSetAmbientCustomDelaySec}
        twoPaneEnabled={twoPaneEnabled}
        onSetTwoPaneEnabled={onSetTwoPaneEnabled}
        discordPresenceEnabled={discordPresenceEnabled}
        onSetDiscordPresenceEnabled={onSetDiscordPresenceEnabled}
        discordAppId={discordAppId}
        onSetDiscordAppId={onSetDiscordAppId}
        imgbbApiKey={imgbbApiKey}
        onSetImgbbApiKey={onSetImgbbApiKey}
        onReloadLibrary={onReloadLibrary}
        panelResizableEnabled={panelResizableEnabled}
        onSetPanelResizableEnabled={onSetPanelResizableEnabled}
        dockDraggableEnabled={dockDraggableEnabled}
        onSetDockDraggableEnabled={onSetDockDraggableEnabled}
        panelWidth={panelWidth}
        onSetPanelWidth={onSetPanelWidth}
        playEvents={playEvents}
        onResetStats={onResetStats}
        statsRangeTabsEnabled={statsRangeTabsEnabled}
        onSetStatsRangeTabsEnabled={onSetStatsRangeTabsEnabled}
        tabContextHandler={handleTabContextMenu}
        onToggleFavorite={onToggleFavorite}
        queue={queue}
        currentIndex={currentIndex}
        onAddToQueue={onAddToQueue}
        onPlayNext={onPlayNext}
        onRemoveFromQueue={onRemoveFromQueue}
        onReorderQueue={onReorderQueue}
        onClearUpNext={onClearUpNext}
        onJumpToQueueIndex={onJumpToQueueIndex}
        releases={releases}
        followedArtists={followedArtists}
        followOverrides={followOverrides}
        releasesRefreshing={releasesRefreshing}
        onRefreshReleases={onRefreshReleases}
        onAddFollowedArtist={onAddFollowedArtist}
        onExcludeFollowedArtist={onExcludeFollowedArtist}
        onClearFollowedArtistOverride={onClearFollowedArtistOverride}
        onClearLibrary={onClearLibrary}
        onShowCandidatePicker={showCandidatePicker}
        onTrackContextMenu={contextMenusEnabled ? handleTrackContextMenu : null}
        contextMenusEnabled={contextMenusEnabled}
        onSetContextMenusEnabled={updateContextMenusEnabled}
        onSetSide={updateDockSide}
      />

      {/* Manual-pick modal — opens when an automatic import fails. */}
      <CandidatePickerModal
        open={!!pickerState}
        candidates={pickerState?.candidates || []}
        meta={pickerState?.meta || null}
        onClose={() => setPickerState(null)}
        onPick={async (cand) => {
          if (!pickerState || !window.electronAPI?.importFromYoutubeId) {
            return { ok: false, error: 'Manual import not available.' };
          }
          const r = await window.electronAPI.importFromYoutubeId({
            videoId: cand.id,
            meta: pickerState.meta,
          });
          if (r?.ok && r.track) {
            // Run the original call-site callback (adds to library, marks as
            // downloaded in the Find tab UI, etc.)
            try { pickerState.onSuccess?.(r.track); } catch { /* ignore */ }
            setPickerState(null);
          }
          return r;
        }}
      />

      {/* Right-click context menu — opens at cursor coordinates with the
          item list provided by whichever element triggered it. Single
          state at the page root so any region can show one. */}
      {contextMenu ? (
        <ContextMenu
          anchorX={contextMenu.x}
          anchorY={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {/* Metadata editor — floating glass modal, only visible when a track is being edited */}
      {editingTrack ? (
        <MetadataEditor
          track={editingTrack}
          onSave={async (fields) => {
            const r = await onUpdateTrackMetadata(editingTrack.id, fields);
            if (r?.ok) setEditingTrackId(null);
            return r;
          }}
          onClose={() => setEditingTrackId(null)}
          accent={accent}
        />
      ) : null}

      {/* Album-wide metadata editor */}
      {editingAlbumScope ? (
        <AlbumMetadataEditor
          scope={editingAlbumScope}
          onSave={async (fields) => {
            const r = await onUpdateAlbumMetadata(editingAlbumScope.trackIds, fields);
            if (r?.ok) setEditingAlbumScope(null);
            return r;
          }}
          onClose={() => setEditingAlbumScope(null)}
          accent={accent}
        />
      ) : null}

      {/* Playlist create / edit modal */}
      {editingPlaylistObj ? (
        <PlaylistEditor
          mode={editingPlaylistObj.mode}
          playlist={editingPlaylistObj.playlist}
          pendingAddCount={editingPlaylistObj.mode === 'new' && pendingTracksForNewPlaylist?.length > 0
            ? pendingTracksForNewPlaylist.length : 0}
          onSave={async (fields) => {
            if (editingPlaylistObj.mode === 'new') {
              const r = await onCreatePlaylist(fields);
              if (r?.ok) {
                // If this flow was triggered from the "Add to playlist" menu,
                // queue those tracks into the fresh playlist now.
                const pending = pendingTracksForNewPlaylist;
                if (pending && pending.length > 0) {
                  try { await onAddTracksToPlaylist(r.id, pending); } catch { /* ignore */ }
                }
                setPendingTracksForNewPlaylist(null);
                setEditingPlaylist(null);
                setDockTab(`playlist:${r.id}`);
                if (dockCollapsed) setDockCollapsed(false);
              }
              return r;
            }
            const r = await onUpdatePlaylist(editingPlaylistObj.playlist.id, fields);
            if (r?.ok) setEditingPlaylist(null);
            return r;
          }}
          onClose={() => {
            setEditingPlaylist(null);
            setPendingTracksForNewPlaylist(null);
          }}
          accent={accent}
        />
      ) : null}

      {/* Add-to-playlist floating popover */}
      {addMenu ? (
        <AddToPlaylistMenu
          trackIds={addMenu.trackIds}
          anchorRect={addMenu.anchorRect}
          playlists={playlists}
          playlistCoverMap={playlistCoverMap}
          onPick={handlePickPlaylist}
          onNewPlaylist={handleNewPlaylistFromMenu}
          onClose={() => setAddMenu(null)}
          accent={accent}
        />
      ) : null}

      {/* Fullscreen cover overlay — opens via cover click or 'F' shortcut.
          Sits on top of the dock, lyrics, and all modals so the artwork is
          truly the only thing on screen. */}
      {coverFullscreenOpen && currentTrack ? (
        <CoverFullscreenOverlay
          coverUrl={coverUrl}
          title={focusTrack?.title}
          artist={focusTrack?.artist}
          album={focusTrack?.album}
          accent={accent}
          onClose={() => setCoverFullscreenOpen(false)}
        />
      ) : null}

      {/* Lyric share overlay — opens when the user picks lyrics and taps
          Share. Renders a beautifully-composed share card (cover art,
          selected lines, immerse wordmark) and provides Copy text, Copy
          image, Save image actions. Same z-index layer as the cover
          fullscreen overlay; both can't logically be open at once. */}
      {lyricShareOpen && currentTrack && lyricsSelection ? (() => {
        // Slice the appropriate line buffer based on which lyrics view is
        // active. Synced lyrics use the {time,text} array; plain lyrics
        // use the raw newline-split text array.
        let pickedLines = [];
        if (hasSyncedLyrics) {
          pickedLines = (lyricsData?.synced || [])
            .slice(lyricsSelection.start, lyricsSelection.end + 1)
            .map((l) => l.text || '');
        } else if (hasPlainLyrics) {
          pickedLines = (lyricsData?.plain || '')
            .split('\n')
            .slice(lyricsSelection.start, lyricsSelection.end + 1);
        }
        return (
          <LyricShareOverlay
            lines={pickedLines}
            track={currentTrack}
            coverUrl={coverUrl}
            accent={accent}
            onClose={() => setLyricShareOpen(false)}
          />
        );
      })() : null}

      {/* Dock-tab hide popover — opens on right-click of a hideable tab when
          pinnable-tabs is enabled. Single action, lightweight glass surface
          to match the dock aesthetic. Position is the click coordinates;
          we offset slightly so the cursor doesn't immediately sit on the
          item (which would feel jumpy). */}
      {dockTabMenu ? (
        <div
          role="menu"
          aria-label="Tab options"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            // Anchor above-and-left of the click. The dock buttons live near
            // the bottom edge of the window, so an above-positioned popover
            // is more reliable than below-the-cursor.
            left: Math.max(8, dockTabMenu.x - 70),
            top: Math.max(8, dockTabMenu.y - 56),
            zIndex: 100,
            minWidth: 140,
            padding: 4,
            borderRadius: 10,
            background: 'rgba(22, 22, 26, 0.92)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(20px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)',
            animation: 'immerseTabMenuIn 140ms ease-out',
          }}
        >
          <style>{`
            @keyframes immerseTabMenuIn {
              0%   { opacity: 0; transform: translateY(2px); }
              100% { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          <button
            type="button"
            role="menuitem"
            onClick={handleHideTabFromMenu}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', textAlign: 'left',
              padding: '8px 10px', borderRadius: 7, border: 'none',
              background: 'transparent', color: 'rgba(255,255,255,0.9)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            Hide tab
          </button>
        </div>
      ) : null}

    </div>
  );
}

/** MetadataEditor — floating glass modal for editing a track's metadata including cover art. */
function MetadataEditor({ track, onSave, onClose, accent }) {
  const [title, setTitle] = useState(track.title || '');
  const [artist, setArtist] = useState(track.artist || '');
  const [album, setAlbum] = useState(track.album || '');
  const [year, setYear] = useState(track.year != null ? String(track.year) : '');
  const [genre, setGenre] = useState(track.genre || '');
  const [trackNumber, setTrackNumber] = useState(track.trackNumber != null ? String(track.trackNumber) : '');
  const [discNumber, setDiscNumber] = useState(track.discNumber != null ? String(track.discNumber) : '');
  // Cover art — null = removed, string = current data URI or URL
  const [coverArt, setCoverArt] = useState(track.coverArt || null);
  const [coverDirty, setCoverDirty] = useState(false); // tracks whether user changed the cover
  const [coverMode, setCoverMode] = useState('preview'); // 'preview' | 'url'
  const [urlInput, setUrlInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [coverHover, setCoverHover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const firstInputRef = useRef(null);

  // Dirty-state check — only submit changed fields
  const hasChanges
    = title.trim() !== (track.title || '').trim()
    || artist.trim() !== (track.artist || '').trim()
    || album.trim() !== (track.album || '').trim()
    || year.trim() !== (track.year != null ? String(track.year) : '').trim()
    || genre.trim() !== (track.genre || '').trim()
    || trackNumber.trim() !== (track.trackNumber != null ? String(track.trackNumber) : '').trim()
    || discNumber.trim() !== (track.discNumber != null ? String(track.discNumber) : '').trim()
    || coverDirty;

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const readFileToDataUri = (file) => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File must be an image.'));
      return;
    }
    if (file.size > 2_000_000) {
      reject(new Error('Image too large (max 2MB source file).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });

  const handleFileSelect = async (file) => {
    if (!file) return;
    setError('');
    try {
      const data = await readFileToDataUri(file);
      if (data.length > 1_500_000) {
        setError('Image too large after encoding. Try a smaller image (~1MB or less).');
        return;
      }
      setCoverArt(data);
      setCoverDirty(true);
      setCoverMode('preview');
    } catch (e) {
      setError(e?.message || 'Could not load image.');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleUrlApply = () => {
    const u = urlInput.trim();
    if (!u) {
      setCoverArt(null);
      setCoverDirty(true);
      setCoverMode('preview');
      setUrlInput('');
      return;
    }
    if (!/^https?:\/\//i.test(u)) {
      setError('URL must start with http:// or https://');
      return;
    }
    setError('');
    setCoverArt(u);
    setCoverDirty(true);
    setCoverMode('preview');
    setUrlInput('');
  };

  const handleRemoveCover = () => {
    setCoverArt(null);
    setCoverDirty(true);
    setCoverMode('preview');
    setError('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!hasChanges || saving) return;
    setError('');
    setSaving(true);

    // Validate year
    const y = year.trim();
    if (y) {
      const n = Number(y);
      if (!Number.isFinite(n) || n < 1000 || n > 9999) {
        setError('Year must be 4 digits between 1000 and 9999 (or leave blank).');
        setSaving(false);
        return;
      }
    }

    // Validate track/disc numbers
    const tn = trackNumber.trim();
    if (tn) {
      const n = Number(tn);
      if (!Number.isFinite(n) || n < 1 || n > 9999) {
        setError('Track number must be between 1 and 9999 (or leave blank).');
        setSaving(false);
        return;
      }
    }
    const dn = discNumber.trim();
    if (dn) {
      const n = Number(dn);
      if (!Number.isFinite(n) || n < 1 || n > 99) {
        setError('Disc number must be between 1 and 99 (or leave blank).');
        setSaving(false);
        return;
      }
    }

    const fields = {};
    if (title.trim() !== (track.title || '').trim()) fields.title = title.trim();
    if (artist.trim() !== (track.artist || '').trim()) fields.artist = artist.trim();
    if (album.trim() !== (track.album || '').trim()) fields.album = album.trim();
    if (y !== (track.year != null ? String(track.year) : '').trim()) {
      fields.year = y ? Number(y) : null;
    }
    if (genre.trim() !== (track.genre || '').trim()) fields.genre = genre.trim();
    if (tn !== (track.trackNumber != null ? String(track.trackNumber) : '').trim()) {
      fields.trackNumber = tn ? Number(tn) : null;
    }
    if (dn !== (track.discNumber != null ? String(track.discNumber) : '').trim()) {
      fields.discNumber = dn ? Number(dn) : null;
    }
    if (coverDirty) fields.coverArt = coverArt;

    const r = await onSave(fields);
    setSaving(false);
    if (!r?.ok) setError(r?.error || 'Could not save.');
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 9,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff', fontSize: 12.5, outline: 'none',
    transition: 'border-color 0.15s, background 0.15s',
  };

  const fieldLabelStyle = {
    fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 4,
    fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase',
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <form onSubmit={handleSubmit}
        style={{
          width: 'min(460px, 100%)',
          maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          borderRadius: 16,
          background: 'rgba(22, 22, 24, 0.85)',
          backdropFilter: 'blur(40px) saturate(1.6)', WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(${accent},0.15), inset 0 1px 0 rgba(255,255,255,0.06)`,
        }}>
        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = ''; // allow re-selecting the same file
          }} />

        {/* Header with close button */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Edit metadata</div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close"
            style={{
              width: 26, height: 26, borderRadius: 7, border: 'none',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Cover art + title/artist row */}
        <div style={{ display: 'flex', gap: 14, padding: '4px 16px 14px', alignItems: 'flex-start' }}>
          {/* Cover art editor */}
          <div style={{ flexShrink: 0 }}>
            <div
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={() => setCoverHover(true)}
              onMouseLeave={() => setCoverHover(false)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              title="Click to choose image — or drop one here"
              style={{
                width: 96, height: 96, borderRadius: 10, overflow: 'hidden',
                background: '#0f0f0f', cursor: 'pointer', position: 'relative',
                border: dragOver ? `2px solid rgba(${accent},0.8)` : '2px solid transparent',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                transition: 'border-color 0.15s',
              }}>
              {coverArt ? (
                <img src={coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#2a2a2a', background: 'rgba(255,255,255,0.02)',
                }}>
                  <span style={{ transform: 'scale(1.8)' }}><Icons.AlbumSidebar /></span>
                </div>
              )}
              {/* Hover overlay */}
              {(coverHover || dragOver) ? (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.6)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4,
                  color: '#fff', fontSize: 10.5, fontWeight: 600,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>{dragOver ? 'Drop to set' : coverArt ? 'Change' : 'Add cover'}</span>
                </div>
              ) : null}
            </div>
            {/* Small action row under cover */}
            <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'center' }}>
              <button type="button" onClick={() => setCoverMode((m) => m === 'url' ? 'preview' : 'url')}
                title="Paste an image URL"
                style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none',
                  background: coverMode === 'url' ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: coverMode === 'url' ? '#fff' : 'rgba(255,255,255,0.55)',
                  fontSize: 9.5, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                URL
              </button>
              {coverArt ? (
                <button type="button" onClick={handleRemoveCover}
                  title="Remove cover art"
                  style={{
                    padding: '3px 8px', borderRadius: 6, border: 'none',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: 9.5, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          {/* Right side: track name preview + URL input when in URL mode */}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            {coverMode === 'url' ? (
              <>
                <div style={fieldLabelStyle}>Image URL</div>
                <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlApply(); } }}
                  placeholder="https://…/cover.jpg" style={inputStyle} autoFocus
                  onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  <button type="button" onClick={handleUrlApply}
                    style={{
                      padding: '4px 12px', borderRadius: 7, border: 'none',
                      background: `rgba(${accent},0.3)`, color: '#fff',
                      fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                    }}>
                    Apply
                  </button>
                  <button type="button" onClick={() => { setCoverMode('preview'); setUrlInput(''); }}
                    style={{
                      padding: '4px 12px', borderRadius: 7,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'transparent', color: 'rgba(255,255,255,0.7)',
                      fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                    }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5,
                overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
              }}>
                <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>{track.title || 'Untitled'}</span>
                <br />
                <span style={{ fontSize: 10.5 }}>{track.artist || '—'}</span>
                <br />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 6, display: 'block' }}>
                  Click cover to choose an image, drop one in, or paste a URL.
                </span>
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 16px' }} />

        {/* Form body */}
        <div style={{ padding: '14px 16px 12px' }}>
          <div style={fieldLabelStyle}>Title</div>
          <input ref={firstInputRef} type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title" style={{ ...inputStyle, marginBottom: 10 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />

          <div style={fieldLabelStyle}>Artist</div>
          <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist" style={{ ...inputStyle, marginBottom: 10 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />

          <div style={fieldLabelStyle}>Album</div>
          <input type="text" value={album} onChange={(e) => setAlbum(e.target.value)}
            placeholder="Album" style={{ ...inputStyle, marginBottom: 10 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />

          {/* Year + Genre side by side */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: '0 0 90px' }}>
              <div style={fieldLabelStyle}>Year</div>
              <input type="text" inputMode="numeric" maxLength={4} value={year}
                onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="2024" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={fieldLabelStyle}>Genre</div>
              <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)}
                placeholder="Electronic, Pop, …" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
            </div>
          </div>

          {/* Track # + Disc # side by side */}
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={fieldLabelStyle}>Track #</div>
              <input type="text" inputMode="numeric" maxLength={4} value={trackNumber}
                onChange={(e) => setTrackNumber(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={fieldLabelStyle}>Disc #</div>
              <input type="text" inputMode="numeric" maxLength={2} value={discNumber}
                onChange={(e) => setDiscNumber(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
            </div>
          </div>

          {error ? (
            <div style={{
              marginTop: 10, padding: '7px 10px', borderRadius: 8,
              background: 'rgba(243,114,114,0.1)', border: '1px solid rgba(243,114,114,0.3)',
              color: '#f37272', fontSize: 10.5, lineHeight: 1.4,
            }}>
              {error}
            </div>
          ) : null}

          <div style={{
            marginTop: 10, fontSize: 9.5, color: 'rgba(255,255,255,0.35)',
            lineHeight: 1.4,
          }}>
            Changes are saved to the library only — the audio file is not modified.
          </div>
        </div>

        {/* Footer actions */}
        <div style={{
          display: 'flex', gap: 8, padding: '12px 16px 14px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <button type="button" onClick={onClose}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 9,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent', color: 'rgba(255,255,255,0.75)',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}>
            Cancel
          </button>
          <button type="submit" disabled={!hasChanges || saving}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 9, border: 'none',
              background: !hasChanges || saving ? 'rgba(255,255,255,0.06)' : `rgba(${accent},0.3)`,
              color: !hasChanges || saving ? 'rgba(255,255,255,0.35)' : '#fff',
              fontSize: 11.5, fontWeight: 700,
              cursor: !hasChanges || saving ? 'default' : 'pointer',
              transition: 'all 0.15s',
              boxShadow: !hasChanges || saving ? 'none' : `0 2px 12px rgba(${accent},0.2)`,
            }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}


/**
 * AlbumMetadataEditor — edit album-level metadata (album name, artist, year,
 * genre, cover art) across all tracks in an album, or scoped to a single disc.
 *
 * scope: { album, artist, coverArt, trackIds, sampleTrack, discNumber }
 *   discNumber === null  → whole-album scope
 *   discNumber === 1,2,… → only tracks on that disc
 */
function AlbumMetadataEditor({ scope, onSave, onClose, accent }) {
  const { album: initAlbum, artist: initArtist, coverArt: initCover, sampleTrack, trackIds, discNumber } = scope;

  // Year/genre come from the sample track — since the grouping logic already
  // treats album metadata as consistent per-album, this is safe.
  const initYear = sampleTrack?.year != null ? String(sampleTrack.year) : '';
  const initGenre = sampleTrack?.genre || '';

  const [albumName, setAlbumName] = useState(initAlbum || '');
  const [artist, setArtist] = useState(initArtist || '');
  const [year, setYear] = useState(initYear);
  const [genre, setGenre] = useState(initGenre);
  const [coverArt, setCoverArt] = useState(initCover || null);
  const [coverDirty, setCoverDirty] = useState(false);
  const [coverMode, setCoverMode] = useState('preview'); // 'preview' | 'url'
  const [urlInput, setUrlInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [coverHover, setCoverHover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const firstInputRef = useRef(null);

  const hasChanges
    = albumName.trim() !== (initAlbum || '').trim()
    || artist.trim() !== (initArtist || '').trim()
    || year.trim() !== initYear.trim()
    || genre.trim() !== initGenre.trim()
    || coverDirty;

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const readFileToDataUri = (file) => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File must be an image.'));
      return;
    }
    if (file.size > 2_000_000) {
      reject(new Error('Image too large (max 2MB source file).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });

  const handleFileSelect = async (file) => {
    if (!file) return;
    setError('');
    try {
      const data = await readFileToDataUri(file);
      if (data.length > 1_500_000) {
        setError('Image too large after encoding. Try a smaller image (~1MB or less).');
        return;
      }
      setCoverArt(data);
      setCoverDirty(true);
      setCoverMode('preview');
    } catch (e) {
      setError(e?.message || 'Could not load image.');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleUrlApply = () => {
    const u = urlInput.trim();
    if (!u) {
      setCoverArt(null);
      setCoverDirty(true);
      setCoverMode('preview');
      setUrlInput('');
      return;
    }
    if (!/^https?:\/\//i.test(u)) {
      setError('URL must start with http:// or https://');
      return;
    }
    setError('');
    setCoverArt(u);
    setCoverDirty(true);
    setCoverMode('preview');
    setUrlInput('');
  };

  const handleRemoveCover = () => {
    setCoverArt(null);
    setCoverDirty(true);
    setCoverMode('preview');
    setError('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!hasChanges || saving) return;
    setError('');
    setSaving(true);

    const y = year.trim();
    if (y) {
      const n = Number(y);
      if (!Number.isFinite(n) || n < 1000 || n > 9999) {
        setError('Year must be 4 digits between 1000 and 9999 (or leave blank).');
        setSaving(false);
        return;
      }
    }

    const fields = {};
    if (albumName.trim() !== (initAlbum || '').trim()) fields.album = albumName.trim();
    if (artist.trim() !== (initArtist || '').trim()) fields.artist = artist.trim();
    if (y !== initYear.trim()) fields.year = y ? Number(y) : null;
    if (genre.trim() !== initGenre.trim()) fields.genre = genre.trim();
    if (coverDirty) fields.coverArt = coverArt;

    const r = await onSave(fields);
    setSaving(false);
    if (!r?.ok) setError(r?.error || 'Could not save.');
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 9,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff', fontSize: 12.5, outline: 'none',
    transition: 'border-color 0.15s, background 0.15s',
  };

  const fieldLabelStyle = {
    fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 4,
    fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase',
  };

  const titleText = discNumber != null ? `Edit disc ${discNumber}` : 'Edit album';
  const scopeText = discNumber != null
    ? `${trackIds.length} tracks on disc ${discNumber} of “${initAlbum}”`
    : `${trackIds.length} tracks in “${initAlbum}”`;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <form onSubmit={handleSubmit}
        style={{
          width: 'min(460px, 100%)',
          maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          borderRadius: 16,
          background: 'rgba(22, 22, 24, 0.85)',
          backdropFilter: 'blur(40px) saturate(1.6)', WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(${accent},0.15), inset 0 1px 0 rgba(255,255,255,0.06)`,
        }}>
        <input ref={fileInputRef} type="file" accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = '';
          }} />

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{titleText}</div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close"
            style={{
              width: 26, height: 26, borderRadius: 7, border: 'none',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Cover + scope context */}
        <div style={{ display: 'flex', gap: 14, padding: '4px 16px 14px', alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <div
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={() => setCoverHover(true)}
              onMouseLeave={() => setCoverHover(false)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              title="Click to choose image — or drop one here"
              style={{
                width: 96, height: 96, borderRadius: 10, overflow: 'hidden',
                background: '#0f0f0f', cursor: 'pointer', position: 'relative',
                border: dragOver ? `2px solid rgba(${accent},0.8)` : '2px solid transparent',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                transition: 'border-color 0.15s',
              }}>
              {coverArt ? (
                <img src={coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#2a2a2a', background: 'rgba(255,255,255,0.02)',
                }}>
                  <span style={{ transform: 'scale(1.8)' }}><Icons.AlbumSidebar /></span>
                </div>
              )}
              {(coverHover || dragOver) ? (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.6)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4,
                  color: '#fff', fontSize: 10.5, fontWeight: 600,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>{dragOver ? 'Drop to set' : coverArt ? 'Change' : 'Add cover'}</span>
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'center' }}>
              <button type="button" onClick={() => setCoverMode((m) => m === 'url' ? 'preview' : 'url')}
                title="Paste an image URL"
                style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none',
                  background: coverMode === 'url' ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: coverMode === 'url' ? '#fff' : 'rgba(255,255,255,0.55)',
                  fontSize: 9.5, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                URL
              </button>
              {coverArt ? (
                <button type="button" onClick={handleRemoveCover}
                  title="Remove cover art"
                  style={{
                    padding: '3px 8px', borderRadius: 6, border: 'none',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: 9.5, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            {coverMode === 'url' ? (
              <>
                <div style={fieldLabelStyle}>Image URL</div>
                <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlApply(); } }}
                  placeholder="https://…/cover.jpg" style={inputStyle} autoFocus
                  onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  <button type="button" onClick={handleUrlApply}
                    style={{
                      padding: '4px 12px', borderRadius: 7, border: 'none',
                      background: `rgba(${accent},0.3)`, color: '#fff',
                      fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                    }}>
                    Apply
                  </button>
                  <button type="button" onClick={() => { setCoverMode('preview'); setUrlInput(''); }}
                    style={{
                      padding: '4px 12px', borderRadius: 7,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'transparent', color: 'rgba(255,255,255,0.7)',
                      fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                    }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5,
              }}>
                <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>Applies to {scopeText}</span>
                <br />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 6, display: 'block' }}>
                  All tracks in this {discNumber != null ? 'disc' : 'album'} will get these values.
                </span>
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 16px' }} />

        {/* Form fields */}
        <div style={{ padding: '14px 16px 12px' }}>
          <div style={fieldLabelStyle}>Album</div>
          <input ref={firstInputRef} type="text" value={albumName} onChange={(e) => setAlbumName(e.target.value)}
            placeholder="Album name" style={{ ...inputStyle, marginBottom: 10 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />

          <div style={fieldLabelStyle}>Artist</div>
          <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist" style={{ ...inputStyle, marginBottom: 10 }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: '0 0 90px' }}>
              <div style={fieldLabelStyle}>Year</div>
              <input type="text" inputMode="numeric" maxLength={4} value={year}
                onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="2024" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={fieldLabelStyle}>Genre</div>
              <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)}
                placeholder="Electronic, Pop, …" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
            </div>
          </div>

          {error ? (
            <div style={{
              marginTop: 10, padding: '7px 10px', borderRadius: 8,
              background: 'rgba(243,114,114,0.1)', border: '1px solid rgba(243,114,114,0.3)',
              color: '#f37272', fontSize: 10.5, lineHeight: 1.4,
            }}>
              {error}
            </div>
          ) : null}

          <div style={{
            marginTop: 10, fontSize: 9.5, color: 'rgba(255,255,255,0.35)',
            lineHeight: 1.4,
          }}>
            Changes are saved to the library only — audio files are not modified.
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: 8, padding: '12px 16px 14px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <button type="button" onClick={onClose}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 9,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent', color: 'rgba(255,255,255,0.75)',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}>
            Cancel
          </button>
          <button type="submit" disabled={!hasChanges || saving}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 9, border: 'none',
              background: !hasChanges || saving ? 'rgba(255,255,255,0.06)' : `rgba(${accent},0.3)`,
              color: !hasChanges || saving ? 'rgba(255,255,255,0.35)' : '#fff',
              fontSize: 11.5, fontWeight: 700,
              cursor: !hasChanges || saving ? 'default' : 'pointer',
              transition: 'all 0.15s',
              boxShadow: !hasChanges || saving ? 'none' : `0 2px 12px rgba(${accent},0.2)`,
            }}>
            {saving ? 'Saving…' : `Save to ${trackIds.length} track${trackIds.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </div>
  );
}


function GhostBtn({ children, onClick, title, active, size = 36 }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: size, height: size, borderRadius: '50%', border: 'none', background: 'transparent',
        color: active ? '#fff' : hov ? '#fff' : 'rgba(255,255,255,0.65)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', padding: 0, transition: 'color 0.16s',
      }}
    >
      {active ? (
        <span
          aria-hidden
          style={{
            position: 'absolute', bottom: 2, width: 3, height: 3, borderRadius: '50%', background: '#fff',
          }}
        />
      ) : null}
      {children}
    </button>
  );
}

/** Reva UI-style skip button — thin lineal icon, just brightens on hover */
function RevaTransportBtn({ children, onClick, title }) {
  const [hov, setHov] = useState(false);
  return (
    <Tooltip label={title} side="top">
      <button type="button" onClick={onClick} aria-label={title}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'transparent',
          color: hov ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.75)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'color 0.2s, transform 0.15s',
          transform: hov ? 'scale(1.08)' : 'scale(1)',
        }}>
        {children}
      </button>
    </Tooltip>
  );
}

/** Reva UI-style play/pause — no circle, just the rounded-triangle outline (larger than skip buttons) */
function RevaPlayBtn({ onClick, isPlaying }) {
  const [hov, setHov] = useState(false);
  const label = isPlaying ? 'Pause' : 'Play';
  return (
    <Tooltip label={label} side="top">
      <button type="button" onClick={onClick} aria-label={label}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          border: 'none', background: 'transparent',
          color: hov ? '#fff' : 'rgba(255,255,255,0.85)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
          transition: 'color 0.2s, transform 0.15s',
          transform: hov ? 'scale(1.08)' : 'scale(1)',
          flexShrink: 0,
        }}>
        {isPlaying ? (
          /* Pause — two rounded outlined lines/pills */
          <svg width="38" height="38" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 8 C 11 7.4, 11.5 7, 12.1 7 L 12.9 7 C 13.5 7, 14 7.4, 14 8 L 14 24 C 14 24.6, 13.5 25, 12.9 25 L 12.1 25 C 11.5 25, 11 24.6, 11 24 Z" />
            <path d="M18 8 C 18 7.4, 18.5 7, 19.1 7 L 19.9 7 C 20.5 7, 21 7.4, 21 8 L 21 24 C 21 24.6, 20.5 25, 19.9 25 L 19.1 25 C 18.5 25, 18 24.6, 18 24 Z" />
          </svg>
        ) : (
          /* Play — large rounded-corner outlined triangle, matching skip button style */
          <svg width="38" height="38" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2 }}>
            <path d="M10 7.5 C 10 6.3, 11.3 5.8, 12.3 6.5 L 24 15.2 C 24.8 15.7, 24.8 16.3, 24 16.8 L 12.3 25.5 C 11.3 26.2, 10 25.7, 10 24.5 Z" />
          </svg>
        )}
      </button>
    </Tooltip>
  );
}

/** Reva UI-style secondary button — shuffle/repeat — bare icon with active dot */
function RevaSecondaryBtn({ children, onClick, title, active }) {
  const [hov, setHov] = useState(false);
  return (
    <Tooltip label={title} side="top">
      <button type="button" onClick={onClick} aria-label={title}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          width: 32, height: 40, border: 'none', background: 'transparent',
          color: active ? '#fff' : hov ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)',
          cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.2s',
          position: 'relative',
        }}>
        {children}
        {/* Active dot indicator below icon */}
        {active ? (
          <span aria-hidden style={{
            position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
            width: 3, height: 3, borderRadius: '50%',
            background: '#fff',
          }} />
        ) : null}
      </button>
    </Tooltip>
  );
}


/**
 * AnimatedGradientBg — Apple Music style animated background.
 *
 * Based on the reverse-engineered technique from aadishv.dev/music:
 * Apple Music stacks 4 oversaturated copies of the album art at different
 * scales, each spinning. The two smaller copies also orbit in circles.
 * A heavy Gaussian blur is applied on top, creating the flowing colour field.
 *
 * We approximate this in canvas 2D:
 *   - Draw the cover art into a small offscreen canvas at low resolution
 *   - Each frame, paint 4 copies at different sizes/rotations/positions
 *   - The canvas itself is rendered at 1/4 resolution and CSS-scaled up,
 *     which provides the Gaussian blur effect naturally (bicubic upscaling
 *     of a very blurry small canvas = smooth gradient)
 *   - An additional CSS filter blur + a darkening overlay completes the look
 *
 * Falls back to a static gradient when no cover art is available.
 */

/* =========================================================================
 *  CoverFullscreenOverlay — edge-to-edge cover art with a soft blurred
 *  backdrop sampled from the same image. Press Escape, click the close
 *  affordance, or click outside the cover to dismiss.
 *
 *  Pure read-only display: no playback controls. The dock and progress are
 *  still reachable via keyboard shortcuts (Space, arrows) which the rest
 *  of the app already wires up; cluttering the fullscreen view with a
 *  duplicate control surface would defeat the point of the mode.
 * ========================================================================= */
function CoverFullscreenOverlay({ coverUrl, title, artist, album, accent, onClose }) {
  // Trap-on-mount focus so Escape works immediately and the keyboard reader
  // announces the overlay.
  const dialogRef = useRef(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title || 'Cover art'} — fullscreen`}
      tabIndex={-1}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '4vmin',
        background: '#000',
        cursor: 'zoom-out',
        animation: 'immerseFullscreenIn 220ms ease-out',
        outline: 'none',
      }}
    >
      <style>{`
        @keyframes immerseFullscreenIn {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes immerseFullscreenCoverIn {
          0%   { opacity: 0; transform: scale(0.96); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Blurred backdrop — same cover, scaled up huge and saturated, so the
          background colour shifts with the artwork. */}
      {coverUrl ? (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: -80,
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'blur(80px) saturate(1.45) brightness(0.55)',
            opacity: 0.85,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {/* Vignette over the backdrop so the cover & text always have contrast. */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Close pill — top-right. Dismisses the overlay; Escape works too. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose?.(); }}
        title="Close (Esc)"
        aria-label="Close fullscreen"
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 2,
          width: 36, height: 36, borderRadius: 999,
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,255,255,0.14)',
          color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.8)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.55)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* The cover itself — clicking it should NOT close (only the backdrop). */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', zIndex: 1,
          width: 'min(86vmin, 80vh)', aspectRatio: '1',
          borderRadius: 18, overflow: 'hidden',
          boxShadow: `0 32px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(${accent},0.4)`,
          background: '#111',
          animation: 'immerseFullscreenCoverIn 280ms cubic-bezier(0.2, 0.7, 0.2, 1)',
          cursor: 'default',
        }}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title ? `Cover for ${title}` : 'Cover art'}
            decoding="async"
            style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              // High-quality scaling matters most here — the cover may be
              // upscaled significantly to fill a 27"+ monitor.
              imageRendering: 'high-quality',
            }}
            draggable={false}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#444',
          }}>
            <Icons.AlbumSidebar />
          </div>
        )}
      </div>

      {/* Track info — sits below the cover, calm typography. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', zIndex: 1,
          marginTop: '3vmin', textAlign: 'center', maxWidth: '80vw', cursor: 'default',
        }}
      >
        <div style={{
          fontSize: 'clamp(18px, 2.4vmin, 28px)', fontWeight: 800, color: '#fff',
          letterSpacing: '-0.02em', lineHeight: 1.15, textShadow: '0 2px 24px rgba(0,0,0,0.6)',
        }}>
          {(title || 'No track').trim()}
        </div>
        {artist ? (
          <div style={{
            marginTop: 6,
            fontSize: 'clamp(13px, 1.6vmin, 17px)', color: 'rgba(255,255,255,0.78)', fontWeight: 500,
            textShadow: '0 1px 14px rgba(0,0,0,0.55)',
          }}>
            {artist.trim()}
            {album ? <span style={{ color: 'rgba(255,255,255,0.45)' }}>{` · ${album.trim()}`}</span> : null}
          </div>
        ) : null}
        <div style={{
          marginTop: 14, fontSize: 10, letterSpacing: '0.08em',
          color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
        }}>
          esc to close
        </div>
      </div>
    </div>
  );
}


/* =========================================================================
 *  LyricShareOverlay — share a passage of lyrics as a beautifully
 *  composed card. Modelled on iOS / Apple Music's "Share Lyrics" sheet,
 *  re-skinned to match Immerse: blurred cover backdrop, accent-tinted
 *  glass, the cover thumb anchoring the composition, the selected lyric
 *  lines set in a generous editorial type, and a tasteful "immerse"
 *  wordmark in the corner.
 *
 *  Why a dedicated component:
 *    - The export pipeline (serialize to PNG / copy to clipboard / save
 *      to disk) is non-trivial and benefits from being all in one place.
 *    - The card itself is rendered as an SVG with `foreignObject` for
 *      the text. SVG is what we serialize to a PNG via canvas, so the
 *      visible preview and the exported image are by construction the
 *      same pixels.
 *    - Sits at z-index 50, the same layer as CoverFullscreenOverlay,
 *      so neither can be open over the other.
 *
 *  Esc closes. Click outside the card closes. Inside the card, clicks
 *  do nothing (won't accidentally dismiss while interacting with a
 *  button).
 * ========================================================================= */
function LyricShareOverlay({
  lines,             // array of strings — the selected lyric text lines
  track,             // { title, artist, album, coverArt? }
  coverUrl,          // resolved cover URL (may differ from track.coverArt)
  accent,
  onClose,
}) {
  const dialogRef = useRef(null);
  const cardRef = useRef(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);

  // Esc to close — own listener so we don't have to plumb through.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Toast within the overlay — tiny self-contained confirmation, fades
  // out automatically. We don't reach into the app-wide toast bus from
  // here because the overlay is z:50 and would visually sit above any
  // global toasts anyway.
  const [innerToast, setInnerToast] = useState(null);
  const showInner = useCallback((msg) => {
    setInnerToast(msg);
    setTimeout(() => setInnerToast(null), 1800);
  }, []);

  const title = (track?.title || '').trim() || 'Unknown track';
  const artist = (track?.artist || '').trim() || 'Unknown artist';

  // Filter blank lines and keep just the visible ones.
  const trimmed = lines.filter((l) => l && l.trim().length > 0);
  const lineCount = trimmed.length;

  // --- Export helpers ---------------------------------------------------
  // The card is a 1080×1350 portrait (4:5 — IG portrait / Apple Music
  // share-card aspect). Rendering goes through the Canvas 2D API directly,
  // not through SVG `foreignObject`. Reasons:
  //   1. Cover art comes through Immerse's custom `studio-cover://` protocol.
  //      Loading it inside a Blob-URL SVG taints the canvas (silent failure
  //      mode: `canvas.toBlob()` returns null with no error).
  //   2. Browser SVG-to-canvas raster has a long history of fragile edge
  //      cases — `foreignObject` HTML doesn't always paint, embedded
  //      `<image>` doesn't always load, `<filter>` doesn't always render.
  //   3. Canvas 2D wrapping/text/clipping/gradients are all stable in
  //      Electron's Chromium and let us match Apple Music's widget look
  //      pixel-for-pixel.
  const SHARE_W = 1080;
  const SHARE_H = 1350;
  // Safe area for the lyric block — leaves room for the header (cover
  // thumb + title/artist) above and the IMMERSE footer below.
  const TEXT_PADDING_X = 100;          // horizontal inset for lyric column
  const TEXT_AREA_TOP = 360;           // below the header band
  const TEXT_AREA_BOTTOM = SHARE_H - 200; // above the footer band
  const TEXT_AREA_H = TEXT_AREA_BOTTOM - TEXT_AREA_TOP;
  const TEXT_AREA_W = SHARE_W - TEXT_PADDING_X * 2 - 32; // minus accent-bar gutter

  /**
   * Load the cover image into an HTMLImageElement that's drawable to a
   * canvas. Critical detail: we DO NOT use `fetch().then(blob).then(dataURL)`
   * because that path goes through different security plumbing than a
   * direct `<img>` load and can produce a canvas-tainting result for
   * `studio-cover://` URLs. A bare `<img src=...>` with `crossOrigin =
   * 'anonymous'` works because Electron registers `studio-cover` as a
   * standard protocol (see main.js `protocol.handle('studio-cover', ...)`)
   * and the in-renderer load is same-origin from the canvas's POV.
   *
   * Returns null if the cover fails to load, so the rest of the card can
   * still render with a placeholder.
   */
  const loadCoverImage = useCallback(() => {
    return new Promise((resolve) => {
      if (!coverUrl) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        // Retry without crossOrigin — some custom protocols (file://,
        // studio-cover://) reject the CORS preflight but still load when
        // accessed without it.
        const fallback = new Image();
        fallback.onload = () => resolve(fallback);
        fallback.onerror = (e) => {
          console.warn('cover load failed (both attempts):', e);
          resolve(null);
        };
        fallback.src = coverUrl;
      };
      img.src = coverUrl;
    });
  }, [coverUrl]);

  /**
   * Wrap text into lines that fit a max pixel width, given a measured
   * canvas context. Returns an array of strings (the wrapped lines).
   * Splits on whitespace; doesn't break inside words.
   */
  const wrapTextLine = (ctx, text, maxWidth) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const out = [];
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const probe = `${line} ${words[i]}`;
      if (ctx.measureText(probe).width <= maxWidth) {
        line = probe;
      } else {
        out.push(line);
        line = words[i];
      }
    }
    out.push(line);
    return out;
  };

  /**
   * Pick the largest font size whose wrapped lyric block fits inside the
   * safe area. Measurement uses the same canvas context the rasterizer
   * will use, so the on-screen preview and the export agree.
   */
  const fitFontSize = (ctx) => {
    const candidates = [72, 64, 58, 52, 46, 40, 34, 30, 26, 22, 18];
    for (const size of candidates) {
      ctx.font = `700 ${size}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`;
      const lineHeight = size * 1.28;
      const paragraphGap = size * 0.32;
      let totalH = 0;
      for (let i = 0; i < trimmed.length; i += 1) {
        const wrapped = wrapTextLine(ctx, trimmed[i], TEXT_AREA_W);
        totalH += wrapped.length * lineHeight;
        if (i < trimmed.length - 1) totalH += paragraphGap;
      }
      if (totalH <= TEXT_AREA_H) return size;
    }
    return candidates[candidates.length - 1];
  };

  /**
   * Render the share card directly to an offscreen canvas using Canvas
   * 2D primitives. Returns a PNG Blob ready for clipboard write or
   * download. Throws if the canvas operation itself fails.
   */
  const rasterize = useCallback(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_W;
    canvas.height = SHARE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');

    const cover = await loadCoverImage();

    // --- Backdrop --------------------------------------------------
    // The cover, scaled to fill, with a heavy blur on top via stacked
    // canvas filters. Canvas `filter` property supports CSS filters in
    // Chromium / Electron.
    if (cover) {
      ctx.save();
      ctx.filter = 'blur(60px) saturate(1.45) brightness(0.5)';
      // Cover-fit the image, bleeding past the canvas edges so the blur
      // doesn't show seams.
      const scale = Math.max(
        (SHARE_W + 200) / cover.naturalWidth,
        (SHARE_H + 200) / cover.naturalHeight,
      );
      const drawW = cover.naturalWidth * scale;
      const drawH = cover.naturalHeight * scale;
      ctx.drawImage(
        cover,
        (SHARE_W - drawW) / 2,
        (SHARE_H - drawH) / 2,
        drawW, drawH,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    }

    // --- Vignette (top→bottom darkening) ---------------------------
    const vignette = ctx.createLinearGradient(0, 0, 0, SHARE_H);
    vignette.addColorStop(0, 'rgba(0,0,0,0.32)');
    vignette.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);

    // --- Accent glow from bottom-center ----------------------------
    const glow = ctx.createRadialGradient(
      SHARE_W / 2, SHARE_H, 0,
      SHARE_W / 2, SHARE_H, SHARE_H * 0.9,
    );
    glow.addColorStop(0, `rgba(${accent}, 0.45)`);
    glow.addColorStop(0.6, `rgba(${accent}, 0.1)`);
    glow.addColorStop(1, `rgba(${accent}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);

    // --- Cover thumb -----------------------------------------------
    const COVER_X = TEXT_PADDING_X;
    const COVER_Y = 130;
    const COVER_SIZE = 130;
    const COVER_RADIUS = 18;
    ctx.save();
    // Rounded-rect clip for the cover.
    const r = COVER_RADIUS;
    ctx.beginPath();
    ctx.moveTo(COVER_X + r, COVER_Y);
    ctx.lineTo(COVER_X + COVER_SIZE - r, COVER_Y);
    ctx.quadraticCurveTo(COVER_X + COVER_SIZE, COVER_Y, COVER_X + COVER_SIZE, COVER_Y + r);
    ctx.lineTo(COVER_X + COVER_SIZE, COVER_Y + COVER_SIZE - r);
    ctx.quadraticCurveTo(COVER_X + COVER_SIZE, COVER_Y + COVER_SIZE, COVER_X + COVER_SIZE - r, COVER_Y + COVER_SIZE);
    ctx.lineTo(COVER_X + r, COVER_Y + COVER_SIZE);
    ctx.quadraticCurveTo(COVER_X, COVER_Y + COVER_SIZE, COVER_X, COVER_Y + COVER_SIZE - r);
    ctx.lineTo(COVER_X, COVER_Y + r);
    ctx.quadraticCurveTo(COVER_X, COVER_Y, COVER_X + r, COVER_Y);
    ctx.closePath();
    ctx.clip();
    if (cover) {
      // Cover-fit the source image into the thumb rect.
      const sScale = Math.max(
        COVER_SIZE / cover.naturalWidth,
        COVER_SIZE / cover.naturalHeight,
      );
      const sW = cover.naturalWidth * sScale;
      const sH = cover.naturalHeight * sScale;
      ctx.drawImage(
        cover,
        COVER_X + (COVER_SIZE - sW) / 2,
        COVER_Y + (COVER_SIZE - sH) / 2,
        sW, sH,
      );
    } else {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(COVER_X, COVER_Y, COVER_SIZE, COVER_SIZE);
    }
    ctx.restore();

    // --- Title + artist -------------------------------------------
    const META_X = COVER_X + COVER_SIZE + 24;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 34px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 1;
    // Truncate title/artist to fit one line each.
    const maxMetaW = SHARE_W - META_X - TEXT_PADDING_X;
    const fitOneLine = (text, fontSpec) => {
      ctx.font = fontSpec;
      if (ctx.measureText(text).width <= maxMetaW) return text;
      let s = text;
      while (s.length > 1 && ctx.measureText(`${s}…`).width > maxMetaW) {
        s = s.slice(0, -1);
      }
      return `${s}…`;
    };
    ctx.font = '700 34px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    const fittedTitle = fitOneLine(title, ctx.font);
    ctx.fillText(fittedTitle, META_X, COVER_Y + 52);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '500 26px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    const fittedArtist = fitOneLine(artist, ctx.font);
    ctx.fillText(fittedArtist, META_X, COVER_Y + 92);
    // Reset shadow before drawing further elements that don't want it.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // --- Accent bar -----------------------------------------------
    const BAR_X = TEXT_PADDING_X;
    const BAR_Y = TEXT_AREA_TOP + 6;
    const BAR_H = TEXT_AREA_H - 12;
    const BAR_W = 6;
    ctx.fillStyle = `rgb(${accent})`;
    // Rounded pill
    ctx.beginPath();
    const rb = BAR_W / 2;
    ctx.moveTo(BAR_X + rb, BAR_Y);
    ctx.lineTo(BAR_X + BAR_W - rb, BAR_Y);
    ctx.quadraticCurveTo(BAR_X + BAR_W, BAR_Y, BAR_X + BAR_W, BAR_Y + rb);
    ctx.lineTo(BAR_X + BAR_W, BAR_Y + BAR_H - rb);
    ctx.quadraticCurveTo(BAR_X + BAR_W, BAR_Y + BAR_H, BAR_X + BAR_W - rb, BAR_Y + BAR_H);
    ctx.lineTo(BAR_X + rb, BAR_Y + BAR_H);
    ctx.quadraticCurveTo(BAR_X, BAR_Y + BAR_H, BAR_X, BAR_Y + BAR_H - rb);
    ctx.lineTo(BAR_X, BAR_Y + rb);
    ctx.quadraticCurveTo(BAR_X, BAR_Y, BAR_X + rb, BAR_Y);
    ctx.closePath();
    ctx.fill();

    // --- Lyric text -----------------------------------------------
    // Pick the largest font that fits, then render the wrapped lines
    // centered vertically inside the safe area.
    const bodyFontPx = fitFontSize(ctx);
    ctx.font = `700 ${bodyFontPx}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 2;

    const lineHeight = bodyFontPx * 1.28;
    const paragraphGap = bodyFontPx * 0.32;
    // Pre-wrap so we can vertically center.
    const wrappedParagraphs = trimmed.map((line) => wrapTextLine(ctx, line, TEXT_AREA_W));
    let totalH = 0;
    wrappedParagraphs.forEach((lines2, i) => {
      totalH += lines2.length * lineHeight;
      if (i < wrappedParagraphs.length - 1) totalH += paragraphGap;
    });
    const blockTop = TEXT_AREA_TOP + (TEXT_AREA_H - totalH) / 2;
    const textX = BAR_X + BAR_W + 26;
    let cursorY = blockTop + lineHeight * 0.8; // alphabetic baseline offset
    wrappedParagraphs.forEach((lines2, pIdx) => {
      lines2.forEach((ln) => {
        ctx.fillText(ln, textX, cursorY);
        cursorY += lineHeight;
      });
      if (pIdx < wrappedParagraphs.length - 1) cursorY += paragraphGap;
    });
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // --- Footer: IMMERSE wordmark + accent orb ---------------------
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 22px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    // Letter-spaced uppercase wordmark. Canvas 2D has no letter-spacing,
    // so we draw glyph-by-glyph with a manual tracking offset.
    const wordmark = 'IMMERSE';
    const trackPx = 13; // approximates 0.6em letter-spacing at this size
    let wx = TEXT_PADDING_X;
    const wy = SHARE_H - 90;
    for (const ch of wordmark) {
      ctx.fillText(ch, wx, wy);
      wx += ctx.measureText(ch).width + trackPx;
    }
    // Accent orb — three concentric circles, smallest filled, two outer
    // rings stroked at reducing opacities for the radar / sound-wave feel.
    const orbX = SHARE_W - 115;
    const orbY = SHARE_H - 100;
    ctx.beginPath();
    ctx.arc(orbX, orbY, 30, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${accent}, 0.18)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(orbX, orbY, 22, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${accent}, 0.35)`;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(orbX, orbY, 14, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${accent}, 0.85)`;
    ctx.fill();

    // --- Export ----------------------------------------------------
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null (canvas may be tainted)'));
      }, 'image/png', 0.95);
    });
  }, [accent, title, artist, trimmed, loadCoverImage, fitFontSize, wrapTextLine,
      SHARE_W, SHARE_H, TEXT_AREA_TOP, TEXT_AREA_H, TEXT_AREA_W, TEXT_PADDING_X]);

  const handleCopyText = useCallback(async () => {
    const body = trimmed.join('\n');
    const sig = `\n\n— ${title} · ${artist}`;
    try {
      await navigator.clipboard.writeText(body + sig);
      showInner('Lyrics copied');
    } catch (err) {
      console.error('copy text failed:', err);
      showInner('Copy failed');
    }
  }, [trimmed, title, artist, showInner]);

  const handleCopyImage = useCallback(async () => {
    try {
      const blob = await rasterize();
      // ClipboardItem only supports a small set of types; PNG is one.
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('ClipboardItem not supported in this environment');
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showInner('Image copied');
    } catch (err) {
      console.error('copy image failed:', err);
      // Friendlier message — clipboard permission denial is a common cause.
      const msg = /denied|permission|notallowed/i.test(String(err?.message || err))
        ? 'Clipboard blocked — try Save'
        : 'Copy failed';
      showInner(msg);
    }
  }, [rasterize, showInner]);

  const handleSaveImage = useCallback(async () => {
    try {
      const blob = await rasterize();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = title.replace(/[^a-z0-9\-_ ]/gi, '').slice(0, 40).trim() || 'lyric';
      a.href = url;
      a.download = `${safeTitle} — immerse.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showInner('Image saved');
    } catch (err) {
      console.error('save image failed:', err);
      showInner('Save failed');
    }
  }, [rasterize, title, showInner]);

  // --- Render ----------------------------------------------------------
  // The visible preview inside the overlay is a CSS/HTML approximation of
  // the SVG above — close enough that what the user sees is what they get.
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Share lyric"
      tabIndex={-1}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '4vmin',
        background: '#000',
        cursor: 'zoom-out',
        animation: 'immerseFullscreenIn 220ms ease-out',
        outline: 'none',
      }}
    >
      <style>{`
        @keyframes immerseShareCardIn {
          0%   { opacity: 0; transform: scale(0.96) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes immerseShareToastIn {
          0%   { opacity: 0; transform: translate(-50%, 12px); }
          100% { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>

      {/* Blurred cover backdrop — identical technique to CoverFullscreenOverlay. */}
      {coverUrl ? (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: -80,
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'blur(80px) saturate(1.45) brightness(0.5)',
            opacity: 0.85,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%),
                       radial-gradient(ellipse at 50% 90%, rgba(${accent},0.25) 0%, rgba(${accent},0) 60%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Close pill */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose?.(); }}
        title="Close (Esc)"
        aria-label="Close"
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 2,
          width: 36, height: 36, borderRadius: 999,
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,255,255,0.14)',
          color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.8)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.55)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* The share card — visible preview. Pointer events stop here so a
          click inside the card never bubbles to the backdrop's close.
          Aspect is 4:5 portrait (1080×1350) to match the exported PNG and
          to give every wrapped lyric line plenty of horizontal room. */}
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', zIndex: 1,
          // Sized to fit a comfortable viewing rectangle on most screens.
          // The 4/5 aspect drives the actual shape; width is capped so the
          // card never gets so tall that it crashes into the action bar.
          width: 'min(440px, calc((100vh - 220px) * 0.8))',
          aspectRatio: '4 / 5',
          borderRadius: 22, overflow: 'hidden',
          boxShadow: `0 32px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(${accent},0.4), 0 0 60px rgba(${accent},0.12)`,
          background: '#111',
          animation: 'immerseShareCardIn 320ms cubic-bezier(0.2, 0.7, 0.2, 1)',
          cursor: 'default',
          // Container-query root — all `cqi` units in descendants resolve
          // against this card's width. Lets the header/lyric/footer text
          // scale together with the card without separate clamp() math.
          containerType: 'inline-size',
        }}
      >
        {/* Backdrop layer of the card itself — same cover, blurred. */}
        {coverUrl ? (
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: -40,
              backgroundImage: `url(${coverUrl})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              filter: 'blur(60px) saturate(1.4) brightness(0.55)',
            }}
          />
        ) : (
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: '#0a0a0a' }} />
        )}
        {/* Vignette + accent glow */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.78) 100%),
                         radial-gradient(ellipse at 50% 95%, rgba(${accent},0.45) 0%, rgba(${accent},0) 65%)`,
          }}
        />

        {/* Top row — cover thumb + track meta. Proportions mirror the
            SVG export (cover ~12% of width, sits ~10% from the top). */}
        <div style={{
          position: 'absolute',
          top: '9.6%', left: '9.2%', right: '9.2%',
          display: 'flex', alignItems: 'center', gap: '4%',
        }}>
          <div style={{
            width: '26%', aspectRatio: '1',
            borderRadius: 12, overflow: 'hidden',
            background: '#1a1a1a', flexShrink: 0,
            boxShadow: '0 2px 14px rgba(0,0,0,0.55)',
          }}>
            {coverUrl ? (
              <img src={coverUrl} alt="" draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#444',
              }}>
                <Icons.AlbumSidebar />
              </div>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 'clamp(15px, 3.3cqi, 20px)', fontWeight: 700, color: '#fff',
              letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textShadow: '0 1px 8px rgba(0,0,0,0.6)',
            }}>
              {title}
            </div>
            <div style={{
              marginTop: 3,
              fontSize: 'clamp(12px, 2.6cqi, 15px)', color: 'rgba(255,255,255,0.72)', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textShadow: '0 1px 8px rgba(0,0,0,0.6)',
            }}>
              {artist}
            </div>
          </div>
        </div>

        {/* Lyric body — fills the middle band. Accent bar runs the full
            band height. Font auto-scales by line count so 1-2 lines look
            poster-sized and 8+ lines still fit. */}
        <div style={{
          position: 'absolute',
          top: '27%', bottom: '15%',
          left: '9.2%', right: '9.2%',
          display: 'flex',
          gap: '4%',
        }}>
          <div style={{
            width: 5, borderRadius: 999,
            background: `rgb(${accent})`,
            boxShadow: `0 0 16px rgba(${accent},0.7)`,
            flexShrink: 0,
          }} />
          <div style={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            fontSize: (() => {
              // Mirrors the canvas fitFontSize scale, in cqi units (% of
              // card width). The breakpoints are chosen so the preview
              // visually reflects what the exported PNG will look like.
              if (lineCount <= 1) return 'clamp(28px, 8.2cqi, 56px)';
              if (lineCount <= 2) return 'clamp(24px, 7.2cqi, 48px)';
              if (lineCount <= 4) return 'clamp(20px, 6cqi, 40px)';
              if (lineCount <= 6) return 'clamp(17px, 5cqi, 32px)';
              if (lineCount <= 8) return 'clamp(15px, 4.2cqi, 28px)';
              return 'clamp(13px, 3.5cqi, 22px)';
            })(),
            fontWeight: 700, lineHeight: 1.28, color: '#fff',
            letterSpacing: '-0.015em',
            textShadow: '0 2px 18px rgba(0,0,0,0.5)',
            wordBreak: 'normal',
            overflowWrap: 'break-word',
          }}>
            {trimmed.map((line, i) => (
              <div key={i} style={{ marginBottom: i < trimmed.length - 1 ? '0.32em' : 0 }}>
                {line}
              </div>
            ))}
          </div>
        </div>

        {/* Footer — immerse wordmark + accent orb. Echoes the on-card
            export, so the preview faithfully represents the saved image. */}
        <div style={{
          position: 'absolute', left: '9.2%', right: '9.2%',
          bottom: '7%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{
            fontSize: 'clamp(10px, 2.2cqi, 14px)', fontWeight: 600,
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: '0.55em', textTransform: 'uppercase',
          }}>
            IMMERSE
          </div>
          <div style={{ position: 'relative', width: 'clamp(28px, 7cqi, 38px)', aspectRatio: '1', flexShrink: 0 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: `2px solid rgba(${accent},0.18)`,
            }} />
            <div style={{
              position: 'absolute', inset: 4, borderRadius: '50%',
              border: `2px solid rgba(${accent},0.35)`,
            }} />
            <div style={{
              position: 'absolute', inset: 9, borderRadius: '50%',
              background: `rgba(${accent},0.85)`,
              boxShadow: `0 0 12px rgba(${accent},0.6)`,
            }} />
          </div>
        </div>
      </div>

      {/* Action bar — sits below the card. Three actions: copy text,
          copy image, save image. Styled as glass pills matching the dock. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', zIndex: 1,
          marginTop: 'clamp(16px, 3vmin, 24px)',
          display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
          cursor: 'default',
        }}
      >
        <ShareActionButton
          accent={accent}
          onClick={handleCopyText}
          label="Copy text"
          icon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        />
        <ShareActionButton
          accent={accent}
          primary
          onClick={handleCopyImage}
          label="Copy image"
          icon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          )}
        />
        <ShareActionButton
          accent={accent}
          onClick={handleSaveImage}
          label="Save image"
          icon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
        />
      </div>

      {/* Inner toast — confirms a copy/save action. */}
      {innerToast ? (
        <div
          style={{
            position: 'fixed',
            left: '50%', bottom: 'clamp(40px, 8vmin, 80px)',
            transform: 'translateX(-50%)',
            padding: '10px 18px', borderRadius: 999,
            background: 'rgba(20,20,22,0.92)',
            border: `1px solid rgba(${accent},0.4)`,
            backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            color: '#fff', fontSize: 12, fontWeight: 600,
            boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
            zIndex: 3, pointerEvents: 'none',
            animation: 'immerseShareToastIn 220ms ease-out',
          }}
        >
          {innerToast}
        </div>
      ) : null}
    </div>
  );
}

/** ShareActionButton — small glass pill used in the LyricShareOverlay
 *  action bar. Two variants: standard (subtle glass) and primary (accent
 *  fill, used for the headline action). Hovers brighten predictably. */
function ShareActionButton({ icon, label, onClick, accent, primary = false }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderRadius: 999,
        border: primary
          ? `1px solid rgba(${accent},${hover ? 0.7 : 0.55})`
          : `1px solid rgba(255,255,255,${hover ? 0.18 : 0.1})`,
        background: primary
          ? `rgba(${accent},${hover ? 0.42 : 0.32})`
          : `rgba(20,20,22,${hover ? 0.85 : 0.7})`,
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.01em',
        cursor: 'pointer',
        boxShadow: primary
          ? `0 6px 22px rgba(${accent},0.35)`
          : '0 4px 14px rgba(0,0,0,0.35)',
        transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}


/* =========================================================================
 *  EdgeBleedBand — thin gradient strip at the bottom of the immersive
 *  stage, tinted with the playing track's accent colour. Like the cover
 *  is "leaking light" into the bottom of the room.
 *
 *  Fixed-position so it sits above the gradient field but below the dock
 *  pill and side panel. Pointer-events disabled so it never intercepts
 *  clicks meant for things below it (which there aren't any of, but
 *  defensive). Accent updates pick up automatically via the inline style
 *  — no animation hooks needed.
 *
 *  60px tall: enough to read as ambient light, not enough to dominate
 *  the cover composition. Gradient fades from accent at the bottom edge
 *  to transparent at the top via a bottom-aligned ellipse, so the band
 *  feels diffuse rather than a sharp line.
 * ========================================================================= */

/* =========================================================================
 *  BoostButton — sits at the right end of the volume slider in the dock.
 *
 *  The audio element's own .volume property is capped at 1.0 by the HTML
 *  spec, so for tracks mastered too quietly (or just to crank), we route
 *  playback through a Web Audio GainNode that can multiply the signal up
 *  to 4×. This control is the user's handle on that gain.
 *
 *  Behaviour:
 *   - Default state (boost === 1): looks like a regular speaker-with-
 *     waves icon, matching what was there before this feature existed.
 *   - Boosted state (boost > 1): the speaker is replaced with the live
 *     multiplier ("1.5×", "2.4×", "4×") in accent colour with a soft
 *     glow, so the user can see at a glance that boost is active.
 *   - Click opens a popover with a slider (1× to 4×) plus a Reset pill
 *     for jumping straight back to 1×. Closes on outside click / Esc.
 *
 *  The boost feeds into App.jsx's gainNodeRef via the onSetBoost prop;
 *  see App.jsx for the audio graph wiring and the compressor safety net.
 * ========================================================================= */
function BoostButton({ boost = 1, onSetBoost, accent }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  // Close on outside click / Esc. Mirror the pattern used by other
  // popovers in this file (RecentPeekPopover, etc.) for consistency.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = boost > 1.005;
  // Format like "1.5×" or "2×" — drop the decimal if it's a clean integer.
  const label = (() => {
    const r = Math.round(boost * 10) / 10;
    if (Math.abs(r - Math.round(r)) < 0.05) return `${Math.round(r)}×`;
    return `${r.toFixed(1)}×`;
  })();

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={active ? `Volume boost: ${label}` : 'Volume boost'}
        aria-label="Volume boost"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          // Wider than the original 24-square so the multiplier label
          // has breathing room (up to "14.5×" / "16×" at high boost);
          // still compact enough to live in the dock row.
          minWidth: active ? 40 : 24, height: 24,
          padding: active ? '0 6px' : 0,
          border: active ? `1px solid rgba(${accent},0.5)` : 'none',
          background: active ? `rgba(${accent},0.18)` : 'transparent',
          borderRadius: 999,
          color: active ? `rgb(${accent})` : 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, letterSpacing: '-0.01em',
          // The accent glow when active is what makes boost feel "ON" at
          // a glance, like a hardware indicator light.
          boxShadow: active ? `0 0 12px rgba(${accent},0.35)` : 'none',
          transition: 'background 0.15s, color 0.15s, box-shadow 0.15s, border-color 0.15s, min-width 0.15s',
        }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
        }}
      >
        {active ? label : (
          // Reva speaker-with-waves — identical to the icon that lived
          // here before, so users who never touch boost see exactly the
          // same dock.
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 5 L 6 9 L 3 9 C 2.4 9, 2 9.4, 2 10 L 2 14 C 2 14.6, 2.4 15, 3 15 L 6 15 L 10 19 C 10.5 19.4, 11 19.1, 11 18.5 L 11 5.5 C 11 4.9, 10.5 4.6, 10 5 Z" />
            <path d="M14.5 9 C 16 10.3, 16 13.7, 14.5 15" />
            <path d="M17.5 6.5 C 20.5 9, 20.5 15, 17.5 17.5" />
          </svg>
        )}
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Volume boost"
          style={{
            position: 'absolute',
            // Anchor to the right edge of the button, opening upward so
            // the popover doesn't shoot off the bottom of the dock.
            right: 0, bottom: 'calc(100% + 8px)',
            width: 220,
            padding: '14px 14px 12px',
            background: 'rgba(20,20,22,0.94)',
            border: `1px solid rgba(${accent},0.3)`,
            borderRadius: 12,
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            boxShadow: `0 14px 40px rgba(0,0,0,0.6), 0 0 24px rgba(${accent},0.12)`,
            zIndex: 60,
            animation: 'immerseBoostPopIn 160ms ease-out',
          }}
        >
          <style>{`
            @keyframes immerseBoostPopIn {
              0%   { opacity: 0; transform: translateY(4px) scale(0.97); }
              100% { opacity: 1; transform: translateY(0)    scale(1);    }
            }
          `}</style>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.55)',
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>
              Volume boost
            </div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: active ? `rgb(${accent})` : 'rgba(255,255,255,0.7)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {label}
            </div>
          </div>

          {/* The slider. With max bumped to 16×, a linear range would
              cram 1-4× (where users will live 90% of the time) into the
              first quarter of the track. Instead the slider's raw value
              is the LOG of the boost (base 2): 0→4 maps to 1×→16×, with
              each integer step doubling. This gives equal space to each
              "doubling level" — perceptually how loudness actually feels.
              0.05 step = ~3.5% multiplier resolution, fine-grained enough
              for nudges but not so fine that the thumb feels twitchy. */}
          <input
            type="range"
            min="0"
            max="4"
            step="0.05"
            value={Math.log2(boost)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onSetBoost?.(Math.pow(2, v));
            }}
            aria-label="Volume boost multiplier"
            style={{
              width: '100%', height: 4,
              WebkitAppearance: 'none', appearance: 'none',
              background: `linear-gradient(to right,
                rgba(${accent},0.85) 0%,
                rgba(${accent},0.85) ${(Math.log2(boost) / 4) * 100}%,
                rgba(255,255,255,0.1)  ${(Math.log2(boost) / 4) * 100}%,
                rgba(255,255,255,0.1)  100%)`,
              borderRadius: 999,
              outline: 'none',
              cursor: 'pointer',
            }}
          />
          {/* Custom thumb styling — kept inline in <style> so we don't
              need to touch any global CSS. The selectors target only the
              slider inside this popover via the parent attribute. */}
          <style>{`
            [aria-label="Volume boost"] input[type="range"]::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 14px; height: 14px;
              border-radius: 50%;
              background: rgb(${accent});
              border: 2px solid #fff;
              cursor: pointer;
              box-shadow: 0 0 10px rgba(${accent},0.55);
            }
            [aria-label="Volume boost"] input[type="range"]::-moz-range-thumb {
              width: 14px; height: 14px;
              border-radius: 50%;
              background: rgb(${accent});
              border: 2px solid #fff;
              cursor: pointer;
              box-shadow: 0 0 10px rgba(${accent},0.55);
            }
          `}</style>

          {/* Tick row — quick-jump pills at each doubling level. Saves
              the user from carefully aiming the thumb when they just
              want "8×". Position uses log spacing to match the slider's
              own log mapping — visually each pill is roughly under its
              equivalent point on the track. */}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 6, marginBottom: 10,
            fontSize: 9.5, fontWeight: 600, color: 'rgba(255,255,255,0.45)',
          }}>
            {[1, 2, 4, 8, 16].map((tick) => {
              const isActive = Math.abs(boost - tick) < 0.06 * tick; // proportional tolerance
              return (
                <button
                  key={tick}
                  type="button"
                  onClick={() => onSetBoost?.(tick)}
                  style={{
                    border: 'none', background: 'transparent', padding: '2px 4px',
                    color: isActive ? `rgb(${accent})` : 'inherit',
                    fontWeight: isActive ? 700 : 600,
                    fontSize: 'inherit', cursor: 'pointer',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = isActive
                      ? `rgb(${accent})` : 'rgba(255,255,255,0.45)';
                  }}
                >
                  {tick}×
                </button>
              );
            })}
          </div>

          {/* High-boost warning. Past 8× the limiter is doing real work
              and the audio character is genuinely affected — better that
              the user knows than to think "why does this sound crunchy".
              The warning fades in at 8× and saturates at 16×. */}
          {boost > 8 ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', marginBottom: 10,
              borderRadius: 8,
              background: 'rgba(255, 170, 70, 0.1)',
              border: '1px solid rgba(255, 170, 70, 0.3)',
              fontSize: 10.5, color: 'rgba(255, 200, 130, 0.95)',
              lineHeight: 1.35,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Extreme boost — protect your ears and speakers.</span>
            </div>
          ) : null}

          <div style={{
            display: 'flex', gap: 8, alignItems: 'center',
            paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{
              flex: 1, fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.3,
            }}>
              Amplifies past 100%. A soft limiter prevents clipping at high boost.
            </div>
            <button
              type="button"
              onClick={() => onSetBoost?.(1)}
              disabled={!active}
              style={{
                padding: '5px 10px', borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
                fontSize: 10.5, fontWeight: 600,
                cursor: active ? 'pointer' : 'not-allowed',
                transition: 'background 0.12s, color 0.12s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!active) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                if (!active) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
              }}
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EdgeBleedBand({ accent }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        height: 60,
        zIndex: 2,
        pointerEvents: 'none',
        // Tall ellipse anchored to the bottom centre. The radial gradient
        // gives a soft light-leak feel — strongest in the lower middle,
        // fading out at the top edge and to either side.
        background: `radial-gradient(ellipse 80% 100% at 50% 100%, rgba(${accent}, 0.32) 0%, rgba(${accent}, 0.10) 40%, rgba(${accent}, 0) 80%)`,
        // Multiply blend lets the underlying gradient field's colour
        // peek through, so the bleed reads as additive light rather
        // than an opaque overlay.
        mixBlendMode: 'screen',
        transition: 'background 600ms ease',
      }}
    />
  );
}


function AnimatedGradientBg({ accent, mid, wash, coverUrl, analyserRef, beatReactive, isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const imgRef = useRef(null);
  const coverUrlRef = useRef(null);
  // Smoothed beat envelope — climbs fast on hits, decays slowly. Stored in a
  // ref so we don't re-run the effect every frame.
  const beatEnvRef = useRef(0);
  // Frequency-data buffer; sized when the analyser first appears.
  const freqBufRef = useRef(null);
  // Latest props mirrored into refs so the long-lived RAF closure always
  // reads current values without restarting.
  const propsRef = useRef({ analyserRef, beatReactive, isPlaying });
  useEffect(() => {
    propsRef.current = { analyserRef, beatReactive, isPlaying };
  }, [analyserRef, beatReactive, isPlaying]);

  // Load the cover image whenever coverUrl changes
  useEffect(() => {
    if (!coverUrl) {
      imgRef.current = null;
      coverUrlRef.current = null;
      return;
    }
    if (coverUrl === coverUrlRef.current) return;
    coverUrlRef.current = coverUrl;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
    };
    img.onerror = () => {
      imgRef.current = null;
    };
    img.src = coverUrl;
  }, [coverUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Run at extreme low resolution — CSS upscaling to full size creates
    // heavy natural blur. 32px → ~900px display = 28× scale, which completely
    // destroys any recognizable image structure.
    const W = 32;
    const H = 32;
    canvas.width = W;
    canvas.height = H;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 4 layers: [relativeSize, orbitRadius, orbitSpeed, spinSpeed, initialAngle]
    // Orbit radius is in normalized units (0-1 of the canvas size)
    // Two big layers spin in place (orbit=0), two small ones orbit + spin
    const layers = prefersReduced ? [
      [1.2,  0,    0,     0,     0   ],
      [0.8,  0,    0,     0,     0   ],
      [0.6,  0,    0,     0,     0   ],
      [0.4,  0,    0,     0,     0   ],
    ] : [
      [1.25, 0,    0.0,   0.022, 0   ],  // huge, very slow spin in place
      [0.90, 0,    0.0,  -0.031, 1.1 ],  // large, slow opposite spin
      [0.70, 0.18, 0.038, 0.055, 0.5 ],  // medium, gentle orbit + spin
      [0.55, 0.24, -0.051, 0.07, 2.4 ],  // slightly smaller, slow orbit
    ];

    const cx = W / 2;
    const cy = H / 2;
    const startTime = performance.now();

    const frame = () => {
      const t = (performance.now() - startTime) / 1000; // seconds

      /* ---- Beat envelope sampling ----
       * Read the lowest ~10% of the frequency spectrum (roughly the bass
       * range) and mix it into a smoothed envelope. Climb fast on hits
       * (attack), decay slow (release). Reduced motion users opt out of
       * the kinetic boost regardless of preference. */
      let beat = 0;
      const { analyserRef: aRef, beatReactive: br, isPlaying: ip } = propsRef.current;
      const analyser = aRef?.current;
      if (br && ip && analyser && !prefersReduced) {
        if (!freqBufRef.current || freqBufRef.current.length !== analyser.frequencyBinCount) {
          freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqBufRef.current);
        const bins = freqBufRef.current;
        // Average the bottom ~50 bins (roughly 0–1.5 kHz at 44.1 kHz / 1024 fft).
        const N = Math.min(50, bins.length);
        let sum = 0;
        for (let i = 0; i < N; i++) sum += bins[i];
        const avg = (sum / N) / 255; // 0..1
        // Attack/release shaping
        const env = beatEnvRef.current;
        const target = avg;
        const next = target > env
          ? env + (target - env) * 0.45   // fast attack
          : env + (target - env) * 0.06;  // slow release
        beatEnvRef.current = next;
        beat = next;
      } else {
        // Decay to zero when reactivity is off, paused, or no analyser.
        beatEnvRef.current = beatEnvRef.current * 0.92;
        beat = beatEnvRef.current;
      }

      ctx.clearRect(0, 0, W, H);

      // Background fill using the extracted theme colours as a fallback
      // (shows when no image is loaded yet, or when image fails)
      const fallback = ctx.createRadialGradient(cx, cy * 0.6, 0, cx, cy, W * 0.8);
      fallback.addColorStop(0, `rgba(${accent}, 0.9)`);
      fallback.addColorStop(0.5, `rgba(${mid}, 0.7)`);
      fallback.addColorStop(1, `rgba(${wash}, 0.5)`);
      ctx.fillStyle = fallback;
      ctx.fillRect(0, 0, W, H);

      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        for (const [relSize, orbitR, orbitSpeed, spinSpeed, initAngle] of layers) {
          const orbitAngle = initAngle + t * orbitSpeed;
          // Beat-modulated orbit & size — bass hits push layers outward and
          // grow them ~20% momentarily. Subtle for low beat values, alive
          // for big bass kicks. Uses the smoothed envelope so the motion
          // never strobes between frames.
          const beatBoost = 1 + beat * 0.22;
          const orbitBoost = 1 + beat * 0.4;
          const ox = cx + orbitR * orbitBoost * W * Math.cos(orbitAngle);
          const oy = cy + orbitR * orbitBoost * H * Math.sin(orbitAngle);
          const spinAngle = initAngle * 0.5 + t * spinSpeed;
          const size = relSize * beatBoost * W;

          ctx.save();
          ctx.translate(ox, oy);
          ctx.rotate(spinAngle);
          // Beat also pushes alpha up slightly so the colours feel "lit".
          ctx.globalAlpha = Math.min(1, 0.55 + beat * 0.25);
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
          ctx.restore();
        }

        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);  // accent/mid/wash read via fallback gradient which rerenders on prop change

  // When accent/mid/wash change (track change), the next frame automatically
  // picks them up via closure. No restart needed.

  return (
    <>
      {/* The canvas renders at 80×80 and is scaled up to full size.
          The bicubic upscaling + the CSS blur together create a very smooth
          smeared-colours effect identical to a heavy Gaussian blur. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          // imageRendering: pixelated would break the blur — leave as default
          filter: 'blur(40px) saturate(1.8)',
          transition: 'opacity 0.8s ease',
        }}
      />
      {/* Vignette — bottom darkens more so track info stays readable */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.65) 50%, rgba(0,0,0,0.94) 100%)',
        }}
      />
    </>
  );
}


/**
 * WelcomeScreen — animated first-run landing state shown when nothing has
 * played yet in the current session. Displays the app name "Immerse" with a
 * character-by-character reveal, ambient drifting color blobs in the
 * background, a tagline, quick-action pills, and library stats.
 *
 * Replaces the normal immersive player view on cold boot. Dismisses the first
 * time any track is played.
 *
 * Respects prefers-reduced-motion — animations are disabled for users who have
 * that preference set.
 */
function WelcomeScreen({
  library,
  playlists,
  onImportFiles,
  onImportFolder,
  importing,
  onOpenLibrary,
  onOpenFind,
  onNewPlaylist,
  onPlayTrack,
  accent = '48, 48, 48',
  trackOfMomentEnabled = false,
  playEvents = [],
}) {
  const isEmpty = library.length === 0;

  // Derive simple library stats — albums are unique album+primary-artist pairs
  const albumCount = useMemo(() => {
    if (isEmpty) return 0;
    const primaryArtist = (str) => {
      if (!str) return '';
      return str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim();
    };
    const seen = new Set();
    for (const t of library) {
      const k = `${(t.album || '').trim().toLowerCase()}__${primaryArtist(t.artist).toLowerCase()}`;
      seen.add(k);
    }
    return seen.size;
  }, [library, isEmpty]);

  // Recently played — take last N distinct tracks by lastPlayed timestamp.
  // Dedupe by (album + artist) pair so we don't see the same record over and
  // over (5 plays from the same album = 1 tile, not 5).
  const recentTracks = useMemo(() => {
    if (isEmpty) return [];
    const sorted = library
      .filter((t) => t.lastPlayed && t.coverArt)
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    const seen = new Set();
    const result = [];
    for (const t of sorted) {
      const key = `${(t.album || '').toLowerCase()}__${(t.artist || '').toLowerCase().split(/[,&]/)[0].trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(t);
      if (result.length >= 8) break;
    }
    return result;
  }, [library, isEmpty]);

  // Hero pick — "what's worth playing right now"
  // Strategy:
  //   1. If the user has stuff they HAVEN'T played in 3+ weeks, prefer that
  //      (pull from the back of the library, encourages rediscovery)
  //   2. Otherwise, pick from anything they haven't played yet at all
  //   3. Fallback: random library entry
  // We pick a track but treat it as "an album" — clicking the hero plays the
  // whole album sorted by track number.
  const heroPick = useMemo(() => {
    if (isEmpty) return null;
    const now = Date.now();
    const threeWeeks = 1000 * 60 * 60 * 24 * 21;
    const candidates = library.filter((t) => t.coverArt && (t.album || '').trim());
    if (candidates.length === 0) return null;
    // Prefer "haven't played in 3 weeks" first
    const stale = candidates.filter((t) => {
      const last = t.lastPlayed || 0;
      return last === 0 || (now - last) > threeWeeks;
    });
    const pool = stale.length > 0 ? stale : candidates;
    // Stable per-session pick — uses today's date as a seed so the pick
    // doesn't change every render but DOES change day-to-day.
    const dayKey = new Date().toDateString();
    let h = 0;
    for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) | 0;
    const idx = Math.abs(h) % pool.length;
    return pool[idx];
  }, [library, isEmpty]);

  // Album-mate tracks for the hero pick — used so clicking play queues the
  // whole album in track order, not just the single track.
  const heroAlbumTracks = useMemo(() => {
    if (!heroPick) return [];
    const albumKey = (heroPick.album || '').toLowerCase().trim();
    const artistKey = (heroPick.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    const tracks = library.filter((t) => {
      const ta = (t.album || '').toLowerCase().trim();
      const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
      return ta === albumKey && tar === artistKey;
    });
    return tracks.sort((a, b) => {
      const an = a.trackNumber || 0;
      const bn = b.trackNumber || 0;
      if (an !== bn) return an - bn;
      return (a.title || '').localeCompare(b.title || '');
    });
  }, [heroPick, library]);

  /* ---------- Track of the moment ----------
   *
   * Picks one track from the library based on:
   *   - Time-of-day match: tracks whose past plays cluster around the
   *     current hour score higher
   *   - Day-of-week match: same for current weekday
   *   - Recency penalty: tracks played in the last 24h get scored down
   *     so we don't suggest what the user just heard
   *   - Familiarity floor: never-played tracks are excluded (the
   *     first-time-hearing sparkle covers those)
   *
   * The selection is stable inside a 4-hour window and refreshes as that
   * window rolls over. Without a play history we still pick something
   * — falls back to a random familiar track.
   *
   * Returns { track, contextLabel } or null. The context label is a
   * short evocative phrase like "Friday night" or "Thursday morning"
   * derived from the current moment.
   */
  const trackOfMoment = useMemo(() => {
    if (!trackOfMomentEnabled) return null;
    if (!library || library.length === 0) return null;

    const now = new Date();
    const currentHour = now.getHours();
    const currentDow = now.getDay(); // 0..6 (Sun..Sat)

    // Build per-track histograms from the play-event log. Index by id so we
    // can look up scores in O(1) during the main pass.
    const hourHist = new Map();
    const dowHist = new Map();
    if (Array.isArray(playEvents)) {
      for (const ev of playEvents) {
        if (!ev || typeof ev.id !== 'string' || !Number.isFinite(ev.at)) continue;
        const d = new Date(ev.at);
        const h = d.getHours();
        const w = d.getDay();
        const hh = hourHist.get(ev.id) || new Array(24).fill(0);
        hh[h] += 1;
        hourHist.set(ev.id, hh);
        const wh = dowHist.get(ev.id) || new Array(7).fill(0);
        wh[w] += 1;
        dowHist.set(ev.id, wh);
      }
    }

    // Score each candidate track. Only consider tracks with cover art and
    // some play history — skipping never-played ones since the sparkle
    // already surfaces those.
    const recencyCutoff = Date.now() - 1000 * 60 * 60 * 24; // 24h
    const candidates = library.filter((t) => (
      t.coverArt && (Number(t.playCount) || 0) > 0
    ));
    if (candidates.length === 0) return null;

    const scored = candidates.map((t) => {
      let score = 1; // baseline so every candidate is reachable

      // Time-of-day score: count plays in current hour ±1 hour, weighted.
      const hh = hourHist.get(t.id);
      if (hh) {
        const cur = hh[currentHour] || 0;
        const prev = hh[(currentHour + 23) % 24] || 0;
        const next = hh[(currentHour + 1) % 24] || 0;
        score += cur * 3 + (prev + next) * 1.5;
      }
      // Day-of-week score: count plays on same weekday.
      const wh = dowHist.get(t.id);
      if (wh) {
        score += (wh[currentDow] || 0) * 2;
      }
      // Recency penalty: heavy if played in last 24h, so we don't repeat
      // what the user just heard. Multiplicative to avoid swamping it.
      const last = Number(t.lastPlayed) || 0;
      if (last && last > recencyCutoff) {
        score *= 0.25;
      }

      return { track: t, score };
    });

    // Stable per-window pick — hash today's date + 4-hour bucket as seed
    // so the chosen track is consistent through the bucket but rolls over.
    const bucketKey = `${now.toDateString()}-${Math.floor(currentHour / 4)}`;
    let h = 0;
    for (let i = 0; i < bucketKey.length; i++) h = (h * 31 + bucketKey.charCodeAt(i)) | 0;

    // Sort by score desc, take top quartile, then deterministically pick
    // one from that quartile via the seed. Avoids always picking the
    // single highest-scoring track (which would be boring) while still
    // keeping the pick within the "best matches" pool.
    scored.sort((a, b) => b.score - a.score);
    const topN = Math.max(1, Math.min(scored.length, Math.ceil(scored.length / 4)));
    const top = scored.slice(0, topN);
    const idx = Math.abs(h) % top.length;
    const picked = top[idx]?.track;
    if (!picked) return null;

    // Build the context label from current time. Keep it short and
    // evocative; aim for the kind of mood a person might describe with
    // ("Friday night", "Saturday morning"). The day-part bucket follows
    // common conversational divisions rather than strict clock hours.
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDow];
    let part = 'evening';
    if (currentHour < 5) part = 'late night';
    else if (currentHour < 11) part = 'morning';
    else if (currentHour < 14) part = 'midday';
    else if (currentHour < 18) part = 'afternoon';
    else if (currentHour < 22) part = 'evening';
    else part = 'night';
    const contextLabel = `${dayName} ${part}`;

    return { track: picked, contextLabel };
  }, [library, playEvents, trackOfMomentEnabled]);

  const handleMomentPlay = () => {
    if (!trackOfMoment || !onPlayTrack) return;
    onPlayTrack(trackOfMoment.track, [trackOfMoment.track]);
  };

  const handleImport = async () => {
    if (typeof onImportFolder === 'function') {
      await onImportFolder();
    } else if (typeof onImportFiles === 'function') {
      await onImportFiles();
    }
  };

  const handleHeroPlay = () => {
    if (!heroPick || !onPlayTrack) return;
    const list = heroAlbumTracks.length > 0 ? heroAlbumTracks : [heroPick];
    onPlayTrack(list[0], list);
  };

  const handleRecentPlay = (track) => {
    if (!onPlayTrack) return;
    // Build the album for this recent — same logic as hero
    const albumKey = (track.album || '').toLowerCase().trim();
    const artistKey = (track.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    const albumTracks = library
      .filter((t) => {
        const ta = (t.album || '').toLowerCase().trim();
        const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
        return ta === albumKey && tar === artistKey;
      })
      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
    const list = albumTracks.length > 0 ? albumTracks : [track];
    onPlayTrack(list[0], list);
  };

  // Subtle inline-link style for secondary actions
  const inlineLink = {
    background: 'transparent', border: 'none', padding: 0,
    color: 'rgba(255,255,255,0.55)', fontSize: 11.5, fontWeight: 600,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    transition: 'color 0.15s',
  };

  return (
    <div style={{
      position: 'relative', zIndex: 1, flex: 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
      padding: '40px 32px',
    }}>
      <style>{`
        @keyframes imm-welcome-in {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes imm-ambient-drift {
          0%, 100% { transform: translateX(-50%) translate3d(0, 0, 0) scale(1); }
          50%      { transform: translateX(-50%) translate3d(2%, -2%, 0) scale(1.05); }
        }
        @keyframes imm-tile-in {
          0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes imm-hero-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes imm-hero-breathe {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.025); }
        }
        @keyframes imm-play-pulse {
          0%, 100% { box-shadow: 0 4px 14px rgba(0,0,0,0.35); }
          50%      { box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 0 6px rgba(255,255,255,0.06); }
        }
        .imm-welcome-stagger > * {
          opacity: 0;
          animation: imm-welcome-in 520ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .imm-welcome-stagger > *:nth-child(1) { animation-delay: 0ms; }
        .imm-welcome-stagger > *:nth-child(2) { animation-delay: 80ms; }
        .imm-welcome-stagger > *:nth-child(3) { animation-delay: 220ms; }
        .imm-welcome-stagger > *:nth-child(4) { animation-delay: 480ms; }
        .imm-welcome-stagger > *:nth-child(5) { animation-delay: 560ms; }
        /* Hero card: entrance fade-up THEN perpetual float. Both animations
           specified together so the .imm-hero rule doesn't override the
           stagger entrance (CSS animations don't stack — setting animation
           on a more-specific rule replaces it). 'both' fill mode means the
           starting opacity:0 is applied BEFORE the animation starts (during
           the 80ms delay) so there's no flash of visible-then-hidden. */
        .imm-hero {
          animation:
            imm-welcome-in 520ms cubic-bezier(0.16, 1, 0.3, 1) 80ms both,
            imm-hero-float 5.5s ease-in-out infinite 1.4s;
        }
        /* Hero cover breathes like the now-playing canvas */
        .imm-hero-cover-img {
          animation: imm-hero-breathe 7s ease-in-out infinite 1.4s;
          transform-origin: center;
        }
        /* Hero play button has a subtle ring pulse to draw the eye */
        .imm-hero-play {
          animation: imm-play-pulse 3.2s ease-in-out infinite 1.6s;
        }
        /* Tile hover: lift the tile AND scale the inner cover image. */
        .imm-tile:hover .imm-tile-cover {
          transform: translateY(-4px);
          box-shadow: 0 14px 32px rgba(0,0,0,0.55) !important;
        }
        .imm-tile:hover .imm-tile-cover img {
          transform: scale(1.06);
        }
        .imm-tile:hover .imm-tile-overlay {
          opacity: 1;
        }
        /* Custom thin horizontal scrollbar for the recently-played row.
           Visible only when content overflows (browser auto-hides
           horizontal scrollbars when content fits). 5px tall — present
           enough to grab and to signal "more this way," but unobtrusive. */
        .imm-recent-row::-webkit-scrollbar {
          height: 5px;
          background: transparent;
        }
        .imm-recent-row::-webkit-scrollbar-track {
          background: transparent;
          margin: 0 4px;
        }
        .imm-recent-row::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.14);
          border-radius: 3px;
          transition: background 0.15s;
        }
        .imm-recent-row::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.28);
        }
        .imm-link:hover { color: rgba(255,255,255,0.92) !important; }

        /* Action cards — same hover language as cover tiles. Lift, brighten
           the ring shadow, slightly intensify the icon. The press-bounce
           is handled in JSX via mouseDown/Up + transition. */
        .imm-action-card:not(:disabled):hover {
          background: rgba(28, 28, 32, 0.85) !important;
          border-color: rgba(255,255,255,0.14) !important;
          transform: translateY(-3px) !important;
          box-shadow:
            0 16px 36px rgba(0,0,0,0.55),
            0 0 0 1px rgba(255,255,255,0.06),
            inset 0 1px 0 rgba(255,255,255,0.06) !important;
        }

        /* Hero cover shimmer — a soft white diagonal gradient sweeps across
           the cover every ~9 seconds. Uses a pseudo-element so it sits over
           the image without affecting the image transform. */
        .imm-hero-cover-frame {
          position: relative;
          overflow: hidden;
        }
        .imm-hero-cover-frame::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(115deg,
            transparent 0%,
            transparent 35%,
            rgba(255,255,255,0.12) 50%,
            transparent 65%,
            transparent 100%
          );
          transform: translateX(-100%);
          pointer-events: none;
          animation: imm-shimmer-sweep 9s ease-in-out infinite 2.4s;
        }
        @keyframes imm-shimmer-sweep {
          0%   { transform: translateX(-100%); }
          16%  { transform: translateX(100%); }
          100% { transform: translateX(100%); }
        }

        /* Hero play button — icon rotates slightly on hover for a small
           "ready to launch" feel. */
        .imm-hero-play:hover svg { transform: scale(1.12); }
        .imm-hero-play svg { transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .imm-hero-play:hover { transform: scale(1.08); }
        .imm-hero-play { transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); }

        /* Floating ambient particles — three tiny dots drift up slowly across
           the background. Subtle, easy to miss but adds aliveness. */
        @keyframes imm-particle-up {
          0%   { transform: translateY(120vh) translateX(0); opacity: 0; }
          10%  { opacity: 0.55; }
          50%  { transform: translateY(50vh) translateX(20px); opacity: 0.4; }
          90%  { opacity: 0.25; }
          100% { transform: translateY(-20vh) translateX(-10px); opacity: 0; }
        }
        .imm-particle {
          position: absolute;
          width: 4px; height: 4px;
          border-radius: 50%;
          pointer-events: none;
          will-change: transform, opacity;
          background: rgba(255,255,255,0.6);
          box-shadow: 0 0 8px rgba(255,255,255,0.4);
        }
        .imm-particle-1 { left: 15%; animation: imm-particle-up 18s linear infinite; }
        .imm-particle-2 { left: 38%; animation: imm-particle-up 22s linear infinite 4s; }
        .imm-particle-3 { left: 62%; animation: imm-particle-up 20s linear infinite 9s; }
        .imm-particle-4 { left: 85%; animation: imm-particle-up 24s linear infinite 13s; }

        /* Wordmark gentle sheen — a single horizontal pass of brightness
           every 7s. Subtle enough that you almost don't see it, but it makes
           the title feel less static. */
        .imm-wordmark {
          background: linear-gradient(
            90deg,
            rgba(255,255,255,0.95) 0%,
            rgba(255,255,255,0.95) 40%,
            rgba(255,255,255,1) 50%,
            rgba(255,255,255,0.95) 60%,
            rgba(255,255,255,0.95) 100%
          );
          background-size: 200% 100%;
          background-position: 100% 0;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: imm-wordmark-sheen 7s ease-in-out infinite 2s;
        }
        @keyframes imm-wordmark-sheen {
          0%, 70%, 100% { background-position: 100% 0; }
          85%           { background-position: -100% 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .imm-welcome-stagger > * { animation: none; opacity: 1; }
          .imm-ambient, .imm-hero, .imm-hero-cover-img, .imm-hero-play,
          .imm-particle, .imm-wordmark { animation: none; }
          .imm-hero-cover-frame::after { animation: none; }
          .imm-tile { transition: none; }
        }
      `}</style>

      {/* Single ambient backdrop using the user's accent color — matches the
          dynamic gradient vocabulary used elsewhere in the app instead of
          the previous three competing blobs. */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div className="imm-ambient" style={{
          position: 'absolute', top: '10%', left: '50%',
          width: '70%', height: '70%', borderRadius: '50%',
          transform: 'translateX(-50%)',
          background: `radial-gradient(circle, rgba(${accent}, 0.28) 0%, rgba(${accent}, 0) 60%)`,
          filter: 'blur(60px)',
          animation: 'imm-ambient-drift 18s ease-in-out infinite',
        }} />
        {/* Slow-rising ambient particles. Four dots at staggered horizontal
            positions and start times so the field feels populated without
            looking choreographed. Long durations (18-24s) keep the motion
            calm, never demanding attention. */}
        <div className="imm-particle imm-particle-1" />
        <div className="imm-particle imm-particle-2" />
        <div className="imm-particle imm-particle-3" />
        <div className="imm-particle imm-particle-4" />
      </div>

      <div className="imm-welcome-stagger" style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        width: '100%', maxWidth: 640,
      }}>
        {/* 1. Wordmark + tagline — quiet, no chaos */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          marginBottom: 28,
        }}>
          <h1
            className="imm-wordmark"
            style={{
              margin: 0,
              fontSize: 28, fontWeight: 300,
              letterSpacing: '-0.02em',
              color: 'rgba(255,255,255,0.95)',
              lineHeight: 1,
            }}>
            Immerse
          </h1>
          <div style={{
            marginTop: 8,
            fontSize: 11.5, color: 'rgba(255,255,255,0.5)',
            letterSpacing: '0.02em',
          }}>
            {isEmpty
              ? 'Add some music to get started.'
              : (heroPick ? 'Worth a listen today.' : 'Pick something to play.')}
          </div>
        </div>

        {/* 2. Hero — either album-of-the-day or import CTA */}
        {isEmpty ? (
          <div style={{
            width: '100%', maxWidth: 380,
            padding: '24px 28px',
            borderRadius: 14,
            background: 'rgba(18, 18, 20, 0.7)',
            backdropFilter: 'blur(28px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: `
              0 16px 40px rgba(0,0,0,0.5),
              0 0 0 1px rgba(${accent}, 0.1),
              inset 0 1px 0 rgba(255,255,255,0.05)
            `,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 12,
              background: `rgba(${accent}, 0.2)`,
              border: `1px solid rgba(${accent}, 0.4)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>
              Your library is empty
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 18, lineHeight: 1.5 }}>
              Import a folder of music files,<br />or use Find to pull tracks from Spotify.
            </div>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              style={{
                padding: '9px 18px', borderRadius: 9,
                background: `rgba(${accent}, 0.55)`,
                border: `1px solid rgba(${accent}, 0.7)`,
                color: '#fff', fontSize: 11.5, fontWeight: 700,
                cursor: importing ? 'default' : 'pointer',
                opacity: importing ? 0.6 : 1,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (!importing) e.currentTarget.style.background = `rgba(${accent}, 0.7)`; }}
              onMouseLeave={(e) => { if (!importing) e.currentTarget.style.background = `rgba(${accent}, 0.55)`; }}
            >
              {importing ? 'Importing…' : 'Import music'}
            </button>
          </div>
        ) : heroPick ? (
          <div
            className="imm-hero"
            onClick={handleHeroPlay}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHeroPlay(); } }}
            style={{
              width: '100%', maxWidth: 460,
              padding: 14,
              borderRadius: 14,
              background: 'rgba(18, 18, 20, 0.7)',
              backdropFilter: 'blur(28px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: `
                0 16px 40px rgba(0,0,0,0.5),
                0 0 0 1px rgba(${accent}, 0.1),
                inset 0 1px 0 rgba(255,255,255,0.05)
              `,
              display: 'flex', alignItems: 'center', gap: 14,
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
            <div className="imm-hero-cover-frame" style={{
              width: 84, height: 84, borderRadius: 8,
              flexShrink: 0,
              background: 'rgba(0,0,0,0.4)',
            }}>
              {heroPick.coverArt ? (
                <img
                  className="imm-hero-cover-img"
                  src={heroPick.coverArt}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : null}
            </div>
            {/* Text column: explicit min-width:0 + overflow:hidden so the
                inner ellipsis works against the available flex space.
                Without these, long album names push the play button off
                the right edge instead of truncating. */}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em',
                color: `rgba(${accent}, 1)`, textTransform: 'uppercase', marginBottom: 4,
                opacity: 0.95,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {heroAlbumTracks.length > 1 ? `Album · ${heroAlbumTracks.length} tracks` : 'Track'}
              </div>
              <div style={{
                fontSize: 14, fontWeight: 700, color: '#fff',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginBottom: 2,
              }}>
                {heroPick.album || heroPick.title}
              </div>
              <div style={{
                fontSize: 11.5, color: 'rgba(255,255,255,0.6)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {heroPick.artist || 'Unknown Artist'}
              </div>
            </div>
            <button
              type="button"
              className="imm-hero-play"
              onClick={(e) => { e.stopPropagation(); handleHeroPlay(); }}
              aria-label="Play"
              style={{
                flexShrink: 0,
                width: 44, height: 44, borderRadius: '50%',
                background: '#fff', border: 'none',
                color: '#000', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
        ) : null}

        {/* Track of the moment — a small horizontal card with a track chosen
            by time-of-day + day-of-week + recent listening. Only renders
            when the DEV toggle is on AND the selection logic returned a
            candidate (which requires play history). Sits between the hero
            and Recently played as a "what would fit right now?" cue. */}
        {trackOfMomentEnabled && trackOfMoment ? (
          <div
            onClick={handleMomentPlay}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleMomentPlay();
              }
            }}
            style={{
              width: '100%', maxWidth: 640, marginTop: 24,
              display: 'flex', alignItems: 'center', gap: 14,
              padding: 12, borderRadius: 12,
              background: `linear-gradient(135deg, rgba(${accent}, 0.12) 0%, rgba(255,255,255,0.03) 100%)`,
              border: `1px solid rgba(${accent}, 0.18)`,
              cursor: 'pointer',
              // No entrance animation here. Earlier versions used `imm-tile-in`
              // with `animation-fill-mode: backwards` and a 200ms delay, but
              // when the parent re-rendered (which happens at audio-tick
              // cadence on the welcome screen too because accent/state can
              // shift), the animation property on a new style object made the
              // browser re-run the keyframe — yielding a visible
              // appear / fade-out / re-appear flicker. Hover transitions
              // remain since they're triggered by user input, not render
              // churn.
              transition: 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s, border-color 0.18s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = `0 8px 24px rgba(${accent}, 0.18)`;
              e.currentTarget.style.borderColor = `rgba(${accent}, 0.35)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = `rgba(${accent}, 0.18)`;
            }}
          >
            {/* Cover thumbnail. Smaller than the hero so the hero stays the
                visual centerpiece. */}
            <div style={{
              width: 56, height: 56, borderRadius: 8, overflow: 'hidden',
              background: 'rgba(0,0,0,0.4)', flexShrink: 0,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {trackOfMoment.track.coverArt ? (
                <img src={trackOfMoment.track.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : null}
            </div>

            {/* Title block — context label up top in accent, then title /
                artist. Mirrors the hero's information hierarchy at a
                smaller scale. */}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em',
                color: `rgba(${accent}, 1)`, textTransform: 'uppercase',
                marginBottom: 4, opacity: 0.92,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {trackOfMoment.contextLabel} · For this moment
              </div>
              <div style={{
                fontSize: 13, fontWeight: 700, color: '#fff',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginBottom: 1,
              }}>
                {trackOfMoment.track.title || 'Untitled'}
              </div>
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.6)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {trackOfMoment.track.artist || 'Unknown Artist'}
              </div>
            </div>

            {/* Inline play button. stopPropagation so clicking it doesn't
                also trigger the parent card's onClick (would still work,
                but feels weird to have two click paths fight each other). */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleMomentPlay(); }}
              aria-label="Play"
              style={{
                flexShrink: 0,
                width: 36, height: 36, borderRadius: '50%',
                background: '#fff', border: 'none',
                color: '#000', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
        ) : null}

        {/* 3. Recently played — only render if there's stuff to show */}
        {!isEmpty && recentTracks.length > 0 ? (
          <div style={{ width: '100%', maxWidth: 640, marginTop: 28, minWidth: 0 }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
              color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
              marginBottom: 12, paddingLeft: 4,
            }}>
              Recently played
            </div>
            {/* Single flex row that scrolls horizontally. Removed the
                redundant wrapper div that was causing the inner row to
                ignore parent width and overflow into adjacent tiles. */}
            <div
              className="imm-recent-row"
              style={{
                display: 'flex', gap: 10,
                overflowX: 'auto', overflowY: 'hidden',
                paddingBottom: 10, paddingTop: 4,
                // Firefox: thin scrollbar with custom colors. WebKit
                // styling lives in the .imm-recent-row::-webkit-scrollbar
                // rule in the welcome-screen <style> block.
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.18) transparent',
                // Prevent the row itself from forcing parent expansion
                width: '100%',
              }}>
              {recentTracks.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleRecentPlay(t)}
                  title={`${t.album || t.title} · ${t.artist}`}
                  className="imm-tile"
                  style={{
                    flexShrink: 0,
                    // Fixed-width tile. Width and inner text containers
                    // both set explicitly so text-overflow ellipsis works
                    // (it requires a known parent width to truncate at).
                    width: 104,
                    padding: 0, background: 'transparent', border: 'none',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 6,
                    textAlign: 'left',
                    // Cascade-in animation — each tile fades up after a
                    // small stagger so the row reveals left-to-right.
                    opacity: 0,
                    animation: `imm-tile-in 460ms cubic-bezier(0.16, 1, 0.3, 1) ${500 + i * 70}ms forwards`,
                  }}
                >
                  <div className="imm-tile-cover" style={{
                    width: 104, height: 104, borderRadius: 8, overflow: 'hidden',
                    background: 'rgba(0,0,0,0.4)',
                    position: 'relative',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s',
                  }}>
                    <img src={t.coverArt} alt="" style={{
                      width: '100%', height: '100%', objectFit: 'cover',
                      // Cover ALSO scales slightly inside the frame on hover
                      // for a subtle "alive" feel.
                      transition: 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
                    }} />
                    {/* Play-on-hover overlay */}
                    <div className="imm-tile-overlay" style={{
                      position: 'absolute', inset: 0,
                      background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
                      padding: 8,
                      opacity: 0, transition: 'opacity 0.18s',
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
                      }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#000">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  {/* Text wrapper — explicit width:100% so the parent button's
                      width (104px) becomes the constraint for ellipsis on the
                      inner divs. Without this, ellipsis fails because the
                      inner divs have no explicit width to truncate against. */}
                  <div style={{ width: '100%', minWidth: 0, padding: '0 2px' }}>
                    <div style={{
                      width: '100%',
                      fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.92)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      lineHeight: 1.3,
                    }}>
                      {t.album || t.title}
                    </div>
                    <div style={{
                      width: '100%',
                      fontSize: 9.5, color: 'rgba(255,255,255,0.5)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      lineHeight: 1.3, marginTop: 1,
                    }}>
                      {t.artist}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 4. Action cards — small glass tiles for navigation/quick actions.
            Sized similar to recently-played tiles (a touch smaller) so they
            visually rhyme without competing. Each one has a label, an icon,
            hover lift, and press-bounce. */}
        {!isEmpty ? (
          <div style={{
            display: 'flex', gap: 10, marginTop: 28,
            justifyContent: 'center', flexWrap: 'wrap',
          }}>
            <ActionCard
              onClick={onOpenLibrary}
              label="Library"
              accent={accent}
              icon={(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              )}
            />
            <ActionCard
              onClick={onOpenFind}
              label="Find"
              accent={accent}
              icon={(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.5" y2="16.5" />
                </svg>
              )}
            />
            {typeof onNewPlaylist === 'function' ? (
              <ActionCard
                onClick={onNewPlaylist}
                label="New playlist"
                accent={accent}
                icon={(
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                )}
              />
            ) : null}
            <ActionCard
              onClick={handleImport}
              label={importing ? 'Importing…' : 'Import'}
              disabled={importing}
              accent={accent}
              icon={(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
            />
          </div>
        ) : (
          <div style={{
            display: 'flex', gap: 10, marginTop: 24,
            justifyContent: 'center',
          }}>
            <ActionCard
              onClick={onOpenFind}
              label="Open Find"
              accent={accent}
              icon={(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.5" y2="16.5" />
                </svg>
              )}
            />
            <ActionCard
              onClick={onOpenLibrary}
              label="Browse library"
              accent={accent}
              icon={(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              )}
            />
          </div>
        )}

        {/* 5. Stats footer — barely visible */}
        {!isEmpty ? (
          <div style={{
            display: 'flex', gap: 14, justifyContent: 'center',
            fontSize: 10, color: 'rgba(255,255,255,0.3)',
            fontVariantNumeric: 'tabular-nums',
            marginTop: 22,
          }}>
            <span><strong style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>{library.length}</strong>&nbsp;{library.length === 1 ? 'track' : 'tracks'}</span>
            {albumCount > 0 ? (
              <>
                <span style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
                <span><strong style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>{albumCount}</strong>&nbsp;{albumCount === 1 ? 'album' : 'albums'}</span>
              </>
            ) : null}
            {playlists.length > 0 ? (
              <>
                <span style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
                <span><strong style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>{playlists.length}</strong>&nbsp;{playlists.length === 1 ? 'playlist' : 'playlists'}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ActionCard — small glass tile used in the welcome screen action row.
 * Icon-on-top, label-below layout. Slightly smaller than the recently-played
 * cover tiles so they read as "secondary" but visually match the same
 * design language (same glass, same accent ring shadow, same hover lift).
 */
function ActionCard({ onClick, label, icon, accent = '48, 48, 48', disabled = false }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      className="imm-action-card"
      style={{
        width: 92, padding: '14px 8px 12px',
        borderRadius: 12,
        background: 'rgba(18, 18, 20, 0.7)',
        backdropFilter: 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: `
          0 8px 24px rgba(0,0,0,0.4),
          0 0 0 1px rgba(${accent}, 0.08),
          inset 0 1px 0 rgba(255,255,255,0.04)
        `,
        color: 'rgba(255,255,255,0.85)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
        // press-bounce — scale down on mouse-down then bounce back via the
        // CSS transition release. Disabled state skips the transform.
        transform: pressed && !disabled ? 'scale(0.94)' : 'scale(1)',
        transition: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s, border-color 0.2s, box-shadow 0.25s',
      }}
    >
      <div style={{
        color: `rgba(${accent}, 1)`, opacity: 0.95,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        width: '100%', textAlign: 'center',
      }}>
        {label}
      </div>
    </button>
  );
}


/**
 * NavRail — thin always-visible navigation strip.
 *
 * Lives flush against the user's chosen edge (left or right) of the window.
 * Holds the four primary tab icons (Find / Library / New / Settings) plus
 * a panel-toggle button at the top. Tapping a tab icon both selects that
 * tab AND opens the panel — so the rail is the single entry point for
 * navigation regardless of panel state.
 *
 * The rail is intentionally narrow (40px) and dense — the panel does the
 * heavy lifting. This split lets the immersive now-playing canvas reclaim
 * most of the screen when the panel is closed.
 */
function NavRail({
  side = 'right',
  tab,
  onTabChange,
  panelOpen,
  onTogglePanel,
  libraryCount,
  accent = '48, 48, 48',
  // Pinnable-tabs props — if undefined, the feature is treated as off.
  pinnableTabsEnabled = false,
  hiddenTabIds = [],
  tabContextHandler = () => undefined,
}) {
  const handleTabClick = (id) => {
    if (tab === id && panelOpen) {
      // Click the active tab while panel is open → close panel.
      onTogglePanel();
      return;
    }
    onTabChange(id);
    if (!panelOpen) onTogglePanel();
  };

  return (
    <aside
      style={{
        position: 'absolute',
        top: 44, bottom: 12,
        ...(side === 'right' ? { right: 12 } : { left: 12 }),
        width: 40,
        zIndex: 6, // above the panel so it always catches clicks
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        borderRadius: 14,
        background: 'rgba(18, 18, 20, 0.55)',
        backdropFilter: 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: `
          0 16px 40px rgba(0,0,0,0.45),
          0 0 0 1px rgba(${accent}, 0.08),
          inset 0 1px 0 rgba(255,255,255,0.04)
        `,
        WebkitAppRegion: 'no-drag',
      }}
    >
      {/* Panel toggle — chevron pointing inward when closed, outward when open */}
      <button
        type="button"
        onClick={onTogglePanel}
        title={panelOpen ? 'Hide panel' : 'Show panel'}
        aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
        style={{
          width: 28, height: 24, borderRadius: 6, marginBottom: 8,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24"
          // Chevron points toward the screen interior when closed (so user
          // sees "open this way") and toward the rail when open ("close").
          style={{
            transform: side === 'right'
              ? `rotate(${panelOpen ? 0 : 180}deg)`
              : `rotate(${panelOpen ? 180 : 0}deg)`,
            transition: 'transform 0.2s',
          }}
          fill="currentColor" aria-hidden
        >
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
        </svg>
      </button>

      <div style={{ height: 1, width: 22, background: 'rgba(255,255,255,0.06)', marginBottom: 8 }} />

      {/* Tab icons — order matches the dock: Find, Library, New, Settings.
          When pinnable-tabs is enabled, hidden tabs render nothing and the
          remaining tabs accept right-click for a hide action. Library and
          Settings are protected (always visible). */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('find')) ? (
        <NavRailIcon active={tab === 'find' && panelOpen} onClick={() => handleTabClick('find')} title="Find" onContextMenu={tabContextHandler('find')}>
          <Icons.Search />
        </NavRailIcon>
      ) : null}
      <NavRailIcon active={tab === 'library' && panelOpen} onClick={() => handleTabClick('library')} title={`Library · ${libraryCount}`}>
        <Icons.LibrarySidebar />
      </NavRailIcon>
      {!(pinnableTabsEnabled && hiddenTabIds.includes('new')) ? (
        <NavRailIcon active={tab === 'new' && panelOpen} onClick={() => handleTabClick('new')} title="New releases" onContextMenu={tabContextHandler('new')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M10 2 L11.3 8 L17 9.3 L11.3 10.6 L10 16.6 L8.7 10.6 L3 9.3 L8.7 8 Z" />
            <path d="M17.5 14 L18.2 17 L21 17.6 L18.2 18.2 L17.5 21.2 L16.8 18.2 L14 17.6 L16.8 17 Z" />
          </svg>
        </NavRailIcon>
      ) : null}
      <NavRailIcon active={tab === 'settings' && panelOpen} onClick={() => handleTabClick('settings')} title="Settings">
        <Icons.Settings />
      </NavRailIcon>
    </aside>
  );
}

/**
 * NavRailIcon — a single button in the rail. Slightly larger than the old
 * RailIcon, with a clearer active state (accent-tinted background + left
 * inset bar to emphasize "active tab").
 */
function NavRailIcon({ active, onClick, title, children, onContextMenu }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      aria-label={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28, height: 28, borderRadius: 8, marginBottom: 4,
        background: active
          ? 'rgba(255,255,255,0.14)'
          : (hovered ? 'rgba(255,255,255,0.06)' : 'transparent'),
        border: 'none',
        color: active ? '#fff' : (hovered ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)'),
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        flexShrink: 0,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  );
}


/**
 * BottomDockBar — centered floating pill at the bottom of the window.
 *
 * Holds the four primary tab icons (Find / Library / New / Settings) plus
 * a queue button on the far right. Replaces the side NavRail (which
 * permanently occupied a screen edge) and the QueueHandle (a separate
 * pull-tab that lived in the same bottom-center region anyway). One
 * unified piece of UI instead of two.
 *
 * Behavior:
 *   - Tap a tab icon while panel is closed → opens panel on that tab
 *   - Tap a different tab icon while panel is open → switches tab
 *   - Tap the active tab while panel is open → closes the panel
 *   - Tap queue icon → opens the queue drawer (independent of panel state)
 *
 * Positioning: bottom-center, sits 16px above the window edge. The bar
 * itself doesn't take side margin so it can be quite wide if needed.
 */
function BottomDockBar({
  tab,
  onTabChange,
  panelOpen,
  onTogglePanel,
  libraryCount,
  queueCount = 0,
  // Lyrics toggle — replaces the previous queue button. The queue is now
  // a tab inside the side dock panel, accessed via a tab button alongside
  // the other navigation tabs.
  lyricsVisible = false,
  onToggleLyrics,
  lyricsAvailable = false,
  accent = '48, 48, 48',
  // Pinnable-tabs feature — when enabled, hidden tabs disappear from the
  // bar entirely. Right-click on a hideable tab fires the supplied
  // `tabContextHandler`, which opens the local hide-popover in SideDock.
  pinnableTabsEnabled = false,
  hiddenTabIds = [],
  tabContextHandler = () => undefined,
  // Random play — when enabled, a dice icon appears in the bar that plays
  // a uniformly-random track from the library. Sits at the right end of
  // the dock, just before the lyrics button.
  randomButtonEnabled = false,
  onPlayRandom,
  // Breathing dock pill — when enabled and music is playing, the dock's
  // accent ring + outer glow pulse subtly on an 8s loop, matching the
  // cover's breathing rhythm. Pure visual ambience.
  breathingDockPillEnabled = false,
  // Transparent dock — when enabled, the pill's solid dark backdrop drops
  // away so the cover-art-derived background bleeds through. Falls back
  // to the standard semi-opaque fill when off.
  dockTransparentEnabled = false,
  // Liquid glass dock — opt-in beyond plain transparency. Layers a
  // multi-step frosted-glass effect (heavy blur, top-edge highlight,
  // specular sheen, accent inner glow) so the dock reads as a slab
  // of real glass laid over the cover art rather than just a faded fill.
  liquidGlassDockEnabled = false,
  // Listening Journal — when enabled, a Journal button appears in the
  // tab row between Stats and the divider. The actual tab content is
  // rendered by SideDock; this just controls whether the icon shows.
  journalTabEnabled = false,
  // Recently-played peek — when enabled, a clock icon appears in the
  // dock; clicking pops a small panel listing recently-played tracks.
  // The popover is owned here (not in SideDock) because it should
  // anchor to the button and appear without opening the side panel.
  recentPeekEnabled = false,
  recentPeekRange = '5',
  recentPeekCustomCount = 15,
  // Library + play events feed the peek's "recently played" list. We
  // pass them through directly so the peek doesn't need a separate IPC.
  library = [],
  playEvents = [],
  onPlayTrack,
  isPlaying = false,
  // Dock drag — when enabled, the user can pick up the dock and move it
  // anywhere on screen. Position persists until the feature is disabled.
  dockDraggableEnabled = false,
  dockPosition = null,
  onSetDockPosition,
}) {
  const handleTabClick = (id) => {
    if (tab === id && panelOpen) {
      onTogglePanel();
      return;
    }
    onTabChange(id);
    if (!panelOpen) onTogglePanel();
  };

  // Whether the breathing animation should be running right now.
  const breathing = breathingDockPillEnabled && isPlaying;

  // Stable random phase for the liquid-glass specular sheen. We pick
  // once via useRef so parent re-renders don't reset the animation —
  // otherwise the sheen would jump every time a sibling state changes.
  const sheenPhaseRef = useRef(`-${Math.floor(Math.random() * 3)}s`);

  // Recently-played peek state. The button sits in the dock; clicking
  // toggles the popover. The button ref lets the popover anchor itself
  // to the button's screen position so it sits just above the dock.
  const [peekOpen, setPeekOpen] = useState(false);
  const peekBtnRef = useRef(null);
  // Close when clicking anywhere outside the peek button or popover.
  // We can't use a simple onClick on a backdrop because the popover
  // floats above the dock without one — instead we attach a document
  // listener while open. Ignores clicks that originated inside the
  // peek itself (the popover has its own data attribute marker).
  useEffect(() => {
    if (!peekOpen) return undefined;
    const onDocClick = (e) => {
      // Inside the button? Toggling will be handled by its own click.
      if (peekBtnRef.current && peekBtnRef.current.contains(e.target)) return;
      // Inside the popover?
      let el = e.target;
      while (el) {
        if (el.dataset?.recentPeek === '1') return;
        el = el.parentElement;
      }
      setPeekOpen(false);
    };
    // Use mousedown — closing on click feels laggier than closing on press.
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [peekOpen]);

  // --- Dock drag handling ------------------------------------------------
  // When `dockDraggableEnabled` is true, mousedown on the dock body (NOT on
  // a button or interactive child) starts a drag. Drag updates the
  // `dockPosition` so the dock follows the cursor; release commits.
  // The mouse offset within the dock at drag-start is captured so the
  // drop point lines up with the click point (otherwise the dock would
  // jump to top-left of the cursor).
  const dragStateRef = useRef(null);
  const onDockMouseDown = (e) => {
    if (!dockDraggableEnabled) return;
    if (e.button !== 0) return;
    // Only initiate drag when the user grabs the dock body itself, not a
    // button or icon inside. Walk up from the target; if we hit a button
    // before hitting the container we registered on, abort.
    let el = e.target;
    while (el && el !== e.currentTarget) {
      if (el.tagName === 'BUTTON' || el.getAttribute?.('role') === 'button') return;
      el = el.parentElement;
    }
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      if (!dragStateRef.current) return;
      const { offsetX, offsetY, width, height } = dragStateRef.current;
      // Keep the dock fully on-screen — cap at 0..(viewport - size).
      const maxX = window.innerWidth - width;
      const maxY = window.innerHeight - height;
      const x = Math.max(0, Math.min(maxX, ev.clientX - offsetX));
      const y = Math.max(0, Math.min(maxY, ev.clientY - offsetY));
      onSetDockPosition?.({ xFromLeft: x, yFromTop: y });
    };
    const onUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Compute positioning. Default: bottom-center via translateX. Custom:
  // absolute left/top from dockPosition; no transform.
  const usingCustomPosition = dockDraggableEnabled && dockPosition !== null;
  const positionStyle = usingCustomPosition
    ? {
        left: dockPosition.xFromLeft,
        top: dockPosition.yFromTop,
        transform: 'none',
      }
    : {
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
      };

  // Resolve the three possible dock surface modes into a single style
  // object. The modes are mutually-composable in principle (liquid glass
  // can layer over transparent), but in practice liquid glass supplies
  // its own base fill since the whole point is the multi-layer optical
  // illusion. Branch order: liquid > transparent > solid.
  let surfaceStyle;
  if (liquidGlassDockEnabled) {
    // Liquid glass — three stacked layers in a single background, plus
    // a richer backdrop-filter stack and a deeper box-shadow stack.
    // Layer 1 (top): faint top-edge light catch — the "highlight" you
    //   see on the top edge of real polished glass.
    // Layer 2 (middle): soft accent-tinted radial glow from below
    //   center, so the dock picks up some of the track's color cast.
    // Layer 3 (bottom): the dark base fill, kept lower-opacity so the
    //   cover wash still bleeds through but the icons stay legible.
    // The brightness(1.05) inside backdrop-filter is what separates
    // "glass" from "frosted plastic" — it brightens the bled-through
    // colors a hair so the surface reads as light-transmitting.
    surfaceStyle = {
      background: `
        linear-gradient(180deg,
          rgba(255,255,255,0.16) 0%,
          rgba(255,255,255,0.04) 18%,
          rgba(255,255,255,0)    35%,
          rgba(0,0,0,0.05)       100%),
        radial-gradient(ellipse 80% 60% at 50% 110%,
          rgba(${accent}, 0.22) 0%,
          rgba(${accent}, 0)    70%),
        rgba(18, 18, 20, 0.32)
      `,
      backdropFilter: 'blur(50px) saturate(2) brightness(1.05)',
      WebkitBackdropFilter: 'blur(50px) saturate(2) brightness(1.05)',
      // Glass-style border: subtle on most edges, brighter on top to
      // catch the implied light source. The four-layer box-shadow is
      // doing the heavy optical lifting: outer drop, accent rim glow,
      // top-edge inner highlight, bottom-edge inner shadow line.
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: breathing ? undefined : `
        0 20px 50px rgba(0,0,0,0.55),
        0 0 0 1px rgba(${accent}, 0.18),
        0 0 24px rgba(${accent}, 0.1),
        inset 0 1px 0 rgba(255,255,255,0.22),
        inset 0 -1px 0 rgba(0,0,0,0.25)
      `,
    };
  } else if (dockTransparentEnabled) {
    // Transparent — the original "let the wash through" mode. Thin
    // fill, stronger blur to soften any cover detail into a wash.
    surfaceStyle = {
      background: 'rgba(18, 18, 20, 0.18)',
      backdropFilter: 'blur(40px) saturate(1.8)',
      WebkitBackdropFilter: 'blur(40px) saturate(1.8)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: breathing ? undefined : `
        0 16px 40px rgba(0,0,0,0.5),
        0 0 0 1px rgba(${accent}, 0.1),
        inset 0 1px 0 rgba(255,255,255,0.05)
      `,
    };
  } else {
    // Solid — the default. Semi-opaque fill, moderate blur.
    surfaceStyle = {
      background: 'rgba(18, 18, 20, 0.7)',
      backdropFilter: 'blur(28px) saturate(1.6)',
      WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: breathing ? undefined : `
        0 16px 40px rgba(0,0,0,0.5),
        0 0 0 1px rgba(${accent}, 0.1),
        inset 0 1px 0 rgba(255,255,255,0.05)
      `,
    };
  }

  return (
    <div
      onMouseDown={onDockMouseDown}
      style={{
        position: 'absolute',
        ...positionStyle,
        zIndex: 6,
        display: 'flex', alignItems: 'center',
        padding: '6px 10px',
        gap: 4,
        borderRadius: 14,
        ...surfaceStyle,
        // CSS custom properties so the keyframes can reference the live
        // accent without us having to inject a per-track keyframe. The
        // browser interpolates the shadow stack on each frame using these
        // values, so accent shifts on track change pick up automatically.
        ['--imm-dock-accent']: accent,
        animation: breathing ? 'immerseDockBreathe 8s ease-in-out infinite' : 'none',
        // Cursor: grab when draggable so the user gets affordance feedback.
        cursor: dockDraggableEnabled ? 'grab' : 'default',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <style>{`
        @keyframes immerseDockBreathe {
          0%, 100% {
            box-shadow:
              0 16px 40px rgba(0,0,0,0.5),
              0 0 0 1px rgba(var(--imm-dock-accent), 0.1),
              0 0 0 0 rgba(var(--imm-dock-accent), 0),
              inset 0 1px 0 rgba(255,255,255,0.05);
          }
          50% {
            box-shadow:
              0 16px 40px rgba(0,0,0,0.5),
              0 0 0 1px rgba(var(--imm-dock-accent), 0.35),
              0 0 28px 4px rgba(var(--imm-dock-accent), 0.18),
              inset 0 1px 0 rgba(255,255,255,0.08);
          }
        }
        /* Specular sheen — a thin diagonal highlight that slowly drifts
           across the dock. This is what separates "frosted plastic" from
           "polished glass": real glass has a moving spec from any light
           source. We use a single-pass animation over ~9s with a long
           pause off-screen so the sheen feels occasional, not constant. */
        @keyframes immerseDockSheen {
          0%   { transform: translateX(-140%) skewX(-20deg); opacity: 0; }
          8%   { opacity: 0.55; }
          22%  { transform: translateX(140%) skewX(-20deg); opacity: 0; }
          100% { transform: translateX(140%) skewX(-20deg); opacity: 0; }
        }
      `}</style>
      {liquidGlassDockEnabled ? (
        /* Specular sheen overlay — only present in liquid-glass mode.
           Absolutely positioned across the dock surface with pointer
           events disabled so it never blocks button clicks. The
           overflow:hidden on this wrapper keeps the angled sheen from
           bleeding past the dock's rounded corners. */
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            borderRadius: 14,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '-20%', bottom: '-20%',
              left: 0,
              width: '40%',
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
              filter: 'blur(8px)',
              // Overlay blend so the sheen reads as a light catch on the
              // glass rather than painting over the buttons. Where the
              // sheen overlaps an icon, the icon gets brighter; where
              // it's over empty glass, the glass picks up the highlight.
              // This also conveniently sidesteps any z-stacking issues
              // with the dock buttons.
              mixBlendMode: 'overlay',
              animation: 'immerseDockSheen 9s ease-in-out infinite',
              animationDelay: sheenPhaseRef.current,
            }}
          />
        </div>
      ) : null}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('find')) ? (
        <BottomDockBtn active={tab === 'find' && panelOpen} onClick={() => handleTabClick('find')} title="Find" onContextMenu={tabContextHandler('find')}>
          <Icons.Search />
        </BottomDockBtn>
      ) : null}
      <BottomDockBtn active={tab === 'library' && panelOpen} onClick={() => handleTabClick('library')} title={`Library · ${libraryCount}`}>
        <Icons.LibrarySidebar />
      </BottomDockBtn>
      {!(pinnableTabsEnabled && hiddenTabIds.includes('new')) ? (
        <BottomDockBtn active={tab === 'new' && panelOpen} onClick={() => handleTabClick('new')} title="New releases" onContextMenu={tabContextHandler('new')}>
          {/* Two-star sparkle. Both stars enlarged + slightly thicker so the
              silhouette fills the 14px bounding box like the other icons.
              Previous version was smaller because the star paths only used
              the inner 16×16 of a 24-unit viewBox. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            {/* Big star, slightly off-center top-left */}
            <path d="M10 1 L11.6 8.4 L19 10 L11.6 11.6 L10 19 L8.4 11.6 L1 10 L8.4 8.4 Z" />
            {/* Small accent star, lower-right */}
            <path d="M18 14 L18.8 17.2 L22 18 L18.8 18.8 L18 22 L17.2 18.8 L14 18 L17.2 17.2 Z" />
          </svg>
        </BottomDockBtn>
      ) : null}
      <BottomDockBtn active={tab === 'settings' && panelOpen} onClick={() => handleTabClick('settings')} title="Settings">
        <Icons.Settings />
      </BottomDockBtn>
      {!(pinnableTabsEnabled && hiddenTabIds.includes('stats')) ? (
        <BottomDockBtn active={tab === 'stats' && panelOpen} onClick={() => handleTabClick('stats')} title="Listening stats" onContextMenu={tabContextHandler('stats')}>
          {/* Bar chart with three bars of varying height — universal "stats /
              data" glyph. Distinct from the other icons in the row. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="6" y1="20" x2="6" y2="13" />
            <line x1="12" y1="20" x2="12" y2="6" />
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="3" y1="21" x2="21" y2="21" />
          </svg>
        </BottomDockBtn>
      ) : null}
      {journalTabEnabled && !(pinnableTabsEnabled && hiddenTabIds.includes('journal')) ? (
        <BottomDockBtn active={tab === 'journal' && panelOpen} onClick={() => handleTabClick('journal')} title="Listening journal" onContextMenu={tabContextHandler('journal')}>
          {/* Open-book glyph — distinguishes the diary view from Stats
              (numbers) and Queue (list). Two facing pages with a spine
              groove down the middle. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 5c3 0 7 1 10 2 3-1 7-2 10-2v14c-3 0-7 1-10 2-3-1-7-2-10-2V5z" />
            <line x1="12" y1="7" x2="12" y2="21" />
          </svg>
        </BottomDockBtn>
      ) : null}

      {/* Divider — separates the navigation tabs (Find/Library/New/Settings)
          from the playback-context buttons (Queue/Lyrics). The right-side
          group is "what's happening with the music right now" while the
          left-side group is "where do I want to navigate". */}
      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

      {/* Track tab — opens the side dock panel on the Track tab, which shows
          info about whatever's currently playing: hero strip, your history
          with this track, more from the album, more from the artist.
          Belongs in the playback-context group because it's all about
          what's happening right now. Hideable via pinnable-tabs. */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('track')) ? (
        <BottomDockBtn
          active={tab === 'track' && panelOpen}
          onClick={() => handleTabClick('track')}
          onContextMenu={tabContextHandler('track')}
          title="About this track"
          accent={accent}
        >
          {/* "Info" glyph — circle with an i. Universally recognised; pairs
              cleanly with the bar-chart Stats icon and the dice Random
              icon nearby without clashing. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16.5" />
            <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </BottomDockBtn>
      ) : null}

      {/* Random play — when enabled, plays a uniformly-random track from the
          library on click. Decision-fatigue cure. Lives in the playback-
          context group because it's an action that affects what's playing
          right now. Disabled (visually muted) if the library is empty. */}
      {randomButtonEnabled && typeof onPlayRandom === 'function' ? (
        <BottomDockBtn
          active={false}
          onClick={() => onPlayRandom?.()}
          title="Play something random"
          accent={accent}
        >
          {/* Dice — five-pip face. Rounded square outline + pips. Universal
              "random" symbol that won't be confused with shuffle (which uses
              the crossed-arrows icon elsewhere). */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
            <circle cx="8"  cy="8"  r="1.1" fill="currentColor" stroke="none" />
            <circle cx="16" cy="8"  r="1.1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="8"  cy="16" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="16" cy="16" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </BottomDockBtn>
      ) : null}

      {/* Recently-played peek — clock icon that opens a small popover above
          the dock listing the most-recently-played tracks. Click a track to
          play it; the popover closes automatically. Lives in the playback-
          context group because it answers "what was that song?" in the
          moment. The button position is captured via ref so the popover
          can absolute-position relative to it. */}
      {recentPeekEnabled ? (
        <div ref={peekBtnRef} style={{ position: 'relative', display: 'flex' }}>
          <BottomDockBtn
            active={peekOpen}
            onClick={() => setPeekOpen((o) => !o)}
            title="Recently played"
            accent={accent}
          >
            {/* Clock with a slight back-arrow accent — distinguishes "history"
                from a plain time display. Single SVG; the arrow is a small
                curved path looping from the top of the clock face. */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="8.5" />
              {/* Hour hand pointing to ~10 o'clock + minute hand pointing up */}
              <polyline points="12 7 12 12 9 14" />
              {/* Subtle counter-clockwise arrow over the top to imply "history" */}
              <path d="M 6.5 6.5 A 6 6 0 0 1 12 3" />
              <polyline points="11.5 1.5 12 3 10.5 3.5" />
            </svg>
          </BottomDockBtn>
          {peekOpen ? (
            <RecentPeekPopover
              library={library}
              playEvents={playEvents}
              range={recentPeekRange}
              customCount={recentPeekCustomCount}
              accent={accent}
              onPlayTrack={onPlayTrack}
              onClose={() => setPeekOpen(false)}
            />
          ) : null}
        </div>
      ) : null}

      {/* Queue tab — opens the side dock panel on the queue tab. Count
          badge surfaces how many tracks are queued so the user knows
          there's something there without needing to open it. */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('queue')) ? (
        <BottomDockBtn
          active={tab === 'queue' && panelOpen}
          onClick={() => handleTabClick('queue')}
          onContextMenu={tabContextHandler('queue')}
          title={queueCount > 0 ? `Queue · ${queueCount}` : 'Queue'}
          badge={queueCount > 0 ? queueCount : null}
          accent={accent}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="3.5" cy="6" r="1.2" fill="currentColor" />
            <circle cx="3.5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="3.5" cy="18" r="1.2" fill="currentColor" />
          </svg>
        </BottomDockBtn>
      ) : null}

      {/* Lyrics view-toggle. Disabled (visually muted) when no track is
          playing or no lyrics are available. Speech-bubble icon with
          interior text-lines reads instantly as "the words being said in
          this track" — distinct from the queue's straight lines because
          it has a recognizable container shape (rounded rectangle with
          a tail). */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('lyrics')) ? (
        <BottomDockBtn
          active={lyricsVisible && lyricsAvailable}
          onClick={onToggleLyrics}
          onContextMenu={tabContextHandler('lyrics')}
          title={lyricsVisible ? 'Hide lyrics' : 'Show lyrics'}
          accent={accent}
          disabled={!lyricsAvailable}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {/* Rounded speech-bubble outline with a small tail */}
            <path d="M4 5 a 2 2 0 0 1 2 -2 h 12 a 2 2 0 0 1 2 2 v 9 a 2 2 0 0 1 -2 2 h -7 l -4 4 v -4 h -1 a 2 2 0 0 1 -2 -2 z" />
            {/* Two short lines inside, suggesting text content */}
            <line x1="8" y1="8.5" x2="14" y2="8.5" />
            <line x1="8" y1="11.5" x2="16" y2="11.5" />
          </svg>
        </BottomDockBtn>
      ) : null}
    </div>
  );
}

/**
 * RecentPeekPopover — small floating panel that lists recently-played
 * tracks. Anchored to its triggering button (the parent renders it inside
 * a position:relative wrapper). The list is computed from `playEvents` +
 * `library` using one of several range strategies:
 *
 *   '5' / '10' / '20' — most-recently-played N (with same-track dedup)
 *   'today'   — plays since local midnight
 *   'session' — plays back to the last gap of >= 30 minutes
 *   'custom'  — most-recently-played `customCount` (with dedup)
 *
 * Dedup: if a song was played twice 5 minutes apart, it shows once with
 * a "2×" badge. Without dedup, listening to one track on loop would fill
 * the whole list with the same row.
 *
 * Click a row to play that track (uses the full library as the queue
 * context, mirroring how other "play this" actions in the app work).
 *
 * The popover is non-modal — clicking elsewhere closes it (handled by
 * the parent BottomDockBar via a document mousedown listener).
 */
function RecentPeekPopover({ library = [], playEvents = [], range = '5', customCount = 15, accent = '48, 48, 48', onPlayTrack, onClose }) {
  // Index library by id once so we can resolve event → track quickly.
  const libIndex = useMemo(() => {
    const m = new Map();
    for (const t of library) m.set(t.id, t);
    return m;
  }, [library]);

  // Build the recent list according to the chosen range.
  const recent = useMemo(() => {
    if (!playEvents || playEvents.length === 0) return [];

    // Filter events into the active window. Events come oldest-first;
    // we walk backwards from the end.
    const reversed = [...playEvents].reverse();
    let inWindow = reversed;

    if (range === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const startMs = start.getTime();
      inWindow = reversed.filter((e) => e.at >= startMs);
    } else if (range === 'session') {
      // A session boundary is a gap of >= 30 minutes between consecutive
      // plays. Walk backwards from the most recent play and stop when we
      // hit the first such gap.
      const SESSION_GAP_MS = 30 * 60 * 1000;
      const window = [];
      let lastAt = null;
      for (const ev of reversed) {
        if (lastAt != null && lastAt - ev.at > SESSION_GAP_MS) break;
        window.push(ev);
        lastAt = ev.at;
      }
      inWindow = window;
    }
    // For count-based ranges ('5'/'10'/'20'/'custom') we don't pre-filter;
    // we dedup-then-slice below since count refers to unique tracks.

    // Resolve to tracks and dedup by track id while preserving order.
    // Track each occurrence so we can show a play-count badge.
    const seen = new Map(); // track_id -> { track, count, mostRecentAt }
    for (const ev of inWindow) {
      const t = libIndex.get(ev.track_id);
      if (!t) continue; // skip events whose track has been removed
      if (seen.has(ev.track_id)) {
        const slot = seen.get(ev.track_id);
        slot.count += 1;
        // Keep the most recent timestamp (events are reversed, so first
        // sighting of a track is already the most recent).
      } else {
        seen.set(ev.track_id, { track: t, count: 1, mostRecentAt: ev.at });
      }
    }

    const list = Array.from(seen.values());

    // Apply count cap for count-based ranges.
    if (range === '5') return list.slice(0, 5);
    if (range === '10') return list.slice(0, 10);
    if (range === '20') return list.slice(0, 20);
    if (range === 'custom') return list.slice(0, Math.max(1, customCount));
    // 'today' and 'session' return everything in the window.
    return list;
  }, [playEvents, libIndex, range, customCount]);

  // Friendly label for the header — describes the current range.
  const rangeLabel = (() => {
    if (range === 'today') return 'Today';
    if (range === 'session') return 'Current session';
    if (range === 'custom') return `Last ${customCount}`;
    return `Last ${range}`;
  })();

  const fmtRelTime = (ts) => {
    const diffMs = Date.now() - ts;
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  };

  const handlePlay = (track) => {
    if (!track || !onPlayTrack) return;
    onPlayTrack(track, library);
    onClose?.();
  };

  return (
    <div
      data-recent-peek="1"
      style={{
        // Anchored ABOVE the button (dock sits at bottom of screen).
        // `bottom: 100%` positions the popover's bottom edge at the button's
        // top edge; the 10px gap leaves visual breathing room.
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        // Right-aligned so the popover doesn't hang off the left edge of
        // the dock. The button itself is on the right side of the dock,
        // so right-aligning matches the natural reading position.
        right: 0,
        width: 280,
        maxHeight: 360,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(18,18,22,0.96)',
        backdropFilter: 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        zIndex: 100,
        overflow: 'hidden',
        // Quick fade-in so the popover doesn't pop into existence harshly.
        animation: 'recentPeekFadeIn 160ms ease',
      }}
    >
      {/* Header strip */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Recently played
          </div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
            {rangeLabel} · {recent.length} {recent.length === 1 ? 'track' : 'tracks'}
          </div>
        </div>
      </div>

      {/* Body — scrollable list of recent tracks */}
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        padding: '4px 4px',
        scrollbarGutter: 'stable',
      }}>
        {recent.length === 0 ? (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            color: 'rgba(255,255,255,0.4)', fontSize: 11, lineHeight: 1.5,
          }}>
            Nothing played {range === 'today' ? 'today' : range === 'session' ? 'this session' : 'yet'}.
            <div style={{ marginTop: 4, fontSize: 9.5, color: 'rgba(255,255,255,0.3)' }}>
              Play something and it'll show up here.
            </div>
          </div>
        ) : (
          recent.map(({ track: t, count, mostRecentAt }) => (
            <div
              key={t.id}
              onClick={() => handlePlay(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.1)`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {t.coverArt ? (
                <img src={t.coverArt} alt="" style={{
                  width: 32, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0,
                }} />
              ) : (
                <div style={{
                  width: 32, height: 32, borderRadius: 4, flexShrink: 0,
                  background: 'rgba(255,255,255,0.05)',
                }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11.5, color: '#fff', fontWeight: 500,
                  overflow: 'hidden',
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {t.title || 'Untitled'}
                  </span>
                  {count > 1 ? (
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      color: `rgb(${accent})`,
                      background: `rgba(${accent},0.18)`,
                      padding: '1px 5px', borderRadius: 4,
                      flexShrink: 0,
                    }}>
                      {count}×
                    </span>
                  ) : null}
                </div>
                <div style={{
                  fontSize: 9.5, color: 'rgba(255,255,255,0.5)',
                  marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.artist || 'Unknown artist'} · {fmtRelTime(mostRecentAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes recentPeekFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}


function BottomDockBtn({ active, onClick, title, children, badge = null, accent = '48, 48, 48', disabled = false, onContextMenu }) {
  const [hovered, setHovered] = useState(false);
  // Bottom dock bar is anchored at the bottom of the window — tooltips
  // would clip off-screen if they appeared below. Force above.
  return (
    <Tooltip label={title} side="top">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={disabled}
        // Keep aria-label for accessibility (screen readers); the visual
        // tooltip replaces the native title="" hover behavior.
        aria-label={title}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          width: 32, height: 32, borderRadius: 8,
          background: disabled
            ? 'transparent'
            : (active
                ? `rgba(${accent}, 0.4)`
                : (hovered ? 'rgba(255,255,255,0.08)' : 'transparent')),
          border: 'none',
          color: disabled
            ? 'rgba(255,255,255,0.25)'
            : (active ? '#fff' : (hovered ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.65)')),
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          flexShrink: 0,
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {children}
        {badge != null ? (
          <span style={{
            position: 'absolute', top: 1, right: 1,
            minWidth: 12, height: 12, padding: '0 3px',
            borderRadius: 6, fontSize: 8, fontWeight: 700, lineHeight: 1,
            background: `rgba(${accent}, 0.95)`, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.45)',
          }}>
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}


/* =========================================================================
 *  PanelResizeHandle — invisible drag strip on the inner edge of the side
 *  panel. Lets the user widen or narrow the panel by dragging the strip;
 *  releases commit the new width via `onCommitWidth`.
 *
 *  Tracking happens locally during the drag for immediate feedback (the
 *  panel width updates frame-by-frame as the cursor moves), but only the
 *  final value is persisted by the caller.
 *
 *  Bounds: 240..720 px. Below 240 the panel becomes unusable; above 720
 *  it dominates the immersive view.
 * ========================================================================= */
function PanelResizeHandle({ side, currentWidth, onCommitWidth }) {
  const [hovered, setHovered] = useState(false);
  const dragRef = useRef(null);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Capture the starting cursor X and width so we can compute deltas
    // without needing to read the panel rect on each move (which would
    // re-trigger layout). Sign of the delta depends on which side the
    // panel is on: right-side panel widens when dragged left.
    dragRef.current = {
      startX: e.clientX,
      startWidth: currentWidth,
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      // Right-side panel: drag handle is on its left edge. Moving the cursor
      // LEFT (dx < 0) widens the panel. So new width = startWidth - dx.
      // Left-side panel: handle is on the right edge; LEFT drag narrows.
      const sign = side === 'right' ? -1 : 1;
      const next = Math.round(dragRef.current.startWidth + sign * dx);
      const clamped = Math.max(240, Math.min(720, next));
      onCommitWidth?.(clamped);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      style={{
        position: 'absolute',
        top: 0, bottom: 0,
        // Inner edge: right-side panel exposes its LEFT edge; left-side its RIGHT.
        ...(side === 'right' ? { left: 0 } : { right: 0 }),
        width: 6,
        zIndex: 10,
        cursor: 'ew-resize',
        // Subtle visual feedback on hover so the user discovers the handle.
        // The 1px line lives in the centre of the 6px hit zone.
        background: 'transparent',
      }}
    >
      {/* Visible 1px guide line — appears on hover only so the resting
          state is invisible. */}
      <div style={{
        position: 'absolute',
        top: '15%', bottom: '15%',
        ...(side === 'right' ? { left: 2 } : { right: 2 }),
        width: 2, borderRadius: 2,
        background: hovered ? 'rgba(255,255,255,0.4)' : 'transparent',
        transition: 'background 160ms ease',
      }} />
    </div>
  );
}


function SideDock({
  collapsed,
  onToggleCollapsed,
  tab,
  onTabChange,
  tracks,
  library,
  libraryCount,
  search,
  onSearchChange,
  currentTrack,
  isPlaying,
  currentTime = 0,
  lyricsData = null,
  onShowLyricsPanel,
  selectedId,
  setSelectedId,
  hovered,
  setHovered,
  onPlayTrack,
  onPlayPauseTrack,
  onImportFiles,
  onImportFolder,
  importing,
  setImporting,
  canRemove,
  onRemoveFromLibrary,
  canEdit,
  onEditTrack,
  canEditAlbum,
  onEditAlbum,
  playlists = [],
  playlistCoverMap = new Map(),
  openPlaylistId,
  openPlaylistTracks,
  onNewPlaylist,
  onEditPlaylist,
  onDeletePlaylist,
  onRemoveTracksFromPlaylist,
  canAddToPlaylist,
  onAddToPlaylist,
  accent,
  spotifyCredsRefreshKey,
  onSpotifyImportDone,
  onSpotifyCredsSaved,
  uiFontId,
  onSetUiFontId,
  uiFontStack,
  animateGradient,
  onSetAnimateGradient,
  beatReactive = false,
  onSetBeatReactive,
  coverFullscreenEnabled = true,
  onSetCoverFullscreenEnabled,
  pinnableTabsEnabled = false,
  onSetPinnableTabsEnabled,
  hiddenTabIds = [],
  onSetHiddenTabIds,
  dockCollapseAnimationEnabled = false,
  onSetDockCollapseAnimationEnabled,
  randomButtonEnabled = false,
  onSetRandomButtonEnabled,
  onPlayRandom,
  breathingDockPillEnabled = false,
  onSetBreathingDockPillEnabled,
  dockTransparentEnabled = false,
  onSetDockTransparentEnabled,
  liquidGlassDockEnabled = false,
  onSetLiquidGlassDockEnabled,
  journalTabEnabled = false,
  onSetJournalTabEnabled,
  queuePainterEnabled = false,
  onSetQueuePainterEnabled,
  recentPeekEnabled = true,
  onSetRecentPeekEnabled,
  recentPeekRange = '5',
  onSetRecentPeekRange,
  recentPeekCustomCount = 15,
  onSetRecentPeekCustomCount,
  firstTimeSparkleEnabled = false,
  onSetFirstTimeSparkleEnabled,
  trackOfMomentEnabled = false,
  onSetTrackOfMomentEnabled,
  clickToFilterEnabled = false,
  onSetClickToFilterEnabled,
  onFilterByText,
  artistInfoEnabled = false,
  onSetArtistInfoEnabled,
  lastFmApiKey = '',
  onSetLastFmApiKey,
  creditsEnabled = false,
  onSetCreditsEnabled,
  videosEnabled = false,
  onSetVideosEnabled,
  edgeBleedEnabled = false,
  onSetEdgeBleedEnabled,
  ambientMode = 'idle',
  onSetAmbientMode,
  ambientCustomDelaySec = 30,
  onSetAmbientCustomDelaySec,
  twoPaneEnabled = false,
  onSetTwoPaneEnabled,
  discordPresenceEnabled = false,
  onSetDiscordPresenceEnabled,
  discordAppId = '',
  onSetDiscordAppId,
  imgbbApiKey = '',
  onSetImgbbApiKey,
  onReloadLibrary,
  panelResizableEnabled = false,
  onSetPanelResizableEnabled,
  dockDraggableEnabled = false,
  onSetDockDraggableEnabled,
  panelWidth = 340,
  onSetPanelWidth,
  playEvents = [],
  onResetStats,
  statsRangeTabsEnabled = true,
  onSetStatsRangeTabsEnabled,
  // Right-click handler factory provided by the page so the popover can be
  // owned at page level (where it can layer above the dock without z-index
  // games inside the dock itself).
  tabContextHandler = () => undefined,
  onToggleFavorite,
  queue = [],
  currentIndex = -1,
  onAddToQueue,
  onPlayNext,
  onRemoveFromQueue,
  onReorderQueue,
  onClearUpNext,
  onJumpToQueueIndex,
  releases = [],
  followedArtists = [],
  followOverrides = [],
  releasesRefreshing = false,
  onRefreshReleases,
  onAddFollowedArtist,
  onExcludeFollowedArtist,
  onClearFollowedArtistOverride,
  onClearLibrary,
  onShowCandidatePicker,
  onTrackContextMenu,
  contextMenusEnabled,
  onSetContextMenusEnabled,
  side = 'right',
  onSetSide,
  forceOpaque = false,
}) {
  // No complex mounting logic needed — the expanded content is always in the
  // DOM from first render. When `collapsed`, it's hidden via display:none but
  // React has already mounted LibraryTab, built the albums memo, and set up
  // VirtualTrackList's observers. First user-open is just a CSS display flip,
  // which is instant.

  // Disable the expensive backdrop-filter during width transitions. The blur
  // has to re-sample and re-blur the entire background every frame of the
  // animation, which is the main source of jank. We swap it for a solid
  // opaque background during the ~280ms transition, then restore the glass.
  const [isAnimating, setIsAnimating] = useState(false);
  const animTimerRef = useRef(null);

  useEffect(() => {
    setIsAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    // Match whichever collapse animation is active. The collapse-to-edge
    // mode runs ~340ms; the default slide is ~280ms. Either way we give a
    // small safety buffer so backdrop-filter doesn't reactivate too early.
    const dur = dockCollapseAnimationEnabled ? 380 : 320;
    animTimerRef.current = setTimeout(() => setIsAnimating(false), dur);
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, [collapsed, dockCollapseAnimationEnabled]);

  /**
   * Import an entire album release via iTunes → yt-dlp. The process:
   *   1. Ask the main process to look up all tracks on the album (iTunes)
   *   2. For each track, invoke the existing importFromYoutubeSearch IPC
   *      (same downloader as the Find tab)
   *   3. Report per-track progress via the provided callback
   *
   * Returns { ok, completed, failed, total, error?, failures? }.
   */
  const handleImportRelease = useCallback(async (release, onProgress) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.lookupReleaseAlbumTracks || !api?.importFromYoutubeSearch) {
      return { ok: false, error: 'Import not available' };
    }
    // Step 1 — pull track list from iTunes
    let tracks = [];
    try {
      const r = await api.lookupReleaseAlbumTracks(release.collectionId);
      if (!r?.ok) return { ok: false, error: r?.error || 'Could not fetch tracks' };
      tracks = r.tracks || [];
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
    if (!tracks.length) return { ok: false, error: 'No tracks on this album' };

    console.log(`[import-release] "${release.collectionName}" — ${tracks.length} tracks to download`);

    // Step 2 — download each track in sequence
    onProgress?.({ status: 'downloading', current: 0, total: tracks.length });
    let completed = 0;
    let failed = 0;
    const failures = [];
    for (let i = 0; i < tracks.length; i += 1) {
      const t = tracks[i];
      onProgress?.({
        status: 'downloading',
        current: i + 1,
        total: tracks.length,
      });
      try {
        // IMPORTANT: main.js expects `artists` to be a comma-joined string,
        // not an array (the Spotify client builds them that way). Must pass
        // a string here so yt-dlp receives a clean search query.
        const artistStr = t.artistName || release.artistName || '';
        const res = await api.importFromYoutubeSearch({
          title: t.trackName,
          artists: artistStr,
          album: t.collectionName || release.collectionName,
          albumArtUrl: t.artworkUrl || release.artworkUrl,
          durationMs: t.trackTimeMillis || 0,
          // Synthetic ID so the importer's dedupe logic has something stable.
          spotifyId: `itunes:${t.trackId}`,
          // Track position from iTunes (sorted by trackNumber already).
          trackNumber: t.trackNumber || null,
          discNumber: null,  // iTunes lookup doesn't expose disc numbers
          // iTunes flags each track as 'explicit' / 'cleaned' / 'notExplicit';
          // main.js maps that to a boolean. Used by the downloader's tier
          // selection AND stored on the track for the UI badge.
          explicit: t.explicit,
        });
        if (res?.ok && res.track) {
          onSpotifyImportDone?.(res.track);
          completed += 1;
          console.log(`[import-release]   ✓ ${t.trackName}`);
        } else {
          failed += 1;
          const reason = res?.error || 'unknown error';
          failures.push({ title: t.trackName, reason });
          console.log(`[import-release]   ✗ ${t.trackName} — ${reason}`);
        }
      } catch (e) {
        failed += 1;
        const reason = String(e?.message || e);
        failures.push({ title: t.trackName, reason });
        console.error(`[import-release]   ✗ ${t.trackName} — threw:`, reason);
      }
    }
    console.log(`[import-release] "${release.collectionName}" done — ${completed}/${tracks.length} ok, ${failed} failed`);
    return { ok: true, completed, failed, total: tracks.length, failures };
  }, [onSpotifyImportDone]);

  return (
    <aside
      style={{
        position: 'absolute',
        top: 44,
        // Leave room at the bottom for the BottomDockBar (sits at bottom 16,
        // ~44px tall, plus a gap so the panel doesn't visually crowd it).
        bottom: 76,
        // Sits flush against the chosen edge (the bottom dock bar replaced
        // the side rail, so there's no rail to offset around anymore).
        ...(side === 'right'
          ? { right: 12 }
          : { left: 12 }
        ),
        // Panel width — respects the user's chosen size when the resize
        // feature is enabled. Falls back to the historical default 340px
        // otherwise. Bounds enforced upstream (240..720) so we trust the
        // value here.
        width: panelResizableEnabled ? panelWidth : 340,
        zIndex: 5,
        display: 'flex', flexDirection: 'column',
        borderRadius: 18,
        background: (isAnimating || forceOpaque) ? 'rgba(18, 18, 20, 0.96)' : 'rgba(18, 18, 20, 0.45)',
        backdropFilter: (isAnimating || forceOpaque) ? 'none' : 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: (isAnimating || forceOpaque) ? 'none' : 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: `
          0 24px 60px rgba(0,0,0,0.55),
          0 0 0 1px rgba(${accent},0.12),
          inset 0 1px 0 rgba(255,255,255,0.06)
        `,
        overflow: 'hidden',
        // Panel collapse animation. Two modes:
        //
        //  default       slides off-screen toward the panel's outside edge,
        //                fades to 0 opacity. Reliable, snappy, the original.
        //
        //  collapse-to-edge (DEV)  scales toward the bottom-inner corner of
        //                the panel — the corner closest to the centered
        //                bottom-dock pill — while translating downward and
        //                blurring slightly. The visual reads as the panel
        //                collapsing INTO the dock pill, which makes the dock
        //                feel like the source of truth for the panel.
        //
        // Both share the same `pointerEvents: none` + `opacity: 0` end state
        // so collapsed UI never catches clicks.
        ...(dockCollapseAnimationEnabled ? {
          transformOrigin: side === 'right' ? '0% 100%' : '100% 100%',
          transform: collapsed
            ? `translateY(40px) scale(0.05)`
            : 'translateY(0) scale(1)',
          opacity: collapsed ? 0 : 1,
          filter: collapsed ? 'blur(4px)' : 'blur(0)',
          pointerEvents: collapsed ? 'none' : 'auto',
          // Slightly longer + a custom curve that decelerates hard near the
          // end, so the final settle is smooth rather than rubbery.
          transition: 'transform 0.34s cubic-bezier(0.32, 0.0, 0.16, 1), opacity 0.26s ease, filter 0.28s ease, background 0.25s ease',
          willChange: 'transform, opacity, filter',
        } : {
          // When `collapsed` (open=false), translate the panel off-screen in
          // the direction of its edge. Combined with `pointerEvents: none` so
          // hidden content doesn't catch clicks.
          transform: collapsed
            ? `translateX(${side === 'right' ? 'calc(100% + 24px)' : 'calc(-100% - 24px)'})`
            : 'translateX(0)',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s ease, background 0.25s ease',
          willChange: 'transform, opacity',
        }),
        WebkitAppRegion: 'no-drag',
      }}
    >
      {/* Resize handle — only when the resize feature is enabled. Sits on
          the panel's inner edge: left edge for a right-side panel, right
          edge for a left-side panel. Absolutely positioned so it doesn't
          push content. */}
      {panelResizableEnabled && !collapsed ? (
        <PanelResizeHandle
          side={side}
          currentWidth={panelWidth}
          onCommitWidth={onSetPanelWidth}
        />
      ) : null}

      {/* Expanded content */}
      <div style={{
        display: 'flex',
        flex: 1, flexDirection: 'column', minHeight: 0,
      }}>
        {/* Compact header showing the active tab name. The tab buttons that
            used to live here moved to the always-visible NavRail. The
            collapse button is also gone — toggling the panel is owned by
            the rail's chevron. */}
        <div style={{
          display: 'flex', padding: '14px 14px 10px 14px', alignItems: 'center',
          minWidth: 0,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            {tab === 'find' ? 'Find'
              : tab === 'library' ? 'Library'
              : tab === 'new' ? 'New'
              : tab === 'settings' ? 'Settings'
              : tab === 'stats' ? 'Stats'
              : tab === 'queue' ? 'Queue'
              : tab === 'journal' ? 'Journal'
              : tab === 'track' ? 'Track'
              : (typeof tab === 'string' && tab.startsWith('playlist:')) ? 'Playlist'
              : 'Library'}
          </div>
        </div>
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

        {/* LibraryTab stays mounted across tab switches — expensive albums memo
            only computes once per library change. Other tabs mount/unmount
            normally since they're cheap. */}
        <div style={{ display: tab === 'library' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0 }}>
          <LibraryTab
            tracks={tracks}
            library={library}
            libraryCount={libraryCount}
            search={search}
            onSearchChange={onSearchChange}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            hovered={hovered}
            setHovered={setHovered}
            onPlayTrack={onPlayTrack}
            onPlayPauseTrack={onPlayPauseTrack}
            onImportFiles={onImportFiles}
            onImportFolder={onImportFolder}
            importing={importing}
            canRemove={canRemove}
            onRemoveFromLibrary={onRemoveFromLibrary}
            canEdit={canEdit}
            onEditTrack={onEditTrack}
            canEditAlbum={canEditAlbum}
            onEditAlbum={onEditAlbum}
            canAddToPlaylist={canAddToPlaylist}
            onAddToPlaylist={onAddToPlaylist}
            onAddToQueue={onAddToQueue}
            onPlayNext={onPlayNext}
            onToggleFavorite={onToggleFavorite}
            onTrackContextMenu={onTrackContextMenu}
            playlists={playlists}
            playlistCoverMap={playlistCoverMap}
            onOpenPlaylist={(id) => onTabChange(`playlist:${id}`)}
            onNewPlaylist={onNewPlaylist}
            firstTimeSparkleEnabled={firstTimeSparkleEnabled}
            clickToFilterEnabled={clickToFilterEnabled}
            onFilterByText={onFilterByText}
            twoPaneEnabled={twoPaneEnabled}
            accent={accent}
          />
        </div>
        <div style={{ display: tab === 'find' ? 'contents' : 'none' }}>
          <FindTab
            importing={importing}
            setImporting={setImporting}
            spotifyCredsRefreshKey={spotifyCredsRefreshKey}
            onSpotifyImportDone={onSpotifyImportDone}
            onOpenSettings={() => onTabChange('settings')}
            accent={accent}
            library={library}
            onShowCandidatePicker={onShowCandidatePicker}
            isActive={tab === 'find'}
          />
        </div>
        {tab === 'new' ? (
          <NewReleasesTab
            releases={releases}
            followedArtists={followedArtists}
            followOverrides={followOverrides}
            refreshing={releasesRefreshing}
            onRefresh={onRefreshReleases}
            onAddFollowedArtist={onAddFollowedArtist}
            onExcludeFollowedArtist={onExcludeFollowedArtist}
            onClearFollowedArtistOverride={onClearFollowedArtistOverride}
            onImportRelease={handleImportRelease}
            library={library}
            accent={accent}
          />
        ) : tab === 'settings' ? (
          <SettingsTab
            uiFontId={uiFontId}
            onSetUiFontId={onSetUiFontId}
            uiFontStack={uiFontStack}
            onSpotifyCredsSaved={onSpotifyCredsSaved}
            animateGradient={animateGradient}
            onSetAnimateGradient={onSetAnimateGradient}
            beatReactive={beatReactive}
            onSetBeatReactive={onSetBeatReactive}
            coverFullscreenEnabled={coverFullscreenEnabled}
            onSetCoverFullscreenEnabled={onSetCoverFullscreenEnabled}
            pinnableTabsEnabled={pinnableTabsEnabled}
            onSetPinnableTabsEnabled={onSetPinnableTabsEnabled}
            hiddenTabIds={hiddenTabIds}
            onSetHiddenTabIds={onSetHiddenTabIds}
            dockCollapseAnimationEnabled={dockCollapseAnimationEnabled}
            onSetDockCollapseAnimationEnabled={onSetDockCollapseAnimationEnabled}
            randomButtonEnabled={randomButtonEnabled}
            onSetRandomButtonEnabled={onSetRandomButtonEnabled}
            breathingDockPillEnabled={breathingDockPillEnabled}
            onSetBreathingDockPillEnabled={onSetBreathingDockPillEnabled}
            dockTransparentEnabled={dockTransparentEnabled}
            onSetDockTransparentEnabled={onSetDockTransparentEnabled}
            liquidGlassDockEnabled={liquidGlassDockEnabled}
            onSetLiquidGlassDockEnabled={onSetLiquidGlassDockEnabled}
            journalTabEnabled={journalTabEnabled}
            onSetJournalTabEnabled={onSetJournalTabEnabled}
            queuePainterEnabled={queuePainterEnabled}
            onSetQueuePainterEnabled={onSetQueuePainterEnabled}
            recentPeekEnabled={recentPeekEnabled}
            onSetRecentPeekEnabled={onSetRecentPeekEnabled}
            recentPeekRange={recentPeekRange}
            onSetRecentPeekRange={onSetRecentPeekRange}
            recentPeekCustomCount={recentPeekCustomCount}
            onSetRecentPeekCustomCount={onSetRecentPeekCustomCount}
            firstTimeSparkleEnabled={firstTimeSparkleEnabled}
            onSetFirstTimeSparkleEnabled={onSetFirstTimeSparkleEnabled}
            trackOfMomentEnabled={trackOfMomentEnabled}
            onSetTrackOfMomentEnabled={onSetTrackOfMomentEnabled}
            statsRangeTabsEnabled={statsRangeTabsEnabled}
            onSetStatsRangeTabsEnabled={onSetStatsRangeTabsEnabled}
            clickToFilterEnabled={clickToFilterEnabled}
            onSetClickToFilterEnabled={onSetClickToFilterEnabled}
            artistInfoEnabled={artistInfoEnabled}
            onSetArtistInfoEnabled={onSetArtistInfoEnabled}
            lastFmApiKey={lastFmApiKey}
            onSetLastFmApiKey={onSetLastFmApiKey}
            creditsEnabled={creditsEnabled}
            onSetCreditsEnabled={onSetCreditsEnabled}
            videosEnabled={videosEnabled}
            onSetVideosEnabled={onSetVideosEnabled}
            edgeBleedEnabled={edgeBleedEnabled}
            onSetEdgeBleedEnabled={onSetEdgeBleedEnabled}
            ambientMode={ambientMode}
            onSetAmbientMode={onSetAmbientMode}
            ambientCustomDelaySec={ambientCustomDelaySec}
            onSetAmbientCustomDelaySec={onSetAmbientCustomDelaySec}
            twoPaneEnabled={twoPaneEnabled}
            onSetTwoPaneEnabled={onSetTwoPaneEnabled}
            discordPresenceEnabled={discordPresenceEnabled}
            onSetDiscordPresenceEnabled={onSetDiscordPresenceEnabled}
            discordAppId={discordAppId}
            onSetDiscordAppId={onSetDiscordAppId}
            imgbbApiKey={imgbbApiKey}
            onSetImgbbApiKey={onSetImgbbApiKey}
            onReloadLibrary={onReloadLibrary}
            panelResizableEnabled={panelResizableEnabled}
            onSetPanelResizableEnabled={onSetPanelResizableEnabled}
            dockDraggableEnabled={dockDraggableEnabled}
            onSetDockDraggableEnabled={onSetDockDraggableEnabled}
            onClearLibrary={onClearLibrary}
            dockSide={side}
            onSetDockSide={onSetSide}
            contextMenusEnabled={contextMenusEnabled}
            onSetContextMenusEnabled={onSetContextMenusEnabled}
          />
        ) : tab === 'stats' ? (
          <StatsTab
            library={library}
            playlists={playlists}
            onPlayTrack={onPlayTrack}
            accent={accent}
            playEvents={playEvents}
            onResetStats={onResetStats}
            rangeTabsEnabled={statsRangeTabsEnabled}
          />
        ) : tab === 'queue' ? (
          <QueueTab
            queue={queue}
            currentIndex={currentIndex}
            onJumpToQueueIndex={onJumpToQueueIndex}
            onRemoveFromQueue={onRemoveFromQueue}
            onReorderQueue={onReorderQueue}
            onClearUpNext={onClearUpNext}
            accent={accent}
            painterAvailable={queuePainterEnabled}
            currentTime={currentTime}
          />
        ) : tab === 'journal' ? (
          <JournalTab
            library={library}
            playEvents={playEvents}
            accent={accent}
            onPlayTrack={onPlayTrack}
          />
        ) : tab === 'track' ? (
          <TrackTab
            currentTrack={currentTrack}
            library={library}
            playEvents={playEvents}
            accent={accent}
            onPlayTrack={onPlayTrack}
            onFilterByText={onFilterByText}
            clickToFilterEnabled={clickToFilterEnabled}
            onTabChange={onTabChange}
            currentTime={currentTime}
            lyricsData={lyricsData}
            onShowLyricsPanel={onShowLyricsPanel}
            artistInfoEnabled={artistInfoEnabled}
            lastFmApiKey={lastFmApiKey}
            creditsEnabled={creditsEnabled}
            videosEnabled={videosEnabled}
          />
        ) : (typeof tab === 'string' && tab.startsWith('playlist:')) ? (
          (() => {
            const pl = playlists.find((p) => p.id === openPlaylistId);
            if (!pl) {
              return (
                <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11.5 }}>
                  Playlist not found.
                </div>
              );
            }
            return (
              <PlaylistView
                playlist={pl}
                tracks={openPlaylistTracks}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                hovered={hovered}
                setHovered={setHovered}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                onPlayTrack={onPlayTrack}
                onPlayPauseTrack={onPlayPauseTrack}
                onEditPlaylist={onEditPlaylist}
                onDeletePlaylist={onDeletePlaylist}
                onRemoveTracksFromPlaylist={onRemoveTracksFromPlaylist}
                onTrackContextMenu={onTrackContextMenu}
                onBack={() => onTabChange('library')}
                accent={accent}
              />
            );
          })()
        ) : null}
      </div>
    </aside>
  );
}

function TabBtn({ children, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, minWidth: 0,
        padding: '6px 3px', borderRadius: 9, border: 'none',
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? '#fff' : hov ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)',
        fontSize: 11, fontWeight: 600, cursor: 'pointer',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Render a playlist's thumbnail — uses the custom cover if set, otherwise
 * builds a 2x2 mosaic from the first 4 unique track covers in the playlist.
 * Falls back gracefully for playlists with 0/1/2/3 covers.
 *
 * Props:
 *  - playlist: the playlist object (id, name, coverArt)
 *  - trackCovers: array of cover URLs from the playlist's tracks (already
 *    filtered/deduped by the caller; may be empty)
 *  - size: pixel size of the square thumbnail
 */
function PlaylistThumb({ playlist, trackCovers = [], size = 34 }) {
  // Custom cover — single image fills the square
  if (playlist?.coverArt) {
    return (
      <img
        src={playlist.coverArt}
        alt=""
        style={{
          width: size, height: size, objectFit: 'cover',
          borderRadius: Math.max(6, Math.round(size * 0.18)),
          display: 'block', background: '#111',
        }}
      />
    );
  }

  const borderRadius = Math.max(6, Math.round(size * 0.18));
  const covers = trackCovers.slice(0, 4);

  // No tracks / no covers — show a musical note placeholder
  if (covers.length === 0) {
    return (
      <div style={{
        width: size, height: size, borderRadius,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.35)',
      }}>
        <svg width={Math.round(size * 0.45)} height={Math.round(size * 0.45)} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
        </svg>
      </div>
    );
  }

  // Single cover — full fill
  if (covers.length === 1) {
    return (
      <img src={covers[0]} alt="" style={{
        width: size, height: size, objectFit: 'cover',
        borderRadius, display: 'block', background: '#111',
      }} />
    );
  }

  // 2 covers — vertical split
  if (covers.length === 2) {
    return (
      <div style={{
        width: size, height: size, borderRadius, overflow: 'hidden',
        display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#111',
      }}>
        <img src={covers[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <img src={covers[1]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  // 3 covers — first on left, others stacked on right
  if (covers.length === 3) {
    return (
      <div style={{
        width: size, height: size, borderRadius, overflow: 'hidden',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', background: '#111',
      }}>
        <img src={covers[0]} alt="" style={{ gridRow: '1 / 3', width: '100%', height: '100%', objectFit: 'cover' }} />
        <img src={covers[1]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <img src={covers[2]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  // 4 covers — classic 2x2 mosaic
  return (
    <div style={{
      width: size, height: size, borderRadius, overflow: 'hidden',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', background: '#111',
    }}>
      {covers.map((c, i) => (
        <img key={i} src={c} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ))}
    </div>
  );
}


function CollapsedRail({
  tab, onTabChange, libraryCount, queueCount = 0, accent = '48, 48, 48',
  playlists = [], playlistCoverMap = new Map(), onNewPlaylist,
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 14, minHeight: 0,
    }}>
      {/* Top section — fixed system tabs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <RailIcon active={tab === 'find'} onClick={() => onTabChange('find')} title="Find">
          <Icons.Search />
        </RailIcon>
        <RailIcon active={tab === 'library'} onClick={() => onTabChange('library')} title={`Library · ${libraryCount}`}>
          <Icons.LibrarySidebar />
        </RailIcon>
        <RailIcon active={tab === 'new'} onClick={() => onTabChange('new')} title="New releases">
          {/* 4-point sparkle — a big one with a small companion, classic "new/magic" glyph */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            {/* Large sparkle centered a bit high-left */}
            <path d="M10 2 L11.3 8 L17 9.3 L11.3 10.6 L10 16.6 L8.7 10.6 L3 9.3 L8.7 8 Z" />
            {/* Smaller companion at bottom-right */}
            <path d="M17.5 14 L18.2 17 L21 17.6 L18.2 18.2 L17.5 21.2 L16.8 18.2 L14 17.6 L16.8 17 Z" />
          </svg>
        </RailIcon>
        <RailIcon active={tab === 'settings'} onClick={() => onTabChange('settings')} title="Settings">
          <Icons.Settings />
        </RailIcon>
      </div>

      {/* Divider — only shown if there are playlists or the new-playlist button is available */}
      {(playlists.length > 0 || typeof onNewPlaylist === 'function') ? (
        <div style={{ width: 20, height: 1, background: 'rgba(255,255,255,0.1)', margin: '10px 0 8px', flexShrink: 0 }} />
      ) : null}

      {/* Middle section — scrollable playlist stack. The 4px top padding gives
          the active-playlist outline room to render without crossing the
          divider above. */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '4px 0 4px', width: '100%',
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
      }}>
        {playlists.map((pl) => {
          const railTab = `playlist:${pl.id}`;
          const active = tab === railTab;
          return (
            <button
              key={pl.id}
              type="button"
              onClick={() => onTabChange(railTab)}
              title={pl.name}
              aria-label={`Playlist: ${pl.name}`}
              style={{
                width: 34, height: 34, borderRadius: 10, border: 'none',
                padding: 0, cursor: 'pointer', flexShrink: 0,
                background: 'transparent', overflow: 'hidden',
                outline: active ? '2px solid rgba(255,255,255,0.85)' : '2px solid transparent',
                outlineOffset: active ? 2 : 0,
                transition: 'outline-color 0.15s, transform 0.1s',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.transform = 'scale(1.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
              <PlaylistThumb playlist={pl} trackCovers={playlistCoverMap.get(pl.id) || []} size={34} />
            </button>
          );
        })}
      </div>

      {/* Bottom section — + New playlist button pinned */}
      {typeof onNewPlaylist === 'function' ? (
        <button
          type="button"
          onClick={onNewPlaylist}
          title="New playlist"
          aria-label="New playlist"
          style={{
            flexShrink: 0, marginTop: 4, marginBottom: 10,
            width: 34, height: 34, borderRadius: 10,
            border: '1px dashed rgba(255,255,255,0.2)', background: 'transparent',
            color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, lineHeight: 1, fontWeight: 300,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
            e.currentTarget.style.background = 'transparent';
          }}>
          +
        </button>
      ) : null}

      {/* Track count footer — only shown when no playlists (otherwise it's too cramped) */}
      {playlists.length === 0 && typeof onNewPlaylist !== 'function' ? (
        <div style={{
          marginTop: 'auto', marginBottom: 16,
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', fontWeight: 700,
          textTransform: 'uppercase',
        }}>
          {libraryCount} {libraryCount === 1 ? 'track' : 'tracks'}
        </div>
      ) : null}
    </div>
  );
}


function RailIcon({ children, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 34, height: 34, borderRadius: 10, border: 'none',
        background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.6)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

function LibraryTab({
  tracks,
  library,
  libraryCount,
  search,
  onSearchChange,
  currentTrack,
  isPlaying,
  selectedId,
  setSelectedId,
  hovered,
  setHovered,
  onPlayTrack,
  onPlayPauseTrack,
  onImportFiles,
  onImportFolder,
  importing,
  canRemove,
  onRemoveFromLibrary,
  canEdit,
  onEditTrack,
  canEditAlbum,
  onEditAlbum,
  canAddToPlaylist,
  onAddToPlaylist,
  onAddToQueue,
  onPlayNext,
  onToggleFavorite,
  onTrackContextMenu,
  // Playlists view
  playlists = [],
  playlistCoverMap = new Map(),
  onOpenPlaylist,
  onNewPlaylist,
  firstTimeSparkleEnabled = false,
  clickToFilterEnabled = false,
  onFilterByText,
  twoPaneEnabled = false,
  accent,
}) {
  const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const [view, setView] = useState('songs'); // 'songs' | 'albums'
  const [openAlbum, setOpenAlbum] = useState(null);

  // Album view layout: 'grid' (default 2-col grid) or 'stack' (Cover Flow
  // style horizontal browser). Persisted in localStorage so the choice
  // sticks across launches.
  const [albumViewMode, setAlbumViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'grid';
    return window.localStorage.getItem('immerse:albumViewMode') || 'grid';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('immerse:albumViewMode', albumViewMode);
    }
  }, [albumViewMode]);

  // Imperative scroll handle for the A-Z quick-jump rail. The
  // VirtualTrackList populates this with a `(index) => void` function
  // when it mounts; the rail calls it on letter-tap.
  const scrollToTrackIndexRef = useRef(null);

  // Two-pane mode — when enabled, the Songs view splits in half:
  // artists on the left, tracks of the selected artist on the right.
  // null means "show all" (no artist filter).
  const [twoPaneArtist, setTwoPaneArtist] = useState(null);
  /**
   * Sort mode for Songs view. Persisted to localStorage so the user's choice
   * survives restarts. Options: 'aToZ', 'zToA', 'recentlyAdded', 'oldestFirst',
   * 'recentlyPlayed', 'mostPlayed', 'longest', 'shortest', 'year', 'favorites'.
   */
  const [sortMode, setSortMode] = useState(() => {
    try {
      const v = window.localStorage?.getItem('studioPlayerSongSort');
      const valid = ['aToZ', 'zToA', 'recentlyAdded', 'oldestFirst', 'recentlyPlayed', 'mostPlayed', 'longest', 'shortest', 'year', 'favorites'];
      return valid.includes(v) ? v : 'aToZ';
    } catch { return 'aToZ'; }
  });
  useEffect(() => {
    try { window.localStorage?.setItem('studioPlayerSongSort', sortMode); } catch { /* ignore */ }
  }, [sortMode]);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // Apply current sort mode to incoming `tracks` (which is already search-filtered).
  const sortedTracks = useMemo(() => {
    const arr = [...tracks];
    const titleCmp = (a, b) => titleCollator.compare(String(a.title || ''), String(b.title || ''));
    switch (sortMode) {
      case 'zToA':
        arr.sort((a, b) => -titleCmp(a, b));
        break;
      case 'recentlyAdded':
        arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        break;
      case 'oldestFirst':
        arr.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        break;
      case 'recentlyPlayed':
        arr.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || titleCmp(a, b));
        break;
      case 'mostPlayed':
        arr.sort((a, b) => (b.playCount || 0) - (a.playCount || 0) || titleCmp(a, b));
        break;
      case 'longest':
        arr.sort((a, b) => (b.duration || 0) - (a.duration || 0) || titleCmp(a, b));
        break;
      case 'shortest':
        arr.sort((a, b) => (a.duration || 0) - (b.duration || 0) || titleCmp(a, b));
        break;
      case 'year':
        // Recent year first, then alphabetical
        arr.sort((a, b) => (b.year || 0) - (a.year || 0) || titleCmp(a, b));
        break;
      case 'favorites':
        // Favorites first, then alphabetical
        arr.sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || titleCmp(a, b));
        break;
      case 'aToZ':
      default:
        arr.sort(titleCmp);
        break;
    }
    return arr;
  }, [tracks, sortMode]);

  const alphaRailVisible = sortMode === 'aToZ' || sortMode === 'zToA';
  const alphaIndex = useMemo(() => {
    if (!alphaRailVisible) return null;
    const letters = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    const idx = new Map(letters.map((l) => [l, -1]));
    // Strip leading "The " (the universal alphabetization convention)
    // and any leading punctuation/whitespace before checking the first
    // character. So "The Beatles" buckets under "B" and "(The) Doors"
    // buckets under "D" — matching how a CD shelf is alphabetized.
    const firstLetterOf = (title) => {
      const t = String(title || '').replace(/^the\s+/i, '').replace(/^[\s\W_]+/, '');
      const c = t.charAt(0).toUpperCase();
      if (c >= 'A' && c <= 'Z') return c;
      return '#';
    };
    for (let i = 0; i < sortedTracks.length; i++) {
      const letter = firstLetterOf(sortedTracks[i].title);
      // Only set the FIRST occurrence; later tracks of the same letter
      // are skipped so the rail jumps to the top of each bucket.
      if (idx.get(letter) === -1) idx.set(letter, i);
    }
    return idx;
  }, [sortedTracks, alphaRailVisible]);

  // Two-pane artists list — distinct primary artist names from
  // `sortedTracks` with track counts. Sorted alphabetically (case-
  // insensitive) regardless of the song-sort mode, since the artist
  // pane is its own browse axis and shouldn't reflect song-sort.
  const twoPaneArtists = useMemo(() => {
    if (!twoPaneEnabled) return [];
    const counts = new Map();
    for (const t of sortedTracks) {
      const key = (t.artist || '').split(/[,&]/)[0].trim() || 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const list = Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
    list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return list;
  }, [sortedTracks, twoPaneEnabled]);

  // Filter sortedTracks down to just the selected artist's tracks. When
  // no artist is selected, falls back to the unfiltered list (so an
  // empty artist pane still shows everything on the right).
  const twoPaneFilteredTracks = useMemo(() => {
    if (!twoPaneEnabled || !twoPaneArtist) return sortedTracks;
    const target = twoPaneArtist.toLowerCase();
    return sortedTracks.filter((t) => {
      const primary = (t.artist || '').split(/[,&]/)[0].trim().toLowerCase();
      return primary === target;
    });
  }, [twoPaneEnabled, twoPaneArtist, sortedTracks]);

  // Reset selected artist if it disappears from the list (e.g. user
  // edits a track or deletes the artist's last track).
  useEffect(() => {
    if (!twoPaneEnabled || !twoPaneArtist) return;
    const exists = twoPaneArtists.some((a) => a.name === twoPaneArtist);
    if (!exists) setTwoPaneArtist(null);
  }, [twoPaneEnabled, twoPaneArtist, twoPaneArtists]);

  // Group the full library into albums with disc-aware structure
  const albums = useMemo(() => {
    // Extract the primary artist — everything before the first comma, feat., ft., &, or x
    const primaryArtist = (str) => {
      if (!str) return 'Unknown Artist';
      const clean = str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim();
      return clean || str.trim();
    };

    // Comparator: disc asc (null→1), track asc, then — if BOTH lack a track
    // number — fall back to the order tracks were added to the library. This
    // rescues albums that were imported in-order via batch download but whose
    // yt-dlp files don't carry track tags. Title is the final tiebreaker.
    const compareTracks = (a, b) => {
      const da = a.discNumber != null ? a.discNumber : 1;
      const db_ = b.discNumber != null ? b.discNumber : 1;
      if (da !== db_) return da - db_;
      const aHas = a.trackNumber != null;
      const bHas = b.trackNumber != null;
      if (aHas && bHas) {
        if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
      } else if (aHas !== bHas) {
        // A tagged track sorts before an untagged one (so a numbered track 1
        // doesn't get stranded below random alphabetically-first untagged tracks)
        return aHas ? -1 : 1;
      } else {
        // Neither has a track number — fall back to addedAt order
        const aa = Number(a.addedAt) || 0;
        const bb = Number(b.addedAt) || 0;
        if (aa !== bb) return aa - bb;
      }
      return titleCollator.compare(String(a.title || ''), String(b.title || ''));
    };

    const map = new Map();
    for (const t of library) {
      const albumName = (t.album || '').trim() || 'Unknown Album';
      const primary = primaryArtist(t.artist);
      const key = `${albumName}__${primary}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          album: albumName,
          artist: primary,
          coverArt: null,       // primary/fallback cover
          tracks: [],           // flat, sorted list
          discs: new Map(),     // discNum → { discNumber, coverArt, tracks }
        });
      }
      const entry = map.get(key);
      if (!entry.coverArt && t.coverArt) entry.coverArt = t.coverArt;
      entry.tracks.push(t);

      // Accumulate disc info
      const discNum = t.discNumber != null ? t.discNumber : 1;
      if (!entry.discs.has(discNum)) {
        entry.discs.set(discNum, { discNumber: discNum, coverArt: null, tracks: [] });
      }
      const disc = entry.discs.get(discNum);
      if (!disc.coverArt && t.coverArt) disc.coverArt = t.coverArt;
      disc.tracks.push(t);
    }

    for (const entry of map.values()) {
      entry.tracks.sort(compareTracks);
      for (const disc of entry.discs.values()) {
        disc.tracks.sort(compareTracks);
      }
      // Convert disc Map → sorted array
      entry.discs = [...entry.discs.values()].sort((a, b) => a.discNumber - b.discNumber);
      // Build a quick list of the unique cover arts across discs (for split visuals)
      entry.discCoverArts = entry.discs
        .map((d) => d.coverArt || entry.coverArt)
        .filter(Boolean);
      // Dedupe adjacent duplicates — if all discs share the same cover, only need one
      entry.discCoverArts = Array.from(new Set(entry.discCoverArts));
      entry.hasMultipleDiscs = entry.discs.length >= 2;
    }

    return [...map.values()]
      // Only show albums with 2+ tracks — singles stay in Songs view only
      .filter((a) => a.tracks.length >= 2)
      .sort((a, b) =>
        titleCollator.compare(a.album, b.album) || titleCollator.compare(a.artist, b.artist)
      );
  }, [library]);

  const filteredAlbums = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return albums;
    return albums.filter((a) =>
      a.album.toLowerCase().includes(q) ||
      a.artist.toLowerCase().includes(q) ||
      a.tracks.some((t) => t.title.toLowerCase().includes(q))
    );
  }, [albums, search]);

  const openAlbumData = useMemo(() => {
    if (!openAlbum) return null;
    return albums.find((a) => a.key === openAlbum) || null;
  }, [albums, openAlbum]);

  const openAlbumTracks = useMemo(() => {
    if (!openAlbumData) return [];
    const q = search.trim().toLowerCase();
    if (!q) return openAlbumData.tracks;
    return openAlbumData.tracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q));
  }, [openAlbumData, search]);

  useEffect(() => {
    if (openAlbum && !albums.find((a) => a.key === openAlbum)) setOpenAlbum(null);
  }, [albums, openAlbum]);

  return (
    <>
      <div style={{ padding: '10px 12px 8px', display: 'flex', gap: 6 }}>
        <button type="button" onClick={onImportFiles} disabled={importing}
          style={{ flex: 1, padding: '7px 10px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#e5e5e5', fontSize: 11.5, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }}>
          {importing ? 'Importing…' : '+ Files'}
        </button>
        {hasElectron ? (
          <button type="button" onClick={onImportFolder} disabled={importing}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#e5e5e5', fontSize: 11.5, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }}>
            + Folder
          </button>
        ) : null}
      </div>

      {libraryCount > 0 ? (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 3, background: 'rgba(255,255,255,0.04)', borderRadius: 9, padding: 3 }}>
            <button type="button" onClick={() => { setView('songs'); setOpenAlbum(null); }}
              style={{ flex: 1, padding: '5px 0', borderRadius: 7, border: 'none', background: view === 'songs' ? 'rgba(255,255,255,0.1)' : 'transparent', color: view === 'songs' ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
              Songs
            </button>
            <button type="button" onClick={() => { setView('albums'); setOpenAlbum(null); }}
              style={{ flex: 1, padding: '5px 0', borderRadius: 7, border: 'none', background: view === 'albums' ? 'rgba(255,255,255,0.1)' : 'transparent', color: view === 'albums' ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
              Albums
            </button>
            <button type="button" onClick={() => { setView('playlists'); setOpenAlbum(null); }}
              style={{ flex: 1, padding: '5px 0', borderRadius: 7, border: 'none', background: view === 'playlists' ? 'rgba(255,255,255,0.1)' : 'transparent', color: view === 'playlists' ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
              Playlists
            </button>
          </div>
          {view !== 'playlists' ? (
            <div style={{ display: 'flex', gap: 5, position: 'relative' }}>
              <input type="text" value={search} onChange={(e) => onSearchChange(e.target.value)}
                placeholder={view === 'albums' && openAlbumData ? `Search in ${openAlbumData.album}…` : 'Search…'}
                style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 11px', borderRadius: 9, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: 12, outline: 'none' }} />
            {view === 'songs' ? (
              <button type="button"
                onClick={() => setSortMenuOpen((v) => !v)}
                title={`Sort: ${SORT_LABELS[sortMode] || sortMode}`}
                aria-label="Sort songs"
                style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: 9,
                  background: sortMenuOpen ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { if (!sortMenuOpen) e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { if (!sortMenuOpen) e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M6 12h12M10 18h4" />
                </svg>
              </button>
            ) : null}
            {sortMenuOpen ? (
              <div
                onMouseLeave={() => setSortMenuOpen(false)}
                style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20,
                  minWidth: 180,
                  background: 'rgba(28, 28, 30, 0.96)',
                  backdropFilter: 'blur(20px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                  padding: 4,
                }}>
                {Object.entries(SORT_LABELS).map(([key, label]) => (
                  <button key={key}
                    type="button"
                    onClick={() => { setSortMode(key); setSortMenuOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 10px', borderRadius: 7, border: 'none',
                      background: sortMode === key ? `rgba(${accent},0.18)` : 'transparent',
                      color: sortMode === key ? '#fff' : 'rgba(255,255,255,0.78)',
                      fontSize: 11.5, fontWeight: sortMode === key ? 700 : 500,
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { if (sortMode !== key) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                    onMouseLeave={(e) => { if (sortMode !== key) e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{
                      width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      color: sortMode === key ? '#fff' : 'transparent',
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {libraryCount === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.6 }}>
            Your library is empty.<br />Import files or find music on Spotify.
          </div>
        ) : view === 'songs' ? (
          sortedTracks.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              No matches for "{search}"
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Two-pane mode adds an artists list on the LEFT. The
                  artist pane shows distinct primary artists from the
                  filtered library (after search), with track counts
                  per artist. Click an artist to filter the right pane;
                  click "All artists" to clear the filter. */}
              {twoPaneEnabled ? (
                <TwoPaneArtistList
                  artists={twoPaneArtists}
                  selected={twoPaneArtist}
                  onSelect={setTwoPaneArtist}
                  accent={accent}
                />
              ) : null}
              <VirtualTrackList
                tracks={twoPaneFilteredTracks}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                hovered={hovered}
                setHovered={setHovered}
                onPlayTrack={onPlayTrack}
                onPlayPauseTrack={onPlayPauseTrack}
                canEdit={canEdit}
                onEditTrack={onEditTrack}
                canRemove={canRemove}
                onRemoveFromLibrary={onRemoveFromLibrary}
                canAddToPlaylist={canAddToPlaylist}
                onAddToPlaylist={onAddToPlaylist}
                onAddToQueue={onAddToQueue}
                onPlayNext={onPlayNext}
                onToggleFavorite={onToggleFavorite}
                onTrackContextMenu={onTrackContextMenu}
                firstTimeSparkleEnabled={firstTimeSparkleEnabled}
                clickToFilterEnabled={clickToFilterEnabled}
                onFilterByText={onFilterByText}
                accent={accent}
                scrollToIndexRef={scrollToTrackIndexRef}
              />
              {/* A-Z rail — hidden in two-pane mode since the artist
                  list serves the same "browse by letter" function. */}
              {alphaRailVisible && alphaIndex && !twoPaneEnabled ? (
                <AlphaRail
                  alphaIndex={alphaIndex}
                  reverse={sortMode === 'zToA'}
                  onJump={(idx) => {
                    if (typeof scrollToTrackIndexRef.current === 'function') {
                      scrollToTrackIndexRef.current(idx);
                    }
                  }}
                  accent={accent}
                />
              ) : null}
            </div>
          )
        ) : view === 'playlists' ? (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 12px 12px', overscrollBehavior: 'contain' }}>
            {playlists.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 11, margin: '0 auto 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px dashed rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.5)',
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15V6" />
                    <path d="M21 6L9 8" />
                    <path d="M9 18V8" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="15" r="3" />
                  </svg>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
                  No playlists yet
                </div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 1.5, marginBottom: 14 }}>
                  Create one to organize tracks however you want.
                </div>
                {typeof onNewPlaylist === 'function' ? (
                  <button type="button" onClick={onNewPlaylist}
                    style={{
                      padding: '8px 16px', borderRadius: 9,
                      background: `rgba(${accent}, 0.4)`,
                      border: `1px solid rgba(${accent}, 0.55)`,
                      color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>
                    + New playlist
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                {/* New-playlist row pinned at the top */}
                {typeof onNewPlaylist === 'function' ? (
                  <button type="button" onClick={onNewPlaylist}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 8px', marginBottom: 4,
                      borderRadius: 9, border: 'none',
                      background: 'transparent', color: 'rgba(255,255,255,0.85)',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                      border: '1px dashed rgba(255,255,255,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'rgba(255,255,255,0.55)', fontSize: 18, lineHeight: 1, fontWeight: 300,
                    }}>+</div>
                    <div style={{ minWidth: 0, flex: 1, fontSize: 11.5, fontWeight: 600 }}>
                      New playlist…
                    </div>
                  </button>
                ) : null}
                {playlists.map((pl) => {
                  const trackCovers = playlistCoverMap.get(pl.id) || [];
                  const count = pl.trackIds?.length || 0;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => onOpenPlaylist?.(pl.id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 8px', marginBottom: 2,
                        borderRadius: 9, border: 'none',
                        background: 'transparent', color: '#fff',
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <PlaylistThumb playlist={pl} trackCovers={trackCovers} size={42} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.95)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          marginBottom: 1,
                        }}>
                          {pl.name || 'Untitled playlist'}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
                          {count === 0 ? 'Empty' : `${count} ${count === 1 ? 'track' : 'tracks'}`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        ) : openAlbumData ? (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '2px 6px 12px', overscrollBehavior: 'contain' }}>
            <AlbumDetailView
              album={openAlbumData}
              tracks={openAlbumTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              hovered={hovered}
              setHovered={setHovered}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              onBack={() => setOpenAlbum(null)}
              onPlayTrack={(track) => onPlayTrack(track, openAlbumData.tracks)}
              onPlayPauseTrack={(track) => onPlayPauseTrack(track, openAlbumData.tracks)}
              canRemove={canRemove}
              onRemoveFromLibrary={onRemoveFromLibrary}
              canEdit={canEdit}
              onEditTrack={onEditTrack}
              canEditAlbum={canEditAlbum}
              onEditAlbum={onEditAlbum}
              canAddToPlaylist={canAddToPlaylist}
              onAddToPlaylist={onAddToPlaylist}
              onTrackContextMenu={onTrackContextMenu}
              accent={accent}
            />
          </div>
        ) : (
          <div style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px 6px 12px',
            overscrollBehavior: 'contain',
            // Reserve scrollbar gutter at all times so the grid's available
            // width is constant regardless of whether content overflows.
            // Without this, hovering a card can trigger a tiny layout shift
            // (the play-overlay/transition pushes a 1px change in total
            // height, which can cross the scrollbar threshold, which changes
            // available width, which makes the grid reflow — making every
            // card subtly resize). `scrollbar-gutter: stable` is the
            // modern, browser-managed way to handle this.
            scrollbarGutter: 'stable',
          }}>
            {filteredAlbums.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                No albums match "{search}"
              </div>
            ) : (
              <>
                {/* View toggle: aligned right so it doesn't crowd the album grid. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px 8px' }}>
                  <AlbumViewToggle mode={albumViewMode} onChange={setAlbumViewMode} />
                </div>
                {albumViewMode === 'stack' ? (
                  <AlbumStackView
                    albums={filteredAlbums}
                    currentTrack={currentTrack}
                    onOpenAlbum={(key) => setOpenAlbum(key)}
                    onPlayAlbum={(albumEntry) => onPlayTrack(albumEntry.tracks[0], albumEntry.tracks)}
                    accent={accent}
                  />
                ) : (
                  <AlbumGridView
                    albums={filteredAlbums}
                    currentTrack={currentTrack}
                    onOpenAlbum={(key) => setOpenAlbum(key)}
                    onPlayAlbum={(albumEntry) => onPlayTrack(albumEntry.tracks[0], albumEntry.tracks)}
                    accent={accent}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}


/**
 * Render an album cover. When a multi-disc album has two (or more) distinct
 * cover images, shows them split along a diagonal — top-left = first disc,
 * bottom-right = second disc — with a thin divider line for definition.
 * Falls back to a single image otherwise.
 */
/**
 * VirtualTrackList — renders only the rows currently visible in the scroll
 * window, plus a small overscan. Handles libraries of any size without DOM
 * bloat. Each row is a fixed ROW_H pixels tall so we can calculate positions
 * arithmetically with no layout queries.
 */
const ROW_H = 48; // px — must match the rendered row height (6px pad top + 36px content + 6px pad bottom)
const OVERSCAN = 5; // extra rows above and below the visible window

/**
 * FilterableText — inline span that renders text and, on click, calls
 * `onFilter(text)`. Visually distinct from plain text (cursor pointer,
 * underline-on-hover, brighter colour on hover) so the user knows it's
 * interactive. Always stops click propagation so the parent row's onClick
 * doesn't also fire (which would mark the row as selected and play it).
 *
 * The component takes only the bare minimum styling to integrate — the
 * parent's font-size / colour cascade through normally. Hover effects use
 * local React state so each instance is independent.
 */
function FilterableText({ text, title, onFilter }) {
  const [hovered, setHovered] = useState(false);
  if (!text) return null;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onFilter?.(text);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onFilter?.(text);
        }
      }}
      style={{
        cursor: 'pointer',
        // Brighten on hover — using `inherit` baseline lets parent contexts
        // (e.g. the artist line at 0.5 opacity) drive resting colour while
        // hover gives a clear "now you can click me" signal.
        color: hovered ? 'rgba(255,255,255,0.95)' : 'inherit',
        textDecoration: hovered ? 'underline' : 'none',
        textUnderlineOffset: 2,
        transition: 'color 0.12s',
      }}
    >
      {text}
    </span>
  );
}


/* =========================================================================
 *  TwoPaneArtistList — left pane in the two-pane library view. Lists
 *  distinct primary artists with track counts; clicking one filters the
 *  right pane to that artist's tracks. A pinned "All artists" row at
 *  the top clears the filter.
 * ========================================================================= */
function TwoPaneArtistList({ artists = [], selected, onSelect, accent }) {
  return (
    <div style={{
      flexShrink: 0,
      width: 180,
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.05)',
      overflowY: 'auto', overflowX: 'hidden',
      overscrollBehavior: 'contain',
      padding: '4px 6px 12px',
    }}>
      <ArtistListRow
        label="All artists"
        count={artists.reduce((sum, a) => sum + a.count, 0)}
        active={selected == null}
        accent={accent}
        onClick={() => onSelect?.(null)}
        muted
      />
      {artists.map((a) => (
        <ArtistListRow
          key={a.name}
          label={a.name}
          count={a.count}
          active={selected === a.name}
          accent={accent}
          onClick={() => onSelect?.(a.name)}
        />
      ))}
    </div>
  );
}

function ArtistListRow({ label, count, active, accent, onClick, muted }) {
  const [hov, setHov] = useState(false);
  const bg = active
    ? `rgba(${accent}, 0.22)`
    : hov ? 'rgba(255,255,255,0.05)' : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '6px 8px', borderRadius: 6,
        background: bg, border: 'none',
        color: active ? '#fff' : 'rgba(255,255,255,0.78)',
        cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.12s',
        flexShrink: 0,
      }}
    >
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 11.5, fontWeight: active ? 700 : 500,
        fontStyle: muted ? 'italic' : 'normal',
        color: muted && !active ? 'rgba(255,255,255,0.55)' : undefined,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <span style={{
        flexShrink: 0,
        fontSize: 9.5, color: 'rgba(255,255,255,0.4)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {count}
      </span>
    </button>
  );
}


/* =========================================================================
 *  AlphaRail — vertical A-Z (or Z-A) letter rail floating on the right
 *  edge of the library list. Tap a letter to scroll the matching track
 *  into view at the top.
 *
 *  Letters with no tracks of that letter (alphaIndex value of -1) are
 *  rendered dimmed and untappable. Letters that have tracks are tappable;
 *  a hover state highlights them with the accent colour.
 *
 *  Drag-scrubbing: holding mousedown and dragging up/down across the rail
 *  jumps to whichever letter the cursor is currently over. Many users
 *  expect this from iOS/iTunes' alphabetic sidebars, where the affordance
 *  is "scrub through the alphabet."
 *
 *  Compact 18px wide; the letters are tiny but legible at the small font.
 *  No labels or captions — the alphabet is universal so no chrome needed.
 * ========================================================================= */
function AlphaRail({ alphaIndex, reverse = false, onJump, accent }) {
  // Letter list. Reversed for Z-A so the visual order matches the sort.
  const letters = useMemo(() => {
    const base = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    return reverse ? [...base].reverse() : base;
  }, [reverse]);

  const [activeLetter, setActiveLetter] = useState(null);
  const railRef = useRef(null);

  // Resolve the letter under a given clientY by walking the rail's
  // children. Used for both click and drag-scrub. We cache the
  // children list per drag to avoid querying on every mousemove —
  // the rail is short (27 cells) so this is cheap.
  const letterAtY = (clientY) => {
    const rail = railRef.current;
    if (!rail) return null;
    const cells = rail.querySelectorAll('[data-alpha]');
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return cell.getAttribute('data-alpha');
      }
    }
    return null;
  };

  // Trigger jump for a letter, but only if that letter has tracks.
  const tryJump = (letter) => {
    if (!letter) return;
    const idx = alphaIndex.get(letter);
    if (idx == null || idx < 0) return;
    setActiveLetter(letter);
    if (typeof onJump === 'function') onJump(idx);
  };

  // Drag-scrub. Mouse-down on the rail (anywhere) starts a scrub
  // session that follows the cursor until mouse-up. Each unique
  // letter under the cursor triggers a fresh jump.
  const handleMouseDown = (e) => {
    e.preventDefault();
    const initial = letterAtY(e.clientY);
    if (initial) tryJump(initial);
    let last = initial;
    const onMove = (ev) => {
      const l = letterAtY(ev.clientY);
      if (l && l !== last) {
        last = l;
        tryJump(l);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Clear active highlight after a brief moment so the user sees
      // where they landed before it fades.
      setTimeout(() => setActiveLetter(null), 400);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={railRef}
      onMouseDown={handleMouseDown}
      style={{
        flexShrink: 0,
        width: 18,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-around',
        padding: '6px 0',
        userSelect: 'none',
        // Subtle left-edge separator so the rail reads as a distinct
        // affordance rather than running into the track rows.
        borderLeft: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {letters.map((letter) => {
        const idx = alphaIndex.get(letter);
        const empty = idx == null || idx < 0;
        const isActive = activeLetter === letter;
        return (
          <div
            key={letter}
            data-alpha={letter}
            style={{
              flex: 1, minHeight: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em',
              color: isActive
                ? `rgba(${accent}, 1)`
                : empty
                  ? 'rgba(255,255,255,0.15)'
                  : 'rgba(255,255,255,0.5)',
              cursor: empty ? 'default' : 'pointer',
              transition: 'color 0.12s',
              // No hover state inline; we rely on activeLetter for visual
              // feedback during drag. Hover is implicit via the cursor.
            }}
          >
            {letter}
          </div>
        );
      })}
    </div>
  );
}


function VirtualTrackList({
  tracks,
  currentTrack,
  isPlaying,
  selectedId,
  setSelectedId,
  hovered,
  setHovered,
  onPlayTrack,
  onPlayPauseTrack,
  canEdit,
  onEditTrack,
  canRemove,
  onRemoveFromLibrary,
  canAddToPlaylist,
  onAddToPlaylist,
  onAddToQueue,
  onPlayNext,
  onToggleFavorite,
  onTrackContextMenu,
  firstTimeSparkleEnabled = false,
  clickToFilterEnabled = false,
  onFilterByText,
  accent,
  // Optional ref the parent can populate with a scroll-to-index function.
  // Used by the A-Z quick-jump rail to jump to the first track of a given
  // letter. We expose this via a mutable ref rather than imperative
  // handles to keep the component a plain function.
  scrollToIndexRef,
}) {
  const outerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  // Sync scroll position
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(el.scrollTop);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Sync container height via ResizeObserver
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setViewHeight(e.contentRect.height);
      }
    });
    ro.observe(el);
    setViewHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Expose imperative scroll-to-index for the A-Z rail. Lives in a single
  // effect so the function is rebuilt only when row height could change
  // (which it doesn't — but keep the dep array honest). The rail calls
  // this when the user taps a letter; it scrolls the target row to ~24px
  // below the top of the viewport so it's clearly the "first match."
  useEffect(() => {
    if (!scrollToIndexRef) return undefined;
    scrollToIndexRef.current = (idx) => {
      const el = outerRef.current;
      if (!el || !Number.isInteger(idx) || idx < 0) return;
      const target = Math.max(0, idx * ROW_H - 24);
      // Use the browser's smooth scroll — short hops feel fine, long
      // hops complete in ~300ms which is fast enough that the user
      // doesn't lose the "I tapped a letter" cause-and-effect.
      el.scrollTo({ top: target, behavior: 'smooth' });
    };
    return () => {
      // Don't null the ref out unconditionally — another instance might
      // have populated it. Only clear if we still own it.
      if (scrollToIndexRef.current && scrollToIndexRef.current.__owner === outerRef) {
        scrollToIndexRef.current = null;
      }
    };
  }, [scrollToIndexRef]);

  // Scroll the current track into view when it changes — uses a slow ease
  // so large jumps don't feel hectic
  const scrollAnimRef = useRef(null);
  useEffect(() => {
    if (!currentTrack || !outerRef.current) return;
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return;
    const el = outerRef.current;
    const rowTop = idx * ROW_H;
    const rowBot = rowTop + ROW_H;
    if (rowTop >= el.scrollTop && rowBot <= el.scrollTop + el.clientHeight) return; // already visible

    const target = Math.max(0, rowTop - el.clientHeight / 2 + ROW_H / 2);
    const start = el.scrollTop;
    const distance = target - start;
    if (Math.abs(distance) < 2) return;

    const DURATION = 600; // ms — slow enough to feel calm over any distance
    const startTime = performance.now();

    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);
      // Ease-out cubic — decelerates to a stop, no bounce
      const eased = 1 - Math.pow(1 - progress, 3);
      el.scrollTop = start + distance * eased;
      if (progress < 1) {
        scrollAnimRef.current = requestAnimationFrame(step);
      }
    };
    scrollAnimRef.current = requestAnimationFrame(step);

    return () => {
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    };
  }, [currentTrack?.id, tracks]);

  const totalHeight = tracks.length * ROW_H;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const lastVisible = Math.min(tracks.length - 1, Math.ceil((scrollTop + viewHeight) / ROW_H) + OVERSCAN);
  const visibleTracks = tracks.slice(firstVisible, lastVisible + 1);
  const paddingTop = firstVisible * ROW_H;
  const paddingBot = Math.max(0, (tracks.length - lastVisible - 1) * ROW_H);

  return (
    <div
      ref={outerRef}
      style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '2px 6px 12px' }}
    >
      {/* Keyframes for the first-time-hearing sparkle. Mounted once at the
          list root so all rows share the same animation. */}
      <style>{`
        @keyframes immerseFirstTimeSparkle {
          0%, 100% { opacity: 0.55; transform: scale(0.85); }
          50%      { opacity: 1.0;  transform: scale(1.15); }
        }
      `}</style>
      {/* Top spacer — represents rows above the visible window */}
      {paddingTop > 0 && <div style={{ height: paddingTop }} />}

      {visibleTracks.map((track) => {
        const i = tracks.indexOf(track);
        const isCur = currentTrack?.id === track.id;
        const isSel = selectedId === track.id;
        const isHov = hovered === track.id;
        return (
          <div key={track.id}
            onMouseEnter={() => setHovered(track.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setSelectedId(track.id)}
            onDoubleClick={() => onPlayTrack(track)}
            onContextMenu={onTrackContextMenu ? (e) => onTrackContextMenu(e, track) : undefined}
            style={{
              display: 'grid', gridTemplateColumns: '22px 36px 1fr auto',
              alignItems: 'center', gap: 10,
              padding: '6px 8px', cursor: 'pointer', borderRadius: 9,
              height: ROW_H, boxSizing: 'border-box',
              background: isCur ? `rgba(${accent},0.24)` : isSel ? 'rgba(255,255,255,0.05)' : isHov ? 'rgba(255,255,255,0.035)' : 'transparent',
            }}>
            {/* Index / play button */}
            <div style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isCur ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {(isHov || isCur) ? (
                <button type="button" title={isCur && isPlaying ? 'Pause' : 'Play'}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); (onPlayPauseTrack || onPlayTrack)(track); }}
                  style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ transform: 'scale(0.72)' }}>{isCur && isPlaying ? <Icons.Pause /> : <Icons.Play />}</span>
                </button>
              ) : String(i + 1).padStart(2, '0')}
            </div>
            {/* Cover art */}
            <div style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a', flexShrink: 0 }}>
              {track.coverArt
                ? <img src={track.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" decoding="async" />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}><Icons.AlbumSidebar /></div>}
            </div>
            {/* Title + artist */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: isCur ? '#fff' : 'rgba(255,255,255,0.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* First-time-hearing sparkle — small pulsing dot for tracks
                    that have never been played (playCount === 0). Helps
                    unheard music feel discoverable in big libraries. The
                    dot disappears the moment playCount goes above 0 (which
                    happens once playback crosses the scrobble threshold). */}
                {firstTimeSparkleEnabled && !((Number(track.playCount) || 0) > 0) ? (
                  <span
                    aria-label="First time hearing"
                    title="First time hearing this"
                    style={{
                      flexShrink: 0,
                      width: 6, height: 6, borderRadius: '50%',
                      background: `rgb(${accent})`,
                      boxShadow: `0 0 8px rgba(${accent}, 0.7)`,
                      animation: 'immerseFirstTimeSparkle 2s ease-in-out infinite',
                    }}
                  />
                ) : null}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title || 'Untitled'}</span>
                {track.explicit === 1 ? <ExplicitBadge /> : null}
                {/* Favorite indicator — when the hover action buttons are
                    suppressed (right-click menu mode), favorited tracks
                    still need a visible indicator. Tiny non-interactive
                    heart inline with the title. */}
                {track.isFavorite && onTrackContextMenu ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#f37272" aria-hidden style={{ flexShrink: 0 }}>
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                ) : null}
              </div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {clickToFilterEnabled && (track.artist || '').trim() ? (
                  <FilterableText
                    text={track.artist}
                    title={`Filter library by ${track.artist}`}
                    onFilter={onFilterByText}
                  />
                ) : (track.artist || '—')}
              </div>
            </div>
            {/* Actions — show on hover OR when favorited (so heart is always
                visible for favorites). Suppressed entirely when right-click
                context menus are enabled — the menu has all the same actions
                so the hover buttons would be redundant clutter. */}
            {(isHov || track.isFavorite) && !onTrackContextMenu && (canEdit || canRemove || canAddToPlaylist || onToggleFavorite) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                {onToggleFavorite ? (
                  <button type="button" title={track.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(track.id); }}
                    style={{
                      width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent',
                      color: track.isFavorite ? '#f37272' : 'rgba(255,255,255,0.55)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}
                    onMouseEnter={(e) => { if (!track.isFavorite) { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; } }}
                    onMouseLeave={(e) => { if (!track.isFavorite) { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; } }}>
                    <svg width="13" height="13" viewBox="0 0 24 24"
                      fill={track.isFavorite ? 'currentColor' : 'none'}
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>
                ) : null}
                {isHov && typeof onAddToQueue === 'function' ? (
                  <button type="button" title="Add to queue"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onAddToQueue(track); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="3" y1="6" x2="16" y2="6" />
                      <line x1="3" y1="12" x2="16" y2="12" />
                      <line x1="3" y1="18" x2="11" y2="18" />
                      <line x1="19" y1="15" x2="19" y2="21" />
                      <line x1="16" y1="18" x2="22" y2="18" />
                    </svg>
                  </button>
                ) : null}
                {isHov && canAddToPlaylist ? (
                  <button type="button" title="Add to playlist"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onAddToPlaylist([track.id], e.currentTarget); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1, fontWeight: 300, padding: 0 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    +
                  </button>
                ) : null}
                {isHov && canEdit ? (
                  <button type="button" title="Edit metadata"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onEditTrack(track.id); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ transform: 'scale(0.8)' }}><Icons.Edit /></span>
                  </button>
                ) : null}
                {isHov && canRemove ? (
                  <button type="button" title="Remove from library"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveFromLibrary([track.id]); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ transform: 'scale(0.85)' }}><Icons.Trash /></span>
                  </button>
                ) : null}
              </div>
            ) : (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, paddingRight: 4 }}>
                {track.duration ? formatTime(track.duration) : ''}
              </span>
            )}
          </div>
        );
      })}

      {/* Bottom spacer — represents rows below the visible window */}
      {paddingBot > 0 && <div style={{ height: paddingBot }} />}
    </div>
  );
}


function AlbumCover({ album, showDiscBadge = true }) {
  const hasMulti = album.hasMultipleDiscs && album.discCoverArts?.length >= 2;

  if (!hasMulti) {
    if (!album.coverArt) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
        </div>
      );
    }
    return <img src={album.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} decoding="async" />;
  }

  const [coverA, coverB] = album.discCoverArts;
  // Unique clip id so multiple SplitDiscCover instances don't collide
  const clipId = `disc-split-${album.key.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {/* Top-left triangle (disc 1) */}
        <clipPath id={`${clipId}-a`}>
          <polygon points="0,0 100,0 0,100" />
        </clipPath>
        {/* Bottom-right triangle (disc 2) */}
        <clipPath id={`${clipId}-b`}>
          <polygon points="100,0 100,100 0,100" />
        </clipPath>
      </defs>

      {/* Neutral background in case images are slow to load */}
      <rect x="0" y="0" width="100" height="100" fill="#111" />

      {/* Disc 1 — top-left triangle */}
      <image href={coverA} x="0" y="0" width="100" height="100"
        preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId}-a)`} />

      {/* Disc 2 — bottom-right triangle */}
      <image href={coverB} x="0" y="0" width="100" height="100"
        preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId}-b)`} />

      {/* Thin diagonal divider */}
      <line x1="100" y1="0" x2="0" y2="100"
        stroke="rgba(255,255,255,0.9)" strokeWidth="0.7" />
    </svg>
  );
}


function AlbumGridView({ albums, currentTrack, onOpenAlbum, onPlayAlbum, accent }) {
  const [hovAlbum, setHovAlbum] = useState(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '2px 4px 8px' }}>
      {albums.map((album) => {
        const isHov = hovAlbum === album.key;
        const isActive = album.tracks.some((t) => t.id === currentTrack?.id);
        return (
          <div key={album.key}
            onMouseEnter={() => setHovAlbum(album.key)}
            onMouseLeave={() => setHovAlbum(null)}
            onClick={() => onOpenAlbum(album.key)}
            style={{
              borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
              background: isHov ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
              // The "border" is rendered as an inset box-shadow so it doesn't
              // occupy layout space. A real 1px border would change the box's
              // outer size when its color changes, causing a tiny but visible
              // pulse on hover and on active-state toggle. box-shadow is paint-
              // only — zero layout impact, zero pulse.
              boxShadow: `inset 0 0 0 1px ${isActive ? `rgba(${accent},0.35)` : 'rgba(255,255,255,0.06)'}`,
              // Only transition the properties we actually change here:
              // background and box-shadow. Avoiding `transition: all` keeps
              // any layout-influencing property (border, margin, padding,
              // size) from getting unintended animations.
              transition: 'background 0.15s, box-shadow 0.15s',
              position: 'relative',
            }}>
            {/* Cover art */}
            <div style={{ width: '100%', aspectRatio: '1', background: '#111', position: 'relative' }}>
              <AlbumCover album={album} />
              {/* Play overlay on hover */}
              {isHov ? (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); onPlayAlbum(album); }}
                    title="Play album"
                    style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)', color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                </div>
              ) : null}
              {/* Now playing dot */}
              {isActive ? (
                <div style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: `rgb(${accent})`, boxShadow: `0 0 6px rgba(${accent},0.8)` }} />
              ) : null}
            </div>
            {/* Info */}
            <div style={{ padding: '8px 8px 9px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: isActive ? '#fff' : 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                {album.album}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {album.artist}
              </div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                {album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * AlbumStackView — Cover Flow–style horizontal album browser.
 *
 * Drop-in alternative to AlbumGridView. Albums fan out around a focused
 * center card; flanking cards scale + rotate away in 3D, fading toward
 * the edges. Click a side card to focus it; click the center card to
 * open the album (matches grid behavior). Scroll-wheel or trackpad
 * horizontal scroll flips through the stack.
 *
 * Why this exists alongside the grid:
 *   - Grid is good for scanning by name.
 *   - Stack is good for flipping by feel — your eye catches a cover
 *     you'd forgotten and you stop. Matches the way people flipped
 *     through a CD wallet or record bin.
 *
 * Performance notes:
 *   - Only cards within ±STACK_RENDER_RADIUS of the focused index are
 *     rendered. A 500-album library renders ~9 DOM nodes at a time
 *     instead of 500.
 *   - All movement is GPU transforms (translate3d / rotateY / scale),
 *     not layout properties — keeps animation off the main thread.
 */

// How many cards on each side of the focused card stay rendered. 4 looks
// best — enough to give depth but not so many that distant cards become
// muddy. Cards beyond this fade to opacity 0 anyway.
const STACK_RENDER_RADIUS = 4;

// Card size is computed dynamically from the container width to handle
// the resizable dock panel (default 340px but user-adjustable). The
// proportions stay constant: the focused card takes ~75% of the
// container width, the gap between adjacent cards' centers is ~38%.
// Hard floor of 140px keeps it usable on the narrowest panels.
function computeStackMetrics(containerWidth) {
  const cardSize = Math.max(140, Math.min(320, Math.round(containerWidth * 0.75)));
  const cardGap = Math.round(cardSize * 0.5);
  return { cardSize, cardGap };
}

function AlbumStackView({ albums, currentTrack, onOpenAlbum, onPlayAlbum, accent }) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [hovCenter, setHovCenter] = useState(false);
  const containerRef = useRef(null);
  // Separate ref for width measurement — points at a stable wrapper
  // whose dimensions are determined by the parent layout, NOT by the
  // cards inside it. If we observe the same element that holds the
  // cards, changing the card size changes the container's height,
  // which fires the observer again, which changes the card size, and
  // so on — a visible "pulsing" feedback loop. Anchoring to a parent
  // breaks the cycle.
  const measureRef = useRef(null);

  // Measure the wrapper width with ResizeObserver so the stack scales
  // smoothly when the user resizes the dock panel. We compare against
  // the previous width and only update state if the change is ≥4px —
  // this prevents subpixel rounding from triggering re-renders in a
  // tight loop, and ignores height changes entirely (the observer
  // fires on any contentRect change, not just the dimension we care
  // about). Default 320 covers the first paint before the observer
  // has fired.
  const [containerWidth, setContainerWidth] = useState(320);
  const lastWidthRef = useRef(320);
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return undefined;
    const update = () => {
      const w = el.clientWidth || 320;
      if (Math.abs(w - lastWidthRef.current) >= 4) {
        lastWidthRef.current = w;
        setContainerWidth(w);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cardSize: STACK_CARD_SIZE, cardGap: STACK_CARD_GAP } = computeStackMetrics(containerWidth);

  // Keep focusedIndex valid if the underlying albums list changes
  // (search filter, sort order swap, library refresh).
  useEffect(() => {
    if (focusedIndex >= albums.length) {
      setFocusedIndex(Math.max(0, albums.length - 1));
    }
  }, [albums.length, focusedIndex]);

  const flip = useCallback((delta) => {
    setFocusedIndex((i) => {
      const next = i + delta;
      if (next < 0) return 0;
      if (next >= albums.length) return albums.length - 1;
      return next;
    });
  }, [albums.length]);

  // Wheel handler: map both vertical and horizontal wheel/trackpad motion
  // onto stack movement. Most users have vertical-only wheels, so we
  // accept either axis. Debounced via lastWheelTs so a single trackpad
  // swipe doesn't fly through 20 albums.
  const lastWheelTsRef = useRef(0);
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelTsRef.current < 90) return; // ~11 flips/sec ceiling
    lastWheelTsRef.current = now;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (d > 0) flip(1);
    else if (d < 0) flip(-1);
  }, [flip]);

  // Attach a non-passive wheel listener so we can preventDefault.
  // React's synthetic onWheel is passive by default in newer versions
  // and won't honor preventDefault — without this, vertical scrolls
  // would scroll the parent container instead of flipping cards.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const renderCard = (album, index) => {
    const offset = index - focusedIndex;
    const abs = Math.abs(offset);
    if (abs > STACK_RENDER_RADIUS) return null;

    const isCenter = offset === 0;
    const isActive = album.tracks.some((t) => t.id === currentTrack?.id);

    const x = Math.sign(offset) * (STACK_CARD_GAP * abs * 0.9);
    const scale = isCenter ? 1 : Math.max(0.5, 0.82 - abs * 0.05);
    const rotY = isCenter ? 0 : -Math.sign(offset) * Math.min(45, 22 + abs * 4);
    const opacity = isCenter ? 1 : Math.max(0, 0.85 - abs * 0.18);
    const z = STACK_RENDER_RADIUS - abs + 10;

    const transform = `
      translate3d(${x}px, 0, ${isCenter ? 0 : -abs * 40}px)
      rotateY(${rotY}deg)
      scale(${scale})
    `;

    const handleClick = () => {
      if (isCenter) onOpenAlbum(album.key);
      else setFocusedIndex(index);
    };

    return (
      <div
        key={album.key}
        onClick={handleClick}
        onMouseEnter={isCenter ? () => setHovCenter(true) : undefined}
        onMouseLeave={isCenter ? () => setHovCenter(false) : undefined}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: STACK_CARD_SIZE,
          height: STACK_CARD_SIZE,
          marginLeft: -STACK_CARD_SIZE / 2,
          marginTop: -STACK_CARD_SIZE / 2,
          transform,
          transformStyle: 'preserve-3d',
          opacity,
          zIndex: z,
          cursor: 'pointer',
          transition: 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 320ms ease',
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 12,
            overflow: 'hidden',
            background: '#111',
            border: `1px solid ${isActive ? `rgba(${accent},0.5)` : 'rgba(255,255,255,0.08)'}`,
            boxShadow: isCenter
              ? `0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), 0 0 60px rgba(${accent},0.2)`
              : '0 16px 40px rgba(0,0,0,0.5)',
            position: 'relative',
          }}
        >
          <AlbumCover album={album} />

          {isActive && (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              width: 10, height: 10, borderRadius: '50%',
              background: `rgb(${accent})`,
              boxShadow: `0 0 10px rgba(${accent},0.9)`,
            }} />
          )}

          {isCenter && hovCenter && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 12,
            }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPlayAlbum(album); }}
                title="Play album"
                style={{
                  width: 56, height: 56, borderRadius: '50%', border: 'none',
                  background: 'rgba(255,255,255,0.95)', color: '#000',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (albums.length === 0) {
    return (
      <div style={{
        padding: '40px 16px', textAlign: 'center',
        color: 'rgba(255,255,255,0.45)', fontSize: 12,
      }}>
        No albums to display
      </div>
    );
  }

  const focusedAlbum = albums[focusedIndex];

  return (
    <div
      ref={measureRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        paddingTop: 12,
      }}
    >
      {/* The 3D stage. perspective gives rotateY meaningful depth. */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: STACK_CARD_SIZE + 60,
          perspective: 1100,
          // Clip cards to the container edges. With responsive sizing the
          // side cards will mostly fit, but in narrow panels they can still
          // extend slightly beyond the edge — hidden overflow keeps the
          // layout tidy and prevents horizontal scrollbars from appearing.
          overflow: 'hidden',
        }}
      >
        {albums.map((album, i) => renderCard(album, i))}
      </div>

      {/* Label strip below the stack. key={focusedAlbum.key} triggers
         a fresh fade-in animation when the focus changes. */}
      <div style={{
        marginTop: 18,
        textAlign: 'center',
        minHeight: 60,
        pointerEvents: 'none',
      }}>
        <div key={focusedAlbum.key} style={{
          animation: 'albumStackLabelFade 240ms ease',
        }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: '#fff',
            letterSpacing: 0.2,
          }}>
            {focusedAlbum.album}
          </div>
          <div style={{
            fontSize: 12, color: 'rgba(255,255,255,0.55)',
            marginTop: 4,
          }}>
            {focusedAlbum.artist}
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>
              {' · '}
              {focusedAlbum.tracks.length} {focusedAlbum.tracks.length === 1 ? 'track' : 'tracks'}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom nav buttons — discoverable affordance for users who
         don't think to scroll. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginTop: 8, pointerEvents: 'auto',
      }}>
        <button
          type="button"
          onClick={() => flip(-1)}
          disabled={focusedIndex === 0}
          aria-label="Previous album"
          style={stackNavBtnStyle(focusedIndex === 0)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
          </svg>
        </button>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.45)',
          fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'center',
        }}>
          {focusedIndex + 1} / {albums.length}
        </div>
        <button
          type="button"
          onClick={() => flip(1)}
          disabled={focusedIndex >= albums.length - 1}
          aria-label="Next album"
          style={stackNavBtnStyle(focusedIndex >= albums.length - 1)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes albumStackLabelFade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function stackNavBtnStyle(disabled) {
  return {
    width: 32, height: 32, borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s',
  };
}

/** Two-button cluster — Grid / Stack. Sits above the album list. */
/**
 * AlbumViewToggle — segmented control for switching between grid and stack
 * album views. The inner button component is defined OUTSIDE the parent so
 * it has a stable identity across renders; if it were inline, every render
 * would create a new component reference, causing React to unmount and
 * remount the DOM button on each render. When that unmount happened
 * between a mousedown and the matching mouseup, the browser would never
 * fire the click event (clicks require both events on the same node), so
 * users would have to land a perfectly-still click on the element to make
 * it register. Hoisting Btn fixes that class of "only the center works"
 * bugs entirely.
 *
 * We also dispatch on `onMouseDown` rather than `onClick`. A mousedown
 * fires immediately as the pointer goes down, before any state churn that
 * a parent might cause, so even if the button remounts a moment later the
 * action has already been committed.
 */
function AlbumViewToggleBtn({ value, label, icon, active, onActivate }) {
  // Use onMouseDown for instant activation; onClick still fires for
  // keyboard / accessibility paths. Suppress the synthesized click that
  // follows mousedown so we don't double-fire onActivate.
  const handledRef = useRef(false);
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Only left-button activations.
        if (e.button !== 0) return;
        handledRef.current = true;
        onActivate(value);
      }}
      onClick={() => {
        if (handledRef.current) { handledRef.current = false; return; }
        onActivate(value);
      }}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: 28, height: 24, borderRadius: 6, border: 'none',
        background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {icon}
    </button>
  );
}

function AlbumViewToggle({ mode, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2, padding: 2,
      background: 'rgba(255,255,255,0.04)', borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <AlbumViewToggleBtn
        value="grid"
        label="Grid view"
        active={mode === 'grid'}
        onActivate={onChange}
        icon={
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
          </svg>
        }
      />
      <AlbumViewToggleBtn
        value="stack"
        label="Stack view"
        active={mode === 'stack'}
        onActivate={onChange}
        icon={
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="6" width="10" height="12" rx="1.5" opacity="0.4" />
            <rect x="7" y="5" width="10" height="14" rx="1.5" opacity="0.7" />
            <rect x="11" y="4" width="10" height="16" rx="1.5" />
          </svg>
        }
      />
    </div>
  );
}

function AlbumDetailView({ album, tracks, currentTrack, isPlaying, hovered, setHovered, selectedId, setSelectedId, onBack, onPlayTrack, onPlayPauseTrack, canRemove, onRemoveFromLibrary, canEdit, onEditTrack, canEditAlbum, onEditAlbum, canAddToPlaylist, onAddToPlaylist, onTrackContextMenu, accent }) {
  const totalDuration = album.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const formatAlbumDuration = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h} hr ${m} min`;
    return m > 0 ? `${m} min` : '< 1 min';
  };

  // When search is filtering tracks, we only show the filtered subset.
  // Otherwise we use the full album structure (so discs are visible).
  const searchActive = tracks.length !== album.tracks.length;

  // Renders a single row — reused across flat and disc-grouped layouts.
  const renderTrackRow = (track, displayIndex) => {
    const isCur = currentTrack?.id === track.id;
    const isSel = selectedId === track.id;
    const isHov = hovered === track.id;
    return (
      <div key={track.id}
        onMouseEnter={() => setHovered(track.id)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => setSelectedId(track.id)}
        onDoubleClick={() => onPlayTrack(track)}
        onContextMenu={onTrackContextMenu ? (e) => onTrackContextMenu(e, track) : undefined}
        style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', alignItems: 'center', gap: 8, padding: '5px 8px', cursor: 'pointer', borderRadius: 8, background: isCur ? `rgba(${accent},0.22)` : isSel ? 'rgba(255,255,255,0.05)' : isHov ? 'rgba(255,255,255,0.035)' : 'transparent' }}>
        <div style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isCur ? '#fff' : 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {(isHov || isCur) ? (
            <button type="button" title={isCur && isPlaying ? 'Pause' : 'Play'}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); (onPlayPauseTrack || onPlayTrack)(track); }}
              style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ transform: 'scale(0.72)' }}>{isCur && isPlaying ? <Icons.Pause /> : <Icons.Play />}</span>
            </button>
          ) : (
            // Show the actual track number if we have it, otherwise the display index
            String(track.trackNumber != null ? track.trackNumber : displayIndex).padStart(2, '0')
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: isCur ? '#fff' : 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title || 'Untitled'}</span>
            {track.explicit === 1 ? <ExplicitBadge /> : null}
          </div>
        </div>
        {isHov && (canEdit || canRemove || canAddToPlaylist) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            {canAddToPlaylist ? (
              <button type="button" title="Add to playlist"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onAddToPlaylist([track.id], e.currentTarget); }}
                style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1, fontWeight: 300, padding: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                +
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" title="Edit metadata"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onEditTrack(track.id); }}
                style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ transform: 'scale(0.75)' }}><Icons.Edit /></span>
              </button>
            ) : null}
            {canRemove ? (
              <button type="button" title="Remove from library"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveFromLibrary([track.id]); }}
                style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ transform: 'scale(0.8)' }}><Icons.Trash /></span>
              </button>
            ) : null}
          </div>
        ) : (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {track.duration ? formatTime(track.duration) : ''}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Album hero header */}
      <div style={{ display: 'flex', gap: 10, padding: '4px 6px 12px', alignItems: 'flex-start' }}>
        {/* Back button + cover */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" onClick={onBack}
            title="Back to albums"
            style={{ position: 'absolute', top: -6, left: -6, zIndex: 1, width: 22, height: 22, borderRadius: 7, border: 'none', background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, backdropFilter: 'blur(6px)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <div style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', background: '#111', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
            <AlbumCover album={album} showDiscBadge={false} />
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{album.album}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.artist}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
            {album.tracks.length} tracks
            {album.hasMultipleDiscs ? ` · ${album.discs.length} discs` : ''}
            {' · '}{formatAlbumDuration(totalDuration)}
          </div>
          {/* Play all + Edit album buttons */}
          <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button"
              onClick={() => onPlayTrack(album.tracks[0])}
              style={{
                padding: '5px 12px', borderRadius: 12, border: 'none',
                background: `rgba(${accent},0.25)`, color: '#fff',
                fontSize: 10.5, fontWeight: 700, lineHeight: 1,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
                <path d="M8 5v14l11-7z" />
              </svg>
              Play all
            </button>
            {canEditAlbum ? (
              <button type="button"
                onClick={() => onEditAlbum({
                  album: album.album,
                  artist: album.artist,
                  coverArt: album.coverArt,
                  trackIds: album.tracks.map((t) => t.id),
                  sampleTrack: album.tracks[0],
                  discNumber: null, // null = whole-album scope
                })}
                title="Edit album metadata"
                style={{
                  padding: '5px 12px', borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: 'rgba(255,255,255,0.75)',
                  fontSize: 10.5, fontWeight: 600, lineHeight: 1,
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Edit
              </button>
            ) : null}
            {canAddToPlaylist ? (
              <button type="button"
                onClick={(e) => onAddToPlaylist(album.tracks.map((t) => t.id), e.currentTarget)}
                title="Add album to playlist"
                style={{
                  padding: '5px 12px', borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: 'rgba(255,255,255,0.75)',
                  fontSize: 10.5, fontWeight: 600, lineHeight: 1,
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ display: 'block' }}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 6px 6px' }} />

      {/* Track list — grouped by disc when multi-disc (and not search-filtered) */}
      {tracks.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>No matching tracks</div>
      ) : (album.hasMultipleDiscs && !searchActive) ? (
        album.discs.map((disc) => (
          <div key={disc.discNumber}>
            {/* Disc section header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 8px 6px', marginTop: disc.discNumber === album.discs[0].discNumber ? 0 : 6,
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 5, overflow: 'hidden',
                background: '#111', flexShrink: 0,
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
              }}>
                {disc.coverArt ? (
                  <img src={disc.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
                  </div>
                )}
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.75)',
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>
                Disc {disc.discNumber}
              </div>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              {canEditAlbum ? (
                <button type="button"
                  onClick={() => onEditAlbum({
                    album: album.album,
                    artist: album.artist,
                    coverArt: disc.coverArt || album.coverArt,
                    trackIds: disc.tracks.map((t) => t.id),
                    sampleTrack: disc.tracks[0],
                    discNumber: disc.discNumber,
                  })}
                  title={`Edit disc ${disc.discNumber} metadata`}
                  style={{
                    width: 20, height: 20, borderRadius: 5, border: 'none',
                    background: 'transparent', color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ transform: 'scale(0.7)', display: 'flex' }}><Icons.Edit /></span>
                </button>
              ) : null}
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums' }}>
                {disc.tracks.length} {disc.tracks.length === 1 ? 'track' : 'tracks'}
              </div>
            </div>
            {disc.tracks.map((track, i) => renderTrackRow(track, i + 1))}
          </div>
        ))
      ) : (
        tracks.map((track, i) => renderTrackRow(track, i + 1))
      )}
    </>
  );
}


/**
 * PlaylistView — detail view for a single playlist. Matches the structure of
 * AlbumDetailView: hero header with cover/name/controls, then a list of tracks.
 * Each row has a "remove from playlist" button on hover.
 */
function PlaylistView({
  playlist,
  tracks,
  currentTrack,
  isPlaying,
  hovered,
  setHovered,
  selectedId,
  setSelectedId,
  onPlayTrack,
  onPlayPauseTrack,
  onEditPlaylist,
  onDeletePlaylist,
  onRemoveTracksFromPlaylist,
  onTrackContextMenu,
  onBack,
  accent,
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const totalDuration = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const formatDuration = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h} hr ${m} min`;
    return m > 0 ? `${m} min` : '< 1 min';
  };

  // Derive cover info for the hero thumbnail
  const coversForMosaic = useMemo(() => {
    if (playlist.coverArt) return [];
    const seen = new Set();
    const covers = [];
    for (const t of tracks) {
      if (t.coverArt && !seen.has(t.coverArt)) {
        seen.add(t.coverArt);
        covers.push(t.coverArt);
        if (covers.length >= 4) break;
      }
    }
    return covers;
  }, [tracks, playlist.coverArt]);

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    const r = await onDeletePlaylist(playlist.id);
    if (r?.ok) {
      setConfirmingDelete(false);
      onBack?.();
    }
  };

  // Cancel the delete confirmation if user navigates away / hovers off
  useEffect(() => {
    if (!confirmingDelete) return undefined;
    const t = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  return (
    <div style={{ padding: '10px 10px 10px', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* Hero header */}
      <div style={{ display: 'flex', gap: 10, padding: '4px 2px 12px', alignItems: 'flex-start' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" onClick={onBack}
            title="Back to library"
            style={{
              position: 'absolute', top: -6, left: -6, zIndex: 1,
              width: 22, height: 22, borderRadius: 7, border: 'none',
              background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.8)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, backdropFilter: 'blur(6px)',
            }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <div style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
            <PlaylistThumb playlist={playlist} trackCovers={coversForMosaic} size={64} />
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Playlist</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{playlist.name}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
            {tracks.length > 0 ? ` · ${formatDuration(totalDuration)}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button"
              disabled={tracks.length === 0}
              onClick={() => tracks.length > 0 && onPlayTrack(tracks[0], tracks)}
              style={{
                padding: '5px 12px', borderRadius: 12, border: 'none',
                background: tracks.length === 0 ? 'rgba(255,255,255,0.04)' : `rgba(${accent},0.25)`,
                color: tracks.length === 0 ? 'rgba(255,255,255,0.35)' : '#fff',
                fontSize: 10.5, fontWeight: 700, lineHeight: 1,
                cursor: tracks.length === 0 ? 'default' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
                <path d="M8 5v14l11-7z" />
              </svg>
              Play all
            </button>
            <button type="button"
              onClick={() => onEditPlaylist(playlist.id)}
              title="Edit playlist"
              style={{
                padding: '5px 12px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent', color: 'rgba(255,255,255,0.75)',
                fontSize: 10.5, fontWeight: 600, lineHeight: 1,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Edit
            </button>
            <button type="button"
              onClick={handleDelete}
              title={confirmingDelete ? 'Click again to confirm' : 'Delete playlist'}
              style={{
                padding: '5px 12px', borderRadius: 12,
                border: `1px solid rgba(${confirmingDelete ? '243,114,114' : '255,255,255'},${confirmingDelete ? 0.4 : 0.1})`,
                background: confirmingDelete ? 'rgba(243,114,114,0.12)' : 'transparent',
                color: confirmingDelete ? '#f37272' : 'rgba(255,255,255,0.6)',
                fontSize: 10.5, fontWeight: 600, lineHeight: 1,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!confirmingDelete) {
                  e.currentTarget.style.color = '#f37272';
                  e.currentTarget.style.borderColor = 'rgba(243,114,114,0.3)';
                }
              }}
              onMouseLeave={(e) => {
                if (!confirmingDelete) {
                  e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                }
              }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {confirmingDelete ? 'Confirm' : 'Delete'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 2px 6px' }} />

      {/* Track list — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tracks.length === 0 ? (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            color: 'rgba(255,255,255,0.4)', fontSize: 11, lineHeight: 1.6,
          }}>
            This playlist is empty.<br />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Add tracks from the library later.</span>
          </div>
        ) : tracks.map((track, i) => {
          const isCur = currentTrack?.id === track.id;
          const isSel = selectedId === track.id;
          const isHov = hovered === track.id;
          return (
            <div key={track.id}
              onMouseEnter={() => setHovered(track.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelectedId(track.id)}
              onDoubleClick={() => onPlayTrack(track, tracks)}
              onContextMenu={onTrackContextMenu ? (e) => onTrackContextMenu(e, track) : undefined}
              style={{
                display: 'grid', gridTemplateColumns: '22px 36px 1fr auto',
                alignItems: 'center', gap: 10,
                padding: '6px 8px', cursor: 'pointer', borderRadius: 9,
                background: isCur ? `rgba(${accent},0.24)` : isSel ? 'rgba(255,255,255,0.05)' : isHov ? 'rgba(255,255,255,0.035)' : 'transparent',
              }}>
              <div style={{
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isCur ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.38)',
                fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
              }}>
                {(isHov || isCur) ? (
                  <button type="button" title={isCur && isPlaying ? 'Pause' : 'Play'}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); (onPlayPauseTrack || onPlayTrack)(track, tracks); }}
                    style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ transform: 'scale(0.72)' }}>{isCur && isPlaying ? <Icons.Pause /> : <Icons.Play />}</span>
                  </button>
                ) : String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a', flexShrink: 0 }}>
                {track.coverArt ? (
                  <img src={track.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" decoding="async" />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}><Icons.AlbumSidebar /></div>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: isCur ? '#fff' : 'rgba(255,255,255,0.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title || 'Untitled'}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist || '—'}</div>
              </div>
              {isHov ? (
                <button type="button"
                  title="Remove from playlist"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveTracksFromPlaylist(playlist.id, [track.id]); }}
                  style={{
                    width: 24, height: 24, borderRadius: 6, border: 'none',
                    background: 'transparent', color: 'rgba(255,255,255,0.55)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ transform: 'scale(0.85)' }}><Icons.Trash /></span>
                </button>
              ) : (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, paddingRight: 4 }}>
                  {track.duration ? formatTime(track.duration) : ''}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/**
 * AddToPlaylistMenu — floating popover that lets the user pick a playlist to
 * add a track (or set of tracks) to. Includes a "New playlist…" entry at the
 * bottom that opens the PlaylistEditor flow with the tracks queued up.
 *
 * Props:
 *  - trackIds: the tracks being added
 *  - anchorRect: DOMRect of the button that triggered this (positions the popover)
 *  - playlists: full list to render
 *  - playlistCoverMap: optional Map<playlistId, string[]> for mosaic thumbnails
 *  - onPick(playlistId): called when user selects an existing playlist
 *  - onNewPlaylist(): called when user chooses "New playlist…"
 *  - onClose(): called to dismiss
 */
function AddToPlaylistMenu({
  trackIds,
  anchorRect,
  playlists = [],
  playlistCoverMap = new Map(),
  onPick,
  onNewPlaylist,
  onClose,
  accent,
}) {
  // Position the popover: prefer flush-right against the anchor's left edge,
  // vertically centered on the button. Clamp inside the viewport.
  const MENU_WIDTH = 260;
  const MENU_MAX_HEIGHT = 360;
  const GAP = 6;
  const MARGIN = 8;

  const position = useMemo(() => {
    if (!anchorRect) return { top: 80, left: 80 };
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    let left = anchorRect.left - MENU_WIDTH - GAP;
    if (left < MARGIN) left = anchorRect.right + GAP;
    if (left + MENU_WIDTH + MARGIN > vw) left = vw - MENU_WIDTH - MARGIN;
    let top = anchorRect.top - 8;
    if (top + MENU_MAX_HEIGHT + MARGIN > vh) top = Math.max(MARGIN, vh - MENU_MAX_HEIGHT - MARGIN);
    if (top < MARGIN) top = MARGIN;
    return { top, left };
  }, [anchorRect]);

  // Close on Escape or outside click
  const rootRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const countLabel = trackIds.length === 1 ? 'track' : `${trackIds.length} tracks`;

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 60, pointerEvents: 'none',
      }}
    >
      <div
        ref={rootRef}
        style={{
          position: 'absolute',
          top: position.top, left: position.left,
          width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT,
          pointerEvents: 'auto',
          display: 'flex', flexDirection: 'column',
          borderRadius: 12,
          background: 'rgba(24, 24, 26, 0.95)',
          backdropFilter: 'blur(32px) saturate(1.6)', WebkitBackdropFilter: 'blur(32px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: `0 18px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(${accent},0.12)`,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '10px 12px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}>Add to playlist</div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
            Adding {countLabel}
          </div>
        </div>

        {/* Playlist list */}
        <div style={{
          flex: 1, overflowY: 'auto', minHeight: 0,
          padding: 4,
          scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
        }}>
          {playlists.length === 0 ? (
            <div style={{
              padding: '14px 10px', textAlign: 'center',
              color: 'rgba(255,255,255,0.4)', fontSize: 10.5, lineHeight: 1.5,
            }}>
              No playlists yet.<br />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>Create one below.</span>
            </div>
          ) : playlists.map((pl) => (
            <PlaylistMenuRow
              key={pl.id}
              playlist={pl}
              trackCovers={playlistCoverMap.get(pl.id) || []}
              onClick={() => onPick(pl.id)}
            />
          ))}
        </div>

        {/* Footer — New playlist */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: 4 }}>
          <button
            type="button"
            onClick={onNewPlaylist}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 8px', borderRadius: 7, border: 'none',
              background: 'transparent', color: 'rgba(255,255,255,0.9)',
              cursor: 'pointer', textAlign: 'left',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.15)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              border: '1px dashed rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.6)', fontSize: 18, lineHeight: 1, fontWeight: 300,
            }}>+</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>New playlist…</div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
                Create and add {countLabel}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}


function PlaylistMenuRow({ playlist, trackCovers, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px', borderRadius: 7, border: 'none',
        background: hov ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: '#fff', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.12s',
      }}
    >
      <div style={{ width: 32, height: 32, flexShrink: 0 }}>
        <PlaylistThumb playlist={playlist} trackCovers={trackCovers} size={32} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.92)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {playlist.name}
        </div>
        <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
          {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
        </div>
      </div>
    </button>
  );
}


/**
 * PlaylistEditor — create or edit a playlist's name and cover art.
 * Mirrors AlbumMetadataEditor visually.
 */
function PlaylistEditor({ mode, playlist, pendingAddCount = 0, onSave, onClose, accent }) {
  const initialName = playlist?.name || '';
  const initialCover = playlist?.coverArt || null;

  const [name, setName] = useState(initialName);
  const [coverArt, setCoverArt] = useState(initialCover);
  const [coverDirty, setCoverDirty] = useState(false);
  const [coverMode, setCoverMode] = useState('preview');
  const [urlInput, setUrlInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [coverHover, setCoverHover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const firstInputRef = useRef(null);

  const hasChanges = mode === 'new'
    ? name.trim().length > 0
    : (name.trim() !== initialName.trim() || coverDirty);

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const readFileToDataUri = (file) => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File must be an image.'));
      return;
    }
    if (file.size > 2_000_000) {
      reject(new Error('Image too large (max 2MB source file).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });

  const handleFileSelect = async (file) => {
    if (!file) return;
    setError('');
    try {
      const data = await readFileToDataUri(file);
      if (data.length > 1_500_000) {
        setError('Image too large after encoding. Try a smaller image (~1MB or less).');
        return;
      }
      setCoverArt(data);
      setCoverDirty(true);
      setCoverMode('preview');
    } catch (e) {
      setError(e?.message || 'Could not load image.');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleUrlApply = () => {
    const u = urlInput.trim();
    if (!u) {
      setCoverArt(null);
      setCoverDirty(true);
      setCoverMode('preview');
      setUrlInput('');
      return;
    }
    if (!/^https?:\/\//i.test(u)) {
      setError('URL must start with http:// or https://');
      return;
    }
    setError('');
    setCoverArt(u);
    setCoverDirty(true);
    setCoverMode('preview');
    setUrlInput('');
  };

  const handleRemoveCover = () => {
    setCoverArt(null);
    setCoverDirty(true);
    setCoverMode('preview');
    setError('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!hasChanges || saving) return;
    setError('');
    const n = name.trim();
    if (!n) {
      setError('Playlist name is required.');
      return;
    }
    setSaving(true);

    const fields = {};
    if (mode === 'new') {
      fields.name = n;
      if (coverArt) fields.coverArt = coverArt;
    } else {
      if (n !== initialName.trim()) fields.name = n;
      if (coverDirty) fields.coverArt = coverArt;
    }

    const r = await onSave(fields);
    setSaving(false);
    if (!r?.ok) setError(r?.error || 'Could not save.');
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 9,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff', fontSize: 12.5, outline: 'none',
    transition: 'border-color 0.15s, background 0.15s',
  };

  const fieldLabelStyle = {
    fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 4,
    fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase',
  };

  const titleText = mode === 'new' ? 'New playlist' : 'Edit playlist';
  const submitText = saving
    ? (mode === 'new' ? 'Creating…' : 'Saving…')
    : mode === 'new'
      ? (pendingAddCount > 0
        ? `Create & add ${pendingAddCount} ${pendingAddCount === 1 ? 'track' : 'tracks'}`
        : 'Create')
      : 'Save';

  // Synthetic "playlist" for the cover preview (uses local state)
  const previewPlaylist = { coverArt };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <form onSubmit={handleSubmit}
        style={{
          width: 'min(420px, 100%)',
          maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          borderRadius: 16,
          background: 'rgba(22, 22, 24, 0.85)',
          backdropFilter: 'blur(40px) saturate(1.6)', WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(${accent},0.15), inset 0 1px 0 rgba(255,255,255,0.06)`,
        }}>
        <input ref={fileInputRef} type="file" accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = '';
          }} />

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{titleText}</div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close"
            style={{
              width: 26, height: 26, borderRadius: 7, border: 'none',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 14, padding: '4px 16px 14px', alignItems: 'flex-start' }}>
          {/* Cover picker */}
          <div style={{ flexShrink: 0 }}>
            <div
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={() => setCoverHover(true)}
              onMouseLeave={() => setCoverHover(false)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              title="Click to choose image — or drop one here"
              style={{
                width: 96, height: 96, borderRadius: 10, overflow: 'hidden',
                background: '#0f0f0f', cursor: 'pointer', position: 'relative',
                border: dragOver ? `2px solid rgba(${accent},0.8)` : '2px solid transparent',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                transition: 'border-color 0.15s',
              }}>
              <PlaylistThumb playlist={previewPlaylist} trackCovers={[]} size={96} />
              {(coverHover || dragOver) ? (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.6)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4,
                  color: '#fff', fontSize: 10.5, fontWeight: 600,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>{dragOver ? 'Drop to set' : coverArt ? 'Change' : 'Add cover'}</span>
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'center' }}>
              <button type="button" onClick={() => setCoverMode((m) => m === 'url' ? 'preview' : 'url')}
                title="Paste an image URL"
                style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none',
                  background: coverMode === 'url' ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: coverMode === 'url' ? '#fff' : 'rgba(255,255,255,0.55)',
                  fontSize: 9.5, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                URL
              </button>
              {coverArt ? (
                <button type="button" onClick={handleRemoveCover}
                  title="Remove cover art"
                  style={{
                    padding: '3px 8px', borderRadius: 6, border: 'none',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: 9.5, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          {/* Right: URL field or hint text */}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            {coverMode === 'url' ? (
              <>
                <div style={fieldLabelStyle}>Image URL</div>
                <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlApply(); } }}
                  placeholder="https://…/cover.jpg" style={inputStyle} autoFocus
                  onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  <button type="button" onClick={handleUrlApply}
                    style={{
                      padding: '4px 12px', borderRadius: 7, border: 'none',
                      background: `rgba(${accent},0.3)`, color: '#fff',
                      fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                    }}>
                    Apply
                  </button>
                  <button type="button" onClick={() => { setCoverMode('preview'); setUrlInput(''); }}
                    style={{
                      padding: '4px 12px', borderRadius: 7,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'transparent', color: 'rgba(255,255,255,0.7)',
                      fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                    }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                Click the cover to choose an image, drop one in, or paste a URL.
                {!coverArt ? (
                  <>
                    <br />
                    <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', marginTop: 6, display: 'block' }}>
                      Leave blank to auto-generate a mosaic from track covers.
                    </span>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 16px' }} />

        <div style={{ padding: '14px 16px 12px' }}>
          <div style={fieldLabelStyle}>Name</div>
          <input ref={firstInputRef} type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My playlist" style={inputStyle} maxLength={200}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }} />

          {error ? (
            <div style={{
              marginTop: 10, padding: '7px 10px', borderRadius: 8,
              background: 'rgba(243,114,114,0.1)', border: '1px solid rgba(243,114,114,0.3)',
              color: '#f37272', fontSize: 10.5, lineHeight: 1.4,
            }}>
              {error}
            </div>
          ) : null}
        </div>

        <div style={{
          display: 'flex', gap: 8, padding: '12px 16px 14px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <button type="button" onClick={onClose}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 9,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent', color: 'rgba(255,255,255,0.75)',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}>
            Cancel
          </button>
          <button type="submit" disabled={!hasChanges || saving}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 9, border: 'none',
              background: !hasChanges || saving ? 'rgba(255,255,255,0.06)' : `rgba(${accent},0.3)`,
              color: !hasChanges || saving ? 'rgba(255,255,255,0.35)' : '#fff',
              fontSize: 11.5, fontWeight: 700,
              cursor: !hasChanges || saving ? 'default' : 'pointer',
              transition: 'all 0.15s',
              boxShadow: !hasChanges || saving ? 'none' : `0 2px 12px rgba(${accent},0.2)`,
            }}>
            {submitText}
          </button>
        </div>
      </form>
    </div>
  );
}


/* =========================================================================
 *  QueueDrawer — bottom-anchored drawer that holds the queue.
 *
 *  Conceptually, the queue is ephemeral state about what's playing right now,
 *  not a destination you "navigate to". A drawer that slides up from the
 *  bottom matches that — it appears when you want it, disappears when you
 *  don't, and doesn't take over the dock or the now-playing canvas.
 *
 *  Layout strategy:
 *    - Closed: only QueueHandle (a small pull-tab at bottom-center) is shown
 *    - Opening: drawer animates up from y=100% to y=45% of viewport height,
 *      backdrop fades from 0 to 0.55 opacity
 *    - Open: drawer occupies the bottom 55% of viewport. The drag handle at
 *      the top of the drawer can be dragged up to expand to 85%, or down
 *      to dismiss.
 *
 *  Three height snaps: closed (0%), default (55%), expanded (85%). Drag
 *  velocity decides which snap to land on after release.
 * ========================================================================= */

const QUEUE_DRAWER_SNAPS = {
  CLOSED: 0,
  DEFAULT: 0.55,
  EXPANDED: 0.85,
};

function QueueDrawer({
  open,
  onClose,
  queue,
  currentIndex,
  onJumpToQueueIndex,
  onRemoveFromQueue,
  onReorderQueue,
  onClearUpNext,
  accent,
}) {
  // Height as a fraction of viewport (0..1). Drives the transform.
  const [heightFrac, setHeightFrac] = useState(QUEUE_DRAWER_SNAPS.DEFAULT);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ y: 0, frac: 0 });

  // Reset to default height every time the drawer opens (so a previous
  // expanded state doesn't surprise the user later).
  useEffect(() => {
    if (open) setHeightFrac(QUEUE_DRAWER_SNAPS.DEFAULT);
  }, [open]);

  // Escape key closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Pointer-based drag on the handle at the top of the drawer
  const onHandlePointerDown = (e) => {
    e.preventDefault();
    setDragging(true);
    dragStartRef.current = { y: e.clientY, frac: heightFrac };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onHandlePointerMove = (e) => {
    if (!dragging) return;
    const vh = window.innerHeight || 800;
    const dy = dragStartRef.current.y - e.clientY;     // up = positive
    const next = Math.max(0, Math.min(0.95, dragStartRef.current.frac + dy / vh));
    setHeightFrac(next);
  };
  const onHandlePointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    // Snap to nearest of 0 / DEFAULT / EXPANDED.
    const f = heightFrac;
    if (f < 0.18) { onClose?.(); return; }       // dragged way down → close
    const candidates = [QUEUE_DRAWER_SNAPS.DEFAULT, QUEUE_DRAWER_SNAPS.EXPANDED];
    const closest = candidates.reduce((best, c) => Math.abs(c - f) < Math.abs(best - f) ? c : best, candidates[0]);
    setHeightFrac(closest);
  };

  // Render even when closed so the slide-out transition has somewhere to go.
  // Visibility is controlled by transform + opacity below.
  const visibleFrac = open ? heightFrac : 0;
  const heightCss = `${visibleFrac * 100}vh`;

  return (
    <>
      {/* Backdrop — dims the rest of the app and catches outside clicks */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        style={{
          position: 'absolute', inset: 0, zIndex: 40,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: dragging ? 'none' : 'opacity 280ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label="Play queue"
        aria-hidden={!open}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: heightCss,
          zIndex: 41,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(18, 18, 20, 0.92)',
          backdropFilter: 'blur(18px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
          borderTop: `1px solid rgba(${accent}, 0.18)`,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          boxShadow: '0 -20px 60px rgba(0, 0, 0, 0.5)',
          // Animate height when not actively dragging. Dragging needs to
          // follow the cursor 1:1 so we kill the transition then.
          transition: dragging ? 'none' : 'height 320ms cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle — visible bar at the top, pointer-draggable */}
        <div
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            padding: '10px 0 6px', cursor: dragging ? 'grabbing' : 'grab',
            flexShrink: 0,
            touchAction: 'none',
          }}
          title="Drag to resize, or pull down to close"
        >
          <div style={{
            width: 44, height: 4, borderRadius: 2,
            background: 'rgba(255, 255, 255, 0.25)',
          }} />
        </div>

        {/* Reuse QueueTab as the body — same virtualized list that worked in
            the dock version. The drawer's height fills around it. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <QueueTab
            queue={queue}
            currentIndex={currentIndex}
            onJumpToQueueIndex={onJumpToQueueIndex}
            onRemoveFromQueue={onRemoveFromQueue}
            onReorderQueue={onReorderQueue}
            onClearUpNext={onClearUpNext}
            accent={accent}
          />
        </div>
      </div>
    </>
  );
}

/**
 * QueueHandle — the always-visible bottom-center pull tab. Sits flat against
 * the bottom edge of the window. Clicking opens the drawer; the count badge
 * shows how many tracks are queued so the user knows there's something there.
 */
function QueueHandle({ count, onOpen, accent }) {
  const [hovered, setHovered] = useState(false);
  const hasContent = count > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={hasContent ? `Queue · ${count} tracks` : 'Queue'}
      aria-label="Open queue"
      style={{
        position: 'absolute', bottom: 0, left: '50%',
        transform: `translate(-50%, ${hovered ? '-2px' : '0'})`,
        zIndex: 30,
        // Pill-shaped tab that protrudes upward from the very bottom edge
        width: 96, height: hovered ? 18 : 14,
        borderTopLeftRadius: 10, borderTopRightRadius: 10,
        borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
        border: 'none',
        borderTop: `1px solid rgba(${accent}, ${hasContent ? 0.4 : 0.18})`,
        borderLeft: `1px solid rgba(255, 255, 255, 0.06)`,
        borderRight: `1px solid rgba(255, 255, 255, 0.06)`,
        background: hovered
          ? `rgba(${accent}, 0.25)`
          : (hasContent ? 'rgba(28, 28, 32, 0.85)' : 'rgba(20, 20, 22, 0.65)'),
        backdropFilter: 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: 0,
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: hovered ? '0 -4px 16px rgba(0, 0, 0, 0.4)' : '0 -2px 8px rgba(0, 0, 0, 0.25)',
      }}
    >
      {/* Pill indicator */}
      <div style={{
        width: 28, height: 3, borderRadius: 2,
        background: hasContent ? `rgba(${accent}, 0.95)` : 'rgba(255, 255, 255, 0.35)',
        transition: 'background 200ms',
      }} />
      {/* Count, only when there's something to show — appears when hovered */}
      {hasContent && hovered ? (
        <span style={{
          fontSize: 9.5, fontWeight: 700, color: '#fff',
          letterSpacing: '0.04em',
        }}>{count > 99 ? '99+' : count}</span>
      ) : null}
    </button>
  );
}


/* =========================================================================
 *  QueueTab — shows the current play queue (Now + Up Next).
 *
 *  The queue IS the playback order: no hidden "context" behind it. Every row
 *  is either (a) the currently-playing track, (b) something coming up, or (c)
 *  something already played and still sitting in history. Users can jump to
 *  any index, drag to reorder, click × to remove, or clear everything after
 *  current with "Clear up next".
 * ========================================================================= */

function QueueTab({
  queue,
  currentIndex,
  onJumpToQueueIndex,
  onRemoveFromQueue,
  onReorderQueue,
  onClearUpNext,
  accent,
  // When painterAvailable is true, a list/painter view-mode toggle appears
  // at the top of the tab. Reading from localStorage preserves the user's
  // last choice across launches. When false, only the list view renders.
  painterAvailable = false,
  // Live audio currentTime — only needed by the painter to render the
  // playhead inside the current track's strip cell. List view ignores it.
  currentTime = 0,
}) {
  // View mode: 'list' (default — the original virtualized vertical list)
  // or 'painter' (horizontal duration-proportional strip).
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'list';
    return window.localStorage.getItem('immerse:queueViewMode') || 'list';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('immerse:queueViewMode', viewMode);
    }
  }, [viewMode]);
  // If painter gets disabled while it's active, fall back to list so the
  // user doesn't end up with an invisible queue.
  useEffect(() => {
    if (!painterAvailable && viewMode === 'painter') setViewMode('list');
  }, [painterAvailable, viewMode]);

  const [dragging, setDragging] = useState(null);      // index being dragged
  const [dragOver, setDragOver] = useState(null);      // index being hovered

  // Virtualization state — render only rows currently visible in the scroll
  // viewport. With queues of 500+ tracks (e.g. "play all" on a large library),
  // rendering every row up-front was making the queue open slowly and laggy
  // to scroll. Fixed 50px row height makes the math trivial.
  const ROW_H = 50;
  const OVERSCAN = 5;
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(el.scrollTop);
    // Measure viewport with a ResizeObserver so we stay correct when the dock
    // resizes or an overlay (like a modal) changes the layout.
    let ro;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => setViewHeight(el.clientHeight || 600));
      ro.observe(el);
    }
    setViewHeight(el.clientHeight || 600);
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (ro) ro.disconnect();
    };
  }, []);

  // When current track changes, auto-scroll it into view (gently). Runs only
  // when the queue tab is mounted, so it doesn't re-scroll on every tab switch
  // elsewhere in the app.
  const lastCurrentRef = useRef(currentIndex);
  useEffect(() => {
    if (currentIndex === lastCurrentRef.current) return;
    lastCurrentRef.current = currentIndex;
    const el = scrollRef.current;
    if (!el || currentIndex < 0) return;
    const rowTop = currentIndex * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    // Only scroll if the row isn't already comfortably in view
    if (rowTop < viewTop || rowBottom > viewBottom) {
      el.scrollTo({
        top: Math.max(0, rowTop - el.clientHeight / 2 + ROW_H / 2),
        behavior: 'smooth',
      });
    }
  }, [currentIndex]);

  const upNextCount = Math.max(0, queue.length - currentIndex - 1);
  const historyCount = Math.max(0, currentIndex);

  const handleDragStart = (index) => (e) => {
    setDragging(index);
    try { e.dataTransfer.effectAllowed = 'move'; } catch { /* ignore */ }
  };
  const handleDragOver = (index) => (e) => {
    e.preventDefault();
    if (dragOver !== index) setDragOver(index);
  };
  const handleDragEnd = () => { setDragging(null); setDragOver(null); };
  const handleDrop = (index) => (e) => {
    e.preventDefault();
    if (dragging != null && dragging !== index) onReorderQueue?.(dragging, index);
    handleDragEnd();
  };

  // Compute visible slice
  const total = queue.length;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const lastVisible = Math.min(total, Math.ceil((scrollTop + viewHeight) / ROW_H) + OVERSCAN);
  const visibleRows = [];
  for (let i = firstVisible; i < lastVisible; i += 1) {
    visibleRows.push({ track: queue[i], index: i });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
            Queue
          </div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
            {queue.length === 0 ? 'Empty' : (
              <>
                {historyCount > 0 ? `${historyCount} played · ` : ''}
                {upNextCount} up next
              </>
            )}
          </div>
        </div>
        {upNextCount > 0 ? (
          <button type="button" onClick={onClearUpNext}
            title="Remove everything after the current track"
            style={{
              padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent', color: 'rgba(255,255,255,0.65)',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.borderColor = 'rgba(243,114,114,0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
            Clear up next
          </button>
        ) : null}
        {/* List/painter toggle — only present when the painter feature is
           enabled in Settings. The two icon buttons are styled the same as
           the album grid/stack toggle for visual consistency. */}
        {painterAvailable ? (
          <QueueViewToggle mode={viewMode} onChange={setViewMode} />
        ) : null}
      </div>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
      {/* Keyframes for the playing-indicator bars — defined once, not per row. */}
      <style>{`
        @keyframes immerseBar { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
      `}</style>

      {viewMode === 'painter' && painterAvailable ? (
        <QueuePainterView
          queue={queue}
          currentIndex={currentIndex}
          currentTime={currentTime}
          accent={accent}
          onJumpToQueueIndex={onJumpToQueueIndex}
          onRemoveFromQueue={onRemoveFromQueue}
          onReorderQueue={onReorderQueue}
        />
      ) : (
      /* Body — virtualized. Inner spacer forces the correct scrollbar size;
          each visible row is absolutely positioned at its real index. */
      <div ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
        {queue.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 11.5, lineHeight: 1.6 }}>
            No tracks queued.
            <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
              Play something from the library and it'll show up here.
            </div>
          </div>
        ) : (
          <div style={{ height: total * ROW_H + 16, position: 'relative' }}>
            {visibleRows.map(({ track: t, index: i }) => {
              const isCurrent = i === currentIndex;
              const isHistory = i < currentIndex;
              const isDrop = dragOver === i && dragging !== i && dragging != null;
              return (
                <div key={`${t.id}:${i}`}
                  draggable
                  onDragStart={handleDragStart(i)}
                  onDragOver={handleDragOver(i)}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop(i)}
                  style={{
                    position: 'absolute', top: i * ROW_H, left: 6, right: 6,
                    height: ROW_H - 2,
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '5px 8px', borderRadius: 8,
                    background: isCurrent ? `rgba(${accent},0.15)` : 'transparent',
                    borderTop: isDrop ? `2px solid rgba(${accent},0.9)` : '2px solid transparent',
                    opacity: isHistory ? 0.45 : 1,
                    cursor: 'grab',
                    transition: 'background 0.12s, opacity 0.12s',
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}>
                  {/* Cover art */}
                  <button type="button"
                    onClick={() => onJumpToQueueIndex?.(i)}
                    title={isCurrent ? 'Now playing' : `Jump to "${t.title}"`}
                    style={{
                      width: 36, height: 36, borderRadius: 5, overflow: 'hidden',
                      background: '#1a1a1a', border: 'none', padding: 0, flexShrink: 0,
                      cursor: 'pointer', position: 'relative',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                    }}>
                    {t.coverArt ? (
                      <img src={t.coverArt} alt="" loading="lazy" decoding="async"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : null}
                    {/* Playing indicator bars */}
                    {isCurrent ? (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(0,0,0,0.45)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                      }}>
                        <div style={{ width: 2, height: 10, background: '#fff', borderRadius: 1, animation: 'immerseBar 0.9s ease-in-out infinite' }} />
                        <div style={{ width: 2, height: 10, background: '#fff', borderRadius: 1, animation: 'immerseBar 0.9s ease-in-out 0.25s infinite' }} />
                        <div style={{ width: 2, height: 10, background: '#fff', borderRadius: 1, animation: 'immerseBar 0.9s ease-in-out 0.5s infinite' }} />
                      </div>
                    ) : null}
                  </button>
                  {/* Title / artist */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11.5, fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#fff' : 'rgba(255,255,255,0.88)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.title || 'Untitled'}
                    </div>
                    <div style={{
                      fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.artist || 'Unknown Artist'}
                    </div>
                  </div>
                  {/* Remove button — hidden for the current track (use prev/next transport instead) */}
                  {!isCurrent ? (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); onRemoveFromQueue?.(i); }}
                      title="Remove from queue" aria-label="Remove"
                      style={{
                        width: 22, height: 22, borderRadius: 5, border: 'none',
                        background: 'transparent', color: 'rgba(255,255,255,0.35)',
                        cursor: 'pointer', flexShrink: 0, padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'color 0.12s, background 0.12s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'transparent'; }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

/** Small two-button toggle for QueueTab — list / painter modes.
 *  Same visual vocabulary as the album grid/stack toggle. */
/**
 * QueueViewToggle — segmented control for List / Painter queue views.
 * See AlbumViewToggle's leading comment for why the button component is
 * hoisted out of the parent and why activation runs on mousedown.
 */
function QueueViewToggleBtn({ value, label, icon, active, onActivate }) {
  const handledRef = useRef(false);
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        handledRef.current = true;
        onActivate(value);
      }}
      onClick={() => {
        if (handledRef.current) { handledRef.current = false; return; }
        onActivate(value);
      }}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: 26, height: 22, borderRadius: 5, border: 'none',
        background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {icon}
    </button>
  );
}

function QueueViewToggle({ mode, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2, padding: 2,
      background: 'rgba(255,255,255,0.04)', borderRadius: 6,
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <QueueViewToggleBtn
        value="list"
        label="List view"
        active={mode === 'list'}
        onActivate={onChange}
        icon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="6" y1="6" x2="20" y2="6" />
            <line x1="6" y1="12" x2="20" y2="12" />
            <line x1="6" y1="18" x2="20" y2="18" />
            <circle cx="3.5" cy="6" r="0.8" fill="currentColor" />
            <circle cx="3.5" cy="12" r="0.8" fill="currentColor" />
            <circle cx="3.5" cy="18" r="0.8" fill="currentColor" />
          </svg>
        }
      />
      <QueueViewToggleBtn
        value="painter"
        label="Painter view"
        active={mode === 'painter'}
        onActivate={onChange}
        icon={
          /* Three rounded rectangles of varying width — represents the
             duration-proportional strip metaphor. */
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <rect x="2" y="9" width="6" height="6" rx="1.2" />
            <rect x="9" y="9" width="10" height="6" rx="1.2" opacity="0.7" />
            <rect x="20" y="9" width="3" height="6" rx="1.2" opacity="0.4" />
          </svg>
        }
      />
    </div>
  );
}


/**
 * QueuePainterView — horizontal strip showing the queue as duration-
 * proportional blocks. Each track is rendered as a rounded rectangle
 * whose width is its `duration` value, scaled to fit the viewport.
 *
 * Visual encoding:
 *   - Played tracks (index < currentIndex): dimmed at 35% opacity
 *   - Current track: full opacity with accent-tinted glow + playhead
 *     cursor showing real-time position via `currentTime`
 *   - Up-next tracks: full opacity, no highlight
 *   - Hovered track: shows track title + artist as a small overlay
 *
 * Interactions:
 *   - Click a track block to jump to it (calls onJumpToQueueIndex)
 *   - Right-click to remove from queue (onRemoveFromQueue)
 *   - Drag-reorder: drag a block horizontally and drop on another to
 *     swap positions. Uses native HTML5 drag/drop to match the list view's
 *     reorder behavior — no custom pointer state needed.
 *
 * Sizing math:
 *   The strip wraps to multiple rows if the queue is long. Each row is
 *   `ROW_HEIGHT` tall. The width per second is computed so each row
 *   approximately fills the viewport; tracks longer than the remaining
 *   row space wrap to the next row. Minimum block width is 24px so a
 *   30-second interlude doesn't disappear entirely.
 *
 * Performance:
 *   For queues under ~500 tracks this is fine to render all at once
 *   (each block is ~30 DOM nodes including text). Larger queues would
 *   benefit from virtualization but in practice queues rarely exceed
 *   100 tracks during a session.
 */
function QueuePainterView({
  queue, currentIndex, currentTime, accent,
  onJumpToQueueIndex, onRemoveFromQueue, onReorderQueue,
}) {
  const containerRef = useRef(null);
  // Measured container width — drives the seconds-per-pixel scale. Falls
  // back to a sensible default while the ResizeObserver hasn't fired yet.
  const [containerWidth, setContainerWidth] = useState(320);
  // Stable last-width ref to suppress sub-4px observer noise (same trick
  // used in the album stack to avoid feedback loops).
  const lastWidthRef = useRef(320);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => {
      const w = el.clientWidth || 320;
      if (Math.abs(w - lastWidthRef.current) >= 4) {
        lastWidthRef.current = w;
        setContainerWidth(w);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag-reorder state. We use HTML5 drag (matches list view) so the user
  // can drag from list view to painter view and back without disorientation.
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const handleDragStart = (i) => (e) => {
    setDragging(i);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* IE quirk */ }
    }
  };
  const handleDragOver = (i) => (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (i !== dragOver) setDragOver(i);
  };
  const handleDragEnd = () => { setDragging(null); setDragOver(null); };
  const handleDrop = (i) => (e) => {
    e.preventDefault();
    const from = dragging;
    setDragging(null); setDragOver(null);
    if (from == null || from === i) return;
    onReorderQueue?.(from, i);
  };

  // Hovered track for the tooltip strip below.
  const [hoverIndex, setHoverIndex] = useState(null);

  if (queue.length === 0) {
    return (
      <div style={{
        flex: 1, padding: '28px 18px', textAlign: 'center',
        color: 'rgba(255,255,255,0.5)', fontSize: 11.5, lineHeight: 1.6,
      }}>
        No tracks queued.
        <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
          Play something from the library and it'll show up here.
        </div>
      </div>
    );
  }

  // Sizing constants. ROW_HEIGHT picked to feel substantial without
  // dominating; PIXELS_PER_SECOND derived from container width and a
  // target of fitting roughly 8 minutes per row at default panel width
  // (containerWidth=320 → ~8min/row gives ~0.67px/s). Scales linearly
  // with width so wider panels show more queue per row.
  const ROW_HEIGHT = 56;
  const ROW_GAP = 6;
  const HORIZONTAL_PADDING = 8;
  const MIN_BLOCK_WIDTH = 28;
  const usableWidth = Math.max(120, containerWidth - HORIZONTAL_PADDING * 2);
  // Aim for ~8 minutes per row on a 320px panel; linearly scale.
  const pixelsPerSecond = usableWidth / (8 * 60);

  // Build row layout: pack blocks left-to-right, wrap when next would
  // overflow. Each entry carries its index, computed width, row, x-offset.
  const layout = [];
  let row = 0;
  let xCursor = 0;
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const sec = Math.max(15, t.duration || 180); // fall back to 3min if unknown
    let w = Math.max(MIN_BLOCK_WIDTH, Math.round(sec * pixelsPerSecond));
    // If a single track is wider than the entire row, cap it (otherwise
    // a 30-minute live track would push other blocks off-screen). Cap
    // at full row width minus a gap.
    if (w > usableWidth) w = usableWidth;
    // Wrap to next row if we'd overflow.
    if (xCursor + w > usableWidth && xCursor > 0) {
      row += 1;
      xCursor = 0;
    }
    layout.push({ index: i, track: t, x: xCursor, y: row * (ROW_HEIGHT + ROW_GAP), w });
    xCursor += w + 2; // 2px between blocks
  }
  const totalHeight = (row + 1) * (ROW_HEIGHT + ROW_GAP);

  const fmtTime = (sec) => {
    const s = Math.round(sec || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  const currentDur = currentTrack?.duration || 0;
  const currentProgress = currentDur > 0 ? Math.min(1, Math.max(0, currentTime / currentDur)) : 0;

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Scrollable canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: `8px ${HORIZONTAL_PADDING}px`,
          overscrollBehavior: 'contain',
          scrollbarGutter: 'stable',
        }}
      >
        <div style={{ position: 'relative', width: '100%', height: totalHeight }}>
          {layout.map(({ index: i, track: t, x, y, w }) => {
            const isCurrent = i === currentIndex;
            const isPlayed = i < currentIndex;
            const isHovered = hoverIndex === i;
            const isDropTarget = dragOver === i && dragging !== i && dragging != null;
            return (
              <div
                key={`${t.id}:${i}`}
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop(i)}
                onClick={() => onJumpToQueueIndex?.(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!isCurrent) onRemoveFromQueue?.(i);
                }}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((cur) => (cur === i ? null : cur))}
                style={{
                  position: 'absolute',
                  left: x, top: y, width: w, height: ROW_HEIGHT,
                  borderRadius: 6,
                  background: isCurrent
                    ? `linear-gradient(135deg, rgba(${accent},0.45) 0%, rgba(${accent},0.25) 100%)`
                    : isPlayed
                    ? 'rgba(255,255,255,0.04)'
                    : 'rgba(255,255,255,0.08)',
                  border: isDropTarget
                    ? `2px solid rgba(${accent},0.85)`
                    : isCurrent
                    ? `1px solid rgba(${accent},0.6)`
                    : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: isCurrent
                    ? `0 4px 16px rgba(${accent},0.35), inset 0 1px 0 rgba(255,255,255,0.08)`
                    : isHovered
                    ? '0 2px 8px rgba(0,0,0,0.3)'
                    : 'none',
                  opacity: isPlayed ? 0.5 : 1,
                  cursor: 'pointer',
                  // Transition on properties that won't cause layout reflow.
                  // Width/position are static once computed for this render.
                  transition: 'box-shadow 0.18s, border-color 0.18s, opacity 0.18s, background 0.18s',
                  overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  padding: '6px 8px',
                  minWidth: 0,
                }}
              >
                {/* Title — sized down hard so even narrow blocks show
                   something readable. For very narrow blocks (< 50px),
                   the text gets ellipsized away naturally. */}
                <div style={{
                  fontSize: 9.5,
                  color: isCurrent ? '#fff' : isPlayed ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)',
                  fontWeight: isCurrent ? 700 : 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  lineHeight: 1.25,
                }}>
                  {t.title || 'Untitled'}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                  gap: 4,
                }}>
                  <div style={{
                    fontSize: 8.5,
                    color: isCurrent ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    minWidth: 0, flex: 1,
                  }}>
                    {t.artist || ''}
                  </div>
                  <div style={{
                    fontSize: 8.5,
                    color: 'rgba(255,255,255,0.5)',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}>
                    {fmtTime(t.duration || 0)}
                  </div>
                </div>

                {/* Real-time playhead — only on current track. A vertical
                   accent-tinted line drawn at currentTime/duration of the
                   block's width. Updates smoothly because currentTime
                   flows down from the audio element's timeupdate event. */}
                {isCurrent && currentDur > 0 ? (
                  <div style={{
                    position: 'absolute',
                    top: 0, bottom: 0,
                    left: `${currentProgress * 100}%`,
                    width: 2,
                    background: `rgba(${accent},0.95)`,
                    boxShadow: `0 0 8px rgba(${accent},0.8)`,
                    pointerEvents: 'none',
                  }} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer hint — explains the controls without cluttering the
         visual. Stays subtle. */}
      <div style={{
        padding: '6px 10px',
        fontSize: 9.5, color: 'rgba(255,255,255,0.4)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        textAlign: 'center',
      }}>
        click to jump · drag to reorder · right-click to remove
      </div>
    </div>
  );
}


/* =========================================================================
 *  NewReleasesTab — shows recent releases (last 30 days) from followed artists.
 *
 *  The main process fetches from iTunes on a throttled schedule and caches in
 *  the DB. This component just renders the cached set and exposes a refresh
 *  button + a "manage followed artists" modal.
 * ========================================================================= */

function NewReleasesTab({
  releases,
  followedArtists,
  followOverrides,
  refreshing,
  onRefresh,
  onAddFollowedArtist,
  onExcludeFollowedArtist,
  onClearFollowedArtistOverride,
  onImportRelease,
  library = [],
  accent,
}) {
  const [manageOpen, setManageOpen] = useState(false);
  /** Map<collectionId, { status: 'fetching'|'downloading'|'done'|'error', current, total, error? }> */
  const [downloads, setDownloads] = useState(new Map());

  const setDownloadState = (collectionId, patch) => {
    setDownloads((prev) => {
      const next = new Map(prev);
      if (patch == null) next.delete(collectionId);
      else next.set(collectionId, { ...(prev.get(collectionId) || {}), ...patch });
      return next;
    });
  };

  /**
   * Check whether a release is already in the library. We match on album name
   * + primary artist (case-insensitive) since iTunes and yt-dlp metadata may
   * not share IDs.
   */
  const isInLibrary = useCallback((release) => {
    if (!release?.collectionName || !release?.artistName) return false;
    const targetAlbum = release.collectionName.toLowerCase().trim();
    const targetArtist = release.artistName.toLowerCase().trim();
    return library.some((t) => {
      const tAlbum = (t.album || '').toLowerCase().trim();
      if (tAlbum !== targetAlbum) return false;
      const tArtist = (t.artist || '').toLowerCase().trim();
      // Artist just needs to START with the target (to handle "Artist, feat. X")
      return tArtist === targetArtist || tArtist.startsWith(`${targetArtist},`) || tArtist.startsWith(`${targetArtist} `);
    });
  }, [library]);

  const handleImport = async (release) => {
    if (!onImportRelease) return;
    const collectionId = release.collectionId;
    setDownloadState(collectionId, { status: 'fetching', current: 0, total: 0 });
    try {
      const result = await onImportRelease(release, (progress) => {
        setDownloadState(collectionId, progress);
      });
      if (result?.ok) {
        // If every track failed, surface that as an error rather than a
        // green "Added 0 · N failed". The user needs to know nothing
        // happened.
        const completed = result.completed ?? 0;
        const failed = result.failed ?? 0;
        if (completed === 0 && failed > 0) {
          const firstErr = result.failures?.[0]?.reason || 'All tracks failed';
          setDownloadState(collectionId, {
            status: 'error',
            error: `All ${failed} track${failed === 1 ? '' : 's'} failed. First error: ${firstErr}`,
          });
        } else {
          setDownloadState(collectionId, {
            status: 'done',
            current: completed,
            total: result.total ?? 0,
            failed,
          });
        }
      } else {
        setDownloadState(collectionId, {
          status: 'error',
          error: result?.error || 'Could not import.',
        });
      }
    } catch (e) {
      setDownloadState(collectionId, { status: 'error', error: String(e?.message || e) });
    }
  };

  // Group releases by date label ("Today", "Yesterday", "N days ago", or date)
  const formatDate = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 14) return 'Last week';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    if (typeof onRefresh !== 'function') return;
    await onRefresh();
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header with refresh + manage */}
      <div style={{
        padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
            Recent releases
          </div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
            Last 30 days · {followedArtists.length} artist{followedArtists.length === 1 ? '' : 's'}
          </div>
        </div>
        <button type="button" onClick={handleRefresh} disabled={refreshing}
          title={refreshing ? 'Refreshing…' : 'Refresh releases'}
          aria-label="Refresh releases"
          style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.25)',
            color: refreshing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
            cursor: refreshing ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            transition: 'color 0.15s, background 0.15s',
          }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={refreshing ? { animation: 'immerseSpin 1s linear infinite' } : undefined}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        <button type="button" onClick={() => setManageOpen(true)}
          title="Manage followed artists" aria-label="Manage followed artists"
          style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.25)',
            color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; e.currentTarget.style.background = 'rgba(0,0,0,0.25)'; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>
      </div>
      {/* Inline @keyframes for the spinning refresh icon — injected once */}
      <style>{`
        @keyframes immerseSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 6px 16px' }}>
        {releases.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 11.5, lineHeight: 1.6 }}>
            {followedArtists.length === 0 ? (
              <>
                No artists followed yet.
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => setManageOpen(true)}
                    style={{
                      padding: '6px 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)',
                      background: `rgba(${accent},0.2)`, color: '#fff',
                      fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                    }}>
                    Follow some artists
                  </button>
                </div>
              </>
            ) : refreshing ? (
              <>Checking for new releases…</>
            ) : (
              <>
                Nothing new in the last 30 days.
                <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                  Tap refresh to check again.
                </div>
              </>
            )}
          </div>
        ) : (
          releases.map((r) => {
            const dl = downloads.get(r.collectionId);
            const inLibrary = isInLibrary(r);
            const isBusy = dl && (dl.status === 'fetching' || dl.status === 'downloading');
            const isDone = dl && dl.status === 'done';
            const isError = dl && dl.status === 'error';

            return (
              <div key={`${r.itunesArtistId}:${r.collectionId}`}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px', marginBottom: 2, borderRadius: 9,
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
                  background: '#1a1a1a', boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                }}>
                  {r.artworkUrl ? (
                    <img src={r.artworkUrl} alt="" loading="lazy" decoding="async"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.collectionName}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.6)', marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.artistName}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.38)', marginTop: 2,
                    display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span>{formatDate(r.releaseDate)}</span>
                    <span style={{ opacity: 0.5 }}>·</span>
                    <span>{r.trackCount} track{r.trackCount === 1 ? '' : 's'}</span>
                    {isBusy && dl.total > 0 ? (
                      <>
                        <span style={{ opacity: 0.5 }}>·</span>
                        <span style={{ color: `rgba(${accent},1)` }}>
                          {dl.current}/{dl.total}
                        </span>
                      </>
                    ) : null}
                    {isDone ? (
                      <>
                        <span style={{ opacity: 0.5 }}>·</span>
                        <span style={{ color: '#8ae08a' }}>
                          Added {dl.current}{dl.failed ? ` · ${dl.failed} failed` : ''}
                        </span>
                      </>
                    ) : null}
                    {isError ? (
                      <>
                        <span style={{ opacity: 0.5 }}>·</span>
                        <span style={{ color: '#f37272' }} title={dl.error}>Failed</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {/* Download button — shows library-checkmark if already in library */}
                {inLibrary && !isBusy && !isDone ? (
                  <div title="Already in your library"
                    aria-label="In library"
                    style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'rgba(255,255,255,0.35)',
                    }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => handleImport(r)}
                    disabled={isBusy || isDone}
                    title={isBusy ? 'Downloading…' : isDone ? 'Imported' : 'Import this album'}
                    aria-label={isBusy ? 'Downloading album' : 'Import album'}
                    style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: isDone ? 'rgba(138,224,138,0.15)'
                        : isError ? 'rgba(243,114,114,0.1)'
                        : isBusy ? `rgba(${accent},0.18)`
                        : 'rgba(0,0,0,0.25)',
                      color: isDone ? '#8ae08a'
                        : isError ? '#f37272'
                        : isBusy ? `rgba(${accent},1)`
                        : 'rgba(255,255,255,0.75)',
                      cursor: isBusy || isDone ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                      transition: 'color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!isBusy && !isDone) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = `rgba(${accent},0.25)`; } }}
                    onMouseLeave={(e) => { if (!isBusy && !isDone) { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(0,0,0,0.25)'; } }}>
                    {isBusy ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                        style={{ animation: 'immerseSpin 0.9s linear infinite' }}>
                        <path d="M21 12a9 9 0 1 1-6.2-8.55" />
                      </svg>
                    ) : isDone ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isError ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {manageOpen ? (
        <FollowedArtistsManager
          followedArtists={followedArtists}
          followOverrides={followOverrides}
          onAdd={onAddFollowedArtist}
          onExclude={onExcludeFollowedArtist}
          onClearOverride={onClearFollowedArtistOverride}
          onClose={() => setManageOpen(false)}
          accent={accent}
        />
      ) : null}
    </div>
  );
}


/**
 * FollowedArtistsManager — modal that lists currently-followed artists with
 * toggles, plus a text input to manually add new ones. Auto-followed artists
 * (from library tracks) can be excluded; manually-added ones can be fully
 * removed via clearOverride.
 */
function FollowedArtistsManager({
  followedArtists,
  followOverrides,
  onAdd,
  onExclude,
  onClearOverride,
  onClose,
  accent,
}) {
  const [newArtist, setNewArtist] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lazy-load debug data on first expand, then refresh when the panel reopens
  useEffect(() => {
    if (!debugOpen) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.getReleasesDebug) return;
    api.getReleasesDebug().then((r) => {
      if (r?.ok) setDebugData(r.debug);
    }).catch(() => {});
  }, [debugOpen]);

  // Also list excluded artists so user can re-enable them
  const excludedOverrides = followOverrides.filter((o) => o.action === 'exclude'); // eslint-disable-line no-unused-vars

  const handleAdd = async () => {
    const name = newArtist.trim();
    if (!name) return;
    setError('');
    setAdding(true);
    try {
      const r = await onAdd?.(name);
      if (r?.ok) {
        setNewArtist('');
      } else {
        setError(r?.error || 'Could not add artist.');
      }
    } finally {
      setAdding(false);
    }
  };

  const isManual = (artist) => followOverrides.some(
    (o) => o.action === 'add' && o.artistName.toLowerCase() === artist.key,
  );

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div
        style={{
          width: 'min(420px, 90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: 'rgba(22, 22, 24, 0.96)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
          boxShadow: `0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(${accent},0.15)`,
          overflow: 'hidden',
        }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Followed artists</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
              Artists with 2+ tracks in your library are followed automatically.
            </div>
          </div>
          <button type="button" onClick={onClose}
            title="Close" aria-label="Close"
            style={{
              width: 26, height: 26, borderRadius: 7, border: 'none',
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Add artist */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              type="text"
              value={newArtist}
              onChange={(e) => setNewArtist(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !adding) handleAdd(); }}
              placeholder="Follow an artist by name…"
              style={{
                flex: 1, padding: '7px 11px', borderRadius: 8,
                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 12, outline: 'none',
              }}
            />
            <button type="button" onClick={handleAdd} disabled={!newArtist.trim() || adding}
              style={{
                padding: '7px 14px', borderRadius: 8, border: 'none',
                background: !newArtist.trim() || adding ? 'rgba(255,255,255,0.06)' : `rgba(${accent},0.3)`,
                color: !newArtist.trim() || adding ? 'rgba(255,255,255,0.4)' : '#fff',
                fontSize: 11, fontWeight: 600,
                cursor: !newArtist.trim() || adding ? 'default' : 'pointer',
              }}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
          {error ? (
            <div style={{ marginTop: 6, fontSize: 10, color: '#f37272' }}>{error}</div>
          ) : null}
        </div>

        {/* Followed list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {followedArtists.length === 0 && excludedOverrides.length === 0 ? (
            <div style={{ padding: '24px 18px', textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
              No artists followed.
            </div>
          ) : null}
          {followedArtists.map((a) => {
            const manual = isManual(a);
            return (
              <div key={a.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 16px', fontSize: 11.5,
                }}>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#fff', fontWeight: 500 }}>{a.displayName}</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9.5, marginLeft: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {manual ? 'Manual' : 'Auto'}
                  </span>
                </div>
                <button type="button"
                  onClick={() => (manual ? onClearOverride?.(a.displayName) : onExclude?.(a.displayName))}
                  title={manual ? 'Remove' : 'Unfollow'}
                  style={{
                    padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)',
                    background: 'transparent', color: 'rgba(255,255,255,0.6)',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.borderColor = 'rgba(243,114,114,0.4)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
                  {manual ? 'Remove' : 'Unfollow'}
                </button>
              </div>
            );
          })}

          {/* Debug section — collapsible, shows the outcome of the last refresh */}
          <div style={{ padding: '10px 16px 4px' }}>
            <button type="button"
              onClick={() => setDebugOpen((v) => !v)}
              style={{
                padding: 0, border: 'none', background: 'transparent',
                color: 'rgba(255,255,255,0.35)', fontSize: 9.5, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: debugOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Last refresh details
            </button>
          </div>
          {debugOpen ? (
            <div style={{ padding: '4px 16px 10px', fontSize: 10, lineHeight: 1.5 }}>
              {!debugData ? (
                <div style={{ color: 'rgba(255,255,255,0.45)' }}>
                  No refresh has run yet this session. Hit the refresh button in the New tab.
                </div>
              ) : (
                <>
                  <div style={{ color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>
                    Refreshed at {new Date(debugData.at).toLocaleTimeString()} ·{' '}
                    {debugData.resolved.length} resolved ·{' '}
                    {debugData.failures.length} failed
                  </div>
                  {debugData.resolved.map((r) => (
                    <div key={r.name}
                      style={{
                        display: 'flex', gap: 8, padding: '3px 0',
                        borderTop: '1px solid rgba(255,255,255,0.05)',
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9.5 }}>
                          iTunes ID {r.itunesArtistId} · {r.albumCount} albums · {r.recentCount} in last 30d
                        </div>
                      </div>
                    </div>
                  ))}
                  {debugData.failures.length > 0 ? (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(243,114,114,0.2)' }}>
                      <div style={{ color: 'rgba(243,114,114,0.8)', fontSize: 9.5, fontWeight: 700, marginBottom: 4 }}>
                        Failed:
                      </div>
                      {debugData.failures.map((f) => (
                        <div key={f.name} style={{ color: 'rgba(255,255,255,0.55)' }}>
                          {f.name} <span style={{ color: 'rgba(243,114,114,0.7)' }}>— {f.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


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
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('tracks');
  // Remembers the last Spotify sub-mode (tracks/albums/playlist) so
  // toggling out to Soulseek and back lands on the same sub-tab the
  // user was on. Tracks is the default first time.
  const lastSpotifySubModeRef = useRef('tracks');
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
      }
    } catch (e) {
      setSlskDownloads((prev) => prev.map((d) =>
        d.rowId === row.id ? { ...d, state: 'failed', error: String(e?.message || e) } : d
      ));
    } finally {
      setImporting?.(false);
    }
  }, [api, onSpotifyImportDone, setImporting]);

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
      } else if (res?.error) {
        setError(res.error);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setImporting?.(false);
    }
  }, [api, onSpotifyImportDone, setImporting]);

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
      } else {
        setError(res?.error || 'Playlist import failed.');
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setImporting?.(false);
      setPlaylistImporting(false);
    }
  }, [api, playlistData, playlistSkipIds, playlistSource, setImporting]);

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
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [q, api, mode, slskStatus.configured]);

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
          },
        });
      } else {
        setError(res?.error || 'Import failed.');
      }
    } catch (e) { setError(e?.message || String(e)); }
    finally {
      setDownloadingIds((prev) => { const next = new Set(prev); next.delete(row.spotifyId); return next; });
    }
  };

  const hasSelection = selected.size > 0;

  return (
    <>
      <div style={{ padding: '10px 12px 4px' }}>
        {/* Top-level source toggle: Spotify vs Soulseek. The three
            Spotify sub-modes (tracks, albums, playlist) are collapsed
            under "Spotify" and shown in a sub-row below. Clicking
            Spotify when we're currently in Soulseek restores whichever
            sub-mode was last active (default: tracks). */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
          <MiniToggle
            active={mode === 'tracks' || mode === 'albums' || mode === 'playlist'}
            onClick={() => {
              const target = lastSpotifySubModeRef.current || 'tracks';
              if (mode !== target) { setMode(target); setExpandedAlbum(null); setSelected(new Set()); }
            }}
          >
            Spotify
          </MiniToggle>
          <MiniToggle
            active={mode === 'soulseek'}
            onClick={() => { setMode('soulseek'); setExpandedAlbum(null); setSelected(new Set()); }}
          >
            Soulseek
          </MiniToggle>
        </div>
        {/* Spotify sub-modes. Hidden when we're on Soulseek. */}
        {(mode === 'tracks' || mode === 'albums' || mode === 'playlist') ? (
          <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
            <MiniToggle active={mode === 'tracks'} onClick={() => { setMode('tracks'); setExpandedAlbum(null); setSelected(new Set()); }}>Tracks</MiniToggle>
            <MiniToggle active={mode === 'albums'} onClick={() => { setMode('albums'); setExpandedAlbum(null); setSelected(new Set()); }}>Albums</MiniToggle>
            <MiniToggle active={mode === 'playlist'} onClick={() => { setMode('playlist'); setExpandedAlbum(null); setSelected(new Set()); }}>Playlist</MiniToggle>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 6 }}>
          {mode === 'playlist' ? (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={myPlaylistsState === 'loaded' && myPlaylists.length > 0
                  ? `Filter ${myPlaylists.length} playlist${myPlaylists.length === 1 ? '' : 's'}…`
                  : 'Your Spotify playlists'}
                style={{ flex: 1, boxSizing: 'border-box', padding: '7px 11px', borderRadius: 9, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: 12, outline: 'none' }} />
              <button type="button" onClick={loadMyPlaylists} disabled={myPlaylistsState === 'loading'}
                title="Refresh playlist list from Spotify"
                style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(29,185,84,0.35)', background: 'rgba(29,185,84,0.18)', color: '#1db954', fontSize: 11.5, fontWeight: 700, cursor: myPlaylistsState === 'loading' ? 'wait' : 'pointer' }}>
                {myPlaylistsState === 'loading' ? '…' : 'Refresh'}
              </button>
            </>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder={mode === 'tracks' ? 'Song, artist, lyric…' : mode === 'albums' ? 'Album name, artist…' : 'Song title, album, artist…'}
                style={{ flex: 1, boxSizing: 'border-box', padding: '7px 11px', borderRadius: 9, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: 12, outline: 'none' }} />
              <button type="button" onClick={runSearch} disabled={busy}
                style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(29,185,84,0.35)', background: 'rgba(29,185,84,0.18)', color: '#1db954', fontSize: 11.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? '…' : 'Go'}
              </button>
            </>
          )}
        </div>
      </div>

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
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.6 }}>
            {mode === 'soulseek' ? (
              <>
                Search the Soulseek peer-to-peer network.<br />
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)' }}>
                  Clean / edited / karaoke versions filtered automatically.
                </span>
              </>
            ) : (
              <>
                Search Spotify, then import tracks or whole albums.<br />
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)' }}>Audio comes from YouTube via yt-dlp.</span>
              </>
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
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.6 }}>
                Connect your Spotify account to see your playlists.
                <br />
                <button type="button" onClick={() => onOpenSettings?.()} style={{ marginTop: 10, padding: '6px 14px', borderRadius: 9, border: '1px solid rgba(29,185,84,0.35)', background: 'rgba(29,185,84,0.18)', color: '#1db954', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
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
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.6 }}>
                No playlists found on your Spotify account.<br />
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)' }}>
                  Create one in the Spotify app, then hit Refresh.
                </span>
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
            padding: '5px 10px', borderRadius: 8,
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
          padding: '5px 10px', borderRadius: 8,
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
  playlist, conflicts, skipIds, onToggleSkip, source, setSource,
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


/** Custom font picker — collapsed trigger + expandable card grid */
function FontPicker({ selectedId, onSelect, refreshKey }) {
  const groups = useMemo(() => presetsGrouped(), [refreshKey]);
  const [hovId, setHovId] = useState(null);
  const [open, setOpen] = useState(false);

  const selectedPreset = useMemo(
    () => groups.flatMap((g) => g.presets).find((p) => p.id === selectedId) || null,
    [groups, selectedId],
  );

  // Load fonts for all presets once the panel is opened for the first time
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    for (const { presets } of groups) {
      for (const p of presets) {
        loadGoogleFontForPreset(p);
      }
    }
  }, [open, groups]);

  // Always keep the selected font loaded so the trigger renders correctly
  useEffect(() => {
    if (selectedPreset) loadGoogleFontForPreset(selectedPreset);
  }, [selectedPreset]);

  const handleSelect = (id) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div style={{ marginBottom: 8 }}>
      {/* ── Trigger ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '9px 12px',
          borderRadius: 10,
          border: `1px solid ${open ? 'rgba(155,130,240,0.4)' : 'rgba(255,255,255,0.08)'}`,
          background: open ? 'rgba(120, 95, 220, 0.14)' : 'rgba(255,255,255,0.04)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        {/* "Ag" sample in selected font */}
        <div style={{
          fontFamily: selectedPreset?.stack || 'system-ui, sans-serif',
          fontSize: 20,
          fontWeight: 600,
          color: '#fff',
          lineHeight: 1,
          flexShrink: 0,
          width: 28,
          textAlign: 'left',
        }}>
          Ag
        </div>
        {/* Name + group */}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {selectedPreset?.label || 'Select font'}
          </div>
          {selectedPreset?.group ? (
            <div style={{
              fontSize: 9.5,
              color: 'rgba(255,255,255,0.35)',
              marginTop: 1,
              letterSpacing: '0.02em',
            }}>
              {selectedPreset.group}
            </div>
          ) : null}
        </div>
        {/* Chevron */}
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{
            flexShrink: 0,
            color: 'rgba(255,255,255,0.4)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* ── Expandable grid ── */}
      {open && (
        <div style={{
          marginTop: 6,
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(0,0,0,0.25)',
          maxHeight: 340,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '8px 8px 10px',
        }}>
          {groups.map(({ name, presets }) => (
            <div key={name} style={{ marginBottom: 10 }}>
              {/* Group label */}
              <div style={{
                padding: '2px 2px 5px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.28)',
                position: 'sticky',
                top: 0,
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                zIndex: 1,
              }}>
                {name}
              </div>

              {/* 2-column card grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 5,
              }}>
                {presets.map((p) => {
                  const isSelected = p.id === selectedId;
                  const isHov = p.id === hovId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelect(p.id)}
                      onMouseEnter={() => setHovId(p.id)}
                      onMouseLeave={() => setHovId(null)}
                      style={{
                        padding: '10px 11px 8px',
                        borderRadius: 10,
                        border: `1px solid ${
                          isSelected
                            ? 'rgba(155,130,240,0.45)'
                            : isHov
                              ? 'rgba(255,255,255,0.11)'
                              : 'rgba(255,255,255,0.06)'
                        }`,
                        background: isSelected
                          ? 'rgba(120, 95, 220, 0.2)'
                          : isHov
                            ? 'rgba(255,255,255,0.06)'
                            : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.12s, border-color 0.12s',
                        minWidth: 0,
                        boxSizing: 'border-box',
                        position: 'relative',
                        display: 'block',
                      }}
                    >
                      <div style={{
                        fontFamily: p.stack,
                        fontSize: 19,
                        fontWeight: 600,
                        color: isSelected ? '#fff' : 'rgba(255,255,255,0.85)',
                        lineHeight: 1.15,
                        marginBottom: 5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        Ag
                      </div>
                      <div style={{
                        fontSize: 9.5,
                        fontWeight: isSelected ? 600 : 400,
                        color: isSelected ? 'rgba(200,185,255,0.9)' : 'rgba(255,255,255,0.4)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        letterSpacing: '0.01em',
                        fontFamily: 'system-ui, sans-serif',
                      }}>
                        {p.label}
                      </div>
                      {isSelected ? (
                        <div style={{
                          position: 'absolute',
                          top: 7,
                          right: 8,
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          background: 'rgba(155,130,240,0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 8,
                          color: 'rgba(210,195,255,1)',
                        }}>
                          ✓
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/** Custom fonts manager — add/remove user-defined fonts, saved to localStorage */
function CustomFontsManager({ onChange, version }) {
  const fonts = useMemo(() => getCustomFonts(), [version]);
  const [label, setLabel] = useState('');
  const [family, setFamily] = useState('');
  const [cssUrl, setCssUrl] = useState('');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  // Preload custom fonts' CSS so the family previews in the list actually render in that font
  useEffect(() => {
    for (const f of fonts) {
      if (f.cssUrl) {
        loadGoogleFontForPreset({ id: f.id, customCss: f.cssUrl });
      }
    }
  }, [fonts]);

  const handleAdd = () => {
    const l = label.trim();
    const f = family.trim();
    const url = cssUrl.trim();
    if (!l || !f) {
      setError('Label and font family are required.');
      return;
    }
    const id = `custom-${f.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const entry = { id, label: l, family: f, cssUrl: url || null };
    setCustomFonts([...fonts, entry]);
    // Preload the stylesheet right now so the list preview renders in the new font
    if (url) loadGoogleFontForPreset({ id, customCss: url });
    // Reset the form
    setLabel('');
    setFamily('');
    setCssUrl('');
    setError('');
    setShowForm(false);
    onChange?.();
  };

  const handleRemove = (id) => {
    setCustomFonts(fonts.filter((f) => f.id !== id));
    onChange?.();
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)',
    color: '#fff', fontSize: 11.5, outline: 'none', marginBottom: 6,
  };

  const labelStyle = {
    fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 3, marginTop: 6,
    fontWeight: 600, letterSpacing: '0.02em',
  };

  return (
    <>
      <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 8 }}>
        Add a Google Font, a web CDN URL, or a font installed on your system.
      </div>

      {/* List of existing custom fonts */}
      {fonts.length > 0 ? (
        <div style={{
          borderRadius: 10,
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid rgba(255,255,255,0.07)',
          marginBottom: 8,
          overflow: 'hidden',
        }}>
          {fonts.map((f, i) => (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px',
              borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 600, color: '#fff',
                  fontFamily: `'${f.family}', system-ui, sans-serif`,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {f.label}
                </div>
                <div style={{
                  fontSize: 9.5, color: 'rgba(255,255,255,0.4)', marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {f.family}{f.cssUrl ? ' · custom CSS' : ' · system'}
                </div>
              </div>
              <button type="button" onClick={() => handleRemove(f.id)} title="Remove"
                style={{
                  width: 22, height: 22, borderRadius: 6, border: 'none',
                  background: 'transparent', color: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}>
                <span style={{ transform: 'scale(0.75)' }}><Icons.Trash /></span>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Add new — toggles the form */}
      {!showForm ? (
        <button type="button" onClick={() => setShowForm(true)}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 9,
            border: '1px dashed rgba(255,255,255,0.15)', background: 'transparent',
            color: 'rgba(255,255,255,0.7)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
          }}>
          + Add custom font
        </button>
      ) : (
        <div style={{
          padding: 10, borderRadius: 10,
          background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={labelStyle}>Display name</div>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Modulus Pro" style={inputStyle} />

          <div style={labelStyle}>Font family</div>
          <input type="text" value={family} onChange={(e) => setFamily(e.target.value)}
            placeholder="Exact CSS font-family name" style={inputStyle} />

          <div style={labelStyle}>CSS URL <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>(optional)</span></div>
          <input type="text" value={cssUrl} onChange={(e) => setCssUrl(e.target.value)}
            placeholder="https://... (leave blank for system-installed)" style={inputStyle} />

          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.45, marginTop: 4, marginBottom: 8 }}>
            Leave URL blank for locally-installed fonts. For Google Fonts paste a <code style={{ background: 'rgba(255,255,255,0.07)', padding: '1px 4px', borderRadius: 3, fontSize: 9 }}>fonts.googleapis.com/css2?family=…</code> link.
          </div>

          {error ? (
            <div style={{ fontSize: 10, color: '#f37272', marginBottom: 8 }}>{error}</div>
          ) : null}

          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={handleAdd}
              style={{
                flex: 1, padding: '6px 10px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.06)', color: '#fff',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>
              Add
            </button>
            <button type="button" onClick={() => {
              setShowForm(false);
              setLabel(''); setFamily(''); setCssUrl(''); setError('');
            }}
              style={{
                flex: 1, padding: '6px 10px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'transparent', color: 'rgba(255,255,255,0.6)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}


/* =========================================================================
 *  JournalTab — day-by-day listening diary.
 *
 *  Groups play_events into local-day buckets and renders each non-empty day
 *  as a card containing:
 *    - Header: weekday + date, plays count, total minutes
 *    - Prose summary: 1–2 sentence auto-generated story of the day's listening
 *    - Stat cards: first track, last track, most-played track, longest run
 *
 *  Day cards are collapsed by default. Click expands to show the full
 *  chronological list of plays for that day, with clickable rows that
 *  resume play of the track.
 *
 *  Reads from props.playEvents + props.library — no DB additions. Works
 *  offline; runs entirely in one O(n) pass plus a sort.
 *
 *  Empty state: when the user has no play history yet, prompts them to
 *  play some music. When the play history is non-empty but the most
 *  recent day still has no events visible (which would be unusual),
 *  falls back gracefully.
 * ========================================================================= */
function JournalTab({ library = [], playEvents = [], accent = '48, 48, 48', onPlayTrack }) {
  // Index library by id for O(1) track lookup. Recomputed only when the
  // library reference changes; play-event scans below stay fast.
  const libIndex = useMemo(() => {
    const m = new Map();
    for (const t of library) m.set(t.id, t);
    return m;
  }, [library]);

  // Group play events by local-day. Key is YYYY-MM-DD string keyed off the
  // device's timezone (Date.toLocaleDateString with a fixed format). That
  // way "yesterday at 11pm" and "yesterday at 6am" both group under the
  // same day, which matches user intuition better than UTC bucketing.
  const days = useMemo(() => {
    if (!playEvents || playEvents.length === 0) return [];
    const dayKey = (ts) => {
      const d = new Date(ts);
      // Locale-independent YYYY-MM-DD — stable sort key.
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };

    const map = new Map();
    for (const ev of playEvents) {
      const key = dayKey(ev.at);
      if (!map.has(key)) map.set(key, { key, ts0: ev.at, events: [] });
      const slot = map.get(key);
      slot.events.push(ev);
      if (ev.at < slot.ts0) slot.ts0 = ev.at;
    }
    // Sort events within each day chronologically.
    for (const slot of map.values()) slot.events.sort((a, b) => a.at - b.at);
    // Newest day first.
    return Array.from(map.values()).sort((a, b) => b.ts0 - a.ts0);
  }, [playEvents]);

  if (days.length === 0) {
    return (
      <div style={{
        padding: '48px 24px', textAlign: 'center',
        color: 'rgba(255,255,255,0.45)', fontSize: 12.5, lineHeight: 1.6,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>📖</div>
        <div>Your listening journal will appear here.</div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          Play some music and come back.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', overflowX: 'hidden',
      padding: '6px 10px 14px', overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
    }}>
      {days.map((day) => (
        <JournalDayCard
          key={day.key}
          day={day}
          libIndex={libIndex}
          accent={accent}
          onPlayTrack={onPlayTrack}
          library={library}
        />
      ))}
    </div>
  );
}

/**
 * JournalDayCard — single day's collapsible card with prose, stats, and
 * optional expanded full-play-list.
 */
function JournalDayCard({ day, libIndex, accent, onPlayTrack, library }) {
  const [expanded, setExpanded] = useState(false);

  // Compute everything we display about the day in one memo'd pass. Heavy
  // calc but only runs when the day data or library changes, which is
  // basically never during a session.
  const meta = useMemo(() => {
    const events = day.events;
    if (events.length === 0) return null;

    // Resolve events → tracks. Some events might point at tracks that have
    // since been removed from the library; we tolerate that with a fallback.
    const resolved = events.map((ev) => ({
      at: ev.at,
      track: libIndex.get(ev.track_id) || null,
    }));

    // Total play count + minutes.
    let totalSec = 0;
    const playCount = new Map(); // trackId -> times played that day
    for (const r of resolved) {
      if (r.track?.duration) totalSec += r.track.duration;
      const tid = r.track?.id || `_missing:${r.at}`;
      playCount.set(tid, (playCount.get(tid) || 0) + 1);
    }

    const totalMin = Math.round(totalSec / 60);

    // First and last tracks of the day.
    const first = resolved[0];
    const last = resolved[resolved.length - 1];

    // Most-played track that day (resolve back to a track object).
    let topId = null; let topN = 0;
    for (const [tid, n] of playCount.entries()) {
      if (n > topN && !tid.startsWith('_missing:')) { topId = tid; topN = n; }
    }
    const topTrack = topId ? libIndex.get(topId) : null;

    // Longest consecutive listening run — sequence of plays separated by
    // less than 6 minutes each (covers typical track-to-track gaps; longer
    // gaps imply a pause/break and start a new session). The run length is
    // measured in track count, not duration, because that's the more
    // intuitive "session" metric.
    let runStart = 0; let runEnd = 0; let bestStart = 0; let bestEnd = 0;
    const GAP_THRESHOLD_MS = 6 * 60 * 1000;
    for (let i = 1; i < resolved.length; i++) {
      if (resolved[i].at - resolved[i - 1].at <= GAP_THRESHOLD_MS) {
        runEnd = i;
      } else {
        if (runEnd - runStart > bestEnd - bestStart) {
          bestStart = runStart; bestEnd = runEnd;
        }
        runStart = i; runEnd = i;
      }
    }
    if (runEnd - runStart > bestEnd - bestStart) {
      bestStart = runStart; bestEnd = runEnd;
    }
    const longestRun = bestEnd - bestStart + 1;

    // Prose summary — 1-2 sentences that read naturally. Built from
    // first/most-played/last to give a sense of the day's arc.
    const formatTime12 = (ts) => {
      const d = new Date(ts);
      const h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, '0');
      const period = h >= 12 ? 'pm' : 'am';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${m}${period}`;
    };
    const titleOrUnknown = (t) => t ? (t.title || 'Untitled') : 'an unknown track';
    const artistOrUnknown = (t) => t ? (t.artist || 'unknown artist') : '';

    let prose;
    if (resolved.length === 1) {
      prose = `A single play at ${formatTime12(first.at)} — ${titleOrUnknown(first.track)}${first.track ? ' by ' + artistOrUnknown(first.track) : ''}.`;
    } else {
      const samePerson = first.track && last.track && first.track.artist === last.track.artist;
      const startBit = `started with ${titleOrUnknown(first.track)}${first.track ? ' by ' + artistOrUnknown(first.track) : ''} at ${formatTime12(first.at)}`;
      const endBit = samePerson
        ? `and ended on the same artist at ${formatTime12(last.at)}`
        : `and ended on ${titleOrUnknown(last.track)} at ${formatTime12(last.at)}`;
      const middleBit = topTrack && topN > 1
        ? `, returning to ${topTrack.title} ${topN} times in between`
        : '';
      prose = `You ${startBit}${middleBit} ${endBit}.`;
    }

    return {
      playCountTotal: resolved.length,
      totalMin,
      first,
      last,
      topTrack,
      topPlays: topN,
      longestRun,
      prose,
      resolved,
    };
  }, [day, libIndex]);

  if (!meta) return null;

  // Date header — uses the device's locale for day name + numeric date.
  const dateObj = new Date(day.ts0);
  const weekday = dateObj.toLocaleDateString(undefined, { weekday: 'long' });
  const dateStr = dateObj.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  // Quick-helper for playing a track from the journal.
  const handlePlay = (track) => {
    if (!track || !onPlayTrack) return;
    onPlayTrack(track, library);
  };

  return (
    <div style={{
      marginBottom: 12,
      borderRadius: 12,
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden',
    }}>
      {/* Header strip — clickable to expand/collapse */}
      <div
        onClick={() => setExpanded((x) => !x)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px',
          cursor: 'pointer',
          background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: 0.2 }}>
            {weekday}
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            {dateStr} · {meta.playCountTotal} play{meta.playCountTotal === 1 ? '' : 's'} · {meta.totalMin} min
          </div>
        </div>
        {/* Chevron indicator */}
        <div style={{
          color: 'rgba(255,255,255,0.4)',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.18s',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>

      {/* Prose summary */}
      <div style={{
        padding: '0 14px 12px',
        fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.55,
      }}>
        {meta.prose}
      </div>

      {/* Stat cards — 2x2 grid of bite-size facts */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        padding: '0 14px 12px',
      }}>
        <JournalStatCard
          label="First play"
          value={meta.first.track ? meta.first.track.title : 'Unknown'}
          subValue={meta.first.track ? meta.first.track.artist : ''}
          cover={meta.first.track?.coverArt}
          onClick={() => handlePlay(meta.first.track)}
          accent={accent}
        />
        <JournalStatCard
          label="Last play"
          value={meta.last.track ? meta.last.track.title : 'Unknown'}
          subValue={meta.last.track ? meta.last.track.artist : ''}
          cover={meta.last.track?.coverArt}
          onClick={() => handlePlay(meta.last.track)}
          accent={accent}
        />
        <JournalStatCard
          label={meta.topPlays > 1 ? `Most-played (${meta.topPlays}×)` : 'Top pick'}
          value={meta.topTrack ? meta.topTrack.title : '—'}
          subValue={meta.topTrack ? meta.topTrack.artist : ''}
          cover={meta.topTrack?.coverArt}
          onClick={() => handlePlay(meta.topTrack)}
          accent={accent}
        />
        <JournalStatCard
          label="Longest run"
          value={`${meta.longestRun} track${meta.longestRun === 1 ? '' : 's'}`}
          subValue="back-to-back"
          cover={null}
          onClick={null}
          accent={accent}
        />
      </div>

      {/* Expanded: full chronological play list for the day */}
      {expanded ? (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '8px 6px',
        }}>
          {meta.resolved.map((r, i) => {
            const t = r.track;
            const time = new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            return (
              <div
                key={i}
                onClick={() => handlePlay(t)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px',
                  borderRadius: 6,
                  cursor: t ? 'pointer' : 'default',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { if (t) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', minWidth: 50, fontVariantNumeric: 'tabular-nums' }}>
                  {time}
                </div>
                {t?.coverArt ? (
                  <img src={t.coverArt} alt="" style={{ width: 24, height: 24, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 24, height: 24, borderRadius: 3, background: 'rgba(255,255,255,0.04)', flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 11.5, color: t ? '#fff' : 'rgba(255,255,255,0.35)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {t ? (t.title || 'Untitled') : 'Track removed from library'}
                  </div>
                  {t ? (
                    <div style={{
                      fontSize: 10, color: 'rgba(255,255,255,0.45)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.artist || 'Unknown artist'}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Bite-size labeled card for the stats grid in JournalDayCard. */
function JournalStatCard({ label, value, subValue, cover, onClick, accent }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick || undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.05)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.15s, border-color 0.15s',
        minWidth: 0,
      }}
      onMouseEnter={(e) => {
        if (!clickable) return;
        e.currentTarget.style.background = `rgba(${accent},0.08)`;
        e.currentTarget.style.borderColor = `rgba(${accent},0.25)`;
      }}
      onMouseLeave={(e) => {
        if (!clickable) return;
        e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
      }}
    >
      {cover ? (
        <img src={cover} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 28, height: 28, borderRadius: 4,
          background: 'rgba(255,255,255,0.04)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.3)', fontSize: 14,
        }}>·</div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 9, color: 'rgba(255,255,255,0.45)',
          textTransform: 'uppercase', letterSpacing: 0.4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 11, color: '#fff', fontWeight: 600, marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value}
        </div>
        {subValue ? (
          <div style={{
            fontSize: 9.5, color: 'rgba(255,255,255,0.45)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {subValue}
          </div>
        ) : null}
      </div>
    </div>
  );
}


/* =========================================================================
 *  TrackTab — "About this track" panel.
 *
 *  v1: pure local data only. No external API calls. Sections:
 *    - Hero strip: large-ish cover, title, artist, album · year
 *    - Your history: total plays, first played, last played, average per
 *      month, longest gap, most common time-of-day, most common day-of-week
 *    - More from this album: every track in the library that shares the
 *      album+artist, sorted by track number
 *    - More from this artist: every other album by the same artist
 *      (collapsed to one row per album)
 *    - File details: duration, year, genre, track number
 *
 *  Empty state: when no track is playing, the panel shows a calm "play
 *  something to see info about it" prompt.
 *
 *  Future stages will layer on lyrics preview, Last.fm bio, MusicBrainz
 *  credits, YouTube video embed, etc. — each behind its own opt-in toggle
 *  so the panel stays fast and offline-first by default.
 * ========================================================================= */
function TrackTab({
  currentTrack,
  library = [],
  playEvents = [],
  accent = '48, 48, 48',
  onPlayTrack,
  onFilterByText,
  clickToFilterEnabled = false,
  onTabChange,
  currentTime = 0,
  lyricsData = null,
  onShowLyricsPanel,
  artistInfoEnabled = false,
  lastFmApiKey = '',
  creditsEnabled = false,
  videosEnabled = false,
}) {
  // Empty state — no track playing. Rendered as a calm "nothing to show"
  // card so the user understands the panel is alive and waiting, not broken.
  if (!currentTrack) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '48px 24px', textAlign: 'center',
        color: 'rgba(255,255,255,0.55)', fontSize: 12,
        gap: 14,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 14,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16.5" />
            <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
          Nothing playing
        </div>
        <div style={{ maxWidth: 240, lineHeight: 1.55 }}>
          Play a track and this panel will fill with info: your history with it, more from the album, more from the artist.
        </div>
      </div>
    );
  }

  // --- Derived: this track's stats from the play-event log -----------------
  const stats = useMemo(() => {
    const myEvents = playEvents.filter((ev) => ev && ev.id === currentTrack.id && Number.isFinite(ev.at));
    myEvents.sort((a, b) => a.at - b.at);

    const totalPlays = myEvents.length;
    const firstPlayedAt = myEvents.length ? myEvents[0].at : null;
    const lastPlayedAt = myEvents.length ? myEvents[myEvents.length - 1].at : null;

    // Average plays per month — only meaningful with at least a month of
    // history. Returns null otherwise so the row can be skipped.
    let playsPerMonth = null;
    if (firstPlayedAt) {
      const monthsElapsed = Math.max(1, (Date.now() - firstPlayedAt) / (1000 * 60 * 60 * 24 * 30));
      if (monthsElapsed >= 1) playsPerMonth = totalPlays / monthsElapsed;
    }

    // Longest gap between plays (in days). Only computable with 2+ plays.
    let longestGapDays = null;
    if (myEvents.length >= 2) {
      let max = 0;
      for (let i = 1; i < myEvents.length; i++) {
        const d = myEvents[i].at - myEvents[i - 1].at;
        if (d > max) max = d;
      }
      longestGapDays = max / (1000 * 60 * 60 * 24);
    }

    // Most common hour-of-day and day-of-week for this track. Bucketed
    // into broad parts of the day for human-friendly labelling.
    const hourCounts = new Array(24).fill(0);
    const dowCounts = new Array(7).fill(0);
    for (const ev of myEvents) {
      const d = new Date(ev.at);
      hourCounts[d.getHours()] += 1;
      dowCounts[d.getDay()] += 1;
    }
    const topHour = hourCounts.reduce((best, _c, h) => hourCounts[h] > hourCounts[best] ? h : best, 0);
    const topDow = dowCounts.reduce((best, _c, d) => dowCounts[d] > dowCounts[best] ? d : best, 0);
    const dayPart = (h) => {
      if (h < 5) return 'late nights';
      if (h < 11) return 'mornings';
      if (h < 14) return 'middays';
      if (h < 18) return 'afternoons';
      if (h < 22) return 'evenings';
      return 'nights';
    };
    const dayName = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][topDow];

    return {
      totalPlays,
      firstPlayedAt,
      lastPlayedAt,
      playsPerMonth,
      longestGapDays,
      // Only surface a "you usually play this on …" sentence with at least
      // 3 plays. Below that, the inferred patterns aren't meaningful.
      preferredDayPart: myEvents.length >= 3 ? dayPart(topHour) : null,
      preferredDayName: myEvents.length >= 3 ? dayName : null,
    };
  }, [playEvents, currentTrack.id]);

  // --- Derived: more from this album --------------------------------------
  const moreFromAlbum = useMemo(() => {
    if (!currentTrack.album) return [];
    const albumKey = (currentTrack.album || '').toLowerCase().trim();
    const artistKey = (currentTrack.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    return library
      .filter((t) => {
        if (t.id === currentTrack.id) return false;
        const ta = (t.album || '').toLowerCase().trim();
        const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
        return ta === albumKey && tar === artistKey;
      })
      .sort((a, b) => {
        const an = a.trackNumber || 0;
        const bn = b.trackNumber || 0;
        if (an !== bn) return an - bn;
        return (a.title || '').localeCompare(b.title || '');
      });
  }, [library, currentTrack.id, currentTrack.album, currentTrack.artist]);

  // --- Derived: other albums by this artist -------------------------------
  // Group all library tracks by album for the same artist (excluding the
  // album we're currently in). Pick a representative track per album for
  // the cover, sort by year desc, fallback alphabetical.
  const moreFromArtist = useMemo(() => {
    const artistKey = (currentTrack.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    if (!artistKey) return [];
    const currentAlbumKey = (currentTrack.album || '').toLowerCase().trim();
    const albums = new Map();
    for (const t of library) {
      const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
      if (tar !== artistKey) continue;
      const aKey = (t.album || '').toLowerCase().trim();
      if (!aKey) continue;
      if (aKey === currentAlbumKey) continue;
      const existing = albums.get(aKey);
      if (existing) {
        existing.count += 1;
        // Prefer the lowest-numbered track for the cover (usually track 1
        // has the most "iconic" album art when there's variation).
        if ((t.trackNumber || 99) < (existing.sample.trackNumber || 99)) {
          existing.sample = t;
        }
      } else {
        albums.set(aKey, {
          name: t.album || 'Untitled album',
          year: t.year || null,
          count: 1,
          sample: t,
        });
      }
    }
    const out = Array.from(albums.values());
    out.sort((a, b) => {
      const ay = Number(a.year) || 0;
      const by = Number(b.year) || 0;
      if (ay !== by) return by - ay;
      return (a.name || '').localeCompare(b.name || '');
    });
    return out;
  }, [library, currentTrack.id, currentTrack.album, currentTrack.artist]);

  // --- Helpers ------------------------------------------------------------
  const formatDate = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const formatRelative = (ts) => {
    if (!ts) return '—';
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 30) return `${Math.round(days)} days ago`;
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    return `${(days / 365).toFixed(1)} years ago`;
  };
  const formatDuration = (sec) => {
    if (!sec || !Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Click an album tile — opens the artist's other album in the library
  // by filtering on album name. Reuses the existing filter mechanism so
  // we don't need new navigation plumbing.
  const handleOpenAlbum = (album) => {
    if (!album?.name) return;
    if (clickToFilterEnabled && onFilterByText) {
      onFilterByText(album.name);
    } else if (onTabChange) {
      // No filter feature available — at least take the user to the
      // library so they can find it manually.
      onTabChange('library');
    }
  };

  return (
    <div style={{
      flex: 1, overflowY: 'auto', overflowX: 'hidden',
      overscrollBehavior: 'contain',
      padding: '14px 14px 24px',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      {/* --- Hero strip -------------------------------------------------- */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        padding: 12, borderRadius: 12,
        background: `linear-gradient(135deg, rgba(${accent}, 0.18) 0%, rgba(255,255,255,0.02) 100%)`,
        border: `1px solid rgba(${accent}, 0.2)`,
      }}>
        <div style={{
          width: 84, height: 84, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
          background: 'rgba(0,0,0,0.4)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
        }}>
          {currentTrack.coverArt ? (
            <img src={currentTrack.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            lineHeight: 1.25,
          }}>
            {currentTrack.title || 'Untitled'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4, lineHeight: 1.4 }}>
            {currentTrack.artist || 'Unknown artist'}
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
            {[currentTrack.album, currentTrack.year].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      </div>

      {/* --- About the artist (Last.fm) --------------------------------- */}
      {/* Sits right under the hero so the bio is the first context the
          user sees about whatever is playing. Only renders when the
          feature is enabled AND a Last.fm key is configured AND the
          current track has an artist name. The component handles its
          own network state, caching, and offline behaviour internally. */}
      {artistInfoEnabled && lastFmApiKey && (currentTrack.artist || '').trim() ? (
        <ArtistInfoSection
          artistName={currentTrack.artist}
          apiKey={lastFmApiKey}
          accent={accent}
          onTagClick={(tag) => {
            if (clickToFilterEnabled && onFilterByText) onFilterByText(tag);
          }}
          tagsClickable={clickToFilterEnabled}
        />
      ) : null}

      {/* --- Your history with this track -------------------------------- */}
      <TrackTabSection title="YOUR HISTORY" accent={accent}>
        {stats.totalPlays === 0 ? (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55 }}>
            You haven’t finished playing this track yet. Once it crosses the scrobble threshold, this panel will start filling in with stats.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TrackStatRow label="Total plays" value={String(stats.totalPlays)} />
            <TrackStatRow
              label="First played"
              value={formatDate(stats.firstPlayedAt)}
              hint={stats.firstPlayedAt ? formatRelative(stats.firstPlayedAt) : null}
            />
            <TrackStatRow
              label="Last played"
              value={formatDate(stats.lastPlayedAt)}
              hint={stats.lastPlayedAt ? formatRelative(stats.lastPlayedAt) : null}
            />
            {stats.playsPerMonth !== null ? (
              <TrackStatRow
                label="Plays per month"
                value={stats.playsPerMonth >= 1
                  ? stats.playsPerMonth.toFixed(1)
                  : stats.playsPerMonth.toFixed(2)}
              />
            ) : null}
            {stats.longestGapDays !== null && stats.longestGapDays >= 1 ? (
              <TrackStatRow
                label="Longest gap"
                value={stats.longestGapDays >= 30
                  ? `${(stats.longestGapDays / 30).toFixed(1)} months`
                  : `${Math.round(stats.longestGapDays)} days`}
              />
            ) : null}
            {stats.preferredDayPart && stats.preferredDayName ? (
              <TrackStatRow
                label="You usually play it"
                value={`${stats.preferredDayName.toLowerCase()}, ${stats.preferredDayPart}`}
              />
            ) : null}
          </div>
        )}
      </TrackTabSection>

      {/* --- More from this album --------------------------------------- */}
      {moreFromAlbum.length > 0 ? (
        <TrackTabSection
          title="MORE FROM THIS ALBUM"
          accent={accent}
          subtitle={currentTrack.album || ''}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {moreFromAlbum.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onPlayTrack?.(t, moreFromAlbum)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px', borderRadius: 6,
                  background: 'transparent', border: 'none',
                  color: 'rgba(255,255,255,0.85)',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: 18, fontSize: 10, color: 'rgba(255,255,255,0.4)',
                  textAlign: 'right', flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {t.trackNumber || ''}
                </span>
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.title || 'Untitled'}
                </span>
                <span style={{
                  fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
                  flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatDuration(t.duration)}
                </span>
              </button>
            ))}
          </div>
        </TrackTabSection>
      ) : null}

      {/* --- More from this artist (other albums) ----------------------- */}
      {moreFromArtist.length > 0 ? (
        <TrackTabSection
          title="MORE FROM THIS ARTIST"
          accent={accent}
          subtitle={currentTrack.artist || ''}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 10,
          }}>
            {moreFromArtist.slice(0, 6).map((album, i) => (
              <button
                key={`${album.name}-${i}`}
                type="button"
                onClick={() => handleOpenAlbum(album)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 6, padding: 6, borderRadius: 8,
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)';
                }}
              >
                <div style={{
                  width: '100%', aspectRatio: '1 / 1', borderRadius: 6, overflow: 'hidden',
                  background: 'rgba(0,0,0,0.4)',
                }}>
                  {album.sample?.coverArt ? (
                    <img src={album.sample.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  width: '100%',
                }}>
                  {album.name}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
                  {[album.year, `${album.count} ${album.count === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </TrackTabSection>
      ) : null}

      {/* --- Watch (YouTube) -------------------------------------------- */}
      {/* Lazy-loaded YouTube embed. The disclosure button is light — no
          iframe mounts until the user clicks. This means: no auto-load
          on track change, no background traffic, no third-party cookies
          set unless the user explicitly chose to watch. The embed uses
          youtube-nocookie.com for privacy-enhanced mode. */}
      {videosEnabled && (currentTrack.title || '').trim() && (currentTrack.artist || '').trim() ? (
        <VideoSection
          title={currentTrack.title}
          artist={currentTrack.artist}
          accent={accent}
        />
      ) : null}

      {/* --- Credits (MusicBrainz) -------------------------------------- */}
      {/* Renders only when the user has opted into credits. The component
          handles its own MusicBrainz lookup, throttling, caching, and
          offline behaviour. Credits are people-data — writers, producers,
          engineers, performers — pulled from the upstream Spotify itself
          uses for its credits panel. */}
      {creditsEnabled && (currentTrack.title || '').trim() && (currentTrack.artist || '').trim() ? (
        <CreditsSection
          title={currentTrack.title}
          artist={currentTrack.artist}
          accent={accent}
        />
      ) : null}

      {/* --- File details ----------------------------------------------- */}
      <TrackTabSection title="DETAILS" accent={accent}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <TrackStatRow label="Duration" value={formatDuration(currentTrack.duration)} />
          {currentTrack.year ? <TrackStatRow label="Year" value={String(currentTrack.year)} /> : null}
          {currentTrack.genre ? <TrackStatRow label="Genre" value={currentTrack.genre} /> : null}
          {currentTrack.trackNumber ? (
            <TrackStatRow
              label="Track"
              value={currentTrack.trackTotal
                ? `${currentTrack.trackNumber} of ${currentTrack.trackTotal}`
                : String(currentTrack.trackNumber)}
            />
          ) : null}
        </div>
      </TrackTabSection>
    </div>
  );
}

/**
 * TrackTabSection — header + body with consistent spacing for sections in
 * the Track panel. Header is a small accent-coloured caption; subtitle is
 * the more human-readable context (album name, artist name, etc).
 */
function TrackTabSection({ title, subtitle, accent, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
        color: `rgba(${accent}, 0.95)`,
        textTransform: 'uppercase',
      }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.55)',
          marginTop: -4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {subtitle}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * TrackStatRow — label/value/hint trio for a stat in the YOUR HISTORY or
 * DETAILS sections. Label sits left, value right, with an optional faint
 * hint below the value (e.g. "3 days ago" alongside an absolute date).
 */
function TrackStatRow({ label, value, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
        {label}
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#fff' }}>
          {value}
        </div>
        {hint ? (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}


/* =========================================================================
 *  Last.fm artist-info plumbing.
 *
 *  Free public API, key-only auth, single endpoint we care about:
 *    artist.getInfo  → bio (summary + content), top tags, listener count
 *
 *  Caching:
 *    - Stored in localStorage under `immerse:lastfm:artist:{key}` where
 *      `key` is the artist name lowercased and trimmed to the first
 *      "primary" name (matches the `track.artist` normalization used
 *      elsewhere in the app, e.g. "X feat. Y" → "X").
 *    - Each entry is { fetchedAt, data }. TTL is 24 hours; older entries
 *      are still rendered while a refresh fires in the background, so
 *      offline users keep seeing their last successful fetch.
 *    - Soft eviction: when we'd push past ~200 cached artists we delete
 *      the 50 oldest. Bios are typically <2KB, but cumulative growth in
 *      localStorage (which is capped at ~5MB across the whole origin) is
 *      worth bounding.
 *
 *  Failure modes returned to the caller:
 *    - Network error / offline    → throw with code='offline'
 *    - 401 / invalid key          → throw with code='auth'
 *    - 6 (artist not found)       → throw with code='not_found'
 *    - other Last.fm error codes  → throw with code='error', message included
 * ========================================================================= */
const LASTFM_CACHE_PREFIX = 'immerse:lastfm:artist:';
const LASTFM_TTL_MS = 24 * 60 * 60 * 1000;
const LASTFM_CACHE_LIMIT = 200;

/** Normalize an artist name to the cache key used elsewhere in the app:
 *  lowercase, trimmed, and split on commas/ampersands to get the primary
 *  artist (so "Pino Palladino, Blake Mills" caches under "pino palladino"). */
function lastFmCacheKey(artistName) {
  if (!artistName) return '';
  return (artistName || '')
    .toLowerCase()
    .split(/[,&]/)[0]
    .trim();
}

/** Retrieve a cached entry, or null if missing / unparseable. */
function lastFmCacheGet(artistName) {
  try {
    const key = LASTFM_CACHE_PREFIX + lastFmCacheKey(artistName);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data || !Number.isFinite(parsed.fetchedAt)) return null;
    return parsed;
  } catch { return null; }
}

/** Write an entry. Soft-evicts oldest when we go over the cache limit. */
function lastFmCacheSet(artistName, data) {
  try {
    const key = LASTFM_CACHE_PREFIX + lastFmCacheKey(artistName);
    window.localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
    // Soft eviction — only run when we suspect we may have gone over the
    // limit, so the common write path is one setItem call.
    const allKeys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(LASTFM_CACHE_PREFIX)) allKeys.push(k);
    }
    if (allKeys.length > LASTFM_CACHE_LIMIT) {
      const entries = allKeys.map((k) => {
        try {
          const v = JSON.parse(window.localStorage.getItem(k) || '{}');
          return { k, ts: Number(v.fetchedAt) || 0 };
        } catch { return { k, ts: 0 }; }
      });
      entries.sort((a, b) => a.ts - b.ts);
      const toEvict = entries.slice(0, 50);
      for (const e of toEvict) window.localStorage.removeItem(e.k);
    }
  } catch { /* ignore quota errors */ }
}

/** Fetch fresh data from Last.fm. Throws categorized errors on failure. */
async function fetchLastFmArtistInfo(artistName, apiKey) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const err = new Error('Offline');
    err.code = 'offline';
    throw err;
  }
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'artist.getInfo');
  url.searchParams.set('artist', lastFmCacheKey(artistName) || (artistName || ''));
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');

  let res;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    const err = new Error('Network failure');
    err.code = 'offline';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.code = res.status === 401 || res.status === 403 ? 'auth' : 'error';
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    const err = new Error('Invalid JSON response');
    err.code = 'error';
    throw err;
  }
  // Last.fm returns `{ error: <code>, message: '...' }` on failure with HTTP 200.
  if (body.error) {
    const err = new Error(body.message || `Last.fm error ${body.error}`);
    err.code = (body.error === 6) ? 'not_found'
      : (body.error === 10 || body.error === 26) ? 'auth'
      : 'error';
    throw err;
  }

  const a = body.artist || {};
  // Strip the trailing "Read more on Last.fm" link Last.fm appends to all
  // bio summaries. Format is `<a href="...">Read more on Last.fm</a>.`
  // The summary still contains useful HTML formatting we'll just text-ify.
  const rawSummary = (a.bio?.summary || '').replace(/<a [^>]*>.*?<\/a>\.?\s*$/i, '').trim();
  const text = stripHtmlTags(rawSummary);
  const tags = Array.isArray(a.tags?.tag)
    ? a.tags.tag.map((t) => (t.name || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const listeners = Number(a.stats?.listeners) || null;

  return {
    bio: text,
    tags,
    listeners,
    correctedName: a.name || artistName,
  };
}

/** Strip HTML tags from a string and collapse whitespace. Good enough for
 *  Last.fm bio summaries which only use a handful of inline tags. */
function stripHtmlTags(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/* =========================================================================
 *  ArtistInfoSection — renders Last.fm bio + tags + listener count for
 *  the playing track's artist. Self-contained: handles its own fetch,
 *  cache reads/writes, retry, and offline state.
 *
 *  Lifecycle:
 *    - On mount or when artistName / apiKey changes:
 *        1. Try cache. If fresh (< TTL), render immediately and stop.
 *        2. If cache is stale or missing, render any stale data we have
 *           (so the user sees the last bio while the refresh runs) and
 *           kick off a fetch.
 *        3. On fetch success: write cache and re-render.
 *        4. On fetch failure: keep showing stale data if any; otherwise
 *           render a calm error state.
 *
 *  The component never throws — all errors are caught and presented in
 *  the UI as small, readable copy.
 * ========================================================================= */
function ArtistInfoSection({ artistName, apiKey, accent, onTagClick, tagsClickable }) {
  // null = unloaded; { ... } = data; { error: code } = error state
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    // Reset on artist change.
    if (!artistName || !apiKey) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }

    let cancelled = false;
    const cached = lastFmCacheGet(artistName);
    const isFresh = cached && (Date.now() - cached.fetchedAt) < LASTFM_TTL_MS;

    // Render cached data immediately if any. If stale, this will be
    // replaced below when the refresh resolves.
    if (cached) {
      setState({ status: isFresh ? 'ok' : 'ok-stale', data: cached.data, error: null });
    } else {
      setState({ status: 'loading', data: null, error: null });
    }

    if (isFresh) return undefined; // No need to refetch.

    fetchLastFmArtistInfo(artistName, apiKey)
      .then((data) => {
        if (cancelled) return;
        lastFmCacheSet(artistName, data);
        setState({ status: 'ok', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // If we already had stale data, keep showing it; the section
        // header will just note that we couldn't refresh.
        if (cached) {
          setState({ status: 'ok-stale', data: cached.data, error: err?.code || 'error' });
        } else {
          setState({ status: 'error', data: null, error: err?.code || 'error' });
        }
      });

    return () => { cancelled = true; };
  }, [artistName, apiKey]);

  // Don't render the section frame at all when we have no data and no
  // meaningful state to communicate.
  if (state.status === 'idle') return null;

  const subtitle = state.data?.correctedName && state.data.correctedName.toLowerCase() !== (artistName || '').toLowerCase()
    ? `Showing info for ${state.data.correctedName}`
    : null;

  return (
    <TrackTabSection title="ABOUT THE ARTIST" accent={accent} subtitle={subtitle}>
      {state.status === 'loading' ? (
        <div style={{
          fontSize: 11.5, color: 'rgba(255,255,255,0.45)',
          fontStyle: 'italic',
        }}>
          Loading…
        </div>
      ) : null}

      {state.status === 'error' ? (
        <ArtistInfoError code={state.error} accent={accent} />
      ) : null}

      {state.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state.data.bio ? (
            <div style={{
              fontSize: 12, lineHeight: 1.6,
              color: 'rgba(255,255,255,0.78)',
              // Cap to a reasonable height so a long bio doesn't dominate
              // the whole tab. ~9 lines at 12px/1.6 ≈ 175px.
              maxHeight: 200, overflowY: 'auto',
              paddingRight: 4,
            }}>
              {state.data.bio || 'No biography available.'}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              No biography on Last.fm for this artist.
            </div>
          )}

          {state.data.tags?.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {state.data.tags.map((tag) => (
                <ArtistInfoTag
                  key={tag}
                  tag={tag}
                  accent={accent}
                  clickable={tagsClickable}
                  onClick={tagsClickable ? () => onTagClick?.(tag) : null}
                />
              ))}
            </div>
          ) : null}

          {state.data.listeners ? (
            <div style={{
              fontSize: 10.5, color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.02em',
            }}>
              {state.data.listeners.toLocaleString()} listeners on Last.fm
              {state.status === 'ok-stale' ? ' · couldn’t refresh just now' : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </TrackTabSection>
  );
}

/** Friendly per-code error message. The code values come from
 *  fetchLastFmArtistInfo above. */
function ArtistInfoError({ code, accent }) {
  let msg;
  switch (code) {
    case 'offline':   msg = 'You’re offline — couldn’t reach Last.fm.'; break;
    case 'auth':      msg = 'Last.fm rejected the API key. Check Settings.'; break;
    case 'not_found': msg = 'Last.fm has no info for this artist.'; break;
    default:          msg = 'Couldn’t fetch artist info from Last.fm.'; break;
  }
  return (
    <div style={{
      fontSize: 11.5, color: 'rgba(255,255,255,0.5)',
      lineHeight: 1.55,
      padding: '8px 10px', borderRadius: 7,
      background: `rgba(${accent}, 0.04)`,
      border: `1px solid rgba(${accent}, 0.10)`,
    }}>
      {msg}
    </div>
  );
}

/** Single tag chip. Clickable variant filters the library by the tag text;
 *  non-clickable just displays. Hover lifts and brightens. */
function ArtistInfoTag({ tag, accent, clickable, onClick }) {
  const [hovered, setHovered] = useState(false);
  const Tag = clickable ? 'button' : 'span';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '3px 9px', borderRadius: 11,
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em',
        color: hovered && clickable ? '#fff' : 'rgba(255,255,255,0.78)',
        background: hovered && clickable
          ? `rgba(${accent}, 0.22)`
          : `rgba(${accent}, 0.10)`,
        border: `1px solid rgba(${accent}, ${hovered && clickable ? 0.4 : 0.2})`,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
    >
      {tag}
    </Tag>
  );
}


/* =========================================================================
 *  MusicBrainz credits plumbing.
 *
 *  MusicBrainz is the upstream that Spotify's credits panel ultimately
 *  derives from (via licensed pipelines — we go direct). Two-step lookup:
 *
 *    1. Search /ws/2/recording with title + artist as a query. Take the
 *       top match if its score is above 85; otherwise treat as failed.
 *    2. Fetch /ws/2/recording/{mbid} with `inc=artist-credits+work-rels+
 *       artist-rels+release-rels` to get all the people-relations.
 *    3. If the recording has work relations, fetch /ws/2/work/{mbid}
 *       with `inc=artist-rels` to pull writers / composers / lyricists
 *       (those are stored on the work, not the recording).
 *
 *  Caching: keyed by lowercase(artist) + '|' + lowercase(title), TTL
 *  7 days. Credits don't change once set, so a long TTL is fine.
 *
 *  Throttle: MusicBrainz asks for ≤1 req/sec etiquette. Implemented as
 *  a global serial promise queue so two TrackTab instances (or rapid
 *  track skips) can never burst out a flurry of requests. Each request
 *  waits at least 1100ms after the previous one resolved.
 *
 *  User-Agent: required by MusicBrainz to identify the app. Browsers
 *  block setting User-Agent from JS, but the Origin header serves the
 *  same identification purpose for client-side calls — we just include
 *  a courteous `app=immerse` query param so it shows in MusicBrainz's
 *  request logs.
 * ========================================================================= */
const MB_CACHE_PREFIX = 'immerse:mb:rec:';
const MB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MB_CACHE_LIMIT = 200;
const MB_MIN_INTERVAL_MS = 1100; // honour MusicBrainz 1 req/sec etiquette

// Module-level serial queue ensures global rate limiting across all
// CreditsSection instances. Each call schedules itself on top of the last
// one and waits the minimum interval after it resolved.
let mbLastRequestAt = 0;
let mbQueueTail = Promise.resolve();

function mbScheduledFetch(url) {
  const next = mbQueueTail.then(async () => {
    const elapsed = Date.now() - mbLastRequestAt;
    const wait = Math.max(0, MB_MIN_INTERVAL_MS - elapsed);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(url, {
        // MusicBrainz uses `Accept: application/json` to return JSON
        // instead of XML.
        headers: { 'Accept': 'application/json' },
      });
      mbLastRequestAt = Date.now();
      return res;
    } catch (e) {
      mbLastRequestAt = Date.now();
      throw e;
    }
  });
  // Ensure the chain doesn't leak unhandled rejections — every link in
  // the queue should resolve so the next one can run.
  mbQueueTail = next.catch(() => {});
  return next;
}

/** Cache key for a (artist, title) pair. Lowercases and trims the primary
 *  artist name (matching the rest of the app's "X feat. Y" → "X" semantics)
 *  so case differences and feature credits don't fragment the cache. */
function mbCacheKey(artist, title) {
  const a = (artist || '').toLowerCase().split(/[,&]/)[0].trim();
  const t = (title || '').toLowerCase().trim();
  return `${a}|${t}`;
}

function mbCacheGet(artist, title) {
  try {
    const raw = window.localStorage.getItem(MB_CACHE_PREFIX + mbCacheKey(artist, title));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data || !Number.isFinite(parsed.fetchedAt)) return null;
    return parsed;
  } catch { return null; }
}

function mbCacheSet(artist, title, data) {
  try {
    const k = MB_CACHE_PREFIX + mbCacheKey(artist, title);
    window.localStorage.setItem(k, JSON.stringify({ fetchedAt: Date.now(), data }));
    // Soft eviction.
    const allKeys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const kk = window.localStorage.key(i);
      if (kk && kk.startsWith(MB_CACHE_PREFIX)) allKeys.push(kk);
    }
    if (allKeys.length > MB_CACHE_LIMIT) {
      const entries = allKeys.map((kk) => {
        try {
          const v = JSON.parse(window.localStorage.getItem(kk) || '{}');
          return { k: kk, ts: Number(v.fetchedAt) || 0 };
        } catch { return { k: kk, ts: 0 }; }
      });
      entries.sort((a, b) => a.ts - b.ts);
      for (const e of entries.slice(0, 50)) window.localStorage.removeItem(e.k);
    }
  } catch { /* ignore */ }
}

/** Fetch credits for a (artist, title) pair from MusicBrainz. Throws
 *  categorized errors on failure (offline, not_found, error). */
async function fetchMusicBrainzCredits(artist, title) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const err = new Error('Offline');
    err.code = 'offline';
    throw err;
  }

  // Step 1: search for a recording matching artist + title.
  const query = `recording:"${title.replace(/"/g, '\\"')}" AND artist:"${artist.replace(/"/g, '\\"')}"`;
  const searchUrl = new URL('https://musicbrainz.org/ws/2/recording/');
  searchUrl.searchParams.set('query', query);
  searchUrl.searchParams.set('limit', '5');
  searchUrl.searchParams.set('app', 'immerse');

  let searchRes;
  try {
    searchRes = await mbScheduledFetch(searchUrl.toString());
  } catch {
    const err = new Error('Network failure');
    err.code = 'offline';
    throw err;
  }
  if (!searchRes.ok) {
    const err = new Error(`HTTP ${searchRes.status}`);
    err.code = 'error';
    throw err;
  }
  let searchBody;
  try { searchBody = await searchRes.json(); }
  catch { const err = new Error('Invalid JSON'); err.code = 'error'; throw err; }

  const recordings = Array.isArray(searchBody.recordings) ? searchBody.recordings : [];
  // Take the top result if its score is high. Below 85 means the search
  // engine wasn't confident — better to say "not found" than show wrong
  // credits for a different track.
  const top = recordings.find((r) => Number(r.score) >= 85);
  if (!top || !top.id) {
    const err = new Error('No match');
    err.code = 'not_found';
    throw err;
  }

  // Step 2: fetch the full recording with relations included.
  const lookupUrl = new URL(`https://musicbrainz.org/ws/2/recording/${top.id}`);
  lookupUrl.searchParams.set('inc', 'artist-credits+work-rels+artist-rels+release-rels');
  lookupUrl.searchParams.set('fmt', 'json');
  lookupUrl.searchParams.set('app', 'immerse');

  let lookupRes;
  try { lookupRes = await mbScheduledFetch(lookupUrl.toString()); }
  catch { const err = new Error('Network failure'); err.code = 'offline'; throw err; }
  if (!lookupRes.ok) {
    const err = new Error(`HTTP ${lookupRes.status}`);
    err.code = 'error';
    throw err;
  }
  let recording;
  try { recording = await lookupRes.json(); }
  catch { const err = new Error('Invalid JSON'); err.code = 'error'; throw err; }

  // Collect role → names from recording-level relations. MusicBrainz uses
  // a `type` field with values like 'producer', 'mix', 'mastering',
  // 'recording', 'instrument', 'vocal', 'performer', etc.
  const roles = new Map();
  const addRole = (label, name) => {
    if (!label || !name) return;
    if (!roles.has(label)) roles.set(label, new Set());
    roles.get(label).add(name);
  };

  for (const rel of (recording.relations || [])) {
    const target = rel.artist?.name;
    if (!target) continue;
    const t = rel.type;
    // Map MusicBrainz role types to display labels.
    if (t === 'producer') addRole('Producer', target);
    else if (t === 'mix') addRole('Mixed by', target);
    else if (t === 'mastering') addRole('Mastered by', target);
    else if (t === 'recording') addRole('Recording', target);
    else if (t === 'engineer') addRole('Engineer', target);
    else if (t === 'instrument') {
      // Attribute on this relation tells us which instrument; concat for
      // a richer label like "Guitar". When attribute missing fall back
      // to the generic "Performer".
      const instr = (rel.attributes && rel.attributes[0]) || 'Performer';
      const label = instr.charAt(0).toUpperCase() + instr.slice(1);
      addRole(label, target);
    }
    else if (t === 'vocal') {
      const v = (rel.attributes && rel.attributes[0]) || 'vocals';
      const label = v.charAt(0).toUpperCase() + v.slice(1);
      addRole(label, target);
    }
    else if (t === 'performer') addRole('Performer', target);
    else if (t === 'remixer') addRole('Remixer', target);
  }

  // Step 3: chase work relations for writer/composer/lyricist credits.
  // Multiple works are uncommon but possible; we lookup the first one.
  const workRel = (recording.relations || []).find((r) => r.work?.id);
  if (workRel?.work?.id) {
    const workUrl = new URL(`https://musicbrainz.org/ws/2/work/${workRel.work.id}`);
    workUrl.searchParams.set('inc', 'artist-rels');
    workUrl.searchParams.set('fmt', 'json');
    workUrl.searchParams.set('app', 'immerse');
    try {
      const wRes = await mbScheduledFetch(workUrl.toString());
      if (wRes.ok) {
        const work = await wRes.json();
        for (const rel of (work.relations || [])) {
          const target = rel.artist?.name;
          if (!target) continue;
          if (rel.type === 'composer')   addRole('Composer', target);
          else if (rel.type === 'lyricist') addRole('Lyricist', target);
          else if (rel.type === 'writer')   addRole('Writer', target);
          else if (rel.type === 'arranger') addRole('Arranger', target);
        }
      }
    } catch {
      // Work lookup failure is non-fatal — we still have recording-level
      // credits to show.
    }
  }

  // Convert Map<role, Set<name>> → array of { role, names } sorted in a
  // semantic display order: writers first, then producers, then engineers,
  // then performers, then everything else.
  const roleOrder = [
    'Writer', 'Composer', 'Lyricist', 'Arranger',
    'Producer', 'Remixer',
    'Mixed by', 'Mastered by', 'Recording', 'Engineer',
  ];
  const out = [];
  for (const role of roleOrder) {
    if (roles.has(role)) {
      out.push({ role, names: Array.from(roles.get(role)) });
      roles.delete(role);
    }
  }
  // Anything left (instrument-specific roles like "Guitar", "Vocals",
  // "Drums") goes after, sorted alphabetically.
  const remaining = Array.from(roles.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [role, names] of remaining) {
    out.push({ role, names: Array.from(names) });
  }

  return {
    credits: out,
    matchedTitle: recording.title || title,
  };
}


/* =========================================================================
 *  CreditsSection — renders MusicBrainz credits for the playing track.
 *  Self-contained: own fetch, cache, retry, offline state.
 *
 *  Lifecycle mirrors ArtistInfoSection: cache-first render, stale-while-
 *  revalidate, all errors caught to user-readable copy.
 * ========================================================================= */
function CreditsSection({ title, artist, accent }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (!title || !artist) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }

    let cancelled = false;
    const cached = mbCacheGet(artist, title);
    const isFresh = cached && (Date.now() - cached.fetchedAt) < MB_TTL_MS;

    if (cached) {
      setState({ status: isFresh ? 'ok' : 'ok-stale', data: cached.data, error: null });
    } else {
      setState({ status: 'loading', data: null, error: null });
    }

    if (isFresh) return undefined;

    fetchMusicBrainzCredits(artist, title)
      .then((data) => {
        if (cancelled) return;
        mbCacheSet(artist, title, data);
        setState({ status: 'ok', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        if (cached) {
          setState({ status: 'ok-stale', data: cached.data, error: err?.code || 'error' });
        } else {
          setState({ status: 'error', data: null, error: err?.code || 'error' });
        }
      });

    return () => { cancelled = true; };
  }, [artist, title]);

  if (state.status === 'idle') return null;

  const noCredits = state.data && state.data.credits.length === 0;

  return (
    <TrackTabSection title="CREDITS" accent={accent}>
      {state.status === 'loading' ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
          Loading…
        </div>
      ) : null}

      {state.status === 'error' ? (
        <CreditsError code={state.error} accent={accent} />
      ) : null}

      {state.data && !noCredits ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {state.data.credits.map(({ role, names }) => (
            <div key={role} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                flexShrink: 0, width: 90,
                fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
                paddingTop: 1,
              }}>
                {role}
              </div>
              <div style={{
                flex: 1, fontSize: 11.5, fontWeight: 500,
                color: 'rgba(255,255,255,0.85)', lineHeight: 1.55,
              }}>
                {names.join(', ')}
              </div>
            </div>
          ))}
          {state.status === 'ok-stale' ? (
            <div style={{
              fontSize: 10, color: 'rgba(255,255,255,0.35)',
              marginTop: 4, fontStyle: 'italic',
            }}>
              couldn’t refresh just now
            </div>
          ) : null}
        </div>
      ) : null}

      {noCredits ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
          No credits listed on MusicBrainz for this track.
        </div>
      ) : null}
    </TrackTabSection>
  );
}

/** Friendly error messaging for credit fetch failures. */
function CreditsError({ code, accent }) {
  let msg;
  switch (code) {
    case 'offline':   msg = 'You’re offline — couldn’t reach MusicBrainz.'; break;
    case 'not_found': msg = 'Couldn’t find this track on MusicBrainz.'; break;
    default:          msg = 'Couldn’t fetch credits from MusicBrainz.'; break;
  }
  return (
    <div style={{
      fontSize: 11.5, color: 'rgba(255,255,255,0.5)',
      lineHeight: 1.55,
      padding: '8px 10px', borderRadius: 7,
      background: `rgba(${accent}, 0.04)`,
      border: `1px solid rgba(${accent}, 0.10)`,
    }}>
      {msg}
    </div>
  );
}


/* =========================================================================
 *  VideoSection — "Watch on YouTube" link for the playing track.
 *
 *  Originally this used `youtube-nocookie.com/embed?listType=search&list=`
 *  to lazy-load a YouTube search-result iframe directly in the panel.
 *  That approach was deprecated by Google on 2020-11-15 and now returns
 *  4xx errors ("Video unavailable"). The official replacement requires
 *  the YouTube Data API key + quota management.
 *
 *  Even with a key, embedding music tracks is fragile: labels frequently
 *  disable embed permissions on official videos, so users would still
 *  hit "Video unavailable" much of the time. Better to skip embedding
 *  entirely and just open YouTube's search results page in the user's
 *  default browser, where they can pick the right video themselves.
 *
 *  This means: zero network traffic from the panel, no third-party
 *  cookies, no API key needed, no embed restrictions to fight. Click →
 *  browser opens to YouTube search.
 * ========================================================================= */
function VideoSection({ title, artist, accent }) {
  const [hovered, setHovered] = useState(false);
  const query = `${artist} ${title} official music video`;
  const externalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  // Launches YouTube in the user's default browser via Electron's
  // shell.openExternal IPC. Falls back to window.open for non-Electron
  // contexts (dev preview).
  const handleClick = (e) => {
    e.preventDefault();
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (api && typeof api.openExternal === 'function') {
      api.openExternal(externalUrl);
    } else {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <TrackTabSection title="WATCH" accent={accent}>
      <a
        href={externalUrl}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '10px 12px', borderRadius: 8,
          background: hovered ? `rgba(${accent}, 0.22)` : `rgba(${accent}, 0.12)`,
          border: `1px solid rgba(${accent}, ${hovered ? 0.45 : 0.25})`,
          color: 'rgba(255,255,255,0.9)',
          fontSize: 11.5, fontWeight: 600,
          textDecoration: 'none',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Play icon */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
          Search YouTube for this track
        </span>
        {/* External-link glyph — visual reinforcement that this leaves
            the app and opens in the user's default browser. */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.6 }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </a>
    </TrackTabSection>
  );
}


/**
 * StatsTab — listening insights derived from the user's library data.
 * No external services, no telemetry — everything is computed locally
 * from the playCount + lastPlayed columns we already track per track.
 *
 * Sections:
 *   - Headline numbers (tracks, hours listened, plays)
 *   - Top tracks (by play count)
 *   - Top albums and top artists (aggregated)
 *   - Listening velocity (last 7d vs prior 7d)
 *   - Rediscover (high play count, not played in 30+ days)
 */
function StatsTab({ library, playlists, onPlayTrack, accent = '48, 48, 48', playEvents = [], onResetStats, rangeTabsEnabled = true }) {
  // Time range for the top-tracks/albums/artists lists. 'all' uses the
  // per-track playCount aggregate (which is all-time and survives DB
  // event pruning); 'day'/'week'/'month' filter the play-event log to
  // the matching window and count plays from there.
  const [rangeRaw, setRange] = useState('all');
  // When the user has hidden the range tabs in settings, collapse the
  // entire tab to All Time regardless of what was selected before the
  // toggle flipped. Without this, a previously-selected Day/Week/Month
  // would silently keep filtering even though the picker is gone.
  const range = rangeTabsEnabled ? rangeRaw : 'all';
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Pre-compute everything in one big memo since the inputs only change
  // when library, the play-event log, or the active range does. Avoids
  // running multiple sort/group passes per render.
  const stats = useMemo(() => {
    const totalTracks = library.length;
    if (totalTracks === 0) {
      return {
        empty: true, totalTracks: 0, totalHours: 0, totalPlays: 0, favoritesCount: 0,
        topTracks: [], topAlbums: [], topArtists: [], rediscover: [],
        playsLast7: 0, playsPrior7: 0,
      };
    }

    const now = Date.now();
    // Range cutoff: calendar-aligned, not rolling. So "Day" means since
    // local midnight today (a play from 11:30pm yesterday isn't in
    // today's stats even though it's <24h ago); "Week" means since
    // Monday 00:00 of this week; "Month" means since the 1st 00:00 of
    // this month. Feels closer to how people think about "this week"
    // than a rolling 7-day window that quietly drops things at random
    // times of day.
    const cutoff = (() => {
      if (range === 'day') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      }
      if (range === 'week') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        // getDay() returns 0=Sun..6=Sat. Treat Monday as the start of
        // the week — most music-stats convention (Spotify Wrapped's
        // weekly view, last.fm) uses Monday-start weeks. Shift the
        // anchor so Monday=0..Sunday=6, then subtract those days.
        const daysSinceMonday = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - daysSinceMonday);
        return d.getTime();
      }
      if (range === 'month') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(1);
        return d.getTime();
      }
      return 0;
    })();

    // Build a track lookup once — used both to enrich top-* lists with
    // cover art / titles / artists and to total listening time.
    const libIndex = new Map(library.map((t) => [t.id, t]));
    const primaryArtist = (str) => {
      if (!str) return 'Unknown Artist';
      return str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim() || 'Unknown Artist';
    };

    // Totals always come from the per-track aggregate so all-time
    // headline numbers stay accurate even when viewing the Day tab.
    let totalSeconds = 0;
    let totalPlays = 0;
    let favoritesCount = 0;
    for (const t of library) {
      const plays = Number(t.playCount) || 0;
      const dur = Number(t.duration) || 0;
      totalSeconds += plays * dur;
      totalPlays += plays;
      if (t.isFavorite) favoritesCount++;
    }

    // Per-track play-counts within the active range. For 'all' we use
    // each track's stored playCount; for time-bounded ranges we count
    // events in the window. This is the key change that makes
    // Day/Week/Month meaningful — without it, every range would just
    // re-show the same all-time top list.
    const playsByTrack = new Map();
    if (range === 'all') {
      for (const t of library) {
        const n = Number(t.playCount) || 0;
        if (n > 0) playsByTrack.set(t.id, n);
      }
    } else if (Array.isArray(playEvents) && cutoff > 0) {
      for (const ev of playEvents) {
        const at = Number(ev?.at) || 0;
        if (!at || at < cutoff) continue;
        const id = String(ev.id || '');
        if (!id) continue;
        playsByTrack.set(id, (playsByTrack.get(id) || 0) + 1);
      }
    }

    // Roll the per-track counts up into albums and artists. Album key
    // is "album__primaryArtist" (case-insensitive) so different albums
    // by the same artist stay separate, and the same album-title under
    // different artists also stays separate.
    const albumMap = new Map(); // key: "album__artist" -> { name, artist, plays, coverArt, sampleTrack }
    const artistMap = new Map(); // key: artist (primary) -> { name, plays, sampleCover, sampleTrack }
    for (const [trackId, plays] of playsByTrack.entries()) {
      const t = libIndex.get(trackId);
      if (!t || plays <= 0) continue;
      const album = (t.album || 'Unknown Album').trim();
      const artist = primaryArtist(t.artist);
      const albumKey = `${album.toLowerCase()}__${artist.toLowerCase()}`;
      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, { name: album, artist, plays: 0, coverArt: t.coverArt, sampleTrack: t });
      }
      albumMap.get(albumKey).plays += plays;
      if (!artistMap.has(artist)) {
        artistMap.set(artist, { name: artist, plays: 0, sampleCover: t.coverArt, sampleTrack: t });
      }
      artistMap.get(artist).plays += plays;
    }

    // Build the top-tracks list. Each entry carries the track itself
    // (for cover art / play action) plus the play count for the active
    // range, so the row can show "8 plays" for the week tab while
    // still showing the all-time count on the 'all' tab.
    const topTracks = [...playsByTrack.entries()]
      .map(([id, plays]) => {
        const t = libIndex.get(id);
        return t ? { ...t, rangePlays: plays } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.rangePlays - a.rangePlays)
      .slice(0, 8);
    const topAlbums = [...albumMap.values()].sort((a, b) => b.plays - a.plays).slice(0, 6);
    const topArtists = [...artistMap.values()].sort((a, b) => b.plays - a.plays).slice(0, 6);

    // Rediscover only makes sense for the all-time view — by definition
    // it surfaces tracks you HAVEN'T played recently. Hide it for the
    // bounded ranges.
    const thirtyDays = 1000 * 60 * 60 * 24 * 30;
    const rediscover = range === 'all'
      ? library
        .filter((t) => {
          const plays = Number(t.playCount) || 0;
          const last = Number(t.lastPlayed) || 0;
          return plays >= 3 && t.coverArt && (now - last) > thirtyDays;
        })
        .sort((a, b) => (Number(b.playCount) || 0) - (Number(a.playCount) || 0))
        .slice(0, 6)
      : [];

    // --- Weekly velocity card numbers ---
    // The velocity card stays on every tab because it's a useful
    // benchmark (this-week vs prior-week) regardless of what list the
    // user is viewing.
    const sevenDays = 1000 * 60 * 60 * 24 * 7;
    let playsLast7 = 0;
    let playsPrior7 = 0;
    if (Array.isArray(playEvents) && playEvents.length > 0) {
      for (const ev of playEvents) {
        const at = Number(ev?.at) || 0;
        if (!at) continue;
        const age = now - at;
        if (age <= sevenDays) playsLast7++;
        else if (age <= sevenDays * 2) playsPrior7++;
      }
    } else {
      // Legacy fallback — count distinct tracks with lastPlayed in the window.
      for (const t of library) {
        const last = Number(t.lastPlayed) || 0;
        if (!last) continue;
        const age = now - last;
        if (age <= sevenDays) playsLast7++;
        else if (age <= sevenDays * 2) playsPrior7++;
      }
    }

    return {
      empty: false,
      totalTracks, totalHours: totalSeconds / 3600, totalPlays, favoritesCount,
      topTracks, topAlbums, topArtists, rediscover,
      playsLast7, playsPrior7,
    };
  }, [library, playEvents, range]);

  // Format helpers
  const fmtNum = (n) => Math.round(n).toLocaleString();
  const fmtHours = (h) => {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 10) return `${h.toFixed(1)}h`;
    return `${Math.round(h)}h`;
  };

  const handlePlay = (t) => {
    if (!onPlayTrack) return;
    onPlayTrack(t, library);
  };

  const doReset = async () => {
    if (!onResetStats || resetting) return;
    setResetting(true);
    try {
      await onResetStats();
    } finally {
      setResetting(false);
      setResetConfirmOpen(false);
    }
  };

  if (stats.empty) {
    return (
      <div style={{ flex: 1, padding: '40px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.55 }}>
        No listening data yet.<br />
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>Play some tracks and stats will populate here.</span>
      </div>
    );
  }

  // Trend indicator for velocity
  const trendDelta = stats.playsLast7 - stats.playsPrior7;
  const trendPct = stats.playsPrior7 > 0 ? Math.round((trendDelta / stats.playsPrior7) * 100) : null;

  // Label suffix used in section titles when a time range is active —
  // "Most Played Tracks · This Week" reads better than just "Most
  // Played Tracks" for the bounded views.
  const rangeLabel =
    range === 'day' ? 'Today'
    : range === 'week' ? 'This Week'
    : range === 'month' ? 'This Month'
    : '';

  // Heading on top-N lists. When a range is selected, also note if the
  // window is empty so the user understands why a list is missing.
  const rangeIsEmpty = range !== 'all' && stats.topTracks.length === 0;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', overflowX: 'hidden',
      padding: '8px 14px 18px',
      scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
    }}>
      {/* Range tabs — All / Day / Week / Month. Drives which top-N
          lists are shown and how their counts are computed. Hidden
          when the user has disabled the feature in settings, in which
          case the tab silently behaves as All Time only. */}
      {rangeTabsEnabled ? (
        <div style={{
          display: 'flex', gap: 4, marginBottom: 14,
          padding: 3, borderRadius: 9,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          {[
            { id: 'all', label: 'All Time' },
            { id: 'day', label: 'Day' },
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              style={{
                flex: 1,
                padding: '5px 8px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.02em',
                background: range === r.id ? `rgba(${accent}, 0.18)` : 'transparent',
                color: range === r.id ? '#fff' : 'rgba(255,255,255,0.55)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Headline numbers — always all-time totals regardless of which
          range tab is active. The range tab affects the top-N lists
          below, not the lifetime numbers up here. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
        <StatCard label="Tracks" value={fmtNum(stats.totalTracks)} accent={accent} />
        <StatCard label="Plays" value={fmtNum(stats.totalPlays)} accent={accent} />
        <StatCard label="Listened" value={fmtHours(stats.totalHours)} accent={accent} />
      </div>

      {/* Velocity card — prominent if there's data */}
      {stats.playsLast7 > 0 || stats.playsPrior7 > 0 ? (
        <div style={{
          padding: '12px 14px', marginBottom: 18,
          borderRadius: 11,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>
              This Week
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.92)' }}>
              <strong style={{ color: '#fff', fontSize: 17, fontWeight: 700 }}>{stats.playsLast7}</strong>
              <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginLeft: 6 }}>{stats.playsLast7 === 1 ? 'play' : 'plays'}</span>
            </div>
          </div>
          {trendPct != null ? (
            <div style={{
              fontSize: 11, fontWeight: 700,
              padding: '4px 10px', borderRadius: 999,
              background: trendDelta >= 0 ? 'rgba(80, 200, 120, 0.15)' : 'rgba(243, 114, 114, 0.15)',
              color: trendDelta >= 0 ? '#7be191' : '#f37272',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span>{trendDelta >= 0 ? '↗' : '↘'}</span>
              <span>{trendDelta >= 0 ? '+' : ''}{trendPct}%</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* When a range is selected but produced no results, surface a
          friendly empty-state instead of just hiding all the top-N
          sections (which would look like a broken tab). */}
      {rangeIsEmpty ? (
        <div style={{
          padding: '22px 14px',
          textAlign: 'center',
          color: 'rgba(255,255,255,0.45)',
          fontSize: 12,
          lineHeight: 1.55,
          marginBottom: 18,
          borderRadius: 10,
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}>
          No plays {rangeLabel.toLowerCase()} yet.<br />
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>Switch to All Time to see your full listening history.</span>
        </div>
      ) : null}

      {/* Top tracks */}
      {stats.topTracks.length > 0 ? (
        <StatsSection title={rangeLabel ? `Most Played · ${rangeLabel}` : 'Most Played Tracks'} accent={accent}>
          {stats.topTracks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handlePlay(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '6px 4px',
                background: 'transparent', border: 'none',
                color: '#fff', cursor: 'pointer',
                textAlign: 'left',
                borderRadius: 7,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <div style={{
                width: 18, fontSize: 11, fontWeight: 700,
                color: i < 3 ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.35)',
                fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {t.coverArt ? <img src={t.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginBottom: 1,
                }}>
                  {t.title}
                </div>
                <div style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.5)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.artist}
                </div>
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)',
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
              }}>
                {t.rangePlays}
              </div>
            </button>
          ))}
        </StatsSection>
      ) : null}

      {/* Top albums */}
      {stats.topAlbums.length > 0 ? (
        <StatsSection title={rangeLabel ? `Top Albums · ${rangeLabel}` : 'Most Played Albums'} accent={accent}>
          {stats.topAlbums.map((a, i) => (
            <div key={`${a.name}__${a.artist}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 4px',
                color: '#fff',
              }}>
              <div style={{
                width: 18, fontSize: 11, fontWeight: 700,
                color: i < 3 ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.35)',
                fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {a.coverArt ? <img src={a.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.name}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.artist}
                </div>
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {a.plays}
              </div>
            </div>
          ))}
        </StatsSection>
      ) : null}

      {/* Top artists */}
      {stats.topArtists.length > 0 ? (
        <StatsSection title={rangeLabel ? `Top Artists · ${rangeLabel}` : 'Most Played Artists'} accent={accent}>
          {stats.topArtists.map((a, i) => (
            <div key={a.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 4px',
                color: '#fff',
              }}>
              <div style={{
                width: 18, fontSize: 11, fontWeight: 700,
                color: i < 3 ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.35)',
                fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {a.sampleCover ? <img src={a.sampleCover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {a.plays} {a.plays === 1 ? 'play' : 'plays'}
              </div>
            </div>
          ))}
        </StatsSection>
      ) : null}

      {/* Rediscover — only shown on All Time since the bounded ranges
          explicitly show what you ARE playing, not what you aren't. */}
      {stats.rediscover.length > 0 ? (
        <StatsSection
          title="Rediscover"
          subtitle="You used to play these — haven't in a while"
          accent={accent}
        >
          {stats.rediscover.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handlePlay(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '6px 4px',
                background: 'transparent', border: 'none',
                color: '#fff', cursor: 'pointer',
                textAlign: 'left', borderRadius: 7,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {t.coverArt ? <img src={t.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.title}
                </div>
                <div style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.5)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.artist}
                </div>
              </div>
            </button>
          ))}
        </StatsSection>
      ) : null}

      {/* Listening calendar — year heatmap of plays per day. Cells are
          intensity-tinted with the accent colour. Clicking a cell opens
          a small list of the tracks played that day, in order. Only
          shown on All Time since it's an all-history view by design. */}
      {range === 'all' ? (
        <ListeningCalendar
          playEvents={playEvents}
          library={library}
          accent={accent}
          onPlayTrack={handlePlay}
        />
      ) : null}

      {/* Footer summary */}
      <div style={{
        marginTop: 18, padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.04)',
        fontSize: 10.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.55,
      }}>
        {stats.favoritesCount > 0 ? (
          <div><strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{stats.favoritesCount}</strong> {stats.favoritesCount === 1 ? 'track' : 'tracks'} marked as favorite.</div>
        ) : null}
        {playlists.length > 0 ? (
          <div style={{ marginTop: 4 }}><strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{playlists.length}</strong> {playlists.length === 1 ? 'playlist' : 'playlists'} created.</div>
        ) : null}
      </div>

      {/* Reset stats — destructive action gated behind an inline confirm
          so a stray click doesn't wipe months of history. Only shown
          when the renderer wired up onResetStats (i.e. running in the
          full app, not a storybook preview). */}
      {onResetStats ? (
        <div style={{ marginTop: 14 }}>
          {!resetConfirmOpen ? (
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              style={{
                width: '100%', padding: '9px 12px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 9,
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11, fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(243, 114, 114, 0.06)';
                e.currentTarget.style.borderColor = 'rgba(243, 114, 114, 0.2)';
                e.currentTarget.style.color = '#f37272';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
              }}
            >
              Reset all stats
            </button>
          ) : (
            <div style={{
              padding: '12px',
              borderRadius: 9,
              background: 'rgba(243, 114, 114, 0.06)',
              border: '1px solid rgba(243, 114, 114, 0.2)',
              fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.55,
            }}>
              <div style={{ marginBottom: 8 }}>
                This will zero every track's play count and erase your play history. Your library itself stays. This can't be undone.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={() => setResetConfirmOpen(false)}
                  style={{
                    flex: 1, padding: '7px 10px',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 10.5, fontWeight: 600,
                    cursor: resetting ? 'default' : 'pointer',
                    opacity: resetting ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={doReset}
                  style={{
                    flex: 1, padding: '7px 10px',
                    background: '#f37272',
                    border: '1px solid #f37272',
                    borderRadius: 6,
                    color: '#fff',
                    fontSize: 10.5, fontWeight: 700,
                    cursor: resetting ? 'default' : 'pointer',
                    opacity: resetting ? 0.7 : 1,
                  }}
                >
                  {resetting ? 'Resetting…' : 'Reset stats'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** StatCard — large headline number above small label. */
function StatCard({ label, value, accent }) {
  return (
    <div style={{
      padding: '12px 10px',
      borderRadius: 10,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.06)',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 18, fontWeight: 700, color: '#fff',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginTop: 4,
      }}>
        {label}
      </div>
    </div>
  );
}

/** StatsSection — section header (small caps title, optional subtitle) + child rows. */
function StatsSection({ title, subtitle = null, accent, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
        color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
        marginBottom: subtitle ? 2 : 8, paddingLeft: 4,
      }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8, paddingLeft: 4,
        }}>
          {subtitle}
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}


/* =========================================================================
 *  ListeningCalendar — year heatmap of plays per day, GitHub-style.
 *
 *  Renders a 7-row × 53-column grid (days-of-week × weeks) covering the
 *  trailing 53 weeks. Each cell is intensity-tinted with the accent
 *  colour: 0 plays = nearly invisible, 1+ plays = progressively brighter
 *  bins (1, 2-3, 4-7, 8-14, 15+).
 *
 *  Clicking a cell selects that day; below the grid we then render a list
 *  of every track played on that day in chronological order. Click a
 *  track in the list to play it.
 *
 *  All derivation is from `playEvents` and `library` — no new state, no
 *  new persisted data.
 * ========================================================================= */
function ListeningCalendar({ playEvents = [], library = [], accent, onPlayTrack }) {
  const [selectedDay, setSelectedDay] = useState(null);

  // --- Build the day-keyed data ----------------------------------------
  // Group events by local-date string YYYY-MM-DD. Storing as ms-since-
  // epoch in the second field lets us find max() per day without a
  // second pass through the array.
  const { dayCounts, totalDays, totalPlays, maxPerDay, dayEvents } = useMemo(() => {
    const counts = new Map();      // dateKey → count
    const events = new Map();      // dateKey → [eventObj, ...]
    let max = 0;
    let plays = 0;
    for (const ev of (playEvents || [])) {
      if (!ev || typeof ev.id !== 'string' || !Number.isFinite(ev.at)) continue;
      const d = new Date(ev.at);
      // Local-date YYYY-MM-DD. Avoids UTC-rollover edge cases at the
      // user's time zone where a late-night play would shift to the
      // next day.
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!events.has(key)) events.set(key, []);
      events.get(key).push(ev);
      plays += 1;
      const c = counts.get(key);
      if (c > max) max = c;
    }
    return {
      dayCounts: counts,
      totalDays: counts.size,
      totalPlays: plays,
      maxPerDay: max,
      dayEvents: events,
    };
  }, [playEvents]);

  // --- Generate the grid cells ------------------------------------------
  // We render 53 columns; each column = one ISO-style week (Sun-start).
  // The rightmost column is the current week; fill earlier columns going
  // back from there. Build as a flat array of { dateKey, count, isToday,
  // isFuture } — easier to map than nested arrays.
  const { cells, monthLabels } = useMemo(() => {
    const COLS = 53;
    const ROWS = 7; // 0=Sun..6=Sat
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Anchor: the Sunday at the start of the current week.
    const todayDow = today.getDay();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - todayDow);

    const out = [];
    const months = []; // { col, label } — only when month changes at top of column

    let lastMonth = -1;
    for (let col = 0; col < COLS; col++) {
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(currentWeekStart.getDate() - (COLS - 1 - col) * 7);
      // Track month changes for x-axis labels — fire when the month at
      // the TOP of the column (i.e. the Sunday) differs from the previous
      // column's top month.
      const m = weekStart.getMonth();
      if (m !== lastMonth) {
        // Skip the very first column's label since it'd be cut off; only
        // emit when there's enough room to the right.
        if (col >= 0) {
          months.push({ col, label: weekStart.toLocaleDateString(undefined, { month: 'short' }) });
        }
        lastMonth = m;
      }
      for (let row = 0; row < ROWS; row++) {
        const cellDate = new Date(weekStart);
        cellDate.setDate(weekStart.getDate() + row);
        const isFuture = cellDate > today;
        const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        out.push({
          key,
          col, row,
          count: isFuture ? 0 : (dayCounts.get(key) || 0),
          isFuture,
          isToday: !isFuture && cellDate.getTime() === today.getTime(),
        });
      }
    }
    return { cells: out, monthLabels: months };
  }, [dayCounts]);

  // --- Bucket cell counts into intensity bins for colour scaling -------
  // Five bins so the colour ramp reads as discrete steps the user can
  // actually distinguish (a continuous ramp would mostly look "kind of
  // dark" everywhere unless the user has wildly varying play counts).
  const intensityFor = (count) => {
    if (count <= 0) return 0;
    if (count >= 15) return 4;
    if (count >= 8) return 3;
    if (count >= 4) return 2;
    if (count >= 2) return 1;
    return 0.5;
  };
  // Map intensity → background colour. 0 is nearly invisible (just a hint
  // the cell exists); 4 is full accent.
  const bgFor = (count, isFuture) => {
    if (isFuture) return 'rgba(255,255,255,0.015)';
    const i = intensityFor(count);
    if (i === 0) return 'rgba(255,255,255,0.04)';
    const alphas = { 0.5: 0.18, 1: 0.32, 2: 0.50, 3: 0.72, 4: 0.95 };
    return `rgba(${accent}, ${alphas[i]})`;
  };

  // --- Selected-day track list -----------------------------------------
  // When a cell is clicked, we resolve the day's events to library
  // tracks. Some events might point to tracks that have since been
  // deleted from the library — those are skipped silently.
  const selectedDayTracks = useMemo(() => {
    if (!selectedDay) return [];
    const events = dayEvents.get(selectedDay) || [];
    const out = [];
    for (const ev of events) {
      const t = library.find((x) => x.id === ev.id);
      if (t) out.push({ track: t, at: ev.at });
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  }, [selectedDay, dayEvents, library]);

  // Format a date key as "Sat, Mar 15" — long enough to read but short.
  const formatDayLabel = (key) => {
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  // Cell + gap sizing. Tuned so the grid fits comfortably in the
  // narrowest panel width (~240px) without scrolling.
  const CELL = 9;
  const GAP = 2;

  // Empty state — no plays yet.
  if (totalPlays === 0) {
    return (
      <StatsSection title="LISTENING CALENDAR" accent={accent}>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.45)',
          padding: '8px 4px', lineHeight: 1.55,
        }}>
          Once you start playing tracks, the last year of your listening will appear here as a heatmap.
        </div>
      </StatsSection>
    );
  }

  return (
    <StatsSection
      title="LISTENING CALENDAR"
      subtitle={`${totalPlays.toLocaleString()} ${totalPlays === 1 ? 'play' : 'plays'} across ${totalDays} ${totalDays === 1 ? 'day' : 'days'}`}
      accent={accent}
    >
      {/* The grid itself. Horizontal scroll if the panel is too narrow,
          but at default width (~340px) the 53 cols × 11px = ~583px will
          overflow — we let it scroll horizontally so the heatmap stays
          legible at its true scale. Mask edges fade out to soften the
          scroll boundaries. */}
      <div style={{
        overflowX: 'auto', overflowY: 'hidden',
        paddingTop: 14, paddingBottom: 4,
        // Subtle horizontal-fade mask so the right edge doesn't look
        // hard-cut when overflowing.
        maskImage: 'linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)',
      }}>
        <div style={{ display: 'inline-block', position: 'relative', paddingLeft: 4 }}>
          {/* Month labels above the grid. Positioned absolute by column. */}
          <div style={{
            position: 'relative', height: 11, marginBottom: 2,
            width: 53 * (CELL + GAP),
          }}>
            {monthLabels.map((m) => (
              <span
                key={`${m.col}-${m.label}`}
                style={{
                  position: 'absolute',
                  left: m.col * (CELL + GAP),
                  fontSize: 8.5, color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
          {/* Grid — column-major so React keys stay stable across renders. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(53, ${CELL}px)`,
            gridTemplateRows: `repeat(7, ${CELL}px)`,
            gridAutoFlow: 'column',
            gap: GAP,
          }}>
            {cells.map((cell) => {
              const isSelected = selectedDay === cell.key;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => {
                    if (cell.isFuture) return;
                    // Toggle off if clicking the already-selected day.
                    setSelectedDay(isSelected ? null : cell.key);
                  }}
                  disabled={cell.isFuture}
                  title={cell.isFuture
                    ? ''
                    : `${formatDayLabel(cell.key)} — ${cell.count} ${cell.count === 1 ? 'play' : 'plays'}`}
                  aria-label={`${formatDayLabel(cell.key)}, ${cell.count} plays`}
                  style={{
                    width: CELL, height: CELL,
                    borderRadius: 2,
                    background: bgFor(cell.count, cell.isFuture),
                    border: isSelected
                      ? `1px solid rgba(${accent}, 1)`
                      : cell.isToday
                        ? '1px solid rgba(255,255,255,0.4)'
                        : '1px solid transparent',
                    padding: 0,
                    cursor: cell.isFuture ? 'default' : 'pointer',
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                />
              );
            })}
          </div>
          {/* Legend below the grid. Five swatches showing the bins. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.4)',
          }}>
            <span>less</span>
            {[0, 0.5, 1, 2, 3, 4].map((bin) => (
              <span
                key={bin}
                style={{
                  display: 'inline-block', width: CELL, height: CELL,
                  borderRadius: 2,
                  background: bin === 0
                    ? 'rgba(255,255,255,0.04)'
                    : `rgba(${accent}, ${{ 0.5: 0.18, 1: 0.32, 2: 0.50, 3: 0.72, 4: 0.95 }[bin]})`,
                }}
              />
            ))}
            <span>more</span>
          </div>
        </div>
      </div>

      {/* Selected-day track list */}
      {selectedDay ? (
        <div style={{
          marginTop: 14, padding: 10, borderRadius: 9,
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#fff',
            marginBottom: selectedDayTracks.length === 0 ? 0 : 8,
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 8,
          }}>
            <span>{formatDayLabel(selectedDay)}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
              {selectedDayTracks.length} {selectedDayTracks.length === 1 ? 'play' : 'plays'}
            </span>
          </div>
          {selectedDayTracks.length === 0 ? (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              The tracks played that day are no longer in your library.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {selectedDayTracks.map(({ track, at }, i) => (
                <button
                  key={`${at}-${i}`}
                  type="button"
                  onClick={() => onPlayTrack?.(track)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 6px', borderRadius: 5,
                    background: 'transparent', border: 'none',
                    color: 'rgba(255,255,255,0.85)',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{
                    flexShrink: 0, width: 38,
                    fontSize: 9.5, color: 'rgba(255,255,255,0.4)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {formatTime(at)}
                  </span>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 11, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {track.title || 'Untitled'}
                  </span>
                  <span style={{
                    flexShrink: 0, fontSize: 10, color: 'rgba(255,255,255,0.45)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 100,
                  }}>
                    {track.artist || ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </StatsSection>
  );
}


function SettingsTab({
  uiFontId,
  onSetUiFontId,
  uiFontStack,
  onSpotifyCredsSaved,
  animateGradient = true,
  onSetAnimateGradient,
  beatReactive = false,
  onSetBeatReactive,
  coverFullscreenEnabled = true,
  onSetCoverFullscreenEnabled,
  pinnableTabsEnabled = false,
  onSetPinnableTabsEnabled,
  hiddenTabIds = [],
  onSetHiddenTabIds,
  dockCollapseAnimationEnabled = false,
  onSetDockCollapseAnimationEnabled,
  randomButtonEnabled = false,
  onSetRandomButtonEnabled,
  breathingDockPillEnabled = false,
  onSetBreathingDockPillEnabled,
  dockTransparentEnabled = false,
  onSetDockTransparentEnabled,
  liquidGlassDockEnabled = false,
  onSetLiquidGlassDockEnabled,
  journalTabEnabled = false,
  onSetJournalTabEnabled,
  queuePainterEnabled = false,
  onSetQueuePainterEnabled,
  recentPeekEnabled = true,
  onSetRecentPeekEnabled,
  recentPeekRange = '5',
  onSetRecentPeekRange,
  recentPeekCustomCount = 15,
  onSetRecentPeekCustomCount,
  firstTimeSparkleEnabled = false,
  onSetFirstTimeSparkleEnabled,
  trackOfMomentEnabled = false,
  onSetTrackOfMomentEnabled,
  statsRangeTabsEnabled = true,
  onSetStatsRangeTabsEnabled,
  clickToFilterEnabled = false,
  onSetClickToFilterEnabled,
  artistInfoEnabled = false,
  onSetArtistInfoEnabled,
  lastFmApiKey = '',
  onSetLastFmApiKey,
  creditsEnabled = false,
  onSetCreditsEnabled,
  videosEnabled = false,
  onSetVideosEnabled,
  edgeBleedEnabled = false,
  onSetEdgeBleedEnabled,
  ambientMode = 'idle',
  onSetAmbientMode,
  ambientCustomDelaySec = 30,
  onSetAmbientCustomDelaySec,
  twoPaneEnabled = false,
  onSetTwoPaneEnabled,
  discordPresenceEnabled = false,
  onSetDiscordPresenceEnabled,
  discordAppId = '',
  onSetDiscordAppId,
  imgbbApiKey = '',
  onSetImgbbApiKey,
  onReloadLibrary,
  panelResizableEnabled = false,
  onSetPanelResizableEnabled,
  dockDraggableEnabled = false,
  onSetDockDraggableEnabled,
  onClearLibrary,
  dockSide = 'right',
  onSetDockSide,
  contextMenusEnabled = true,
  onSetContextMenusEnabled,
}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saveState, setSaveState] = useState(''); // '' | 'saved' | 'error'
  const [saveMsg, setSaveMsg] = useState('');

  // Spotify user-OAuth state. Separate from the Client ID/Secret state
  // above because connecting/disconnecting the user account doesn't
  // touch the app credentials (which the client-credentials flow still
  // needs for search). Refreshed on mount via spotifyUserAuthState and
  // kept in sync via the onSpotifyUserAuthChanged event from main.
  const [spotifyUserConnected, setSpotifyUserConnected] = useState(false);
  const [spotifyUserName, setSpotifyUserName] = useState('');
  const [spotifyConnectBusy, setSpotifyConnectBusy] = useState(false);
  const [spotifyConnectMsg, setSpotifyConnectMsg] = useState('');

  useEffect(() => {
    if (!api?.spotifyUserAuthState) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.spotifyUserAuthState();
        if (cancelled) return;
        setSpotifyUserConnected(!!s?.connected);
        setSpotifyUserName(s?.displayName || '');
      } catch { /* ignore */ }
    })();
    // Subscribe to live updates when the OAuth flow completes in the
    // background. Returns an unsubscribe fn — pattern used elsewhere
    // for soulseek progress, fullscreen changes, etc.
    let unsub = null;
    if (typeof api.onSpotifyUserAuthChanged === 'function') {
      unsub = api.onSpotifyUserAuthChanged((payload) => {
        setSpotifyConnectBusy(false);
        if (payload?.connected) {
          setSpotifyUserConnected(true);
          setSpotifyUserName(payload.displayName || '');
          setSpotifyConnectMsg(`Connected as ${payload.displayName || 'your account'}.`);
          setTimeout(() => setSpotifyConnectMsg(''), 2500);
        } else {
          setSpotifyUserConnected(false);
          setSpotifyUserName('');
          if (payload?.error) {
            setSpotifyConnectMsg(payload.error);
            setTimeout(() => setSpotifyConnectMsg(''), 5000);
          }
        }
      });
    }
    return () => {
      cancelled = true;
      if (typeof unsub === 'function') unsub();
    };
  }, [api]);

  const beginSpotifyUserAuth = async () => {
    if (!api?.spotifyBeginUserAuth) return;
    setSpotifyConnectBusy(true);
    setSpotifyConnectMsg('Opening your browser\u2026');
    try {
      const r = await api.spotifyBeginUserAuth();
      if (!r?.ok) {
        setSpotifyConnectBusy(false);
        setSpotifyConnectMsg(r?.error || 'Could not start authorization.');
        setTimeout(() => setSpotifyConnectMsg(''), 5000);
      } else {
        setSpotifyConnectMsg('Waiting for you to approve in your browser\u2026');
      }
      // On success we DON'T clear busy here — the
      // onSpotifyUserAuthChanged listener will when the callback fires.
    } catch (e) {
      setSpotifyConnectBusy(false);
      setSpotifyConnectMsg(String(e?.message || e));
      setTimeout(() => setSpotifyConnectMsg(''), 5000);
    }
  };

  const disconnectSpotifyUser = async () => {
    if (!api?.spotifyDisconnectUser) return;
    try {
      await api.spotifyDisconnectUser();
      // The userAuthChanged event from main will flip our state, but
      // also do it locally for snappy feedback.
      setSpotifyUserConnected(false);
      setSpotifyUserName('');
      setSpotifyConnectMsg('Disconnected.');
      setTimeout(() => setSpotifyConnectMsg(''), 2000);
    } catch (e) {
      setSpotifyConnectMsg(String(e?.message || e));
    }
  };

  // Soulseek credentials — same load/save shape as Spotify above but a
  // different IPC channel. Stored separately so the user can configure
  // one without the other.
  const [slskUsername, setSlskUsername] = useState('');
  const [slskPassword, setSlskPassword] = useState('');
  const [slskSaveState, setSlskSaveState] = useState('');
  const [slskSaveMsg, setSlskSaveMsg] = useState('');
  const [slskTestState, setSlskTestState] = useState(''); // '' | 'testing' | 'ok' | 'fail'
  const [slskTestMsg, setSlskTestMsg] = useState('');
  // Bumps whenever custom fonts are added/removed so the picker & preview re-read them
  const [customFontsVersion, setCustomFontsVersion] = useState(0);

  // Clear-library confirmation modal state
  const [clearModalOpen, setClearModalOpen] = useState(false);

  // Settings search — filters visible Sections and ToggleRows by label
  // and description match. The query is lowercased once for case-
  // insensitive matching; an empty query disables filtering entirely.
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');

  // Lyrics provider preference. Lives in localStorage so it persists without
  // adding a DB column. The fetch handler in main.js reads this value from
  // each lyrics:fetch IPC payload.
  const [lyricsProvider, setLyricsProvider] = useState(() => {
    if (typeof window === 'undefined') return 'lrclib';
    return localStorage.getItem('immerse:lyricsProvider') || 'lrclib';
  });
  const updateLyricsProvider = (v) => {
    setLyricsProvider(v);
    if (typeof window !== 'undefined') {
      localStorage.setItem('immerse:lyricsProvider', v);
    }
  };

  // Always-show-picker preference. When on, every Find tab download opens
  // the candidate picker first instead of running tier auto-selection.
  // Useful when you don't trust the auto-pick at all and want eyes on every
  // selection. Stored in localStorage as '1' or absent.
  const [alwaysShowPicker, setAlwaysShowPicker] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('immerse:alwaysShowPicker') === '1';
  });
  const updateAlwaysShowPicker = (v) => {
    setAlwaysShowPicker(v);
    if (typeof window !== 'undefined') {
      if (v) localStorage.setItem('immerse:alwaysShowPicker', '1');
      else localStorage.removeItem('immerse:alwaysShowPicker');
    }
  };

  // Load existing creds when this tab mounts.
  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    (async () => {
      try {
        let creds;
        if (typeof api.spotifyGetCredentials === 'function') {
          creds = await api.spotifyGetCredentials();
        } else if (typeof api.invokeIpc === 'function') {
          creds = await api.invokeIpc('spotify:getCreds');
        }
        if (cancelled || !creds) return;
        setClientId(String(creds.clientId || ''));
        setClientSecret(String(creds.clientSecret || ''));
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  // Parallel load for Soulseek creds. Separate effect (rather than
  // bundled with Spotify) so a failure in one doesn't block the other.
  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    (async () => {
      try {
        let creds;
        if (typeof api.soulseekGetCredentials === 'function') {
          creds = await api.soulseekGetCredentials();
        } else if (typeof api.invokeIpc === 'function') {
          creds = await api.invokeIpc('soulseek:getCreds');
        }
        if (cancelled || !creds) return;
        setSlskUsername(String(creds.username || ''));
        setSlskPassword(String(creds.password || ''));
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const save = async () => {
    if (!api) {
      setSaveState('error');
      setSaveMsg('No Electron preload available.');
      return;
    }
    const payload = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
    try {
      let r;
      if (typeof api.spotifySetCredentials === 'function') r = await api.spotifySetCredentials(payload);
      else if (typeof api.invokeIpc === 'function') r = await api.invokeIpc('spotify:setCreds', payload);
      else {
        setSaveState('error');
        setSaveMsg('Spotify save not available in this build.');
        return;
      }
      if (r?.ok) {
        setSaveState('saved');
        setSaveMsg('Saved.');
        onSpotifyCredsSaved?.();
        setTimeout(() => { setSaveState(''); setSaveMsg(''); }, 1800);
      } else {
        setSaveState('error');
        setSaveMsg(r?.error || 'Could not save.');
      }
    } catch (e) {
      setSaveState('error');
      setSaveMsg(e?.message || String(e));
    }
  };

  const saveSoulseek = async () => {
    if (!api) {
      setSlskSaveState('error');
      setSlskSaveMsg('No Electron preload available.');
      return;
    }
    const payload = { username: slskUsername.trim(), password: slskPassword };
    try {
      let r;
      if (typeof api.soulseekSetCredentials === 'function') r = await api.soulseekSetCredentials(payload);
      else if (typeof api.invokeIpc === 'function') r = await api.invokeIpc('soulseek:setCreds', payload);
      else {
        setSlskSaveState('error');
        setSlskSaveMsg('Soulseek save not available in this build.');
        return;
      }
      if (r?.ok) {
        setSlskSaveState('saved');
        setSlskSaveMsg('Saved.');
        // Clear any stale "test failed" banner — new creds invalidate it.
        setSlskTestState('');
        setSlskTestMsg('');
        setTimeout(() => { setSlskSaveState(''); setSlskSaveMsg(''); }, 1800);
      } else {
        setSlskSaveState('error');
        setSlskSaveMsg(r?.error || 'Could not save.');
      }
    } catch (e) {
      setSlskSaveState('error');
      setSlskSaveMsg(e?.message || String(e));
    }
  };

  const testSoulseek = async () => {
    if (!api?.soulseekTest) {
      setSlskTestState('fail');
      setSlskTestMsg('Test not available in this build.');
      return;
    }
    setSlskTestState('testing');
    setSlskTestMsg('Connecting…');
    try {
      const r = await api.soulseekTest();
      if (r?.ok || r?.state === 'connected') {
        setSlskTestState('ok');
        setSlskTestMsg('Connected.');
      } else {
        setSlskTestState('fail');
        setSlskTestMsg(r?.error || 'Could not connect.');
      }
    } catch (e) {
      setSlskTestState('fail');
      setSlskTestMsg(e?.message || String(e));
    }
  };

  return (
    <SettingsSearchContext.Provider value={settingsSearchQuery.trim().toLowerCase()}>
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 14px 16px' }}>
      {/* Settings search — filters Sections and ToggleRows by label /
          description match. Empty query renders everything as normal.
          The query is propagated through context so we don't have to
          thread it through every Section / ToggleRow callsite. */}
      <div style={{ marginBottom: 14, position: 'relative' }}>
        <input
          type="text"
          value={settingsSearchQuery}
          onChange={(e) => setSettingsSearchQuery(e.target.value)}
          placeholder="Search settings…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 32px 8px 12px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#fff', fontSize: 12,
            outline: 'none',
          }}
        />
        {/* Clear button — only visible when there's text. Resets the
            query on click so the user can quickly bail out of search. */}
        {settingsSearchQuery ? (
          <button
            type="button"
            onClick={() => setSettingsSearchQuery('')}
            aria-label="Clear search"
            style={{
              position: 'absolute', right: 6, top: '50%',
              transform: 'translateY(-50%)',
              width: 22, height: 22, borderRadius: 11,
              padding: 0, border: 'none',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Appearance */}
      <Section title="APPEARANCE">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 8 }}>
          Rounded & Y2K faces. Loads from CDN once.
        </div>
        <FontPicker
          selectedId={uiFontId}
          onSelect={onSetUiFontId}
          refreshKey={customFontsVersion}
        />
        <div
          style={{
            fontFamily: uiFontStack, fontSize: 13, fontWeight: 500, color: '#e5e5e5',
            padding: '10px 11px', borderRadius: 9,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
            lineHeight: 1.4,
          }}
        >
          The quick brown fox — Immersive 0123456789
        </div>
      </Section>

      {/* Layout — placement of the navigation rail and panel */}
      <Section title="LAYOUT">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          Which side of the window the navigation rail and panel live on.
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button"
            onClick={() => onSetDockSide?.('left')}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 8,
              background: dockSide === 'left' ? 'rgba(120, 95, 220, 0.18)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${dockSide === 'left' ? 'rgba(155,130,240,0.4)' : 'rgba(255,255,255,0.06)'}`,
              color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
            }}>
            Left
          </button>
          <button type="button"
            onClick={() => onSetDockSide?.('right')}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 8,
              background: dockSide === 'right' ? 'rgba(120, 95, 220, 0.18)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${dockSide === 'right' ? 'rgba(155,130,240,0.4)' : 'rgba(255,255,255,0.06)'}`,
              color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
            }}>
            Right
          </button>
        </div>
      </Section>

      {/* Inputs — right-click menus, keyboard shortcuts, etc. */}
      <Section title="INPUTS">
        <ToggleRow
          label="Right-click menus"
          description="Right-click any track to access Play, Add to queue, Add to playlist, Edit, Remove, and other actions. When off, right-clicking does nothing."
          checked={contextMenusEnabled}
          onChange={(v) => onSetContextMenusEnabled?.(v)}
        />
      </Section>

      {/* Playback / Now playing visuals */}
      <Section title="PLAYBACK">
        <ToggleRow
          label="Animate colour field"
          description="Gently drifts the colour blobs behind the now-playing track."
          checked={animateGradient}
          onChange={(v) => onSetAnimateGradient?.(v)}
        />
        <ToggleRow
          label="Beat-reactive colour field"
          description="The colour blobs pulse subtly to the bass of the playing track. Requires Animate colour field to be on."
          checked={beatReactive}
          onChange={(v) => onSetBeatReactive?.(v)}
        />
        <ToggleRow
          label="Fullscreen cover on click"
          description="Click the cover art (or press F) to open it edge-to-edge. Esc to close."
          checked={coverFullscreenEnabled}
          onChange={(v) => onSetCoverFullscreenEnabled?.(v)}
        />
        <ToggleRow
          label="Edge-bleed colour band"
          description="A thin gradient strip at the bottom of the now-playing stage tinted with the current track’s accent colour, like the cover is leaking light into the bottom of the room. Hidden on the welcome screen."
          checked={edgeBleedEnabled}
          onChange={(v) => onSetEdgeBleedEnabled?.(v)}
        />
        <AmbientSettingRow
          mode={ambientMode}
          onSetMode={onSetAmbientMode}
          customDelaySec={ambientCustomDelaySec}
          onSetCustomDelaySec={onSetAmbientCustomDelaySec}
        />
      </Section>

      {/* Downloads */}
      <Section title="DOWNLOADS">
        <ToggleRow
          label="Always show video picker"
          description="When on, every Find tab download opens the candidate picker first instead of relying on automatic selection. Useful when you want to verify each pick yourself."
          checked={alwaysShowPicker}
          onChange={updateAlwaysShowPicker}
        />
      </Section>

      {/* Lyrics */}
      <Section title="LYRICS">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          Where to fetch lyrics from. LRClib has the best synced-lyrics
          coverage; Genius adds plain-only lyrics for older or obscure songs
          LRClib doesn't have.
        </div>
        <LyricsProviderPicker value={lyricsProvider} onChange={updateLyricsProvider} />
      </Section>

      {/* LIBRARY — toggles that change how the library list itself looks
          or behaves, plus library-adjacent affordances like the welcome
          screen's track-of-the-moment suggestion. */}
      <Section title="LIBRARY">
        <ToggleRow
          label="Two-pane library"
          description="Split the library Songs view in two: artists on the left, tracks of the selected artist on the right. Click an artist to filter; click “All artists” to clear. The A-Z rail hides when this is on (the artist list is the same browse axis)."
          checked={twoPaneEnabled}
          onChange={(v) => onSetTwoPaneEnabled?.(v)}
        />
        <ToggleRow
          label="Click artist / album to filter"
          description="Artist and album names in the library list and on the now-playing screen become clickable. Clicking one filters the library to tracks matching that name."
          checked={clickToFilterEnabled}
          onChange={(v) => onSetClickToFilterEnabled?.(v)}
        />
        <ToggleRow
          label="First-time-hearing sparkle"
          description="Tracks you’ve never played get a small pulsing dot next to their title. The dot disappears the first time you play the track past the scrobble threshold."
          checked={firstTimeSparkleEnabled}
          onChange={(v) => onSetFirstTimeSparkleEnabled?.(v)}
        />
        <ToggleRow
          label="Track of the moment"
          description="On the welcome screen, surface a single track chosen by time-of-day, day-of-week, and recent listening. Refreshes every four hours. Needs play history to suggest anything."
          checked={trackOfMomentEnabled}
          onChange={(v) => onSetTrackOfMomentEnabled?.(v)}
        />
      </Section>

      {/* STATS — settings that only affect the Stats panel. Currently
          just one, but kept as its own section so it's easy to find. */}
      <Section title="STATS">
        <ToggleRow
          label="Day / Week / Month tabs"
          description="Show the time-range tabs at the top of the Stats panel. Day covers plays since local midnight; Week resets every Monday at midnight; Month resets on the 1st at midnight — so a play at 11:55 PM tonight counts toward Day, but five minutes later rolls into yesterday and Day starts fresh. The All Time tab and the headline numbers (Tracks / Plays / Listened) are unaffected. Turn off to hide the tabs and keep Stats as an all-time view only."
          checked={statsRangeTabsEnabled}
          onChange={(v) => onSetStatsRangeTabsEnabled?.(v)}
        />
      </Section>

      {/* DOCK & PANEL — chrome around the player: the bottom dock, the
          side panel, the visibility / movement of those controls. */}
      <Section title="DOCK & PANEL">
        <ToggleRow
          label="Pinnable tabs"
          description="Right-click any tab in the dock (Find, New, Stats, Queue, Lyrics) to hide it. Library and Settings are always shown. Use the list below to reveal hidden tabs."
          checked={pinnableTabsEnabled}
          onChange={(v) => onSetPinnableTabsEnabled?.(v)}
        />
        {pinnableTabsEnabled ? (
          <DockTabVisibilityList
            hiddenTabIds={hiddenTabIds}
            onSetHiddenTabIds={onSetHiddenTabIds}
          />
        ) : null}
        <ToggleRow
          label="Collapse-to-edge animation"
          description="When the side panel collapses, scale it into the bottom dock pill instead of sliding off-screen — making the dock feel like the panel’s home."
          checked={dockCollapseAnimationEnabled}
          onChange={(v) => onSetDockCollapseAnimationEnabled?.(v)}
        />
        <ToggleRow
          label="Random play button"
          description="Add a dice button to the bottom dock. Click it to play a uniformly-random track from your library. The decision-fatigue cure."
          checked={randomButtonEnabled}
          onChange={(v) => onSetRandomButtonEnabled?.(v)}
        />
        <ToggleRow
          label="Breathing dock pill"
          description="The bottom dock subtly pulses with the playing track’s accent colour while music is playing. Most visible when the panel is collapsed."
          checked={breathingDockPillEnabled}
          onChange={(v) => onSetBreathingDockPillEnabled?.(v)}
        />
        <ToggleRow
          label="Transparent dock"
          description="Drop the dock pill’s solid dark backdrop so the cover-art-derived background bleeds through, matching how the side panel washes with the playing track’s colour."
          checked={dockTransparentEnabled}
          onChange={(v) => onSetDockTransparentEnabled?.(v)}
        />
        <ToggleRow
          label="Liquid glass dock"
          description="Replaces the dock’s flat surface with a multi-layer frosted-glass effect: heavy backdrop blur, a top-edge highlight, an accent-tinted inner glow, and a slow specular sheen that drifts across like light on real polished glass."
          checked={liquidGlassDockEnabled}
          onChange={(v) => onSetLiquidGlassDockEnabled?.(v)}
        />
        <ToggleRow
          label="Listening journal tab"
          description="Adds a Journal tab to the dock. Browse your play history day by day with auto-generated prose summaries and stat cards. Reads from your existing play events; nothing extra recorded."
          checked={journalTabEnabled}
          onChange={(v) => onSetJournalTabEnabled?.(v)}
        />
        <ToggleRow
          label="Queue painter view"
          description="Adds a list/painter switch to the Queue tab. Painter mode shows the queue as a horizontal duration-proportional strip so you can see at a glance how long until the next track plays."
          checked={queuePainterEnabled}
          onChange={(v) => onSetQueuePainterEnabled?.(v)}
        />
        <ToggleRow
          label="Recently-played peek"
          description="Adds a clock icon to the dock. Click it to pop up a small panel listing tracks you've played recently — handy for the 'wait, what was that song?' moment. Click any track to play it again."
          checked={recentPeekEnabled}
          onChange={(v) => onSetRecentPeekEnabled?.(v)}
        />
        {recentPeekEnabled ? (
          <RecentPeekRangeRow
            range={recentPeekRange}
            onSetRange={onSetRecentPeekRange}
            customCount={recentPeekCustomCount}
            onSetCustomCount={onSetRecentPeekCustomCount}
          />
        ) : null}
        <ToggleRow
          label="Resizable side panel"
          description="Adds a drag handle on the inner edge of the side panel. Drag it to make the panel narrower or wider; the size persists across reloads."
          checked={panelResizableEnabled}
          onChange={(v) => onSetPanelResizableEnabled?.(v)}
        />
        <ToggleRow
          label="Draggable dock"
          description="Pick up the bottom dock and move it anywhere on screen. Click-and-drag the dock body (not a button). The position persists. Turning this off resets the dock to its default bottom-center position."
          checked={dockDraggableEnabled}
          onChange={(v) => onSetDockDraggableEnabled?.(v)}
        />
      </Section>

      {/* TRACK PANEL — features that add data to the Track tab. Each one
          fetches from a different external service, so it's worth grouping
          them together: the user can decide as a unit how chatty they
          want the Track panel to be with the outside internet. */}
      <Section title="TRACK PANEL">
        <ToggleRow
          label="Online artist info (Last.fm)"
          description="In the Track tab, fetch artist biography, top tags, and listener count from Last.fm. Requires a free API key from last.fm/api. Requests are logged by Last.fm and tied to your IP; results are cached locally for 24 hours."
          checked={artistInfoEnabled}
          onChange={(v) => onSetArtistInfoEnabled?.(v)}
        />
        {artistInfoEnabled ? (
          <LastFmKeyField
            value={lastFmApiKey}
            onChange={onSetLastFmApiKey}
          />
        ) : null}
        <ToggleRow
          label="Track credits (MusicBrainz)"
          description="In the Track tab, show writers, producers, mix and mastering engineers, and named performers — sourced from MusicBrainz, the same database Spotify’s credits panel ultimately derives from. No API key needed; results cached locally for 7 days. Requests are sent at one per second to honour MusicBrainz etiquette."
          checked={creditsEnabled}
          onChange={(v) => onSetCreditsEnabled?.(v)}
        />
        <ToggleRow
          label="Track videos (YouTube)"
          description="In the Track tab, show a button that opens YouTube’s search results for the playing track in your default browser. The Track panel itself doesn’t load anything from YouTube — clicking the button is what takes you there."
          checked={videosEnabled}
          onChange={(v) => onSetVideosEnabled?.(v)}
        />
      </Section>

      {/* DISCORD — its own section because the app ID field doesn't make
          sense bundled with anything else, and because Discord-specific
          troubleshooting tends to be the most-searched-for setting. */}
      <Section title="DISCORD">
        <ToggleRow
          label="Rich presence"
          description="Broadcast the playing track to your Discord status, visible to friends and in voice channels. Requires Discord desktop running and your own Application ID from discord.com/developers. Title, artist, album, and elapsed time are sent — nothing else."
          checked={discordPresenceEnabled}
          onChange={(v) => onSetDiscordPresenceEnabled?.(v)}
        />
        {discordPresenceEnabled ? (
          <>
            <DiscordAppIdField
              value={discordAppId}
              onChange={onSetDiscordAppId}
            />
            <ImgbbApiKeyField
              value={imgbbApiKey}
              onChange={onSetImgbbApiKey}
            />
          </>
        ) : null}
      </Section>

      {/* Custom Fonts */}
      <Section title="CUSTOM FONTS">
        <CustomFontsManager
          onChange={() => setCustomFontsVersion((v) => v + 1)}
          version={customFontsVersion}
        />
      </Section>

      {/* Spotify API */}
      <Section title="SPOTIFY API">
        <SpotifySetupGuide />
        {!api ? (
          <Banner color="#f37272" bg="rgba(243,114,114,0.1)">
            No Electron preload available.
          </Banner>
        ) : (
          <>
            <FieldLabel>Client ID</FieldLabel>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              placeholder="Paste Client ID"
              style={inputStyle}
            />
            <FieldLabel>Client Secret</FieldLabel>
            <input
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="Paste Client Secret"
              style={inputStyle}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
            }}
            >
              <button
                type="button"
                onClick={save}
                style={{
                  padding: '6px 14px', borderRadius: 9, border: '1px solid rgba(29,185,84,0.35)',
                  background: 'rgba(29,185,84,0.18)', color: '#1db954',
                  fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Save
              </button>
              {saveState === 'saved' ? (
                <span style={{ fontSize: 10.5, color: '#1db954' }}>{saveMsg}</span>
              ) : null}
              {saveState === 'error' ? (
                <span style={{ fontSize: 10.5, color: '#f37272' }}>{saveMsg}</span>
              ) : null}
            </div>

            {/* User OAuth: needed for playlist import (client-credentials
                returns 403 on /v1/playlists/{id}/tracks since Nov 2024). */}
            <div style={{
              marginTop: 14, paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
              <FieldLabel>Spotify account (for playlist import)</FieldLabel>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                marginTop: 2,
              }}>
                {spotifyUserConnected ? (
                  <>
                    <span style={{ fontSize: 11.5, color: '#1db954' }}>
                      Connected{spotifyUserName ? ` as ${spotifyUserName}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={disconnectSpotifyUser}
                      style={{
                        padding: '6px 14px', borderRadius: 9,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'transparent',
                        color: 'rgba(255,255,255,0.75)',
                        fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={beginSpotifyUserAuth}
                    disabled={spotifyConnectBusy || !clientId.trim()}
                    title={!clientId.trim() ? 'Save your Client ID first.' : ''}
                    style={{
                      padding: '6px 14px', borderRadius: 9,
                      border: '1px solid rgba(29,185,84,0.35)',
                      background: 'rgba(29,185,84,0.18)', color: '#1db954',
                      fontSize: 11.5, fontWeight: 700,
                      cursor: (spotifyConnectBusy || !clientId.trim()) ? 'not-allowed' : 'pointer',
                      opacity: (spotifyConnectBusy || !clientId.trim()) ? 0.6 : 1,
                    }}
                  >
                    {spotifyConnectBusy ? 'Connecting\u2026' : 'Connect Spotify account'}
                  </button>
                )}
                {spotifyConnectMsg ? (
                  <span style={{
                    fontSize: 10.5,
                    color: spotifyConnectMsg.toLowerCase().includes('error')
                      || spotifyConnectMsg.toLowerCase().includes('failed')
                      || spotifyConnectMsg.toLowerCase().includes('could not')
                      ? '#f37272'
                      : 'rgba(255,255,255,0.55)',
                  }}>
                    {spotifyConnectMsg}
                  </span>
                ) : null}
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Soulseek account */}
      <Section title="SOULSEEK">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 10 }}>
          Sign up for a free account at
          {' '}
          <a href="https://www.slsknet.org/news/node/1" target="_blank" rel="noreferrer" style={{ color: '#d97706' }}>slsknet.org</a>
          {' '}
          (register through the official client, then paste the same username and password here).
        </div>
        {!api ? (
          <Banner color="#f37272" bg="rgba(243,114,114,0.1)">
            No Electron preload available.
          </Banner>
        ) : (
          <>
            <FieldLabel>Username</FieldLabel>
            <input
              value={slskUsername}
              onChange={(e) => setSlskUsername(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Soulseek username"
              style={inputStyle}
            />
            <FieldLabel>Password</FieldLabel>
            <input
              value={slskPassword}
              onChange={(e) => setSlskPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="Soulseek password"
              style={inputStyle}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap',
            }}>
              <button
                type="button"
                onClick={saveSoulseek}
                style={{
                  padding: '6px 14px', borderRadius: 9, border: '1px solid rgba(217,119,6,0.35)',
                  background: 'rgba(217,119,6,0.18)', color: '#d97706',
                  fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={testSoulseek}
                disabled={slskTestState === 'testing'}
                style={{
                  padding: '6px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)',
                  fontSize: 11.5, fontWeight: 600,
                  cursor: slskTestState === 'testing' ? 'wait' : 'pointer',
                }}
              >
                {slskTestState === 'testing' ? 'Testing…' : 'Test connection'}
              </button>
              {slskSaveState === 'saved' ? (
                <span style={{ fontSize: 10.5, color: '#d97706' }}>{slskSaveMsg}</span>
              ) : null}
              {slskSaveState === 'error' ? (
                <span style={{ fontSize: 10.5, color: '#f37272' }}>{slskSaveMsg}</span>
              ) : null}
              {slskTestState === 'ok' ? (
                <span style={{ fontSize: 10.5, color: '#22c55e' }}>{slskTestMsg}</span>
              ) : null}
              {slskTestState === 'fail' ? (
                <span style={{ fontSize: 10.5, color: '#f37272' }}>{slskTestMsg}</span>
              ) : null}
            </div>
          </>
        )}
      </Section>

      {/* Updates — manual "check for updates" affordance for users
          who don't want to wait for the hourly auto-check, plus current
          version display. The auto-update toast in App.jsx handles the
          install-prompt UX; this section is for visibility/control. */}
      <UpdatesSection />

      {/* Library maintenance — re-scan files for fresh metadata. Useful
          after improving the parser or when files have been re-tagged
          externally. */}
      <Section title="LIBRARY MAINTENANCE">
        <RescanMetadataButton onReloadLibrary={onReloadLibrary} />
      </Section>

      {/* Danger zone — only exposed if the IPC is available (Electron) */}
      {typeof onClearLibrary === 'function' ? (
        <Section title="DANGER ZONE">
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
            Empty your entire library. Playlists, favorites, play counts,
            lyrics, and follow overrides are all removed.
          </div>
          <button type="button"
            onClick={() => setClearModalOpen(true)}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 9,
              border: '1px solid rgba(243,114,114,0.35)',
              background: 'rgba(243,114,114,0.08)', color: '#f37272',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(243,114,114,0.16)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(243,114,114,0.08)'; }}>
            Clear library…
          </button>
        </Section>
      ) : null}

      {clearModalOpen ? (
        <ClearLibraryModal
          onConfirm={onClearLibrary}
          onClose={() => setClearModalOpen(false)}
        />
      ) : null}

      {/* No-results fallback — when a search query is active and nothing
          matched, none of the Sections will have rendered. Show a calm
          empty state so the user understands the page isn't broken. We
          detect this via querying the rendered DOM would be wrong, so
          instead we run the same predicate the Sections do — but here
          it's simplest to just check the query against the section
          titles + the predefined toggle labels. The real test: if every
          Section returned null, the search box is the only thing left
          on screen; rendering this prompt below is a no-op for a
          successful match (since Sections are above). */}
      <SettingsSearchEmptyState query={settingsSearchQuery} />
    </div>
    </SettingsSearchContext.Provider>
  );
}

/**
 * SettingsSearchEmptyState — surface a "no matches" message when the
 * user's search query matches no rendered Section or ToggleRow.
 *
 * Implementation: this component lives BELOW all the Sections in the
 * render order. We can't easily know whether any Sections rendered
 * (we'd need a ref/registry), so instead we statically check the
 * query against the canonical list of search-targets — section titles
 * and toggle labels. If the query matches nothing in that list, we
 * show the empty state.
 *
 * The list is static (no need to re-derive at runtime) so we just
 * hard-code it. Adding a new section/toggle requires updating this
 * list, which is annoying but acceptable for the small number of
 * entries.
 */
function SettingsSearchEmptyState({ query }) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  // Canonical list of section titles + toggle labels currently in the
  // SettingsTab. If a search matches anywhere here, at least one
  // Section will render, so the empty state should NOT render.
  const haystack = [
    'appearance', 'rounded', 'y2k',
    'layout', 'context menus', 'side dock',
    'playback', 'visualizer', 'beat-reactive', 'cover fullscreen',
    'lyrics', 'lrclib', 'genius',
    'features',
    'pinnable tabs', 'collapse-to-edge', 'random play', 'breathing dock',
    'first-time-hearing', 'track of the moment', 'click artist',
    'online artist info', 'last.fm', 'lastfm',
    'track credits', 'musicbrainz',
    'track videos', 'youtube',
    'edge-bleed', 'colour band',
    'two-pane', 'two pane', 'split', 'artists',
    'discord', 'rich presence', 'application id',
    'resizable side panel', 'draggable dock',
    'custom fonts', 'fonts',
    'spotify', 'api', 'client',
    'downloads', 'yt-dlp', 'ffmpeg', 'tools',
    'library maintenance', 're-scan', 'metadata',
    'danger zone', 'clear library',
  ];
  const anyMatch = haystack.some((s) => s.includes(q));
  if (anyMatch) return null;
  return (
    <div style={{
      padding: '24px 16px', textAlign: 'center',
      color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 1.55,
    }}>
      No settings match “{query}”.
    </div>
  );
}

/**
 * Tooltip — wraps any child element and shows a styled glass tooltip on
 * hover after a short delay. Replaces the native browser `title=""`
 * tooltip everywhere it was visually jarring (transport buttons, dock
 * bar buttons, etc.). Native `title=""` still works fine for things like
 * truncated track row text where free OS tooltips are appropriate.
 *
 * Behavior:
 *   - 400ms hover delay before appearing (matches OS tooltip timing so
 *     the user doesn't get spammed with tooltips while skimming)
 *   - 120ms fade-in
 *   - Disappears immediately on mouse-leave (no exit fade — feels snappier)
 *   - Auto-flips above the target if the target is in the bottom 30% of
 *     the viewport (avoids the tooltip getting clipped at the screen edge)
 *   - Only one tooltip visible at a time; the wrapper component is
 *     stateful per-instance, but mouse-leave cancels pending appearances
 *
 * Usage:
 *   <Tooltip label="Shuffle"><button>...</button></Tooltip>
 *
 * Or for components that already accept a `title` prop, integrate the
 * Tooltip rendering inside the component itself (see BottomDockBtn).
 */
function Tooltip({ label, children, side = 'auto', delay = 400 }) {
  const wrapRef = useRef(null);
  const timerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: '100%', bottom: 'auto', marginTop: 6, marginBottom: 0 });

  const show = () => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      // At the moment of appearance, decide above-or-below based on
      // viewport position. If the target is in the bottom third, flip up.
      if (wrapRef.current && side === 'auto') {
        const rect = wrapRef.current.getBoundingClientRect();
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        if (rect.bottom > viewportH * 0.7) {
          setPosition({ top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 });
        } else {
          setPosition({ top: '100%', bottom: 'auto', marginTop: 6, marginBottom: 0 });
        }
      } else if (side === 'top') {
        setPosition({ top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 });
      }
      setVisible(true);
      timerRef.current = null;
    }, delay);
  };

  const hide = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setVisible(false);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!label) return children;

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      {children}
      {visible ? (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: position.top, bottom: position.bottom,
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: position.marginTop, marginBottom: position.marginBottom,
            padding: '5px 9px',
            borderRadius: 7,
            background: 'rgba(18, 18, 20, 0.94)',
            backdropFilter: 'blur(20px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
            color: '#fff',
            fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 100,
            animation: 'imm-tt-in 120ms ease-out',
          }}
        >
          <style>{`
            @keyframes imm-tt-in {
              from { opacity: 0; transform: translateX(-50%) translateY(${position.bottom === 'auto' ? '-3px' : '3px'}); }
              to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
          `}</style>
          {label}
        </span>
      ) : null}
    </span>
  );
}

/**
 * HeartSlider — the seek bar / volume slider with a heart-shaped thumb.
 *
 * Click-to-jump and drag-to-scrub both supported. While dragging, the
 * value is reported live so the underlying audio (or volume) updates in
 * real time. The heart thumb is an inline SVG positioned by left%, scaling
 * up slightly on hover/drag so the user knows it's grabbable.
 *
 * Props:
 *   value      — current value (0..max)
 *   max        — upper bound. If 0 / falsy, the slider becomes inert.
 *   onChange   — fn(newValue) called continuously during drag and on click.
 *                Called as the user drags so audio/volume tracks the cursor.
 *   accent     — RGB string used to tint the filled portion + heart.
 *   ariaLabel  — accessibility label
 *   thumbSize  — heart width/height in px (default 12)
 */
function HeartSlider({ value = 0, max = 0, onChange, accent = '255, 255, 255', ariaLabel = 'Slider', thumbSize = 12 }) {
  const trackRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const inert = !max;

  // Convert pointer X to a value within [0, max]. Clamped so dragging
  // outside the track bounds still produces in-range values.
  const valueFromEvent = useCallback((clientX) => {
    if (!trackRef.current || !max) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * max;
  }, [max]);

  const handlePointerDown = (e) => {
    if (inert) return;
    e.preventDefault();
    // Use pointer capture so we keep getting move/up events even if the
    // pointer leaves the track. setPointerCapture on the track element.
    try { trackRef.current?.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    setDragging(true);
    onChange?.(valueFromEvent(e.clientX));
  };

  const handlePointerMove = (e) => {
    if (!dragging) return;
    onChange?.(valueFromEvent(e.clientX));
  };

  const handlePointerUp = (e) => {
    if (!dragging) return;
    setDragging(false);
    try { trackRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  const handleKey = (e) => {
    if (inert) return;
    const step = max / 100; // 1% steps for keyboard
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange?.(Math.min(max, value + step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange?.(Math.max(0, value - step));
    } else if (e.key === 'Home') {
      e.preventDefault(); onChange?.(0);
    } else if (e.key === 'End') {
      e.preventDefault(); onChange?.(max);
    }
  };

  // Thumb visible when hovered or dragging — keeps the bar visually
  // minimal at rest (Spotify-style) and reveals the heart on intent.
  const thumbVisible = hovered || dragging;
  const thumbScale = dragging ? 1.25 : (hovered ? 1.1 : 1);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={inert ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max || 1}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={handleKey}
      style={{
        flex: 1, height: 16, position: 'relative', display: 'flex', alignItems: 'center',
        cursor: inert ? 'default' : 'pointer',
        // Prevent text-selection / image-drag mid-drag
        userSelect: 'none', WebkitUserSelect: 'none',
        outline: 'none',
        // Subtle focus ring via box-shadow on hover only — full focus
        // would clash with the cover canvas.
        touchAction: 'none',
      }}
    >
      {/* Track (background) */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 2, top: '50%', marginTop: -1,
        background: 'rgba(255,255,255,0.14)', borderRadius: 2,
        transition: 'height 0.15s',
      }} />
      {/* Filled portion */}
      <div style={{
        position: 'absolute', left: 0, width: `${pct}%`, height: 2, top: '50%', marginTop: -1,
        background: thumbVisible ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.95)',
        borderRadius: 2, maxWidth: '100%',
        transition: 'background 0.18s, height 0.15s',
        // Slight glow when grabbing so the bar feels alive
        boxShadow: dragging ? `0 0 8px rgba(${accent}, 0.45)` : 'none',
      }} />
      {/* Heart thumb. Positioned by left% with translate to center. SVG
          is filled with the accent color when active, white otherwise.
          Scale animation gives it a "pop" on grab. */}
      <div style={{
        position: 'absolute',
        left: `${pct}%`,
        top: '50%',
        transform: `translate(-50%, -50%) scale(${thumbScale})`,
        opacity: thumbVisible ? 1 : 0,
        transition: 'opacity 0.18s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
        pointerEvents: 'none',
        // Tiny drop-shadow so the heart reads against any cover-art color
        filter: dragging
          ? `drop-shadow(0 2px 4px rgba(0,0,0,0.5)) drop-shadow(0 0 6px rgba(${accent}, 0.6))`
          : 'drop-shadow(0 1px 3px rgba(0,0,0,0.45))',
      }}>
        <svg
          width={thumbSize} height={thumbSize}
          viewBox="0 0 24 24"
          fill={dragging ? `rgb(${accent})` : '#fff'}
          aria-hidden
          style={{ display: 'block' }}
        >
          {/* Classic heart path */}
          <path d="M12 21s-7-4.35-9.5-8.5C.92 9.4 2.18 5 6 5c2.04 0 3.4 1.13 4.5 2.5C11.6 6.13 12.96 5 15 5c3.82 0 5.08 4.4 3.5 7.5C19 16.65 12 21 12 21z" />
        </svg>
      </div>
    </div>
  );
}


/**
 * ExplicitBadge — small "E" indicator that appears next to a track title when
 * the streaming service flagged the song as explicit. Inline-block, ~14px
 * square, white text on a translucent dark plate. Only shown when
 * `track.explicit === 1`; we deliberately don't show a "clean" badge for
 * `=== 0` because the absence of the E is itself the signal.
 */
function ExplicitBadge() {
  return (
    <span
      title="Explicit"
      aria-label="Explicit lyrics"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, borderRadius: 3,
        background: 'rgba(255, 255, 255, 0.18)',
        color: 'rgba(255, 255, 255, 0.85)',
        fontSize: 8.5, fontWeight: 700, letterSpacing: '-0.02em',
        flexShrink: 0,
        lineHeight: 1, paddingTop: 1,
        userSelect: 'none',
      }}
    >E</span>
  );
}

/**
 * Settings search context. The SettingsTab provides the lowercased query
 * string; Section and ToggleRow consume it. Empty string = no filtering.
 *
 * We use a context (not a prop) so we don't have to thread `query` through
 * every Section / ToggleRow callsite (there are ~50 of them across the
 * SettingsTab). Sections check if they have any surviving children and
 * hide themselves if not. ToggleRows check if their own label/description
 * matches and hide themselves if not (unless the section title matched,
 * in which case the section "wins" and shows everything).
 */
const SettingsSearchContext = React.createContext('');

/**
 * Section — settings section header + children. Self-filtering when a
 * search query is active in SettingsSearchContext. If the title matches
 * the query, ALL children render unfiltered. Otherwise, filtering is
 * delegated to each ToggleRow child via the context (and non-ToggleRow
 * children are hidden, since we can't introspect their searchability).
 *
 * Sections with zero rendered children when filtering hide entirely so
 * empty section headers don't clutter the search results.
 */
function Section({ title, children }) {
  const query = useContext(SettingsSearchContext);
  const hasQuery = query && query.length > 0;
  const titleMatches = hasQuery && String(title || '').toLowerCase().includes(query);

  // When there's a query and the title doesn't match, we need to
  // determine whether any child will actually render before deciding
  // to render the section frame. Iterate children; for ToggleRows we
  // can introspect their props; non-ToggleRows are hidden during
  // search since we can't tell whether they match.
  let childrenToRender = children;
  let hasVisibleChildren = true;

  if (hasQuery && !titleMatches) {
    const filtered = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const isToggle = child.type === ToggleRow;
      if (isToggle) {
        const label = String(child.props.label || '').toLowerCase();
        const desc = String(child.props.description || '').toLowerCase();
        if (label.includes(query) || desc.includes(query)) {
          filtered.push(child);
        }
      }
      // Non-ToggleRow children (FontPicker, LastFmKeyField, plain divs,
      // headings, etc.) are skipped during search. They'll come back
      // automatically if the user matches the section title or clears
      // the query.
    });
    childrenToRender = filtered;
    hasVisibleChildren = filtered.length > 0;
  }

  if (!hasVisibleChildren) return null;

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
        color: 'rgba(255,255,255,0.45)', marginBottom: 10,
      }}
      >
        {title}
      </div>
      {/* Flex column with a small gap separates ToggleRows (and other
          child elements like inline help, key fields, pickers) so their
          borders stop running into each other. Previously children
          stacked with zero spacing, which made adjacent rows look like
          one continuous rectangle with internal dividers. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {childrenToRender}
      </div>
    </div>
  );
}

/**
 * ContextMenu — right-click popup menu.
 *
 * Positioned at the cursor (anchorX/Y from the contextmenu event), with
 * automatic edge-flipping so it stays on-screen even near the window edge.
 * Glass styling matches the dock panel.
 *
 * Items support icons, dividers, danger styling (red text), disabled state,
 * and nested submenus (one level deep, opens to the right or left depending
 * on space).
 *
 * Usage:
 *   <ContextMenu
 *     anchorX={300} anchorY={120}
 *     items={[
 *       { icon: <PlayIcon />, label: 'Play', onClick: () => play(track) },
 *       { divider: true },
 *       { label: 'Remove', danger: true, onClick: () => remove(track) },
 *     ]}
 *     onClose={() => setMenu(null)}
 *   />
 */
function ContextMenu({ anchorX, anchorY, items, onClose }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ left: anchorX, top: anchorY });
  const [openSubmenu, setOpenSubmenu] = useState(null); // index of open submenu item

  // Close on outside click and Esc
  useEffect(() => {
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    // mousedown so the click that opens another menu (which would also
    // immediately close this one) is handled in the right order.
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Edge-flip — measure the menu after mount and reposition if it'd overflow
  // the viewport. Done in a layout effect so the user never sees it offscreen.
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const margin = 8;
    let left = anchorX;
    let top = anchorY;
    if (anchorX + rect.width + margin > vw) left = Math.max(margin, vw - rect.width - margin);
    if (anchorY + rect.height + margin > vh) top = Math.max(margin, anchorY - rect.height);
    setPosition({ left, top });
  }, [anchorX, anchorY]);

  return (
    <div
      ref={menuRef}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 200,
        minWidth: 180,
        padding: 4,
        borderRadius: 9,
        background: 'rgba(20, 20, 22, 0.96)',
        backdropFilter: 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
        animation: 'imm-ctx-in 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <style>{`
        @keyframes imm-ctx-in {
          from { opacity: 0; transform: scale(0.97) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={`d-${i}`} style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 2px' }} />;
        }
        const isOpen = openSubmenu === i;
        return (
          <ContextMenuItem
            key={item.key || i}
            item={item}
            isSubmenuOpen={isOpen}
            onSubmenuOpen={() => setOpenSubmenu(i)}
            onSubmenuClose={() => setOpenSubmenu(null)}
            closeMenu={onClose}
            onAction={() => {
              if (item.disabled) return;
              if (!item.submenu) {
                item.onClick?.();
                onClose?.();
              }
            }}
          />
        );
      })}
    </div>
  );
}

/** Single row in the context menu. Splits out so submenu hover-state is local. */
function ContextMenuItem({ item, isSubmenuOpen, onSubmenuOpen, onSubmenuClose, onAction, closeMenu }) {
  const [hovered, setHovered] = useState(false);
  const itemRef = useRef(null);
  const submenuTimerRef = useRef(null);
  // The submenu needs to know the parent row's rect to position itself.
  // Reading `itemRef.current` directly inside the JSX is unreliable (the ref
  // may be null on the first render after isSubmenuOpen flips, and accessing
  // refs during render is a React anti-pattern). Instead we measure the rect
  // imperatively when the submenu becomes open, store it in state, and pass
  // it down. This guarantees the submenu always has a valid rect by the time
  // it mounts.
  const [submenuParentRect, setSubmenuParentRect] = useState(null);

  useLayoutEffect(() => {
    if (isSubmenuOpen && itemRef.current) {
      setSubmenuParentRect(itemRef.current.getBoundingClientRect());
    } else if (!isSubmenuOpen) {
      setSubmenuParentRect(null);
    }
  }, [isSubmenuOpen]);

  const handleMouseEnter = () => {
    setHovered(true);
    // Open submenu after a short delay (don't open on accidental pass-over)
    if (item.submenu && !isSubmenuOpen) {
      submenuTimerRef.current = setTimeout(() => {
        onSubmenuOpen?.();
      }, 180);
    }
  };
  const handleMouseLeave = () => {
    setHovered(false);
    if (submenuTimerRef.current) {
      clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
  };

  // Click handler. For leaf items: fire the action. For submenu items: also
  // toggle the submenu open immediately, in case the hover-delay path didn't
  // fire (e.g. user clicks the row before the 180ms timer elapses, or the
  // hover never registered for some reason).
  const handleClick = (e) => {
    e.stopPropagation();
    if (item.disabled) return;
    if (item.submenu) {
      // Cancel any pending hover-open timer so we don't double-fire.
      if (submenuTimerRef.current) {
        clearTimeout(submenuTimerRef.current);
        submenuTimerRef.current = null;
      }
      if (isSubmenuOpen) onSubmenuClose?.();
      else onSubmenuOpen?.();
      return;
    }
    onAction?.();
  };

  useEffect(() => () => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
  }, []);

  // For the danger style, color the text red on hover.
  const baseColor = item.disabled ? 'rgba(255,255,255,0.3)' : (item.danger ? '#f37272' : 'rgba(255,255,255,0.92)');
  const hoverBg = item.disabled
    ? 'transparent'
    : (item.danger ? 'rgba(243, 114, 114, 0.12)' : 'rgba(255,255,255,0.07)');

  return (
    <div
      ref={itemRef}
      role="menuitem"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '6px 10px',
        borderRadius: 6,
        color: baseColor,
        cursor: item.disabled ? 'default' : 'pointer',
        background: hovered ? hoverBg : 'transparent',
        fontSize: 11.5, fontWeight: 500,
        transition: 'background 0.1s, color 0.1s',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {item.icon ? (
        <span style={{
          width: 14, height: 14, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'currentColor',
        }}>
          {item.icon}
        </span>
      ) : <span style={{ width: 14, flexShrink: 0 }} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
      {item.shortcut ? (
        <span style={{
          fontSize: 10, color: 'rgba(255,255,255,0.4)',
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {item.shortcut}
        </span>
      ) : null}
      {item.submenu ? (
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }} aria-hidden>▶</span>
      ) : null}

      {/* Submenu — opens to the right by default. Only renders when this
          row's submenu state is open AND we have a measured parent rect.
          Auto-flips left if right-side would overflow. */}
      {item.submenu && isSubmenuOpen && submenuParentRect ? (
        <ContextSubmenu
          parentRect={submenuParentRect}
          items={item.submenu}
          onClose={onSubmenuClose}
          onAction={(subItem) => {
            if (subItem.disabled) return;
            // Fire the action FIRST so it doesn't get cancelled by the
            // unmount when we close the submenu / parent menu below.
            try { subItem.onClick?.(); } catch { /* ignore */ }
            onSubmenuClose?.();
            // Always bubble up to close the parent menu too. Previously
            // ContextMenu's own onAction short-circuited (via `if
            // (!item.submenu)`) when the parent had a submenu, leaving the
            // parent menu open after a submenu pick — confusing UX. Call
            // closeMenu directly so parent always closes on submenu action.
            closeMenu?.();
          }}
        />
      ) : null}
    </div>
  );
}

/** Submenu — same visual as ContextMenu but anchored to a parent row.
 *
 * Note: we intentionally do NOT close on `onMouseLeave` of the submenu
 * container alone. A user may briefly cross a 1-2px gap between the parent
 * row and submenu, or scroll a long playlist list — both should not dismiss
 * the menu. The parent menu's outside-click listener handles real dismissal.
 * Hover hand-off back to the parent row is handled by ContextMenuItem.
 */
function ContextSubmenu({ parentRect, items, onClose, onAction }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: parentRect.right + 4, top: parentRect.top - 4 });
  const [hoveredIdx, setHoveredIdx] = useState(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const margin = 8;
    let left = parentRect.right + 4;
    let top = parentRect.top - 4;
    if (left + rect.width + margin > vw) left = Math.max(margin, parentRect.left - rect.width - 4);
    if (top + rect.height + margin > vh) top = Math.max(margin, vh - rect.height - margin);
    setPos({ left, top });
  }, [parentRect]);

  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.left, top: pos.top,
        minWidth: 180, maxHeight: 320, overflowY: 'auto',
        padding: 4,
        borderRadius: 9,
        background: 'rgba(20, 20, 22, 0.96)',
        backdropFilter: 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
        animation: 'imm-ctx-in 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 201,
        scrollbarWidth: 'thin',
      }}
    >
      {items.length === 0 ? (
        <div style={{
          padding: '8px 10px', fontSize: 10.5,
          color: 'rgba(255,255,255,0.4)', fontStyle: 'italic',
        }}>
          Empty
        </div>
      ) : items.map((sub, i) => {
        const isHov = hoveredIdx === i;
        const baseColor = sub.disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.92)';
        return (
          <div
            key={sub.key || i}
            role="menuitem"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={() => onAction(sub)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '6px 10px',
              borderRadius: 6,
              color: baseColor,
              cursor: sub.disabled ? 'default' : 'pointer',
              background: isHov && !sub.disabled ? 'rgba(255,255,255,0.07)' : 'transparent',
              fontSize: 11.5, fontWeight: 500,
              transition: 'background 0.1s',
              userSelect: 'none',
            }}
          >
            {sub.icon ? (
              <span style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {sub.icon}
              </span>
            ) : <span style={{ width: 14, flexShrink: 0 }} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sub.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}


/**
 * CandidatePickerModal — manual fallback when the tier matcher rejects
 * every candidate. Shown after a failed import; lets the user pick from up
 * to 12 surfaced YouTube videos (sorted by view count, highest first).
 *
 * The user sees thumbnail, title, channel, duration, view count for each.
 * Clicking one calls back to the importFromYoutubeId IPC which downloads
 * that specific video and writes it to library with the original metadata
 * (title/artist/album from Spotify, etc.) intact.
 */
function CandidatePickerModal({ open, candidates: initialCandidates, meta, onPick, onClose }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Local copy of candidates so we can replace them when the user refines
  // the search without bouncing back to the parent component.
  const [candidates, setCandidates] = useState(initialCandidates || []);
  // Refine-search field — pre-filled with the original "<artists> <title>"
  // string so the user can edit it (remove a "(remaster)" suffix, fix an
  // artist spelling, add "live", etc.) and re-search.
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  // URL paste field — accepts a YouTube URL/ID and downloads it directly.
  const [urlInput, setUrlInput] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);

  // Reset state on open. Sync candidates from props and rebuild the
  // default search string from meta so the refine input shows what was
  // searched.
  useEffect(() => {
    if (open) {
      setBusyId(null);
      setError('');
      setUrlInput('');
      setUrlBusy(false);
      setCandidates(initialCandidates || []);
      const defaultQuery = `${meta?.artists || ''} ${meta?.title || ''}`.trim();
      setSearchInput(defaultQuery);
    }
  }, [open, meta?.artists, meta?.title, initialCandidates]);

  // Esc closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busyId && !urlBusy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busyId, urlBusy, onClose]);

  if (!open) return null;

  const fmtDuration = (s) => {
    if (!s) return '?';
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };
  const fmtViews = (n) => {
    if (!n) return '';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K views`;
    return `${n} views`;
  };

  const handlePick = async (cand) => {
    setBusyId(cand.id);
    setError('');
    try {
      const result = await onPick?.(cand);
      if (!result?.ok) {
        setError(result?.error || 'Download failed.');
        setBusyId(null);
      }
      // On success, the parent closes the modal.
    } catch (e) {
      setError(String(e?.message || e));
      setBusyId(null);
    }
  };

  const handleRefineSearch = async () => {
    const q = searchInput.trim();
    if (!q || searching) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.searchYoutubeCandidates) {
      setError('Search not available.');
      return;
    }
    setSearching(true);
    setError('');
    try {
      const r = await api.searchYoutubeCandidates({
        customQuery: q,
        // Belt-and-suspenders: also send the query as title/artists fallback
        // so older builds of main.js (where customQuery wasn't recognized
        // yet) don't error with "Missing title". Newer main.js prefers
        // customQuery and ignores these.
        title: q,
        artists: '',
      });
      if (r?.ok && Array.isArray(r.candidates)) {
        setCandidates(r.candidates);
        if (r.candidates.length === 0) {
          setError('No results for that search.');
        }
      } else {
        setError(r?.error || 'Search failed.');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSearching(false);
    }
  };

  /**
   * Parse a YouTube URL or bare ID into an 11-character video ID.
   * Accepts:
   *   - https://www.youtube.com/watch?v=ID
   *   - https://youtu.be/ID
   *   - https://music.youtube.com/watch?v=ID
   *   - youtube.com/embed/ID
   *   - bare 11-char ID
   * Strips any extra query params (timestamps, playlists, etc).
   */
  const extractVideoId = (input) => {
    const s = String(input || '').trim();
    if (!s) return null;
    // Bare ID: 11 chars of [A-Za-z0-9_-]
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    // Try to extract from URL
    try {
      const url = new URL(s.startsWith('http') ? s : `https://${s}`);
      // Standard ?v=ID
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      // youtu.be/ID
      if (url.hostname.includes('youtu.be')) {
        const id = url.pathname.split('/').filter(Boolean)[0];
        if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
      }
      // youtube.com/embed/ID or /shorts/ID
      const parts = url.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v');
      if (idx >= 0 && parts[idx + 1] && /^[A-Za-z0-9_-]{11}$/.test(parts[idx + 1])) {
        return parts[idx + 1];
      }
    } catch {
      // Fall through — invalid URL
    }
    return null;
  };

  const handleUrlSubmit = async () => {
    const id = extractVideoId(urlInput);
    if (!id) {
      setError('Could not parse a YouTube URL or video ID from that.');
      return;
    }
    setUrlBusy(true);
    setError('');
    // Dispatch the same flow as picking from the list — onPick takes any
    // candidate-shaped object with at least an `id`.
    try {
      const result = await onPick?.({ id });
      if (!result?.ok) {
        setError(result?.error || 'Download failed.');
        setUrlBusy(false);
      }
      // On success, parent closes the modal.
    } catch (e) {
      setError(String(e?.message || e));
      setUrlBusy(false);
    }
  };

  const inputDisabled = !!busyId || !!urlBusy || searching;
  const accent = '120, 95, 220'; // soft purple — matches existing modal accents

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busyId && !urlBusy) onClose?.(); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div style={{
        width: 'min(620px, 96vw)', maxHeight: '88vh',
        background: 'rgba(20, 20, 22, 0.97)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14,
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
            Pick a video to import
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4, lineHeight: 1.45 }}>
            Importing{' '}
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>
              {meta?.artists ? `${meta.artists} — ` : ''}{meta?.title}
            </span>.
            Tweak the search below to refine results, or paste a YouTube URL at the bottom.
          </div>
        </div>

        {/* Refine search */}
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRefineSearch(); }}
            disabled={inputDisabled}
            placeholder="Refine search…"
            style={{
              flex: 1, padding: '7px 11px', borderRadius: 8,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fff', fontSize: 11.5, outline: 'none',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent}, 0.4)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          />
          <button
            type="button"
            onClick={handleRefineSearch}
            disabled={inputDisabled || !searchInput.trim()}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: searching ? 'rgba(255,255,255,0.06)' : `rgba(${accent}, 0.4)`,
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: (inputDisabled || !searchInput.trim()) ? 'default' : 'pointer',
              opacity: (inputDisabled || !searchInput.trim()) ? 0.5 : 1,
              flexShrink: 0,
              transition: 'background 0.15s, opacity 0.15s',
            }}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* Candidate list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {searching ? (
            <div style={{ padding: '32px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11.5 }}>
              Searching YouTube…
            </div>
          ) : (candidates && candidates.length > 0) ? (
            candidates.map((c) => {
            const isBusy = busyId === c.id;
            const isOtherBusy = (busyId && busyId !== c.id) || urlBusy;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => handlePick(c)}
                disabled={!!busyId || !!urlBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%', padding: '10px 18px',
                  background: isBusy ? 'rgba(120, 95, 220, 0.12)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  color: '#fff', textAlign: 'left',
                  cursor: (busyId || urlBusy) ? 'default' : 'pointer',
                  opacity: isOtherBusy ? 0.4 : 1,
                  transition: 'background 0.15s, opacity 0.15s',
                }}
                onMouseEnter={(e) => { if (!busyId && !urlBusy) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { if (!busyId && !urlBusy) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: 96, height: 54, flexShrink: 0,
                  background: 'rgba(0,0,0,0.4)', borderRadius: 6, overflow: 'hidden',
                  position: 'relative',
                }}>
                  {c.thumbnailUrl ? (
                    <img
                      src={c.thumbnailUrl}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : null}
                  {/* Duration overlay */}
                  <div style={{
                    position: 'absolute', bottom: 3, right: 3,
                    background: 'rgba(0,0,0,0.85)', color: '#fff',
                    fontSize: 9, padding: '1px 4px', borderRadius: 3,
                    fontWeight: 600,
                  }}>
                    {fmtDuration(c.duration)}
                  </div>
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginBottom: 2,
                  }}>
                    {c.title}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: 'rgba(255,255,255,0.55)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.channel}{c.viewCount ? ` · ${fmtViews(c.viewCount)}` : ''}
                  </div>
                </div>
                {isBusy ? (
                  <div style={{ flexShrink: 0, fontSize: 11, color: 'rgba(155,130,240,0.95)', fontWeight: 600 }}>
                    Downloading…
                  </div>
                ) : null}
              </button>
            );
          })
        ) : (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 11.5, lineHeight: 1.5 }}>
            No candidates.
            <br />
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>Try refining the search above, or paste a URL below.</span>
          </div>
        )}
        </div>

        {/* URL paste — last resort when YouTube search just won't surface
            what the user wants. They go to YouTube manually, find the
            video, paste the URL/ID here, we download that exact video. */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          background: 'rgba(0,0,0,0.18)',
          display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUrlSubmit(); }}
            disabled={inputDisabled}
            placeholder="…or paste a YouTube URL"
            style={{
              flex: 1, padding: '7px 11px', borderRadius: 8,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fff', fontSize: 11.5, outline: 'none',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent}, 0.4)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            disabled={inputDisabled || !urlInput.trim()}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: urlBusy ? 'rgba(255,255,255,0.06)' : `rgba(${accent}, 0.4)`,
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: (inputDisabled || !urlInput.trim()) ? 'default' : 'pointer',
              opacity: (inputDisabled || !urlInput.trim()) ? 0.5 : 1,
              flexShrink: 0,
              transition: 'background 0.15s, opacity 0.15s',
            }}
          >
            {urlBusy ? 'Importing…' : 'Import URL'}
          </button>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px 14px', borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          {error ? (
            <div style={{ fontSize: 10.5, color: '#f37272', flex: 1, lineHeight: 1.45 }}>
              {error}
            </div>
          ) : <div />}
          <button type="button" onClick={onClose} disabled={inputDisabled}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
              fontSize: 11, fontWeight: 600, cursor: inputDisabled ? 'default' : 'pointer',
              flexShrink: 0,
            }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ClearLibraryModal — destructive confirmation for wiping the library.
 *
 * Two-step safety:
 *   1. User chooses whether to also delete downloaded files from disk (only
 *      applies to yt-dlp downloads; user-imported files are never touched).
 *   2. Requires typing "CLEAR" exactly to enable the confirm button.
 *
 * After success, shows a summary ("Removed N tracks · Deleted N files ·
 * Skipped N user-imported") and auto-closes after a beat.
 */

/**
 * SpotifySetupGuide — collapsible step-by-step walkthrough for getting
 * a Client ID + Secret + connecting an account. Collapsed by default
 * with a compact "Setup guide" disclosure; expanded shows the full
 * three-step flow with anchor links into the right dashboard pages.
 *
 * The expanded state isn't persisted — every time the user opens
 * Settings, the guide starts collapsed. That's deliberate: once they've
 * done it once they don't need to see the guide again on subsequent
 * Settings visits, but it's still discoverable for the next time they
 * forget which redirect URI to add.
 */
function SpotifySetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      marginBottom: 10,
      borderRadius: 9,
      border: '1px solid rgba(255,255,255,0.07)',
      background: 'rgba(0,0,0,0.18)',
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '9px 11px',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 11.5, fontWeight: 600,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 8,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
            color: '#1db954',
            fontSize: 9,
          }}
        >
          ▶
        </span>
        <span>Setup guide</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
          {open ? 'hide' : 'first time?'}
        </span>
      </button>
      {open ? (
        <div style={{
          padding: '4px 12px 12px',
          fontSize: 11, lineHeight: 1.6, color: 'rgba(255,255,255,0.7)',
        }}>
          <SetupStep
            num={1}
            title="Create a Spotify developer app"
          >
            Go to{' '}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={setupLinkStyle}>
              developer.spotify.com/dashboard
            </a>
            . Sign in with your regular Spotify account (Free works fine).
            Click <strong style={setupEmStyle}>Create app</strong>.
            <ul style={setupListStyle}>
              <li><strong style={setupEmStyle}>App name</strong>: anything (e.g. "Immerse")</li>
              <li><strong style={setupEmStyle}>App description</strong>: anything (e.g. "Personal music player")</li>
              <li><strong style={setupEmStyle}>Redirect URIs</strong>: add exactly{' '}
                <code style={setupCodeStyle}>http://127.0.0.1:8888/callback</code>
                {' '}— click Add after typing it.
                {' '}<span style={setupNoteStyle}>It MUST be 127.0.0.1, not "localhost".</span>
              </li>
              <li><strong style={setupEmStyle}>Which APIs</strong>: just check "Web API"</li>
            </ul>
            Agree to the terms and click <strong style={setupEmStyle}>Save</strong>.
          </SetupStep>

          <SetupStep
            num={2}
            title="Copy your Client ID and Client Secret"
          >
            On your new app's page, click <strong style={setupEmStyle}>Settings</strong> in
            the top-right. You'll see your Client ID immediately. Click
            {' '}<strong style={setupEmStyle}>View client secret</strong> to reveal the secret.
            Copy both, then paste them into the fields below.
            <div style={{ marginTop: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>
              Treat the Client Secret like a password — don't share it. It's
              stored locally in your Immerse settings folder and never
              transmitted except to Spotify.
            </div>
          </SetupStep>

          <SetupStep
            num={3}
            title="Connect your Spotify account"
            last
          >
            After saving the ID + Secret below, click{' '}
            <strong style={setupEmStyle}>Connect Spotify account</strong>. A browser
            tab opens — log in (if needed) and click <strong style={setupEmStyle}>Agree</strong>.
            The tab will say "Spotify connected" and you can close it.
            <div style={{ marginTop: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>
              This is only needed for importing playlists. Single-track and
              album search work with just the ID + Secret.
            </div>
          </SetupStep>
        </div>
      ) : null}
    </div>
  );
}

const setupLinkStyle = {
  color: '#1db954',
  textDecoration: 'none',
  borderBottom: '1px solid rgba(29,185,84,0.4)',
};
const setupEmStyle = { color: 'rgba(255,255,255,0.92)', fontWeight: 600 };
const setupCodeStyle = {
  display: 'inline-block',
  padding: '1px 5px',
  borderRadius: 4,
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#1db954',
  fontSize: 10.5,
  fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
};
const setupListStyle = {
  margin: '6px 0 6px 0',
  paddingLeft: 18,
  listStyleType: 'disc',
};
const setupNoteStyle = {
  fontSize: 10,
  color: 'rgba(243,170,114,0.85)',
  fontStyle: 'italic',
};

/**
 * SetupStep — single numbered step within the SpotifySetupGuide.
 * Renders a green numbered circle on the left and the step content on
 * the right, with a vertical connector line down to the next step.
 * `last` suppresses the connector so the final step doesn't have a
 * dangling line.
 */
function SetupStep({ num, title, children, last = false }) {
  return (
    <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          background: 'rgba(29,185,84,0.18)',
          border: '1px solid rgba(29,185,84,0.5)',
          color: '#1db954',
          fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {num}
        </div>
        {!last ? (
          <div style={{
            width: 1, flex: 1, marginTop: 4,
            background: 'rgba(29,185,84,0.18)',
          }} />
        ) : null}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 4 }}>
        <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: 11.5, marginBottom: 2 }}>
          {title}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

/**
 * UpdatesSection — Settings panel for the auto-updater. Shows the
 * current app version and a "Check for updates" button. The actual
 * "Restart to install" prompt is handled by a toast in App.jsx — this
 * section is for visibility (what version am I running) and manual
 * control (check right now instead of waiting for the hourly poll).
 *
 * In dev mode (`npm start`), the updater isn't initialized; we show
 * a small note explaining why the check is unavailable.
 */
function UpdatesSection() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState({ state: 'idle', version: '', progressPct: 0, error: '' });

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const v = await api.appGetVersion?.();
        if (!cancelled && v) setVersion(String(v));
      } catch { /* ignore */ }
      try {
        const s = await api.updateGetStatus?.();
        if (!cancelled && s) setStatus(s);
      } catch { /* ignore */ }
    })();
    let unsub = null;
    if (typeof api.onUpdateStatus === 'function') {
      unsub = api.onUpdateStatus((s) => { if (s) setStatus(s); });
    }
    return () => { cancelled = true; if (typeof unsub === 'function') unsub(); };
  }, [api]);

  const checkNow = async () => {
    if (!api?.updateCheckNow) return;
    try { await api.updateCheckNow(); }
    catch { /* status update will surface error */ }
  };

  const statusLine = (() => {
    switch (status.state) {
      case 'checking': return 'Checking for updates…';
      case 'no-update': return "You're on the latest version.";
      case 'available': return `Update v${status.version} available — downloading…`;
      case 'downloading': return `Downloading update… ${status.progressPct}%`;
      case 'downloaded': return `Update v${status.version} ready. Restart to install.`;
      case 'error': return `Couldn't check: ${status.error || 'unknown error'}`;
      default: return '';
    }
  })();
  const statusColor = status.state === 'error'
    ? '#f37272'
    : status.state === 'downloaded' || status.state === 'available'
      ? '#1db954'
      : 'rgba(255,255,255,0.55)';

  const installNow = async () => {
    if (!api?.updateInstall) return;
    try { await api.updateInstall(); }
    catch { /* main will quit + relaunch */ }
  };

  return (
    <Section title="UPDATES">
      <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 8 }}>
        Current version:{' '}
        <code style={{ color: 'rgba(255,255,255,0.85)' }}>{version || '—'}</code>
        {'  ·  '}
        Updates download in the background; you'll see a "Restart" toast when one's ready.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={checkNow}
          disabled={status.state === 'checking' || status.state === 'downloading'}
          style={{
            padding: '6px 14px', borderRadius: 9,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)', color: '#fff',
            fontSize: 11.5, fontWeight: 600,
            cursor: (status.state === 'checking' || status.state === 'downloading') ? 'wait' : 'pointer',
            opacity: (status.state === 'checking' || status.state === 'downloading') ? 0.6 : 1,
          }}
        >
          {status.state === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {status.state === 'downloaded' ? (
          <button
            type="button"
            onClick={installNow}
            style={{
              padding: '6px 14px', borderRadius: 9,
              border: '1px solid rgba(29,185,84,0.35)',
              background: 'rgba(29,185,84,0.18)', color: '#1db954',
              fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Restart &amp; install
          </button>
        ) : null}
        {statusLine ? (
          <span style={{ fontSize: 10.5, color: statusColor }}>{statusLine}</span>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * RescanMetadataButton — sends a library:rescanMetadata IPC to the main
 * process which re-parses every file and updates fields that are
 * currently missing or suspicious (null years, empty genres, the
 * classic ID3v1-corruption track-number value 63, etc).
 *
 * Shows a progress bar while running, and a summary on completion.
 * Reloads the library on success so the renderer state matches the DB.
 */
function RescanMetadataButton({ onReloadLibrary }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { scanned, total, updated, failed }
  const [result, setResult] = useState(null);

  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const available = !!(api && typeof api.rescanMetadata === 'function');

  const handleClick = async () => {
    if (!available || busy) return;
    setBusy(true);
    setResult(null);
    setProgress({ scanned: 0, total: 0, updated: 0, failed: 0 });

    // Subscribe to progress events for the duration of the run.
    let unsub = null;
    if (typeof api.onRescanProgress === 'function') {
      unsub = api.onRescanProgress((p) => {
        if (p) setProgress(p);
      });
    }

    let r;
    try { r = await api.rescanMetadata(); }
    catch (e) { r = { ok: false, error: String(e?.message || e) }; }

    if (typeof unsub === 'function') unsub();

    setBusy(false);
    setResult(r);

    // Re-load the library state after a successful rescan so the UI
    // shows the freshly-updated metadata immediately.
    if (r?.ok && typeof onReloadLibrary === 'function') {
      try { await onReloadLibrary(); } catch { /* ignore */ }
    }
  };

  if (!available) {
    return (
      <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
        Re-scan only works in the desktop app.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 10.5, color: 'rgba(255,255,255,0.55)',
        lineHeight: 1.55, marginBottom: 10,
      }}>
        Re-read every file in your library and fill in any missing or
        clearly-wrong metadata (years, genres, track numbers).
        Existing values you’ve hand-edited are kept as-is.
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 9,
          border: '1px solid rgba(255,255,255,0.10)',
          background: busy ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 11.5, fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; }}
        onMouseLeave={(e) => { if (!busy) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      >
        {busy ? 'Re-scanning…' : 'Re-scan metadata'}
      </button>

      {/* Progress bar — only while running. Reads scanned/total to
          show a percentage, plus running counters of updated and
          failed. */}
      {busy && progress ? (
        <div style={{ marginTop: 10 }}>
          <div style={{
            height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: progress.total > 0
                ? `${Math.min(100, (progress.scanned / progress.total) * 100)}%`
                : '0%',
              background: 'rgba(255,255,255,0.4)',
              transition: 'width 0.2s',
            }} />
          </div>
          <div style={{
            marginTop: 6, fontSize: 10,
            color: 'rgba(255,255,255,0.45)',
            display: 'flex', justifyContent: 'space-between', gap: 8,
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span>{progress.scanned} / {progress.total}</span>
            <span>{progress.updated} updated · {progress.failed} failed</span>
          </div>
        </div>
      ) : null}

      {/* Result — only after completion. Brief summary. */}
      {!busy && result ? (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 7,
          background: result.ok ? 'rgba(80,180,120,0.08)' : 'rgba(243,114,114,0.08)',
          border: `1px solid ${result.ok ? 'rgba(80,180,120,0.2)' : 'rgba(243,114,114,0.25)'}`,
          fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5,
        }}>
          {result.ok ? (
            <>
              Updated <strong>{result.updated}</strong> of <strong>{result.total}</strong> tracks
              {result.failed > 0 ? <> · <span style={{ color: 'rgba(243,114,114,0.85)' }}>{result.failed} failed</span></> : null}
              .
            </>
          ) : (
            <>Re-scan failed: {result.error || 'unknown error'}</>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ClearLibraryModal({ onConfirm, onClose }) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const canConfirm = confirmText.trim().toUpperCase() === 'CLEAR' && !busy && !result;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError('');
    try {
      const r = await onConfirm?.({ deleteFiles });
      if (r?.ok) {
        setResult(r);
        // Auto-close after the user has a moment to read the summary
        setTimeout(() => onClose?.(), 2400);
      } else {
        setError(r?.error || 'Something went wrong.');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div style={{
        width: 'min(440px, 92vw)',
        background: 'rgba(22, 22, 24, 0.97)',
        border: '1px solid rgba(243,114,114,0.25)', borderRadius: 14,
        boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(243,114,114,0.1)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f37272' }}>
            Clear library
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginTop: 3, lineHeight: 1.5 }}>
            This cannot be undone. Your Spotify credentials and UI preferences will be preserved.
          </div>
        </div>

        <div style={{ padding: '14px 16px' }}>
          {result ? (
            /* Success summary */
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
              <div style={{ color: '#8ae08a', fontWeight: 600, marginBottom: 6 }}>
                Library cleared.
              </div>
              <div>Removed {result.cleared} track{result.cleared === 1 ? '' : 's'}.</div>
              {deleteFiles ? (
                <>
                  <div>Deleted {result.deleted} file{result.deleted === 1 ? '' : 's'} (moved to Trash).</div>
                  {result.skipped > 0 ? (
                    <div style={{ color: 'rgba(255,255,255,0.55)' }}>
                      Kept {result.skipped} user-imported file{result.skipped === 1 ? '' : 's'} on disk.
                    </div>
                  ) : null}
                  {result.failed > 0 ? (
                    <div style={{ color: '#f3b872' }}>
                      {result.failed} file{result.failed === 1 ? '' : 's'} could not be deleted.
                    </div>
                  ) : null}
                </>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Audio files on disk were not touched.
                </div>
              )}
            </div>
          ) : (
            <>
              <label style={{
                display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer', marginBottom: 12,
              }}>
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  style={{ marginTop: 2, accentColor: '#f37272' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#fff', fontWeight: 600, marginBottom: 2 }}>
                    Also delete downloaded files
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                    Only files this app downloaded via the Find or New tabs.
                    Files you imported from your own folders are never touched.
                    Deleted files go to the Trash (recoverable).
                  </div>
                </div>
              </label>

              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>
                Type <span style={{ color: '#f37272', fontWeight: 700 }}>CLEAR</span> to confirm:
              </div>
              <input
                ref={inputRef}
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) handleConfirm(); }}
                placeholder="CLEAR"
                disabled={busy}
                autoComplete="off"
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(0,0,0,0.35)',
                  border: `1px solid ${confirmText.trim().toUpperCase() === 'CLEAR' ? 'rgba(243,114,114,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  color: '#fff', fontSize: 13, fontFamily: 'monospace',
                  letterSpacing: '0.1em', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {error ? (
                <div style={{ marginTop: 8, fontSize: 10.5, color: '#f37272' }}>{error}</div>
              ) : null}
            </>
          )}
        </div>

        {!result ? (
          <div style={{
            padding: '10px 16px 14px', display: 'flex', gap: 8,
            borderTop: '1px solid rgba(255,255,255,0.04)',
          }}>
            <button type="button" onClick={onClose} disabled={busy}
              style={{
                flex: 1, padding: '8px 14px', borderRadius: 8, border: 'none',
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
                fontSize: 11.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
              }}>
              Cancel
            </button>
            <button type="button" onClick={handleConfirm} disabled={!canConfirm}
              style={{
                flex: 1, padding: '8px 14px', borderRadius: 8, border: 'none',
                background: canConfirm ? 'rgba(243,114,114,0.9)' : 'rgba(243,114,114,0.15)',
                color: canConfirm ? '#fff' : 'rgba(243,114,114,0.45)',
                fontSize: 11.5, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'default',
                transition: 'background 0.15s',
              }}>
              {busy ? 'Clearing…' : deleteFiles ? 'Clear library + delete files' : 'Clear library'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <label style={{ display: 'block', fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>
      {children}
    </label>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 11px', borderRadius: 9,
  border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#fff',
  fontSize: 12, marginBottom: 10, outline: 'none',
};

function Banner({ children, color, bg }) {
  return (
    <div style={{
      padding: '7px 10px', borderRadius: 8, background: bg, color, fontSize: 11, lineHeight: 1.5,
      display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    }}
    >
      {children}
    </div>
  );
}

/**
 * SettingsSlider — label + description + 0..max range slider that matches the
 * visual language of ToggleRow. Used for continuous-value preferences (e.g.
 * intensity, opacity) where a binary toggle isn't enough.
 *
 * The native <input type="range"> handles all interaction; we just style its
 * track and thumb via ::-webkit-slider-* and ::-moz-range-* selectors injected
 * once via a scoped class. Keeps keyboard, touch, and screen reader support
 * for free.
 */
function SettingsSlider({
  label, description,
  value = 0, min = 0, max = 100, step = 1,
  onChange,
  formatValue,
}) {
  const display = formatValue ? formatValue(value) : `${Math.round(value)}%`;
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '10px 11px', borderRadius: 10,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <style>{`
        .imm-settings-slider {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 14px;
          background: transparent; cursor: pointer; outline: none;
          margin: 0; padding: 0;
        }
        .imm-settings-slider::-webkit-slider-runnable-track {
          height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.10);
        }
        .imm-settings-slider::-moz-range-track {
          height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.10);
          border: none;
        }
        .imm-settings-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 14px; height: 14px; border-radius: 50%;
          background: #fff;
          margin-top: -5px;
          box-shadow: 0 0 0 3px rgba(139,92,246,0.18), 0 1px 3px rgba(0,0,0,0.4);
          transition: box-shadow 0.15s ease, transform 0.15s ease;
        }
        .imm-settings-slider::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%;
          background: #fff; border: none;
          box-shadow: 0 0 0 3px rgba(139,92,246,0.18), 0 1px 3px rgba(0,0,0,0.4);
          transition: box-shadow 0.15s ease, transform 0.15s ease;
        }
        .imm-settings-slider:hover::-webkit-slider-thumb,
        .imm-settings-slider:focus-visible::-webkit-slider-thumb {
          transform: scale(1.1);
          box-shadow: 0 0 0 4px rgba(139,92,246,0.32), 0 1px 4px rgba(0,0,0,0.5);
        }
        .imm-settings-slider:hover::-moz-range-thumb,
        .imm-settings-slider:focus-visible::-moz-range-thumb {
          transform: scale(1.1);
          box-shadow: 0 0 0 4px rgba(139,92,246,0.32), 0 1px 4px rgba(0,0,0,0.5);
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2 }}>
            {label}
          </div>
          {description ? (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, marginTop: 3 }}>
              {description}
            </div>
          ) : null}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700,
          color: 'rgba(255,255,255,0.85)',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 36, textAlign: 'right',
          letterSpacing: '0.02em',
        }}>
          {display}
        </div>
      </div>
      <input
        type="range"
        className="imm-settings-slider"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

/**
 * LastFmKeyField — small text input row for the Last.fm API key. Sits
 * just below the "Online artist info" toggle in Settings; only rendered
 * when that toggle is on.
 *
 * The key is stored in plain localStorage (not main-process secure
 * storage) because Last.fm read-only API keys aren't a write-credential
 * — they identify the requester, but exposing them only allows someone
 * to make read calls on the user's behalf, not modify anything.
 */
function LastFmKeyField({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      marginTop: -4, marginBottom: 4,
      padding: '10px 12px', borderRadius: 9,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600,
        color: 'rgba(255,255,255,0.7)',
        marginBottom: 6, letterSpacing: '0.02em',
      }}>
        Last.fm API key
      </div>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="paste your 32-character key"
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '6px 9px', borderRadius: 6,
          background: 'rgba(0,0,0,0.3)',
          border: `1px solid rgba(255,255,255,${focused ? 0.18 : 0.08})`,
          color: '#fff', fontSize: 11,
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
      />
      <div style={{
        marginTop: 8, fontSize: 10, lineHeight: 1.5,
        color: 'rgba(255,255,255,0.4)',
      }}>
        Get a free key at{' '}
        <span style={{ color: 'rgba(255,255,255,0.65)', fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>
          last.fm/api/account/create
        </span>
        . The key is stored on this device only.
      </div>
    </div>
  );
}

/**
 * DiscordAppIdField — text input for the user's Discord Application ID,
 * plus a small live-status indicator (connected / not running / invalid)
 * powered by the discord:status IPC.
 *
 * The status ticks every 3 seconds while the field is mounted, so a
 * change in Discord's run state surfaces without any user action.
 */
function DiscordAppIdField({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState({ connected: false, lastError: null });
  const api = typeof window !== 'undefined' ? window.electronAPI : null;

  useEffect(() => {
    if (!api?.discordStatus) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await api.discordStatus();
        if (!cancelled && s) setStatus(s);
      } catch { /* ignore */ }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [api]);

  // Status pill color + text.
  let pillBg = 'rgba(255,255,255,0.06)';
  let pillColor = 'rgba(255,255,255,0.5)';
  let pillText = 'Not connected';
  let errorDetail = '';
  if (status.connected) {
    pillBg = 'rgba(80,180,120,0.14)';
    pillColor = 'rgba(120,220,160,0.95)';
    pillText = 'Connected';
  } else if (status.lastError) {
    if (/invalid client id|invalid app id|unknown application/i.test(status.lastError)) {
      pillBg = 'rgba(243,114,114,0.12)';
      pillColor = 'rgba(255,160,160,0.95)';
      pillText = 'Invalid app ID';
    } else if (/cannot find package|cannot find module|not installed/i.test(status.lastError)) {
      pillBg = 'rgba(243,114,114,0.12)';
      pillColor = 'rgba(255,160,160,0.95)';
      pillText = 'Discord RPC missing';
    } else {
      pillText = 'Discord not running';
      errorDetail = String(status.lastError || '');
    }
  } else if (value && value.trim()) {
    pillText = 'Discord not running';
  } else {
    pillText = 'Awaiting app ID';
  }

  return (
    <div style={{
      marginTop: -4, marginBottom: 4,
      padding: '10px 12px', borderRadius: 9,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <div style={{
          fontSize: 10.5, fontWeight: 600,
          color: 'rgba(255,255,255,0.7)', letterSpacing: '0.02em',
        }}>
          Discord Application ID
        </div>
        <div style={{
          fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          background: pillBg, color: pillColor,
          letterSpacing: '0.04em',
        }}>
          {pillText}
        </div>
      </div>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="leave blank to use Immerse default"
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '6px 9px', borderRadius: 6,
          background: 'rgba(0,0,0,0.3)',
          border: `1px solid rgba(255,255,255,${focused ? 0.18 : 0.08})`,
          color: '#fff', fontSize: 11,
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
      />
      <div style={{
        marginTop: 8, fontSize: 10, lineHeight: 1.5,
        color: 'rgba(255,255,255,0.4)',
      }}>
        Optional. By default Discord shows “Listening to Immerse.” To use your own application name and icon, create one at{' '}
        <span style={{ color: 'rgba(255,255,255,0.65)', fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>
          discord.com/developers/applications
        </span>
        {' '}and paste its Application ID above.
      </div>
      {errorDetail ? (
        <div style={{
          marginTop: 6,
          fontSize: 9.5,
          lineHeight: 1.45,
          color: 'rgba(255,160,160,0.95)',
          wordBreak: 'break-word',
        }}>
          {errorDetail}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ImgbbApiKeyField — text input for the user's imgbb API key used to
 * upload local cover art to a public URL for Discord RPC.
 *
 * imgbb is free and requires no OAuth — just sign up at api.imgbb.com
 * and paste the key shown on the dashboard.
 *
 * When set, the first time a local track (with no public cover URL) plays,
 * its embedded art is uploaded to imgbb and the resulting URL is sent to
 * Discord. Results are cached on disk by image hash so the same art is
 * never uploaded twice.
 */
function ImgbbApiKeyField({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      marginTop: 8, marginBottom: 4,
      padding: '10px 12px', borderRadius: 9,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600,
        color: 'rgba(255,255,255,0.7)', letterSpacing: '0.02em',
        marginBottom: 6,
      }}>
        imgbb API Key
        <span style={{
          marginLeft: 6, fontSize: 9, fontWeight: 500,
          color: 'rgba(255,255,255,0.35)', letterSpacing: '0.01em',
        }}>
          for local cover art
        </span>
      </div>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="optional — paste imgbb API key"
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '6px 9px', borderRadius: 6,
          background: 'rgba(0,0,0,0.3)',
          border: `1px solid rgba(255,255,255,${focused ? 0.18 : 0.08})`,
          color: '#fff', fontSize: 11,
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
      />
      <div style={{
        marginTop: 8, fontSize: 10, lineHeight: 1.5,
        color: 'rgba(255,255,255,0.4)',
      }}>
        Optional. When set, local cover art is uploaded to imgbb once and shown on Discord. Get a free API key at{' '}
        <span style={{ color: 'rgba(255,255,255,0.65)', fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>
          api.imgbb.com
        </span>
        {' '}— sign up, and your key is shown on the dashboard. Each image is only uploaded once, cached locally.
      </div>
    </div>
  );
}

/** Small inline row with a label, helper text, and an iOS-style toggle switch. */
function ToggleRow({ label, description, checked, onChange }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={() => onChange?.(!checked)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 11px', borderRadius: 10,
        background: hov ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange?.(!checked);
        }
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2 }}>
          {label}
        </div>
        {description ? (
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, marginTop: 3 }}>
            {description}
          </div>
        ) : null}
      </div>
      <div
        aria-hidden
        style={{
          position: 'relative', flexShrink: 0,
          width: 34, height: 20, borderRadius: 10,
          background: checked ? 'rgba(139,92,246,0.85)' : 'rgba(255,255,255,0.14)',
          border: `1px solid ${checked ? 'rgba(139,92,246,0.95)' : 'rgba(255,255,255,0.18)'}`,
          transition: 'background 0.2s ease, border-color 0.2s ease',
          boxShadow: checked ? '0 0 10px rgba(139,92,246,0.4)' : 'none',
        }}
      >
        <div
          style={{
            position: 'absolute', top: 1, left: checked ? 15 : 1,
            width: 16, height: 16, borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
          }}
        />
      </div>
    </div>
  );
}

/**
 * AmbientSettingRow — four-option segmented control for ambient mode plus
 * an inline number input that appears only when "Custom" is selected.
 *
 * Modes:
 *   off    → Never auto-engage ambient mode
 *   idle   → Engage after 30s with no current track AND empty queue
 *   pause  → Engage after 30s when player is idle OR paused
 *   custom → Same idle test as 'idle' but with user-specified delay
 *
 * The custom-delay input is bounded 5–600s in the App.jsx setter; we
 * don't re-validate here (uncontrolled feel is nicer than clamping
 * mid-typing). The setter handles out-of-range inputs at save time.
 */
function AmbientSettingRow({ mode, onSetMode, customDelaySec, onSetCustomDelaySec }) {
  const options = [
    { value: 'off',    label: 'Off' },
    { value: 'idle',   label: 'Strict' },
    { value: 'pause',  label: 'Relaxed' },
    { value: 'custom', label: 'Custom' },
  ];
  // Local input mirror so the user can type freely without each keystroke
  // hitting localStorage. Commits on blur or Enter.
  const [draft, setDraft] = useState(String(customDelaySec || 30));
  useEffect(() => { setDraft(String(customDelaySec || 30)); }, [customDelaySec]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 5 && n <= 600) {
      onSetCustomDelaySec?.(Math.round(n));
    } else {
      // Reset to last-valid if input was nonsense.
      setDraft(String(customDelaySec || 30));
    }
  };

  // Descriptive subtext that updates with the selection — helps the
  // user understand what each choice does without needing tooltips.
  const description = mode === 'off'
    ? 'Ambient mode will never appear.'
    : mode === 'idle'
    ? 'After 30 seconds with nothing playing and an empty queue, a slow cover collage takes over the screen.'
    : mode === 'pause'
    ? 'Same as Strict, but pausing the current track also counts as idle.'
    : `After ${customDelaySec} second${customDelaySec === 1 ? '' : 's'} with nothing playing and an empty queue, the collage takes over.`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 11px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2 }}>
          Ambient mode
        </div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, marginTop: 3 }}>
          {description}
        </div>
      </div>

      {/* Segmented control */}
      <div style={{
        display: 'flex', gap: 4, padding: 3,
        background: 'rgba(0,0,0,0.25)', borderRadius: 8,
      }}>
        {options.map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSetMode?.(opt.value)}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 6,
                border: 'none',
                background: active ? 'rgba(255,255,255,0.14)' : 'transparent',
                color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                fontSize: 11.5,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Custom-delay input — only visible when 'custom' is selected. */}
      {mode === 'custom' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', flexShrink: 0 }}>
            Delay after idle
          </label>
          <input
            type="number"
            min={5}
            max={600}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
            style={{
              width: 64, padding: '5px 8px', borderRadius: 6,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              outline: 'none',
              textAlign: 'right',
            }}
          />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>seconds (5–600)</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * RecentPeekRangeRow — segmented control + optional number input for the
 * "Recently played" dock popover's range. Mirrors the visual pattern of
 * AmbientSettingRow.
 *
 * Five range modes:
 *   '5' / '10' / '20' — last N unique tracks
 *   'today'           — tracks played today
 *   'session'         — current listening session
 *   'custom'          — last `customCount` unique tracks
 *
 * The custom-count input only appears when 'custom' is selected. Bounded
 * 1–100 in the App.jsx setter; the input commits on blur or Enter.
 */
function RecentPeekRangeRow({ range, onSetRange, customCount, onSetCustomCount }) {
  const options = [
    { value: '5',       label: 'Last 5' },
    { value: '10',      label: 'Last 10' },
    { value: '20',      label: 'Last 20' },
    { value: 'today',   label: 'Today' },
    { value: 'session', label: 'Session' },
    { value: 'custom',  label: 'Custom' },
  ];
  const [draft, setDraft] = useState(String(customCount || 15));
  useEffect(() => { setDraft(String(customCount || 15)); }, [customCount]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 1 && n <= 100) {
      onSetCustomCount?.(Math.round(n));
    } else {
      setDraft(String(customCount || 15));
    }
  };

  const description = range === 'today'
    ? "Shows everything you've played since local midnight."
    : range === 'session'
    ? "Shows the current listening session (back to the last 30-minute silence)."
    : range === 'custom'
    ? `Shows the last ${customCount} unique track${customCount === 1 ? '' : 's'} you played.`
    : `Shows the last ${range} unique tracks you played.`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 11px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2 }}>
          Peek range
        </div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, marginTop: 3 }}>
          {description}
        </div>
      </div>

      {/* Segmented control — three options per row for visual breathing. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: 3,
        background: 'rgba(0,0,0,0.25)', borderRadius: 8,
      }}>
        {options.map((opt) => {
          const active = range === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSetRange?.(opt.value)}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                border: 'none',
                background: active ? 'rgba(255,255,255,0.14)' : 'transparent',
                color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                fontSize: 11,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {range === 'custom' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', flexShrink: 0 }}>
            Show last
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
            style={{
              width: 64, padding: '5px 8px', borderRadius: 6,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              outline: 'none',
              textAlign: 'right',
            }}
          />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>tracks (1–100)</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * LyricsProviderPicker — segmented control for choosing where lyrics come
 * from. Two options:
 *   - 'lrclib'         (default): synced + plain from LRClib only
 *   - 'lrclib+genius'  Falls back to Genius for plain lyrics when LRClib
 *                      doesn't have the song.
 */


/**
 * DockTabVisibilityList — checklist of every hideable dock tab with an eye
 * icon to show/hide each one. Mirrors the right-click affordance from the
 * dock itself, plus serves as the only path back from a fully-hidden tab
 * (since the right-click vocabulary requires the tab to be visible to use).
 *
 * The list is small and stable, so it's hard-coded rather than introspected
 * from the dock — keeps things simple and lets us pair each tab with a
 * proper helper-text description.
 */
function DockTabVisibilityList({ hiddenTabIds = [], onSetHiddenTabIds }) {
  const HIDEABLE_TABS = [
    { id: 'find',   label: 'Find',           desc: 'Search Spotify for tracks to import via yt-dlp.' },
    { id: 'new',    label: 'New releases',   desc: 'Recent releases from artists you follow.' },
    { id: 'stats',  label: 'Listening stats', desc: 'Top tracks, artists, listening time.' },
    { id: 'queue',  label: 'Queue',          desc: 'Up-next tracks for the current session.' },
    { id: 'journal', label: 'Journal',        desc: 'Day-by-day diary of your play history with prose summaries.' },
    { id: 'lyrics', label: 'Lyrics',         desc: 'Show/hide the lyrics side panel during playback.' },
  ];

  const isHidden = (id) => Array.isArray(hiddenTabIds) && hiddenTabIds.includes(id);
  const setVisible = (id, visible) => {
    const cur = Array.isArray(hiddenTabIds) ? hiddenTabIds : [];
    if (visible) onSetHiddenTabIds?.(cur.filter((x) => x !== id));
    else if (!cur.includes(id)) onSetHiddenTabIds?.([...cur, id]);
  };

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
        color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
        padding: '6px 11px 4px',
      }}>
        Tab visibility
      </div>
      {HIDEABLE_TABS.map((t) => {
        const visible = !isHidden(t.id);
        return (
          <div
            key={t.id}
            onClick={() => setVisible(t.id, !visible)}
            role="switch"
            aria-checked={visible}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setVisible(t.id, !visible);
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '8px 11px', borderRadius: 9,
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.05)',
              cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
              opacity: visible ? 1 : 0.62,
            }}
          >
            {/* Eye / eye-off icon. The icon swap doubles as the state
                indicator — visible = open eye, hidden = crossed-out eye. */}
            <div style={{
              width: 18, height: 18, flexShrink: 0,
              color: visible ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {visible ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11.5, fontWeight: 600,
                color: visible ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)',
                lineHeight: 1.2,
              }}>
                {t.label}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.42)', lineHeight: 1.4, marginTop: 2 }}>
                {t.desc}
              </div>
            </div>
            <div style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
              color: visible ? 'rgba(155, 130, 240, 0.85)' : 'rgba(255,255,255,0.3)',
              textTransform: 'uppercase',
            }}>
              {visible ? 'Shown' : 'Hidden'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LyricsProviderPicker({ value, onChange }) {
  const options = [
    { id: 'lrclib', label: 'LRClib', desc: 'Synced + plain. Default.' },
    { id: 'lrclib+genius', label: 'LRClib + Genius', desc: 'Genius fallback for missing songs (plain only).' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <div key={opt.id}
            onClick={() => onChange?.(opt.id)}
            role="radio"
            aria-checked={active}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange?.(opt.id); } }}
            style={{
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '9px 11px', borderRadius: 10,
              background: active ? 'rgba(120, 95, 220, 0.18)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${active ? 'rgba(155, 130, 240, 0.4)' : 'rgba(255,255,255,0.06)'}`,
              cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
            }}
          >
            {/* Radio dot */}
            <div style={{
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
              border: `1.5px solid ${active ? '#b89dff' : 'rgba(255,255,255,0.25)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 0.15s',
            }}>
              {active ? (
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#b89dff' }} />
              ) : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.2 }}>{opt.label}</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.45, marginTop: 2 }}>{opt.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Lyrics Editor — two-step workflow:
 *   Step 1 "Edit lines": paste/type lyrics as plain text (one line per row).
 *   Step 2 "Tap to sync": play the song and tap a button to stamp each line.
 * Saves synced LRC back to the DB cache.
 */
function LyricsEditor({ track, currentTime, existingSynced, existingPlain, accent, onSeek, onSave, onCancel }) {
  // 'edit' = editing text lines, 'sync' = tap-to-sync stamping mode
  const [step, setStep] = useState('edit');
  const [text, setText] = useState(() => {
    // Seed from existing synced lines or plain text
    if (existingSynced?.length) return existingSynced.map((l) => l.text).join('\n');
    if (existingPlain) return existingPlain;
    return '';
  });
  // Array of { text, time: number|null }
  const [stampedLines, setStampedLines] = useState([]);
  const [syncIdx, setSyncIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const syncContainerRef = useRef(null);
  const lineElsRef = useRef([]);
  const api = typeof window !== 'undefined' ? window.electronAPI : null;

  // Parse text into lines when entering sync mode
  const enterSyncMode = () => {
    const lines = text.split('\n').filter((l) => l.trim());
    if (!lines.length) return;
    // Pre-fill timestamps from existing synced data if line text matches
    const existingMap = new Map((existingSynced || []).map((l) => [l.text.trim().toLowerCase(), l.time]));
    setStampedLines(lines.map((l) => ({
      text: l.trim(),
      time: existingMap.get(l.trim().toLowerCase()) ?? null,
    })));
    setSyncIdx(0);
    setStep('sync');
  };

  // Tap handler — stamp current playback time onto the current line
  const stampCurrent = useCallback(() => {
    setStampedLines((prev) => {
      const next = [...prev];
      if (syncIdx < next.length) {
        next[syncIdx] = { ...next[syncIdx], time: currentTime };
      }
      // Keep stamped lines sorted by time, with unstamped (time === null)
      // lines at the bottom in their original order. This way the editor
      // list always reads in playback order — critical for songs with
      // choruses and verse repeats that don't follow text order.
      return sortStampedLines(next);
    });
    // After sorting, the next-to-stamp position is the first line
    // whose time is still null. Compute that fresh rather than
    // incrementing — sorting may have shuffled positions.
    setStampedLines((cur) => {
      const firstUnstamped = cur.findIndex((l) => l.time === null);
      setSyncIdx(firstUnstamped === -1 ? cur.length : firstUnstamped);
      return cur;
    });
  }, [syncIdx, currentTime]);

  // Keyboard: space to stamp while in sync mode
  useEffect(() => {
    if (step !== 'sync') return;
    const handler = (e) => {
      // Don't capture if user is in a textarea/input
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        stampCurrent();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, stampCurrent]);

  // Auto-scroll to current sync line — scoped to container only, never bubbles to parents
  useEffect(() => {
    if (step !== 'sync') return;
    const container = syncContainerRef.current;
    const el = lineElsRef.current[syncIdx];
    if (!container || !el) return;
    const targetTop = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, [syncIdx, step]);

  // Save to DB
  const handleSave = async () => {
    if (!track || !api?.saveLyrics) return;
    setSaving(true);
    // Build LRC string from stamped lines
    const synced = stampedLines.filter((l) => l.time !== null);
    synced.sort((a, b) => a.time - b.time);
    const lrcStr = synced.map((l) => {
      const min = Math.floor(l.time / 60);
      const sec = l.time % 60;
      return `[${String(min).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}] ${l.text}`;
    }).join('\n');
    const plainStr = stampedLines.map((l) => l.text).join('\n');
    try {
      await api.saveLyrics({
        title: track.title || '',
        artist: track.artist || '',
        syncedLyrics: lrcStr || null,
        plainLyrics: plainStr || null,
      });
      onSave(parseLRC(lrcStr), plainStr);
    } catch (e) {
      console.error('Failed to save lyrics', e);
    } finally {
      setSaving(false);
    }
  };

  // Quick-save plain only (no sync)
  const handleSavePlainOnly = async () => {
    if (!track || !api?.saveLyrics) return;
    setSaving(true);
    try {
      await api.saveLyrics({
        title: track.title || '',
        artist: track.artist || '',
        syncedLyrics: null,
        plainLyrics: text || null,
      });
      onSave([], text || null);
    } catch (e) {
      console.error('Failed to save lyrics', e);
    } finally {
      setSaving(false);
    }
  };

  // Undo last stamp
  const undoLast = () => {
    if (syncIdx <= 0) return;
    const target = syncIdx - 1;
    setStampedLines((prev) => {
      const next = [...prev];
      next[target] = { ...next[target], time: null };
      return next;
    });
    setSyncIdx(target);
  };

  // Clear a specific line's timestamp
  const clearStamp = (i) => {
    setStampedLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], time: null };
      return next;
    });
    if (i < syncIdx) setSyncIdx(i);
  };

  const allStamped = stampedLines.length > 0 && stampedLines.every((l) => l.time !== null);
  const stampedCount = stampedLines.filter((l) => l.time !== null).length;

  const pillStyle = (active) => ({
    padding: '5px 12px', borderRadius: 16, border: 'none',
    background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
    color: active ? '#fff' : 'rgba(255,255,255,0.5)',
    fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
  });

  const btnBase = {
    padding: '7px 14px', borderRadius: 10, border: 'none', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s',
  };

  if (step === 'edit') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Header */}
        <div style={{ padding: '10px 8px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', flex: 1 }}>Edit lyrics</div>
          <button type="button" onClick={onCancel} style={{ ...btnBase, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', padding: '5px 10px' }}>Cancel</button>
        </div>
        <div style={{ padding: '0 8px 6px', fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
          One line per row. When you're done, tap <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Tap to sync</strong> to add timestamps while the song plays.
        </div>

        {/* Textarea */}
        <div style={{ flex: 1, padding: '0 8px', minHeight: 0 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Paste or type lyrics here…\n\nOne line per row.\nEmpty lines are ignored.'}
            spellCheck={false}
            style={{
              width: '100%', height: '100%', boxSizing: 'border-box',
              padding: '12px 14px', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.35)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12.5, lineHeight: 1.7,
              resize: 'none', outline: 'none',
              fontFamily: 'inherit',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.15) transparent',
            }}
          />
        </div>

        {/* Actions */}
        <div style={{ padding: '10px 8px 8px', display: 'flex', gap: 6 }}>
          <button type="button" onClick={handleSavePlainOnly} disabled={!text.trim() || saving}
            style={{ ...btnBase, flex: 1, background: 'rgba(255,255,255,0.08)', color: '#fff', opacity: !text.trim() ? 0.4 : 1 }}>
            {saving ? 'Saving…' : 'Save without sync'}
          </button>
          <button type="button" onClick={enterSyncMode} disabled={!text.trim()}
            style={{ ...btnBase, flex: 1, background: `rgba(${accent},0.25)`, color: '#fff', opacity: !text.trim() ? 0.4 : 1 }}>
            Tap to sync →
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Tap-to-sync
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 8px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => setStep('edit')} style={{ ...pillStyle(false), display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px' }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          Edit
        </button>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center' }}>Tap to sync</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
          {stampedCount}/{stampedLines.length}
        </div>
      </div>

      <div style={{ padding: '2px 8px 6px', fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5, textAlign: 'center' }}>
        Play the song, then tap the button or press <strong style={{ color: 'rgba(255,255,255,0.65)' }}>Space</strong> as each line is sung.
      </div>

      {/* Playback time indicator */}
      <div style={{ padding: '0 8px 6px', textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {formatTime(currentTime)}
      </div>

      {/* Lines list */}
      <div ref={syncContainerRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 4px',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.12) transparent',
        maskImage: 'linear-gradient(to bottom, #000 0%, #000 90%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 90%, transparent 100%)',
      }}>
        {stampedLines.map((line, i) => {
          const isCurrent = i === syncIdx;
          const isStamped = line.time !== null;
          const isPast = isStamped && i < syncIdx;
          return (
            <div
              key={i}
              ref={(el) => { lineElsRef.current[i] = el; }}
              onClick={(e) => {
                // Plain click on a stamped line: seek audio AND make it
                //   the active sync cursor — so you can scrub to a
                //   specific line and continue syncing from there.
                // Plain click on an unstamped line: just move the
                //   cursor there (no audio seek — there's no timestamp
                //   to seek to yet).
                // Shift-click: jump the sync cursor without touching
                //   audio playback. Useful when you're already playing
                //   and want to commit to syncing from a line that's
                //   about to come up.
                setSyncIdx(i);
                if (isStamped && !e.shiftKey && onSeek) onSeek(line.time);
              }}
              title={isStamped
                ? 'Click: resume syncing here (and seek). Shift-click: just move the cursor.'
                : 'Click: resume syncing here.'}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '6px 8px', borderRadius: 8,
                background: isCurrent ? `rgba(${accent},0.12)` : 'transparent',
                borderLeft: isCurrent ? `2px solid rgba(${accent},0.7)` : '2px solid transparent',
                transition: 'all 0.2s ease',
                // Every line is clickable now — both stamped (seek+resume)
                // and unstamped (just resume). The cursor reflects that.
                cursor: 'pointer',
              }}
            >
              {/* Timestamp badge */}
              <div style={{
                flexShrink: 0, width: 42, fontSize: 9.5, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: isStamped ? 'rgba(29,185,84,0.8)' : 'rgba(255,255,255,0.2)',
                paddingTop: 2, textAlign: 'right',
              }}>
                {isStamped ? formatTime(line.time) : '—:——'}
              </div>

              {/* Line text */}
              <div style={{
                flex: 1, fontSize: 12.5,
                fontWeight: isCurrent ? 600 : 400,
                color: isCurrent ? '#fff' : isPast ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.65)',
                lineHeight: 1.5,
                transition: 'color 0.2s',
              }}>
                {line.text}
              </div>

              {/* Clear button for stamped lines */}
              {isStamped ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); clearStamp(i); }}
                  title="Remove timestamp"
                  style={{
                    flexShrink: 0, width: 18, height: 18, borderRadius: 9,
                    border: 'none', background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.3)', fontSize: 10,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                  }}>
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        <div style={{ height: 60 }} />
      </div>

      {/* Bottom action bar */}
      <div style={{
        padding: '8px 8px 8px', display: 'flex', gap: 6,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {!allStamped ? (
          <>
            <button type="button" onClick={undoLast} disabled={syncIdx === 0}
              title="Undo last stamp"
              style={{
                ...btnBase, padding: '8px 10px',
                background: 'rgba(255,255,255,0.06)',
                color: syncIdx === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L2.5 7.5v9h9l-3.19-3.19C9.8 12.21 11.08 11.5 12.5 11.5c2.65 0 4.88 1.77 5.57 4.19l2.62-.87C19.68 11.17 16.38 8 12.5 8z"/></svg>
            </button>
            {/* Jump to first unstamped — handy after the user has
                clicked around to seek/preview different lines and
                wants to snap back to "where they should be syncing
                next." Only enabled when (a) there's at least one
                stamped line behind us (so jumping makes sense) and
                (b) the cursor isn't already on the first unstamped. */}
            {(() => {
              const firstUnstamped = stampedLines.findIndex((l) => l.time === null);
              const canJump = firstUnstamped !== -1 && firstUnstamped !== syncIdx;
              return (
                <button type="button"
                  onClick={() => { if (firstUnstamped !== -1) setSyncIdx(firstUnstamped); }}
                  disabled={!canJump}
                  title="Jump to next unstamped line"
                  style={{
                    ...btnBase, padding: '8px 10px',
                    background: 'rgba(255,255,255,0.06)',
                    color: canJump ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)',
                  }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              );
            })()}
            <button type="button" onClick={stampCurrent} disabled={syncIdx >= stampedLines.length}
              style={{
                ...btnBase, flex: 1, padding: '10px 14px',
                background: `rgba(${accent},0.3)`,
                color: '#fff', fontSize: 12, fontWeight: 700,
                border: `1px solid rgba(${accent},0.4)`,
                opacity: syncIdx >= stampedLines.length ? 0.4 : 1,
              }}>
              ⏎ Stamp line {syncIdx < stampedLines.length ? syncIdx + 1 : ''}
            </button>
          </>
        ) : (
          <button type="button" onClick={handleSave} disabled={saving}
            style={{
              ...btnBase, flex: 1, padding: '10px 14px',
              background: '#1db954', color: '#000',
              fontSize: 12, fontWeight: 700,
            }}>
            {saving ? 'Saving…' : '✓ Save synced lyrics'}
          </button>
        )}
      </div>

      {/* Allow saving partially stamped */}
      {!allStamped && stampedCount > 0 ? (
        <div style={{ padding: '0 8px 8px' }}>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{
              ...btnBase, width: '100%', padding: '6px 10px',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.5)', fontSize: 10,
            }}>
            {saving ? 'Saving…' : `Save with ${stampedCount} synced line${stampedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Karaoke-style synced lyrics — GPU-translated, no scroll.
 *
 * Past lines dim ~18%, future lines mid-grey, active line full white.
 */
function SyncedLyrics({
  lines, currentTime, accent, onSeek,
  fontSize = 15, lineHeight = 1.55,
  // --- Selection-for-sharing props ---
  // When `selection` is non-null, the panel enters "share-pick" mode:
  //   - Active-line auto-scroll freezes (so the user can read freely
  //     without the active line tugging the view away)
  //   - Clicks on lines extend/contract the highlight instead of seeking
  //   - Selected lines glow with the accent and a left-edge bar
  // Selection shape: { start: number, end: number } where end >= start,
  // both indices into `lines`.
  selection = null,
  onSelectLine,    // (idx) → toggle / extend selection
  onSelectStart,   // (idx) → enter selection mode anchored at idx
}) {
  const containerRef = useRef(null);
  const lineRefs = useRef([]);
  const [offset, setOffset] = useState(0);
  const activeIdx = activeLyricIndex(lines, currentTime);

  // Ensure refs array matches lines length.
  if (lineRefs.current.length !== lines.length) {
    lineRefs.current = Array(lines.length).fill(null);
  }

  const selecting = !!selection;

  // Compute translateY so the active line sits at the vertical center.
  // When the user is picking lines to share we FREEZE the offset — having
  // the lyric column auto-scroll under your finger would make it impossible
  // to select a stable range.
  useEffect(() => {
    if (selecting) return; // hold position while selecting
    const container = containerRef.current;
    const el = lineRefs.current[activeIdx];
    if (!container || !el || activeIdx < 0) {
      setOffset(0);
      return;
    }
    const containerH = container.clientHeight;
    const elTop = el.offsetTop;
    const elH = el.offsetHeight;
    setOffset(-(elTop - containerH / 2 + elH / 2));
  }, [activeIdx, lines.length, selecting]);

  // Long-press tracking for entering selection mode. 380ms hold to match
  // the platform feel of a mobile long-press without being so slow that
  // a casual click ever triggers it.
  const pressTimerRef = useRef(null);
  const pressedRef = useRef(null); // {idx, t0, fired}
  const LONG_PRESS_MS = 380;
  const startPress = (idx, e) => {
    // Right-click also opens selection at this line — power-user shortcut.
    if (e && e.button === 2) return; // handled by onContextMenu
    pressedRef.current = { idx, t0: Date.now(), fired: false };
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      if (pressedRef.current && !pressedRef.current.fired) {
        pressedRef.current.fired = true;
        onSelectStart?.(idx);
      }
    }, LONG_PRESS_MS);
  };
  const endPress = (idx) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    // If the long-press fired, the click is consumed by selection mode —
    // don't seek. If it didn't fire, this is a normal click.
    if (pressedRef.current?.fired) {
      pressedRef.current = null;
      return;
    }
    pressedRef.current = null;
    if (selecting) {
      // In selection mode, taps extend/contract the highlight rather than seeking.
      onSelectLine?.(idx);
    } else {
      onSeek?.(lines[idx]?.time);
    }
  };
  const cancelPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressedRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: selecting ? 'auto' : 'hidden',
        scrollbarWidth: 'none',
        position: 'relative',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 15%, #000 85%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 15%, #000 85%, transparent 100%)',
      }}
    >
      <div
        style={{
          transform: selecting ? 'none' : `translateY(${offset}px)`,
          transition: selecting ? 'none' : 'transform 0.55s cubic-bezier(0.25, 0.1, 0.25, 1)',
          willChange: selecting ? 'auto' : 'transform',
        }}
      >
        {lines.map((line, i) => {
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          const isSelected = selecting && i >= selection.start && i <= selection.end;

          let styleColor;
          let styleOpacity;
          let styleWeight;
          if (isSelected) {
            styleColor = '#fff';
            styleOpacity = 1;
            styleWeight = 600;
          } else if (selecting) {
            // While selecting, fade unselected lines uniformly — past/future
            // distinction doesn't matter, the user is composing a share.
            styleColor = 'rgba(255,255,255,0.32)';
            styleOpacity = 0.85;
            styleWeight = 400;
          } else {
            styleColor = isActive ? '#fff' : isPast ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.45)';
            styleOpacity = isActive ? 1 : isPast ? 0.7 : 0.85;
            styleWeight = isActive ? 700 : 400;
          }

          return (
            <div
              key={`${i}-${line.time}`}
              ref={(el) => { lineRefs.current[i] = el; }}
              onMouseDown={(e) => startPress(i, e)}
              onMouseUp={() => endPress(i)}
              onMouseLeave={cancelPress}
              onTouchStart={() => startPress(i)}
              onTouchEnd={() => endPress(i)}
              onTouchCancel={cancelPress}
              onContextMenu={(e) => { e.preventDefault(); onSelectStart?.(i); }}
              style={{
                position: 'relative',
                padding: '8px 8px 8px 14px',
                fontSize,
                fontWeight: styleWeight,
                lineHeight,
                textAlign: 'left',
                color: styleColor,
                opacity: styleOpacity,
                borderRadius: isSelected ? 8 : 0,
                background: isSelected ? `rgba(${accent},0.18)` : 'transparent',
                textShadow: isActive && !selecting
                  ? `0 0 20px rgba(${accent},0.5), 0 1px 8px rgba(0,0,0,0.3)`
                  : isSelected
                    ? `0 0 18px rgba(${accent},0.35)`
                    : 'none',
                transition: 'color 0.25s ease, opacity 0.25s ease, font-weight 0.25s ease, text-shadow 0.25s ease, background 0.2s ease',
                cursor: 'pointer',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              {/* Accent bar on the left edge for selected lines — gives the
                  highlight a clean Apple-Music-like marker without depending
                  solely on background colour. */}
              {isSelected ? (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', left: 2, top: 8, bottom: 8, width: 3,
                    borderRadius: 999,
                    background: `rgb(${accent})`,
                    boxShadow: `0 0 10px rgba(${accent},0.7)`,
                  }}
                />
              ) : null}
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Plain (unsynced) lyrics — scrollable, left-aligned to match synced style.
 *
 * Supports the same share-selection vocabulary as SyncedLyrics: long-press
 * or right-click a line to enter selection mode, click further lines to
 * extend the range. Blank lines (verse separators) are skipped — selecting
 * them would just be empty space in the share card.
 */
function PlainLyrics({
  text, fontSize = 13, lineHeight = 1.55,
  accent = '128, 128, 128',
  selection = null,
  onSelectLine,
  onSelectStart,
}) {
  if (!text) return null;
  const lines = text.split('\n');
  const selecting = !!selection;

  const pressTimerRef = useRef(null);
  const pressedRef = useRef(null);
  const LONG_PRESS_MS = 380;
  const startPress = (idx, e) => {
    if (e && e.button === 2) return;
    pressedRef.current = { idx, fired: false };
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      if (pressedRef.current && !pressedRef.current.fired) {
        pressedRef.current.fired = true;
        onSelectStart?.(idx);
      }
    }, LONG_PRESS_MS);
  };
  const endPress = (idx) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (pressedRef.current?.fired) {
      pressedRef.current = null;
      return;
    }
    pressedRef.current = null;
    // Plain lyrics have no seek target, so a quick tap only does anything
    // in selection mode (extend/contract).
    if (selecting) onSelectLine?.(idx);
  };
  const cancelPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressedRef.current = null;
  };

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      scrollbarWidth: 'none',
      maskImage: 'linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)',
      padding: '24px 8px',
    }}
    >
      {lines.map((line, i) => {
        const isBlank = !line.trim();
        const isSelected = selecting && !isBlank && i >= selection.start && i <= selection.end;
        const dimmed = selecting && !isSelected && !isBlank;
        return (
          <div
            key={i}
            // Blank lines are non-interactive — selecting whitespace is meaningless.
            onMouseDown={isBlank ? undefined : (e) => startPress(i, e)}
            onMouseUp={isBlank ? undefined : () => endPress(i)}
            onMouseLeave={cancelPress}
            onTouchStart={isBlank ? undefined : () => startPress(i)}
            onTouchEnd={isBlank ? undefined : () => endPress(i)}
            onTouchCancel={cancelPress}
            onContextMenu={isBlank ? undefined : (e) => { e.preventDefault(); onSelectStart?.(i); }}
            style={{
              position: 'relative',
              padding: '4px 8px 4px 14px',
              fontSize,
              fontWeight: isSelected ? 600 : 400,
              lineHeight,
              textAlign: 'left',
              color: isBlank
                ? 'transparent'
                : isSelected
                  ? '#fff'
                  : dimmed
                    ? 'rgba(255,255,255,0.3)'
                    : 'rgba(255,255,255,0.55)',
              background: isSelected ? `rgba(${accent},0.18)` : 'transparent',
              borderRadius: isSelected ? 8 : 0,
              minHeight: isBlank ? 10 : undefined,
              cursor: isBlank ? 'default' : 'pointer',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              transition: 'color 0.2s, background 0.2s, font-weight 0.2s',
            }}
          >
            {isSelected ? (
              <span
                aria-hidden
                style={{
                  position: 'absolute', left: 2, top: 4, bottom: 4, width: 3,
                  borderRadius: 999,
                  background: `rgb(${accent})`,
                  boxShadow: `0 0 10px rgba(${accent},0.7)`,
                }}
              />
            ) : null}
            {line.trim() || '\u00A0'}
          </div>
        );
      })}
    </div>
  );
}

