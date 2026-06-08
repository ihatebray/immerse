import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

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

  const fmtDur = (ms) => { if (!ms) return ''; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
      {/* Inline keyframes (spin) */}
      <style>{`
        @keyframes immerseSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .xpl-row { transition: background .13s; }
        .xpl-icbtn { transition: color .15s, background .15s, border-color .15s; }
      `}</style>

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
            const inLibrary = isInLibrary(r);
            const isBusy = dl && (dl.status === 'fetching' || dl.status === 'downloading');
            const isDone = dl && dl.status === 'done';
            const isError = dl && dl.status === 'error';

            const open = expandedId === Number(r.collectionId);
            const tks = trackCache[Number(r.collectionId)];
            const tkLoading = trackLoading[Number(r.collectionId)];
            const tkErr = trackError[Number(r.collectionId)];
            return (
              <div key={`${r.itunesArtistId}:${r.collectionId}`} style={{ marginBottom: 3 }}>
              <div
                className="xpl-row"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 10px', borderRadius: 12, cursor: 'pointer',
                  background: open ? `rgba(${accent},0.1)` : 'transparent',
                  border: open ? `1px solid rgba(${accent},0.25)` : '1px solid transparent',
                }}
                onClick={() => toggleExpand(r)}
                onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
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
                    onClick={(e) => { e.stopPropagation(); handleImport(r); }}
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
                {/* expand chevron */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>

              {open ? (
                <div style={{
                  margin: '2px 4px 8px', borderRadius: 9, overflow: 'hidden',
                  background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  {tkLoading ? (
                    <div style={{ padding: '14px', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>Loading tracks…</div>
                  ) : tkErr ? (
                    <div style={{ padding: '14px', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>Couldn’t load tracks.</div>
                  ) : tks && tks.length ? (
                    tks.map((tk, ti) => {
                      const key = `${r.collectionId}:${tk.trackId}`;
                      const st = trackDl[key];
                      return (
                        <div key={tk.trackId || ti} style={{
                          display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px',
                          borderTop: ti === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                        }}>
                          <span style={{ width: 16, textAlign: 'right', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{tk.trackNumber || ti + 1}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'rgba(255,255,255,0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.trackName}</span>
                          {tk.explicit ? <span style={{ fontSize: 7, fontWeight: 800, border: '1px solid rgba(255,255,255,0.28)', borderRadius: 3, padding: '0 3px', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>E</span> : null}
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtDur(tk.trackTimeMillis)}</span>
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

      {manageOpen ? createPortal(
        <FollowedArtistsManager
          followedArtists={followedArtists}
          followOverrides={followOverrides}
          onAdd={onAddFollowedArtist}
          onExclude={onExcludeFollowedArtist}
          onClearOverride={onClearFollowedArtistOverride}
          onClose={() => setManageOpen(false)}
          accent={accent}
        />,
        document.body
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

  // Candidate disambiguation: as the user types, search iTunes for matching
  // artists (enriched with art/genre/latest year) so they can pick the EXACT
  // artist — fixing the "followed the wrong same-named artist" problem.
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
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div
        style={{
          width: 'min(420px, 90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: 'rgba(18,18,20,0.62)',
          backdropFilter: 'blur(30px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
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
                const already = followedArtists.some((a) => (a.key || a.displayName || '').toLowerCase() === c.artistName.toLowerCase());
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


export { NewReleasesTab, FollowedArtistsManager };
