import React, { useState, useEffect, useMemo } from 'react';
import { getFileFormatLabel } from './mediaUtils.js';

function TrackTab({
  currentTrack,
  library = [],
  playEvents = [],
  accent = '48, 48, 48',
  onPlayTrack,
  onFilterByText,
  clickToFilterEnabled = false,
  onTabChange,
  currentTime = 0,
  lyricsData = null,
  onShowLyricsPanel,
  artistInfoEnabled = false,
  lastFmApiKey = '',
  creditsEnabled = false,
  videosEnabled = false,
}) {
  // Empty state — no track playing. Rendered as a calm "nothing to show"
  // card so the user understands the panel is alive and waiting, not broken.
  if (!currentTrack) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '48px 24px', textAlign: 'center',
        color: 'rgba(255,255,255,0.55)', fontSize: 12,
        gap: 14,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 14,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16.5" />
            <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
          Nothing playing
        </div>
        <div style={{ maxWidth: 240, lineHeight: 1.55 }}>
          Play a track and this panel will fill with info: your history with it, more from the album, more from the artist.
        </div>
      </div>
    );
  }

  // --- Derived: this track's stats from the play-event log -----------------
  const stats = useMemo(() => {
    const myEvents = playEvents.filter((ev) => ev && ev.id === currentTrack.id && Number.isFinite(ev.at));
    myEvents.sort((a, b) => a.at - b.at);

    const totalPlays = myEvents.length;
    const firstPlayedAt = myEvents.length ? myEvents[0].at : null;
    const lastPlayedAt = myEvents.length ? myEvents[myEvents.length - 1].at : null;

    // Average plays per month — only meaningful with at least a month of
    // history. Returns null otherwise so the row can be skipped.
    let playsPerMonth = null;
    if (firstPlayedAt) {
      const monthsElapsed = Math.max(1, (Date.now() - firstPlayedAt) / (1000 * 60 * 60 * 24 * 30));
      if (monthsElapsed >= 1) playsPerMonth = totalPlays / monthsElapsed;
    }

    // Longest gap between plays (in days). Only computable with 2+ plays.
    let longestGapDays = null;
    if (myEvents.length >= 2) {
      let max = 0;
      for (let i = 1; i < myEvents.length; i++) {
        const d = myEvents[i].at - myEvents[i - 1].at;
        if (d > max) max = d;
      }
      longestGapDays = max / (1000 * 60 * 60 * 24);
    }

    // Most common hour-of-day and day-of-week for this track. Bucketed
    // into broad parts of the day for human-friendly labelling.
    const hourCounts = new Array(24).fill(0);
    const dowCounts = new Array(7).fill(0);
    for (const ev of myEvents) {
      const d = new Date(ev.at);
      hourCounts[d.getHours()] += 1;
      dowCounts[d.getDay()] += 1;
    }
    const topHour = hourCounts.reduce((best, _c, h) => hourCounts[h] > hourCounts[best] ? h : best, 0);
    const topDow = dowCounts.reduce((best, _c, d) => dowCounts[d] > dowCounts[best] ? d : best, 0);
    const dayPart = (h) => {
      if (h < 5) return 'late nights';
      if (h < 11) return 'mornings';
      if (h < 14) return 'middays';
      if (h < 18) return 'afternoons';
      if (h < 22) return 'evenings';
      return 'nights';
    };
    const dayName = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][topDow];

    return {
      totalPlays,
      firstPlayedAt,
      lastPlayedAt,
      playsPerMonth,
      longestGapDays,
      // Only surface a "you usually play this on …" sentence with at least
      // 3 plays. Below that, the inferred patterns aren't meaningful.
      preferredDayPart: myEvents.length >= 3 ? dayPart(topHour) : null,
      preferredDayName: myEvents.length >= 3 ? dayName : null,
    };
  }, [playEvents, currentTrack.id]);

  // --- Derived: more from this album --------------------------------------
  const moreFromAlbum = useMemo(() => {
    if (!currentTrack.album) return [];
    const albumKey = (currentTrack.album || '').toLowerCase().trim();
    const artistKey = (currentTrack.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    return library
      .filter((t) => {
        if (t.id === currentTrack.id) return false;
        const ta = (t.album || '').toLowerCase().trim();
        const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
        return ta === albumKey && tar === artistKey;
      })
      .sort((a, b) => {
        const an = a.trackNumber || 0;
        const bn = b.trackNumber || 0;
        if (an !== bn) return an - bn;
        return (a.title || '').localeCompare(b.title || '');
      });
  }, [library, currentTrack.id, currentTrack.album, currentTrack.artist]);

  // --- Derived: other albums by this artist -------------------------------
  // Group all library tracks by album for the same artist (excluding the
  // album we're currently in). Pick a representative track per album for
  // the cover, sort by year desc, fallback alphabetical.
  const moreFromArtist = useMemo(() => {
    const artistKey = (currentTrack.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    if (!artistKey) return [];
    const currentAlbumKey = (currentTrack.album || '').toLowerCase().trim();
    const albums = new Map();
    for (const t of library) {
      const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
      if (tar !== artistKey) continue;
      const aKey = (t.album || '').toLowerCase().trim();
      if (!aKey) continue;
      if (aKey === currentAlbumKey) continue;
      const existing = albums.get(aKey);
      if (existing) {
        existing.count += 1;
        // Prefer the lowest-numbered track for the cover (usually track 1
        // has the most "iconic" album art when there's variation).
        if ((t.trackNumber || 99) < (existing.sample.trackNumber || 99)) {
          existing.sample = t;
        }
      } else {
        albums.set(aKey, {
          name: t.album || 'Untitled album',
          year: t.year || null,
          count: 1,
          sample: t,
        });
      }
    }
    const out = Array.from(albums.values());
    out.sort((a, b) => {
      const ay = Number(a.year) || 0;
      const by = Number(b.year) || 0;
      if (ay !== by) return by - ay;
      return (a.name || '').localeCompare(b.name || '');
    });
    return out;
  }, [library, currentTrack.id, currentTrack.album, currentTrack.artist]);

  // --- Helpers ------------------------------------------------------------
  const formatDate = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const formatRelative = (ts) => {
    if (!ts) return '—';
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 30) return `${Math.round(days)} days ago`;
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    return `${(days / 365).toFixed(1)} years ago`;
  };
  const formatDuration = (sec) => {
    if (!sec || !Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Click an album tile — opens the artist's other album in the library
  // by filtering on album name. Reuses the existing filter mechanism so
  // we don't need new navigation plumbing.
  const handleOpenAlbum = (album) => {
    if (!album?.name) return;
    if (clickToFilterEnabled && onFilterByText) {
      onFilterByText(album.name);
    } else if (onTabChange) {
      // No filter feature available — at least take the user to the
      // library so they can find it manually.
      onTabChange('library');
    }
  };

  return (
    <div style={{
      flex: 1, overflowY: 'auto', overflowX: 'hidden',
      overscrollBehavior: 'contain',
      padding: '14px 14px 24px',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      {/* --- Hero strip -------------------------------------------------- */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        padding: 12, borderRadius: 12,
        background: `linear-gradient(135deg, rgba(${accent}, 0.18) 0%, rgba(255,255,255,0.02) 100%)`,
        border: `1px solid rgba(${accent}, 0.2)`,
      }}>
        <div style={{
          width: 84, height: 84, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
          background: 'rgba(0,0,0,0.4)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
        }}>
          {currentTrack.coverArt ? (
            <img src={currentTrack.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            lineHeight: 1.25,
          }}>
            {currentTrack.title || 'Untitled'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4, lineHeight: 1.4 }}>
            {currentTrack.artist || 'Unknown artist'}
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
            {[currentTrack.album, currentTrack.year].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      </div>

      {/* --- About the artist (Last.fm) --------------------------------- */}
      {/* Sits right under the hero so the bio is the first context the
          user sees about whatever is playing. Only renders when the
          feature is enabled AND the current track has an artist name. A
          Last.fm key is no longer required — the bio comes from Wikipedia by
          default; the key just adds tags + listener counts and a bio fallback.
          The component handles its own network state, caching, and offline
          behaviour internally. */}
      {artistInfoEnabled && (currentTrack.artist || '').trim() ? (
        <ArtistInfoSection
          artistName={currentTrack.artist}
          apiKey={lastFmApiKey}
          accent={accent}
          onTagClick={(tag) => {
            if (clickToFilterEnabled && onFilterByText) onFilterByText(tag);
          }}
          tagsClickable={clickToFilterEnabled}
        />
      ) : null}

      {/* --- Your history with this track -------------------------------- */}
      <TrackTabSection title="YOUR HISTORY" accent={accent}>
        {stats.totalPlays === 0 ? (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55 }}>
            You haven’t finished playing this track yet. Once it crosses the scrobble threshold, this panel will start filling in with stats.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TrackStatRow label="Total plays" value={String(stats.totalPlays)} />
            <TrackStatRow
              label="First played"
              value={formatDate(stats.firstPlayedAt)}
              hint={stats.firstPlayedAt ? formatRelative(stats.firstPlayedAt) : null}
            />
            <TrackStatRow
              label="Last played"
              value={formatDate(stats.lastPlayedAt)}
              hint={stats.lastPlayedAt ? formatRelative(stats.lastPlayedAt) : null}
            />
            {stats.playsPerMonth !== null ? (
              <TrackStatRow
                label="Plays per month"
                value={stats.playsPerMonth >= 1
                  ? stats.playsPerMonth.toFixed(1)
                  : stats.playsPerMonth.toFixed(2)}
              />
            ) : null}
            {stats.longestGapDays !== null && stats.longestGapDays >= 1 ? (
              <TrackStatRow
                label="Longest gap"
                value={stats.longestGapDays >= 30
                  ? `${(stats.longestGapDays / 30).toFixed(1)} months`
                  : `${Math.round(stats.longestGapDays)} days`}
              />
            ) : null}
            {stats.preferredDayPart && stats.preferredDayName ? (
              <TrackStatRow
                label="You usually play it"
                value={`${stats.preferredDayName.toLowerCase()}, ${stats.preferredDayPart}`}
              />
            ) : null}
          </div>
        )}
      </TrackTabSection>

      {/* --- More from this album --------------------------------------- */}
      {moreFromAlbum.length > 0 ? (
        <TrackTabSection
          title="MORE FROM THIS ALBUM"
          accent={accent}
          subtitle={currentTrack.album || ''}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {moreFromAlbum.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onPlayTrack?.(t, moreFromAlbum)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px', borderRadius: 6,
                  background: 'transparent', border: 'none',
                  color: 'rgba(255,255,255,0.85)',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: 18, fontSize: 10, color: 'rgba(255,255,255,0.4)',
                  textAlign: 'right', flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {t.trackNumber || ''}
                </span>
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.title || 'Untitled'}
                </span>
                <span style={{
                  fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
                  flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatDuration(t.duration)}
                </span>
              </button>
            ))}
          </div>
        </TrackTabSection>
      ) : null}

      {/* --- More from this artist (other albums) ----------------------- */}
      {moreFromArtist.length > 0 ? (
        <TrackTabSection
          title="MORE FROM THIS ARTIST"
          accent={accent}
          subtitle={currentTrack.artist || ''}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 10,
          }}>
            {moreFromArtist.slice(0, 6).map((album, i) => (
              <button
                key={`${album.name}-${i}`}
                type="button"
                onClick={() => handleOpenAlbum(album)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 6, padding: 6, borderRadius: 8,
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)';
                }}
              >
                <div style={{
                  width: '100%', aspectRatio: '1 / 1', borderRadius: 6, overflow: 'hidden',
                  background: 'rgba(0,0,0,0.4)',
                }}>
                  {album.sample?.coverArt ? (
                    <img src={album.sample.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  width: '100%',
                }}>
                  {album.name}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
                  {[album.year, `${album.count} ${album.count === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </TrackTabSection>
      ) : null}

      {/* --- Watch (YouTube) -------------------------------------------- */}
      {/* Lazy-loaded YouTube embed. The disclosure button is light — no
          iframe mounts until the user clicks. This means: no auto-load
          on track change, no background traffic, no third-party cookies
          set unless the user explicitly chose to watch. The embed uses
          youtube-nocookie.com for privacy-enhanced mode. */}
      {videosEnabled && (currentTrack.title || '').trim() && (currentTrack.artist || '').trim() ? (
        <VideoSection
          title={currentTrack.title}
          artist={currentTrack.artist}
          accent={accent}
        />
      ) : null}

      {/* --- Credits (MusicBrainz) -------------------------------------- */}
      {/* Renders only when the user has opted into credits. The component
          handles its own MusicBrainz lookup, throttling, caching, and
          offline behaviour. Credits are people-data — writers, producers,
          engineers, performers — pulled from the upstream Spotify itself
          uses for its credits panel. */}
      {creditsEnabled && (currentTrack.title || '').trim() && (currentTrack.artist || '').trim() ? (
        <CreditsSection
          title={currentTrack.title}
          artist={currentTrack.artist}
          accent={accent}
        />
      ) : null}

      {/* --- File details ----------------------------------------------- */}
      <TrackTabSection title="DETAILS" accent={accent}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <TrackStatRow label="Duration" value={formatDuration(currentTrack.duration)} />
          {(() => {
            // File format (FLAC / MP3 / M4A / etc.) derived from the
            // file extension. Renders only if we can identify the
            // format; streaming-temp paths return '' and we suppress
            // the row.
            const fmt = getFileFormatLabel(currentTrack.filePath);
            return fmt ? <TrackStatRow label="Format" value={fmt} /> : null;
          })()}
          {currentTrack.year ? <TrackStatRow label="Year" value={String(currentTrack.year)} /> : null}
          {currentTrack.genre ? <TrackStatRow label="Genre" value={currentTrack.genre} /> : null}
          {currentTrack.trackNumber ? (
            <TrackStatRow
              label="Track"
              value={currentTrack.trackTotal
                ? `${currentTrack.trackNumber} of ${currentTrack.trackTotal}`
                : String(currentTrack.trackNumber)}
            />
          ) : null}
        </div>
      </TrackTabSection>
    </div>
  );
}

/**
 * TrackTabSection — header + body with consistent spacing for sections in
 * the Track panel. Header is a small accent-coloured caption; subtitle is
 * the more human-readable context (album name, artist name, etc).
 */
function TrackTabSection({ title, subtitle, accent, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
        color: `rgba(${accent}, 0.95)`,
        textTransform: 'uppercase',
      }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.55)',
          marginTop: -4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {subtitle}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * TrackStatRow — label/value/hint trio for a stat in the YOUR HISTORY or
 * DETAILS sections. Label sits left, value right, with an optional faint
 * hint below the value (e.g. "3 days ago" alongside an absolute date).
 */
function TrackStatRow({ label, value, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
        {label}
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#fff' }}>
          {value}
        </div>
        {hint ? (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}


/* =========================================================================
 *  Last.fm artist-info plumbing.
 *
 *  Free public API, key-only auth, single endpoint we care about:
 *    artist.getInfo  → bio (summary + content), top tags, listener count
 *
 *  Caching:
 *    - Stored in localStorage under `immerse:lastfm:artist:{key}` where
 *      `key` is the artist name lowercased and trimmed to the first
 *      "primary" name (matches the `track.artist` normalization used
 *      elsewhere in the app, e.g. "X feat. Y" → "X").
 *    - Each entry is { fetchedAt, data }. TTL is 24 hours; older entries
 *      are still rendered while a refresh fires in the background, so
 *      offline users keep seeing their last successful fetch.
 *    - Soft eviction: when we'd push past ~200 cached artists we delete
 *      the 50 oldest. Bios are typically <2KB, but cumulative growth in
 *      localStorage (which is capped at ~5MB across the whole origin) is
 *      worth bounding.
 *
 *  Failure modes returned to the caller:
 *    - Network error / offline    → throw with code='offline'
 *    - 401 / invalid key          → throw with code='auth'
 *    - 6 (artist not found)       → throw with code='not_found'
 *    - other Last.fm error codes  → throw with code='error', message included
 * ========================================================================= */
const LASTFM_CACHE_PREFIX = 'immerse:lastfm:artist:';
// Bump when the cached artist-info shape changes. v2 = Wikipedia-first bios
// (older v1/unversioned entries hold a stale Last.fm-only bio, so they're
// treated as a miss and refetched once).
const ARTIST_INFO_CACHE_VERSION = 2;
const LASTFM_TTL_MS = 24 * 60 * 60 * 1000;
const LASTFM_CACHE_LIMIT = 200;

/** Normalize an artist name to the cache key used elsewhere in the app:
 *  lowercase, trimmed, and split on commas/ampersands to get the primary
 *  artist (so "Pino Palladino, Blake Mills" caches under "pino palladino"). */
function lastFmCacheKey(artistName) {
  if (!artistName) return '';
  return (artistName || '')
    .toLowerCase()
    .split(/[,&]/)[0]
    .trim();
}

/** Retrieve a cached entry, or null if missing / unparseable. */
function lastFmCacheGet(artistName) {
  try {
    const key = LASTFM_CACHE_PREFIX + lastFmCacheKey(artistName);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data || !Number.isFinite(parsed.fetchedAt)) return null;
    // Ignore entries written before the Wikipedia-first switch so they refetch.
    if (parsed.v !== ARTIST_INFO_CACHE_VERSION) return null;
    return parsed;
  } catch { return null; }
}

/** Write an entry. Soft-evicts oldest when we go over the cache limit. */
function lastFmCacheSet(artistName, data) {
  try {
    const key = LASTFM_CACHE_PREFIX + lastFmCacheKey(artistName);
    window.localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), v: ARTIST_INFO_CACHE_VERSION, data }));
    // Soft eviction — only run when we suspect we may have gone over the
    // limit, so the common write path is one setItem call.
    const allKeys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(LASTFM_CACHE_PREFIX)) allKeys.push(k);
    }
    if (allKeys.length > LASTFM_CACHE_LIMIT) {
      const entries = allKeys.map((k) => {
        try {
          const v = JSON.parse(window.localStorage.getItem(k) || '{}');
          return { k, ts: Number(v.fetchedAt) || 0 };
        } catch { return { k, ts: 0 }; }
      });
      entries.sort((a, b) => a.ts - b.ts);
      const toEvict = entries.slice(0, 50);
      for (const e of toEvict) window.localStorage.removeItem(e.k);
    }
  } catch { /* ignore quota errors */ }
}

/** Fetch fresh data from Last.fm. Throws categorized errors on failure. */
async function fetchLastFmArtistInfo(artistName, apiKey) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const err = new Error('Offline');
    err.code = 'offline';
    throw err;
  }
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'artist.getInfo');
  url.searchParams.set('artist', lastFmCacheKey(artistName) || (artistName || ''));
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');

  let res;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    const err = new Error('Network failure');
    err.code = 'offline';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.code = res.status === 401 || res.status === 403 ? 'auth' : 'error';
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    const err = new Error('Invalid JSON response');
    err.code = 'error';
    throw err;
  }
  // Last.fm returns `{ error: <code>, message: '...' }` on failure with HTTP 200.
  if (body.error) {
    const err = new Error(body.message || `Last.fm error ${body.error}`);
    err.code = (body.error === 6) ? 'not_found'
      : (body.error === 10 || body.error === 26) ? 'auth'
      : 'error';
    throw err;
  }

  const a = body.artist || {};
  // Use the FULL bio (`content`), not `summary` — the summary is Last.fm's
  // short teaser that always ends in "Read more on Last.fm". Fall back to the
  // summary only if there's no content. Strip the trailing read-more link and
  // keep paragraph breaks for readability.
  const text = stripHtmlBio(a.bio?.content || a.bio?.summary || '');
  const tags = Array.isArray(a.tags?.tag)
    ? a.tags.tag.map((t) => (t.name || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const listeners = Number(a.stats?.listeners) || null;

  return {
    bio: text,
    tags,
    listeners,
    correctedName: a.name || artistName,
  };
}

/** Strip HTML from a Last.fm bio while PRESERVING paragraph breaks (the
 *  `content` field is multi-paragraph, separated by literal newlines). Also
 *  removes the trailing "Read more on Last.fm" anchor Last.fm appends. */
function stripHtmlBio(s) {
  if (!s) return '';
  return s
    // Cut the trailing "Read more on Last.fm" link AND the Creative Commons
    // licence sentence Last.fm appends after it. The link is the last anchor
    // and everything from there to the end is boilerplate, so drop it all —
    // whether or not the phrase is still wrapped in its <a> tag.
    .replace(/(?:<a\b[^>]*>)?\s*Read more on Last\.fm[\s\S]*$/i, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Belt-and-suspenders for any boilerplate that survived tag-stripping.
    .replace(/\s*User-contributed text is available under[\s\S]*$/i, '')
    .replace(/\s*Read more on Last\.fm[\s\S]*$/i, '')
    .replace(/[ \t]+/g, ' ')      // collapse spaces but keep newlines
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')   // cap blank-line runs
    .trim();
}

/** Strip HTML tags from a string and collapse whitespace. Good enough for
 *  Last.fm bio summaries which only use a handful of inline tags. */
function stripHtmlTags(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/* =========================================================================
 *  Wikipedia artist bio (primary source) + orchestration with Last.fm.
 *
 *  Wikipedia is better-maintained and fuller than Last.fm for notable
 *  artists, and needs no API key. We reach the right article the canonical
 *  way: MusicBrainz artist → its Wikidata relation → the English Wikipedia
 *  sitelink → the article's intro extract. Last.fm stays as the fallback for
 *  artists Wikipedia hasn't covered, and remains the source for tags +
 *  listener counts (which Wikipedia doesn't provide) when a key is set.
 * ========================================================================= */

/** Fetch an artist bio from Wikipedia via MusicBrainz → Wikidata. Throws
 *  categorized errors (offline / not_found / error) so the caller can fall
 *  back to Last.fm. */
async function fetchWikipediaArtistBio(artistName) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const err = new Error('Offline'); err.code = 'offline'; throw err;
  }
  const primary = primaryArtistName(artistName) || artistName;

  // 1. Find the artist on MusicBrainz.
  const searchUrl = new URL('https://musicbrainz.org/ws/2/artist/');
  searchUrl.searchParams.set('query', `artist:"${primary.replace(/"/g, '\\"')}"`);
  searchUrl.searchParams.set('limit', '5');
  searchUrl.searchParams.set('fmt', 'json');
  searchUrl.searchParams.set('app', 'immerse');
  let mbid = null;
  let mbName = primary;
  {
    let res;
    try { res = await mbScheduledFetch(searchUrl.toString()); }
    catch { const e = new Error('Network'); e.code = 'offline'; throw e; }
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.code = 'error'; throw e; }
    const body = await res.json();
    const artists = Array.isArray(body.artists) ? body.artists : [];
    const want = normalizeMatch(primary);
    const hit = artists.find((a) => Number(a.score) >= 80 && normalizeMatch(a.name) === want)
      || artists.find((a) => Number(a.score) >= 90)
      || artists[0];
    if (hit?.id) { mbid = hit.id; mbName = hit.name || primary; }
  }
  if (!mbid) { const e = new Error('No MusicBrainz artist'); e.code = 'not_found'; throw e; }

  // 2. Look up the artist's URL relations to find Wikidata / Wikipedia.
  const relUrl = new URL(`https://musicbrainz.org/ws/2/artist/${mbid}`);
  relUrl.searchParams.set('inc', 'url-rels');
  relUrl.searchParams.set('fmt', 'json');
  relUrl.searchParams.set('app', 'immerse');
  let wikidataId = null;
  let wikiTitle = null;
  {
    let res;
    try { res = await mbScheduledFetch(relUrl.toString()); }
    catch { const e = new Error('Network'); e.code = 'offline'; throw e; }
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.code = 'error'; throw e; }
    const body = await res.json();
    for (const rel of (body.relations || [])) {
      const resource = rel.url?.resource || '';
      if (rel.type === 'wikidata') {
        const m = resource.match(/Q\d+/);
        if (m) wikidataId = m[0];
      } else if (rel.type === 'wikipedia') {
        const m = resource.match(/\/wiki\/([^?#]+)$/);
        if (m && !wikiTitle) wikiTitle = decodeURIComponent(m[1]).replace(/_/g, ' ');
      }
    }
  }

  // 3. Resolve the Wikidata id to the English Wikipedia article title.
  if (!wikiTitle && wikidataId) {
    const wdUrl = new URL('https://www.wikidata.org/w/api.php');
    wdUrl.searchParams.set('action', 'wbgetentities');
    wdUrl.searchParams.set('ids', wikidataId);
    wdUrl.searchParams.set('props', 'sitelinks');
    wdUrl.searchParams.set('sitefilter', 'enwiki');
    wdUrl.searchParams.set('format', 'json');
    wdUrl.searchParams.set('origin', '*');
    try {
      const res = await fetch(wdUrl.toString());
      if (res.ok) {
        const body = await res.json();
        wikiTitle = body.entities?.[wikidataId]?.sitelinks?.enwiki?.title || null;
      }
    } catch { /* fall through to not_found */ }
  }
  if (!wikiTitle) { const e = new Error('No Wikipedia article'); e.code = 'not_found'; throw e; }

  // 4. Pull the article's intro as plain text.
  const wpUrl = new URL('https://en.wikipedia.org/w/api.php');
  wpUrl.searchParams.set('action', 'query');
  wpUrl.searchParams.set('prop', 'extracts');
  wpUrl.searchParams.set('exintro', '1');
  wpUrl.searchParams.set('explaintext', '1');
  wpUrl.searchParams.set('redirects', '1');
  wpUrl.searchParams.set('format', 'json');
  wpUrl.searchParams.set('origin', '*');
  wpUrl.searchParams.set('titles', wikiTitle);
  let extract = '';
  {
    let res;
    try { res = await fetch(wpUrl.toString()); }
    catch { const e = new Error('Network'); e.code = 'offline'; throw e; }
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.code = 'error'; throw e; }
    const body = await res.json();
    const pages = body.query?.pages || {};
    const first = Object.values(pages)[0];
    extract = (first?.extract || '').trim();
  }
  if (!extract) { const e = new Error('Empty extract'); e.code = 'not_found'; throw e; }

  return {
    bio: extract.replace(/\n{3,}/g, '\n\n').trim(),
    correctedName: mbName,
    source: 'wikipedia',
  };
}

/** Orchestrate the two sources: Wikipedia bio first, Last.fm as fallback (and
 *  as the source of tags + listener counts when a key is present). Returns the
 *  combined shape the section renders; throws only when BOTH come up empty. */
async function fetchArtistInfo(artistName, apiKey) {
  let wiki = null;
  let wikiErr = null;
  try { wiki = await fetchWikipediaArtistBio(artistName); }
  catch (e) { wikiErr = e; }

  let lastfm = null;
  let lastfmErr = null;
  if (apiKey) {
    try { lastfm = await fetchLastFmArtistInfo(artistName, apiKey); }
    catch (e) { lastfmErr = e; }
  }

  const bio = wiki?.bio || lastfm?.bio || '';
  const source = wiki?.bio ? 'wikipedia' : (lastfm?.bio ? 'lastfm' : null);
  const tags = lastfm?.tags || [];
  const listeners = lastfm?.listeners || null;
  const correctedName = (source === 'wikipedia' ? wiki?.correctedName : lastfm?.correctedName) || artistName;

  if (!bio && !tags.length && !listeners) {
    const err = new Error('No artist info');
    err.code = (wikiErr?.code === 'offline' || lastfmErr?.code === 'offline') ? 'offline'
      : (lastfmErr?.code === 'auth') ? 'auth'
      : 'not_found';
    throw err;
  }
  return { bio, tags, listeners, correctedName, source };
}

/* =========================================================================
 *  ArtistInfoSection — renders the artist bio (Wikipedia first, Last.fm
 *  fallback) plus Last.fm tags + listener count. Self-contained: handles its
 *  own fetch, cache reads/writes, retry, and offline state.
 *
 *  Lifecycle:
 *    - On mount or when artistName / apiKey changes:
 *        1. Try cache. If fresh (< TTL), render immediately and stop.
 *        2. If cache is stale or missing, render any stale data we have
 *           (so the user sees the last bio while the refresh runs) and
 *           kick off a fetch.
 *        3. On fetch success: write cache and re-render.
 *        4. On fetch failure: keep showing stale data if any; otherwise
 *           render a calm error state.
 *
 *  The component never throws — all errors are caught and presented in
 *  the UI as small, readable copy.
 * ========================================================================= */
function ArtistInfoSection({ artistName, apiKey, accent, onTagClick, tagsClickable }) {
  // null = unloaded; { ... } = data; { error: code } = error state
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    // Reset when there's no artist. A Last.fm key is NO LONGER required — the
    // bio comes from Wikipedia by default; the key only adds tags + listeners.
    if (!artistName) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }

    let cancelled = false;
    const cached = lastFmCacheGet(artistName);
    const isFresh = cached && (Date.now() - cached.fetchedAt) < LASTFM_TTL_MS;

    // Render cached data immediately if any. If stale, this will be
    // replaced below when the refresh resolves.
    if (cached) {
      setState({ status: isFresh ? 'ok' : 'ok-stale', data: cached.data, error: null });
    } else {
      setState({ status: 'loading', data: null, error: null });
    }

    if (isFresh) return undefined; // No need to refetch.

    fetchArtistInfo(artistName, apiKey)
      .then((data) => {
        if (cancelled) return;
        lastFmCacheSet(artistName, data);
        setState({ status: 'ok', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // If we already had stale data, keep showing it; the section
        // header will just note that we couldn't refresh.
        if (cached) {
          setState({ status: 'ok-stale', data: cached.data, error: err?.code || 'error' });
        } else {
          setState({ status: 'error', data: null, error: err?.code || 'error' });
        }
      });

    return () => { cancelled = true; };
  }, [artistName, apiKey]);

  // Don't render the section frame at all when we have no data and no
  // meaningful state to communicate.
  if (state.status === 'idle') return null;

  const subtitle = state.data?.correctedName && state.data.correctedName.toLowerCase() !== (artistName || '').toLowerCase()
    ? `Showing info for ${state.data.correctedName}`
    : null;

  return (
    <TrackTabSection title="ABOUT THE ARTIST" accent={accent} subtitle={subtitle}>
      {state.status === 'loading' ? (
        <div style={{
          fontSize: 11.5, color: 'rgba(255,255,255,0.45)',
          fontStyle: 'italic',
        }}>
          Loading…
        </div>
      ) : null}

      {state.status === 'error' ? (
        <ArtistInfoError code={state.error} accent={accent} />
      ) : null}

      {state.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state.data.bio ? (
            <div style={{
              fontSize: 12, lineHeight: 1.6,
              color: 'rgba(255,255,255,0.78)',
              whiteSpace: 'pre-line',
              // Cap to a reasonable height so a long bio doesn't dominate
              // the whole tab; it scrolls past that.
              maxHeight: 240, overflowY: 'auto',
              paddingRight: 4,
            }}>
              {state.data.bio || 'No biography available.'}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              No biography available for this artist.
            </div>
          )}

          {state.data.tags?.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {state.data.tags.map((tag) => (
                <ArtistInfoTag
                  key={tag}
                  tag={tag}
                  accent={accent}
                  clickable={tagsClickable}
                  onClick={tagsClickable ? () => onTagClick?.(tag) : null}
                />
              ))}
            </div>
          ) : null}

          {state.data.listeners ? (
            <div style={{
              fontSize: 10.5, color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.02em',
            }}>
              {state.data.listeners.toLocaleString()} listeners on Last.fm
              {state.status === 'ok-stale' ? ' · couldn’t refresh just now' : ''}
            </div>
          ) : null}

          {state.data.bio && state.data.source ? (
            <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.02em' }}>
              {state.data.source === 'wikipedia' ? 'Bio from Wikipedia (CC BY-SA)' : 'Bio from Last.fm'}
            </div>
          ) : null}
        </div>
      ) : null}
    </TrackTabSection>
  );
}

