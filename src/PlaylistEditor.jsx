import React, { useState, useEffect, useRef, useMemo } from 'react';

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
          borderRadius: 14,
          background: 'rgba(18,18,20,0.62)',
          backdropFilter: 'blur(30px) saturate(1.6)', WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(${accent},0.12), inset 0 1px 0 rgba(255,255,255,0.07)`,
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
    if (file.size > 25_000_000) {
      reject(new Error('Image too large (max 25MB source file).'));
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
      if (data.length > 35_000_000) {
        setError('Image too large after encoding. Try a smaller image (~25MB source or less).');
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
        background: 'rgba(0,0,0,0.28)',
        // no backdrop blur on the scrim — let the panel's own glass sample the app, matching the context menu
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <form onSubmit={handleSubmit}
        style={{
          width: 'min(420px, 100%)',
          maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          borderRadius: 16,
          background: 'rgba(18,18,20,0.62)',
          backdropFilter: 'blur(30px) saturate(1.6)', WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
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
                width: 96, height: 96, borderRadius: 14, overflow: 'hidden',
                background: coverArt
                  ? '#0f0f0f'
                  : `linear-gradient(150deg, rgba(${accent},0.22), rgba(${accent},0.06) 55%, rgba(255,255,255,0.02))`,
                cursor: 'pointer', position: 'relative',
                border: dragOver ? `2px solid rgba(${accent},0.85)` : '1px solid rgba(255,255,255,0.12)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 6px 18px rgba(0,0,0,0.4)',
                transition: 'border-color 0.15s, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
                transform: coverHover && !coverArt ? 'translateY(-1px)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              {coverArt ? (
                <PlaylistThumb playlist={previewPlaylist} trackCovers={[]} size={96} />
              ) : (
                // Empty state — a clear "add image" affordance, accent-tinted.
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, color: coverHover ? `rgba(${accent},1)` : `rgba(${accent},0.9)`, opacity: coverHover ? 1 : 0.92, transition: 'opacity 0.15s, color 0.15s', pointerEvents: 'none' }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1.6" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: coverHover ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)', transition: 'color 0.15s' }}>Add cover</span>
                </div>
              )}
              {((coverHover && coverArt) || dragOver) ? (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: dragOver ? `rgba(${accent},0.5)` : 'rgba(12,12,14,0.82)',
                  backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 6, color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  pointerEvents: 'none',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>{dragOver ? 'Drop to set' : 'Change'}</span>
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 8, justifyContent: 'center' }}>
              <button type="button" onClick={() => setCoverMode((m) => m === 'url' ? 'preview' : 'url')}
                title="Paste an image URL"
                style={{
                  padding: '4px 10px', borderRadius: 999,
                  border: coverMode === 'url' ? `1px solid rgba(${accent},0.5)` : '1px solid rgba(255,255,255,0.12)',
                  background: coverMode === 'url' ? `rgba(${accent},0.2)` : 'rgba(255,255,255,0.03)',
                  color: coverMode === 'url' ? '#fff' : 'rgba(255,255,255,0.6)',
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                  transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
                }}>
                URL
              </button>
              {coverArt ? (
                <button type="button" onClick={handleRemoveCover}
                  title="Remove cover art"
                  style={{
                    padding: '4px 10px', borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.03)',
                    color: 'rgba(255,255,255,0.55)',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.borderColor = 'rgba(243,114,114,0.4)'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}>
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
              transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
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
              transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
              boxShadow: !hasChanges || saving ? 'none' : `0 2px 12px rgba(${accent},0.2)`,
            }}>
            {submitText}
          </button>
        </div>
      </form>
    </div>
  );
}

export { PlaylistThumb, AddToPlaylistMenu, PlaylistMenuRow, PlaylistEditor };
