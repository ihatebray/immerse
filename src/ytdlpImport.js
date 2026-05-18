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
 *  remixes, fan covers, or 10-hour loops instead of the studio recording the
 *  user asked for.
 *
 *  We score candidates against three tiers in order. The first non-empty tier
 *  wins. If all three are empty, the import FAILS — the user can choose
 *  manually via the Find tab. We never silently download a bad match.
 *
 *  TIER 1 — official audio source from the artist's own channel:
 *    - Channel matches "<artist> - Topic" / "<artist>VEVO" / contains artist
 *    - Title does NOT suggest a music video
 *
 *  TIER 2 — explicitly labeled audio from any plausible source:
 *    - Title contains "Official Audio", "Audio", "Visualizer",
 *      or "Official Visualizer"
 *    - Channel either matches the artist OR looks like a record label
 *
 *  TIER 3 — lyric video, only if duration matches the target ±5s:
 *    - Title contains "Lyric" / "Lyrics"
 *    - Duration within 5s of the Spotify/iTunes target
 *
 *  HARD REJECTS (never accepted in any tier):
 *    - Title suggests "music video", "M/V", "official video"
 *    - Title suggests "live", "cover", "karaoke", "instrumental",
 *      "8d audio", "sped up", "slowed", "nightcore", "reverb"
 *      UNLESS those words appeared in the original search query
 * ========================================================================= */

/** Words that, when found in a title, should disqualify a candidate. */
const HARD_REJECT_TITLE_PATTERNS = [
  // M/V is overwhelmingly used by fan/reaction/compilation channels in 2026.
  /\bM\/V\b/,
  // Partial/snippet/preview titles — fan uploads of incomplete tracks.
  // These would otherwise sneak through duration checks if the partial
  // happens to be close to the target length, or get accepted as Tier 1
  // matches based on title/channel alone.
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
];

/** Channels that should be rejected outright. */
const HARD_REJECT_CHANNEL_PATTERNS = [
  // Legacy "Drake - Topic" naming. The newer auto-audio channels drop this
  // suffix and just use the artist name — those are filtered structurally
  // by Tier 1's "title must contain artist name" requirement, since auto-
  // audio uploads are titled with just the song name.
  /\s-\s*topic\s*$/i,
];

/** Conditional rejects — only applied if NOT in the user's query. */
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
];

/**
 * STRICT official-audio markers — phrases that fan/reupload accounts essentially
 * never use, because they're industry conventions for label/artist uploads.
 * "(Official Audio)" with the parens and "Official" prefix is the giveaway —
 * fan reuploads use "AUDIO" in caps, "Audio HQ", "Audio Only", etc.
 *
 * If a candidate title matches one of these, we accept it on the strength of
 * the title alone — the channel doesn't need to be on our label whitelist.
 * This is what lets uploads from named-only labels (Fueled By Ramen, OVO Sound,
 * Top Shelf, Polyvinyl, etc.) win without us having to maintain a list of
 * every label on Earth.
 */
const STRICT_OFFICIAL_AUDIO_PATTERNS = [
  /\(\s*official\s*audio\s*\)/i,
  /\(\s*official\s*visualizer\s*\)/i,
  /\[\s*official\s*audio\s*\]/i,
  /\[\s*official\s*visualizer\s*\]/i,
];

/**
 * LOOSE official-audio markers — used as a wider net but require a label-
 * whitelisted channel as a guardrail because plain "Audio" or "Visualizer"
 * is much more ambiguous and could appear in fan-channel titles.
 */
const OFFICIAL_AUDIO_TITLE_PATTERNS = [
  /\bofficial\s*audio\b/i,
  /\bofficial\s*visualizer\b/i,
  /\bvisualizer\b/i,
  /\baudio\b/i,
];

/**
 * Music-video markers. Allowed only as the LAST option within Tier 1, behind
 * Audio/Visualizer titles, AND only if the duration matches exactly (±1s).
 * The exact duration check is the safety net — without it, any random fan
 * remix or extended edit with "music video" in the title would be eligible.
 */
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
 * Specific anti-patterns for the lyric-video tier. A lyric video titled
 * "Clean Lyrics" or "(Clean Version)" is an explicit signal that this is the
 * radio edit, which is exactly what we DON'T want when the streaming service
 * told us the song is explicit. We reject these regardless of expected
 * explicit flag because: (a) the user can re-import as a folder if they want
 * the clean version, (b) the Audio/Visualizer tier 1 catches clean uploads
 * just fine when intentional.
 */
