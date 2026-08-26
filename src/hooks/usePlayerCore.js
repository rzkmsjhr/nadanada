import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

export function usePlayerCore({
  currentSong,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  onPlayStateChange,
  onTimeUpdate,
  onError,
  repeatMode,
  onSongEnded,
}) {
  const playerRef = useRef(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [masterVolume, setMasterVolume] = useState(() => {
    const saved = localStorage.getItem('nadanada-volume');
    const parsed = saved ? parseInt(saved, 10) : 100;
    return isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
  });
  const [isMuted, setIsMuted] = useState(false);
  
  // Persist volume preference across sessions
  useEffect(() => {
    localStorage.setItem('nadanada-volume', masterVolume.toString());
  }, [masterVolume]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  
  const [streamUrl, setStreamUrl] = useState(null);
  const [isExtractingStream, setIsExtractingStream] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);
  const [captions, setCaptions] = useState([]);
  const [activeCaptionCode, setActiveCaptionCode] = useState(null);
  const [isVideoHovered, setIsVideoHovered] = useState(false);
  const [isCaptionMenuOpen, setIsCaptionMenuOpen] = useState(false);
  const hasAutoSelectedCaptionRef = useRef(false);
  
  // Track how many times this specific song has repeated for 'repeat once' mode
  const [playCount, setPlayCount] = useState(0);

  const stallTimeoutRef = useRef(null);

  const handleCaptionsReceived = (tracks) => {
    setCaptions(tracks || []);
    if (tracks && tracks.length > 0 && !hasAutoSelectedCaptionRef.current) {
      hasAutoSelectedCaptionRef.current = true;
      // Prefer Indonesian or non-English/non-auto translated tracks first, fallback to first track
      const preferred = tracks.find(t => t.languageCode === 'id') || 
                        tracks.find(t => t.languageCode !== 'en' && t.languageCode !== 'en-US' && t.languageCode !== 'a.en') || 
                        tracks[0];
      if (preferred && playerRef.current && playerRef.current.setCaption) {
        playerRef.current.setCaption(preferred.languageCode);
        setActiveCaptionCode(preferred.languageCode);
      }
    }
  };
  
  const selectCaption = (code) => {
    if (playerRef.current && playerRef.current.setCaption) {
      playerRef.current.setCaption(code || false);
    }
    setActiveCaptionCode(code);
    setIsCaptionMenuOpen(false);
  };
  
  const handleStallStart = () => {
    setIsBuffering(true);
    if (currentSong && !currentSong.is_local && !stallTimeoutRef.current) {
      stallTimeoutRef.current = setTimeout(() => {
        console.warn("Audio stream stalled for 10s. Skipping.");
        if (hasNext) onNext();
        else if (onError) onError("Stream stalled and failed to recover.");
      }, 10000);
    }
  };

  const handleStallClear = () => {
    setIsBuffering(false);
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    let timeout;
    if (isBuffering && !streamUrl && !isExtractingStream && currentSong && !currentSong.is_local) {
      if (currentTime < 1) {
        timeout = setTimeout(() => {
          console.warn("YouTube iframe stuck buffering for 15s at start. Triggering fallback.");
          setIsExtractingStream(true);
          api.getStreamUrl(currentSong.id)
            .then(url => {
              setStreamUrl(url);
              setIsExtractingStream(false);
            })
            .catch(err => {
              console.error("Stream extraction fallback failed:", err);
              setIsExtractingStream(false);
              if (hasNext) onNext();
              else {
                setIsPlaying(false);
                if (onPlayStateChange) onPlayStateChange(false);
                if (onError) onError(`Failed to stream track from YouTube: ${err.message || err}`);
              }
            });
        }, 15000); // 15 seconds to be safe for slow connections
      }
    }
    return () => clearTimeout(timeout);
  }, [isBuffering, streamUrl, isExtractingStream, currentSong, currentTime]);

  const songId = currentSong?.id;
  const startSecs = Math.floor(currentSong?.startSeconds || currentSong?.initialTime || 0);
  const prevSongIdRef = useRef(null);
  const hasSeekedInitialRef = useRef(false);

  useEffect(() => {
    hasSeekedInitialRef.current = false;
  }, [songId, startSecs]);

  useEffect(() => {
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }
    if (songId) {
      setStreamUrl(null);
      hasAutoSelectedCaptionRef.current = false;
      setCaptions([]);
      setActiveCaptionCode(null);
      setIsExtractingStream(false);
      setIsBuffering(true);
      setIsPlaying(false);
      setCurrentTime(startSecs);
      setDuration(0);
      setPlayCount(0); // Reset repeat counter for new song

      if (prevSongIdRef.current === songId && playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
        try {
          playerRef.current.loadVideoById(songId, startSecs);
        } catch (e) {
          console.error("Failed to loadVideoById:", e);
        }
      }
      prevSongIdRef.current = songId;
    } else {
      prevSongIdRef.current = null;
      if (playerRef.current && typeof playerRef.current.stopVideo === 'function') {
        try { playerRef.current.stopVideo(); } catch (e) {}
      }
      setIsBuffering(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setPlayCount(0);
    }
  }, [songId, startSecs]);

  // Time tracking
  useEffect(() => {
    let interval;
    // Do not poll the YouTube player if we are using the local audio fallback (streamUrl is set)
    if (isPlaying && !isDragging && (!currentSong || !currentSong.is_local) && !streamUrl) {
      interval = setInterval(async () => {
        if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
          try {
            const time = await playerRef.current.getCurrentTime();
            const dur = await playerRef.current.getDuration();
            setCurrentTime(time || 0);
            if (onTimeUpdate) onTimeUpdate(time || 0);
            setDuration(dur || 0);
          } catch (e) {}
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isDragging, currentSong, streamUrl]);

  // --- Media Session API Integration for SMTC ---
  useEffect(() => {
    if ('mediaSession' in navigator) {
      if (currentSong) {
        let title = currentSong.title;
        let artist = currentSong.channel ? currentSong.channel.replace(/ - Topic/i, '').trim() : 'Unknown Artist';
        
        const parts = currentSong.title.split('-');
        if (parts.length > 1 && (!currentSong.channel || currentSong.channel.toLowerCase().includes('topic'))) {
            artist = parts[0].trim();
            title = parts.slice(1).join('-').trim();
        }

        title = title.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/official|music|video|audio|hd|hq|lyrics/ig, ' ').replace(/\s+/g, ' ').trim();

        navigator.mediaSession.metadata = new MediaMetadata({
          title: title || currentSong.title,
          artist: artist,
          artwork: currentSong.thumbnail ? [
            { src: currentSong.thumbnail, sizes: '512x512', type: 'image/jpeg' }
          ] : []
        });
      } else {
        navigator.mediaSession.metadata = null;
      }
    }
  }, [currentSong]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  useEffect(() => {
    if ('mediaSession' in navigator && currentSong && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: 1.0,
          position: currentTime
        });
      } catch (e) {}
    }
  }, [currentTime, duration, currentSong]);

  const togglePlay = () => {
    if (currentSong && (currentSong.is_local || streamUrl)) {
      const audioEl = document.getElementById('local-audio-player');
      if (audioEl) {
        if (isPlaying) audioEl.pause();
        else audioEl.play();
      }
      return;
    }
    
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (currentSong && (currentSong.is_local || streamUrl)) {
      const audioEl = document.getElementById('local-audio-player');
      if (audioEl) audioEl.muted = !isMuted;
      return;
    }
    
    if (playerRef.current) {
      if (!isMuted) playerRef.current.mute();
      else {
        playerRef.current.unMute();
        playerRef.current.setVolume(masterVolume);
      }
    }
  };

  const togglePlayRef = useRef(null);
  const toggleMuteRef = useRef(null);
  togglePlayRef.current = togglePlay;
  toggleMuteRef.current = toggleMute;

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => togglePlayRef.current?.());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayRef.current?.());
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious ? () => onPrevious() : null);
      navigator.mediaSession.setActionHandler('nexttrack', hasNext ? () => onNext() : null);
    }
  }, [isPlaying, hasPrevious, hasNext, onPrevious, onNext]);

  const activeFadeIntervalRef = useRef(null);

  const applyVolume = (vol) => {
    if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
      try { playerRef.current.setVolume(vol); } catch (e) {}
    }
    const audioEl = document.getElementById('local-audio-player');
    if (audioEl) {
      try { audioEl.volume = Math.max(0, Math.min(1, vol / 100)); } catch (e) {}
    }
  };

  const fadeOut = (durationMs = 250) => {
    return new Promise((resolve) => {
      if (activeFadeIntervalRef.current) {
        clearInterval(activeFadeIntervalRef.current);
        activeFadeIntervalRef.current = null;
      }
      const startVol = isMuted ? 0 : masterVolume;
      if (startVol <= 0) {
        applyVolume(0);
        resolve();
        return;
      }
      const steps = 10;
      const stepTime = durationMs / steps;
      let step = 0;

      activeFadeIntervalRef.current = setInterval(() => {
        step++;
        const curVol = Math.max(0, Math.round(startVol * (1 - step / steps)));
        applyVolume(curVol);
        if (step >= steps || curVol <= 0) {
          clearInterval(activeFadeIntervalRef.current);
          activeFadeIntervalRef.current = null;
          resolve();
        }
      }, stepTime);
    });
  };

  const fadeIn = (durationMs = 350) => {
    return new Promise((resolve) => {
      if (activeFadeIntervalRef.current) {
        clearInterval(activeFadeIntervalRef.current);
        activeFadeIntervalRef.current = null;
      }
      const targetVol = isMuted ? 0 : masterVolume;
      if (targetVol <= 0) {
        applyVolume(0);
        resolve();
        return;
      }
      applyVolume(0);
      const steps = 12;
      const stepTime = durationMs / steps;
      let step = 0;

      activeFadeIntervalRef.current = setInterval(() => {
        step++;
        const curVol = Math.min(targetVol, Math.round(targetVol * (step / steps)));
        applyVolume(curVol);
        if (step >= steps || curVol >= targetVol) {
          clearInterval(activeFadeIntervalRef.current);
          activeFadeIntervalRef.current = null;
          applyVolume(targetVol);
          resolve();
        }
      }, stepTime);
    });
  };

  const onReady = (event) => {
    playerRef.current = event.target;
    if (!activeFadeIntervalRef.current) {
      event.target.setVolume(isMuted ? 0 : masterVolume);
    }
    if (startSecs > 0) {
      try {
        event.target.seekTo(startSecs, true);
      } catch (e) {}
    }
    try {
      event.target.playVideo();
    } catch (e) {}
  };

  const handleTrackEnd = () => {
    if (repeatMode === 1) {
      // Repeat infinitely: just seek to 0 and play again
      setCurrentTime(0);
      if (onTimeUpdate) onTimeUpdate(0);
      
      if (streamUrl || (currentSong && currentSong.is_local)) {
        const audioEl = document.getElementById('local-audio-player');
        if (audioEl) { audioEl.currentTime = 0; audioEl.play(); }
      } else if (playerRef.current) {
        playerRef.current.seekTo(0, true);
        playerRef.current.playVideo();
      }
    } else if (repeatMode === 2) {
      // Repeat once: play twice in total
      if (playCount < 1) {
        setPlayCount(1);
        setCurrentTime(0);
        if (onTimeUpdate) onTimeUpdate(0);
        
        if (streamUrl || (currentSong && currentSong.is_local)) {
          const audioEl = document.getElementById('local-audio-player');
          if (audioEl) { audioEl.currentTime = 0; audioEl.play(); }
        } else if (playerRef.current) {
          playerRef.current.seekTo(0, true);
          playerRef.current.playVideo();
        }
      } else {
        // Already played twice, move to next
        setIsPlaying(false);
        setIsBuffering(false);
        if (onPlayStateChange) onPlayStateChange(false);
        setCurrentTime(0);
        if (onTimeUpdate) onTimeUpdate(0);
        
        if (onSongEnded) onSongEnded();
        else if (hasNext) onNext();
      }
    } else {
      // Normal playback: move to next
      setIsPlaying(false);
      setIsBuffering(false);
      if (onPlayStateChange) onPlayStateChange(false);
      setCurrentTime(0);
      if (onTimeUpdate) onTimeUpdate(0);
      
      if (onSongEnded) onSongEnded();
      else if (hasNext) onNext();
    }
  };

  const onStateChange = (event) => {
    if (event.data === 1) { // PLAYING
      setIsPlaying(true);
      setIsBuffering(false);
      if (onPlayStateChange) onPlayStateChange(true);
      
      // Force volume application on every track change, as YouTube sometimes resets it
      if (!activeFadeIntervalRef.current) {
        try { event.target.setVolume(isMuted ? 0 : masterVolume); } catch (e) {}
      }

      if (startSecs > 0 && !hasSeekedInitialRef.current) {
        hasSeekedInitialRef.current = true;
        try {
          event.target.seekTo(startSecs, true);
        } catch (e) {}
      }
    } else if (event.data === 2) { // PAUSED
      setIsPlaying(false);
      setIsBuffering(false);
      if (onPlayStateChange) onPlayStateChange(false);
    } else if (event.data === 0) { // ENDED
      handleTrackEnd();
    } else if (event.data === 3) { // BUFFERING
      setIsBuffering(true);
    } else if (event.data === 5 || event.data === -1) {
      // CUED (5) or UNSTARTED (-1)
      setIsBuffering(true);
      try {
        event.target.playVideo();
      } catch (e) {}
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseInt(e.target.value);
    setMasterVolume(val);
    if (isMuted) {
      setIsMuted(false);
      if (playerRef.current) playerRef.current.unMute();
    }
    
    if (currentSong && (currentSong.is_local || streamUrl)) {
      const audioEl = document.getElementById('local-audio-player');
      if (audioEl) {
        audioEl.muted = false;
        audioEl.volume = val / 100;
      }
      return;
    }
    
    if (playerRef.current) playerRef.current.setVolume(val);
  };

  const handleSeekChange = (e) => {
    setCurrentTime(Number(e.target.value));
  };

  const handleSeekMouseUp = (e) => {
    setIsDragging(false);
    if (currentSong && (currentSong.is_local || streamUrl)) {
      const audioEl = document.getElementById('local-audio-player');
      if (audioEl) {
        audioEl.currentTime = Number(e.target.value);
      }
      return;
    }
    
    if (playerRef.current) {
      playerRef.current.seekTo(Number(e.target.value), true);
    }
  };

  const handleSeekMouseDown = () => setIsDragging(true);

  const formatTime = (seconds) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return {
    playerRef,
    isPlaying, setIsPlaying,
    isBuffering, setIsBuffering,
    masterVolume,
    isMuted,
    currentTime, setCurrentTime,
    duration, setDuration,
    isDragging,
    streamUrl, setStreamUrl,
    isExtractingStream, setIsExtractingStream,
    isVolumeHovered, setIsVolumeHovered,
    captions,
    activeCaptionCode,
    isVideoHovered, setIsVideoHovered,
    isCaptionMenuOpen, setIsCaptionMenuOpen,
    
    handleCaptionsReceived,
    selectCaption,
    handleStallClear,
    handleStallStart,
    handleTrackEnd,
    onStateChange,
    onReady,
    
    togglePlay,
    toggleMute,
    fadeOut,
    fadeIn,
    
    handleVolumeChange,
    handleSeekChange,
    handleSeekMouseUp,
    handleSeekMouseDown,
    formatTime
  };
}
