import React, { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import ProxyYouTube from './ProxyYouTube';
import PlayerControls from './PlayerControls';
import { Loader2, Subtitles, Play, Pause, SkipBack, SkipForward, X, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Maximize2, Minimize2, Mic2, ListMusic, Disc, Check } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../services/api';
import { usePlayerCore } from '../hooks/usePlayerCore';
import VideoOverlay from './VideoOverlay';
import SpinningVinyl, { isAlbumArtTrack } from './SpinningVinyl';
import ArtistHeroVisualizer from './ArtistHeroVisualizer';

const Player = React.forwardRef(function Player({ 
  currentSong, nextSong, onNext, onPrevious, hasNext, hasPrevious, onPlayStateChange, onTimeUpdate, onError, isMaximized, isFullscreen, onToggleFullscreen, isVideoHidden,
  repeatMode, onToggleRepeat, isShuffle, onToggleShuffle, onSongEnded, isSearchExpanded,
  albumInfo, isLoadingAlbum, onAlbumClick, isMiniPlayer, onToggleMiniPlayer,
  crossfadeDuration, setCrossfadeDuration,
  videoOverlayMode, setVideoOverlayMode,
  lyricsData, lyricsSyncOffset, setLyricsSyncOffset, isFetchingLyrics, lyricsError, onRetryLyrics,
  chordsData, syncOffset, setSyncOffset, transposeOffset, setTransposeOffset, bpmOffset = 0, setBpmOffset, isFetchingChords, chordsError, onRetryChords,
  fontScale,
  lyricsFontScale, chordsFontScale,
  downloadedIds,
  isVinylEnabled = true,
  onToggleVinyl,
  selectedArtist,
  artistDetails,
  isLoadingArtist,
  isPlayingArtist,
  onArtistClick,
  onCloseArtistPage,
  onPlayArtistTopSongs,
  onShuffleArtistTopSongs,
  onAddArtistTopSongs
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
    setCrossfadeDuration,
    downloadedIds
  });

  const activeSong = core.activeDeck === 0 ? core.deck0Song : core.deck1Song;
  const isAlbumArtSong = isAlbumArtTrack(activeSong || currentSong);

  const [transitionDirection, setTransitionDirection] = useState('forward');

  const handleNextTrack = useCallback(() => {
    setTransitionDirection('forward');
    if (onNext) onNext();
  }, [onNext]);

  const handlePreviousTrack = useCallback(() => {
    setTransitionDirection('backward');
    if (onPrevious) onPrevious();
  }, [onPrevious]);

  const currentVinylSong = activeSong || currentSong;
  const nextVinylSong = core.isCrossfading ? (core.activeDeck === 0 ? core.deck1Song : core.deck0Song) : nextSong;
  const isVinylVisible = isVinylEnabled && isAlbumArtTrack(currentVinylSong);

  const [showFullscreenControls, setShowFullscreenControls] = useState(true);
  const fullscreenTimerRef = useRef(null);
  const lastMousePosRef = useRef({ x: -1, y: -1 });

  const isDraggingRef = useRef(core.isDragging);
  isDraggingRef.current = core.isDragging;

  const isCaptionMenuOpenRef = useRef(core.isCaptionMenuOpen);
  isCaptionMenuOpenRef.current = core.isCaptionMenuOpen;

  const captionButtonRef = useRef(null);
  const captionMenuRef = useRef(null);
  const [captionMenuCoords, setCaptionMenuCoords] = useState(null);

  const updateCaptionCoords = useCallback(() => {
    if (captionButtonRef.current) {
      const rect = captionButtonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - (rect.bottom + 8);
      const spaceAbove = rect.top - 8;
      const shouldFlipUp = spaceBelow < 180 && spaceAbove > spaceBelow;

      setCaptionMenuCoords({
        top: shouldFlipUp ? undefined : rect.bottom + 6,
        bottom: shouldFlipUp ? window.innerHeight - rect.top + 6 : undefined,
        right: Math.max(12, window.innerWidth - rect.right),
        maxHeight: Math.min(340, Math.max(160, shouldFlipUp ? spaceAbove : spaceBelow))
      });
    }
  }, []);

  const handleToggleCaptionMenu = useCallback((e) => {
    e?.stopPropagation?.();
    if (!core.isCaptionMenuOpen) {
      updateCaptionCoords();
      core.setIsCaptionMenuOpen(true);
    } else {
      core.setIsCaptionMenuOpen(false);
    }
  }, [core, updateCaptionCoords]);

  // Close caption dropdown when clicking outside or update position on window resize/scroll
  useEffect(() => {
    if (!core.isCaptionMenuOpen) return;
    updateCaptionCoords();

    const handleClickOutside = (e) => {
      if (
        captionMenuRef.current && !captionMenuRef.current.contains(e.target) &&
        captionButtonRef.current && !captionButtonRef.current.contains(e.target)
      ) {
        core.setIsCaptionMenuOpen(false);
      }
    };

    const handleWindowUpdate = () => {
      updateCaptionCoords();
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleWindowUpdate);
    window.addEventListener('scroll', handleWindowUpdate, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleWindowUpdate);
      window.removeEventListener('scroll', handleWindowUpdate, true);
    };
  }, [core.isCaptionMenuOpen, updateCaptionCoords, core]);

  const resetFullscreenTimer = useCallback(() => {
    setShowFullscreenControls(true);
    if (fullscreenTimerRef.current) {
      clearTimeout(fullscreenTimerRef.current);
    }
    fullscreenTimerRef.current = setTimeout(() => {
      if (!isDraggingRef.current && !isCaptionMenuOpenRef.current) {
        setShowFullscreenControls(false);
      }
    }, 2500);
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      setShowFullscreenControls(true);
      if (fullscreenTimerRef.current) {
        clearTimeout(fullscreenTimerRef.current);
      }
      return;
    }

    // When entering fullscreen, reset tracking coordinates and start countdown
    lastMousePosRef.current = { x: -1, y: -1 };
    resetFullscreenTimer();

    const onWindowMouseMove = (e) => {
      // Discard synthetic mousemove events dispatched by browser on DOM mutations, cursor:none, or hit-test recalculations
      if (
        lastMousePosRef.current.x === e.clientX &&
        lastMousePosRef.current.y === e.clientY
      ) {
        return;
      }
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      resetFullscreenTimer();
    };

    const onWindowActivity = () => {
      resetFullscreenTimer();
    };

    window.addEventListener('mousemove', onWindowMouseMove, { passive: true });
    window.addEventListener('mousedown', onWindowActivity, { passive: true });
    window.addEventListener('keydown', onWindowActivity, { passive: true });

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mousedown', onWindowActivity);
      window.removeEventListener('keydown', onWindowActivity);
      if (fullscreenTimerRef.current) {
        clearTimeout(fullscreenTimerRef.current);
      }
    };
  }, [isFullscreen, resetFullscreenTimer]);

  useEffect(() => {
    if (isFullscreen && !core.isDragging && !core.isCaptionMenuOpen) {
      resetFullscreenTimer();
    }
  }, [isFullscreen, core.isDragging, core.isCaptionMenuOpen, resetFullscreenTimer]);

  useImperativeHandle(ref, () => ({
    togglePlay: core.togglePlay,
    toggleMute: core.toggleMute,
    fadeOut: core.fadeOut,
    fadeIn: core.fadeIn,
    getCurrentTime: () => core.currentTime,
    crossfadeDuration: core.crossfadeDuration,
    toggleCrossfade: core.toggleCrossfade,
    seekTo: core.seekTo,
    seekBy: core.seekBy
  }), [core]);

  const isCurrentLyrics = !currentSong?.id || (lyricsData?._songId === currentSong?.id);
  const isLyricsLoading = isFetchingLyrics || (Boolean(currentSong?.id) && lyricsData?._songId !== currentSong?.id);
  const lyricsLines = isCurrentLyrics ? (lyricsData?.lines || []) : [];

  const isCurrentChords = !currentSong?.id || (chordsData?._songId === currentSong?.id);
  const isChordsLoading = isFetchingChords || (Boolean(currentSong?.id) && chordsData?._songId !== currentSong?.id);
  const chordsList = isCurrentChords ? (chordsData?.chords || []) : [];

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
          onMouseLeave={() => { core.setIsVideoHovered(false); }}
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
            {core.deck0Song && !core.deck0Song?.is_local && !core.streamUrl && !core.isExtractingStream && (
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: core.deck0Opacity,
                zIndex: core.activeDeck === 0 ? 2 : 1,
                pointerEvents: core.activeDeck === 0 ? 'auto' : 'none',
                transition: 'opacity 0.1s linear'
              }}>
                <div style={{
                  width: '100%',
                  height: '100%',
                  opacity: (isVinylEnabled && isAlbumArtTrack(core.deck0Song)) ? 0 : 1,
                  pointerEvents: (isVinylEnabled && isAlbumArtTrack(core.deck0Song)) ? 'none' : 'auto'
                }}>
                  <ProxyYouTube
                    key="deck-0"
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
                      const rawCode = e?.data ?? e;
                      const errorCode = Number(rawCode);
                      // YouTube IFrame API standard embed restriction errors:
                      // 101 - The owner of the requested video does not allow it to be played in embedded players.
                      // 150 - Same as 101 (embed blocked by owner / copyright restriction).
                      const isEmbedBlocked = errorCode === 101 || errorCode === 150;

                      if (isEmbedBlocked) {
                        console.log(`[Player] Deck 0 video ${core.deck0Song?.id} is blocked from embedding (error ${errorCode}). Bypassing embed block via stream extraction...`);
                        if (core.isCrossfading) {
                          if (core.activeDeck === 0) {
                            if (core.finishCrossfade) core.finishCrossfade();
                            else core.cancelCrossfade();
                          } else {
                            core.cancelCrossfade();
                          }
                        }
                        if (!core.streamUrl && !core.isExtractingStream && core.deck0Song) {
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
                      } else {
                        console.warn(`[Player] Deck 0 YouTube Error ${errorCode} is not an embed block.`);
                        if (errorCode === 5) {
                          // Error 5 is HTML5 player error (frequently caused by slow network buffer underrun).
                          // Give it a chance to buffer and play without killing the video.
                          try { e.target?.playVideo?.(); } catch (_) {}
                        } else if (errorCode === 100) {
                          // Video removed or private
                          if (hasNext) onNext();
                          else if (onError) onError("Video not found or has been removed.");
                        }
                      }
                    }}
                    style={{ width: '100%', height: '100%' }}
                    iframeClassName="youtube-iframe"
                  />
                </div>

                <div 
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  onClick={() => core.togglePlay()}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
              </div>
            )}

            {/* Deck 1 (YouTube) */}
            {core.deck1Song && !core.deck1Song?.is_local && !core.streamUrl && !core.isExtractingStream && (
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: core.deck1Opacity,
                zIndex: core.activeDeck === 1 ? 2 : 1,
                pointerEvents: core.activeDeck === 1 ? 'auto' : 'none',
                transition: 'opacity 0.1s linear'
              }}>
                <div style={{
                  width: '100%',
                  height: '100%',
                  opacity: (isVinylEnabled && isAlbumArtTrack(core.deck1Song)) ? 0 : 1,
                  pointerEvents: (isVinylEnabled && isAlbumArtTrack(core.deck1Song)) ? 'none' : 'auto'
                }}>
                  <ProxyYouTube
                    key="deck-1"
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
                      const rawCode = e?.data ?? e;
                      const errorCode = Number(rawCode);
                      // YouTube IFrame API standard embed restriction errors:
                      // 101 - The owner of the requested video does not allow it to be played in embedded players.
                      // 150 - Same as 101 (embed blocked by owner / copyright restriction).
                      const isEmbedBlocked = errorCode === 101 || errorCode === 150;

                      if (isEmbedBlocked) {
                        console.log(`[Player] Deck 1 video ${core.deck1Song?.id} is blocked from embedding (error ${errorCode}). Bypassing embed block via stream extraction...`);
                        if (core.isCrossfading) {
                          if (core.activeDeck === 1) {
                            if (core.finishCrossfade) core.finishCrossfade();
                            else core.cancelCrossfade();
                          } else {
                            core.cancelCrossfade();
                          }
                        }
                        if (!core.streamUrl && !core.isExtractingStream && core.deck1Song) {
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
                      } else {
                        console.warn(`[Player] Deck 1 YouTube Error ${errorCode} is not an embed block.`);
                        if (errorCode === 5) {
                          // Error 5 is HTML5 player error (frequently caused by slow network buffer underrun).
                          // Give it a chance to buffer and play without killing the video.
                          try { e.target?.playVideo?.(); } catch (_) {}
                        } else if (errorCode === 100) {
                          // Video removed or private
                          if (hasNext) onNext();
                          else if (onError) onError("Video not found or has been removed.");
                        }
                      }
                    }}
                    style={{ width: '100%', height: '100%' }}
                    iframeClassName="youtube-iframe"
                  />
                </div>

                <div 
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  onClick={() => core.togglePlay()}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
              </div>
            )}

            {/* Vinyl Effect Toggle Button - Bottom Left */}
            {!isMiniPlayer && !isFullscreen && !videoOverlayMode && !selectedArtist && isAlbumArtSong && (
              <button
                className="btn btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVinyl?.();
                }}
                title={isVinylEnabled ? "Vinyl Player: ON (Click to turn off)" : "Vinyl Player: OFF (Click to turn on)"}
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  left: '12px',
                  zIndex: 100,
                  background: isVinylEnabled ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.45)',
                  color: isVinylEnabled ? 'var(--accent-color)' : 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(6px)',
                  border: isVinylEnabled ? '1px solid var(--accent-color)' : '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '50%',
                  padding: '7px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: core.isVideoHovered ? 1 : 0,
                  transition: 'opacity 0.2s ease, transform 0.15s ease',
                  pointerEvents: core.isVideoHovered ? 'auto' : 'none',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
                }}
              >
                <Disc size={18} />
              </button>
            )}

            {/* Captions button - Top Right */}
            {!isMiniPlayer && !isFullscreen && !videoOverlayMode && !selectedArtist && currentSong && !currentSong.is_local && core.captions?.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  zIndex: 100,
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  opacity: (core.isVideoHovered || core.isCaptionMenuOpen) ? 1 : 0.65,
                  transition: 'opacity 0.2s',
                  pointerEvents: 'auto'
                }}
              >
                <button
                  ref={captionButtonRef}
                  className="btn btn-icon"
                  onClick={handleToggleCaptionMenu}
                  title={core.activeCaptionCode ? "Subtitles: ON (Click to change)" : "Subtitles / Closed Captions"}
                  style={{
                    background: core.isCaptionMenuOpen ? 'var(--accent-color)' : 'rgba(0, 0, 0, 0.65)',
                    color: core.isCaptionMenuOpen ? '#ffffff' : core.activeCaptionCode ? 'var(--accent-color)' : '#fff',
                    backdropFilter: 'blur(6px)',
                    border: core.isCaptionMenuOpen ? '1px solid var(--accent-color)' : core.activeCaptionCode ? '1px solid var(--accent-color)' : '1px solid rgba(255,255,255,0.15)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Subtitles size={18} />
                </button>
              </div>
            )}

            {/* Subtitle / Caption Dropdown Menu Portal (Unconstrained by video container overflow) */}
            {!isMiniPlayer && !isFullscreen && core.captions?.length > 0 && core.isCaptionMenuOpen && captionMenuCoords && createPortal(
              <div
                ref={captionMenuRef}
                className="dropdown-menu-portal"
                style={{
                  position: 'fixed',
                  top: captionMenuCoords.top !== undefined ? `${captionMenuCoords.top}px` : 'auto',
                  bottom: captionMenuCoords.bottom !== undefined ? `${captionMenuCoords.bottom}px` : 'auto',
                  right: `${captionMenuCoords.right}px`,
                  maxHeight: `${captionMenuCoords.maxHeight}px`,
                  minWidth: '170px',
                  maxWidth: '300px',
                  overflowY: 'auto',
                  zIndex: 999999,
                  background: 'var(--bg-color)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '10px',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08)',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px'
                }}
              >
                <div style={{
                  padding: '4px 10px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--panel-border)',
                  marginBottom: '2px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>Subtitles</span>
                  <span style={{ opacity: 0.6 }}>{core.captions.length}</span>
                </div>

                <button
                  className="dropdown-item-btn"
                  onClick={() => {
                    core.selectCaption(null);
                    core.setIsCaptionMenuOpen(false);
                  }}
                  style={{
                    background: !core.activeCaptionCode ? 'var(--panel-bg)' : 'transparent',
                    color: !core.activeCaptionCode ? 'var(--accent-color)' : 'var(--text-main)',
                    fontWeight: !core.activeCaptionCode ? 700 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <span>Off</span>
                  {!core.activeCaptionCode && <Check size={14} color="var(--accent-color)" />}
                </button>

                {core.captions.map(c => {
                  const isSelected = core.activeCaptionCode === c.languageCode;
                  return (
                    <button
                      key={c.languageCode}
                      className="dropdown-item-btn"
                      onClick={() => {
                        core.selectCaption(c.languageCode);
                        core.setIsCaptionMenuOpen(false);
                      }}
                      style={{
                        background: isSelected ? 'var(--panel-bg)' : 'transparent',
                        color: isSelected ? 'var(--accent-color)' : 'var(--text-main)',
                        fontWeight: isSelected ? 700 : 500,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.languageName}
                      </span>
                      {isSelected && <Check size={14} color="var(--accent-color)" style={{ flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>,
              document.body
            )}
            {core.isExtractingStream && (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: 'rgba(0,0,0,0.5)' }}>
                <Loader2 className="spinning" style={{ color: 'var(--accent-color)', marginBottom: '16px' }} size={40} />
                <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>Bypassing embed block...</div>
              </div>
            )}

            {/* Deck 0 (Local / Stream Audio) */}
            {core.deck0Song && (core.deck0Song?.is_local || core.streamUrl) && (
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: core.deck0Opacity,
                zIndex: core.activeDeck === 0 ? 2 : 1,
                pointerEvents: core.activeDeck === 0 ? 'auto' : 'none',
                transition: 'opacity 0.1s linear',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {isVinylEnabled && isAlbumArtTrack(core.deck0Song) ? null : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <div style={{ fontSize: '3rem', color: 'var(--accent-color)', opacity: 0.8, marginBottom: '16px' }}>
                      ♪
                    </div>
                    <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>{core.deck0Song?.is_local ? 'Playing Offline' : 'Audio Stream Fallback'}</div>
                  </div>
                )}
                <audio
                  id="deck-0-audio"
                  src={core.deck0Song?.is_local ? convertFileSrc(core.deck0Song.file_path) : core.streamUrl}
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
                      if (!core.isOfflinePlayback) {
                        core.checkAutoCrossfade(e.target.currentTime, e.target.duration);
                      }
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
                <div 
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  onClick={() => core.togglePlay()}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
              </div>
            )}

            {/* Deck 1 (Local / Stream Audio) */}
            {core.deck1Song && (core.deck1Song?.is_local || core.streamUrl) && (
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: core.deck1Opacity,
                zIndex: core.activeDeck === 1 ? 2 : 1,
                pointerEvents: core.activeDeck === 1 ? 'auto' : 'none',
                transition: 'opacity 0.1s linear',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {isVinylEnabled && isAlbumArtTrack(core.deck1Song) ? null : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <div style={{ fontSize: '3rem', color: 'var(--accent-color)', opacity: 0.8, marginBottom: '16px' }}>
                      ♪
                    </div>
                    <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.9rem' }}>{core.deck1Song?.is_local ? 'Playing Offline' : 'Audio Stream Fallback'}</div>
                  </div>
                )}
                <audio
                  id="deck-1-audio"
                  src={core.deck1Song?.is_local ? convertFileSrc(core.deck1Song.file_path) : core.streamUrl}
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
                      if (!core.isOfflinePlayback) {
                        core.checkAutoCrossfade(e.target.currentTime, e.target.duration);
                      }
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
                <div 
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  onClick={() => core.togglePlay()}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
              </div>
            )}
          </div>

          {/* Unified Photorealistic Direct Drive Turntable Plinth OR Artist Background Image */}
          {selectedArtist ? (
            <ArtistHeroVisualizer
              artistName={selectedArtist}
              artistDetails={artistDetails}
              isLoading={isLoadingArtist}
              isFullscreen={isFullscreen}
              isMaximized={isMaximized}
              isMiniPlayer={isMiniPlayer}
              isShuffle={isShuffle}
              isPlaying={isPlayingArtist}
              onPlayAll={onPlayArtistTopSongs}
              onShuffleAll={onShuffleArtistTopSongs}
              onAddAll={onAddArtistTopSongs}
              onClose={onCloseArtistPage}
            />
          ) : isVinylVisible && (
            <>
              <SpinningVinyl
                song={currentVinylSong}
                nextSong={nextVinylSong}
                isPlaying={core.isPlaying}
                isCrossfading={core.isCrossfading}
                direction={transitionDirection}
                subtext={currentVinylSong?.is_local ? 'Playing Offline' : (core.streamUrl ? 'Audio Stream Fallback' : null)}
              />
              <div 
                style={{ position: 'absolute', inset: 0, zIndex: 12, cursor: 'pointer' }}
                onClick={() => core.togglePlay()}
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              />
            </>
          )}

          {!currentSong && !selectedArtist && (
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
                background: (!videoOverlayMode && core.isVideoHovered) ? 'rgba(0,0,0,0.6)' : 'transparent',
                opacity: core.isVideoHovered ? 1 : 0,
                transition: 'all 0.2s ease',
                zIndex: videoOverlayMode ? 40 : 20,
                pointerEvents: core.isVideoHovered ? (videoOverlayMode ? 'none' : 'auto') : 'none',
                display: 'flex',
                alignItems: videoOverlayMode ? 'flex-end' : 'center',
                justifyContent: 'center',
                paddingBottom: videoOverlayMode ? '10px' : 0,
                borderRadius: '12px'
              }}
            >
              <div data-tauri-drag-region style={{
                position: 'absolute', top: '12px', left: '12px', right: '48px',
                display: 'flex', flexDirection: 'column', gap: '2px',
                color: '#fff', zIndex: 25,
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                overflow: 'hidden',
                pointerEvents: 'none'
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
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'auto'
                }}
                title="Exit Mini Player"
              >
                <X size={16} />
              </button>

              {/* Media Controls */}
              <div
                data-no-drag="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: videoOverlayMode ? '12px' : '16px',
                  pointerEvents: 'auto',
                  zIndex: 25
                }}
              >
                <button 
                  className="btn btn-icon" 
                  onClick={handlePreviousTrack} 
                  disabled={!hasPrevious} 
                  style={{ 
                    zIndex: 25, 
                    color: '#fff', 
                    background: videoOverlayMode ? 'rgba(0, 0, 0, 0.7)' : 'transparent',
                    backdropFilter: videoOverlayMode ? 'blur(6px)' : undefined,
                    border: videoOverlayMode ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
                    borderRadius: '50%',
                    padding: videoOverlayMode ? '5px' : '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'auto',
                    transition: 'all 0.15s ease'
                  }}
                  title="Previous"
                >
                  <SkipBack size={videoOverlayMode ? 15 : 24} />
                </button>
                <button 
                  className="btn btn-icon" 
                  onClick={core.togglePlay} 
                  style={{ 
                    background: 'var(--accent-color)', 
                    color: '#fff', 
                    borderRadius: '50%', 
                    padding: videoOverlayMode ? '7px' : '12px', 
                    zIndex: 25, 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'auto',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    transition: 'all 0.15s ease'
                  }}
                  title={core.isPlaying ? "Pause" : "Play"}
                >
                  {core.isPlaying ? <Pause size={videoOverlayMode ? 16 : 24} /> : <Play size={videoOverlayMode ? 16 : 24} />}
                </button>
                <button 
                  className="btn btn-icon" 
                  onClick={handleNextTrack} 
                  disabled={!hasNext} 
                  style={{ 
                    zIndex: 25, 
                    color: '#fff', 
                    background: videoOverlayMode ? 'rgba(0, 0, 0, 0.7)' : 'transparent',
                    backdropFilter: videoOverlayMode ? 'blur(6px)' : undefined,
                    border: videoOverlayMode ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
                    borderRadius: '50%',
                    padding: videoOverlayMode ? '5px' : '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'auto',
                    transition: 'all 0.15s ease'
                  }}
                  title="Next"
                >
                  <SkipForward size={videoOverlayMode ? 15 : 24} />
                </button>
              </div>
            </div>
          )}

          {/* Invisible overlay */}
          {!isMiniPlayer && !isFullscreen && !selectedArtist && currentSong && <div data-tauri-drag-region style={{ position: 'absolute', inset: 0, background: 'transparent', zIndex: 5 }} />}

          {/* Video Overlay (Lyrics / Chords) */}
          {videoOverlayMode && (
            <VideoOverlay
              mode={videoOverlayMode}
              onClose={() => setVideoOverlayMode?.(null)}
              onTogglePlay={core.togglePlay}
              isFullscreen={isFullscreen}
              isMaximized={isMaximized}
              isMiniPlayer={isMiniPlayer}
              fontScale={fontScale}
              lyricsFontScale={fontScale ?? lyricsFontScale}
              chordsFontScale={fontScale ?? chordsFontScale}
              showFullscreenControls={showFullscreenControls}
              currentSong={currentSong}
              lyricsData={lyricsData}
              lyricsSyncOffset={lyricsSyncOffset}
              onLyricsSyncChange={setLyricsSyncOffset}
              isFetchingLyrics={isFetchingLyrics}
              lyricsError={lyricsError}
              onRetryLyrics={onRetryLyrics}
              chordsData={chordsData}
              syncOffset={syncOffset}
              onSyncChange={setSyncOffset}
              transposeOffset={transposeOffset}
              onTransposeChange={setTransposeOffset}
              bpmOffset={bpmOffset}
              onBpmChange={setBpmOffset}
              isFetchingChords={isFetchingChords}
              chordsError={chordsError}
              onRetryChords={onRetryChords}
            />
          )}
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
            style={{ 
              flex: 1, 
              cursor: (!selectedArtist && (showFullscreenControls || core.isDragging)) ? 'pointer' : 'default',
              pointerEvents: selectedArtist ? 'none' : ((showFullscreenControls || core.isDragging) ? 'auto' : 'none')
            }}
            onClick={() => {
              if (!selectedArtist) core.togglePlay();
            }}
          />

          {/* Bottom Bar HUD */}
          <div style={{
            padding: '20px 32px 32px 32px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0) 100%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            {/* Fullscreen Lyrics Sync Calibration Capsule (Above Seekbar) */}
            {videoOverlayMode === 'lyrics' && lyricsLines.length > 0 && !isLyricsLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '-4px' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: '8px',
                    padding: '4px 10px',
                    fontSize: '0.8rem',
                    color: '#ffffff',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.6)'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    resetFullscreenTimer();
                  }}
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>Sync:</span>
                    <button
                      onClick={() => {
                        setLyricsSyncOffset?.(s => Math.max(-30, Number((s - 0.25).toFixed(2))));
                        resetFullscreenTimer();
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '1px 6px',
                        fontSize: '0.85rem',
                        lineHeight: 1
                      }}
                      title="Delay Lyrics by 0.25s"
                    >
                      -
                    </button>
                    <span style={{ minWidth: '34px', textAlign: 'center', fontWeight: 'bold', color: '#fff' }}>
                      {lyricsSyncOffset > 0 ? '+' : ''}{lyricsSyncOffset}s
                    </span>
                    <button
                      onClick={() => {
                        setLyricsSyncOffset?.(s => Math.min(30, Number((s + 0.25).toFixed(2))));
                        resetFullscreenTimer();
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '1px 6px',
                        fontSize: '0.85rem',
                        lineHeight: 1
                      }}
                      title="Advance Lyrics by 0.25s"
                    >
                      +
                    </button>
                  </div>

                  {lyricsSyncOffset !== 0 && (
                    <button
                      onClick={() => {
                        setLyricsSyncOffset?.(0);
                        resetFullscreenTimer();
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(255,255,255,0.7)',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        textDecoration: 'underline',
                        padding: '0 2px'
                      }}
                      title="Reset sync offset to 0s"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Fullscreen Chords Sync & Key Calibration Capsule (Above Seekbar) */}
            {videoOverlayMode === 'chords' && chordsList.length > 0 && !isChordsLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '-4px' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '12px',
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: '8px',
                    padding: '4px 12px',
                    fontSize: '0.8rem',
                    color: '#ffffff',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.6)'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    resetFullscreenTimer();
                  }}
                >
                  {/* Sync Controls */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>Sync:</span>
                    <button
                      onClick={() => {
                        setSyncOffset?.(s => Math.max(-30, Number((s - 0.25).toFixed(2))));
                        resetFullscreenTimer();
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '1px 6px',
                        fontSize: '0.85rem'
                      }}
                      title="Delay Chords"
                    >
                      -
                    </button>
                    <span style={{ minWidth: '32px', textAlign: 'center', fontWeight: 'bold' }}>
                      {syncOffset > 0 ? '+' : ''}{syncOffset}s
                    </span>
                    <button
                      onClick={() => {
                        setSyncOffset?.(s => Math.min(30, Number((s + 0.25).toFixed(2))));
                        resetFullscreenTimer();
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '1px 6px',
                        fontSize: '0.85rem'
                      }}
                      title="Advance Chords"
                    >
                      +
                    </button>
                  </div>

                  {/* Key Controls */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '10px' }}>
                    <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>Key:</span>
                    <button
                      onClick={() => {
                        setTransposeOffset?.(s => (s - 1) % 12);
                        resetFullscreenTimer();
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '1px 6px',
                        fontSize: '0.85rem'
                      }}
                      title="Transpose Down"
                    >
                      -
                    </button>
                    <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 'bold' }}>
                      {transposeOffset > 0 ? '+' : ''}{transposeOffset}
                    </span>
                    <button
                      onClick={() => {
                        setTransposeOffset?.(s => (s + 1) % 12);
                        resetFullscreenTimer();
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '1px 6px',
                        fontSize: '0.85rem'
                      }}
                      title="Transpose Up"
                    >
                      +
                    </button>
                  </div>

                  {/* BPM Controls */}
                  {chordsData?.bpm && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '10px' }}>
                      <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>BPM:</span>
                      <button
                        onClick={() => {
                          setBpmOffset?.(b => Math.max(-50, b - 1));
                          resetFullscreenTimer();
                        }}
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRadius: '4px',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: '1px 6px',
                          fontSize: '0.85rem'
                        }}
                        title="Slower / expand beat interval"
                      >
                        -
                      </button>
                      <span
                        onClick={() => {
                          if (bpmOffset !== 0) {
                            setBpmOffset?.(0);
                            resetFullscreenTimer();
                          }
                        }}
                        style={{
                          minWidth: '28px',
                          textAlign: 'center',
                          fontWeight: 'bold',
                          color: bpmOffset !== 0 ? 'var(--accent-color)' : 'inherit',
                          cursor: bpmOffset !== 0 ? 'pointer' : 'default'
                        }}
                        title={bpmOffset !== 0 ? `BPM shifted by ${bpmOffset > 0 ? '+' : ''}${bpmOffset} (click to reset)` : "Song tempo"}
                      >
                        {Math.round(chordsData.bpm)}
                      </span>
                      <button
                        onClick={() => {
                          setBpmOffset?.(b => Math.min(50, b + 1));
                          resetFullscreenTimer();
                        }}
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRadius: '4px',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: '1px 6px',
                          fontSize: '0.85rem'
                        }}
                        title="Faster / tighten beat interval"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

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
                <button className="btn btn-icon" onClick={handlePreviousTrack} disabled={!hasPrevious} style={{ color: '#fff', background: 'rgba(255,255,255,0.1)', padding: '8px' }} title="Previous">
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
                <button className="btn btn-icon" onClick={handleNextTrack} disabled={!hasNext} style={{ color: '#fff', background: 'rgba(255,255,255,0.1)', padding: '8px' }} title="Next">
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
                {currentSong && !currentSong.is_local && core.captions?.length > 0 && (
                  <div style={{ position: 'relative' }}>
                    <button
                      className="btn btn-icon"
                      onClick={() => core.setIsCaptionMenuOpen(!core.isCaptionMenuOpen)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: core.activeCaptionCode ? 'var(--accent-color)' : '#fff',
                        padding: '8px'
                      }}
                      title={core.activeCaptionCode ? "Subtitles: ON (Click to change)" : "Subtitles / Closed Captions"}
                    >
                      <Subtitles size={20} />
                    </button>
                    {core.isCaptionMenuOpen && (
                      <div style={{
                        position: 'absolute',
                        bottom: '100%',
                        right: 0,
                        marginBottom: '8px',
                        background: 'rgba(20, 20, 24, 0.95)',
                        backdropFilter: 'blur(16px)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '10px',
                        padding: '6px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        minWidth: '160px',
                        maxWidth: '300px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        maxHeight: '340px',
                        overflowY: 'auto',
                        zIndex: 100
                      }}>
                        <div style={{
                          padding: '4px 8px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '1px',
                          color: 'rgba(255, 255, 255, 0.5)',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                          marginBottom: '2px',
                          display: 'flex',
                          justifyContent: 'space-between'
                        }}>
                          <span>Subtitles</span>
                          <span>{core.captions.length}</span>
                        </div>
                        <button 
                          onClick={() => {
                            core.selectCaption(null);
                            core.setIsCaptionMenuOpen(false);
                          }}
                          style={{
                            background: !core.activeCaptionCode ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                            color: !core.activeCaptionCode ? 'var(--accent-color)' : '#fff',
                            padding: '7px 12px',
                            border: 'none',
                            borderRadius: '6px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: !core.activeCaptionCode ? 700 : 500,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                        >
                          <span>Off</span>
                          {!core.activeCaptionCode && <Check size={14} color="var(--accent-color)" />}
                        </button>
                        {core.captions.map(c => {
                          const isSelected = core.activeCaptionCode === c.languageCode;
                          return (
                            <button
                              key={c.languageCode}
                              onClick={() => {
                                core.selectCaption(c.languageCode);
                                core.setIsCaptionMenuOpen(false);
                              }}
                              style={{
                                background: isSelected ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                                    color: isSelected ? 'var(--accent-color)' : '#fff',
                                    padding: '7px 12px',
                                    border: 'none',
                                    borderRadius: '6px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: isSelected ? 700 : 500,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '8px',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {c.languageName}
                                  </span>
                                  {isSelected && <Check size={14} color="var(--accent-color)" style={{ flexShrink: 0 }} />}
                                </button>
                              );
                            })}
                      </div>
                    )}
                  </div>
                )}

                {/* Vinyl Toggle in Fullscreen */}
                {isAlbumArtSong && (
                  <button
                    className="btn btn-icon"
                    onClick={() => {
                      onToggleVinyl?.();
                      resetFullscreenTimer();
                    }}
                    style={{
                      background: isVinylEnabled ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.1)',
                      color: '#fff',
                      padding: '8px'
                    }}
                    title={isVinylEnabled ? "Vinyl Spinning Effect: ON (Click to turn off)" : "Vinyl Spinning Effect: OFF (Click to turn on)"}
                  >
                    <Disc size={20} />
                  </button>
                )}

                {/* Lyrics Overlay Toggle in Fullscreen */}
                <button
                  className="btn btn-icon"
                  onClick={() => {
                    setVideoOverlayMode?.(videoOverlayMode === 'lyrics' ? null : 'lyrics');
                    resetFullscreenTimer();
                  }}
                  style={{
                    background: videoOverlayMode === 'lyrics' ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    padding: '8px'
                  }}
                  title={videoOverlayMode === 'lyrics' ? "Hide Lyrics" : "Show Lyrics"}
                >
                  <Mic2 size={20} />
                </button>

                {/* Chords Overlay Toggle in Fullscreen */}
                <button
                  className="btn btn-icon"
                  onClick={() => {
                    setVideoOverlayMode?.(videoOverlayMode === 'chords' ? null : 'chords');
                    resetFullscreenTimer();
                  }}
                  style={{
                    background: videoOverlayMode === 'chords' ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    padding: '8px'
                  }}
                  title={videoOverlayMode === 'chords' ? "Hide Chords" : "Show Chords"}
                >
                  <ListMusic size={20} />
                </button>

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
          onPrevious={handlePreviousTrack}
          togglePlay={core.togglePlay}
          onNext={handleNextTrack}
          onToggleRepeat={onToggleRepeat}
          handleVolumeChange={core.handleVolumeChange}
          toggleMute={core.toggleMute}
          formatTime={core.formatTime}
          albumInfo={albumInfo}
          isLoadingAlbum={isLoadingAlbum}
          onAlbumClick={onAlbumClick}
          onArtistClick={onArtistClick}
          isMaximized={isMaximized}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
        />
      )}
    </div>
  );
});

export default Player;
