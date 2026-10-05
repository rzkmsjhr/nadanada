import { useState, useRef, useCallback } from 'react';
import { api } from '../services/api';

export function useArtistPage() {
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [artistDetails, setArtistDetails] = useState(null);
  const [isLoadingArtist, setIsLoadingArtist] = useState(false);
  const [artistError, setArtistError] = useState(null);
  const [isLoadingMoreSongs, setIsLoadingMoreSongs] = useState(false);
  const artistCacheRef = useRef(new Map());

  const openArtistPage = useCallback(async (artistName, artistBrowseId = null) => {
    if (!artistName || !artistName.trim()) return;
    const cleanName = artistName.replace(/\s*-\s*Topic$/i, '').trim();
    const cacheKey = cleanName.toLowerCase();

    setSelectedArtist(cleanName);
    setArtistError(null);

    if (artistCacheRef.current.has(cacheKey)) {
      setArtistDetails(artistCacheRef.current.get(cacheKey));
      setIsLoadingArtist(false);
      return;
    }

    setIsLoadingArtist(true);
    setArtistDetails(null);

    try {
      const details = await api.getArtistDetails(cleanName, artistBrowseId);
      artistCacheRef.current.set(cacheKey, details);
      setArtistDetails(details);
    } catch (err) {
      console.error('Failed to load artist details:', err);
      setArtistError(err?.message || String(err));
    } finally {
      setIsLoadingArtist(false);
    }
  }, []);

  const closeArtistPage = useCallback(() => {
    setSelectedArtist(null);
    setArtistDetails(null);
    setArtistError(null);
  }, []);

  const loadMoreTopSongs = useCallback(async () => {
    if (!artistDetails?.top_songs_playlist_id || isLoadingMoreSongs) return;

    setIsLoadingMoreSongs(true);
    try {
      const moreSongs = await api.getArtistTopSongs(artistDetails.top_songs_playlist_id);
      if (moreSongs && moreSongs.length > 0) {
        setArtistDetails(prev => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            top_songs: moreSongs,
            has_loaded_all: true
          };
          if (prev.name) {
            artistCacheRef.current.set(prev.name.toLowerCase(), updated);
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to load all top songs:', err);
    } finally {
      setIsLoadingMoreSongs(false);
    }
  }, [artistDetails, isLoadingMoreSongs]);

  return {
    selectedArtist,
    artistDetails,
    isLoadingArtist,
    artistError,
    isLoadingMoreSongs,
    openArtistPage,
    closeArtistPage,
    loadMoreTopSongs
  };
}
