import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { parseDurationToSecs, hifiCache, getCachedHifi, resolveHifiForTrack, isHifiEligibleTrack } from '../services/hifiResolver';

// Global cache for captions across song transitions and component re-renders
const globalCaptionsMap = new Map();

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
  setCrossfadeDuration: externalSetCrossfadeDuration,
  downloadedIds,
  isHifiEnabled = true,
  onSongHifiFailed = null
}) {
  const [activeDeck, setActiveDeck] = useState(0); // 0 or 1
  const activeDeckRef = useRef(0);
  const crossfadeSongRef = useRef(null);
  const deck0PlayerRef = useRef(null);
  const deck1PlayerRef = useRef(null);

  const [deck0Song, setDeck0Song] = useState(currentSong || null);
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
  const isPreloadingNextRef = useRef(false);
  const hasPreloadedNextRef = useRef(false);
  const isTransitioningSongRef = useRef(true);
  const needsSeekFixRef = useRef(false);
  
  const [internalCrossfadeDuration, setInternalCrossfadeDuration] = useState(() => {
    const saved = localStorage.getItem('nadanada-crossfade-duration');
    const parsed = saved !== null ? parseInt(saved, 10) : 3;
    let val = isNaN(parsed) ? 3 : Math.max(0, Math.min(6, parsed));
    if (val === 1) val = 2; // Auto-migrate 1s to 2s
    return val;
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
    const options = [0, 2, 3, 4, 5, 6];
    const currentIndex = options.indexOf(crossfadeDuration);
    const nextVal = currentIndex === -1 ? 3 : options[(currentIndex + 1) % options.length];
    setCrossfadeDuration(nextVal);
  };

  // Offline / Downloaded playback crossfade bypass
  const isSongOffline = (song) => {
    if (!song) return false;
    if (song?.is_local || song?.file_path) return true;
    if (isHifiEnabled && isHifiEligibleTrack(song) && (song?.stream_url || song?.source === 'monochrome')) return false;
    if (downloadedIds && typeof downloadedIds.has === 'function') {
      if (song.id && downloadedIds.has(song.id)) return true;
      if (song.file_path && downloadedIds.has(song.file_path)) return true;
    }
    return false;
  };

  const isCurrentOffline = isSongOffline(currentSong) || isSongOffline(activeDeckRef.current === 0 ? deck0Song : deck1Song);
  const isNextOffline = isSongOffline(nextSong);
  const isOfflinePlayback = isCurrentOffline || isNextOffline;
  const effectiveCrossfadeDuration = isOfflinePlayback ? 0 : crossfadeDuration;

  // If entering offline playback mode, immediately cancel any active or ramping crossfade
  useEffect(() => {
    if (isOfflinePlayback && (isCrossfadingRef.current || isPreloadingNextRef.current || isCrossfadeRampingRef.current)) {
      cancelCrossfade();
    }
  }, [isOfflinePlayback]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  
  const [streamUrl, setStreamUrl] = useState(null);
  const [isExtractingStream, setIsExtractingStream] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);
  const [captions, setCaptions] = useState(() => (currentSong?.id ? (globalCaptionsMap.get(currentSong.id) || []) : []));

  useEffect(() => {
    if (currentSong?.id && globalCaptionsMap.has(currentSong.id)) {
      const cached = globalCaptionsMap.get(currentSong.id);
      if (cached && cached.length > 0) {
        setCaptions(cached);
      }
    }
  }, [currentSong?.id]);

  const [activeCaptionCode, setActiveCaptionCode] = useState(null);
  const [isVideoHovered, setIsVideoHovered] = useState(false);
  const [isCaptionMenuOpen, setIsCaptionMenuOpen] = useState(false);
  const hasAutoSelectedCaptionRef = useRef(false);
  const [playCount, setPlayCount] = useState(0);
  const stallTimeoutRef = useRef(null);
  const activeFadeIntervalRef = useRef(null);

  const isSongHiFi = (song) => Boolean(
    isHifiEnabled &&
    song &&
    isHifiEligibleTrack(song) &&
    Boolean(song.stream_url || song.blob_url) &&
    !song.is_local &&
    !song._hifiFailed &&
    !song._userForcedYoutube &&
    !failedHifiSongIdsRef.current.has(String(song.id)) &&
    (!song.hifi_id || !failedHifiSongIdsRef.current.has(String(song.hifi_id)))
  );

  const isAudioElementPlayback = (song) => {
    const s = song || (activeDeckRef.current === 0 ? deck0Song : deck1Song) || currentSong;
    if (!s) return Boolean(streamUrl);
    if (s.is_local || s.file_path) return true;
    if (s._hifiFailed || s._userForcedYoutube || failedHifiSongIdsRef.current.has(String(s.id))) return false;
    if (isSongHiFi(s)) return true;
    return Boolean(streamUrl);
  };

  // Deck Volume Control
  const applyDeckVolume = (deckIndex, vol) => {
    const player = deckIndex === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (player && typeof player.setVolume === 'function') {
      try { player.setVolume(Math.round(vol)); } catch (e) {}
    }
    const audioEl = document.getElementById(deckIndex === 0 ? 'deck-0-audio' : 'deck-1-audio');
    if (audioEl) {
      try { audioEl.volume = Math.max(0, Math.min(1, vol / 100)); } catch (e) {}
    }
  };

  const applyActiveVolume = (vol) => {
    applyDeckVolume(activeDeckRef.current, vol);
  };

  const finishCrossfadeRef = useRef(null);
  const onSongEndedRef = useRef(onSongEnded);
  onSongEndedRef.current = onSongEnded;
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

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
    isPreloadingNextRef.current = false;
    hasPreloadedNextRef.current = false;
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

  const startCrossfadeVolumeRamp = (remainingSecs) => {
    if (isOfflinePlayback || effectiveCrossfadeDuration <= 0) return;
    if (isCrossfadeRampingRef.current) return;
    isCrossfadeRampingRef.current = true;

    const outgoingDeck = activeDeckRef.current;
    const incomingDeck = 1 - activeDeckRef.current;

    const effectiveRampSecs = (Number.isFinite(remainingSecs) && remainingSecs > 0.4)
      ? Math.min(effectiveCrossfadeDuration, remainingSecs)
      : effectiveCrossfadeDuration;
    const durationMs = effectiveRampSecs * 1000;
    const startVol = isMuted ? 0 : masterVolume;
    const rampStartTime = performance.now();

    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }

    applyDeckVolume(outgoingDeck, startVol);
    applyDeckVolume(incomingDeck, 0);

    const startSecs = Math.floor(crossfadeSongRef.current?.startSeconds || crossfadeSongRef.current?.initialTime || 0);

    // If we preloaded the deck, it's currently paused. Seek to correct start time and start playing!
    const audioEl = document.getElementById(`deck-${incomingDeck}-audio`);
    if (audioEl) { 
      try { 
        if (Math.abs((audioEl.currentTime || 0) - startSecs) > 0.2) {
          audioEl.currentTime = startSecs;
        }
        audioEl.play().catch(() => {}); 
      } catch(e) {} 
    }
    if (incomingDeck === 0 && deck0PlayerRef.current) {
      try { 
        deck0PlayerRef.current.seekTo(startSecs, true);
        deck0PlayerRef.current.playVideo(); 
      } catch(e) {}
    } else if (incomingDeck === 1 && deck1PlayerRef.current) {
      try { 
        deck1PlayerRef.current.seekTo(startSecs, true);
        deck1PlayerRef.current.playVideo(); 
      } catch(e) {}
    }

    crossfadeIntervalRef.current = setInterval(() => {
      const elapsed = performance.now() - rampStartTime;
      const progress = Math.min(1, elapsed / durationMs);

      // Equal-power fade curves
      const factorOut = Math.cos(progress * (Math.PI / 2));
      const factorIn = Math.sin(progress * (Math.PI / 2));

      const volOut = Math.max(0, startVol * factorOut);
      const volIn = Math.min(startVol, startVol * factorIn);

      applyDeckVolume(outgoingDeck, volOut);
      applyDeckVolume(incomingDeck, volIn);

      if (outgoingDeck === 0) {
        setDeck0Opacity(factorOut);
        setDeck1Opacity(factorIn);
      } else {
        setDeck1Opacity(factorOut);
        setDeck0Opacity(factorIn);
      }

      if (progress >= 1) {
        if (finishCrossfadeRef.current) {
          finishCrossfadeRef.current();
        } else {
          finishCrossfade();
        }
      }
    }, 30);
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
    // Keep hasTriggeredEndCrossfadeRef true so no secondary crossfade can trigger on the outgoing track
    // while waiting for App.jsx to update currentSong. It will be reset to false in useEffect([songId, startSecs]).
    hasTriggeredEndCrossfadeRef.current = true;
    outgoingEndedDuringCrossfadeRef.current = false;
    isPreloadingNextRef.current = false;
    hasPreloadedNextRef.current = false;
    const incomingDeck = 1 - activeDeckRef.current;
    const incomingSong = crossfadeSongRef.current || (incomingDeck === 0 ? deck0Song : deck1Song);
    const outgoingDeck = activeDeckRef.current;

    // Update activeDeckRef and isCrossfadingRef BEFORE pausing outgoing deck so onPause on outgoing deck is ignored
    activeDeckRef.current = incomingDeck;
    isCrossfadingRef.current = false;
    crossfadeSongRef.current = null;

    applyDeckVolume(outgoingDeck, 0);
    applyDeckVolume(incomingDeck, isMuted ? 0 : masterVolume);

    if (incomingDeck === 0) {
      setDeck0Opacity(1);
      setDeck1Opacity(0);
      const outAudioEl = document.getElementById('deck-1-audio');
      if (outAudioEl) {
        try {
          outAudioEl.pause();
          outAudioEl.removeAttribute('src');
          outAudioEl.load();
        } catch (e) {}
      }
      if (deck1PlayerRef.current) {
        try {
          deck1PlayerRef.current.stopVideo?.();
          deck1PlayerRef.current.pauseVideo?.();
        } catch (e) {}
      }
      setDeck1Song(null);
      const inAudioEl = document.getElementById('deck-0-audio');
      if (inAudioEl) {
        if (inAudioEl.paused) {
          try { inAudioEl.play().catch(() => {}); } catch (e) {}
        }
        if (Number.isFinite(inAudioEl.currentTime)) setCurrentTime(inAudioEl.currentTime);
        if (Number.isFinite(inAudioEl.duration) && inAudioEl.duration > 0 && inAudioEl.duration !== Infinity) {
          setDuration(inAudioEl.duration);
        } else {
          const fallbackDur = parseDurationToSecs(incomingSong?.duration);
          if (fallbackDur > 0) setDuration(fallbackDur);
        }
      }
    } else {
      setDeck1Opacity(1);
      setDeck0Opacity(0);
      const outAudioEl = document.getElementById('deck-0-audio');
      if (outAudioEl) {
        try {
          outAudioEl.pause();
          outAudioEl.removeAttribute('src');
          outAudioEl.load();
        } catch (e) {}
      }
      if (deck0PlayerRef.current) {
        try {
          deck0PlayerRef.current.stopVideo?.();
          deck0PlayerRef.current.pauseVideo?.();
        } catch (e) {}
      }
      setDeck0Song(null);
      const inAudioEl = document.getElementById('deck-1-audio');
      if (inAudioEl) {
        if (inAudioEl.paused) {
          try { inAudioEl.play().catch(() => {}); } catch (e) {}
        }
        if (Number.isFinite(inAudioEl.currentTime)) setCurrentTime(inAudioEl.currentTime);
        if (Number.isFinite(inAudioEl.duration) && inAudioEl.duration > 0 && inAudioEl.duration !== Infinity) {
          setDuration(inAudioEl.duration);
        } else {
          const fallbackDur = parseDurationToSecs(incomingSong?.duration);
          if (fallbackDur > 0) setDuration(fallbackDur);
        }
      }
    }

    setActiveDeck(incomingDeck);
    setIsCrossfading(false);
    setPlayCount(0);
      setBufferedPercent(0);
      if (songId) streamRecoveryAttemptsRef.current[songId] = 0;

    if (incomingSong) {
      justCrossfadedSongIdRef.current = incomingSong.id;
      prevSongIdRef.current = incomingSong.id;
      needsSeekFixRef.current = true;
    }

    if (bufferingTimeoutRef.current) {
      clearTimeout(bufferingTimeoutRef.current);
      bufferingTimeoutRef.current = null;
    }
    setIsPlaying(true);
    setIsBuffering(false);
    if (onPlayStateChange) onPlayStateChange(true);

    if (onSongEndedRef.current) onSongEndedRef.current();
    else if (hasNext && onNextRef.current) onNextRef.current();
  };
  finishCrossfadeRef.current = finishCrossfade;



  const preloadNextSong = async (incomingSong) => {
    if (isOfflinePlayback || effectiveCrossfadeDuration <= 0) return;
    if (!incomingSong || isPreloadingNextRef.current || hasPreloadedNextRef.current) return;
    
    isPreloadingNextRef.current = true;
    outgoingEndedDuringCrossfadeRef.current = false;

    let songToPreload = incomingSong;
    if (isHifiEnabled && !songToPreload.stream_url && !songToPreload.is_local && isHifiEligibleTrack(songToPreload)) {
      const cached = getCachedHifi(songToPreload);
      if (cached && cached.stream_url) {
        songToPreload = {
          ...songToPreload,
          stream_url: cached.stream_url,
          source: 'monochrome',
          hifi_id: cached.hifi_id,
          _hifiChecked: true
        };
      } else if (!songToPreload._hifiChecked) {
        try {
          const resolved = await resolveHifiForTrack(songToPreload);
          if (resolved && resolved.stream_url) {
            songToPreload = {
              ...songToPreload,
              stream_url: resolved.stream_url,
              source: 'monochrome',
              hifi_id: resolved.hifi_id,
              _hifiChecked: true
            };
          }
        } catch (e) {}
      }
    }

    if (!isPreloadingNextRef.current) return;

    crossfadeSongRef.current = songToPreload;

    const incomingDeck = 1 - activeDeckRef.current;

    // Set initial volume & opacity
    applyDeckVolume(incomingDeck, 0);

    if (incomingDeck === 0) {
      setDeck0Song(songToPreload);
      setDeck0Opacity(0);
    } else {
      setDeck1Song(songToPreload);
      setDeck1Opacity(0);
    }

    // Wait for incoming deck to report PLAYING (state=1) in onDeckStateChange or onCanPlay in handleAudioDeckReady.
    // Set a safety timeout in case it never loads (so we don't get stuck)
    if (crossfadeReadyTimeoutRef.current) {
      clearTimeout(crossfadeReadyTimeoutRef.current);
    }
    crossfadeReadyTimeoutRef.current = setTimeout(() => {
      if (isPreloadingNextRef.current && !isCrossfadingRef.current && !isCrossfadeRampingRef.current) {
        console.log('[CROSSFADE] Safety timeout: preload did not finish in time, aborting preload');
        cancelCrossfade();
      }
    }, (effectiveCrossfadeDuration + 5) * 1000);
  };

  const checkAutoCrossfade = (time, dur) => {
    if (isOfflinePlayback || effectiveCrossfadeDuration <= 0) return;
    // If track is just starting or duration is invalid, ignore to prevent false triggers
    if (!time || !dur || time < effectiveCrossfadeDuration + 2 || time < 5) return;

    const isLoopingCurrentTrack = repeatMode === 1 || (repeatMode === 2 && playCount < 1);

    if (
      effectiveCrossfadeDuration > 0 &&
      dur > 10 &&
      nextSong &&
      !isLoopingCurrentTrack &&
      hasNext
    ) {
      const remaining = dur - time;
      
      // Phase 1: Preload the next song exactly effectiveCrossfadeDuration + 5 seconds before end
      const preloadTime = effectiveCrossfadeDuration + 5;
      if (remaining <= preloadTime && remaining > effectiveCrossfadeDuration && !isPreloadingNextRef.current && !hasPreloadedNextRef.current) {
        console.log(`[CROSSFADE-DEBUG] 🔄 Preloading next song at time=${time.toFixed(1)}, remaining=${remaining.toFixed(1)}s (preload window)`);
        preloadNextSong(nextSong);
      }

      // Phase 2: Start the crossfade ramp at exactly effectiveCrossfadeDuration seconds before end
      if (remaining <= effectiveCrossfadeDuration && remaining > 0 && !hasTriggeredEndCrossfadeRef.current && !isCrossfadingRef.current) {
        console.log(`[CROSSFADE-DEBUG] 🔔 crossfade ramp triggered: remaining=${remaining.toFixed(1)}s <= ${effectiveCrossfadeDuration}s`);
        hasTriggeredEndCrossfadeRef.current = true;
        setIsCrossfading(true);
        isCrossfadingRef.current = true;

        if (!hasPreloadedNextRef.current && !isPreloadingNextRef.current) {
          console.log(`[CROSSFADE-DEBUG] ⚠️ Scrubbed past preload window, loading song now!`);
          preloadNextSong(nextSong);
        }

        if (hasPreloadedNextRef.current) {
          startCrossfadeVolumeRamp(remaining);
        }
      }
    }
  };

  const handleCaptionsReceived = useCallback((tracks, vid) => {
    const targetId = vid || currentSong?.id;
    if (tracks && tracks.length > 0) {
      if (targetId) {
        globalCaptionsMap.set(targetId, tracks);
      }
      if (!targetId || targetId === currentSong?.id) {
        setCaptions(tracks);
      }
    } else {
      if (!targetId || targetId === currentSong?.id) {
        setCaptions(tracks || []);
      }
    }
  }, [currentSong?.id]);
  
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
    if (currentSong && !isAudioElementPlayback(currentSong) && !stallTimeoutRef.current) {
      stallTimeoutRef.current = setTimeout(() => {
        console.warn("Audio stream stalled for 25s. Skipping.");
        if (hasNext) onNext();
        else if (onError) onError("Stream stalled and failed to recover.");
      }, 25000);
    }
  };

  const handleStallClear = () => {
    setIsBuffering(false);
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }
  };

  // Note: Embed blocks are handled explicitly by error events (codes 101/150) in Player.jsx.
  // We do NOT use buffering timeouts to guess embed blocks, ensuring slow internet connections
  // are never prematurely downgraded to audio fallback.

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
    if (songId && justCrossfadedSongIdRef.current && (justCrossfadedSongIdRef.current === songId || String(justCrossfadedSongIdRef.current) === String(songId))) {
      justCrossfadedSongIdRef.current = null;
      prevSongIdRef.current = songId;
      hasTriggeredEndCrossfadeRef.current = false;
      return;
    }

    // If the song ID is unchanged, it is the SAME track already loaded and playing!
    // Do NOT reload, interrupt, or restart it when playlist items are reordered or updated!
    if (songId && prevSongIdRef.current === songId) {
      return;
    }

    // Otherwise, this is a genuine new song selection or manual skip
    cancelCrossfade();

    if (songId) {
      setStreamUrl(null);
      // Give fresh song playback a clean slate - clear any transient recovery/failure records
      failedHifiSongIdsRef.current.delete(String(songId));
      if (currentSong?.hifi_id) failedHifiSongIdsRef.current.delete(String(currentSong.hifi_id));
      delete streamRecoveryAttemptsRef.current[String(songId)];
      if (currentSong?.hifi_id) delete streamRecoveryAttemptsRef.current[String(currentSong.hifi_id)];

      hasAutoSelectedCaptionRef.current = false;
      setCaptions(globalCaptionsMap.get(songId) || []);
      setActiveCaptionCode(null);
      setIsCaptionMenuOpen(false);
      setIsExtractingStream(false);
      setIsBuffering(true);
      setIsPlaying(false);
      setCurrentTime(startSecs);
      const initDur = parseDurationToSecs(currentSong?.duration);
      setDuration(initDur > 0 ? initDur : 0);
      setPlayCount(0);

      // Check hifiCache before mounting so if FLAC stream is available, it starts directly as FLAC!
      let songToLoad = currentSong;
      const isFailedOrForced = Boolean(
        songToLoad._userForcedYoutube ||
        failedHifiSongIdsRef.current.has(String(songToLoad.id)) ||
        (songToLoad.hifi_id && failedHifiSongIdsRef.current.has(String(songToLoad.hifi_id)))
      );

      if (isFailedOrForced) {
        songToLoad = {
          ...songToLoad,
          stream_url: null,
          blob_url: null,
          source: null,
          _hifiFailed: true
        };
      } else if (
        isHifiEnabled &&
        !songToLoad.stream_url &&
        !songToLoad.is_local &&
        isHifiEligibleTrack(songToLoad)
      ) {
        const cached = getCachedHifi(songToLoad);
        if (cached && cached.stream_url && !failedHifiSongIdsRef.current.has(String(cached.hifi_id || songToLoad.id))) {
          songToLoad = {
            ...songToLoad,
            stream_url: cached.stream_url,
            source: 'monochrome',
            hifi_id: cached.hifi_id
          };
        }
      }

      // Load into activeDeck and reset other deck
      if (activeDeckRef.current === 0) {
        setDeck0Song(songToLoad);
        setDeck0Opacity(1);
        setDeck1Song(null);
        setDeck1Opacity(0);
      } else {
        setDeck1Song(songToLoad);
        setDeck1Opacity(1);
        setDeck0Song(null);
        setDeck0Opacity(0);
      }

      prevSongIdRef.current = songId;
      hasTriggeredEndCrossfadeRef.current = false;
      isTransitioningSongRef.current = true;
      needsSeekFixRef.current = false;
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

  // If currentSong receives its Hi-Fi stream_url right as the track is starting (e.g. bulk import),
  // seamlessly upgrade the active deck to FLAC before playback has progressed!
  // Also, if a false-positive stream_url was stripped from currentSong or user toggles audio source,
  // immediately switch between Hi-Fi and YouTube at the current playback position!
  useEffect(() => {
    if (!currentSong?.id || prevSongIdRef.current !== currentSong.id) return;
    if (isCrossfadingRef.current || isCrossfadeRampingRef.current) return;

    if (currentSong._manualSourceSwitch) {
      failedHifiSongIdsRef.current.delete(String(currentSong.id));
      if (currentSong.hifi_id) failedHifiSongIdsRef.current.delete(String(currentSong.hifi_id));
      delete streamRecoveryAttemptsRef.current[String(currentSong.id)];
      if (currentSong.hifi_id) delete streamRecoveryAttemptsRef.current[String(currentSong.hifi_id)];
      setDeck0Song(prev => (prev && (prev.id === currentSong.id || prev.hifi_id === currentSong.hifi_id)) ? { ...prev, _hifiFailed: false, _userForcedYoutube: false } : prev);
      setDeck1Song(prev => (prev && (prev.id === currentSong.id || prev.hifi_id === currentSong.hifi_id)) ? { ...prev, _hifiFailed: false, _userForcedYoutube: false } : prev);
    }

    const activeDeckSong = activeDeckRef.current === 0 ? deck0Song : deck1Song;
    if (!activeDeckSong || activeDeckSong.id !== currentSong.id) return;

    const isTrackFailedOrForced = Boolean(
      failedHifiSongIdsRef.current.has(String(currentSong.id)) ||
      currentSong._hifiFailed ||
      currentSong._userForcedYoutube ||
      (currentSong.hifi_id && failedHifiSongIdsRef.current.has(String(currentSong.hifi_id)))
    );

    // If track is failed/forced or has lost its stream_url, ensure activeDeckSong is downgraded to YouTube
    if (isTrackFailedOrForced || (!currentSong.stream_url && activeDeckSong.stream_url && !currentSong.is_local)) {
      if (activeDeckSong.stream_url || !activeDeckSong._hifiFailed) {
        const audioEl = document.getElementById(activeDeckRef.current === 0 ? 'deck-0-audio' : 'deck-1-audio');
        if (audioEl) {
          try {
            audioEl.pause();
            audioEl.removeAttribute('src');
            audioEl.load();
          } catch (e) {}
        }
        const pos = Math.max(0, currentTime || 0);
        const fallback = {
          ...currentSong,
          stream_url: null,
          blob_url: null,
          source: null,
          startSeconds: Math.floor(pos),
          _hifiFailed: true
        };
        if (activeDeckRef.current === 0) {
          setDeck0Song(fallback);
        } else {
          setDeck1Song(fallback);
        }
      }
      return;
    }

    if (activeDeckSong._hifiFailed || activeDeckSong._userForcedYoutube) return;

    if (
      isHifiEnabled &&
      isHifiEligibleTrack(currentSong) &&
      currentSong.stream_url &&
      !currentSong._hifiFailed &&
      !currentSong._userForcedYoutube &&
      !activeDeckSong.stream_url &&
      !activeDeckSong._hifiFailed &&
      !failedHifiSongIdsRef.current.has(String(activeDeckSong.id)) &&
      (isBuffering || currentTime < 10.0 || currentSong._manualSourceSwitch)
    ) {
      const pos = Math.max(0, currentTime || 0);
      if (activeDeckRef.current === 0) {
        try {
          deck0PlayerRef.current?.stopVideo?.();
          deck0PlayerRef.current?.pauseVideo?.();
        } catch (e) {}
        setDeck0Song({ ...currentSong, startSeconds: Math.floor(pos) });
      } else {
        try {
          deck1PlayerRef.current?.stopVideo?.();
          deck1PlayerRef.current?.pauseVideo?.();
        } catch (e) {}
        setDeck1Song({ ...currentSong, startSeconds: Math.floor(pos) });
      }

      // Automatically trigger playback on the audio element once upgraded to Hi-Fi!
      setTimeout(() => {
        const audioEl = document.getElementById(activeDeckRef.current === 0 ? 'deck-0-audio' : 'deck-1-audio')
          || document.getElementById('deck-0-audio')
          || document.getElementById('deck-1-audio');
        if (audioEl) {
          if (pos > 0 && Math.abs(audioEl.currentTime - pos) > 1) {
            try { audioEl.currentTime = pos; } catch (_) {}
          }
          const p = audioEl.play();
          if (p !== undefined) {
            p.then(() => {
              setIsPlaying(true);
              setIsBuffering(false);
              if (onPlayStateChange) onPlayStateChange(true);
            }).catch(() => {});
          }
        }
      }, 60);
    }
  }, [currentSong?.stream_url, currentSong?._hifiFailed, currentSong?._userForcedYoutube, isHifiEnabled, currentSong?._manualSourceSwitch]);

  // If nextSong receives its Hi-Fi stream_url while being preloaded on the inactive deck
  // (before the crossfade volume ramp has started), upgrade the preload deck to FLAC!
  useEffect(() => {
    if (!isHifiEnabled || !nextSong?.stream_url || !nextSong?.id) return;
    if (isCrossfadingRef.current || isCrossfadeRampingRef.current) return;
    if (!isPreloadingNextRef.current && !hasPreloadedNextRef.current) return;

    const inactiveDeck = 1 - activeDeckRef.current;
    const inactiveDeckSong = inactiveDeck === 0 ? deck0Song : deck1Song;
    if (
      inactiveDeckSong &&
      inactiveDeckSong.id === nextSong.id &&
      !inactiveDeckSong.stream_url &&
      !inactiveDeckSong._hifiFailed
    ) {
      const upgraded = { ...nextSong };
      crossfadeSongRef.current = upgraded;
      hasPreloadedNextRef.current = false;
      isPreloadingNextRef.current = true;
      if (inactiveDeck === 0) {
        try { deck0PlayerRef.current?.stopVideo?.(); } catch (e) {}
        setDeck0Song(upgraded);
      } else {
        try { deck1PlayerRef.current?.stopVideo?.(); } catch (e) {}
        setDeck1Song(upgraded);
      }
    }
  }, [nextSong?.stream_url, isHifiEnabled]);



  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Time tracking on activeDeck
  useEffect(() => {
    let interval;
    if (isPlaying && !isDragging) {
      interval = setInterval(async () => {
        const activeSong = activeDeckRef.current === 0 ? deck0Song : deck1Song;
        if (isAudioElementPlayback(activeSong || currentSong)) {
          const activeAudioId = activeDeckRef.current === 0 ? 'deck-0-audio' : 'deck-1-audio';
          const audioEl = document.getElementById(activeAudioId)
            || document.getElementById('deck-0-audio')
            || document.getElementById('deck-1-audio');
          if (audioEl) {
            const time = audioEl.currentTime;
            const fallbackDur = parseDurationToSecs((activeSong || currentSong)?.duration);
            const dur = (Number.isFinite(audioEl.duration) && audioEl.duration > 0 && audioEl.duration !== Infinity)
              ? audioEl.duration
              : (fallbackDur > 0 ? fallbackDur : (durationRef.current > 0 ? durationRef.current : 0));

            if (Number.isFinite(time)) {
              setCurrentTime(time);
              if (onTimeUpdate) onTimeUpdate(time);
            }
            if (dur > 0 && Number.isFinite(dur)) {
              setDuration(dur);
              if (!isOfflinePlayback) {
                checkAutoCrossfade(time, dur);
              }
            }
          }
        } else {
          const player = activeDeckRef.current === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
          if (player && typeof player.getCurrentTime === 'function') {
            try {
              const time = await player.getCurrentTime();
              const dur = await player.getDuration();
              setCurrentTime(time || 0);
              if (onTimeUpdate) onTimeUpdate(time || 0);
              setDuration(dur || 0);

              // Check auto-crossfade trigger
              if (!isOfflinePlayback) {
                checkAutoCrossfade(time || 0, dur || 0);
              }
            } catch (e) {}
          }
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isDragging, currentSong, deck0Song, deck1Song, streamUrl, crossfadeDuration, effectiveCrossfadeDuration, isOfflinePlayback, onTimeUpdate, nextSong, hasNext, repeatMode, activeDeck]);

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
    const activeDeckSong = (activeDeckRef.current === 0 ? deck0Song : deck1Song) || currentSong;
    if (isAudioElementPlayback(activeDeckSong)) {
      const audioEl = document.getElementById(activeDeckRef.current === 0 ? 'deck-0-audio' : 'deck-1-audio')
        || document.getElementById('deck-0-audio')
        || document.getElementById('deck-1-audio');
      if (audioEl) {
        if (isPlaying && !audioEl.paused) {
          audioEl.pause();
          setIsPlaying(false);
          if (onPlayStateChange) onPlayStateChange(false);
        } else {
          // If the audio element is broken or failed, trigger immediate stream fallback rather than freezing
          if (audioEl.error || (audioEl.networkState === 3 && audioEl.readyState === 0)) {
            console.warn('[HIFI] togglePlay detected broken audio stream. Triggering fallback.');
            handleAudioStreamFailure(activeDeckRef.current, currentTime);
            return;
          }
          const p = audioEl.play();
          if (p !== undefined) {
            p.then(() => {
              setIsPlaying(true);
              setIsBuffering(false);
              if (onPlayStateChange) onPlayStateChange(true);
            }).catch((err) => {
              console.warn('[HIFI] togglePlay audio.play() prevented:', err);
              if (audioEl.error || (audioEl.networkState === 3 && audioEl.readyState === 0)) {
                handleAudioStreamFailure(activeDeckRef.current, currentTime);
              }
            });
          }
        }
      } else {
        // Audio element not mounted yet (rendering in progress). Simply update isPlaying state so autoPlay / onCanPlay picks it up
        setIsPlaying(true);
        if (onPlayStateChange) onPlayStateChange(true);
      }
      return;
    }
    
    const activePlayer = activeDeckRef.current === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (!activePlayer) {
      console.warn('[PLAYER] YouTube player not ready on active deck');
      return;
    }
    if (isPlaying) {
      activePlayer.pauseVideo();
    } else {
      activePlayer.playVideo();
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    const activeDeckSong = (activeDeckRef.current === 0 ? deck0Song : deck1Song) || currentSong;
    if (isAudioElementPlayback(activeDeckSong)) {
      const audioEl = document.getElementById(activeDeckRef.current === 0 ? 'deck-0-audio' : 'deck-1-audio');
      if (audioEl) audioEl.muted = !isMuted;
      return;
    }
    
    const activePlayer = activeDeckRef.current === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
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
      if (effectiveCrossfadeDuration > 0 && isTransitioningSongRef.current) {
        applyDeckVolume(deckIndex, 0);
        fadeIn(Math.min(effectiveCrossfadeDuration * 1000, 1500));
      } else if (!activeFadeIntervalRef.current) {
        event.target.setVolume(isMuted ? 0 : masterVolume);
      }
      isTransitioningSongRef.current = false;
      const activeDeckSong = deckIndex === 0 ? deck0Song : deck1Song;
      const targetStart = Math.floor(activeDeckSong?.startSeconds || activeDeckSong?.initialTime || startSecs || 0);
      if (targetStart > 0) {
        try { event.target.seekTo(targetStart, true); } catch (e) {}
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
        setIsBuffering(false);
        if (onPlayStateChange) onPlayStateChange(true);
        if (effectiveCrossfadeDuration > 0 && isTransitioningSongRef.current) {
          isTransitioningSongRef.current = false;
          fadeIn(Math.min(effectiveCrossfadeDuration * 1000, 1500));
        } else if (!activeFadeIntervalRef.current && !isCrossfadingRef.current) {
          try { event.target.setVolume(isMuted ? 0 : masterVolume); } catch (e) {}
        }
      } else if (event.data === 2) { // PAUSED
        const activeSong = deckIndex === 0 ? deck0Song : deck1Song;
        if (isAudioElementPlayback(activeSong || currentSong)) {
          return;
        }
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
      if (event.data === 1) { // PLAYING
        if (crossfadeReadyTimeoutRef.current) {
          clearTimeout(crossfadeReadyTimeoutRef.current);
          crossfadeReadyTimeoutRef.current = null;
        }

        if (isCrossfadeRampingRef.current) {
          // Deck is playing as intended during volume ramp
          isPreloadingNextRef.current = false;
          hasPreloadedNextRef.current = true;
        } else if (isPreloadingNextRef.current && !isCrossfadingRef.current) {
          // Preload finished ahead of ramp! Pause it and wait for Phase 2.
          console.log(`[CROSSFADE-DEBUG] ✅ Preload finished on deck ${deckIndex}, pausing until ramp`);
          try { 
            event.target.pauseVideo();
          } catch (e) {}
          isPreloadingNextRef.current = false;
          hasPreloadedNextRef.current = true;
        } else if (isCrossfadingRef.current || isPreloadingNextRef.current) {
          // Incoming deck started playing DURING crossfade (either preload finished late or we skipped preload)
          isPreloadingNextRef.current = false;
          hasPreloadedNextRef.current = true;
          if (outgoingEndedDuringCrossfadeRef.current) {
            console.log(`[CROSSFADE] Incoming deck ${deckIndex} PLAYING, outgoing already ended — finishing immediately`);
            finishCrossfade();
          } else {
            console.log(`[CROSSFADE] Incoming deck ${deckIndex} PLAYING — starting volume ramp`);
            startCrossfadeVolumeRamp();
          }
        }
      } else if (event.data === 5 || event.data === -1) {
        try { event.target.playVideo(); } catch (e) {}
      }
    }
  };

  const handleAudioDeckPlay = (deckIndex) => {
    if (deckIndex === activeDeckRef.current) {
      setIsPlaying(true);
    setIsBuffering(false);
      handleStallClear();
      if (onPlayStateChange) onPlayStateChange(true);
    }
  };

  const handleAudioDeckPause = (deckIndex, e) => {
    if (deckIndex !== activeDeckRef.current) return;
    if (isCrossfadingRef.current || isCrossfadeRampingRef.current) return;
    if (e?.target?.ended) return;
    setIsPlaying(false);
    if (onPlayStateChange) onPlayStateChange(false);
  };

  const handleAudioDeckEnded = (deckIndex) => {
    if (deckIndex !== activeDeckRef.current) return;
    if (bufferingTimeoutRef.current) {
      clearTimeout(bufferingTimeoutRef.current);
      bufferingTimeoutRef.current = null;
    }
    if (isCrossfadingRef.current) {
      applyDeckVolume(deckIndex, 0);
      outgoingEndedDuringCrossfadeRef.current = true;
      console.log('[CROSSFADE] Outgoing audio deck ENDED during crossfade — finishing immediately');
      finishCrossfade();
    } else {
      handleTrackEnd();
    }
  };

  const handleAudioDeckReady = (deckIndex) => {
    if (deckIndex === activeDeckRef.current) return;
    if (isCrossfadeRampingRef.current || hasPreloadedNextRef.current) return;

    if (crossfadeReadyTimeoutRef.current) {
      clearTimeout(crossfadeReadyTimeoutRef.current);
      crossfadeReadyTimeoutRef.current = null;
    }

    const audioEl = document.getElementById(`deck-${deckIndex}-audio`);

    if (isPreloadingNextRef.current && !isCrossfadingRef.current) {
      console.log(`[CROSSFADE-DEBUG] ✅ Preload finished on audio deck ${deckIndex}, pausing until ramp`);
      if (audioEl) {
        try {
          audioEl.pause();
          const startSecs = Math.floor(crossfadeSongRef.current?.startSeconds || crossfadeSongRef.current?.initialTime || 0);
          audioEl.currentTime = startSecs;
        } catch (e) {}
      }
      isPreloadingNextRef.current = false;
      hasPreloadedNextRef.current = true;
    } else if (isCrossfadingRef.current && !isCrossfadeRampingRef.current) {
      isPreloadingNextRef.current = false;
      hasPreloadedNextRef.current = true;
      if (outgoingEndedDuringCrossfadeRef.current) {
        console.log(`[CROSSFADE] Incoming audio deck ${deckIndex} ready, outgoing already ended — finishing immediately`);
        finishCrossfade();
      } else {
        console.log(`[CROSSFADE] Incoming audio deck ${deckIndex} ready — starting volume ramp`);
        startCrossfadeVolumeRamp();
      }
    }
  };

  const streamRecoveryAttemptsRef = useRef({});
  const streamRecoveryTimersRef = useRef({});
  const failedHifiSongIdsRef = useRef(new Set());

  const handleAudioStreamFailure = (deckIndex, failedTime = 0) => {
    const deckSong = deckIndex === 0 ? deck0Song : deck1Song;
    if (!deckSong) return;

    const sId = String(deckSong.hifi_id || deckSong.id);
    const attempts = streamRecoveryAttemptsRef.current[sId] || 0;

    // Clear any existing pending recovery timer for this track
    if (streamRecoveryTimersRef.current[sId]) {
      clearTimeout(streamRecoveryTimersRef.current[sId]);
      delete streamRecoveryTimersRef.current[sId];
    }

    // 1. Inactive deck (e.g. background preloading during crossfade)
    if (deckIndex !== activeDeckRef.current) {
      console.warn(`[HIFI] Preload audio stream failed on inactive deck ${deckIndex} for "${deckSong.title}". Falling back preload to YouTube.`);
      const fallbackSong = {
        ...deckSong,
        stream_url: null,
        blob_url: null,
        source: null,
        _hifiChecked: true,
        _hifiFailed: true,
        _userForcedYoutube: false
      };
      if (deckIndex === 0) setDeck0Song(fallbackSong);
      else setDeck1Song(fallbackSong);
      return;
    }

    // 2. Local offline file
    if (deckSong.is_local) {
      console.error(`[LOCAL] Offline audio file playback failed for "${deckSong.title}"`);
      if (onError) onError(`Failed to play local audio file: ${deckSong.title || 'Unknown'}`);
      return;
    }

    // 3. Audio stream error handling & resilient retry
    const audioEl = document.getElementById(deckIndex === 0 ? 'deck-0-audio' : 'deck-1-audio');
    const pos = Math.max(0, failedTime || currentTime || 0);
    const errorCode = audioEl?.error?.code;

    // Fatal check: format error, unsupported source at start, or repeated failure at startup
    const isInitialFatal = (pos < 1.5 && attempts >= 1) || errorCode === 3 || (errorCode === 4 && pos < 1.0 && attempts >= 1);

    if (!isInitialFatal && attempts < 2 && audioEl && isSongHiFi(deckSong) && !failedHifiSongIdsRef.current.has(sId)) {
      streamRecoveryAttemptsRef.current[sId] = attempts + 1;
      const delay = attempts === 0 ? 300 : 1000;
      console.warn(`[HIFI] Audio stream hiccup (code ${errorCode}) at ${pos.toFixed(1)}s for "${deckSong.title}". Attempting recovery ${attempts + 1}/2 in ${delay}ms...`);

      streamRecoveryTimersRef.current[sId] = setTimeout(() => {
        delete streamRecoveryTimersRef.current[sId];
        const currentActiveDeckSong = activeDeckRef.current === 0 ? deck0Song : deck1Song;
        if (!currentActiveDeckSong || String(currentActiveDeckSong.hifi_id || currentActiveDeckSong.id) !== sId) {
          return; // Track changed or deck switched during timeout delay
        }

        try {
          // Reconnect with fresh connection / cache buster
          const baseStreamUrl = deckSong.stream_url;
          if (!baseStreamUrl) {
            handleAudioStreamFailure(deckIndex, pos);
            return;
          }

          const sep = baseStreamUrl.includes('?') ? '&' : '?';
          const retryUrl = `${baseStreamUrl}${sep}retry=${attempts + 1}&t=${Date.now()}`;
          audioEl.src = retryUrl;
          audioEl.load();
          if (pos > 0) {
            audioEl.currentTime = pos;
          }
          audioEl.play().catch(e => {
            console.warn(`[HIFI] Retry ${attempts + 1} play failed, trying next:`, e);
            handleAudioStreamFailure(deckIndex, pos);
          });
        } catch (e) {
          handleAudioStreamFailure(deckIndex, pos);
        }
      }, delay);
      return;
    }

    // 4. Recovery exhausted or fatal: fall back to YouTube for this playback without polluting persistent cache
    console.warn(`[HIFI] Hi-Fi recovery exhausted (${attempts} attempts) for "${deckSong.title}". Seamlessly falling back to YouTube at ${pos.toFixed(1)}s without modal error.`);
    failedHifiSongIdsRef.current.add(sId);
    if (deckSong.id) failedHifiSongIdsRef.current.add(String(deckSong.id));
    if (deckSong.hifi_id) failedHifiSongIdsRef.current.add(String(deckSong.hifi_id));

    // Stop and kill audio element completely
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
      } catch (_) {}
    }

    const fallbackSong = {
      ...deckSong,
      stream_url: null,
      blob_url: null,
      source: null,
      startSeconds: Math.floor(pos),
      _hifiChecked: true,
      _hifiFailed: true,
      _userForcedYoutube: false
    };

    if (deckIndex === 0) {
      setDeck0Song(fallbackSong);
    } else {
      setDeck1Song(fallbackSong);
    }

    // Notify App.jsx so playlist[currentIndex] and currentSong are updated
    if (onSongHifiFailed) {
      onSongHifiFailed(deckSong);
    }

    // If Monochrome track without YouTube ID, resolve YouTube counterpart
    const isYtId = Boolean(deckSong.id && /^[a-zA-Z0-9_-]{11}$/.test(deckSong.id));
    if (!isYtId && api.searchYouTube) {
      const q = `${deckSong.title || ''} ${deckSong.channel || deckSong.artist || ''}`.trim();
      api.searchYouTube(q, 'song').then(res => {
        const topYt = res?.[0];
        if (topYt && topYt.id) {
          const ytSong = {
            ...fallbackSong,
            id: topYt.id,
            stream_url: null,
            blob_url: null,
            source: null,
          };
          if (deckIndex === 0) setDeck0Song(ytSong);
          else setDeck1Song(ytSong);
        }
      }).catch(e => console.warn('[HIFI] YouTube search fallback error:', e));
    }

    setCurrentTime(pos);
    setIsPlaying(true);
    setIsBuffering(false);
  };

  const handleTrackEnd = () => {
    if (repeatMode === 1) {
      setCurrentTime(startSecs);
      hasTriggeredEndCrossfadeRef.current = false;
      if (onTimeUpdate) onTimeUpdate(startSecs);
      
      const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
      if (isAudioElementPlayback(currentSong)) {
        const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
        if (audioEl) { 
          audioEl.currentTime = startSecs; 
          audioEl.play(); 
          if (effectiveCrossfadeDuration > 0) fadeIn(Math.min(effectiveCrossfadeDuration * 1000, 1500));
        }
      } else if (activePlayer) {
        activePlayer.seekTo(startSecs, true);
        activePlayer.playVideo();
        if (effectiveCrossfadeDuration > 0) fadeIn(Math.min(effectiveCrossfadeDuration * 1000, 1500));
      }
    } else if (repeatMode === 2) {
      if (playCount < 1) {
        setPlayCount(1);
        setCurrentTime(startSecs);
        hasTriggeredEndCrossfadeRef.current = false;
        if (onTimeUpdate) onTimeUpdate(startSecs);
        
        const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
        if (isAudioElementPlayback(currentSong)) {
          const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
          if (audioEl) { 
            audioEl.currentTime = startSecs; 
            audioEl.play(); 
            if (effectiveCrossfadeDuration > 0) fadeIn(Math.min(effectiveCrossfadeDuration * 1000, 1500));
          }
        } else if (activePlayer) {
          activePlayer.seekTo(startSecs, true);
          activePlayer.playVideo();
          if (effectiveCrossfadeDuration > 0) fadeIn(Math.min(effectiveCrossfadeDuration * 1000, 1500));
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
      const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
      if (audioEl) audioEl.muted = false;
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

  const seekTo = (targetTime) => {
    if (!currentSong) return;
    const maxDur = duration > 0 ? duration : Infinity;
    const clampedTime = Math.max(0, Math.min(maxDur, targetTime));
    setCurrentTime(clampedTime);
    if (onTimeUpdate) onTimeUpdate(clampedTime);
    isTransitioningSongRef.current = false;
    cancelCrossfade();
    if (activeFadeIntervalRef.current) {
      clearInterval(activeFadeIntervalRef.current);
      activeFadeIntervalRef.current = null;
    }
    applyActiveVolume(isMuted ? 0 : masterVolume);

    if (clampedTime < duration - effectiveCrossfadeDuration) {
      hasTriggeredEndCrossfadeRef.current = false;
    }

    const activeDeckSong = activeDeckRef.current === 0 ? deck0Song : deck1Song;
    if (isAudioElementPlayback(activeDeckSong)) {
      const audioEl = document.getElementById(activeDeckRef.current === 0 ? 'deck-0-audio' : 'deck-1-audio') 
        || document.getElementById('deck-0-audio') 
        || document.getElementById('deck-1-audio');
      if (audioEl) {
        audioEl.currentTime = clampedTime;
        if (isPlaying) { audioEl.play().catch(() => {}); }
      }
      return;
    }

    const activePlayer = activeDeckRef.current === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
    if (activePlayer) {
      if (needsSeekFixRef.current) {
        activePlayer.loadVideoById(activeDeckSong?.id || currentSong.id, clampedTime);
        needsSeekFixRef.current = false;
      } else {
        activePlayer.seekTo(clampedTime, true);
      }
    }
  };

  const seekBy = (deltaSeconds) => {
    let baseTime = currentTime;
    if (currentSong && isAudioElementPlayback(currentSong)) {
      const audioEl = document.getElementById(activeDeck === 0 ? 'deck-0-audio' : 'deck-1-audio');
      if (audioEl && Number.isFinite(audioEl.currentTime)) {
        baseTime = audioEl.currentTime;
      }
    } else {
      const activePlayer = activeDeck === 0 ? deck0PlayerRef.current : deck1PlayerRef.current;
      if (activePlayer && typeof activePlayer.getCurrentTime === 'function') {
        try {
          const pt = activePlayer.getCurrentTime();
          if (Number.isFinite(pt)) baseTime = pt;
        } catch (_) {}
      }
    }
    seekTo(baseTime + deltaSeconds);
  };

  const handleSeekMouseUp = (e) => {
    setIsDragging(false);
    seekTo(Number(e.target.value));
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
    handleAudioDeckPlay,
    handleAudioDeckPause,
    handleAudioDeckEnded,
    handleAudioDeckReady,
    handleAudioStreamFailure,
    
    isPlaying, setIsPlaying,
    isBuffering, setIsBuffering,
    masterVolume,
    isMuted,
    crossfadeDuration, setCrossfadeDuration,
    effectiveCrossfadeDuration,
    isOfflinePlayback,
    toggleCrossfade,
    hasTriggeredEndCrossfadeRef,
    isTransitioningSongRef,
    activeFadeIntervalRef,
    isCrossfading,
    cancelCrossfade,
    finishCrossfade,
    checkAutoCrossfade,
    currentTime, setCurrentTime,
    duration, setDuration,
    bufferedPercent, setBufferedPercent,
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
    seekTo,
    seekBy,
    formatTime,
    isSongHiFi,
    isAudioElementPlayback
  };
}
