import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useContext, useCallback } from 'react';
import Icons from './Icons.jsx';
import { presetsGrouped, presetById, getCustomFonts, setCustomFonts, loadGoogleFontForPreset } from './uiFonts.js';
import { Tooltip, HeartSlider, ExplicitBadge } from './sharedUI.jsx';
import { useToast } from './Toasts.jsx';

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
            transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
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


function SettingsTab({
  accent = '120, 90, 220',
  uiFontId,
  onSetUiFontId,
  uiFontStack,
  onSpotifyCredsSaved,
  onOpenTutorial,
  onOpenUpdateHistory,
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
  previewVolumePosition = 'bottomRight',
  onSetPreviewVolumePosition,
  nowPlayingSliderStyle = 'circle',
  fullscreenLyricsMode = 'side',
  onSetFullscreenLyricsMode,
  onSetNowPlayingSliderStyle,
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
  recentlyPlayedEnabled = true,
  onSetRecentlyPlayedEnabled,
  onShowOnboarding,
  firstTimeSparkleEnabled = false,
  onSetFirstTimeSparkleEnabled,
  trackOfMomentEnabled = false,
  onSetTrackOfMomentEnabled,
  statsRangeTabsEnabled = true,
  onSetStatsRangeTabsEnabled,
  clickToFilterEnabled = false,
  onSetClickToFilterEnabled,
  librarySwitcherStyle = 'chip',
  onSetLibrarySwitcherStyle,
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
  // Settings are grouped into categories so new users aren't hit with every
  // option at once. The category nav switches which group shows; an active
  // search overrides categories and shows all matches across groups.
  const [settingsCategory, setSettingsCategory] = useState(null);

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

  // Allow music videos as a last resort when importing. Off by default; read
  // by the YouTube import path so it can fall back to an exact-duration music
  // video instead of failing over to the picker. Stored as '1' or absent.
  const [allowMusicVideo, setAllowMusicVideo] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('immerse:allowMusicVideo') === '1';
  });
  const updateAllowMusicVideo = (v) => {
    setAllowMusicVideo(v);
    if (typeof window !== 'undefined') {
      if (v) localStorage.setItem('immerse:allowMusicVideo', '1');
      else localStorage.removeItem('immerse:allowMusicVideo');
    }
  };

  // Opt-in toast announcing each new track. Read live by App's track-change
  // effect, so flipping this takes effect immediately. Stored as '1' or absent.
  const [nowPlayingToast, setNowPlayingToast] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('immerse:nowPlayingToast') === '1';
  });
  const updateNowPlayingToast = (v) => {
    setNowPlayingToast(v);
    if (typeof window !== 'undefined') {
      if (v) localStorage.setItem('immerse:nowPlayingToast', '1');
      else localStorage.removeItem('immerse:nowPlayingToast');
    }
  };

  const updatePreviewVolumePosition = (v) => {
    onSetPreviewVolumePosition?.(v);
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
    <SettingsCategoryContext.Provider value={settingsSearchQuery.trim() ? '' : (settingsCategory || '__menu__')}>
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

      {/* Master list / drill-in nav. Hidden while searching (search spans all
          categories and renders every matching Section flat). */}
      {!settingsSearchQuery.trim() ? (
        settingsCategory ? (
          <button type="button" onClick={() => setSettingsCategory(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
              padding: '7px 12px 7px 9px', borderRadius: 9, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.8)', fontSize: 12.5, fontWeight: 600,
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            {{ general: 'General', playback: 'Playback', interface: 'Interface', connections: 'Connections', library: 'Library' }[settingsCategory]}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
            {[
              { id: 'general', label: 'General', sub: 'Appearance, Fonts, Layout, Inputs', icon: <Icons.Settings /> },
              { id: 'playback', label: 'Playback', sub: 'Audio, Downloads, Lyrics, Stats', icon: (<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>) },
              { id: 'interface', label: 'Interface', sub: 'Dock, Panels, Library & Track View', icon: (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>) },
              { id: 'connections', label: 'Connections', sub: 'Discord, Overlay, Spotify, Soulseek', icon: (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>) },
              { id: 'library', label: 'Library', sub: 'Maintenance, Reset', icon: <Icons.LibrarySidebar /> },
            ].map((c) => (
              <button key={c.id} type="button" onClick={() => setSettingsCategory(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                  padding: '11px 12px', borderRadius: 12, cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)',
                  transition: 'background .14s, border-color .14s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.1)`; e.currentTarget.style.borderColor = `rgba(${accent},0.35)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `linear-gradient(135deg, rgba(${accent},0.9), rgba(${accent},0.4))`,
                  color: '#fff', boxShadow: `0 5px 14px rgba(${accent},0.3)`,
                }}>{c.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#fff' }}>{c.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6" /></svg>
              </button>
            ))}
          </div>
        )
      ) : null}

      {/* Appearance */}
      <Section title="Interface Font" category="general">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5, marginBottom: 8 }}>
          The typeface used across the app’s interface. A handful of rounded and
          Y2K-style faces, loaded from the web the first time you pick one. Add
          your own under Custom Fonts below.
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
      <Section title="Layout" category="general">
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
      <Section title="Inputs" category="general">
        <ToggleRow
          label="Right-Click Menus"
          description="Right-click a track for quick actions — play, queue, add to a playlist, edit, remove. Off means right-click does nothing."
          checked={contextMenusEnabled}
          onChange={(v) => onSetContextMenusEnabled?.(v)}
        />
      </Section>

      {/* Playback / Now playing visuals */}
      <Section title="Now Playing" category="playback">
        <ToggleRow
          label="Animate Colour Field"
          description="Lets the colour blobs behind the now-playing track drift around lazily."
          checked={animateGradient}
          onChange={(v) => onSetAnimateGradient?.(v)}
        />
        <ToggleRow
          label="Beat-Reactive Colour Field"
          description="Those colour blobs pulse along to the bass. Needs Animate Colour Field switched on."
          checked={beatReactive}
          onChange={(v) => onSetBeatReactive?.(v)}
        />
        <ToggleRow
          label="Fullscreen Cover on Click"
          description="Tap the cover (or hit F) to blow it up edge-to-edge. Esc backs out."
          checked={coverFullscreenEnabled}
          onChange={(v) => onSetCoverFullscreenEnabled?.(v)}
        />
        <ToggleRow
          label="Edge-Bleed Colour Band"
          description="A soft band of the track’s colour along the bottom, like the cover’s leaking light into the room."
          checked={edgeBleedEnabled}
          onChange={(v) => onSetEdgeBleedEnabled?.(v)}
        />
        <SegmentedSettingRow
          label="Fullscreen Lyrics"
          options={[
            { value: 'side', label: 'Beside cover' },
            { value: 'flip', label: 'Flip cover' },
          ]}
          value={fullscreenLyricsMode}
          onChange={(v) => onSetFullscreenLyricsMode?.(v)}
          descriptions={{
            side: 'In fullscreen (F), lyrics float beside the cover at its height, scrolling with the song.',
            flip: 'In fullscreen (F), the art stays untouched — press L or click the cover to flip it over to a lyrics card.',
          }}
        />
        <SegmentedSettingRow
          label="Slider Thumb Style"
          options={[
            { value: 'circle', label: 'Circle' },
            { value: 'heart', label: 'Heart' },
          ]}
          value={nowPlayingSliderStyle}
          onChange={(v) => onSetNowPlayingSliderStyle?.(v)}
          descriptions={{
            circle: 'The seek and volume sliders use a simple circle thumb.',
            heart: 'The seek and volume sliders use the signature heart thumb.',
          }}
        />
        <AmbientSettingRow
          mode={ambientMode}
          onSetMode={onSetAmbientMode}
          customDelaySec={ambientCustomDelaySec}
          onSetCustomDelaySec={onSetAmbientCustomDelaySec}
        />
        <TransitionSettingRow
          mode={transitionMode}
          onSetMode={onSetTransitionMode}
          crossfadeSec={crossfadeSec}
          onSetCrossfadeSec={onSetCrossfadeSec}
        />
      </Section>

      {/* Downloads */}
      <Section title="Downloads" category="playback">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          How tracks are sourced when you import from the Find tab.
        </div>
        <ToggleRow
          label="Always Show Video Picker"
          description="Hand-pick the source for every download instead of letting the app choose. For the control freaks (affectionate)."
          checked={alwaysShowPicker}
          onChange={updateAlwaysShowPicker}
        />
        <ToggleRow
          label="Allow Music Videos as a Last Resort"
          description="When nothing cleaner turns up, fall back to a music video that’s an exact length match — same studio audio, just from the video. Off by default."
          checked={allowMusicVideo}
          onChange={updateAllowMusicVideo}
        />
      </Section>

      {/* New Releases */}
      <Section title="New Releases" category="playback">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          Previewing 30-second clips of releases from artists you follow.
        </div>
        <SegmentedSettingRow
          label="Preview Volume Position"
          options={[
            { value: 'bottomRight', label: 'Bottom right' },
            { value: 'underButtons', label: 'Under buttons' },
          ]}
          value={previewVolumePosition}
          onChange={updatePreviewVolumePosition}
          descriptions={{
            bottomRight: 'A floating volume pill sits in the bottom-right corner while a preview plays.',
            underButtons: 'A small volume bar appears inline, under the preview and download buttons.',
          }}
        />
      </Section>

      {/* Lyrics */}
      <Section title="Lyrics" category="playback">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          Where to fetch lyrics from. LRClib has the best synced-lyrics
          coverage; Genius adds plain-only lyrics for older or obscure songs
          LRClib doesn't have.
        </div>
        <LyricsProviderPicker value={lyricsProvider} onChange={updateLyricsProvider} />
      </Section>

      {/* LIBRARY VIEW — how the library list looks and behaves. Filed under
          Interface (the Library tab is maintenance/reset only). */}
      <Section title="Library View" category="interface">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          How your library list looks and behaves, and the suggestions shown on
          the welcome screen.
        </div>
        <ToggleRow
          label="Two-Pane Library"
          description="Splits Songs into artists on the left, their tracks on the right. Click an artist to filter, “All artists” to reset."
          checked={twoPaneEnabled}
          onChange={(v) => onSetTwoPaneEnabled?.(v)}
        />
        <ToggleRow
          label="Click Artist / Album to Filter"
          description="Makes artist and album names clickable — tap one to filter your library down to it."
          checked={clickToFilterEnabled}
          onChange={(v) => onSetClickToFilterEnabled?.(v)}
        />
        <ToggleRow
          label="Library View: Tab Bar"
          description="Swaps the Songs / Albums / Playlists dropdown for always-visible text tabs. Team tabs vs. team chip — your call."
          checked={librarySwitcherStyle === 'tabs'}
          onChange={(v) => onSetLibrarySwitcherStyle?.(v ? 'tabs' : 'chip')}
        />
        <ToggleRow
          label="First-Time-Hearing Sparkle"
          description="A little pulsing dot marks tracks you’ve never played. It vanishes the first time you really listen."
          checked={firstTimeSparkleEnabled}
          onChange={(v) => onSetFirstTimeSparkleEnabled?.(v)}
        />
        <ToggleRow
          label="Track of the Moment"
          description="The welcome screen picks one track for right now — based on the time, the day, and what you’ve been playing. Refreshes every few hours."
          checked={trackOfMomentEnabled}
          onChange={(v) => onSetTrackOfMomentEnabled?.(v)}
        />
        <ToggleRow
          label="Now-Playing Toast"
          description="Pops a small notification with the track name and artist each time a new song starts playing."
          checked={nowPlayingToast}
          onChange={updateNowPlayingToast}
        />
      </Section>

      {/* STATS — settings that only affect the Stats panel. Currently
          just one, but kept as its own section so it's easy to find. */}
      <Section title="Stats" category="playback">
        <ToggleRow
          label="Day / Week / Month Tabs"
          description="Adds Day / Week / Month range tabs to Stats; off keeps it all-time only. (Day resets at midnight, Week on Monday, Month on the 1st.)"
          checked={statsRangeTabsEnabled}
          onChange={(v) => onSetStatsRangeTabsEnabled?.(v)}
        />
      </Section>

      {/* DOCK & PANEL — chrome around the player: the bottom dock, the
          side panel, the visibility / movement of those controls. */}
      <Section title="Dock & Panel" category="interface">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          The chrome around the player — the bottom dock and the side panel, plus
          what lives in them and how they move.
        </div>
        <ToggleRow
          label="Pinnable Tabs"
          description="Right-click a dock tab to tuck it away — Library and Settings always stay. Bring hidden ones back from the list below."
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
          label="Collapse-to-Edge Animation"
          description="When the side panel closes, it scales down into the dock pill instead of sliding off — like it’s heading home."
          checked={dockCollapseAnimationEnabled}
          onChange={(v) => onSetDockCollapseAnimationEnabled?.(v)}
        />
        <ToggleRow
          label="Random Play Button"
          description="Drops a dice button in the dock that plays something totally random. The cure for “what do I even want to hear.”"
          checked={randomButtonEnabled}
          onChange={(v) => onSetRandomButtonEnabled?.(v)}
        />
        <ToggleRow
          label="Breathing Dock Pill"
          description="The dock gently glows in time with the music’s colour. Best seen with the panel collapsed."
          checked={breathingDockPillEnabled}
          onChange={(v) => onSetBreathingDockPillEnabled?.(v)}
        />
        <ToggleRow
          label="Transparent Dock"
          description="Ditches the dock’s dark backdrop so the cover-art glow shines right through."
          checked={dockTransparentEnabled}
          onChange={(v) => onSetDockTransparentEnabled?.(v)}
        />
        <ToggleRow
          label="Liquid Glass Dock"
          description="Turns the dock into fancy frosted glass — blur, a top highlight, an accent glow, and a slow shimmer drifting across."
          checked={liquidGlassDockEnabled}
          onChange={(v) => onSetLiquidGlassDockEnabled?.(v)}
        />
        <ToggleRow
          label="Queue Painter View"
          description="Adds a painter mode to the Queue: a colourful strip sized by track length, so you can eyeball how long till the next song."
          checked={queuePainterEnabled}
          onChange={(v) => onSetQueuePainterEnabled?.(v)}
        />
        <ToggleRow
          label="Recently Played"
          description="A row of your latest album covers up top in Library. Click one to spin it again."
          checked={recentlyPlayedEnabled}
          onChange={(v) => onSetRecentlyPlayedEnabled?.(v)}
        />
        <ToggleRow
          label="Resizable Side Panel"
          description="Adds a drag handle to the panel’s edge — make it as wide or narrow as you like. It remembers."
          checked={panelResizableEnabled}
          onChange={(v) => onSetPanelResizableEnabled?.(v)}
        />
        <ToggleRow
          label="Draggable Dock"
          description="Grab the dock by its body and park it anywhere. It stays put; turn off to snap it back to the bottom."
          checked={dockDraggableEnabled}
          onChange={(v) => onSetDockDraggableEnabled?.(v)}
        />
      </Section>

      {/* TRACK PANEL — features that add data to the Track tab. Each one
          fetches from a different external service, so it's worth grouping
          them together: the user can decide as a unit how chatty they
          want the Track panel to be with the outside internet. */}
      <Section title="Track Panel" category="interface">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, marginBottom: 10 }}>
          Extra detail in the Track tab, each pulled from a different external
          service. Turn on only the ones you want reaching out to the internet.
        </div>
        <ToggleRow
          label="Online Artist Info (Last.fm)"
          description="Pulls artist bios, tags, and listener counts into the Track tab. Needs a free Last.fm API key; they log requests by IP, and results cache for a day."
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
          label="Track Credits (MusicBrainz)"
          description="Shows writers, producers, engineers, and performers in the Track tab, courtesy of MusicBrainz. No key needed; cached for a week."
          checked={creditsEnabled}
          onChange={(v) => onSetCreditsEnabled?.(v)}
        />
        <ToggleRow
          label="Track Videos (YouTube)"
          description="Adds a button in the Track tab that opens a YouTube search for the song in your browser. Nothing loads here until you click it."
          checked={videosEnabled}
          onChange={(v) => onSetVideosEnabled?.(v)}
        />
      </Section>

      {/* DISCORD — its own section because the app ID field doesn't make
          sense bundled with anything else, and because Discord-specific
          troubleshooting tends to be the most-searched-for setting. */}
      <Section title="Discord" category="connections">
        <ToggleRow
          label="Rich Presence"
          description="Shows what you’re playing on your Discord profile. Needs Discord open and your own App ID — only title, artist, album, and time are sent, nothing sneaky."
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

      {/* STREAM OVERLAY — OBS browser source showing now-playing on stream. */}
      <Section title="Stream Overlay" category="connections">
        <StreamOverlaySection accent={accent} />
      </Section>

      {/* Custom Fonts */}
      <Section title="Custom Fonts" category="general">
        <CustomFontsManager
          onChange={() => setCustomFontsVersion((v) => v + 1)}
          version={customFontsVersion}
        />
      </Section>

      {/* Spotify API */}
      <Section title="Spotify API" category="connections">
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
      <Section title="Soulseek" category="connections">
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
      <div style={{ marginTop: 24 }}>
        <UpdatesSection />
      </div>

      {/* Library maintenance — re-scan files for fresh metadata. Useful
          after improving the parser or when files have been re-tagged
          externally. */}
      <Section title="Library Maintenance" category="library">
        <RescanMetadataButton onReloadLibrary={onReloadLibrary} />
        <div style={{ height: 18 }} />
        <RepairCoversButton onReloadLibrary={onReloadLibrary} />
      </Section>

      {/* Danger zone — only exposed if the IPC is available (Electron) */}
      {typeof onClearLibrary === 'function' ? (
        <Section title="Danger Zone" category="library">
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
    </SettingsCategoryContext.Provider>
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
// Active settings category ('' = show all). When set and no search query is
// active, Sections whose `category` prop differs hide themselves.
const SettingsCategoryContext = React.createContext('');

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
function Section({ title, category, children }) {
  const query = useContext(SettingsSearchContext);
  const activeCategory = useContext(SettingsCategoryContext);
  const hasQuery = query && query.length > 0;
  // Category gating: when a category is active and the user isn't searching,
  // hide sections that don't belong to it. Sections with no category always
  // show (so anything uncategorised never disappears).
  if (!hasQuery && activeCategory && category && category !== activeCategory) {
    return null;
  }
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
      // Build a searchable haystack from the props that setting rows expose:
      // ToggleRow has label/description, SegmentedSettingRow additionally has
      // per-option descriptions and option labels. Components without those
      // props can still opt in by declaring a static `searchTerms` string
      // (see AmbientSettingRow / TransitionSettingRow below their bodies).
      const p = child.props || {};
      const parts = [];
      if (typeof p.label === 'string') parts.push(p.label);
      if (typeof p.description === 'string') parts.push(p.description);
      if (p.descriptions && typeof p.descriptions === 'object') {
        parts.push(Object.values(p.descriptions).filter((v) => typeof v === 'string').join(' '));
      }
      if (Array.isArray(p.options)) {
        parts.push(p.options.map((o) => (o && typeof o.label === 'string' ? o.label : '')).join(' '));
      }
      if (child.type && typeof child.type.searchTerms === 'string') {
        parts.push(child.type.searchTerms);
      }
      const haystack = parts.join(' ').toLowerCase();
      if (haystack && haystack.includes(query)) {
        filtered.push(child);
      }
      // Children with no searchable text (FontPicker, plain divs, headings,
      // etc.) are skipped during search. They'll come back automatically if
      // the user matches the section title or clears the query.
    });
    childrenToRender = filtered;
    hasVisibleChildren = filtered.length > 0;
  }

  if (!hasVisibleChildren) return null;

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11.5, fontWeight: 700, letterSpacing: '0.01em',
        color: 'rgba(255,255,255,0.92)', marginBottom: 10,
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
        if (typeof api.appGetVersion === 'function') {
          const v = await api.appGetVersion();
          if (!cancelled && v) setVersion(String(v));
        }
      } catch { /* ignore */ }
      try {
        if (typeof api.updateGetStatus === 'function') {
          const s = await api.updateGetStatus();
          if (!cancelled && s && typeof s === 'object') setStatus(s);
        }
      } catch { /* ignore */ }
    })();
    let unsub = null;
    try {
      if (typeof api.onUpdateStatus === 'function') {
        const maybeUnsub = api.onUpdateStatus((s) => { if (s && typeof s === 'object') setStatus(s); });
        if (typeof maybeUnsub === 'function') unsub = maybeUnsub;
      }
    } catch { /* ignore */ }
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
    <Section title="Updates" category="__menu__">
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

