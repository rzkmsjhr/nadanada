import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

export function useAlbumInfo(playlist, currentIndex) {
  const [albumCache, setAlbumCache] = useState(() => {
    try {
      const stored = localStorage.getItem('nadanada_album_cache');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  }); // { videoId: { album, artist, albumPlaylistId } }
  const queueRef = useRef([]);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem('nadanada_album_cache', JSON.stringify(albumCache));
    } catch (e) {
      console.error('Failed to save album cache:', e);
    }
  }, [albumCache]);

  const inFlightRef = useRef(new Set());

  useEffect(() => {
    if (!playlist || playlist.length === 0) return;

    // Prioritize current song, then upcoming songs, then previous songs
    const missing = [];
    const current = playlist[currentIndex];
    
    if (current && !current.is_local && !albumCache[current.id]) {
      missing.push(current.id);
    }
    for (let i = currentIndex + 1; i < playlist.length; i++) {
      if (!playlist[i].is_local && !albumCache[playlist[i].id]) missing.push(playlist[i].id);
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!playlist[i].is_local && !albumCache[playlist[i].id]) missing.push(playlist[i].id);
    }

    queueRef.current = Array.from(new Set(missing));

    const processQueue = async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      
      while (queueRef.current.length > 0) {
        const videoId = queueRef.current.shift();
        
        // Skip if currently fetching or already fetched in this session
        if (inFlightRef.current.has(videoId)) continue;
        inFlightRef.current.add(videoId);
        
        try {
          const info = await api.getVideoAlbumInfo(videoId);
          let artist = info.artist || '';
          artist = artist.replace(/\s*-\s*Topic$/i, '').trim();
          
          const result = {
            album: info.album || '',
            artist: artist,
            albumPlaylistId: info.album_playlist_id || ''
          };
          
          setAlbumCache(prev => ({ ...prev, [videoId]: result }));
        } catch (err) {
          console.error('Failed to fetch album info for', videoId, err);
          // Keep it in inFlightRef to prevent infinite retries during this session for unfetchable videos.
          // It will retry on the next app restart in case it was a temporary network issue.
          
          // Pause queue briefly on error to prevent rapid-fire failures if offline
          await new Promise(r => setTimeout(r, 5000));
          continue; 
        }

        // Throttle requests to avoid yt-dlp spam / rate limits
        await new Promise(r => setTimeout(r, 1500));
      }
      
      isFetchingRef.current = false;
    };

    processQueue();
  }, [playlist, currentIndex]); // Don't depend on albumCache to avoid infinite loops

  const currentSong = playlist?.[currentIndex];
  const albumInfo = currentSong ? albumCache[currentSong.id] : null;
  const isLoadingAlbum = currentSong && !currentSong.is_local && !albumCache[currentSong.id];

  return { albumInfo, isLoadingAlbum, albumCache };
}
