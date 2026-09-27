import { useState, useRef, useEffect, useMemo } from 'react';
import { parseDuration } from "./useMusicDiscovery";

export function useChords(currentSong, isAudioPlaying, api) {
  const [showChords, setShowChords] = useState(false);
  const [chordsData, setChordsData] = useState(null);
  const [isFetchingChords, setIsFetchingChords] = useState(false);
  const [chordsError, setChordsError] = useState(null);
  const [syncOffset, setSyncOffset] = useState(0);
  const [transposeOffset, setTransposeOffset] = useState(0);
  const [bpmOffset, setBpmOffset] = useState(0);
  
  useEffect(() => {
    let isCancelled = false;
    if (currentSong) {
      const savedSync = localStorage.getItem(`sync_${currentSong.id}`);
      setSyncOffset(savedSync ? parseFloat(savedSync) : 0);
      const savedTranspose = localStorage.getItem(`transpose_${currentSong.id}`);
      setTransposeOffset(savedTranspose ? parseInt(savedTranspose, 10) : 0);
      const savedBpm = localStorage.getItem(`bpm_${currentSong.id}`);
      setBpmOffset(savedBpm ? parseFloat(savedBpm) : 0);
      
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

                // Sanity check: if chordifyDurationSec is significantly shorter than lastChordTime, it is bogus
                const effectiveChordifyDurSec = (chordifyDurationSec > 0 && chordifyDurationSec >= lastChordTime - 5)
                  ? chordifyDurationSec
                  : (lastChordTime > 0 ? Math.round(lastChordTime + 5) : 0);

                const displayChordifyDuration = (chordifyDurationSec > 0 && chordifyDurationSec >= lastChordTime - 5)
                  ? parsed.data.chordify_duration
                  : (effectiveChordifyDurSec > 0 
                      ? `${Math.floor(effectiveChordifyDurSec / 60)}:${String(effectiveChordifyDurSec % 60).padStart(2, '0')}` 
                      : parsed.data.chordify_duration);

                // Mismatch heuristics
                // 1. Chords extend past video end by > 12s (e.g. video version with long intro storytelling/dialogue)
                const isTooLong = videoDuration > 0 && lastChordTime > videoDuration + 12;

                // 2. Chords stop way too early (< 55% of song length), meaning transcription cut short / incomplete
                // Applies even on exact video match so stuck/truncated chords are not silently played
                const effectiveSongDuration = videoDuration > 0 ? videoDuration : effectiveChordifyDurSec;
                const isTooShort = effectiveSongDuration > 60 && lastChordTime < effectiveSongDuration * 0.55;

                // 3. If Chordify's actual video duration is known, check if it differs by > 12s (e.g. 3:30 radio edit vs 5:13 album version)
                // Differences <= 12s (e.g. 5:13 audio vs 5:16 music video) are the same song with minor silence/logos
                const isDurationMismatch = Boolean(
                  videoDuration > 0 && effectiveChordifyDurSec > 0 && Math.abs(effectiveChordifyDurSec - videoDuration) > 12
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
                    chordify_duration: displayChordifyDuration || null
                  });
                } else {
                  setChordsData({
                    ...parsed.data,
                    chordify_duration: displayChordifyDuration || parsed.data.chordify_duration,
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
      setBpmOffset(0);
      setChordsData(null);
      setChordsError(null);
    }
    return () => { isCancelled = true; };
  }, [currentSong, showChords, isAudioPlaying, api, chordsData]);

  const songIdForSaveRef = useRef(currentSong?.id);
  songIdForSaveRef.current = currentSong?.id;

  // Save sync, transpose, and bpm offsets when changed
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
      if (bpmOffset !== 0) {
        localStorage.setItem(`bpm_${id}`, bpmOffset.toString());
      } else {
        localStorage.removeItem(`bpm_${id}`);
      }
    }
  }, [syncOffset, transposeOffset, bpmOffset]);

  const effectiveChordsData = useMemo(() => {
    if (!chordsData || !chordsData.chords) return chordsData;
    const baseBpm = chordsData.bpm || 120;
    if (bpmOffset === 0) {
      return { ...chordsData, baseBpm };
    }
    const effectiveBpm = Math.max(30, Math.min(300, baseBpm + bpmOffset));
    const factor = baseBpm / effectiveBpm;
    return {
      ...chordsData,
      bpm: effectiveBpm,
      baseBpm,
      chords: chordsData.chords.map(c => ({
        ...c,
        time_sec: c.time_sec * factor
      }))
    };
  }, [chordsData, bpmOffset]);

  return {
    showChords, setShowChords,
    chordsData: effectiveChordsData,
    rawChordsData: chordsData,
    setChordsData,
    isFetchingChords,
    chordsError, setChordsError,
    syncOffset, setSyncOffset,
    transposeOffset, setTransposeOffset,
    bpmOffset, setBpmOffset
  };
}
