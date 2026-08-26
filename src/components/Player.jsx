import React, { useImperativeHandle } from 'react';
import ProxyYouTube from './ProxyYouTube';
import PlayerControls from './PlayerControls';
import { Loader2, Subtitles, Play, Pause, SkipBack, SkipForward, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../services/api';
import { usePlayerCore } from '../hooks/usePlayerCore';

const Player = React.forwardRef(function Player({ 
  currentSong, onNext, onPrevious, hasNext, hasPrevious, onPlayStateChange, onTimeUpdate, onError, isMaximized, isVideoHidden,
  repeatMode, onToggleRepeat, isShuffle, onToggleShuffle, onSongEnded, onRestoreHandled, isSearchExpanded,
  albumInfo, isLoadingAlbum, onAlbumClick, isMiniPlayer, onToggleMiniPlayer
}, ref) {
  
  const core = usePlayerCore({
    currentSong,
    onNext,
    onPrevious,
    hasNext,
    hasPrevious,
    onPlayStateChange,
    onTimeUpdate,
    onError,
    repeatMode,
    onSongEnded
  });

  useImperativeHandle(ref, () => ({
    togglePlay: core.togglePlay,
    toggleMute: core.toggleMute,
    fadeOut: core.fadeOut,
    fadeIn: core.fadeIn
  }), [core]);

  const startSecs = Math.floor(currentSong?.startSeconds || currentSong?.initialTime || 0);

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
        <div 
          onMouseEnter={() => core.setIsVideoHovered(true)}
          onMouseLeave={() => { core.setIsVideoHovered(false); core.setIsCaptionMenuOpen(false); }}
          style={isMaximized ? {
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
            {currentSong && !currentSong.is_local && !core.streamUrl && !core.isExtractingStream && (
              <ProxyYouTube
                videoId={currentSong.id}
                onCaptionsReceived={core.handleCaptionsReceived}
                opts={opts}
                onReady={core.onReady}
                onStateChange={core.onStateChange}
                onError={async (e) => {
                  console.error("YouTube Error:", e);
                  // Error codes 101/150 mean embedding is disabled. Fallback to extracting the raw stream!
                  if (!core.streamUrl && !core.isExtractingStream) {
                    core.setIsExtractingStream(true);
                    try {
                      const url = await api.getStreamUrl(currentSong.id);
                      core.setStreamUrl(url);
                    } catch (err) {
                      console.error("Stream extraction fallback failed:", err);
                      if (hasNext) {
                        onNext();
                      } else {
                        core.setIsPlaying(false);
                        if (onPlayStateChange) onPlayStateChange(false);
                        if (onError) onError(`Failed to stream track from YouTube: ${err}`);
                      }
                    } finally {
                      core.setIsExtractingStream(false);
                    }
                  }
                }}
                style={{ width: '100%', height: '100%' }}
                iframeClassName="youtube-iframe"
              />
            )}
            {core.captions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  zIndex: 100,
                  opacity: core.isVideoHovered || core.isCaptionMenuOpen ? 1 : 0,
                  transition: 'opacity 0.2s',
                  pointerEvents: core.isVideoHovered || core.isCaptionMenuOpen ? 'auto' : 'none'
                }}
              >
                <div style={{ position: 'relative' }}>
                  <button
                    className="btn btn-icon"
                    onClick={() => core.setIsCaptionMenuOpen(!core.isCaptionMenuOpen)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      color: core.activeCaptionCode ? 'var(--accent-color)' : '#fff',
                      backdropFilter: 'blur(4px)',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}
                  >
                    <Subtitles size={20} />
                  </button>
                  {core.isCaptionMenuOpen && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '4px',
                      background: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '4px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                      minWidth: '120px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      maxHeight: '200px',
                      overflowY: 'auto'
                    }}>
                      <button 
                        onClick={() => core.selectCaption(null)}
                        style={{
                          background: !core.activeCaptionCode ? 'var(--text-main)' : 'transparent',
                          color: !core.activeCaptionCode ? 'var(--bg-color)' : 'var(--text-main)',
                          padding: '6px 12px',
                          border: 'none',
                          borderRadius: '4px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '0.9rem'
                        }}
                      >Off</button>
                      {core.captions.map(c => (
                        <button
                          key={c.languageCode}
                          onClick={() => core.selectCaption(c.languageCode)}
                          style={{
                            background: core.activeCaptionCode === c.languageCode ? 'var(--text-main)' : 'transparent',
                            color: core.activeCaptionCode === c.languageCode ? 'var(--bg-color)' : 'var(--text-main)',
                            padding: '6px 12px',
                            border: 'none',
                            borderRadius: '4px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {c.languageName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {core.isExtractingStream && (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: 'rgba(0,0,0,0.5)' }}>
                <Loader2 className="spinning" style={{ color: 'var(--accent-color)', marginBottom: '16px' }} size={40} />
                <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>Bypassing embed block...</div>
              </div>
            )}
            {currentSong && (currentSong.is_local || core.streamUrl) && (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <div style={{ fontSize: '3rem', color: 'var(--accent-color)', opacity: 0.8, marginBottom: '16px' }}>
                   ♪
                </div>
                <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>{currentSong.is_local ? 'Playing Offline' : 'Audio Stream Fallback'}</div>
                <audio
                  id="local-audio-player"
                  src={currentSong.is_local ? convertFileSrc(currentSong.file_path) : core.streamUrl}
                  autoPlay
                  onPlay={() => { core.setIsPlaying(true); core.handleStallClear(); if (onPlayStateChange) onPlayStateChange(true); }}
                  onPause={() => { core.setIsPlaying(false); if (onPlayStateChange) onPlayStateChange(false); }}
                  onEnded={core.handleTrackEnd}
                  onTimeUpdate={(e) => {
                    if (!core.isDragging) {
                      core.setCurrentTime(e.target.currentTime);
                      if (onTimeUpdate) onTimeUpdate(e.target.currentTime);
                    }
                  }}
                  onLoadedMetadata={(e) => {
                    core.setDuration(e.target.duration);
                    e.target.volume = core.isMuted ? 0 : (core.masterVolume / 100);
                  }}
                  onError={(e) => {
                    console.error("Local audio error", e);
                    if (onError) onError("Failed to play local audio file.");
                    core.handleStallClear();
                  }}
                  onWaiting={core.handleStallStart}
                  onStalled={core.handleStallStart}
                  onCanPlay={core.handleStallClear}
                  onPlaying={core.handleStallClear}
                />
              </div>
            )}
          </div>

          {!currentSong && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '20px', zIndex: 10 }}>
              No song playing.<br/>Search for music to get started!
            </div>
          )}
          
          {/* Mini Player hover overlay */}
          {isMiniPlayer && currentSong && (
            <div 
              data-tauri-drag-region 
              style={{
                position: 'absolute',
                inset: 0,
                background: core.isVideoHovered ? 'rgba(0,0,0,0.6)' : 'transparent',
                opacity: core.isVideoHovered ? 1 : 0,
                transition: 'all 0.2s ease',
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                borderRadius: '12px'
              }}
            >
              <div data-tauri-drag-region style={{
                position: 'absolute', top: '12px', left: '12px',
                display: 'flex', flexDirection: 'column', gap: '2px',
                color: '#fff', zIndex: 25, maxWidth: 'calc(100% - 48px)',
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                overflow: 'hidden'
              }}>
                <div data-tauri-drag-region className="mini-player-marquee-container" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  <span data-tauri-drag-region className="mini-player-marquee-text">{currentSong.title}</span>
                </div>
                <div data-tauri-drag-region className="mini-player-marquee-container" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                  <span data-tauri-drag-region className="mini-player-marquee-text">{albumInfo?.artist || (currentSong.channel || '').replace(/\s*-\s*Topic$/i, '').trim()}</span>
                </div>
              </div>

              <button 
                onClick={onToggleMiniPlayer}
                style={{
                  position: 'absolute', top: '12px', right: '12px',
                  background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff',
                  borderRadius: '50%', padding: '6px', cursor: 'pointer', zIndex: 25,
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <X size={16} />
              </button>

              <button className="btn btn-icon" onClick={onPrevious} disabled={!hasPrevious} style={{ zIndex: 25, color: '#fff', background: 'transparent' }}>
                <SkipBack size={24} />
              </button>
              <button className="btn btn-icon" onClick={core.togglePlay} style={{ background: 'var(--accent-color)', color: '#fff', borderRadius: '50%', padding: '12px', zIndex: 25 }}>
                {core.isPlaying ? <Pause size={24} /> : <Play size={24} />}
              </button>
              <button className="btn btn-icon" onClick={onNext} disabled={!hasNext} style={{ zIndex: 25, color: '#fff', background: 'transparent' }}>
                <SkipForward size={24} />
              </button>
            </div>
          )}

          {/* Invisible overlay */}
          {!isMiniPlayer && currentSong && <div data-tauri-drag-region style={{ position: 'absolute', inset: 0, background: 'transparent', zIndex: 5 }} />}
        </div>
      </div>

      {!isMiniPlayer && (
        <PlayerControls
          currentSong={currentSong}
          isPlaying={core.isPlaying}
          isBuffering={core.isBuffering}
          currentTime={core.currentTime}
          duration={core.duration}
          masterVolume={core.masterVolume}
          isMuted={core.isMuted}
          repeatMode={repeatMode}
          isShuffle={isShuffle}
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          isSearchExpanded={isSearchExpanded}
          isVolumeHovered={core.isVolumeHovered}
          setIsVolumeHovered={core.setIsVolumeHovered}
          handleSeekChange={core.handleSeekChange}
          handleSeekMouseDown={core.handleSeekMouseDown}
          handleSeekMouseUp={core.handleSeekMouseUp}
          onToggleShuffle={onToggleShuffle}
          onPrevious={onPrevious}
          togglePlay={core.togglePlay}
          onNext={onNext}
          onToggleRepeat={onToggleRepeat}
          handleVolumeChange={core.handleVolumeChange}
          toggleMute={core.toggleMute}
          formatTime={core.formatTime}
          albumInfo={albumInfo}
          isLoadingAlbum={isLoadingAlbum}
          onAlbumClick={onAlbumClick}
        />
      )}
    </div>
  );
});

export default Player;