const LYRIC_CLEAN_REJECT_PATTERNS = [
  /\bclean\s*lyrics\b/i,
  /\bclean\s*version\b/i,
  /\(clean\)/i,
];

/**
 * Common record-label substrings (case-insensitive). Not exhaustive — this is
 * a sanity check, not a definitive list. Anything matching here counts as a
 * "label channel" for Tier 2.
 */
const LABEL_SUBSTRINGS = [
  'records', 'recordings', 'music group', 'entertainment', 'label',
  'atlantic', 'republic', 'def jam', 'interscope', 'columbia', 'rca',
  'warner', 'universal', 'sony', 'capitol', 'island', 'epic', 'parlophone',
  'virgin', 'roc nation', 'top dawg', '4ad', 'matador', 'sub pop',
  'xl recordings', 'domino', 'ninja tune', 'mom + pop', 'merge',
  'big machine', 'glassnote', 'fader', 'aftermath', 'shady', 'mass appeal',
];

/**
 * Strip common YouTube channel suffixes and decorations so we can compare
 * artist names directly. "Drake - Topic" → "drake", "Drake VEVO" → "drake",
 * "DrakeOfficial" → "drake".
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

/**
 * Pull the primary artist out of a comma/feat-separated string. iTunes tends
 * to return "Drake feat. 21 Savage" for collabs; we want just "Drake" for
 * channel comparison.
 */
function primaryArtist(s) {
  if (!s) return '';
  return String(s)
    .split(/,|feat\.?|ft\.?|featuring|&|\bx\b|\bwith\b/i)[0]
    .trim()
    .toLowerCase();
}

/**
 * Returns true if the candidate channel looks like a record label.
 */
function isLabelChannel(channelName) {
  if (!channelName) return false;
  const lower = channelName.toLowerCase();
  return LABEL_SUBSTRINGS.some((sub) => lower.includes(sub));
}

/**
 * Returns true if the candidate channel matches the artist name.
 * Lenient match — substring after normalizing both sides.
 */
function channelMatchesArtist(channelName, artistName) {
  const c = normalizeChannelName(channelName);
  const a = primaryArtist(artistName);
  if (!c || !a) return false;
  return c === a || c.includes(a) || a.includes(c);
}

/**
 * Returns true if the candidate is a "Topic" auto-generated audio channel.
 * These are YouTube Music's pristine studio rips and the gold standard.
 */
function isTopicChannel(channelName) {
  return /\s-\s*topic\s*$/i.test(String(channelName || ''));
}

/** "DrakeVEVO" / "DRAKEVEVO" / "Drake VEVO" all match. */
function isVevoChannel(channelName) {
  return /vevo\s*$/i.test(String(channelName || ''));
}

/** Bucket of words that disqualify regardless of tier. */
function hasHardReject(title) {
  return HARD_REJECT_TITLE_PATTERNS.some((re) => re.test(title));
}

/** Channel-level hard rejects (e.g. legacy "Topic" channels). */
function hasHardRejectChannel(channel) {
  return HARD_REJECT_CHANNEL_PATTERNS.some((re) => re.test(String(channel || '')));
}

