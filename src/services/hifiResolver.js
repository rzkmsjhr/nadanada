import { api } from './api.js';

const STORAGE_KEY = 'nadanada-hifi-cache-v3';
const LEGACY_STORAGE_KEYS = ['nadanada-hifi-cache', 'nadanada-hifi-cache-v2'];
const MAX_CACHE_ENTRIES = 3000;
export const HIFI_MATCHER_VERSION = 3;

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
function loadPersistentCache() {
  const map = new Map();
  try {
    // Purge legacy caches to eliminate any cross-contaminated or artist-mismatched entries
    if (typeof localStorage !== 'undefined') {
      for (const oldKey of LEGACY_STORAGE_KEYS) {
        if (localStorage.getItem(oldKey)) {
          localStorage.removeItem(oldKey);
        }
      }
    }

    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (Array.isArray(item) && item.length === 2) {
            map.set(item[0], item[1]);
          }
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
          map.set(k, v);
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
 */
export function doesArtistMatch(targetArtist, candidateArtist, fallbackChannel = '') {
  const targetList = [
    ...splitArtistList(targetArtist),
    ...splitArtistList(fallbackChannel)
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const candList = splitArtistList(candidateArtist);

  if (targetList.length === 0 || candList.length === 0) return false;

  for (const t of targetList) {
    const tCompact = t.replace(/\s+/g, '');
    const tNoThe = t.replace(/^the\s+/, '').trim();

    for (const c of candList) {
      if (t === c) return true;

      const cCompact = c.replace(/\s+/g, '');
      if (tCompact.length >= 2 && tCompact === cCompact) return true;

      const cNoThe = c.replace(/^the\s+/, '').trim();
      if (tNoThe.length >= 3 && tNoThe === cNoThe) return true;
    }
  }

  return false;
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
 * Validates whether any track from Monochrome matches the target song.
 * Enforces strict musical edition flags and duration thresholds.
 */
export function matchTrack(song, results) {
  if (!results || results.length === 0) return null;
  const { title: cleanTitle, artist: cleanArtist } = cleanSongTitle(song.title, song.channel);
  const normTarget = normalizeComparableTitle(cleanTitle);
  if (!normTarget) return null;

  const targetFlags = extractVersionFlags(song.title);
  const songSecs = parseDurationToSecs(song.duration);

  // Strictly filter out any candidates with mismatched artist or mismatched version descriptors
  const candidates = results.filter(t => {
    if (!doesArtistMatch(cleanArtist, t.channel, song.channel)) return false;
    const candFlags = extractVersionFlags(t.title);
    return !hasVersionConflict(targetFlags, candFlags);
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
  if (!song) return null;
  const idKey = song.id ? String(song.id) : null;
  const { title, artist } = cleanSongTitle(song.title, song.channel);
  const textKey = title && artist ? `${artist.toLowerCase()}:::${title.toLowerCase()}` : null;

  let cached = (idKey && hifiCache.get(idKey)) || (textKey && hifiCache.get(textKey)) || null;
  if (!cached || !cached.stream_url) return null;

  // Validate artist match (purge any legacy entry missing artist or with mismatched artist)
  if (!cached.artist || !doesArtistMatch(artist, cached.artist, song.channel)) {
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

  return cached;
}

const inFlightPromises = new Map();

/**
 * Resolves a single track to its Hi-Fi counterpart if available.
 * Checks both song.id and canonical artist:::title in persistent cache with validation,
 * and deduplicates concurrent in-flight lookups for the same song.
 */
export async function resolveHifiForTrack(song) {
  if (!song || song.is_local || song.file_path) return null;
  // Only trust pre-attached stream_url if it is a native Monochrome search item (id === hifi_id or no hifi_id)
  // OR if it was already verified with HIFI_MATCHER_VERSION
  if (
    song.source === 'monochrome' &&
    song.stream_url &&
    (!song.hifi_id || String(song.hifi_id) === String(song.id) || song._hifiVersion === HIFI_MATCHER_VERSION)
  ) {
    return {
      stream_url: song.stream_url,
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
    if (!entry.artist || !doesArtistMatch(artist, entry.artist, song.channel)) return false;
    if (entry.title) {
      const cachedFlags = extractVersionFlags(entry.title);
      if (hasVersionConflict(targetFlags, cachedFlags)) return false;
    }
    if (songSecs > 0 && entry.duration > 0) {
      if (Math.abs(songSecs - entry.duration) > 20) return false;
    }
    return true;
  };

  // Check persistent cache with artist, version & duration validation
  if (idKey && hifiCache.has(idKey)) {
    const cached = hifiCache.get(idKey);
    if (cached === null) return null;
    if (isValidCached(cached)) {
      return cached;
    } else {
      hifiCache.delete(idKey);
    }
  }
  if (textKey && hifiCache.has(textKey)) {
    const cached = hifiCache.get(textKey);
    if (cached === null) return null;
    if (isValidCached(cached)) {
      if (idKey) hifiCache.set(idKey, cached);
      return cached;
    } else {
      hifiCache.delete(textKey);
    }
  }

  if (!title) {
    if (idKey) hifiCache.set(idKey, null);
    if (textKey) hifiCache.set(textKey, null);
    persistCacheDebounced();
    return null;
  }

  const dedupeKey = idKey || textKey;
  if (dedupeKey && inFlightPromises.has(dedupeKey)) {
    return inFlightPromises.get(dedupeKey);
  }

  const promise = (async () => {
    const query = `${artist} ${title}`.trim();
    try {
      const results = await api.searchMonochrome(query, 'song');
      const matched = matchTrack(song, results);
      if (matched && matched.stream_url) {
        const hifiData = {
          stream_url: matched.stream_url,
          source: 'monochrome',
          hifi_id: matched.id,
          title: matched.title,
          artist: matched.channel,
          duration: parseDurationToSecs(matched.duration),
          _hifiVersion: HIFI_MATCHER_VERSION
        };
        if (idKey) hifiCache.set(idKey, hifiData);
        if (textKey) hifiCache.set(textKey, hifiData);
        persistCacheDebounced();
        return hifiData;
      }
    } catch (e) {
      console.warn('[HIFI] Error querying Monochrome for:', query, e);
      return null;
    }

    // Cache negative result so we never re-query unmatched songs on restart
    if (idKey) hifiCache.set(idKey, null);
    if (textKey) hifiCache.set(textKey, null);
    persistCacheDebounced();
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
