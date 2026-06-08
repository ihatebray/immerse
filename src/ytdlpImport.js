import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getToolPaths } from './binPaths.js';

/* =========================================================================
 *  Tiered YouTube candidate selection
 *
 *  yt-dlp returns whatever it thinks is the best match for a search query.
 *  Without filtering, that means we sometimes get music videos, sped-up
 *  remixes, fan covers, clean radio edits, or 10-hour loops instead of the
 *  studio recording the user asked for.
 *
 *  The governing idea: WHATEVER SPOTIFY/iTUNES TOLD US IS THE TRACK WE WANT.
 *  Spotify hands us an exact duration and an explicit flag for the track.
 *  Our job is to find the YouTube upload that is the SAME RECORDING — same
 *  master, same length, same explicit/clean status — and reject everything
 *  else (live, remix, cover, music video, clean edit of an explicit song).
 *
 *  We score candidates against tiers in order. The first non-empty tier
 *  wins; within a tier the candidate whose duration is closest to Spotify's
 *  wins. If every tier is empty the import FAILS and the user picks manually
 *  via the Find tab. We never silently download a bad match.
 *
 *  TIER 0 — the streaming master (best):
 *    "<Artist> - Topic" auto-generated channel. These are uploaded by the
 *    label/distributor from the exact audio that ships to Spotify/Apple
 *    Music, so they match the target duration AND the target explicit
 *    status automatically. If Spotify says the track is explicit, the
 *    Topic upload IS the explicit master. This is the single most reliable
 *    way to guarantee we get the explicit cut.
 *
 *  TIER 1 — official audio from artist/label:
 *    Title carries an "(Official Audio)" / "(Official Visualizer)" marker
 *    (accepted from any channel), or a looser "Audio"/"Visualizer" marker
 *    from the artist's own channel or a record label.
 *
 *  TIER 2 — lyric video:
 *    Title says "Lyrics" / "Lyric Video", contains artist + song, duration
 *    matches, and is NOT a "Clean Lyrics"/"Clean Version" upload.
 *
 *  TIER 3 — music video (OFF BY DEFAULT, see ALLOW_MUSIC_VIDEO_FALLBACK):
 *    Disabled to honour "no music videos". When enabled it is the last
 *    resort, gated on an EXACT duration match from an artist/label/Topic
 *    channel — at exact duration the MV audio is the studio cut.
 *
 *  HARD REJECTS (never accepted in any tier):
 *    - Snippets / previews / teasers / "part N of M" / loops / hour-long
 *      uploads / extended edits.
 *    - Clean / radio-edit / censored markers WHEN the target is explicit.
 *    - Live / cover / karaoke / instrumental / remix / sped-up / slowed /
 *      nightcore / mashup / bootleg — UNLESS that word was in the query.
 * ========================================================================= */

/* -------------------------------------------------------------------------
 *  Tunable knobs
 * ---------------------------------------------------------------------- */

/**
 * Music videos as a last-resort fallback. Default OFF: the user's stated
 * preference is "no music videos". When a track has no Topic / Official
 * Audio / lyric upload, the import will fail over to the manual picker
 * instead of grabbing a music video.
 *
 * Flip to `true` if you find too many tracks failing to auto-import: it
 * adds a Tier 3 that accepts an official music video ONLY when its duration
 * matches Spotify's EXACTLY (±MV_DURATION_TOLERANCE_SEC) and it comes from
 * the artist's channel, a label, or a Topic channel. At exact duration the
 * music-video audio track is the same studio recording, so it is not a
 * "wrong song" — it just may carry a spoken intro/outro on rare uploads,
 * which the exact-duration gate filters out.
 *
 * This is only the DEFAULT. A per-import `allowMusicVideo` option (driven by
 * the "Allow music videos as a last resort" setting in the UI) overrides it
 * when provided.
 */
const ALLOW_MUSIC_VIDEO_FALLBACK = false;

/** Duration tolerance (seconds) for the audio tiers (Topic / Official Audio). */
const AUDIO_DURATION_TOLERANCE_SEC = 4;
/** Duration tolerance for lyric videos — they sometimes carry a short graphic intro. */
const LYRIC_DURATION_TOLERANCE_SEC = 5;
/** Duration tolerance for the (optional) music-video fallback — must be near-exact. */
const MV_DURATION_TOLERANCE_SEC = 2;

