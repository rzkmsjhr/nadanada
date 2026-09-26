import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { Maximize2 } from 'lucide-react';

const LyricsDisplay = ({ data, syncOffset = 0, onSyncChange, onSwitchToOverlay, lyricsFontScale = 100, isLoading, error, onRetry }) => {
  const [time, setTime] = useState(0);
  const containerRef = useRef(null);
  const activeTextRef = useRef(null);
  const nextTextRef = useRef(null);
  const [activeScale, setActiveScale] = useState(1);
  const [nextScale, setNextScale] = useState(1);

  useEffect(() => {
    const handleTime = (e) => setTime(e.detail + (syncOffset || 0));
    window.addEventListener('timeupdate', handleTime);
    return () => window.removeEventListener('timeupdate', handleTime);
  }, [syncOffset]);

  const lines = data?.lines || [];

  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (time >= lines[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }

  const activeLine = activeIndex >= 0 ? lines[activeIndex] : null;
  const nextLine = activeIndex + 1 < lines.length ? lines[activeIndex + 1] : null;

  // Dynamic auto-scale to guarantee text NEVER overflows or shows ellipsis
  const updateScales = useCallback(() => {
    if (!containerRef.current) return;
    const parentWidth = containerRef.current.clientWidth;
    if (parentWidth <= 0) return;

    if (activeTextRef.current) {
      const el = activeTextRef.current;
      el.style.transform = 'none';
      const w = el.scrollWidth;
      if (w > parentWidth) {
        setActiveScale(parentWidth / w);
      } else {
        setActiveScale(1);
      }
    }

    if (nextTextRef.current) {
      const el = nextTextRef.current;
      el.style.transform = 'none';
      const w = el.scrollWidth;
      if (w > parentWidth) {
        setNextScale(parentWidth / w);
      } else {
        setNextScale(1);
      }
    }
  }, []);

  useLayoutEffect(() => {
    updateScales();
  }, [activeLine?.text, nextLine?.text, lyricsFontScale, updateScales]);

  useEffect(() => {
    window.addEventListener('resize', updateScales);
    return () => window.removeEventListener('resize', updateScales);
  }, [updateScales]);

  if (isLoading) {
    return (
      <div style={{
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '36px',
        fontSize: '0.82rem'
      }}>
        <span className="spinner-mini" style={{
          display: 'inline-block',
          width: '12px',
          height: '12px',
          border: '2px solid var(--text-muted)',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <span>Searching lyrics (LRCLIB, YouTube)...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        color: '#ef4444',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '36px',
        fontSize: '0.82rem'
      }}>
        <span>{error}</span>
        {onRetry && (
          <button 
            onClick={onRetry} 
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid #ef4444',
              color: '#ef4444',
              borderRadius: '4px',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: '0.75rem'
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', minHeight: '36px', fontSize: '0.82rem' }}>
        No lyrics available.
      </div>
    );
  }

  if (data.isInstrumental) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', minHeight: '36px' }}>
        <span style={{ fontSize: '0.95rem', color: 'var(--accent-color)', fontWeight: 600 }}>
          ♪ Instrumental ♪
        </span>
      </div>
    );
  }

  // ── Only Synchronized Lyrics Supported ──
  if (!data.isSynced) {
    return (
      <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', minHeight: '36px', fontSize: '0.82rem' }}>
        No synced lyrics available.
      </div>
    );
  }

  // ── Time-Synced Lyrics Mode ──
  if (lines.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', minHeight: '36px', fontSize: '0.82rem' }}>
        No synced lyrics available.
      </div>
    );
  }

  // Responsive font size calculation scaled by user settings
  const get25PercentFontSize = (text) => {
    const len = text?.length || 0;
    const factor = (lyricsFontScale || 100) / 100;
    const f = (val) => Number((val * factor).toFixed(2));
    if (len <= 18) return `clamp(${f(1.10)}rem, ${f(2.8)}vw, ${f(1.30)}rem)`;
    if (len <= 30) return `clamp(${f(1.00)}rem, ${f(2.4)}vw, ${f(1.18)}rem)`;
    if (len <= 45) return `clamp(${f(0.88)}rem, ${f(2.0)}vw, ${f(1.05)}rem)`;
    if (len <= 60) return `clamp(${f(0.78)}rem, ${f(1.7)}vw, ${f(0.94)}rem)`;
    return `clamp(${f(0.70)}rem, ${f(1.4)}vw, ${f(0.85)}rem)`;
  };

  const getUpcomingFontSize = (text) => {
    const len = text?.length || 0;
    const factor = (lyricsFontScale || 100) / 100;
    const f = (val) => Number((val * factor).toFixed(2));
    if (len <= 35) return `clamp(${f(0.82)}rem, ${f(1.8)}vw, ${f(0.94)}rem)`;
    return `clamp(${f(0.74)}rem, ${f(1.5)}vw, ${f(0.84)}rem)`;
  };

  return (
    <div ref={containerRef} style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: '36px',
      height: '100%',
      minWidth: 0,
      width: '100%',
      overflow: 'hidden'
    }}>
      {/* Active (current) lyric line - auto-scales to fit container with ZERO ellipsis */}
      <div 
        ref={activeTextRef}
        style={{
          fontSize: get25PercentFontSize(activeLine?.text),
          fontWeight: 600,
          color: activeLine ? 'var(--accent-color)' : 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'clip',
          fontStyle: activeLine ? 'normal' : 'italic',
          transition: 'color 0.2s ease, font-size 0.2s ease',
          lineHeight: 1.25,
          display: 'inline-block',
          width: 'max-content',
          transform: `scale(${activeScale})`,
          transformOrigin: 'left center'
        }}
      >
        {activeLine ? activeLine.text : '♪ ...'}
      </div>

      {/* Upcoming next lyric line - auto-scales to fit container with ZERO ellipsis */}
      {nextLine && (
        <div 
          ref={nextTextRef}
          style={{
            fontSize: getUpcomingFontSize(nextLine?.text),
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'clip',
            marginTop: '2px',
            opacity: 0.75,
            lineHeight: 1.2,
            display: 'inline-block',
            width: 'max-content',
            transform: `scale(${nextScale})`,
            transformOrigin: 'left center'
          }}
        >
          {nextLine.text}
        </div>
      )}

      {/* Sync calibration capsule below the lyrics (same capsule style as chords) */}
      {data.isSynced && onSyncChange && (
        <div className="card-hover-controls" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginTop: '8px',
          fontSize: '0.7rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            background: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            borderRadius: '6px',
            padding: '1px 5px'
          }}>
            <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>Sync:</span>
            <button 
              onClick={(e) => { e.stopPropagation(); onSyncChange(s => Math.max(-30, Number((s - 0.25).toFixed(2)))); }} 
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 3px',
                fontSize: '0.75rem',
                lineHeight: 1
              }}
              title="Delay Lyrics by 0.25s"
            >
              -
            </button>
            <span style={{
              minWidth: '28px',
              textAlign: 'center',
              fontWeight: 'bold',
              fontSize: '0.72rem',
              color: 'var(--text-main)'
            }}>
              {syncOffset > 0 ? '+' : ''}{syncOffset}s
            </span>
            <button 
              onClick={(e) => { e.stopPropagation(); onSyncChange(s => Math.min(30, Number((s + 0.25).toFixed(2)))); }} 
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 3px',
                fontSize: '0.75rem',
                lineHeight: 1
              }}
              title="Advance Lyrics by 0.25s"
            >
              +
            </button>
          </div>

          {onSwitchToOverlay && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwitchToOverlay();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--panel-bg)',
                border: '1px solid var(--panel-border)',
                borderRadius: '6px',
                padding: '2px 5px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.75rem',
                lineHeight: 1,
                height: '18px',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-main)';
                e.currentTarget.style.borderColor = 'var(--accent-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.borderColor = 'var(--panel-border)';
              }}
              title="Overlay on video"
            >
              <Maximize2 size={11} strokeWidth={2.2} />
            </button>
          )}

          {syncOffset !== 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onSyncChange(0); }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.68rem',
                textDecoration: 'underline',
                padding: '0 4px',
                marginLeft: '2px',
                opacity: 0.8
              }}
              title="Reset sync offset to 0s"
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default LyricsDisplay;
