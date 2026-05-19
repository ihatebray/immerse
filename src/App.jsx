import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import ImmersiveLibraryPage from './ImmersiveLibraryPage.jsx';
import {
  getStoredFontId,
  storeFontId,
  presetById,
  loadGoogleFontForPreset,
} from './uiFonts.js';
import { useToastBus, ToastStack } from './Toasts.jsx';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Default Discord Application ID baked into the build, used when the
 * user hasn't entered their own. Lets Discord rich presence work
 * zero-setup — toggling the feature on Just Works, broadcasting
 * "Listening to Immerse" with the bundled app's name and assets.
 *
 * Users can still override in Settings (paste their own App ID) if
 * they want their Discord profile to credit a custom application.
 *
 * Set this to your created Discord application's "Application ID"
 * value from discord.com/developers/applications. Leave as empty
 * string to require user-supplied IDs only.
 */
const DEFAULT_DISCORD_APP_ID = ''; // ← paste your Discord App ID here

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const titleCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function sortByTitle(arr) {
  return [...arr].sort((a, b) =>
    titleCollator.compare(String(a.title || ''), String(b.title || ''))
    || titleCollator.compare(String(a.id), String(b.id))
  );
}

/**
 * Overlay freshly parsed cover art (and duration) onto DB rows for paths
 * present in `batch`. We deliberately copy both `coverArt` (which may
 * be a fast-rendering data: URI for the app's own UI) and `coverArtUrl`
 * (the public http(s) URL that Discord's media proxy can fetch). The DB
 * only persists one column so the round-trip via rowToTrack loses the
 * URL form; without re-overlaying it here, the in-memory track right
 * after import has only the data URI, and Discord falls back to its
 * asset key. The next app restart would heal it (rowToTrack puts the
 * URL into coverArt), but that's a confusing user-visible inconsistency.
 */
function mergeCoverArt(fromDb, batch) {
  if (!batch?.length) return fromDb;
  const rich = new Map(batch.map((t) => [t.filePath, t]));
  return fromDb.map((t) => {
    const r = rich.get(t.filePath);
    if (!r) return t;
    const next = { ...t };
    if (r.coverArt) {
      // If the DB track had a studio-cover:// URL and we're about to
      // overwrite it with a freshly-parsed data: URI, preserve it in
      // coverArtLocal so the Discord RPC imgbb uploader can still find it.
      // Without this, the studio-cover:// URL is lost in-memory for the
      // duration of the session and the imgbb upload path never triggers.
      if (typeof t.coverArt === 'string' && t.coverArt.startsWith('studio-cover://')) {
        next.coverArtLocal = t.coverArt;
      }
      next.coverArt = r.coverArt;
    }
    if (r.coverArtUrl) next.coverArtUrl = r.coverArtUrl;
    if (r.duration) next.duration = r.duration || t.duration;
    return next;
  });
}