/* -------------------------------------------------------------------------
 *  Title / channel pattern banks
 * ---------------------------------------------------------------------- */

/** Words that, when found in a title, disqualify a candidate outright. */
const HARD_REJECT_TITLE_PATTERNS = [
  // M/V is overwhelmingly used by fan/reaction/compilation channels in 2026.
  /\bM\/V\b/,
  // Partial/snippet/preview titles — fan uploads of incomplete tracks.
  /\bfirst\s*half\b/i,
  /\bsecond\s*half\b/i,
  /\bpart\s*\d+\s*of\s*\d+\b/i,
  /\bsnippet\b/i,
  /\bpreview\b/i,
  /\bteaser\b/i,
  /\bincomplete\b/i,
  /\bintro\s*only\b/i,
  /\boutro\s*only\b/i,
  /\b\(short\)/i,
  /\bshortened\b/i,
  // Loops / hour-long / extended uploads. These would also fail the
  // duration gate, but rejecting them by title avoids ever scoring them.
  /\bloop(ed)?\b/i,
  /\b\d+\s*hours?\b/i,
  /\bextended\s*(version|mix|edit)\b/i,
];

/**
 * Channel-level hard rejects. NOTE: "<Artist> - Topic" is deliberately NOT
 * here any more — Topic channels are the streaming master and now win Tier 0.
 */
const HARD_REJECT_CHANNEL_PATTERNS = [
  // (Reserved for genuinely bad channels. Intentionally empty for now.)
];

/**
 * Conditional rejects — only applied if the word is NOT in the user's query.
 * (If the user searched "drake live", they want a live version.)
 */
const CONDITIONAL_REJECT_PATTERNS = [
  { re: /\blive\b/i, key: 'live' },
  { re: /\bcover\b/i, key: 'cover' },
  { re: /\bkaraoke\b/i, key: 'karaoke' },
  { re: /\binstrumental\b/i, key: 'instrumental' },
  { re: /\b8d\s*audio\b/i, key: '8d' },
  { re: /\bsped\s*up\b/i, key: 'sped up' },
  { re: /\bslowed\b/i, key: 'slowed' },
  { re: /\bnightcore\b/i, key: 'nightcore' },
  { re: /\breverb\b/i, key: 'reverb' },
  { re: /\bremix\b/i, key: 'remix' },
  { re: /\bmashup\b/i, key: 'mashup' },
  { re: /\bbootleg\b/i, key: 'bootleg' },
  { re: /\bvip\s*(mix|edit)\b/i, key: 'vip' },
  { re: /\bflip\b/i, key: 'flip' },
  { re: /\brework\b/i, key: 'rework' },
];

/* -------------------------------------------------------------------------
 *  Explicit / clean detection
 *
 *  Duration cannot tell a clean cut from an explicit one (clean versions
 *  usually mute or reverse the word and keep the same length). The reliable
 *  signals are (a) explicit title markers and (b) anchoring to the Topic
 *  channel, whose upload mirrors the streaming master's explicit status.
 * ---------------------------------------------------------------------- */

/** Title markers that mean "this is the CLEAN / radio cut". */
const CLEAN_MARKER_PATTERNS = [
  /\(\s*clean\s*\)/i,
  /\[\s*clean\s*\]/i,
  /\bclean\s*version\b/i,
  /\bclean\s*lyrics?\b/i,
  /\bclean\s*audio\b/i,
  /\bclean\s*edit\b/i,
  /\bradio\s*edit\b/i,
  /\bradio\s*version\b/i,
  /\bcensored\b/i,
  /\bbleeped\b/i,
  /\bfamily\s*friendly\b/i,
  /\bno\s*swearing\b/i,
];

/** Title markers that mean "this is the EXPLICIT / uncensored cut". */
const EXPLICIT_MARKER_PATTERNS = [
  /\(\s*explicit\s*\)/i,
  /\[\s*explicit\s*\]/i,
  /\bexplicit\s*version\b/i,
  /\buncensored\b/i,
  /\(\s*dirty\s*\)/i,
  /\[\s*dirty\s*\]/i,
  /\bdirty\s*version\b/i,
];

/**
 * STRICT official-audio markers — phrases fan/reupload accounts essentially
 * never use because they're industry conventions for label/artist uploads.
 * If a title matches one of these we accept it on the strength of the title
 * alone (channel need not be whitelisted), which lets named-only labels
 * (Fueled By Ramen, OVO Sound, Top Shelf, etc.) win without us enumerating
 * every label on Earth.
 */
