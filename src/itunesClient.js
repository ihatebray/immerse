/**
 * itunesClient.js — fallback metadata provider using Apple's iTunes
 * Search API.
 *
 * Used when Spotify is unavailable: either the user never configured
 * Spotify credentials, or Spotify returned a rate-limit error (429).
 * The iTunes Search API needs no authentication and has far gentler
 * rate limits (~20 req/min per IP, undocumented but generous), making
 * it a reliable backstop.
 *
 * IMPORTANT — all exported functions return objects shaped IDENTICALLY
 * to the corresponding spotifyClient.js functions, so callers can swap
 * providers without branching on the result shape. The only field that
 * doesn't map is Spotify's track/album IDs (iTunes uses its own
 * numeric IDs, exposed as `itunesId`/`collectionId`).
 *
 * Matching quality is the whole game here. The raw iTunes Search API
 * ranks by popularity, which means compilations ("Now That's What I
 * Call Music"), karaoke versions, and tribute covers frequently
 * outrank the real track. We never just take results[0] — we filter
 * out junk, then score survivors, then return the best (or nothing if
 * nothing is confident enough). See scoreCandidate() for the logic.
 */

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP_URL = 'https://itunes.apple.com/lookup';

/**
 * Normalize a title/artist string for fuzzy comparison: lowercase,
 * strip parentheticals & brackets (so "Song (feat. X)" matches "Song"),
 * drop punctuation, collapse whitespace.
 */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Regex of collection/album names that indicate a compilation,
 * karaoke, tribute, or other not-the-real-release. Matched against
 * iTunes `collectionName`. These are the usual suspects that pollute
 * iTunes Search results.
 */
const JUNK_COLLECTION = /various artists|now that'?s what|karaoke|tribute|made famous|originally performed|in the style of|workout|cover version|covers? of|instrumental versions?|as made popular|hit crew|ringtone/i;

/**
 * Raw fetch of the iTunes Search API. Returns the parsed `results`
 * array (possibly empty). Throws on network/HTTP error so callers can
 * distinguish "no results" from "couldn't reach iTunes".
 */
