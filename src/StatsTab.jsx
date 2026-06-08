import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { formatTime } from './mediaUtils.js';

function StatsTab({ library, playlists, onPlayTrack, accent = '48, 48, 48', playEvents = [], onResetStats, rangeTabsEnabled = true }) {
  // Time range for the top-tracks/albums/artists lists. 'all' uses the
  // per-track playCount aggregate (which is all-time and survives DB
  // event pruning); 'day'/'week'/'month' filter the play-event log to
  // the matching window and count plays from there.
  const [rangeRaw, setRange] = useState('all');
  // When the user has hidden the range tabs in settings, collapse the
  // entire tab to All Time regardless of what was selected before the
  // toggle flipped. Without this, a previously-selected Day/Week/Month
  // would silently keep filtering even though the picker is gone.
  const range = rangeTabsEnabled ? rangeRaw : 'all';
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Pre-compute everything in one big memo since the inputs only change
  // when library, the play-event log, or the active range does. Avoids
  // running multiple sort/group passes per render.
  const stats = useMemo(() => {
    const totalTracks = library.length;
    if (totalTracks === 0) {
      return {
        empty: true, totalTracks: 0, totalHours: 0, totalPlays: 0, favoritesCount: 0,
        topTracks: [], topAlbums: [], topArtists: [], rediscover: [],
        playsLast7: 0, playsPrior7: 0,
      };
    }

    const now = Date.now();
    // Range cutoff: calendar-aligned, not rolling. So "Day" means since
    // local midnight today (a play from 11:30pm yesterday isn't in
    // today's stats even though it's <24h ago); "Week" means since
    // Monday 00:00 of this week; "Month" means since the 1st 00:00 of
    // this month. Feels closer to how people think about "this week"
    // than a rolling 7-day window that quietly drops things at random
    // times of day.
    const cutoff = (() => {
      if (range === 'day') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      }
      if (range === 'week') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        // getDay() returns 0=Sun..6=Sat. Treat Monday as the start of
        // the week — most music-stats convention (Spotify Wrapped's
        // weekly view, last.fm) uses Monday-start weeks. Shift the
        // anchor so Monday=0..Sunday=6, then subtract those days.
        const daysSinceMonday = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - daysSinceMonday);
        return d.getTime();
      }
      if (range === 'month') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(1);
        return d.getTime();
      }
      return 0;
    })();

    // Build a track lookup once — used both to enrich top-* lists with
    // cover art / titles / artists and to total listening time.
    const libIndex = new Map(library.map((t) => [t.id, t]));
    const primaryArtist = (str) => {
      if (!str) return 'Unknown Artist';
      return str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim() || 'Unknown Artist';
    };

    // Totals always come from the per-track aggregate so all-time
    // headline numbers stay accurate even when viewing the Day tab.
    let totalSeconds = 0;
    let totalPlays = 0;
    let favoritesCount = 0;
    for (const t of library) {
      const plays = Number(t.playCount) || 0;
      const dur = Number(t.duration) || 0;
      totalSeconds += plays * dur;
      totalPlays += plays;
      if (t.isFavorite) favoritesCount++;
    }

    // Per-track play-counts within the active range. For 'all' we use
    // each track's stored playCount; for time-bounded ranges we count
    // events in the window. This is the key change that makes
    // Day/Week/Month meaningful — without it, every range would just
    // re-show the same all-time top list.
    const playsByTrack = new Map();
    if (range === 'all') {
      for (const t of library) {
        const n = Number(t.playCount) || 0;
        if (n > 0) playsByTrack.set(t.id, n);
      }
    } else if (Array.isArray(playEvents) && cutoff > 0) {
      for (const ev of playEvents) {
        const at = Number(ev?.at) || 0;
        if (!at || at < cutoff) continue;
        const id = String(ev.id || '');
        if (!id) continue;
        playsByTrack.set(id, (playsByTrack.get(id) || 0) + 1);
      }
    }

    // Roll the per-track counts up into albums and artists. Album key
    // is "album__primaryArtist" (case-insensitive) so different albums
    // by the same artist stay separate, and the same album-title under
    // different artists also stays separate.
    const albumMap = new Map(); // key: "album__artist" -> { name, artist, plays, coverArt, sampleTrack }
    const artistMap = new Map(); // key: artist (primary) -> { name, plays, sampleCover, sampleTrack }
    for (const [trackId, plays] of playsByTrack.entries()) {
      const t = libIndex.get(trackId);
      if (!t || plays <= 0) continue;
      const album = (t.album || 'Unknown Album').trim();
      const artist = primaryArtist(t.artist);
      const albumKey = `${album.toLowerCase()}__${artist.toLowerCase()}`;
      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, { name: album, artist, plays: 0, coverArt: t.coverArt, sampleTrack: t });
      }
      albumMap.get(albumKey).plays += plays;
      if (!artistMap.has(artist)) {
        artistMap.set(artist, { name: artist, plays: 0, sampleCover: t.coverArt, sampleTrack: t });
      }
      artistMap.get(artist).plays += plays;
    }

    // Build the top-tracks list. Each entry carries the track itself
    // (for cover art / play action) plus the play count for the active
    // range, so the row can show "8 plays" for the week tab while
    // still showing the all-time count on the 'all' tab.
    const topTracks = [...playsByTrack.entries()]
      .map(([id, plays]) => {
        const t = libIndex.get(id);
        return t ? { ...t, rangePlays: plays } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.rangePlays - a.rangePlays)
      .slice(0, 5);
    const topAlbums = [...albumMap.values()].sort((a, b) => b.plays - a.plays).slice(0, 5);
    const topArtists = [...artistMap.values()].sort((a, b) => b.plays - a.plays).slice(0, 5);

    // Rediscover only makes sense for the all-time view — by definition
    // it surfaces tracks you HAVEN'T played recently. Hide it for the
    // bounded ranges.
    const thirtyDays = 1000 * 60 * 60 * 24 * 30;
    const rediscover = range === 'all'
      ? library
        .filter((t) => {
          const plays = Number(t.playCount) || 0;
          const last = Number(t.lastPlayed) || 0;
          return plays >= 3 && t.coverArt && (now - last) > thirtyDays;
        })
        .sort((a, b) => (Number(b.playCount) || 0) - (Number(a.playCount) || 0))
        .slice(0, 5)
      : [];

    // --- Weekly velocity card numbers ---
    // The velocity card stays on every tab because it's a useful
    // benchmark (this-week vs prior-week) regardless of what list the
    // user is viewing.
    const sevenDays = 1000 * 60 * 60 * 24 * 7;
    let playsLast7 = 0;
    let playsPrior7 = 0;
    if (Array.isArray(playEvents) && playEvents.length > 0) {
      for (const ev of playEvents) {
        const at = Number(ev?.at) || 0;
        if (!at) continue;
        const age = now - at;
        if (age <= sevenDays) playsLast7++;
        else if (age <= sevenDays * 2) playsPrior7++;
      }
    } else {
      // Legacy fallback — count distinct tracks with lastPlayed in the window.
      for (const t of library) {
        const last = Number(t.lastPlayed) || 0;
        if (!last) continue;
        const age = now - last;
        if (age <= sevenDays) playsLast7++;
        else if (age <= sevenDays * 2) playsPrior7++;
      }
    }

    return {
      empty: false,
      totalTracks, totalHours: totalSeconds / 3600, totalPlays, favoritesCount,
      topTracks, topAlbums, topArtists, rediscover,
      playsLast7, playsPrior7,
    };
  }, [library, playEvents, range]);

  // Format helpers
  const fmtNum = (n) => Math.round(n).toLocaleString();
  const fmtHours = (h) => {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 10) return `${h.toFixed(1)}h`;
    return `${Math.round(h)}h`;
  };

  const handlePlay = (t) => {
    if (!onPlayTrack) return;
    onPlayTrack(t, library);
  };

  const doReset = async () => {
    if (!onResetStats || resetting) return;
    setResetting(true);
    try {
      await onResetStats();
    } finally {
      setResetting(false);
      setResetConfirmOpen(false);
    }
  };

  if (stats.empty) {
    return (
      <div style={{ flex: 1, padding: '28px 18px', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
        <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Stats</div>
        <div style={{ marginBottom: 8 }}>
          Your listening stats appear here as you play music — top tracks, most-played artists, a listening calendar, and weekly trends.
        </div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6 }}>
          Play a few tracks and check back. Stats update in real time and you can filter by today, this week, this month, or all time.
        </div>
      </div>
    );
  }

  // Trend indicator for velocity
  const trendDelta = stats.playsLast7 - stats.playsPrior7;
  const trendPct = stats.playsPrior7 > 0 ? Math.round((trendDelta / stats.playsPrior7) * 100) : null;

  // Label suffix used in section titles when a time range is active —
  // "Most Played Tracks · This Week" reads better than just "Most
  // Played Tracks" for the bounded views.
  const rangeLabel =
    range === 'day' ? 'Today'
    : range === 'week' ? 'This Week'
    : range === 'month' ? 'This Month'
    : '';

  // Heading on top-N lists. When a range is selected, also note if the
  // window is empty so the user understands why a list is missing.
  const rangeIsEmpty = range !== 'all' && stats.topTracks.length === 0;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', overflowX: 'hidden',
      padding: '8px 14px 18px',
      scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
      contain: 'layout paint',
    }}>
      {/* Range tabs — All / Day / Week / Month. Drives which top-N
          lists are shown and how their counts are computed. Hidden
          when the user has disabled the feature in settings, in which
          case the tab silently behaves as All Time only. */}
      {rangeTabsEnabled ? (
        <div style={{
          display: 'flex', gap: 4, marginBottom: 14,
          padding: 3, borderRadius: 9,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          {[
            { id: 'all', label: 'All Time' },
            { id: 'day', label: 'Day' },
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              style={{
                flex: 1,
                padding: '5px 8px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.02em',
                background: range === r.id ? `rgba(${accent}, 0.18)` : 'transparent',
                color: range === r.id ? '#fff' : 'rgba(255,255,255,0.55)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Headline numbers — always all-time totals regardless of which
          range tab is active. The range tab affects the top-N lists
          below, not the lifetime numbers up here. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
        <StatCard label="Tracks" value={fmtNum(stats.totalTracks)} accent={accent} />
        <StatCard label="Plays" value={fmtNum(stats.totalPlays)} accent={accent} />
        <StatCard label="Listened" value={fmtHours(stats.totalHours)} accent={accent} />
      </div>

      {/* Velocity card — prominent if there's data */}
      {stats.playsLast7 > 0 || stats.playsPrior7 > 0 ? (
        <div style={{
          padding: '12px 14px', marginBottom: 18,
          borderRadius: 11,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>
              This Week
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.92)' }}>
              <strong style={{ color: '#fff', fontSize: 17, fontWeight: 700 }}>{stats.playsLast7}</strong>
              <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginLeft: 6 }}>{stats.playsLast7 === 1 ? 'play' : 'plays'}</span>
            </div>
          </div>
          {trendPct != null ? (
            <div style={{
              fontSize: 11, fontWeight: 700,
              padding: '4px 10px', borderRadius: 999,
              background: trendDelta >= 0 ? 'rgba(80, 200, 120, 0.15)' : 'rgba(243, 114, 114, 0.15)',
              color: trendDelta >= 0 ? '#7be191' : '#f37272',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span>{trendDelta >= 0 ? '↗' : '↘'}</span>
              <span>{trendDelta >= 0 ? '+' : ''}{trendPct}%</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* When a range is selected but produced no results, surface a
          friendly empty-state instead of just hiding all the top-N
          sections (which would look like a broken tab). */}
      {rangeIsEmpty ? (
        <div style={{
          padding: '22px 14px',
          textAlign: 'center',
          color: 'rgba(255,255,255,0.45)',
          fontSize: 12,
          lineHeight: 1.55,
          marginBottom: 18,
          borderRadius: 10,
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}>
          No plays {rangeLabel.toLowerCase()} yet.<br />
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>Switch to All Time to see your full listening history.</span>
        </div>
      ) : null}

      {/* Top tracks */}
      {stats.topTracks.length > 0 ? (
        <StatsSection title={rangeLabel ? `Most Played · ${rangeLabel}` : 'Most Played Tracks'} accent={accent}>
          {stats.topTracks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handlePlay(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '6px 4px',
                background: 'transparent', border: 'none',
                color: '#fff', cursor: 'pointer',
                textAlign: 'left',
                borderRadius: 7,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <div style={{
                width: 18, fontSize: 11, fontWeight: 700,
                color: i < 3 ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.35)',
                fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {t.coverArt ? <img src={t.coverArt} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginBottom: 1,
                }}>
                  {t.title}
                </div>
                <div style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.5)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.artist}
                </div>
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)',
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
              }}>
                {t.rangePlays}
              </div>
            </button>
          ))}
        </StatsSection>
      ) : null}

      {/* Top albums */}
      {stats.topAlbums.length > 0 ? (
        <StatsSection title={rangeLabel ? `Top Albums · ${rangeLabel}` : 'Most Played Albums'} accent={accent}>
          {stats.topAlbums.map((a, i) => (
            <div key={`${a.name}__${a.artist}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 4px',
                color: '#fff',
              }}>
              <div style={{
                width: 18, fontSize: 11, fontWeight: 700,
                color: i < 3 ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.35)',
                fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {a.coverArt ? <img src={a.coverArt} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.name}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.artist}
                </div>
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {a.plays}
              </div>
            </div>
          ))}
        </StatsSection>
      ) : null}

      {/* Top artists */}
      {stats.topArtists.length > 0 ? (
        <StatsSection title={rangeLabel ? `Top Artists · ${rangeLabel}` : 'Most Played Artists'} accent={accent}>
          {stats.topArtists.map((a, i) => (
            <div key={a.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 4px',
                color: '#fff',
              }}>
              <div style={{
                width: 18, fontSize: 11, fontWeight: 700,
                color: i < 3 ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.35)',
                fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {a.sampleCover ? <img src={a.sampleCover} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {a.plays} {a.plays === 1 ? 'play' : 'plays'}
              </div>
            </div>
          ))}
        </StatsSection>
      ) : null}

      {/* Rediscover — only shown on All Time since the bounded ranges
          explicitly show what you ARE playing, not what you aren't. */}
      {stats.rediscover.length > 0 ? (
        <StatsSection
          title="Rediscover"
          subtitle="You used to play these — haven't in a while"
          accent={accent}
        >
          {stats.rediscover.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handlePlay(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '6px 4px',
                background: 'transparent', border: 'none',
                color: '#fff', cursor: 'pointer',
                textAlign: 'left', borderRadius: 7,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                {t.coverArt ? <img src={t.coverArt} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.title}
                </div>
                <div style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.5)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.artist}
                </div>
              </div>
            </button>
          ))}
        </StatsSection>
      ) : null}

      {/* Listening calendar — year heatmap of plays per day. Cells are
          intensity-tinted with the accent colour. Clicking a cell opens
          a small list of the tracks played that day, in order. Only
          shown on All Time since it's an all-history view by design. */}
      {range === 'all' ? (
        <ListeningCalendar
          playEvents={playEvents}
          library={library}
          accent={accent}
          onPlayTrack={handlePlay}
        />
      ) : null}

      {/* Footer summary */}
      <div style={{
        marginTop: 18, padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.04)',
        fontSize: 10.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.55,
      }}>
        {stats.favoritesCount > 0 ? (
          <div><strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{stats.favoritesCount}</strong> {stats.favoritesCount === 1 ? 'track' : 'tracks'} marked as favorite.</div>
        ) : null}
        {playlists.length > 0 ? (
          <div style={{ marginTop: 4 }}><strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{playlists.length}</strong> {playlists.length === 1 ? 'playlist' : 'playlists'} created.</div>
        ) : null}
      </div>

      {/* Reset stats — destructive action gated behind an inline confirm
          so a stray click doesn't wipe months of history. Only shown
          when the renderer wired up onResetStats (i.e. running in the
          full app, not a storybook preview). */}
      {onResetStats ? (
        <div style={{ marginTop: 14 }}>
          {!resetConfirmOpen ? (
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              style={{
                width: '100%', padding: '9px 12px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 9,
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11, fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(243, 114, 114, 0.06)';
                e.currentTarget.style.borderColor = 'rgba(243, 114, 114, 0.2)';
                e.currentTarget.style.color = '#f37272';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
              }}
            >
              Reset all stats
            </button>
          ) : (
            <div style={{
              padding: '12px',
              borderRadius: 9,
              background: 'rgba(243, 114, 114, 0.06)',
              border: '1px solid rgba(243, 114, 114, 0.2)',
              fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.55,
            }}>
              <div style={{ marginBottom: 8 }}>
                This will zero every track's play count and erase your play history. Your library itself stays. This can't be undone.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={() => setResetConfirmOpen(false)}
                  style={{
                    flex: 1, padding: '7px 10px',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 10.5, fontWeight: 600,
                    cursor: resetting ? 'default' : 'pointer',
                    opacity: resetting ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={doReset}
                  style={{
                    flex: 1, padding: '7px 10px',
                    background: '#f37272',
                    border: '1px solid #f37272',
                    borderRadius: 6,
                    color: '#fff',
                    fontSize: 10.5, fontWeight: 700,
                    cursor: resetting ? 'default' : 'pointer',
                    opacity: resetting ? 0.7 : 1,
                  }}
                >
                  {resetting ? 'Resetting…' : 'Reset stats'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** StatCard — large headline number above small label. */
function StatCard({ label, value, accent }) {
  return (
    <div style={{
      padding: '12px 10px',
      borderRadius: 10,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.06)',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 18, fontWeight: 700, color: '#fff',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginTop: 4,
      }}>
        {label}
      </div>
    </div>
  );
}

/** StatsSection — section header (small caps title, optional subtitle) + child rows. */
function StatsSection({ title, subtitle = null, accent, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
        color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
        marginBottom: subtitle ? 2 : 8, paddingLeft: 4,
      }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8, paddingLeft: 4,
        }}>
          {subtitle}
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}


/* =========================================================================
 *  ListeningCalendar — year heatmap of plays per day, GitHub-style.
 *
 *  Renders a 7-row × 53-column grid (days-of-week × weeks) covering the
 *  trailing 53 weeks. Each cell is intensity-tinted with the accent
 *  colour: 0 plays = nearly invisible, 1+ plays = progressively brighter
 *  bins (1, 2-3, 4-7, 8-14, 15+).
 *
 *  Clicking a cell selects that day; below the grid we then render a list
 *  of every track played on that day in chronological order. Click a
 *  track in the list to play it.
 *
 *  All derivation is from `playEvents` and `library` — no new state, no
 *  new persisted data.
 * ========================================================================= */
function ListeningCalendar({ playEvents = [], library = [], accent, onPlayTrack }) {
  const [selectedDay, setSelectedDay] = useState(null);

  // --- Build the day-keyed data ----------------------------------------
  // Group events by local-date string YYYY-MM-DD. Storing as ms-since-
  // epoch in the second field lets us find max() per day without a
  // second pass through the array.
  const { dayCounts, totalDays, totalPlays, maxPerDay, dayEvents } = useMemo(() => {
    const counts = new Map();      // dateKey → count
    const events = new Map();      // dateKey → [eventObj, ...]
    let max = 0;
    let plays = 0;
    for (const ev of (playEvents || [])) {
      if (!ev || typeof ev.id !== 'string' || !Number.isFinite(ev.at)) continue;
      const d = new Date(ev.at);
      // Local-date YYYY-MM-DD. Avoids UTC-rollover edge cases at the
      // user's time zone where a late-night play would shift to the
      // next day.
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!events.has(key)) events.set(key, []);
      events.get(key).push(ev);
      plays += 1;
      const c = counts.get(key);
      if (c > max) max = c;
    }
    return {
      dayCounts: counts,
      totalDays: counts.size,
      totalPlays: plays,
      maxPerDay: max,
      dayEvents: events,
    };
  }, [playEvents]);

  // --- Generate the grid cells ------------------------------------------
  // We render 53 columns; each column = one ISO-style week (Sun-start).
  // The rightmost column is the current week; fill earlier columns going
  // back from there. Build as a flat array of { dateKey, count, isToday,
  // isFuture } — easier to map than nested arrays.
  const { cells, monthLabels } = useMemo(() => {
    const COLS = 53;
    const ROWS = 7; // 0=Sun..6=Sat
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Anchor: the Sunday at the start of the current week.
    const todayDow = today.getDay();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - todayDow);

    const out = [];
    const months = []; // { col, label } — only when month changes at top of column

    let lastMonth = -1;
    for (let col = 0; col < COLS; col++) {
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(currentWeekStart.getDate() - (COLS - 1 - col) * 7);
      // Track month changes for x-axis labels — fire when the month at
      // the TOP of the column (i.e. the Sunday) differs from the previous
      // column's top month.
      const m = weekStart.getMonth();
      if (m !== lastMonth) {
        // Skip the very first column's label since it'd be cut off; only
        // emit when there's enough room to the right.
        if (col >= 0) {
          months.push({ col, label: weekStart.toLocaleDateString(undefined, { month: 'short' }) });
        }
        lastMonth = m;
      }
      for (let row = 0; row < ROWS; row++) {
        const cellDate = new Date(weekStart);
        cellDate.setDate(weekStart.getDate() + row);
        const isFuture = cellDate > today;
        const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        out.push({
          key,
          col, row,
          count: isFuture ? 0 : (dayCounts.get(key) || 0),
          isFuture,
          isToday: !isFuture && cellDate.getTime() === today.getTime(),
        });
      }
    }
    return { cells: out, monthLabels: months };
  }, [dayCounts]);

  // --- Bucket cell counts into intensity bins for colour scaling -------
  // Five bins so the colour ramp reads as discrete steps the user can
  // actually distinguish (a continuous ramp would mostly look "kind of
  // dark" everywhere unless the user has wildly varying play counts).
  const intensityFor = (count) => {
    if (count <= 0) return 0;
    if (count >= 15) return 4;
    if (count >= 8) return 3;
    if (count >= 4) return 2;
    if (count >= 2) return 1;
    return 0.5;
  };
  // Map intensity → background colour. 0 is nearly invisible (just a hint
  // the cell exists); 4 is full accent.
  const bgFor = (count, isFuture) => {
    if (isFuture) return 'rgba(255,255,255,0.015)';
    const i = intensityFor(count);
    if (i === 0) return 'rgba(255,255,255,0.04)';
    const alphas = { 0.5: 0.18, 1: 0.32, 2: 0.50, 3: 0.72, 4: 0.95 };
    return `rgba(${accent}, ${alphas[i]})`;
  };

  // --- Selected-day track list -----------------------------------------
  // When a cell is clicked, we resolve the day's events to library
  // tracks. Some events might point to tracks that have since been
  // deleted from the library — those are skipped silently.
  const libIndex = useMemo(() => {
    const m = new Map();
    for (const t of library) m.set(t.id, t);
    return m;
  }, [library]);

  const selectedDayTracks = useMemo(() => {
    if (!selectedDay) return [];
    const events = dayEvents.get(selectedDay) || [];
    const out = [];
    for (const ev of events) {
      const t = libIndex.get(ev.id);
      if (t) out.push({ track: t, at: ev.at });
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  }, [selectedDay, dayEvents, libIndex]);

  // Format a date key as "Sat, Mar 15" — long enough to read but short.
  const formatDayLabel = (key) => {
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  // Pre-compute readable labels for each cell so we're not calling
  // toLocaleDateString() 371 times during render.
  const cellLabels = useMemo(() => {
    const m = new Map();
    for (const cell of cells) {
      if (cell.isFuture) continue;
      const [y, mo, d] = cell.key.split('-').map(Number);
      const dt = new Date(y, mo - 1, d);
      m.set(cell.key, `${dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — ${cell.count} ${cell.count === 1 ? 'play' : 'plays'}`);
    }
    return m;
  }, [cells]);

  // Cell + gap sizing. Tuned so the grid fits comfortably in the
  // narrowest panel width (~240px) without scrolling.
  const CELL = 9;
  const GAP = 2;

  // Empty state — no plays yet.
  if (totalPlays === 0) {
    return (
      <StatsSection title="LISTENING CALENDAR" accent={accent}>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.45)',
          padding: '8px 4px', lineHeight: 1.55,
        }}>
          Once you start playing tracks, the last year of your listening will appear here as a heatmap.
        </div>
      </StatsSection>
    );
  }

  return (
    <StatsSection
      title="LISTENING CALENDAR"
      subtitle={`${totalPlays.toLocaleString()} ${totalPlays === 1 ? 'play' : 'plays'} across ${totalDays} ${totalDays === 1 ? 'day' : 'days'}`}
      accent={accent}
    >
      {/* The grid itself. Horizontal scroll if the panel is too narrow,
          but at default width (~340px) the 53 cols × 11px = ~583px will
          overflow — we let it scroll horizontally so the heatmap stays
          legible at its true scale. Mask edges fade out to soften the
          scroll boundaries. */}
      <div style={{
        overflowX: 'auto', overflowY: 'hidden',
        paddingTop: 14, paddingBottom: 4,
        // Subtle horizontal-fade mask so the right edge doesn't look
        // hard-cut when overflowing.
        maskImage: 'linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)',
      }}>
        <div style={{ display: 'inline-block', position: 'relative', paddingLeft: 4 }}>
          {/* Month labels above the grid. Positioned absolute by column. */}
          <div style={{
            position: 'relative', height: 11, marginBottom: 2,
            width: 53 * (CELL + GAP),
          }}>
            {monthLabels.map((m) => (
              <span
                key={`${m.col}-${m.label}`}
                style={{
                  position: 'absolute',
                  left: m.col * (CELL + GAP),
                  fontSize: 8.5, color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
          {/* Grid — column-major so React keys stay stable across renders. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(53, ${CELL}px)`,
            gridTemplateRows: `repeat(7, ${CELL}px)`,
            gridAutoFlow: 'column',
            gap: GAP,
          }}>
            {cells.map((cell) => {
              const isSelected = selectedDay === cell.key;
              return (
                <div
                  key={cell.key}
                  role={cell.isFuture ? undefined : 'button'}
                  onClick={cell.isFuture ? undefined : () => setSelectedDay(isSelected ? null : cell.key)}
                  title={cellLabels.get(cell.key) || ''}
                  style={{
                    width: CELL, height: CELL,
                    borderRadius: 2,
                    background: bgFor(cell.count, cell.isFuture),
                    border: isSelected
                      ? `1px solid rgba(${accent}, 1)`
                      : cell.isToday
                        ? '1px solid rgba(255,255,255,0.4)'
                        : '1px solid transparent',
                    cursor: cell.isFuture ? 'default' : 'pointer',
                  }}
                />
              );
            })}
          </div>
          {/* Legend below the grid. Five swatches showing the bins. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.4)',
          }}>
            <span>less</span>
            {[0, 0.5, 1, 2, 3, 4].map((bin) => (
              <span
                key={bin}
                style={{
                  display: 'inline-block', width: CELL, height: CELL,
                  borderRadius: 2,
                  background: bin === 0
                    ? 'rgba(255,255,255,0.04)'
                    : `rgba(${accent}, ${{ 0.5: 0.18, 1: 0.32, 2: 0.50, 3: 0.72, 4: 0.95 }[bin]})`,
                }}
              />
            ))}
            <span>more</span>
          </div>
        </div>
      </div>

      {/* Selected-day track list */}
      {selectedDay ? (
        <div style={{
          marginTop: 14, padding: 10, borderRadius: 9,
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#fff',
            marginBottom: selectedDayTracks.length === 0 ? 0 : 8,
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 8,
          }}>
            <span>{formatDayLabel(selectedDay)}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
              {selectedDayTracks.length} {selectedDayTracks.length === 1 ? 'play' : 'plays'}
            </span>
          </div>
          {selectedDayTracks.length === 0 ? (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              The tracks played that day are no longer in your library.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {selectedDayTracks.map(({ track, at }, i) => (
                <button
                  key={`${at}-${i}`}
                  type="button"
                  onClick={() => onPlayTrack?.(track)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 6px', borderRadius: 5,
                    background: 'transparent', border: 'none',
                    color: 'rgba(255,255,255,0.85)',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{
                    flexShrink: 0, width: 38,
                    fontSize: 9.5, color: 'rgba(255,255,255,0.4)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {formatTime(at)}
                  </span>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 11, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {track.title || 'Untitled'}
                  </span>
                  <span style={{
                    flexShrink: 0, fontSize: 10, color: 'rgba(255,255,255,0.45)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 100,
                  }}>
                    {track.artist || ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </StatsSection>
  );
}


export { StatsTab, StatCard, StatsSection, ListeningCalendar };
