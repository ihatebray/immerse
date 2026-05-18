import React, { useState, useEffect, useMemo } from 'react';
import Icons from './Icons.jsx';
import { sampleCoverTheme } from './coverTheme.js';

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function formatPlaylistDuration(totalSec) {
  const sec = Math.floor(Number(totalSec) || 0);
  if (sec <= 0) return '0 min';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  if (m > 0) return `${m} min`;
  return '< 1 min';
}

const titleCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Library as one big playlist: hero + dynamic tint from art, searchable list.
 */
export default function LibraryPlaylistView({
  library,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onPlayPauseTrack,
  onImportFiles,
  onImportFolder,
  importing,
  onRemoveFromLibrary,
  onOpenImmersivePage,
}) {
  const [hovered, setHovered] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [themeRgb, setThemeRgb] = useState({
    accent: '48, 48, 48', wash: '10, 10, 10', mid: '12, 12, 12', deep: '0, 0, 0',
  });

  const canRemove = typeof onRemoveFromLibrary === 'function'
    && window.electronAPI
    && (typeof window.electronAPI.removeLibraryTracks === 'function'
      || typeof window.electronAPI.invokeIpc === 'function');

  const gridCols = canRemove
    ? '40px 44px minmax(0,1.5fr) minmax(0,0.9fr) 56px 40px'
    : '40px 44px minmax(0,1.5fr) minmax(0,0.9fr) 56px';

  const displayedTracks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? [...library]
      : library.filter((t) => {
        const blob = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
        return blob.includes(q);
      });
    base.sort((a, b) => titleCollator.compare(String(a.title || ''), String(b.title || ''))
      || titleCollator.compare(String(a.id), String(b.id)));
    return base;
  }, [library, search]);

  const totalDuration = useMemo(
    () => library.reduce((acc, t) => acc + (typeof t.duration === 'number' ? t.duration : 0), 0),
    [library],
  );

  const themeSource = useMemo(() => {
    if (currentTrack && library.some((t) => t.id === currentTrack.id)) return currentTrack;
    const sel = library.find((t) => t.id === selectedId);
    return sel || library[0] || null;
  }, [currentTrack, selectedId, library]);

  useEffect(() => {
    const src = themeSource?.coverArt;
    if (!src) {
      setThemeRgb({ accent: '48, 48, 48', wash: '10, 10, 10', mid: '12, 12, 12', deep: '0, 0, 0' });
      return;
    }
    let cancelled = false;
    sampleCoverTheme(src).then((rgb) => {
      if (!cancelled && rgb) setThemeRgb(rgb);
    });
    return () => { cancelled = true; };
  }, [themeSource?.coverArt, themeSource?.id]);

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

  if (!library.length) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: 0,
      }}
      >
        <div style={{
          textAlign: 'center', maxWidth: 400, padding: '32px 36px',
          border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 16, background: 'rgba(255,255,255,0.02)',
        }}
        >
          <div style={{ color: '#3d3d3d', marginBottom: 14, display: 'flex', justifyContent: 'center' }}>
            <Icons.AlbumSidebar />
          </div>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e5e5e5' }}>Library is empty</p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#737373', lineHeight: 1.5 }}>
            Import music, then browse it like a playlist here.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onImportFiles}
              disabled={importing}
              style={{
                padding: '10px 22px', borderRadius: 8, border: 'none', background: '#1db954',
                color: '#000', fontSize: 13, fontWeight: 700, cursor: importing ? 'wait' : 'pointer',
                opacity: importing ? 0.65 : 1,
              }}
            >{importing ? 'Importing…' : 'Import files'}</button>
            {window.electronAPI && (
              <button
                type="button"
                onClick={onImportFolder}
                disabled={importing}
                style={{
                  padding: '10px 22px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.05)', color: '#ddd', fontSize: 13, fontWeight: 600,
                  cursor: importing ? 'wait' : 'pointer',
                }}
              >Import folder</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { accent, wash } = themeRgb;
  const heroBg = `linear-gradient(180deg, rgba(${accent},0.48) 0%, rgba(${wash},0.82) 42%, rgba(0,0,0,0.97) 100%)`;
  const listBg = 'linear-gradient(180deg, rgba(0,0,0,0.96) 0%, #000000 100%)';
  const metaMuted = 'rgba(255,255,255,0.72)';
  const colHeader = '#64748b';
  const rowSecondary = '#64748b';
  const rowTertiary = '#475569';
  const idxColor = (isCur) => (isCur ? '#1db954' : '#475569');

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, WebkitAppRegion: 'no-drag',
    }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{
          position: 'relative', flexShrink: 0, padding: '28px 28px 22px', overflow: 'hidden',
        }}
        >
          {themeSource?.coverArt ? (
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: -40,
                backgroundImage: `url(${themeSource.coverArt})`,
                backgroundSize: 'cover', backgroundPosition: 'center',
                filter: 'blur(36px) saturate(1.2)', transform: 'scale(1.1)', opacity: 0.75,
              }}
            />
          ) : null}
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: heroBg }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h1 style={{
              margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: '-0.045em', color: '#fff',
              lineHeight: 1.05, textShadow: '0 2px 24px rgba(0,0,0,0.35)',
            }}
            >LIBRARY</h1>
            <p style={{ margin: '10px 0 0', fontSize: 14, color: metaMuted }}>
              {library.length} {library.length === 1 ? 'track' : 'tracks'} · {formatPlaylistDuration(totalDuration)}
            </p>

            <div style={{
              marginTop: 18, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', maxWidth: 'min(520px, 100%)',
            }}
            >
              <div style={{
                flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.25)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
              >
                <Icons.Search />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search in library"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent', color: '#fff',
                    fontSize: 14, minWidth: 0,
                  }}
                />
              </div>
              {typeof onOpenImmersivePage === 'function' ? (
                <button
                  type="button"
                  title="Open immersive view"
                  onClick={onOpenImmersivePage}
                  style={{
                    width: 42, height: 42, flexShrink: 0, borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)',
                    color: 'rgba(255,255,255,0.85)', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Icons.Immersive />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          background: listBg,
        }}
        >
          <div style={{
            display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center',
            padding: '10px 20px', columnGap: 10,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: colHeader, textAlign: 'center' }}>#</span>
            <span aria-hidden style={{ width: 44 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: colHeader }}>Title</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: colHeader }}>Album</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: colHeader, textAlign: 'right' }}>Time</span>
            {canRemove ? <span aria-hidden style={{ width: 40 }} /> : null}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch' }}>
            {displayedTracks.map((track, i) => {
              const isCur = currentTrack?.id === track.id;
              const isHov = hovered === track.id;
              const isSel = selectedId === track.id;
              return (
                <div
                  key={track.id}
                  onMouseEnter={() => setHovered(track.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelectedId(track.id)}
                  onDoubleClick={() => onPlayTrack(track)}
                  style={{
                    display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center', columnGap: 10,
                    padding: '8px 20px', cursor: 'pointer', userSelect: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: isCur
                      ? 'rgba(29,185,84,0.12)'
                      : isSel
                        ? 'rgba(255,255,255,0.06)'
                        : isHov
                          ? 'rgba(255,255,255,0.03)'
                          : 'transparent',
                    transition: 'background 0.12s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {isHov ? (
                      <button
                        type="button"
                        title={isCur && isPlaying ? 'Pause' : 'Play'}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          (onPlayPauseTrack || onPlayTrack)(track);
                        }}
                        style={{
                          width: 28, height: 28, borderRadius: 6, border: 'none', padding: 0,
                          background: 'rgba(255,255,255,0.14)', color: '#fff', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {isCur && isPlaying ? <Icons.Pause /> : <Icons.Play />}
                      </button>
                    ) : (
                      <span style={{
                        fontSize: 13, fontWeight: 500, color: idxColor(isCur), fontVariantNumeric: 'tabular-nums',
                      }}
                      >{i + 1}</span>
                    )}
                  </div>

                  <div style={{
                    width: 44, height: 44, borderRadius: 6, background: '#141414', overflow: 'hidden', flexShrink: 0,
                  }}
                  >
                    {track.coverArt
                      ? <img src={track.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (
                        <div style={{
                          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: '#334155',
                        }}
                        ><Icons.AlbumSidebar /></div>
                        )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 600, color: isCur ? '#fff' : '#f1f5f9',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.02em',
                    }}
                    >{track.title}</div>
                    <div style={{
                      fontSize: 12, color: rowSecondary, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    >{(track.artist || '').trim() || 'Unknown artist'}</div>
                  </div>

                  <span style={{
                    fontSize: 13, color: rowSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  >{(track.album || '').trim() || '—'}</span>

                  <span style={{
                    fontSize: 12, fontWeight: 500, color: rowTertiary, fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                  }}
                  >{track.duration ? formatTime(track.duration) : '—'}</span>

                  {canRemove ? (
                    <button
                      type="button"
                      title="Remove from library"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveFromLibrary([track.id]);
                      }}
                      style={{
                        width: '100%', height: 34, border: 'none', borderRadius: 6, padding: 0,
                        background: isHov ? 'rgba(255,255,255,0.08)' : 'transparent',
                        color: isHov ? '#f87171' : '#334155', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Icons.Trash />
                    </button>
                  ) : null}
                </div>
              );
            })}
            {!displayedTracks.length ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
                No tracks match “{search}”.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
