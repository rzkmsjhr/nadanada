import { useEffect, useRef } from 'react';

export function useKeyboardShortcuts({
  playerRef,
  handleNext,
  handlePrevious,
  handleToggleSearch,
  isFullscreen,
  toggleFullscreen
}) {
  // Stable refs for next/prev/toggle so the keyboard handler never becomes stale
  const handleNextRef = useRef(handleNext);
  const handlePreviousRef = useRef(handlePrevious);
  const handleToggleSearchRef = useRef(handleToggleSearch);
  const isFullscreenRef = useRef(isFullscreen);
  const toggleFullscreenRef = useRef(toggleFullscreen);

  // Keep refs current
  handleNextRef.current = handleNext;
  handlePreviousRef.current = handlePrevious;
  handleToggleSearchRef.current = handleToggleSearch;
  isFullscreenRef.current = isFullscreen;
  toggleFullscreenRef.current = toggleFullscreen;

  useEffect(() => {
    const handleKeyDown = e => {
      // Prevent standalone function keys (F1-F12, especially F5 reload) from triggering default actions,
      // but allow combination keys like Ctrl+F5, Ctrl+R, Ctrl+Shift+R, etc.
      if (/^F\d+$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
      }

      // Don't fire shortcuts while the user is typing
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      
      switch (e.key) {
        case 'Escape':
          if (isFullscreenRef.current) {
            e.preventDefault();
            toggleFullscreenRef.current?.(false);
          }
          break;
        case ' ':
          e.preventDefault();
          playerRef.current?.togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleNextRef.current?.();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePreviousRef.current?.();
          break;
        case 'm':
        case 'M':
          playerRef.current?.toggleMute();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          handleToggleSearchRef.current?.();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreenRef.current?.();
          break;
        default:
          break;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [playerRef]); // Registered once — relies on refs for always-current functions
}