/**
 * Check conditional rejects. A title with "Live" is only rejected if the
 * user's query did NOT also contain "live". (User searched for "Drake live"
 * → they want a live version; we shouldn't reject those.)
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
 * Score a candidate against the locked-down tier system. Returns an object
 * describing which tier it fits and a tiebreaker score (lower wins).
 *
 * STRICT TIER ORDER — only these patterns are ever accepted:
 *
 *   TIER 1   (best): Title contains BOTH artist name AND song name. Channel
 *                    matches the artist (substring). Duration matches within
 *                    ±5s. Tiebreaker: higher view count wins (favors the
 *                    main artist channel over auto-audio "topic" channels
 *                    which usually have fewer views).
 *
 *   TIER 1a  (next): All of Tier 1's requirements PLUS the title also
 *                    contains "Audio" / "Official Audio" / "Visualizer" /
 *                    "Official Visualizer". This is a super-set of Tier 1
 *                    so it would also match Tier 1 — but we score it
 *                    higher because the explicit "Audio" tag is the
 *                    strongest signal an upload is the canonical audio
 *                    version.
 *
 *   TIER 1b  (last resort within Tier 1): Music video. Title contains
 *                    "Music Video" / "Official Music Video" / "Official
 *                    Video" + artist name + song name + EXACT duration
 *                    match (±1s). Channel must match artist or label.
 *
 *   TIER 2   (fallback): Lyric video. Title contains BOTH artist name AND
 *                    song name AND "Lyrics" / "Lyric Video". Duration
 *                    within ±5s. Hard rejects already filtered "Clean
 *                    Lyrics", "First Half", snippets, etc.
 *
 *   NOTHING ELSE QUALIFIES. If no candidate matches any tier, the import
 *   fails — the user will need to manually search via the Find tab.
 *
 * View count is used ONLY as a tiebreaker within the same tier. Higher view
 * count wins (this favors the canonical main-channel upload over auto-audio
 * channels and re-uploads). Implemented by subtracting a small fraction of
 * log(view_count) from the score.
 *
 * Explicit-aware penalty: when the streaming service told us the song
 * SHOULD be explicit, candidates with duration more than 3s off the target
 * take a +5 score penalty. Clean radio edits typically cut verses with
 * profanity (5+ seconds shorter), so duration mismatch is a strong signal.
 */