/** Friendly per-code error message. The code values come from
 *  fetchLastFmArtistInfo above. */
function ArtistInfoError({ code, accent }) {
  let msg;
  switch (code) {
    case 'offline':   msg = 'You’re offline — couldn’t reach Last.fm.'; break;
    case 'auth':      msg = 'Last.fm rejected the API key. Check Settings.'; break;
    case 'not_found': msg = 'Last.fm has no info for this artist.'; break;
    default:          msg = 'Couldn’t fetch artist info from Last.fm.'; break;
  }
  return (
    <div style={{
      fontSize: 11.5, color: 'rgba(255,255,255,0.5)',
      lineHeight: 1.55,
      padding: '8px 10px', borderRadius: 7,
      background: `rgba(${accent}, 0.04)`,
      border: `1px solid rgba(${accent}, 0.10)`,
    }}>
      {msg}
    </div>
  );
}

/** Single tag chip. Clickable variant filters the library by the tag text;
 *  non-clickable just displays. Hover lifts and brightens. */
function ArtistInfoTag({ tag, accent, clickable, onClick }) {
  const [hovered, setHovered] = useState(false);
  const Tag = clickable ? 'button' : 'span';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '3px 9px', borderRadius: 11,
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em',
        color: hovered && clickable ? '#fff' : 'rgba(255,255,255,0.78)',
        background: hovered && clickable
          ? `rgba(${accent}, 0.22)`
          : `rgba(${accent}, 0.10)`,
        border: `1px solid rgba(${accent}, ${hovered && clickable ? 0.4 : 0.2})`,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
    >
      {tag}
    </Tag>
  );
}


