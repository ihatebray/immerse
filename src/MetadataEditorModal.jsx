import React, { useEffect, useState } from 'react';

function fileExtLower(fp) {
  if (!fp || typeof fp !== 'string') return '';
  const m = fp.match(/\.([a-z0-9]+)$/i);
  return m ? `.${m[1].toLowerCase()}` : '';
}

export default function MetadataEditorModal({ track, open, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [year, setYear] = useState('');
  const [genre, setGenre] = useState('');
  const [coverPreview, setCoverPreview] = useState(null);
  const [coverAction, setCoverAction] = useState('keep');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !track) return;
    setTitle(track.title || '');
    setArtist(track.artist || '');
    setAlbum(track.album || '');
    setYear(track.year != null && track.year !== '' ? String(track.year) : '');
    setGenre(typeof track.genre === 'string' ? track.genre : '');
    setCoverPreview(track.coverArt || null);
    setCoverAction('keep');
    setError('');
    setSaving(false);
  }, [open, track?.id]);

  if (!open || !track) return null;

  const ext = fileExtLower(track.filePath);
  const isMp3 = ext === '.mp3';

  const onPickImage = (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => {
      setCoverPreview(String(r.result));
      setCoverAction('replace');
    };
    r.readAsDataURL(f);
    e.target.value = '';
  };

  const handleSave = async () => {
    const api = window.electronAPI;
    if (!api?.saveTrackMetadata) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.saveTrackMetadata({
        id: track.id,
        filePath: track.filePath,
        title,
        artist,
        album,
        year: year.trim() === '' ? null : year,
        genre,
        coverAction,
        coverArtDataUrl: coverAction === 'replace' && coverPreview?.startsWith('data:image/')
          ? coverPreview
          : undefined,
      });
      if (!res?.ok) {
        setError(res?.error || 'Save failed');
        return;
      }
      onSaved?.(res.track, res);
      onClose?.();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 8,
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
  };

  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 5 };

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        WebkitAppRegion: 'no-drag',
      }}
      onMouseDown={() => onClose?.()}
    >
      <div
        role="dialog"
        aria-labelledby="meta-edit-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(420px, 100%)',
          maxHeight: 'min(90vh, 640px)',
          overflow: 'auto',
          borderRadius: 16,
          background: 'rgba(22,22,24,0.92)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.65)',
          padding: '20px 20px 16px',
        }}
      >
        <h2 id="meta-edit-title" style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#fff' }}>
          Edit metadata
        </h2>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 16, wordBreak: 'break-all' }}>
          {track.filePath}
        </div>

        {!isMp3 ? (
          <div style={{
            fontSize: 12,
            color: 'rgba(255,200,120,0.95)',
            background: 'rgba(255,160,60,0.08)',
            border: '1px solid rgba(255,180,80,0.2)',
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 14,
            lineHeight: 1.5,
          }}
          >
            Embedded file tags are only written for MP3. For this file type, changes are saved to your Immersive library database (including artwork).
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 112,
            height: 112,
            borderRadius: 8,
            overflow: 'hidden',
            flexShrink: 0,
            background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          >
            {coverPreview ? (
              <img src={coverPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.25)',
                fontSize: 11,
              }}
              >
                No art
              </div>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <label style={{ cursor: 'pointer' }}>
              <span style={{
                display: 'inline-block',
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e5e5e5',
                fontSize: 12,
                fontWeight: 600,
              }}
              >
                Choose image…
              </span>
              <input type="file" accept="image/*" onChange={onPickImage} style={{ display: 'none' }} />
            </label>
            <button
              type="button"
              onClick={() => {
                setCoverPreview(null);
                setCoverAction('clear');
              }}
              style={{
                alignSelf: 'flex-start',
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.55)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Remove artwork
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="meta-title" style={labelStyle}>Title</label>
            <input id="meta-title" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="meta-artist" style={labelStyle}>Artist</label>
            <input id="meta-artist" value={artist} onChange={(e) => setArtist(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="meta-album" style={labelStyle}>Album</label>
            <input id="meta-album" value={album} onChange={(e) => setAlbum(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label htmlFor="meta-year" style={labelStyle}>Year</label>
              <input
                id="meta-year"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="e.g. 2024"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="meta-genre" style={labelStyle}>Genre</label>
              <input id="meta-genre" value={genre} onChange={(e) => setGenre(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ marginTop: 12, fontSize: 12, color: '#fca5a5' }}>{error}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            type="button"
            onClick={() => onClose?.()}
            disabled={saving}
            style={{
              padding: '8px 16px',
              borderRadius: 9,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              color: 'rgba(255,255,255,0.75)',
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 16px',
              borderRadius: 9,
              border: 'none',
              background: 'rgba(255,255,255,0.14)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
