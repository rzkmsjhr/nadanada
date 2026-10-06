import React from 'react';
import { Play, Pause, Shuffle, ListPlus, Loader2, X, Users } from 'lucide-react';

export default function ArtistHeroVisualizer({
  artistName,
  artistDetails,
  isLoading,
  isFullscreen = false,
  isMaximized = false,
  isMiniPlayer = false,
  isShuffle = false,
  isPlaying = false,
  onPlayAll,
  onShuffleAll,
  onAddAll,
  onClose
}) {
  const bgImage = artistDetails?.background_image || artistDetails?.avatar;
  const name = artistDetails?.name || artistName;
  const audience = artistDetails?.monthly_audience || (artistDetails?.subscribers ? `${artistDetails.subscribers} subscribers` : null);

  return (
    <div 
      className="artist-hero-container"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 15,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: isFullscreen ? 'flex-end' : 'space-between',
        background: '#111116',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Background Image with smooth fade */}
      {bgImage && (
        <img 
          src={bgImage} 
          alt={name}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 25%',
            filter: 'brightness(0.9)',
            transform: 'scale(1.02)',
            transition: 'opacity 0.4s ease-out'
          }} 
        />
      )}

      {/* Dark Vignette / Gradient Overlay */}
      <div 
        style={{
          position: 'absolute',
          inset: 0,
          background: isFullscreen 
            ? 'linear-gradient(to top, rgba(14, 14, 18, 0.95) 0%, rgba(14, 14, 18, 0.6) 35%, rgba(0, 0, 0, 0.25) 100%), linear-gradient(to right, rgba(14, 14, 18, 0.75) 0%, transparent 65%)'
            : 'linear-gradient(to top, rgba(14, 14, 18, 0.95) 0%, rgba(14, 14, 18, 0.5) 45%, rgba(0, 0, 0, 0.2) 100%), linear-gradient(to right, rgba(14, 14, 18, 0.7) 0%, transparent 60%)',
          pointerEvents: 'none'
        }}
      />

      {/* Top Header Row (Close Button) - Hide in fullscreen or mini player */}
      {!isFullscreen && !isMiniPlayer && onClose && (
        <div style={{
          position: 'relative',
          zIndex: 5,
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '12px 14px'
        }}>
          <button 
            className="btn btn-icon"
            onClick={onClose}
            title="Back to Turntable / Playlist"
            style={{
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '50%',
              padding: '6px',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Bottom Content Row: Artist Name, Audience, Action Buttons */}
      <div style={{
        position: 'relative',
        zIndex: 5,
        padding: isFullscreen 
          ? '0 36px 156px 36px' 
          : isMaximized 
            ? '18px 24px 30px 24px' 
            : isMiniPlayer
              ? '12px 14px'
              : '8px 18px 40px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: isFullscreen ? '14px' : isMiniPlayer ? '3px' : '10px',
        pointerEvents: 'auto'
      }}>
        {isLoading && !artistDetails ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#fff' }}>
            <Loader2 size={isFullscreen ? 28 : 24} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
            <span style={{ fontSize: isFullscreen ? '1.4rem' : '1.2rem', fontWeight: 600 }}>Loading {artistName}…</span>
          </div>
        ) : (
          <>
            <div>
              <h1 style={{
                margin: 0,
                fontSize: isFullscreen ? '2.5rem' : isMaximized ? '2rem' : isMiniPlayer ? '1.25rem' : '1.45rem',
                fontWeight: 800,
                color: '#ffffff',
                textShadow: '0 2px 14px rgba(0,0,0,0.85)',
                letterSpacing: '-0.02em',
                lineHeight: 1.15
              }}>
                {name}
              </h1>

              {audience && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: isFullscreen ? '6px' : '4px',
                  fontSize: isFullscreen ? '0.95rem' : isMiniPlayer ? '0.78rem' : '0.82rem',
                  color: 'rgba(255, 255, 255, 0.85)',
                  textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                  fontWeight: 500
                }}>
                  <Users size={isFullscreen ? 16 : isMiniPlayer ? 13 : 14} style={{ opacity: 0.85 }} />
                  <span>{audience}</span>
                </div>
              )}
            </div>

            {/* Quick Action Buttons (hidden in mini player as it has its own media controller) */}
            {!isMiniPlayer && artistDetails?.top_songs?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: isFullscreen ? '4px' : '2px' }}>
                <button
                  className="btn btn-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayAll?.();
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: isFullscreen ? '9px 18px' : '7px 14px',
                    borderRadius: '20px',
                    fontSize: isFullscreen ? '0.88rem' : '0.82rem',
                    fontWeight: 600,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
                    cursor: 'pointer'
                  }}
                  title={isPlaying ? "Pause artist top songs" : "Play artist top songs"}
                >
                  {isPlaying ? (
                    <>
                      <Pause size={isFullscreen ? 16 : 14} fill="currentColor" /> Pause
                    </>
                  ) : (
                    <>
                      <Play size={isFullscreen ? 16 : 14} fill="currentColor" /> Play
                    </>
                  )}
                </button>

                <button
                  className={`btn ${isShuffle ? 'btn-primary' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShuffleAll?.();
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: isFullscreen ? '9px 18px' : '7px 14px',
                    borderRadius: '20px',
                    fontSize: isFullscreen ? '0.88rem' : '0.82rem',
                    fontWeight: 600,
                    background: isShuffle ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.15)',
                    backdropFilter: 'blur(8px)',
                    color: '#ffffff',
                    border: isShuffle ? '1px solid var(--accent-color)' : '1px solid rgba(255, 255, 255, 0.25)',
                    boxShadow: isShuffle ? '0 2px 14px rgba(0,0,0,0.45)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  title={isShuffle ? "Shuffle is ON (Click to toggle)" : "Shuffle artist top songs"}
                >
                  <Shuffle size={isFullscreen ? 16 : 14} />
                  <span>Shuffle</span>
                  {isShuffle && (
                    <span 
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#ffffff',
                        display: 'inline-block',
                        marginLeft: '1px',
                        boxShadow: '0 0 6px rgba(255,255,255,0.9)'
                      }} 
                      title="Active"
                    />
                  )}
                </button>

                <button
                  className="btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddAll?.();
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: isFullscreen ? '9px 18px' : '7px 14px',
                    borderRadius: '20px',
                    fontSize: isFullscreen ? '0.88rem' : '0.82rem',
                    fontWeight: 600,
                    background: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(8px)',
                    color: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    cursor: 'pointer'
                  }}
                  title="Add all top songs to playlist"
                >
                  <ListPlus size={isFullscreen ? 16 : 14} /> Add All
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
