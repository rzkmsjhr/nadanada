import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

export function useAlbumInfo(currentSong) {
  const [albumInfo, setAlbumInfo] = useState(null);
  const [isLoadingAlbum, setIsLoadingAlbum] = useState(false);
  const cacheRef = useRef({}); // { videoId: { album, artist } }

  useEffect(() => {
    if (!currentSong || currentSong.is_local) {
      setAlbumInfo(null);
      return;
    }

    const videoId = currentSong.id;

    // Check cache first
    if (cacheRef.current[videoId]) {
      setAlbumInfo(cacheRef.current[videoId]);
      return;
    }

    let cancelled = false;
    setAlbumInfo(null);
    setIsLoadingAlbum(true);

    api.getVideoAlbumInfo(videoId).then(info => {
      if (cancelled) return;
      
      // Clean up artist: remove "- Topic" suffix
      let artist = info.artist || '';
      artist = artist.replace(/\s*-\s*Topic$/i, '').trim();
      
      const result = {
        album: info.album || '',
        artist: artist
      };
      
      cacheRef.current[videoId] = result;
      setAlbumInfo(result);
    }).catch(err => {
      console.error('Failed to fetch album info:', err);
      if (!cancelled) setAlbumInfo(null);
    }).finally(() => {
      if (!cancelled) setIsLoadingAlbum(false);
    });

    return () => { cancelled = true; };
  }, [currentSong?.id]);

  return { albumInfo, isLoadingAlbum };
}
