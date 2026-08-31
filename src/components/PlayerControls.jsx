import React, { useState, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Loader2, Shuffle, Repeat, Repeat1, Maximize2, Minimize2 } from 'lucide-react';

export default function PlayerControls({
  currentSong,
  isPlaying,
  isBuffering,
  currentTime,
  duration,
  masterVolume,
  isMuted,
  repeatMode,
  isShuffle,
  hasNext,
  hasPrevious,
  isSearchExpanded,
  isVolumeHovered,
  setIsVolumeHovered,
  handleSeekChange,
  handleSeekMouseDown,
  handleSeekMouseUp,
  onToggleShuffle,
  onPrevious,
  togglePlay,
  onNext,
  onToggleRepeat,
  handleVolumeChange,
  toggleMute,
  formatTime,
  albumInfo,
  isLoadingAlbum,
  onAlbumClick,
  isMaximized,
  isFullscreen,
  onToggleFullscreen
}) {
  const [isSubtitleHovered, setIsSubtitleHovered] = useState(false);
  const [shouldScrollSubtitle, setShouldScrollSubtitle] = useState(false);
  const subtitleTextRef = useRef(null);

  const handleSubtitleMouseEnter = () => {
    if (subtitleTextRef.current) {
      setShouldScrollSubtitle(subtitleTextRef.current.scrollWidth > subtitleTextRef.current.clientWidth);
    }
    setIsSubtitleHovered(true);
  };

  const handleSubtitleMouseLeave = () => {
    setIsSubtitleHovered(false);
    setShouldScrollSubtitle(false);
  };

  // Build the subtitle string: "Artist · Album"
  const getSubtitle = () => {
    if (!currentSong) return null;
    
    // Use albumInfo artist if available, else fall back to channel with Topic cleaned
    let artist = albumInfo?.artist || (currentSong.channel || '').replace(/\s*-\s*Topic$/i, '').trim();
    let album = albumInfo?.album || '';
    
    if (!artist && !album) return null;
    
    const parts = [];
    if (artist) parts.push(artist);
    if (album) parts.push(album);
    return parts;
  };

  const subtitleParts = getSubtitle();

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: isSearchExpanded ? '0fr' : '1fr',
      transition: 'grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
    }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ padding: '16px 0 0 0', display: 'flex', flexDirection: 'column', gap: '12px', opacity: isSearchExpanded ? 0 : 1, transition: 'opacity 0.25s ease', pointerEvents: isSearchExpanded ? 'none' : 'auto' }}>
          <div style={{ width: '100%' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentSong ? currentSong.title : 'Waiting for music...'}
            </h3>
            {subtitleParts && (
              <div 
                className="song-title-wrapper"
                style={{ marginTop: '2px' }}
                onMouseEnter={handleSubtitleMouseEnter}
                onMouseLeave={handleSubtitleMouseLeave}
              >
                <div 
                  ref={subtitleTextRef}
                  className={`song-title ${isSubtitleHovered && shouldScrollSubtitle ? 'scrolling' : ''}`}
                  style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}
                >
                  {subtitleParts.map((part, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>}
                      {i === subtitleParts.length - 1 && albumInfo?.album && part === albumInfo.album ? (
                        <span 
                          onClick={(e) => { e.stopPropagation(); if (onAlbumClick) onAlbumClick(albumInfo); }}
                          className="album-link"
                          title={`Browse "${albumInfo.album}" album`}
                        >
                          {part}
                        </span>
                      ) : (
                        <span>{part}</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
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
                style={{ 
                  color: isShuffle ? 'var(--bg-color)' : 'var(--text-muted)',
                  background: isShuffle ? 'var(--text-main)' : 'transparent',
                  boxShadow: isShuffle ? '0 2px 8px rgba(0,0,0,0.1)' : 'none'
                }}
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
                style={{ 
                  color: repeatMode > 0 ? 'var(--bg-color)' : 'var(--text-muted)',
                  background: repeatMode > 0 ? 'var(--text-main)' : 'transparent',
                  boxShadow: repeatMode > 0 ? '0 2px 8px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                {repeatMode === 2 ? <Repeat1 size={20} /> : <Repeat size={20} />}
              </button>
            </div>

            <div
              style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
              onMouseEnter={() => setIsVolumeHovered(true)}
              onMouseLeave={() => setIsVolumeHovered(false)}
            >
              {(isMaximized || isFullscreen) && (
                <button 
                  className="btn btn-icon" 
                  style={{ border: 'none', background: 'transparent' }} 
                  onClick={onToggleFullscreen}
                  title={isFullscreen ? "Exit Fullscreen (Esc)" : "Fullscreen Video"}
                >
                  {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              )}

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
    </div>
  );
}
