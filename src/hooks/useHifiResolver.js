import { useEffect, useRef } from 'react';
import { resolveHifiForTrack, HIFI_MATCHER_VERSION, isHifiEligibleTrack, isMonochromeCoolingDown } from '../services/hifiResolver';

function isNativeMonochromeItem(s) {
  return Boolean(s && s.source === 'monochrome' && s.stream_url && (!s.hifi_id || String(s.hifi_id) === String(s.id)));
}

function needsHifiCheck(s, inFlightSet) {
  if (!s || s.is_local || s.file_path || inFlightSet.has(s.id)) return false;
  if (s._userForcedYoutube || s._hifiFailed) return false;
  if (!isHifiEligibleTrack(s)) return false;
  if (isNativeMonochromeItem(s)) return false;
  if (s._hifiChecked && s._hifiVersion === HIFI_MATCHER_VERSION) {
    if (s._resolvedWithAlbum === false && s.id && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('nadanada_album_cache');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed[s.id]?.album) {
            return true;
          }
        }
      } catch (_) {}
    }
    return false;
  }
  return true;
}

function applyHifiToTrack(track, hifi) {
  const source = hifi?.source || (hifi?.hifi_id && String(hifi.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome');
  if (hifi && hifi.stream_url) {
    return {
      ...track,
      stream_url: hifi.stream_url,
      source,
      hifi_id: hifi.hifi_id,
      _hifiChecked: true,
      _hifiVersion: HIFI_MATCHER_VERSION,
      _resolvedWithAlbum: hifi._resolvedWithAlbum ?? false
    };
  } else if (!isMonochromeCoolingDown()) {
    return {
      ...track,
      stream_url: null,
      source: null,
      hifi_id: null,
      _hifiChecked: true,
      _hifiVersion: HIFI_MATCHER_VERSION,
      _resolvedWithAlbum: false
    };
  }
  return track;
}

/**
 * Automatically inspects songs in the active playlist queue and background playlist,
 * upgrading them in-place with lossless FLAC stream URLs (Kuwo primary -> Monochrome fallback).
 * 
 * Strictness:
 * - Only runs when isHifiEnabled is true.
 * - Tier 1: Current playing track (currentIndex) + true upcoming track (nextIndex).
 * - Tier 2: Near lookahead (currentIndex + 2, currentIndex + 3).
 * - Tier 3: Full-queue progressive sweep (drains all remaining unresolved items across playlist and savedPlaylist).
 */
export function useHifiResolver({
  playlist,
  setPlaylist,
  currentIndex,
  nextIndex,
  isHifiEnabled,
  savedPlaylist,
  setSavedPlaylist
}) {
  const inFlightRef = useRef(new Set());
  const isHifiEnabledRef = useRef(isHifiEnabled);
  isHifiEnabledRef.current = isHifiEnabled;

  useEffect(() => {
    if (!isHifiEnabled || !playlist || playlist.length === 0) {
      return;
    }

    let isCancelled = false;

    const timer = setTimeout(async () => {
      const activeNext = (nextIndex !== undefined && nextIndex !== null) ? nextIndex : currentIndex + 1;

      // 1. Tier 1: Immediate priorities (current + upcoming song)
      const immediateIndices = [currentIndex, activeNext].filter(idx => {
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

        if (isHifiEnabledRef.current) {
          setPlaylist(prev => {
            let changed = false;
            let updated = [...prev];
            for (const { song, hifi } of immediateResults) {
              const matchIdx = updated.findIndex(s => (s.queueId && s.queueId === song.queueId) || s.id === song.id);
              if (matchIdx !== -1 && (updated[matchIdx]._hifiVersion !== HIFI_MATCHER_VERSION || !updated[matchIdx]._hifiChecked || (updated[matchIdx]._resolvedWithAlbum === false && hifi?._resolvedWithAlbum))) {
                changed = true;
                updated[matchIdx] = applyHifiToTrack(updated[matchIdx], hifi);
              }
            }
            return changed ? updated : prev;
          });
        }
      }

      if (isCancelled) return;

      // 2. Tier 2: Near lookahead (next 2 upcoming tracks)
      const lookaheadIndices = [currentIndex + 2, currentIndex + 3].filter(idx => {
        if (idx < 0 || idx >= playlist.length) return false;
        const s = playlist[idx];
        return needsHifiCheck(s, inFlightRef.current);
      });

      for (const idx of lookaheadIndices) {
        if (isCancelled || isMonochromeCoolingDown()) break;
        const song = playlist[idx];
        if (!needsHifiCheck(song, inFlightRef.current)) continue;

        inFlightRef.current.add(song.id);
        let hifi = null;
        try {
          hifi = await resolveHifiForTrack(song);
        } catch (e) {
          console.warn('[HIFI] Lookahead resolution error for:', song.title, e);
        } finally {
          inFlightRef.current.delete(song.id);
        }

        if (isCancelled) break;

        if (isHifiEnabledRef.current) {
          setPlaylist(prev => {
            const matchIdx = prev.findIndex(s => (s.queueId && s.queueId === song.queueId) || s.id === song.id);
            if (matchIdx === -1 || (prev[matchIdx]._hifiChecked && prev[matchIdx]._hifiVersion === HIFI_MATCHER_VERSION && (prev[matchIdx]._resolvedWithAlbum !== false || !hifi?._resolvedWithAlbum))) return prev;
            const updated = [...prev];
            updated[matchIdx] = applyHifiToTrack(updated[matchIdx], hifi);
            return updated;
          });
        }

        await new Promise(r => setTimeout(r, 200));
        if (isCancelled) break;
      }

      if (isCancelled) return;

      // 3. Tier 3: Full-Queue Progressive Sweep (sweeps remaining playlist, then savedPlaylist)
      const remainingPlaylistIndices = [];
      for (let i = currentIndex + 4; i < playlist.length; i++) {
        if (needsHifiCheck(playlist[i], inFlightRef.current)) remainingPlaylistIndices.push(i);
      }
      for (let i = 0; i < currentIndex - 1; i++) {
        if (needsHifiCheck(playlist[i], inFlightRef.current)) remainingPlaylistIndices.push(i);
      }

      for (const idx of remainingPlaylistIndices) {
        if (isCancelled || isMonochromeCoolingDown()) break;
        const song = playlist[idx];
        if (!needsHifiCheck(song, inFlightRef.current)) continue;

        inFlightRef.current.add(song.id);
        let hifi = null;
        try {
          hifi = await resolveHifiForTrack(song);
        } catch (e) {
          console.warn('[HIFI] Queue drain error for:', song.title, e);
        } finally {
          inFlightRef.current.delete(song.id);
        }

        if (isCancelled) break;

        if (isHifiEnabledRef.current) {
          setPlaylist(prev => {
            const matchIdx = prev.findIndex(s => (s.queueId && s.queueId === song.queueId) || s.id === song.id);
            if (matchIdx === -1 || (prev[matchIdx]._hifiChecked && prev[matchIdx]._hifiVersion === HIFI_MATCHER_VERSION && (prev[matchIdx]._resolvedWithAlbum !== false || !hifi?._resolvedWithAlbum))) return prev;
            const updated = [...prev];
            updated[matchIdx] = applyHifiToTrack(updated[matchIdx], hifi);
            return updated;
          });
        }

        await new Promise(r => setTimeout(r, 300));
        if (isCancelled) break;
      }

      if (!isCancelled && savedPlaylist && Array.isArray(savedPlaylist) && setSavedPlaylist) {
        const unresolvedSaved = savedPlaylist.filter(s => needsHifiCheck(s, inFlightRef.current));
        for (const song of unresolvedSaved) {
          if (isCancelled || isMonochromeCoolingDown()) break;
          if (!needsHifiCheck(song, inFlightRef.current)) continue;

          inFlightRef.current.add(song.id);
          let hifi = null;
          try {
            hifi = await resolveHifiForTrack(song);
          } catch (e) {
            console.warn('[HIFI] SavedPlaylist drain error for:', song.title, e);
          } finally {
            inFlightRef.current.delete(song.id);
          }

          if (isCancelled) break;

          if (isHifiEnabledRef.current) {
            setSavedPlaylist(prev => {
              if (!prev) return prev;
              const matchIdx = prev.findIndex(s => (s.queueId && s.queueId === song.queueId) || s.id === song.id);
              if (matchIdx === -1 || (prev[matchIdx]._hifiChecked && prev[matchIdx]._hifiVersion === HIFI_MATCHER_VERSION && (prev[matchIdx]._resolvedWithAlbum !== false || !hifi?._resolvedWithAlbum))) return prev;
              const updated = [...prev];
              updated[matchIdx] = applyHifiToTrack(updated[matchIdx], hifi);
              return updated;
            });
          }

          await new Promise(r => setTimeout(r, 300));
          if (isCancelled) break;
        }
      }
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [playlist, currentIndex, nextIndex, isHifiEnabled, setPlaylist, savedPlaylist, setSavedPlaylist]);
}
