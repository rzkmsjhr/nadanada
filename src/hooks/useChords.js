import { useState, useRef, useEffect } from 'react';
import { parseDuration } from "./useMusicDiscovery";

export function useChords(currentSong, isAudioPlaying, api) {
  const [showChords, setShowChords] = useState(false);
  const [chordsData, setChordsData] = useState(null);
  const [isFetchingChords, setIsFetchingChords] = useState(false);
  const [chordsError, setChordsError] = useState(null);
  const [syncOffset, setSyncOffset] = useState(0);
  const [transposeOffset, setTransposeOffset] = useState(0);
  
  const isFetchingChordsRef = useRef(false);

  useEffect(() => {
    if (currentSong) {
      const savedSync = localStorage.getItem(`sync_${currentSong.id}`);
      setSyncOffset(savedSync ? parseFloat(savedSync) : 0);
      const savedTranspose = localStorage.getItem(`transpose_${currentSong.id}`);
      setTransposeOffset(savedTranspose ? parseInt(savedTranspose, 10) : 0);
      
      if (showChords && isAudioPlaying && (!chordsData || chordsData._songId !== currentSong.id) && !isFetchingChordsRef.current) {
        const fetchChords = async () => {
          isFetchingChordsRef.current = true;
          setIsFetchingChords(true);
          setChordsError(null);
          try {
            // Append the channel/artist name to the title so Google finds the exact artist's version
            let searchTitle = currentSong.title;
            if (currentSong.channel) {
              const cleanChannel = currentSong.channel.replace(/ - Topic/i, '').trim();
              searchTitle = `${searchTitle} ${cleanChannel}`;
            }
            const res = await api.scrapeChords(currentSong.id, searchTitle);
            const parsed = JSON.parse(res);
            if (parsed.success) {
              const chordsList = parsed.data.chords;
              if (chordsList && chordsList.length > 0) {
                const lastChordTime = chordsList[chordsList.length - 1].time_sec;
                const videoDuration = parseDuration(currentSong.duration);

                // Mismatch if chords extend past the video (meaning Chordify's version has a longer intro/body)
                const isTooLong = videoDuration > 0 && lastChordTime > videoDuration + 15;
                // Mismatch if chords end suspiciously early (e.g. they only cover less than 60% of the video length)
                const isTooShort = videoDuration > 0 && lastChordTime < videoDuration * 0.6;
                if (isTooLong || isTooShort) {
                  setChordsError(`Mismatched song version. Not found on Chordify.`);
                  setChordsData({
                    _songId: currentSong.id
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
            setChordsError(e.toString());
            setChordsData({
              _songId: currentSong.id
            });
          } finally {
            isFetchingChordsRef.current = false;
            setIsFetchingChords(false);
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
  }, [currentSong, showChords, isAudioPlaying, api, chordsData]);

  // Save sync and transpose offsets when changed
  useEffect(() => {
    if (currentSong) {
      if (syncOffset !== 0) {
        localStorage.setItem(`sync_${currentSong.id}`, syncOffset.toString());
      } else {
        localStorage.removeItem(`sync_${currentSong.id}`);
      }
      if (transposeOffset !== 0) {
        localStorage.setItem(`transpose_${currentSong.id}`, transposeOffset.toString());
      } else {
        localStorage.removeItem(`transpose_${currentSong.id}`);
      }
    }
  }, [syncOffset, transposeOffset, currentSong]);

  return {
    showChords, setShowChords,
    chordsData, setChordsData,
    isFetchingChords,
    chordsError, setChordsError,
    syncOffset, setSyncOffset,
    transposeOffset, setTransposeOffset
  };
}
