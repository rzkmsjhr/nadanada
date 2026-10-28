import { api } from './api.js';

const STORAGE_KEY = 'nadanada-hifi-cache-v6';
const LEGACY_STORAGE_KEYS = ['nadanada-hifi-cache', 'nadanada-hifi-cache-v2', 'nadanada-hifi-cache-v3', 'nadanada-hifi-cache-v4', 'nadanada-hifi-cache-v5'];
const MAX_CACHE_ENTRIES = 3000;
export const HIFI_MATCHER_VERSION = 6;

export const WORKER_FLAC_URL = 'https://nadanada-yt.kdmp.workers.dev/flac';
export const TRACKS_BASE_URL = 'https://tracks.monochrome.st';

/**
 * Normalizes any FLAC stream URL to route via the Cloudflare Worker proxy
 * with proper audio/flac MIME type, CORS, and Range headers.
 * Extracts the exact stream target ID (recording_id if present in url, or trackId).
 */
export function normalizeFlacStreamUrl(url, trackId) {
  if (!url && !trackId) return null;
  if (typeof url === 'string' && url.startsWith(WORKER_FLAC_URL) && url.endsWith('.flac')) {
    return url;
  }
  let targetId = null;
  if (typeof url === 'string') {
    const match = url.match(/\/flac\/([a-zA-Z0-9_-]+)(?:\.flac)?/i) || url.match(/\/track\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      targetId = match[1];
    }
  }
  if (!targetId && trackId) {
    targetId = trackId;
  }
  if (targetId) {
    return `${WORKER_FLAC_URL}/${targetId}.flac`;
  }
  return url;
}

/**
 * Known upstream streaming catalog IDs where the original recording was overwritten
 * by the distributor with a modern remake/re-recorded version featuring different vocalists.
 */
export const KNOWN_UPSTREAM_MISMATCHES = new Set([
  '168395054749057024', // Dewa 19 - Aku Milikmu (upstream audio is 2021 Virzha single instead of 1994 Ari Lasso master)
  '168589766881927168', // Dewa 19 feat. Virzha - Aku Milikmu (2021 Virzha remake)
  '168395069831774208', // Dewa 19 - Tak Kan Ada Cinta Yang Lain (upstream audio is 2021 Ello remake)
  '168395062953115648'  // Dewa 19 - Mahameru (upstream audio is 2021 Virzha remake)
]);

/**
 * Checks whether the user has explicitly requested to keep this specific song on YouTube audio.
 */
export function isUserYoutubeForced(songId) {
  if (!songId || typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem('nadanada-user-youtube-overrides');
    if (!raw) return false;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.includes(String(songId));
  } catch {
    return false;
  }
}

/**
 * Records or clears the user's manual preference to force YouTube audio for a song.
 */
export function setUserYoutubeForced(songId, forced) {
  if (!songId || typeof localStorage === 'undefined') return;
  try {
    const idStr = String(songId);
    let list = [];
    const raw = localStorage.getItem('nadanada-user-youtube-overrides');
    if (raw) list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
    if (forced) {
      if (!list.includes(idStr)) list.push(idStr);
    } else {
      list = list.filter(id => id !== idStr);
    }
    localStorage.setItem('nadanada-user-youtube-overrides', JSON.stringify(list));
  } catch (e) {
    console.warn('[HIFI] Failed to persist user youtube override:', e);
  }
}

/**
 * Video keywords that explicitly indicate a music video, performance, or video upload.
 */
export const VIDEO_TITLE_KEYWORDS = [
  'official music video',
  'official video',
  'music video',
  'official audio video',
  'lyric video',
  'lyrics video',
  'visualizer',
  'official visualizer',
  'performance video',
  'live performance',
  'dance practice',
  'live at',
  'live in',
  'live from',
  'live concert',
  'full concert',
  'trailer',
  'teaser',
  '[mv]',
  '(mv)',
  '[m/v]',
  '(m/v)',
  '[official video]',
  '(official video)',
  '[official music video]',
  '(official music video)',
  '(video)',
  '[video]'
];

/**
 * Checks whether a track is eligible for Hi-Fi / lossless FLAC resolution.
 * Per requirement: Hi-Fi version MUST only be searched and attached for "songs" and "- topic" channels.
 * If the track is a video (or item_type is 'video' / regular YouTube video), it should NOT be overridden
 * with Hi-Fi audio; the original YouTube video must be shown.
 */
