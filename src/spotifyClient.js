import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

function credPath() {
  return path.join(app.getPath('userData'), 'spotify-credentials.json');
}

/**
 * User OAuth token storage. Kept SEPARATE from spotify-credentials.json
 * so the user can disconnect their Spotify account without losing the
 * Client ID/Secret used by the client-credentials flow (search, album
 * lookups, single-track imports — none of which need a user login).
 */
function userTokenPath() {
  return path.join(app.getPath('userData'), 'spotify-user-token.json');
}

/**
 * Disk file wins per-field when non-empty, then env fills gaps.
 */
export function loadSpotifyCredentials() {
  const envId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
  const envSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  let fileId = '';
  let fileSecret = '';
  try {
    const raw = fs.readFileSync(credPath(), 'utf8');
    const j = JSON.parse(raw);
    fileId = String(j.clientId || '').trim();
    fileSecret = String(j.clientSecret || '').trim();
  } catch {
    /* no file yet */
  }
  return {
    clientId: fileId || envId,
    clientSecret: fileSecret || envSecret,
  };
}

let tokenCache = { token: null, expiresAt: 0 };

export function invalidateSpotifyTokenCache() {
  tokenCache = { token: null, expiresAt: 0 };
}

export function saveSpotifyCredentials({ clientId, clientSecret }) {
  fs.mkdirSync(path.dirname(credPath()), { recursive: true });
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  fs.writeFileSync(
    credPath(),
    JSON.stringify({ clientId: id, clientSecret: secret }),
    'utf8',
  );
  invalidateSpotifyTokenCache();
}

export function spotifyCredentialsConfigured() {
  const c = loadSpotifyCredentials();
  return !!(c.clientId && c.clientSecret);
}

export async function getSpotifyAccessToken() {
  const { clientId, clientSecret } = loadSpotifyCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('Spotify is not configured. Add Client ID and Secret in Settings.');
  }
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Spotify token failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

/* =========================================================================
 *  OAuth Authorization Code flow with PKCE
 *
 *  Why a second flow?
 *  ------------------
 *  Spotify locked down `/v1/playlists/{id}/tracks` for client-credentials
 *  apps post-Nov 2024 — those requests now return 403 even for fully
 *  public playlists. To read playlist contents we need a USER-authorized
 *  token. This flow gets us one.
 *
 *  Why PKCE and not classic Authorization Code?
 *  --------------------------------------------
 *  Desktop apps can't safely store a client secret (it ships inside the
 *  packaged binary, which anyone can crack open). PKCE solves this by
 *  proving — via a one-time challenge that only the requesting client
 *  knows the verifier for — that the same client started and finished
 *  the flow. No secret needed for the auth exchange. The Client Secret
 *  is still used by the existing client-credentials flow above (which
 *  runs entirely server-side, so the secret never leaves our process).
 *
 *  We reuse the existing Client ID from `spotify-credentials.json`. The
 *  user only needs to register ONE app in their Spotify Developer
 *  Dashboard, with a redirect URI of `http://127.0.0.1:8888/callback`.
 *
 *  Scopes
 *  ------
 *  `playlist-read-private` and `playlist-read-collaborative` are the
 *  minimum scopes for reading playlist contents (including the user's
 *  own private/collab playlists). We deliberately do NOT ask for any
 *  write or library-modify scopes — Immerse only reads.
 *
 *  Token lifecycle
 *  ---------------
 *  - Access token: 1 hour (Spotify-default), refreshed automatically
 *    when within 60s of expiry (matches the buffer used by the
 *    client-credentials cache above).
 *  - Refresh token: long-lived; persists across app restarts. If the
 *    user revokes access via accounts.spotify.com, refresh fails with
 *    400/401 and we clear the stored token — the caller (e.g. the
 *    playlist fetch handler) is then free to fall back to client-
 *    credentials, which will surface a clear "playlist tracks need a
 *    user login" error.
 * ========================================================================= */