async function itunesGet(params) {
  // id-based requests must use the lookup endpoint; term-based requests
  // use search. The search endpoint silently ignores `id` and returns
  // nothing, which is exactly the bug that made iTunes albums show no
  // tracks when expanded.
  const base = params.id ? ITUNES_LOOKUP_URL : ITUNES_SEARCH_URL;
  const url = `${base}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`iTunes API (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

/**
 * Map iTunes explicitness string to a boolean.
 *   "explicit"    → true
 *   "cleaned"     → false  (this IS the clean version)
 *   "notExplicit" → false
 * Anything else (missing) → null (unknown).
 */
function mapExplicit(trackExplicitness) {
  if (trackExplicitness === 'explicit') return true;
  if (trackExplicitness === 'cleaned' || trackExplicitness === 'notExplicit') return false;
  return null;
}

/**
 * Upgrade an iTunes artwork URL to a higher resolution. iTunes returns
 * `artworkUrl100` (100×100) by default, but the URL pattern lets you
 * request any size by swapping the dimension token. We bump to 600×600
 * which is comparable to Spotify's max and looks good in the now-
 * playing canvas without being wastefully huge.
 *
 * Pattern: ".../source/100x100bb.jpg" → ".../source/600x600bb.jpg"
 */
function upgradeArtwork(url, size = 600) {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/\/\d+x\d+bb\.(jpg|png)/, `/${size}x${size}bb.$1`);
}

/**
 * Score an iTunes track candidate against what we're looking for.
 * Higher is better. Returns -Infinity for candidates that should be
 * rejected outright (compilation, wrong artist, etc.).
 *
 * @param {object} cand     raw iTunes result
 * @param {object} target   { title, artist, album?, durationMs? }
 */
function scoreCandidate(cand, target) {
  // Hard rejections first.
  if (cand.kind && cand.kind !== 'song') return -Infinity;
  if (JUNK_COLLECTION.test(cand.collectionName || '')) return -Infinity;

  const candTitle = normalize(cand.trackName);
  const candArtist = normalize(cand.artistName);
  const wantTitle = normalize(target.title);
  const wantArtist = normalize(target.artist);

  if (!candTitle || !wantTitle) return -Infinity;

  // Title matching. The old logic used naive substring containment in
  // either direction, which is dangerously loose for short titles:
  // "you" is a substring of "you too", "thank you", "all of you", and
  // hundreds of others, so a file titled "You" would match the wrong
  // song (and pull the wrong cover art). We use a stricter scheme:
  //
  //   - Exact normalized match → best.
  //   - Otherwise require strong WORD-LEVEL overlap: every word of the
  //     shorter title must appear as a whole word in the longer one,
  //     AND the shorter title must be a meaningful fraction (≥60%) of
  //     the longer one's word count. This lets "you too" match
  //     "you too (bonus)" but rejects "you" matching "you too".
  const titleExact = candTitle === wantTitle;
  let titleWordMatch = false;
  if (!titleExact) {
    const candWords = candTitle.split(' ').filter(Boolean);
    const wantWords = wantTitle.split(' ').filter(Boolean);
    const [shorter, longer] = wantWords.length <= candWords.length
      ? [wantWords, candWords] : [candWords, wantWords];
    const longerSet = new Set(longer);
    const allPresent = shorter.every((w) => longerSet.has(w));
    const fraction = shorter.length / longer.length;
    titleWordMatch = allPresent && fraction >= 0.6;
  }
  if (!titleExact && !titleWordMatch) return -Infinity;

  // Artist must overlap by at least one significant token (3+ chars).
  // This kills karaoke/tribute results whose artistName is the cover
  // band, not the real artist.
  let artistOverlap = false;
  if (wantArtist) {
    const wantTokens = new Set(wantArtist.split(' ').filter((t) => t.length >= 3));
    const candTokens = new Set(candArtist.split(' ').filter((t) => t.length >= 3));
    for (const t of wantTokens) {
      if (candTokens.has(t)) { artistOverlap = true; break; }
    }
    if (!artistOverlap) return -Infinity;
  }

  // Passed the filters — now score.
  let score = 0;

  // Title exactness
  if (titleExact) score += 10;
  else score += 4;

  // Duration proximity. This is the strongest discriminator since it
  // separates the real track from live versions / remixes / radio edits
  // that share a title. Only applies if we know the file's duration.
  if (target.durationMs && cand.trackTimeMillis) {
    const diffSec = Math.abs(target.durationMs - cand.trackTimeMillis) / 1000;
    if (diffSec <= 2) score += 12;        // basically certain
    else if (diffSec <= 5) score += 6;    // close enough — minor encoding diffs
    else if (diffSec <= 12) score += 1;   // same-ish, weak signal
    else score -= 8;                      // different version — penalize hard
  }

  // Album match (if we have a target album to compare)
  if (target.album) {
    const wantAlbum = normalize(target.album);
    const candAlbum = normalize(cand.collectionName);
    if (wantAlbum && candAlbum && (candAlbum === wantAlbum || candAlbum.includes(wantAlbum) || wantAlbum.includes(candAlbum))) {
      score += 5;
    }
  }

  // Prefer albums over singles (a "single" release often has a slightly
  // different master than the album version the user likely has).
  if (cand.collectionType === 'Album') score += 1;

  // Slight bias toward the explicit version. iTunes often lists both a
  // clean and explicit cut of the same song with near-identical
  // durations, so duration scoring alone can't separate them. Most
  // downloaded files are the explicit version, and the "E" badge is
  // meant to indicate the song HAS explicit content — so when two
  // candidates are otherwise tied, prefer the explicit one. Small
  // weight (2) so it only breaks ties, never overrides a better
  // title/duration/album match.
  if (cand.trackExplicitness === 'explicit') score += 2;

  return score;
}

/**
 * Map a raw iTunes track result into the spotifyClient track shape.
 */
function mapTrack(cand) {
  return {
    // Reuse the spotifyId field as the universal track identifier the
    // renderer keys on. iTunes tracks get an "itunes:"-prefixed ID so
    // they're unique and non-empty (the import paths already understand
    // this prefix — see the New Releases feature). Without this,
    // selecting/importing iTunes album tracks breaks because every row
    // would share an empty spotifyId.
    spotifyId: cand.trackId ? `itunes:${cand.trackId}` : '',
    itunesId: cand.trackId || null,
    collectionId: cand.collectionId || null,
    title: cand.trackName || '',
    name: cand.trackName || '',
    artists: cand.artistName || '',
    artist: cand.artistName || '',
    album: cand.collectionName || '',
    albumArtUrl: upgradeArtwork(cand.artworkUrl100 || cand.artworkUrl60 || ''),
    imageUrl: upgradeArtwork(cand.artworkUrl100 || cand.artworkUrl60 || ''),
    durationMs: cand.trackTimeMillis || 0,
    spotifyUrl: cand.trackViewUrl || '',
    explicit: mapExplicit(cand.trackExplicitness),
    trackNumber: cand.trackNumber || null,
    discNumber: cand.discNumber || null,
    releaseDate: cand.releaseDate || '',
    genre: cand.primaryGenreName || '',
    provider: 'itunes',
  };
}

/**
 * Search iTunes for tracks matching a free-text query. Returns an
 * array shaped like spotifySearchTracks(). Results are NOT confidence-
 * filtered here (that's for the cross-check path) — this is the raw
 * search used by the Find tab, where the user sees and picks results
 * themselves. We do still drop obvious junk (compilations/karaoke) and
 * non-songs so the list isn't polluted.
 *
 * @param {string} q
 * @returns {Promise<Array>}
 */
/**
 * Resolve a free-text query to the most likely iTunes artist record.
 * Tries progressively shorter prefixes of the query as artist-name
 * guesses ("lil uzi vert moon" → "lil uzi vert" → "lil uzi" → "lil").
 * Returns the artist object (with artistId) or null.
 *
 * We match the returned artistName against our guess to avoid picking a
 * wrong artist — iTunes' musicArtist search for "lil" returns "Lil
 * Tjay", "Lil Tecca" etc., so we prefer an artist whose name actually
 * contains (or is contained by) the guess.
 */
async function resolveArtist(words) {
  const guesses = [];
  if (words.length >= 3) guesses.push(words.slice(0, 3).join(' '));
  if (words.length >= 2) guesses.push(words.slice(0, 2).join(' '));
  if (words.length >= 1) guesses.push(words[0]);

  for (const guess of guesses) {
    let hits;
    try {
      hits = await itunesGet({ term: guess, entity: 'musicArtist', media: 'music', limit: 5 });
    } catch {
      continue;
    }
    if (!Array.isArray(hits) || !hits.length) continue;
    const gNorm = normalize(guess);
    // Prefer an artist whose normalized name matches the guess closely.
    const exact = hits.find((a) => a.artistId && normalize(a.artistName) === gNorm);
    if (exact) return exact;
    const contains = hits.find((a) => {
      if (!a.artistId) return false;
      const an = normalize(a.artistName);
      return an.includes(gNorm) || gNorm.includes(an);
    });
    if (contains) return contains;
    // Only fall back to "first result" for multi-word guesses — a
    // single short word like "lil" matches too many wrong artists.
    if (guess.includes(' ') && hits[0]?.artistId) return hits[0];
  }
  return null;
}

/**
 * Given an iTunes artistId, fetch the artist's albums and then every
 * track on those albums. This is the reliable way to enumerate a full
 * discography — far better than the song-entity artist lookup, which
 * caps at ~200 songs (truncating large catalogs like Lil Uzi Vert's,
 * dropping deep cuts).
 *
 * Returns { albums: [...rawAlbumRecords], tracks: [...rawTrackRecords] }.
 * Both are raw iTunes records (not yet mapped), deduped by id.
 *
 * `maxAlbumsForTracks` bounds how many albums we expand into tracks, to
 * keep latency sane for prolific artists. Albums are taken in iTunes'
 * order (roughly recency/popularity). The album LIST itself is always
 * returned in full regardless of this cap.
 */
async function fetchArtistDiscography(artistId, { maxAlbumsForTracks = 25 } = {}) {
  let albumLookup;
  try {
    albumLookup = await itunesGet({ id: String(artistId), entity: 'album', limit: 200 });
  } catch {
    return { albums: [], tracks: [] };
  }
  const albums = (albumLookup || []).filter(
    (r) => r.wrapperType === 'collection' && r.collectionId && !JUNK_COLLECTION.test(r.collectionName || ''),
  );

  // Expand the first N albums into their tracks, in parallel.
  const toExpand = albums.slice(0, maxAlbumsForTracks);
  const trackBatches = await Promise.all(
    toExpand.map((alb) =>
      itunesGet({ id: String(alb.collectionId), entity: 'song', limit: 100 })
        .then((rows) => (rows || []).filter((r) => r.wrapperType === 'track' || r.kind === 'song'))
        .catch(() => []),
    ),
  );

  const tracks = [];
  const seen = new Set();
  for (const batch of trackBatches) {
    for (const t of batch) {
      if (!t.trackId || seen.has(t.trackId)) continue;
      seen.add(t.trackId);
      tracks.push(t);
    }
  }
  return { albums, tracks };
}

/**
 * Score how well a track matches a free-text search query, for
 * client-side re-ranking. iTunes returns results in popularity order,
 * which buries less-popular songs even when the user clearly typed
 * their title — e.g. "chase atlantic you" returns Chase Atlantic's
 * hits, not "YOU TOO." We re-rank by actual relevance to the query.
 *
 * The query is split into tokens. We figure out which tokens match the
 * artist vs the title and reward results that satisfy BOTH the artist
 * part and the title part of the query. Returns a breakdown object:
 * { score, titleHits, artistHits, albumHits, unmatched }.
 */
function scoreSearchRelevance(cand, queryTokens) {
  const candTitleWords = new Set(normalize(cand.trackName).split(' ').filter(Boolean));
  const candArtistWords = new Set(normalize(cand.artistName).split(' ').filter(Boolean));
  const candAlbumWords = new Set(normalize(cand.collectionName).split(' ').filter(Boolean));

  let titleHits = 0;
  let artistHits = 0;
  let albumHits = 0;
  let unmatched = 0;

  for (const tok of queryTokens) {
    const inTitle = candTitleWords.has(tok);
    const inArtist = candArtistWords.has(tok);
    const inAlbum = candAlbumWords.has(tok);
    if (inTitle) titleHits += 1;
    else if (inArtist) artistHits += 1;
    else if (inAlbum) albumHits += 1;
    else unmatched += 1;
  }

  // Every query token that matches something is good. Title matches are
  // weighted highest (that's usually the song the user wants), artist
  // next, album least. Unmatched tokens are penalized so a result that
  // ignores half the query sinks.
  let score = titleHits * 6 + artistHits * 4 + albumHits * 1 - unmatched * 3;

  // Bonus: if the query matched BOTH a title word and an artist word,
  // it's very likely the exact "artist + song" the user meant. This is
  // the key signal that surfaces "YOU TOO." for "chase atlantic you".
  if (titleHits > 0 && artistHits > 0) score += 8;

  return { score, titleHits, artistHits, albumHits, unmatched };
}

/**
 * Search iTunes for tracks matching a free-text query. Returns an
 * array shaped like spotifySearchTracks(), re-ranked by relevance.
 *
 * iTunes' search endpoint does strict-ish AND matching and pads results
 * with duplicate releases (the same song across albums/singles/regions).
 * This means a query like "chase atlantic amy" can return ZERO results
 * (if iTunes doesn't index that exact word combo on the track), while
 * "chase atlantic you" returns 100 rows that are 90% duplicate "Swim"
 * and "Consume" entries — burying the song you actually wanted.
 *
 * Strategy to be resilient to both:
 *   1. Fire SEVERAL queries in parallel:
 *        - the full query as typed
 *        - the query minus the first word (handles "artist song" where
 *          the artist match is over-constraining)
 *        - just the last 1-2 words (the likely song title)
 *      More queries = more chance the target song appears in SOME set.
 *   2. Merge all results, dedupe by trackId.
 *   3. Drop junk (compilations/karaoke) and non-songs.
 *   4. Re-rank everything by relevance to the FULL original query.
 *   5. Return the top 25.
 *
 * @param {string} q
 * @returns {Promise<Array>}
 */
export async function itunesSearchTracks(q) {
  const query = String(q || '').trim();
  if (!query) return [];

  const words = query.split(/\s+/).filter(Boolean);

  // Build a small set of query variants. Using a Set dedupes identical
  // variants (e.g. for a one-word query they all collapse to one).
  const variants = new Set();
  variants.add(query);                              // full query
  if (words.length >= 2) {
    variants.add(words.slice(1).join(' '));         // drop first word (artist)
    variants.add(words.slice(-2).join(' '));        // last two words (likely title)
    variants.add(words[words.length - 1]);          // last word alone
  }

  // Fire all song-search variants in parallel. Each is best-effort.
  const songSearchPromise = Promise.all(
    Array.from(variants).map((term) =>
      itunesGet({ term, entity: 'song', media: 'music', limit: 100 }).catch(() => []),
    ),
  );

  // ALSO pull the artist's discography by expanding their albums into
  // tracks. This finds songs iTunes' text search can't surface and,
  // unlike the song-entity artist lookup (capped at ~200), it scales to
  // large catalogs because we fetch tracks album-by-album. This is what
  // surfaces deep cuts like "Moon Relate" on Eternal Atake.
  //
  // We also keep the resolved artist around: if the query named a real
  // artist, we'll require results to actually be by that artist, so a
  // search like "drake shabang" doesn't return "Shabang" songs by
  // unrelated artists.
  const artistCatalogPromise = (async () => {
    const artist = await resolveArtist(words);
    if (!artist?.artistId) return { artist: null, tracks: [] };
    const { tracks } = await fetchArtistDiscography(artist.artistId, { maxAlbumsForTracks: 30 });
    return { artist, tracks };
  })();

  const [songBatches, catalogResult] = await Promise.all([songSearchPromise, artistCatalogPromise]);
  const resolvedArtist = catalogResult.artist;
  const catalog = catalogResult.tracks;

  // Tokens of the resolved artist's name, for artist-match filtering.
  const resolvedArtistTokens = resolvedArtist
    ? new Set(normalize(resolvedArtist.artistName).split(' ').filter((t) => t.length >= 2))
    : null;

  // Merge + dedupe by trackId across all sources.
  const byTrackId = new Map();
  const addAll = (arr) => {
    for (const r of arr) {
      if (!r.trackId) continue;
      if (byTrackId.has(r.trackId)) continue;
      if (r.kind && r.kind !== 'song') continue;
      if (JUNK_COLLECTION.test(r.collectionName || '')) continue;
      byTrackId.set(r.trackId, r);
    }
  };
  for (const batch of songBatches) addAll(batch);
  addAll(catalog);

  const queryTokens = normalize(query).split(' ').filter((t) => t.length >= 2);
  const merged = Array.from(byTrackId.values());

  const scored = merged.map((r, i) => ({
    r, i, ...scoreSearchRelevance(r, queryTokens),
  }));

  // Figure out how many query tokens are "title words" — i.e. not
  // matched by the artist of any candidate. If the query is purely an
  // artist name (e.g. "chase atlantic"), every catalog track is a
  // valid result. But if the query has title words too (e.g. "chase
  // atlantic amy"), we should ONLY show tracks whose title matches one
  // of those words — otherwise pulling in the artist's whole catalog
  // would dump every Chase Atlantic song for an "amy" query.
  const maxArtistHits = scored.reduce((m, s) => Math.max(m, s.artistHits), 0);
  const queryHasTitleWords = queryTokens.length > maxArtistHits;

  let relevant = scored.filter((s) => {
    if (s.score <= 0) return false;
    // When the query includes title words, require a title hit.
    if (queryHasTitleWords && s.titleHits === 0) return false;
    // When the query named a real artist, require the candidate to
    // actually be by that artist. This stops "drake shabang" from
    // returning "Shabang" by unrelated artists — they match the title
    // but not the artist the user clearly specified.
    if (resolvedArtistTokens && resolvedArtistTokens.size > 0) {
      const candArtistWords = new Set(normalize(s.r.artistName).split(' ').filter(Boolean));
      let artistMatch = false;
      for (const tok of resolvedArtistTokens) {
        if (candArtistWords.has(tok)) { artistMatch = true; break; }
      }
      if (!artistMatch) return false;
    }
    return true;
  });

  // Fallback: if requiring the artist wiped everything (e.g. resolve
  // misfired, or the user really did want a title-only search), retry
  // without the artist requirement so the user still sees results.
  if (relevant.length === 0 && resolvedArtistTokens) {
    relevant = scored.filter((s) => {
      if (s.score <= 0) return false;
      if (queryHasTitleWords && s.titleHits === 0) return false;
      return true;
    });
  }

  // Fallback: if the title-required filter wiped everything (e.g. our
  // artist-word detection misfired), fall back to plain score > 0 so
  // the user still sees something.
  if (relevant.length === 0) {
    relevant = scored.filter((s) => s.score > 0);
  }

  relevant.sort((a, b) => (b.score - a.score) || (a.i - b.i));

  return relevant.slice(0, 25).map((s) => mapTrack(s.r));
}

/**
 * Search iTunes for albums. Returns array shaped like
 * spotifySearchAlbums(). Same junk filtering as track search.
 */
export async function itunesSearchAlbums(q) {
  const query = String(q || '').trim();
  if (!query) return [];

  const words = query.split(/\s+/).filter(Boolean);
  const variants = new Set();
  variants.add(query);
  if (words.length >= 2) {
    variants.add(words.slice(1).join(' '));
    variants.add(words.slice(-2).join(' '));
    variants.add(words[words.length - 1]);
  }
  const variantList = Array.from(variants);

  // For each variant, search both album-entity and song-entity (song
  // results carry album info and surface albums the album search drops).
  const fetches = [];
  for (const term of variantList) {
    fetches.push(itunesGet({ term, entity: 'album', media: 'music', limit: 50 }).catch(() => []));
    fetches.push(itunesGet({ term, entity: 'song', media: 'music', limit: 100 }).catch(() => []));
  }
  const batches = await Promise.all(fetches);
  // Even indices are album-entity batches, odd are song-entity.
  const albumRes = batches.filter((_, i) => i % 2 === 0).flat();
  const songRes = batches.filter((_, i) => i % 2 === 1).flat();

  // PRIMARY source: the artist's full album list via artist-ID lookup.
  // This is dramatically more complete than text search — for "lil uzi
  // vert ..." it returns 130+ real albums vs ~8 junk-padded text-search
  // hits. Text/song results above are kept as a supplement for queries
  // where the artist can't be resolved.
  const artist = await resolveArtist(words);
  let artistAlbums = [];
  if (artist?.artistId) {
    try {
      const lookup = await itunesGet({ id: String(artist.artistId), entity: 'album', limit: 200 });
      artistAlbums = (lookup || []).filter(
        (r) => r.wrapperType === 'collection' && r.collectionId,
      );
    } catch { /* ignore */ }
  }

  const queryTokens = normalize(query).split(' ').filter((t) => t.length >= 2);
  const byCollection = new Map();

  // Score an album-ish record (album entity OR a song carrying album
  // info) by how well its album name + artist match the query.
  const scoreAlbum = (name, artistName) => {
    const nameWords = new Set(normalize(name).split(' ').filter(Boolean));
    const artistWords = new Set(normalize(artistName).split(' ').filter(Boolean));
    let nameHits = 0; let artistHits = 0; let unmatched = 0;
    for (const tok of queryTokens) {
      if (nameWords.has(tok)) nameHits += 1;
      else if (artistWords.has(tok)) artistHits += 1;
      else unmatched += 1;
    }
    let s = nameHits * 6 + artistHits * 4 - unmatched * 3;
    if (nameHits > 0 && artistHits > 0) s += 8;
    return { score: s, nameHits, artistHits };
  };

  const addAlbum = (a) => {
    if (!a.collectionId || byCollection.has(a.collectionId)) return;
    if (JUNK_COLLECTION.test(a.collectionName || '')) return;
    const sc = scoreAlbum(a.collectionName, a.artistName);
    byCollection.set(a.collectionId, {
      albumId: `itunes:${a.collectionId}`,
      itunesCollectionId: a.collectionId,
      name: a.collectionName || '',
      artists: a.artistName || '',
      albumArtUrl: upgradeArtwork(a.artworkUrl100 || a.artworkUrl60 || ''),
      totalTracks: a.trackCount || 0,
      releaseDate: a.releaseDate || '',
      spotifyUrl: a.collectionViewUrl || '',
      provider: 'itunes',
      _score: sc.score,
      _nameHits: sc.nameHits,
      _artistHits: sc.artistHits,
    });
  };

  // Artist-lookup albums first (most complete + authoritative), then
  // text-search album results, then albums derived from song results.
  for (const a of artistAlbums) addAlbum(a);
  for (const a of albumRes) addAlbum(a);
  for (const s of songRes) {
    if (!s.collectionId || byCollection.has(s.collectionId)) continue;
    if (JUNK_COLLECTION.test(s.collectionName || '')) continue;
    if (s.kind && s.kind !== 'song') continue;
    // song records carry collection fields too
    addAlbum({
      collectionId: s.collectionId,
      collectionName: s.collectionName,
      artistName: s.artistName,
      artworkUrl100: s.artworkUrl100,
      artworkUrl60: s.artworkUrl60,
      trackCount: s.trackCount,
      releaseDate: s.releaseDate,
      collectionViewUrl: s.collectionViewUrl,
    });
  }

  // Filtering: if the query has album-title words beyond the artist
  // name, require a name hit (so "lil uzi vert eternal atake" returns
  // Eternal Atake, not the artist's whole 130-album catalog). If the
  // query is just an artist name, show everything.
  const all = Array.from(byCollection.values());
  const maxArtistHits = all.reduce((m, a) => Math.max(m, a._artistHits), 0);
  const queryHasAlbumWords = queryTokens.length > maxArtistHits;

  let filtered = all.filter((a) => {
    if (a._score <= 0) return false;
    if (queryHasAlbumWords && a._nameHits === 0) return false;
    return true;
  });
  // Fallback so we never return empty when there were candidates.
  if (filtered.length === 0) filtered = all.filter((a) => a._score > 0);

  return filtered
    .sort((a, b) => b._score - a._score)
    .slice(0, 40)
    .map(({ _score, _nameHits, _artistHits, ...rest }) => rest);
}

/**
 * Get all tracks for an iTunes album (collection) by its collectionId.
 * Uses the iTunes lookup endpoint with entity=song, which returns the
 * collection record first, then one record per track.
 *
 * Returns a shape matching spotifyGetAlbumTracks():
 *   { album, artists, albumArtUrl, tracks: [...] }
 * where each track matches the mapTrack() shape.
 */
export async function itunesGetAlbumTracks(collectionId) {
  const id = String(collectionId || '').trim();
  if (!id) return { album: '', artists: '', albumArtUrl: '', tracks: [] };
  let results;
  try {
    results = await itunesGet({ id, entity: 'song', limit: 200 });
  } catch {
    return { album: '', artists: '', albumArtUrl: '', tracks: [] };
  }
  // First result is the collection (wrapperType === 'collection'); the
  // rest are tracks (wrapperType === 'track').
  const collection = results.find((r) => r.wrapperType === 'collection') || {};
  const trackRows = results.filter((r) => r.wrapperType === 'track' || r.kind === 'song');
  return {
    album: collection.collectionName || '',
    artists: collection.artistName || '',
    albumArtUrl: upgradeArtwork(collection.artworkUrl100 || collection.artworkUrl60 || ''),
    tracks: trackRows
      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0))
      .map(mapTrack),
  };
}

