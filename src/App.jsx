import React, { useState, useEffect } from 'react';
import Player from './components/Player';
import Search from './components/Search';
import Playlist from './components/Playlist';
import { Music2, Sun, Moon, Search as SearchIcon, X, Minus, Square, Infinity, Disc } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import './App.css';

function App() {
  const appWindow = getCurrentWindow();
  const [theme, setTheme] = useState('dark');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [isEndlessPlay, setIsEndlessPlay] = useState(false);
  const [isFetchingEndless, setIsFetchingEndless] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const unlisten = listen('close-requested', () => {
      setShowClosePrompt(true);
    });
    
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const [audioSpectrum, setAudioSpectrum] = useState(new Array(24).fill(0));

  useEffect(() => {
    let interval;
    if (isAudioPlaying) {
      interval = setInterval(async () => {
        try {
          const spectrum = await invoke('get_audio_spectrum');
          setAudioSpectrum(spectrum);
        } catch (e) {}
      }, 50);
    } else {
      setAudioSpectrum(new Array(24).fill(0));
    }
    return () => clearInterval(interval);
  }, [isAudioPlaying]);

  const toggleTheme = () => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  };

  const currentSong = playlist[currentIndex] || null;

  useEffect(() => {
    if (isEndlessPlay && playlist.length > 0 && currentIndex === playlist.length - 1 && !isFetchingEndless) {
      const fetchNext = async () => {
        setIsFetchingEndless(true);
        try {
          const current = playlist[currentIndex];
          
          const results = await invoke('get_youtube_mix', { videoId: current.id });
          
          const existingIds = new Set(playlist.map(s => s.id));
          
          const available = results.filter(v => !existingIds.has(v.id));
          
          if (available.length > 0) {
            const picked = available[0];
            
            const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            setPlaylist(prev => [...prev, { ...picked, queueId }]);
          }
        } catch (e) {
          console.error("Endless play fetch error:", e);
        } finally {
          setIsFetchingEndless(false);
        }
      };
      
      fetchNext();
    }
  }, [currentIndex, playlist.length, isEndlessPlay, isFetchingEndless]);

  const handleNext = () => {
    if (currentIndex < playlist.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleAddSong = (video) => {
    const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setPlaylist(prev => [...prev, { ...video, queueId }]);
  };

  const handleRemoveSong = (index) => {
    setPlaylist(prev => {
      const newPlaylist = [...prev];
      newPlaylist.splice(index, 1);
      return newPlaylist;
    });
    if (index < currentIndex) {
      setCurrentIndex(currentIndex - 1);
    } else if (index === currentIndex && currentIndex >= playlist.length - 1) {
      setCurrentIndex(Math.max(0, currentIndex - 1));
    }
  };

  const handleReorder = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    
    setPlaylist(prev => {
      const newPlaylist = [...prev];
      const [movedItem] = newPlaylist.splice(fromIndex, 1);
      newPlaylist.splice(toIndex, 0, movedItem);
      return newPlaylist;
    });

    if (currentIndex === fromIndex) {
      setCurrentIndex(toIndex);
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      setCurrentIndex(currentIndex - 1);
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      setCurrentIndex(currentIndex + 1);
    }
  };

const Visualizer = ({ isPlaying, spectrum }) => {
  return (
    <div className={`visualizer ${isPlaying ? 'playing' : ''}`}>
      {spectrum.map((val, i) => {
        const h = 4 + (val * 36);
        return <div key={i} className="bar" style={{ height: isPlaying ? `${h}px` : '4px' }}></div>;
      })}
    </div>
  );
};

const ResizeBorder = ({ cursor, direction, style, windowObj }) => (
  <div 
    style={{ position: 'absolute', zIndex: 9999, cursor, background: 'rgba(0,0,0,0.01)', ...style }}
    onMouseDown={() => windowObj.startResizing(direction).catch(()=>windowObj.startResizing(direction.toLowerCase()).catch(()=>{}))}
  />
);

  return (
    <div className="app-container" style={{ position: 'relative' }}>
      
      {/* Invisible Resize Borders */}
      <ResizeBorder windowObj={appWindow} cursor="n-resize" direction="Top" style={{ top: 0, left: 4, right: 4, height: '4px' }} />
      <ResizeBorder windowObj={appWindow} cursor="s-resize" direction="Bottom" style={{ bottom: 0, left: 4, right: 4, height: '12px' }} />
      <ResizeBorder windowObj={appWindow} cursor="e-resize" direction="Right" style={{ top: 4, bottom: 4, right: 0, width: '4px' }} />
      <ResizeBorder windowObj={appWindow} cursor="w-resize" direction="Left" style={{ top: 4, bottom: 4, left: 0, width: '4px' }} />
      <ResizeBorder windowObj={appWindow} cursor="nw-resize" direction="TopLeft" style={{ top: 0, left: 0, width: '8px', height: '8px' }} />
      <ResizeBorder windowObj={appWindow} cursor="ne-resize" direction="TopRight" style={{ top: 0, right: 0, width: '8px', height: '8px' }} />
      <ResizeBorder windowObj={appWindow} cursor="sw-resize" direction="BottomLeft" style={{ bottom: 0, left: 0, width: '8px', height: '8px' }} />
      <ResizeBorder windowObj={appWindow} cursor="se-resize" direction="BottomRight" style={{ bottom: 0, right: 0, width: '8px', height: '8px' }} />

      {/* Native Titlebar */}
      <div 
        className="titlebar" 
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || e.target.classList.contains('titlebar-logo')) {
            appWindow.startDragging().catch(()=>{});
          }
        }}
      >
        <div className="titlebar-logo">
          <Music2 size={14} /> NadaNada
        </div>
        <div className="titlebar-buttons">
          <div className="titlebar-button" onClick={() => appWindow.minimize()}>
            <Minus size={14} />
          </div>
          <div className="titlebar-button" onClick={() => appWindow.toggleMaximize()}>
            <Square size={12} />
          </div>
          <div className="titlebar-button close" onClick={() => appWindow.close()}>
            <X size={14} />
          </div>
        </div>
      </div>

      {/* Top Section: Player & Controls */}
      <div className="top-section glass-panel" style={{ margin: '0 auto 8px auto', maxWidth: '800px', width: 'calc(100% - 16px)', borderRadius: '16px', position: 'relative' }}>
        <header className="header" style={{ paddingBottom: '12px', display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, display: 'flex', paddingRight: '16px' }}>
            <Visualizer isPlaying={isAudioPlaying} spectrum={audioSpectrum} />
          </div>
          <div style={{ flexShrink: 0 }}>
            <button className="btn btn-icon" onClick={toggleTheme} title="Toggle Theme" style={{ background: 'transparent', boxShadow: 'none' }}>
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        <Player 
          currentSong={currentSong} 
          nextSong={playlist[currentIndex + 1]}
          onNext={handleNext} 
          onPrevious={handlePrevious} 
          hasNext={currentIndex < playlist.length - 1}
          hasPrevious={currentIndex > 0}
          onPlayStateChange={setIsAudioPlaying}
        />
      </div>

      {/* Bottom Section: Playlist or Search */}
      <div className="bottom-section glass-panel" style={{ margin: '0 auto 8px auto', maxWidth: '800px', width: 'calc(100% - 16px)', borderRadius: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--panel-border)' }}>
          <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {showSearch ? 'Search YouTube' : `Up Next (${playlist.length})`}
            {!showSearch && isFetchingEndless && <span style={{ fontSize: '0.8rem', color: 'var(--accent-color)' }}>Loading mix...</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!showSearch && (
              <button 
                className={`btn btn-icon ${isEndlessPlay ? 'active' : ''}`} 
                onClick={() => setIsEndlessPlay(!isEndlessPlay)} 
                title="Endless Play" 
                style={{ padding: '6px', color: isEndlessPlay ? 'var(--accent-color)' : 'inherit' }}
              >
                <Infinity size={18} />
              </button>
            )}
            <button className="btn btn-icon" onClick={() => setShowSearch(!showSearch)} title={showSearch ? "Close Search" : "Search Music"} style={{ padding: '6px' }}>
              {showSearch ? <X size={18} /> : <SearchIcon size={18} />}
            </button>
          </div>
        </div>
        
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {showSearch ? (
            <div style={{ padding: '16px', height: '100%', display: 'flex', flex: 1, minHeight: 0 }}>
              <Search onAdd={handleAddSong} playlist={playlist} />
            </div>
          ) : (
            <Playlist 
              playlist={playlist} 
              currentIndex={currentIndex} 
              onSelectIndex={setCurrentIndex} 
              onRemove={handleRemoveSong}
              onReorder={handleReorder}
            />
          )}
        </div>
      </div>

      {showClosePrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon-container">
              <Disc className="modal-icon" />
            </div>
            <div>
              <h3 className="modal-title">Keep the music playing?</h3>
              <p className="modal-desc">
                You can minimize NadaNada to the system tray so it continues playing in the background.
              </p>
            </div>
            
            <div className="modal-actions">
              <button 
                onClick={async () => {
                  setShowClosePrompt(false);
                  await getCurrentWindow().hide();
                }}
                className="btn btn-primary btn-large"
              >
                Minimize to Tray
              </button>
              <button 
                onClick={async () => {
                  setShowClosePrompt(false);
                  await invoke('quit_app');
                }}
                className="btn btn-secondary btn-large"
              >
                Quit App
              </button>
              <button 
                onClick={() => setShowClosePrompt(false)}
                className="btn btn-cancel btn-large"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
