import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

export function usePlayerCore({
  currentSong,
  nextSong,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  onPlayStateChange,
  onTimeUpdate,
  onError,
  repeatMode,
  onSongEnded,
  crossfadeDuration: externalCrossfadeDuration,
  setCrossfadeDuration: externalSetCrossfadeDuration
}) {
  const [activeDeck, setActiveDeck] = useState(0); // 0 or 1
  const activeDeckRef = useRef(0);
  const crossfadeSongRef = useRef(null);
  const deck0PlayerRef = useRef(null);
  const deck1PlayerRef = useRef(null);

  const [deck0Song, setDeck0Song] = useState(null);
  const [deck1Song, setDeck1Song] = useState(null);
  const [deck0Opacity, setDeck0Opacity] = useState(1);
  const [deck1Opacity, setDeck1Opacity] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [masterVolume, setMasterVolume] = useState(() => {
    const saved = localStorage.getItem('nadanada-volume');
    const parsed = saved ? parseInt(saved, 10) : 100;
    return isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
  });
  const [isMuted, setIsMuted] = useState(false);

  // Dual-deck simultaneous crossfading state
  const [isCrossfading, setIsCrossfading] = useState(false);
  const isCrossfadingRef = useRef(false); // Synchronous mirror — React state is async
  const crossfadeIntervalRef = useRef(null);
  const crossfadeReadyTimeoutRef = useRef(null);
  const justCrossfadedSongIdRef = useRef(null);
  const hasTriggeredEndCrossfadeRef = useRef(false);
  const outgoingEndedDuringCrossfadeRef = useRef(false);
  const isTransitioningSongRef = useRef(true);
  
  const [internalCrossfadeDuration, setInternalCrossfadeDuration] = useState(() => {
    const saved = localStorage.getItem('nadanada-crossfade-duration');
    const parsed = saved !== null ? parseInt(saved, 10) : 3;
    return isNaN(parsed) ? 3 : Math.max(0, Math.min(5, parsed));
  });

  const crossfadeDuration = externalCrossfadeDuration !== undefined ? externalCrossfadeDuration : internalCrossfadeDuration;
  const setCrossfadeDuration = externalSetCrossfadeDuration || setInternalCrossfadeDuration;

  // Persist volume and crossfade preferences across sessions
  useEffect(() => {
    localStorage.setItem('nadanada-volume', masterVolume.toString());
  }, [masterVolume]);

  useEffect(() => {
    localStorage.setItem('nadanada-crossfade-duration', crossfadeDuration.toString());
  }, [crossfadeDuration]);

  const toggleCrossfade = () => {
    const options = [0, 1, 2, 3, 4, 5];
    const currentIndex = options.indexOf(crossfadeDuration);
    const nextVal = currentIndex === -1 ? 3 : options[(currentIndex + 1) % options.length];
    setCrossfadeDuration(nextVal);
  };

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
  const [playCount, setPlayCount] = useState(0);
  const stallTimeoutRef = useRef(null);
  const activeFadeIntervalRef = useRef(null);

  // Deck Volume Control
  const applyDeckVolume = (deckIndex, vol) => {
    const player = deckIndex === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (player && typeof player.setVolume === 'function') {
      try { player.setVolume(vol); } catch (e) {}
    }
    const audioEl = document.getElementById(deckIndex === 0 ? 'deck-0-audio' : 'deck-1-audio');
    if (audioEl) {
      try { audioEl.volume = Math.max(0, Math.min(1, vol / 100)); } catch (e) {}
    }
  };

  const applyActiveVolume = (vol) => {
    applyDeckVolume(activeDeckRef.current, vol);
  };

  const cancelCrossfade = () => {
    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }
    if (crossfadeReadyTimeoutRef.current) {
      clearTimeout(crossfadeReadyTimeoutRef.current);
      crossfadeReadyTimeoutRef.current = null;
    }
    crossfadeSongRef.current = null;
    isCrossfadeRampingRef.current = false;
    outgoingEndedDuringCrossfadeRef.current = false;
    const inactiveDeck = 1 - activeDeckRef.current;
    if (inactiveDeck === 0) {
      setDeck0Song(null);
      setDeck0Opacity(0);
      const audioEl = document.getElementById('deck-0-audio');
      if (audioEl) { try { audioEl.pause(); } catch (e) {} }
    } else {
      setDeck1Song(null);
      setDeck1Opacity(0);
      const audioEl = document.getElementById('deck-1-audio');
      if (audioEl) { try { audioEl.pause(); } catch (e) {} }
    }
    setIsCrossfading(false);
    isCrossfadingRef.current = false;
    if (activeDeckRef.current === 0) {
      setDeck0Opacity(1);
      setDeck1Opacity(0);
    } else {
      setDeck1Opacity(1);
      setDeck0Opacity(0);
    }
    applyDeckVolume(activeDeckRef.current, isMuted ? 0 : masterVolume);
  };

  const isCrossfadeRampingRef = useRef(false);
  const bufferingTimeoutRef = useRef(null);

  const startCrossfadeVolumeRamp = () => {
    if (isCrossfadeRampingRef.current) return;
    isCrossfadeRampingRef.current = true;

    const outgoingDeck = activeDeckRef.current;
    const incomingDeck = 1 - activeDeckRef.current;

    const durationMs = crossfadeDuration * 1000;
    const startVol = isMuted ? 0 : masterVolume;
    const steps = Math.max(25, Math.floor(durationMs / 30));
    const stepTime = durationMs / steps;
    let step = 0;

    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }

    applyDeckVolume(outgoingDeck, startVol);
    applyDeckVolume(incomingDeck, 0);

    crossfadeIntervalRef.current = setInterval(() => {
      step++;
      const progress = Math.min(1, step / steps);

      // Equal-power fade curves
      const factorOut = Math.cos(progress * (Math.PI / 2));
      const factorIn = Math.sin(progress * (Math.PI / 2));

      const volOut = Math.max(0, Math.round(startVol * factorOut));
      const volIn = Math.min(startVol, Math.round(startVol * factorIn));

      applyDeckVolume(outgoingDeck, volOut);
      applyDeckVolume(incomingDeck, volIn);

      if (outgoingDeck === 0) {
        setDeck0Opacity(factorOut);
        setDeck1Opacity(factorIn);
      } else {
        setDeck1Opacity(factorOut);
        setDeck0Opacity(factorIn);
      }

      if (step >= steps) {
        finishCrossfade();
      }
    }, stepTime);
  };

  const finishCrossfade = () => {
    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }
    if (crossfadeReadyTimeoutRef.current) {
      clearTimeout(crossfadeReadyTimeoutRef.current);
      crossfadeReadyTimeoutRef.current = null;
    }
    isCrossfadeRampingRef.current = false;
    hasTriggeredEndCrossfadeRef.current = false;
    outgoingEndedDuringCrossfadeRef.current = false;
    const incomingSong = crossfadeSongRef.current;
    const outgoingDeck = activeDeckRef.current;
    const incomingDeck = 1 - activeDeckRef.current;

    applyDeckVolume(outgoingDeck, 0);
    applyDeckVolume(incomingDeck, isMuted ? 0 : masterVolume);

    if (incomingDeck === 0) {
      setDeck0Opacity(1);
      setDeck1Opacity(0);
      const audioEl = document.getElementById('deck-1-audio');
      if (audioEl) { try { audioEl.pause(); } catch (e) {} }
    } else {
      setDeck1Opacity(1);
      setDeck0Opacity(0);
      const audioEl = document.getElementById('deck-0-audio');
      if (audioEl) { try { audioEl.pause(); } catch (e) {} }
    }

    activeDeckRef.current = incomingDeck;
    setActiveDeck(incomingDeck);
    setIsCrossfading(false);
    isCrossfadingRef.current = false;
    crossfadeSongRef.current = null;

    if (incomingSong) {
      justCrossfadedSongIdRef.current = incomingSong.id;
    }

    if (bufferingTimeoutRef.current) {
      clearTimeout(bufferingTimeoutRef.current);
      bufferingTimeoutRef.current = null;
    }
    setIsPlaying(true);
    setIsBuffering(false);
    if (onPlayStateChange) onPlayStateChange(true);

    if (onSongEnded) onSongEnded();
    else if (hasNext) onNext();
  };



  const startCrossfade = (incomingSong) => {
    if (!incomingSong || isCrossfadingRef.current) return;
    setIsCrossfading(true);
    isCrossfadingRef.current = true;
    crossfadeSongRef.current = incomingSong;
    outgoingEndedDuringCrossfadeRef.current = false;

    const outgoingDeck = activeDeckRef.current;
    const incomingDeck = 1 - activeDeckRef.current;

    // Set initial volume & opacity
    applyDeckVolume(incomingDeck, 0);
    applyDeckVolume(outgoingDeck, isMuted ? 0 : masterVolume);

    if (incomingDeck === 0) {
      setDeck0Song(incomingSong);
      setDeck0Opacity(0);
    } else {
      setDeck1Song(incomingSong);
      setDeck1Opacity(0);
    }

    // DON'T start ramp yet — wait for the incoming deck to report PLAYING (state=1)
    // via onDeckStateChange. Set a safety timeout in case the incoming deck never loads.
    if (crossfadeReadyTimeoutRef.current) {
      clearTimeout(crossfadeReadyTimeoutRef.current);
    }
    crossfadeReadyTimeoutRef.current = setTimeout(() => {
      // Safety: if incoming deck hasn't started playing within crossfadeDuration+5s,
      // just finish the crossfade anyway to avoid dead air
      if (isCrossfadeRampingRef.current === false && crossfadeSongRef.current) {
        console.log('[CROSSFADE] Safety timeout: incoming deck did not start in time, finishing crossfade');
        finishCrossfade();
      }
    }, (crossfadeDuration + 5) * 1000);
  };

  const checkAutoCrossfade = (time, dur) => {
    if (
      crossfadeDuration > 0 &&
      dur > 10 &&
      time > 0 &&
      nextSong &&
      (hasNext || repeatMode > 0)
    ) {
      const remaining = dur - time;
      if (remaining <= crossfadeDuration && remaining > 0 && !hasTriggeredEndCrossfadeRef.current && !isCrossfadingRef.current) {
        console.log(`[CROSSFADE-DEBUG] 🔔 checkAutoCrossfade triggered: time=${time.toFixed(1)}, dur=${dur.toFixed(1)}, remaining=${remaining.toFixed(1)}s <= crossfadeDuration=${crossfadeDuration}s`);
        hasTriggeredEndCrossfadeRef.current = true;
        startCrossfade(nextSong);
      }
    }
  };

  const handleCaptionsReceived = (tracks) => {
    setCaptions(tracks || []);
    if (tracks && tracks.length > 0 && !hasAutoSelectedCaptionRef.current) {
      hasAutoSelectedCaptionRef.current = true;
      const preferred = tracks.find(t => t.languageCode === 'id') || 
                        tracks.find(t => t.languageCode !== 'en' && t.languageCode !== 'en-US' && t.languageCode !== 'a.en') || 
                        tracks[0];
      const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
      if (preferred && activePlayer && activePlayer.setCaption) {
        activePlayer.setCaption(preferred.languageCode);
        setActiveCaptionCode(preferred.languageCode);
      }
    }
  };
  
  const selectCaption = (code) => {
    const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (activePlayer && activePlayer.setCaption) {
      activePlayer.setCaption(code || false);
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
          setIsExtractingStream(true);
          api.getStreamUrl(currentSong.id)
            .then(url => {
              setStreamUrl(url);
              setIsExtractingStream(false);
            })
            .catch(err => {
              setIsExtractingStream(false);
              if (hasNext) {
                onNext();
              } else {
                setIsPlaying(false);
                if (onPlayStateChange) onPlayStateChange(false);
                if (onError) onError(`Failed to stream track from YouTube: ${err.message || err}`);
              }
            });
        }, 15000);
      }
    }
    return () => clearTimeout(timeout);
  }, [isBuffering, streamUrl, isExtractingStream, currentSong]);

  const songId = currentSong?.id;
  const startSecs = Math.floor(currentSong?.startSeconds || currentSong?.initialTime || 0);
  const prevSongIdRef = useRef(null);

  // Handle currentSong changes
  useEffect(() => {
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }

    // If this song change is the result of a crossfade transition completion,
    // the song is ALREADY PLAYING uninterrupted on activeDeck! DO NOT reload or restart it!
    if (songId && justCrossfadedSongIdRef.current === songId) {
      justCrossfadedSongIdRef.current = null;
      prevSongIdRef.current = songId;
      hasTriggeredEndCrossfadeRef.current = false;
      return;
    }

    // If the song ID is unchanged, it is the SAME track already loaded and playing!
    // Do NOT reload or restart it when playlist items are reordered!
    if (songId && prevSongIdRef.current === songId) {
      return;
    }

    // Otherwise, this is a genuine new song selection or manual skip
    cancelCrossfade();

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
      setPlayCount(0);

      // Load into activeDeck and reset other deck
      if (activeDeckRef.current === 0) {
        setDeck0Song(currentSong);
        setDeck0Opacity(1);
        setDeck1Song(null);
        setDeck1Opacity(0);
      } else {
        setDeck1Song(currentSong);
        setDeck1Opacity(1);
        setDeck0Song(null);
        setDeck0Opacity(0);
      }

      prevSongIdRef.current = songId;
      hasTriggeredEndCrossfadeRef.current = false;
      isTransitioningSongRef.current = true;
    } else {
      prevSongIdRef.current = null;
      hasTriggeredEndCrossfadeRef.current = false;
      isTransitioningSongRef.current = false;
      setDeck0Song(null);
      setDeck1Song(null);
      setDeck0Opacity(0);
      setDeck1Opacity(0);
      try { deck0PlayerRef.current?.stopVideo?.(); } catch (e) {}
      try { deck1PlayerRef.current?.stopVideo?.(); } catch (e) {}
      setIsBuffering(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setPlayCount(0);
    }
  }, [songId, startSecs]);

  // Time tracking on activeDeck
  useEffect(() => {
    let interval;
    if (isPlaying && !isDragging && (!currentSong || !currentSong.is_local) && !streamUrl) {
      interval = setInterval(async () => {
        const player = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
        if (player && typeof player.getCurrentTime === 'function') {
          try {
            const time = await player.getCurrentTime();
            const dur = await player.getDuration();
            setCurrentTime(time || 0);
            if (onTimeUpdate) onTimeUpdate(time || 0);
            setDuration(dur || 0);

            // Check auto-crossfade trigger
            checkAutoCrossfade(time || 0, dur || 0);
          } catch (e) {}
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isDragging, currentSong, streamUrl, crossfadeDuration, onTimeUpdate, nextSong, hasNext, repeatMode, activeDeck]);

  // Media Session API Integration for SMTC
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
      const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
      if (audioEl) {
        if (isPlaying) audioEl.pause();
        else audioEl.play();
      }
      return;
    }
    
    const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (!activePlayer) return;
    if (isPlaying) {
      activePlayer.pauseVideo();
    } else {
      activePlayer.playVideo();
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (currentSong && (currentSong.is_local || streamUrl)) {
      const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
      if (audioEl) audioEl.muted = !isMuted;
      return;
    }
    
    const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (activePlayer) {
      if (!isMuted) activePlayer.mute();
      else {
        activePlayer.unMute();
        activePlayer.setVolume(masterVolume);
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

  // Fade in / out helpers for manual transitions
  const fadeOut = (durationMs = 200) => {
    return new Promise((resolve) => {
      if (activeFadeIntervalRef.current) {
        clearInterval(activeFadeIntervalRef.current);
        activeFadeIntervalRef.current = null;
      }
      const startVol = isMuted ? 0 : masterVolume;
      if (startVol <= 0 || durationMs <= 0) {
        applyActiveVolume(0);
        resolve();
        return;
      }
      const steps = Math.max(8, Math.floor(durationMs / 25));
      const stepTime = durationMs / steps;
      let step = 0;

      activeFadeIntervalRef.current = setInterval(() => {
        step++;
        const progress = Math.min(1, step / steps);
        const factor = Math.cos(progress * (Math.PI / 2));
        const curVol = Math.max(0, Math.round(startVol * factor));
        applyActiveVolume(curVol);
        if (step >= steps || curVol <= 0) {
          clearInterval(activeFadeIntervalRef.current);
          activeFadeIntervalRef.current = null;
          applyActiveVolume(0);
          resolve();
        }
      }, stepTime);
    });
  };

  const fadeIn = (durationMs = 250) => {
    return new Promise((resolve) => {
      if (activeFadeIntervalRef.current) {
        clearInterval(activeFadeIntervalRef.current);
        activeFadeIntervalRef.current = null;
      }
      const targetVol = isMuted ? 0 : masterVolume;
      if (targetVol <= 0 || durationMs <= 0) {
        applyActiveVolume(targetVol);
        resolve();
        return;
      }
      applyActiveVolume(0);
      const steps = Math.max(8, Math.floor(durationMs / 25));
      const stepTime = durationMs / steps;
      let step = 0;

      activeFadeIntervalRef.current = setInterval(() => {
        step++;
        const progress = Math.min(1, step / steps);
        const factor = Math.sin(progress * (Math.PI / 2));
        const curVol = Math.min(targetVol, Math.round(targetVol * factor));
        applyActiveVolume(curVol);
        if (step >= steps || curVol >= targetVol) {
          clearInterval(activeFadeIntervalRef.current);
          activeFadeIntervalRef.current = null;
          applyActiveVolume(targetVol);
          resolve();
        }
      }, stepTime);
    });
  };

  // Deck Ready Handlers
  const onDeckReady = (deckIndex, event) => {
    if (deckIndex === 0) deck0PlayerRef.current = event.target;
    else deck1PlayerRef.current = event.target;

    if (deckIndex === activeDeckRef.current) {
      if (crossfadeDuration > 0 && isTransitioningSongRef.current) {
        applyDeckVolume(deckIndex, 0);
        fadeIn(Math.min(crossfadeDuration * 1000, 1500));
      } else if (!activeFadeIntervalRef.current) {
        event.target.setVolume(isMuted ? 0 : masterVolume);
      }
      isTransitioningSongRef.current = false;
      if (startSecs > 0) {
        try { event.target.seekTo(startSecs, true); } catch (e) {}
      }
      try { event.target.playVideo(); } catch (e) {}
    } else {
      // Inactive deck starting up during crossfade: start at volume 0
      event.target.setVolume(0);
      try { event.target.playVideo(); } catch (e) {}
    }
  };

  // Deck State Change Handlers
  const onDeckStateChange = (deckIndex, event) => {
    if (deckIndex === activeDeckRef.current) {
      if (event.data === 1) { // PLAYING
        if (bufferingTimeoutRef.current) {
          clearTimeout(bufferingTimeoutRef.current);
          bufferingTimeoutRef.current = null;
        }
        setIsPlaying(true);
        setIsBuffering(false);
        if (onPlayStateChange) onPlayStateChange(true);
        if (crossfadeDuration > 0 && isTransitioningSongRef.current) {
          isTransitioningSongRef.current = false;
          fadeIn(Math.min(crossfadeDuration * 1000, 1500));
        } else if (!activeFadeIntervalRef.current && !isCrossfadingRef.current) {
          try { event.target.setVolume(isMuted ? 0 : masterVolume); } catch (e) {}
        }
      } else if (event.data === 2) { // PAUSED
        if (bufferingTimeoutRef.current) {
          clearTimeout(bufferingTimeoutRef.current);
          bufferingTimeoutRef.current = null;
        }
        setIsPlaying(false);
        setIsBuffering(false);
        if (onPlayStateChange) onPlayStateChange(false);
      } else if (event.data === 0) { // ENDED
        if (bufferingTimeoutRef.current) {
          clearTimeout(bufferingTimeoutRef.current);
          bufferingTimeoutRef.current = null;
        }
        if (isCrossfadingRef.current) {
          applyDeckVolume(deckIndex, 0);
          outgoingEndedDuringCrossfadeRef.current = true;
          if (isCrossfadeRampingRef.current) {
            // Ramp is running but outgoing just ended — skip remaining ramp, finish now
            console.log('[CROSSFADE] Outgoing deck ENDED while ramp is running — finishing immediately');
            finishCrossfade();
          }
          // else: ramp hasn't started yet (waiting for incoming deck to load)
          // When incoming deck reports PLAYING, we'll skip the ramp and go straight to finishCrossfade
        } else {
          handleTrackEnd();
        }
      } else if (event.data === 3) { // BUFFERING
        if (!isCrossfadingRef.current) {
          if (!bufferingTimeoutRef.current) {
            bufferingTimeoutRef.current = setTimeout(() => {
              setIsBuffering(true);
            }, 600);
          }
        }
      } else if (event.data === 5 || event.data === -1) {
        if (!isCrossfadingRef.current) {
          setIsBuffering(true);
        }
        try { event.target.playVideo(); } catch (e) {}
      }
    } else {
      // Inactive deck events during crossfade
      if (event.data === 1 && isCrossfadingRef.current && !isCrossfadeRampingRef.current) {
        // Incoming deck has started playing!
        if (crossfadeReadyTimeoutRef.current) {
          clearTimeout(crossfadeReadyTimeoutRef.current);
          crossfadeReadyTimeoutRef.current = null;
        }
        if (outgoingEndedDuringCrossfadeRef.current) {
          // Outgoing song already ended — no point in gradual ramp, just finish immediately
          console.log(`[CROSSFADE] Incoming deck ${deckIndex} PLAYING, outgoing already ended — finishing immediately`);
          finishCrossfade();
        } else {
          // Outgoing still playing — do the smooth volume ramp
          console.log(`[CROSSFADE] Incoming deck ${deckIndex} PLAYING — starting volume ramp`);
          startCrossfadeVolumeRamp();
        }
      } else if (event.data === 5 || event.data === -1) {
        try { event.target.playVideo(); } catch (e) {}
      }
    }
  };

  const handleTrackEnd = () => {
    if (repeatMode === 1) {
      setCurrentTime(0);
      hasTriggeredEndCrossfadeRef.current = false;
      if (onTimeUpdate) onTimeUpdate(0);
      
      const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
      if (streamUrl || (currentSong && currentSong.is_local)) {
        const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
        if (audioEl) { 
          audioEl.currentTime = 0; 
          audioEl.play(); 
          if (crossfadeDuration > 0) fadeIn(Math.min(crossfadeDuration * 1000, 1500));
        }
      } else if (activePlayer) {
        activePlayer.seekTo(0, true);
        activePlayer.playVideo();
        if (crossfadeDuration > 0) fadeIn(Math.min(crossfadeDuration * 1000, 1500));
      }
    } else if (repeatMode === 2) {
      if (playCount < 1) {
        setPlayCount(1);
        setCurrentTime(0);
        hasTriggeredEndCrossfadeRef.current = false;
        if (onTimeUpdate) onTimeUpdate(0);
        
        const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
        if (streamUrl || (currentSong && currentSong.is_local)) {
          const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
          if (audioEl) { 
            audioEl.currentTime = 0; 
            audioEl.play(); 
            if (crossfadeDuration > 0) fadeIn(Math.min(crossfadeDuration * 1000, 1500));
          }
        } else if (activePlayer) {
          activePlayer.seekTo(0, true);
          activePlayer.playVideo();
          if (crossfadeDuration > 0) fadeIn(Math.min(crossfadeDuration * 1000, 1500));
        }
      } else {
        setIsPlaying(false);
        setIsBuffering(false);
        if (onPlayStateChange) onPlayStateChange(false);
        setCurrentTime(0);
        if (onTimeUpdate) onTimeUpdate(0);
        if (onSongEnded) onSongEnded();
        else if (hasNext) onNext();
      }
    } else {
      setIsPlaying(false);
      setIsBuffering(false);
      if (onPlayStateChange) onPlayStateChange(false);
      setCurrentTime(0);
      if (onTimeUpdate) onTimeUpdate(0);
      if (onSongEnded) onSongEnded();
      else if (hasNext) onNext();
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseInt(e.target.value);
    if (activeFadeIntervalRef.current) {
      clearInterval(activeFadeIntervalRef.current);
      activeFadeIntervalRef.current = null;
    }
    setMasterVolume(val);
    if (isMuted) {
      setIsMuted(false);
      const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
      if (activePlayer) activePlayer.unMute();
    }
    applyActiveVolume(val);
  };

  const handleSeekChange = (e) => {
    setCurrentTime(Number(e.target.value));
  };

  const handleSeekMouseDown = () => {
    setIsDragging(true);
    isTransitioningSongRef.current = false;
    cancelCrossfade();
    if (activeFadeIntervalRef.current) {
      clearInterval(activeFadeIntervalRef.current);
      activeFadeIntervalRef.current = null;
    }
    applyActiveVolume(isMuted ? 0 : masterVolume);
  };

  const handleSeekMouseUp = (e) => {
    setIsDragging(false);
    isTransitioningSongRef.current = false;
    cancelCrossfade();
    if (activeFadeIntervalRef.current) {
      clearInterval(activeFadeIntervalRef.current);
      activeFadeIntervalRef.current = null;
    }
    applyActiveVolume(isMuted ? 0 : masterVolume);

    const targetTime = Number(e.target.value);
    if (targetTime < duration - crossfadeDuration) {
      hasTriggeredEndCrossfadeRef.current = false;
    }
    if (currentSong && (currentSong.is_local || streamUrl)) {
      const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
      if (audioEl) {
        audioEl.currentTime = targetTime;
      }
      return;
    }
    
    const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (activePlayer) {
      activePlayer.seekTo(targetTime, true);
    }
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return {
    activeDeck,
    deck0Song,
    deck1Song,
    deck0Opacity,
    deck1Opacity,
    deck0PlayerRef,
    deck1PlayerRef,
    onDeckReady,
    onDeckStateChange,
    
    isPlaying, setIsPlaying,
    isBuffering, setIsBuffering,
    masterVolume,
    isMuted,
    crossfadeDuration, setCrossfadeDuration,
    toggleCrossfade,
    hasTriggeredEndCrossfadeRef,
    isTransitioningSongRef,
    activeFadeIntervalRef,
    isCrossfading,
    cancelCrossfade,
    checkAutoCrossfade,
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
