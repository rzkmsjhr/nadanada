import { useState, useRef, useEffect, useCallback } from 'react';
import { parseDuration } from './useMusicDiscovery';

/**
 * Parses standard LRC strings into sorted time-tagged lines
 * Supports multiple timestamps per line: [00:12.34][00:15.67] Line text
 */
export function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const text = trimmed.replace(timeRegex, '').trim();
    for (const match of matches) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const time = min * 60 + sec + ms / 1000;
      result.push({ time, text });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

export function useLyrics(currentSong, isAudioPlaying, api) {
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsData, setLyricsData] = useState(null);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [lyricsError, setLyricsError] = useState(null);
  const [syncOffset, setSyncOffset] = useState(0);

  const songIdForSaveRef = useRef(currentSong?.id);
  songIdForSaveRef.current = currentSong?.id;

  const fetchLyrics = useCallback(async (songToFetch) => {
    const targetSong = songToFetch || currentSong;
    if (!targetSong) return;

    setIsFetchingLyrics(true);
    setLyricsError(null);

    try {
      let title = targetSong.title;
      let artist = targetSong.channel || targetSong.artist || '';
      const durationSec = parseDuration(targetSong.duration);

      const res = await api.getLyrics(title, artist, durationSec, targetSong.id);
      if (songIdForSaveRef.current !== targetSong.id) return;

      if (res.success) {
        if (res.instrumental) {
          setLyricsData({
            isInstrumental: true,
            isSynced: false,
            lines: [],
            source: res.source,
            _songId: targetSong.id
          });
        } else if (res.synced_lyrics) {
          const parsedLines = parseLrc(res.synced_lyrics);
          if (parsedLines.length > 0) {
            setLyricsData({
              isInstrumental: false,
              isSynced: true,
              lines: parsedLines,
              rawLrc: res.synced_lyrics,
              source: res.source,
              _songId: targetSong.id
            });
          } else {
            setLyricsError('No synced lyrics available for this song.');
            setLyricsData({ _songId: targetSong.id });
          }
        } else {
          setLyricsError('No synced lyrics available for this song.');
          setLyricsData({ _songId: targetSong.id });
        }
      } else {
        setLyricsError(res.error || 'No synced lyrics found.');
        setLyricsData({ _songId: targetSong.id });
      }
    } catch (e) {
      if (songIdForSaveRef.current !== targetSong.id) return;
      setLyricsError(e?.message || e?.toString() || 'Failed to fetch lyrics.');
      setLyricsData({ _songId: targetSong.id });
    } finally {
      if (songIdForSaveRef.current === targetSong.id) {
        setIsFetchingLyrics(false);
      }
    }
  }, [currentSong, api]);

  // Load song sync offsets and fetch lyrics when showLyrics is active
  useEffect(() => {
    if (currentSong) {
      const savedSync = localStorage.getItem(`lyrics_sync_${currentSong.id}`);
      setSyncOffset(savedSync ? parseFloat(savedSync) : 0);

      if (showLyrics && (!lyricsData || lyricsData._songId !== currentSong.id)) {
        fetchLyrics(currentSong);
      } else if (!showLyrics) {
        setLyricsData(null);
        setLyricsError(null);
      }
    } else {
      setSyncOffset(0);
      setLyricsData(null);
      setLyricsError(null);
    }
  }, [currentSong?.id, showLyrics]);

  // Save sync offset when changed
  useEffect(() => {
    const id = songIdForSaveRef.current;
    if (id) {
      if (syncOffset !== 0) {
        localStorage.setItem(`lyrics_sync_${id}`, syncOffset.toString());
      } else {
        localStorage.removeItem(`lyrics_sync_${id}`);
      }
    }
  }, [syncOffset]);

  const handleRetry = useCallback(() => {
    if (currentSong) {
      setLyricsData(null);
      setLyricsError(null);
      fetchLyrics(currentSong);
    }
  }, [currentSong, fetchLyrics]);

  return {
    showLyrics,
    setShowLyrics,
    lyricsData,
    setLyricsData,
    isFetchingLyrics,
    lyricsError,
    setLyricsError,
    syncOffset,
    setSyncOffset,
    handleRetry
  };
}
