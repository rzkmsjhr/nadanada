import { useEffect, useRef } from 'react';

export function useKeyboardShortcuts({
  playerRef,
  handleNext,
  handlePrevious,
  handleToggleSearch
}) {
  // Stable refs for next/prev/toggle so the keyboard handler never becomes stale
  const handleNextRef = useRef(handleNext);
  const handlePreviousRef = useRef(handlePrevious);
  const handleToggleSearchRef = useRef(handleToggleSearch);

  // Keep refs current
  handleNextRef.current = handleNext;
  handlePreviousRef.current = handlePrevious;
  handleToggleSearchRef.current = handleToggleSearch;

  useEffect(() => {
    const handleKeyDown = e => {
      // Don't fire shortcuts while the user is typing
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      
      switch (e.key) {
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
        case 'f':
        case 'F':
          e.preventDefault();
          // Toggle search view
          handleToggleSearchRef.current?.();
          break;
        default:
          break;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [playerRef]); // Registered once — relies on refs for always-current functions
}
