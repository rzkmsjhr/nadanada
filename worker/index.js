/**
 * NadaNada YouTube Embed Proxy — Cloudflare Worker
 *
 * Serves the YouTube IFrame API wrapper page over HTTPS on a real public domain.
 * This solves two conflicting requirements:
 *   1. YouTube rejects localhost/127.0.0.1 as embed origin for licensed music
 *   2. macOS WebKit blocks http:// iframes (nip.io) as mixed content inside tauri://
 *
 * The Worker URL (https://nadanada-yt.kdmp.workers.dev/embed) satisfies both:
 *   - YouTube sees a valid HTTPS public FQDN ✓
 *   - WebKit sees HTTPS → no mixed content ✓
 *
 * Deploy: cd worker && npx wrangler deploy
 */

const EMBED_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body, html { width: 100%; height: 100%; overflow: hidden; background: #000; }
  #player { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="player"></div>
<script>
  var params = new URLSearchParams(window.location.search);
  var videoId = params.get('v');
  var startSeconds = parseInt(params.get('start') || '0', 10);
  var initialVolume = parseInt(params.get('volume') || '100', 10);

  // Load YouTube IFrame API
  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  var firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

  var player;
  var timeInterval;
  var userRequestedCaption = false;

  function forceDisableCaptions() {
    if (userRequestedCaption) return;
    try {
      if (player && typeof player.unloadModule === 'function') {
        player.unloadModule('captions');
        player.unloadModule('cc');
      }
    } catch(err) {}
    try {
      if (player && typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
      }
    } catch(err) {}
  }

  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      videoId: videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        cc_load_policy: 0,
        iv_load_policy: 3,
        start: startSeconds > 0 ? startSeconds : undefined,
        origin: window.location.origin
      },
      events: {
        onReady: function(e) {
          e.target.setVolume(initialVolume);
          forceDisableCaptions();
          window.parent.postMessage({ type: 'yt-proxy-ready' }, '*');
          // Start periodic time updates
          timeInterval = setInterval(function() {
            if (player && typeof player.getCurrentTime === 'function') {
              try {
                window.parent.postMessage({
                  type: 'yt-proxy-time',
                  currentTime: player.getCurrentTime(),
                  duration: player.getDuration()
                }, '*');
              } catch(err) {}
            }
          }, 100);
        },
        onApiChange: function(e) {
          if (!userRequestedCaption) {
            forceDisableCaptions();
          }
          try {
            var tList = player.getOption('captions', 'tracklist');
            if (tList && tList.length > 0) window.parent.postMessage({ type: 'yt-proxy-captions', data: tList }, '*');
          } catch(err){}
        },
        onStateChange: function(e) {
          window.parent.postMessage({ type: 'yt-proxy-state', data: e.data }, '*');
          if (!userRequestedCaption) {
            forceDisableCaptions();
          }
          if (e.data === 1) {
            try { player.setPlaybackQuality('hd1080'); } catch(err) {}
            try {
              var tracks = player.getOption('captions', 'tracklist');
              if (tracks && tracks.length > 0) {
                window.parent.postMessage({ type: 'yt-proxy-captions', data: tracks }, '*');
              }
            } catch(err) {}
          }
        },
        onError: function(e) {
          window.parent.postMessage({ type: 'yt-proxy-error', data: e.data }, '*');
        }
      }
    });
  }

  // Listen for commands from the parent app
  window.addEventListener('message', function(event) {
    if (!player) return;
    var msg = event.data;
    if (!msg || !msg.command) return;
    try {
      switch(msg.command) {
        case 'play': player.playVideo(); break;
        case 'pause': player.pauseVideo(); break;
        case 'stop': player.stopVideo(); break;
        case 'seekTo': player.seekTo(msg.value, true); break;
        case 'setVolume': player.setVolume(msg.value); break;
        case 'mute': player.mute(); break;
        case 'unmute': player.unMute(); break;
        case 'loadVideoById':
          userRequestedCaption = false;
          window.captionsEmitted = false;
          player.loadVideoById({videoId: msg.videoId, startSeconds: msg.startSeconds || 0, suggestedQuality: 'hd1080'});
          forceDisableCaptions();
          break;
        case 'setCaption':
          if (msg.value) {
            userRequestedCaption = true;
            try { if (player.loadModule) player.loadModule('captions'); } catch(e) {}
            player.setOption('captions', 'track', {languageCode: msg.value});
          } else {
            userRequestedCaption = false;
            forceDisableCaptions();
          }
          break;
      }
    } catch(err) {}
  });
</script>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (url.pathname === '/embed' || url.pathname.startsWith('/embed?') || url.pathname === '/embed/') {
      return new Response(EMBED_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // Health check
    if (url.pathname === '/') {
      return new Response('nadanada-yt embed proxy is running', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
