import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Shuffle, Repeat, Repeat1 } from 'lucide-react';
import Icons from './Icons.jsx';
import { sampleCoverTheme } from './coverTheme.js';

import { titleCollator, formatTime, parseLRC } from './mediaUtils.js';
import { MetadataEditor, AlbumMetadataEditor } from './MetadataEditor.jsx';
import { AddToPlaylistMenu, PlaylistEditor } from './PlaylistEditor.jsx';
import { StatsTab } from './StatsTab.jsx';
import { Tooltip, HeartSlider, MediaSkipBtn, MediaPlayPauseBtn, MediaToggleBtn } from './sharedUI.jsx';
import { SettingsTab } from './SettingsTab.jsx';
import { NavRail, BottomDockBar, SideDock } from './AppShell.jsx';
import { LyricsEditor, SyncedLyrics, PlainLyrics } from './Lyrics.jsx';
import { ContextMenu, CandidatePickerModal } from './ContextMenu.jsx';
import { CoverFullscreenOverlay, LyricShareOverlay, BoostButton } from './Overlays.jsx';
import { EdgeBleedBand, AnimatedGradientBg } from './VisualEffects.jsx';
import { WelcomeScreen } from './WelcomeScreen.jsx';
import { FilterableText } from './LibraryTab.jsx';
import { useToast } from './Toasts.jsx';

