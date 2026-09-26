import { useState, useRef, useEffect } from 'react';
import { parseDuration } from "./useMusicDiscovery";

export function useChords(currentSong, isAudioPlaying, api) {
  const [showChords, setShowChords] = useState(false);
  const [chordsData, setChordsData] = useState(null);
  const [isFetchingChords, setIsFetchingChords] = useState(false);
  const [chordsError, setChordsError] = useState(null);
  const [syncOffset, setSyncOffset] = useState(0);
  const [transposeOffset, setTransposeOffset] = useState(0);
  
  useEffect(() => {
    let isCancelled = false;
    if (currentSong) {
      const savedSync = localStorage.getItem(`sync_${currentSong.id}`);
      setSyncOffset(savedSync ? parseFloat(savedSync) : 0);
      const savedTranspose = localStorage.getItem(`transpose_${currentSong.id}`);
      setTransposeOffset(savedTranspose ? parseInt(savedTranspose, 10) : 0);
      
      if (showChords && isAudioPlaying && (!chordsData || chordsData._songId !== currentSong.id)) {
        const fetchChords = async () => {
          setIsFetchingChords(true);
          setChordsError(null);
          try {
            // Clean title of bracketed extras like (2024 Remaster), [Official Audio]
            let cleanSongTitle = (currentSong.title || '')
              .replace(/\s*\([^)]*\)/g, '')
              .replace(/\s*\[[^\]]*\]/g, '')
              .replace(/\s*\{[^}]*\}/g, '')
              .trim();
            const cleanChannel = (currentSong.channel || '').replace(/\s*-\s*Topic$/i, '').trim();
            const searchTitle = cleanChannel ? `${cleanSongTitle} ${cleanChannel}` : cleanSongTitle;
            const res = await api.scrapeChords(currentSong.id, searchTitle, currentSong.duration);
            if (isCancelled) return;
            
            const parsed = JSON.parse(res);
            if (parsed.success) {
              const chordsList = parsed.data.chords;
              if (chordsList && chordsList.length > 0) {
                const lastChordTime = chordsList[chordsList.length - 1].time_sec;
                const videoDuration = parseDuration(currentSong.duration);

                // Check if Chordify returned the exact same YouTube video ID
                const chordifyVideoId = parsed.data.chordify_video_id;
                const isExactVideoMatch = Boolean(chordifyVideoId && chordifyVideoId === currentSong.id);

                const chordifyDurationSec = parseDuration(parsed.data.chordify_duration);

                // Mismatch heuristics
                // 1. Chords extend past video end by > 5s (e.g. video version with long intro storytelling/dialogue)
                const isTooLong = videoDuration > 0 && lastChordTime > videoDuration + 5;

                // 2. Chords stop way too early (< 60% of song length), meaning transcription cut short / incomplete
                // Applies even on exact video match so stuck/truncated chords are not silently played
                const isTooShort = videoDuration > 60 && lastChordTime < videoDuration * 0.6;

                // 3. If Chordify's actual video duration is known, check if it differs by > 5s (e.g. 5:54 audio vs 6:04 music video)
                // NOTE: We compare chordifyDurationSec to videoDuration, NOT lastChordTime, because many songs have instrument-free outros!
                const isDurationMismatch = Boolean(
                  videoDuration > 0 && chordifyDurationSec > 0 && Math.abs(chordifyDurationSec - videoDuration) > 5
                );

                const isMismatch = isTooShort || (!isExactVideoMatch && (isTooLong || isDurationMismatch));

                if (isMismatch) {
                  const errorMsg = isTooShort
                    ? `Incomplete chord transcription on Chordify (stops at ${Math.floor(lastChordTime / 60)}:${String(Math.floor(lastChordTime % 60)).padStart(2, '0')}).`
                    : `Mismatched song version. Chordify has a different version.`;
                  setChordsError(errorMsg);
                  setChordsData({
                    _songId: currentSong.id,
                    chordify_video_id: parsed.data.chordify_video_id || null,
                    chordify_title: parsed.data.chordify_title || null,
                    chordify_channel: parsed.data.chordify_channel || null,
                    chordify_thumbnail: parsed.data.chordify_thumbnail || null,
                    chordify_duration: parsed.data.chordify_duration || null
                  });
                } else {
                  setChordsData({
                    ...parsed.data,
                    _songId: currentSong.id
                  });
                }
              } else {
                setChordsData({
                  ...parsed.data,
                  _songId: currentSong.id
                });
              }
            } else {
              setChordsError(parsed.error);
              setChordsData({
                _songId: currentSong.id
              });
            }
          } catch (e) {
            if (isCancelled) return;
            setChordsError(e.toString());
            setChordsData({
              _songId: currentSong.id
            });
          } finally {
            if (!isCancelled) setIsFetchingChords(false);
          }
        };
        fetchChords();
      } else if (!showChords) {
        setChordsData(null);
        setChordsError(null);
      }
    } else {
      setSyncOffset(0);
      setTransposeOffset(0);
      setChordsData(null);
      setChordsError(null);
    }
    return () => { isCancelled = true; };
  }, [currentSong, showChords, isAudioPlaying, api, chordsData]);

  const songIdForSaveRef = useRef(currentSong?.id);
  songIdForSaveRef.current = currentSong?.id;

  // Save sync and transpose offsets when changed
  useEffect(() => {
    const id = songIdForSaveRef.current;
    if (id) {
      if (syncOffset !== 0) {
        localStorage.setItem(`sync_${id}`, syncOffset.toString());
      } else {
        localStorage.removeItem(`sync_${id}`);
      }
      if (transposeOffset !== 0) {
        localStorage.setItem(`transpose_${id}`, transposeOffset.toString());
      } else {
        localStorage.removeItem(`transpose_${id}`);
      }
    }
  }, [syncOffset, transposeOffset]);

  return {
    showChords, setShowChords,
    chordsData, setChordsData,
    isFetchingChords,
    chordsError, setChordsError,
    syncOffset, setSyncOffset,
    transposeOffset, setTransposeOffset
  };
}
