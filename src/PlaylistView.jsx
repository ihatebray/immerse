import React, { useState, useEffect, useMemo } from 'react';
import Icons from './Icons.jsx';
import { formatTime } from './mediaUtils.js';
import { PlaylistThumb } from './PlaylistEditor.jsx';

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
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button"
              disabled={tracks.length === 0}
              onClick={() => tracks.length > 0 && onPlayTrack(tracks[0], tracks)}
              style={{
                padding: '8px 15px', borderRadius: 10, border: 'none',
                background: tracks.length === 0 ? 'rgba(255,255,255,0.04)' : `rgba(${accent},0.3)`,
                color: tracks.length === 0 ? 'rgba(255,255,255,0.35)' : '#fff',
                fontSize: 11.5, fontWeight: 600, lineHeight: 1,
                cursor: tracks.length === 0 ? 'default' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 7,
                boxShadow: tracks.length === 0 ? 'none' : `0 2px 14px rgba(${accent},0.18)`,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (tracks.length > 0) e.currentTarget.style.background = `rgba(${accent},0.42)`; }}
              onMouseLeave={(e) => { if (tracks.length > 0) e.currentTarget.style.background = `rgba(${accent},0.3)`; }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
                <path d="M8 5v14l11-7z" />
              </svg>
              Play all
            </button>

            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3,
              borderRadius: 11, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <button type="button"
                onClick={() => onEditPlaylist(playlist.id)}
                title="Edit playlist"
                style={{
                  padding: '6px 11px', borderRadius: 8, border: 'none',
                  background: 'transparent', color: 'rgba(255,255,255,0.6)',
                  fontSize: 11, fontWeight: 600, lineHeight: 1, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Edit
              </button>
              <button type="button"
                onClick={handleDelete}
                title={confirmingDelete ? 'Click again to confirm' : 'Delete playlist'}
                style={{
                  padding: '6px 11px', borderRadius: 8, border: 'none',
                  background: confirmingDelete ? 'rgba(243,114,114,0.15)' : 'transparent',
                  color: confirmingDelete ? '#f37272' : 'rgba(255,255,255,0.6)',
                  fontSize: 11, fontWeight: 600, lineHeight: 1, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!confirmingDelete) { e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; e.currentTarget.style.color = '#f37272'; }
                }}
                onMouseLeave={(e) => {
                  if (!confirmingDelete) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }
                }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
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


export { PlaylistView };
