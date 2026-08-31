import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { api } from '../services/api';

const WORKER_EMBED_URL = 'https://nadanada-yt.kdmp.workers.dev';

const ProxyYouTube = ({ videoId, opts, onReady, onStateChange, onError, onCaptionsReceived, style, iframeClassName }) => {
  const iframeRef = useRef(null);
  const latestTime = useRef(0);
  const latestDuration = useRef(0);

  const playerVars = opts?.playerVars || {};
  const startSecs = playerVars.start || 0;

  const [initialVideoId] = useState(videoId);
  const [initialStartSecs] = useState(startSecs);

  // Local embed server port — cached in memory for instantaneous 0ms startup
  const [localPort, setLocalPort] = useState(() => (api.getCachedEmbedPort ? api.getCachedEmbedPort() : null));
  useEffect(() => {
    if (!localPort) {
      api.getEmbedPort().then(p => {
        if (p) setLocalPort(p);
      }).catch(() => {});
    }
  }, [localPort]);

  // Build fake "player" object that mirrors the YT.Player API surface
  const sendCommand = useCallback((command, extra) => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ command, ...extra }, '*');
    }
  }, []);

  const playerProxy = useRef({
    playVideo: () => sendCommand('play'),
    pauseVideo: () => sendCommand('pause'),
    stopVideo: () => sendCommand('stop'),
    seekTo: (seconds) => sendCommand('seekTo', { value: seconds }),
    setVolume: (vol) => sendCommand('setVolume', { value: vol }),
    mute: () => sendCommand('mute'),
    unMute: () => sendCommand('unmute'),
    loadVideoById: (id, start) => sendCommand('loadVideoById', { videoId: id, startSeconds: start }),
    setCaption: (lang) => sendCommand('setCaption', { value: lang }),
    getCurrentTime: () => latestTime.current,
    getDuration: () => latestDuration.current,
  });

  useEffect(() => {
    playerProxy.current.playVideo = () => sendCommand('play');
    playerProxy.current.pauseVideo = () => sendCommand('pause');
    playerProxy.current.stopVideo = () => sendCommand('stop');
    playerProxy.current.seekTo = (seconds) => sendCommand('seekTo', { value: seconds });
    playerProxy.current.setVolume = (vol) => sendCommand('setVolume', { value: vol });
    playerProxy.current.mute = () => sendCommand('mute');
    playerProxy.current.unMute = () => sendCommand('unmute');
    playerProxy.current.loadVideoById = (id, start) => sendCommand('loadVideoById', { videoId: id, startSeconds: start });
    playerProxy.current.setCaption = (lang) => sendCommand('setCaption', { value: lang });
  }, [sendCommand]);

  // Listen for postMessage events from the iframe
  useEffect(() => {
    const handler = (event) => {
      if (iframeRef.current && iframeRef.current.contentWindow && event.source !== iframeRef.current.contentWindow) {
        return;
      }
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
        case 'yt-proxy-captions':
          if (onCaptionsReceived) onCaptionsReceived(msg.data);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onReady, onStateChange, onError, onCaptionsReceived]);

  const currentLoadedVideoId = useRef(initialVideoId);
  const currentLoadedStart = useRef(startSecs);

  useEffect(() => {
    if (videoId && (videoId !== currentLoadedVideoId.current || startSecs !== currentLoadedStart.current)) {
      playerProxy.current.loadVideoById(videoId, startSecs);
      currentLoadedVideoId.current = videoId;
      currentLoadedStart.current = startSecs;
    }
  }, [videoId, startSecs]);

  const [useFallback, setUseFallback] = useState(false);
  const isMacOS = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent || navigator.platform);

  const activeSrc = useMemo(() => {
    if (!initialVideoId) return null;
    // On macOS / WebKit: ALWAYS use Cloudflare Worker HTTPS to prevent ATS / mixed-content blocks
    if (isMacOS) {
      return `${WORKER_EMBED_URL}/embed?v=${initialVideoId}&start=${initialStartSecs}&volume=100`;
    }
    const port = localPort || (api.getCachedEmbedPort ? api.getCachedEmbedPort() : null);
    if (port && !useFallback) {
      return `http://127.0.0.1.nip.io:${port}/embed?v=${initialVideoId}&start=${initialStartSecs}&volume=100`;
    }
    return `${WORKER_EMBED_URL}/embed?v=${initialVideoId}&start=${initialStartSecs}&volume=100`;
  }, [localPort, initialVideoId, initialStartSecs, useFallback, isMacOS]);

  const handleIframeError = useCallback(() => {
    if (!useFallback) {
      console.warn('Local embed failed to load, falling back to Cloudflare Worker');
      setUseFallback(true);
    }
  }, [useFallback]);

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
