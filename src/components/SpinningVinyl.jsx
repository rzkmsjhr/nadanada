import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Disc } from 'lucide-react';

/**
 * Checks whether a track should display album/cover art (spinning vinyl)
 * instead of video content. Strictly guarantees videos never spin.
 */
export function isAlbumArtTrack(song) {
  if (!song) return false;

  // 1. Local offline files are always audio tracks with album art
  if (song.is_local) return true;

  const channel = (song.channel || '').toLowerCase().trim();
  const title = (song.title || '').toLowerCase().trim();
  const itemType = (song.item_type || '').toLowerCase().trim();

  // 2. Explicit video type must NEVER spin or show turntable
  if (itemType === 'video') {
    return false;
  }

  // 3. Inspect title & channel for video markers FIRST
  // Even if tagged as 'song' from a mix or playlist, if it's an official music video it is a VIDEO!
  const videoKeywords = [
    'official music video',
    'official video',
    'music video',
    'official audio video',
    'lyric video',
    'lyrics video',
    'visualizer',
    'official visualizer',
    'performance video',
    'live performance',
    'dance practice',
    'live at',
    'live in',
    'live from',
    'live concert',
    'full concert',
    'trailer',
    'teaser',
    '[mv]',
    '(mv)',
    '[m/v]',
    '(m/v)',
    '[official video]',
    '(official video)',
    '[official music video]',
    '(official music video)',
    '(video)',
    '[video]'
  ];

  if (videoKeywords.some(keyword => title.includes(keyword))) {
    return false;
  }

  // Standalone MV / M/V with word boundary check
  if (/\b(mv|m\/v)\b/i.test(title)) {
    return false;
  }

  // VEVO channels host official music videos, never static album art
  if (channel.includes('vevo')) {
    return false;
  }

  // 4. YouTube Topic channels are auto-generated audio releases with static album art
  if (channel.endsWith('- topic') || channel === 'topic') {
    return true;
  }

  // 5. Explicit "song" items from YouTube Music (that passed video checks above)
  if (itemType === 'song') {
    return true;
  }

  // 6. User constraint: "if the track is video, and not 'song' or '- topic' one",
  // both the turntable and trigger option MUST be hidden.
  // Any regular YouTube video, upload, or non-song release defaults to false.
  return false;
}

