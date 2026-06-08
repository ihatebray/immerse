import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { storeCoverFromDataUri } from './coverArtStore.js';

let initPromise;
let SQL;
let db;

function userDataDir() {
  return app.getPath('userData');
}

function dbFilePath() {
  return path.join(userDataDir(), 'library.db');
}

function legacyJsonPath() {
  return path.join(userDataDir(), 'library.json');
}

async function ensureEngine() {
  if (SQL) return SQL;
  if (!initPromise) {
    initPromise = (async () => {
      const initSqlJs = (await import('sql.js/dist/sql-asm.js')).default;
      return initSqlJs();
    })();
  }
  SQL = await initPromise;
  return SQL;
}

function persistAtomic() {
  if (!db) return;
  const dir = userDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = dbFilePath();
  const data = db.export();
  const buf = Buffer.from(data);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, filePath);
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      cover_art_url TEXT,
      year INTEGER,
      genre TEXT,
      track_number INTEGER,
      disc_number INTEGER,
      added_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);');
  db.run('CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);');
  db.run('CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);');
  db.run(`
    CREATE TABLE IF NOT EXISTS lyrics_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      synced_lyrics TEXT,
      plain_lyrics TEXT,
      instrumental INTEGER NOT NULL DEFAULT 0,
      fetched_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      cover_art_url TEXT,
      sort_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (playlist_id, track_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);');
  db.run(`
    CREATE TABLE IF NOT EXISTS play_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_play_events_at ON play_events(at);');
  db.run('CREATE INDEX IF NOT EXISTS idx_play_events_track ON play_events(track_id, at);');
}

/** Existing DBs created before cover_art_url — add column without losing data. */
function migrateTracksCoverArtUrlColumn() {
  try {
    const r = db.exec('PRAGMA table_info(tracks);');
    if (!r[0]?.values?.length) return;
    const colNames = r[0].values.map((row) => row[1]);
    if (colNames.includes('cover_art_url')) return;
    db.run('ALTER TABLE tracks ADD COLUMN cover_art_url TEXT;');
  } catch (e) {
    console.error('migrateTracksCoverArtUrlColumn', e);
  }
}

/** Add year and genre columns to existing tracks tables that predate them. */
function migrateTracksYearGenreColumns() {
  try {
    const r = db.exec('PRAGMA table_info(tracks);');
    if (!r[0]?.values?.length) return;
    const colNames = r[0].values.map((row) => row[1]);
    if (!colNames.includes('year')) {
      db.run('ALTER TABLE tracks ADD COLUMN year INTEGER;');
    }
    if (!colNames.includes('genre')) {
      db.run('ALTER TABLE tracks ADD COLUMN genre TEXT;');
    }
  } catch (e) {
    console.error('migrateTracksYearGenreColumns', e);
  }
}

/** Add track_number and disc_number columns for proper album ordering. */
function migrateTracksTrackDiscColumns() {
  try {
    const r = db.exec('PRAGMA table_info(tracks);');
    if (!r[0]?.values?.length) return;
    const colNames = r[0].values.map((row) => row[1]);
    if (!colNames.includes('track_number')) {
      db.run('ALTER TABLE tracks ADD COLUMN track_number INTEGER;');
    }
    if (!colNames.includes('disc_number')) {
      db.run('ALTER TABLE tracks ADD COLUMN disc_number INTEGER;');
    }
  } catch (e) {
    console.error('migrateTracksTrackDiscColumns', e);
  }
}

/**
 * Add favorite flag, per-track notes, play tracking. Adds columns:
 *   is_favorite  INTEGER 0/1, default 0
 *   notes        TEXT
 *   play_count   INTEGER default 0
 *   last_played  INTEGER (unix ms timestamp), nullable
 */
function migrateTracksFavoritesNotesPlays() {
  try {
    const r = db.exec('PRAGMA table_info(tracks);');
    if (!r[0]?.values?.length) return;
    const colNames = r[0].values.map((row) => row[1]);
    if (!colNames.includes('is_favorite')) {
      db.run('ALTER TABLE tracks ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;');
    }
    if (!colNames.includes('notes')) {
      db.run('ALTER TABLE tracks ADD COLUMN notes TEXT;');
    }
    if (!colNames.includes('play_count')) {
      db.run('ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;');
    }
    if (!colNames.includes('last_played')) {
      db.run('ALTER TABLE tracks ADD COLUMN last_played INTEGER;');
    }
  } catch (e) {
    console.error('migrateTracksFavoritesNotesPlays', e);
  }
}

/**
 * Tracks the EXPECTED explicit flag for each track, sourced from the streaming
 * service (Spotify / iTunes) at import time. NULL = unknown (track was
 * imported manually without metadata, or via "+ Folder" / "+ Files"). 0 = clean,
 * 1 = explicit. We don't trust the actual yt-dlp audio for this — we record what
 * the streaming service said the song SHOULD be, so the user can spot mismatches.
 */
function migrateTracksExplicit() {
  try {
    const r = db.exec('PRAGMA table_info(tracks);');
    if (!r[0]?.values?.length) return;
    const colNames = r[0].values.map((row) => row[1]);
    if (!colNames.includes('explicit')) {
      db.run('ALTER TABLE tracks ADD COLUMN explicit INTEGER;');
    }
  } catch (e) {
    console.error('migrateTracksExplicit', e);
  }
}

/**
 * Album notes — keyed by (album, primary_artist) pair since albums are
 * derived from track metadata rather than being their own DB entity.
 */
function migrateAlbumNotesTable() {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS album_notes (
        album TEXT NOT NULL,
        artist TEXT NOT NULL,
        notes TEXT,
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (album, artist)
      );
    `);
  } catch (e) {
    console.error('migrateAlbumNotesTable', e);
  }
}

/**
 * album_links — remembers which Spotify album a library album was resolved /
 * confirmed to, keyed by the same (album, artist) pair as album_notes. This
 * powers the "missing tracks" feature: once an album is matched to a Spotify
 * edition (auto or via the user's confirm/correct step), we store its ID so
 * future opens are exact instead of re-running the fuzzy name search.
 *   spotify_album_id  — the confirmed Spotify album ID
 *   confirmed         — 1 if the user explicitly confirmed, 0 if auto-resolved
 */
function migrateAlbumLinksTable() {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS album_links (
        album TEXT NOT NULL,
        artist TEXT NOT NULL,
        spotify_album_id TEXT NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (album, artist)
      );
    `);
  } catch (e) {
    console.error('migrateAlbumLinksTable', e);
  }
}

/**
 * followed_artists — stores manual overrides for the "new releases" tracker.
 *   action='add'     → user explicitly follows (may not be in library)
 *   action='exclude' → user explicitly unfollows an auto-followed artist
 *
 * Auto-followed artists (anyone in the library with ≥ 2 tracks) are computed
 * at runtime from the library itself, so they don't need DB rows. This table
 * only records deviations from that default. The iTunes artist ID is resolved
 * lazily on first lookup and cached here to avoid repeated search API calls.
 */