function scoreCandidate(c, { artists, title, targetDurationSec, query, expectedExplicit }) {
  const candidateTitle = String(c.title || '');
  const candidateChannel = String(c.channel || c.uploader || '');
  const candidateDuration = Number(c.duration) || 0;
  const viewCount = Number(c.view_count) || 0;

  // ---- HARD REJECTS ----
  // Title-level: M/V, snippets, partials, previews, teasers, etc.
  if (hasHardReject(candidateTitle)) return { tier: null, reason: 'hard reject (title)' };
  // Channel-level: legacy "Topic" channels.
  if (hasHardRejectChannel(candidateChannel)) return { tier: null, reason: 'hard reject (channel: Topic)' };
  // Conditional: live, cover, karaoke, instrumental, sped-up, slowed, etc.
  // (only if those words aren't in the original query).
  if (hasConditionalReject(candidateTitle, `${artists} ${title}`)) {
    return { tier: null, reason: 'conditional reject (cover/karaoke/etc.)' };
  }

  const dur = candidateDuration;
  const target = targetDurationSec || 0;
  const durDiff = target > 0 ? Math.abs(dur - target) : 0;

  // Explicit-aware penalty applied to durDiff.
  const explicitPenalty = (expectedExplicit === true && target > 0 && durDiff > 3) ? 5 : 0;

  // View-count tiebreaker. Higher views = lower score (better). We use
  // log10 so the penalty difference between 1M and 10M views is the same
  // as 100K vs 1M — small bonus, used only to break ties within a tier.
  // Capped at -2 so view count can never override a real signal like
  // duration mismatch.
  const viewBonus = viewCount > 0 ? -Math.min(2, Math.log10(viewCount) / 4) : 0;
  const adjustedDiff = durDiff + explicitPenalty + viewBonus;

  // ---- Pre-compute signals ----
  const channelIsArtist = channelMatchesArtist(candidateChannel, artists);
  const channelIsLabel = isLabelChannel(candidateChannel);
  const hasOfficialAudioTitle = OFFICIAL_AUDIO_TITLE_PATTERNS.some((re) => re.test(candidateTitle));
  const hasStrictOfficialAudioTitle = STRICT_OFFICIAL_AUDIO_PATTERNS.some((re) => re.test(candidateTitle));
  const hasMusicVideoTitle = MUSIC_VIDEO_PATTERNS.some((re) => re.test(candidateTitle));
  const isLyricVideo = LYRIC_VIDEO_PATTERNS.some((re) => re.test(candidateTitle));
  const isCleanLyricVideo = LYRIC_CLEAN_REJECT_PATTERNS.some((re) => re.test(candidateTitle));
  const isExactDurationMatch = target > 0 && Math.abs(Math.round(dur) - Math.round(target)) <= 1;
  const isLooseDurationMatch = target > 0 && durDiff <= 5;

  // ---- Title-content checks ----
  // Normalize for matching: lowercase, alphanumerics only. "Drake" matches
  // "DRAKE", "drake & future" (substring), "Drake -" etc.
  const normalizeForMatch = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidateTitleNorm = normalizeForMatch(candidateTitle);
  const primaryArtistNorm = normalizeForMatch(primaryArtist(artists));
  const titleNorm = normalizeForMatch(title);
  const titleContainsArtist = primaryArtistNorm.length > 0 && candidateTitleNorm.includes(primaryArtistNorm);
  // Song name match: at least 70% of the song's normalized chars need to
  // appear consecutively. Loose check because subtitles like "(feat. X)"
  // may not be in the YouTube title even though the song is the same.
  const titleContainsSong = (() => {
    if (titleNorm.length === 0) return false;
    if (candidateTitleNorm.includes(titleNorm)) return true;
    // Fallback: check if at least 80% of the song's word characters appear
    // (handles cases like "What Did I Miss?" → "What Did I Miss" stripped).
    const songWords = titleNorm.length;
    let matched = 0;
    for (const ch of titleNorm) {
      if (candidateTitleNorm.includes(ch)) matched++;
    }
    return matched / songWords >= 0.8 && titleNorm.length >= 3;
  })();

  // ---- TIER 1: artist channel + artist name + song name in title ----
  // The "first result is usually right" case. Title MUST contain both
  // artist and song name (this is the strict rule that filters out the
  // renamed-Topic auto-audio channels which title their uploads with just
  // the song name). Channel must match artist. Duration ±5s.
  // View count is the tiebreaker — main channel uploads almost always
  // dominate auto-audio uploads in views, so this naturally selects the
  // canonical version.
  if (channelIsArtist && titleContainsArtist && titleContainsSong && isLooseDurationMatch) {
    return { tier: 1.0, score: adjustedDiff, sub: 'artist-channel+full-title' };
  }

  // ---- TIER 1a: artist+audio-title (refinement of Tier 1) ----
  // Same as Tier 1 but the title also has Audio/Visualizer marker. This
  // catches cases where the artist's main channel upload doesn't qualify
  // for Tier 1 (e.g. the channel name doesn't contain the artist exactly,
  // but a record label uploaded an "Official Audio" version with the
  // artist+song in the title).
  //
  // Two acceptance paths:
  //   1. STRICT marker — title contains "(Official Audio)" or
  //      "(Official Visualizer)" (with parens). Fan accounts essentially
  //      never use this exact format, so we accept the candidate from any
  //      channel (no label whitelist required). This is what lets uploads
  //      from labels like Fueled By Ramen / OVO Sound / Top Shelf / etc.
  //      qualify without us having to enumerate every label that exists.
  //   2. LOOSE marker — title contains plain "Audio" / "Visualizer" /
  //      "Official Audio" without strict formatting. Requires the channel
  //      to be on our label whitelist OR match the artist, because the
  //      loose form is more ambiguous and fan reuploads often use it.
  if (titleContainsArtist && titleContainsSong && isLooseDurationMatch) {
    if (hasStrictOfficialAudioTitle) {
      // Title alone is a strong-enough signal — channel can be anything
      // (still subject to the channel hard-rejects above).
      if (channelIsArtist) {
        return { tier: 1.1, score: adjustedDiff, sub: 'artist+strict-audio-title' };
      }
      return { tier: 1.1, score: adjustedDiff + 0.5, sub: 'any+strict-audio-title' };
    }
    if (hasOfficialAudioTitle) {
      if (channelIsArtist) {
        return { tier: 1.1, score: adjustedDiff, sub: 'artist+audio-title' };
      }
      if (channelIsLabel) {
        return { tier: 1.1, score: adjustedDiff + 1, sub: 'label+audio-title' };
      }
    }
  }

  // ---- TIER 1b: music video as last resort within Tier 1 ----
  // Title says Music Video / Official Music Video / Official Video AND
  // contains both artist and song name AND channel matches artist or label
  // AND duration matches EXACTLY (±1s). The exact-duration check is
  // critical — without it, fan compilations and edits would pass.
  if (hasMusicVideoTitle && titleContainsArtist && titleContainsSong && isExactDurationMatch) {
    if (channelIsArtist) {
      return { tier: 1.5, score: adjustedDiff, sub: 'artist+music-video' };
    }
    if (channelIsLabel) {
      return { tier: 1.5, score: adjustedDiff + 1, sub: 'label+music-video' };
    }
  }

  // ---- TIER 2: lyric video — must contain artist and song name ----
  // Title says Lyrics / Lyric Video AND contains both artist and song
  // name. NOT a Clean Lyrics / Clean Version upload (those are blocked).
  // Snippets / first half etc. are blocked at the hard-reject level above.
  // Duration ±5s.
  if (isLyricVideo && !isCleanLyricVideo && titleContainsArtist && titleContainsSong && isLooseDurationMatch) {
    return { tier: 2, score: adjustedDiff, sub: 'lyric-video' };
  }

  return { tier: null, reason: 'no tier match' };
}

