import { api } from './api.js';

const STORAGE_KEY = 'nadanada-hifi-cache-v7';
const LEGACY_STORAGE_KEYS = [
  'nadanada-hifi-cache',
  'nadanada-hifi-cache-v2',
  'nadanada-hifi-cache-v3',
  'nadanada-hifi-cache-v4',
  'nadanada-hifi-cache-v5',
  'nadanada-hifi-cache-v6'
];
const MAX_CACHE_ENTRIES = 3000;
export const HIFI_MATCHER_VERSION = 7;

export const TRACKS_BASE_URL = 'https://tracks.monochrome.st';

/**
 * Normalizes any FLAC stream URL to route via the local Rust stream proxy
 * with HTTP 206 Range support, zero CORS issues, and automatic local disk caching.
 */
export function normalizeFlacStreamUrl(url, trackId) {
  if (!url && !trackId) return null;
  const port = api.getCachedEmbedPort() || 24242;

  let targetId = null;
  if (typeof url === 'string') {
    const match = url.match(/\/flac\/([a-zA-Z0-9_-]+)(?:\.flac)?/i)
      || url.match(/\/track\/([a-zA-Z0-9_-]+)/i)
      || url.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      targetId = match[1];
    }
  }
  if (!targetId && trackId) {
    targetId = trackId;
  }

  if (targetId && port) {
    return `http://127.0.0.1:${port}/hifi/stream?id=${targetId}`;
  }

  if (typeof url === 'string' && port && url.includes('127.0.0.1')) {
    return url.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${port}`);
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

export function isHifiEligibleTrack(song) {
  if (!song) return false;
  if (song.is_local || song.file_path) return false;
  if (song.source === 'monochrome' || song.is_monochrome) return true;

  const itemType = (song.item_type || '').toLowerCase().trim();
  const channel = (song.channel || '').toLowerCase().trim();
  const title = (song.title || '').toLowerCase().trim();

  if (itemType === 'video') return false;
  if (channel.includes('vevo')) return false;
  if (VIDEO_TITLE_KEYWORDS.some(k => title.includes(k))) return false;
  if (/\b(mv|m\/v)\b/i.test(title)) return false;

  if (channel.endsWith('- topic') || channel === 'topic') return true;
  if (itemType === 'song') return true;

  return false;
}

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
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (Array.isArray(item) && item.length === 2 && item[1]?.stream_url) {
              map.set(item[0], item[1]);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[HIFI] Failed to parse persistent cache from localStorage:', e);
  }
  return map;
}

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

export function reportMonochromeRateLimit(cooldownMs = 4000) {
  monochromeRateLimitedUntil = Math.max(monochromeRateLimitedUntil, Date.now() + cooldownMs);
}

export function isMonochromeCoolingDown() {
  return Date.now() < monochromeRateLimitedUntil;
}

export function markHifiFailed(song) {
  // Managed by player fallback state
}

export function parseDurationToSecs(dur) {
  if (!dur) return 0;
  if (typeof dur === 'number') return dur > 1000 ? Math.round(dur / 1000) : Math.round(dur);
  const parts = String(dur).split(':').map(Number);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  return 0;
}

export function isKnownUpstreamMismatch(song) {
  if (!song) return false;
  if (song.hifi_id && KNOWN_UPSTREAM_MISMATCHES.has(String(song.hifi_id))) return true;
  // Kuwo tracks are from the original master catalog, not Monochrome's replaced remakes
  if (song.hifi_id && String(song.hifi_id).startsWith('kuwo_')) return false;
  const t = (song.title || '').toLowerCase();
  const a = (song.channel || song.artist || '').toLowerCase();
  if (a.includes('dewa') && (t.includes('aku milikmu') || t.includes('tak kan ada cinta') || t.includes('mahameru'))) {
    if (!t.includes('virzha') && !t.includes('ello') && !t.includes('2021') && !t.includes('remake')) {
      return true;
    }
  }
  return false;
}

export function getCachedHifi(song) {
  if (!song || !isHifiEligibleTrack(song)) return null;
  if (song._hifiFailed || song._userForcedYoutube) return null;
  const idKey = song.id ? String(song.id) : null;
  if (idKey && (isUserYoutubeForced(idKey) || sessionUnmatchedSet.has(idKey))) return null;

  const textKey = song.channel && song.title ? `${song.channel.toLowerCase()}:::${song.title.toLowerCase()}` : null;
  if (textKey && sessionUnmatchedSet.has(textKey)) return null;

  let cached = (idKey && hifiCache.get(idKey)) || (textKey && hifiCache.get(textKey)) || null;
  if (!cached || !cached.stream_url) return null;

  const port = api.getCachedEmbedPort();
  const normUrl = normalizeFlacStreamUrl(cached.stream_url, cached.hifi_id);
  if (normUrl !== cached.stream_url && port) {
    cached = { ...cached, stream_url: normUrl };
    if (idKey) hifiCache.set(idKey, cached);
    if (textKey) hifiCache.set(textKey, cached);
  }

  return cached;
}

export function sanitizeLegacyHifiTrack(s) {
  if (!s || typeof s !== 'object') return s;
  if (s.is_local || s.file_path) return s;

  // On session restore, clear transient failures so tracks get a clean retry
  if (s._hifiFailed) {
    s = { ...s, _hifiFailed: false };
  }

  if (!isHifiEligibleTrack(s)) {
    return {
      ...s,
      stream_url: null,
      source: null,
      hifi_id: null,
      _hifiChecked: true,
      _hifiVersion: HIFI_MATCHER_VERSION
    };
  }

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

  if (s._hifiVersion !== HIFI_MATCHER_VERSION) {
    return {
      ...s,
      stream_url: null,
      source: null,
      hifi_id: null,
      _hifiChecked: false,
      _hifiVersion: undefined
    };
  }

  // Ensure stream_url has the active local server port
  if (s.stream_url) {
    const norm = normalizeFlacStreamUrl(s.stream_url, s.hifi_id);
    if (norm) {
      return { ...s, stream_url: norm };
    }
  } else {
    // If stream_url was missing, check fast resolution cache
    const cached = getCachedHifi(s);
    if (cached && cached.stream_url) {
      return {
        ...s,
        stream_url: cached.stream_url,
        source: cached.source || (String(cached.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome'),
        hifi_id: cached.hifi_id,
        _hifiChecked: true,
        _hifiVersion: HIFI_MATCHER_VERSION
      };
    } else {
      // Allow resolver to check on startup
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
 * Resolves a track to its Hi-Fi counterpart directly via the Rust backend.
 * The Rust backend runs candidate search, multi-instance failover,
 * candidate fuzzy scoring, edition verification, and local disk proxying.
 */
export async function resolveHifiForTrack(song, options = {}) {
  const { ignoreBlacklist = false, ignoreUserYoutubeForced = false } = options;
  if (!song || song.is_local || song.file_path) return null;
  if (!isHifiEligibleTrack(song)) return null;
  if (!ignoreUserYoutubeForced && ((song.id && isUserYoutubeForced(song.id)) || song._userForcedYoutube)) return null;

  // Native Monochrome track: immediately return local stream proxy URL
  if (song.source === 'monochrome' && song.id) {
    const targetId = song.hifi_id || song.id;
    const streamUrl = await api.getHifiStreamUrl(targetId);
    return {
      stream_url: streamUrl,
      source: 'monochrome',
      hifi_id: targetId,
      title: song.title,
      artist: song.channel,
      duration: parseDurationToSecs(song.duration),
      _hifiVersion: HIFI_MATCHER_VERSION
    };
  }

  const idKey = song.id ? String(song.id) : null;
  const textKey = song.channel && song.title ? `${song.channel.toLowerCase()}:::${song.title.toLowerCase()}` : null;

  if (!ignoreBlacklist) {
    if (idKey && sessionUnmatchedSet.has(idKey)) return null;
    if (textKey && sessionUnmatchedSet.has(textKey)) return null;
  }

  // Fast synchronous memory cache check
  const cached = getCachedHifi(song);
  if (cached && cached.stream_url) {
    return cached;
  }

  const dedupeKey = idKey || textKey || song.title;
  if (inFlightPromises.has(dedupeKey)) {
    return inFlightPromises.get(dedupeKey);
  }

  const promise = (async () => {
    try {
      console.log(`[HIFI] Resolving Hi-Fi via Rust engine for "${song.title}" (${song.channel})...`);
      const res = await api.resolveHifiTrack(
        song.id,
        song.title,
        song.channel || song.artist,
        song.duration,
        song.item_type,
        song.isrc
      );

      if (res && res.stream_url && res.hifi_id) {
        console.log(`[HIFI] Rust engine matched "${song.title}" -> "${res.title}" by ${res.artist} (ID: ${res.hifi_id}, Score: ${res.match_score}, Cached on disk: ${res.is_cached})`);
        const hifiData = {
          stream_url: res.stream_url,
          source: res.source || (String(res.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome'),
          hifi_id: res.hifi_id,
          title: res.title,
          artist: res.artist,
          duration: res.duration || parseDurationToSecs(song.duration),
          is_cached: res.is_cached,
          _hifiVersion: HIFI_MATCHER_VERSION
        };

        if (idKey) hifiCache.set(idKey, hifiData);
        if (textKey) hifiCache.set(textKey, hifiData);
        persistCacheDebounced();
        return hifiData;
      } else {
        console.log(`[HIFI] No Hi-Fi counterpart found by Rust engine for "${song.title}". Using YouTube.`);
        if (!ignoreBlacklist) {
          if (idKey) sessionUnmatchedSet.add(idKey);
          if (textKey) sessionUnmatchedSet.add(textKey);
        }
        return null;
      }
    } catch (e) {
      console.warn('[HIFI] Resolution error in Rust backend:', e);
      return null;
    }
  })();

  inFlightPromises.set(dedupeKey, promise);
  try {
    return await promise;
  } finally {
    inFlightPromises.delete(dedupeKey);
  }
}

/**
 * Resolves initial tracks of a playlist eagerly before playback.
 * Defaults to count = 1 so only the current playing song is resolved upfront,
 * preventing upstream burst rate limits while guaranteeing instant playback.
 */
export async function resolveInitialPlaylistTracks(tracks, count = 1) {
  if (!Array.isArray(tracks) || tracks.length === 0) return tracks || [];

  const sanitized = tracks.map(sanitizeLegacyHifiTrack);
  const targetCount = Math.min(count, sanitized.length);

  const initialBatch = sanitized.slice(0, targetCount);
  const resolvedBatch = await Promise.all(
    initialBatch.map(async (song) => {
      if (!song || song.is_local || song.file_path) return song;
      if (!isHifiEligibleTrack(song)) {
        return { ...song, stream_url: null, source: null, hifi_id: null, _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION };
      }
      if ((song.id && isUserYoutubeForced(song.id)) || song._userForcedYoutube) {
        return { ...song, stream_url: null, source: null, hifi_id: null, _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION, _userForcedYoutube: true };
      }
      if (song._hifiChecked && song._hifiVersion === HIFI_MATCHER_VERSION) return song;

      const cached = getCachedHifi(song);
      if (cached && cached.stream_url) {
        return {
          ...song,
          stream_url: cached.stream_url,
          source: cached.source || (String(cached.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome'),
          hifi_id: cached.hifi_id,
          _hifiChecked: true,
          _hifiVersion: HIFI_MATCHER_VERSION
        };
      }

      try {
        const hifi = await resolveHifiForTrack(song);
        if (hifi && hifi.stream_url) {
          return {
            ...song,
            stream_url: hifi.stream_url,
            source: hifi.source || (String(hifi.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome'),
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
        return { ...song, _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION };
      }
    })
  );

  const remainingBatch = sanitized.slice(targetCount).map((song) => {
    if (!song || song.is_local || song.file_path) return song;
    if (!isHifiEligibleTrack(song)) {
      return { ...song, stream_url: null, source: null, hifi_id: null, _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION };
    }
    if ((song.id && isUserYoutubeForced(song.id)) || song._userForcedYoutube) {
      return { ...song, stream_url: null, source: null, hifi_id: null, _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION, _userForcedYoutube: true };
    }
    if (song.stream_url) return song;
    const cached = getCachedHifi(song);
    if (cached && cached.stream_url) {
      return {
        ...song,
        stream_url: cached.stream_url,
        source: cached.source || (String(cached.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome'),
        hifi_id: cached.hifi_id,
        _hifiChecked: true,
        _hifiVersion: HIFI_MATCHER_VERSION
      };
    }
    return song;
  });

  return [...resolvedBatch, ...remainingBatch];
}