/**
 * RepairCoversButton — sends library:repairCovers, which walks every track
 * and trims the baked-in black bars off letterboxed cover art (the YouTube
 * thumbnails yt-dlp embeds when Spotify had no album art), squaring them so
 * they fill the now-playing / fullscreen frames with no black edges. Clean
 * square covers are left alone. Mirrors the rescan button's progress UX.
 */
function RepairCoversButton({ onReloadLibrary }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { scanned, total, fixed, failed }
  const [result, setResult] = useState(null);

  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const available = !!(api && typeof api.repairCovers === 'function');

  const handleClick = async () => {
    if (!available || busy) return;
    setBusy(true);
    setResult(null);
    setProgress({ scanned: 0, total: 0, fixed: 0, failed: 0 });

    let unsub = null;
    if (typeof api.onRepairCoversProgress === 'function') {
      unsub = api.onRepairCoversProgress((p) => { if (p) setProgress(p); });
    }

    let r;
    try { r = await api.repairCovers(); }
    catch (e) { r = { ok: false, error: String(e?.message || e) }; }

    if (typeof unsub === 'function') unsub();

    setBusy(false);
    setResult(r);

    if (r?.ok && r.fixed > 0 && typeof onReloadLibrary === 'function') {
      try { await onReloadLibrary(); } catch { /* ignore */ }
    }
  };

  if (!available) {
    return (
      <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
        Cover repair only works in the desktop app.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 10.5, color: 'rgba(255,255,255,0.55)',
        lineHeight: 1.55, marginBottom: 10,
      }}>
        Fix cover art that shows black edges in the now-playing and fullscreen
        views. Trims the letterbox bars baked into thumbnail artwork and squares
        it up. Covers that already look right are left untouched.
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
        {busy ? 'Repairing covers…' : 'Repair cover art'}
      </button>

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
            <span>{progress.fixed} fixed{progress.failed > 0 ? ` · ${progress.failed} failed` : ''}</span>
          </div>
        </div>
      ) : null}

      {!busy && result ? (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 7,
          background: result.ok ? 'rgba(80,180,120,0.08)' : 'rgba(243,114,114,0.08)',
          border: `1px solid ${result.ok ? 'rgba(80,180,120,0.2)' : 'rgba(243,114,114,0.25)'}`,
          fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5,
        }}>
          {result.ok ? (
            result.fixed > 0 ? (
              <>
                Fixed <strong>{result.fixed}</strong> cover{result.fixed === 1 ? '' : 's'}
                {result.failed > 0 ? <> · <span style={{ color: 'rgba(243,114,114,0.85)' }}>{result.failed} failed</span></> : null}
                .
              </>
            ) : (
              <>No covers needed fixing — everything looks square.</>
            )
          ) : (
            <>Cover repair failed: {result.error || 'unknown error'}</>
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

/**
 * Stream overlay settings — toggles the local OBS-overlay server on/off and
 * shows the browser-source URL with a copy button. Self-contained: talks to
 * the main process directly via electronAPI, no prop-drilling needed.
 */
function StreamOverlaySection({ accent = '120, 90, 220' }) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const pushToast = useToast();
  const [enabled, setEnabled] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem('immerse:streamOverlay') === '1'; } catch { return false; }
  });
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [theme, setThemeState] = useState(() => {
    try {
      const t = typeof window !== 'undefined' ? window.localStorage.getItem('immerse:overlayTheme') : null;
      return ['glass', 'led', 'island'].includes(t) ? t : 'glass';
    } catch { return 'glass'; }
  });

  // Push the saved theme to the overlay once on mount so the running widget
  // reflects the user's choice even after a restart.
  useEffect(() => {
    if (api?.twitchSetOptions) api.twitchSetOptions({ theme }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (t) => {
    setThemeState(t);
    try { window.localStorage.setItem('immerse:overlayTheme', t); } catch { /* ignore */ }
    if (api?.twitchSetOptions) api.twitchSetOptions({ theme: t }).catch(() => {});
  };

  const persist = (v) => {
    try {
      if (v) window.localStorage.setItem('immerse:streamOverlay', '1');
      else window.localStorage.removeItem('immerse:streamOverlay');
    } catch { /* ignore */ }
  };

  // On mount: reflect a running server, and if the overlay was left enabled
  // last session, make sure it's started again (so it survives a restart).
  useEffect(() => {
    if (!api?.twitchOverlayStatus) return undefined;
    let cancelled = false;
    api.twitchOverlayStatus().then(async (r) => {
      if (cancelled) return;
      if (r?.running) { setEnabled(true); setUrl(r.url || ''); return; }
      if (enabled && api.twitchOverlayStart) {
        const s = await api.twitchOverlayStart().catch(() => null);
        if (cancelled) return;
        if (s?.ok) setUrl(s.url || '');
        else if (s) { setError(s.error || ''); }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (v) => {
    setError('');
    setEnabled(v);
    persist(v);
    if (!api) { setError('Overlay needs the desktop app.'); return; }
    try {
      if (v) {
        const r = await api.twitchOverlayStart?.();
        if (r?.ok) setUrl(r.url || '');
        else { setError(r?.error || 'Could not start the overlay server.'); setEnabled(false); persist(false); }
      } else {
        await api.twitchOverlayStop?.();
        setUrl('');
      }
    } catch (e) { setError(String(e?.message || e)); }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true); setTimeout(() => setCopied(false), 1400);
      pushToast({ message: 'Overlay URL copied — paste into an OBS Browser Source', kind: 'success', dedupeKey: 'overlay-url-copy' });
    } catch { pushToast({ message: 'Couldn’t copy the URL', kind: 'error', dedupeKey: 'overlay-url-copy' }); }
  };

  return (
    <>
      <ToggleRow
        label="Now-Playing Overlay for OBS"
        description="Runs a little now-playing widget you can drop into OBS as a browser source, so your stream shows the current track."
        checked={enabled}
        onChange={toggle}
      />
      {enabled ? (
        <div style={{ marginTop: 8 }}>
          {error ? (
            <div style={{ fontSize: 10.5, color: '#f37272', marginBottom: 8 }}>{error}</div>
          ) : null}

          {/* Theme picker — Glass / LED / Island */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Style</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { id: 'glass', label: 'Glass' },
                { id: 'led', label: 'LED Marquee' },
                { id: 'island', label: 'Dynamic Island' },
              ].map((opt) => {
                const active = theme === opt.id;
                return (
                  <button key={opt.id} type="button" onClick={() => setTheme(opt.id)}
                    style={{
                      flex: 1, padding: '8px 6px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${active ? `rgba(${accent},0.7)` : 'rgba(255,255,255,0.12)'}`,
                      background: active ? `rgba(${accent},0.18)` : 'rgba(255,255,255,0.04)',
                      color: active ? '#fff' : 'rgba(255,255,255,0.65)',
                      fontSize: 11, fontWeight: 600, transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                    }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {url ? (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <input readOnly value={url} onFocus={(e) => e.target.select()}
                  style={{
                    flex: 1, padding: '8px 11px', borderRadius: 8,
                    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', fontSize: 11.5, outline: 'none', fontFamily: 'ui-monospace, monospace',
                  }} />
                <button type="button" onClick={copy}
                  style={{
                    padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: copied ? 'rgba(120,200,120,0.85)' : `rgba(${accent},0.9)`, color: '#fff',
                    fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', transition: 'background 0.15s',
                  }}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                In OBS: <b>+ → Browser</b>, paste this URL, set size ~440×100, transparent background. It updates automatically as you play music.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>Starting overlay…</div>
          )}
        </div>
      ) : null}
    </>
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
            position: 'absolute', top: 1, left: 1,
            width: 16, height: 16, borderRadius: '50%',
            background: '#fff',
            transform: checked ? 'translateX(14px)' : 'translateX(0)',
            transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
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
/**
 * SegmentedSettingRow — shared card for multiple-choice settings. Mirrors the
 * AmbientSettingRow / TransitionSettingRow visual language: a labelled card
 * with a contextual description and a segmented control. `descriptions` is an
 * optional map of value → text; when given, the subtext updates with the
 * selection (falling back to `description` for a static line).
 */
function SegmentedSettingRow({ label, description, descriptions, options = [], value, onChange }) {
  const subtext = (descriptions && descriptions[value]) || description || null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 11px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2 }}>
          {label}
        </div>
        {subtext ? (
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, marginTop: 3 }}>
            {subtext}
          </div>
        ) : null}
      </div>

      {/* Segmented control */}
      <div style={{
        display: 'flex', gap: 4, padding: 3,
        background: 'rgba(0,0,0,0.25)', borderRadius: 8,
      }}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange?.(opt.value)}
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
    </div>
  );
}

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
 * TransitionSettingRow — picks how one track flows into the next.
 * Visually mirrors AmbientSettingRow: a segmented control plus a contextual
 * slider that only appears for 'crossfade'.
 *
 *   off       → hard cut (original behaviour; small decode gap)
 *   gapless   → next track preloaded and started ~0.18s before the end;
 *               no overlap, inaudible seam on lossless files
 *   crossfade → next track starts `crossfadeSec` early and the two overlap
 *               while one fades down and the other fades up
 */
AmbientSettingRow.searchTerms = 'ambient mode screensaver idle collage cover delay off strict relaxed custom';
TransitionSettingRow.searchTerms = 'track transitions crossfade gapless hard cut fade between songs';

function TransitionSettingRow({ mode, onSetMode, crossfadeSec, onSetCrossfadeSec }) {
  const options = [
    { value: 'off',       label: 'Off' },
    { value: 'gapless',   label: 'Gapless' },
    { value: 'crossfade', label: 'Crossfade' },
  ];

  const description = mode === 'off'
    ? 'Tracks change with a hard cut — there may be a brief gap as the next file loads.'
    : mode === 'gapless'
    ? 'The next track is loaded ahead of time and starts the instant the current one ends — no gap, no overlap.'
    : `The next track fades in over ${crossfadeSec} second${crossfadeSec === 1 ? '' : 's'} while the current one fades out, so they briefly overlap.`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 11px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2 }}>
          Track transitions
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

      {/* Crossfade length — only visible when 'crossfade' is selected. */}
      {mode === 'crossfade' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', flexShrink: 0 }}>
            Length
          </label>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={crossfadeSec}
            onChange={(e) => onSetCrossfadeSec?.(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#fff', cursor: 'pointer' }}
          />
          <span style={{
            fontSize: 11, color: 'rgba(255,255,255,0.65)',
            fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right',
          }}>
            {crossfadeSec}s
          </span>
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
    { id: 'new',    label: 'Explore',        desc: 'New releases, charts, and music to discover.' },
    { id: 'stats',  label: 'Listening stats', desc: 'Top tracks, artists, listening time.' },
    { id: 'queue',  label: 'Queue',          desc: 'Up-next tracks for the current session.' },
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


export {
  SettingsTab, SettingsSearchEmptyState, Section,
  FontPicker, CustomFontsManager,
  SpotifySetupGuide, SetupStep, UpdatesSection, RescanMetadataButton, ClearLibraryModal,
  FieldLabel, Banner, SettingsSlider,
  LastFmKeyField, DiscordAppIdField, ImgbbApiKeyField, StreamOverlaySection,
  ToggleRow, AmbientSettingRow, TransitionSettingRow,
  DockTabVisibilityList, LyricsProviderPicker,
};