export function isHifiEligibleTrack(song) {
  if (!song) return false;
  // Local offline files are played locally
  if (song.is_local || song.file_path) return false;

  // Native Monochrome tracks are audio releases
  if (song.source === 'monochrome' || song.is_monochrome) return true;

  const itemType = (song.item_type || '').toLowerCase().trim();
  const channel = (song.channel || '').toLowerCase().trim();
  const title = (song.title || '').toLowerCase().trim();

  // Explicit video item type is never Hi-Fi eligible
  if (itemType === 'video') return false;

  // VEVO channels host official music videos, never static album tracks
  if (channel.includes('vevo')) return false;

  // Video titles containing MV / music video markers must stay as video
  if (VIDEO_TITLE_KEYWORDS.some(k => title.includes(k))) return false;
  if (/\b(mv|m\/v)\b/i.test(title)) return false;

  // 1. YouTube Topic channels are auto-generated audio releases
  if (channel.endsWith('- topic') || channel === 'topic') return true;

  // 2. Explicit "song" items from YouTube Music (that passed video checks above)
  if (itemType === 'song') return true;

  // All other YouTube videos, uploads, or non-song/non-topic items are NOT Hi-Fi eligible
  return false;
}

/**
 * Words inside brackets/parentheses that represent musical editions or versions and MUST BE PRESERVED.
 */
export const PRESERVED_VERSION_REGEX = /\b(acoustic|live|unplugged|remix|mix|instrumental|karaoke|orchestral|piano|demo|session|cover|re-recorded|rerecorded|radio\s+edit|extended|slowed|sped\s+up|clean|explicit|version|edit|deluxe|bonus|anniversary)\b/i;

/**
 * Pure YouTube promotional noise words to strip when found in brackets or standalone.
 */
export const YOUTUBE_NOISE_REGEX = /\b(official\s*(?:music\s*)?video|official\s*audio|official\s*visualizer|lyrics?\s*(?:video)?|music\s*video|audio|visualizer|hd|hq|4k|1080p|720p|topic|clip\s*officiel|video\s*oficial|mv)\b/gi;

/**
 * Loads persistent cache from localStorage across app restarts.
 */
// In-memory session tracking for unmatched songs to prevent duplicate API queries
// without permanently blacklisting songs in persistent localStorage
export const sessionUnmatchedSet = new Set();

function loadPersistentCache() {
  const map = new Map();
  try {
    if (typeof localStorage !== 'undefined') {
      for (const oldKey of LEGACY_STORAGE_KEYS) {
        if (localStorage.getItem(oldKey)) {
          localStorage.removeItem(oldKey);
        }
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        let cleaned = false;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (Array.isArray(item) && item.length === 2) {
              const val = item[1];
              if (val && typeof val === 'object' && val.stream_url) {
                const normUrl = normalizeFlacStreamUrl(val.stream_url, val.hifi_id);
                if (normUrl !== val.stream_url) {
                  val.stream_url = normUrl;
                  cleaned = true;
                }
                map.set(item[0], val);
              } else {
                cleaned = true;
              }
            }
          }
        } else if (typeof parsed === 'object' && parsed !== null) {
          for (const [k, v] of Object.entries(parsed)) {
            if (v && typeof v === 'object' && v.stream_url) {
              const normUrl = normalizeFlacStreamUrl(v.stream_url, v.hifi_id);
              if (normUrl !== v.stream_url) {
                v.stream_url = normUrl;
                cleaned = true;
              }
              map.set(k, v);
            } else {
              cleaned = true;
            }
          }
        }
        if (cleaned) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(map.entries())));
        }
      }
    }
  } catch (e) {
    console.warn('[HIFI] Failed to parse persistent cache from localStorage:', e);
  }
  return map;
}

// Persistent cache across app closures & restarts
export const hifiCache = loadPersistentCache();

let saveTimeout = null;
function persistCacheDebounced() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      let entries = Array.from(hifiCache.entries());
      if (entries.length > MAX_CACHE_ENTRIES) {
        entries = entries.slice(entries.length - MAX_CACHE_ENTRIES);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn('[HIFI] Failed to persist cache to localStorage:', e);
    }
  }, 350);
}

let monochromeRateLimitedUntil = 0;

export function reportMonochromeRateLimit(cooldownMs = 60000) {
  monochromeRateLimitedUntil = Math.max(monochromeRateLimitedUntil, Date.now() + cooldownMs);
  console.warn(`[HIFI] Monochrome API rate-limit detected. Backing off for ${Math.round(cooldownMs / 1000)}s.`);
}

export function isMonochromeCoolingDown() {
  return Date.now() < monochromeRateLimitedUntil;
}

/**
 * Records transient Hi-Fi stream failure without destroying persistent cache
 * or blacklisting valid tracks from future playback attempts.
 */
export function markHifiFailed(song) {
  if (!song) return;
  // Transient failure is tracked per-playback instance via _hifiFailed.
  // Preserving hifiCache ensures that the song remains recoverable when the network recovers.
}

/**
 * Cleans YouTube noise from song titles while strictly preserving musical version qualifiers
 * like (Acoustic Version), (Live), (Remix), etc.
 */