/**
 * Confidence-matched cross-check. This is the function the import /
 * download paths use when Spotify can't answer. Given what we know
 * about a track (title, artist, optionally album + the real file
 * duration), it finds the single best iTunes match — or returns null
 * if nothing clears the confidence bar.
 *
 * The duration, when provided, is the strongest signal. Pass the
 * file's actual decoded duration (in ms) whenever you have it.
 *
 * @param {object} target { title, artist, album?, durationMs? }
 * @returns {Promise<object|null>} mapped track or null
 */
export async function itunesCrossCheck(target) {
  const title = String(target?.title || '').trim();
  const artist = String(target?.artist || '').trim();
  if (!title) return null;

  // Gather candidates from two sources, same as the search path:
  //   1. Plain text search (fast, works for popular tracks).
  //   2. The artist's discography via album expansion (reliable for
  //      deep cuts that text search can't surface — this is what makes
  //      the explicit flag work for songs like "Moon Relate").
  const q = artist ? `${artist} ${title}` : title;
  const textPromise = itunesGet({ term: q, entity: 'song', media: 'music', limit: 25 })
    .catch(() => []);

  const catalogPromise = (async () => {
    if (!artist) return [];
    const words = artist.split(/\s+/).filter(Boolean);
    const a = await resolveArtist(words);
    if (!a?.artistId) return [];
    const { tracks } = await fetchArtistDiscography(a.artistId, { maxAlbumsForTracks: 30 });
    return tracks;
  })();

  const [textResults, catalog] = await Promise.all([textPromise, catalogPromise]);

  // Merge + dedupe by trackId.
  const byId = new Map();
  for (const r of [...textResults, ...catalog]) {
    if (!r.trackId || byId.has(r.trackId)) continue;
    byId.set(r.trackId, r);
  }
  const candidates = Array.from(byId.values());
  if (!candidates.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    const s = scoreCandidate(cand, {
      title, artist, album: target.album, durationMs: target.durationMs,
    });
    if (s > bestScore) { bestScore = s; best = cand; }
  }

  // Confidence floor: require a minimum score so we never apply a
  // shaky guess. A bare title match with no other signal scores ~4-10;
  // we want at least a solid title match. If duration was available
  // and disagreed badly, the candidate is already penalized below this.
  const CONFIDENCE_FLOOR = 8;
  if (!best || bestScore < CONFIDENCE_FLOOR) return null;

  return mapTrack(best);
}