export const SPOTIFY_OAUTH_PORT = 8888;
export const SPOTIFY_OAUTH_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_OAUTH_PORT}/callback`;
export const SPOTIFY_OAUTH_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

/** Base64-URL (no padding) — required for PKCE per RFC 7636. */
function base64UrlEncode(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate a PKCE verifier (43-128 chars of URL-safe base64) and its
 * S256 challenge. Caller holds onto the verifier in memory until the
 * code exchange step; we never persist it.
 */
export function generatePkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(64));   // 86 chars
  const challenge = base64UrlEncode(
    crypto.createHash('sha256').update(verifier).digest()
  );
  return { verifier, challenge };
}

/** Random opaque string sent as `state` and verified on callback. */
export function generateOAuthState() {
  return base64UrlEncode(crypto.randomBytes(24));
}

/**
 * Build the Spotify authorize URL the user is sent to in their browser.
 * The Client ID is sourced from disk; the caller passes in the PKCE
 * challenge and state it generated for THIS flow.
 */
export function buildAuthorizeUrl({ challenge, state }) {
  const { clientId } = loadSpotifyCredentials();
  if (!clientId) {
    throw new Error('Spotify Client ID is not configured. Save it in Settings first.');
  }
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', SPOTIFY_OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', SPOTIFY_OAUTH_SCOPES);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  // `show_dialog=true` forces the consent screen every time. Without
  // this, a previously-authorized user gets bounced through silently,
  // which is confusing if they're trying to switch accounts.
  url.searchParams.set('show_dialog', 'true');
  return url.toString();
}

/**
 * Persisted token shape:
 *   { accessToken, refreshToken, expiresAt (ms epoch),
 *     scope, displayName, userId, savedAt }
 */
export function loadUserToken() {
  try {
    const raw = fs.readFileSync(userTokenPath(), 'utf8');
    const j = JSON.parse(raw);
    if (!j?.accessToken || !j?.refreshToken) return null;
    return j;
  } catch {
    return null;
  }
}

export function saveUserToken(tok) {
  fs.mkdirSync(path.dirname(userTokenPath()), { recursive: true });
  fs.writeFileSync(userTokenPath(), JSON.stringify(tok), 'utf8');
}

export function clearUserToken() {
  try {
    fs.unlinkSync(userTokenPath());
  } catch {
    /* already gone */
  }
}

export function hasUserToken() {
  return !!loadUserToken();
}

/**
 * Exchange the one-shot auth code (just received via the loopback
 * redirect) for an access+refresh token pair. Also fetches the user's
 * display name so the Settings UI can show "Connected as Alice".
 *
 * Spotify's token endpoint accepts PKCE-only callers via `client_id`
 * in the body — no Basic auth header, no client secret. That's the
 * whole point of PKCE for desktop apps.
 */
export async function exchangeAuthCode({ code, verifier }) {
  const { clientId } = loadSpotifyCredentials();
  if (!clientId) {
    throw new Error('Spotify Client ID is not configured.');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_OAUTH_REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const tok = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope || SPOTIFY_OAUTH_SCOPES,
    savedAt: Date.now(),
  };
  // Fire-and-forget profile fetch for the display name. Failure here
  // shouldn't break connection — we still have a working token.
  try {
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      tok.displayName = me.display_name || me.id || '';
      tok.userId = me.id || '';
    }
  } catch {
    /* leave displayName empty */
  }
  saveUserToken(tok);
  return tok;
}

/**
 * Refresh the user's access token using the stored refresh token.
 * Spotify sometimes rotates the refresh token on refresh; if a new
 * one comes back, we save it.
 */
async function refreshUserToken(stored) {
  const { clientId } = loadSpotifyCredentials();
  if (!clientId) {
    throw new Error('Spotify Client ID is not configured.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    client_id: clientId,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    // 400 invalid_grant means the refresh token is dead (user revoked,
    // app deleted, password change). Clear it so we don't keep retrying.
    if (res.status === 400 || res.status === 401) {
      clearUserToken();
    }
    throw new Error(`Token refresh failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const next = {
    ...stored,
    accessToken: data.access_token,
    // Refresh token rotation: Spotify MAY return a new one. If absent,
    // the old one is still valid.
    refreshToken: data.refresh_token || stored.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope || stored.scope,
    savedAt: Date.now(),
  };
  saveUserToken(next);
  return next;
}

