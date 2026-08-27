import { useState, useRef } from 'react';

export function useSearchPreview({
  playerRef,
  playlist,
  currentIndex,
  isAudioPlaying,
  setIsAudioPlaying
}) {
  const [previewSong, setPreviewSong] = useState(null);
  const [restoredSong, setRestoredSong] = useState(null);
  const previewSavedStateRef = useRef(null);

  const handlePlayPreview = async video => {
    if (!previewSavedStateRef.current) {
      let currentTimeSeconds = 0;
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        try {
          const t = await playerRef.current.getCurrentTime();
          if (typeof t === 'number' && !isNaN(t)) {
            currentTimeSeconds = t;
          }
        } catch (e) {}
      }
      previewSavedStateRef.current = {
        song: playlist[currentIndex],
        time: currentTimeSeconds,
        wasPlaying: isAudioPlaying
      };
    }

    // Smoothly fade out currently playing main track
    if (playerRef.current && typeof playerRef.current.fadeOut === 'function') {
      await playerRef.current.fadeOut(200);
    }
    setRestoredSong(null);
    setPreviewSong(video);
    setIsAudioPlaying(true);

    // Smoothly fade in preview track
    setTimeout(() => {
      if (playerRef.current && typeof playerRef.current.fadeIn === 'function') {
        playerRef.current.fadeIn(350);
      }
    }, 120);
  };

  const handleStopPreview = async () => {
    const saved = previewSavedStateRef.current;
    previewSavedStateRef.current = null;

    // Smoothly fade out preview track
    if (playerRef.current && typeof playerRef.current.fadeOut === 'function') {
      await playerRef.current.fadeOut(200);
    }
    setPreviewSong(null);
    if (saved && saved.song) {
      const restoredItem = {
        ...saved.song,
        startSeconds: Math.floor(saved.time || 0)
      };
      setRestoredSong(restoredItem);
      setIsAudioPlaying(saved.wasPlaying);
      setTimeout(() => {
        if (playerRef.current && typeof playerRef.current.fadeIn === 'function') {
          playerRef.current.fadeIn(400);
        }
      }, 150);
    }
  };

  return {
    previewSong, setPreviewSong,
    restoredSong, setRestoredSong,
    previewSavedStateRef,
    handlePlayPreview,
    handleStopPreview
  };
}