function migrateFollowedArtistsTable() {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS followed_artists (
        artist_name TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
        action TEXT NOT NULL DEFAULT 'add',
        itunes_artist_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
      );
    `);
  } catch (e) {
    console.error('migrateFollowedArtistsTable', e);
  }
}

/**
 * artist_releases_cache — stores releases (iTunes albums) that we've fetched
 * for followed artists. Lets the "new releases" tab render instantly without
 * re-hitting the iTunes API on every open. Records are refreshed in the
 * background; stale entries are pruned on write.
 */
function migrateArtistReleasesCacheTable() {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS artist_releases_cache (
        itunes_artist_id INTEGER NOT NULL,
        collection_id INTEGER NOT NULL,
        collection_name TEXT,
        artist_name TEXT,
        release_date TEXT,
        artwork_url TEXT,
        track_count INTEGER,
        collection_view_url TEXT,
        primary_genre_name TEXT,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (itunes_artist_id, collection_id)
      );
    `);
    // Also an index on release_date for fast "recent releases" queries
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_artist_releases_release_date
      ON artist_releases_cache(release_date DESC);
    `);
    // collection_explicitness: iTunes 'explicit' | 'cleaned' | 'notExplicit'.
    // Added so the renderer can prefer the explicit edition when both an
    // explicit and a cleaned copy of the same album are cached.
    try {
      const info = db.exec("PRAGMA table_info(artist_releases_cache);");
      const cols = info?.[0]?.values?.map((r) => r[1]) || [];
      if (!cols.includes('collection_explicitness')) {
        db.run('ALTER TABLE artist_releases_cache ADD COLUMN collection_explicitness TEXT;');
      }
    } catch (e) {
      console.error('migrate collection_explicitness', e);
    }
  } catch (e) {
    console.error('migrateArtistReleasesCacheTable', e);
  }
}

/**
 * Move inline base64 cover art out of the DB and onto disk.
 *
 * Older versions stored entire `data:image/...;base64,...` strings in the
 * cover_art_url column. A DB with many large covers causes sql.js to run out
 * of WASM heap on SELECT *. This migration rewrites those rows to
 * `studio-cover://local/<hash>.<ext>` URLs and writes the actual image bytes
 * to the userData cover-cache folder. Idempotent — only acts on rows that
 * still start with "data:image/".
 *
 * Processes rows one id at a time (no SELECT *) to keep memory flat.
 */
function migrateInlineCoversToDisk() {
  try {
    // 1) Collect ids of rows that still carry an inline data URI. Fetching
    //    just (id, length) keeps the working set tiny even if a row is huge.
    const idsRes = db.exec("SELECT id FROM tracks WHERE cover_art_url LIKE 'data:image/%';");
    const ids = idsRes?.[0]?.values?.map((r) => r[0]) || [];
    if (ids.length === 0) return;

    console.log(`[cover migration] converting ${ids.length} inline covers to disk…`);
    let converted = 0;
    let failed = 0;

    const selectStmt = db.prepare('SELECT cover_art_url FROM tracks WHERE id = ?;');
    const updateStmt = db.prepare('UPDATE tracks SET cover_art_url = ? WHERE id = ?;');

    for (const id of ids) {
      let dataUri = null;
      try {
        selectStmt.bind([id]);
        if (selectStmt.step()) {
          const row = selectStmt.get();
          dataUri = row?.[0] || null;
        }
        selectStmt.reset();
      } catch (e) {
        console.error('[cover migration] select failed for', id, e);
        failed += 1;
        continue;
      }

      if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) continue;

      const url = storeCoverFromDataUri(dataUri);
      // Release the big string immediately so the next iteration has heap to work with
      dataUri = null;

      if (!url) {
        failed += 1;
        continue;
      }

      try {
        updateStmt.run([url, id]);
        converted += 1;
      } catch (e) {
        console.error('[cover migration] update failed for', id, e);
        failed += 1;
      }
    }

    selectStmt.free();
    updateStmt.free();

    console.log(`[cover migration] done — converted ${converted}, failed ${failed}`);
    if (converted > 0) persistAtomic();
  } catch (e) {
    console.error('migrateInlineCoversToDisk', e);
  }
}

function rowToTrack(row) {
  const url = row.cover_art_url && String(row.cover_art_url).trim();
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    coverArt: url || null,
    year: row.year != null ? Number(row.year) : null,
    genre: row.genre || '',
    trackNumber: row.track_number != null ? Number(row.track_number) : null,
    discNumber: row.disc_number != null ? Number(row.disc_number) : null,
    isFavorite: row.is_favorite ? true : false,
    notes: row.notes || '',
    playCount: row.play_count != null ? Number(row.play_count) : 0,
    lastPlayed: row.last_played != null ? Number(row.last_played) : null,
    addedAt: row.added_at != null ? Number(row.added_at) : null,
    // explicit: null = unknown (typically a "+ Folder" import where Spotify
    // never told us). 0 = clean, 1 = explicit. This is what the streaming
    // service said the song SHOULD be, not what the actual audio file is.
    explicit: row.explicit == null ? null : (row.explicit ? 1 : 0),
  };
}

function normalizeTrackInput(track) {
  if (!track || typeof track !== 'object') return null;
  const filePath = typeof track.filePath === 'string' ? track.filePath.trim() : '';
  if (!filePath) return null;
  const rawCover = track.coverArtUrl ?? track.cover_art_url ?? track.coverArt;
  let cover_art_url = null;
  if (typeof rawCover === 'string' && rawCover.trim()) {
    const u = rawCover.trim();
    if (/^https?:\/\//i.test(u)) {
      cover_art_url = u.slice(0, 2048);
    } else if (u.startsWith('studio-cover://')) {
      cover_art_url = u.slice(0, 2048);
    } else if (u.startsWith('data:image/')) {
      // Persist to disk and store a lightweight URL in the DB
      const saved = storeCoverFromDataUri(u);
      if (saved) cover_art_url = saved;
    }
  }
  // Year: accept number or numeric string in the valid range
  let year = null;
  const rawYear = track.year;
  if (rawYear != null && rawYear !== '') {
    const n = Number(rawYear);
    if (Number.isFinite(n) && n >= 1000 && n <= 9999) year = Math.floor(n);
  }
  const genre = typeof track.genre === 'string' ? track.genre.trim().slice(0, 200) : '';
  // Track and disc numbers — accept positive integers, ignore anything else
  const clampInt = (v, max = 9999) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > max) return null;
    return Math.floor(n);
  };
  const track_number = clampInt(track.trackNumber ?? track.track_number);
  const disc_number = clampInt(track.discNumber ?? track.disc_number, 99);
  // Explicit: accept boolean true/false or 1/0; null/undefined means unknown.
  // We keep null distinct from 0 (clean) so we can show no badge vs a "clean" badge.
  let explicit = null;
  if (track.explicit === true || track.explicit === 1) explicit = 1;
  else if (track.explicit === false || track.explicit === 0) explicit = 0;
  return {
    id: typeof track.id === 'string' && track.id ? track.id : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file_path: filePath,
    title: typeof track.title === 'string' ? track.title : path.basename(filePath, path.extname(filePath)),
    artist: typeof track.artist === 'string' ? track.artist : 'Unknown Artist',
    album: typeof track.album === 'string' ? track.album : 'Unknown Album',
    duration: typeof track.duration === 'number' && !Number.isNaN(track.duration) ? track.duration : 0,
    cover_art_url,
    year,
    genre: genre || null,
    track_number,
    disc_number,
    explicit,
  };
}

