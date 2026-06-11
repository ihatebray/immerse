import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Icons from './Icons.jsx';
import { formatTime, titleCollator, SORT_LABELS } from './mediaUtils.js';
import { ExplicitBadge } from './sharedUI.jsx';
import { PlaylistThumb } from './PlaylistEditor.jsx';
import { AlbumGridView, AlbumStackView, AlbumViewToggle, AlbumDetailView } from './AlbumViews.jsx';
import { RecentlyPlayed } from './RecentlyPlayed.jsx';

function LibraryTab({
  tracks,
  library,
  libraryCount,
  search,
  onSearchChange,
  currentTrack,
  isPlaying,
  selectedId,
  setSelectedId,
  hovered,
  setHovered,
  onPlayTrack,
  onPlayPauseTrack,
  onImportFiles,
  onImportFolder,
  importing,
  canRemove,
  onRemoveFromLibrary,
  canEdit,
  onEditTrack,
  canEditAlbum,
  onEditAlbum,
  canAddToPlaylist,
  onAddToPlaylist,
  onAddToQueue,
  onPlayNext,
  onToggleFavorite,
  onTrackContextMenu,
  // Playlists view
  playlists = [],
  playlistCoverMap = new Map(),
  onOpenPlaylist,
  onNewPlaylist,
  firstTimeSparkleEnabled = false,
  clickToFilterEnabled = false,
  onFilterByText,
  twoPaneEnabled = false,
  accent,
  playEvents = [],
  recentlyPlayedEnabled = true,
  librarySwitcherStyle = 'chip', // 'chip' | 'tabs'
  pinnedPlaylists = [],
  onTogglePinnedPlaylist,
}) {
  const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const [view, setView] = useState('songs'); // 'songs' | 'albums' | 'playlists'
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const viewBtnRef = useRef(null);
  const sortBtnRef = useRef(null);
  const [openAlbum, setOpenAlbum] = useState(null);

  // Album view layout: 'grid' (default 2-col grid) or 'stack' (Cover Flow
  // style horizontal browser). Persisted in localStorage so the choice
  // sticks across launches.
  const [albumViewMode, setAlbumViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'grid';
    return window.localStorage.getItem('immerse:albumViewMode') || 'grid';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('immerse:albumViewMode', albumViewMode);
    }
  }, [albumViewMode]);

  // Imperative scroll handle for the A-Z quick-jump rail. The
  // VirtualTrackList populates this with a `(index) => void` function
  // when it mounts; the rail calls it on letter-tap.
  const scrollToTrackIndexRef = useRef(null);

  // Two-pane mode — when enabled, the Songs view splits in half:
  // artists on the left, tracks of the selected artist on the right.
  // null means "show all" (no artist filter).
  const [twoPaneArtist, setTwoPaneArtist] = useState(null);
  /**
   * Sort mode for Songs view. Persisted to localStorage so the user's choice
   * survives restarts. Options: 'aToZ', 'zToA', 'recentlyAdded', 'oldestFirst',
   * 'recentlyPlayed', 'mostPlayed', 'longest', 'shortest', 'year', 'favorites'.
   */
  const [sortMode, setSortMode] = useState(() => {
    try {
      const v = window.localStorage?.getItem('studioPlayerSongSort');
      const valid = ['aToZ', 'zToA', 'recentlyAdded', 'oldestFirst', 'recentlyPlayed', 'mostPlayed', 'longest', 'shortest', 'year', 'favorites'];
      return valid.includes(v) ? v : 'aToZ';
    } catch { return 'aToZ'; }
  });
  useEffect(() => {
    try { window.localStorage?.setItem('studioPlayerSongSort', sortMode); } catch { /* ignore */ }
  }, [sortMode]);

  // Apply current sort mode to incoming `tracks` (which is already search-filtered).
  const sortedTracks = useMemo(() => {
    const arr = [...tracks];
    const titleCmp = (a, b) => titleCollator.compare(String(a.title || ''), String(b.title || ''));
    switch (sortMode) {
      case 'zToA':
        arr.sort((a, b) => -titleCmp(a, b));
        break;
      case 'recentlyAdded':
        arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        break;
      case 'oldestFirst':
        arr.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        break;
      case 'recentlyPlayed':
        arr.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || titleCmp(a, b));
        break;
      case 'mostPlayed':
        arr.sort((a, b) => (b.playCount || 0) - (a.playCount || 0) || titleCmp(a, b));
        break;
      case 'longest':
        arr.sort((a, b) => (b.duration || 0) - (a.duration || 0) || titleCmp(a, b));
        break;
      case 'shortest':
        arr.sort((a, b) => (a.duration || 0) - (b.duration || 0) || titleCmp(a, b));
        break;
      case 'year':
        // Recent year first, then alphabetical
        arr.sort((a, b) => (b.year || 0) - (a.year || 0) || titleCmp(a, b));
        break;
      case 'favorites':
        // Favorites first, then alphabetical
        arr.sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || titleCmp(a, b));
        break;
      case 'aToZ':
      default:
        arr.sort(titleCmp);
        break;
    }
    return arr;
  }, [tracks, sortMode]);

  // When showing the Favorites view, filter down to only favorited tracks.
  const displayTracks = useMemo(() => {
    if (view !== 'favorites') return sortedTracks;
    return sortedTracks.filter((t) => t.isFavorite);
  }, [sortedTracks, view]);

  const alphaRailVisible = sortMode === 'aToZ' || sortMode === 'zToA';
  const alphaIndex = useMemo(() => {
    if (!alphaRailVisible) return null;
    const letters = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    const idx = new Map(letters.map((l) => [l, -1]));
    // Strip leading "The " (the universal alphabetization convention)
    // and any leading punctuation/whitespace before checking the first
    // character. So "The Beatles" buckets under "B" and "(The) Doors"
    // buckets under "D" — matching how a CD shelf is alphabetized.
    const firstLetterOf = (title) => {
      const t = String(title || '').replace(/^the\s+/i, '').replace(/^[\s\W_]+/, '');
      const c = t.charAt(0).toUpperCase();
      if (c >= 'A' && c <= 'Z') return c;
      return '#';
    };
    for (let i = 0; i < displayTracks.length; i++) {
      const letter = firstLetterOf(displayTracks[i].title);
      // Only set the FIRST occurrence; later tracks of the same letter
      // are skipped so the rail jumps to the top of each bucket.
      if (idx.get(letter) === -1) idx.set(letter, i);
    }
    return idx;
  }, [displayTracks, alphaRailVisible]);

  // Two-pane artists list — distinct primary artist names from
  // `displayTracks` with track counts. Sorted alphabetically (case-
  // insensitive) regardless of the song-sort mode, since the artist
  // pane is its own browse axis and shouldn't reflect song-sort.
  const twoPaneArtists = useMemo(() => {
    if (!twoPaneEnabled) return [];
    const counts = new Map();
    for (const t of displayTracks) {
      const key = (t.artist || '').split(/[,&]/)[0].trim() || 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const list = Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
    list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return list;
  }, [displayTracks, twoPaneEnabled]);

  // Filter displayTracks down to just the selected artist's tracks. When
  // no artist is selected, falls back to the unfiltered list (so an
  // empty artist pane still shows everything on the right).
  const twoPaneFilteredTracks = useMemo(() => {
    if (!twoPaneEnabled || !twoPaneArtist) return displayTracks;
    const target = twoPaneArtist.toLowerCase();
    return displayTracks.filter((t) => {
      const primary = (t.artist || '').split(/[,&]/)[0].trim().toLowerCase();
      return primary === target;
    });
  }, [twoPaneEnabled, twoPaneArtist, displayTracks]);

  // Decide how a clicked song should seed the queue:
  //   'list'   — queue the whole visible group (artist pane, or a search that
  //              resolves to a single artist/album, or the unfiltered library).
  //   'single' — the search is a grab-bag of unrelated songs, so play just the
  //              clicked track and let the queue continue randomly afterward.
  const songsPlayContext = useMemo(() => {
    if (twoPaneArtist) return 'list';           // explicit artist selection
    if (!search || !search.trim()) return 'list'; // whole library
    const list = twoPaneFilteredTracks;
    if (list.length <= 1) return 'single';
    const primary = (t) => (t.artist || '').split(/[,&]/)[0].trim().toLowerCase();
    const artists = new Set(list.map(primary));
    const albums = new Set(list.map((t) => (t.album || '').toLowerCase()).filter(Boolean));
    // All results share one artist (artist search) or one album (album search).
    if (artists.size === 1) return 'list';
    if (albums.size === 1 && albums.size > 0) return 'list';
    return 'single';
  }, [twoPaneArtist, search, twoPaneFilteredTracks]);

  // Reset selected artist if it disappears from the list (e.g. user
  // edits a track or deletes the artist's last track).
  useEffect(() => {
    if (!twoPaneEnabled || !twoPaneArtist) return;
    const exists = twoPaneArtists.some((a) => a.name === twoPaneArtist);
    if (!exists) setTwoPaneArtist(null);
  }, [twoPaneEnabled, twoPaneArtist, twoPaneArtists]);

  // Group the full library into albums with disc-aware structure
  const albums = useMemo(() => {
    // Extract the primary artist — everything before the first comma, feat., ft., &, or x
    const primaryArtist = (str) => {
      if (!str) return 'Unknown Artist';
      const clean = str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim();
      return clean || str.trim();
    };

    // Comparator: disc asc (null→1), track asc, then — if BOTH lack a track
    // number — fall back to the order tracks were added to the library. This
    // rescues albums that were imported in-order via batch download but whose
    // yt-dlp files don't carry track tags. Title is the final tiebreaker.
    const compareTracks = (a, b) => {
      const da = a.discNumber != null ? a.discNumber : 1;
      const db_ = b.discNumber != null ? b.discNumber : 1;
      if (da !== db_) return da - db_;
      const aHas = a.trackNumber != null;
      const bHas = b.trackNumber != null;
      if (aHas && bHas) {
        if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
      } else if (aHas !== bHas) {
        // A tagged track sorts before an untagged one (so a numbered track 1
        // doesn't get stranded below random alphabetically-first untagged tracks)
        return aHas ? -1 : 1;
      } else {
        // Neither has a track number — fall back to addedAt order
        const aa = Number(a.addedAt) || 0;
        const bb = Number(b.addedAt) || 0;
        if (aa !== bb) return aa - bb;
      }
      return titleCollator.compare(String(a.title || ''), String(b.title || ''));
    };

    const map = new Map();
    for (const t of library) {
      const albumName = (t.album || '').trim() || 'Unknown Album';
      const primary = primaryArtist(t.artist);
      const key = `${albumName}__${primary}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          album: albumName,
          artist: primary,
          coverArt: null,       // primary/fallback cover
          tracks: [],           // flat, sorted list
          discs: new Map(),     // discNum → { discNumber, coverArt, tracks }
        });
      }
      const entry = map.get(key);
      if (!entry.coverArt && t.coverArt) entry.coverArt = t.coverArt;
      entry.tracks.push(t);

      // Accumulate disc info
      const discNum = t.discNumber != null ? t.discNumber : 1;
      if (!entry.discs.has(discNum)) {
        entry.discs.set(discNum, { discNumber: discNum, coverArt: null, tracks: [] });
      }
      const disc = entry.discs.get(discNum);
      if (!disc.coverArt && t.coverArt) disc.coverArt = t.coverArt;
      disc.tracks.push(t);
    }

    for (const entry of map.values()) {
      entry.tracks.sort(compareTracks);
      for (const disc of entry.discs.values()) {
        disc.tracks.sort(compareTracks);
      }
      // Convert disc Map → sorted array
      entry.discs = [...entry.discs.values()].sort((a, b) => a.discNumber - b.discNumber);
      // Build a quick list of the unique cover arts across discs (for split visuals)
      entry.discCoverArts = entry.discs
        .map((d) => d.coverArt || entry.coverArt)
        .filter(Boolean);
      // Dedupe adjacent duplicates — if all discs share the same cover, only need one
      entry.discCoverArts = Array.from(new Set(entry.discCoverArts));
      entry.hasMultipleDiscs = entry.discs.length >= 2;
    }

    return [...map.values()]
      // Only show albums with 2+ tracks — singles stay in Songs view only
      .filter((a) => a.tracks.length >= 2)
      .sort((a, b) =>
        titleCollator.compare(a.album, b.album) || titleCollator.compare(a.artist, b.artist)
      );
  }, [library]);

  const filteredAlbums = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return albums;
    return albums.filter((a) =>
      a.album.toLowerCase().includes(q) ||
      a.artist.toLowerCase().includes(q) ||
      a.tracks.some((t) => t.title.toLowerCase().includes(q))
    );
  }, [albums, search]);

  const openAlbumData = useMemo(() => {
    if (!openAlbum) return null;
    return albums.find((a) => a.key === openAlbum) || null;
  }, [albums, openAlbum]);

  const openAlbumTracks = useMemo(() => {
    if (!openAlbumData) return [];
    const q = search.trim().toLowerCase();
    if (!q) return openAlbumData.tracks;
    return openAlbumData.tracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q));
  }, [openAlbumData, search]);

  useEffect(() => {
    if (openAlbum && !albums.find((a) => a.key === openAlbum)) setOpenAlbum(null);
  }, [albums, openAlbum]);

  return (
    <>
      <div style={{ padding: '10px 12px 8px', display: 'flex', gap: 6 }}>
        <button type="button" onClick={onImportFiles} disabled={importing}
          style={{ flex: 1, padding: '7px 10px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#e5e5e5', fontSize: 11.5, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }}>
          {importing ? 'Importing…' : '+ Files'}
        </button>
        {hasElectron ? (
          <button type="button" onClick={onImportFolder} disabled={importing}
            style={{ flex: 1, padding: '7px 10px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#e5e5e5', fontSize: 11.5, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }}>
            + Folder
          </button>
        ) : null}
      </div>

      {libraryCount > 0 ? (
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 5, alignItems: 'center' }}>

          {/* View switcher — chip dropdown or bottom-border tabs, inline with search */}
          {librarySwitcherStyle === 'tabs' ? (
            <>
              {['songs', 'favorites', 'albums', 'playlists'].map((m) => (
                <button key={m} type="button"
                  onClick={() => { setView(m); setOpenAlbum(null); onSearchChange(''); }}
                  style={{
                    flexShrink: 0, padding: '6px 8px 8px', border: 'none', background: 'transparent',
                    color: view === m ? '#fff' : 'rgba(255,255,255,0.4)',
                    fontSize: 10.5, fontWeight: view === m ? 700 : 600,
                    cursor: 'pointer', transition: 'color 0.2s',
                    position: 'relative',
                  }}>
                  {m === 'favorites' ? '♥' : m.charAt(0).toUpperCase() + m.slice(1)}
                  {view === m ? (
                    <div style={{
                      position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
                      width: '60%', height: 1.5, borderRadius: 1,
                      background: `rgb(${accent})`,
                    }} />
                  ) : null}
                </button>
              ))}
            </>
          ) : (
            <button ref={viewBtnRef} type="button"
              onClick={() => setViewMenuOpen((v) => !v)}
              style={{
                flexShrink: 0, padding: '7px 12px', borderRadius: 9,
                border: `1px solid rgba(${accent},0.35)`,
                background: `rgba(${accent},0.12)`,
                color: '#fff', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s cubic-bezier(0.16,1,0.3,1)',
              }}>
              <span>{view === 'songs' ? 'Songs' : view === 'favorites' ? 'Favorites' : view === 'albums' ? 'Albums' : 'Playlists'}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.6, transform: viewMenuOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}

          <input type="text" value={search} onChange={(e) => onSearchChange(e.target.value)}
            placeholder={view === 'albums' && openAlbumData ? `Search in ${openAlbumData.album}…` : view === 'playlists' ? 'Search playlists…' : view === 'favorites' ? 'Search favorites…' : 'Search…'}
            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 11px', borderRadius: 9, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', color: '#fff', fontSize: 12, outline: 'none' }} />
          {(view === 'songs' || view === 'favorites') ? (
            <button ref={sortBtnRef} type="button"
              onClick={() => setSortMenuOpen((v) => !v)}
              title={`Sort: ${SORT_LABELS[sortMode] || sortMode}`}
              aria-label="Sort songs"
              style={{
                flexShrink: 0, width: 32, height: 32, borderRadius: 9,
                background: sortMenuOpen ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { if (!sortMenuOpen) e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { if (!sortMenuOpen) e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M6 12h12M10 18h4" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── Portaled menus ─────────────────────────────────────
          These use createPortal to render into document.body so they
          escape the panel's transform/overflow and their backdrop-filter
          samples the live app background — matching the right-click
          context menu exactly.  */}

      {viewMenuOpen && viewBtnRef.current ? (() => {
        const r = viewBtnRef.current.getBoundingClientRect();
        return createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={() => setViewMenuOpen(false)} />
            <div style={{
              position: 'fixed', left: r.left, top: r.bottom + 4, zIndex: 201,
              minWidth: 184, padding: 5, borderRadius: 14,
              background: 'rgba(18,18,20,0.62)',
              backdropFilter: 'blur(30px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
              animation: 'imm-ctx-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
              <style>{`@keyframes imm-ctx-in { from { opacity:0; transform:scale(0.96) translateY(-5px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
              {[
                { id: 'songs', label: 'Songs', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg> },
                { id: 'favorites', label: 'Favorites', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg> },
                { divider: true },
                { id: 'albums', label: 'Albums', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg> },
                { id: 'playlists', label: 'Playlists', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 12H3M16 6H3M16 18H3M21 12l-4-3v6z" /></svg> },
              ].map((m, i) => m.divider ? (
                <div key={`d-${i}`} style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 2px' }} />
              ) : (
                <div key={m.id} role="menuitem"
                  onClick={() => { setView(m.id); setOpenAlbum(null); setViewMenuOpen(false); onSearchChange(''); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.18)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 11px', borderRadius: 9,
                    color: 'rgba(255,255,255,0.92)',
                    cursor: 'pointer', background: 'transparent',
                    fontSize: 12, fontWeight: 500, userSelect: 'none',
                    transition: 'background 0.12s cubic-bezier(0.16,1,0.3,1), color 0.12s',
                  }}>
                  <span style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'currentColor' }}>{m.icon}</span>
                  <span style={{ flex: 1 }}>{m.label}</span>
                  {view === m.id ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : null}
                </div>
              ))}
            </div>
          </>,
          document.body
        );
      })() : null}

      {sortMenuOpen && sortBtnRef.current ? (() => {
        const r = sortBtnRef.current.getBoundingClientRect();
        return createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={() => setSortMenuOpen(false)} />
            <div style={{
              position: 'fixed', left: r.right, top: r.bottom + 4, zIndex: 201,
              transform: 'translateX(-100%)',
              minWidth: 184, padding: 5, borderRadius: 14,
              background: 'rgba(18,18,20,0.62)',
              backdropFilter: 'blur(30px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
              animation: 'imm-ctx-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
              {Object.entries(SORT_LABELS).map(([key, label]) => (
                <div key={key} role="menuitem"
                  onClick={() => { setSortMode(key); setSortMenuOpen(false); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.18)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 11px', borderRadius: 9,
                    color: 'rgba(255,255,255,0.92)',
                    cursor: 'pointer', background: 'transparent',
                    fontSize: 12, fontWeight: 500, userSelect: 'none',
                    transition: 'background 0.12s cubic-bezier(0.16,1,0.3,1), color 0.12s',
                  }}>
                  <span style={{ width: 14, height: 14, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: sortMode === key ? '#fff' : 'transparent' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  <span style={{ flex: 1 }}>{label}</span>
                </div>
              ))}
            </div>
          </>,
          document.body
        );
      })() : null}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {libraryCount === 0 ? (
          <div style={{ padding: '28px 18px', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
            <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Your Library</div>
            <div style={{ marginBottom: 8 }}>
              This is where all your music lives. Tracks you import from Spotify, Soulseek, or local files appear here — organized by song, album, or playlist.
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6 }}>
              Head to the Find tab to search for music. You can also drag audio files onto this window to add them directly.
            </div>
          </div>
        ) : (view === 'songs' || view === 'favorites') ? (
          displayTracks.length === 0 ? (
            <div style={{ padding: '28px 18px', color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
              {view === 'favorites' && !search ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Favorites</div>
                  <div style={{ marginBottom: 8 }}>
                    Your favorite tracks show up here. Tap the heart icon on any song to add it — in the library list, the now-playing view, or the right-click menu.
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6 }}>
                    Favorites aren't a playlist — they're a live filter across your entire library, so they stay in sync automatically.
                  </div>
                </>
              ) : (
                <>No matches for "{search}"</>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Recently played strip — only in songs view, no search active */}
              {view === 'songs' && !search && recentlyPlayedEnabled ? (
                <div style={{ padding: '6px 12px 0', flexShrink: 0 }}>
                  <RecentlyPlayed
                    playEvents={playEvents}
                    library={library}
                    accent={accent}
                    onPlayTrack={onPlayTrack}
                  />
                </div>
              ) : null}
              <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Two-pane mode adds an artists list on the LEFT. The
                  artist pane shows distinct primary artists from the
                  filtered library (after search), with track counts
                  per artist. Click an artist to filter the right pane;
                  click "All artists" to clear the filter. */}
              {twoPaneEnabled ? (
                <TwoPaneArtistList
                  artists={twoPaneArtists}
                  selected={twoPaneArtist}
                  onSelect={setTwoPaneArtist}
                  accent={accent}
                />
              ) : null}
              <VirtualTrackList
                tracks={twoPaneFilteredTracks}
                playContext={songsPlayContext}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                hovered={hovered}
                setHovered={setHovered}
                onPlayTrack={onPlayTrack}
                onPlayPauseTrack={onPlayPauseTrack}
                canEdit={canEdit}
                onEditTrack={onEditTrack}
                canRemove={canRemove}
                onRemoveFromLibrary={onRemoveFromLibrary}
                canAddToPlaylist={canAddToPlaylist}
                onAddToPlaylist={onAddToPlaylist}
                onAddToQueue={onAddToQueue}
                onPlayNext={onPlayNext}
                onToggleFavorite={onToggleFavorite}
                onTrackContextMenu={onTrackContextMenu}
                firstTimeSparkleEnabled={firstTimeSparkleEnabled}
                clickToFilterEnabled={clickToFilterEnabled}
                onFilterByText={onFilterByText}
                accent={accent}
                scrollToIndexRef={scrollToTrackIndexRef}
              />
              {/* A-Z rail — hidden in two-pane mode since the artist
                  list serves the same "browse by letter" function. */}
              {alphaRailVisible && alphaIndex && !twoPaneEnabled ? (
                <AlphaRail
                  alphaIndex={alphaIndex}
                  reverse={sortMode === 'zToA'}
                  onJump={(idx) => {
                    if (typeof scrollToTrackIndexRef.current === 'function') {
                      scrollToTrackIndexRef.current(idx);
                    }
                  }}
                  accent={accent}
                />
              ) : null}
            </div>
            </div>
          )
        ) : view === 'playlists' ? (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 12px 12px', overscrollBehavior: 'contain' }}>
            {playlists.length === 0 ? (
              <div style={{ padding: '28px 18px' }}>
                <div style={{ fontSize: 14, fontWeight: 200, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>Playlists</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7, marginBottom: 8 }}>
                  Group tracks into custom playlists. Right-click any song and choose "Add to playlist," or create one from scratch with the button below.
                </div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 10.5, lineHeight: 1.6, marginBottom: 16 }}>
                  You can also pin your favorite playlists to the dock for quick access — look for the star icon on each playlist row.
                </div>
                {typeof onNewPlaylist === 'function' ? (
                  <button type="button" onClick={onNewPlaylist}
                    style={{
                      padding: '8px 16px', borderRadius: 9,
                      background: `rgba(${accent}, 0.4)`,
                      border: `1px solid rgba(${accent}, 0.55)`,
                      color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>
                    + New playlist
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                {/* New-playlist row pinned at the top */}
                {typeof onNewPlaylist === 'function' ? (
                  <button type="button" onClick={onNewPlaylist}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 8px', marginBottom: 4,
                      borderRadius: 9, border: 'none',
                      background: 'transparent', color: 'rgba(255,255,255,0.85)',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                      border: '1px dashed rgba(255,255,255,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'rgba(255,255,255,0.55)', fontSize: 18, lineHeight: 1, fontWeight: 300,
                    }}>+</div>
                    <div style={{ minWidth: 0, flex: 1, fontSize: 11.5, fontWeight: 600 }}>
                      New playlist…
                    </div>
                  </button>
                ) : null}
                {playlists.filter((pl) => !search || pl.name?.toLowerCase().includes(search.toLowerCase())).map((pl) => {
                  const trackCovers = playlistCoverMap.get(pl.id) || [];
                  const count = pl.trackIds?.length || 0;
                  return (
                    <div
                      key={pl.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenPlaylist?.(pl.id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 8px', marginBottom: 2,
                        borderRadius: 9, border: 'none',
                        background: 'transparent', color: '#fff',
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <PlaylistThumb playlist={pl} trackCovers={trackCovers} size={42} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.95)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          marginBottom: 1,
                        }}>
                          {pl.name || 'Untitled playlist'}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
                          {count === 0 ? 'Empty' : `${count} ${count === 1 ? 'track' : 'tracks'}`}
                        </div>
                      </div>
                      {onTogglePinnedPlaylist ? (
                        <button type="button" title={pinnedPlaylists.includes(pl.id) ? 'Unpin from dock' : 'Pin to dock'}
                          onClick={(e) => { e.stopPropagation(); onTogglePinnedPlaylist(pl.id); }}
                          style={{
                            flexShrink: 0, width: 24, height: 24, borderRadius: 6,
                            border: 'none', padding: 0, cursor: 'pointer',
                            background: pinnedPlaylists.includes(pl.id) ? `rgba(${accent},0.2)` : 'transparent',
                            color: pinnedPlaylists.includes(pl.id) ? '#fff' : 'rgba(255,255,255,0.25)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = `rgba(${accent},0.15)`; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = pinnedPlaylists.includes(pl.id) ? '#fff' : 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = pinnedPlaylists.includes(pl.id) ? `rgba(${accent},0.2)` : 'transparent'; }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill={pinnedPlaylists.includes(pl.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2 L14.5 9 L21.5 9 L16 13.5 L18 21 L12 16.5 L6 21 L8 13.5 L2.5 9 L9.5 9 Z" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ) : openAlbumData ? (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '2px 6px 12px', overscrollBehavior: 'contain' }}>
            <AlbumDetailView
              album={openAlbumData}
              tracks={openAlbumTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              hovered={hovered}
              setHovered={setHovered}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              onBack={() => setOpenAlbum(null)}
              onPlayTrack={(track) => onPlayTrack(track, openAlbumData.tracks)}
              onPlayPauseTrack={(track) => onPlayPauseTrack(track, openAlbumData.tracks)}
              canRemove={canRemove}
              onRemoveFromLibrary={onRemoveFromLibrary}
              canEdit={canEdit}
              onEditTrack={onEditTrack}
              canEditAlbum={canEditAlbum}
              onEditAlbum={onEditAlbum}
              canAddToPlaylist={canAddToPlaylist}
              onAddToPlaylist={onAddToPlaylist}
              onTrackContextMenu={onTrackContextMenu}
              accent={accent}
              onDownloadMissing={(track, ctx) => {
                const apiRef = window.electronAPI;
                if (!apiRef?.playlistImportBatch) { ctx.onStatus?.('failed'); return; }
                const sid = track.spotifyId || track.title;
                // Listen for this track's progress, then fire a one-track
                // Soulseek import (reuses the full search/score/download flow).
                let unsub = null;
                if (apiRef.onPlaylistImportProgress) {
                  unsub = apiRef.onPlaylistImportProgress((p) => {
                    if (!p || (p.spotifyId !== sid && p.spotifyId !== track.spotifyId)) return;
                    if (p.state === 'starting') ctx.onStatus?.('downloading');
                    else if (p.state === 'done') { ctx.onStatus?.('done'); unsub?.(); }
                    else if (p.state === 'failed') { ctx.onStatus?.('failed'); unsub?.(); }
                  });
                }
                ctx.onStatus?.('downloading');
                apiRef.playlistImportBatch({
                  source: 'soulseek',
                  tracks: [{
                    spotifyId: sid,
                    title: track.title,
                    artists: track.artists || ctx.artist || '',
                    album: ctx.album || '',
                    albumArtUrl: ctx.albumArtUrl || '',
                    durationMs: track.durationMs || 0,
                    trackNumber: track.trackNumber || 0,
                    explicit: track.explicit ? 1 : 0,
                  }],
                }).then((res) => {
                  // Fallback in case progress events didn't fire.
                  if (res && typeof res.completed === 'number') {
                    ctx.onStatus?.(res.completed > 0 ? 'done' : 'failed');
                  }
                  unsub?.();
                }).catch(() => { ctx.onStatus?.('failed'); unsub?.(); });
              }}
            />
          </div>
        ) : (
          <div style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px 6px 12px',
            overscrollBehavior: 'contain',
            // Reserve scrollbar gutter at all times so the grid's available
            // width is constant regardless of whether content overflows.
            // Without this, hovering a card can trigger a tiny layout shift
            // (the play-overlay/transition pushes a 1px change in total
            // height, which can cross the scrollbar threshold, which changes
            // available width, which makes the grid reflow — making every
            // card subtly resize). `scrollbar-gutter: stable` is the
            // modern, browser-managed way to handle this.
            scrollbarGutter: 'stable',
          }}>
            {filteredAlbums.length === 0 ? (
              <div style={{ padding: '20px 16px', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                No albums match "{search}"
              </div>
            ) : (
              <>
                {/* View toggle: aligned right so it doesn't crowd the album grid. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px 8px' }}>
                  <AlbumViewToggle mode={albumViewMode} onChange={setAlbumViewMode} />
                </div>
                {albumViewMode === 'stack' ? (
                  <AlbumStackView
                    albums={filteredAlbums}
                    currentTrack={currentTrack}
                    onOpenAlbum={(key) => { setOpenAlbum(key); onSearchChange?.(''); }}
                    onPlayAlbum={(albumEntry) => onPlayTrack(albumEntry.tracks[0], albumEntry.tracks)}
                    accent={accent}
                  />
                ) : (
                  <AlbumGridView
                    albums={filteredAlbums}
                    currentTrack={currentTrack}
                    onOpenAlbum={(key) => { setOpenAlbum(key); onSearchChange?.(''); }}
                    onPlayAlbum={(albumEntry) => onPlayTrack(albumEntry.tracks[0], albumEntry.tracks)}
                    accent={accent}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}


/**
 * Render an album cover. When a multi-disc album has two (or more) distinct
 * cover images, shows them split along a diagonal — top-left = first disc,
 * bottom-right = second disc — with a thin divider line for definition.
 * Falls back to a single image otherwise.
 */
/**
 * VirtualTrackList — renders only the rows currently visible in the scroll
 * window, plus a small overscan. Handles libraries of any size without DOM
 * bloat. Each row is a fixed ROW_H pixels tall so we can calculate positions
 * arithmetically with no layout queries.
 */
const ROW_H = 48; // px — must match the rendered row height (6px pad top + 36px content + 6px pad bottom)
const OVERSCAN = 5; // extra rows above and below the visible window

/**
 * FilterableText — inline span that renders text and, on click, calls
 * `onFilter(text)`. Visually distinct from plain text (cursor pointer,
 * underline-on-hover, brighter colour on hover) so the user knows it's
 * interactive. Always stops click propagation so the parent row's onClick
 * doesn't also fire (which would mark the row as selected and play it).
 *
 * The component takes only the bare minimum styling to integrate — the
 * parent's font-size / colour cascade through normally. Hover effects use
 * local React state so each instance is independent.
 */
function FilterableText({ text, title, onFilter }) {
  const [hovered, setHovered] = useState(false);
  if (!text) return null;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onFilter?.(text);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onFilter?.(text);
        }
      }}
      style={{
        cursor: 'pointer',
        // Brighten on hover — using `inherit` baseline lets parent contexts
        // (e.g. the artist line at 0.5 opacity) drive resting colour while
        // hover gives a clear "now you can click me" signal.
        color: hovered ? 'rgba(255,255,255,0.95)' : 'inherit',
        textDecoration: hovered ? 'underline' : 'none',
        textUnderlineOffset: 2,
        transition: 'color 0.12s',
      }}
    >
      {text}
    </span>
  );
}


/* =========================================================================
 *  TwoPaneArtistList — left pane in the two-pane library view. Lists
 *  distinct primary artists with track counts; clicking one filters the
 *  right pane to that artist's tracks. A pinned "All artists" row at
 *  the top clears the filter.
 * ========================================================================= */
function TwoPaneArtistList({ artists = [], selected, onSelect, accent }) {
  return (
    <div style={{
      flexShrink: 0,
      width: 180,
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.05)',
      overflowY: 'auto', overflowX: 'hidden',
      overscrollBehavior: 'contain',
      padding: '4px 6px 12px',
    }}>
      <ArtistListRow
        label="All artists"
        count={artists.reduce((sum, a) => sum + a.count, 0)}
        active={selected == null}
        accent={accent}
        onClick={() => onSelect?.(null)}
        muted
      />
      {artists.map((a) => (
        <ArtistListRow
          key={a.name}
          label={a.name}
          count={a.count}
          active={selected === a.name}
          accent={accent}
          onClick={() => onSelect?.(a.name)}
        />
      ))}
    </div>
  );
}

function ArtistListRow({ label, count, active, accent, onClick, muted }) {
  const [hov, setHov] = useState(false);
  const bg = active
    ? `rgba(${accent}, 0.22)`
    : hov ? 'rgba(255,255,255,0.05)' : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '6px 8px', borderRadius: 6,
        background: bg, border: 'none',
        color: active ? '#fff' : 'rgba(255,255,255,0.78)',
        cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.12s',
        flexShrink: 0,
      }}
    >
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 11.5, fontWeight: active ? 700 : 500,
        fontStyle: muted ? 'italic' : 'normal',
        color: muted && !active ? 'rgba(255,255,255,0.55)' : undefined,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <span style={{
        flexShrink: 0,
        fontSize: 9.5, color: 'rgba(255,255,255,0.4)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {count}
      </span>
    </button>
  );
}


/* =========================================================================
 *  AlphaRail — vertical A-Z (or Z-A) letter rail floating on the right
 *  edge of the library list. Tap a letter to scroll the matching track
 *  into view at the top.
 *
 *  Letters with no tracks of that letter (alphaIndex value of -1) are
 *  rendered dimmed and untappable. Letters that have tracks are tappable;
 *  a hover state highlights them with the accent colour.
 *
 *  Drag-scrubbing: holding mousedown and dragging up/down across the rail
 *  jumps to whichever letter the cursor is currently over. Many users
 *  expect this from iOS/iTunes' alphabetic sidebars, where the affordance
 *  is "scrub through the alphabet."
 *
 *  Compact 18px wide; the letters are tiny but legible at the small font.
 *  No labels or captions — the alphabet is universal so no chrome needed.
 * ========================================================================= */
function AlphaRail({ alphaIndex, reverse = false, onJump, accent }) {
  // Letter list. Reversed for Z-A so the visual order matches the sort.
  const letters = useMemo(() => {
    const base = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    return reverse ? [...base].reverse() : base;
  }, [reverse]);

  const [activeLetter, setActiveLetter] = useState(null);
  const railRef = useRef(null);

  // Resolve the letter under a given clientY by walking the rail's
  // children. Used for both click and drag-scrub. We cache the
  // children list per drag to avoid querying on every mousemove —
  // the rail is short (27 cells) so this is cheap.
  const letterAtY = (clientY) => {
    const rail = railRef.current;
    if (!rail) return null;
    const cells = rail.querySelectorAll('[data-alpha]');
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return cell.getAttribute('data-alpha');
      }
    }
    return null;
  };

  // Trigger jump for a letter, but only if that letter has tracks.
  const tryJump = (letter) => {
    if (!letter) return;
    const idx = alphaIndex.get(letter);
    if (idx == null || idx < 0) return;
    setActiveLetter(letter);
    if (typeof onJump === 'function') onJump(idx);
  };

  // Drag-scrub. Mouse-down on the rail (anywhere) starts a scrub
  // session that follows the cursor until mouse-up. Each unique
  // letter under the cursor triggers a fresh jump.
  const handleMouseDown = (e) => {
    e.preventDefault();
    const initial = letterAtY(e.clientY);
    if (initial) tryJump(initial);
    let last = initial;
    const onMove = (ev) => {
      const l = letterAtY(ev.clientY);
      if (l && l !== last) {
        last = l;
        tryJump(l);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Clear active highlight after a brief moment so the user sees
      // where they landed before it fades.
      setTimeout(() => setActiveLetter(null), 400);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={railRef}
      onMouseDown={handleMouseDown}
      style={{
        flexShrink: 0,
        width: 18,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-around',
        padding: '6px 0',
        userSelect: 'none',
        // Subtle left-edge separator so the rail reads as a distinct
        // affordance rather than running into the track rows.
        borderLeft: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {letters.map((letter) => {
        const idx = alphaIndex.get(letter);
        const empty = idx == null || idx < 0;
        const isActive = activeLetter === letter;
        return (
          <div
            key={letter}
            data-alpha={letter}
            style={{
              flex: 1, minHeight: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em',
              color: isActive
                ? `rgba(${accent}, 1)`
                : empty
                  ? 'rgba(255,255,255,0.15)'
                  : 'rgba(255,255,255,0.5)',
              cursor: empty ? 'default' : 'pointer',
              transition: 'color 0.12s',
              // No hover state inline; we rely on activeLetter for visual
              // feedback during drag. Hover is implicit via the cursor.
            }}
          >
            {letter}
          </div>
        );
      })}
    </div>
  );
}


function VirtualTrackList({
  tracks,
  playContext = 'list',
  currentTrack,
  isPlaying,
  selectedId,
  setSelectedId,
  hovered,
  setHovered,
  onPlayTrack,
  onPlayPauseTrack,
  canEdit,
  onEditTrack,
  canRemove,
  onRemoveFromLibrary,
  canAddToPlaylist,
  onAddToPlaylist,
  onAddToQueue,
  onPlayNext,
  onToggleFavorite,
  onTrackContextMenu,
  firstTimeSparkleEnabled = false,
  clickToFilterEnabled = false,
  onFilterByText,
  accent,
  // Optional ref the parent can populate with a scroll-to-index function.
  // Used by the A-Z quick-jump rail to jump to the first track of a given
  // letter. We expose this via a mutable ref rather than imperative
  // handles to keep the component a plain function.
  scrollToIndexRef,
}) {
  const outerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  // Sync scroll position
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(el.scrollTop);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Sync container height via ResizeObserver
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setViewHeight(e.contentRect.height);
      }
    });
    ro.observe(el);
    setViewHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Expose imperative scroll-to-index for the A-Z rail. Lives in a single
  // effect so the function is rebuilt only when row height could change
  // (which it doesn't — but keep the dep array honest). The rail calls
  // this when the user taps a letter; it scrolls the target row to ~24px
  // below the top of the viewport so it's clearly the "first match."
  useEffect(() => {
    if (!scrollToIndexRef) return undefined;
    scrollToIndexRef.current = (idx) => {
      const el = outerRef.current;
      if (!el || !Number.isInteger(idx) || idx < 0) return;
      const target = Math.max(0, idx * ROW_H - 24);
      // Use the browser's smooth scroll — short hops feel fine, long
      // hops complete in ~300ms which is fast enough that the user
      // doesn't lose the "I tapped a letter" cause-and-effect.
      el.scrollTo({ top: target, behavior: 'smooth' });
    };
    return () => {
      // Don't null the ref out unconditionally — another instance might
      // have populated it. Only clear if we still own it.
      if (scrollToIndexRef.current && scrollToIndexRef.current.__owner === outerRef) {
        scrollToIndexRef.current = null;
      }
    };
  }, [scrollToIndexRef]);

  // Scroll the current track into view when it changes — uses a slow ease
  // so large jumps don't feel hectic
  const scrollAnimRef = useRef(null);
  useEffect(() => {
    if (!currentTrack || !outerRef.current) return;
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return;
    const el = outerRef.current;
    const rowTop = idx * ROW_H;
    const rowBot = rowTop + ROW_H;
    if (rowTop >= el.scrollTop && rowBot <= el.scrollTop + el.clientHeight) return; // already visible

    const target = Math.max(0, rowTop - el.clientHeight / 2 + ROW_H / 2);
    const start = el.scrollTop;
    const distance = target - start;
    if (Math.abs(distance) < 2) return;

    const DURATION = 600; // ms — slow enough to feel calm over any distance
    const startTime = performance.now();

    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);
      // Ease-out cubic — decelerates to a stop, no bounce
      const eased = 1 - Math.pow(1 - progress, 3);
      el.scrollTop = start + distance * eased;
      if (progress < 1) {
        scrollAnimRef.current = requestAnimationFrame(step);
      }
    };
    scrollAnimRef.current = requestAnimationFrame(step);

    return () => {
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    };
  }, [currentTrack?.id, tracks]);

  const totalHeight = tracks.length * ROW_H;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const lastVisible = Math.min(tracks.length - 1, Math.ceil((scrollTop + viewHeight) / ROW_H) + OVERSCAN);
  const visibleTracks = tracks.slice(firstVisible, lastVisible + 1);
  const paddingTop = firstVisible * ROW_H;
  const paddingBot = Math.max(0, (tracks.length - lastVisible - 1) * ROW_H);

  return (
    <div
      ref={outerRef}
      style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '2px 6px 12px' }}
    >
      {/* Keyframes for the first-time-hearing sparkle. Mounted once at the
          list root so all rows share the same animation. */}
      <style>{`
        @keyframes immerseFirstTimeSparkle {
          0%, 100% { opacity: 0.55; transform: scale(0.85); }
          50%      { opacity: 1.0;  transform: scale(1.15); }
        }
      `}</style>
      {/* Top spacer — represents rows above the visible window */}
      {paddingTop > 0 && <div style={{ height: paddingTop }} />}

      {visibleTracks.map((track) => {
        const i = tracks.indexOf(track);
        const isCur = currentTrack?.id === track.id;
        const isSel = selectedId === track.id;
        const isHov = hovered === track.id;
        return (
          <div key={track.id}
            onMouseEnter={() => setHovered(track.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setSelectedId(track.id)}
            onDoubleClick={() => onPlayTrack(track, tracks, playContext)}
            onContextMenu={onTrackContextMenu ? (e) => onTrackContextMenu(e, track) : undefined}
            style={{
              display: 'grid', gridTemplateColumns: '22px 36px 1fr auto',
              alignItems: 'center', gap: 10,
              padding: '6px 8px', cursor: 'pointer', borderRadius: 9,
              height: ROW_H, boxSizing: 'border-box',
              background: isCur ? `rgba(${accent},0.24)` : isSel ? 'rgba(255,255,255,0.05)' : isHov ? 'rgba(255,255,255,0.035)' : 'transparent',
            }}>
            {/* Index / play button */}
            <div style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isCur ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {(isHov || isCur) ? (
                <button type="button" title={isCur && isPlaying ? 'Pause' : 'Play'}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); (onPlayPauseTrack || onPlayTrack)(track, tracks, playContext); }}
                  style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ transform: 'scale(0.72)' }}>{isCur && isPlaying ? <Icons.Pause /> : <Icons.Play />}</span>
                </button>
              ) : String(i + 1).padStart(2, '0')}
            </div>
            {/* Cover art */}
            <div style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a', flexShrink: 0 }}>
              {track.coverArt
                ? <img src={track.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" decoding="async" />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}><Icons.AlbumSidebar /></div>}
            </div>
            {/* Title + artist */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: isCur ? '#fff' : 'rgba(255,255,255,0.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* First-time-hearing sparkle — small pulsing dot for tracks
                    that have never been played (playCount === 0). Helps
                    unheard music feel discoverable in big libraries. The
                    dot disappears the moment playCount goes above 0 (which
                    happens once playback crosses the scrobble threshold). */}
                {firstTimeSparkleEnabled && !((Number(track.playCount) || 0) > 0) ? (
                  <span
                    aria-label="First time hearing"
                    title="First time hearing this"
                    style={{
                      flexShrink: 0,
                      width: 6, height: 6, borderRadius: '50%',
                      background: `rgb(${accent})`,
                      boxShadow: `0 0 8px rgba(${accent}, 0.7)`,
                      animation: 'immerseFirstTimeSparkle 2s ease-in-out infinite',
                    }}
                  />
                ) : null}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title || 'Untitled'}</span>
                {track.explicit === 1 ? <ExplicitBadge /> : null}
                {/* Favorite indicator — when the hover action buttons are
                    suppressed (right-click menu mode), favorited tracks
                    still need a visible indicator. Tiny non-interactive
                    heart inline with the title. */}
                {track.isFavorite && onTrackContextMenu ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#f37272" aria-hidden style={{ flexShrink: 0 }}>
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                ) : null}
              </div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {clickToFilterEnabled && (track.artist || '').trim() ? (
                  <FilterableText
                    text={track.artist}
                    title={`Filter library by ${track.artist}`}
                    onFilter={onFilterByText}
                  />
                ) : (track.artist || '—')}
              </div>
            </div>
            {/* Actions — show on hover OR when favorited (so heart is always
                visible for favorites). Suppressed entirely when right-click
                context menus are enabled — the menu has all the same actions
                so the hover buttons would be redundant clutter. */}
            {(isHov || track.isFavorite) && !onTrackContextMenu && (canEdit || canRemove || canAddToPlaylist || onToggleFavorite) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                {onToggleFavorite ? (
                  <button type="button" title={track.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(track.id); }}
                    style={{
                      width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent',
                      color: track.isFavorite ? '#f37272' : 'rgba(255,255,255,0.55)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}
                    onMouseEnter={(e) => { if (!track.isFavorite) { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; } }}
                    onMouseLeave={(e) => { if (!track.isFavorite) { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; } }}>
                    <svg width="13" height="13" viewBox="0 0 24 24"
                      fill={track.isFavorite ? 'currentColor' : 'none'}
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>
                ) : null}
                {isHov && typeof onAddToQueue === 'function' ? (
                  <button type="button" title="Add to queue"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onAddToQueue(track); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="3" y1="6" x2="16" y2="6" />
                      <line x1="3" y1="12" x2="16" y2="12" />
                      <line x1="3" y1="18" x2="11" y2="18" />
                      <line x1="19" y1="15" x2="19" y2="21" />
                      <line x1="16" y1="18" x2="22" y2="18" />
                    </svg>
                  </button>
                ) : null}
                {isHov && canAddToPlaylist ? (
                  <button type="button" title="Add to playlist"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onAddToPlaylist([track.id], e.currentTarget); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1, fontWeight: 300, padding: 0 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    +
                  </button>
                ) : null}
                {isHov && canEdit ? (
                  <button type="button" title="Edit metadata"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onEditTrack(track.id); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ transform: 'scale(0.8)' }}><Icons.Edit /></span>
                  </button>
                ) : null}
                {isHov && canRemove ? (
                  <button type="button" title="Remove from library"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveFromLibrary([track.id]); }}
                    style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ transform: 'scale(0.85)' }}><Icons.Trash /></span>
                  </button>
                ) : null}
              </div>
            ) : (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, paddingRight: 4 }}>
                {track.duration ? formatTime(track.duration) : ''}
              </span>
            )}
          </div>
        );
      })}

      {/* Bottom spacer — represents rows below the visible window */}
      {paddingBot > 0 && <div style={{ height: paddingBot }} />}
    </div>
  );
}


export { LibraryTab, FilterableText, TwoPaneArtistList, ArtistListRow, AlphaRail, VirtualTrackList };
