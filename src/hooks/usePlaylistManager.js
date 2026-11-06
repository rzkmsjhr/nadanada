import { useState, useRef, useEffect, useCallback } from 'react';
import { resolveHifiForTrack, getCachedHifi, HIFI_MATCHER_VERSION, sanitizeLegacyHifiTrack, resolveInitialPlaylistTracks, prepareTrackThroughGateSync, isHifiEligibleTrack } from '../services/hifiResolver';

export function usePlaylistManager({
  api,
  showSearch,
  hasAddedSongInSearchRef,
  isHifiEnabled = true
}) {
  const [playlist, setPlaylist] = useState(() => {
    try {
      const saved = localStorage.getItem('nadanada-session-playlist');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed)
        ? parsed.map(sanitizeLegacyHifiTrack)
        : [];
    } catch (e) {
      console.error('Failed to parse session playlist:', e);
      return [];
    }
  });

  const [currentIndex, setCurrentIndex] = useState(() => {
    try {
      const saved = localStorage.getItem('nadanada-session-index');
      const parsed = saved ? parseInt(saved, 10) : 0;
      if (isNaN(parsed) || parsed < 0) return 0;
      if (playlist.length > 0 && parsed >= playlist.length) return playlist.length - 1;
      if (playlist.length === 0) return 0;
      return parsed;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    if (playlist.length === 0) {
      if (currentIndex !== 0) setCurrentIndex(0);
    } else if (currentIndex >= playlist.length) {
      setCurrentIndex(playlist.length - 1);
    } else if (currentIndex < 0) {
      setCurrentIndex(0);
    }
  }, [playlist.length, currentIndex]);

  const [savedPlaylist, setSavedPlaylist] = useState(null);
  const [savedPlaylists, setSavedPlaylists] = useState([]);
  const [shouldScrollPlaylistToBottom, setShouldScrollPlaylistToBottom] = useState(false);
  const playlistsLoadedRef = useRef(false);

  useEffect(() => {
    const loadPlaylists = async () => {
      try {
        const data = await api.loadPlaylists();
        const parsed = JSON.parse(data);
        if (parsed && parsed.length > 0) {
          const sanitized = parsed.map(pl => ({
            ...pl,
            items: Array.isArray(pl.items) ? pl.items.map(sanitizeLegacyHifiTrack) : []
          }));
          setSavedPlaylists(sanitized);
        } else {
          // One-time migration from localStorage
          const lsData = localStorage.getItem('nadanada-saved-playlists');
          if (lsData) {
            try {
              const lsParsed = JSON.parse(lsData);
              if (lsParsed && lsParsed.length > 0) {
                const sanitized = lsParsed.map(pl => ({
                  ...pl,
                  items: Array.isArray(pl.items) ? pl.items.map(sanitizeLegacyHifiTrack) : []
                }));
                setSavedPlaylists(sanitized);
                await api.savePlaylists(JSON.stringify(sanitized));
                localStorage.removeItem('nadanada-saved-playlists');
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error('Failed to load playlists from file, using localStorage fallback:', e);
        try {
          const lsData = localStorage.getItem('nadanada-saved-playlists');
          if (lsData) {
            const lsParsed = JSON.parse(lsData);
            if (lsParsed && lsParsed.length > 0) {
              setSavedPlaylists(lsParsed.map(pl => ({
                ...pl,
                items: Array.isArray(pl.items) ? pl.items.map(sanitizeLegacyHifiTrack) : []
              })));
            }
          }
        } catch {}
      } finally {
        playlistsLoadedRef.current = true;
      }
    };
    loadPlaylists();
  }, [api]);

  // Eagerly warm the initial restored tracks on app launch so playback starts in Hi-Fi instantly
  useEffect(() => {
    if (!isHifiEnabled || !playlist || playlist.length === 0) return;
    const initialSlice = playlist.slice(currentIndex, currentIndex + 2);
    if (initialSlice.length === 0) return;
    resolveInitialPlaylistTracks(initialSlice, 2).then(warmed => {
      if (!warmed || warmed.length === 0) return;
      setPlaylist(prev => {
        let changed = false;
        const updated = [...prev];
        warmed.forEach((wSong, i) => {
          const targetIdx = currentIndex + i;
          if (targetIdx < updated.length && wSong.stream_url && updated[targetIdx].stream_url !== wSong.stream_url) {
            updated[targetIdx] = { ...updated[targetIdx], ...wSong };
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }).catch(() => {});
  }, []);

  const lastMainPlaylistIndexRef = useRef(currentIndex);

  useEffect(() => {
    if (!savedPlaylist) {
      lastMainPlaylistIndexRef.current = currentIndex;
    }
  }, [savedPlaylist, currentIndex]);

  const persistSession = useCallback((activePlaylist, activeIdx, preservedPlaylist) => {
    const playlistToPersist = preservedPlaylist || activePlaylist;
    let indexToPersist = activeIdx;
    if (preservedPlaylist && preservedPlaylist.length > 0) {
      const activeTrack = activePlaylist[activeIdx];
      const matchIdx = activeTrack ? preservedPlaylist.findIndex(s => s.id === activeTrack.id) : -1;
      indexToPersist = matchIdx !== -1 ? matchIdx : (lastMainPlaylistIndexRef.current ?? 0);
      if (indexToPersist >= preservedPlaylist.length) {
        indexToPersist = Math.max(0, preservedPlaylist.length - 1);
      } else if (indexToPersist < 0) {
        indexToPersist = 0;
      }
    } else if (playlistToPersist.length === 0) {
      indexToPersist = 0;
    } else if (indexToPersist >= playlistToPersist.length) {
      indexToPersist = Math.max(0, playlistToPersist.length - 1);
    }
    try {
      localStorage.setItem('nadanada-session-playlist', JSON.stringify(playlistToPersist));
      localStorage.setItem('nadanada-session-index', indexToPersist.toString());
    } catch (e) {
      console.error('Failed to save session playlist:', e);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      persistSession(playlist, currentIndex, savedPlaylist);
    }, 500);
    return () => clearTimeout(timer);
  }, [playlist, currentIndex, savedPlaylist, persistSession]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      persistSession(playlist, currentIndex, savedPlaylist);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [playlist, currentIndex, savedPlaylist, persistSession]);

  useEffect(() => {
    if (!playlistsLoadedRef.current) return; // Don't overwrite the file before we've loaded it
    const timer = setTimeout(() => {
      api.savePlaylists(JSON.stringify(savedPlaylists)).catch(e => console.error('Failed to save playlists to file:', e));
    }, 500);
    return () => clearTimeout(timer);
  }, [savedPlaylists, api]);

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const handleAddSong = async (video, options = {}) => {
    console.log("handleAddSong called. showSearch is:", showSearch);
    if (showSearch) {
      hasAddedSongInSearchRef.current = true;
    }

    const gatedSong = prepareTrackThroughGateSync(video, isHifiEnabled);
    const afterCurrent = Boolean(options?.afterCurrent);
    const currIdx = currentIndexRef.current;

    // If queue is empty, resolve eagerly before play begins
    const shouldEagerResolve = isHifiEnabled && playlist.length === 0 && !gatedSong._hifiChecked && isHifiEligibleTrack(gatedSong);

    if (shouldEagerResolve) {
      try {
        const hifi = await resolveHifiForTrack(gatedSong);
        if (hifi && hifi.stream_url) {
          gatedSong.stream_url = hifi.stream_url;
          gatedSong.source = hifi.source || (String(hifi.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome');
          gatedSong.hifi_id = hifi.hifi_id;
        } else {
          gatedSong.stream_url = null;
          gatedSong.source = null;
          gatedSong.hifi_id = null;
        }
      } catch (e) {
        // Fallback to youtube
      }
      gatedSong._hifiChecked = true;
      gatedSong._hifiVersion = HIFI_MATCHER_VERSION;
      gatedSong._resolvedWithAlbum = Boolean(gatedSong.album);
    }

    // Insert into state immediately (instant UI responsiveness)
    if (savedPlaylist) {
      setSavedPlaylist(prev => {
        if (afterCurrent && currIdx >= 0 && currIdx < prev.length) {
          const next = [...prev];
          next.splice(currIdx + 1, 0, gatedSong);
          return next;
        }
        return [...prev, gatedSong];
      });
    }

    setPlaylist(prev => {
      if (afterCurrent && currIdx >= 0 && currIdx < prev.length) {
        const next = [...prev];
        next.splice(currIdx + 1, 0, gatedSong);
        return next;
      }
      return [...prev, gatedSong];
    });

    // If inserted into an active queue, resolve in background immediately
    if (isHifiEnabled && !gatedSong._hifiChecked && isHifiEligibleTrack(gatedSong)) {
      resolveHifiForTrack(gatedSong).then(hifi => {
        const source = hifi?.source || (hifi?.hifi_id && String(hifi.hifi_id).startsWith('kuwo_') ? 'kuwo' : 'monochrome');
        const updateFn = prev => prev.map(s => s.queueId === gatedSong.queueId ? {
          ...s,
          stream_url: hifi?.stream_url || null,
          source: hifi?.stream_url ? source : null,
          hifi_id: hifi?.hifi_id || null,
          _hifiChecked: true,
          _hifiVersion: HIFI_MATCHER_VERSION,
          _resolvedWithAlbum: hifi?._resolvedWithAlbum ?? Boolean(s.album || gatedSong.album)
        } : s);
        setPlaylist(updateFn);
        if (savedPlaylist) {
          setSavedPlaylist(updateFn);
        }
      }).catch(() => {
        const updateFn = prev => prev.map(s => s.queueId === gatedSong.queueId ? {
          ...s,
          _hifiChecked: true,
          _hifiVersion: HIFI_MATCHER_VERSION,
          _resolvedWithAlbum: false
        } : s);
        setPlaylist(updateFn);
        if (savedPlaylist) {
          setSavedPlaylist(updateFn);
        }
      });
    }
  };

  const handleAddSongAfterCurrent = async video => {
    await handleAddSong(video, { afterCurrent: true });
  };

  const handleAddMultiple = async videos => {
    if (showSearch) {
      hasAddedSongInSearchRef.current = true;
    }
    if (!videos || videos.length === 0) return [];

    let preparedVideos = videos;
    if (isHifiEnabled) {
      preparedVideos = await resolveInitialPlaylistTracks(videos, 5);
    } else {
      preparedVideos = videos.map(sanitizeLegacyHifiTrack);
    }

    const timestamp = Date.now();
    const newSongs = preparedVideos.map((video, idx) => ({
      ...video,
      queueId: (timestamp + idx).toString() + Math.random().toString(36).substr(2, 9)
    }));

    setPlaylist(prev => [...prev, ...newSongs]);
    if (savedPlaylist) {
      setSavedPlaylist(prev => [...prev, ...newSongs]);
    }
    return newSongs;
  };

  const handleRemoveSong = index => {
    const isLast = index >= playlist.length - 1;
    setPlaylist(prev => {
      const newPlaylist = [...prev];
      newPlaylist.splice(index, 1);
      return newPlaylist;
    });
    setCurrentIndex(prev => {
      if (index < prev) {
        return prev - 1;
      } else if (index === prev && isLast) {
        return Math.max(0, prev - 1);
      }
      return prev;
    });
  };

  const handleReorder = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;

    if (savedPlaylist) {
      setSavedPlaylist(prev => {
        if (!prev || fromIndex >= prev.length || toIndex >= prev.length) return prev;
        const next = [...prev];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        return next;
      });
    }

    setPlaylist(prev => {
      if (fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const currentTrack = prev[currentIndex];
      const newPlaylist = [...prev];
      const [movedItem] = newPlaylist.splice(fromIndex, 1);
      newPlaylist.splice(toIndex, 0, movedItem);

      if (currentTrack) {
        const newIdx = newPlaylist.findIndex(s =>
          (currentTrack.queueId && s.queueId === currentTrack.queueId) ||
          s === currentTrack ||
          s.id === currentTrack.id
        );
        if (newIdx !== -1 && newIdx !== currentIndex) {
          queueMicrotask(() => setCurrentIndex(newIdx));
        }
      }
      return newPlaylist;
    });
  };

  return {
    playlist, setPlaylist,
    currentIndex, setCurrentIndex,
    savedPlaylist, setSavedPlaylist,
    savedPlaylists, setSavedPlaylists,
    shouldScrollPlaylistToBottom, setShouldScrollPlaylistToBottom,
    handleAddSong, handleAddSongAfterCurrent, handleAddMultiple,
    handleRemoveSong, handleReorder,
    lastMainPlaylistIndexRef
  };
}
