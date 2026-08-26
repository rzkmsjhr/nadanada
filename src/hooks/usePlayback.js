import { useState } from 'react';

export function usePlayback({
  playlist,
  currentIndex,
  setCurrentIndex,
  previewSong,
  setPreviewSong,
  restoredSong,
  setRestoredSong
}) {
  const [repeatMode, setRepeatMode] = useState(0); // 0=off, 1=repeat, 2=repeat once
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffleHistory, setShuffleHistory] = useState([]);

  const handleNext = () => {
    if (previewSong) setPreviewSong(null);
    if (restoredSong) setRestoredSong(null);
    if (isShuffle) {
      if (playlist.length <= 1) return;
      let nextIdx;
      do {
        nextIdx = Math.floor(Math.random() * playlist.length);
      } while (nextIdx === currentIndex);
      setShuffleHistory(prev => [...prev, currentIndex]);
      setCurrentIndex(nextIdx);
    } else {
      if (currentIndex < playlist.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    }
  };

  const handlePrevious = () => {
    if (previewSong) setPreviewSong(null);
    if (restoredSong) setRestoredSong(null);
    if (isShuffle) {
      if (shuffleHistory.length > 0) {
        const newHistory = [...shuffleHistory];
        const prevIdx = newHistory.pop();
        setShuffleHistory(newHistory);
        setCurrentIndex(prevIdx);
      } else {
        if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
      }
    } else {
      if (currentIndex > 0) {
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
