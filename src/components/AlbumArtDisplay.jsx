import React, { useState, useEffect, useMemo } from 'react';
import { Disc } from 'lucide-react';
import { getOptimizedThumbnail } from './SpinningVinyl';

export default function AlbumArtDisplay({ song, subtext }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [srcIndex, setSrcIndex] = useState(0);

  const rawThumb = song?.thumbnail;
  const optimizedThumb = getOptimizedThumbnail(rawThumb) || rawThumb;

  // Generate candidate source URLs in order of preference:
  // 1. Optimized thumbnail (800x800 for googleusercontent, raw for tidal/monochrome)
  // 2. If it's a YouTube thumbnail with hqdefault/mqdefault, try maxresdefault first
  // 3. Fallback to raw thumbnail / hqdefault
  const sources = useMemo(() => {
    if (!rawThumb) return [];
    const list = [];
    if (rawThumb.includes('i.ytimg.com')) {
      const maxres = rawThumb.replace(/(?:hq|mq|sd|default)\.jpg/i, 'maxresdefault.jpg');
      if (maxres !== rawThumb) list.push(maxres);
      list.push(rawThumb);
      const hq = rawThumb.replace(/(?:maxresdefault|mqdefault|sddefault|default)\.jpg/i, 'hqdefault.jpg');
      if (!list.includes(hq)) list.push(hq);
    } else {
      if (optimizedThumb) list.push(optimizedThumb);
      if (rawThumb && rawThumb !== optimizedThumb) list.push(rawThumb);
    }
    return list;
  }, [rawThumb, optimizedThumb]);

  const activeSrc = sources[srcIndex] || null;

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setSrcIndex(0);
  }, [song?.id, rawThumb]);

  const handleError = () => {
    if (srcIndex + 1 < sources.length) {
      setSrcIndex(prev => prev + 1);
    } else {
      setHasError(true);
    }
  };

  const handleLoad = () => {
    setIsLoaded(true);
  };

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      userSelect: 'none'
    }}>
      {activeSrc && !hasError ? (
        <>
          {/* Ambient Blurred Background Glow (like YouTube Topic / YouTube Music) */}
          <div style={{
            position: 'absolute',
            inset: '-40px',
            zIndex: 1,
            overflow: 'hidden',
            pointerEvents: 'none'
          }}>
            <img
              src={activeSrc}
              alt=""
              aria-hidden="true"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(42px) brightness(0.38) saturate(1.4)',
                transform: 'scale(1.25)',
                opacity: isLoaded ? 0.75 : 0,
                transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            />
            {/* Soft Radial Vignette Overlay */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(circle at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.65) 100%)'
            }} />
          </div>

          {/* Sharp Foreground Album Art */}
          <div style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            padding: '24px',
            boxSizing: 'border-box'
          }}>
            <img
              src={activeSrc}
              alt={song?.title || 'Album Art'}
              onLoad={handleLoad}
              onError={handleError}
              style={{
                maxHeight: '82%',
                maxWidth: '82%',
                aspectRatio: '1 / 1',
                objectFit: 'contain',
                borderRadius: '12px',
                boxShadow: '0 16px 44px rgba(0, 0, 0, 0.7), 0 4px 14px rgba(0, 0, 0, 0.45)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                opacity: isLoaded ? 1 : 0,
                transform: isLoaded ? 'scale(1)' : 'scale(0.96)',
                transition: 'opacity 0.35s ease, transform 0.35s ease'
              }}
            />
          </div>
        </>
      ) : (
        /* Fallback when no thumbnail is available */
        <div style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '90px',
            height: '90px',
            borderRadius: '16px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <Disc size={42} style={{ color: 'var(--accent-color)', opacity: 0.85 }} />
          </div>
          <div style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.85rem', fontWeight: 500 }}>
            {song?.title || 'Hi-Fi Audio'}
          </div>
        </div>
      )}

      {/* Optional subtle status pill (e.g. "Playing Offline" or "Audio Stream Fallback") */}
      {subtext && (
        <div style={{
          position: 'absolute',
          bottom: '14px',
          zIndex: 4,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          padding: '3px 9px',
          borderRadius: '12px',
          fontSize: '0.72rem',
          color: 'rgba(255, 255, 255, 0.75)',
          letterSpacing: '0.3px',
          pointerEvents: 'none'
        }}>
          {subtext}
        </div>
      )}
    </div>
  );
}