export default function App() {
  const [library, setLibrary] = useState([]);
  const [libraryBootstrapped, setLibraryBootstrapped] = useState(() => typeof window === 'undefined' || !window.electronAPI);
  const [playlists, setPlaylists] = useState([]);

  // Global toast bus — used by the auto-updater (and anywhere else that
  // needs to surface a transient confirmation/error from the app shell).
  const { toasts, pushToast, dismissToast } = useToastBus();

  // Auto-updater state. Driven by 'update:status' events from the main
  // process. Initial fetch on mount in case the updater already had a
  // status before this component mounted (rare but possible if the
  // renderer hot-reloads).
  const [updaterStatus, setUpdaterStatus] = useState({ state: 'idle', version: '', progressPct: 0, error: '' });
  const updateToastIdRef = useRef(null);

  // "What's new" overlay state. Shown once after every version bump.
  //   whatsNewOpen: boolean controlling visibility of the overlay
  //   whatsNewData: { version, name, body, url, publishedAt } once we've
  //                 fetched the notes from GitHub. Null while loading or
  //                 if the fetch failed (in which case we don't show
  //                 the overlay at all — silent failure is preferable
  //                 to a "couldn't load release notes" splash).
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [whatsNewData, setWhatsNewData] = useState(null);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.appGetVersion || !api?.whatsnewGetLastSeen) return;
    // Don't show the overlay in dev mode — there's no "release" for an
    // unpackaged build, the fetch would 404, and it'd be noise during
    // development.
    let cancelled = false;
    (async () => {
      try {
        const currentVersion = String(await api.appGetVersion());
        const seen = await api.whatsnewGetLastSeen();
        const lastSeen = String(seen?.version || '');
        if (cancelled) return;
        // Already shown for this version (or earlier of the same).
        // Comparison is string-based which is wrong for proper semver
        // (1.0.10 < 1.0.9 stringwise), but for our linear bump pattern
        // an EXACT match check is sufficient: we only need to know
        // "did we show notes for THIS version yet?" If yes, skip; if
        // no, show. After showing once, we save currentVersion so the
        // next launch sees an exact match and skips.
        if (lastSeen === currentVersion) return;
        // Fetch release notes. Failure is silent — better to skip
        // than show a broken overlay.
        const notes = await api.whatsnewFetchReleaseNotes(currentVersion);
        if (cancelled) return;
        if (!notes?.ok || !notes.body) {
          // Mark as seen anyway so we don't refetch every launch when
          // the release page has no body or the release hasn't been
          // created yet.
          try { await api.whatsnewSetLastSeen(currentVersion); } catch { /* ignore */ }
          return;
        }
        setWhatsNewData({
          version: currentVersion,
          name: notes.name || `v${currentVersion}`,
          body: notes.body,
          url: notes.url || '',
          publishedAt: notes.publishedAt || null,
        });
        setWhatsNewOpen(true);
      } catch { /* swallow — no overlay on any error */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismissWhatsNew = useCallback(async () => {
    setWhatsNewOpen(false);
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.whatsnewSetLastSeen || !whatsNewData?.version) return;
    try { await api.whatsnewSetLastSeen(whatsNewData.version); } catch { /* ignore */ }
  }, [whatsNewData]);

  // First-run tutorial. Auto-shows once after the first launch ever
  // (unless the user is mid-update, in which case the What's New
  // overlay handles their introduction). Settings has an "Open tutorial"
  // button that triggers it anytime regardless of the seen flag.
  //
  // We DON'T auto-show alongside the What's New overlay — if the user
  // is updating, they already know the app, no point repeating the
  // tour. The auto-show only fires when whatsNewOpen is false AND
  // tutorialSeen is false. The check happens once on mount with a
  // small delay so the dock has time to render and our spotlight
  // measurements are accurate.
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.tutorialGetSeen) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.tutorialGetSeen();
        if (cancelled) return;
        // Wait a beat so the dock has settled into its final position
        // before we measure for spotlights. The whats-new overlay also
        // takes precedence — we don't want both modals at once.
        setTimeout(() => {
          if (cancelled) return;
          if (!r?.seen && !whatsNewOpen) setTutorialOpen(true);
        }, 600);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  const dismissTutorial = useCallback(async () => {
    setTutorialOpen(false);
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.tutorialSetSeen) return;
    try { await api.tutorialSetSeen(true); } catch { /* ignore */ }
  }, []);

  const openTutorial = useCallback(() => setTutorialOpen(true), []);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.onUpdateStatus) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.updateGetStatus?.();
        if (!cancelled && s) setUpdaterStatus(s);
      } catch { /* ignore */ }
    })();
    const unsub = api.onUpdateStatus((s) => {
      if (!s) return;
      setUpdaterStatus(s);
      // Surface the "ready to install" prompt as a toast with an action
      // button. Push exactly once per download cycle by tracking the
      // toast id; if a second 'downloaded' event arrives (shouldn't,
      // but defensive), we won't stack duplicates.
      if (s.state === 'downloaded' && !updateToastIdRef.current) {
        const id = pushToast({
          message: `Update ready${s.version ? ` (v${s.version})` : ''}. Restart to install.`,
          kind: 'info',
          durationMs: 0, // 0 = no auto-dismiss; user has to click
          action: {
            label: 'Restart',
            // The toast bus expects `onClick`, not `handler`. Older
            // code in this file accidentally used `handler` which
            // meant the button silently did nothing because Toasts.jsx
            // guards on `!toast.action?.onClick`.
            onClick: () => {
              try { api.updateInstall?.(); }
              catch { /* main quits us regardless */ }
            },
          },
        });
        updateToastIdRef.current = id;
      }
      // Reset the toast tracker on any non-downloaded state so a future
      // check + download will be allowed to toast again.
      if (s.state !== 'downloaded' && updateToastIdRef.current) {
        updateToastIdRef.current = null;
      }
    });
    return () => { cancelled = true; if (typeof unsub === 'function') unsub(); };
  }, [pushToast]);

  /** Recent releases (within last 30 days) for followed artists — cached server-side. */
  const [releases, setReleases] = useState([]);
  /** Manual follow-overrides: [{ artistName, action: 'add' | 'exclude', itunesArtistId }]. */
  const [followOverrides, setFollowOverrides] = useState([]);
  /** True while the main process is actively hitting iTunes to refresh the cache. */
  const [releasesRefreshing, setReleasesRefreshing] = useState(false);
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Bumped on every audio `seeked` event so the Discord-presence effect
  // re-runs and re-anchors its wall-start timestamp. Without this, a
  // seek mid-song doesn't notify Discord and its progress bar keeps
  // counting from the pre-seek position.
  const [seekNonce, setSeekNonce] = useState(0);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [volume, setVolume] = useState(1);

  /**
   * isMaximized — tracks whether the window is currently maximized
   * (filling the work area, taskbar still visible). NOT native
   * fullscreen — that's a different state we don't currently use.
   *
   * Detection uses `window.resize` events plus a comparison of the
   * window's outer dimensions against the screen's available
   * dimensions. When they match (within a 4px tolerance for
   * subpixel/DPI rounding) the window is maximized. This avoids any
   * dependency on main-process IPC, so it works the moment the new
   * App.jsx loads — no Electron restart needed.
   *
   * Triggered by: the in-app maximize button, double-clicking the
   * title bar, and OS shortcuts like Win+Up. All three end up
   * resizing the window, so a single resize listener catches them all.
   */
  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    const check = () => {
      const TOLERANCE = 4;
      const maxed =
        Math.abs(window.outerWidth - window.screen.availWidth) <= TOLERANCE
        && Math.abs(window.outerHeight - window.screen.availHeight) <= TOLERANCE;
      setIsMaximized(maxed);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /**
   * gainBoost — multiplier applied to the audio graph's GainNode, on top
   * of the regular volume slider. Lets the user push playback above the
   * OS-level 100% cap (HTMLAudioElement.volume is clamped to [0, 1]) for
   * tracks that are mastered too quietly, or just to crank.
   *
   * Range: 1.0 (passthrough — no boost) up to 16.0 (+24 dB of gain).
   * Most users will live in 1-4×; the 4-16× range is "this track was
   * mastered way too quietly" / "I'm across the room" territory. The
   * compressor in ensureAnalyser is tuned to keep the high end of the
   * range from sounding like a buzzsaw.
   *
   * Persisted across sessions because nothing is more annoying than
   * having to re-crank the volume every launch.
   *
   * A DynamicsCompressorNode sits after the gain stage as a safety net
   * for clipping when boost is high; see ensureAnalyser in this file.
   */
  const [gainBoost, setGainBoost] = useState(() => {
    try {
      const raw = localStorage.getItem('immerse:gainBoost');
      if (!raw) return 1;
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return 1;
      // Clamp on read in case a corrupted value snuck in.
      return Math.max(1, Math.min(16, n));
    } catch { return 1; }
  });
  useEffect(() => {
    try { localStorage.setItem('immerse:gainBoost', String(gainBoost)); } catch { /* ignore */ }
  }, [gainBoost]);

  const [importing, setImporting] = useState(false);

  // Ambient mode: full-window cover collage that auto-engages after a
  // user-defined idle threshold. Behaviour is controlled by `ambientMode`:
  //   'off'     — never auto-engage
  //   'idle'    — only when no track loaded AND queue empty
  //   'pause'   — also when track is loaded but paused (relaxed)
  //   'custom'  — same as 'idle' but with user-specified delay
  // The delay is fixed at 30s for idle/pause; `ambientCustomDelaySec`
  // applies when mode === 'custom'. Both persist to localStorage.
  const [ambientMode, setAmbientMode] = useState(() => {
    if (typeof window === 'undefined') return 'idle';
    const v = window.localStorage.getItem('immerse:ambientMode');
    if (v === 'off' || v === 'idle' || v === 'pause' || v === 'custom') return v;
    return 'idle';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('immerse:ambientMode', ambientMode);
    }
  }, [ambientMode]);

  const [ambientCustomDelaySec, setAmbientCustomDelaySec] = useState(() => {
    if (typeof window === 'undefined') return 30;
    const raw = window.localStorage.getItem('immerse:ambientCustomDelaySec');
    const n = Number(raw);
    // Bounded so a fat-finger doesn't lock the user into a 24-hour wait.
    if (Number.isFinite(n) && n >= 5 && n <= 600) return Math.round(n);
    return 30;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('immerse:ambientCustomDelaySec', String(ambientCustomDelaySec));
    }
  }, [ambientCustomDelaySec]);

  const [ambientActive, setAmbientActive] = useState(false);
  // Toggle so a user who dismisses ambient mode doesn't immediately get
  // re-engaged the moment they stop interacting. Stays false until the
  // next time the player is actually used (currentTrack appears), then
  // flips back to true so future idle periods can re-engage.
  const [ambientArmed, setAmbientArmed] = useState(true);
  const [uiFontId, setUiFontId] = useState(getStoredFontId);
  /** Session flag — flips true the first time any track starts. Resets on next
   * launch. Used to render the Welcome screen until the user plays something. */
  const [hasEverPlayed, setHasEverPlayed] = useState(false);
  /** User preference — animate the theme gradient behind the now-playing view. */
  const [animateGradient, setAnimateGradient] = useState(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem('studioPlayerAnimateGradient') : null;
      // Default: ON. Explicitly "0" or "false" → off.
      if (v === '0' || v === 'false') return false;
      return true;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('studioPlayerAnimateGradient', animateGradient ? '1' : '0');
    } catch { /* ignore */ }
  }, [animateGradient]);

  /** Beat reactivity — colour field pulses to the bass envelope of the playing audio.
   * Default OFF (audio analysis has a small CPU cost; keep the calm default behaviour). */
  const [beatReactive, setBeatReactive] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:beatReactive') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (beatReactive) window.localStorage.setItem('immerse:beatReactive', '1');
      else window.localStorage.removeItem('immerse:beatReactive');
    } catch { /* ignore */ }
  }, [beatReactive]);

  /** Cover fullscreen mode — when true, clicking the cover (or pressing F) opens
   * an edge-to-edge fullscreen overlay of just the artwork + minimal controls. */
  const [coverFullscreenEnabled, setCoverFullscreenEnabled] = useState(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem('immerse:coverFullscreen') : null;
      // Default: ON. The feature is opt-in for the action (you have to click), but
      // having the affordance available by default is the friendlier choice.
      if (v === '0' || v === 'false') return false;
      return true;
    } catch { return true; }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('immerse:coverFullscreen', coverFullscreenEnabled ? '1' : '0');
    } catch { /* ignore */ }
  }, [coverFullscreenEnabled]);

  /* ---------- Experimental (Dev) toggles ----------------------------------
   *
   * Each of these gates a feature that's still being shaped. They live behind
   * a "DEV / EXPERIMENTAL" group in Settings so the user can opt in. Each
   * persists individually in localStorage under `immerse:dev:*` so they don't
   * collide with stable preferences and can all be wiped in one shot if a
   * future migration ever needs to.
   */

  /** Pinnable tabs — master toggle for the dock-tab hiding system. When OFF
   * (default), every tab is visible, right-click does nothing special, and
   * any persisted hidden-tab list is ignored. When ON, the right-click menu
   * offers "Hide tab", and the Settings list shows per-tab eye toggles. */
  const [pinnableTabsEnabled, setPinnableTabsEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:pinnableTabs') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (pinnableTabsEnabled) window.localStorage.setItem('immerse:dev:pinnableTabs', '1');
      else window.localStorage.removeItem('immerse:dev:pinnableTabs');
    } catch { /* ignore */ }
  }, [pinnableTabsEnabled]);

  /** Hidden-tab list — tab IDs the user has chosen to hide from the dock.
   * Stored as a JSON array. Has effect only when `pinnableTabsEnabled` is on.
   * `'library'` and `'settings'` are intentionally never hideable: library is
   * the home base and settings is the only way to undo a hidden state. */
  const [hiddenTabIds, setHiddenTabIds] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('immerse:dev:hiddenTabs') : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Sanitize: only keep known tab IDs and never include the protected ones.
      const allowed = new Set(['find', 'new', 'stats', 'queue', 'journal', 'lyrics']);
      return parsed.filter((x) => typeof x === 'string' && allowed.has(x));
    } catch { return []; }
  });
  useEffect(() => {
    try {
      if (hiddenTabIds.length === 0) window.localStorage.removeItem('immerse:dev:hiddenTabs');
      else window.localStorage.setItem('immerse:dev:hiddenTabs', JSON.stringify(hiddenTabIds));
    } catch { /* ignore */ }
  }, [hiddenTabIds]);

  /** Collapse-to-edge animation — when enabled, the side dock panel collapses
   * by scaling into the bottom dock pill rather than sliding off-screen. Makes
   * the dock feel like the source of truth for the panel. Off by default
   * because the existing slide-off animation is reliably snappy. */
  const [dockCollapseAnimationEnabled, setDockCollapseAnimationEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:dockCollapseAnimation') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (dockCollapseAnimationEnabled) window.localStorage.setItem('immerse:dev:dockCollapseAnimation', '1');
      else window.localStorage.removeItem('immerse:dev:dockCollapseAnimation');
    } catch { /* ignore */ }
  }, [dockCollapseAnimationEnabled]);

  /** Random play button — when enabled, a dice icon appears in the bottom
   * dock that plays a uniformly-random track from the library on click.
   * The decision-fatigue cure. Off by default because not every user wants
   * extra dock buttons. */
  const [randomButtonEnabled, setRandomButtonEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:randomButton') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (randomButtonEnabled) window.localStorage.setItem('immerse:dev:randomButton', '1');
      else window.localStorage.removeItem('immerse:dev:randomButton');
    } catch { /* ignore */ }
  }, [randomButtonEnabled]);

  /** Breathing dock pill — when enabled, the bottom dock bar's accent ring
   * pulses subtly while music is playing. Most visible when the panel is
   * collapsed. Off by default; pure visual ambience. */
  const [breathingDockPillEnabled, setBreathingDockPillEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:breathingDockPill') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (breathingDockPillEnabled) window.localStorage.setItem('immerse:dev:breathingDockPill', '1');
      else window.localStorage.removeItem('immerse:dev:breathingDockPill');
    } catch { /* ignore */ }
  }, [breathingDockPillEnabled]);

  // Transparent dock — when enabled, the bottom dock pill's solid dark
  // backdrop drops away so the cover-art-derived background bleeds
  // through. The pill still has its blur and inset highlight, but the
  // 0.7-alpha dark fill is replaced with a near-transparent layer that
  // lets the accent/cover wash from the immersive stage show through.
  // Defaults OFF — the solid backdrop is the more readable default.
  const [dockTransparentEnabled, setDockTransparentEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:dockTransparent') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (dockTransparentEnabled) window.localStorage.setItem('immerse:dev:dockTransparent', '1');
      else window.localStorage.removeItem('immerse:dev:dockTransparent');
    } catch { /* ignore */ }
  }, [dockTransparentEnabled]);

  /**
   * liquidGlassDockEnabled — when on, replaces the dock's flat surface
   * with a multi-layer frosted-glass effect: heavy backdrop blur,
   * inner highlight gradient catching the "top edge" of the slab, a
   * subtle specular sheen that slowly sweeps across, and a faint inner
   * ring of accent-tinted light. Goes beyond `dockTransparentEnabled`
   * (which just thins the fill) — this makes the dock look like a slab
   * of real polished glass laid over the cover art.
   *
   * Both toggles can be on at once; liquid glass composes its layers
   * over whichever base fill transparency picked.
   */
  const [liquidGlassDockEnabled, setLiquidGlassDockEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:liquidGlassDock') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (liquidGlassDockEnabled) window.localStorage.setItem('immerse:liquidGlassDock', '1');
      else window.localStorage.removeItem('immerse:liquidGlassDock');
    } catch { /* ignore */ }
  }, [liquidGlassDockEnabled]);

  // Listening Journal — when enabled, a "Journal" tab joins the dock
  // alongside Stats/Queue/Lyrics. The tab renders a day-by-day diary of
  // play events with auto-generated prose summaries and stat cards.
  // Drawn entirely from existing `playEvents` + `library`; no DB
  // additions needed.
  // Journal tab removed in v1.0.5. State + setter retained as a noop to
  // avoid invasive changes to all the props that referenced them, but
  // the value is now permanently false and the setter is a no-op so the
  // journal tab can never appear regardless of prior localStorage state.
  // Also proactively clears the localStorage flag so future versions
  // don't accidentally re-enable it.
  const journalTabEnabled = false;
  const setJournalTabEnabled = () => {};
  useEffect(() => {
    try { window.localStorage.removeItem('immerse:dev:journalTab'); } catch { /* ignore */ }
  }, []);

  // Queue Painter — when enabled, the Queue tab gains a view-mode switch
  // (list / painter). Painter mode shows the queue as a horizontal
  // duration-proportional strip instead of the standard vertical list.
  // Setting controls *availability* of the switch; the user's choice of
  // mode within the switch is a separate localStorage key (saved by
  // the Queue tab itself, mirroring how AlbumStackView did it).
  const [queuePainterEnabled, setQueuePainterEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:queuePainter') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (queuePainterEnabled) window.localStorage.setItem('immerse:dev:queuePainter', '1');
      else window.localStorage.removeItem('immerse:dev:queuePainter');
    } catch { /* ignore */ }
  }, [queuePainterEnabled]);

  // Recently-played peek — when enabled, a small clock icon appears in
  // the dock. Clicking it pops a floating panel showing recently-played
  // tracks. The range is also user-configurable: by count (5/10/20),
  // by time window (today / current session), or a custom count.
  // Default: enabled with "last 5" since it's small and useful.
  const [recentPeekEnabled, setRecentPeekEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:recentPeek') !== '0';
    } catch { return true; }
  });
  useEffect(() => {
    try {
      if (recentPeekEnabled) window.localStorage.removeItem('immerse:dev:recentPeek');
      else window.localStorage.setItem('immerse:dev:recentPeek', '0');
    } catch { /* ignore */ }
  }, [recentPeekEnabled]);

  // What "recently played" means. Five options:
  //   '5' | '10' | '20'  → last N tracks
  //   'today'            → tracks played today only (since local midnight)
  //   'session'          → current listening session (30min idle = boundary)
  //   'custom'           → recentPeekCustomCount tracks
  const [recentPeekRange, setRecentPeekRange] = useState(() => {
    try {
      const v = window.localStorage.getItem('immerse:dev:recentPeekRange');
      if (['5', '10', '20', 'today', 'session', 'custom'].includes(v)) return v;
    } catch { /* ignore */ }
    return '5';
  });
  useEffect(() => {
    try { window.localStorage.setItem('immerse:dev:recentPeekRange', recentPeekRange); }
    catch { /* ignore */ }
  }, [recentPeekRange]);

  const [recentPeekCustomCount, setRecentPeekCustomCount] = useState(() => {
    try {
      const raw = window.localStorage.getItem('immerse:dev:recentPeekCustomCount');
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 1 && n <= 100) return Math.round(n);
    } catch { /* ignore */ }
    return 15;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('immerse:dev:recentPeekCustomCount', String(recentPeekCustomCount));
    } catch { /* ignore */ }
  }, [recentPeekCustomCount]);

  /** First-time-hearing sparkle — when enabled, tracks in the library list
   * that have never been played (playCount === 0) get a small pulsing dot
   * next to their title. Helps unheard music feel discoverable in big
   * libraries. Off by default. */
  const [firstTimeSparkleEnabled, setFirstTimeSparkleEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:firstTimeSparkle') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (firstTimeSparkleEnabled) window.localStorage.setItem('immerse:dev:firstTimeSparkle', '1');
      else window.localStorage.removeItem('immerse:dev:firstTimeSparkle');
    } catch { /* ignore */ }
  }, [firstTimeSparkleEnabled]);

  /** Track of the moment — when enabled, the welcome screen surfaces a small
   * card with a track chosen by time-of-day, day-of-week, and recent
   * listening behaviour. Refreshes every few hours (not every render).
   * Off by default. */
  const [trackOfMomentEnabled, setTrackOfMomentEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:trackOfMoment') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (trackOfMomentEnabled) window.localStorage.setItem('immerse:dev:trackOfMoment', '1');
      else window.localStorage.removeItem('immerse:dev:trackOfMoment');
    } catch { /* ignore */ }
  }, [trackOfMomentEnabled]);

  /** Click artist / album name to filter — when enabled, the artist and album
   * names in the library list and now-playing become clickable. Clicking one
   * opens the library tab and filters by that text. Off by default; turning
   * it on makes those names visually distinct (underline-on-hover). */
  const [statsRangeTabsEnabled, setStatsRangeTabsEnabled] = useState(() => {
    try {
      // Default ON. localStorage absence means "user hasn't touched it" → on.
      // We only treat the explicit '0' string as off so future migrations
      // (or first-launch reads) stay safe.
      return typeof window === 'undefined'
        || window.localStorage.getItem('immerse:dev:statsRangeTabs') !== '0';
    } catch { return true; }
  });
  useEffect(() => {
    try {
      if (statsRangeTabsEnabled) window.localStorage.removeItem('immerse:dev:statsRangeTabs');
      else window.localStorage.setItem('immerse:dev:statsRangeTabs', '0');
    } catch { /* ignore */ }
  }, [statsRangeTabsEnabled]);
  const [clickToFilterEnabled, setClickToFilterEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:clickToFilter') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (clickToFilterEnabled) window.localStorage.setItem('immerse:dev:clickToFilter', '1');
      else window.localStorage.removeItem('immerse:dev:clickToFilter');
    } catch { /* ignore */ }
  }, [clickToFilterEnabled]);

  /** Online artist info — when enabled, the Track tab fetches artist
   * biography, tags, and listener count from Last.fm. Off by default
   * because it requires user-supplied API credentials and makes outbound
   * requests that are logged by Last.fm. */
  const [artistInfoEnabled, setArtistInfoEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:artistInfo') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (artistInfoEnabled) window.localStorage.setItem('immerse:dev:artistInfo', '1');
      else window.localStorage.removeItem('immerse:dev:artistInfo');
    } catch { /* ignore */ }
  }, [artistInfoEnabled]);

  /** Last.fm API key — user-provided, stored client-side. No secret pair
   * (Last.fm separates "api_key" for read-only ws.audioscrobbler calls
   * from "secret" used only for write/auth flows we don't use). */
  const [lastFmApiKey, setLastFmApiKey] = useState(() => {
    try {
      return (typeof window !== 'undefined' ? window.localStorage.getItem('immerse:lastFmApiKey') : null) || '';
    } catch { return ''; }
  });
  useEffect(() => {
    try {
      if (lastFmApiKey.trim()) window.localStorage.setItem('immerse:lastFmApiKey', lastFmApiKey.trim());
      else window.localStorage.removeItem('immerse:lastFmApiKey');
    } catch { /* ignore */ }
  }, [lastFmApiKey]);

  /** Track credits — when enabled, the Track tab fetches writers,
   * producers, engineers, and performers from MusicBrainz. Off by default
   * because it makes outbound requests (logged by MusicBrainz) and uses a
   * one-request-per-second throttle to honour their etiquette. No API
   * key needed; results are cached locally for 7 days. */
  const [creditsEnabled, setCreditsEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:credits') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (creditsEnabled) window.localStorage.setItem('immerse:dev:credits', '1');
      else window.localStorage.removeItem('immerse:dev:credits');
    } catch { /* ignore */ }
  }, [creditsEnabled]);

  /** Track videos — when enabled, the Track tab offers a "Watch video"
   * disclosure that lazy-loads a YouTube embed for the playing track.
   * Off by default because the embed loads from a Google domain and
   * (when the user actually plays the video) sets third-party cookies.
   * No API key required; uses YouTube's search-list embed URL so the
   * top search result auto-loads inside the iframe. */
  const [videosEnabled, setVideosEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:videos') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (videosEnabled) window.localStorage.setItem('immerse:dev:videos', '1');
      else window.localStorage.removeItem('immerse:dev:videos');
    } catch { /* ignore */ }
  }, [videosEnabled]);

  /** Edge-bleed colour band — when enabled, a thin gradient strip at the
   * bottom of the immersive stage tinted with the playing track's accent
   * colour. Like the cover is "leaking light" into the room. Default OFF. */
  const [edgeBleedEnabled, setEdgeBleedEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:edgeBleed') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (edgeBleedEnabled) window.localStorage.setItem('immerse:dev:edgeBleed', '1');
      else window.localStorage.removeItem('immerse:dev:edgeBleed');
    } catch { /* ignore */ }
  }, [edgeBleedEnabled]);

  /** Two-pane library — when enabled, the library Songs view splits in
   * two: artists on the left, tracks of the selected artist on the right.
   * Default OFF. */
  const [twoPaneEnabled, setTwoPaneEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:twoPane') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (twoPaneEnabled) window.localStorage.setItem('immerse:dev:twoPane', '1');
      else window.localStorage.removeItem('immerse:dev:twoPane');
    } catch { /* ignore */ }
  }, [twoPaneEnabled]);

  /** Discord rich presence — when enabled, broadcasts the playing
   * track to the user's Discord status (visible to friends and in
   * voice channels). Off by default for privacy. Requires the user
   * to have the Discord desktop client running and to provide their
   * own Application ID (created at discord.com/developers). */
  const [discordPresenceEnabled, setDiscordPresenceEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:discordPresence') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (discordPresenceEnabled) window.localStorage.setItem('immerse:dev:discordPresence', '1');
      else window.localStorage.removeItem('immerse:dev:discordPresence');
    } catch { /* ignore */ }
  }, [discordPresenceEnabled]);

  /** Discord application ID — user-provided string from
   * discord.com/developers/applications. Stored separately from the
   * toggle so the user can keep it set even when the feature is off.
   * If left empty, falls back to DEFAULT_DISCORD_APP_ID below so the
   * feature works out of the box. */
  const [discordAppId, setDiscordAppId] = useState(() => {
    try {
      return (typeof window !== 'undefined' ? window.localStorage.getItem('immerse:discordAppId') : null) || '';
    } catch { return ''; }
  });
  useEffect(() => {
    try {
      if (discordAppId.trim()) window.localStorage.setItem('immerse:discordAppId', discordAppId.trim());
      else window.localStorage.removeItem('immerse:discordAppId');
    } catch { /* ignore */ }
  }, [discordAppId]);

  /**
   * imgbb API key for uploading local cover art to a public URL so
   * Discord's media proxy can fetch it. Free, no OAuth — just sign up
   * at https://api.imgbb.com and paste the key shown on the dashboard.
   * Stored separately from the Discord toggle so the user keeps it set
   * while toggling the feature.
   */
  const [imgbbApiKey, setImgbbApiKey] = useState(() => {
    try {
      return (typeof window !== 'undefined' ? window.localStorage.getItem('immerse:imgbbApiKey') : null) || '';
    } catch { return ''; }
  });
  useEffect(() => {
    try {
      if (imgbbApiKey.trim()) window.localStorage.setItem('immerse:imgbbApiKey', imgbbApiKey.trim());
      else window.localStorage.removeItem('immerse:imgbbApiKey');
    } catch { /* ignore */ }
  }, [imgbbApiKey]);

  // Effective app ID used for the Discord IPC connection — the user's
  // value if they set one, otherwise the bundled default. Lets users
  // override (use their own Discord app, with their own naming and
  // image assets) but works zero-setup for everyone else.
  const effectiveDiscordAppId = (discordAppId.trim() || DEFAULT_DISCORD_APP_ID || '').trim();

  /** Panel resize — when enabled, the inner edge of the side panel becomes
   * a drag handle for resizing the panel's width. Persisted. Off by default. */
  const [panelResizableEnabled, setPanelResizableEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:panelResizable') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (panelResizableEnabled) window.localStorage.setItem('immerse:dev:panelResizable', '1');
      else window.localStorage.removeItem('immerse:dev:panelResizable');
    } catch { /* ignore */ }
  }, [panelResizableEnabled]);

  /** Dock drag — when enabled, the bottom dock can be picked up and moved
   * anywhere on screen. Persisted. Off by default. */
  const [dockDraggableEnabled, setDockDraggableEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('immerse:dev:dockDraggable') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    try {
      if (dockDraggableEnabled) window.localStorage.setItem('immerse:dev:dockDraggable', '1');
      else window.localStorage.removeItem('immerse:dev:dockDraggable');
    } catch { /* ignore */ }
  }, [dockDraggableEnabled]);

  /** Panel width (px). Bounds enforced at use site. Default 340 matches the
   * historical hard-coded width. */
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem('immerse:panelWidth') : null;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 240 && n <= 720) return Math.round(n);
      return 340;
    } catch { return 340; }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('immerse:panelWidth', String(panelWidth));
    } catch { /* ignore */ }
  }, [panelWidth]);

  /** Dock position. Stored as { xFromLeft, yFromTop } in pixels — both
   * relative to the top-left of the window. `null` means default position
   * (bottom-center). Reset to null any time the user disables dock-drag. */
  const [dockPosition, setDockPosition] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('immerse:dockPosition') : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.xFromLeft) && Number.isFinite(parsed.yFromTop)) {
        return { xFromLeft: parsed.xFromLeft, yFromTop: parsed.yFromTop };
      }
      return null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      if (dockPosition === null) window.localStorage.removeItem('immerse:dockPosition');
      else window.localStorage.setItem('immerse:dockPosition', JSON.stringify(dockPosition));
    } catch { /* ignore */ }
  }, [dockPosition]);
  // When dock-drag is turned off, reset position to default so the user
  // doesn't end up with a mysteriously-misplaced dock when they didn't
  // remember moving it.
  useEffect(() => {
    if (!dockDraggableEnabled && dockPosition !== null) {
      setDockPosition(null);
    }
  }, [dockDraggableEnabled, dockPosition]);
  /** Bumps after saving Spotify creds so Find view re-checks configured state. */
  const [spotifyCredsRefreshKey, setSpotifyCredsRefreshKey] = useState(0);

  const audioRef = useRef(null);
  const seekGenerationRef = useRef(0);
  /** When this matches the active queue slot + file, we must not set `audio.src` again or playback restarts from 0. */
  const lastAudioLoadKeyRef = useRef(null);
  const handleNextRef = useRef(null);
  const libraryRef = useRef([]);
  libraryRef.current = library;
  const queueRef = useRef([]);
  queueRef.current = queue;

  const currentTrack = currentIndex >= 0 && queue[currentIndex] ? queue[currentIndex] : null;

  useEffect(() => {
    if (!window.electronAPI?.loadLibrary) {
      setLibraryBootstrapped(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const tracks = await window.electronAPI.loadLibrary();
        if (!cancelled && Array.isArray(tracks)) setLibrary(tracks);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLibraryBootstrapped(true);
      }
      // Load playlists — not critical, don't block bootstrap on failure
      try {
        if (typeof window.electronAPI.loadPlaylists === 'function') {
          const pls = await window.electronAPI.loadPlaylists();
          if (!cancelled && Array.isArray(pls)) setPlaylists(pls);
        }
      } catch (e) {
        console.error('loadPlaylists failed', e);
      }
      // Load cached releases + follow overrides — also non-critical. The UI
      // shows whatever's cached immediately; a background refresh happens
      // separately in a different effect.
      try {
        if (typeof window.electronAPI.loadCachedReleases === 'function') {
          const r = await window.electronAPI.loadCachedReleases();
          if (!cancelled && r?.ok) setReleases(r.releases || []);
        }
      } catch (e) { console.error('loadCachedReleases failed', e); }
      try {
        if (typeof window.electronAPI.loadReleaseOverrides === 'function') {
          const r = await window.electronAPI.loadReleaseOverrides();
          if (!cancelled && r?.ok) setFollowOverrides(r.overrides || []);
        }
      } catch (e) { console.error('loadReleaseOverrides failed', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    const preset = presetById(uiFontId);
    loadGoogleFontForPreset(preset);
    document.body.style.fontFamily = preset.stack;
    storeFontId(uiFontId);
  }, [uiFontId]);

  useEffect(() => {
    if (!libraryBootstrapped || !window.electronAPI?.getMetadata) return undefined;
    let cancelled = false;
    const CAP = 200;
    const CONC = 4;
    const timer = setTimeout(async () => {
      const lib = libraryRef.current;
      const need = lib.filter((t) => t.filePath && !t.coverArt).slice(0, CAP);
      for (let i = 0; i < need.length; i += CONC) {
        if (cancelled) return;
        const chunk = need.slice(i, i + CONC);
        const metas = await Promise.all(chunk.map((t) => window.electronAPI.getMetadata(t.filePath)));
        if (cancelled) return;
        setLibrary((prev) => {
          const byId = new Map(chunk.map((t, idx) => [t.id, metas[idx]]));
          return prev.map((t) => {
            const m = byId.get(t.id);
            if (!m?.coverArt) return t;
            return { ...t, coverArt: m.coverArt, duration: m.duration || t.duration };
          });
        });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [libraryBootstrapped]);

  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.volume = volume;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      // Close the analyser graph if it was ever created. Safe to call even
      // if the context is already closed — close() on a closed context
      // throws an InvalidStateError which we swallow.
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch { /* ignore */ }
        audioCtxRef.current = null;
        audioSourceRef.current = null;
        analyserRef.current = null;
      }
    };
  }, []);

  /* ---------- Web Audio analyser (for beat reactivity + visualizers) ----------
   *
   * A single AudioContext + AnalyserNode pair, lazily created on first
   * playback (browsers block AudioContext creation until user interaction).
   * Once `createMediaElementSource` is called on the <audio> element, all of
   * its output flows through the Web Audio graph permanently — there's no
   * way to undo it — so we wire it up exactly once and leave it alone.
   *
   * Visualizer components receive the `analyserRef` and pull frequency /
   * waveform data inside their own RAF loops. Storing the analyser in a ref
   * (not state) means consuming components don't re-render on each frame —
   * they read the current value directly from the ref.
   */
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const audioSourceRef = useRef(null);
  /** GainNode in the audio graph used to amplify playback above the OS
   *  100% cap. Driven by `gainBoost` state below. */
  const gainNodeRef = useRef(null);

  const ensureAnalyser = useCallback(() => {
    if (analyserRef.current) return analyserRef.current;
    const audio = audioRef.current;
    if (!audio) return null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      // 1024 fftSize → 512 frequency bins; cheap and responsive enough for
      // visual feedback without spending real CPU.
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;

      // --- Volume boost stage ---------------------------------------
      // GainNode multiplies the signal. >1.0 amplifies (where the audio
      // element's own .volume cap of 1.0 can't reach). Initial value is
      // applied below from current state; subsequent changes flow in
      // through the gainBoost effect.
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1;

      // --- Two-stage dynamics safety net ----------------------------
      // With boost going as high as 16× (+24 dB), clipping is a serious
      // concern. We use a two-stage approach:
      //
      //   compressor: musical compression that does most of the work,
      //     gently riding the levels down so the perceived loudness
      //     keeps climbing but peaks don't blow out the DAC.
      //
      //   limiter: a near-brickwall final stage that catches anything
      //     the first compressor missed. Very high ratio, fast attack,
      //     threshold just below 0 dBFS — this is the "do not pass go"
      //     line that prevents speaker-killing clicks.
      //
      // At 1× boost both stages are essentially transparent (the signal
      // never reaches their thresholds). They only really start working
      // around 3× and become the dominant character at 8-16×.
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;  // dB — earlier engagement than before
      compressor.knee.value = 20;        // dB — still wide for transparency
      compressor.ratio.value = 8;        // 8:1 — firmer at high boost
      compressor.attack.value = 0.003;   // 3ms — fast enough to catch transients
      compressor.release.value = 0.2;    // 200ms — natural decay

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;      // dB — brickwall just under digital max
      limiter.knee.value = 0;            // dB — hard knee (true brickwall)
      limiter.ratio.value = 20;          // ~∞:1 effectively
      limiter.attack.value = 0.001;      // 1ms — catches transients
      limiter.release.value = 0.05;      // 50ms — fast recovery

      // Graph: source → gain → compressor → limiter → analyser → destination
      // (analyser before destination so visualizers see the boosted signal)
      source.connect(gainNode);
      gainNode.connect(compressor);
      compressor.connect(limiter);
      limiter.connect(analyser);
      // CRITICAL: also connect to destination, otherwise the audio becomes
      // silent — createMediaElementSource removes the audio's default
      // connection to speakers.
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      audioSourceRef.current = source;
      analyserRef.current = analyser;
      gainNodeRef.current = gainNode;
      return analyser;
    } catch (e) {
      // Some sources (cross-origin without CORS, certain DRM streams) refuse.
      // Don't crash visualizers — they'll just render their idle state.
      console.warn('Web Audio analyser unavailable:', e);
      return null;
    }
  }, []);

  /**
   * Apply the current gainBoost value to the live audio graph. We do this
   * in an effect (rather than directly in setGainBoost) so the value
   * persists even if the analyser is built later — see the "make sure
   * analyser exists on first play" effect below, which calls ensureAnalyser
   * lazily.
   *
   * setTargetAtTime gives us a short smooth ramp instead of a click —
   * jumping from 1.0× to 2.5× in a single sample frame is audible as a
   * "thwack." 30ms is the magic number where the change feels instant but
   * doesn't pop.
   */
  useEffect(() => {
    const gainNode = gainNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!gainNode || !ctx) return;
    try {
      gainNode.gain.setTargetAtTime(gainBoost, ctx.currentTime, 0.03);
    } catch {
      // Fallback: instant set (older Chromium versions, some Electron builds)
      gainNode.gain.value = gainBoost;
    }
  }, [gainBoost]);

  // Resume the audio context whenever playback begins — Chrome auto-suspends
  // it on inactivity, and after a tab backgrounds-then-foregrounds the
  // analyser stops producing data until resumed.
  //
  // We also build the analyser/gain graph here on first play if EITHER
  // beat-reactivity is on OR the user has a non-passthrough gainBoost set.
  // The graph is the only way to amplify above OS 100%, so it needs to
  // exist before the gainBoost effect can apply its value.
  useEffect(() => {
    if (!isPlaying) return;
    if (!analyserRef.current && (beatReactive || gainBoost > 1)) {
      ensureAnalyser();
      // ensureAnalyser created the gain node with value 1; sync to the
      // user's saved boost immediately so they don't hear a quiet first
      // second on session start.
      const gainNode = gainNodeRef.current;
      const ctx = audioCtxRef.current;
      if (gainNode && ctx) {
        try { gainNode.gain.setTargetAtTime(gainBoost, ctx.currentTime, 0.03); }
        catch { gainNode.gain.value = gainBoost; }
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* ignore */ });
    }
  }, [isPlaying, beatReactive, gainBoost, ensureAnalyser]);

  // Ambient idle-timer. The "idle" definition and delay both come from
  // user settings:
  //   - 'off'    → never engages
  //   - 'idle'   → no current track AND queue empty for 30s
  //   - 'pause'  → no track loaded OR loaded-but-paused for 30s
  //   - 'custom' → same idle test as 'idle' but with custom delay
  // Any state transition that breaks idleness cancels the pending timer.
  // The `ambientArmed` gate prevents auto-re-engagement after the user
  // manually dismisses: once dismissed, we wait until something happens
  // in the player (currentTrack appears) before allowing future engagement.
  useEffect(() => {
    // Off → never engage.
    if (ambientMode === 'off') return undefined;

    // Determine whether we count as idle under the active mode.
    const strictIdle = !currentTrack && queue.length === 0;
    const relaxedIdle = strictIdle || (!!currentTrack && !isPlaying);
    const isIdle = ambientMode === 'pause' ? relaxedIdle : strictIdle;

    // Re-arm whenever we leave idleness. If a track is now playing or
    // the queue has things lined up, the user is actively using the app.
    if (!isIdle) {
      setAmbientArmed(true);
      return undefined;
    }
    if (!ambientArmed) return undefined;
    if (ambientActive) return undefined;

    const delayMs = ambientMode === 'custom'
      ? Math.max(5, ambientCustomDelaySec) * 1000
      : 30_000;
    const t = setTimeout(() => setAmbientActive(true), delayMs);
    return () => clearTimeout(t);
  }, [
    currentTrack, queue.length, isPlaying,
    ambientMode, ambientCustomDelaySec,
    ambientArmed, ambientActive,
  ]);

  // Public-facing handler the AmbientMode overlay calls when the user
  // closes it. Disarms re-engagement until the player wakes up again.
  const dismissAmbient = useCallback(() => {
    setAmbientActive(false);
    setAmbientArmed(false);
  }, []);

  const handleNext = useCallback(() => {
    if (queue.length === 0) return;
    if (repeat === 'one') {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    let next = currentIndex + 1;
    if (next >= queue.length) {
      if (repeat === 'all') next = 0;
      else { setIsPlaying(false); return; }
    }
    setCurrentIndex(next);
  }, [currentIndex, queue, repeat]);

  handleNextRef.current = handleNext;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onSeeked = () => setSeekNonce((n) => n + 1);
    const syncDuration = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onDur = () => syncDuration();
    const onLoadedMeta = () => syncDuration();
    const onEnded = () => handleNextRef.current();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('durationchange', onDur);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('durationchange', onDur);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    if (!currentTrack || !audioRef.current) {
      if (!currentTrack) lastAudioLoadKeyRef.current = null;
      return;
    }
    const pathKey = String(currentTrack.filePath || currentTrack.objectUrl || '');
    // Intentionally omit `currentIndex` from the key — the same track can move
    // to a different queue position (e.g. when toggling shuffle) and we must
    // not reload audio.src in that case or playback restarts from 0.
    const loadKey = `${currentTrack.id}|${pathKey}`;
    if (lastAudioLoadKeyRef.current === loadKey) return;
    lastAudioLoadKeyRef.current = loadKey;

    seekGenerationRef.current += 1;
    const audio = audioRef.current;
    setCurrentTime(0);
    const seed =
      typeof currentTrack.duration === 'number'
      && currentTrack.duration > 0
      && Number.isFinite(currentTrack.duration)
        ? currentTrack.duration
        : 0;
    setDuration(seed);
    async function load() {
      if (window.electronAPI?.getPlaybackUrl) {
        audio.src = window.electronAPI.getPlaybackUrl(currentTrack.filePath);
        audio.play().catch(() => {});
      } else if (currentTrack.objectUrl) {
        audio.src = currentTrack.objectUrl;
        audio.play().catch(() => {});
      }
    }
    load();
    // Intentionally omit `currentTrack.duration`: metadata hydration updates it and must not reload `src` (that restarts playback).
  }, [currentIndex, currentTrack?.id, currentTrack?.filePath, currentTrack?.objectUrl]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  const togglePlay = () => {
    if (!currentTrack) {
      if (library.length > 0) {
        const sorted = sortByTitle(library);
        const q = shuffleOn ? shuffleArray(sorted) : sorted;
        setQueue(q);
        setCurrentIndex(0);
      }
      return;
    }
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
  };

  const handlePrev = () => {
    if (queue.length === 0) return;
    if (audioRef.current.currentTime > 3) { audioRef.current.currentTime = 0; return; }
    let prev = currentIndex - 1;
    if (prev < 0) prev = repeat === 'all' ? queue.length - 1 : 0;
    setCurrentIndex(prev);
  };

  const toggleShuffle = () => {
    setShuffleOn((prev) => {
      if (!prev && queue.length > 0) {
        const cur = queue[currentIndex];
        const rest = queue.filter((_, i) => i !== currentIndex);
        setQueue([cur, ...shuffleArray(rest)]);
        setCurrentIndex(0);
      }
      return !prev;
    });
  };

  const seekTo = useCallback((seconds) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(seconds);
    if (!Number.isFinite(t)) return;

    const maxFromElement = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const maxFromState = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const maxSeek = maxFromElement > 0 ? maxFromElement : maxFromState;

    const apply = (max) => {
      if (!(max > 0)) return false;
      audio.currentTime = Math.max(0, Math.min(max, t));
      return true;
    };

    if (apply(maxSeek)) return;

    const gen = seekGenerationRef.current;
    const onMeta = () => {
      if (gen !== seekGenerationRef.current) return;
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) {
        audio.currentTime = Math.max(0, Math.min(d, t));
      }
    };
    audio.addEventListener('loadedmetadata', onMeta, { once: true });
  }, [duration]);

  const importFiles = async () => {
    setImporting(true);
    try {
      if (window.electronAPI) {
        const paths = await window.electronAPI.openFiles();
        const tracks = [];
        for (const fp of paths) {
          const meta = await window.electronAPI.getMetadata(fp);
          tracks.push({ id: uid(), ...meta });
        }
        await window.electronAPI.addLibraryTracks(tracks);
        const fromDb = await window.electronAPI.loadLibrary();
        setLibrary(mergeCoverArt(fromDb, tracks));
      } else {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true; input.accept = 'audio/*';
        const files = await new Promise((res) => { input.onchange = () => res(Array.from(input.files)); input.click(); });
        const tracks = files.map((f) => ({
          id: uid(),
          title: f.name.replace(/\.[^.]+$/, ''),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          duration: 0,
          coverArt: null,
          filePath: f.name,
          objectUrl: URL.createObjectURL(f),
        }));
        setLibrary((prev) => [...prev, ...tracks]);
      }
    } catch (e) { console.error(e); }
    setImporting(false);
  };

  const importFolder = async () => {
    if (!window.electronAPI) return;
    setImporting(true);
    try {
      const paths = await window.electronAPI.openFolder();
      const tracks = [];
      for (const fp of paths) {
        const meta = await window.electronAPI.getMetadata(fp);
        tracks.push({ id: uid(), ...meta });
      }
      await window.electronAPI.addLibraryTracks(tracks);
      const fromDb = await window.electronAPI.loadLibrary();
      setLibrary(mergeCoverArt(fromDb, tracks));
    } catch (e) { console.error(e); }
    setImporting(false);
  };

  const playTrack = (track, sortedList) => {
    const source = sortedList && sortedList.length > 0 ? sortedList : sortByTitle(library);
    const q = shuffleOn ? shuffleArray([...source]) : [...source];
    const idx = q.findIndex((t) => t.id === track.id);
    setQueue(q);
    setCurrentIndex(idx >= 0 ? idx : 0);
    if (!hasEverPlayed) setHasEverPlayed(true);
  };

  /** Pick a uniformly random track from the library and play it. The full
   * library is seeded as the queue context so the user can hit "next" and
   * keep going from a random point. Returns the track that was picked, or
   * null if the library is empty.
   *
   * Note: this is a "true random" pick regardless of the user's `shuffleOn`
   * setting — playTrack itself will then shuffle the queue if shuffle is on,
   * which is fine since the user explicitly asked for randomness. */
  const playRandomTrack = useCallback(() => {
    if (!library.length) return null;
    const t = library[Math.floor(Math.random() * library.length)];
    if (!t) return null;
    playTrack(t, library);
    return t;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  /**
   * Queue mutations — keep the current index pointed at the same track across
   * every operation. When tracks are inserted BEFORE the current index, shift
   * the index forward; when removed, shift back (or stay put if removal is
   * after).
   */

  /** Append one or more tracks to the end of the queue. */
  const addToQueue = useCallback((tracks) => {
    const rows = Array.isArray(tracks) ? tracks : [tracks];
    if (!rows.length) return;
    setQueue((prev) => {
      // If there's nothing playing yet, treat the first add as "play this now"
      if (prev.length === 0 || currentIndex < 0) {
        setCurrentIndex(0);
        if (!hasEverPlayed) setHasEverPlayed(true);
      }
      return [...prev, ...rows];
    });
  }, [currentIndex, hasEverPlayed]);

  /** Insert tracks right after the currently-playing track (Play Next). */
  const playNext = useCallback((tracks) => {
    const rows = Array.isArray(tracks) ? tracks : [tracks];
    if (!rows.length) return;
    setQueue((prev) => {
      if (prev.length === 0 || currentIndex < 0) {
        setCurrentIndex(0);
        if (!hasEverPlayed) setHasEverPlayed(true);
        return [...rows];
      }
      const before = prev.slice(0, currentIndex + 1);
      const after = prev.slice(currentIndex + 1);
      return [...before, ...rows, ...after];
    });
  }, [currentIndex, hasEverPlayed]);

  /** Remove the track at `index` from the queue. */
  const removeFromQueue = useCallback((index) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice(0, index).concat(prev.slice(index + 1));
      // Adjust current index:
      //   · Removing a track BEFORE current → shift current back by 1
      //   · Removing the CURRENT track → keep index in place, which now points
      //     to what used to be the next track (natural "skip forward" behavior).
      //     If we removed the last item, clamp to -1.
      //   · Removing a track AFTER current → no change
      if (index < currentIndex) {
        setCurrentIndex((c) => c - 1);
      } else if (index === currentIndex) {
        if (next.length === 0) setCurrentIndex(-1);
        else if (currentIndex >= next.length) setCurrentIndex(next.length - 1);
        // else: stay put — new track at same index will play
      }
      return next;
    });
  }, [currentIndex]);

  /** Move the track at `from` to position `to` in the queue. */
  const reorderQueue = useCallback((from, to) => {
    setQueue((prev) => {
      if (from === to) return prev;
      if (from < 0 || from >= prev.length) return prev;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Adjust current index — the playing track might have moved. Track it
      // by id since the array positions all shifted.
      const playingId = prev[currentIndex]?.id;
      if (playingId) {
        const newIdx = next.findIndex((t) => t.id === playingId);
        if (newIdx >= 0 && newIdx !== currentIndex) setCurrentIndex(newIdx);
      }
      return next;
    });
  }, [currentIndex]);

  /** Drop every track from the queue except the one currently playing. */
  const clearUpNext = useCallback(() => {
    setQueue((prev) => {
      if (currentIndex < 0 || !prev[currentIndex]) return [];
      const kept = [prev[currentIndex]];
      setCurrentIndex(0);
      return kept;
    });
  }, [currentIndex]);

  /** Jump to a specific index in the queue (used when user clicks a row in the queue UI). */
  const jumpToQueueIndex = useCallback((index) => {
    if (index < 0 || index >= queue.length) return;
    setCurrentIndex(index);
    if (!hasEverPlayed) setHasEverPlayed(true);
  }, [queue.length, hasEverPlayed]);

  const playPauseLibraryRow = (track, sortedList) => {
    if (currentTrack?.id === track.id && isPlaying) {
      audioRef.current?.pause();
      return;
    }
    if (currentTrack?.id === track.id && !isPlaying) {
      audioRef.current?.play()?.catch(() => {});
      return;
    }
    playTrack(track, sortedList);
  };

  const handleSpotifyImportDone = async (track) => {
    if (!window.electronAPI?.loadLibrary) return;
    const fromDb = await window.electronAPI.loadLibrary();
    setLibrary(mergeCoverArt(fromDb, [track]));
  };

  /**
   * Re-load the library from the DB and update state. Used by features
   * that mutate the DB outside the normal add/remove paths — most
   * importantly the metadata re-scan, which can update many tracks at
   * once and needs the renderer to see the fresh values.
   */
  const reloadLibrary = useCallback(async () => {
    if (!window.electronAPI?.loadLibrary) return;
    try {
      const fromDb = await window.electronAPI.loadLibrary();
      if (Array.isArray(fromDb)) setLibrary(fromDb);
    } catch { /* ignore */ }
  }, []);

  /* ---------- Discord rich presence ---------------------------------- */

  /**
   * Connect/disconnect Discord presence in the main process whenever
   * the toggle or app ID changes. Connection is fire-and-forget — the
   * main process handles retries if Discord isn't running yet.
   */
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.discordConnect) return undefined;
    if (discordPresenceEnabled && effectiveDiscordAppId) {
      api.discordConnect(effectiveDiscordAppId).catch(() => { /* ignore */ });
    } else if (api.discordDisconnect) {
      api.discordDisconnect().catch(() => { /* ignore */ });
    }
    return undefined;
  }, [discordPresenceEnabled, effectiveDiscordAppId]);

  /**
   * Push the current playback state to Discord whenever the playing
   * track or play/pause state changes. Uses the track's title +
   * artist + album for the activity strings, the wall-clock start
   * timestamp for elapsed-time progress (Discord computes the bar
   * itself given a start ms), and the total duration so the bar
   * shows total length. We DON'T push currentTime updates — that
   * would spam Discord's IPC with no visual benefit (Discord
   * extrapolates from the start timestamp).
   *
   * The "wall start time" is `Date.now() - currentTime*1000` recomputed
   * from a ref each time playback state changes, so a seek or pause-
   * resume cycle correctly re-anchors the timeline.
   */
  const discordWallStartRef = useRef(Date.now());
  const discordLastTrackIdRef = useRef(null);
  // Cache of iTunes artwork-lookup results keyed by `artist|album` (lower-
  // cased). Lets every track on the same album share one lookup and
  // avoids re-hitting the network on replay. `''` means "looked up and
  // got nothing"; absence means "haven't tried yet".
  const discordArtworkCacheRef = useRef(new Map());
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.discordSetActivity) return;
    if (!discordPresenceEnabled || !effectiveDiscordAppId) return;
    const track = queue[currentIndex];
    if (!track) {
      discordLastTrackIdRef.current = null;
      api.discordSetActivity(null).catch(() => { /* ignore */ });
      return;
    }
    // Re-anchor the wall start time. `currentTime` from the React state
    // is stale here (it's not in deps — including it would spam Discord
    // every audio frame), so read live from the audio element. On a
    // track change the audio element's currentTime still reads the OLD
    // song's position for one tick before `loadedmetadata`/`play` reset
    // it, so we treat a track-id change as "start from 0" explicitly.
    // For play/pause toggles on the same track, the live audio
    // currentTime is the correct anchor — pausing at 30s then resuming
    // anchors the wall start to (now - 30s), so Discord shows the right
    // elapsed time without rewinding.
    const trackId = track.id;
    const trackChanged = discordLastTrackIdRef.current !== trackId;
    discordLastTrackIdRef.current = trackId;
    const liveCurrentTime = trackChanged
      ? 0
      : (audioRef.current?.currentTime ?? currentTime);
    discordWallStartRef.current = Date.now() - (liveCurrentTime * 1000);
    // Discord only fetches public http(s) URLs for cover art — embedded
    // ID3 art (data: URLs) and our studio-cover:// custom protocol won't
    // resolve from Discord's servers. We try every field on the track
    // that might hold a public URL and pick the first one that qualifies.
    const isPublicHttpUrl = (s) => typeof s === 'string' && /^https?:\/\/[^\s]+$/i.test(s);
    const localCoverUrl = [
      track.coverArtUrl,
      track.coverArtRemote,
      track.albumArtUrl,
      track.spotifyAlbumImage,
      // track.coverArt is usually a data: URL from embedded ID3 — but on
      // Spotify-imported tracks it may also be a CDN URL, so try it last.
      track.coverArt,
    ].find(isPublicHttpUrl) || '';

    // imgbb upload path — for local tracks whose only art is a
    // studio-cover:// file, we upload it to imgbb once (cached on disk
    // by image hash) and use the resulting public URL. The upload key is
    // prefixed so it doesn't collide with the iTunes cache entries.
    //
    // Check coverArtLocal first: mergeCoverArt preserves the original
    // studio-cover:// URL there when it overwrites coverArt with a
    // freshly-parsed data: URI, so we don't lose the path mid-session.
    const studioUrl = !localCoverUrl
      ? [track.coverArtLocal, track.coverArt]
          .find((s) => typeof s === 'string' && s.startsWith('studio-cover://')) || null
      : null;
    const imgurKey = studioUrl ? `imgur:${studioUrl}` : null;
    const cachedImgur = imgurKey && discordArtworkCacheRef.current.has(imgurKey)
      ? (discordArtworkCacheRef.current.get(imgurKey) || '') : '';

    // Some tracks have no public URL anywhere (Spotify search row
    // didn't carry one, or the track was imported back when that field
    // wasn't being persisted). For those, check the iTunes cache — if
    // we've already looked up this song, use the cached URL
    // immediately; otherwise queue an async lookup and re-push when it
    // returns. Key by artist+album+title (not just album) because the
    // main-process lookup matches on all three; an album-wide cache key
    // would falsely share a URL between tracks where only one matched.
    const cacheKey = `${(track.artist || '').trim()}|${(track.album || '').trim()}|${(track.title || '').trim()}`.toLowerCase();
    const cachedRemote = discordArtworkCacheRef.current.get(cacheKey);
    const coverArtUrl = localCoverUrl || cachedImgur || cachedRemote || '';
    const payload = {
      title: track.title || 'Unknown track',
      artist: track.artist || '',
      album: track.album || '',
      coverArtUrl,
      isPlaying,
      duration: track.duration || 0,
      startedAtMs: discordWallStartRef.current,
    };
    api.discordSetActivity(payload).catch(() => { /* ignore */ });

    const effectiveImgbbApiKey = (imgbbApiKey || '').trim();

    // Path A — imgbb upload for local studio-cover:// art.
    // When the track has no public URL but has local embedded art,
    // upload it once to imgbb and re-push when the URL comes back.
    // The main process caches the result on disk by image hash so the
    // same art is never uploaded twice across restarts.
    if (
      !localCoverUrl && !cachedImgur
      && imgurKey && effectiveImgbbApiKey
      && api.discordResolveCoverUrl
      && !discordArtworkCacheRef.current.has(imgurKey)
    ) {
      discordArtworkCacheRef.current.set(imgurKey, null); // mark in-flight
      api.discordResolveCoverUrl({ studioUrl, clientId: effectiveImgbbApiKey })
        .then((res) => {
          const url = res?.url || '';
          discordArtworkCacheRef.current.set(imgurKey, url);
          if (!url) return;
          if (discordLastTrackIdRef.current !== trackId) return; // user moved on
          api.discordSetActivity({
            ...payload,
            coverArtUrl: url,
            isPlaying,
            startedAtMs: discordWallStartRef.current,
          }).catch(() => { /* ignore */ });
        })
        .catch(() => {
          // Network error — remove so next play can retry
          discordArtworkCacheRef.current.delete(imgurKey);
        });
    }

    // Path B — iTunes metadata lookup, fallback when no Imgur Client-ID
    // is configured or when the track has no studio-cover:// art at all.
    // If we sent no URL and don't have a cached lookup yet, kick off an
    // iTunes lookup. When it returns, if the user is still on this same
    // track, re-push the activity with the resolved URL. We guard on
    // trackId so that an old lookup for a previous track doesn't
    // overwrite presence for whatever the user has skipped to.
    if (
      !localCoverUrl && !cachedImgur
      && !(imgurKey && effectiveImgbbApiKey) // skip when imgbb path is active
      && !discordArtworkCacheRef.current.has(cacheKey)
      && api.discordLookupArtwork
      && (track.artist || track.album || track.title)
    ) {
      // Mark as "in flight" with `null` so we don't fire duplicate
      // lookups for the same album while the first request is pending.
      discordArtworkCacheRef.current.set(cacheKey, null);
      api.discordLookupArtwork({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
      }).then((res) => {
        const url = res?.url || '';
        discordArtworkCacheRef.current.set(cacheKey, url || '');
        if (!url) return;
        if (discordLastTrackIdRef.current !== trackId) return; // user moved on
        const isStillPlaying = isPlaying;
        api.discordSetActivity({
          ...payload,
          coverArtUrl: url,
          isPlaying: isStillPlaying,
          // The wall-start was anchored above; reuse it so the elapsed-
          // time bar doesn't jump when the second activity arrives.
          startedAtMs: discordWallStartRef.current,
        }).catch(() => { /* ignore */ });
      }).catch(() => {
        // Mark as known-miss so we don't retry on replay.
        discordArtworkCacheRef.current.set(cacheKey, '');
      });
    }
    // Note: we deliberately depend on currentTrack identity + isPlaying
    // + seekNonce only, NOT currentTime. currentTime ticks every audio
    // frame and would spam Discord. Track changes and play/pause both
    // re-anchor on their own; seekNonce covers user seeks within a song.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue[currentIndex]?.id, isPlaying, seekNonce, discordPresenceEnabled, effectiveDiscordAppId]);

  const handleSpotifyCredsSaved = () => {
    setSpotifyCredsRefreshKey((k) => k + 1);
  };

  /**
   * Clear the entire library. `deleteFiles=true` also trashes audio files the
   * app downloaded (yt-dlp). User-imported files on disk are never touched.
   *
   * Returns the IPC result so the caller can surface a confirmation message
   * ("Deleted 42 files, kept 6 user-imported files").
   */
  const clearLibrary = useCallback(async ({ deleteFiles = false } = {}) => {
    const api = window.electronAPI;
    if (!api?.clearLibrary) return { ok: false, error: 'Not supported' };
    const result = await api.clearLibrary({ deleteFiles });
    if (result?.ok) {
      // Reset playback + library state locally
      const audio = audioRef.current;
      if (audio) { try { audio.pause(); } catch { /* ignore */ } audio.src = ''; }
      setQueue([]);
      setCurrentIndex(-1);
      setIsPlaying(false);
      setCurrentTime(0);
      setLibrary([]);
      setPlaylists([]);
      setReleases([]);
      setFollowOverrides([]);
      setHasEverPlayed(false);
    }
    return result;
  }, []);

  const removeTracksFromLibrary = async (trackIds) => {
    const ids = new Set((trackIds || []).map(String).filter(Boolean));
    if (ids.size === 0) return;
    const api = window.electronAPI;
    let removedOk = false;
    if (api && typeof api.removeLibraryTracks === 'function') {
      const r = await api.removeLibraryTracks([...ids]);
      if (!r?.ok) return;
      removedOk = true;
    } else if (api && typeof api.invokeIpc === 'function') {
      const r = await api.invokeIpc('library:removeTracks', [...ids]);
      if (!r?.ok) return;
      removedOk = true;
    }
    if (!removedOk) return;

    const prevQ = queueRef.current;
    const curIdx = currentIndex;
    const curId = prevQ[curIdx]?.id;
    const nextQ = prevQ.filter((t) => !ids.has(t.id));

    if (api?.loadLibrary) {
      try {
        const fromDb = await api.loadLibrary();
        setLibrary(fromDb);
      } catch {
        setLibrary((prev) => prev.filter((t) => !ids.has(t.id)));
      }
    } else {
      setLibrary((prev) => prev.filter((t) => !ids.has(t.id)));
    }

    setQueue(nextQ);
    if (curId && ids.has(curId)) {
      if (nextQ.length === 0) {
        setCurrentIndex(-1);
        setIsPlaying(false);
      } else {
        setCurrentIndex(Math.min(curIdx, nextQ.length - 1));
      }
    } else if (curId) {
      const ni = nextQ.findIndex((t) => t.id === curId);
      setCurrentIndex(ni >= 0 ? ni : Math.min(curIdx, Math.max(0, nextQ.length - 1)));
    }
  };

  /** Update metadata fields on a single track and refresh the library. */
  const updateTrackMetadata = async (id, fields) => {
    const api = window.electronAPI;
    if (!api) return { ok: false, error: 'Not running in Electron' };
    let r;
    try {
      if (typeof api.updateLibraryTrack === 'function') {
        r = await api.updateLibraryTrack(id, fields);
      } else if (typeof api.invokeIpc === 'function') {
        r = await api.invokeIpc('library:updateTrack', { id, fields });
      } else {
        return { ok: false, error: 'Update not supported in this build' };
      }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
    if (!r?.ok) return r || { ok: false };
    // Reload the library so the edited row reflects in UI and queue
    try {
      const fromDb = await api.loadLibrary();
      setLibrary(fromDb);
      // Also patch the live queue so "currently playing" info updates without a skip
      setQueue((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t };
        if (typeof fields.title === 'string') next.title = fields.title.trim() || t.title;
        if (typeof fields.artist === 'string') next.artist = fields.artist.trim() || t.artist;
        if (typeof fields.album === 'string') next.album = fields.album.trim() || t.album;
        if ('year' in fields) next.year = fields.year || null;
        if ('genre' in fields) next.genre = fields.genre || '';
        if ('coverArt' in fields) next.coverArt = fields.coverArt || null;
        if ('trackNumber' in fields) next.trackNumber = fields.trackNumber || null;
        if ('discNumber' in fields) next.discNumber = fields.discNumber || null;
        return next;
      }));
    } catch { /* ignore */ }
    return { ok: true };
  };

  /** Apply album-level fields to a set of tracks in one transaction. */
  const updateAlbumMetadata = async (trackIds, fields) => {
    const api = window.electronAPI;
    if (!api) return { ok: false, error: 'Not running in Electron' };
    const ids = (trackIds || []).map(String).filter(Boolean);
    if (ids.length === 0) return { ok: false, error: 'No tracks to update' };
    let r;
    try {
      if (typeof api.updateLibraryAlbum === 'function') {
        r = await api.updateLibraryAlbum(ids, fields);
      } else if (typeof api.invokeIpc === 'function') {
        r = await api.invokeIpc('library:updateAlbum', { trackIds: ids, fields });
      } else {
        return { ok: false, error: 'Update not supported in this build' };
      }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
    if (!r?.ok) return r || { ok: false };
    // Reload library + patch live queue entries for any affected tracks
    try {
      const fromDb = await api.loadLibrary();
      setLibrary(fromDb);
      const idSet = new Set(ids);
      setQueue((prev) => prev.map((t) => {
        if (!idSet.has(t.id)) return t;
        const next = { ...t };
        if (typeof fields.artist === 'string') next.artist = fields.artist.trim() || t.artist;
        if (typeof fields.album === 'string') next.album = fields.album.trim() || t.album;
        if ('year' in fields) next.year = fields.year || null;
        if ('genre' in fields) next.genre = fields.genre || '';
        if ('coverArt' in fields) next.coverArt = fields.coverArt || null;
        return next;
      }));
    } catch { /* ignore */ }
    return { ok: true, updated: r.updated };
  };

  /* ---------- Favorites / notes / play tracking ---------- */

  /**
   * Toggle a track's favorite. Optimistically updates local library state so the
   * UI feels instant; rolls back if the DB write fails.
   */
  const toggleFavorite = async (id) => {
    const api = window.electronAPI;
    if (!api?.setTrackFavorite) return { ok: false };
    const current = library.find((t) => t.id === id);
    if (!current) return { ok: false };
    const next = !current.isFavorite;
    setLibrary((lib) => lib.map((t) => (t.id === id ? { ...t, isFavorite: next } : t)));
    try {
      const r = await api.setTrackFavorite(id, next);
      if (!r?.ok) {
        // Roll back
        setLibrary((lib) => lib.map((t) => (t.id === id ? { ...t, isFavorite: !next } : t)));
      }
      return r;
    } catch (e) {
      setLibrary((lib) => lib.map((t) => (t.id === id ? { ...t, isFavorite: !next } : t)));
      return { ok: false, error: String(e?.message || e) };
    }
  };

  /**
   * Track which IDs we've already counted as played in this app session.
   * The threshold for counting a play is "30s elapsed OR 50% of duration,
   * whichever comes first" — matches Last.fm's scrobble rule.
   */
  /* ---------- Play count tracking ----------
   *
   * Bump play count + lastPlayed once per playback session of a track:
   *   - Threshold = min(30s, half the track length)
   *   - One bump per "session" = one continuous mount of this track as the
   *     current track. Switching to another track and back counts as a new
   *     session and is eligible for another bump.
   *
   * Why allow re-counting on return? Because a session is the natural unit
   * a listener thinks of — playing a song twice in a sitting is two plays
   * to a human. The Set is keyed by track id and is cleaned up in the
   * effect's teardown, so revisiting the same track later mounts a fresh
   * effect with a fresh chance to record.
   */

  /** Rolling log of play events. Each entry = { id, at }. Used by StatsTab to
   * compute "plays this week" as the actual count of events, not the count of
   * distinct tracks with `lastPlayed` in the window — the DB only stores the
   * latest play timestamp per track, so we keep this log in localStorage to
   * recover real per-week play totals.
   *
   * On bootstrap, hydrate from the DB (authoritative) — localStorage is a
   * legacy fallback for pre-DB-events installs. New events go to both.
   * Pruned to the last ~90 days on read so it can't grow unbounded. */
  const PLAY_EVENT_RETENTION_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
  const [playEvents, setPlayEvents] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('immerse:playEvents') : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - PLAY_EVENT_RETENTION_MS;
      // Keep only well-formed events newer than the cutoff. Sanitize defensively
      // — junk in localStorage shouldn't crash the app.
      return parsed.filter((e) => (
        e && typeof e.id === 'string' && Number.isFinite(e.at) && e.at >= cutoff
      ));
    } catch { return []; }
  });
  // Bootstrap from the DB once the library is open. The DB is the source
  // of truth for play events now — localStorage was a pre-DB-events
  // workaround that we keep around so older installs don't lose history.
  // The DB result REPLACES the localStorage seed (it includes everything
  // the localStorage one had, since recordTrackPlay writes both).
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.loadPlayEvents) return;
    let cancelled = false;
    (async () => {
      try {
        const since = Date.now() - PLAY_EVENT_RETENTION_MS;
        const events = await api.loadPlayEvents(since);
        if (cancelled || !Array.isArray(events)) return;
        setPlayEvents(events);
      } catch { /* keep the localStorage seed */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist the log whenever it changes. Also opportunistically prunes old
  // events on every save so the stored size never drifts upward.
  useEffect(() => {
    try {
      const cutoff = Date.now() - PLAY_EVENT_RETENTION_MS;
      const fresh = playEvents.filter((e) => e.at >= cutoff);
      if (fresh.length === 0) {
        window.localStorage.removeItem('immerse:playEvents');
      } else {
        window.localStorage.setItem('immerse:playEvents', JSON.stringify(fresh));
      }
    } catch { /* ignore */ }
  }, [playEvents]);

  // Reset stats — clears both DB and local mirror. Used by the Stats
  // tab's reset action. After the DB call returns, we also zero
  // playCount/lastPlayed in the in-memory library and empty the
  // playEvents list so the UI updates instantly.
  const resetAllStats = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.resetStats) return { ok: false, error: 'Not supported' };
    const res = await api.resetStats();
    if (res?.ok) {
      setLibrary((lib) => lib.map((t) => ({ ...t, playCount: 0, lastPlayed: null })));
      setPlayEvents([]);
      try { window.localStorage.removeItem('immerse:playEvents'); } catch { /* ignore */ }
    }
    return res || { ok: false };
  }, []);

  // Dedupe lock for the per-track "scrobble" threshold. Tracks whose id
  // is in this set have already had a play recorded in the current play
  // segment. The lock is released when:
  //   - The track ends (audio `ended` event) — so a repeat play counts.
  //   - The user seeks backward below the threshold — so manually
  //     restarting the song to listen again counts.
  //   - The user switches to a different track — the effect cleanup
  //     removes the old id from the set.
  const playRecordedRef = useRef(new Set());
  useEffect(() => {
    if (!currentTrack) return undefined;
    const audio = audioRef.current;
    if (!audio) return undefined;
    const id = currentTrack.id;

    const recordIfThresholdHit = () => {
      if (playRecordedRef.current.has(id)) return;
      const dur = audio.duration || currentTrack.duration || 0;
      const elapsed = audio.currentTime || 0;
      const threshold = Math.min(30, dur > 0 ? dur * 0.5 : 30);
      if (elapsed < threshold) return;
      playRecordedRef.current.add(id);
      const api = window.electronAPI;
      if (!api?.recordTrackPlay) return;
      api.recordTrackPlay(id).then((r) => {
        if (!r?.ok) return;
        // Mirror the DB write in memory so library sorts and stats
        // update without waiting for a reload. The DB recordTrackPlay
        // is still the source of truth.
        const at = Date.now();
        setLibrary((lib) => lib.map((t) => (
          t.id === id
            ? { ...t, playCount: (t.playCount || 0) + 1, lastPlayed: at }
            : t
        )));
        setPlayEvents((evs) => [...evs, { id, at }]);
      }).catch(() => {});
    };

    const onTime = () => recordIfThresholdHit();
    const onEnded = () => {
      // Track ended — clear the lock so a loop / repeat replays this
      // exact track at the next threshold crossing.
      playRecordedRef.current.delete(id);
    };
    const onSeeked = () => {
      // Seeking backward past the threshold gives the user another
      // shot at scrobbling: e.g. they really like the song and rewind
      // to its start. We re-arm the dedupe lock when current position
      // drops below the threshold, then the next forward play through
      // it will count.
      const dur = audio.duration || currentTrack.duration || 0;
      const threshold = Math.min(30, dur > 0 ? dur * 0.5 : 30);
      if ((audio.currentTime || 0) < threshold) {
        playRecordedRef.current.delete(id);
      }
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('seeked', onSeeked);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('seeked', onSeeked);
      // Clear this id from the dedupe set so a future return to the
      // same track in a different session is eligible to be recorded.
      playRecordedRef.current.delete(id);
    };
  }, [currentTrack?.id]);

  /* ---------- New releases tracker ---------- */

  /**
   * Compute the "followed artist" set = (auto-followed from library with 2+ tracks)
   *                                   ∪ (manual 'add' overrides)
   *                                   − (manual 'exclude' overrides).
   *
   * Artist names are canonicalised to lower-case for comparison but returned
   * with their original casing so the iTunes query sees a proper name.
   */
  const followedArtists = useMemo(() => {
    const primaryArtist = (str) => {
      if (!str) return '';
      return str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim();
    };
    const counts = new Map();    // lowercase → { displayName, count }
    for (const t of library) {
      const primary = primaryArtist(t.artist);
      if (!primary) continue;
      const key = primary.toLowerCase();
      const prev = counts.get(key);
      if (prev) prev.count += 1;
      else counts.set(key, { displayName: primary, count: 1 });
    }
    const auto = new Set();
    const displayByLower = new Map();
    for (const [key, v] of counts) {
      displayByLower.set(key, v.displayName);
      if (v.count >= 2) auto.add(key);
    }
    // Apply manual overrides
    for (const o of followOverrides) {
      const key = o.artistName.toLowerCase();
      displayByLower.set(key, o.artistName);
      if (o.action === 'add') auto.add(key);
      else if (o.action === 'exclude') auto.delete(key);
    }
    // Emit as array of { displayName, key, source }
    return [...auto].map((key) => {
      const override = followOverrides.find((o) => o.artistName.toLowerCase() === key && o.action === 'add');
      return {
        key,
        displayName: displayByLower.get(key) || key,
        source: override ? 'manual' : 'auto',
      };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [library, followOverrides]);

  /**
   * Auto-refresh releases once per app session, a few seconds after bootstrap,
   * if we haven't already pulled within the last 24 hours. The main process
   * has its own cooldown so this is idempotent.
   */
  const releasesAutoRefreshedRef = useRef(false);
  useEffect(() => {
    if (releasesAutoRefreshedRef.current) return undefined;
    if (!libraryBootstrapped) return undefined;
    if (!followedArtists.length) return undefined;
    const api = window.electronAPI;
    if (!api?.refreshReleases) return undefined;

    // Only auto-refresh if the newest cached release is older than 24 hours
    // (or if there are no cached releases at all). Otherwise user hit refresh
    // recently or the data is already fresh.
    const newest = releases[0]?.cachedAt || 0;
    const stale = !newest || (Date.now() - newest) > 24 * 60 * 60 * 1000;
    if (!stale) {
      releasesAutoRefreshedRef.current = true;
      return undefined;
    }

    releasesAutoRefreshedRef.current = true;
    const t = setTimeout(async () => {
      try {
        setReleasesRefreshing(true);
        const names = followedArtists.map((a) => a.displayName);
        await api.refreshReleases(names, 'auto');
        // Reload cache after refresh completes
        const r = await api.loadCachedReleases();
        if (r?.ok) setReleases(r.releases || []);
      } catch (e) { console.error('auto-refresh releases', e); }
      finally { setReleasesRefreshing(false); }
    }, 3500); // small delay so we don't pile onto startup
    return () => clearTimeout(t);
  }, [libraryBootstrapped, followedArtists.length]);

  /** Manual refresh, triggered from the New Releases tab's refresh button. */
  const refreshReleases = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.refreshReleases) return { ok: false, error: 'Not supported' };
    if (!followedArtists.length) return { ok: true, skipped: true };
    setReleasesRefreshing(true);
    try {
      const names = followedArtists.map((a) => a.displayName);
      const result = await api.refreshReleases(names, 'manual');
      const r = await api.loadCachedReleases();
      if (r?.ok) setReleases(r.releases || []);
      return result;
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    } finally {
      setReleasesRefreshing(false);
    }
  }, [followedArtists]);

  /** Refresh the overrides list from DB after any add/exclude/clear. */
  const refreshOverrides = async () => {
    const api = window.electronAPI;
    if (!api?.loadReleaseOverrides) return;
    try {
      const r = await api.loadReleaseOverrides();
      if (r?.ok) setFollowOverrides(r.overrides || []);
    } catch (e) { console.error('refreshOverrides', e); }
  };

  const addFollowedArtist = async (artistName) => {
    const api = window.electronAPI;
    if (!api?.addFollowedArtist) return { ok: false };
    const r = await api.addFollowedArtist(artistName);
    if (r?.ok) await refreshOverrides();
    return r;
  };

  const excludeFollowedArtist = async (artistName) => {
    const api = window.electronAPI;
    if (!api?.excludeFollowedArtist) return { ok: false };
    const r = await api.excludeFollowedArtist(artistName);
    if (r?.ok) await refreshOverrides();
    return r;
  };

  const clearFollowedArtistOverride = async (artistName) => {
    const api = window.electronAPI;
    if (!api?.clearFollowedArtistOverride) return { ok: false };
    const r = await api.clearFollowedArtistOverride(artistName);
    if (r?.ok) await refreshOverrides();
    return r;
  };

  /* ---------- Playlist CRUD ---------- */

  const refreshPlaylists = async () => {
    const api = window.electronAPI;
    if (!api?.loadPlaylists) return;
    try {
      const pls = await api.loadPlaylists();
      if (Array.isArray(pls)) setPlaylists(pls);
    } catch (e) { console.error('refreshPlaylists', e); }
  };

  const createPlaylist = async (fields) => {
    const api = window.electronAPI;
    if (!api?.createPlaylist) return { ok: false, error: 'Not supported' };
    const r = await api.createPlaylist(fields || {});
    if (r?.ok) await refreshPlaylists();
    return r;
  };

  const updatePlaylist = async (id, fields) => {
    const api = window.electronAPI;
    if (!api?.updatePlaylist) return { ok: false, error: 'Not supported' };
    const r = await api.updatePlaylist(id, fields || {});
    if (r?.ok) await refreshPlaylists();
    return r;
  };

  const deletePlaylist = async (id) => {
    const api = window.electronAPI;
    if (!api?.deletePlaylist) return { ok: false, error: 'Not supported' };
    const r = await api.deletePlaylist(id);
    if (r?.ok) await refreshPlaylists();
    return r;
  };

  const addTracksToPlaylist = async (playlistId, trackIds) => {
    const api = window.electronAPI;
    if (!api?.addTracksToPlaylist) return { ok: false, error: 'Not supported' };
    const r = await api.addTracksToPlaylist(playlistId, trackIds || []);
    if (r?.ok) await refreshPlaylists();
    return r;
  };

  const removeTracksFromPlaylist = async (playlistId, trackIds) => {
    const api = window.electronAPI;
    if (!api?.removeTracksFromPlaylist) return { ok: false, error: 'Not supported' };
    const r = await api.removeTracksFromPlaylist(playlistId, trackIds || []);
    if (r?.ok) await refreshPlaylists();
    return r;
  };

  /** Load a playlist's ordered track objects (joins track IDs against library). */
  const loadPlaylistTracks = async (playlistId) => {
    const api = window.electronAPI;
    if (!api?.loadPlaylistTrackIds) return [];
    const ids = await api.loadPlaylistTrackIds(playlistId);
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const libMap = new Map(libraryRef.current.map((t) => [t.id, t]));
    return ids.map((id) => libMap.get(id)).filter(Boolean);
  };

  const inElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const uiFontStack = presetById(uiFontId).stack;

  return (
    <div style={{
      width: '100%', height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#000', color: '#fff',
      fontFamily: uiFontStack,
      fontSize: '13px', overflow: 'hidden',
      position: 'relative',
    }}
    >
      {!inElectron ? (
        <div style={{
          flexShrink: 0, background: '#5c1010', color: '#fecaca', padding: '12px 20px', fontSize: 13, lineHeight: 1.55,
          borderBottom: '1px solid rgba(255,255,255,0.12)', WebkitAppRegion: 'no-drag',
          position: 'relative', zIndex: 200,
        }}
        >
          <strong style={{ color: '#fff' }}>You are in a normal browser tab.</strong>
          {' '}
          Close this tab and use the
          {' '}
          <strong style={{ color: '#fff' }}>Immersive desktop window</strong>
          {' '}
          that appears when you run
          {' '}
          <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', color: '#fda4af' }}>npm start</span>
          {' '}
          from the project folder.
        </div>
      ) : null}

      {/* Immersive fills everything — the title bar is now an overlay on top of it. */}
      <ImmersiveLibraryPage
        library={library}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        shuffleOn={shuffleOn}
        repeat={repeat}
        importing={importing}
        setImporting={setImporting}
        uiFontId={uiFontId}
        onSetUiFontId={setUiFontId}
        uiFontStack={uiFontStack}
        spotifyCredsRefreshKey={spotifyCredsRefreshKey}
        onSpotifyCredsSaved={handleSpotifyCredsSaved}
        onOpenTutorial={openTutorial}
        onPlayTrack={playTrack}
        onPlayPauseTrack={playPauseLibraryRow}
        onTogglePlay={togglePlay}
        onPrev={handlePrev}
        onNext={handleNext}
        onToggleShuffle={toggleShuffle}
        onToggleRepeat={() => setRepeat((p) => (p === 'off' ? 'all' : p === 'all' ? 'one' : 'off'))}
        onSeek={seekTo}
        onSetVolume={setVolume}
        gainBoost={gainBoost}
        onSetGainBoost={setGainBoost}
        isMaximized={isMaximized}
        onImportFiles={importFiles}
        onImportFolder={importFolder}
        onSpotifyImportDone={handleSpotifyImportDone}
        onRemoveFromLibrary={removeTracksFromLibrary}
        onUpdateTrackMetadata={updateTrackMetadata}
        onUpdateAlbumMetadata={updateAlbumMetadata}
        playlists={playlists}
        onCreatePlaylist={createPlaylist}
        onUpdatePlaylist={updatePlaylist}
        onDeletePlaylist={deletePlaylist}
        onAddTracksToPlaylist={addTracksToPlaylist}
        onRemoveTracksFromPlaylist={removeTracksFromPlaylist}
        onLoadPlaylistTracks={loadPlaylistTracks}
        hasEverPlayed={hasEverPlayed}
        animateGradient={animateGradient}
        onSetAnimateGradient={setAnimateGradient}
        beatReactive={beatReactive}
        onSetBeatReactive={setBeatReactive}
        coverFullscreenEnabled={coverFullscreenEnabled}
        onSetCoverFullscreenEnabled={setCoverFullscreenEnabled}
        pinnableTabsEnabled={pinnableTabsEnabled}
        onSetPinnableTabsEnabled={setPinnableTabsEnabled}
        hiddenTabIds={hiddenTabIds}
        onSetHiddenTabIds={setHiddenTabIds}
        dockCollapseAnimationEnabled={dockCollapseAnimationEnabled}
        onSetDockCollapseAnimationEnabled={setDockCollapseAnimationEnabled}
        randomButtonEnabled={randomButtonEnabled}
        onSetRandomButtonEnabled={setRandomButtonEnabled}
        onPlayRandom={playRandomTrack}
        breathingDockPillEnabled={breathingDockPillEnabled}
        onSetBreathingDockPillEnabled={setBreathingDockPillEnabled}
        dockTransparentEnabled={dockTransparentEnabled}
        onSetDockTransparentEnabled={setDockTransparentEnabled}
        liquidGlassDockEnabled={liquidGlassDockEnabled}
        onSetLiquidGlassDockEnabled={setLiquidGlassDockEnabled}
        journalTabEnabled={journalTabEnabled}
        onSetJournalTabEnabled={setJournalTabEnabled}
        queuePainterEnabled={queuePainterEnabled}
        onSetQueuePainterEnabled={setQueuePainterEnabled}
        recentPeekEnabled={recentPeekEnabled}
        onSetRecentPeekEnabled={setRecentPeekEnabled}
        recentPeekRange={recentPeekRange}
        onSetRecentPeekRange={setRecentPeekRange}
        recentPeekCustomCount={recentPeekCustomCount}
        onSetRecentPeekCustomCount={setRecentPeekCustomCount}
        firstTimeSparkleEnabled={firstTimeSparkleEnabled}
        onSetFirstTimeSparkleEnabled={setFirstTimeSparkleEnabled}
        trackOfMomentEnabled={trackOfMomentEnabled}
        onSetTrackOfMomentEnabled={setTrackOfMomentEnabled}
        clickToFilterEnabled={clickToFilterEnabled}
        onSetClickToFilterEnabled={setClickToFilterEnabled}
        artistInfoEnabled={artistInfoEnabled}
        onSetArtistInfoEnabled={setArtistInfoEnabled}
        lastFmApiKey={lastFmApiKey}
        onSetLastFmApiKey={setLastFmApiKey}
        creditsEnabled={creditsEnabled}
        onSetCreditsEnabled={setCreditsEnabled}
        videosEnabled={videosEnabled}
        onSetVideosEnabled={setVideosEnabled}
        edgeBleedEnabled={edgeBleedEnabled}
        onSetEdgeBleedEnabled={setEdgeBleedEnabled}
        ambientMode={ambientMode}
        onSetAmbientMode={setAmbientMode}
        ambientCustomDelaySec={ambientCustomDelaySec}
        onSetAmbientCustomDelaySec={setAmbientCustomDelaySec}
        twoPaneEnabled={twoPaneEnabled}
        onSetTwoPaneEnabled={setTwoPaneEnabled}
        discordPresenceEnabled={discordPresenceEnabled}
        onSetDiscordPresenceEnabled={setDiscordPresenceEnabled}
        discordAppId={discordAppId}
        onSetDiscordAppId={setDiscordAppId}
        imgbbApiKey={imgbbApiKey}
        onSetImgbbApiKey={setImgbbApiKey}
        onReloadLibrary={reloadLibrary}
        panelResizableEnabled={panelResizableEnabled}
        onSetPanelResizableEnabled={setPanelResizableEnabled}
        dockDraggableEnabled={dockDraggableEnabled}
        onSetDockDraggableEnabled={setDockDraggableEnabled}
        panelWidth={panelWidth}
        onSetPanelWidth={setPanelWidth}
        dockPosition={dockPosition}
        onSetDockPosition={setDockPosition}
        playEvents={playEvents}
        onResetStats={resetAllStats}
        statsRangeTabsEnabled={statsRangeTabsEnabled}
        onSetStatsRangeTabsEnabled={setStatsRangeTabsEnabled}
        analyserRef={analyserRef}
        ensureAnalyser={ensureAnalyser}
        onToggleFavorite={toggleFavorite}
        queue={queue}
        currentIndex={currentIndex}
        onAddToQueue={addToQueue}
        onPlayNext={playNext}
        onRemoveFromQueue={removeFromQueue}
        onReorderQueue={reorderQueue}
        onClearUpNext={clearUpNext}
        onJumpToQueueIndex={jumpToQueueIndex}
        releases={releases}
        followedArtists={followedArtists}
        followOverrides={followOverrides}
        releasesRefreshing={releasesRefreshing}
        onRefreshReleases={refreshReleases}
        onAddFollowedArtist={addFollowedArtist}
        onExcludeFollowedArtist={excludeFollowedArtist}
        onClearFollowedArtistOverride={clearFollowedArtistOverride}
        onClearLibrary={clearLibrary}
      />

      {/* Drag strip — invisible, sits behind everything, lets you move the
          window by dragging the top edge. The `right: 130` reservation
          carves out a margin on the right side that the floating window
          controls live in. CRITICAL: this number must be at least the
          width of the window-controls container, otherwise the drag
          region overlaps the buttons and on Windows/Linux the OS-level
          hit-test routes clicks to drag instead of to the button. The
          controls container below is ~100px wide (3 × 26px + 2 × 6px
          gap + 12px right padding); 130 gives a 30px safety margin. */}
      <div
        aria-hidden
        style={{
          position: 'absolute', top: 0, left: 0, right: 130, height: 36,
          WebkitAppRegion: 'drag', zIndex: 99,
        }}
      />

      {/* Floating window controls. Three round glass pills sitting in
          the top-right corner, color-coded by action so they're scannable
          at a glance: cool gray for minimize, Immerse purple for the
          maximize toggle, warm coral for close. Container is explicitly
          marked no-drag and sits at z-index 101 (above the drag strip
          at 99) so clicks always land on a button, not on the drag region. */}
      {inElectron ? (
        <div
          style={{
            position: 'absolute', top: 6, right: 8, height: 32,
            display: 'flex', alignItems: 'center', gap: 6,
            // Padding ensures the no-drag region is slightly larger than
            // the buttons themselves, giving a small buffer where clicks
            // are guaranteed to route to the controls rather than drag.
            padding: '3px 4px',
            WebkitAppRegion: 'no-drag', pointerEvents: 'auto', zIndex: 101,
          }}
        >
          <WinBtn
            onClick={() => window.electronAPI?.minimize()}
            title="Minimize"
            // Cool slate — reads as "tuck away" rather than "destroy".
            hue="170, 180, 195"
          >
            <svg width="10" height="10" viewBox="0 0 12 12">
              <rect y="5.4" width="12" height="1.2" fill="currentColor" rx="0.6" />
            </svg>
          </WinBtn>
          <WinBtn
            onClick={() => window.electronAPI?.maximize()}
            title={isMaximized ? 'Restore' : 'Maximize'}
            // Immerse purple — ties the action to the app's identity.
            hue="167, 139, 250"
          >
            {isMaximized ? (
              // "Restore" icon — two stacked squares suggesting un-stack.
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <path d="M2 8.5 V2.5 a0.5 0.5 0 0 1 0.5 -0.5 H8.5" />
              </svg>
            ) : (
              // "Maximize" icon — single empty square.
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
              </svg>
            )}
          </WinBtn>
          <WinBtn
            onClick={() => window.electronAPI?.close()}
            title="Close"
            // Warm coral — clearly signals "stop" without the screaming
            // Windows-red. Friendlier within the app's aesthetic.
            hue="255, 130, 130"
            isClose
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </WinBtn>
        </div>
      ) : null}

      {/* Ambient mode overlay. Renders unconditionally so React keeps the
         AmbientMode instance mounted across activations; the component
         itself returns null when `active` is false. This avoids a tear-
         down/rebuild every time the player goes idle, which matters
         because AmbientMode runs its own setIntervals for cover cycling. */}
      <AmbientMode
        active={ambientActive}
        library={library}
        onClose={dismissAmbient}
        onPlayAlbum={(albumTracks) => {
          // User picked an album from ambient mode — play track 1 and
          // exit ambient. setAmbientActive(false) here, NOT dismissAmbient,
          // because we want re-engagement to happen if they later become
          // idle again (which dismissAmbient would prevent until the
          // next session-start). currentTrack appearing will re-arm
          // anyway via the idle-timer effect.
          if (!albumTracks || albumTracks.length === 0) return;
          setAmbientActive(false);
          playTrack(albumTracks[0], albumTracks);
        }}
      />
      {/* Global toast stack — used by the auto-updater and any other
          app-shell notification path. Pinned to bottom-right above the
          player chrome. */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {/* What's new overlay — shown once per version bump. */}
      {whatsNewOpen && whatsNewData ? (
        <WhatsNewOverlay
          data={whatsNewData}
          onClose={dismissWhatsNew}
        />
      ) : null}
      {/* First-run / on-demand tutorial. Has its own z-index above the
          dock and ToastStack so it sits on top of everything. */}
      {tutorialOpen ? (
        <Tutorial onClose={dismissTutorial} />
      ) : null}
    </div>
  );
}

