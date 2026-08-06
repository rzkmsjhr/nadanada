import React, { useRef, useState, useEffect } from 'react';
import YouTube from 'react-youtube';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX } from 'lucide-react';

export default function Player({ currentSong, onNext, onPrevious, hasNext, hasPrevious, onPlayStateChange, onTimeUpdate }) {
  const playerRef = useRef(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [masterVolume, setMasterVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Time tracking
  useEffect(() => {
    let interval;
    if (isPlaying && !isDragging) {
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
  }, [isPlaying, isDragging]);

  const onReady = (event) => {
    playerRef.current = event.target;
    event.target.setVolume(isMuted ? 0 : masterVolume);
  };

  const onStateChange = (event) => {
    if (event.data === 1) { // PLAYING
      setIsPlaying(true);
      if (onPlayStateChange) onPlayStateChange(true);
    } else if (event.data === 2) { // PAUSED
      setIsPlaying(false);
      if (onPlayStateChange) onPlayStateChange(false);
    } else if (event.data === 0) { // ENDED
      setIsPlaying(false);
      if (onPlayStateChange) onPlayStateChange(false);
      setCurrentTime(0);
      if (onTimeUpdate) onTimeUpdate(0);
      if (hasNext) onNext();
    } else if (event.data === 5 || event.data === -1) {
      // CUED (5) or UNSTARTED (-1)
      event.target.playVideo();
    }
  };

  const togglePlay = () => {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (playerRef.current) {
      if (!isMuted) playerRef.current.mute();
      else {
        playerRef.current.unMute();
        playerRef.current.setVolume(masterVolume);
      }
    }
  };

  const handleVolumeChange = (e) => {
    const val = Number(e.target.value);
    setMasterVolume(val);
    if (val > 0) setIsMuted(false);
    if (playerRef.current) playerRef.current.setVolume(val);
  };

  const handleSeekChange = (e) => {
    setCurrentTime(Number(e.target.value));
  };

  const handleSeekMouseUp = (e) => {
    setIsDragging(false);
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
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ 
          width: '100%', 
          height: 'auto', 
          maxHeight: '100%', 
          aspectRatio: '16 / 9', 
          position: 'relative', 
          background: '#000', 
          borderRadius: '12px', 
          overflow: 'hidden' 
        }}>
          
          <div style={{ position: 'absolute', inset: 0 }}>
            {currentSong && (
              <YouTube
                videoId={currentSong.id}
                opts={opts}
                onReady={onReady}
                onStateChange={onStateChange}
                style={{ width: '100%', height: '100%' }}
                iframeClassName="youtube-iframe"
              />
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
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button className="btn btn-icon" onClick={onPrevious} disabled={!hasPrevious}>
              <SkipBack size={24} />
            </button>
            <button className="btn btn-icon btn-primary" onClick={togglePlay} disabled={!currentSong} style={{ padding: '12px' }}>
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button className="btn btn-icon" onClick={onNext} disabled={!hasNext}>
              <SkipForward size={24} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-icon" style={{ border: 'none', background: 'transparent' }} onClick={toggleMute}>
              {isMuted || masterVolume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
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
}
