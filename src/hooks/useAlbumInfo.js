import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

export function useAlbumInfo(playlist, currentIndex) {
  const [albumCache, setAlbumCache] = useState(() => {
    try {
      const stored = localStorage.getItem('nadanada_album_cache');
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      const clean = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object' && !v.artist?.includes('\uFFFD') && !v.album?.includes('\uFFFD')) {
          clean[k] = v;
        }
      }
      return clean;
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

  const hasValidCache = (id) => {
    const item = albumCache[id];
    return Boolean(item && !item.artist?.includes('\uFFFD') && !item.album?.includes('\uFFFD'));
  };

  useEffect(() => {
    if (!playlist || playlist.length === 0) return;

    // Prioritize current song, then upcoming songs, then previous songs
    const missing = [];
    const len = playlist.length;

    // Check current song if index is valid
    if (currentIndex >= 0 && currentIndex < len) {
      const current = playlist[currentIndex];
      if (current && !current.is_local && current.id && !hasValidCache(current.id)) {
        missing.push(current.id);
      }

      // Upcoming songs (currentIndex + 1 to len - 1)
      for (let i = currentIndex + 1; i < len; i++) {
        const item = playlist[i];
        if (item && !item.is_local && item.id && !hasValidCache(item.id)) {
          missing.push(item.id);
        }
      }

      // Previous songs (0 to currentIndex - 1)
      for (let i = 0; i < currentIndex; i++) {
        const item = playlist[i];
        if (item && !item.is_local && item.id && !hasValidCache(item.id)) {
          missing.push(item.id);
        }
      }
    } else {
      // If currentIndex is out of range, safely scan all playlist items
      for (let i = 0; i < len; i++) {
        const item = playlist[i];
        if (item && !item.is_local && item.id && !hasValidCache(item.id)) {
          missing.push(item.id);
        }
      }
    }

    queueRef.current = Array.from(new Set(missing.filter(Boolean)));

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
          artist = artist.replace(/Elley\s+Duh[\uFFFD\?]/gi, 'Elley Duhé');
          let album = (info.album || '').trim().replace(/Elley\s+Duh[\uFFFD\?]/gi, 'Elley Duhé');
          
          const result = {
            album: album,
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

  const currentSong = (playlist && currentIndex >= 0 && currentIndex < playlist.length)
    ? playlist[currentIndex]
    : null;
  const albumInfo = currentSong?.id ? albumCache[currentSong.id] : null;
  const isLoadingAlbum = Boolean(currentSong && !currentSong.is_local && currentSong.id && !hasValidCache(currentSong.id));

  return { albumInfo, isLoadingAlbum, albumCache };
}
