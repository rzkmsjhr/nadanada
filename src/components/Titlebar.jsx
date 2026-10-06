import React from 'react';
import { Music2, Minus, Square, X, PictureInPicture2 } from 'lucide-react';

const Titlebar = ({ appWindow, onToggleMiniPlayer, isMiniPlayer }) => {
  const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

  const handleMouseDown = (e) => {
    if (
      e.button === 0 &&
      !e.target.closest('.titlebar-button') && 
      !e.target.closest('.mac-btn')
    ) {
      appWindow.startDragging().catch(() => {});
    }
  };

  return (
    <div className={`titlebar ${isMac ? 'mac' : ''}`} data-tauri-drag-region onMouseDown={handleMouseDown}>
      {isMac ? (
        <>
          <div className="titlebar-buttons mac">
            <div className="mac-btn close" onClick={() => appWindow.close()} />
            <div className="mac-btn minimize" onClick={() => appWindow.minimize()} />
            <div className="mac-btn maximize" onClick={() => appWindow.toggleMaximize()} />
          </div>
          <div className="titlebar-center">
            <Music2 size={14} /> NadaNada
          </div>
          <div className="titlebar-buttons mac-right">
            <div 
              className="titlebar-button mac-mini-btn" 
              onClick={() => onToggleMiniPlayer?.()} 
              title={isMiniPlayer ? "Exit Mini Player" : "Mini Player"}
            >
              <PictureInPicture2 size={14} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="titlebar-logo">
            <Music2 size={14} /> NadaNada
          </div>
          <div className="titlebar-buttons">
            <div className="titlebar-button" onClick={() => appWindow.minimize()}>
              <Minus size={14} />
            </div>
            <div className="titlebar-button" onClick={() => onToggleMiniPlayer?.()} title={isMiniPlayer ? "Exit Mini Player" : "Mini Player"}>
              <PictureInPicture2 size={14} />
            </div>
            <div className="titlebar-button" onClick={() => appWindow.toggleMaximize()}>
              <Square size={12} />
            </div>
            <div className="titlebar-button close" onClick={() => appWindow.close()}>
              <X size={14} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Titlebar;