function migrateFromLegacyJsonIfNeeded() {
  const jsonPath = legacyJsonPath();
  if (!fs.existsSync(jsonPath)) return;

  const countRes = db.exec('SELECT COUNT(*) AS c FROM tracks;');
  const count = countRes?.[0]?.values?.[0]?.[0] ?? 0;
  if (count > 0) return;

  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const list = data && Array.isArray(data.tracks) ? data.tracks : [];
    db.run('BEGIN;');
    for (const t of list) {
      const n = normalizeTrackInput(t);
      if (!n) continue;
      db.run(
        'INSERT OR IGNORE INTO tracks (id, file_path, title, artist, album, duration, cover_art_url, year, genre, track_number, disc_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        [n.id, n.file_path, n.title, n.artist, n.album, n.duration, n.cover_art_url, n.year, n.genre, n.track_number, n.disc_number],
      );
    }
    db.run('COMMIT;');
    fs.renameSync(jsonPath, `${jsonPath}.migrated.bak`);
    persistAtomic();
  } catch (e) {
    console.error('library JSON migration failed', e);
    try {
      db.run('ROLLBACK;');
    } catch { /* ignore */ }
  }
}

let openPromise;

export async function ensureLibraryOpen() {
  if (db) return;
  if (!openPromise) {
    openPromise = (async () => {
      await ensureEngine();
      const filePath = dbFilePath();
      fs.mkdirSync(userDataDir(), { recursive: true });

      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        db = new SQL.Database(fileBuffer);
      } else {
        db = new SQL.Database();
      }

      initSchema();
      migrateTracksCoverArtUrlColumn();
      migrateTracksYearGenreColumns();
      migrateTracksTrackDiscColumns();
      migrateTracksFavoritesNotesPlays();
      migrateTracksExplicit();
      migrateAlbumNotesTable();
      migrateAlbumLinksTable();
      migrateFollowedArtistsTable();
      migrateArtistReleasesCacheTable();
      migrateInlineCoversToDisk();
      migrateFromLegacyJsonIfNeeded();
    })();
  }
  await openPromise;
}

export async function loadAllTracks() {
  await ensureLibraryOpen();
  if (!db) return [];
  const res = db.exec(
    'SELECT id, file_path, title, artist, album, duration, cover_art_url, year, genre, track_number, disc_number, is_favorite, notes, play_count, last_played, added_at, explicit FROM tracks ORDER BY added_at ASC, title COLLATE NOCASE ASC;',
  );
  if (!res?.[0]) return [];
  const { columns, values } = res[0];
  return values.map((row) => {
    const obj = {};
    columns.forEach((c, i) => {
      obj[c] = row[i];
    });
    return rowToTrack(obj);
  });
}

/**
 * Remove library rows by track id. Does not delete audio files on disk.
 * @param {string[]} ids
 */
export async function removeTracksByIds(ids) {
  await ensureLibraryOpen();
  if (!db || !Array.isArray(ids)) return { ok: false, error: 'Invalid request', removed: 0 };
  const clean = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (clean.length === 0) return { ok: true, removed: 0 };

  const placeholders = clean.map(() => '?').join(',');
  let stmt;
  db.run('BEGIN;');
  try {
    stmt = db.prepare(`DELETE FROM tracks WHERE id IN (${placeholders})`);
    stmt.run(clean);
    stmt.free();
    stmt = null;
    db.run('COMMIT;');
  } catch (e) {
    try {
      db.run('ROLLBACK;');
    } catch { /* ignore */ }
    try {
      stmt?.free();
    } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e), removed: 0 };
  }
  try {
    persistAtomic();
  } catch (e) {
    return { ok: false, error: String(e?.message || e), removed: 0 };
  }
  return { ok: true, removed: clean.length };
}

/**
 * Nuke all library data from the DB: tracks, playlists, playlist mappings,
 * album notes, cached lyrics, release cache, and follow overrides. Returns the
 * list of file paths that WERE in the tracks table so the caller can
 * optionally delete the audio files from disk.
 *
 * Does NOT touch: app settings (UI preferences, gradient toggle), Spotify
 * credentials, UI font choice. Those are stored separately and should persist.
 */
export async function clearAllLibraryData() {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open', filePaths: [] };

  // Snapshot all file paths before we delete the rows — the caller may want
  // to remove the files from disk.
  let filePaths = [];
  try {
    const res = db.exec('SELECT file_path FROM tracks;');
    if (res?.[0]) {
      filePaths = res[0].values
        .map((row) => String(row[0] || '').trim())
        .filter(Boolean);
    }
  } catch (e) {
    console.error('clearAllLibraryData — snapshot', e);
  }

  db.run('BEGIN;');
  try {
    // Tables that must always exist (created by base schema + migrations).
    db.run('DELETE FROM tracks;');
    db.run('DELETE FROM playlist_tracks;');
    db.run('DELETE FROM playlists;');
    db.run('DELETE FROM album_notes;');
    // Tables added by later migrations — safe to delete-if-exists:
    try { db.run('DELETE FROM followed_artists;'); } catch { /* table may not exist on very old DBs */ }
    try { db.run('DELETE FROM artist_releases_cache;'); } catch { /* same */ }
    try { db.run('DELETE FROM lyrics_cache;'); } catch { /* same */ }
    db.run('COMMIT;');
  } catch (e) {
    try { db.run('ROLLBACK;'); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e), filePaths: [] };
  }
  try { persistAtomic(); } catch (e) {
    return { ok: false, error: String(e?.message || e), filePaths: [] };
  }
  return { ok: true, filePaths };
}