/* =========================================================================
 *  MusicBrainz credits plumbing.
 *
 *  MusicBrainz is the upstream that Spotify's credits panel ultimately
 *  derives from (via licensed pipelines — we go direct). Two-step lookup:
 *
 *    1. Search /ws/2/recording with title + artist as a query. Take the
 *       top match if its score is above 85; otherwise treat as failed.
 *    2. Fetch /ws/2/recording/{mbid} with `inc=artist-credits+work-rels+
 *       artist-rels+release-rels` to get all the people-relations.
 *    3. If the recording has work relations, fetch /ws/2/work/{mbid}
 *       with `inc=artist-rels` to pull writers / composers / lyricists
 *       (those are stored on the work, not the recording).
 *
 *  Caching: keyed by lowercase(artist) + '|' + lowercase(title), TTL
 *  7 days. Credits don't change once set, so a long TTL is fine.
 *
 *  Throttle: MusicBrainz asks for ≤1 req/sec etiquette. Implemented as
 *  a global serial promise queue so two TrackTab instances (or rapid
 *  track skips) can never burst out a flurry of requests. Each request
 *  waits at least 1100ms after the previous one resolved.
 *
 *  User-Agent: required by MusicBrainz to identify the app. Browsers
 *  block setting User-Agent from JS, but the Origin header serves the
 *  same identification purpose for client-side calls — we just include
 *  a courteous `app=immerse` query param so it shows in MusicBrainz's
 *  request logs.
 * ========================================================================= */