const STRICT_OFFICIAL_AUDIO_PATTERNS = [
  /\(\s*official\s*audio\s*\)/i,
  /\(\s*official\s*visualizer\s*\)/i,
  /\[\s*official\s*audio\s*\]/i,
  /\[\s*official\s*visualizer\s*\]/i,
];

/** LOOSE official-audio markers — wider net, requires artist/label channel. */
const OFFICIAL_AUDIO_TITLE_PATTERNS = [
  /\bofficial\s*audio\b/i,
  /\bofficial\s*visualizer\b/i,
  /\bvisualizer\b/i,
  /\baudio\b/i,
];

/** Music-video markers (only relevant when ALLOW_MUSIC_VIDEO_FALLBACK is on). */
const MUSIC_VIDEO_PATTERNS = [
  /\bofficial\s*music\s*video\b/i,
  /\bmusic\s*video\b/i,
  /\bofficial\s*video\b/i,
  /\(\s*video\s*\)/i,
];

/** Lyric-video markers. */
const LYRIC_VIDEO_PATTERNS = [
  /\blyrics?\b/i,
  /\blyric\s*video\b/i,
];

/**
 * Common record-label substrings (case-insensitive). Not exhaustive — a
 * sanity check, not a definitive list.
 */
const LABEL_SUBSTRINGS = [
  'records', 'recordings', 'music group', 'entertainment', 'label',
  'atlantic', 'republic', 'def jam', 'interscope', 'columbia', 'rca',
  'warner', 'universal', 'sony', 'capitol', 'island', 'epic', 'parlophone',
  'virgin', 'roc nation', 'top dawg', '4ad', 'matador', 'sub pop',
  'xl recordings', 'domino', 'ninja tune', 'mom + pop', 'merge',
  'big machine', 'glassnote', 'fader', 'aftermath', 'shady', 'mass appeal',
];

/* -------------------------------------------------------------------------
 *  Small helpers
 * ---------------------------------------------------------------------- */

/**
 * Strip common YouTube channel suffixes/decorations so artist names can be
 * compared directly. "Drake - Topic" → "drake", "Drake VEVO" → "drake".
 */
function normalizeChannelName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\s*-\s*topic\s*$/i, '')
    .replace(/\s*vevo\s*$/i, '')
    .replace(/\s*official\s*$/i, '')
    .replace(/\s*music\s*$/i, '')
    .replace(/\s*\(official\)\s*$/i, '')
    .trim();
}

/** Pull the primary artist out of a comma/feat-separated string. */
function primaryArtist(s) {
  if (!s) return '';
  return String(s)
    .split(/,|feat\.?|ft\.?|featuring|&|\bx\b|\bwith\b/i)[0]
    .trim()
    .toLowerCase();
}

/** True if the channel name looks like a record label. */
function isLabelChannel(channelName) {
  if (!channelName) return false;
  const lower = channelName.toLowerCase();
  return LABEL_SUBSTRINGS.some((sub) => lower.includes(sub));
}

/**
 * Strip noise from a title before comparison: parentheticals/brackets
 * ("(feat. X)", "(Official Audio)", "[Lyrics]"), trailing "feat.." tails, and
 * common decoration words. Then lowercase to a clean word list.
 *
 * The point is to compare the actual SONG NAME, not the marketing furniture.
 * "Slide (feat. Future) [Official Audio]" and "Chase Atlantic - Slide" both
 * reduce to the word "slide".
 */
function songWordsOf(s) {
  const cleaned = String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')        // (feat. X), (Official Audio), ...
    .replace(/\[[^\]]*\]/g, ' ')       // [ ... ]
    .replace(/\bfeat\.?\b[\s\S]*$/i, ' ') // trailing "feat ..."
    .replace(/\bft\.?\b[\s\S]*$/i, ' ')   // trailing "ft ..."
    .replace(/\b(official|audio|visualizer|lyric|lyrics|video|explicit|clean|hd|hq)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')      // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.split(' ') : [];
}

const SONG_TITLE_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'for']);

