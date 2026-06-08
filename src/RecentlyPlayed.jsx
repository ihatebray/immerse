import React, { useMemo } from 'react';

/**
 * RecentlyPlayed — compact horizontal strip of album-art squares
 * showing the most recently played tracks. Sits at the top of the
 * Library tab. Click a tile to play that track.
 *
 * Self-contained: computes its own data from playEvents + library.
 */
export function RecentlyPlayed({ playEvents = [], library = [], accent = '128,128,128', onPlayTrack }) {
  // Build deduplicated recently-played list from play events.
  // Most recent first, max 12 unique tracks.
  const recent = useMemo(() => {
    if (!playEvents || playEvents.length === 0 || !library || library.length === 0) return [];
    const libMap = new Map();
    for (const t of library) libMap.set(t.id, t);

    const seen = new Set();
    const out = [];
    // Walk events from newest to oldest
    for (let i = playEvents.length - 1; i >= 0 && out.length < 12; i--) {
      const ev = playEvents[i];
      if (!ev?.id || seen.has(ev.id)) continue;
      seen.add(ev.id);
      const track = libMap.get(ev.id);
      if (track) out.push(track);
    }
    return out;
  }, [playEvents, library]);

  if (recent.length === 0) return null;

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 2px', marginBottom: 8,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)',
        }}>Recently Played</span>
      </div>
      <div className="rp-strip" style={{
        display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4,
        scrollbarWidth: 'thin',
        WebkitOverflowScrolling: 'touch',
      }}>
        <style>{`.rp-strip::-webkit-scrollbar { height: 3px; } .rp-strip::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; } .rp-strip::-webkit-scrollbar-track { background: transparent; }`}</style>
        {recent.map((t) => (
          <div
            key={t.id}
            title={`${t.title} — ${t.artist || 'Unknown'}`}
            onClick={() => onPlayTrack?.(t, recent)}
            style={{
              flexShrink: 0, width: 44, cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 44, height: 44, borderRadius: 8,
                overflow: 'hidden',
                border: '2px solid transparent',
                transition: 'border-color 0.15s, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
                background: '#1a1a1c',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = `rgba(${accent},0.5)`; e.currentTarget.style.transform = 'scale(1.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {t.coverArt ? (
                <img src={t.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" decoding="async" />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  background: 'rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              )}
            </div>
            <div style={{
              fontSize: 9, color: 'rgba(255,255,255,0.55)', marginTop: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              lineHeight: 1.2,
            }}>{t.title}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginTop: 8 }} />
    </div>
  );
}
