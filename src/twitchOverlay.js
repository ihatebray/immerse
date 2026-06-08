/**
 * twitchOverlay.js — a tiny local HTTP server that exposes Immerse's
 * now-playing state as an OBS / Streamlabs **browser source** overlay.
 *
 * How it's used:
 *   1. The user enables the overlay in Immerse (Settings → toggles this on).
 *   2. Immerse starts this server on a localhost port and shows the URL.
 *   3. The user adds a Browser Source in OBS pointing at:
 *          http://127.0.0.1:<port>/overlay
 *   4. The renderer pushes the current track via `setNowPlaying(...)` on every
 *      playback change (mirroring the Discord presence flow). The overlay page
 *      polls `/nowplaying.json` and animates updates.
 *
 * Design notes:
 *   - No external dependencies — Node's built-in `http` only.
 *   - Bound to 127.0.0.1 so it's not exposed on the network.
 *   - Cover art: the renderer passes whatever URL it has (http(s) or a
 *     `studio-cover://`/data URL). For OBS, http(s) and data: URLs work
 *     directly; if only embedded art exists the renderer can pass a data URL.
 *   - The overlay HTML is styled to match Immerse: dark glass, the user's
 *     accent, thin large type, cover-art-as-environment bleed.
 */

import http from 'http';

let server = null;
let port = 0;
let state = {
  title: '',
  artist: '',
  album: '',
  coverArtUrl: '',
  isPlaying: false,
  accent: '210,95,70',
  // Visual options the user can tweak from settings:
  theme: 'glass',        // 'glass' | 'minimal' | 'bar'
  showWhenPaused: true,
  updatedAt: 0,
};

function overlayHtml() {
  // Self-contained page. Polls /nowplaying.json and crossfades on change.
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Immerse — Now Playing</title>
<style>
  :root { --acc: 210,95,70; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { background:transparent; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  #card {
    position:relative; display:flex; align-items:center; gap:18px;
    width:420px; max-width:calc(100vw - 16px); margin:8px;
    padding:14px 20px 14px 14px; border-radius:18px; overflow:hidden;
    background:rgba(18,18,20,0.55);
    backdrop-filter:blur(30px) saturate(1.6); -webkit-backdrop-filter:blur(30px) saturate(1.6);
    border:1px solid rgba(255,255,255,0.08);
    box-shadow:0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
    opacity:0; transform:translateY(10px);
    transition:opacity .5s cubic-bezier(0.16,1,0.3,1), transform .5s cubic-bezier(0.16,1,0.3,1);
  }
  #card.show { opacity:1; transform:translateY(0); }
  /* cover-art-as-environment: a blurred bloom of the cover bleeds behind */
  #bloom {
    position:absolute; inset:-30%; z-index:0;
    background-size:cover; background-position:center;
    filter:blur(48px) saturate(1.7); opacity:0.5; transform:scale(1.2);
    transition:background-image .5s ease;
  }
  #tint { position:absolute; inset:0; z-index:0; background:linear-gradient(90deg, rgba(var(--acc),0.18), transparent 70%); }
  #cover {
    position:relative; z-index:1; width:64px; height:64px; flex-shrink:0; border-radius:12px;
    background-size:cover; background-position:center; background-color:rgba(0,0,0,0.4);
    box-shadow:0 10px 26px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08);
  }
  #meta { position:relative; z-index:1; flex:1; min-width:0; }
  #eq { display:flex; align-items:center; gap:7px; margin-bottom:6px; }
  #eqbars { display:flex; align-items:flex-end; gap:2px; height:11px; }
  #eqbars span { width:3px; background:rgb(var(--acc)); border-radius:2px; animation:eq 0.9s ease-in-out infinite; }
  #eqbars span:nth-child(2){ animation-delay:.2s } #eqbars span:nth-child(3){ animation-delay:.4s } #eqbars span:nth-child(4){ animation-delay:.1s }
  @keyframes eq { 0%,100%{ height:3px } 50%{ height:11px } }
  #label { font-size:9.5px; font-weight:800; letter-spacing:0.18em; text-transform:uppercase; color:rgba(255,255,255,0.55); }
  #title { font-size:18px; font-weight:300; letter-spacing:-0.01em; color:#fff; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #artist { font-size:13px; color:rgba(255,255,255,0.6); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  body.minimal #card { background:transparent; backdrop-filter:none; -webkit-backdrop-filter:none; border:none; box-shadow:none; padding:8px; }
  body.minimal #bloom, body.minimal #tint { display:none; }
  body.paused #eqbars span { animation-play-state:paused; opacity:0.4; }
