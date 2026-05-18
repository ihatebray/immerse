import React, { useState, useCallback, useEffect } from 'react';
import Icons from './Icons.jsx';

function formatDurationMs(ms) {
  if (!ms || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function SpotifySearchView({
  credsRefreshKey = 0,
  onImportDone,
  importing,
  setImporting,
  onOpenSettings,
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const [logLine, setLogLine] = useState('');
  const [toolsOk, setToolsOk] = useState(true);
  const [credsOk, setCredsOk] = useState(true);

  const api = window.electronAPI;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, c] = await Promise.all([
          api?.toolsGetState?.(),
          api?.spotifyGetCredsState?.(),
        ]);
        if (cancelled) return;
        setToolsOk(!!t?.installed);
        setCredsOk(!!c?.configured);
      } catch {
        if (!cancelled) {
          setToolsOk(false);
          setCredsOk(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [api, credsRefreshKey]);

  const runSearch = useCallback(async () => {
    if (!api?.spotifySearch) return;
    setError('');
    setResults([]);
    const query = q.trim();
    if (!query) {
      setError('Enter a song or artist to search.');
      return;
    }
    setBusy(true);
    try {
      const list = await api.spotifySearch(query);
      setResults(Array.isArray(list) ? list : []);
      if (!list?.length) setError('No tracks found.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [q, api]);

  const importTrack = async (row) => {
    if (!api?.importFromYoutubeSearch || importing) return;
    setError('');
    setLogLine('');
    setImportingId(row.spotifyId);
    setImporting(true);
    try {
      const res = await api.importFromYoutubeSearch({
        title: row.title,
        artists: row.artists,
        album: row.album || '',
        albumArtUrl: row.albumArtUrl || '',
        durationMs: row.durationMs ?? 0,
        spotifyId: row.spotifyId,
      });
      if (res?.ok && res.track) {
        onImportDone?.(res.track);
        setLogLine('Added to library.');
      } else {
        setError(res?.error || 'Import failed.');
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setImportingId(null);
      setImporting(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      <div style={{ padding: '24px 32px 16px' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Find music</div>
        <div style={{ fontSize: 13, color: '#a7a7a7', marginTop: 4, maxWidth: 720 }}>
          Search Spotify for metadata, then import a match. Import uses yt-dlp (YouTube search) and saves an MP3 into your library.
          Configure Spotify API keys from the gear icon (Developer Dashboard: Client ID + Client Secret).
        </div>
        {!toolsOk ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(243,114,114,0.12)', color: '#f37272', fontSize: 13 }}>
            yt-dlp / ffmpeg not found. Run <span style={{ fontFamily: 'monospace' }}>npm run setup:binaries</span> from the project folder, then restart Immersive.
          </div>
        ) : null}
        {!credsOk ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(255,193,7,0.12)', color: '#ffc107', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Spotify API is not configured yet. Use the gear in the title bar or open settings here.</span>
            {onOpenSettings ? (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onOpenSettings(); }}
                style={{
                  padding: '6px 14px', borderRadius: 16, border: 'none', background: '#ffc107',
                  color: '#000', fontWeight: 600, cursor: 'pointer', fontSize: 12,
                }}
              >
                Open API settings
              </button>
            ) : null}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="Song title, artist, or lyrics snippet…"
            style={{
              flex: 1, maxWidth: 480, padding: '10px 14px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.15)', background: '#121212', color: '#fff', fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={busy}
            style={{
              padding: '10px 22px', borderRadius: 20, border: 'none', background: '#1db954',
              color: '#000', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontSize: 13,
            }}
          >{busy ? 'Searching…' : 'Search'}</button>
        </div>
        {error ? (
          <div style={{ marginTop: 12, color: '#f37272', fontSize: 13 }}>{error}</div>
        ) : null}
        {logLine ? (
          <div style={{ marginTop: 8, color: '#1db954', fontSize: 13 }}>{logLine}</div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 1fr 90px 100px', padding: '8px 32px', color: '#a7a7a7', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span />
        <span>Title</span>
        <span>Album</span>
        <span>Time</span>
        <span style={{ textAlign: 'right' }}>Import</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
        {results.map((row) => (
          <div
            key={row.spotifyId}
            style={{
              display: 'grid',
              gridTemplateColumns: '52px 1fr 1fr 90px 100px',
              alignItems: 'center',
              padding: '10px 16px',
              borderRadius: 6,
              marginBottom: 4,
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 4, overflow: 'hidden', background: '#282828' }}>
              {row.albumArtUrl
                ? <img src={row.albumArtUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}><Icons.AlbumSidebar /></div>}
            </div>
            <div style={{ minWidth: 0, paddingRight: 12 }}>
              <div style={{ color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</div>
              <div style={{ color: '#a7a7a7', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.artists}</div>
            </div>
            <div style={{ color: '#a7a7a7', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.album}</div>
            <div style={{ color: '#a7a7a7', fontSize: 13 }}>{formatDurationMs(row.durationMs)}</div>
            <div style={{ textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => importTrack(row)}
                disabled={importing}
                style={{
                  padding: '6px 14px', borderRadius: 16, border: 'none',
                  background: importingId === row.spotifyId ? 'rgba(29,185,84,0.35)' : 'rgba(255,255,255,0.12)',
                  color: '#fff', fontSize: 12, fontWeight: 600, cursor: importing ? 'wait' : 'pointer',
                }}
              >
                {importingId === row.spotifyId ? '…' : 'Import'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
