import React, { useRef, useState, useEffect, useImperativeHandle } from 'react';
import ProxyYouTube from './ProxyYouTube';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Loader2, Shuffle, Repeat, Repeat1 } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

const Player = React.forwardRef(function Player({ 
  currentSong, onNext, onPrevious, hasNext, hasPrevious, onPlayStateChange, onTimeUpdate, onError, isMaximized, isVideoHidden,
  repeatMode, onToggleRepeat, isShuffle, onToggleShuffle, onSongEnded, onRestoreHandled
}, ref) {
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
  
  // Track how many times this specific song has repeated for 'repeat once' mode
  const [playCount, setPlayCount] = useState(0);

  const stallTimeoutRef = useRef(null);

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
          invoke('get_stream_url', { videoId: currentSong.id })
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
                if (onError) onError("Failed to stream track from YouTube.");
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

  // togglePlayRef and toggleMuteRef are assigned after those functions are defined below.
  const togglePlayRef = useRef(null);
  const toggleMuteRef = useRef(null);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', togglePlay);
      navigator.mediaSession.setActionHandler('pause', togglePlay);
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious ? () => onPrevious() : null);
      navigator.mediaSession.setActionHandler('nexttrack', hasNext ? () => onNext() : null);
    }
  }, [isPlaying, hasPrevious, hasNext, onPrevious, onNext]);

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

  // Assign refs AFTER the functions are defined to avoid temporal dead zone.
  // These stay current on every render so the keyboard handler in App always
  // calls the latest version without needing to re-register the listener.
  togglePlayRef.current = togglePlay;
  toggleMuteRef.current = toggleMute;

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

  useImperativeHandle(ref, () => ({
    togglePlay: () => togglePlayRef.current?.(),
    toggleMute: () => toggleMuteRef.current?.(),
    fadeOut: (durationMs = 250) => {
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
    },
    fadeIn: (durationMs = 350) => {
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
    }
  }), [masterVolume, isMuted]);

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

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1, // Crucial for auto-playing when videoId changes
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      start: startSecs > 0 ? startSecs : undefined
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: isMaximized ? 1 : 'none', overflow: 'hidden', minHeight: 0 }}>
      {/* Video area wrapper — must be a sized flex container so height:100% resolves on child */}
      <div style={{ flex: isMaximized ? 1 : 'none', height: isMaximized ? 0 : 'auto', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0, overflow: 'hidden', containerType: isMaximized ? 'size' : 'normal' }}>
        <div style={isMaximized ? {
          /* Maximized: Use container queries to guarantee exact 16:9 fit within the parent without black bars */
          width: '100cqw',
          maxWidth: 'calc(100cqh * (16 / 9))',
          aspectRatio: '16 / 9',
          position: 'relative',
          background: '#000',
          borderRadius: '12px',
          overflow: 'hidden',
          opacity: isVideoHidden ? 0 : 1,
          transition: 'opacity 0.15s ease',
        } : {
          /* Default (normal window): stretch to 100% width and maintain exactly 16:9 height natively */
          width: '100%',
          height: 'auto',
          aspectRatio: '16 / 9',
          position: 'relative',
          background: '#000',
          borderRadius: '12px',
          overflow: 'hidden',
          opacity: isVideoHidden ? 0 : 1,
          transition: 'opacity 0.15s ease',
        }}>
          
          <div style={{ position: 'absolute', inset: 0 }}>
            {currentSong && !currentSong.is_local && !streamUrl && !isExtractingStream && (
              <ProxyYouTube
                videoId={currentSong.id}
                opts={opts}
                onReady={onReady}
                onStateChange={onStateChange}
                onError={async (e) => {
                  console.error("YouTube Error:", e);
                  // Error codes 101/150 mean embedding is disabled. Fallback to extracting the raw stream!
                  if (!streamUrl && !isExtractingStream) {
                    setIsExtractingStream(true);
                    try {
                      const url = await invoke('get_stream_url', { videoId: currentSong.id });
                      setStreamUrl(url);
                    } catch (err) {
                      console.error("Stream extraction fallback failed:", err);
                      if (hasNext) {
                        onNext();
                      } else {
                        setIsPlaying(false);
                        if (onPlayStateChange) onPlayStateChange(false);
                        if (onError) onError(`Failed to stream track from YouTube: ${err}`);
                      }
                    } finally {
                      setIsExtractingStream(false);
                    }
                  }
                }}
                style={{ width: '100%', height: '100%' }}
                iframeClassName="youtube-iframe"
              />
            )}
            {isExtractingStream && (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: 'rgba(0,0,0,0.5)' }}>
                <Loader2 className="spinning" style={{ color: 'var(--accent-color)', marginBottom: '16px' }} size={40} />
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Bypassing embed block...</div>
              </div>
            )}
            {currentSong && (currentSong.is_local || streamUrl) && (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <div style={{ fontSize: '3rem', color: 'var(--accent-color)', opacity: 0.8, marginBottom: '16px' }}>
                   ♪
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{currentSong.is_local ? 'Playing Offline' : 'Audio Stream Fallback'}</div>
                <audio
                  id="local-audio-player"
                  src={currentSong.is_local ? convertFileSrc(currentSong.file_path) : streamUrl}
                  autoPlay
                  onPlay={() => { setIsPlaying(true); handleStallClear(); if (onPlayStateChange) onPlayStateChange(true); }}
                  onPause={() => { setIsPlaying(false); if (onPlayStateChange) onPlayStateChange(false); }}
                  onEnded={handleTrackEnd}
                  onTimeUpdate={(e) => {
                    if (!isDragging) {
                      setCurrentTime(e.target.currentTime);
                      if (onTimeUpdate) onTimeUpdate(e.target.currentTime);
                    }
                  }}
                  onLoadedMetadata={(e) => {
                    setDuration(e.target.duration);
                    e.target.volume = isMuted ? 0 : (masterVolume / 100);
                  }}
                  onError={(e) => {
                    console.error("Local audio error", e);
                    if (onError) onError("Failed to play local audio file.");
                    handleStallClear();
                  }}
                  onWaiting={handleStallStart}
                  onStalled={handleStallStart}
                  onCanPlay={handleStallClear}
                  onPlaying={handleStallClear}
                />
              </div>
            )}
          </div>

          {!currentSong && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: '20px', zIndex: 10 }}>
              No song playing.<br/>Search for music to get started!
            </div>
          )}
          
          {/* Invisible overlay */}
          {currentSong && <div style={{ position: 'absolute', inset: 0, background: 'transparent', zIndex: 5 }} />}
        </div>
      </div>

      <div style={{ padding: '16px 0 0 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ width: '100%' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentSong ? currentSong.title : 'Waiting for music...'}
          </h3>
        </div>

        <div className="seek-bar-container">
          <span>{formatTime(currentTime)}</span>
          <input 
            type="range" 
            className="seek-bar"
            min={0} 
            max={duration || 100} 
            value={currentTime}
            onChange={handleSeekChange}
            onMouseDown={handleSeekMouseDown}
            onMouseUp={handleSeekMouseUp}
            onTouchStart={handleSeekMouseDown}
            onTouchEnd={handleSeekMouseUp}
            disabled={!currentSong}
            style={{
              background: `linear-gradient(to right, var(--accent-color) ${(currentTime / (duration || 1)) * 100}%, var(--panel-border) ${(currentTime / (duration || 1)) * 100}%)`
            }}
          />
          <span>{formatTime(duration)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button 
              className="btn btn-icon" 
              onClick={onToggleShuffle} 
              style={{ color: isShuffle ? 'var(--accent-color)' : 'var(--text-muted)' }}
            >
              <Shuffle size={20} />
            </button>
            <button className="btn btn-icon" onClick={onPrevious} disabled={!hasPrevious}>
              <SkipBack size={24} />
            </button>
            <button className="btn btn-icon btn-primary" onClick={togglePlay} disabled={!currentSong || isBuffering} style={{ padding: '10px' }}>
              {isBuffering ? <Loader2 size={24} className="animate-spin" /> : (isPlaying ? <Pause size={24} /> : <Play size={24} />)}
            </button>
            <button className="btn btn-icon" onClick={onNext} disabled={!hasNext}>
              <SkipForward size={24} />
            </button>
            <button 
              className="btn btn-icon" 
              onClick={onToggleRepeat} 
              style={{ color: repeatMode > 0 ? 'var(--accent-color)' : 'var(--text-muted)' }}
            >
              {repeatMode === 2 ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>

          <div
            style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
            onMouseEnter={() => setIsVolumeHovered(true)}
            onMouseLeave={() => setIsVolumeHovered(false)}
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              {/* Floating % tooltip — appears above speaker on hover */}
              <div style={{
                position: 'absolute',
                top: '-26px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '0.7rem',
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-main)',
                background: 'var(--panel-bg)',
                border: '1px solid var(--panel-border)',
                borderRadius: '4px',
                padding: '1px 5px',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                opacity: isVolumeHovered ? 1 : 0,
                transition: 'opacity 0.15s ease',
                zIndex: 10,
              }}>
                {isMuted ? 0 : masterVolume}%
              </div>
              <button className="btn btn-icon" style={{ border: 'none', background: 'transparent' }} onClick={toggleMute}>
                {isMuted || masterVolume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>
            <input
              type="range"
              className="seek-bar"
              min="0"
              max="100"
              value={isMuted ? 0 : masterVolume}
              onChange={handleVolumeChange}
              style={{
                width: '70px',
                background: `linear-gradient(to right, var(--accent-color) ${isMuted ? 0 : masterVolume}%, var(--panel-border) ${isMuted ? 0 : masterVolume}%)`
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export default Player;
