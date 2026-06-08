import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * LyricsPickerButton — hover-reveal button that opens a lyrics picker modal.
 * Self-contained: manages its own open/loading/results state internally.
 *
 * Props:
 *   currentTrack  — the track to search for
 *   accent        — RGB accent triple
 *   visible       — whether the button is visible (hover state from parent)
 *   onApply       — fn(candidate) called when user picks a lyrics version
 *   appliedText   — plain text of the lyrics currently applied, used to mark
 *                   which candidate (if any) is the one in use right now
 */
export function LyricsPickerButton({ currentTrack, accent, visible, onApply, appliedText }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleOpen = useCallback(async () => {
    if (!currentTrack) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.searchAllLyrics) {
      console.warn('[lyrics-picker] searchAllLyrics not available');
      return;
    }
    setOpen(true);
    setLoading(true);
    setResults([]);
    setError('');
    try {
      const r = await api.searchAllLyrics({
        title: currentTrack.title, artist: currentTrack.artist,
        album: currentTrack.album, duration: currentTrack.duration,
      });
      if (r?.error) setError(r.error);
      setResults(r?.candidates || []);
    } catch (e) {
      console.error('[lyrics-picker] call failed:', e);
      setError(String(e?.message || e));
      setResults([]);
    }
    setLoading(false);
  }, [currentTrack]);

  // Signature of a lyrics body: strip LRC timestamps, take the first handful
  // of non-empty lines, normalize. Lets us tell which listed candidate is the
  // one currently applied — whether it got there via this picker or the
  // automatic fetch — without depending on an id we may not have.
  const sigOf = (text) => String(text || '')
    .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
    .split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6).join(' ')
    .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const appliedSig = sigOf(appliedText);
  const targetSec = Number(currentTrack?.duration) || 0;
  const matchColor = (absDelta) => {
    if (absDelta == null) return 'rgba(255,255,255,0.45)';
    if (absDelta <= 2) return '#5fd08a';
    if (absDelta <= 5) return '#e3c15a';
    return '#e57373';
  };

  return (
    <>
      <button type="button"
        onClick={handleOpen}
        title="Browse lyrics versions"
        aria-label="Browse lyrics versions"
        style={{
          position: 'absolute', top: 4, right: 72,
          width: 28, height: 28, borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(0,0,0,0.45)',
          color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          transform: visible ? 'translateY(0)' : 'translateY(-4px)',
          transition: 'opacity 0.18s ease, transform 0.18s ease, background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.7)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open ? createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)' }}
            onClick={() => setOpen(false)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 201,
            width: 'min(520px, 90vw)', maxHeight: '75vh',
            background: 'rgba(18,18,20,0.62)',
            backdropFilter: 'blur(30px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Choose lyrics version</div>
                {currentTrack ? (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
                    {currentTrack.artist} — {currentTrack.title}
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={() => setOpen(false)}
                style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
              </button>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 6, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
              {loading ? (
                <div style={{ padding: '28px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                  Searching LRCLIB…
                </div>
              ) : results.length === 0 ? (
                <div style={{ padding: '28px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 1.6 }}>
                  {error
                    ? <><div style={{ color: '#f37272', marginBottom: 6 }}>Error searching LRCLIB</div><div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)' }}>{error}</div></>
                    : 'No lyrics found on LRCLIB for this track.'}
                </div>
              ) : (
                results.map((c, i) => {
                  const durStr = c.duration ? `${Math.floor(c.duration / 60)}:${String(Math.floor(c.duration % 60)).padStart(2, '0')}` : '';
                  const candSig = sigOf(c.syncedLyrics || c.plainLyrics || '');
                  const isApplied = !!appliedSig && !!candSig && candSig === appliedSig;
                  const absDelta = targetSec > 0 && c.duration > 0 ? Math.abs(c.duration - targetSec) : null;
                  return (
                    <div key={c.id || i}
                      onClick={() => { onApply?.(c); setOpen(false); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.18)`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isApplied ? `rgba(${accent},0.1)` : 'transparent'; }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        background: isApplied ? `rgba(${accent},0.1)` : 'transparent',
                        borderLeft: isApplied ? `3px solid rgb(${accent})` : '3px solid transparent',
                        transition: 'background 0.12s cubic-bezier(0.16,1,0.3,1)',
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.trackName}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.artistName}{c.albumName ? ` · ${c.albumName}` : ''}
                          {durStr ? <> · <span style={{ color: matchColor(absDelta), fontWeight: 600 }}>{durStr}</span></> : null}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                        {isApplied ? (
                          <span style={{
                            padding: '3px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            background: `rgba(${accent},0.28)`, color: '#fff',
                            border: `1px solid rgba(${accent},0.5)`,
                          }}>✓ applied</span>
                        ) : null}
                        {c.hasSynced ? (
                          <span style={{
                            padding: '3px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            background: `rgba(${accent},0.25)`, color: '#fff',
                          }}>synced</span>
                        ) : null}
                        {c.hasPlain ? (
                          <span style={{
                            padding: '3px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
                          }}>plain</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>,
        document.body
      ) : null}
    </>
  );
}
