import { useState, useRef, useEffect, useCallback } from 'react';
import { resolveHifiForTrack, getCachedHifi, HIFI_MATCHER_VERSION } from '../services/hifiResolver';

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
        ? parsed.map(s => (s && s.stream_url && s.hifi_id && String(s.hifi_id) !== String(s.id) && s._hifiVersion !== HIFI_MATCHER_VERSION)
            ? { ...s, stream_url: null, source: null, hifi_id: null, _hifiChecked: false }
            : s)
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
          setSavedPlaylists(parsed);
        } else {
          // One-time migration from localStorage
          const lsData = localStorage.getItem('nadanada-saved-playlists');
          if (lsData) {
            try {
              const lsParsed = JSON.parse(lsData);
              if (lsParsed && lsParsed.length > 0) {
                setSavedPlaylists(lsParsed);
                await api.savePlaylists(lsData);
                localStorage.removeItem('nadanada-saved-playlists');
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error('Failed to load playlists from file, using localStorage fallback:', e);
        try {
          const lsData = localStorage.getItem('nadanada-saved-playlists');
          if (lsData) setSavedPlaylists(JSON.parse(lsData));
        } catch {}
      } finally {
        playlistsLoadedRef.current = true;
      }
    };
    loadPlaylists();
  }, [api]);

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

    let hifiFields = {};
    if (isHifiEnabled && video && !video.is_local && !video.file_path) {
      if (video.stream_url && video.source === 'monochrome' && (!video.hifi_id || String(video.hifi_id) === String(video.id) || video._hifiVersion === HIFI_MATCHER_VERSION)) {
        hifiFields = { _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION };
      } else {
        try {
          const hifi = await resolveHifiForTrack(video);
          if (hifi && hifi.stream_url) {
            hifiFields = {
              stream_url: hifi.stream_url,
              source: 'monochrome',
              hifi_id: hifi.hifi_id,
              _hifiChecked: true,
              _hifiVersion: HIFI_MATCHER_VERSION
            };
          } else {
            hifiFields = {
              stream_url: null,
              source: null,
              hifi_id: null,
              _hifiChecked: true,
              _hifiVersion: HIFI_MATCHER_VERSION
            };
          }
        } catch (e) {
          hifiFields = { _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION };
        }
      }
    }

    const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newSong = {
      ...video,
      ...hifiFields,
      queueId
    };
    const afterCurrent = Boolean(options?.afterCurrent);
    const currIdx = currentIndexRef.current;

    if (savedPlaylist) {
      setSavedPlaylist(prev => {
        if (afterCurrent && currIdx >= 0 && currIdx < prev.length) {
          const next = [...prev];
          next.splice(currIdx + 1, 0, newSong);
          return next;
        }
        return [...prev, newSong];
      });
    }

    setPlaylist(prev => {
      if (afterCurrent && currIdx >= 0 && currIdx < prev.length) {
        const next = [...prev];
        next.splice(currIdx + 1, 0, newSong);
        return next;
      }
      return [...prev, newSong];
    });
  };

  const handleAddSongAfterCurrent = async video => {
    await handleAddSong(video, { afterCurrent: true });
  };

  const handleAddMultiple = async videos => {
    if (showSearch) {
      hasAddedSongInSearchRef.current = true;
    }
    if (!videos || videos.length === 0) return;

    let firstTrackHifi = null;
    if (isHifiEnabled && videos[0] && !videos[0].is_local && !videos[0].stream_url) {
      try {
        firstTrackHifi = await resolveHifiForTrack(videos[0]);
      } catch (e) {}
    }

    const timestamp = Date.now();
    const newSongs = videos.map((video, idx) => {
      let hifiFields = {};
      if (isHifiEnabled && !video.is_local && !video.stream_url) {
        if (idx === 0) {
          if (firstTrackHifi && firstTrackHifi.stream_url) {
            hifiFields = {
              stream_url: firstTrackHifi.stream_url,
              source: 'monochrome',
              hifi_id: firstTrackHifi.hifi_id,
              _hifiChecked: true,
              _hifiVersion: HIFI_MATCHER_VERSION
            };
          } else {
            hifiFields = { _hifiChecked: true, _hifiVersion: HIFI_MATCHER_VERSION };
          }
        } else {
          const cached = getCachedHifi(video);
          if (cached && cached.stream_url) {
            hifiFields = {
              stream_url: cached.stream_url,
              source: 'monochrome',
              hifi_id: cached.hifi_id,
              _hifiChecked: true,
              _hifiVersion: HIFI_MATCHER_VERSION
            };
          }
        }
      }
      return {
        ...video,
        ...hifiFields,
        queueId: (timestamp + idx).toString() + Math.random().toString(36).substr(2, 9)
      };
    });
    setPlaylist(prev => [...prev, ...newSongs]);
    if (savedPlaylist) {
      setSavedPlaylist(prev => [...prev, ...newSongs]);
    }
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