/**
 * Return a fresh user access token, refreshing if within 60s of expiry.
 * Returns null if no user token is stored OR if refresh failed terminally
 * (token revoked / dashboard app deleted / etc.). Callers should treat
 * null as "user not connected" and either fall back to client-credentials
 * or surface a "please reconnect" message.
 */
export async function getValidUserToken() {
  const stored = loadUserToken();
  if (!stored) return null;
  if (stored.accessToken && Date.now() < stored.expiresAt - 60_000) {
    return stored.accessToken;
  }
  try {
    const refreshed = await refreshUserToken(stored);
    return refreshed.accessToken;
  } catch (e) {
    // refreshUserToken already cleared the token on 4xx; on transient
    // network errors the token stays put and the next call retries.
    console.warn('[spotify] user token refresh failed:', String(e?.message || e));
    return null;
  }
}

/** Internal fetch helper — adds auth, returns parsed JSON. */
/**
 * Low-level GET helper for Spotify API calls.
 *
 * Handles 429 rate limiting automatically by reading the `Retry-After`
 * response header and waiting that long before retrying. The header
 * is given in seconds; we add a small jitter (250ms) on top so multiple
 * concurrent retries don't all wake up at exactly the same moment and
 * re-trigger the limit immediately.
 *
 * Caps the retry wait at 30 seconds — anything longer than that we
 * surface as an error rather than blocking the caller indefinitely.
 * Tools like the rescan handler can then back off further on their own
 * (e.g. pause the whole batch for a minute) rather than hanging here.
 *
 * Number of retries is capped at 2. Most 429s are transient (5–30
 * seconds); if we hit it three times in a row, the caller deserves to
 * see the error and decide what to do.
 */
