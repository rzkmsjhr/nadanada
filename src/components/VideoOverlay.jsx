import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { transposeChord } from './ChordDisplay';

export default function VideoOverlay({
  mode, // 'lyrics' | 'chords'
  onClose,
  onTogglePlay,
  isFullscreen,
  isMaximized,
  isMiniPlayer,
  fontScale,
  lyricsFontScale = 100,
  chordsFontScale = 100,
  showFullscreenControls,
  currentSong,
  // Lyrics props
  lyricsData,
  lyricsSyncOffset = 0,
  onLyricsSyncChange,
  isFetchingLyrics,
  lyricsError,
  onRetryLyrics,
  // Chords props
  chordsData,
  syncOffset = 0,
  onSyncChange,
  transposeOffset = 0,
  onTransposeChange,
  bpmOffset = 0,
  onBpmChange,
  isFetchingChords,
  chordsError,
  onRetryChords
}) {
  const [time, setTime] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  // Tauri window dragging support for mini-player view
  const handleMouseDown = (e) => {
    if (!isMiniPlayer) return;
    if (e.button !== 0) return; // Only left mouse button initiates window drag
    // Do not drag when clicking buttons, inputs, or interactive capsules
    if (e.target.closest('button, input, select, textarea, [data-no-drag]')) return;
    try {
      getCurrentWindow().startDragging().catch(() => {});
    } catch (_) {}
  };

  useEffect(() => {
    const currentOffset = mode === 'lyrics' ? (lyricsSyncOffset || 0) : (syncOffset || 0);
    const handleTime = (e) => setTime(e.detail + currentOffset);
    window.addEventListener('timeupdate', handleTime);
    return () => window.removeEventListener('timeupdate', handleTime);
  }, [mode, lyricsSyncOffset, syncOffset]);

  const isLyricsLoading = isFetchingLyrics || (Boolean(currentSong?.id) && lyricsData?._songId !== currentSong?.id);
  const isChordsLoading = isFetchingChords || (Boolean(currentSong?.id) && chordsData?._songId !== currentSong?.id);

  const isCurrentLyrics = !currentSong?.id || (lyricsData?._songId === currentSong?.id);
  const isCurrentChords = !currentSong?.id || (chordsData?._songId === currentSong?.id);

  // ── Lyrics Resolution ──
  const lyricsLines = isCurrentLyrics ? (lyricsData?.lines || []) : [];
  let activeLyricIdx = -1;
  for (let i = 0; i < lyricsLines.length; i++) {
    if (time >= lyricsLines[i].time) {
      activeLyricIdx = i;
    } else {
      break;
    }
  }
  const activeLine = activeLyricIdx >= 0 ? lyricsLines[activeLyricIdx] : null;
  const nextLine = activeLyricIdx + 1 < lyricsLines.length ? lyricsLines[activeLyricIdx + 1] : null;

  const getActiveFontTier = (text) => {
    const len = text?.length || 0;
    if (len <= 20) return 4;
    if (len <= 35) return 3;
    if (len <= 55) return 2;
    return 1;
  };

  const getNextFontTier = (text) => {
    const len = text?.length || 0;
    if (len <= 30) return 2;
    return 1;
  };

  const activeText = activeLine?.text || '';
  const prevActiveTextRef = useRef(activeText);
  const prevActiveTierRef = useRef(getActiveFontTier(activeText));
  const isShrinkingRef = useRef(false);

  if (activeText !== prevActiveTextRef.current) {
    const prevTier = prevActiveTierRef.current;
    const currTier = getActiveFontTier(activeText);
    const prevLen = prevActiveTextRef.current.length;
    // Shrinking occurs when tier drops (smaller font-size) or text length increases or initial mount
    isShrinkingRef.current = currTier < prevTier || activeText.length > prevLen || prevLen === 0;
    prevActiveTextRef.current = activeText;
    prevActiveTierRef.current = currTier;
  }

  const nextText = nextLine?.text || '';
  const prevNextTextRef = useRef(nextText);
  const prevNextTierRef = useRef(getNextFontTier(nextText));
  const isNextShrinkingRef = useRef(false);

  if (nextText !== prevNextTextRef.current) {
    const prevTier = prevNextTierRef.current;
    const currTier = getNextFontTier(nextText);
    const prevLen = prevNextTextRef.current.length;
    isNextShrinkingRef.current = currTier < prevTier || nextText.length > prevLen || prevLen === 0;
    prevNextTextRef.current = nextText;
    prevNextTierRef.current = currTier;
  }

  // ── Chords Resolution ──
  const chords = isCurrentChords ? (chordsData?.chords || []) : [];
  let activeChordIdx = -1;
  for (let i = 0; i < chords.length; i++) {
    if (time >= chords[i].time_sec) {
      activeChordIdx = i;
    } else {
      break;
    }
  }
  const activeChord = activeChordIdx >= 0 ? chords[activeChordIdx] : (chords.length > 0 ? chords[0] : null);
  const prevChords = activeChordIdx > 0 ? chords.slice(Math.max(0, activeChordIdx - 2), activeChordIdx) : [];
  const nextChords = activeChordIdx >= 0 ? chords.slice(activeChordIdx + 1, activeChordIdx + 4) : chords.slice(1, 4);

  // Auto-close overlay immediately if no lyrics or no chords are available, reverting to header view
  useEffect(() => {
    if (!currentSong) {
      onClose?.();
      return;
    }

    if (mode === 'lyrics') {
      if (lyricsError) {
        onClose?.();
        return;
      }
      if (!isLyricsLoading && isCurrentLyrics) {
        if (!lyricsLines || lyricsLines.length === 0) {
          onClose?.();
        }
      }
    } else if (mode === 'chords') {
      if (chordsError) {
        onClose?.();
        return;
      }
      if (!isChordsLoading && isCurrentChords) {
        if (!chords || chords.length === 0) {
          onClose?.();
        }
      }
    }
  }, [
    mode,
    currentSong?.id,
    lyricsError,
    isLyricsLoading,
    isCurrentLyrics,
    lyricsLines.length,
    chordsError,
    isChordsLoading,
    isCurrentChords,
    chords.length,
    onClose
  ]);

  // Responsive lyrics font size scaled across modes (Mini Player & Default, Fullscreen, Maximized)
  const getActiveFontSize = (text) => {
    const len = text?.length || 0;
    const factor = ((fontScale || lyricsFontScale || 100) / 100) * 1.25;
    const f = (val) => Number((val * factor).toFixed(2));

    if (isFullscreen) {
      if (len <= 20) return `clamp(${f(2.20)}rem, ${f(5.5)}vw, ${f(4.50)}rem)`;
      if (len <= 35) return `clamp(${f(1.80)}rem, ${f(4.5)}vw, ${f(3.60)}rem)`;
      if (len <= 55) return `clamp(${f(1.50)}rem, ${f(3.8)}vw, ${f(2.80)}rem)`;
      return `clamp(${f(1.25)}rem, ${f(3.0)}vw, ${f(2.20)}rem)`;
    }

    if (isMaximized) {
      if (len <= 20) return `clamp(${f(1.85)}rem, ${f(5.0)}vw, ${f(3.40)}rem)`;
      if (len <= 35) return `clamp(${f(1.50)}rem, ${f(4.0)}vw, ${f(2.80)}rem)`;
      if (len <= 55) return `clamp(${f(1.25)}rem, ${f(3.2)}vw, ${f(2.20)}rem)`;
      return `clamp(${f(1.05)}rem, ${f(2.6)}vw, ${f(1.80)}rem)`;
    }

    // Default window mode & Mini Player (scaled identically)
    if (len <= 20) return `clamp(${f(1.45)}rem, ${f(4.2)}vw, ${f(2.60)}rem)`;
    if (len <= 35) return `clamp(${f(1.20)}rem, ${f(3.5)}vw, ${f(2.10)}rem)`;
    if (len <= 55) return `clamp(${f(1.05)}rem, ${f(2.8)}vw, ${f(1.70)}rem)`;
    return `clamp(${f(0.90)}rem, ${f(2.2)}vw, ${f(1.40)}rem)`;
  };

  const getNextFontSize = (text) => {
    const len = text?.length || 0;
    const factor = ((fontScale || lyricsFontScale || 100) / 100) * 1.25;
    const f = (val) => Number((val * factor).toFixed(2));

    if (isFullscreen) {
      if (len <= 30) return `clamp(${f(1.40)}rem, ${f(3.5)}vw, ${f(2.20)}rem)`;
      return `clamp(${f(1.15)}rem, ${f(2.8)}vw, ${f(1.80)}rem)`;
    }

    if (isMaximized) {
      if (len <= 30) return `clamp(${f(1.25)}rem, ${f(3.2)}vw, ${f(1.80)}rem)`;
      return `clamp(${f(1.05)}rem, ${f(2.5)}vw, ${f(1.50)}rem)`;
    }

    // Default window mode & Mini Player (scaled identically)
    if (len <= 30) return `clamp(${f(1.05)}rem, ${f(2.7)}vw, ${f(1.45)}rem)`;
    return `clamp(${f(0.88)}rem, ${f(2.1)}vw, ${f(1.20)}rem)`;
  };

  // Responsive chord font sizes scaled across modes (Mini Player & Default, Fullscreen, Maximized)
  const getActiveChordSize = () => {
    const factor = (fontScale || chordsFontScale || 100) / 100;
    const f = (val) => Number((val * factor).toFixed(2));
    if (isFullscreen) return `clamp(${f(3.50)}rem, ${f(8.0)}vw, ${f(6.00)}rem)`;
    if (isMaximized) return `clamp(${f(2.80)}rem, ${f(7.0)}vw, ${f(4.80)}rem)`;
    return `clamp(${f(2.20)}rem, ${f(5.5)}vw, ${f(3.60)}rem)`;
  };

  const getPrevChordSize = (dist) => {
    const factor = (fontScale || chordsFontScale || 100) / 100;
    const f = (val) => Number((val * factor).toFixed(2));
    if (isFullscreen) {
      return dist === 1 ? `clamp(${f(2.20)}rem, ${f(5.0)}vw, ${f(3.50)}rem)` : `clamp(${f(1.70)}rem, ${f(3.8)}vw, ${f(2.60)}rem)`;
    }
    if (isMaximized) {
      return dist === 1 ? `clamp(${f(1.80)}rem, ${f(4.2)}vw, ${f(2.80)}rem)` : `clamp(${f(1.40)}rem, ${f(3.2)}vw, ${f(2.20)}rem)`;
    }
    return dist === 1 ? `clamp(${f(1.40)}rem, ${f(3.4)}vw, ${f(2.10)}rem)` : `clamp(${f(1.10)}rem, ${f(2.6)}vw, ${f(1.60)}rem)`;
  };

  const getNextChordSize = (idx) => {
    const factor = (fontScale || chordsFontScale || 100) / 100;
    const f = (val) => Number((val * factor).toFixed(2));
    if (isFullscreen) {
      if (idx === 0) return `clamp(${f(2.40)}rem, ${f(5.2)}vw, ${f(3.80)}rem)`;
      if (idx === 1) return `clamp(${f(1.90)}rem, ${f(4.2)}vw, ${f(3.00)}rem)`;
      return `clamp(${f(1.50)}rem, ${f(3.2)}vw, ${f(2.40)}rem)`;
    }
    if (isMaximized) {
      if (idx === 0) return `clamp(${f(1.90)}rem, ${f(4.4)}vw, ${f(3.00)}rem)`;
      if (idx === 1) return `clamp(${f(1.50)}rem, ${f(3.5)}vw, ${f(2.40)}rem)`;
      return `clamp(${f(1.30)}rem, ${f(2.8)}vw, ${f(1.90)}rem)`;
    }
    if (idx === 0) return `clamp(${f(1.50)}rem, ${f(3.6)}vw, ${f(2.30)}rem)`;
    if (idx === 1) return `clamp(${f(1.20)}rem, ${f(2.8)}vw, ${f(1.80)}rem)`;
    return `clamp(${f(1.00)}rem, ${f(2.3)}vw, ${f(1.50)}rem)`;
  };

  // If in error or empty state, render nothing so video remains completely unobstructed while overlay closes
  if (mode === 'lyrics') {
    if (lyricsError || (!isLyricsLoading && isCurrentLyrics && lyricsLines.length === 0)) {
      return null;
    }
  } else if (mode === 'chords') {
    if (chordsError || (!isChordsLoading && isCurrentChords && chords.length === 0)) {
      return null;
    }
  }

  return (
    <div
      data-tauri-drag-region={isMiniPlayer ? '' : undefined}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 35,
        borderRadius: isFullscreen ? 0 : '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.72) 40%, rgba(0,0,0,0.72) 60%, rgba(0,0,0,0.88) 100%)',
        pointerEvents: 'auto',
        userSelect: 'none',
        cursor: isMiniPlayer ? 'grab' : 'default',
        transition: 'background 0.2s ease',
        boxSizing: 'border-box',
        padding: isMiniPlayer ? '8px 10px' : '10px 14px'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseMove={() => setIsHovered(true)}
      onClick={(e) => {
        // Toggle play/pause when clicking background of video in regular mode (never in mini-player where clicking drags)
        if (!isMiniPlayer && (e.target === e.currentTarget || e.target.getAttribute('data-bg') === 'true')) {
          onTogglePlay?.();
        }
      }}
      data-bg="true"
    >
      {/* ── Top-Right (X) Return Button (Visible on Hover, Hidden in Mini Player and Fullscreen) ── */}
      {!isMiniPlayer && !isFullscreen && (
        <button
          data-no-drag="true"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          title="Switch back to header view"
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            zIndex: 45,
            opacity: isHovered ? 1 : 0,
            pointerEvents: isHovered ? 'auto' : 'none',
            transition: 'opacity 0.25s ease, transform 0.15s ease, background 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.65)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <X size={15} strokeWidth={2.5} />
        </button>
      )}

      {/* ── LYRICS MODE CONTENT ── */}
      {mode === 'lyrics' && (
        <div
          data-bg="true"
          data-tauri-drag-region={isMiniPlayer ? '' : undefined}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            textAlign: 'center',
            padding: isMiniPlayer ? '16px 8px 26px 8px' : '24px 8px 36px 8px',
            boxSizing: 'border-box'
          }}
        >
          {isLyricsLoading ? (
            <div
              data-tauri-drag-region={isMiniPlayer ? '' : undefined}
              style={{
                color: '#ffffff',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                textShadow: '0 2px 8px rgba(0,0,0,0.9)'
              }}
            >
              <span className="spinner-mini" style={{
                display: 'inline-block',
                width: '16px',
                height: '16px',
                border: '2px solid rgba(255,255,255,0.6)',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite'
              }} />
              <span>Searching lyrics (LRCLIB, YouTube)...</span>
            </div>
          ) : (
            <div data-bg="true" data-tauri-drag-region={isMiniPlayer ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', minWidth: 0 }}>
              {/* Active (current) lyric line - prominent pure white, bold with glowing text-shadow, NO ELLIPSIS */}
              <div
                data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                style={{
                  fontSize: getActiveFontSize(activeLine?.text),
                  fontWeight: 700,
                  color: activeLine ? '#ffffff' : 'rgba(255, 255, 255, 0.5)',
                  textShadow: '0 2px 14px rgba(0,0,0,0.98), 0 1px 4px rgba(0,0,0,0.95), 0 0 30px rgba(0,0,0,0.9)',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  textWrap: 'balance',
                  width: '100%',
                  fontStyle: activeLine ? 'normal' : 'italic',
                  transition: isShrinkingRef.current
                    ? 'color 0.2s ease'
                    : 'color 0.2s ease, font-size 0.28s cubic-bezier(0.25, 1, 0.5, 1)',
                  lineHeight: 1.25,
                  textAlign: 'center'
                }}
              >
                {activeLine ? activeLine.text : '♪ ...'}
              </div>

              {/* Next lyric line */}
              {nextLine && (
                <div
                  data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                  style={{
                    fontSize: getNextFontSize(nextLine.text),
                    color: 'rgba(255, 255, 255, 0.85)',
                    textShadow: '0 2px 8px rgba(0,0,0,0.95)',
                    marginTop: '4px',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    textWrap: 'balance',
                    width: '100%',
                    lineHeight: 1.25,
                    textAlign: 'center',
                    transition: isNextShrinkingRef.current
                      ? 'color 0.2s ease'
                      : 'color 0.2s ease, font-size 0.28s cubic-bezier(0.25, 1, 0.5, 1)'
                  }}
                >
                  {nextLine.text}
                </div>
              )}
            </div>
          )}

          {/* Bottom Floating Sync Calibration Capsule (Visible on Hover, Hidden in Mini Player and Fullscreen where it is in HUD) */}
          {!isMiniPlayer && !isFullscreen && lyricsLines.length > 0 && !isLyricsLoading && onLyricsSyncChange && (
            <div
              data-no-drag="true"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '8px',
                padding: '3px 8px',
                fontSize: '0.75rem',
                color: '#ffffff',
                zIndex: 45,
                opacity: isHovered ? 1 : 0,
                pointerEvents: isHovered ? 'auto' : 'none',
                transition: 'opacity 0.25s ease'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>Sync:</span>
                <button
                  onClick={() => onLyricsSyncChange(s => Math.max(-30, Number((s - 0.25).toFixed(2))))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 4px',
                    fontSize: '0.85rem',
                    lineHeight: 1
                  }}
                  title="Delay Lyrics by 0.25s"
                >
                  -
                </button>
                <span style={{ minWidth: '30px', textAlign: 'center', fontWeight: 'bold', color: '#fff' }}>
                  {lyricsSyncOffset > 0 ? '+' : ''}{lyricsSyncOffset}s
                </span>
                <button
                  onClick={() => onLyricsSyncChange(s => Math.min(30, Number((s + 0.25).toFixed(2))))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 4px',
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
                  onClick={() => onLyricsSyncChange(0)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(255,255,255,0.7)',
                    cursor: 'pointer',
                    fontSize: '0.72rem',
                    textDecoration: 'underline',
                    padding: '0 2px'
                  }}
                  title="Reset sync offset to 0s"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CHORDS MODE CONTENT ── */}
      {mode === 'chords' && (
        <div
          data-bg="true"
          data-tauri-drag-region={isMiniPlayer ? '' : undefined}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            padding: isMiniPlayer ? '16px 8px 26px 8px' : '24px 8px 36px 8px',
            boxSizing: 'border-box'
          }}
        >
          {isChordsLoading ? (
            <div
              data-tauri-drag-region={isMiniPlayer ? '' : undefined}
              style={{ color: '#ffffff', fontSize: '1rem', textShadow: '0 2px 8px rgba(0,0,0,0.9)' }}
            >
              Scraping chords from Chordify...
            </div>
          ) : (
            <div
              data-bg="true"
              data-tauri-drag-region={isMiniPlayer ? '' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Left Side (Past Chords) */}
              <div
                data-bg="true"
                data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                style={{
                  flex: 1,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: isMiniPlayer ? 'clamp(6px, 1.5vw, 12px)' : 'clamp(12px, 2.5vw, 24px)',
                  overflow: 'hidden',
                  paddingRight: isMiniPlayer ? 'clamp(8px, 2.0vw, 16px)' : 'clamp(14px, 3.0vw, 32px)',
                  maskImage: 'linear-gradient(to left, black 50%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to left, black 50%, transparent 100%)'
                }}
              >
                {prevChords.map((c, idx) => {
                  const dist = prevChords.length - idx;
                  const opacity = dist === 1 ? 0.35 : 0.18;
                  const size = getPrevChordSize(dist);

                  return (
                    <div
                      key={`prev-${idx}`}
                      data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                      style={{
                        fontSize: size,
                        color: '#ffffff',
                        fontWeight: 'normal',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        opacity,
                        textShadow: '0 2px 8px rgba(0,0,0,0.95)'
                      }}
                    >
                      {transposeChord(c.chord, transposeOffset || 0)}
                    </div>
                  );
                })}
              </div>

              {/* Center (Active Chord - DEAD CENTER, CLEAN CRISP WHITE) */}
              <div
                data-bg="true"
                data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '0 10px',
                  zIndex: 10
                }}
              >
                <span
                  data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                  style={{
                    fontSize: getActiveChordSize(),
                    fontWeight: 'bold',
                    color: '#ffffff',
                    textShadow: '0 2px 12px rgba(0, 0, 0, 0.98), 0 1px 4px rgba(0, 0, 0, 0.95)',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                    letterSpacing: '-0.01em',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {activeChord ? transposeChord(activeChord.chord, transposeOffset || 0) : '—'}
                </span>
              </div>

              {/* Right Side (Upcoming Chords) */}
              <div
                data-bg="true"
                data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                style={{
                  flex: 1,
                  display: 'flex',
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  gap: isMiniPlayer ? 'clamp(6px, 1.5vw, 12px)' : 'clamp(12px, 2.5vw, 24px)',
                  overflow: 'hidden',
                  paddingLeft: isMiniPlayer ? 'clamp(8px, 2.0vw, 16px)' : 'clamp(14px, 3.0vw, 32px)',
                  maskImage: 'linear-gradient(to right, black 50%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to right, black 50%, transparent 100%)'
                }}
              >
                {nextChords.map((c, idx) => {
                  const opacity = idx === 0 ? 0.55 : idx === 1 ? 0.32 : 0.15;
                  const size = getNextChordSize(idx);

                  return (
                    <div
                      key={`next-${idx}`}
                      data-tauri-drag-region={isMiniPlayer ? '' : undefined}
                      style={{
                        fontSize: size,
                        color: '#ffffff',
                        fontWeight: 'normal',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        opacity,
                        textShadow: '0 2px 8px rgba(0,0,0,0.95)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {transposeChord(c.chord, transposeOffset || 0)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom Floating Sync & Key Capsule (Visible on Hover, Hidden in Mini Player and Fullscreen where it is in HUD) */}
          {!isMiniPlayer && !isFullscreen && chords.length > 0 && !isChordsLoading && (
            <div
              data-no-drag="true"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '12px',
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '8px',
                padding: '3px 10px',
                fontSize: '0.75rem',
                color: '#ffffff',
                zIndex: 45,
                opacity: isHovered ? 1 : 0,
                pointerEvents: isHovered ? 'auto' : 'none',
                transition: 'opacity 0.25s ease'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sync Controls */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>Sync:</span>
                <button
                  onClick={() => onSyncChange?.(s => Math.max(-30, Number((s - 0.25).toFixed(2))))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 4px',
                    fontSize: '0.85rem'
                  }}
                  title="Delay Chords"
                >
                  -
                </button>
                <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 'bold' }}>
                  {syncOffset > 0 ? '+' : ''}{syncOffset}s
                </span>
                <button
                  onClick={() => onSyncChange?.(s => Math.min(30, Number((s + 0.25).toFixed(2))))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 4px',
                    fontSize: '0.85rem'
                  }}
                  title="Advance Chords"
                >
                  +
                </button>
              </div>

              {/* Key Controls */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '8px' }}>
                <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>Key:</span>
                <button
                  onClick={() => onTransposeChange?.(s => (s - 1) % 12)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 4px',
                    fontSize: '0.85rem'
                  }}
                  title="Transpose Down"
                >
                  -
                </button>
                <span style={{ minWidth: '20px', textAlign: 'center', fontWeight: 'bold' }}>
                  {transposeOffset > 0 ? '+' : ''}{transposeOffset}
                </span>
                <button
                  onClick={() => onTransposeChange?.(s => (s + 1) % 12)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 4px',
                    fontSize: '0.85rem'
                  }}
                  title="Transpose Up"
                >
                  +
                </button>
              </div>

              {/* BPM Controls */}
              {chordsData?.bpm && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '8px' }}>
                  <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>BPM:</span>
                  <button
                    onClick={() => onBpmChange?.(b => Math.max(-50, b - 1))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: '0 4px',
                      fontSize: '0.85rem'
                    }}
                    title="Slower / expand beat interval"
                  >
                    -
                  </button>
                  <span
                    onClick={() => bpmOffset !== 0 && onBpmChange?.(0)}
                    style={{
                      minWidth: '24px',
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
                    onClick={() => onBpmChange?.(b => Math.min(50, b + 1))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: '0 4px',
                      fontSize: '0.85rem'
                    }}
                    title="Faster / tighten beat interval"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
