import { useState, useRef, useEffect } from 'react';

export function usePlaylistManager({
  api,
  showSearch,
  hasAddedSongInSearchRef
}) {
  const [playlist, setPlaylist] = useState(() => {
    try {
      const saved = localStorage.getItem('nadanada-session-playlist');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to parse session playlist:', e);
      return [];
    }
  });

  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = localStorage.getItem('nadanada-session-index');
    const parsed = saved ? parseInt(saved, 10) : 0;
    return isNaN(parsed) ? 0 : parsed;
  });

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

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('nadanada-session-playlist', JSON.stringify(playlist));
      localStorage.setItem('nadanada-session-index', currentIndex.toString());
    }, 500);
    return () => clearTimeout(timer);
  }, [playlist, currentIndex]);

  useEffect(() => {
    if (!playlistsLoadedRef.current) return; // Don't overwrite the file before we've loaded it
    const timer = setTimeout(() => {
      api.savePlaylists(JSON.stringify(savedPlaylists)).catch(e => console.error('Failed to save playlists to file:', e));
    }, 500);
    return () => clearTimeout(timer);
  }, [savedPlaylists, api]);

  const handleAddSong = video => {
    console.log("handleAddSong called. showSearch is:", showSearch);
    if (showSearch) {
      hasAddedSongInSearchRef.current = true;
    }
    const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newSong = {
      ...video,
      queueId
    };
    if (savedPlaylist) {
      setSavedPlaylist(prev => [...prev, newSong]);
    } else {
      setPlaylist(prev => [...prev, newSong]);
    }
  };

  const handleAddMultiple = videos => {
    if (showSearch) {
      hasAddedSongInSearchRef.current = true;
    }
    const timestamp = Date.now();
    const newSongs = videos.map((video, idx) => ({
      ...video,
      queueId: (timestamp + idx).toString() + Math.random().toString(36).substr(2, 9)
    }));
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
    if (fromIndex === toIndex) return;
    setPlaylist(prev => {
      const currentTrack = prev[currentIndex];
      const newPlaylist = [...prev];
      const [movedItem] = newPlaylist.splice(fromIndex, 1);
      newPlaylist.splice(toIndex, 0, movedItem);

      if (currentTrack) {
        const newIdx = newPlaylist.findIndex(s => s.id === currentTrack.id);
        if (newIdx !== -1) {
          setCurrentIndex(newIdx);
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
    handleAddSong, handleAddMultiple,
    handleRemoveSong, handleReorder
  };
}