/**
 * Does the candidate's title actually contain the SONG we asked for?
 *
 * This replaces the old per-character heuristic, which matched any two songs
 * by the same artist that happened to share letters (e.g. "Angeline" matched
 * "Ozone" — a, n, e, l, i, n, e all appear in "chaseatlanticozone"). We now
 * match at the WORD level:
 *
 *   1. Exact joined-substring match of the cleaned song name (robust to
 *      punctuation and to a YouTube title that omits/adds "(feat. X)").
 *   2. Otherwise every significant song word must appear as a candidate word.
 *
 * A song word "counts" only as a whole word in the candidate (or as a
 * joined-substring for one-word titles), never as a scatter of letters.
 */
function songTitleMatches(candidateTitle, songTitle) {
  const songWords = songWordsOf(songTitle);
  if (songWords.length === 0) return false;

  const candWords = songWordsOf(candidateTitle);
  const candSet = new Set(candWords);
  const candJoined = candWords.join('');
  const songJoined = songWords.join('');

  // Single-word song title: require a WHOLE-WORD match. No substring gluing,
  // so "Green" does not match "Greenmachine" and "Angeline" does not match
  // "Ozone". (A short word that is a literal token of another title — e.g.
  // "It" inside "Into It" — is the one residual ambiguity; the duration gate
  // disambiguates those same-artist collisions.)
  if (songWords.length === 1) {
    return candSet.has(songWords[0]);
  }

  // Multi-word song title:
  //   1. joined-substring match (a multi-word run rarely embeds in an
  //      unrelated title; robust to added/omitted "(feat. X)").
  if (songJoined.length >= 2 && candJoined.includes(songJoined)) return true;
  //   2. otherwise ≥80% of the significant words must appear as whole words.
  const significant = songWords.filter((w) => w.length >= 2 && !SONG_TITLE_STOPWORDS.has(w));
  const words = significant.length > 0 ? significant : songWords;
  let matched = 0;
  for (const w of words) {
    if (candSet.has(w)) matched++;
  }
  return matched / words.length >= 0.8;
}

/** True if the channel matches the artist (lenient substring after normalizing). */
function channelMatchesArtist(channelName, artistName) {
  const c = normalizeChannelName(channelName);
  const a = primaryArtist(artistName);
  if (!c || !a) return false;
  return c === a || c.includes(a) || a.includes(c);
}

/** True if the channel is a "<Artist> - Topic" auto-generated audio channel. */
function isTopicChannel(channelName) {
  return /\s-\s*topic\s*$/i.test(String(channelName || ''));
}

/** "DrakeVEVO" / "DRAKEVEVO" / "Drake VEVO" all match. */
function isVevoChannel(channelName) {
  return /vevo\s*$/i.test(String(channelName || ''));
}

/** Title-level hard rejects (snippets, loops, M/V, hour-long, etc.). */
function hasHardReject(title) {
  return HARD_REJECT_TITLE_PATTERNS.some((re) => re.test(title));
}

/** Channel-level hard rejects. */
function hasHardRejectChannel(channel) {
  return HARD_REJECT_CHANNEL_PATTERNS.some((re) => re.test(String(channel || '')));
}

/**
 * Conditional rejects (live/cover/remix/etc.) — only fire when the word is
 * absent from the query the user actually searched for.
 */