</style></head>
<body>
  <div id="card">
    <div id="bloom"></div><div id="tint"></div>
    <div id="cover"></div>
    <div id="meta">
      <div id="eq">
        <span id="eqbars"><span></span><span></span><span></span><span></span></span>
        <span id="label">Now Playing</span>
      </div>
      <div id="title">—</div>
      <div id="artist"></div>
    </div>
  </div>
<script>
  const card = document.getElementById('card');
  const bloom = document.getElementById('bloom');
  const cover = document.getElementById('cover');
  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const labelEl = document.getElementById('label');
  let last = '';
  async function tick() {
    try {
      const r = await fetch('/nowplaying.json', { cache:'no-store' });
      const s = await r.json();
      document.documentElement.style.setProperty('--acc', s.accent || '210,95,70');
      document.body.className = (s.theme === 'minimal' ? 'minimal' : '') + (s.isPlaying ? '' : ' paused');
      const has = !!(s.title);
      const visible = has && (s.isPlaying || s.showWhenPaused);
      const key = s.title + '|' + s.artist + '|' + s.coverArtUrl + '|' + s.isPlaying;
      if (key !== last) {
        last = key;
        if (visible) {
          titleEl.textContent = s.title || '';
          artistEl.textContent = [s.artist, s.album].filter(Boolean).join(' — ');
          labelEl.textContent = s.isPlaying ? 'Now Playing' : 'Paused';
          const art = s.coverArtUrl || '';
          cover.style.backgroundImage = art ? 'url("' + art.replace(/"/g,'%22') + '")' : 'none';
          bloom.style.backgroundImage = art ? 'url("' + art.replace(/"/g,'%22') + '")' : 'none';
          card.classList.add('show');
        } else {
          card.classList.remove('show');
        }
      }
    } catch (e) { /* server gone — keep last frame */ }
  }
  tick();
  setInterval(tick, 1000);
</script>
</body></html>`;
}

/** Start the overlay server. Returns { ok, port, url } or { ok:false, error }. */
export function start(preferredPort = 7355) {
  if (server) return { ok: true, port, url: `http://127.0.0.1:${port}/overlay` };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = (req.url || '/').split('?')[0];
      // CORS so OBS's CEF (any origin) can poll without complaint.
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (url === '/nowplaying.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(state));
        return;
      }
      if (url === '/overlay' || url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(overlayHtml());
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    });
    srv.on('error', (e) => {
      // Port in use — try a couple of fallbacks before giving up.
      if (e && e.code === 'EADDRINUSE' && preferredPort < 7360) {
        resolve(start(preferredPort + 1));
      } else {
        resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
    srv.listen(preferredPort, '127.0.0.1', () => {
      server = srv;
      port = preferredPort;
      resolve({ ok: true, port, url: `http://127.0.0.1:${port}/overlay` });
    });
  });
}

export function stop() {
  if (!server) return { ok: true };
  try { server.close(); } catch { /* ignore */ }
  server = null;
  port = 0;
  return { ok: true };
}

/** Update the now-playing payload the overlay shows. Pass null to clear. */
export function setNowPlaying(payload) {
  if (payload == null) {
    state = { ...state, title: '', artist: '', album: '', coverArtUrl: '', isPlaying: false, updatedAt: Date.now() };
    return { ok: true };
  }
  state = {
    ...state,
    title: String(payload.title || ''),
    artist: String(payload.artist || ''),
    album: String(payload.album || ''),
    coverArtUrl: String(payload.coverArtUrl || ''),
    isPlaying: !!payload.isPlaying,
    accent: payload.accent ? String(payload.accent) : state.accent,
    theme: payload.theme || state.theme,
    showWhenPaused: payload.showWhenPaused != null ? !!payload.showWhenPaused : state.showWhenPaused,
    updatedAt: Date.now(),
  };
  return { ok: true };
}

/** Update only visual options (accent/theme/showWhenPaused) without a track. */
export function setOptions(opts = {}) {
  if (opts.accent != null) state.accent = String(opts.accent);
  if (opts.theme != null) state.theme = opts.theme;
  if (opts.showWhenPaused != null) state.showWhenPaused = !!opts.showWhenPaused;
  state.updatedAt = Date.now();
  return { ok: true };
}

export function status() {
  return { ok: true, running: !!server, port, url: server ? `http://127.0.0.1:${port}/overlay` : '' };
}