const MB_CACHE_PREFIX = 'immerse:mb:rec:';
const MB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MB_CACHE_LIMIT = 200;
const MB_MIN_INTERVAL_MS = 1100; // honour MusicBrainz 1 req/sec etiquette

// Module-level serial queue ensures global rate limiting across all
// CreditsSection instances. Each call schedules itself on top of the last
// one and waits the minimum interval after it resolved.
let mbLastRequestAt = 0;
let mbQueueTail = Promise.resolve();

function mbScheduledFetch(url) {
  const next = mbQueueTail.then(async () => {
    const elapsed = Date.now() - mbLastRequestAt;
    const wait = Math.max(0, MB_MIN_INTERVAL_MS - elapsed);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(url, {
        // MusicBrainz uses `Accept: application/json` to return JSON
        // instead of XML.
        headers: { 'Accept': 'application/json' },
      });
      mbLastRequestAt = Date.now();
      return res;
    } catch (e) {
      mbLastRequestAt = Date.now();
      throw e;
    }
  });
  // Ensure the chain doesn't leak unhandled rejections — every link in
  // the queue should resolve so the next one can run.
  mbQueueTail = next.catch(() => {});
  return next;
}

/** Cache key for a (artist, title) pair. Lowercases and trims the primary
 *  artist name (matching the rest of the app's "X feat. Y" → "X" semantics)
 *  so case differences and feature credits don't fragment the cache. */