function hasConditionalReject(title, query) {
  const queryLower = String(query || '').toLowerCase();
  for (const { re, key } of CONDITIONAL_REJECT_PATTERNS) {
    if (re.test(title) && !queryLower.includes(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Decide whether a candidate's explicit/clean status is acceptable given
 * what Spotify told us, and how much to nudge its score.
 *
 *   expectedExplicit === true   → Spotify says the track IS explicit.
 *       Reject any clean/radio-edit upload. Prefer explicit-marked uploads.
 *       Unmarked uploads are allowed (most originals are the explicit cut)
 *       but rank below explicit-marked ones and below the Topic master.
 *
 *   expectedExplicit === false  → the track has no profanity to begin with.
 *       Clean vs explicit is moot; accept anything, no nudge.
 *
 *   expectedExplicit === null   → unknown. Allow clean-marked uploads (so a
 *       track whose only upload is clean still imports) but penalise them so
 *       an unmarked/explicit alternative always wins.
 *
 * Returns { ok: boolean, bonus: number } where a NEGATIVE bonus improves the
 * score (lower score wins).
 */
function explicitDecision(title, expectedExplicit) {
  const hasClean = CLEAN_MARKER_PATTERNS.some((re) => re.test(title));
  const hasExplicit = EXPLICIT_MARKER_PATTERNS.some((re) => re.test(title));

  if (expectedExplicit === true) {
    if (hasClean && !hasExplicit) return { ok: false, bonus: 0 };
    return { ok: true, bonus: hasExplicit ? -1 : 0 };
  }
  if (expectedExplicit === false) {
    return { ok: true, bonus: 0 };
  }
  // Unknown.
  if (hasClean && !hasExplicit) return { ok: true, bonus: 3 };
  return { ok: true, bonus: hasExplicit ? -1 : 0 };
}

/* -------------------------------------------------------------------------
 *  Scoring
 * ---------------------------------------------------------------------- */

/**
 * Score a candidate against the tier system. Returns { tier, score, sub } on
 * a match (lower tier wins, then lower score), or { tier: null, reason } if
 * the candidate is rejected.
 *
 * Within a tier the score is dominated by how close the candidate's duration
 * is to Spotify's target, so the recording that actually matches the
 * streaming length always wins. A tiny view-count tiebreaker favours the
 * canonical upload when two candidates are otherwise identical.
 */
function scoreCandidate(c, { artists, title, targetDurationSec, query, expectedExplicit, allowMusicVideo }) {
  // Per-import override of the module default. Lets the UI's "Allow music
  // videos as a last resort" setting drive Tier 3 without a code change.
  const allowMV = typeof allowMusicVideo === 'boolean' ? allowMusicVideo : ALLOW_MUSIC_VIDEO_FALLBACK;
  const candidateTitle = String(c.title || '');
  const candidateChannel = String(c.channel || c.uploader || '');
  const candidateDuration = Number(c.duration) || 0;
  const viewCount = Number(c.view_count) || 0;

  // ---- HARD REJECTS ----
  if (hasHardReject(candidateTitle)) return { tier: null, reason: 'hard reject (title)' };
  if (hasHardRejectChannel(candidateChannel)) return { tier: null, reason: 'hard reject (channel)' };
  if (hasConditionalReject(candidateTitle, `${artists} ${title}`)) {
    return { tier: null, reason: 'conditional reject (live/cover/remix/etc.)' };
  }

  // ---- Explicit / clean gate ----
  const exp = explicitDecision(candidateTitle, expectedExplicit);
  if (!exp.ok) return { tier: null, reason: 'clean cut of an explicit track' };

  // ---- Duration ----
  const dur = candidateDuration;
  const target = targetDurationSec || 0;
  const durDiff = target > 0 ? Math.abs(dur - target) : 0;

  const withinAudio = target <= 0 || durDiff <= AUDIO_DURATION_TOLERANCE_SEC;
  const withinLyric = target <= 0 || durDiff <= LYRIC_DURATION_TOLERANCE_SEC;
  const withinExact = target <= 0 || durDiff <= MV_DURATION_TOLERANCE_SEC;

  // View-count tiebreaker (log10, capped) — never overrides a real signal.
  const viewBonus = viewCount > 0 ? -Math.min(2, Math.log10(viewCount) / 4) : 0;

  // Base score: distance from target, plus explicit nudge, plus tiebreaker.
  // Lower wins.
  const baseScore = durDiff + exp.bonus + viewBonus;

  // ---- Title-content checks ----
  const normalizeForMatch = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidateTitleNorm = normalizeForMatch(candidateTitle);
  const primaryArtistNorm = normalizeForMatch(primaryArtist(artists));
  // Artist match is a plain substring — the artist name does genuinely appear
  // verbatim in real titles ("Chase Atlantic - Angeline"). The SONG match is
  // word-level (see songTitleMatches) to avoid scatter-of-letters collisions.
  const titleContainsArtist = primaryArtistNorm.length > 0 && candidateTitleNorm.includes(primaryArtistNorm);
  const titleContainsSong = songTitleMatches(candidateTitle, title);

  // ---- Pre-computed signals ----
  const channelIsArtist = channelMatchesArtist(candidateChannel, artists);
  const channelIsLabel = isLabelChannel(candidateChannel);
  const channelIsTopic = isTopicChannel(candidateChannel);
  const channelIsVevo = isVevoChannel(candidateChannel);
  const hasStrictAudio = STRICT_OFFICIAL_AUDIO_PATTERNS.some((re) => re.test(candidateTitle));
  const hasLooseAudio = OFFICIAL_AUDIO_TITLE_PATTERNS.some((re) => re.test(candidateTitle));
  const hasMusicVideo = MUSIC_VIDEO_PATTERNS.some((re) => re.test(candidateTitle));
  const isLyricVideo = LYRIC_VIDEO_PATTERNS.some((re) => re.test(candidateTitle));

  // ---- TIER 0: the streaming master ("<Artist> - Topic") ----
  // Channel is "<artist> - Topic" (so it matches the artist after normalizing)
  // and the title is the song. Duration must land in the audio window. This
  // is the exact upload Spotify/Apple Music distribute from, so it carries
  // the correct duration AND the correct explicit status by construction.
  if (channelIsTopic && channelIsArtist && titleContainsSong && withinAudio) {
    return { tier: 0, score: baseScore, sub: 'topic-master' };
  }

  // ---- TIER 1: official audio ----
  if (titleContainsArtist && titleContainsSong && withinAudio) {
    // 1a — strict "(Official Audio)" / "(Official Visualizer)" marker.
    // Accepted from any channel; fan accounts don't use this exact format.
    if (hasStrictAudio) {
      if (channelIsArtist || channelIsVevo) {
        return { tier: 1, score: baseScore, sub: 'artist+strict-audio' };
      }
      return { tier: 1, score: baseScore + 0.5, sub: 'any+strict-audio' };
    }
    // 1b — artist's own channel (or VEVO) with the song in the title.
    if (channelIsArtist || channelIsVevo) {
      return { tier: 1, score: baseScore + 0.25, sub: 'artist-channel' };
    }
    // 1c — loose audio marker, but only from a label channel.
    if (hasLooseAudio && channelIsLabel) {
      return { tier: 1, score: baseScore + 1, sub: 'label+loose-audio' };
    }
  }

  // ---- TIER 2: lyric video ----
  // Lyrics in the title, artist + song present, duration within the (slightly
  // wider) lyric window. Clean lyric uploads were already rejected by the
  // explicit gate when the target is explicit.
  if (isLyricVideo && titleContainsArtist && titleContainsSong && withinLyric) {
    return { tier: 2, score: baseScore, sub: 'lyric-video' };
  }

  // ---- TIER 3: music video (last resort, OFF by default) ----
  // Honours "no music videos" unless explicitly enabled. When enabled, only
  // an EXACT-duration official MV from artist/label/Topic qualifies — at exact
  // duration the audio is the studio cut.
  if (allowMV
      && hasMusicVideo && titleContainsArtist && titleContainsSong && withinExact) {
    if (channelIsArtist || channelIsVevo) {
      return { tier: 3, score: baseScore, sub: 'artist+music-video' };
    }
    if (channelIsLabel || channelIsTopic) {
      return { tier: 3, score: baseScore + 1, sub: 'label+music-video' };
    }
  }

  return { tier: null, reason: 'no tier match' };
}

/* -------------------------------------------------------------------------
 *  Search / pick / download (I/O — unchanged behaviour)
 * ---------------------------------------------------------------------- */

/**
 * Search YouTube for candidates using --flat-playlist mode for speed.
 * Output is a single top-level JSON object with an `entries` array.
 */
function searchYoutubeCandidates(query, count, ytDlp) {
  return new Promise((resolve, reject) => {
    const args = [
      '--skip-download',
      '--flat-playlist',
      '-J',
      '--default-search', 'ytsearch',
      `ytsearch${count}:${query}`,
    ];
    const proc = spawn(ytDlp, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`yt-dlp search failed (${code})\n${stderr.slice(-2000)}`));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {
        reject(new Error(`Could not parse yt-dlp search output: ${e.message}`));
        return;
      }
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      const candidates = entries
        .filter((e) => e?.id && e?.title)
        .map((e) => ({
          id: e.id,
          title: e.title,
          channel: e.channel || e.uploader || e.uploader_id || '',
          uploader: e.uploader || e.channel || '',
          duration: e.duration || 0,
          view_count: e.view_count || 0,
        }));
      resolve(candidates);
    });
  });
}

/**
 * Pick the best candidate from a list using the tier rules. Returns the
 * candidate object plus the tier it matched, or null if nothing matched.
 */
function pickBestCandidate(candidates, params) {
  const scored = candidates
    .map((c) => ({ candidate: c, ...scoreCandidate(c, params) }))
    .filter((s) => s.tier != null);

  if (scored.length === 0) return null;

  // Tier ascending (0 wins), then score ascending (closest duration / best source).
  scored.sort((a, b) => (a.tier - b.tier) || (a.score - b.score));
  return scored[0];
}

/**
 * Download a specific YouTube video by ID, extract audio, save to disk.
 */
function downloadById(videoId, { ytDlp, ffmpeg, outDir, stamp, onLog }) {
  return new Promise((resolve, reject) => {
    const outTemplate = path.join(outDir, `yt-import-${stamp}.%(ext)s`);
    const args = [
      '--no-playlist',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--embed-metadata',
      '--embed-thumbnail',
      '-o', outTemplate,
    ];
    if (fs.existsSync(ffmpeg)) {
      args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }
    args.push(`https://www.youtube.com/watch?v=${videoId}`);

    const proc = spawn(ytDlp, args, { windowsHide: true });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); onLog?.(d.toString()); });
    proc.stdout?.on('data', (d) => onLog?.(d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with ${code}\n${stderr.slice(-2000)}`));
        return;
      }
      const expected = path.join(outDir, `yt-import-${stamp}.mp3`);
      if (fs.existsSync(expected)) { resolve(expected); return; }
      const candidates = fs.readdirSync(outDir)
        .filter((f) => f.startsWith(`yt-import-${stamp}`) && f.endsWith('.mp3'))
        .map((f) => path.join(outDir, f));
      if (candidates.length === 0) {
        reject(new Error('yt-dlp finished but no mp3 output was found.'));
        return;
      }
      candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      resolve(candidates[0]);
    });
  });
}

/**
 * Download the best YouTube match for "Artist Title" using tiered selection.
 *
 *   targetDurationSec — expected song length in seconds (from Spotify/iTunes).
 *                        Primary discriminator; closest match wins each tier.
 *   expectedExplicit  — Spotify's explicit flag (true/false/null). Drives the
 *                        clean-cut rejection.
 *
 * Returns an absolute path to the written .mp3. Throws (with a structured
 * `no-tier-match` error carrying candidates) if nothing qualifies.
 */
export async function downloadYoutubeAudioForQuery({ artists, title, targetDurationSec = 0, expectedExplicit = null, allowMusicVideo = null }, { onLog } = {}) {
  const { ytDlp, ffmpeg } = getToolPaths();
  if (!fs.existsSync(ytDlp)) {
    throw new Error('yt-dlp not found. Run: npm run setup:binaries');
  }

  const outDir = path.join(app.getPath('userData'), 'streaming-imports');
  fs.mkdirSync(outDir, { recursive: true });

  const baseQuery = `${artists} ${title}`.replace(/"/g, "'").trim();
  const explicitTag = expectedExplicit === true ? ' [explicit]' : (expectedExplicit === false ? ' [clean]' : '');
  onLog?.(`[ytdlp] parallel search for "${baseQuery}" (target duration: ${targetDurationSec || '?'}s)${explicitTag}\n`);

  // Three parallel searches, each surfacing a different source:
  //   - Plain query: catches the artist's own channel AND the "- Topic" master.
  //   - Audio variant: surfaces "Official Audio" / "Visualizer" uploads.
  //   - Lyrics variant: surfaces lyric videos for tracks with no clean audio
  //     source. (Replaces the old "Official Music Video" probe, since music
  //     videos are no longer a default tier.)
  const queries = [
    baseQuery,
    `${baseQuery} Official Audio`,
    `${baseQuery} Lyrics`,
  ];
  let allCandidates;
  try {
    const results = await Promise.all(
      queries.map((q) => searchYoutubeCandidates(q, 8, ytDlp).catch(() => []))
    );
    const seen = new Set();
    allCandidates = [];
    for (const list of results) {
      for (const c of list) {
        if (c?.id && !seen.has(c.id)) {
          seen.add(c.id);
          allCandidates.push(c);
        }
      }
    }
  } catch (e) {
    throw new Error(`Search failed: ${e.message}`);
  }
  if (!allCandidates.length) {
    throw new Error('No YouTube results for this query.');
  }
  onLog?.(`[ytdlp] got ${allCandidates.length} unique candidates from 3 queries, scoring…\n`);

  const winner = pickBestCandidate(allCandidates, { artists, title, targetDurationSec, query: baseQuery, expectedExplicit, allowMusicVideo });
  if (!winner) {
    // Structured failure — main.js surfaces these in the manual picker.
    const sortedCandidates = [...allCandidates].sort(
      (a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0)
    );
    const err = new Error('No YouTube result satisfies the tier requirements.');
    err.code = 'no-tier-match';
    err.candidates = sortedCandidates.slice(0, 12).map((c) => ({
      id: c.id,
      title: c.title,
      channel: c.channel || c.uploader || '',
      duration: c.duration || 0,
      viewCount: c.view_count || 0,
      thumbnailUrl: `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`,
    }));
    throw err;
  }

  const c = winner.candidate;
  onLog?.(
    `[ytdlp] picked tier ${winner.tier} (${winner.sub}): ` +
    `"${c.title}" — ${c.channel || c.uploader} ` +
    `(${Math.round(c.duration || 0)}s, target ${Math.round(targetDurationSec)}s)\n`
  );

  const stamp = Date.now();
  return downloadById(c.id, { ytDlp, ffmpeg, outDir, stamp, onLog });
}

/**
 * Download a specific YouTube video by its ID, bypassing all tier matching.
 * Used by the manual-pick flow.
 */
export async function downloadYoutubeAudioById(videoId, { onLog } = {}) {
  const { ytDlp, ffmpeg } = getToolPaths();
  if (!fs.existsSync(ytDlp)) {
    throw new Error('yt-dlp not found. Run: npm run setup:binaries');
  }
  const outDir = path.join(app.getPath('userData'), 'streaming-imports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = Date.now();
  return downloadById(videoId, { ytDlp, ffmpeg, outDir, stamp, onLog });
}

/**
 * Search-only path for the manual picker. Same multi-query search as the auto
 * import, but returns candidates directly without tier scoring or download.
 *
 * Returns up to 12 (or 24 for custom queries) candidates, sorted by view count.
 */
export async function searchCandidatesForPicker({ artists, title, customQuery }, { onLog } = {}) {
  const { ytDlp } = getToolPaths();
  if (!fs.existsSync(ytDlp)) {
    throw new Error('yt-dlp not found. Run: npm run setup:binaries');
  }
  const cleanCustom = String(customQuery || '').trim();
  const useCustom = cleanCustom.length > 0;
  const baseQuery = useCustom
    ? cleanCustom.replace(/"/g, "'")
    : `${artists} ${title}`.replace(/"/g, "'").trim();
  console.log(`[ytdlp picker] useCustom=${useCustom} query="${baseQuery}" (artists="${artists}", title="${title}", customQuery="${customQuery}")`);
  onLog?.(`[ytdlp] picker-mode search for "${baseQuery}"${useCustom ? ' (custom, no rejects, 24 results)' : ''}\n`);

  const queries = useCustom
    ? [baseQuery]
    : [
        baseQuery,
        `${baseQuery} Official Audio`,
        `${baseQuery} Lyrics`,
      ];
  const perQueryCount = useCustom ? 30 : 8;
  const results = await Promise.all(
    queries.map((q) => searchYoutubeCandidates(q, perQueryCount, ytDlp).catch(() => []))
  );
  const seen = new Set();
  const allCandidates = [];
  for (const list of results) {
    for (const c of list) {
      if (c?.id && !seen.has(c.id)) {
        seen.add(c.id);
        allCandidates.push(c);
      }
    }
  }
  // Default flow drops obvious junk (snippets/partials/loops). Custom queries
  // are trusted verbatim. If the strict filter empties the list, fall back to
  // dropping only title-level junk.
  let filtered;
  if (useCustom) {
    filtered = allCandidates;
  } else {
    const strict = allCandidates.filter((c) => {
      if (hasHardReject(String(c.title || ''))) return false;
      if (hasHardRejectChannel(String(c.channel || c.uploader || ''))) return false;
      return true;
    });
    if (strict.length > 0) {
      filtered = strict;
    } else {
      filtered = allCandidates.filter((c) => !hasHardReject(String(c.title || '')));
      console.log(`[ytdlp picker] strict filter emptied results, falling back to lenient`);
    }
  }
  filtered.sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0));
  const limit = useCustom ? 24 : 12;
  console.log(`[ytdlp picker] raw=${allCandidates.length}, filtered=${filtered.length}, returning=${Math.min(filtered.length, limit)} (limit=${limit})`);
  return filtered.slice(0, limit).map((c) => ({
    id: c.id,
    title: c.title,
    channel: c.channel || c.uploader || '',
    duration: c.duration || 0,
    viewCount: c.view_count || 0,
    thumbnailUrl: `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`,
  }));
}
