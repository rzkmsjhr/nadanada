import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';

const LyricsDisplay = ({ data, syncOffset = 0, onSyncChange, onSwitchToOverlay, fontScale, lyricsFontScale = 100, isLoading, error, onRetry }) => {
  const effectiveFontScale = fontScale ?? lyricsFontScale ?? 100;
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

  const getActiveTier = (text) => {
    const len = text?.length || 0;
    if (len <= 15) return 5;
    if (len <= 25) return 4;
    if (len <= 40) return 3;
    if (len <= 60) return 2;
    return 1;
  };

  const getUpcomingTier = (text) => {
    const len = text?.length || 0;
    if (len <= 35) return 2;
    return 1;
  };

  const activeText = activeLine?.text || '';
  const prevActiveTextRef = useRef(activeText);
  const prevActiveTierRef = useRef(getActiveTier(activeText));
  const isShrinkingRef = useRef(false);
  const prevActiveScaleRef = useRef(1);

  if (activeText !== prevActiveTextRef.current) {
    const prevTier = prevActiveTierRef.current;
    const currTier = getActiveTier(activeText);
    const prevLen = prevActiveTextRef.current.length;
    // Shrinking occurs when tier drops (smaller font-size) or text is longer or initial mount
    isShrinkingRef.current = currTier < prevTier || activeText.length > prevLen || prevLen === 0;
    prevActiveTextRef.current = activeText;
    prevActiveTierRef.current = currTier;
  }

  const nextText = nextLine?.text || '';
  const prevNextTextRef = useRef(nextText);
  const prevNextTierRef = useRef(getUpcomingTier(nextText));
  const isNextShrinkingRef = useRef(false);
  const prevNextScaleRef = useRef(1);

  if (nextText !== prevNextTextRef.current) {
    const prevTier = prevNextTierRef.current;
    const currTier = getUpcomingTier(nextText);
    const prevLen = prevNextTextRef.current.length;
    isNextShrinkingRef.current = currTier < prevTier || nextText.length > prevLen || prevLen === 0;
    prevNextTextRef.current = nextText;
    prevNextTierRef.current = currTier;
  }

  // Dynamic auto-scale to guarantee text NEVER overflows or shows ellipsis
  const updateScales = useCallback(() => {
    if (!containerRef.current) return;
    const parentWidth = containerRef.current.clientWidth;
    if (parentWidth <= 0) return;

    if (activeTextRef.current) {
      const el = activeTextRef.current;
      const w = el.scrollWidth;
      const targetScale = w > parentWidth ? parentWidth / w : 1;
      const isScaleShrinking = isShrinkingRef.current || (targetScale < (prevActiveScaleRef.current - 0.02));
      if (isScaleShrinking) {
        el.style.transition = 'color 0.2s ease';
      }
      // Immediately set the target scale so the browser never renders an unscaled/oversized frame
      el.style.transform = `scale(${targetScale})`;
      prevActiveScaleRef.current = targetScale;
      setActiveScale(targetScale);
    }

    if (nextTextRef.current) {
      const el = nextTextRef.current;
      const w = el.scrollWidth;
      const targetScale = w > parentWidth ? parentWidth / w : 1;
      const isScaleShrinking = isNextShrinkingRef.current || (targetScale < (prevNextScaleRef.current - 0.02));
      if (isScaleShrinking) {
        el.style.transition = 'color 0.2s ease';
      }
      el.style.transform = `scale(${targetScale})`;
      prevNextScaleRef.current = targetScale;
      setNextScale(targetScale);
    }
  }, []);

  useLayoutEffect(() => {
    updateScales();
  }, [activeLine?.text, nextLine?.text, effectiveFontScale, updateScales]);

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
    const factor = ((effectiveFontScale || 100) / 100) * 1.25;
    const f = (val) => Number((val * factor).toFixed(2));
    if (len <= 18) return `clamp(${f(1.10)}rem, ${f(2.8)}vw, ${f(1.30)}rem)`;
    if (len <= 30) return `clamp(${f(1.00)}rem, ${f(2.4)}vw, ${f(1.18)}rem)`;
    if (len <= 45) return `clamp(${f(0.88)}rem, ${f(2.0)}vw, ${f(1.05)}rem)`;
    if (len <= 60) return `clamp(${f(0.78)}rem, ${f(1.7)}vw, ${f(0.94)}rem)`;
    return `clamp(${f(0.70)}rem, ${f(1.4)}vw, ${f(0.85)}rem)`;
  };

  const getUpcomingFontSize = (text) => {
    const len = text?.length || 0;
    const factor = ((effectiveFontScale || 100) / 100) * 1.25;
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
          transition: isShrinkingRef.current
            ? 'color 0.2s ease'
            : 'color 0.2s ease, font-size 0.25s cubic-bezier(0.25, 1, 0.5, 1), transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)',
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
            transformOrigin: 'left center',
            transition: isNextShrinkingRef.current
              ? 'color 0.2s ease'
              : 'color 0.2s ease, font-size 0.25s cubic-bezier(0.25, 1, 0.5, 1), transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)'
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
