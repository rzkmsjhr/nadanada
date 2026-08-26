import { useState, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize } from '@tauri-apps/api/dpi';

export function useSystemIntegration(appWindow, setShowClosePrompt) {
  const [theme, setTheme] = useState(() => localStorage.getItem('nadanada-theme') || 'nox-noir');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isVideoHidden, setIsVideoHidden] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isMiniPlayer, setIsMiniPlayer] = useState(false);
  const isMaximizedRef = useRef(false);
  const prevSizeRef = useRef(null);

  useEffect(() => {
    // Sync initial maximized state (no animation needed on load)
    appWindow.isMaximized().then(v => {
      isMaximizedRef.current = v;
      setIsMaximized(v);
    }).catch(() => {});
    let debounceTimer = null;
    let showTimer = null;
    const unlisten = appWindow.onResized(async () => {
      // Debounce: onResized fires repeatedly during the Windows maximize/restore
      // animation. Wait until resize events stop before acting so we never
      // switch the layout mid-animation.
      clearTimeout(debounceTimer);
      clearTimeout(showTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const maximized = await appWindow.isMaximized();
          if (maximized === isMaximizedRef.current) return; // not a maximize change

          // Step 1 — hide video now (synchronous state update)
          setIsVideoHidden(true);

          // Step 2 — wait two animation frames so the hide actually paints
          // before we touch the layout (double-rAF = guaranteed post-paint)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              isMaximizedRef.current = maximized;
              setIsMaximized(maximized);

              // Step 3 — reveal video after the new layout has settled
              showTimer = setTimeout(() => setIsVideoHidden(false), 250);
            });
          });
        } catch {}
      }, 150); // 150ms debounce — longer than Windows Aero animation (~100ms)
    });
    return () => {
      unlisten.then(f => f()).catch(() => {});
      clearTimeout(debounceTimer);
      clearTimeout(showTimer);
    };
  }, [appWindow]);

  useEffect(() => {
    // Debounce the online event by 1.5s to let the network stack fully stabilise
    // before reloading, and show a visual indicator so the reload doesn't feel
    // like a crash.
    let reconnectTimer = null;
    const handleOnline = () => {
      setIsReconnecting(true);
      reconnectTimer = setTimeout(() => {
        window.location.reload();
      }, 1500);
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nadanada-theme', theme);
  }, [theme]);

  useEffect(() => {
    const unlisten = listen('close-requested', () => {
      setShowClosePrompt(true);
    });
    return () => {
      unlisten.then(f => f());
    };
  }, [setShowClosePrompt]);

  const toggleTheme = () => {
    const themes = ['lavender-steel', 'mahogany-dusk', 'tidal-sage', 'sangria-deep', 'midnight-static', 'obsidian-root', 'nox-noir', 'crimson-night'];
    const currentThemeIndex = themes.indexOf(theme);
    const nextIndex = (currentThemeIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const toggleMiniPlayer = async () => {
    if (isMiniPlayer) {
      setIsMiniPlayer(false);
      appWindow.setAlwaysOnTop(false);
      await appWindow.setMinSize(new LogicalSize(320, 568));
      if (prevSizeRef.current) {
        await appWindow.setSize(prevSizeRef.current);
      }
    } else {
      setIsMiniPlayer(true);
      const currentSize = await appWindow.outerSize();
      prevSizeRef.current = currentSize;
      
      appWindow.setAlwaysOnTop(true);
      if (await appWindow.isMaximized()) {
        await appWindow.unmaximize();
      }
      await appWindow.setMinSize(new LogicalSize(320, 180));
      await appWindow.setSize(new LogicalSize(320, 180));
    }
  };

  return {
    theme, toggleTheme,
    isMaximized,
    isVideoHidden,
    isReconnecting,
    isMiniPlayer,
    toggleMiniPlayer
  };
}
