import { useState, useEffect, useMemo } from 'react';

export function useDownloadManager(api, setGlobalError) {
  const [showDownloadedList, setShowDownloadedList] = useState(false);
  const [downloadedSongs, setDownloadedSongs] = useState([]);
  const [downloadingSongId, setDownloadingSongId] = useState(null);

  // Derive Set so it maintains a stable reference unless the actual song IDs change
  const downloadedIdsStr = downloadedSongs.map(s => s.id).sort().join(',');
  const downloadedIds = useMemo(() => new Set(downloadedSongs.map(s => s.id)), [downloadedIdsStr]);

  const loadDownloadedSongs = async () => {
    try {
      const songs = await api.getDownloadedSongs();
      setDownloadedSongs(prev => {
        if (prev.length === songs.length && prev.every((s, i) => s.id === songs[i].id)) return prev;
        return songs;
      });
    } catch (e) {
      console.error('Failed to load downloaded songs:', e);
    }
  };

  useEffect(() => {
    if (showDownloadedList) {
      loadDownloadedSongs();
    }
  }, [showDownloadedList]);

  useEffect(() => {
    loadDownloadedSongs();
    const interval = setInterval(loadDownloadedSongs, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDownloadSong = async song => {
    if (downloadingSongId) return; // Prevent multiple simultaneous downloads
    setDownloadingSongId(song.id);
    try {
      let title = song.title.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/official|music|video|audio|hd|hq|lyrics/ig, ' ').replace(/\s+/g, ' ').trim();
      let artist = '';
      const parts = title.split(' - ');
      if (parts.length > 1) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        artist = song.channel ? song.channel.replace(/ - Topic/i, '').trim() : 'Unknown';
      }
      await api.downloadSong(song.id, title, artist);
      if (showDownloadedList) {
        loadDownloadedSongs();
      }
      setDownloadedSongs(prev => {
        if (prev.find(s => s.id === song.id)) return prev;
        return [...prev, {
          id: song.id,
          file_path: ''
        }]; // Optimistic update
      });
    } catch (e) {
      console.error('Download failed:', e);
      setGlobalError(`Failed to download song: ${e.toString()}`);
    } finally {
      setDownloadingSongId(null);
    }
  };

  return {
    showDownloadedList, setShowDownloadedList,
    downloadedSongs, setDownloadedSongs,
    downloadingSongId,
    downloadedIds,
    loadDownloadedSongs,
    handleDownloadSong
  };
}