export function getOptimizedThumbnail(thumbnail) {
  if (!thumbnail) return null;
  try {
    if (thumbnail.includes('googleusercontent.com') || thumbnail.includes('ggpht.com')) {
      return thumbnail
        .replace(/=w\d+-h\d+[^?#]*/i, '=w800-h800-l90-rj')
        .replace(/=s\d+[^?#]*/i, '=s800');
    }
  } catch (_) {}
  return thumbnail;
}

export default function SpinningVinyl({
  song,
  nextSong = null,
  isPlaying = false,
  isCrossfading = false,
  direction = 'forward',
  subtext = null,
  onTogglePlay = null
}) {
  const [displayedSong, setDisplayedSong] = useState(song || null);
  const [outgoingSong, setOutgoingSong] = useState(null);
  const [incomingSong, setIncomingSong] = useState(null);
  const [transitionPhase, setTransitionPhase] = useState('idle'); // 'idle' | 'docking' | 'swapping' | 'undocking'
  const [transitionDirection, setTransitionDirection] = useState(direction || 'forward');

  const [tonearmAngle, setTonearmAngle] = useState(isPlaying ? 54 : 0);
  const [armTransitionDuration, setArmTransitionDuration] = useState(0.85);
  const [armEasing, setArmEasing] = useState('0.25, 1, 0.5, 1');

  const [imgErrors, setImgErrors] = useState({});
  const transitionTimersRef = useRef([]);
  const prevSongIdRef = useRef(song?.id || null);
  const prevCrossfadeRef = useRef(false);
  const displayedSongRef = useRef(displayedSong);
  displayedSongRef.current = displayedSong;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const tonearmAngleRef = useRef(tonearmAngle);
  tonearmAngleRef.current = tonearmAngle;

  const handleImgError = (songId) => {
    if (!songId) return;
    setImgErrors(prev => ({ ...prev, [songId]: true }));
  };

  const getFinalThumbnail = (s) => {
    if (!s) return null;
    if (imgErrors[s.id]) return null;
    const raw = s.thumbnail;
    return getOptimizedThumbnail(raw) || raw;
  };

  const clearTimers = () => {
    transitionTimersRef.current.forEach(t => clearTimeout(t));
    transitionTimersRef.current = [];
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const triggerTransition = useCallback((fromSong, toSong, dir = 'forward') => {
    if (!toSong || fromSong?.id === toSong?.id) return;

    clearTimers();

    setTransitionDirection(dir);
    setOutgoingSong(fromSong);
    setIncomingSong(toSong);

    // Preload incoming thumbnail
    if (toSong?.thumbnail) {
      const img = new Image();
      img.src = getOptimizedThumbnail(toSong.thumbnail) || toSong.thumbnail;
    }

    const currentAngle = tonearmAngleRef.current;
    const isArmCurrentlyOverRecord = isPlayingRef.current && currentAngle > 10;

    // ── Continuous fluid transition (No pauses or stops) ──
    setTransitionPhase('swapping');

    if (isArmCurrentlyOverRecord) {
      // 1. Arm begins lifting & swinging towards dock at t=0
      setTonearmAngle(0);
      setArmTransitionDuration(0.36);
      setArmEasing('0.3, 0, 0.25, 1');

      // 2. At t=350ms (needle has cleared vinyl and arm reached dock apex):
      // Without stopping, arm immediately reverses and glides back towards incoming record!
      const returnArmTimer = setTimeout(() => {
        if (isPlayingRef.current) {
          setTonearmAngle(54);
          setArmTransitionDuration(0.55);
          setArmEasing('0.22, 1, 0.36, 1');
        }
      }, 350);
      transitionTimersRef.current.push(returnArmTimer);

      // 3. At t=820ms: Circular revolver animation completes its 180° sweep.
      // Incoming disc is smoothly brought to rest on the platter spindle.
      // Atomically commit displayedSong and return to idle with zero freeze or flash.
      const finishTimer = setTimeout(() => {
        setDisplayedSong(toSong);
        setOutgoingSong(null);
        setIncomingSong(null);
        setTransitionPhase('idle');
      }, 820);
      transitionTimersRef.current.push(finishTimer);
    } else {
      // Tonearm is already parked at dock (paused). Circular carousel runs smoothly.
      setTonearmAngle(0);

      const finishTimer = setTimeout(() => {
        setDisplayedSong(toSong);
        setOutgoingSong(null);
        setIncomingSong(null);
        setTransitionPhase('idle');
      }, 820);
      transitionTimersRef.current.push(finishTimer);
    }
  }, []);

  // Monitor song changes and crossfade transitions
  useEffect(() => {
    const currentId = song?.id;
    const targetDir = direction || 'forward';

    // Auto-crossfade start detection
    if (isCrossfading && !prevCrossfadeRef.current && nextSong && nextSong.id !== displayedSongRef.current?.id) {
      prevCrossfadeRef.current = true;
      triggerTransition(displayedSongRef.current || song, nextSong, targetDir);
      prevSongIdRef.current = nextSong.id;
      return;
    }
    prevCrossfadeRef.current = isCrossfading;

    // Normal song change or manual skip detection
    if (currentId && currentId !== prevSongIdRef.current) {
      const prevId = prevSongIdRef.current;
      prevSongIdRef.current = currentId;

      if (!prevId) {
        // First song load ever: initial appearance
        setDisplayedSong(song);
        if (isPlaying) {
          setTonearmAngle(54);
        }
        return;
      }

      if (currentId !== displayedSongRef.current?.id) {
        triggerTransition(displayedSongRef.current, song, targetDir);
      }
    } else if (!currentId && prevSongIdRef.current) {
      prevSongIdRef.current = null;
      setDisplayedSong(null);
      setTonearmAngle(0);
      setTransitionPhase('idle');
    }
  }, [song?.id, isCrossfading, nextSong?.id, direction, triggerTransition, isPlaying]);

  // Handle play/pause toggles during steady playback
  useEffect(() => {
    if (transitionPhase === 'idle') {
      setTonearmAngle(isPlaying ? 54 : 0);
      setArmTransitionDuration(0.75);
      setArmEasing('0.25, 1, 0.5, 1');
    }
  }, [isPlaying, transitionPhase]);

  const activeThumbnail = getFinalThumbnail(displayedSong || song);

  // 10 vertical LED meter levels: green (-20 to -2), amber (0 to +2), red (+4 to +8)
  const VU_STEPS = [
    { y: 306, label: '-20', type: 'green' },
    { y: 280, label: '-15', type: 'green' },
    { y: 254, label: '-10', type: 'green' },
    { y: 228, label: '-7',  type: 'green' },
    { y: 202, label: '-4',  type: 'green' },
    { y: 176, label: '-2',  type: 'green' },
    { y: 150, label: '0',   type: 'amber' },
    { y: 124, label: '+2',  type: 'amber' },
    { y: 98,  label: '+4',  type: 'red' },
    { y: 72,  label: '+8',  type: 'red' }
  ];

  const getColorHex = (type) => {
    if (type === 'red') return '#ef4444';
    if (type === 'amber') return '#f59e0b';
    return '#22c55e';
  };

  const getUnlitHex = (type) => {
    if (type === 'red') return '#2b1111';
    if (type === 'amber') return '#291e0a';
    return '#102216';
  };

  // ── Authentic DJ Mixer Indefinite Dynamic LED VU Meter ──
  const [vuLevels, setVuLevels] = useState({ l: 1, r: 1, peakL: 1, peakR: 1 });
  const animRef = useRef({ l: 1, r: 1, peakL: 1, peakR: 1, peakHoldL: 0, peakHoldR: 0, lastFrame: 0 });

  useEffect(() => {
    let animId;
    let lastTime = performance.now();

    const updateVu = (now) => {
      // Throttle updates to ~35fps for maximum performance while maintaining silky smooth motion
      if (now - animRef.current.lastFrame < 28) {
        animId = requestAnimationFrame(updateVu);
        return;
      }
      animRef.current.lastFrame = now;

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (!isPlaying) {
        // Smoothly decay to idle (1 lit LED at bottom indicating powered-on deck)
        animRef.current.l = Math.max(1, animRef.current.l - dt * 7);
        animRef.current.r = Math.max(1, animRef.current.r - dt * 7);
        animRef.current.peakL = Math.max(1, animRef.current.peakL - dt * 5);
        animRef.current.peakR = Math.max(1, animRef.current.peakR - dt * 5);
      } else {
        const t = now / 1000;
        // Dynamic music rhythm simulation with fast transients, beat pulses, and polyrhythmic syncopation
        const beat1 = Math.sin(t * 12.566) * 2.2;
        const beat2 = Math.cos(t * 6.283) * 1.8;
        const sub = Math.sin(t * 3.141) * 1.2;
        const flutterL = Math.sin(t * 31.4) * 0.9 + (Math.random() - 0.5) * 1.8;
        const flutterR = Math.cos(t * 28.2) * 0.9 + (Math.random() - 0.5) * 1.8;

        // Target dynamic audio levels (1 to 10 scale)
        const targetL = Math.min(10, Math.max(1, 5.8 + beat1 + beat2 * 0.6 + sub * 0.5 + flutterL));
        const targetR = Math.min(10, Math.max(1, 5.6 + beat1 * 0.9 + beat2 * 0.7 + sub * 0.6 + flutterR));

        // Fast rise / attack (instant transient response)
        if (targetL > animRef.current.l) {
          animRef.current.l = targetL;
        } else {
          // Ballistic VU decay
          animRef.current.l = Math.max(1, animRef.current.l - dt * 14);
        }

        if (targetR > animRef.current.r) {
          animRef.current.r = targetR;
        } else {
          animRef.current.r = Math.max(1, animRef.current.r - dt * 14);
        }

        // Peak Hold LED tracking
        if (animRef.current.l >= animRef.current.peakL) {
          animRef.current.peakL = Math.round(animRef.current.l);
          animRef.current.peakHoldL = now + 420; // hold peak dot for 420ms
        } else if (now > animRef.current.peakHoldL) {
          animRef.current.peakL = Math.max(1, animRef.current.peakL - dt * 6);
        }

        if (targetR > animRef.current.r) {
          animRef.current.peakR = Math.round(animRef.current.r);
          animRef.current.peakHoldR = now + 420;
        } else if (now > animRef.current.peakHoldR) {
          animRef.current.peakR = Math.max(1, animRef.current.peakR - dt * 6);
        }
      }

      setVuLevels({
        l: Math.round(animRef.current.l),
        r: Math.round(animRef.current.r),
        peakL: Math.round(animRef.current.peakL),
        peakR: Math.round(animRef.current.peakR)
      });

      animId = requestAnimationFrame(updateVu);
    };

    animId = requestAnimationFrame(updateVu);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  // ── Vintage Digital LCD Title Display State ──
  const lcdContainerRef = useRef(null);
  const [isMarquee, setIsMarquee] = useState(false);
  
  // Show incoming song title as soon as swapping begins
  const activeTitleSong = transitionPhase === 'swapping' ? (incomingSong || displayedSong || song) : (displayedSong || song);
  const displayTitle = (activeTitleSong?.title || 'NO DISC LOADED').trim();

  useEffect(() => {
    // If title has more than 15 characters, auto-marquee smoothly
    if (displayTitle.length > 15) {
      setIsMarquee(true);
      return;
    }
    if (lcdContainerRef.current) {
      setIsMarquee(lcdContainerRef.current.scrollWidth > lcdContainerRef.current.clientWidth + 4);
    } else {
      setIsMarquee(false);
    }
  }, [displayTitle]);

  const marqueeDuration = Math.max(12, Math.min(28, Math.round(displayTitle.length * 0.55)));

  const lcdTextStyle = {
    fontFamily: '"Doto", monospace',
    fontSize: '22px',
    fontWeight: 400,
    fontVariationSettings: '"ROND" 100, "wght" 400',
    letterSpacing: '2px',
    color: '#ffffff',
    textTransform: 'uppercase',
    textShadow: '0 0 2px rgba(255, 255, 255, 0.7), 0 0 8px rgba(59, 130, 246, 0.45)',
    lineHeight: 1
  };

  /**
   * Helper to render a photorealistic vinyl disc.
   */
  const renderVinylDisc = (discSong, customStyle = {}, isSpinning = false, keyId = 'active') => {
    const thumb = getFinalThumbnail(discSong);

    return (
      <div
        key={keyId}
        className="vinyl-record-wrapper"
        style={{
          position: 'absolute',
          width: '96%',
          height: '96%',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.85))',
          ...customStyle
        }}
      >
        {/* Rotating Vinyl Disc */}
        <div
          className="vinyl-disc"
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            animation: isSpinning ? 'nadanada-vinyl-spin 20s linear infinite' : 'none',
            animationPlayState: isPlaying ? 'running' : 'paused',
            willChange: 'transform',
            background: `
              radial-gradient(circle at center,
                #0d0d0f 0%,
                #141417 87%,
                #1c1c1f 89%,
                #101012 90%,
                #18181b 92%,
                #242429 94%,
                #121214 96%,
                #222226 98%,
                #0b0b0d 100%
              )
            `,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 0 14px rgba(0,0,0,0.95)'
          }}
        >
          {/* Concentric micro-groove texture */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: 'repeating-radial-gradient(circle at center, transparent 0px, transparent 2px, rgba(255, 255, 255, 0.022) 2.5px, transparent 3px)',
              pointerEvents: 'none'
            }}
          />

          {/* Center Label (Album Art - 90% of disc) */}
          <div
            className="vinyl-center-label"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '90%',
              height: '90%',
              borderRadius: '50%',
              overflow: 'hidden',
              boxShadow: '0 0 0 2px #0a0a0c, 0 0 0 3px rgba(255,255,255,0.14), inset 0 0 10px rgba(0,0,0,0.7)',
              background: '#18181b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {thumb ? (
              <img
                src={thumb}
                alt={discSong?.title || 'Album Art'}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block'
                }}
                onError={() => discSong?.id && handleImgError(discSong.id)}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.75)',
                  textAlign: 'center',
                  padding: '8px'
                }}
              >
                <Disc size={32} style={{ color: 'var(--accent-color)', marginBottom: '4px' }} />
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    maxWidth: '85%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {discSong?.title || 'Track'}
                </span>
              </div>
            )}

            {/* Inner rim groove of the label */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                boxShadow: 'inset 0 0 0 1.5px rgba(255, 255, 255, 0.2)',
                pointerEvents: 'none'
              }}
            />

            {/* Center Spindle Hole */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '7%',
                height: '7%',
                borderRadius: '50%',
                background: '#070708',
                border: '2px solid rgba(220, 220, 235, 0.7)',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.85)'
              }}
            />
          </div>
        </div>

        {/* Stationary physical light sheen overlay */}
        <div
          className="vinyl-reflection-sheen"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `conic-gradient(
              from 42deg at 50% 50%,
              rgba(255, 255, 255, 0.08) 0deg,
              transparent 35deg,
              transparent 145deg,
              rgba(255, 255, 255, 0.08) 180deg,
              transparent 215deg,
              transparent 325deg,
              rgba(255, 255, 255, 0.08) 360deg
            )`,
            pointerEvents: 'none',
            mixBlendMode: 'screen'
          }}
        />
      </div>
    );
  };

  return (
    <div
      className="spinning-vinyl-container"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#060608',
        userSelect: 'none',
        pointerEvents: 'none'
      }}
    >
      {/* Ambient background with album art blur aura */}
      {activeThumbnail && (
        <div
          style={{
            position: 'absolute',
            inset: '-20%',
            backgroundImage: `url(${activeThumbnail})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            filter: 'blur(50px) brightness(0.2) saturate(1.3)',
            transform: 'scale(1.2)',
            opacity: 0.6,
            transition: 'opacity 0.6s ease',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Dark Vignette Overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.88) 95%)',
          pointerEvents: 'none'
        }}
      />

      {/* ── Turntable Plinth (Physical Body) - Fully Occupies Video Container ── */}
      <div
        className="turntable-chassis"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: '12px',
          boxSizing: 'border-box',
          // Rich vintage dark walnut finish with natural annular grain
          background: `
            linear-gradient(180deg, 
              rgba(255, 255, 255, 0.08) 0%, 
              transparent 8%, 
              transparent 92%, 
              rgba(0, 0, 0, 0.4) 100%
            ),
            repeating-radial-gradient(
              ellipse 900px 65px at 50% -35px,
              transparent 0px,
              transparent 14px,
              rgba(0, 0, 0, 0.12) 16px,
              rgba(255, 255, 255, 0.035) 17px,
              transparent 19px,
              transparent 30px,
              rgba(0, 0, 0, 0.15) 33px,
              transparent 36px
            ),
            linear-gradient(135deg, 
              #462510 0%, 
              #2e1507 24%, 
              #542e14 48%, 
              #261105 72%, 
              #3f200c 100%
            )
          `,
          boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.25), inset 0 -2px 6px rgba(0, 0, 0, 0.7), 0 8px 24px rgba(0, 0, 0, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        {/* Photorealistic Natural Wood Grain Fibers (SVG Fractal Noise) */}
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            opacity: 0.45,
            mixBlendMode: 'overlay'
          }}
        >
          <filter id="naturalWoodFilter" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.005 0.14"
              numOctaves="4"
              stitchTiles="stitch"
              result="grain"
            />
            <feColorMatrix
              type="matrix"
              values="
                1.3 0 0 0 -0.15
                0 1.3 0 0 -0.15
                0 0 1.3 0 -0.15
                0 0 0 0.85 0"
              result="contrastGrain"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#naturalWoodFilter)" fill="#5c3419" />
        </svg>

        {/* ── Inner Recessed Turntable Deck Plate (Thicker 4.5% Wood Frame) ── */}
        <div
          className="turntable-deck-plate"
          style={{
            position: 'absolute',
            inset: '4.5%',
            borderRadius: '8px',
            background: 'linear-gradient(145deg, #151619 0%, #0d0e10 50%, #121316 100%)',
            boxShadow: 'inset 0 4px 14px rgba(0, 0, 0, 0.95), inset 0 0 0 1.5px rgba(0, 0, 0, 0.8), 0 1px 2px rgba(255, 255, 255, 0.18)',
            overflow: 'hidden'
          }}
        >
          {/* Subtle brushed metal deck texture */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 255, 255, 0.008) 2.5px, transparent 3px)',
              pointerEvents: 'none'
            }}
          />

          {/* ── Turntable Platter Bed (Stationary metallic platter rim and rubber mat) ── */}
          <div
            className="turntable-platter-bed"
            style={{
              position: 'absolute',
              left: '4%',
              top: '50%',
              transform: 'translateY(-50%)',
              height: '88%',
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              // Clean dark metallic platter rim
              background: 'linear-gradient(135deg, #2b2c32 0%, #151619 50%, #222328 100%)',
              border: '3px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.8), 0 12px 32px rgba(0, 0, 0, 0.95)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'visible'
            }}
          >
            {/* Anti-static rubber platter mat with concentric traction ridges */}
            <div
              style={{
                position: 'absolute',
                inset: '5px',
                borderRadius: '50%',
                background: 'radial-gradient(circle at center, #0e0f11 0%, #18191d 60%, #121316 100%)',
                boxShadow: 'inset 0 0 16px rgba(0, 0, 0, 0.95)',
                pointerEvents: 'none'
              }}
            >
              {/* Concentric anti-static rubber ridges */}
              <div
                style={{
                  position: 'absolute',
                  inset: '14%',
                  borderRadius: '50%',
                  border: '1.5px solid rgba(255, 255, 255, 0.04)',
                  boxShadow: 'inset 0 0 0 3px rgba(0, 0, 0, 0.6), 0 0 0 3px rgba(0, 0, 0, 0.6)'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: '30%',
                  borderRadius: '50%',
                  border: '1.5px solid rgba(255, 255, 255, 0.04)',
                  boxShadow: 'inset 0 0 0 3px rgba(0, 0, 0, 0.6), 0 0 0 3px rgba(0, 0, 0, 0.6)'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: '46%',
                  borderRadius: '50%',
                  border: '1.5px solid rgba(255, 255, 255, 0.04)',
                  boxShadow: 'inset 0 0 0 2px rgba(0, 0, 0, 0.6), 0 0 0 2px rgba(0, 0, 0, 0.6)'
                }}
              />
            </div>

            {/* Silver Center Spindle Pin (Fixed to platter center, always visible) */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '3.6%',
                height: '3.6%',
                borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #d4d4d8 30%, #71717a 70%, #27272a 100%)',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.9), inset 0 1px 1px rgba(255, 255, 255, 0.8)',
                zIndex: 6,
                pointerEvents: 'none'
              }}
            />

            {/* ── Vinyl Stage: active, outgoing, and incoming vinyl records ── */}
            <div
              className="turntable-vinyl-stage"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 3,
                pointerEvents: 'none'
              }}
            >
              {transitionPhase === 'swapping' ? (
                <>
                  {/* Outgoing Vinyl Record (Slides/spins out along revolver arc: 6PM to 12AM) */}
                  {outgoingSong && (
                    <div
                      key={`orbit-out-${outgoingSong.id}`}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transformOrigin: '50% -5%',
                        animation: `${transitionDirection === 'backward' ? 'nadanada-revolver-slide-out-reverse' : 'nadanada-revolver-slide-out'} 0.82s cubic-bezier(0.25, 1, 0.5, 1) forwards`,
                        willChange: 'transform, opacity',
                        zIndex: 1
                      }}
                    >
                      {renderVinylDisc(outgoingSong, {}, false, `outgoing-${outgoingSong.id}`)}
                    </div>
                  )}

                  {/* Incoming Vinyl Record (Slides/spins in along revolver arc: 12PM to 6PM) */}
                  {incomingSong && (
                    <div
                      key={`orbit-in-${incomingSong.id}`}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transformOrigin: '50% -5%',
                        animation: `${transitionDirection === 'backward' ? 'nadanada-revolver-slide-in-reverse' : 'nadanada-revolver-slide-in'} 0.82s cubic-bezier(0.25, 1, 0.5, 1) forwards`,
                        willChange: 'transform, opacity',
                        zIndex: 2
                      }}
                    >
                      {renderVinylDisc(incomingSong, {}, false, `incoming-${incomingSong.id}`)}
                    </div>
                  )}
                </>
              ) : (
                /* Normal Active Vinyl Record */
                displayedSong && renderVinylDisc(
                  displayedSong,
                  {
                    transform: 'translate3d(0, 0, 0)',
                    zIndex: 2
                  },
                  true,
                  `active-${displayedSong.id}`
                )
              )}
            </div>
          </div>

          {/* ── Turntable Hardware, Tonearm & Mixer Lighting SVG Overlay ── */}
          <svg
            viewBox="0 0 1000 562.5"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              overflow: 'visible',
              zIndex: 10
            }}
          >
            <defs>
              {/* Chrome/Metallic Linear Gradient */}
              <linearGradient id="metalGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f4f4f5" />
                <stop offset="30%" stopColor="#a1a1aa" />
                <stop offset="55%" stopColor="#ffffff" />
                <stop offset="80%" stopColor="#52525b" />
                <stop offset="100%" stopColor="#d4d4d8" />
              </linearGradient>

              {/* Dark Titanium Gradient */}
              <linearGradient id="darkMetalGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#3f3f46" />
                <stop offset="50%" stopColor="#27272a" />
                <stop offset="100%" stopColor="#18181b" />
              </linearGradient>

              {/* Brass/Dark Plaque Gradient */}
              <linearGradient id="plaqueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2a2825" />
                <stop offset="50%" stopColor="#1a1917" />
                <stop offset="100%" stopColor="#11100e" />
              </linearGradient>

              {/* Polished Chrome Linear Gradient for Badge */}
              <linearGradient id="chromePlaqueGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="20%" stopColor="#e2e8f0" />
                <stop offset="45%" stopColor="#cbd5e1" />
                <stop offset="50%" stopColor="#ffffff" />
                <stop offset="55%" stopColor="#e2e8f0" />
                <stop offset="80%" stopColor="#a6b1c0" />
                <stop offset="100%" stopColor="#d1d5db" />
              </linearGradient>

              {/* Chrome Badge Bevel Border Gradient */}
              <linearGradient id="chromeBevelGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#64748b" />
              </linearGradient>

              {/* Crisp shadow under chrome badge */}
              <filter id="badgeShadow" x="-20%" y="-20%" width="140%" height="150%">
                <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.75" />
              </filter>

              {/* Soft physical drop shadow for tonearm */}
              <filter id="tonearmShadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="4" dy="10" stdDeviation="7" floodColor="#000" floodOpacity="0.8" />
              </filter>

              {/* Glow filters for VU meter lights */}
              <filter id="glowGreen" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#22c55e" floodOpacity="0.9" />
              </filter>
              <filter id="glowAmber" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#f59e0b" floodOpacity="0.9" />
              </filter>
              <filter id="glowRed" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#ef4444" floodOpacity="0.95" />
              </filter>

              {/* Recessed Pocket Well in Turntable Deck Plate */}
              <linearGradient id="lcdPocketGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#040507" />
                <stop offset="100%" stopColor="#0c0e12" />
              </linearGradient>

              {/* Natural Brushed Aluminum / Satin Silver Faceplate Gradient */}
              <linearGradient id="lcdBrushedMetalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#eef2f6" />
                <stop offset="6%" stopColor="#dbe1ea" />
                <stop offset="22%" stopColor="#c5cdd8" />
                <stop offset="50%" stopColor="#a2abb8" />
                <stop offset="78%" stopColor="#b9c2ce" />
                <stop offset="95%" stopColor="#87919f" />
                <stop offset="100%" stopColor="#636c7a" />
              </linearGradient>

              {/* Directional Machined Bevel Stroke: Top light highlight, bottom shadow seam */}
              <linearGradient id="lcdBevelStrokeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.75)" />
                <stop offset="25%" stopColor="rgba(255, 255, 255, 0.25)" />
                <stop offset="70%" stopColor="rgba(15, 23, 42, 0.45)" />
                <stop offset="100%" stopColor="rgba(2, 6, 23, 0.85)" />
              </linearGradient>

              {/* LCD Screen Recessed Dark Chamfer Gradient */}
              <linearGradient id="lcdChamferGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#04060a" />
                <stop offset="50%" stopColor="#0a0e16" />
                <stop offset="100%" stopColor="#151b26" />
              </linearGradient>

              {/* LCD Backlit Cobalt Blue Glass Gradient */}
              <linearGradient id="lcdGlassGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#030d1d" />
                <stop offset="35%" stopColor="#071b38" />
                <stop offset="65%" stopColor="#092248" />
                <stop offset="100%" stopColor="#030c1b" />
              </linearGradient>

              {/* LCD Frame Natural Ambient Occlusion Drop Shadow */}
              <filter id="lcdFrameShadow" x="-10%" y="-20%" width="120%" height="150%">
                <feDropShadow dx="0" dy="2.5" stdDeviation="3" floodColor="#000000" floodOpacity="0.75" />
              </filter>

              {/* Micro-scanline pattern for authentic LCD glass */}
              <pattern id="lcdScanlines" width="10" height="3" patternUnits="userSpaceOnUse">
                <line x1="0" y1="2" x2="10" y2="2" stroke="#000000" strokeWidth="0.8" opacity="0.3" />
              </pattern>
            </defs>

            {/* ── Strobe / Power Pillar (Bottom-Left) ── */}
            <g transform="translate(55, 465)">
              <circle cx="15" cy="5" r="16" fill="url(#metalGrad)" stroke="#27272a" strokeWidth="1" />
              <circle cx="15" cy="5" r="12" fill="#141518" />
              <circle
                cx="15"
                cy="5"
                r="4"
                fill="var(--accent-color)"
                style={{
                  filter: isPlaying ? 'drop-shadow(0 0 6px var(--accent-color))' : 'none',
                  opacity: isPlaying ? 1 : 0.4,
                  transition: 'all 0.3s ease'
                }}
              />
            </g>

            {/* ── Audiophile Plaque / Badge (Chrome with Black Text) ── */}
            <g transform="translate(485, 55)" filter="url(#badgeShadow)">
              {/* Outer Chrome Bevel Border */}
              <rect width="150" height="46" rx="4" fill="url(#chromeBevelGrad)" stroke="rgba(0,0,0,0.6)" strokeWidth="0.8" />
              
              {/* Polished Chrome Face Plate */}
              <rect x="1.5" y="1.5" width="147" height="43" rx="3" fill="url(#chromePlaqueGrad)" />
              
              {/* Inner Fine Hairline Frame */}
              <rect x="3.5" y="3.5" width="143" height="39" rx="2" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="0.7" />
              
              {/* Bold Black Typography */}
              <text x="75" y="17.5" fill="#000000" fontSize="10.5" fontWeight="900" letterSpacing="2.2" textAnchor="middle">
                NADANADA
              </text>
              <text x="75" y="29.5" fill="#111827" fontSize="7" letterSpacing="1.2" fontWeight="700" textAnchor="middle">
                DIRECT DRIVE TURNTABLE
              </text>
              <text x="75" y="39.5" fill="#1f2937" fontSize="6.2" letterSpacing="0.8" fontWeight="700" textAnchor="middle">
                QUARTZ HI-FI AUDIO SYSTEM
              </text>
            </g>

            {/* ── Vintage Mixer Dual Stereo LED VU Meter (Wider, High-Visibility Faceplate) ── */}
            <g transform="translate(820, 95)">
              {/* Meter Faceplate with beveled border - Expanded width to 130 */}
              <rect width="130" height="340" rx="9" fill="#090a0d" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <rect x="2" y="2" width="126" height="336" rx="7" fill="#0c0d11" stroke="rgba(0,0,0,0.8)" strokeWidth="1" />
              
              {/* Header Title */}
              <text x="65" y="21" fill="rgba(255,255,255,0.8)" fontSize="8.5" fontWeight="800" letterSpacing="2" textAnchor="middle">
                VU LEVEL
              </text>
              {/* Channel Labels */}
              <text x="30" y="34" fill="rgba(255,255,255,0.45)" fontSize="7.5" fontWeight="700" textAnchor="middle">CH 1</text>
              <text x="100" y="34" fill="rgba(255,255,255,0.45)" fontSize="7.5" fontWeight="700" textAnchor="middle">CH 2</text>
              
              {/* Vertical channels background tracks */}
              <rect x="17" y="44" width="26" height="282" rx="13" fill="#060608" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8" />
              <rect x="87" y="44" width="26" height="282" rx="13" fill="#060608" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8" />
              
              {/* dB Scale Markings (Center Column) */}
              {VU_STEPS.map((step, i) => (
                <text
                  key={`scale-${i}`}
                  x="65"
                  y={step.y + 3}
                  fill={step.type === 'red' ? '#ef4444' : step.type === 'amber' ? '#f59e0b' : 'rgba(255,255,255,0.45)'}
                  fontSize="7"
                  fontWeight={step.label === '0' ? '800' : '700'}
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {step.label}
                </text>
              ))}

              {/* LED Bulbs: CH 1 (Left, cx=30) and CH 2 (Right, cx=100) */}
              {VU_STEPS.map((step, i) => {
                const isLitL = i < vuLevels.l || i === vuLevels.peakL - 1;
                const isLitR = i < vuLevels.r || i === vuLevels.peakR - 1;
                const glowFilter = step.type === 'red' ? 'url(#glowRed)' : step.type === 'amber' ? 'url(#glowAmber)' : 'url(#glowGreen)';

                return (
                  <g key={`led-row-${i}`}>
                    {/* ── Left Channel Diode (CH 1) ── */}
                    {/* Socket Bezel */}
                    <circle cx="30" cy={step.y} r="6.2" fill="#07080a" stroke="#1c1d22" strokeWidth="0.8" />
                    
                    {/* Ambient Glow Halo */}
                    {isLitL && (
                      <circle cx="30" cy={step.y} r="8.5" fill={getColorHex(step.type)} opacity="0.25" />
                    )}

                    {/* Lit or Unlit Bulb */}
                    <circle
                      cx="30"
                      cy={step.y}
                      r="4.8"
                      fill={isLitL ? getColorHex(step.type) : getUnlitHex(step.type)}
                      filter={isLitL ? glowFilter : undefined}
                      style={{ transition: 'fill 0.08s ease' }}
                    />
                    
                    {/* Specular Highlight / Lens Reflection */}
                    <circle
                      cx="28.5"
                      cy={step.y - 1.5}
                      r="1.3"
                      fill="#ffffff"
                      opacity={isLitL ? 0.85 : 0.12}
                    />

                    {/* ── Right Channel Diode (CH 2) ── */}
                    {/* Socket Bezel */}
                    <circle cx="100" cy={step.y} r="6.2" fill="#07080a" stroke="#1c1d22" strokeWidth="0.8" />
                    
                    {/* Ambient Glow Halo */}
                    {isLitR && (
                      <circle cx="100" cy={step.y} r="8.5" fill={getColorHex(step.type)} opacity="0.25" />
                    )}

                    {/* Lit or Unlit Bulb */}
                    <circle
                      cx="100"
                      cy={step.y}
                      r="4.8"
                      fill={isLitR ? getColorHex(step.type) : getUnlitHex(step.type)}
                      filter={isLitR ? glowFilter : undefined}
                      style={{ transition: 'fill 0.08s ease' }}
                    />
                    
                    {/* Specular Highlight / Lens Reflection */}
                    <circle
                      cx="98.5"
                      cy={step.y - 1.5}
                      r="1.3"
                      fill="#ffffff"
                      opacity={isLitR ? 0.85 : 0.12}
                    />
                  </g>
                );
              })}
            </g>

            {/* ── Tonearm Rest Clasp (Stationary at x=690, y=415) ── */}
            <g transform="translate(690, 415)">
              <rect x="-4" y="-8" width="8" height="24" rx="2" fill="#18181b" stroke="#3f3f46" strokeWidth="0.8" />
              {/* U-Clasp */}
              <path d="M -7,-8 L -7,-3 C -7,2 7,2 7,-3 L 7,-8" fill="none" stroke="url(#metalGrad)" strokeWidth="2.5" strokeLinecap="round" />
            </g>

            {/* ── Rotating Tonearm Assembly ──
                Pivot center: (690, 120)
                When paused / docked: rests at 0deg in the arm clasp at (690, 415).
                When playing: swings +54deg to the left deeply onto the vinyl record,
                positioning the stylus at (411.7, 322.2) squarely over the spinning vinyl record grooves.
            */}
            <g
              id="tonearm"
              style={{
                transformOrigin: '690px 120px',
                transform: `rotate(${tonearmAngle}deg)`,
                transition: `transform ${armTransitionDuration}s cubic-bezier(${armEasing})`
              }}
            >
              {/* Counterweight (extends up/back from pivot) */}
              <rect x="687" y="60" width="6" height="40" fill="url(#metalGrad)" />
              <rect x="674" y="65" width="32" height="28" rx="4" fill="url(#darkMetalGrad)" stroke="#52525b" strokeWidth="0.8" />
              <rect x="674" y="83" width="32" height="7" fill="url(#metalGrad)" />
              {/* Calibration tick on counterweight */}
              <line x1="690" y1="83" x2="690" y2="90" stroke="#09090b" strokeWidth="1.2" />

              {/* Gimbal / Pivot Housing Base */}
              <circle cx="690" cy="120" r="23" fill="url(#metalGrad)" stroke="#27272a" strokeWidth="2" />
              <circle cx="690" cy="120" r="15" fill="url(#darkMetalGrad)" />
              <circle cx="690" cy="120" r="7" fill="url(#metalGrad)" />

              {/* Tonearm S-Curve Tube (casts soft physical drop shadow onto the spinning vinyl) */}
              <g filter="url(#tonearmShadow)">
                <path
                  d="M 690,120 C 690,190 680,265 695,335 C 702,365 697,388 690,408"
                  fill="none"
                  stroke="url(#metalGrad)"
                  strokeWidth="5.5"
                  strokeLinecap="round"
                />
              </g>

              {/* Headshell Connector */}
              <rect x="685" y="407" width="10" height="4" rx="1" fill="#18181b" stroke="#3f3f46" strokeWidth="0.5" />

              {/* Headshell Body */}
              <polygon
                points="684,411 696,411 694,448 680,448"
                fill="#16171b"
                stroke="#3f3f46"
                strokeWidth="1"
                filter="url(#tonearmShadow)"
              />

              {/* Headshell Vent Slots */}
              <line x1="685" y1="420" x2="691" y2="420" stroke="#09090b" strokeWidth="1.5" />
              <line x1="684" y1="427" x2="690" y2="427" stroke="#09090b" strokeWidth="1.5" />

              {/* Finger-Lift Wire Lever */}
              <path
                d="M 695,422 C 706,422 709,416 708,412"
                fill="none"
                stroke="url(#metalGrad)"
                strokeWidth="2"
                strokeLinecap="round"
              />

              {/* Cartridge */}
              <rect x="682" y="448" width="10" height="12" rx="1.5" fill="#0d0e12" stroke="#222" />
              
              {/* Cartridge Accent Stripe (Harmonizes with active theme) */}
              <rect x="683" y="454" width="8" height="2.5" rx="0.5" fill="var(--accent-color)" />

              {/* Diamond Stylus Needle Tip */}
              <polygon points="686,460 688,460 687,464" fill="#ffffff" />
            </g>

            {/* ── Vintage Hi-Fi Backlit Dark Blue LCD Screen with Natural Brushed Aluminum Bezel ── */}
            <g id="turntableLcdDisplay">
              {/* Milled Recessed Pocket in Deck Plate */}
              <rect
                x="588"
                y="464"
                width="364"
                height="64"
                rx="5"
                fill="url(#lcdPocketGrad)"
                stroke="#040508"
                strokeWidth="0.8"
              />

              {/* Precision Machined Brushed Aluminum Faceplate Bezel */}
              <rect
                x="590"
                y="466"
                width="360"
                height="60"
                rx="4"
                fill="url(#lcdBrushedMetalGrad)"
                stroke="url(#lcdBevelStrokeGrad)"
                strokeWidth="1"
                filter="url(#lcdFrameShadow)"
              />

              {/* Brushed Aluminum Horizontal Grain Accent Lines */}
              <line x1="591" y1="470" x2="949" y2="470" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="0.7" />
              <line x1="591" y1="522" x2="949" y2="522" stroke="rgba(0, 0, 0, 0.22)" strokeWidth="0.7" />

              {/* Inner Recessed Dark Chamfer / Milled Socket */}
              <rect
                x="596"
                y="472"
                width="348"
                height="48"
                rx="3"
                fill="url(#lcdChamferGrad)"
                stroke="rgba(0, 0, 0, 0.95)"
                strokeWidth="0.8"
              />

              {/* Neoprene Display Gasket */}
              <rect
                x="598"
                y="474"
                width="344"
                height="44"
                rx="2.5"
                fill="#020408"
              />

              {/* Dark Cobalt Blue Backlit LCD Glass */}
              <rect
                x="599"
                y="475"
                width="342"
                height="42"
                rx="2"
                fill="url(#lcdGlassGrad)"
                stroke="rgba(37, 99, 235, 0.35)"
                strokeWidth="0.8"
              />

              {/* Authentic LCD Micro-Scanlines */}
              <rect
                x="599"
                y="475"
                width="342"
                height="42"
                rx="2"
                fill="url(#lcdScanlines)"
                pointerEvents="none"
              />

              {/* Specular Diagonal Reflection Sheen */}
              <path
                d="M 600,476 L 705,476 L 665,516 L 600,516 Z"
                fill="rgba(255, 255, 255, 0.04)"
                pointerEvents="none"
              />

              {/* Digital Text Display (100% Vector Scaled via foreignObject) */}
              <foreignObject x="600" y="475" width="340" height="42">
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  ref={lcdContainerRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isMarquee ? 'flex-start' : 'center',
                    overflow: 'hidden',
                    padding: '0 10px',
                    boxSizing: 'border-box',
                    maskImage: isMarquee ? 'linear-gradient(90deg, transparent 0%, #000 4%, #000 96%, transparent 100%)' : 'none',
                    WebkitMaskImage: isMarquee ? 'linear-gradient(90deg, transparent 0%, #000 4%, #000 96%, transparent 100%)' : 'none',
                    pointerEvents: 'none'
                  }}
                >
                  {isMarquee ? (
                    <div
                      className="nadanada-lcd-marquee-content"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        whiteSpace: 'nowrap',
                        animation: `nadanada-lcd-marquee ${marqueeDuration}s linear infinite`,
                        willChange: 'transform'
                      }}
                    >
                      <span style={lcdTextStyle}>{displayTitle}</span>
                      <span style={{ ...lcdTextStyle, margin: '0 28px', opacity: 0.45 }}>•••</span>
                      <span style={lcdTextStyle}>{displayTitle}</span>
                      <span style={{ ...lcdTextStyle, margin: '0 28px', opacity: 0.45 }}>•••</span>
                    </div>
                  ) : (
                    <div
                      style={{
                        ...lcdTextStyle,
                        width: '100%',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {displayTitle}
                    </div>
                  )}
                </div>
              </foreignObject>
            </g>
          </svg>
        </div>

        {/* ── Subtext Badge (e.g. Playing Offline / Fallback) ── */}
        {subtext && (
          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: '12px',
              padding: '3px 12px',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: '0.72rem',
              letterSpacing: '0.5px',
              pointerEvents: 'none',
              zIndex: 10
            }}
          >
            {subtext}
          </div>
        )}
      </div>
    </div>
  );
}
