import { useEffect, useRef } from 'react';
import { resolveHifiForTrack, HIFI_MATCHER_VERSION, isHifiEligibleTrack } from '../services/hifiResolver';

function isNativeMonochromeItem(s) {
  return Boolean(s && s.source === 'monochrome' && s.stream_url && (!s.hifi_id || String(s.hifi_id) === String(s.id)));
}

function needsHifiCheck(s, inFlightSet) {
  if (!s || s.is_local || s.file_path || inFlightSet.has(s.id)) return false;
  if (s._userForcedYoutube || s._hifiFailed) return false;
  if (!isHifiEligibleTrack(s)) return false;
  if (isNativeMonochromeItem(s)) return false;
  if (s._hifiChecked && s._hifiVersion === HIFI_MATCHER_VERSION) return false;
  return true;
}

/**
 * Automatically inspects songs in the active playlist queue and upgrades them
 * in-place with lossless FLAC stream URLs from Monochrome when available.
 * 
 * Strictness:
 * - Only runs when isHifiEnabled is true.
 * - Operates on the active playback playlist.
 * - Prioritizes currentSong (currentIndex) and nextSong (currentIndex + 1) for immediate playback & crossfade.
 */
export function useHifiResolver({ playlist, setPlaylist, currentIndex, isHifiEnabled, savedPlaylist }) {
  const inFlightRef = useRef(new Set());
  const isHifiEnabledRef = useRef(isHifiEnabled);
  isHifiEnabledRef.current = isHifiEnabled;

  useEffect(() => {
    if (!isHifiEnabled || !playlist || playlist.length === 0) {
      return;
    }

    let isCancelled = false;

    // Debounce resolver by 150ms during rapid track skipping to avoid triggering Monochrome rate limits
    const timer = setTimeout(async () => {
      // 1. Resolve immediate top priorities (current + next song) in parallel first!
      const immediateIndices = [currentIndex, currentIndex + 1].filter(idx => {
        if (idx < 0 || idx >= playlist.length) return false;
        const s = playlist[idx];
        return needsHifiCheck(s, inFlightRef.current);
      });

      if (immediateIndices.length > 0) {
        immediateIndices.forEach(idx => inFlightRef.current.add(playlist[idx].id));
        const immediateResults = await Promise.all(
          immediateIndices.map(async (idx) => {
            const song = playlist[idx];
            try {
              const hifi = await resolveHifiForTrack(song);
              return { song, hifi };
            } catch (e) {
              console.warn('[HIFI] Immediate resolution error for:', song.title, e);
              return { song, hifi: null };
            } finally {
              inFlightRef.current.delete(song.id);
            }
          })
        );

        if (isCancelled) return;

        // Always commit completed in-flight resolutions to playlist so concurrent playlist updates
        // (such as Endless Play appending a track) never drop an already-resolved song!
        if (isHifiEnabledRef.current) {
          setPlaylist(prev => {
            let changed = false;
            let updated = [...prev];
            for (const { song, hifi } of immediateResults) {
              const matchIdx = updated.findIndex(s => (s.queueId && s.queueId === song.queueId) || s.id === song.id);
              if (matchIdx !== -1 && (updated[matchIdx]._hifiVersion !== HIFI_MATCHER_VERSION || !updated[matchIdx]._hifiChecked)) {
                changed = true;
                if (hifi && hifi.stream_url) {
                  console.log(`[HIFI-QUEUE] Upgraded "${song.title}" to Hi-Fi FLAC stream`);
                  updated[matchIdx] = {
                    ...updated[matchIdx],
                    stream_url: hifi.stream_url,
                    source: 'monochrome',
                    hifi_id: hifi.hifi_id,
                    _hifiChecked: true,
                    _hifiVersion: HIFI_MATCHER_VERSION
                  };
                } else {
                  console.log(`[HIFI-QUEUE] Checked "${song.title}": No Hi-Fi stream available, keeping YouTube source.`);
                  updated[matchIdx] = {
                    ...updated[matchIdx],
                    stream_url: null,
                    source: null,
                    hifi_id: null,
                    _hifiChecked: true,
                    _hifiVersion: HIFI_MATCHER_VERSION
                  };
                }
              }
            }
            return changed ? updated : prev;
          });
        }
      }

      if (isCancelled) return;

      // 2. Remaining songs in queue order (resolved sequentially to avoid rate-limiting)
      const remainingIndices = [];
      for (let i = 0; i < playlist.length; i++) {
        if (!immediateIndices.includes(i)) {
          const song = playlist[i];
          if (needsHifiCheck(song, inFlightRef.current)) {
            remainingIndices.push(i);
          }
        }
      }

      if (remainingIndices.length === 0) return;

      for (const idx of remainingIndices) {
        if (isCancelled) break;
        const song = playlist[idx];
        if (!needsHifiCheck(song, inFlightRef.current)) continue;

        inFlightRef.current.add(song.id);
        let hifi = null;
        try {
          hifi = await resolveHifiForTrack(song);
        } catch (e) {
          console.warn('[HIFI] Resolution error for:', song.title, e);
        } finally {
          inFlightRef.current.delete(song.id);
        }

        if (isCancelled) break;

        if (isHifiEnabledRef.current) {
          setPlaylist(prev => {
            const matchIdx = prev.findIndex(s => (s.queueId && s.queueId === song.queueId) || s.id === song.id);
            if (matchIdx === -1 || (prev[matchIdx]._hifiChecked && prev[matchIdx]._hifiVersion === HIFI_MATCHER_VERSION)) return prev;

            const updated = [...prev];
            if (hifi && hifi.stream_url) {
              updated[matchIdx] = {
                ...updated[matchIdx],
                stream_url: hifi.stream_url,
                source: 'monochrome',
                hifi_id: hifi.hifi_id,
                _hifiChecked: true,
                _hifiVersion: HIFI_MATCHER_VERSION
              };
            } else {
              updated[matchIdx] = {
                ...updated[matchIdx],
                stream_url: null,
                source: null,
                hifi_id: null,
                _hifiChecked: true,
                _hifiVersion: HIFI_MATCHER_VERSION
              };
            }
            return updated;
          });
        }

        if (isCancelled) break;
      }
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [playlist, currentIndex, isHifiEnabled, setPlaylist]);
}
