import { useState } from 'react';

export function usePlayback({
  playlist,
  currentIndex,
  setCurrentIndex,
  previewSong,
  setPreviewSong,
  restoredSong,
  setRestoredSong,
  playerRef
}) {
  const [repeatMode, setRepeatMode] = useState(0); // 0=off, 1=repeat, 2=repeat once
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffleHistory, setShuffleHistory] = useState([]);

  const safeFadeOut = async (durationMs = 180) => {
    if (playerRef?.current && typeof playerRef.current.fadeOut === 'function') {
      try {
        await playerRef.current.fadeOut(durationMs);
      } catch (e) {}
    }
  };

  const handleNext = async (isManual = false) => {
    if (previewSong) setPreviewSong(null);
    if (restoredSong) setRestoredSong(null);
    if (isManual === true) {
      await safeFadeOut(180);
    }
    if (isShuffle) {
      if (playlist.length <= 1) return;
      let nextIdx;
      do {
        nextIdx = Math.floor(Math.random() * playlist.length);
      } while (nextIdx === currentIndex);
      
      if (playlist[currentIndex]) {
        setShuffleHistory(prev => [...prev, playlist[currentIndex].id]);
      }
      setCurrentIndex(nextIdx);
    } else {
      if (currentIndex < playlist.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    }
  };

  const handleManualNext = () => handleNext(true);
  const handleAutoNext = () => handleNext(false);

  const handlePrevious = async () => {
    if (previewSong) setPreviewSong(null);
    if (restoredSong) setRestoredSong(null);
    if (isShuffle) {
      if (shuffleHistory.length > 0) {
        const newHistory = [...shuffleHistory];
        let prevIdx = -1;
        
        while (newHistory.length > 0) {
          const prevId = newHistory.pop();
          const foundIdx = playlist.findIndex(s => s.id === prevId);
          if (foundIdx !== -1) {
            prevIdx = foundIdx;
            break;
          }
        }
        
        setShuffleHistory(newHistory);
        await safeFadeOut(180);
        if (prevIdx !== -1) {
          setCurrentIndex(prevIdx);
        } else {
          if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
        }
      } else {
        if (currentIndex > 0) {
          await safeFadeOut(180);
          setCurrentIndex(currentIndex - 1);
        }
      }
    } else {
      if (currentIndex > 0) {
        await safeFadeOut(180);
        setCurrentIndex(currentIndex - 1);
      }
    }
  };

  return {
    repeatMode, setRepeatMode,
    isShuffle, setIsShuffle,
    shuffleHistory, setShuffleHistory,
    handleNext, handlePrevious
  };
}
