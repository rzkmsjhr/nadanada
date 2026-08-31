import React, { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import ProxyYouTube from './ProxyYouTube';
import PlayerControls from './PlayerControls';
import { Loader2, Subtitles, Play, Pause, SkipBack, SkipForward, X, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../services/api';
import { usePlayerCore } from '../hooks/usePlayerCore';

const Player = React.forwardRef(function Player({ 
  currentSong, nextSong, onNext, onPrevious, hasNext, hasPrevious, onPlayStateChange, onTimeUpdate, onError, isMaximized, isFullscreen, onToggleFullscreen, isVideoHidden,
  repeatMode, onToggleRepeat, isShuffle, onToggleShuffle, onSongEnded, onRestoreHandled, isSearchExpanded,
  albumInfo, isLoadingAlbum, onAlbumClick, isMiniPlayer, onToggleMiniPlayer,
  crossfadeDuration, setCrossfadeDuration
}, ref) {
  
  const core = usePlayerCore({
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
    crossfadeDuration,
    setCrossfadeDuration
  });

  const [showFullscreenControls, setShowFullscreenControls] = useState(true);
  const fullscreenTimerRef = useRef(null);

  const resetFullscreenTimer = useCallback(() => {
    setShowFullscreenControls(true);
    if (fullscreenTimerRef.current) {
      clearTimeout(fullscreenTimerRef.current);
    }
    fullscreenTimerRef.current = setTimeout(() => {
      if (!core.isDragging && !core.isCaptionMenuOpen) {
        setShowFullscreenControls(false);
      }
    }, 2500);
  }, [core.isDragging, core.isCaptionMenuOpen]);

  useEffect(() => {
    if (isFullscreen) {
      resetFullscreenTimer();
    } else {
      setShowFullscreenControls(true);
      if (fullscreenTimerRef.current) clearTimeout(fullscreenTimerRef.current);
    }
    return () => {
      if (fullscreenTimerRef.current) clearTimeout(fullscreenTimerRef.current);
    };
  }, [isFullscreen, resetFullscreenTimer]);

  useImperativeHandle(ref, () => ({
    togglePlay: core.togglePlay,
    toggleMute: core.toggleMute,
    fadeOut: core.fadeOut,
    fadeIn: core.fadeIn,
    getCurrentTime: () => core.currentTime,
    crossfadeDuration: core.crossfadeDuration,
    toggleCrossfade: core.toggleCrossfade
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
    <div 
      onMouseMove={isFullscreen ? resetFullscreenTimer : undefined}
      onMouseEnter={isFullscreen ? resetFullscreenTimer : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: (isMaximized || isFullscreen) ? 1 : 'none',
        overflow: 'hidden',
        minHeight: 0,
        width: '100%',
        height: isFullscreen ? '100%' : 'auto',
        position: isFullscreen ? 'relative' : 'static',
        cursor: isFullscreen ? (showFullscreenControls || core.isDragging ? 'default' : 'none') : 'default'
      }}
    >
      {/* Video area wrapper — must be a sized flex container so height:100% resolves on child */}
      <div style={{
        flex: (isMaximized || isFullscreen) ? 1 : 'none',
        height: (isMaximized || isFullscreen) ? 0 : 'auto',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 0,
        overflow: 'hidden',
        containerType: (isMaximized || isFullscreen) ? 'size' : 'normal',
        background: isFullscreen ? '#000' : 'transparent'
      }}>
        <div 
          onMouseEnter={() => core.setIsVideoHovered(true)}
          onMouseLeave={() => { core.setIsVideoHovered(false); core.setIsCaptionMenuOpen(false); }}
          style={isFullscreen ? {
            width: '100cqw',
            maxWidth: 'calc(100cqh * (16 / 9))',
            aspectRatio: '16 / 9',
            position: 'relative',
            background: '#000',
            borderRadius: 0,
            overflow: 'hidden',
            opacity: isVideoHidden ? 0 : 1,
            transition: 'opacity 0.15s ease'
          } : isMaximized ? {
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
            {/* Deck 0 (YouTube) */}
            {core.deck0Song && !core.deck0Song.is_local && !core.streamUrl && !core.isExtractingStream && (
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: core.deck0Opacity,
                zIndex: core.activeDeck === 0 ? 2 : 1,
                pointerEvents: core.activeDeck === 0 ? 'auto' : 'none',
                transition: 'opacity 0.1s linear'
              }}>
                <ProxyYouTube
                  key={`deck-0-${core.deck0Song.id}`}
                  videoId={core.deck0Song.id}
                  onCaptionsReceived={core.handleCaptionsReceived}
                  opts={{
                    ...opts,
                    playerVars: {
                      ...opts.playerVars,
                      start: Math.floor(core.deck0Song.startSeconds || core.deck0Song.initialTime || 0)
                    }
                  }}
                  onReady={(e) => core.onDeckReady(0, e)}
                  onStateChange={(e) => core.onDeckStateChange(0, e)}
                  onError={async (e) => {
                    console.error("Deck 0 YouTube Error:", e);
                    if (!core.streamUrl && !core.isExtractingStream) {
                      core.setIsExtractingStream(true);
                      try {
                        const url = await api.getStreamUrl(core.deck0Song.id);
                        core.setStreamUrl(url);
                      } catch (err) {
                        console.error("Stream extraction fallback failed:", err);
                        if (hasNext) onNext();
                        else {
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
                <div 
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  onClick={() => core.togglePlay()}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
              </div>
            )}

            {/* Deck 1 (YouTube) */}
            {core.deck1Song && !core.deck1Song.is_local && !core.streamUrl && !core.isExtractingStream && (
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: core.deck1Opacity,
                zIndex: core.activeDeck === 1 ? 2 : 1,
                pointerEvents: core.activeDeck === 1 ? 'auto' : 'none',
                transition: 'opacity 0.1s linear'
              }}>
                <ProxyYouTube
                  key={`deck-1-${core.deck1Song.id}`}
                  videoId={core.deck1Song.id}
                  onCaptionsReceived={core.handleCaptionsReceived}
                  opts={{
                    ...opts,
                    playerVars: {
                      ...opts.playerVars,
                      start: Math.floor(core.deck1Song.startSeconds || core.deck1Song.initialTime || 0)
                    }
                  }}
                  onReady={(e) => core.onDeckReady(1, e)}
                  onStateChange={(e) => core.onDeckStateChange(1, e)}
                  onError={async (e) => {
                    console.error("Deck 1 YouTube Error:", e);
                    if (!core.streamUrl && !core.isExtractingStream) {
                      core.setIsExtractingStream(true);
                      try {
                        const url = await api.getStreamUrl(core.deck1Song.id);
                        core.setStreamUrl(url);
                      } catch (err) {
                        console.error("Stream extraction fallback failed:", err);
                        if (hasNext) onNext();
                        else {
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
                <div 
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  onClick={() => core.togglePlay()}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
              </div>
            )}

            {core.captions.length > 0 && !isMiniPlayer && !isFullscreen && (
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

            {/* Deck 0 (Local / Stream Audio) */}
            {core.deck0Song && (core.deck0Song.is_local || core.streamUrl) && (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <div style={{ fontSize: '3rem', color: 'var(--accent-color)', opacity: 0.8, marginBottom: '16px' }}>
                   ♪
                </div>
                <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>{core.deck0Song.is_local ? 'Playing Offline' : 'Audio Stream Fallback'}</div>
                <audio
                  id="deck-0-audio"
                  src={core.deck0Song.is_local ? convertFileSrc(core.deck0Song.file_path) : core.streamUrl}
                  autoPlay
                  onPlay={() => {
                    if (core.activeDeck === 0) {
                      core.setIsPlaying(true);
                      core.handleStallClear();
                      if (onPlayStateChange) onPlayStateChange(true);
                    }
                  }}
                  onPause={() => {
                    if (core.activeDeck === 0) {
                      core.setIsPlaying(false);
                      if (onPlayStateChange) onPlayStateChange(false);
                    }
                  }}
                  onEnded={() => {
                    if (core.activeDeck === 0) core.handleTrackEnd();
                  }}
                  onTimeUpdate={(e) => {
                    if (core.activeDeck === 0 && !core.isDragging) {
                      core.setCurrentTime(e.target.currentTime);
                      if (onTimeUpdate) onTimeUpdate(e.target.currentTime);
                      core.checkAutoCrossfade(e.target.currentTime, e.target.duration);
                    }
                  }}
                  onLoadedMetadata={(e) => {
                    if (core.activeDeck === 0) {
                      core.setDuration(e.target.duration);
                      e.target.volume = core.isMuted ? 0 : (core.masterVolume / 100);
                    } else {
                      e.target.volume = 0;
                    }
                  }}
                  onError={(e) => {
                    console.error("Deck 0 audio error", e);
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

            {/* Deck 1 (Local / Stream Audio) */}
            {core.deck1Song && (core.deck1Song.is_local || core.streamUrl) && (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <div style={{ fontSize: '3rem', color: 'var(--accent-color)', opacity: 0.8, marginBottom: '16px' }}>
                   ♪
                </div>
                <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>{core.deck1Song.is_local ? 'Playing Offline' : 'Audio Stream Fallback'}</div>
                <audio
                  id="deck-1-audio"
                  src={core.deck1Song.is_local ? convertFileSrc(core.deck1Song.file_path) : core.streamUrl}
                  autoPlay
                  onPlay={() => {
                    if (core.activeDeck === 1) {
                      core.setIsPlaying(true);
                      core.handleStallClear();
                      if (onPlayStateChange) onPlayStateChange(true);
                    }
                  }}
                  onPause={() => {
                    if (core.activeDeck === 1) {
                      core.setIsPlaying(false);
                      if (onPlayStateChange) onPlayStateChange(false);
                    }
                  }}
                  onEnded={() => {
                    if (core.activeDeck === 1) core.handleTrackEnd();
                  }}
                  onTimeUpdate={(e) => {
                    if (core.activeDeck === 1 && !core.isDragging) {
                      core.setCurrentTime(e.target.currentTime);
                      if (onTimeUpdate) onTimeUpdate(e.target.currentTime);
                      core.checkAutoCrossfade(e.target.currentTime, e.target.duration);
                    }
                  }}
                  onLoadedMetadata={(e) => {
                    if (core.activeDeck === 1) {
                      core.setDuration(e.target.duration);
                      e.target.volume = core.isMuted ? 0 : (core.masterVolume / 100);
                    } else {
                      e.target.volume = 0;
                    }
                  }}
                  onError={(e) => {
                    console.error("Deck 1 audio error", e);
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
                position: 'absolute', top: '12px', left: '12px', right: '48px',
                display: 'flex', flexDirection: 'column', gap: '2px',
                color: '#fff', zIndex: 25,
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
          {!isMiniPlayer && !isFullscreen && currentSong && <div data-tauri-drag-region style={{ position: 'absolute', inset: 0, background: 'transparent', zIndex: 5 }} />}
        </div>
      </div>

      {/* Fullscreen Overlay HUD */}
      {isFullscreen && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            pointerEvents: (showFullscreenControls || core.isDragging || core.isCaptionMenuOpen) ? 'auto' : 'none',
            opacity: (showFullscreenControls || core.isDragging || core.isCaptionMenuOpen) ? 1 : 0,
            transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          {/* Top Bar */}
          <div style={{
            padding: '24px 32px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0) 100%)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '80%' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentSong ? currentSong.title : ''}
              </h2>
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                {albumInfo?.artist || (currentSong?.channel || '').replace(/\s*-\s*Topic$/i, '').trim()}
                {albumInfo?.album ? ` · ${albumInfo.album}` : ''}
              </div>
            </div>
            <button
              className="btn btn-icon"
              onClick={onToggleFullscreen}
              title="Exit Fullscreen (Esc)"
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(8px)',
                borderRadius: '50%',
                padding: '10px'
              }}
            >
              <Minimize2 size={20} />
            </button>
          </div>

          {/* Center clickable zone */}
          <div 
            style={{ flex: 1, cursor: (showFullscreenControls || core.isDragging) ? 'pointer' : 'none' }}
            onClick={() => core.togglePlay()}
          />

          {/* Bottom Bar HUD */}
          <div style={{
            padding: '20px 32px 32px 32px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0) 100%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            {/* Seekbar */}
            <div className="seek-bar-container" style={{ color: '#fff', fontSize: '0.85rem' }}>
              <span>{core.formatTime(core.currentTime)}</span>
              <input 
                type="range" 
                className="seek-bar"
                min={0} 
                max={core.duration || 100} 
                value={core.currentTime}
                onChange={core.handleSeekChange}
                onMouseDown={core.handleSeekMouseDown}
                onMouseUp={core.handleSeekMouseUp}
                onTouchStart={core.handleSeekMouseDown}
                onTouchEnd={core.handleSeekMouseUp}
                disabled={!currentSong}
                style={{
                  background: `linear-gradient(to right, var(--accent-color) ${(core.currentTime / (core.duration || 1)) * 100}%, rgba(255,255,255,0.2) ${(core.currentTime / (core.duration || 1)) * 100}%)`
                }}
              />
              <span>{core.formatTime(core.duration)}</span>
            </div>

            {/* Controls Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button 
                  className="btn btn-icon" 
                  onClick={onToggleShuffle} 
                  style={{ 
                    color: isShuffle ? 'var(--bg-color)' : '#fff',
                    background: isShuffle ? 'var(--text-main)' : 'rgba(255,255,255,0.1)',
                    padding: '8px'
                  }}
                  title="Shuffle"
                >
                  <Shuffle size={20} />
                </button>
                <button className="btn btn-icon" onClick={onPrevious} disabled={!hasPrevious} style={{ color: '#fff', background: 'rgba(255,255,255,0.1)', padding: '8px' }} title="Previous">
                  <SkipBack size={22} />
                </button>
                <button 
                  className="btn btn-icon btn-primary" 
                  onClick={core.togglePlay} 
                  disabled={!currentSong || core.isBuffering} 
                  style={{ padding: '12px', background: 'var(--accent-color)', color: '#fff', borderRadius: '50%' }}
                  title={core.isPlaying ? "Pause" : "Play"}
                >
                  {core.isBuffering ? <Loader2 size={24} className="animate-spin" /> : (core.isPlaying ? <Pause size={24} /> : <Play size={24} />)}
                </button>
                <button className="btn btn-icon" onClick={onNext} disabled={!hasNext} style={{ color: '#fff', background: 'rgba(255,255,255,0.1)', padding: '8px' }} title="Next">
                  <SkipForward size={22} />
                </button>
                <button 
                  className="btn btn-icon" 
                  onClick={onToggleRepeat} 
                  style={{ 
                    color: repeatMode > 0 ? 'var(--bg-color)' : '#fff',
                    background: repeatMode > 0 ? 'var(--text-main)' : 'rgba(255,255,255,0.1)',
                    padding: '8px'
                  }}
                  title="Repeat"
                >
                  {repeatMode === 2 ? <Repeat1 size={20} /> : <Repeat size={20} />}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {/* Subtitles / Captions toggle in Fullscreen */}
                {core.captions.length > 0 && (
                  <div style={{ position: 'relative' }}>
                    <button
                      className="btn btn-icon"
                      onClick={() => core.setIsCaptionMenuOpen(!core.isCaptionMenuOpen)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: core.activeCaptionCode ? 'var(--accent-color)' : '#fff',
                        padding: '8px'
                      }}
                      title="Subtitles"
                    >
                      <Subtitles size={20} />
                    </button>
                    {core.isCaptionMenuOpen && (
                      <div style={{
                        position: 'absolute',
                        bottom: '100%',
                        right: 0,
                        marginBottom: '8px',
                        background: 'rgba(20, 20, 20, 0.95)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px',
                        padding: '4px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                        minWidth: '130px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        zIndex: 100
                      }}>
                        <button 
                          onClick={() => core.selectCaption(null)}
                          style={{
                            background: !core.activeCaptionCode ? 'var(--accent-color)' : 'transparent',
                            color: '#fff',
                            padding: '6px 12px',
                            border: 'none',
                            borderRadius: '4px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontSize: '0.85rem'
                          }}
                        >Off</button>
                        {core.captions.map(c => (
                          <button
                            key={c.languageCode}
                            onClick={() => core.selectCaption(c.languageCode)}
                            style={{
                              background: core.activeCaptionCode === c.languageCode ? 'var(--accent-color)' : 'transparent',
                              color: '#fff',
                              padding: '6px 12px',
                              border: 'none',
                              borderRadius: '4px',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {c.languageName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Exit Fullscreen button */}
                <button
                  className="btn btn-icon"
                  onClick={onToggleFullscreen}
                  title="Exit Fullscreen (Esc)"
                  style={{ color: '#fff', background: 'rgba(255,255,255,0.1)', padding: '8px' }}
                >
                  <Minimize2 size={20} />
                </button>

                {/* Volume */}
                <div
                  style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
                  onMouseEnter={() => core.setIsVolumeHovered(true)}
                  onMouseLeave={() => core.setIsVolumeHovered(false)}
                >
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      position: 'absolute',
                      top: '-28px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: '0.75rem',
                      color: '#fff',
                      background: 'rgba(0,0,0,0.8)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                      opacity: core.isVolumeHovered ? 1 : 0,
                      transition: 'opacity 0.15s ease',
                      zIndex: 10,
                    }}>
                      {core.isMuted ? 0 : core.masterVolume}%
                    </div>
                    <button className="btn btn-icon" style={{ border: 'none', background: 'transparent', color: '#fff', padding: '6px' }} onClick={core.toggleMute} title="Mute/Unmute">
                      {core.isMuted || core.masterVolume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                  </div>
                  <input
                    type="range"
                    className="seek-bar"
                    min="0"
                    max="100"
                    value={core.isMuted ? 0 : core.masterVolume}
                    onChange={core.handleVolumeChange}
                    style={{
                      width: '90px',
                      background: `linear-gradient(to right, var(--accent-color) ${core.isMuted ? 0 : core.masterVolume}%, rgba(255,255,255,0.2) ${core.isMuted ? 0 : core.masterVolume}%)`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isMiniPlayer && !isFullscreen && (
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
          isMaximized={isMaximized}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
        />
      )}
    </div>
  );
});

export default Player;