/**
 * Search YouTube for candidates. Uses --flat-playlist mode for speed: instead
 * of yt-dlp doing a full info-extract on each video (which is slow because it
 * fetches the watch page for every result), we get a flat list with just the
 * fields we need — id, title, channel/uploader, duration. About 5-10x faster
 * than per-video extraction with no impact on scoring accuracy.
 *
 * Output is a single top-level JSON object with an `entries` array.
 */
function searchYoutubeCandidates(query, count, ytDlp) {
  return new Promise((resolve, reject) => {
    const args = [
      '--skip-download',
      '--flat-playlist',
      // -J emits a single JSON object for the whole search, much smaller than
      // per-line -j when in flat-playlist mode.
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
      // Flat-playlist mode uses different field names than per-video mode.
      // Normalize them so the scoring function (which reads c.title, c.channel,
      // c.duration, c.id) works without changes.
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

  // Sort by tier ascending (1 wins), then score ascending (closer to target
  // duration / better sub-source).
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
 * Download the best YouTube match for "Artist Title" using a tiered
 * selection. The signature matches the previous version of this function;
 * `targetDurationSec` is new and optional but strongly improves accuracy.
 *
 *   targetDurationSec — expected song length in seconds (from Spotify/iTunes).
 *                        Used for duration matching in Tier 3 and as a
 *                        tiebreaker within tiers.
 *
 * Returns an absolute path to the written .mp3.
 *
 * Throws if no candidate satisfies any tier — caller should handle the
 * failure (the renderer already does, marking the track as "failed" and
 * letting the user manually search via Find tab).
 */
export async function downloadYoutubeAudioForQuery({ artists, title, targetDurationSec = 0, expectedExplicit = null }, { onLog } = {}) {
  const { ytDlp, ffmpeg } = getToolPaths();
  if (!fs.existsSync(ytDlp)) {
    throw new Error('yt-dlp not found. Run: npm run setup:binaries');
  }

  const outDir = path.join(app.getPath('userData'), 'streaming-imports');
  fs.mkdirSync(outDir, { recursive: true });

  const baseQuery = `${artists} ${title}`.replace(/"/g, "'").trim();
  const explicitTag = expectedExplicit === true ? ' [explicit]' : (expectedExplicit === false ? ' [clean]' : '');
  onLog?.(`[ytdlp] parallel search for "${baseQuery}" (target duration: ${targetDurationSec || '?'}s)${explicitTag}\n`);

  // Three parallel searches, each looking for a different signal:
  //   - Plain query: catches the artist's own channel uploads (Tier 1a)
  //   - Audio variant: surfaces "Official Audio" / "Visualizer" uploads (Tier 1b)
  //   - Music Video variant: surfaces "Official Music Video" uploads (Tier 1c)
  // Lyric video matches show up in any of these searches because YouTube's
  // ranking surfaces lyric videos broadly.
  //
  // Each search fetches 8 candidates so the combined pool is ~24 (after
  // dedupe by video ID, usually ~15-18 unique). Running them in parallel
  // keeps total latency at ~2s — the slowest single search — instead of
  // ~6s sequentially.
  const queries = [
    baseQuery,
    `${baseQuery} Official Audio`,
    `${baseQuery} Official Music Video`,
  ];
  let allCandidates;
  try {
    const results = await Promise.all(
      queries.map((q) => searchYoutubeCandidates(q, 8, ytDlp).catch(() => []))
    );
    // Flatten and dedupe by video ID — multiple queries often surface the
    // same video.
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

  const winner = pickBestCandidate(allCandidates, { artists, title, targetDurationSec, query: baseQuery, expectedExplicit });
  if (!winner) {
    // Throw a structured error containing the top candidates. The IPC
    // handler in main.js detects this and returns them to the renderer
    // so the user can pick one manually via the candidate-picker modal.
    // Sort by view count so the most-watched options surface first —
    // that's almost always what the user wants when manually picking.
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
 * Used by the manual-pick flow: when an automatic import fails and the user
 * picks a candidate from the modal, we call this with the video ID.
 *
 * Returns an absolute path to the written .mp3 file.
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
 * Search-only path: runs the same parallel multi-query search as
 * downloadYoutubeAudioForQuery but returns the candidates directly,
 * without tier scoring or download. Used by the "always show picker"
 * setting in Settings — when on, every import surfaces the picker first
 * instead of relying on the tier matcher.
 *
 * Returns up to 12 candidates, sorted by view count descending (highest
 * first — usually what the user wants when manually picking).
 */
export async function searchCandidatesForPicker({ artists, title, customQuery }, { onLog } = {}) {
  const { ytDlp } = getToolPaths();
  if (!fs.existsSync(ytDlp)) {
    throw new Error('yt-dlp not found. Run: npm run setup:binaries');
  }
  // When the user has refined their search via the picker's search box,
  // we use their text verbatim and DON'T append the "Official Audio" /
  // "Official Music Video" variants — they already know what they want.
  // Otherwise (default flow), use the standard artist+title and run the
  // three-variant parallel search to cast a wider net.
  const cleanCustom = String(customQuery || '').trim();
  const useCustom = cleanCustom.length > 0;
  const baseQuery = useCustom
    ? cleanCustom.replace(/"/g, "'")
    : `${artists} ${title}`.replace(/"/g, "'").trim();
  // Always-on log so we can verify in the terminal whether the custom path
  // is actually being taken (was getting confused with stale main.js builds).
  console.log(`[ytdlp picker] useCustom=${useCustom} query="${baseQuery}" (artists="${artists}", title="${title}", customQuery="${customQuery}")`);
  onLog?.(`[ytdlp] picker-mode search for "${baseQuery}"${useCustom ? ' (custom, no rejects, 24 results)' : ''}\n`);

  // For custom queries, do ONE search with 16 results (more breadth on a
  // single query). For default queries, do the three-variant parallel search.
  const queries = useCustom
    ? [baseQuery]
    : [
        baseQuery,
        `${baseQuery} Official Audio`,
        `${baseQuery} Official Music Video`,
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
  // Filter out hard-rejects (snippets, partials, M/V, Topic channels) so
  // the picker doesn't surface obvious junk in the default flow.
  // EXCEPTION 1: when the user typed a custom query in the refine-search
  // box, skip ALL hard-rejects. They asked for it — they get whatever
  // YouTube returns. Search is more useful when it doesn't second-guess
  // the user.
  // EXCEPTION 2: if the strict filter empties the result set (which
  // happens for less popular tracks where only Topic channels host the
  // song), fall back to the unfiltered list. "Better something than
  // nothing" — the user can decide what's worth picking. We still drop
  // title-level rejects (snippets/partials) since those are almost
  // certainly junk regardless.
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
      // Lenient fallback — only drop title-level rejects (snippets, partials).
      // Allow Topic channels through.
      filtered = allCandidates.filter((c) => !hasHardReject(String(c.title || '')));
      console.log(`[ytdlp picker] strict filter emptied results, falling back to lenient (allowing Topic channels)`);
    }
  }
  filtered.sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0));
  // Custom queries return more results (24 vs 12). The default flow only
  // surfaces 12 because that's already enough when the tier matcher failed —
  // scrolling further almost never helps. Refined searches benefit from
  // the wider net since the user might be hunting something specific.
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
