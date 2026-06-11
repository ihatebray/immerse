import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Normalize a track title/artist for "do I already own this song" matching,
// since iTunes and yt-dlp/Spotify metadata rarely share IDs. Strips featured-
// artist decoration so "Song (feat. X)" matches "Song".
const normTrackTitle = (s) => (s || '').toLowerCase().trim()
  .replace(/\s*\((?:feat|ft|with)\.?[^)]*\)/gi, '')
  .replace(/\s*-\s*(?:feat|ft)\.?.*$/i, '')
  .trim();
const primaryArtistOf = (s) => (s || '').toLowerCase()
  .split(/,|&|\bfeat\.?|\bft\.?/i)[0].trim();
const libTrackKey = (title, artist) => `${normTrackTitle(title)}|${primaryArtistOf(artist)}`;
const normAlbum = (s) => (s || '').toLowerCase().trim().replace(/\s*-\s*(?:single|ep)$/i, '').trim();

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
  onShowCandidatePicker,
  onSpotifyImportDone,
  onPreviewPlay,
  previewVolumePosition = 'bottomRight',
}) {
  const [manageOpen, setManageOpen] = useState(false);
  /** Map<collectionId, { status: 'fetching'|'downloading'|'done'|'error', current, total, error? }> */
  const [downloads, setDownloads] = useState(new Map());

  // Expandable tracklists: which release is open, its fetched tracks, and
  // per-track download state. Lets the user see songs on an album and pull a
  // single track instead of the whole release.
  const [expandedId, setExpandedId] = useState(null);
  const [trackCache, setTrackCache] = useState({});   // {collectionId: track[]}
  const [trackLoading, setTrackLoading] = useState({});
  const [trackError, setTrackError] = useState({});
  const [trackDl, setTrackDl] = useState({});          // {`${cid}:${trackId}`: 'queued'|'done'|'failed'}

  // 30-second iTunes preview playback. Only one preview plays at a time.
  const [previewKey, setPreviewKey] = useState(null);  // `${cid}:${trackId}` currently previewing
  const [previewIsSingle, setPreviewIsSingle] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('immerse:previewVolume')); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.45; } catch { return 0.45; }
  });
  const previewAudioRef = useRef(null);
  const prevVolRef = useRef(0.45); // remembers volume across mute toggles
  const volTrackRef = useRef(null);
  const volDragRef = useRef(false);
  // Keep the live audio in sync with the slider, and remember the choice.
  useEffect(() => {
    if (previewAudioRef.current) previewAudioRef.current.volume = previewVolume;
    try { localStorage.setItem('immerse:previewVolume', String(previewVolume)); } catch { /* */ }
  }, [previewVolume]);

  const togglePreview = useCallback((release, tk, isSingle = false) => {
    const url = tk?.previewUrl;
    if (!url) return;
    const audio = previewAudioRef.current;
    if (!audio) return;
    const key = `${release.collectionId}:${tk.trackId}`;
    if (previewKey === key) { try { audio.pause(); } catch { /* */ } setPreviewKey(null); return; }
    onPreviewPlay?.();            // ask the parent to pause the main player first
    try {
      audio.src = url;
      audio.currentTime = 0;
      audio.volume = previewVolume;
      audio.play().then(() => { setPreviewKey(key); setPreviewIsSingle(isSingle); }).catch(() => setPreviewKey(null));
    } catch { setPreviewKey(null); }
  }, [previewKey, onPreviewPlay, previewVolume]);

  // Stop the preview if its album is collapsed (albums only — singles aren't
  // expanded, so they'd be killed instantly), and on unmount.
  useEffect(() => {
    if (previewKey && !previewIsSingle && !String(previewKey).startsWith(`${expandedId}:`)) {
      try { previewAudioRef.current?.pause(); } catch { /* */ }
      setPreviewKey(null);
    }
  }, [expandedId, previewKey, previewIsSingle]);
  useEffect(() => () => { try { previewAudioRef.current?.pause(); } catch { /* */ } }, []);

  const toggleExpand = useCallback((release) => {
    const id = Number(release?.collectionId);
    if (!Number.isFinite(id)) return;
    setExpandedId((cur) => (cur === id ? null : id));
    if (trackCache[id] || trackLoading[id]) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.lookupReleaseAlbumTracks) { setTrackError((m) => ({ ...m, [id]: 'unavailable' })); return; }
    setTrackLoading((m) => ({ ...m, [id]: true }));
    Promise.resolve(api.lookupReleaseAlbumTracks(id))
      .then((res) => {
        if (res?.ok && Array.isArray(res.tracks)) setTrackCache((m) => ({ ...m, [id]: res.tracks }));
        else setTrackError((m) => ({ ...m, [id]: res?.error || 'Could not load tracks' }));
      })
      .catch((e) => setTrackError((m) => ({ ...m, [id]: String(e?.message || e) })))
      .finally(() => setTrackLoading((m) => ({ ...m, [id]: false })));
  }, [trackCache, trackLoading]);

  const downloadOneTrack = useCallback(async (release, tk) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.importFromYoutubeSearch) return;
    const key = `${release.collectionId}:${tk.trackId}`;
    if (trackDl[key] === 'queued' || trackDl[key] === 'done') return;
    setTrackDl((m) => ({ ...m, [key]: 'queued' }));
    try {
      const res = await api.importFromYoutubeSearch({
        title: tk.trackName, artists: tk.artistName || release.artistName,
        album: tk.collectionName || release.collectionName,
        albumArtUrl: tk.artworkUrl || release.artworkUrl, durationMs: tk.trackTimeMillis || 0,
        spotifyId: `itunes:${tk.trackId}`, trackNumber: tk.trackNumber || null, discNumber: null, explicit: tk.explicit,
      });
      if (res?.ok && res.track) {
        setTrackDl((m) => ({ ...m, [key]: 'done' }));
        onSpotifyImportDone?.(res.track);
      } else if (res?.candidates && onShowCandidatePicker) {
        setTrackDl((m) => ({ ...m, [key]: 'failed' }));
        onShowCandidatePicker({
          candidates: res.candidates,
          meta: {
            title: tk.trackName, artists: tk.artistName || release.artistName,
            album: tk.collectionName || release.collectionName,
            albumArtUrl: tk.artworkUrl || release.artworkUrl,
            spotifyId: `itunes:${tk.trackId}`, trackNumber: tk.trackNumber || null,
            explicit: tk.explicit,
          },
          onSuccess: () => setTrackDl((m) => ({ ...m, [key]: 'done' })),
        });
      } else {
        setTrackDl((m) => ({ ...m, [key]: 'failed' }));
      }
    } catch { setTrackDl((m) => ({ ...m, [key]: 'failed' })); }
  }, [trackDl, onShowCandidatePicker, onSpotifyImportDone]);

  // Download every track from a release that isn't already in the library,
  // one at a time (so we don't fire a dozen YouTube searches at once).
  const downloadMissing = useCallback(async (release, list) => {
    for (const tk of list) {
      // eslint-disable-next-line no-await-in-loop
      await downloadOneTrack(release, tk);
    }
  }, [downloadOneTrack]);

  const fmtDur = (ms) => { if (!ms) return ''; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  const setDownloadState = (collectionId, patch) => {
    setDownloads((prev) => {
      const next = new Map(prev);
      if (patch == null) next.delete(collectionId);
      else next.set(collectionId, { ...(prev.get(collectionId) || {}), ...patch });
      return next;
    });
  };

  // Fast lookup of which tracks are already in the library (title + primary artist).
  const libraryTrackKeys = useMemo(() => {
    const set = new Set();
    for (const t of library) { if (t?.title) set.add(libTrackKey(t.title, t.artist)); }
    return set;
  }, [library]);
  const trackInLibrary = useCallback((title, artist) => libraryTrackKeys.has(libTrackKey(title, artist)), [libraryTrackKeys]);

  // How many tracks of each album+artist we already own (for "do I have the
  // whole album" without fetching its tracklist).
  const albumOwnedCounts = useMemo(() => {
    const m = new Map();
    for (const t of library) {
      if (!t?.album) continue;
      const k = `${normAlbum(t.album)}|${primaryArtistOf(t.artist)}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [library]);
  // "Fully owned" pre-expansion: a single counts as owned if we have that song;
  // an album if we own at least as many tracks as iTunes lists.
  const albumFullyOwned = useCallback((r) => {
    const tc = Number(r?.trackCount) || 0;
    if (tc <= 1) return trackInLibrary((r?.collectionName || '').replace(/\s*-\s*single$/i, ''), r?.artistName);
    const k = `${normAlbum(r?.collectionName)}|${primaryArtistOf(r?.artistName)}`;
    return (albumOwnedCounts.get(k) || 0) >= tc;
  }, [albumOwnedCounts, trackInLibrary]);

  // Single / one-song release preview: fetch its single track (once) to get the
  // 30s previewUrl, then play it.
  const toggleSinglePreview = useCallback(async (release) => {
    const id = Number(release?.collectionId);
    let tks = trackCache[id];
    if (!Array.isArray(tks)) {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (!api?.lookupReleaseAlbumTracks) return;
      try {
        const res = await api.lookupReleaseAlbumTracks(id);
        if (res?.ok && Array.isArray(res.tracks)) { tks = res.tracks; setTrackCache((m) => ({ ...m, [id]: res.tracks })); }
      } catch { return; }
    }
    const tk = Array.isArray(tks) ? tks[0] : null;
    if (tk?.previewUrl) togglePreview(release, tk, true);
  }, [trackCache, togglePreview]);

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

  // Minimal volume bar shown directly under the preview/download buttons of
  // whichever row is currently previewing. Only one row previews at a time, so
  // the shared track ref is fine.
  const setVolFromEvent = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPreviewVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  const renderVolBar = (width = 62) => (
    <div ref={volTrackRef}
      aria-label="Preview volume"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } volDragRef.current = true; setVolFromEvent(e); }}
      onPointerMove={(e) => { if (volDragRef.current) setVolFromEvent(e); }}
      onPointerUp={(e) => { volDragRef.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ } }}
      style={{ position: 'relative', width, height: 12, display: 'flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
      <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }}>
        <div style={{ width: `${previewVolume * 100}%`, height: '100%', borderRadius: 2, background: `rgba(${accent},0.9)` }} />
      </div>
      <div style={{ position: 'absolute', left: `${previewVolume * 100}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.4)' }} />
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
      {/* Inline keyframes (spin) */}
      <style>{`
        @keyframes immerseSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .xpl-row { transition: background .13s; }
        .xpl-icbtn { transition: color .15s, background .15s, border-color .15s; }
      `}</style>

      {/* Hidden element that plays the 30s iTunes preview clips */}
      <audio ref={previewAudioRef} preload="none" onEnded={() => setPreviewKey(null)} />

      {/* The body is hidden while the manager is open so the frosted card sits
          over the dock's blurred ambient (a cover image, no text) — matching how
          the Edit-metadata modal opens over the cover. */}
      {!manageOpen ? (
       <>
      {/* ===== Explore actions — refresh + find-follow (identity header is
           now the shared panel header above) ===== */}
      <div style={{ padding: '12px 14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* Prominent find-artists action — the entry to disambiguated follow */}
          <button type="button" onClick={() => setManageOpen(true)}
            className="xpl-icbtn"
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 12px', borderRadius: 11, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'left',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = `rgba(${accent},0.4)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
            </svg>
            <span style={{ flex: 1 }}>Find &amp; follow an artist…</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>Manage</span>
          </button>
          <button type="button" onClick={handleRefresh} disabled={refreshing}
            className="xpl-icbtn" title={refreshing ? 'Refreshing…' : 'Refresh'} aria-label="Refresh releases"
            style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)', color: refreshing ? `rgba(${accent},1)` : 'rgba(255,255,255,0.7)',
              cursor: refreshing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={refreshing ? { animation: 'immerseSpin 1s linear infinite' } : undefined}>
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 8px 16px' }}>
        {releases.length === 0 ? (
          <div style={{ padding: '28px 18px', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
            {followedArtists.length === 0 ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>New Releases</div>
                <div style={{ marginBottom: 8 }}>
                  Follow your favorite artists and Immerse will track their new releases automatically. When something drops, it shows up here — ready to preview and import.
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6, marginBottom: 14 }}>
                  Artists are auto-followed when you import their music. You can also add them manually below.
                </div>
                <button type="button" onClick={() => setManageOpen(true)}
                  style={{
                    padding: '7px 16px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.15)',
                    background: `rgba(${accent},0.2)`, color: '#fff',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>
                  Follow some artists
                </button>
              </>
            ) : refreshing ? (
              <>Checking for new releases…</>
            ) : (
              <>
                Nothing new in the last 30 days.
                <div style={{ marginTop: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.38)' }}>
                  Tap refresh to check again. Immerse checks Spotify for albums released in the last 30 days by your followed artists.
                </div>
              </>
            )}
          </div>
        ) : (
          releases.map((r) => {
            const dl = downloads.get(r.collectionId);
            const isBusy = dl && (dl.status === 'fetching' || dl.status === 'downloading');
            const isDone = dl && dl.status === 'done';
            const isError = dl && dl.status === 'error';

            const open = expandedId === Number(r.collectionId);
            const tks = trackCache[Number(r.collectionId)];
            const tkLoading = trackLoading[Number(r.collectionId)];
            const tkErr = trackError[Number(r.collectionId)];
            // Album ownership is computed from the actual tracklist (once loaded),
            // NOT "any one track matches" — otherwise owning a single song marked
            // the whole album as in-library and hid the download. "Fully owned"
            // means every *available* track is already in the library.
            const availTks = Array.isArray(tks) ? tks.filter((tk) => tk.isStreamable !== false) : [];
            const missingTks = availTks.filter((tk) => !trackInLibrary(tk.trackName, tk.artistName || r.artistName));
            const allOwned = availTks.length > 0 && missingTks.length === 0;
            // Row mode: singles/one-song releases get no dropdown (just preview +
            // download); fully-owned releases collapse to an "in library" marker
            // and can't be expanded; everything else is an expandable album.
            const isSingle = (Number(r.trackCount) || 0) <= 1;
            const fullyOwned = albumFullyOwned(r);
            const expandable = !isSingle && !fullyOwned;
            const singlePrev = !!previewKey && String(previewKey).startsWith(`${r.collectionId}:`);
            return (
              <div key={`${r.itunesArtistId}:${r.collectionId}`} style={{ marginBottom: 3 }}>
              <div
                className="xpl-row"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 10px', borderRadius: 12, cursor: expandable ? 'pointer' : 'default',
                  background: open ? `rgba(${accent},0.1)` : 'transparent',
                  border: open ? `1px solid rgba(${accent},0.25)` : '1px solid transparent',
                }}
                onClick={() => { if (expandable) toggleExpand(r); }}
                onMouseEnter={(e) => { if (expandable && !open) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 9, overflow: 'hidden', flexShrink: 0,
                  background: '#1a1a1a', boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
                }}>
                  {r.artworkUrl ? (
                    <img src={r.artworkUrl} alt="" loading="lazy" decoding="async"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.collectionName}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.artistName}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', marginTop: 4,
                    display: 'flex', gap: 7, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, letterSpacing: '0.03em', color: `rgba(${accent},1)`, background: `rgba(${accent},0.14)`, borderRadius: 5, padding: '1px 6px' }}>{formatDate(r.releaseDate)}</span>
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
                {/* Right side: fully-owned → marker; single → preview+download;
                    album → status + expand chevron. */}
                {fullyOwned ? (
                  <div title="Already in your library" aria-label="In library"
                    style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(138,224,138,0.14)', color: '#8ae08a' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                ) : isSingle ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleSinglePreview(r); }}
                      title={singlePrev ? 'Stop preview' : 'Preview (30s)'} aria-label="Preview"
                      style={{
                        width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: singlePrev ? `rgba(${accent},0.85)` : 'rgba(255,255,255,0.08)', color: '#fff', transition: 'background 0.15s',
                      }}>
                      {singlePrev
                        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                        : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
                    </button>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); if (!isBusy && !isDone) handleImport(r); }}
                      disabled={isBusy || isDone}
                      title={isBusy ? 'Downloading…' : isDone ? 'Added' : isError ? 'Failed — retry' : 'Download'}
                      aria-label="Download single"
                      style={{
                        width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: isBusy || isDone ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isDone ? 'rgba(138,224,138,0.85)' : isBusy ? `rgba(${accent},0.5)` : isError ? 'rgba(243,114,114,0.7)' : 'rgba(255,255,255,0.08)',
                        color: '#fff', transition: 'background 0.15s',
                      }}>
                      {isBusy ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'immerseSpin 0.9s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.2-8.55" /></svg>
                      ) : isDone ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : isError ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
                      )}
                    </button>
                    </div>
                    {singlePrev && previewVolumePosition === 'underButtons' ? renderVolBar(62) : null}
                  </div>
                ) : (
                  <>
                    {isBusy ? (
                      <div aria-label="Downloading" style={{ width: 24, height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: `rgba(${accent},1)` }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'immerseSpin 0.9s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.2-8.55" /></svg>
                      </div>
                    ) : isDone ? (
                      <div aria-label="Added" style={{ width: 24, height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8ae08a' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                    ) : null}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </>
                )}
              </div>

              {open && expandable ? (
                <div style={{
                  margin: '2px 4px 8px', borderRadius: 9, overflow: 'hidden',
                  background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  {/* Download-all — the album download lives here now, not on the row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 9px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <button type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isBusy || isDone || allOwned) return;
                        if (availTks.length) downloadMissing(r, missingTks);
                        else handleImport(r); // tracks not loaded yet — fall back to whole-album import
                      }}
                      disabled={isBusy || isDone || allOwned}
                      title={allOwned ? 'Every track is already in your library' : isBusy ? 'Downloading…' : isDone ? 'Added' : 'Download the tracks you don’t have yet'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.12)', background: isBusy ? `rgba(${accent},0.18)` : 'rgba(0,0,0,0.25)',
                        color: allOwned || isDone ? 'rgba(255,255,255,0.45)' : isBusy ? `rgba(${accent},1)` : 'rgba(255,255,255,0.85)',
                        fontSize: 11, fontWeight: 600, cursor: isBusy || isDone || allOwned ? 'default' : 'pointer', transition: 'color 0.15s, background 0.15s',
                      }}>
                      {isBusy ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'immerseSpin 0.9s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.2-8.55" /></svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      )}
                      {allOwned ? 'All in your library'
                        : isBusy ? `Downloading${dl.total ? ` ${dl.current}/${dl.total}` : '…'}`
                        : isDone ? `Added${dl.failed ? ` · ${dl.failed} failed` : ''}`
                        : (availTks.length && missingTks.length < availTks.length) ? `Download ${missingTks.length} missing`
                        : 'Download all'}
                    </button>
                    {isError ? <span style={{ fontSize: 10, color: '#f37272' }} title={dl.error}>Failed — try again</span> : null}
                  </div>
                  {tkLoading ? (
                    <div style={{ padding: '14px', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>Loading tracks…</div>
                  ) : tkErr ? (
                    <div style={{ padding: '14px', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>Couldn’t load tracks.</div>
                  ) : tks && tks.length ? (
                    tks.map((tk, ti) => {
                      const key = `${r.collectionId}:${tk.trackId}`;
                      const st = trackDl[key];
                      const isPrev = previewKey === key;
                      const unavailable = tk.isStreamable === false;
                      const inLib = trackInLibrary(tk.trackName, tk.artistName || r.artistName);
                      return (
                        <div key={tk.trackId || ti} style={{
                          display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px',
                          borderTop: ti === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                          opacity: unavailable ? 0.5 : 1,
                        }}>
                          <span style={{ width: 16, textAlign: 'right', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{tk.trackNumber || ti + 1}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'rgba(255,255,255,0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.trackName}</span>
                          {tk.explicit ? <span style={{ fontSize: 7, fontWeight: 800, border: '1px solid rgba(255,255,255,0.28)', borderRadius: 3, padding: '0 3px', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>E</span> : null}
                          {unavailable ? <span style={{ fontSize: 7, fontWeight: 800, border: '1px solid rgba(255,255,255,0.18)', borderRadius: 3, padding: '0 3px', color: 'rgba(255,255,255,0.5)', flexShrink: 0, letterSpacing: '0.04em' }}>SOON</span> : null}
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtDur(tk.trackTimeMillis)}</span>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          {tk.previewUrl ? (
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); togglePreview(r, tk); }}
                              title={isPrev ? 'Stop preview' : 'Preview (30s)'} aria-label={isPrev ? 'Stop preview' : 'Play preview'}
                              style={{
                                width: 24, height: 24, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: isPrev ? `rgba(${accent},0.85)` : 'rgba(255,255,255,0.08)', color: '#fff', transition: 'background 0.15s',
                              }}>
                              {isPrev ? (
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                              ) : (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                              )}
                            </button>
                          ) : null}
                          {inLib ? (
                            <div title="Already in your library" aria-label="In library"
                              style={{
                                width: 24, height: 24, flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#8ae08a',
                              }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            </div>
                          ) : unavailable ? (
                            <button type="button" disabled title="Not yet available" aria-label="Not yet available"
                              style={{
                                width: 24, height: 24, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'default',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)',
                              }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                            </button>
                          ) : (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); if (!st || st === 'failed') downloadOneTrack(r, tk); }}
                            title={st || 'Download track'} aria-label="Download track"
                            style={{
                              width: 24, height: 24, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: st === 'done' || st === 'queued' ? 'default' : 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: st === 'done' ? 'rgba(138,224,138,0.85)' : st === 'queued' ? `rgba(${accent},0.5)` : st === 'failed' ? 'rgba(243,114,114,0.7)' : 'rgba(255,255,255,0.08)',
                              color: '#fff', transition: 'background 0.15s',
                            }}>
                            {st === 'done' ? (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            ) : st === 'queued' ? (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'immerseSpin 0.9s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.2-8.55" /></svg>
                            ) : st === 'failed' ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            ) : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
                            )}
                          </button>
                          )}
                          </div>
                          {isPrev && previewVolumePosition === 'underButtons' ? renderVolBar(54) : null}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: '14px', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>No track information.</div>
                  )}
                </div>
              ) : null}
              </div>
            );
          })
        )}
      </div>
       </>
      ) : null}

      {manageOpen ? (
        <FollowedArtistsManager
          followedArtists={followedArtists}
          followOverrides={followOverrides}
          releases={releases}
          onAdd={onAddFollowedArtist}
          onExclude={onExcludeFollowedArtist}
          onClearOverride={onClearFollowedArtistOverride}
          onClose={() => setManageOpen(false)}
          accent={accent}
        />
      ) : null}

      {/* Floating preview-volume pill — shown while a preview is playing when
          the user picked "Bottom right" in Settings. The inline under-buttons
          bars are suppressed in this mode (see renderVolBar call sites). */}
      {previewKey && previewVolumePosition === 'bottomRight' && !manageOpen ? (
        <div style={{
          position: 'absolute', right: 14, bottom: 14, zIndex: 6,
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 13px', borderRadius: 999,
          background: 'rgba(18,18,22,0.88)',
          border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
          {renderVolBar(92)}
        </div>
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
  releases = [],
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

  // Per-artist info derived from the cached releases so the list reads like the
  // search results — cover thumbnail, genre, latest year, release count — which
  // makes it obvious which same-named artist you actually follow.
  const artistInfo = useMemo(() => {
    const m = new Map(); // key (lowercased primary artist) → info
    for (const r of releases || []) {
      const key = (r.artistName || '').split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim().toLowerCase();
      if (!key) continue;
      const year = r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) : 0;
      const prev = m.get(key);
      if (!prev) {
        m.set(key, { artwork: r.artworkUrl || '', genre: r.primaryGenreName || '', latestYear: year || 0, count: 1, latestDate: r.releaseDate || '' });
      } else {
        prev.count += 1;
        if (year && year > (prev.latestYear || 0)) prev.latestYear = year;
        // Use the artwork from the most recent release.
        if ((r.releaseDate || '') > (prev.latestDate || '')) { prev.artwork = r.artworkUrl || prev.artwork; prev.latestDate = r.releaseDate || prev.latestDate; }
        if (!prev.genre && r.primaryGenreName) prev.genre = r.primaryGenreName;
      }
    }
    return m;
  }, [releases]);

  // The cache-derived info above only covers artists with a release in the last
  // ~30 days. Fetch real info from iTunes for everyone (genre, latest year,
  // release count, artwork) so artists whose newest release is older — e.g. a
  // 2025 album — don't show "No recent releases". Cached in the main process.
  const [fetchedInfo, setFetchedInfo] = useState({}); // key → { genre, latestYear, releaseCount, artworkUrl }
  const [infoLoading, setInfoLoading] = useState(false);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.getArtistInfo || !followedArtists.length) return undefined;
    let cancelled = false;
    setInfoLoading(true);
    const payload = followedArtists.map((a) => ({ name: a.displayName, itunesArtistId: a.itunesArtistId || null }));
    Promise.resolve(api.getArtistInfo(payload))
      .then((r) => { if (!cancelled && r?.ok && r.info) setFetchedInfo(r.info); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setInfoLoading(false); });
    return () => { cancelled = true; };
  // Re-run when the set of followed artists changes (by key list).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedArtists.map((a) => a.key).join('|')]);

  // Merge: prefer the freshly-fetched iTunes info, fall back to the cache-derived
  // info, and normalize to one shape for rendering.
  const infoFor = useCallback((a) => {
    const f = fetchedInfo[a.key];
    if (f && (f.latestYear || f.releaseCount || f.artworkUrl || f.genre)) {
      return { artwork: f.artworkUrl || '', genre: f.genre || '', latestYear: f.latestYear || 0, count: f.releaseCount || 0 };
    }
    const c = artistInfo.get(a.key);
    if (c) return { artwork: c.artwork || '', genre: c.genre || '', latestYear: c.latestYear || 0, count: c.count || 0 };
    return null;
  }, [fetchedInfo, artistInfo]);
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addedId, setAddedId] = useState(null); // artistId just followed (for ✓ feedback)
  const searchTimer = useRef(null);
  const searchSeq = useRef(0);

  const runSearch = useCallback((term) => {
    const q = (term || '').trim();
    setError('');
    setAddedId(null);
    if (q.length < 2) { setCandidates([]); setSearching(false); return; }
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.searchArtistCandidates) { setCandidates([]); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    Promise.resolve(api.searchArtistCandidates(q))
      .then((r) => {
        if (seq !== searchSeq.current) return; // stale
        setCandidates(r?.ok && Array.isArray(r.candidates) ? r.candidates : []);
      })
      .catch(() => { if (seq === searchSeq.current) setCandidates([]); })
      .finally(() => { if (seq === searchSeq.current) setSearching(false); });
  }, []);

  const onSearchChange = (val) => {
    setNewArtist(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(val), 320);
  };

  const followCandidate = useCallback(async (c) => {
    setError('');
    setAdding(true);
    try {
      const r = await onAdd?.(c.artistName, c.artistId);
      if (r?.ok) {
        setAddedId(c.artistId);
        // brief confirmation, then clear the search
        setTimeout(() => { setNewArtist(''); setCandidates([]); setAddedId(null); }, 900);
      } else {
        setError(r?.error || 'Could not follow artist.');
      }
    } finally {
      setAdding(false);
    }
  }, [onAdd]);

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

  const isManual = (artist) => followOverrides.some(
    (o) => o.action === 'add' && o.artistName.toLowerCase() === artist.key,
  );

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        // We're INSIDE the dock, which already has its own backdrop-filter. A
        // nested backdrop-filter samples an empty (black) backdrop and renders
        // flat dark, so we DON'T use one here. Instead the dock has already
        // frosted the app's cover into a soft ambient behind us; a light scrim +
        // translucent card let that ambient bleed through, matching the look the
        // Edit-metadata modal gets via its own glass (it lives outside the dock).
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}>
      <div
        style={{
          width: '100%', maxWidth: 520, maxHeight: '100%',
          display: 'flex', flexDirection: 'column', minHeight: 0,
          borderRadius: 16, overflow: 'hidden',
          background: 'rgba(18,18,20,0.45)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
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

        {/* Find & follow an artist — search with disambiguation */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', pointerEvents: 'none', display: 'flex' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" /></svg>
            </span>
            <input
              ref={inputRef}
              type="text"
              value={newArtist}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search for an artist to follow…"
              style={{
                width: '100%', padding: '8px 30px 8px 30px', borderRadius: 9,
                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {searching ? (
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: `rgba(${accent},1)` }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'immerseSpin 0.9s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.2-8.55" /></svg>
              </span>
            ) : newArtist ? (
              <button type="button" onClick={() => { setNewArtist(''); setCandidates([]); setError(''); inputRef.current?.focus(); }}
                aria-label="Clear" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            ) : null}
          </div>

          {/* Candidate results — pick the right artist */}
          {candidates.length > 0 ? (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 248, overflowY: 'auto' }}>
              {candidates.map((c) => {
                const already = followedArtists.some((a) => {
                  // If we've pinned this followed artist to a specific iTunes ID,
                  // only the matching candidate counts as "Following" — otherwise
                  // every artist sharing the name lights up.
                  if (a.itunesArtistId && c.artistId) return Number(a.itunesArtistId) === Number(c.artistId);
                  return (a.key || a.displayName || '').toLowerCase() === c.artistName.toLowerCase();
                });
                const justAdded = addedId === c.artistId;
                return (
                  <button key={c.artistId} type="button"
                    onClick={() => { if (!already && !justAdded) followCandidate(c); }}
                    disabled={adding || already}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '7px 8px', borderRadius: 9, cursor: already || justAdded ? 'default' : 'pointer',
                      background: justAdded ? `rgba(${accent},0.18)` : 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)', transition: 'background 0.13s',
                    }}
                    onMouseEnter={(e) => { if (!already && !justAdded) e.currentTarget.style.background = `rgba(${accent},0.18)`; }}
                    onMouseLeave={(e) => { if (!already && !justAdded) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}>
                    <span style={{ width: 40, height: 40, borderRadius: 7, flexShrink: 0, background: '#1a1a1a', backgroundImage: c.artworkUrl ? `url(${c.artworkUrl})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.artistName}</span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[c.genre, c.latestYear ? `latest ${c.latestYear}` : '', c.albumCount ? `${c.albumCount}+ releases` : ''].filter(Boolean).join(' · ') || 'Artist'}
                      </span>
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, color: justAdded ? '#8ae08a' : already ? 'rgba(255,255,255,0.35)' : `rgba(${accent},1)` }}>
                      {justAdded ? (
                        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Followed</>
                      ) : already ? 'Following' : (
                        <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Follow</>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : newArtist.trim().length >= 2 && !searching ? (
            <div style={{ marginTop: 8, fontSize: 10.5, color: 'rgba(255,255,255,0.4)', padding: '4px 2px' }}>No artists found for “{newArtist.trim()}”.</div>
          ) : null}

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
            const info = infoFor(a);
            const sub = info
              ? [info.genre, info.latestYear ? `latest ${info.latestYear}` : '', info.count ? `${info.count} release${info.count === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
              : '';
            return (
              <div key={a.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 16px', fontSize: 11.5,
                }}>
                <span style={{
                  width: 38, height: 38, borderRadius: 7, flexShrink: 0,
                  background: '#1a1a1a', backgroundImage: info?.artwork ? `url(${info.artwork})` : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {!info?.artwork ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" /></svg>
                  ) : null}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.displayName}</span>
                    <span style={{ color: 'rgba(255,255,255,0.32)', fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>
                      {manual ? 'Manual' : 'Auto'}
                    </span>
                  </div>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub || (infoLoading ? 'Loading…' : 'No recent releases')}
                  </span>
                </div>
                <button type="button"
                  onClick={() => (manual ? onClearOverride?.(a.displayName) : onExclude?.(a.displayName))}
                  title={manual ? 'Remove' : 'Unfollow'}
                  style={{
                    padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)',
                    background: 'transparent', color: 'rgba(255,255,255,0.6)',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
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


export { NewReleasesTab, FollowedArtistsManager };
