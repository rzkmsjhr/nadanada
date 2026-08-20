import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * ProxyYouTube — drop-in replacement for react-youtube that routes the YouTube
 * iframe through a Cloudflare Worker (HTTPS) to satisfy both:
 *   1. YouTube's embed origin validation (needs a real public FQDN, rejects localhost)
 *   2. macOS WebKit mixed-content rules (blocks http:// iframes inside tauri://)
 *
 * Falls back to the local embed server (http://127.0.0.1.nip.io) if the Worker
 * is unreachable (e.g. no internet during initial load — though YouTube itself
 * also needs internet, so this is mainly a development convenience).
 *
 * The component mirrors the react-youtube API surface so Player.jsx needs minimal changes:
 *   <ProxyYouTube videoId={id} opts={opts} onReady={fn} onStateChange={fn} onError={fn} />
 */

const WORKER_EMBED_URL = 'https://nadanada-yt.kdmp.workers.dev';

const ProxyYouTube = ({ videoId, opts, onReady, onStateChange, onError, style, iframeClassName }) => {
  const iframeRef = useRef(null);
  const latestTime = useRef(0);
  const latestDuration = useRef(0);

  const [initialVideoId] = useState(videoId);

  // Local embed server port — kept as fallback
  const [localPort, setLocalPort] = useState(null);
  useEffect(() => {
    invoke('get_embed_port').then(p => setLocalPort(p)).catch(() => {});
  }, []);

  // Build a fake "player" object that mirrors the YT.Player API surface
  // by sending postMessage commands to the iframe and returning cached values.
  const sendCommand = useCallback((command, extra) => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ command, ...extra }, '*');
    }
  }, []);

  const playerProxy = useRef({
    playVideo: () => sendCommand('play'),
    pauseVideo: () => sendCommand('pause'),
    stopVideo: () => sendCommand('stop'),
    seekTo: (seconds, allowSeekAhead) => sendCommand('seekTo', { value: seconds }),
    setVolume: (vol) => sendCommand('setVolume', { value: vol }),
    mute: () => sendCommand('mute'),
    unMute: () => sendCommand('unmute'),
    loadVideoById: (id, startSecs) => sendCommand('loadVideoById', { videoId: id, startSeconds: startSecs }),
    // Synchronous getters return cached values updated via postMessage
    getCurrentTime: () => latestTime.current,
    getDuration: () => latestDuration.current,
  });

  // Keep the sendCommand reference current
  useEffect(() => {
    playerProxy.current.playVideo = () => sendCommand('play');
    playerProxy.current.pauseVideo = () => sendCommand('pause');
    playerProxy.current.stopVideo = () => sendCommand('stop');
    playerProxy.current.seekTo = (seconds) => sendCommand('seekTo', { value: seconds });
    playerProxy.current.setVolume = (vol) => sendCommand('setVolume', { value: vol });
    playerProxy.current.mute = () => sendCommand('mute');
    playerProxy.current.unMute = () => sendCommand('unmute');
    playerProxy.current.loadVideoById = (id, startSecs) => sendCommand('loadVideoById', { videoId: id, startSeconds: startSecs });
  }, [sendCommand]);

  // Listen for postMessage events from the iframe
  useEffect(() => {
    const handler = (event) => {
      const msg = event.data;
      if (!msg || !msg.type || !msg.type.startsWith('yt-proxy-')) return;

      switch (msg.type) {
        case 'yt-proxy-ready':
          if (onReady) onReady({ target: playerProxy.current });
          break;
        case 'yt-proxy-state':
          if (onStateChange) onStateChange({ data: msg.data, target: playerProxy.current });
          break;
        case 'yt-proxy-error':
          if (onError) onError({ data: msg.data, target: playerProxy.current });
          break;
        case 'yt-proxy-time':
          latestTime.current = msg.currentTime || 0;
          latestDuration.current = msg.duration || 0;
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onReady, onStateChange, onError]);

  const playerVars = opts?.playerVars || {};
  const startSecs = playerVars.start || 0;

  const currentLoadedVideoId = useRef(initialVideoId);
  const currentLoadedStart = useRef(startSecs);

  // When videoId or startSecs changes, call loadVideoById
  useEffect(() => {
    if (videoId && (videoId !== currentLoadedVideoId.current || startSecs !== currentLoadedStart.current)) {
      playerProxy.current.loadVideoById(videoId, startSecs);
      currentLoadedVideoId.current = videoId;
      currentLoadedStart.current = startSecs;
    }
  }, [videoId, startSecs]);

  const [initialStartSecs] = useState(startSecs);

  // Primary: Cloudflare Worker (HTTPS, works on all platforms including macOS)
  // Fallback: Local embed server via nip.io (works on Windows, blocked on macOS)
  const initialSrc = useMemo(() => {
    if (!initialVideoId) return null;
    return `${WORKER_EMBED_URL}/embed?v=${initialVideoId}&start=${initialStartSecs}&volume=100`;
  }, [initialVideoId, initialStartSecs]);

  // Fallback URL using local embed server (kept for resilience)
  const fallbackSrc = useMemo(() => {
    if (!localPort || !initialVideoId) return null;
    return `http://127.0.0.1.nip.io:${localPort}/embed?v=${initialVideoId}&start=${initialStartSecs}&volume=100`;
  }, [localPort, initialVideoId, initialStartSecs]);

  // If the Worker iframe fails to load (e.g. network error on the iframe itself),
  // swap to the local fallback. This handles the case where the Worker is down
  // but the user still has general internet (so YouTube itself would work via nip.io).
  const [useFallback, setUseFallback] = useState(false);
  const handleIframeError = useCallback(() => {
    if (!useFallback && fallbackSrc) {
      console.warn('Worker embed failed to load, falling back to local server');
      setUseFallback(true);
    }
  }, [useFallback, fallbackSrc]);

  const activeSrc = useFallback ? fallbackSrc : initialSrc;

  if (!videoId || !activeSrc) return null;

  return (
    <iframe
      ref={iframeRef}
      src={activeSrc}
      className={iframeClassName}
      style={{ ...style, width: '100%', height: '100%', border: 'none' }}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-popups"
      onError={handleIframeError}
    />
  );
};

export default ProxyYouTube;
