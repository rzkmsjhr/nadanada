import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize, PhysicalSize } from '@tauri-apps/api/dpi';

export function useSystemIntegration(appWindow, setShowClosePrompt) {
  const [theme, setTheme] = useState(() => localStorage.getItem('nadanada-theme') || 'nox-noir');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isVideoHidden, setIsVideoHidden] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isMiniPlayer, setIsMiniPlayer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isMiniPlayerRef = useRef(false);
  const isFullscreenRef = useRef(false);
  const isMaximizedRef = useRef(false);
  const prevSizeRef = useRef(null);

  // Sync refs with state
  useEffect(() => {
    isMiniPlayerRef.current = isMiniPlayer;
  }, [isMiniPlayer]);

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

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
          if (maximized !== isMaximizedRef.current) {
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
          } else if (!maximized && !isFullscreenRef.current) {
            // Persist resized window dimensions (excluding maximized and fullscreen)
            try {
              const currentSize = await appWindow.innerSize();
              const scale = await appWindow.scaleFactor();
              const logical = currentSize.toLogical(scale);
              const roundedWidth = Math.round(logical.width);
              const roundedHeight = Math.round(logical.height);

              if (isMiniPlayerRef.current) {
                if (roundedWidth >= 320 && roundedHeight >= 180) {
                  localStorage.setItem('nadanada-mini-player-size', JSON.stringify({
                    width: roundedWidth,
                    height: roundedHeight
                  }));
                }
              } else {
                if (roundedWidth >= 375 && roundedHeight >= 580) {
                  localStorage.setItem('nadanada-default-window-size', JSON.stringify({
                    width: roundedWidth,
                    height: roundedHeight
                  }));
                }
              }
            } catch {}
          }
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
    const unlisten = listen('close-requested', async () => {
      if (isMiniPlayerRef.current) {
        setIsMiniPlayer(false);
        try {
          let defWidth = 375;
          let defHeight = 580;
          try {
            const s = localStorage.getItem('nadanada-default-window-size');
            if (s) {
              const parsed = JSON.parse(s);
              if (parsed.width && parsed.height) {
                defWidth = parsed.width;
                defHeight = parsed.height;
              }
            }
          } catch {}

          if (prevSizeRef.current) {
            await invoke('force_resize_window', { 
              width: prevSizeRef.current.width || defWidth, 
              height: prevSizeRef.current.height || defHeight, 
              minWidth: 375, 
              minHeight: 580,
              alwaysOnTop: false
            });
            if (prevSizeRef.current.wasMaximized) {
              await appWindow.maximize();
            }
          } else {
            await invoke('force_resize_window', { width: defWidth, height: defHeight, minWidth: 375, minHeight: 580, alwaysOnTop: false });
          }
        } catch (err) {
          console.error("Failed to restore window on close:", err);
        }
      }
      setShowClosePrompt(true);
    });
    return () => {
      unlisten.then(f => f());
    };
  }, [setShowClosePrompt, appWindow]);

  const toggleTheme = () => {
    const themes = ['lavender-steel', 'mahogany-dusk', 'tidal-sage', 'sangria-deep', 'midnight-static', 'obsidian-root', 'nox-noir', 'crimson-night'];
    const currentThemeIndex = themes.indexOf(theme);
    const nextIndex = (currentThemeIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const wasMaximizedBeforeFullscreenRef = useRef(false);

  const toggleFullscreen = async (forceValue) => {
    const nextVal = typeof forceValue === 'boolean' ? forceValue : !isFullscreen;
    setIsFullscreen(nextVal);
    try {
      if (nextVal) {
        const max = await appWindow.isMaximized();
        wasMaximizedBeforeFullscreenRef.current = max;
        if (max) {
          await appWindow.unmaximize();
        }
        await appWindow.setFullscreen(true);
      } else {
        await appWindow.setFullscreen(false);
        if (wasMaximizedBeforeFullscreenRef.current) {
          await appWindow.maximize();
        }
      }
    } catch (err) {
      console.warn("Native fullscreen toggle failed, using in-app fullscreen layout:", err);
    }
  };

  const toggleMiniPlayer = async () => {
    if (isFullscreen) {
      await toggleFullscreen(false);
    }
    if (isMiniPlayer) {
      setIsMiniPlayer(false);
      try {
        let defWidth = 375;
        let defHeight = 580;
        try {
          const s = localStorage.getItem('nadanada-default-window-size');
          if (s) {
            const parsed = JSON.parse(s);
            if (parsed.width && parsed.height) {
              defWidth = parsed.width;
              defHeight = parsed.height;
            }
          }
        } catch {}

        if (prevSizeRef.current) {
          await invoke('force_resize_window', { 
            width: prevSizeRef.current.width || defWidth, 
            height: prevSizeRef.current.height || defHeight, 
            minWidth: 375, 
            minHeight: 580,
            alwaysOnTop: false
          });
          if (prevSizeRef.current.wasMaximized) {
            await appWindow.maximize();
          }
        } else {
          await invoke('force_resize_window', { width: defWidth, height: defHeight, minWidth: 375, minHeight: 580, alwaysOnTop: false });
        }
      } catch (err) {
        console.error("Failed to restore window:", err);
      }
    } else {
      setIsMiniPlayer(true);
      const isMax = await appWindow.isMaximized();
      const currentSize = await appWindow.innerSize();
      const scale = await appWindow.scaleFactor();
      const logicalSize = currentSize.toLogical(scale);
      prevSizeRef.current = {
        width: logicalSize.width,
        height: logicalSize.height,
        wasMaximized: isMax
      };
      
      if (isMax) {
        await appWindow.unmaximize();
      }

      // Check for user-customized mini player size
      let miniWidth = 320;
      let miniHeight = 180;
      try {
        const s = localStorage.getItem('nadanada-mini-player-size');
        if (s) {
          const parsed = JSON.parse(s);
          if (parsed.width && parsed.height) {
            miniWidth = parsed.width;
            miniHeight = parsed.height;
          }
        }
      } catch {}

      try {
        await invoke('force_resize_window', { width: miniWidth, height: miniHeight, minWidth: 320, minHeight: 180, alwaysOnTop: true });
      } catch (err) {
        console.error("Failed to resize window:", err);
      }
    }
  };

  return {
    theme, setTheme, toggleTheme,
    isMaximized,
    isVideoHidden,
    isReconnecting,
    isMiniPlayer,
    toggleMiniPlayer,
    isFullscreen,
    setIsFullscreen,
    toggleFullscreen
  };
}