function mbCacheKey(artist, title) {
  const a = (artist || '').toLowerCase().split(/[,&]/)[0].trim();
  const t = (title || '').toLowerCase().trim();
  return `${a}|${t}`;
}

function mbCacheGet(artist, title) {
  try {
    const raw = window.localStorage.getItem(MB_CACHE_PREFIX + mbCacheKey(artist, title));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data || !Number.isFinite(parsed.fetchedAt)) return null;
    return parsed;
  } catch { return null; }
}

function mbCacheSet(artist, title, data) {
  try {
    const k = MB_CACHE_PREFIX + mbCacheKey(artist, title);
    window.localStorage.setItem(k, JSON.stringify({ fetchedAt: Date.now(), data }));
    // Soft eviction.
    const allKeys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const kk = window.localStorage.key(i);
      if (kk && kk.startsWith(MB_CACHE_PREFIX)) allKeys.push(kk);
    }
    if (allKeys.length > MB_CACHE_LIMIT) {
      const entries = allKeys.map((kk) => {
        try {
          const v = JSON.parse(window.localStorage.getItem(kk) || '{}');
          return { k: kk, ts: Number(v.fetchedAt) || 0 };
        } catch { return { k: kk, ts: 0 }; }
      });
      entries.sort((a, b) => a.ts - b.ts);
      for (const e of entries.slice(0, 50)) window.localStorage.removeItem(e.k);
    }
  } catch { /* ignore */ }
}

