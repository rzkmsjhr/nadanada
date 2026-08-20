import React, { useRef, useEffect, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * ProxyYouTube — drop-in replacement for react-youtube that routes the YouTube
 * iframe through a local HTTP proxy server.  This avoids macOS WebKit stripping
 * Referer headers on the custom tauri:// protocol, which causes YouTube Error 153.
 *
 * The component mirrors the react-youtube API surface so Player.jsx needs minimal changes:
 *   <ProxyYouTube videoId={id} opts={opts} onReady={fn} onStateChange={fn} onError={fn} />
 */
const ProxyYouTube = ({ videoId, opts, onReady, onStateChange, onError, style, iframeClassName }) => {
  const iframeRef = useRef(null);
  const [port, setPort] = useState(null);
  const latestTime = useRef(0);
  const latestDuration = useRef(0);

  const [initialVideoId] = useState(videoId);

  // Fetch the embed server port once on mount
  useEffect(() => {
    invoke('get_embed_port').then(p => setPort(p)).catch(() => {});
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

  // When videoId changes after mount, don't reload the iframe; just call loadVideoById
  useEffect(() => {
    if (videoId && videoId !== initialVideoId) {
      playerProxy.current.loadVideoById(videoId, startSecs);
    }
  }, [videoId, initialVideoId, startSecs]);

  if (!port || !videoId) return null;

  const src = `http://127.0.0.1.nip.io:${port}/embed?v=${initialVideoId}&start=${startSecs}&volume=100`;

  return (
    <iframe
      ref={iframeRef}
      src={src}
      className={iframeClassName}
      style={{ ...style, width: '100%', height: '100%', border: 'none' }}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  );
};

export default ProxyYouTube;