export function cleanSongTitle(rawTitle, rawArtist) {
  let title = rawTitle || '';

  // Process all bracketed [ ... ] and parenthesized ( ... ) segments
  title = title.replace(/(\[.*?\]|\(.*?\))/g, (match) => {
    // If segment contains a musical version indicator (like "Acoustic", "Live", "Remix"), preserve it!
    if (PRESERVED_VERSION_REGEX.test(match)) {
      const cleaned = match
        .replace(YOUTUBE_NOISE_REGEX, '')
        .replace(/[\s\-_–—|:]+/g, ' ')
        .trim();
      if (cleaned.length > 2) {
        return cleaned.startsWith('(') || cleaned.startsWith('[') ? cleaned : `(${cleaned})`;
      }
    }
    // If it was purely promotional noise (e.g. [Official Music Video], (Lyrics)), strip it completely
    return ' ';
  });

  // Remove standalone promotional noise outside of brackets
  title = title
    .replace(YOUTUBE_NOISE_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let artist = (rawArtist || '').replace(/\s*-\s*Topic$/i, '').trim();

  // If the title starts with the artist name followed by a separator (e.g. "WIM - Supernova"), strip it
  if (artist) {
    const escapedArtist = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixRegex = new RegExp(`^${escapedArtist}\\s*[\\-–—:]\\s*`, 'i');
    if (prefixRegex.test(title)) {
      title = title.replace(prefixRegex, '').trim();
    }
  }
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length === 2 && !PRESERVED_VERSION_REGEX.test(parts[1])) {
      if (!artist || parts[0].toLowerCase().includes(artist.toLowerCase())) {
        artist = parts[0].trim();
        title = parts[1].trim();
      }
    }
  }

  return { title, artist };
}

/**
 * Normalizes an artist string for strict comparison.
 */
