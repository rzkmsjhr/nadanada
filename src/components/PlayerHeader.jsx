import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ListMusic, Settings, Mic2, X } from 'lucide-react';
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
  onOpenSettings
}) {
  const isViewActive = showLyrics || showChords;
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
              padding: isMaximized ? '8px 34px 8px 18px' : '10px 28px 10px 14px',
              margin: '0',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minWidth: 0,
              boxSizing: 'border-box'
            }}
          >
            {/* Small circle close (x) button on the top right corner */}
            <button
              onClick={() => {
                setShowLyrics?.(false);
                setShowChords?.(false);
              }}
              title="Close"
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                border: '1px solid var(--panel-border)',
                background: 'var(--panel-bg)',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                zIndex: 10,
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

            {showChords ? (
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, justifyContent: 'center' }}>
                <div style={{ height: '36px', display: 'flex', alignItems: 'center' }}>
                  <ChordDisplay 
                    data={chordsData} 
                    syncOffset={syncOffset} 
                    transpose={transposeOffset} 
                    isLoading={isFetchingChords} 
                    error={chordsError} 
                    onRetry={() => {
                      setChordsData(null);
                      setChordsError(null);
                    }} 
                  />
                </div>
                {chordsData && !isFetchingChords && !chordsError && (
                  <div className="card-hover-controls" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '8px',
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)'
                  }}>
                    {/* Sync Capsule first on the left */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '6px',
                      padding: '1px 5px'
                    }}>
                      <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>Sync:</span>
                      <button onClick={() => setSyncOffset?.(s => Math.max(-30, Number((s - 0.25).toFixed(2))))} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 3px',
                        fontSize: '0.75rem'
                      }} title="Delay Chords">-</button>
                      <span style={{
                        minWidth: '28px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: 'var(--text-main)'
                      }}>{syncOffset > 0 ? '+' : ''}{syncOffset}s</span>
                      <button onClick={() => setSyncOffset?.(s => Math.min(30, Number((s + 0.25).toFixed(2))))} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 3px',
                        fontSize: '0.75rem'
                      }} title="Advance Chords">+</button>
                    </div>

                    {/* Key Capsule second on the right */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '6px',
                      padding: '1px 5px'
                    }}>
                      <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>Key:</span>
                      <button onClick={() => setTransposeOffset?.(s => (s - 1) % 12)} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 3px',
                        fontSize: '0.75rem'
                      }} title="Transpose Down">-</button>
                      <span style={{
                        minWidth: '18px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: 'var(--text-main)'
                      }}>{transposeOffset > 0 ? '+' : ''}{transposeOffset}</span>
                      <button onClick={() => setTransposeOffset?.(s => (s + 1) % 12)} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '0 3px',
                        fontSize: '0.75rem'
                      }} title="Transpose Up">+</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <LyricsDisplay
                data={lyricsData}
                syncOffset={lyricsSyncOffset}
                onSyncChange={setLyricsSyncOffset}
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
                  {artistFact ? `"${artistFact}"` : playlist[currentIndex + 1] ? playlist[currentIndex + 1].title : isFetchingEndless ? 'Loading Mix...' : 'End of Playlist'}
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