/** Reduce a track artist to its primary name for MusicBrainz matching:
 *  "Drake feat. 21 Savage" → "Drake", "Pino Palladino, Blake Mills" → first. */
function primaryArtistName(artist) {
  return (artist || '')
    .split(/\s*(?:feat\.?|ft\.?|featuring|,|&|;)\s*/i)[0]
    .trim();
}

/** Strip the decorations MusicBrainz doesn't carry in a recording title:
 *  "(feat. X)", "[Live]", "- Remastered 2011", "(Radio Edit)", etc. So a
 *  Spotify-style decorated title can still match MusicBrainz's clean one. */
function cleanTrackTitle(title) {
  return (title || '')
    .replace(/\s*[([][^)\]]*\b(?:feat|ft|featuring|with|remaster(?:ed)?|remix|live|acoustic|deluxe|edition|version|edit|mono|stereo|mix|bonus|demo|instrumental|explicit|clean|anniversary)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|remix|live|acoustic|deluxe|edition|version|radio edit|edit|mono|stereo|single version|album version)\b.*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Loose normalization for comparing titles/names: lowercase, strip accents
 *  and punctuation down to spaces. */
function normalizeMatch(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Fetch credits for a (artist, title) pair from MusicBrainz. Throws
 *  categorized errors on failure (offline, not_found, error). */
async function fetchMusicBrainzCredits(artist, title) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const err = new Error('Offline');
    err.code = 'offline';
    throw err;
  }

  // Step 1: search for a recording matching artist + title. Clean both first
  // so featured artists / "- Remastered" tags don't sink the match.
  const cleanTitle = cleanTrackTitle(title) || title;
  const primaryArtist = primaryArtistName(artist) || artist;
  const query = `recording:"${cleanTitle.replace(/"/g, '\\"')}" AND artist:"${primaryArtist.replace(/"/g, '\\"')}"`;
  const searchUrl = new URL('https://musicbrainz.org/ws/2/recording/');
  searchUrl.searchParams.set('query', query);
  searchUrl.searchParams.set('limit', '10');
  searchUrl.searchParams.set('fmt', 'json');
  searchUrl.searchParams.set('app', 'immerse');

  let searchRes;
  try {
    searchRes = await mbScheduledFetch(searchUrl.toString());
  } catch {
    const err = new Error('Network failure');
    err.code = 'offline';
    throw err;
  }
  if (!searchRes.ok) {
    const err = new Error(`HTTP ${searchRes.status}`);
    err.code = 'error';
    throw err;
  }
  let searchBody;
  try { searchBody = await searchRes.json(); }
  catch { const err = new Error('Invalid JSON'); err.code = 'error'; throw err; }

  const recordings = Array.isArray(searchBody.recordings) ? searchBody.recordings : [];
  // Choose the best candidate. Rather than demanding a high raw search score
  // (which rejected most valid matches), accept a moderate score AS LONG AS
  // the recording's title and artist actually line up with what we searched —
  // that guard keeps us from showing credits for the wrong song. Only if no
  // title match exists do we fall back to a very high score.
  const wantTitle = normalizeMatch(cleanTitle);
  const wantArtist = normalizeMatch(primaryArtist);
  const titleMatches = (r) => {
    const rt = normalizeMatch(r.title);
    return rt === wantTitle || rt.includes(wantTitle) || wantTitle.includes(rt);
  };
  const artistMatches = (r) => {
    if (!wantArtist) return true;
    const ac = Array.isArray(r['artist-credit'])
      ? r['artist-credit'].map((x) => normalizeMatch(x.name || x.artist?.name || '')).join(' ')
      : '';
    return ac.includes(wantArtist) || wantArtist.split(' ').every((w) => ac.includes(w));
  };
  const top =
    recordings.find((r) => Number(r.score) >= 70 && titleMatches(r) && artistMatches(r))
    || recordings.find((r) => Number(r.score) >= 70 && titleMatches(r))
    || recordings.find((r) => Number(r.score) >= 92);
  if (!top || !top.id) {
    const err = new Error('No match');
    err.code = 'not_found';
    throw err;
  }

  // Step 2: fetch the full recording with relations included.
  const lookupUrl = new URL(`https://musicbrainz.org/ws/2/recording/${top.id}`);
  lookupUrl.searchParams.set('inc', 'artist-credits+work-rels+artist-rels+release-rels');
  lookupUrl.searchParams.set('fmt', 'json');
  lookupUrl.searchParams.set('app', 'immerse');

  let lookupRes;
  try { lookupRes = await mbScheduledFetch(lookupUrl.toString()); }
  catch { const err = new Error('Network failure'); err.code = 'offline'; throw err; }
  if (!lookupRes.ok) {
    const err = new Error(`HTTP ${lookupRes.status}`);
    err.code = 'error';
    throw err;
  }
  let recording;
  try { recording = await lookupRes.json(); }
  catch { const err = new Error('Invalid JSON'); err.code = 'error'; throw err; }

  // Collect role → names from recording-level relations. MusicBrainz uses
  // a `type` field with values like 'producer', 'mix', 'mastering',
  // 'recording', 'instrument', 'vocal', 'performer', etc.
  const roles = new Map();
  const addRole = (label, name) => {
    if (!label || !name) return;
    if (!roles.has(label)) roles.set(label, new Set());
    roles.get(label).add(name);
  };

  for (const rel of (recording.relations || [])) {
    const target = rel.artist?.name;
    if (!target) continue;
    const t = rel.type;
    // Map MusicBrainz role types to display labels.
    if (t === 'producer') addRole('Producer', target);
    else if (t === 'mix') addRole('Mixed by', target);
    else if (t === 'mastering') addRole('Mastered by', target);
    else if (t === 'recording') addRole('Recording', target);
    else if (t === 'engineer') addRole('Engineer', target);
    else if (t === 'instrument') {
      // Attribute on this relation tells us which instrument; concat for
      // a richer label like "Guitar". When attribute missing fall back
      // to the generic "Performer".
      const instr = (rel.attributes && rel.attributes[0]) || 'Performer';
      const label = instr.charAt(0).toUpperCase() + instr.slice(1);
      addRole(label, target);
    }
    else if (t === 'vocal') {
      const v = (rel.attributes && rel.attributes[0]) || 'vocals';
      const label = v.charAt(0).toUpperCase() + v.slice(1);
      addRole(label, target);
    }
    else if (t === 'performer') addRole('Performer', target);
    else if (t === 'remixer') addRole('Remixer', target);
  }

  // Step 3: chase work relations for writer/composer/lyricist credits.
  // Multiple works are uncommon but possible; we lookup the first one.
  const workRel = (recording.relations || []).find((r) => r.work?.id);
  if (workRel?.work?.id) {
    const workUrl = new URL(`https://musicbrainz.org/ws/2/work/${workRel.work.id}`);
    workUrl.searchParams.set('inc', 'artist-rels');
    workUrl.searchParams.set('fmt', 'json');
    workUrl.searchParams.set('app', 'immerse');
    try {
      const wRes = await mbScheduledFetch(workUrl.toString());
      if (wRes.ok) {
        const work = await wRes.json();
        for (const rel of (work.relations || [])) {
          const target = rel.artist?.name;
          if (!target) continue;
          if (rel.type === 'composer')   addRole('Composer', target);
          else if (rel.type === 'lyricist') addRole('Lyricist', target);
          else if (rel.type === 'writer')   addRole('Writer', target);
          else if (rel.type === 'arranger') addRole('Arranger', target);
        }
      }
    } catch {
      // Work lookup failure is non-fatal — we still have recording-level
      // credits to show.
    }
  }

  // Convert Map<role, Set<name>> → array of { role, names } sorted in a
  // semantic display order: writers first, then producers, then engineers,
  // then performers, then everything else.
  const roleOrder = [
    'Writer', 'Composer', 'Lyricist', 'Arranger',
    'Producer', 'Remixer',
    'Mixed by', 'Mastered by', 'Recording', 'Engineer',
  ];
  const out = [];
  for (const role of roleOrder) {
    if (roles.has(role)) {
      out.push({ role, names: Array.from(roles.get(role)) });
      roles.delete(role);
    }
  }
  // Anything left (instrument-specific roles like "Guitar", "Vocals",
  // "Drums") goes after, sorted alphabetically.
  const remaining = Array.from(roles.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [role, names] of remaining) {
    out.push({ role, names: Array.from(names) });
  }

  return {
    credits: out,
    matchedTitle: recording.title || title,
  };
}