/**
 * WhatsNewOverlay — modal that appears once after each app update with
 * the GitHub release notes for the new version.
 *
 * Notes are pulled from the GitHub Release's `body` field, which is
 * GitHub-flavored markdown. We do a lightweight render here (headings,
 * bold, italic, inline code, code blocks, links, lists) — no full
 * markdown parser dep. The renderer is intentionally conservative;
 * anything we don't recognize falls through as plain text rather than
 * raw HTML, so a malformed release body just looks plain, not broken.
 *
 * The overlay matches Immerse's existing modal style: blurred backdrop,
 * frosted glass card, accent green for headings + the close button.
 */
function WhatsNewOverlay({ data, onClose }) {
  const { name, body, url, publishedAt } = data;

  // Escape key dismisses, matching the rest of Immerse's modals.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dateLine = useMemo(() => {
    if (!publishedAt) return '';
    try {
      const d = new Date(publishedAt);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return ''; }
  }, [publishedAt]);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        width: 'min(560px, 100%)',
        maxHeight: 'calc(100vh - 80px)',
        display: 'flex', flexDirection: 'column',
        borderRadius: 18,
        background: 'rgba(22, 22, 24, 0.88)',
        backdropFilter: 'blur(40px) saturate(1.6)', WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(29,185,84,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'flex-start', gap: 14,
        }}>
          <div style={{
            flexShrink: 0,
            width: 38, height: 38,
            borderRadius: 10,
            background: 'rgba(29,185,84,0.16)',
            border: '1px solid rgba(29,185,84,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>
            <span aria-hidden style={{ color: '#1db954' }}>✨</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase',
              color: '#1db954', fontWeight: 700,
            }}>
              What's new
            </div>
            <div style={{
              fontSize: 18, fontWeight: 600, color: '#fff',
              marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {name}
            </div>
            {dateLine ? (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                Released {dateLine}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              width: 28, height: 28,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 22px 18px',
          fontSize: 12.5,
          lineHeight: 1.65,
          color: 'rgba(255,255,255,0.82)',
        }}>
          <MarkdownLite text={body} />
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block', marginTop: 14,
                fontSize: 11, color: 'rgba(255,255,255,0.45)',
                borderBottom: '1px solid rgba(255,255,255,0.15)',
                textDecoration: 'none',
              }}
            >
              View on GitHub →
            </a>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 22px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              borderRadius: 10,
              border: '1px solid rgba(29,185,84,0.4)',
              background: 'rgba(29,185,84,0.22)',
              color: '#1db954',
              fontSize: 12, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * MarkdownLite — minimal renderer for GitHub release-notes markdown.
 * Handles only the subset that's actually common in release notes:
 *
 *   - # / ## / ### headings
 *   - **bold** and *italic*
 *   - `inline code`
 *   - ```fenced code blocks```
 *   - [link text](url)
 *   - - / * bullet lists (single level)
 *   - 1. 2. 3. numbered lists (single level)
 *   - Blank lines as paragraph separators
 *
 * Anything else falls through as plain text. We don't use
 * dangerouslySetInnerHTML — every match is rendered as React elements,
 * which keeps untrusted release-notes content sandboxed (GitHub itself
 * sanitizes markdown but we don't want to depend on that).
 *
 * Why not pull in a real markdown lib? Three reasons:
 *   - Bundle size: react-markdown + remark-gfm pulls in ~80 KB of
 *     code we don't otherwise use.
 *   - Style isolation: real libs need extra CSS to match a dark theme.
 *   - Scope: release notes are short and structurally simple; we don't
 *     need tables, footnotes, task lists, etc.
 *
 * The implementation is line-based: split on \n, classify each line by
 * its prefix, render. Inline transforms (bold, links, code) are applied
 * per-line. Code fences span multiple lines so we maintain a small
 * state machine for "inside fence" vs "normal".
 */
function MarkdownLite({ text }) {
  const blocks = useMemo(() => parseMarkdownLite(text || ''), [text]);
  return (
    <div>
      {blocks.map((b, i) => renderMdBlock(b, i))}
    </div>
  );
}

function parseMarkdownLite(src) {
  const lines = src.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    // Headings
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2] });
      i++;
      continue;
    }

    // Bulleted list — consume consecutive bullet lines into one block
    if (/^[\-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Blank line — separator
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — consume consecutive non-blank, non-special lines
    const para = [line];
    i++;
    while (i < lines.length
      && lines[i].trim() !== ''
      && !/^(#{1,3})\s+/.test(lines[i])
      && !/^[\-*]\s+/.test(lines[i])
      && !/^\d+\.\s+/.test(lines[i])
      && !/^```/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}

function renderMdBlock(b, key) {
  if (b.type === 'heading') {
    const sizes = { 1: 17, 2: 14.5, 3: 13 };
    const weights = { 1: 700, 2: 700, 3: 600 };
    return (
      <div
        key={key}
        style={{
          fontSize: sizes[b.level] || 13,
          fontWeight: weights[b.level] || 600,
          color: '#fff',
          marginTop: key === 0 ? 0 : 14,
          marginBottom: 6,
        }}
      >
        {renderInline(b.text)}
      </div>
    );
  }
  if (b.type === 'ul') {
    return (
      <ul key={key} style={{ margin: '4px 0 8px 0', paddingLeft: 22 }}>
        {b.items.map((it, j) => (
          <li key={j} style={{ marginBottom: 2 }}>{renderInline(it)}</li>
        ))}
      </ul>
    );
  }
  if (b.type === 'ol') {
    return (
      <ol key={key} style={{ margin: '4px 0 8px 0', paddingLeft: 22 }}>
        {b.items.map((it, j) => (
          <li key={j} style={{ marginBottom: 2 }}>{renderInline(it)}</li>
        ))}
      </ol>
    );
  }
  if (b.type === 'code') {
    return (
      <pre
        key={key}
        style={{
          margin: '6px 0 10px',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: 11.5,
          lineHeight: 1.5,
          color: 'rgba(255,255,255,0.85)',
          fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
          overflowX: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {b.text}
      </pre>
    );
  }
  // paragraph
  return (
    <div key={key} style={{ marginBottom: 8 }}>
      {renderInline(b.text)}
    </div>
  );
}

/**
 * renderInline — apply inline markdown formatting (links, bold, italic,
 * code) to a single string and return a list of React nodes. Goes
 * link → code → bold → italic in that priority order so combos like
 * `**bold with `code` inside**` work reasonably.
 *
 * Returns an array of strings + spans / anchor elements. Caller embeds
 * the array directly as children.
 */
function renderInline(text) {
  if (!text) return null;
  // Tokenize: walk the string finding the next match for any of our
  // patterns. We always consume the EARLIEST match at each step.
  const patterns = [
    { re: /\[([^\]]+)\]\(([^)]+)\)/, kind: 'link' },     // [text](url)
    { re: /`([^`]+)`/, kind: 'code' },                   // `code`
    { re: /\*\*([^*]+)\*\*/, kind: 'bold' },             // **bold**
    { re: /\*([^*]+)\*/, kind: 'italic' },               // *italic*
    { re: /_([^_]+)_/, kind: 'italic' },                 // _italic_
  ];
  const out = [];
  let remaining = text;
  let nodeKey = 0;
  while (remaining.length > 0) {
    let earliest = null;
    for (const pat of patterns) {
      const m = pat.re.exec(remaining);
      if (m && (earliest === null || m.index < earliest.match.index)) {
        earliest = { match: m, kind: pat.kind };
      }
    }
    if (!earliest) {
      out.push(remaining);
      break;
    }
    if (earliest.match.index > 0) {
      out.push(remaining.slice(0, earliest.match.index));
    }
    const m = earliest.match;
    if (earliest.kind === 'link') {
      out.push(
        <a key={`mdn${nodeKey++}`} href={m[2]} target="_blank" rel="noreferrer"
          style={{ color: '#1db954', textDecoration: 'none', borderBottom: '1px solid rgba(29,185,84,0.4)' }}>
          {m[1]}
        </a>,
      );
    } else if (earliest.kind === 'code') {
      out.push(
        <code key={`mdn${nodeKey++}`}
          style={{
            padding: '1px 6px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.07)',
            fontSize: '0.92em',
            fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
            color: 'rgba(255,255,255,0.92)',
          }}>
          {m[1]}
        </code>,
      );
    } else if (earliest.kind === 'bold') {
      out.push(<strong key={`mdn${nodeKey++}`} style={{ color: 'rgba(255,255,255,0.95)' }}>{m[1]}</strong>);
    } else if (earliest.kind === 'italic') {
      out.push(<em key={`mdn${nodeKey++}`}>{m[1]}</em>);
    }
    remaining = remaining.slice(m.index + m[0].length);
  }
  return out;
}

/**
 * Tutorial — first-run walkthrough of the dock. Shows a spotlight on
 * each dock button in turn, with a tooltip card explaining what the
 * button does and how to use it.
 *
 * Steps are declared up front; each step has:
 *   - target: a CSS selector that resolves to the element to spotlight
 *             (we use data-tutorial-target="..." attributes on dock
 *             icons to avoid relying on DOM structure)
 *   - title: short header
 *   - body: description text or React nodes
 *
 * If a target can't be found (e.g. the user hid that tab), the step
 * gracefully degrades to a centered card with no spotlight. The "Next"
 * button still works — we don't strand the user on an unreachable step.
 *
 * Tooltip placement: we compute the spotlight rect and place the tooltip
 * on whichever side has the most viewport room. Constrains to viewport
 * with a small margin so the tooltip never clips off-screen.
 */
function Tutorial({ onClose }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const overlayRef = useRef(null);

  // Step content. Order is intentional — we walk the dock left-to-right
  // (or top-to-bottom depending on dock orientation, but the order is
  // the same either way): primary tabs first (Find/Library/New/Settings),
  // then secondary (Stats/Journal), then context tabs (Track/Queue).
  const steps = useMemo(() => [
    {
      target: null, // welcome card, no spotlight
      title: 'Welcome to Immerse',
      body: (
        <>
          Quick tour of the dock — the panel on the side (or bottom) of
          the window. Each button opens a different view of your library
          and tools. Use{' '}
          <kbd style={kbdStyle}>Next</kbd> to step through, or{' '}
          <kbd style={kbdStyle}>Skip</kbd> to dismiss. You can reopen
          this tutorial anytime from Settings.
        </>
      ),
    },
    {
      target: '[data-tutorial-target="dock-find"]',
      title: 'Find',
      body: (
        <>
          Search Spotify for tracks and albums, or find files on Soulseek.
          You can also import your own Spotify playlists here — handy
          when you're rebuilding your library from a service.
        </>
      ),
    },
    {
      target: '[data-tutorial-target="dock-library"]',
      title: 'Library',
      body: (
        <>
          Everything you own, in one place. Browse by track, album, or
          artist. Click any row to play; right-click for more options
          like editing metadata, adding to playlists, or removing.
        </>
      ),
    },
    {
      target: '[data-tutorial-target="dock-new"]',
      title: 'New releases',
      body: (
        <>
          Latest releases from artists in your library. Immerse follows
          everyone in your library by default and surfaces their new
          albums + singles here so you don't miss anything.
        </>
      ),
    },
    {
      target: '[data-tutorial-target="dock-stats"]',
      title: 'Listening stats',
      body: (
        <>
          Charts and lists showing what you've been listening to most —
          top tracks, top albums, top artists, plus play counts and
          totals over different time windows.
        </>
      ),
    },
    {
      target: '[data-tutorial-target="dock-track"]',
      title: 'About this track',
      body: (
        <>
          Deep info on whatever's currently playing — full lyrics if
          available, album context, similar tracks, and a play history
          for just that song.
        </>
      ),
    },
    {
      target: '[data-tutorial-target="dock-queue"]',
      title: 'Queue',
      body: (
        <>
          What's playing next. Drag to reorder, click any track to jump
          to it, or right-click for queue management. The number badge
          shows how many tracks are queued up.
        </>
      ),
    },
    {
      target: '[data-tutorial-target="dock-settings"]',
      title: 'Settings',
      body: (
        <>
          Configure Spotify and Soulseek, manage your library, customize
          the UI, see what's new in each update, and reopen this
          tutorial. Almost every tweak lives here.
        </>
      ),
    },
    {
      target: null, // final card
      title: "You're set",
      body: (
        <>
          That's the dock. Click around, play with it — nothing here is
          destructive. If you ever want a refresher, Settings →
          <strong style={{ color: 'rgba(255,255,255,0.9)' }}> Open tutorial</strong>{' '}
          brings this walkthrough back.
        </>
      ),
    },
  ], []);

  const step = steps[stepIdx];

  // Measure the highlighted element each time the step changes and on
  // window resize. Using a small rAF dance so we don't measure
  // mid-transition.
  useLayoutEffect(() => {
    if (!step) return undefined;
    let rafId = null;
    let cleanup = null;
    const measure = () => {
      if (!step.target) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector(step.target);
      if (!el) {
        setTargetRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTargetRect({
        top: r.top, left: r.left,
        width: r.width, height: r.height,
        bottom: r.bottom, right: r.right,
      });
    };
    // First pass on next frame so the DOM is settled.
    rafId = requestAnimationFrame(measure);
    // Re-measure on resize. Resize event covers most cases; for the
    // dock being toggled (collapsed/expanded), we'd want a MutationObserver,
    // but for the tutorial use case the user shouldn't be opening/closing
    // the dock mid-tutorial so we don't bother.
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    cleanup = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
    return cleanup;
  }, [step]);

  // Escape dismisses; arrow keys step through.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (stepIdx < steps.length - 1) setStepIdx(stepIdx + 1);
        else onClose?.();
      } else if (e.key === 'ArrowLeft') {
        if (stepIdx > 0) setStepIdx(stepIdx - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepIdx, steps.length, onClose]);

  const isFirst = stepIdx === 0;
  const isLast = stepIdx === steps.length - 1;

  // Tooltip placement.
  //
  // The body text varies a lot in height step-to-step, so a fixed
  // estimate clips off-screen on smaller windows (the app launches at
  // a set width × height, not maximized, so "viewport" can be ~800×500).
  //
  // Solution: measure the tooltip card's actual size after it renders
  // (via a ref + ResizeObserver), then recompute position using that
  // real height. Until measurement completes (one frame), render the
  // card at the estimated position with visibility:hidden so it
  // doesn't flash in the wrong place.
  const cardRef = useRef(null);
  const [cardSize, setCardSize] = useState(null);

  // Reset measurement when step changes — the new step's content
  // will have a different height.
  useLayoutEffect(() => {
    setCardSize(null);
  }, [stepIdx]);

  useLayoutEffect(() => {
    if (!cardRef.current) return undefined;
    const el = cardRef.current;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // Avoid pointless re-renders if size hasn't changed (RO fires
      // extra times during opacity transitions).
      setCardSize((prev) => {
        if (prev && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1) {
          return prev;
        }
        return { width: r.width, height: r.height };
      });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [stepIdx]);

  const tooltipPos = useMemo(() => {
    if (!targetRect) {
      return { centered: true };
    }
    const TOOLTIP_W = cardSize?.width || 320;
    const TOOLTIP_H = cardSize?.height || 200;
    const GAP = 14;
    const MARGIN = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Available room on each side, after accounting for the safety
    // margin at the far viewport edge.
    const roomRight = vw - targetRect.right - GAP - MARGIN;
    const roomLeft = targetRect.left - GAP - MARGIN;
    const roomBelow = vh - targetRect.bottom - GAP - MARGIN;
    const roomAbove = targetRect.top - GAP - MARGIN;

    // Score each side: positive = tooltip fits; negative = overflow.
    // Also require the PERPENDICULAR axis to have room (a tooltip on
    // the right side still needs vertical room to roughly center, and
    // vice-versa).
    const candidates = [
      { side: 'right', score: roomRight - TOOLTIP_W, perpFits: vh >= TOOLTIP_H + MARGIN * 2 },
      { side: 'left',  score: roomLeft  - TOOLTIP_W, perpFits: vh >= TOOLTIP_H + MARGIN * 2 },
      { side: 'below', score: roomBelow - TOOLTIP_H, perpFits: vw >= TOOLTIP_W + MARGIN * 2 },
      { side: 'above', score: roomAbove - TOOLTIP_H, perpFits: vw >= TOOLTIP_W + MARGIN * 2 },
    ];
    // Prefer sides where both axes fit. Within that, biggest positive
    // score wins (most breathing room).
    candidates.sort((a, b) => {
      const aFits = a.perpFits && a.score >= 0 ? 1 : 0;
      const bFits = b.perpFits && b.score >= 0 ? 1 : 0;
      if (aFits !== bFits) return bFits - aFits;
      return b.score - a.score;
    });
    const side = candidates[0].side;

    let top, left;
    if (side === 'right') {
      left = targetRect.right + GAP;
      top = targetRect.top + targetRect.height / 2 - TOOLTIP_H / 2;
    } else if (side === 'left') {
      left = targetRect.left - TOOLTIP_W - GAP;
      top = targetRect.top + targetRect.height / 2 - TOOLTIP_H / 2;
    } else if (side === 'below') {
      left = targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2;
      top = targetRect.bottom + GAP;
    } else {
      left = targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2;
      top = targetRect.top - TOOLTIP_H - GAP;
    }

    // Final clamp using the REAL tooltip dimensions. If the tooltip is
    // somehow larger than the viewport (extremely narrow window + long
    // body text), the clamp would push it negative; in that case we
    // give up on placement and fall back to centered so at least the
    // user can read it.
    if (TOOLTIP_W > vw - MARGIN * 2 || TOOLTIP_H > vh - MARGIN * 2) {
      return { centered: true };
    }
    top = Math.max(MARGIN, Math.min(vh - TOOLTIP_H - MARGIN, top));
    left = Math.max(MARGIN, Math.min(vw - TOOLTIP_W - MARGIN, left));
    return { top, left, side, width: TOOLTIP_W };
  }, [targetRect, cardSize]);

  // Spotlight padding — how much room around the target the spotlight
  // hole extends. Makes small icons easier to identify and adds visual
  // breathing room.
  const SPOTLIGHT_PAD = 6;
  const spotlightRect = targetRect ? {
    top: targetRect.top - SPOTLIGHT_PAD,
    left: targetRect.left - SPOTLIGHT_PAD,
    width: targetRect.width + SPOTLIGHT_PAD * 2,
    height: targetRect.height + SPOTLIGHT_PAD * 2,
  } : null;

  return (
    <div
      ref={overlayRef}
      // Full-viewport overlay. zIndex above ToastStack (60) and the
      // What's New overlay (100) so the tutorial sits on top of
      // everything.
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        // pointer-events flow: the overlay catches clicks except where
        // the spotlight cutout is (we want the dock to be visible but
        // not interactive during the tour — so we keep pointer-events
        // on for the overlay and the tooltip card).
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => {
        // Click on backdrop (anywhere not on the card) advances by one
        // step, which feels more like a guided tour than "click to
        // dismiss" — dismissing is reserved for Skip / Escape.
        if (e.target === overlayRef.current) {
          if (stepIdx < steps.length - 1) setStepIdx(stepIdx + 1);
          else onClose?.();
        }
      }}
    >
      {/* SVG mask — the dark backdrop with a transparent rectangle cut
          out where the spotlight should be. Using SVG with mask-image
          would be simpler but Electron sometimes gets weird about that;
          SVG with fill-rule="evenodd" is bulletproof and renders
          identically across platforms. */}
      <svg
        width="100%" height="100%"
        viewBox={`0 0 ${typeof window !== 'undefined' ? window.innerWidth : 1280} ${typeof window !== 'undefined' ? window.innerHeight : 800}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          {/* Soft inner glow around the spotlight. Pure cosmetic. */}
          <filter id="tutorialSpotlightGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {spotlightRect ? (
          <>
            <path
              fillRule="evenodd"
              fill="rgba(0,0,0,0.72)"
              d={`M 0 0 H ${window.innerWidth} V ${window.innerHeight} H 0 Z M ${spotlightRect.left} ${spotlightRect.top} h ${spotlightRect.width} v ${spotlightRect.height} h -${spotlightRect.width} Z`}
            />
            {/* Accent ring around the spotlight */}
            <rect
              x={spotlightRect.left} y={spotlightRect.top}
              width={spotlightRect.width} height={spotlightRect.height}
              fill="none"
              stroke="rgba(29,185,84,0.55)"
              strokeWidth="2"
              rx="10" ry="10"
            />
          </>
        ) : (
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" />
        )}
      </svg>

      {/* Tooltip card */}
      <div
        ref={cardRef}
        style={{
          position: 'absolute',
          // Hide the card during the very first paint of each step,
          // before we've measured its real size. Without this, the card
          // briefly flashes at the estimated position (using fallback
          // 320×200) then jumps to its measured position once the
          // ResizeObserver fires. Setting visibility:hidden keeps it
          // measurable but invisible until cardSize is populated.
          visibility: (!tooltipPos.centered && !cardSize) ? 'hidden' : 'visible',
          ...(tooltipPos.centered ? {
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 360,
          } : {
            top: tooltipPos.top,
            left: tooltipPos.left,
            width: tooltipPos.width,
          }),
          borderRadius: 14,
          background: 'rgba(22, 22, 24, 0.94)',
          backdropFilter: 'blur(28px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.6), 0 0 0 1px rgba(29,185,84,0.15)',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 12.5,
          lineHeight: 1.55,
          overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{
            fontSize: 9.5, letterSpacing: 0.7, textTransform: 'uppercase',
            color: '#1db954', fontWeight: 700,
          }}>
            Tutorial · {stepIdx + 1} of {steps.length}
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Skip tutorial"
            style={{
              width: 22, height: 22,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.45)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.45)'; }}
          >
            ×
          </button>
        </div>

        {/* Title + body */}
        <div style={{ padding: '0 18px 12px' }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: '#fff',
            marginTop: 4, marginBottom: 6,
          }}>
            {step.title}
          </div>
          <div>{step.body}</div>
        </div>

        {/* Progress dots */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 5,
          padding: '2px 18px 10px',
        }}>
          {steps.map((_, i) => (
            <span
              key={i}
              style={{
                width: 5, height: 5, borderRadius: '50%',
                background: i === stepIdx ? '#1db954' : 'rgba(255,255,255,0.18)',
                transition: 'background 0.12s',
              }}
            />
          ))}
        </div>

        {/* Footer buttons */}
        <div style={{
          padding: '10px 16px 14px',
          display: 'flex', gap: 8, alignItems: 'center',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}>
          <button
            type="button"
            onClick={() => onClose?.()}
            style={{
              padding: '6px 12px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent',
              color: 'rgba(255,255,255,0.55)',
              fontSize: 11, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setStepIdx(stepIdx - 1)}
            disabled={isFirst}
            style={{
              padding: '6px 12px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              color: isFirst ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)',
              fontSize: 11, fontWeight: 600,
              cursor: isFirst ? 'default' : 'pointer',
              opacity: isFirst ? 0.5 : 1,
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (isLast) onClose?.();
              else setStepIdx(stepIdx + 1);
            }}
            style={{
              padding: '6px 16px', borderRadius: 8,
              border: '1px solid rgba(29,185,84,0.4)',
              background: 'rgba(29,185,84,0.22)',
              color: '#1db954',
              fontSize: 11, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

const kbdStyle = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 10,
  fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
};

/**
 * WinBtn — custom Immerse-styled window control button.
 *
 * Round 26px glass pill with a subtle hover-fill in a per-button hue.
 * Each of the three controls passes its own `hue` (gray-blue / Immerse
 * purple / coral) so they're distinguishable at a glance without any
 * one of them screaming for attention the way Windows' bright-red
 * close button does. The close button additionally gets a faint
 * always-on glow so it's the most visually weighted of the three —
 * matching the convention that "the most destructive action should be
 * the most distinct" without being aggressive.
 *
 * `hue` is passed as an "R, G, B" string so it can plug straight into
 * `rgba(...)` expressions for tinted backgrounds, borders, and shadows
 * without per-call rgba math.
 */
function WinBtn({ children, onClick, title, hue = '255, 255, 255', isClose = false }) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      title={title}
      role="button"
      aria-label={title}
      style={{
        width: 26, height: 26,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        borderRadius: '50%',
        // Base surface: thin glass that lets the cover wash through.
        // Hover: deepen the hue fill and add a soft accent glow.
        // Close button: gets a subtle resting fill so it reads as the
        // most-weighted of the three controls without being loud.
        background: h
          ? `rgba(${hue}, 0.38)`
          : isClose
            ? `rgba(${hue}, 0.14)`
            : 'rgba(255, 255, 255, 0.06)',
        border: h
          ? `1px solid rgba(${hue}, 0.6)`
          : isClose
            ? `1px solid rgba(${hue}, 0.3)`
            : '1px solid rgba(255, 255, 255, 0.1)',
        // Glass effect — matches the dock's frosted look so the controls
        // feel like part of the same material vocabulary.
        backdropFilter: 'blur(10px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
        boxShadow: h
          ? `0 2px 12px rgba(${hue}, 0.35), 0 0 0 3px rgba(${hue}, 0.1)`
          : isClose
            ? `0 1px 4px rgba(${hue}, 0.18)`
            : 'none',
        color: h ? '#fff' : 'rgba(255, 255, 255, 0.7)',
        WebkitAppRegion: 'no-drag',
        // Snappy but smooth — fast enough to feel responsive, slow
        // enough that the eye registers the colour shift.
        transition: 'background 0.16s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease, transform 0.1s ease',
        // Tiny lift on hover — subtle press-affordance.
        transform: h ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * AmbientMode — full-window cover collage that auto-engages after the
 * player has been idle for 30s.
 *
 * Returns null while `active` is false (kept mounted so internal state /
 * intervals can be lazily initialized once on first activation, not torn
 * down and rebuilt every idle cycle).
 *
 * Weighted selection picks each visible slot from three buckets so the
 * collage mixes familiar music with rediscovery and discovery:
 *   - 50% recently played (last 14 days)
 *   - 30% rediscovery (played before, but not in last 6 months)
 *   - 20% deep cuts (played < 2 times)
 * The track-level `playCount` and `lastPlayed` fields drive bucketing,
 * with album-keyed dedup so the same album doesn't show up twice on
 * screen at once.
 */
function AmbientMode({ active, library, onClose, onPlayAlbum }) {
  // Number of cover slots visible at once. 6 hits a balance — busy
  // enough to feel like a collage, sparse enough that each cover gets
  // visual breathing room. On smaller windows the layout still works
  // because each slot picks a random position within bounds.
  const SLOT_COUNT = 6;
  // How long each cover stays visible before being swapped out, in ms.
  // Slot lifetimes are staggered so the screen never feels like it's
  // refreshing all at once.
  const SLOT_LIFETIME_MS = 11_000;
  // Stagger between slot updates. Spreads the SLOT_COUNT changes evenly
  // across the lifetime so a different cover swaps every ~1.8s.
  const SLOT_CYCLE_MS = Math.round(SLOT_LIFETIME_MS / SLOT_COUNT);

  // Albums grouped by key with cover + tracks. Recomputed only when
  // library changes (could be 10k tracks; don't rebuild on every render).
  const albumsByKey = useMemo(() => {
    // Extract the "primary artist" — the first name before any feat./ft./&/x
    // /comma separators. Mirrors the grouping logic in ImmersiveLibraryPage so
    // collab tracks (e.g. "Pierce the Veil, Kellin Quinn") get keyed under the
    // same album as the rest of the album's tracks, instead of producing a
    // separate per-track tile. Without this, ambient would surface a single
    // collab song as if it were its own album.
    const primaryArtist = (str) => {
      if (!str) return 'Unknown Artist';
      const clean = str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim();
      return clean || str.trim();
    };
    const m = new Map();
    for (const t of library || []) {
      if (!t.album || !t.coverArt) continue; // need both for the collage
      const albumName = (t.album || '').trim() || 'Unknown Album';
      const primary = primaryArtist(t.artist);
      const key = `${albumName}__${primary}`;
      if (!m.has(key)) {
        // Prefer a track with a cover to seed the album entry's cover.
        // Any track on the album might have cover art; we just pick whichever
        // one we hit first.
        m.set(key, { key, album: albumName, artist: primary, coverArt: t.coverArt, tracks: [] });
      }
      m.get(key).tracks.push(t);
    }
    return m;
  }, [library]);

  // Pre-bucket album keys by play status so the weighted random in
  // pickAlbum is O(1) per call. Rebuilt with library; doesn't change
  // during a single ambient session unless tracks get played in
  // background (rare while ambient is showing — by definition we're idle).
  const buckets = useMemo(() => {
    const now = Date.now();
    const recentMs = 14 * 24 * 60 * 60 * 1000;       // 14 days
    const longTimeMs = 180 * 24 * 60 * 60 * 1000;    // ~6 months
    const recent = [];
    const rediscovery = [];
    const discovery = [];
    for (const album of albumsByKey.values()) {
      // For album-level bucketing, use the most-played track in the album
      // as the representative. Counts the album as "played recently" if
      // any track on it was, etc.
      let maxPlay = 0;
      let mostRecent = 0;
      for (const t of album.tracks) {
        if ((t.playCount || 0) > maxPlay) maxPlay = t.playCount || 0;
        if ((t.lastPlayed || 0) > mostRecent) mostRecent = t.lastPlayed || 0;
      }
      if (mostRecent && now - mostRecent < recentMs) {
        recent.push(album.key);
      } else if (mostRecent && now - mostRecent > longTimeMs) {
        rediscovery.push(album.key);
      } else if (maxPlay < 2) {
        discovery.push(album.key);
      } else {
        // Plays in 14d–6mo window — counts as "rediscovery-adjacent",
        // give it to rediscovery bucket as a fallback so it still gets
        // surfaced occasionally.
        rediscovery.push(album.key);
      }
    }
    return { recent, rediscovery, discovery };
  }, [albumsByKey]);

  // Pick a weighted-random album key, avoiding any keys currently shown
  // in other slots. Returns null if the library is empty.
  const pickAlbumKey = useCallback((avoidKeys) => {
    const tryBucket = (arr) => {
      if (!arr || arr.length === 0) return null;
      // Up to 8 attempts to find a non-dup; if everything dups, just
      // return any from the bucket — the visual repeat is preferable
      // to a blank slot.
      for (let i = 0; i < 8; i++) {
        const k = arr[Math.floor(Math.random() * arr.length)];
        if (!avoidKeys.has(k)) return k;
      }
      return arr[Math.floor(Math.random() * arr.length)];
    };
    const roll = Math.random();
    let key = null;
    if (roll < 0.5) key = tryBucket(buckets.recent);
    else if (roll < 0.8) key = tryBucket(buckets.rediscovery);
    else key = tryBucket(buckets.discovery);
    // Fallback chain: if the chosen bucket is empty, walk the others.
    if (!key) key = tryBucket(buckets.recent) || tryBucket(buckets.rediscovery) || tryBucket(buckets.discovery);
    // Last-resort: any album at all.
    if (!key && albumsByKey.size > 0) {
      const keys = Array.from(albumsByKey.keys());
      key = keys[Math.floor(Math.random() * keys.length)];
    }
    return key;
  }, [buckets, albumsByKey]);

  // Slot state: an array of { id, albumKey, x, y, scale, phase }.
  // phase is 'in' (fading in), 'visible', 'out' (fading out), 'gone'.
  // We use the slot's stable id (0..SLOT_COUNT-1) as the React key so
  // React doesn't unmount the wrapper between cycles — the wrapper has
  // its CSS transition that handles the visual fade.
  const [slots, setSlots] = useState(() => Array.from({ length: SLOT_COUNT }, (_, i) => ({
    id: i, albumKey: null, x: 50, y: 50, scale: 1, opacity: 0, generation: 0,
  })));

  // Click-confirmation popup state. Holds the album the user clicked
  // on; while non-null, a small modal asks what to do.
  const [confirmAlbum, setConfirmAlbum] = useState(null);
  // Tracks mouse activity for the auto-revealing ✕ button. Mouse moves
  // set this to a timestamp; an interval below sets it back to 0 after
  // 2.5s of stillness. The X button's opacity is derived from this.
  const [mouseActive, setMouseActive] = useState(false);
  const mouseTimerRef = useRef(null);
  const onMouseMove = useCallback(() => {
    setMouseActive(true);
    if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
    mouseTimerRef.current = setTimeout(() => setMouseActive(false), 2500);
  }, []);

  // Position generator — uses a 3x2 grid with jitter so slots don't
  // bunch up. Six slots map naturally to a 3x2 layout; jitter prevents
  // it from looking like a static grid.
  const positionForSlot = useCallback((slotId) => {
    const col = slotId % 3;          // 0, 1, 2
    const row = Math.floor(slotId / 3); // 0, 1
    const baseX = 18 + col * 32;     // 18, 50, 82
    const baseY = 28 + row * 44;     // 28, 72
    const jitterX = (Math.random() - 0.5) * 12;
    const jitterY = (Math.random() - 0.5) * 14;
    return {
      x: Math.max(8, Math.min(92, baseX + jitterX)),
      y: Math.max(12, Math.min(88, baseY + jitterY)),
      scale: 0.85 + Math.random() * 0.25, // 0.85..1.10
    };
  }, []);

  // The cycle: every SLOT_CYCLE_MS, pick the oldest slot and replace it.
  // Initial activation: stagger all slots in with a quick burst so the
  // screen fills naturally rather than appearing all at once.
  useEffect(() => {
    if (!active) return undefined;
    if (albumsByKey.size === 0) return undefined; // empty library

    // Initial fill: stagger SLOT_COUNT covers into view over ~2 seconds.
    let cancelled = false;
    const fillTimers = [];
    setSlots(Array.from({ length: SLOT_COUNT }, (_, i) => ({
      id: i, albumKey: null, x: 50, y: 50, scale: 1, opacity: 0, generation: 0,
    })));
    for (let i = 0; i < SLOT_COUNT; i++) {
      const t = setTimeout(() => {
        if (cancelled) return;
        setSlots((prev) => {
          const taken = new Set(prev.map((s) => s.albumKey).filter(Boolean));
          const key = pickAlbumKey(taken);
          if (!key) return prev;
          const pos = positionForSlot(i);
          return prev.map((s) => s.id === i
            ? { ...s, albumKey: key, ...pos, opacity: 1, generation: s.generation + 1 }
            : s
          );
        });
      }, i * 320);
      fillTimers.push(t);
    }

    // Ongoing cycle: replace one slot every SLOT_CYCLE_MS once the
    // initial fill is done. Picks slot in round-robin order so each
    // gets equal "screen time."
    let cycleSlot = 0;
    const cycleStart = setTimeout(() => {
      const iv = setInterval(() => {
        if (cancelled) return;
        const id = cycleSlot;
        cycleSlot = (cycleSlot + 1) % SLOT_COUNT;
        setSlots((prev) => {
          const taken = new Set(prev.map((s) => s.albumKey).filter(Boolean));
          const next = pickAlbumKey(taken);
          if (!next) return prev;
          const pos = positionForSlot(id);
          return prev.map((s) => s.id === id
            ? { ...s, albumKey: next, ...pos, generation: s.generation + 1 }
            : s
          );
        });
      }, SLOT_CYCLE_MS);
      fillTimers.push({ kind: 'interval', iv });
    }, SLOT_COUNT * 320 + 500);

    return () => {
      cancelled = true;
      fillTimers.forEach((t) => {
        if (t && t.kind === 'interval') clearInterval(t.iv);
        else clearTimeout(t);
      });
      clearTimeout(cycleStart);
    };
  }, [active, albumsByKey, pickAlbumKey, positionForSlot]);

  // Cleanup mouse timer on unmount.
  useEffect(() => {
    return () => { if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current); };
  }, []);

  if (!active) return null;

  // Background wash: pick the focal cover (most-recently changed slot
  // with an album) and use it as a blurred backdrop. Falls back to the
  // first available album cover or a dark gradient if nothing.
  const focal = [...slots].sort((a, b) => b.generation - a.generation).find((s) => s.albumKey);
  const focalCover = focal ? albumsByKey.get(focal.albumKey)?.coverArt : null;

  return (
    <div
      onMouseMove={onMouseMove}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 200,
        background: '#000',
        // Smooth fade-in when ambient activates. The 600ms is intentionally
        // a bit slow so it feels gentle, not abrupt.
        animation: 'ambientFadeIn 600ms ease',
        overflow: 'hidden',
        cursor: 'default',
      }}
    >
      {/* Blurred background wash from the focal cover. Heavy blur +
         lowered opacity creates the dreamlike backdrop. */}
      {focalCover ? (
        <div
          key={focalCover}
          style={{
            position: 'absolute', inset: -40,
            backgroundImage: `url(${focalCover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(60px) saturate(1.4)',
            opacity: 0.45,
            // Cross-fade when focal changes by re-running this animation.
            animation: 'ambientWashFade 1500ms ease',
          }}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #000 70%)',
        }} />
      )}

      {/* Dim overlay so foreground covers pop against the wash. */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.35)',
        pointerEvents: 'none',
      }} />

      {/* Cover slots */}
      {slots.map((slot) => {
        const album = slot.albumKey ? albumsByKey.get(slot.albumKey) : null;
        if (!album) return null;
        return (
          <div
            key={slot.id}
            // Inner key on the image swaps to re-trigger fade animations
            // when the slot's album changes.
            onClick={() => setConfirmAlbum(album)}
            style={{
              position: 'absolute',
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              width: 'min(260px, 22vw)',
              aspectRatio: '1',
              transform: `translate(-50%, -50%) scale(${slot.scale})`,
              opacity: slot.opacity,
              cursor: 'pointer',
              // Smooth cross-fade as covers change in their slot.
              transition: 'opacity 1200ms ease, transform 1200ms ease',
              willChange: 'opacity, transform',
            }}
          >
            <img
              key={`${slot.albumKey}-${slot.generation}`}
              src={album.coverArt}
              alt=""
              decoding="async"
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                borderRadius: 8,
                boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
                animation: 'ambientCoverFade 1500ms ease',
                display: 'block',
              }}
            />
          </div>
        );
      })}

      {/* Hint text near the bottom — fades to nothing after a few
         seconds so it doesn't distract once the user has seen it. */}
      <div style={{
        position: 'absolute',
        bottom: 48, left: 0, right: 0,
        textAlign: 'center',
        color: 'rgba(255,255,255,0.5)',
        fontSize: 13, letterSpacing: 0.5,
        pointerEvents: 'none',
        animation: 'ambientHintFade 4s ease forwards',
      }}>
        Click any cover to play
      </div>

      {/* Close button — only visible when mouse has moved recently. */}
      <button
        type="button"
        onClick={onClose}
        title="Exit ambient mode"
        style={{
          position: 'absolute',
          top: 16, right: 16,
          width: 36, height: 36,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: mouseActive ? 1 : 0,
          transition: 'opacity 300ms ease, background 0.15s',
          WebkitAppRegion: 'no-drag',
          zIndex: 210,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(232,17,35,0.85)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 12 12">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* Click-confirmation popup */}
      {confirmAlbum && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmAlbum(null); }}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 215,
            animation: 'ambientFadeIn 200ms ease',
          }}
        >
          <div style={{
            background: 'rgba(20,20,30,0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: '24px 28px',
            minWidth: 320,
            maxWidth: 'min(420px, 90vw)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
          }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <img src={confirmAlbum.coverArt} alt=""
                style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 15, fontWeight: 700, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {confirmAlbum.album}
                </div>
                <div style={{
                  fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {confirmAlbum.artist}
                  <span style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {' · '}{confirmAlbum.tracks.length} {confirmAlbum.tracks.length === 1 ? 'track' : 'tracks'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => {
                  const tracks = confirmAlbum.tracks;
                  setConfirmAlbum(null);
                  onPlayAlbum(tracks);
                }}
                style={ambientBtnStyle(true)}
              >
                Play this album
              </button>
              <button
                type="button"
                onClick={() => setConfirmAlbum(null)}
                style={ambientBtnStyle(false)}
              >
                Keep browsing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyframes for the various fades. Scoped via unique names so they
         won't collide with anything else in the app. */}
      <style>{`
        @keyframes ambientFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes ambientWashFade {
          from { opacity: 0; }
          to   { opacity: 0.45; }
        }
        @keyframes ambientCoverFade {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes ambientHintFade {
          0%   { opacity: 0; }
          15%  { opacity: 1; }
          75%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function ambientBtnStyle(primary) {
  return {
    width: '100%', padding: '10px 16px',
    borderRadius: 8, border: 'none',
    background: primary ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.06)',
    color: primary ? '#000' : 'rgba(255,255,255,0.85)',
    fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  };
}
