import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ListMusic, Settings, Mic2, X, Maximize2 } from 'lucide-react';
import ChordDisplay from './ChordDisplay';
import LyricsDisplay from './LyricsDisplay';

export default function PlayerHeader({
  isMaximized,
  showSearch,
  showChords,
  setShowChords,
  chordsData,
  isFetchingChords,
  chordsError,
  setChordsData,
  setChordsError,
  syncOffset,
  setSyncOffset,
  transposeOffset,
  setTransposeOffset,
  bpmOffset = 0,
  setBpmOffset,
  showLyrics,
  setShowLyrics,
  lyricsData,
  isFetchingLyrics,
  lyricsError,
  lyricsSyncOffset = 0,
  setLyricsSyncOffset,
  onRetryLyrics,
  artistFact,
  playlist,
  currentIndex,
  isFetchingEndless,
  onOpenSettings,
  videoOverlayMode,
  setVideoOverlayMode,
  fontScale,
  lyricsFontScale,
  chordsFontScale,
  onAddChordifySong
}) {
  const isViewActive = (showLyrics || showChords) && !videoOverlayMode;
  const [showDropdown, setShowDropdown] = useState(false);
  const [menuCoords, setMenuCoords] = useState(null);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const handleToggleDropdown = () => {
    if (!showDropdown && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuCoords({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right
      });
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  // Close dropdown when clicking outside or resizing
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    const handleScrollOrResize = () => setShowDropdown(false);

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', handleScrollOrResize);
      window.addEventListener('scroll', handleScrollOrResize, true);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [showDropdown]);

  return (
    <header className="header" style={isMaximized ? {
      display: 'flex',
      alignItems: 'center',
      minHeight: '64px',
      height: 'auto',
      padding: '8px 16px 4px 16px',
      flexShrink: 0,
      boxShadow: '0 1px 0 0 var(--panel-border)'
    } : {
      paddingBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      minHeight: '60px',
      height: 'auto',
      opacity: showSearch && !isMaximized ? 0 : 1,
      transition: 'opacity 0.2s ease',
      pointerEvents: showSearch && !isMaximized ? 'none' : 'auto'
    }}>
      <div style={{
        flex: 1,
        display: 'flex',
        paddingRight: '4px',
        height: '100%',
        minWidth: 0
      }}>
        {isViewActive ? (
          /* Wrapped container with solid border, radius, and small circle close (x) button */
          <div 
            className="card-hover-container"
            style={{
              position: 'relative',
              width: '100%',
              border: '1px solid var(--panel-border)',
              borderRadius: '10px',
              background: 'var(--bg-color)',
              minHeight: isMaximized ? '60px' : '58px',
              padding: isMaximized ? '8px 14px' : '8px 12px',
              margin: '0',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minWidth: 0,
              boxSizing: 'border-box'
            }}
          >
            {/* Action buttons on top right corner */}
            <div style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              zIndex: 10
            }}>
              {/* Overlay button (visible on hover) */}
              <button
                className="card-hover-overlay-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setVideoOverlayMode?.(showChords ? 'chords' : 'lyrics');
                }}
                title="Overlay on video"
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: '1px solid var(--panel-border)',
                  background: 'var(--panel-bg)',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                <Maximize2 size={10} strokeWidth={2.2} />
              </button>

              {/* Close (X) button */}
              <button
                onClick={() => {
                  setShowLyrics?.(false);
                  setShowChords?.(false);
                }}
                title="Close"
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: '1px solid var(--panel-border)',
                  background: 'var(--panel-bg)',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-main)';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-muted)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>

            {showChords ? (
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, justifyContent: 'center' }}>
                <div style={{ minHeight: '36px', height: 'auto', display: 'flex', alignItems: 'center', paddingRight: '48px' }}>
                  <ChordDisplay 
                    data={chordsData} 
                    syncOffset={syncOffset} 
                    transpose={transposeOffset} 
                    chordsFontScale={fontScale ?? chordsFontScale ?? 100}
                    fontScale={fontScale ?? chordsFontScale ?? 100}
                    isLoading={isFetchingChords} 
                    error={chordsError} 
                    onRetry={() => {
                      setChordsData(null);
                      setChordsError(null);
                    }}
                    onAddChordifySong={onAddChordifySong}
                    currentSong={playlist?.[currentIndex]}
                    playlist={playlist}
                  />
                </div>
                {chordsData && !isFetchingChords && !chordsError && (
                  <div className="card-hover-controls" style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    rowGap: '4px',
                    columnGap: '5px',
                    marginTop: '6px',
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)'
                  }}>
                    {/* Sync Capsule */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '6px',
                      padding: '1px 4px'
                    }}>
                      <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>Sync:</span>
                      <button onClick={() => setSyncOffset?.(s => Math.max(-30, Number((s - 0.25).toFixed(2))))} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.75rem',
                        lineHeight: 1
                      }} title="Delay Chords">-</button>
                      <span style={{
                        minWidth: '24px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: 'var(--text-main)'
                      }}>{syncOffset > 0 ? '+' : ''}{syncOffset}s</span>
                      <button onClick={() => setSyncOffset?.(s => Math.min(30, Number((s + 0.25).toFixed(2))))} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.75rem',
                        lineHeight: 1
                      }} title="Advance Chords">+</button>
                    </div>

                    {/* Key Capsule */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '6px',
                      padding: '1px 4px'
                    }}>
                      <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>Key:</span>
                      <button onClick={() => setTransposeOffset?.(s => (s - 1) % 12)} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.75rem',
                        lineHeight: 1
                      }} title="Transpose Down">-</button>
                      <span style={{
                        minWidth: '14px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: 'var(--text-main)'
                      }}>{transposeOffset > 0 ? '+' : ''}{transposeOffset}</span>
                      <button onClick={() => setTransposeOffset?.(s => (s + 1) % 12)} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.75rem',
                        lineHeight: 1
                      }} title="Transpose Up">+</button>
                    </div>

                    {/* BPM Capsule */}
                    {chordsData?.bpm && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        background: 'var(--panel-bg)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: '6px',
                        padding: '1px 4px'
                      }}>
                        <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>BPM:</span>
                        <button onClick={() => setBpmOffset?.(b => Math.max(-50, b - 1))} style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: '0 2px',
                          fontSize: '0.75rem',
                          lineHeight: 1
                        }} title="Slower / expand beat interval">-</button>
                        <span
                          onClick={() => bpmOffset !== 0 && setBpmOffset?.(0)}
                          style={{
                            minWidth: '20px',
                            textAlign: 'center',
                            fontWeight: 'bold',
                            color: bpmOffset !== 0 ? 'var(--accent-color)' : 'var(--text-main)',
                            cursor: bpmOffset !== 0 ? 'pointer' : 'default'
                          }}
                          title={bpmOffset !== 0 ? `BPM shifted by ${bpmOffset > 0 ? '+' : ''}${bpmOffset} (click to reset)` : "Song tempo"}
                        >
                          {Math.round(chordsData.bpm)}
                        </span>
                        <button onClick={() => setBpmOffset?.(b => Math.min(50, b + 1))} style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: '0 2px',
                          fontSize: '0.75rem',
                          lineHeight: 1
                        }} title="Faster / tighten beat interval">+</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <LyricsDisplay
                data={lyricsData}
                syncOffset={lyricsSyncOffset}
                onSyncChange={setLyricsSyncOffset}
                onSwitchToOverlay={() => setVideoOverlayMode?.('lyrics')}
                lyricsFontScale={fontScale ?? lyricsFontScale ?? 100}
                fontScale={fontScale ?? lyricsFontScale ?? 100}
                isLoading={isFetchingLyrics}
                error={lyricsError}
                onRetry={onRetryLyrics}
              />
            )}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            paddingLeft: '8px',
            overflow: 'hidden',
            flex: 1
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minWidth: 0,
              paddingRight: '16px',
              flex: 1,
              width: '100%'
            }}>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '2px'
              }}>
                {artistFact ? 'Artist Fact' : 'Up Next'}
              </div>
              <div className="marquee-container">
                <div className={artistFact ? 'running-text' : ''} style={{
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  color: 'var(--text-main)',
                  whiteSpace: 'nowrap',
                  fontStyle: artistFact ? 'italic' : 'normal'
                }}>
                  {artistFact ? `"${artistFact}"` : playlist?.[currentIndex + 1]?.title ? playlist[currentIndex + 1].title : isFetchingEndless ? 'Loading Mix...' : 'End of Playlist'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div style={{
        flexShrink: 0,
        display: 'flex',
        gap: '2px',
        alignItems: 'center'
      }}>
        {/* Chord button with dropdown: HIDDEN when Lyrics or Chords is active */}
        {!isViewActive && (
          <div>
            <button 
              ref={buttonRef}
              className={`btn btn-icon ${showDropdown ? 'active' : ''}`} 
              onClick={handleToggleDropdown} 
              title="Lyrics & Chords" 
              style={{
                background: showDropdown ? 'var(--panel-bg)' : 'transparent',
                boxShadow: 'none',
                color: showDropdown ? 'var(--accent-color)' : 'inherit'
              }}
            >
              <ListMusic size={20} />
            </button>

            {showDropdown && menuCoords && createPortal(
              <div 
                ref={dropdownRef}
                className="dropdown-menu-portal"
                style={{
                  top: `${menuCoords.top}px`,
                  right: `${menuCoords.right}px`
                }}
              >
                <button
                  className="dropdown-item-btn"
                  onClick={() => {
                    setShowLyrics?.(true);
                    setShowChords?.(false);
                    setVideoOverlayMode?.(null);
                    setShowDropdown(false);
                  }}
                >
                  <Mic2 size={15} color="var(--accent-color)" />
                  <span>Lyrics</span>
                </button>

                <button
                  className="dropdown-item-btn"
                  onClick={() => {
                    setShowChords?.(true);
                    setShowLyrics?.(false);
                    setVideoOverlayMode?.(null);
                    setShowDropdown(false);
                  }}
                >
                  <ListMusic size={15} color="var(--accent-color)" />
                  <span>Chords</span>
                </button>
              </div>,
              document.body
            )}
          </div>
        )}

        <button 
          className="btn btn-icon" 
          onClick={onOpenSettings} 
          title="Settings (Theme & Crossfade)" 
          style={{
            background: 'transparent',
            boxShadow: 'none'
          }}
        >
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}
