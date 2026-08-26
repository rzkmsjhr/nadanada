import React from 'react';
import { ListMusic, Palette } from 'lucide-react';
import ChordDisplay from './ChordDisplay';

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
  currentTime,
  syncOffset,
  setSyncOffset,
  transposeOffset,
  setTransposeOffset,
  artistFact,
  playlist,
  currentIndex,
  isFetchingEndless,
  toggleTheme
}) {
  return (
    <header className="header" style={isMaximized ? {
      display: 'flex',
      alignItems: 'center',
      height: '80px',
      padding: '0 16px',
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
        paddingRight: '16px',
        height: '100%',
        minWidth: 0
      }}>
        {showChords ? (
          <ChordDisplay 
            data={chordsData} 
            time={currentTime + syncOffset} 
            transpose={transposeOffset} 
            isLoading={isFetchingChords} 
            error={chordsError} 
            onRetry={() => {
              setChordsData(null);
              setChordsError(null);
            }} 
          />
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
        gap: '8px',
        alignItems: 'center'
      }}>
        {showChords && chordsData && !isFetchingChords && !chordsError && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            marginRight: '4px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.7rem',
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              padding: '2px 6px',
              color: 'var(--text-muted)'
            }}>
              <span style={{ marginRight: '4px' }}>Key:</span>
              <button onClick={() => setTransposeOffset(s => (s - 1) % 12)} style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 4px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }} title="Transpose Down">-</button>
              <span style={{
                minWidth: '24px',
                textAlign: 'center',
                fontWeight: 'bold',
                color: 'var(--text-main)'
              }}>{transposeOffset > 0 ? '+' : ''}{transposeOffset}</span>
              <button onClick={() => setTransposeOffset(s => (s + 1) % 12)} style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 4px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }} title="Transpose Up">+</button>
            </div>
            
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.7rem',
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              padding: '2px 6px',
              color: 'var(--text-muted)'
            }}>
              <span style={{ marginRight: '4px' }}>Sync:</span>
              <button onClick={() => setSyncOffset(s => Math.max(-30, s - 0.25))} style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 4px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }} title="Delay Chords">-</button>
              <span style={{
                minWidth: '32px',
                textAlign: 'center',
                fontWeight: 'bold',
                color: 'var(--text-main)'
              }}>{syncOffset > 0 ? '+' : ''}{syncOffset}s</span>
              <button onClick={() => setSyncOffset(s => Math.min(30, s + 0.25))} style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 4px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }} title="Advance Chords">+</button>
            </div>
          </div>
        )}
        
        <button className={`btn btn-icon ${showChords ? 'active' : ''}`} onClick={() => setShowChords(!showChords)} title="Toggle Chords" style={{
          background: showChords ? 'var(--button-hover)' : 'transparent',
          boxShadow: 'none',
          color: showChords ? 'var(--accent-color)' : 'inherit'
        }}>
          <ListMusic size={20} />
        </button>
        <button className="btn btn-icon" onClick={toggleTheme} title="Switch Theme" style={{
          background: 'transparent',
          boxShadow: 'none'
        }}>
          <Palette size={20} />
        </button>
      </div>
    </header>
  );
}