export async function upsertTracks(tracks) {
  await ensureLibraryOpen();
  if (!db || !Array.isArray(tracks)) return { ok: false, inserted: 0 };

  const sql = `
    INSERT INTO tracks (id, file_path, title, artist, album, duration, cover_art_url, year, genre, track_number, disc_number, explicit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      duration = excluded.duration,
      cover_art_url = excluded.cover_art_url,
      year = excluded.year,
      genre = excluded.genre,
      track_number = excluded.track_number,
      disc_number = excluded.disc_number,
      explicit = COALESCE(excluded.explicit, tracks.explicit);
  `;
  const stmt = db.prepare(sql);
  let n = 0;
  db.run('BEGIN;');
  try {
    for (const t of tracks) {
      const row = normalizeTrackInput(t);
      if (!row) continue;
      stmt.run([row.id, row.file_path, row.title, row.artist, row.album, row.duration, row.cover_art_url, row.year, row.genre, row.track_number, row.disc_number, row.explicit]);
      n += 1;
    }
    db.run('COMMIT;');
  } catch (e) {
    try {
      db.run('ROLLBACK;');
    } catch { /* ignore */ }
    stmt.free();
    return { ok: false, error: String(e?.message || e), inserted: 0 };
  }
  stmt.free();
  try {
    persistAtomic();
  } catch (e) {
    console.error('library persist failed', e);
    return { ok: false, error: String(e?.message || e), inserted: n };
  }
  return { ok: true, inserted: n };
}

/**
 * Update metadata fields on an existing track by id.
 * Accepts a partial object: { title, artist, album, year, genre, coverArt } — only provided keys are updated.
 */