/* =========================================================================
 *  CreditsSection — renders MusicBrainz credits for the playing track.
 *  Self-contained: own fetch, cache, retry, offline state.
 *
 *  Lifecycle mirrors ArtistInfoSection: cache-first render, stale-while-
 *  revalidate, all errors caught to user-readable copy.
 * ========================================================================= */
function CreditsSection({ title, artist, accent }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (!title || !artist) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }

    let cancelled = false;
    const cached = mbCacheGet(artist, title);
    const isFresh = cached && (Date.now() - cached.fetchedAt) < MB_TTL_MS;

    if (cached) {
      setState({ status: isFresh ? 'ok' : 'ok-stale', data: cached.data, error: null });
    } else {
      setState({ status: 'loading', data: null, error: null });
    }

    if (isFresh) return undefined;

    fetchMusicBrainzCredits(artist, title)
      .then((data) => {
        if (cancelled) return;
        mbCacheSet(artist, title, data);
        setState({ status: 'ok', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        if (cached) {
          setState({ status: 'ok-stale', data: cached.data, error: err?.code || 'error' });
        } else {
          setState({ status: 'error', data: null, error: err?.code || 'error' });
        }
      });

    return () => { cancelled = true; };
  }, [artist, title]);

  if (state.status === 'idle') return null;

  const noCredits = state.data && state.data.credits.length === 0;

  return (
    <TrackTabSection title="CREDITS" accent={accent}>
      {state.status === 'loading' ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
          Loading…
        </div>
      ) : null}

      {state.status === 'error' ? (
        <CreditsError code={state.error} accent={accent} />
      ) : null}

      {state.data && !noCredits ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {state.data.credits.map(({ role, names }) => (
            <div key={role} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                flexShrink: 0, width: 90,
                fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
                paddingTop: 1,
              }}>
                {role}
              </div>
              <div style={{
                flex: 1, fontSize: 11.5, fontWeight: 500,
                color: 'rgba(255,255,255,0.85)', lineHeight: 1.55,
              }}>
                {names.join(', ')}
              </div>
            </div>
          ))}
          {state.status === 'ok-stale' ? (
            <div style={{
              fontSize: 10, color: 'rgba(255,255,255,0.35)',
              marginTop: 4, fontStyle: 'italic',
            }}>
              couldn’t refresh just now
            </div>
          ) : null}
        </div>
      ) : null}

      {noCredits ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
          No credits listed on MusicBrainz for this track.
        </div>
      ) : null}
    </TrackTabSection>
  );
}

