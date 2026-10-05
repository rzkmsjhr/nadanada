import React from 'react';
import { Play, Shuffle, ListPlus, Loader2, X, Users, Disc } from 'lucide-react';

export default function ArtistHeroVisualizer({
  artistName,
  artistDetails,
  isLoading,
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
        justifyContent: 'space-between',
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
          background: 'linear-gradient(to top, rgba(14, 14, 18, 0.95) 0%, rgba(14, 14, 18, 0.5) 45%, rgba(0, 0, 0, 0.2) 100%), linear-gradient(to right, rgba(14, 14, 18, 0.7) 0%, transparent 60%)',
          pointerEvents: 'none'
        }}
      />

      {/* Top Header Row (Close Button) */}
      <div style={{
        position: 'relative',
        zIndex: 5,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 14px'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '20px',
          padding: '4px 10px',
          fontSize: '0.75rem',
          color: '#ffffff',
          fontWeight: 600,
          letterSpacing: '0.5px'
        }}>
          <Disc size={13} style={{ color: 'var(--accent-color)' }} />
          <span>ARTIST</span>
        </div>

        {onClose && (
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
        )}
      </div>

      {/* Bottom Content Row: Artist Name, Audience, Action Buttons */}
      <div style={{
        position: 'relative',
        zIndex: 5,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        {isLoading && !artistDetails ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#fff' }}>
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
            <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>Loading {artistName}…</span>
          </div>
        ) : (
          <>
            <div>
              <h1 style={{
                margin: 0,
                fontSize: '1.65rem',
                fontWeight: 800,
                color: '#ffffff',
                textShadow: '0 2px 10px rgba(0,0,0,0.8)',
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
                  marginTop: '4px',
                  fontSize: '0.82rem',
                  color: 'rgba(255, 255, 255, 0.8)',
                  textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                  fontWeight: 500
                }}>
                  <Users size={14} style={{ opacity: 0.8 }} />
                  <span>{audience}</span>
                </div>
              )}
            </div>

            {/* Quick Action Buttons */}
            {artistDetails?.top_songs?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                <button
                  className="btn btn-primary"
                  onClick={onPlayAll}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    boxShadow: '0 2px 10px rgba(0,0,0,0.4)'
                  }}
                  title="Play artist top songs"
                >
                  <Play size={14} fill="currentColor" /> Play
                </button>

                <button
                  className="btn"
                  onClick={onShuffleAll}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    background: 'rgba(255, 255, 255, 0.15)',
                    backdropFilter: 'blur(8px)',
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.2)'
                  }}
                  title="Shuffle artist top songs"
                >
                  <Shuffle size={14} /> Shuffle
                </button>

                <button
                  className="btn"
                  onClick={onAddAll}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    background: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(8px)',
                    color: 'rgba(255, 255, 255, 0.9)',
                    border: '1px solid rgba(255, 255, 255, 0.15)'
                  }}
                  title="Add all top songs to queue"
                >
                  <ListPlus size={14} /> Add All
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