async function spotifyGet(urlStr) {
  const MAX_RETRIES = 2;
  const MAX_RETRY_WAIT_MS = 30_000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getSpotifyAccessToken();
    const res = await fetch(urlStr, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    // 429: read Retry-After, sleep, retry. The header is in whole
    // seconds for Spotify. Some upstream proxies serve an HTTP-date
    // instead, but Spotify itself uses seconds — we handle both
    // defensively just in case.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = res.headers.get('Retry-After');
      let waitMs = 0;
      if (retryAfter) {
        const n = Number(retryAfter);
        if (Number.isFinite(n) && n > 0) {
          waitMs = n * 1000;
        } else {
          // Fallback for HTTP-date format
          const t = Date.parse(retryAfter);
          if (Number.isFinite(t)) waitMs = Math.max(0, t - Date.now());
        }
      }
      // Default to 5s if header missing/unparseable. Add 250ms jitter
      // so concurrent retries don't all fire simultaneously.
      if (!waitMs) waitMs = 5000;
      waitMs = Math.min(MAX_RETRY_WAIT_MS, waitMs + 250);
      console.warn(`[spotify] rate limited (429), waiting ${waitMs}ms before retry ${attempt + 1}/${MAX_RETRIES}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try {
        const j = JSON.parse(text);
        const msg = j?.error?.message ?? j?.error;
        if (typeof msg === 'string' && msg.trim()) detail = msg.trim();
      } catch {
        /* keep raw slice */
      }
      throw new Error(`Spotify API (${res.status}): ${detail}`);
    }
    return JSON.parse(text);
  }

  // Exhausted retries
  throw new Error('Spotify API (429): rate limited; retries exhausted');
}
/**
 * Catalogue search `q` has a strict undocumented length cap; long strings often yield HTTP 400.
 * @see https://community.spotify.com/t5/Spotify-for-Developers/Search-API-returns-400-Bad-Request-undocumented-max-length-of/td-p/5894581
 */
const SPOTIFY_SEARCH_QUERY_MAX_CHARS = 100;
/**
 * Per-request search `limit`. Spotify documents 1–50, but this app gets HTTP 400 “Invalid limit”
 * for values above 10 (client-credentials). Keep each call at 10 and paginate for more rows.
 */
const SPOTIFY_SEARCH_PAGE_SIZE = 10;
/** After pagination, cap how many tracks / albums we return (Spotify catalogue search ceiling). */
const SPOTIFY_SEARCH_MAX_TRACKS = 50;
const SPOTIFY_SEARCH_MAX_ALBUMS = 50;

function sanitizeCatalogueSearchQuery(raw) {
  let s = String(raw ?? '')
    .trim()
    .replace(/\0/g, '');
  s = s.replace(/\s+/g, ' ');
  const chars = [...s];
  if (chars.length > SPOTIFY_SEARCH_QUERY_MAX_CHARS) {
    return chars.slice(0, SPOTIFY_SEARCH_QUERY_MAX_CHARS).join('');
  }
  return s;
}

/** Spotify search: offset + limit ≤ 1000; `limit` is clamped to {@link SPOTIFY_SEARCH_PAGE_SIZE}. */
function applySearchPaging(url, limit, offset) {
  const lim = Math.min(
    SPOTIFY_SEARCH_PAGE_SIZE,
    Math.max(1, Math.floor(Number(limit)) || SPOTIFY_SEARCH_PAGE_SIZE),
  );
  let off = Math.max(0, Math.floor(Number(offset)) || 0);
  if (off + lim > 1000) off = Math.max(0, 1000 - lim);
  url.searchParams.set('limit', String(lim));
  url.searchParams.set('offset', String(off));
}

/**
 * Search tracks — up to {@link SPOTIFY_SEARCH_MAX_TRACKS} results via paginated calls (limit 10 each).
 */
export async function spotifySearchTracks(q) {
  const query = sanitizeCatalogueSearchQuery(q);
  if (!query) return [];
  const merged = [];
  const seen = new Set();
  let offset = 0;
  while (merged.length < SPOTIFY_SEARCH_MAX_TRACKS && offset < 1000) {
    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'track');
    applySearchPaging(url, SPOTIFY_SEARCH_PAGE_SIZE, offset);
    const data = await spotifyGet(url.toString());
    const block = data.tracks;
    const items = block?.items || [];
    const total = typeof block?.total === 'number' ? block.total : items.length;
    for (const t of items) {
      if (t?.id && !seen.has(t.id)) {
        seen.add(t.id);
        merged.push(t);
      }
    }
    if (items.length < SPOTIFY_SEARCH_PAGE_SIZE || offset + items.length >= total) break;
    offset += SPOTIFY_SEARCH_PAGE_SIZE;
  }
  return mapTrackItems(merged);
}

/**
 * Search albums — up to {@link SPOTIFY_SEARCH_MAX_ALBUMS} results via paginated calls (limit 10 each).
 */
export async function spotifySearchAlbums(q) {
  const query = sanitizeCatalogueSearchQuery(q);
  if (!query) return [];
  const merged = [];
  const seen = new Set();
  let offset = 0;
  while (merged.length < SPOTIFY_SEARCH_MAX_ALBUMS && offset < 1000) {
    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'album');
    applySearchPaging(url, SPOTIFY_SEARCH_PAGE_SIZE, offset);
    const data = await spotifyGet(url.toString());
    const block = data.albums;
    const items = block?.items || [];
    const total = typeof block?.total === 'number' ? block.total : items.length;
    for (const a of items) {
      if (a?.id && !seen.has(a.id)) {
        seen.add(a.id);
        merged.push(a);
      }
    }
    if (items.length < SPOTIFY_SEARCH_PAGE_SIZE || offset + items.length >= total) break;
    offset += SPOTIFY_SEARCH_PAGE_SIZE;
  }
  return merged.map((a) => ({
    albumId: a.id,
    name: a.name,
    artists: (a.artists || []).map((ar) => ar.name).join(', '),
    albumArtUrl: a.images?.[0]?.url || a.images?.[1]?.url || '',
    totalTracks: a.total_tracks || 0,
    releaseDate: a.release_date || '',
    spotifyUrl: a.external_urls?.spotify || '',
  }));
}

/**
 * Get all tracks for a given album ID. Handles pagination for albums > 50 tracks.
 */
export async function spotifyGetAlbumTracks(albumId) {
  const all = [];
  let url = `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`;
  // First call: get album metadata + first page of tracks.
  const albumData = await spotifyGet(url);
  const albumName = albumData.name || '';
  const albumArt = albumData.images?.[0]?.url || albumData.images?.[1]?.url || '';
  const albumArtists = (albumData.artists || []).map((a) => a.name).join(', ');

  let page = albumData.tracks;
  while (page) {
    for (const t of (page.items || [])) {
      all.push({
        spotifyId: t.id,
        title: t.name,
        artists: (t.artists || []).map((a) => a.name).join(', '),
        album: albumName,
        albumArtUrl: albumArt,
        albumArtists,
        durationMs: t.duration_ms || 0,
        trackNumber: t.track_number || 0,
        discNumber: t.disc_number || 1,
        spotifyUrl: t.external_urls?.spotify || '',
        explicit: !!t.explicit,
      });
    }
    if (page.next) {
      page = await spotifyGet(page.next);
    } else {
      page = null;
    }
  }
  all.sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber));
  return { album: albumName, artists: albumArtists, albumArtUrl: albumArt, tracks: all };
}

function mapTrackItems(items) {
  return items.map((t) => ({
    spotifyId: t.id,
    title: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name || '',
    albumArtUrl: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url || '',
    durationMs: t.duration_ms || 0,
    spotifyUrl: t.external_urls?.spotify || '',
    popularity: t.popularity ?? 0,
    explicit: !!t.explicit,
    // Position fields and release date are present on the full track
    // object returned from /v1/search?type=track — the single-track
    // import path needs them but used to drop them on the floor. Pass
    // them through so callers can pre-fill the import payload without
    // a second round-trip.
    trackNumber: t.track_number || null,
    discNumber: t.disc_number || null,
    releaseDate: t.album?.release_date || '',
    primaryArtistId: t.artists?.[0]?.id || '',
  }));
}

/**
 * Full track fetch — used for enrichment when an import only carries a
 * track ID. The basic search response already includes most of these,
 * but importing via a saved spotifyId (e.g. re-running an album sync)
 * needs a fresh fetch.
 */
export async function spotifyGetTrack(trackId) {
  if (!trackId || typeof trackId !== 'string') return null;
  const url = `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`;
  try {
    const t = await spotifyGet(url);
    return {
      spotifyId: t.id,
      title: t.name,
      artists: (t.artists || []).map((a) => a.name).join(', '),
      album: t.album?.name || '',
      albumArtUrl: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url || '',
      durationMs: t.duration_ms || 0,
      spotifyUrl: t.external_urls?.spotify || '',
      explicit: !!t.explicit,
      trackNumber: t.track_number || null,
      discNumber: t.disc_number || null,
      releaseDate: t.album?.release_date || '',
      primaryArtistId: t.artists?.[0]?.id || '',
      // album.id is needed when we want to fetch album-level data
      // (genres in particular, since Spotify exposes genre on album
      // and artist endpoints but not on track).
      albumId: t.album?.id || '',
    };
  } catch {
    return null;
  }
}

/**
 * Artist fetch — Spotify exposes a list of broad genres per artist
 * (e.g. ["pop punk", "emo", "metalcore"]). We use this as a best-effort
 * genre source since per-track genre doesn't exist in their API.
 */
export async function spotifyGetArtist(artistId) {
  if (!artistId || typeof artistId !== 'string') return null;
  const url = `https://api.spotify.com/v1/artists/${encodeURIComponent(artistId)}`;
  try {
    const a = await spotifyGet(url);
    return {
      id: a.id,
      name: a.name,
      genres: Array.isArray(a.genres) ? a.genres.filter((g) => typeof g === 'string' && g.trim()) : [],
    };
  } catch {
    return null;
  }
}