/** Lyrics icon (microphone / karaoke). */
import { LyricsPickerButton } from './LyricsPicker.jsx';

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
  onOpenTutorial,
  onOpenUpdateHistory,
  onPlayTrack,
  onPlayPauseTrack,
  onTogglePlay,
  sleepMode = 'off',
  sleepEndsAt = null,
  onSetSleepTimer,
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
  previewVolumePosition = 'bottomRight',
  onSetPreviewVolumePosition,
  nowPlayingSliderStyle = 'circle',
  onSetNowPlayingSliderStyle,
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
  dockOrder = [],
  onSetDockOrder,
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
  recentlyPlayedEnabled = true,
  onSetRecentlyPlayedEnabled,
  onShowOnboarding,
  firstTimeSparkleEnabled = false,
  onSetFirstTimeSparkleEnabled,
  trackOfMomentEnabled = false,
  onSetTrackOfMomentEnabled,
  clickToFilterEnabled = false,
  librarySwitcherStyle = 'chip',
  onSetLibrarySwitcherStyle,
  pinnedPlaylists = [],
  onTogglePinnedPlaylist,
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
  transitionMode = 'off',
  onSetTransitionMode,
  crossfadeSec = 6,
  onSetCrossfadeSec,
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
  const pushToast = useToast();

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
    // Open the menu for any reorderable tab (move left/right) or any hideable
    // tab (hide). Reordering no longer requires the pinnable-tabs toggle; the
    // menu items themselves decide what's offered for this tab.
    const reorderable = ['find', 'library', 'new', 'settings', 'stats', 'journal'].includes(id);
    const hideable = pinnableTabsEnabled && isTabHideable(id);
    if (!reorderable && !hideable) return undefined;
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

  // Move the menu's target tab one slot left/right in the dock. Library and
  // settings are pinned; we reorder around them within the nav group.
  const DOCK_DEFAULT_ORDER = ['find', 'library', 'new', 'settings', 'stats', 'journal'];
  const currentDockOrder = useMemo(() => {
    const saved = (Array.isArray(dockOrder) ? dockOrder : []).filter((x) => DOCK_DEFAULT_ORDER.includes(x));
    const out = [...saved];
    for (const id of DOCK_DEFAULT_ORDER) if (!out.includes(id)) out.push(id);
    return out;
  }, [dockOrder]);
  const moveDockTab = useCallback((dir) => {
    if (!dockTabMenu) return;
    const id = dockTabMenu.tabId;
    setDockTabMenu(null);
    const arr = [...currentDockOrder];
    const i = arr.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onSetDockOrder?.(arr);
  }, [dockTabMenu, currentDockOrder, onSetDockOrder]);
  const dockMoveBounds = useMemo(() => {
    if (!dockTabMenu) return { canLeft: false, canRight: false };
    const i = currentDockOrder.indexOf(dockTabMenu.tabId);
    return { canLeft: i > 0, canRight: i >= 0 && i < currentDockOrder.length - 1 };
  }, [dockTabMenu, currentDockOrder]);

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
  // Monotonic request id. Bumped on every track-change fetch, manual refetch,
  // and manual lyrics pick. Any async lyrics result must re-check this before
  // applying; if it moved on, the result is stale and is discarded. This stops
  // a slow initial fetch (LRCLIB cold searches can take 4-7s) from landing
  // after the user has already picked a version in the picker and silently
  // overwriting it.
  const lyricsReqRef = useRef(0);

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

    // Claim this request. Any async result below — and any earlier in-flight
    // fetch — may only apply if the id still matches.
    const reqId = ++lyricsReqRef.current;

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
      // Discard if the track changed OR the user picked a version while we
      // were in flight (lyricsReqRef moved on).
      if (cancelled || lyricsReqRef.current !== reqId) return;
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
      if (cancelled || lyricsReqRef.current !== reqId) return;
      lyricsCacheRef.current.set(track.id, null);
      setLyricsData(null);
      setLyricsTrackId(track.id);
      setLyricsFetching(false);
    });
    return () => { cancelled = true; };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

  const hasSyncedLyrics = lyricsData?.synced?.length > 0;
  const hasPlainLyrics = !!lyricsData?.plain;
  const hasAnyLyrics = hasSyncedLyrics || hasPlainLyrics;
  const showLyrics = lyricsVisible && hasAnyLyrics && currentTrack;
  // Plain text of the lyrics currently applied — passed to the picker so it
  // can mark which listed version is in use (matched by content, so it works
  // whether the active lyrics came from the picker or the automatic fetch).
  const appliedLyricText = lyricsData
    ? (lyricsData.synced?.length
        ? lyricsData.synced.map((l) => l.text).join('\n')
        : (lyricsData.plain || ''))
    : '';
  const appliedLyricId = lyricsData?.lyricId ?? null;

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
    // Claim this request so a manual pick (or a track change) made while the
    // refetch is in flight supersedes it.
    const reqId = ++lyricsReqRef.current;
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
      if (lyricsReqRef.current !== reqId) return; // superseded (e.g. user picked)
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
      if (lyricsReqRef.current !== reqId) return;
      lyricsCacheRef.current.set(track.id, null);
      setLyricsData(null);
      setLyricsTrackId(track.id);
    } finally {
      if (lyricsReqRef.current === reqId) setLyricsFetching(false);
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

  // Full sorted library (ignores the search filter). Used as the play queue
  // when the user plays a song while a search is active, so playback continues
  // through the whole library instead of dead-ending after the filtered
  // results. The clicked track is passed separately, so it still plays first.
  // Wrap play callbacks to pass the visible track list (so the queue matches
  // what's on screen) AND the play context. 'single' (a one-off song search)
  // plays the track then continues with a random shuffle of the library
  // (handled in App.playTrack); 'list' queues the visible group; an explicit
  // overrideList (album view) wins.
  const sortedPlayTrack = useCallback((track, overrideList, context = 'list') => {
    if (context === 'single') { onPlayTrack(track, null, 'single'); return; }
    const queue = overrideList && overrideList.length > 0 ? overrideList : tracks;
    onPlayTrack(track, queue, 'list');
  }, [onPlayTrack, tracks]);

  const sortedPlayPauseTrack = useCallback((track, overrideList, context = 'list') => {
    if (context === 'single') { onPlayPauseTrack(track, null, 'single'); return; }
    const queue = overrideList && overrideList.length > 0 ? overrideList : tracks;
    onPlayPauseTrack(track, queue, 'list');
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

  // Cover used for the welcome/explore screen's full-stage bleed. Deterministic
  // day-seeded pick (matches the recommendation shown inside), falling back to
  // any cover. Rendered at the stage level (a sibling of WelcomeScreen) so the
  // bleed fills the entire app, not just the inner scroll container. Declared
  // AFTER showWelcome to avoid a temporal-dead-zone reference.
  const welcomeBackdropCover = useMemo(() => {
    if (!showWelcome || !library.length) return null;
    const withArt = library.filter((t) => t.coverArt && (t.album || '').trim());
    if (withArt.length === 0) return null;
    const now = Date.now();
    const threeWeeks = 1000 * 60 * 60 * 24 * 21;
    const stale = withArt.filter((t) => { const l = t.lastPlayed || 0; return l === 0 || (now - l) > threeWeeks; });
    const pool = stale.length > 0 ? stale : withArt;
    const dayKey = new Date().toDateString();
    let h = 0; for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) | 0;
    return pool[Math.abs(h) % pool.length]?.coverArt || null;
  }, [showWelcome, library]);

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
        onClick: () => { onRemoveFromLibrary?.([track.id]); pushToast({ message: `Removed "${track.title || 'track'}" from library`, kind: 'info' }); },
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
    const pl = playlists?.find((p) => p.id === playlistId);
    pushToast({ message: `Added ${ids.length} track${ids.length > 1 ? 's' : ''} to ${pl?.name || 'playlist'}`, kind: 'success' });
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


  const handlePickLyrics = useCallback(async (candidate) => {
    if (!currentTrack) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    const synced = candidate.syncedLyrics ? parseLRC(candidate.syncedLyrics) : [];
    const plain = candidate.plainLyrics || null;
    // Claim ownership BEFORE the await: bumping the request id invalidates any
    // in-flight auto-fetch/refetch so a slow network result can't land
    // afterward and overwrite this pick.
    const reqId = ++lyricsReqRef.current;
    if (api?.saveLyrics) {
      await api.saveLyrics({
        title: currentTrack.title, artist: currentTrack.artist,
        syncedLyrics: candidate.syncedLyrics, plainLyrics: plain,
      });
    }
    // If the track changed during the save round-trip, don't stomp the new one.
    if (lyricsReqRef.current !== reqId) return;
    const data = { synced, plain, instrumental: false, lyricId: candidate.id ?? null };
    lyricsCacheRef.current.set(currentTrack.id, data);
    setLyricsData(data);
    setLyricsTrackId(currentTrack.id);
    setLyricsFetching(false);
    pushToast({ message: candidate.hasSynced ? 'Synced lyrics applied' : 'Plain lyrics applied', kind: 'success' });
  }, [currentTrack, pushToast]);

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
    pushToast({ message: 'Lyrics saved', kind: 'success' });
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

      {/* Welcome/explore backdrop — rendered at the STAGE level (sibling of
          WelcomeScreen) so the cover-art bleed and accent fields fill the
          entire app, including behind the dock, rather than being clipped to
          the inner scroll container. */}
      {showWelcome ? (
        <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          {welcomeBackdropCover ? (
            <div className="xp-bleed" style={{
              position: 'absolute', inset: '-18%',
              backgroundImage: `url(${welcomeBackdropCover})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              filter: 'blur(130px) saturate(1.6)', opacity: 0.5,
            }} />
          ) : null}
          <div className="xp-field xp-field-a" style={{
            position: 'absolute', top: '-12%', left: '8%', width: '60%', height: '70%', borderRadius: '50%',
            background: `radial-gradient(circle, rgba(${accent}, 0.34) 0%, rgba(${accent}, 0) 62%)`, filter: 'blur(85px)',
          }} />
          <div className="xp-field xp-field-b" style={{
            position: 'absolute', top: '40%', left: '55%', width: '55%', height: '64%', borderRadius: '50%',
            background: `radial-gradient(circle, rgba(${accent}, 0.18) 0%, rgba(${accent}, 0) 60%)`, filter: 'blur(95px)',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse 120% 70% at 50% 0%, transparent 40%, rgba(0,0,0,0.4) 100%), linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.5) 100%)',
          }} />
          <style>{EXPLORE_CSS}</style>
        </div>
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
          onOpenAlbumInLibrary={(query) => {
            const q = (query || '').trim();
            if (q) setSearch(q);
            setDockTab('library');
            setDockPanelOpen(true);
          }}
          onOpenFind={() => { setDockTab('find'); setDockPanelOpen(true); }}
          onOpenNew={() => { setDockTab('new'); setDockPanelOpen(true); }}
          onNewPlaylist={() => {
            setPendingTracksForNewPlaylist(null);
            setEditingPlaylist('new');
          }}
          onPlayTrack={onPlayPauseTrack}
          accent={accent}
          onSpotifyImportDone={onSpotifyImportDone}
          onPreviewPlay={() => { if (isPlaying) onTogglePlay?.(); }}
          followedReleases={releases}
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
              /* Subtle breathing glow while playing — pulses the shadow
                 size/opacity instead of scaling the image, so the cover
                 art stays at 1:1 pixel ratio and isn't degraded by GPU
                 resampling. Pauses in-place when paused. */
              animation: isPlaying ? `immerseCoverBreathe 8s ease-in-out infinite` : 'none',
              transition: 'box-shadow 0.4s ease',
              position: 'relative',
              cursor: coverFullscreenEnabled && currentTrack ? 'zoom-in' : 'default',
              outline: 'none',
            }}
          >
            <style>{`
              @keyframes immerseCoverBreathe {
                0%, 100% { box-shadow: 0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(${accent},0.35); }
                50% { box-shadow: 0 32px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(${accent},0.5), 0 0 40px rgba(${accent},0.08); }
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
              thumbShape={nowPlayingSliderStyle}
            />
            <span style={{
              color: 'rgba(255,255,255,0.55)', fontSize: 10.5, fontVariantNumeric: 'tabular-nums',
              minWidth: 34, letterSpacing: '0.02em',
            }}
            >
              {formatTime(duration)}
            </span>
          </div>

          {/* Transport — clean line icons, no container, generous spacing */}
          <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
            <MediaToggleBtn onClick={onToggleShuffle} title="Shuffle" active={shuffleOn}>
              <Shuffle size={20} strokeWidth={2} />
            </MediaToggleBtn>

            <MediaSkipBtn onClick={onPrev} title="Previous">
              {/* A — single chevron, rounded */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 4L7 12l10 8" />
              </svg>
            </MediaSkipBtn>

            <MediaPlayPauseBtn onClick={onTogglePlay} isPlaying={isPlaying} />

            <MediaSkipBtn onClick={onNext} title="Next">
              {/* A — single chevron, rounded */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4l10 8-10 8" />
              </svg>
            </MediaSkipBtn>

            <MediaToggleBtn onClick={onToggleRepeat} title={`Repeat: ${repeat}`} active={repeat !== 'off'}>
              {repeat === 'one' ? (
                <Repeat1 size={20} strokeWidth={2} />
              ) : (
                <Repeat size={20} strokeWidth={2} />
              )}
            </MediaToggleBtn>
          </div>

          {/* Volume — small speaker on left (mute toggle), slider, speaker-with-waves on right */}
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
                {/* small speaker — no waves */}
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
              thumbShape={nowPlayingSliderStyle}
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
          {/* Hover-reveal refetch button */}
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
          {currentTrack && !lyricsEditing ? (
            <LyricsPickerButton
              currentTrack={currentTrack}
              accent={accent}
              visible={lyricsPanelHovered}
              onApply={handlePickLyrics}
              appliedText={appliedLyricText}
              appliedId={appliedLyricId}
            />
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
        dockOrder={dockOrder}
        onSetDockOrder={onSetDockOrder}
        tabContextHandler={handleTabContextMenu}
        randomButtonEnabled={randomButtonEnabled}
        onPlayRandom={onPlayRandom}
        breathingDockPillEnabled={breathingDockPillEnabled}
        dockTransparentEnabled={dockTransparentEnabled}
        liquidGlassDockEnabled={liquidGlassDockEnabled}
        journalTabEnabled={journalTabEnabled}
        library={library}
        playEvents={playEvents}
        onPlayTrack={onPlayTrack}
        isPlaying={isPlaying}
        dockDraggableEnabled={dockDraggableEnabled}
        dockPosition={dockPosition}
        onSetDockPosition={onSetDockPosition}
        pinnedPlaylists={pinnedPlaylists}
        onTogglePinnedPlaylist={onTogglePinnedPlaylist}
        playlists={playlists}
        playlistCoverMap={playlistCoverMap}
      />

      <SideDock
        collapsed={dockCollapsed}
        onToggleCollapsed={() => setDockCollapsed((v) => !v)}
        onOpenTutorial={onOpenTutorial}
        onOpenUpdateHistory={onOpenUpdateHistory}
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
        previewVolumePosition={previewVolumePosition}
        onSetPreviewVolumePosition={onSetPreviewVolumePosition}
        onPreviewPlay={() => { if (isPlaying) onTogglePlay?.(); }}
        nowPlayingSliderStyle={nowPlayingSliderStyle}
        onSetNowPlayingSliderStyle={onSetNowPlayingSliderStyle}
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
        recentlyPlayedEnabled={recentlyPlayedEnabled}
        onSetRecentlyPlayedEnabled={onSetRecentlyPlayedEnabled}
        onShowOnboarding={onShowOnboarding}
        firstTimeSparkleEnabled={firstTimeSparkleEnabled}
        onSetFirstTimeSparkleEnabled={onSetFirstTimeSparkleEnabled}
        trackOfMomentEnabled={trackOfMomentEnabled}
        onSetTrackOfMomentEnabled={onSetTrackOfMomentEnabled}
        clickToFilterEnabled={clickToFilterEnabled}
        onSetClickToFilterEnabled={onSetClickToFilterEnabled}
        librarySwitcherStyle={librarySwitcherStyle}
        onSetLibrarySwitcherStyle={onSetLibrarySwitcherStyle}
        pinnedPlaylists={pinnedPlaylists}
        onTogglePinnedPlaylist={onTogglePinnedPlaylist}
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
        transitionMode={transitionMode}
        onSetTransitionMode={onSetTransitionMode}
        crossfadeSec={crossfadeSec}
        onSetCrossfadeSec={onSetCrossfadeSec}
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
      {/* Lyrics version picker — portaled glass modal matching Immerse aesthetic.
          Lets the user browse all LRCLIB results and choose which lyrics to use. */}


      {pickerState ? createPortal(
        <CandidatePickerModal
          open
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
              try { pickerState.onSuccess?.(r.track); } catch { /* ignore */ }
              onSpotifyImportDone?.(r.track);
              setPickerState(null);
            }
            return r;
          }}
        />,
        document.body
      ) : null}

      {/* Right-click context menu — opens at cursor coordinates with the
          item list provided by whichever element triggered it. Single
          state at the page root so any region can show one. */}
      {contextMenu ? (
        <ContextMenu
          anchorX={contextMenu.x}
          anchorY={contextMenu.y}
          items={contextMenu.items}
          accent={accent}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {/* Metadata editor — floating glass modal, only visible when a track is being edited */}
      {editingTrack ? (
        <MetadataEditor
          track={editingTrack}
          onSave={async (fields) => {
            const r = await onUpdateTrackMetadata(editingTrack.id, fields);
            if (r?.ok) { setEditingTrackId(null); pushToast({ message: 'Metadata saved', kind: 'success' }); }
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
            if (r?.ok) { setEditingAlbumScope(null); pushToast({ message: 'Album metadata saved', kind: 'success' }); }
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
                const pending = pendingTracksForNewPlaylist;
                if (pending && pending.length > 0) {
                  try { await onAddTracksToPlaylist(r.id, pending); } catch { /* ignore */ }
                }
                setPendingTracksForNewPlaylist(null);
                setEditingPlaylist(null);
                setDockTab(`playlist:${r.id}`);
                if (dockCollapsed) setDockCollapsed(false);
                pushToast({ message: `Playlist "${fields.name || 'Untitled'}" created`, kind: 'success' });
              }
              return r;
            }
            const r = await onUpdatePlaylist(editingPlaylistObj.playlist.id, fields);
            if (r?.ok) { setEditingPlaylist(null); pushToast({ message: 'Playlist updated', kind: 'success' }); }
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
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          shuffleOn={shuffleOn}
          repeat={repeat}
          volume={volume}
          onSetVolume={onSetVolume}
          nowPlayingSliderStyle={nowPlayingSliderStyle}
          onTogglePlay={onTogglePlay}
          onPrev={onPrev}
          onNext={onNext}
          onSeek={onSeek}
          onToggleShuffle={onToggleShuffle}
          onToggleRepeat={onToggleRepeat}
          lyricsData={lyricsData}
          hasSyncedLyrics={hasSyncedLyrics}
          hasPlainLyrics={hasPlainLyrics}
          onClose={() => setCoverFullscreenOpen(false)}
        />
      ) : null}

      {/* Lyric share overlay — preview card + Share with friends (copies image). */}
      {lyricShareOpen && currentTrack && lyricsSelection ? (() => {
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

      {/* Dock-tab context menu — reuses the shared ContextMenu component so it
          matches the rest of the app's right-click menus AND inherits its
          measure-after-mount viewport clamping (so it never pops off-screen).
          Items are built from move bounds + hide eligibility. */}
      {dockTabMenu ? (() => {
        const items = [];
        if (dockMoveBounds.canLeft) {
          items.push({ key: 'mleft', label: 'Move left', onClick: () => moveDockTab(-1),
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg> });
        }
        if (dockMoveBounds.canRight) {
          items.push({ key: 'mright', label: 'Move right', onClick: () => moveDockTab(1),
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg> });
        }
        if (pinnableTabsEnabled && isTabHideable(dockTabMenu.tabId)) {
          if (items.length) items.push({ divider: true });
          items.push({ key: 'hide', label: 'Hide tab', onClick: handleHideTabFromMenu,
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg> });
        }
        if (!items.length) return null;
        return (
          <ContextMenu
            anchorX={dockTabMenu.x}
            anchorY={dockTabMenu.y}
            items={items}
            accent={accent}
            onClose={() => setDockTabMenu(null)}
          />
        );
      })() : null}

    </div>
  );
}

/** MetadataEditor — floating glass modal for editing a track's metadata including cover art. */

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
 *  CoverFullscreenOverlay — full "now playing" screen. Large cover art with
 *  a blurred backdrop sampled from the same image, plus the full Immerse
 *  transport (shuffle / prev / play-pause / next / repeat), a seek bar, and
 *  track info. Reuses the same MediaSkipBtn/MediaPlayPauseBtn + HeartSlider as the dock so it
 *  feels native to the app rather than a separate surface.
 *
 *  Layout: side-by-side (cover left, controls right) on wide windows; stacks
 *  vertically when the window is narrow. The dismiss control lives top-LEFT
 *  to avoid colliding with the OS window buttons on the right, and the top
 *  strip is window-draggable so the app can still be moved while open.
 *
 *  Dismiss: the close button, Escape, or 'f'. Clicking the backdrop also
 *  closes; clicking the cover or controls does not.
 * ========================================================================= */

const EXPLORE_CSS = `
  .xp-scroll * { box-sizing: border-box; }
  .xp-scroll::-webkit-scrollbar { width: 10px; }
  .xp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.13); border-radius: 5px; border: 3px solid transparent; background-clip: content-box; }
  .xp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); background-clip: content-box; }

  @keyframes xp-drift-a { 0%,100%{transform:translate3d(0,0,0) scale(1)} 33%{transform:translate3d(6%,4%,0) scale(1.08)} 66%{transform:translate3d(-4%,2%,0) scale(1.04)} }
  @keyframes xp-drift-b { 0%,100%{transform:translate3d(0,0,0) scale(1.05)} 50%{transform:translate3d(-7%,-5%,0) scale(1)} }
  @keyframes xp-breathe { 0%,100%{opacity:.42; transform:scale(1)} 50%{opacity:.52; transform:scale(1.05)} }
  .xp-field-a { animation: xp-drift-a 30s ease-in-out infinite; will-change: transform; }
  .xp-field-b { animation: xp-drift-b 38s ease-in-out infinite; will-change: transform; }
  .xp-bleed { animation: xp-breathe 24s ease-in-out infinite; will-change: opacity, transform; }
  @keyframes xp-in { 0%{opacity:0; transform:translateY(14px)} 100%{opacity:1; transform:translateY(0)} }
  @keyframes xp-tile-in { 0%{opacity:0; transform:translateY(16px) scale(.97)} 100%{opacity:1; transform:translateY(0) scale(1)} }
  @keyframes xp-spin { to { transform: rotate(360deg); } }
  .xp-spin { transform-origin: 12px 12px; animation: xp-spin .9s linear infinite; }

  .xp-sec { animation: xp-in .6s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

  .xp-head { margin-bottom: 30px; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
  .xp-head-left { min-width: 0; }
  .xp-greeting { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 8px; }
  .xp-wordmark { font-size: clamp(30px, 4vw, 40px); font-weight: 300; letter-spacing: -0.02em; line-height: 1; color: #fff; }
  .xp-tag { display: block; font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 9px; letter-spacing: 0.01em; }

  /* Start listening — soft outlined chip with squared accent icon */
  .xp-start { display: inline-flex; align-items: center; gap: 12px; cursor: pointer; border: 1px solid rgba(255,255,255,0.16); border-radius: 14px; padding: 10px 18px 10px 12px;
    background: rgba(255,255,255,0.03); font: inherit; color: #fff;
    transition: background .18s, border-color .18s, transform .18s cubic-bezier(0.16,1,0.3,1); flex-shrink: 0; }
  .xp-start:hover { background: rgba(var(--acc),0.14); border-color: rgba(var(--acc),0.5); transform: translateY(-2px); }
  .xp-start-ico { width: 40px; height: 40px; flex-shrink: 0; border-radius: 11px; background: rgb(var(--acc)); color: #fff; display: flex; align-items: center; justify-content: center; padding-left: 2px; }
  .xp-start-tx { display: flex; flex-direction: column; align-items: flex-start; }
  .xp-start-t { font-size: 14px; font-weight: 700; color: #fff; }
  .xp-start-s { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }

  .xp-label { display: flex; align-items: center; gap: 9px; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.55); margin-bottom: 14px; }

  /* Hero */
  .xp-hero { position: relative; overflow: hidden; display: flex; align-items: center; gap: 20px; padding: 18px; border-radius: 20px; cursor: pointer; max-width: 720px;
    background: rgba(18,18,20,0.6); backdrop-filter: blur(30px) saturate(1.6); -webkit-backdrop-filter: blur(30px) saturate(1.6);
    border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 22px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
    transition: transform .3s cubic-bezier(0.16,1,0.3,1), box-shadow .3s; }
  .xp-hero:hover { transform: translateY(-3px); box-shadow: 0 28px 70px rgba(0,0,0,0.6); }
  .xp-hero-wash { position: absolute; inset: 0; pointer-events: none; }
  .xp-hero-cov { position: relative; z-index: 1; width: clamp(96px,12vw,124px); height: clamp(96px,12vw,124px); border-radius: 13px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); flex-shrink: 0; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
  .xp-hero-meta { position: relative; z-index: 1; flex: 1; min-width: 0; }
  .xp-hero-t { font-size: clamp(20px,2.6vw,26px); font-weight: 700; color: #fff; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-hero-a { font-size: 14px; color: rgba(255,255,255,0.62); margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-hero-play { position: relative; z-index: 1; flex-shrink: 0; width: 54px; height: 54px; border-radius: 50%; background: #fff; color: #000; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 22px rgba(0,0,0,0.4); transition: transform .18s cubic-bezier(0.34,1.56,0.64,1); }
  .xp-hero-play:hover { transform: scale(1.08); }

  /* ===== Combined "For you" grid — favorites + rediscovery ===== */
  .xp-foryou { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: clamp(14px, 1.6vw, 20px); max-width: 1000px; }
  @media (max-width: 760px) { .xp-foryou { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .xp-fy { cursor: pointer; display: flex; flex-direction: column; gap: 9px; animation: xp-tile-in .5s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-fy-cov { position: relative; width: 100%; aspect-ratio: 1; border-radius: 13px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 12px 32px rgba(0,0,0,0.5); transition: transform .26s cubic-bezier(0.16,1,0.3,1), box-shadow .26s; }
  .xp-fy:hover .xp-fy-cov { transform: translateY(-5px); box-shadow: 0 22px 52px rgba(0,0,0,0.62); }
  .xp-fy-play { position: absolute; bottom: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.96); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 22px rgba(0,0,0,0.5); opacity: 0; transform: translateY(6px) scale(0.85); transition: opacity .2s, transform .2s cubic-bezier(0.34,1.56,0.64,1); }
  .xp-fy:hover .xp-fy-play { opacity: 1; transform: translateY(0) scale(1); }
  .xp-fy-play:hover { transform: scale(1.09); }
  .xp-fy-go { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border-radius: 50%; background: rgba(255,255,255,0.9); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: scale(0.8); transition: opacity .2s, transform .2s; }
  .xp-fy:hover .xp-fy-go { opacity: 1; transform: scale(1); }
  .xp-fy-go:hover { transform: scale(1.1); background: #fff; }
  .xp-fy-reason { align-self: flex-start; font-size: 8.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 7px; border-radius: 100px; }
  .xp-fy-reason.favorite { color: #fff; background: rgba(var(--acc),0.95); }
  .xp-fy-reason.rediscover { color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.25); }
  .xp-fy-t { font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
  .xp-fy-a { font-size: 11px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; margin-top: -3px; }

  /* Top songs list */
  .xp-chart-list { display: flex; flex-direction: column; gap: 4px; max-width: 720px; }
  .xp-song { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border-radius: 12px; transition: background .14s; animation: xp-in .5s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-song:hover { background: rgba(255,255,255,0.05); }
  .xp-rank { width: 22px; text-align: center; font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .xp-song-cov { width: 46px; height: 46px; border-radius: 8px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .xp-song-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .xp-song-t { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-song-a { font-size: 11.5px; color: rgba(255,255,255,0.5); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .xp-dl { width: 32px; height: 32px; flex-shrink: 0; border-radius: 50%; background: rgba(255,255,255,0.08); border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .15s; }
  .xp-dl:hover { background: rgba(var(--acc),0.85); }
  .xp-dl.queued { background: rgba(var(--acc),0.5); cursor: default; }
  .xp-dl.done { background: rgba(80,200,120,0.85); cursor: default; }
  .xp-dl.failed { background: rgba(220,80,80,0.7); }

  /* Horizontal cover rows */
  .xp-row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; padding-top: 2px; }
  .xp-row::-webkit-scrollbar { height: 8px; }
  .xp-row::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 4px; }
  .xp-tile { flex-shrink: 0; width: 150px; padding: 0; background: none; border: none; cursor: pointer; display: flex; flex-direction: column; gap: 9px; text-align: left; animation: xp-tile-in .55s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-tile-cov { width: 150px; height: 150px; border-radius: 12px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); position: relative; box-shadow: 0 12px 32px rgba(0,0,0,0.5); transition: transform .25s cubic-bezier(0.16,1,0.3,1), box-shadow .25s; }
  .xp-tile:hover .xp-tile-cov { transform: translateY(-4px); }
  .xp-tile.open .xp-tile-cov { box-shadow: 0 16px 40px rgba(0,0,0,0.6), 0 0 0 2px rgba(var(--acc),0.95); }
  .xp-tile-badge { position: absolute; top: 9px; left: 9px; background: rgba(0,0,0,0.62); border: 1px solid rgba(var(--acc),0.95); color: #fff; font-size: 8px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 7px; border-radius: 100px; backdrop-filter: blur(4px); }
  .xp-tile-chev, .xp-tile-play { position: absolute; bottom: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }
  .xp-tile:hover .xp-tile-chev, .xp-tile:hover .xp-tile-play, .xp-tile.open .xp-tile-chev { opacity: 1; transform: translateY(0); }
  .xp-tile-t { font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; padding: 0 2px; }
  .xp-tile-a { font-size: 11px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; padding: 0 2px; margin-top: -4px; }

  /* Album expand panel */
  @keyframes xp-ap-in { 0%{opacity:0; transform:translateY(-6px); max-height:0} 100%{opacity:1; transform:translateY(0); max-height:380px} }
  .xp-album-panel { margin-top: 10px; max-width: 760px; border-radius: 16px; overflow: hidden;
    background: rgba(14,14,16,0.66); backdrop-filter: blur(28px) saturate(1.5); -webkit-backdrop-filter: blur(28px) saturate(1.5);
    border: 1px solid rgba(255,255,255,0.09); box-shadow: 0 22px 56px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--acc),0.14);
    animation: xp-ap-in .34s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-ap-head { display: flex; align-items: center; gap: 14px; padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .xp-ap-art { width: 60px; height: 60px; border-radius: 10px; background-size: cover; background-position: center; flex-shrink: 0; box-shadow: 0 6px 16px rgba(0,0,0,0.5); }
  .xp-ap-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .xp-ap-t { font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-ap-s { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 2px; }
  .xp-ap-d { font-size: 10.5px; color: rgba(255,255,255,0.4); margin-top: 4px; }
  .xp-ap-all { display: inline-flex; align-items: center; gap: 7px; background: rgba(var(--acc),0.88); border: 1px solid rgba(var(--acc),1); color: #fff; cursor: pointer; padding: 9px 14px; border-radius: 10px; font-size: 12px; font-weight: 700; white-space: nowrap; transition: filter .15s; }
  .xp-ap-all:hover { filter: brightness(1.15); }
  .xp-ap-x { width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .xp-ap-x:hover { background: rgba(255,255,255,0.12); }
  .xp-ap-tracks { max-height: 280px; overflow-y: auto; padding: 6px; }
  .xp-ap-tracks::-webkit-scrollbar { width: 8px; }
  .xp-ap-tracks::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
  .xp-ap-row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; transition: background .12s; }
  .xp-ap-row:hover { background: rgba(255,255,255,0.05); }
  .xp-ap-n { width: 20px; text-align: right; font-size: 11.5px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }
  .xp-ap-tn { flex: 1; min-width: 0; font-size: 13px; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-ap-e { font-size: 8px; font-weight: 800; border: 1px solid rgba(255,255,255,0.28); border-radius: 3px; padding: 1px 4px; color: rgba(255,255,255,0.7); }
  .xp-ap-dur { font-size: 11.5px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }

  /* Skeletons */
  @keyframes xp-shim { 0%{opacity:.4} 50%{opacity:.7} 100%{opacity:.4} }
  .xp-skel-row { height: 62px; border-radius: 12px; background: rgba(255,255,255,0.05); animation: xp-shim 1.4s ease-in-out infinite; max-width: 720px; }
  .xp-skel-tile { flex-shrink: 0; width: 150px; height: 188px; border-radius: 12px; background: rgba(255,255,255,0.05); animation: xp-shim 1.4s ease-in-out infinite; }

  .xp-msg { font-size: 13px; color: rgba(255,255,255,0.5); padding: 14px 2px; }

  /* New releases — full list with inline expand */
  .xp-rel-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 18px; max-width: 980px; align-items: start; }
  @media (max-width: 760px) { .xp-rel-list { grid-template-columns: 1fr; } }
  .xp-rel { border-radius: 12px; overflow: hidden; }
  .xp-rel.open { background: rgba(255,255,255,0.03); grid-column: 1 / -1; }
  .xp-rel-row { display: flex; align-items: center; gap: 14px; width: 100%; padding: 9px 12px; border-radius: 12px; background: none; border: none; cursor: pointer; text-align: left; transition: background .14s; animation: xp-in .45s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-rel-row:hover { background: rgba(255,255,255,0.05); }
  .xp-rel-cov { width: 52px; height: 52px; flex-shrink: 0; border-radius: 9px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 5px 14px rgba(0,0,0,0.4); }
  .xp-rel-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .xp-rel-t { font-size: 14.5px; font-weight: 600; color: rgba(255,255,255,0.95); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 9px; }
  .xp-rel-tag { font-size: 8.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.28); border-radius: 4px; padding: 1px 5px; flex-shrink: 0; }
  .xp-rel-tag.single { color: #fff; background: rgba(var(--acc),0.95); border-color: rgba(var(--acc),1); }
  .xp-rel-a { font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-rel-act { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.85); display: flex; align-items: center; justify-content: center; transition: background .15s, color .15s; }
  .xp-rel-row:hover .xp-rel-act { background: rgba(var(--acc),0.85); color: #fff; }
  .xp-rel-act.queued { background: rgba(var(--acc),0.5); }
  .xp-rel-act.done { background: rgba(80,200,120,0.85); color: #fff; }
  .xp-rel-act.failed { background: rgba(220,80,80,0.7); color: #fff; }
  @keyframes xp-relpanel-in { 0%{opacity:0; transform:translateY(-4px)} 100%{opacity:1; transform:translateY(0)} }
  .xp-rel-panel { padding: 4px 12px 12px 78px; animation: xp-relpanel-in .28s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-rel-panel-bar { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
  .xp-rel-genre { font-size: 10.5px; color: rgba(255,255,255,0.4); letter-spacing: 0.04em; text-transform: uppercase; }

  /* Top songs — 2-column grid (wraps into 2 rows of 5 at default 10) */
  .xp-song-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 22px; max-width: 980px; }
  .xp-viewmore { margin-top: 14px; display: inline-flex; align-items: center; gap: 7px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.8); cursor: pointer; padding: 9px 16px; border-radius: 100px; font: inherit; font-size: 11.5px; font-weight: 700; letter-spacing: 0.02em; transition: background .15s, border-color .15s; }
  .xp-viewmore:hover { background: rgba(var(--acc),0.2); border-color: rgba(var(--acc),0.5); color: #fff; }

  /* New releases — wrapping mosaic with a featured first tile */
  .xp-mosaic { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); grid-auto-rows: 120px; gap: 12px; max-width: 980px; }
  .xp-mtile { position: relative; border: none; padding: 0; cursor: pointer; border-radius: 14px; overflow: hidden; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 12px 32px rgba(0,0,0,0.5); animation: xp-tile-in .55s cubic-bezier(0.16,1,0.3,1) both; transition: transform .28s cubic-bezier(0.16,1,0.3,1), box-shadow .28s; }
  .xp-mtile.feat { grid-column: span 2; grid-row: span 2; }
  .xp-mtile:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 22px 56px rgba(0,0,0,0.65); z-index: 4; }
  .xp-mtile.open { box-shadow: 0 18px 46px rgba(0,0,0,0.65), 0 0 0 2px rgba(var(--acc),0.95); }
  .xp-mtile-badge { position: absolute; top: 9px; left: 9px; background: rgba(0,0,0,0.62); border: 1px solid rgba(var(--acc),0.95); color: #fff; font-size: 8px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 7px; border-radius: 100px; backdrop-filter: blur(4px); z-index: 2; }
  .xp-mtile-scrim { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px; text-align: left; background: linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.82) 100%); opacity: 0; transition: opacity .25s; }
  .xp-mtile:hover .xp-mtile-scrim, .xp-mtile.open .xp-mtile-scrim { opacity: 1; }
  .xp-mtile-t { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-mtile.feat .xp-mtile-t { font-size: 16px; white-space: normal; }
  .xp-mtile-a { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-mtile-chev { position: absolute; bottom: 11px; right: 11px; width: 30px; height: 30px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }
  .xp-mtile:hover .xp-mtile-chev, .xp-mtile.open .xp-mtile-chev { opacity: 1; transform: translateY(0); }
  .xp-skel-mtile { border-radius: 14px; background: rgba(255,255,255,0.05); animation: xp-shim 1.4s ease-in-out infinite; }

  /* Recently played — compact wall of square covers */
  .xp-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 12px; max-width: 980px; }
  .xp-wtile { position: relative; aspect-ratio: 1; border: none; padding: 0; cursor: pointer; border-radius: 12px; overflow: hidden; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 10px 26px rgba(0,0,0,0.45); animation: xp-tile-in .5s cubic-bezier(0.16,1,0.3,1) both; transition: transform .25s cubic-bezier(0.16,1,0.3,1), box-shadow .25s; }
  .xp-wtile:hover { transform: translateY(-4px) scale(1.02); box-shadow: 0 18px 44px rgba(0,0,0,0.6); z-index: 4; }
  .xp-wtile-scrim { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 9px; text-align: left; background: linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.85) 100%); opacity: 0; transition: opacity .22s; }
  .xp-wtile:hover .xp-wtile-scrim { opacity: 1; }
  .xp-wtile-t { font-size: 11px; font-weight: 700; color: #fff; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-wtile-a { font-size: 9.5px; color: rgba(255,255,255,0.65); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-wtile-play { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: scale(0.7); transition: opacity .2s, transform .2s; }
  .xp-wtile:hover .xp-wtile-play { opacity: 1; transform: scale(1); }

  .xp-stats { display: flex; gap: 16px; margin-top: 26px; font-size: 11.5px; color: rgba(255,255,255,0.34); font-variant-numeric: tabular-nums; }
  .xp-stats b { color: rgba(255,255,255,0.55); font-weight: 700; }
  .xp-stats .sep { opacity: 0.3; }

  .xp-pill-primary { background: rgba(var(--acc),0.55); border: 1px solid rgba(var(--acc),0.7); color: #fff; cursor: pointer; padding: 9px 18px; border-radius: 10px; font: inherit; font-size: 11.5px; font-weight: 700; transition: background .15s; }
  .xp-pill-primary:hover { background: rgba(var(--acc),0.7); }
  .xp-pill-ghost { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.85); cursor: pointer; padding: 9px 18px; border-radius: 10px; font: inherit; font-size: 11.5px; font-weight: 700; transition: background .15s; }
  .xp-pill-ghost:hover { background: rgba(255,255,255,0.12); }

  @media (prefers-reduced-motion: reduce) {
    .xp-field-a, .xp-field-b, .xp-bleed, .xp-spin, .xp-skel-row, .xp-skel-tile, .xp-skel-mtile { animation: none; }
    .xp-sec, .xp-song, .xp-tile, .xp-mtile, .xp-wtile, .xp-album-panel, .xp-fy { animation: none; }
  }
`;

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