export async function updateTrackMetadata(id, fields) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid id' };
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'No fields provided' };

  const sets = [];
  const args = [];

  if (typeof fields.title === 'string') {
    const v = fields.title.trim();
    if (!v) return { ok: false, error: 'Title cannot be empty' };
    sets.push('title = ?');
    args.push(v.slice(0, 500));
  }
  if (typeof fields.artist === 'string') {
    const v = fields.artist.trim();
    sets.push('artist = ?');
    args.push((v || 'Unknown Artist').slice(0, 500));
  }
  if (typeof fields.album === 'string') {
    const v = fields.album.trim();
    sets.push('album = ?');
    args.push((v || 'Unknown Album').slice(0, 500));
  }
  if ('year' in fields) {
    let y = null;
    if (fields.year != null && fields.year !== '') {
      const n = Number(fields.year);
      if (Number.isFinite(n) && n >= 1000 && n <= 9999) y = Math.floor(n);
      else return { ok: false, error: 'Year must be 1000–9999 or empty' };
    }
    sets.push('year = ?');
    args.push(y);
  }
  if ('genre' in fields) {
    const v = typeof fields.genre === 'string' ? fields.genre.trim().slice(0, 200) : '';
    sets.push('genre = ?');
    args.push(v || null);
  }
  if ('trackNumber' in fields) {
    let v = null;
    if (fields.trackNumber != null && fields.trackNumber !== '') {
      const n = Number(fields.trackNumber);
      if (Number.isFinite(n) && n >= 1 && n <= 9999) v = Math.floor(n);
      else return { ok: false, error: 'Track number must be 1–9999 or empty' };
    }
    sets.push('track_number = ?');
    args.push(v);
  }
  if ('discNumber' in fields) {
    let v = null;
    if (fields.discNumber != null && fields.discNumber !== '') {
      const n = Number(fields.discNumber);
      if (Number.isFinite(n) && n >= 1 && n <= 99) v = Math.floor(n);
      else return { ok: false, error: 'Disc number must be 1–99 or empty' };
    }
    sets.push('disc_number = ?');
    args.push(v);
  }
  if ('explicit' in fields) {
    // Explicit flag is stored as INTEGER 0/1/null (see schema in
    // ensureLibraryOpen above). Accept boolean true/false from callers
    // and convert; null means "unknown" and clears the column.
    let v = null;
    if (fields.explicit === true) v = 1;
    else if (fields.explicit === false) v = 0;
    else if (fields.explicit == null) v = null;
    else return { ok: false, error: 'Explicit must be boolean or null.' };
    sets.push('explicit = ?');
    args.push(v);
  }
  if ('coverArt' in fields) {
    let cover_art_url = null;
    const raw = fields.coverArt;
    if (raw == null || raw === '') {
      cover_art_url = null;
    } else if (typeof raw === 'string') {
      const u = raw.trim();
      if (/^https?:\/\//i.test(u)) {
        cover_art_url = u.slice(0, 2048);
      } else if (u.startsWith('studio-cover://')) {
        cover_art_url = u.slice(0, 2048);
      } else if (u.startsWith('data:image/')) {
        const saved = storeCoverFromDataUri(u);
        if (!saved) return { ok: false, error: 'Could not save cover image.' };
        cover_art_url = saved;
      } else {
        return { ok: false, error: 'Cover art must be a URL or image data.' };
      }
    } else {
      return { ok: false, error: 'Cover art must be a string, URL, or null.' };
    }
    sets.push('cover_art_url = ?');
    args.push(cover_art_url);
  }

  if (sets.length === 0) return { ok: true, updated: 0 };
  args.push(id);

  let stmt;
  try {
    // Use a prepared statement — same pattern as upsertTracks, more reliable for
    // large TEXT values like base64 data URIs.
    stmt = db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?;`);
    stmt.run(args);
    stmt.free();
    stmt = null;

    // Confirm the row actually exists and the write landed
    const check = db.exec('SELECT changes() AS c;');
    const changes = check?.[0]?.values?.[0]?.[0] ?? 0;
    if (changes === 0) {
      return { ok: false, error: 'Track not found' };
    }

    persistAtomic();
    return { ok: true, updated: 1 };
  } catch (e) {
    console.error('updateTrackMetadata failed:', e);
    try { stmt?.free(); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Apply album-level metadata fields to a set of tracks in a single transaction.
 *
 * Accepts:
 *   trackIds — array of track ids to update
 *   fields   — partial object of { album, artist, year, genre, coverArt }
 *
 * Only the fields provided are updated; missing keys leave the column untouched.
 * All changes commit atomically — on any error the transaction rolls back.
 */
export async function updateAlbumMetadata(trackIds, fields) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (!Array.isArray(trackIds) || trackIds.length === 0) {
    return { ok: false, error: 'No tracks provided' };
  }
  if (!fields || typeof fields !== 'object') {
    return { ok: false, error: 'No fields provided' };
  }

  // Validate and collect the SET clauses (same rules as updateTrackMetadata,
  // minus title/track-number/disc-number which are per-track).
  const sets = [];
  const baseArgs = [];

  if (typeof fields.artist === 'string') {
    const v = fields.artist.trim();
    sets.push('artist = ?');
    baseArgs.push((v || 'Unknown Artist').slice(0, 500));
  }
  if (typeof fields.album === 'string') {
    const v = fields.album.trim();
    sets.push('album = ?');
    baseArgs.push((v || 'Unknown Album').slice(0, 500));
  }
  if ('year' in fields) {
    let y = null;
    if (fields.year != null && fields.year !== '') {
      const n = Number(fields.year);
      if (Number.isFinite(n) && n >= 1000 && n <= 9999) y = Math.floor(n);
      else return { ok: false, error: 'Year must be 1000–9999 or empty' };
    }
    sets.push('year = ?');
    baseArgs.push(y);
  }
  if ('genre' in fields) {
    const v = typeof fields.genre === 'string' ? fields.genre.trim().slice(0, 200) : '';
    sets.push('genre = ?');
    baseArgs.push(v || null);
  }
  if ('explicit' in fields) {
    // Same conversion as updateTrackMetadata: boolean true/false → 1/0,
    // null clears the column. Bulk callers use this to flip an entire
    // album's explicit flag in one go.
    let v = null;
    if (fields.explicit === true) v = 1;
    else if (fields.explicit === false) v = 0;
    else if (fields.explicit == null) v = null;
    else return { ok: false, error: 'Explicit must be boolean or null.' };
    sets.push('explicit = ?');
    baseArgs.push(v);
  }
  if ('coverArt' in fields) {
    let cover_art_url = null;
    const raw = fields.coverArt;
    if (raw == null || raw === '') {
      cover_art_url = null;
    } else if (typeof raw === 'string') {
      const u = raw.trim();
      if (/^https?:\/\//i.test(u)) {
        cover_art_url = u.slice(0, 2048);
      } else if (u.startsWith('studio-cover://')) {
        cover_art_url = u.slice(0, 2048);
      } else if (u.startsWith('data:image/')) {
        const saved = storeCoverFromDataUri(u);
        if (!saved) return { ok: false, error: 'Could not save cover image.' };
        cover_art_url = saved;
      } else {
        return { ok: false, error: 'Cover art must be a URL or image data.' };
      }
    } else {
      return { ok: false, error: 'Cover art must be a string, URL, or null.' };
    }
    sets.push('cover_art_url = ?');
    baseArgs.push(cover_art_url);
  }

  if (sets.length === 0) return { ok: true, updated: 0 };

  // Only accept clean string ids — defensive against accidental nulls/objects
  const ids = trackIds.map(String).filter((s) => s && s.trim());
  if (ids.length === 0) return { ok: false, error: 'No valid track ids' };

  const sql = `UPDATE tracks SET ${sets.join(', ')} WHERE id = ?;`;
  let stmt;
  let updated = 0;
  db.run('BEGIN;');
  try {
    stmt = db.prepare(sql);
    for (const id of ids) {
      stmt.run([...baseArgs, id]);
      const check = db.exec('SELECT changes() AS c;');
      const changes = check?.[0]?.values?.[0]?.[0] ?? 0;
      if (changes > 0) updated += 1;
    }
    stmt.free();
    stmt = null;
    db.run('COMMIT;');
  } catch (e) {
    console.error('updateAlbumMetadata failed:', e);
    try { stmt?.free(); } catch { /* ignore */ }
    try { db.run('ROLLBACK;'); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e) };
  }

  try {
    persistAtomic();
  } catch (e) {
    console.error('persistAtomic after album update failed:', e);
    return { ok: false, error: String(e?.message || e), updated };
  }
  return { ok: true, updated };
}

/* ================= PLAYLISTS ================= */

function newPlaylistId() {
  return `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePlaylistCover(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u.slice(0, 2048);
  if (u.startsWith('studio-cover://')) return u.slice(0, 2048);
  if (u.startsWith('data:image/')) {
    const saved = storeCoverFromDataUri(u);
    return saved || null;
  }
  return null;
}

/** Toggle or set a track's favorite status. Returns { ok, isFavorite }. */
export async function setTrackFavorite(id, isFavorite) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid id' };
  try {
    db.run('UPDATE tracks SET is_favorite = ? WHERE id = ?;', [isFavorite ? 1 : 0, id]);
    persistAtomic();
    return { ok: true, isFavorite: !!isFavorite };
  } catch (e) {
    console.error('setTrackFavorite', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Set per-track notes (free-form text, max 4000 chars). */
export async function setTrackNotes(id, notes) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid id' };
  const trimmed = typeof notes === 'string' ? notes.slice(0, 4000) : '';
  try {
    db.run('UPDATE tracks SET notes = ? WHERE id = ?;', [trimmed || null, id]);
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('setTrackNotes', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Increment play_count + update last_played for a track AND append a
 * per-event row to play_events. Called when a track has been listened
 * to past a meaningful threshold (eg. 30s or 50% of duration).
 *
 * The two writes have to stay in sync — `tracks.play_count` is the
 * fast aggregate for "all-time plays" displays and sorts; `play_events`
 * is the per-event log that powers Day/Week/Month tabs and any future
 * time-windowed stats. Updating one without the other would drift them.
 */
export async function recordTrackPlay(id) {
  await ensureLibraryOpen();
  if (!db) return { ok: false };
  if (typeof id !== 'string' || !id.trim()) return { ok: false };
  try {
    const now = Date.now();
    db.run(
      'UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?;',
      [now, id],
    );
    db.run(
      'INSERT INTO play_events (track_id, at) VALUES (?, ?);',
      [id, now],
    );
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('recordTrackPlay', e);
    return { ok: false };
  }
}

/**
 * Load play events for stats aggregation. With `sinceMs` we only return
 * events newer than that timestamp (used by Day/Week/Month tabs).
 * Without it, returns the full event log.
 *
 * Returns events sorted ascending by time, capped at 100k rows to keep
 * IPC payloads bounded (a heavy listener accumulating that many events
 * over years is still well-served by the most recent slice).
 */
export async function loadPlayEvents(sinceMs) {
  await ensureLibraryOpen();
  if (!db) return [];
  try {
    const cutoff = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : 0;
    const res = cutoff > 0
      ? db.exec('SELECT track_id, at FROM play_events WHERE at >= ' + Math.floor(cutoff) + ' ORDER BY at ASC LIMIT 100000;')
      : db.exec('SELECT track_id, at FROM play_events ORDER BY at ASC LIMIT 100000;');
    if (!res?.[0]) return [];
    const { values } = res[0];
    return values.map((row) => ({ id: String(row[0]), at: Number(row[1]) }));
  } catch (e) {
    console.error('loadPlayEvents', e);
    return [];
  }
}

/**
 * Reset all listening stats: zero play_count, null last_played on every
 * track, and delete every row in play_events. Used by the "Reset stats"
 * button in the Stats tab. Track rows themselves (and everything else)
 * are untouched.
 */
export async function clearAllStats() {
  await ensureLibraryOpen();
  if (!db) return { ok: false };
  try {
    db.run('UPDATE tracks SET play_count = 0, last_played = NULL;');
    db.run('DELETE FROM play_events;');
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('clearAllStats', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Load all album notes as Map<"album__artist", { notes, updatedAt }>. */
export async function loadAllAlbumNotes() {
  await ensureLibraryOpen();
  if (!db) return new Map();
  const out = new Map();
  try {
    const res = db.exec('SELECT album, artist, notes, updated_at FROM album_notes;');
    if (!res?.[0]) return out;
    for (const row of res[0].values) {
      const album = row[0]; const artist = row[1]; const notes = row[2]; const updatedAt = row[3];
      if (!notes) continue;
      out.set(`${album}__${artist}`, { notes: String(notes), updatedAt: Number(updatedAt) });
    }
  } catch (e) { console.error('loadAllAlbumNotes', e); }
  return out;
}

/** Set notes for an album, identified by its (album, artist) pair. */
export async function setAlbumNotes(album, artist, notes) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  const a = String(album || '').trim();
  const ar = String(artist || '').trim();
  if (!a) return { ok: false, error: 'Album required' };
  const trimmed = typeof notes === 'string' ? notes.slice(0, 4000) : '';
  try {
    if (trimmed) {
      db.run(
        `INSERT INTO album_notes (album, artist, notes, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(album, artist) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at;`,
        [a, ar, trimmed, Date.now()],
      );
    } else {
      db.run('DELETE FROM album_notes WHERE album = ? AND artist = ?;', [a, ar]);
    }
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('setAlbumNotes', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Get the stored Spotify album link for a library album, or null if none.
 * Returns { spotifyAlbumId, confirmed, updatedAt }.
 */
export async function getAlbumLink(album, artist) {
  await ensureLibraryOpen();
  if (!db) return null;
  const a = String(album || '').trim();
  const ar = String(artist || '').trim();
  if (!a) return null;
  try {
    const res = db.exec(
      'SELECT spotify_album_id, confirmed, updated_at FROM album_links WHERE album = ? AND artist = ? LIMIT 1;',
      [a, ar],
    );
    const row = res?.[0]?.values?.[0];
    if (!row) return null;
    return { spotifyAlbumId: String(row[0]), confirmed: !!row[1], updatedAt: Number(row[2]) };
  } catch (e) {
    console.error('getAlbumLink', e);
    return null;
  }
}

/**
 * Store (or update) the Spotify album link for a library album. `confirmed`
 * is true when the user explicitly picked the edition, false for an automatic
 * resolution. Passing an empty spotifyAlbumId clears the link.
 */
export async function setAlbumLink(album, artist, spotifyAlbumId, confirmed = false) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  const a = String(album || '').trim();
  const ar = String(artist || '').trim();
  const sid = String(spotifyAlbumId || '').trim();
  if (!a) return { ok: false, error: 'Album required' };
  try {
    if (sid) {
      db.run(
        `INSERT INTO album_links (album, artist, spotify_album_id, confirmed, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(album, artist) DO UPDATE SET
           spotify_album_id = excluded.spotify_album_id,
           confirmed = excluded.confirmed,
           updated_at = excluded.updated_at;`,
        [a, ar, sid, confirmed ? 1 : 0, Date.now()],
      );
    } else {
      db.run('DELETE FROM album_links WHERE album = ? AND artist = ?;', [a, ar]);
    }
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('setAlbumLink', e);
    return { ok: false, error: String(e?.message || e) };
  }
}


/* =========================================================================
 *  Followed artists + releases cache
 * ========================================================================= */

/**
 * Load all manual follow-overrides. Returns an array of
 *   { artistName, action, itunesArtistId, createdAt }
 * where action is 'add' (user explicitly follows) or 'exclude' (user has
 * explicitly un-followed an artist that would otherwise be auto-followed).
 */
export async function loadFollowedArtistOverrides() {
  await ensureLibraryOpen();
  if (!db) return [];
  try {
    const res = db.exec('SELECT artist_name, action, itunes_artist_id, created_at FROM followed_artists ORDER BY created_at DESC;');
    if (!res?.[0]) return [];
    return res[0].values.map((row) => ({
      artistName: String(row[0] || ''),
      action: String(row[1] || 'add'),
      itunesArtistId: row[2] != null ? Number(row[2]) : null,
      createdAt: Number(row[3] || 0),
    }));
  } catch (e) {
    console.error('loadFollowedArtistOverrides', e);
    return [];
  }
}

/**
 * Explicitly follow an artist. Idempotent — overwrites any existing 'exclude'
 * override for the same name. If `itunesArtistId` is provided (user picked a
 * specific artist from the disambiguation dropdown), it's stored so the refresh
 * never has to guess which artist this name refers to.
 */
export async function addFollowedArtist(artistName, itunesArtistId = null) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  const name = String(artistName || '').trim();
  if (!name) return { ok: false, error: 'Artist name required' };
  const id = Number.isFinite(Number(itunesArtistId)) && Number(itunesArtistId) > 0
    ? Number(itunesArtistId) : null;
  try {
    db.run(
      `INSERT INTO followed_artists (artist_name, action, itunes_artist_id, created_at)
       VALUES (?, 'add', ?, ?)
       ON CONFLICT(artist_name) DO UPDATE SET action='add', itunes_artist_id=COALESCE(?, itunes_artist_id);`,
      [name, id, Date.now(), id],
    );
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('addFollowedArtist', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Mark an artist as excluded. Called when the user un-follows an artist that
 * was being auto-followed because they exist in the library. If the artist was
 * manually added previously, this converts that row to 'exclude'.
 */
export async function excludeFollowedArtist(artistName) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  const name = String(artistName || '').trim();
  if (!name) return { ok: false, error: 'Artist name required' };
  try {
    db.run(
      `INSERT INTO followed_artists (artist_name, action, itunes_artist_id, created_at)
       VALUES (?, 'exclude', NULL, ?)
       ON CONFLICT(artist_name) DO UPDATE SET action='exclude';`,
      [name, Date.now()],
    );
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('excludeFollowedArtist', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Delete an override row entirely (so the artist reverts to the default —
 * auto-followed if they're in the library, un-followed otherwise).
 */
export async function clearFollowedArtistOverride(artistName) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  const name = String(artistName || '').trim();
  if (!name) return { ok: false, error: 'Artist name required' };
  try {
    db.run('DELETE FROM followed_artists WHERE artist_name = ?;', [name]);
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('clearFollowedArtistOverride', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Record the resolved iTunes artist ID for a given artist name so we don't
 * have to re-search on every refresh.
 */
export async function setItunesArtistIdForArtist(artistName, itunesArtistId) {
  await ensureLibraryOpen();
  if (!db) return { ok: false };
  const name = String(artistName || '').trim();
  if (!name) return { ok: false };
  const id = Number(itunesArtistId);
  if (!Number.isFinite(id)) return { ok: false };
  try {
    // Insert-or-update. If the row doesn't exist (e.g. auto-followed artist),
    // create one with action='add' so we can store the ID.
    db.run(
      `INSERT INTO followed_artists (artist_name, action, itunes_artist_id, created_at)
       VALUES (?, 'add', ?, ?)
       ON CONFLICT(artist_name) DO UPDATE SET itunes_artist_id=excluded.itunes_artist_id;`,
      [name, id, Date.now()],
    );
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('setItunesArtistIdForArtist', e);
    return { ok: false };
  }
}

/**
 * Load all cached releases, newest first. Optionally filter to releases within
 * the last `withinDays` days (default 30).
 */
export async function loadCachedReleases({ withinDays = 30 } = {}) {
  await ensureLibraryOpen();
  if (!db) return [];
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoff).toISOString();
  try {
    const res = db.exec(
      `SELECT itunes_artist_id, collection_id, collection_name, artist_name,
              release_date, artwork_url, track_count, collection_view_url,
              primary_genre_name, cached_at, collection_explicitness
       FROM artist_releases_cache
       WHERE release_date >= ?
       ORDER BY release_date DESC;`,
      [cutoffIso],
    );
    if (!res?.[0]) return [];
    return res[0].values.map((row) => ({
      itunesArtistId: row[0] != null ? Number(row[0]) : null,
      collectionId: row[1] != null ? Number(row[1]) : null,
      collectionName: String(row[2] || ''),
      artistName: String(row[3] || ''),
      releaseDate: String(row[4] || ''),
      artworkUrl: String(row[5] || ''),
      trackCount: row[6] != null ? Number(row[6]) : 0,
      collectionViewUrl: String(row[7] || ''),
      primaryGenreName: String(row[8] || ''),
      cachedAt: Number(row[9] || 0),
      collectionExplicitness: String(row[10] || ''),
    }));
  } catch (e) {
    console.error('loadCachedReleases', e);
    return [];
  }
}

/**
 * Upsert an array of release records for a given artist. Called by the
 * main-process fetcher after pulling results from iTunes. Also prunes
 * cache entries older than 60 days (keep a window twice the filter size).
 */
export async function upsertArtistReleases(releases) {
  await ensureLibraryOpen();
  if (!db) return { ok: false };
  if (!Array.isArray(releases) || !releases.length) return { ok: true, count: 0 };
  try {
    db.run('BEGIN;');
    const stmt = db.prepare(
      `INSERT INTO artist_releases_cache
        (itunes_artist_id, collection_id, collection_name, artist_name,
         release_date, artwork_url, track_count, collection_view_url,
         primary_genre_name, cached_at, collection_explicitness)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(itunes_artist_id, collection_id) DO UPDATE SET
         collection_name = excluded.collection_name,
         artist_name = excluded.artist_name,
         release_date = excluded.release_date,
         artwork_url = excluded.artwork_url,
         track_count = excluded.track_count,
         collection_view_url = excluded.collection_view_url,
         primary_genre_name = excluded.primary_genre_name,
         cached_at = excluded.cached_at,
         collection_explicitness = excluded.collection_explicitness;`,
    );
    const now = Date.now();
    for (const r of releases) {
      const artistId = Number(r.itunesArtistId);
      const collectionId = Number(r.collectionId);
      if (!Number.isFinite(artistId) || !Number.isFinite(collectionId)) continue;
      stmt.run([
        artistId,
        collectionId,
        String(r.collectionName || ''),
        String(r.artistName || ''),
        String(r.releaseDate || ''),
        String(r.artworkUrl || ''),
        Number(r.trackCount) || 0,
        String(r.collectionViewUrl || ''),
        String(r.primaryGenreName || ''),
        now,
        String(r.collectionExplicitness || ''),
      ]);
    }
    stmt.free();
    // Prune old entries to keep the table small
    const pruneCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    db.run('DELETE FROM artist_releases_cache WHERE release_date < ?;', [pruneCutoff]);
    db.run('COMMIT;');
    persistAtomic();
    return { ok: true, count: releases.length };
  } catch (e) {
    try { db.run('ROLLBACK;'); } catch { /* ignore */ }
    console.error('upsertArtistReleases', e);
    return { ok: false, error: String(e?.message || e) };
  }
}


/** Load all playlists (metadata only — tracks loaded separately). */
export async function loadAllPlaylists() {
  await ensureLibraryOpen();
  if (!db) return [];
  const res = db.exec(
    `SELECT p.id, p.name, p.cover_art_url, p.sort_index, p.created_at, p.updated_at,
            COUNT(pt.track_id) AS track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     GROUP BY p.id
     ORDER BY p.sort_index ASC, p.created_at ASC;`,
  );
  if (!res?.[0]) return [];
  const { columns, values } = res[0];
  return values.map((row) => {
    const obj = {};
    columns.forEach((c, i) => { obj[c] = row[i]; });
    return {
      id: obj.id,
      name: obj.name,
      coverArt: obj.cover_art_url || null,
      sortIndex: obj.sort_index != null ? Number(obj.sort_index) : 0,
      createdAt: obj.created_at,
      updatedAt: obj.updated_at,
      trackCount: Number(obj.track_count) || 0,
    };
  });
}

/** Load the ordered list of track IDs in a playlist. */
export async function loadPlaylistTrackIds(playlistId) {
  await ensureLibraryOpen();
  if (!db) return [];
  if (typeof playlistId !== 'string' || !playlistId.trim()) return [];
  let stmt;
  const ids = [];
  try {
    stmt = db.prepare(
      'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC, added_at ASC;',
    );
    stmt.bind([playlistId]);
    while (stmt.step()) {
      const row = stmt.get();
      if (row?.[0]) ids.push(row[0]);
    }
  } catch (e) {
    console.error('loadPlaylistTrackIds failed', e);
  } finally {
    try { stmt?.free(); } catch { /* ignore */ }
  }
  return ids;
}

/** Create a new playlist. Returns { ok, id }. */
export async function createPlaylist(fields) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  const name = typeof fields?.name === 'string' ? fields.name.trim().slice(0, 200) : '';
  if (!name) return { ok: false, error: 'Playlist name required' };
  const coverArt = normalizePlaylistCover(fields?.coverArt);
  const id = newPlaylistId();

  // Append to end of list by giving it the next sort_index
  let nextSort = 0;
  try {
    const r = db.exec('SELECT COALESCE(MAX(sort_index), -1) + 1 AS s FROM playlists;');
    nextSort = r?.[0]?.values?.[0]?.[0] ?? 0;
  } catch { /* ignore */ }

  try {
    db.run(
      'INSERT INTO playlists (id, name, cover_art_url, sort_index) VALUES (?, ?, ?, ?);',
      [id, name, coverArt, nextSort],
    );
    persistAtomic();
    return { ok: true, id };
  } catch (e) {
    console.error('createPlaylist failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Update a playlist's name and/or cover art. Partial updates supported. */
export async function updatePlaylist(id, fields) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid id' };
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'No fields provided' };

  const sets = [];
  const args = [];

  if (typeof fields.name === 'string') {
    const v = fields.name.trim().slice(0, 200);
    if (!v) return { ok: false, error: 'Name cannot be empty' };
    sets.push('name = ?');
    args.push(v);
  }
  if ('coverArt' in fields) {
    const cover = fields.coverArt == null || fields.coverArt === ''
      ? null
      : normalizePlaylistCover(fields.coverArt);
    sets.push('cover_art_url = ?');
    args.push(cover);
  }

  if (sets.length === 0) return { ok: true, updated: 0 };
  sets.push("updated_at = strftime('%s','now')");
  args.push(id);

  try {
    db.run(`UPDATE playlists SET ${sets.join(', ')} WHERE id = ?;`, args);
    const check = db.exec('SELECT changes() AS c;');
    const changes = check?.[0]?.values?.[0]?.[0] ?? 0;
    if (changes === 0) return { ok: false, error: 'Playlist not found' };
    persistAtomic();
    return { ok: true, updated: 1 };
  } catch (e) {
    console.error('updatePlaylist failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Delete a playlist. Cascades to playlist_tracks via FK. */
export async function deletePlaylist(id) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid id' };
  try {
    // FK ON DELETE CASCADE isn't enforced without PRAGMA foreign_keys=ON — do it manually
    db.run('DELETE FROM playlist_tracks WHERE playlist_id = ?;', [id]);
    db.run('DELETE FROM playlists WHERE id = ?;', [id]);
    persistAtomic();
    return { ok: true };
  } catch (e) {
    console.error('deletePlaylist failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Append tracks to a playlist, skipping ones already present. Returns { ok, added }. */
export async function addTracksToPlaylist(playlistId, trackIds) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (typeof playlistId !== 'string' || !playlistId.trim()) return { ok: false, error: 'Invalid playlist id' };
  const ids = (trackIds || []).map(String).filter(Boolean);
  if (ids.length === 0) return { ok: true, added: 0 };

  // Verify the playlist exists
  try {
    const r = db.exec('SELECT 1 FROM playlists WHERE id = ? LIMIT 1;', [playlistId]);
    if (!r?.[0]?.values?.length) return { ok: false, error: 'Playlist not found' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  // Current max position so we append cleanly
  let nextPos = 0;
  try {
    const r = db.exec(
      'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?;',
      [playlistId],
    );
    nextPos = r?.[0]?.values?.[0]?.[0] ?? 0;
  } catch { /* ignore */ }

  let stmt;
  let added = 0;
  db.run('BEGIN;');
  try {
    stmt = db.prepare(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?);',
    );
    for (const tid of ids) {
      stmt.run([playlistId, tid, nextPos]);
      const check = db.exec('SELECT changes() AS c;');
      const changes = check?.[0]?.values?.[0]?.[0] ?? 0;
      if (changes > 0) {
        added += 1;
        nextPos += 1;
      }
    }
    stmt.free();
    stmt = null;
    db.run(`UPDATE playlists SET updated_at = strftime('%s','now') WHERE id = ?;`, [playlistId]);
    db.run('COMMIT;');
  } catch (e) {
    console.error('addTracksToPlaylist failed', e);
    try { stmt?.free(); } catch { /* ignore */ }
    try { db.run('ROLLBACK;'); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e) };
  }

  try { persistAtomic(); } catch (e) {
    return { ok: false, error: String(e?.message || e), added };
  }
  return { ok: true, added };
}

/** Remove tracks from a playlist. Returns { ok, removed }. */
export async function removeTracksFromPlaylist(playlistId, trackIds) {
  await ensureLibraryOpen();
  if (!db) return { ok: false, error: 'DB not open' };
  if (typeof playlistId !== 'string' || !playlistId.trim()) return { ok: false, error: 'Invalid playlist id' };
  const ids = (trackIds || []).map(String).filter(Boolean);
  if (ids.length === 0) return { ok: true, removed: 0 };

  let stmt;
  let removed = 0;
  db.run('BEGIN;');
  try {
    stmt = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?;');
    for (const tid of ids) {
      stmt.run([playlistId, tid]);
      const check = db.exec('SELECT changes() AS c;');
      const changes = check?.[0]?.values?.[0]?.[0] ?? 0;
      if (changes > 0) removed += 1;
    }
    stmt.free();
    stmt = null;
    db.run(`UPDATE playlists SET updated_at = strftime('%s','now') WHERE id = ?;`, [playlistId]);
    db.run('COMMIT;');
  } catch (e) {
    console.error('removeTracksFromPlaylist failed', e);
    try { stmt?.free(); } catch { /* ignore */ }
    try { db.run('ROLLBACK;'); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e) };
  }

  try { persistAtomic(); } catch (e) {
    return { ok: false, error: String(e?.message || e), removed };
  }
  return { ok: true, removed };
}


/**
 * Load cached lyrics from the DB. Returns { syncedLyrics, plainLyrics, instrumental } or null.
 */
export async function loadCachedLyrics(cacheKey) {
  await ensureLibraryOpen();
  if (!db) return null;
  let stmt;
  try {
    stmt = db.prepare('SELECT synced_lyrics, plain_lyrics, instrumental FROM lyrics_cache WHERE cache_key = ? LIMIT 1;');
    stmt.bind([cacheKey]);
    if (!stmt.step()) return null; // no row
    const row = stmt.get(); // returns [synced, plain, instrumental]
    return {
      syncedLyrics: row[0] || null,
      plainLyrics: row[1] || null,
      instrumental: !!row[2],
    };
  } catch {
    return null;
  } finally {
    try { stmt?.free(); } catch { /* ignore */ }
  }
}

/**
 * Save lyrics to the persistent DB cache.
 */
export async function saveCachedLyrics(cacheKey, { syncedLyrics, plainLyrics, instrumental }) {
  await ensureLibraryOpen();
  if (!db) return;
  try {
    db.run(
      `INSERT OR REPLACE INTO lyrics_cache (cache_key, synced_lyrics, plain_lyrics, instrumental)
       VALUES (?, ?, ?, ?);`,
      [cacheKey, syncedLyrics || null, plainLyrics || null, instrumental ? 1 : 0],
    );
    persistAtomic();
  } catch (e) {
    console.error('saveCachedLyrics failed', e);
  }
}

/**
 * Remove a cached lyrics row by key. Used by the renderer's "refetch"
 * affordance to force a fresh network fetch even when stale or junky
 * data is cached. No-op if no row exists.
 */
export async function deleteCachedLyrics(cacheKey) {
  await ensureLibraryOpen();
  if (!db) return;
  try {
    db.run('DELETE FROM lyrics_cache WHERE cache_key = ?;', [cacheKey]);
    persistAtomic();
  } catch (e) {
    console.error('deleteCachedLyrics failed', e);
  }
}

export function closeLibraryDb() {
  if (db) {
    try {
      persistAtomic();
    } catch { /* ignore */ }
    db.close();
    db = null;
    openPromise = null;
  }
}

/** True if this absolute path is a row in the library (used to gate custom playback protocol). */
export function isPlaybackPathAllowed(filePath) {
  if (!db || typeof filePath !== 'string') return false;
  const p = filePath.trim();
  if (!p) return false;
  let stmt;
  try {
    stmt = db.prepare(
      'SELECT 1 AS x FROM tracks WHERE file_path = ? COLLATE NOCASE LIMIT 1;',
    );
    const row = stmt.get([p]);
    return row != null;
  } catch {
    return false;
  } finally {
    try {
      stmt?.free();
    } catch { /* ignore */ }
  }
}