/** Friendly error messaging for credit fetch failures. */
function CreditsError({ code, accent }) {
  let msg;
  switch (code) {
    case 'offline':   msg = 'You’re offline — couldn’t reach MusicBrainz.'; break;
    case 'not_found': msg = 'Couldn’t find this track on MusicBrainz.'; break;
    default:          msg = 'Couldn’t fetch credits from MusicBrainz.'; break;
  }
  return (
    <div style={{
      fontSize: 11.5, color: 'rgba(255,255,255,0.5)',
      lineHeight: 1.55,
      padding: '8px 10px', borderRadius: 7,
      background: `rgba(${accent}, 0.04)`,
      border: `1px solid rgba(${accent}, 0.10)`,
    }}>
      {msg}
    </div>
  );
}


/* =========================================================================
 *  VideoSection — "Watch on YouTube" link for the playing track.
 *
 *  Originally this used `youtube-nocookie.com/embed?listType=search&list=`
 *  to lazy-load a YouTube search-result iframe directly in the panel.
 *  That approach was deprecated by Google on 2020-11-15 and now returns
 *  4xx errors ("Video unavailable"). The official replacement requires
 *  the YouTube Data API key + quota management.
 *
 *  Even with a key, embedding music tracks is fragile: labels frequently
 *  disable embed permissions on official videos, so users would still
 *  hit "Video unavailable" much of the time. Better to skip embedding
 *  entirely and just open YouTube's search results page in the user's
 *  default browser, where they can pick the right video themselves.
 *
 *  This means: zero network traffic from the panel, no third-party
 *  cookies, no API key needed, no embed restrictions to fight. Click →
 *  browser opens to YouTube search.
 * ========================================================================= */
function VideoSection({ title, artist, accent }) {
  const [hovered, setHovered] = useState(false);
  const query = `${artist} ${title} official music video`;
  const externalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  // Launches YouTube in the user's default browser via Electron's
  // shell.openExternal IPC. Falls back to window.open for non-Electron
  // contexts (dev preview).
  const handleClick = (e) => {
    e.preventDefault();
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (api && typeof api.openExternal === 'function') {
      api.openExternal(externalUrl);
    } else {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <TrackTabSection title="WATCH" accent={accent}>
      <a
        href={externalUrl}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '10px 12px', borderRadius: 8,
          background: hovered ? `rgba(${accent}, 0.22)` : `rgba(${accent}, 0.12)`,
          border: `1px solid rgba(${accent}, ${hovered ? 0.45 : 0.25})`,
          color: 'rgba(255,255,255,0.9)',
          fontSize: 11.5, fontWeight: 600,
          textDecoration: 'none',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Play icon */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
          Search YouTube for this track
        </span>
        {/* External-link glyph — visual reinforcement that this leaves
            the app and opens in the user's default browser. */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.6 }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </a>
    </TrackTabSection>
  );
}

export { TrackTab, TrackTabSection, TrackStatRow, ArtistInfoSection, ArtistInfoError, ArtistInfoTag, CreditsSection, CreditsError, VideoSection };