function normalizeArtistName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\bvevo$/i, '')
    .replace(/\bofficial(?:\s+channel|\s+music|\s+artist)?$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a raw artist/channel string into normalized individual artist names.
 */
function splitArtistList(str) {
  if (!str) return [];
  const cleaned = (str || '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\bvevo$/i, '');
  const parts = cleaned
    .split(/[,&/;]|(?:\s+(?:feat\.?|ft\.?|featuring|with|x|and)\s+)/i)
    .map(normalizeArtistName)
    .filter(Boolean);
  const full = normalizeArtistName(cleaned);
  if (full && !parts.includes(full)) {
    parts.push(full);
  }
  return parts;
}

/**
 * Strictly checks whether a Monochrome candidate's artist matches the target song's artist.
 * Prevents matching a song with the same title by a different artist (e.g. "Wice - Supernova" vs "WIM - Supernova").
 * Also rejects unrequested featured artists / collaborators (e.g. candidate has "Virzha" when original is solo Dewa 19).
 */
export function doesArtistMatch(targetArtist, candidateArtist, fallbackChannel = '', targetTitle = '', options = {}) {
  const { ignoreCollaboratorCheck = false } = options;
  const targetList = [
    ...splitArtistList(targetArtist),
    ...splitArtistList(fallbackChannel)
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const candList = splitArtistList(candidateArtist);

  if (targetList.length === 0 || candList.length === 0) return false;

  let hasPrimaryMatch = false;
  for (const t of targetList) {
    const tCompact = t.replace(/\s+/g, '');
    const tNoThe = t.replace(/^the\s+/, '').trim();

    for (const c of candList) {
      if (t === c) { hasPrimaryMatch = true; break; }

      const cCompact = c.replace(/\s+/g, '');
      if (tCompact.length >= 2 && tCompact === cCompact) { hasPrimaryMatch = true; break; }

      const cNoThe = c.replace(/^the\s+/, '').trim();
      if (tNoThe.length >= 3 && tNoThe === cNoThe) { hasPrimaryMatch = true; break; }
    }
    if (hasPrimaryMatch) break;
  }

  if (!hasPrimaryMatch) return false;

  if (ignoreCollaboratorCheck) return true;

  // Protect against unrequested featured artists / collaborators:
  // If candidate lists extra distinct artists that are NOT anywhere in target artist, channel, or title,
  // it indicates a remake, duet, or remix by a different vocalist (e.g. Dewa 19 feat. Virzha)
  const normTitle = normalizeArtistName(targetTitle || '');
  const combinedTargetText = `${targetList.join(' ')} ${normalizeArtistName(fallbackChannel || '')} ${normTitle}`.toLowerCase();

  const rawCandParts = (candidateArtist || '')
    .split(/[,&/;]|(?:\s+(?:feat\.?|ft\.?|featuring|with|x|and)\s+)/i)
    .map(normalizeArtistName)
    .filter(Boolean);

  for (const part of rawCandParts) {
    if (part.length < 3) continue;
    const isKnownInTarget = targetList.some(t => t === part || t.includes(part) || part.includes(t)) || combinedTargetText.includes(part);
    if (!isKnownInTarget) {
      return false;
    }
  }

  return true;
}

/**
 * Normalizes a song title for comparison after version flags have already been validated.
 * Strips benign remaster/edition/featuring parentheticals while keeping distinct subtitle parentheticals.
 */
function normalizeComparableTitle(rawTitle) {
  let s = (rawTitle || '')
    .replace(/(\[.*?\]|\(.*?\))/g, (match) => {
      if (
        PRESERVED_VERSION_REGEX.test(match) ||
        YOUTUBE_NOISE_REGEX.test(match) ||
        /\b(feat\.?|ft\.?|featuring|with|remaster(?:ed)?|album\s+version|single\s+version|original\s+version|explicit|clean)\b/i.test(match)
      ) {
        return ' ';
      }
      return match;
    })
    .replace(/\s+[-–—]\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|acoustic|live|unplugged|remix|instrumental|karaoke|piano|orchestral|radio\s+edit|album\s+version|single\s+version|explicit|clean).*$/i, ' ')
    .replace(/\b(?:feat\.?|ft\.?|featuring)\s+.*$/i, ' ');

  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Helper to parse various duration formats into seconds.
 */
export function parseDurationToSecs(dur) {
  if (!dur) return 0;
  if (typeof dur === 'number') return dur > 1000 ? Math.round(dur / 1000) : Math.round(dur);
  const parts = String(dur).split(':').map(Number);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  return 0;
}

/**
 * Extracts musical edition flags to enforce version integrity.
 */
export function extractVersionFlags(str) {
  const s = (str || '').toLowerCase();
  return {
    isAcoustic: /\bacoustic\b/i.test(s),
    isLive: /\blive\b/i.test(s),
    isRemix: /\b(?:remix|mix)\b/i.test(s),
    isInstrumental: /\b(?:instrumental|karaoke)\b/i.test(s),
    isPiano: /\bpiano\b/i.test(s),
    isOrchestral: /\borchestral\b/i.test(s),
  };
}

/**
 * Checks whether two tracks have conflicting musical edition flags.
 * E.g. target is acoustic but candidate is full band, or candidate is live but target is studio.
 */
export function hasVersionConflict(flagsA, flagsB) {
  if (flagsA.isAcoustic !== flagsB.isAcoustic) return true;
  if (flagsA.isLive !== flagsB.isLive) return true;
  if (flagsA.isRemix !== flagsB.isRemix) return true;
  if (flagsA.isInstrumental !== flagsB.isInstrumental) return true;
  if (flagsA.isPiano !== flagsB.isPiano) return true;
  if (flagsA.isOrchestral !== flagsB.isOrchestral) return true;
  return false;
}

/**
 * Checks whether a track is a known upstream mismatch where digital distributors
 * replaced the original master with a modern remake/re-recorded version.
 */
export function isKnownUpstreamMismatch(song) {
  if (!song) return false;
  if (song.hifi_id && KNOWN_UPSTREAM_MISMATCHES.has(String(song.hifi_id))) return true;
  const t = (song.title || '').toLowerCase();
  const a = (song.channel || song.artist || '').toLowerCase();
  if (a.includes('dewa') && (t.includes('aku milikmu') || t.includes('tak kan ada cinta') || t.includes('mahameru'))) {
    if (!t.includes('virzha') && !t.includes('ello') && !t.includes('2021') && !t.includes('remake')) {
      return true;
    }
  }
  return false;
}

/**
 * Validates whether any track from Monochrome matches the target song.
 * Enforces strict musical edition flags and duration thresholds.
 */
export function matchTrack(song, results, options = {}) {
  const { ignoreBlacklist = false } = options;
  if (!results || results.length === 0) return null;
  const { title: cleanTitle, artist: cleanArtist } = cleanSongTitle(song.title, song.channel);
  const normTarget = normalizeComparableTitle(cleanTitle);
  if (!normTarget) return null;

  const targetFlags = extractVersionFlags(song.title);
  const songSecs = parseDurationToSecs(song.duration);

  // Strictly filter out any candidates with mismatched artist, version descriptors, or known corruptions
  const candidates = results.filter(t => {
    if (!doesArtistMatch(cleanArtist, t.channel, song.channel, song.title, { ignoreCollaboratorCheck: ignoreBlacklist })) return false;
    const candFlags = extractVersionFlags(t.title);
    if (hasVersionConflict(targetFlags, candFlags)) return false;

    // Reject known upstream catalog tracks that substituted modern remakes
    if (!ignoreBlacklist && t.id && KNOWN_UPSTREAM_MISMATCHES.has(String(t.id))) {
      const normTargetText = `${cleanTitle} ${cleanArtist} ${song.channel || ''}`.toLowerCase();
      if (!normTargetText.includes('virzha') && !normTargetText.includes('ello') && !normTargetText.includes('2021') && !normTargetText.includes('remake')) {
        return false;
      }
    }

    return true;
  });

  if (candidates.length === 0) return null;

  // 1. Strict match: exact normalized title match + duration within 15s (if durations known)
  for (const t of candidates) {
    const resTitle = normalizeComparableTitle(t.title);
    const resSecs = parseDurationToSecs(t.duration);

    const titleMatch = resTitle === normTarget;
    let durMatch = true;
    if (songSecs > 0 && resSecs > 0) {
      durMatch = Math.abs(songSecs - resSecs) <= 15;
    }

    if (titleMatch && durMatch) {
      return t;
    }
  }

  // 2. High-confidence normalized title match with duration boundary <= 25s
  for (const t of candidates) {
    const resTitle = normalizeComparableTitle(t.title);
    const resSecs = parseDurationToSecs(t.duration);

    if (resTitle === normTarget) {
      if (songSecs > 0 && resSecs > 0 && Math.abs(songSecs - resSecs) > 25) {
        continue;
      }
      return t;
    }
  }

  return null;
}

/**
 * Retrieves and validates a cached Hi-Fi entry for a song.
 * Validates that the cached item matches artist, version edition flags, and duration.
 * If invalid or mismatched, safely purges the entry and returns null.
 */
export function getCachedHifi(song) {
  if (!song || !isHifiEligibleTrack(song)) return null;
  if (song._hifiFailed || song._userForcedYoutube) return null;
  if (song.id && (isUserYoutubeForced(song.id) || sessionUnmatchedSet.has(String(song.id)) || sessionUnmatchedSet.has(`id:${song.id}`))) return null;
  const idKey = song.id ? String(song.id) : null;
  const { title, artist } = cleanSongTitle(song.title, song.channel);
  const textKey = title && artist ? `${artist.toLowerCase()}:::${title.toLowerCase()}` : null;
  if (textKey && (sessionUnmatchedSet.has(textKey) || sessionUnmatchedSet.has(`text:${textKey}`))) return null;

  let cached = (idKey && hifiCache.get(idKey)) || (textKey && hifiCache.get(textKey)) || null;
  if (!cached || !cached.stream_url) return null;

  // Reject known upstream catalog tracks that substituted modern remakes
  if (cached.hifi_id && KNOWN_UPSTREAM_MISMATCHES.has(String(cached.hifi_id))) {
    const normTargetText = `${title} ${artist} ${song.channel || ''}`.toLowerCase();
    if (!normTargetText.includes('virzha') && !normTargetText.includes('ello') && !normTargetText.includes('2021') && !normTargetText.includes('remake')) {
      if (idKey) hifiCache.delete(idKey);
      if (textKey) hifiCache.delete(textKey);
      persistCacheDebounced();
      return null;
    }
  }

  // Validate artist match (purge any legacy entry missing artist or with mismatched artist)
  if (!cached.artist || !doesArtistMatch(artist, cached.artist, song.channel, song.title)) {
    if (idKey) hifiCache.delete(idKey);
    if (textKey) hifiCache.delete(textKey);
    persistCacheDebounced();
    return null;
  }

  // Validate version flags
  const targetFlags = extractVersionFlags(song.title);
  if (cached.title) {
    const cachedFlags = extractVersionFlags(cached.title);
    if (hasVersionConflict(targetFlags, cachedFlags)) {
      if (idKey) hifiCache.delete(idKey);
      if (textKey) hifiCache.delete(textKey);
      persistCacheDebounced();
      return null;
    }
  }

  // Validate duration
  const songSecs = parseDurationToSecs(song.duration);
  if (songSecs > 0 && cached.duration > 0) {
    if (Math.abs(songSecs - cached.duration) > 20) {
      if (idKey) hifiCache.delete(idKey);
      if (textKey) hifiCache.delete(textKey);
      persistCacheDebounced();
      return null;
    }
  }

  return {
    ...cached,
    stream_url: normalizeFlacStreamUrl(cached.stream_url, cached.hifi_id)
  };
}

/**
 * Sanitizes a track loaded from persistent storage or saved playlists.
 * If the track has an unverified or legacy Hi-Fi stream_url (matcher version !== HIFI_MATCHER_VERSION),
 * strips the stream_url so that it is cleanly re-verified by strict matcher v3 before playback.
 */
export function sanitizeLegacyHifiTrack(s) {
  if (!s || typeof s !== 'object') return s;
  // Local/downloaded files are always preserved
  if (s.is_local || s.file_path) return s;

  // If track failed Hi-Fi or was marked unmatched this session, ensure it stays as clean YouTube
  if (s._hifiFailed || (s.id && (sessionUnmatchedSet.has(String(s.id)) || sessionUnmatchedSet.has(`id:${s.id}`))) || (s.hifi_id && sessionUnmatchedSet.has(String(s.hifi_id)))) {
    return {
      ...s,
      stream_url: null,
      blob_url: null,
      source: null,
      hifi_id: null,
      _hifiChecked: true,
      _hifiVersion: HIFI_MATCHER_VERSION,
      _hifiFailed: true
    };
  }

  // If the track is not eligible for Hi-Fi (e.g. video), strip any stream_url and mark checked
  if (!isHifiEligibleTrack(s)) {
    if (s.stream_url || s.source === 'monochrome' || s.hifi_id || !s._hifiChecked || s._hifiVersion !== HIFI_MATCHER_VERSION) {
      return {
        ...s,
        stream_url: null,
        source: null,
        hifi_id: null,
        _hifiChecked: true,
        _hifiVersion: HIFI_MATCHER_VERSION
      };
    }
    return s;
  }
  // If user explicitly forced YouTube for this song, keep it as YouTube
  if (s.id && isUserYoutubeForced(s.id)) {
    return {
      ...s,
      stream_url: null,
      source: null,
      hifi_id: null,
      _hifiChecked: true,
      _hifiVersion: HIFI_MATCHER_VERSION,
      _userForcedYoutube: true
    };
  }
  // If track has known upstream mismatched remake ID
  if (s.hifi_id && KNOWN_UPSTREAM_MISMATCHES.has(String(s.hifi_id))) {
    const norm = `${s.title || ''} ${s.channel || ''}`.toLowerCase();
    if (!norm.includes('virzha') && !norm.includes('ello') && !norm.includes('2021') && !norm.includes('remake')) {
      return {
        ...s,
        stream_url: null,
        source: null,
        hifi_id: null,
        _hifiChecked: false,
        _hifiVersion: undefined
      };
    }
  }
  // If track has a stream_url, normalize it to direct Monochrome URL
  if (s.stream_url && typeof s.stream_url === 'string') {
    const normUrl = normalizeFlacStreamUrl(s.stream_url, s.hifi_id || s.id);
    if (normUrl !== s.stream_url) {
      s = {
        ...s,
        stream_url: normUrl
      };
    }
  }

  // Native Monochrome tracks (where id === hifi_id or searched directly from Monochrome) are preserved
  if (s.source === 'monochrome' && (!s.hifi_id || String(s.hifi_id) === String(s.id))) {
    return s;
  }
  // If track hasn't been verified with current matcher version
  if (s._hifiVersion !== HIFI_MATCHER_VERSION) {
    if (s.stream_url) {
      return {
        ...s,
        stream_url: null,
        source: null,
        hifi_id: null,
        _hifiChecked: false,
        _hifiVersion: undefined
      };
    }
    if (s._hifiChecked) {
      return {
        ...s,
        _hifiChecked: false,
        _hifiVersion: undefined
      };
    }
  }
  return s;
}

const inFlightPromises = new Map();

/**
 * Resolves a single track to its Hi-Fi counterpart if available.
 * Checks both song.id and canonical artist:::title in persistent cache with validation,
 * and deduplicates concurrent in-flight lookups for the same song.
 */
export async function resolveHifiForTrack(song, options = {}) {
  const { ignoreBlacklist = false, ignoreUserYoutubeForced = false } = options;
  if (!song || song.is_local || song.file_path) return null;
  if (!isHifiEligibleTrack(song)) return null;
  if (!ignoreUserYoutubeForced && ((song.id && isUserYoutubeForced(song.id)) || song._userForcedYoutube)) return null;
  if (!ignoreBlacklist && song.hifi_id && KNOWN_UPSTREAM_MISMATCHES.has(String(song.hifi_id))) {
    const norm = `${song.title || ''} ${song.channel || ''}`.toLowerCase();
    if (!norm.includes('virzha') && !norm.includes('ello') && !norm.includes('2021') && !norm.includes('remake')) {
      return null;
    }
  }
  // Only trust pre-attached stream_url if it is a native Monochrome search item (id === hifi_id or no hifi_id)
  // OR if it was already verified with HIFI_MATCHER_VERSION
  if (
    song.source === 'monochrome' &&
    song.stream_url &&
    (!song.hifi_id || String(song.hifi_id) === String(song.id) || song._hifiVersion === HIFI_MATCHER_VERSION)
  ) {
    return {
      stream_url: normalizeFlacStreamUrl(song.stream_url, song.hifi_id || song.id),
      source: 'monochrome',
      hifi_id: song.hifi_id || song.id,
      title: song.title,
      artist: song.channel,
      duration: parseDurationToSecs(song.duration),
      _hifiVersion: HIFI_MATCHER_VERSION
    };
  }

  const { title, artist } = cleanSongTitle(song.title, song.channel);
  const textKey = title && artist ? `${artist.toLowerCase()}:::${title.toLowerCase()}` : null;
  const idKey = song.id ? String(song.id) : null;
  const targetFlags = extractVersionFlags(song.title);
  const songSecs = parseDurationToSecs(song.duration);

  const isValidCached = (entry) => {
    if (!entry || !entry.stream_url) return false;
    if (!ignoreUserYoutubeForced && song.id && isUserYoutubeForced(song.id)) return false;
    if (!ignoreBlacklist && entry.hifi_id && KNOWN_UPSTREAM_MISMATCHES.has(String(entry.hifi_id))) {
      const normTargetText = `${title} ${artist} ${song.channel || ''}`.toLowerCase();
      if (!normTargetText.includes('virzha') && !normTargetText.includes('ello') && !normTargetText.includes('2021') && !normTargetText.includes('remake')) {
        return false;
      }
    }
    if (!entry.artist || !doesArtistMatch(artist, entry.artist, song.channel, song.title, { ignoreCollaboratorCheck: ignoreBlacklist })) return false;
    if (entry.title) {
      const cachedFlags = extractVersionFlags(entry.title);
      if (hasVersionConflict(targetFlags, cachedFlags)) return false;
    }
    if (songSecs > 0 && entry.duration > 0) {
      if (Math.abs(songSecs - entry.duration) > 20) return false;
    }
    return true;
  };

  if (!ignoreBlacklist) {
    if (idKey && sessionUnmatchedSet.has(idKey)) return null;
    if (textKey && sessionUnmatchedSet.has(textKey)) return null;
  }

  // Check persistent cache with artist, version & duration validation
  if (!ignoreBlacklist && idKey && hifiCache.has(idKey)) {
    const cached = hifiCache.get(idKey);
    if (cached && isValidCached(cached)) {
      const normUrl = normalizeFlacStreamUrl(cached.stream_url, cached.hifi_id);
      console.log(`[HIFI] Cache HIT for "${song.title}" (${cached.artist}) -> ${normUrl}`);
      return {
        ...cached,
        stream_url: normUrl
      };
    } else {
      hifiCache.delete(idKey);
    }
  }
  if (!ignoreBlacklist && textKey && hifiCache.has(textKey)) {
    const cached = hifiCache.get(textKey);
    if (cached && isValidCached(cached)) {
      const normUrl = normalizeFlacStreamUrl(cached.stream_url, cached.hifi_id);
      console.log(`[HIFI] Cache HIT for "${song.title}" (${cached.artist}) -> ${normUrl}`);
      if (idKey) hifiCache.set(idKey, cached);
      return {
        ...cached,
        stream_url: normUrl
      };
    } else {
      hifiCache.delete(textKey);
    }
  }

  if (!title) {
    if (!ignoreBlacklist) {
      if (idKey) sessionUnmatchedSet.add(idKey);
      if (textKey) sessionUnmatchedSet.add(textKey);
    }
    return null;
  }

  const dedupeKey = (!ignoreBlacklist && (idKey || textKey)) || null;
  if (dedupeKey && inFlightPromises.has(dedupeKey)) {
    return inFlightPromises.get(dedupeKey);
  }

  const promise = (async () => {
    if (!ignoreBlacklist && isMonochromeCoolingDown()) {
      const remainingSecs = Math.max(1, Math.round((monochromeRateLimitedUntil - Date.now()) / 1000));
      console.warn(`[HIFI] Monochrome API cooling down (${remainingSecs}s remaining). Skipping search for "${song.title}". Using YouTube.`);
      return null;
    }
    const query = `${artist} ${title}`.trim();
    try {
      console.log(`[HIFI] Searching Monochrome catalog for: "${query}" (target: "${song.title}" by ${artist})...`);
      const results = await api.searchMonochrome(query, 'song');
      const matched = matchTrack(song, results, { ignoreBlacklist });
      if (matched && matched.stream_url) {
        const streamUrl = normalizeFlacStreamUrl(matched.stream_url, matched.id);
        console.log(`[HIFI] Match found for "${song.title}": "${matched.title}" by ${matched.channel} (ID: ${matched.id}) -> Stream URL: ${streamUrl}`);
        const hifiData = {
          stream_url: streamUrl,
          source: 'monochrome',
          hifi_id: matched.id,
          title: matched.title,
          artist: matched.channel,
          duration: parseDurationToSecs(matched.duration),
          _hifiVersion: HIFI_MATCHER_VERSION
        };
        if (!ignoreBlacklist) {
          if (idKey) hifiCache.set(idKey, hifiData);
          if (textKey) hifiCache.set(textKey, hifiData);
          persistCacheDebounced();
        }
        return hifiData;
      } else {
        console.log(`[HIFI] No matching track found on Monochrome for "${query}". Preserving YouTube.`);
      }
    } catch (e) {
      const errMsg = String(e?.message || e || '');
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('Too Many')) {
        console.warn(`[HIFI] Monochrome search API rate-limited (HTTP 429: "oooooooooooooooooof beep boop") while querying "${query}". Entering 60s cooldown.`);
        reportMonochromeRateLimit(60000);
      } else {
        console.warn('[HIFI] Error querying Monochrome for:', query, e);
      }
      return null;
    }

    // Remember negative result in memory for current session
    if (!ignoreBlacklist) {
      if (idKey) sessionUnmatchedSet.add(idKey);
      if (textKey) sessionUnmatchedSet.add(textKey);
    }
    return null;
  })();

  if (dedupeKey) {
    inFlightPromises.set(dedupeKey, promise);
  }

  try {
    return await promise;
  } finally {
    if (dedupeKey) {
      inFlightPromises.delete(dedupeKey);
    }
  }
}

/**
 * Resolves and validates the first N tracks (default: 5) of a playlist in parallel
 * before playback or batch import begins.
 * Returns a new array where the first N tracks have verified Hi-Fi fields attached
 * (or marked checked), and subsequent tracks have instant cached Hi-Fi attached if available.
 */
export async function resolveInitialPlaylistTracks(tracks, count = 5) {
  if (!Array.isArray(tracks) || tracks.length === 0) return tracks || [];

  const sanitized = tracks.map(sanitizeLegacyHifiTrack);
  const targetCount = Math.min(count, sanitized.length);

  // Check the first N tracks in parallel
  const initialBatch = sanitized.slice(0, targetCount);

  const resolvedBatch = await Promise.all(
    initialBatch.map(async (song) => {
      if (!song || song.is_local || song.file_path) return song;
      if (!isHifiEligibleTrack(song)) {
        return {
          ...song,
          stream_url: null,
          source: null,
          hifi_id: null,
          _hifiChecked: true,
          _hifiVersion: HIFI_MATCHER_VERSION
        };
      }
      // If user explicitly forced YouTube for this song, preserve it
      if ((song.id && isUserYoutubeForced(song.id)) || song._userForcedYoutube) {
        return {
          ...song,
          stream_url: null,
          source: null,
          hifi_id: null,
          _hifiChecked: true,
          _hifiVersion: HIFI_MATCHER_VERSION,
          _userForcedYoutube: true
        };
      }
      // If already verified with current matcher version, keep as is
      if (song._hifiChecked && song._hifiVersion === HIFI_MATCHER_VERSION) return song;
      // If native Monochrome, mark verified
      if (song.source === 'monochrome' && (!song.hifi_id || String(song.hifi_id) === String(song.id))) {
        return { ...song, _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION };
      }

      // Check fast cache first (0ms)
      const cached = getCachedHifi(song);
      if (cached && cached.stream_url) {
        return {
          ...song,
          stream_url: cached.stream_url,
          source: 'monochrome',
          hifi_id: cached.hifi_id,
          _hifiChecked: true,
          _hifiVersion: HIFI_MATCHER_VERSION
        };
      }

      // Query Monochrome if not in cache
      try {
        const hifi = await resolveHifiForTrack(song);
        if (hifi && hifi.stream_url) {
          return {
            ...song,
            stream_url: hifi.stream_url,
            source: 'monochrome',
            hifi_id: hifi.hifi_id,
            _hifiChecked: true,
            _hifiVersion: HIFI_MATCHER_VERSION
          };
        } else {
          return {
            ...song,
            stream_url: null,
            source: null,
            hifi_id: null,
            _hifiChecked: true,
            _hifiVersion: HIFI_MATCHER_VERSION
          };
        }
      } catch (e) {
        console.warn('[HIFI] Initial batch resolution error for:', song.title, e);
        return {
          ...song,
          _hifiChecked: true,
          _hifiVersion: HIFI_MATCHER_VERSION
        };
      }
    })
  );

  // For tracks beyond targetCount, attach cached Hi-Fi if available (instant 0ms)
  const remainingBatch = sanitized.slice(targetCount).map((song) => {
    if (!song || song.is_local || song.file_path) return song;
    if (!isHifiEligibleTrack(song)) {
      return {
        ...song,
        stream_url: null,
        source: null,
        hifi_id: null,
        _hifiChecked: true,
        _hifiVersion: HIFI_MATCHER_VERSION
      };
    }
    if ((song.id && isUserYoutubeForced(song.id)) || song._userForcedYoutube) {
      return {
        ...song,
        stream_url: null,
        source: null,
        hifi_id: null,
        _hifiChecked: true,
        _hifiVersion: HIFI_MATCHER_VERSION,
        _userForcedYoutube: true
      };
    }
    if (song.stream_url) return song;
    const cached = getCachedHifi(song);
    if (cached && cached.stream_url) {
      return {
        ...song,
        stream_url: cached.stream_url,
        source: 'monochrome',
        hifi_id: cached.hifi_id,
        _hifiChecked: true,
        _hifiVersion: HIFI_MATCHER_VERSION
      };
    }
    return song;
  });

  return [...resolvedBatch, ...remainingBatch];
}
