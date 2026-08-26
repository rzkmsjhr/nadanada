import { useMusicDiscovery, parseDuration } from "./hooks/useMusicDiscovery";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Player from './components/Player';
import Search from './components/Search';
import Playlist from './components/Playlist';
import { Music2, Sun, Moon, Palette, Search as SearchIcon, X, Minus, Square, Infinity, Disc, Trash2, Save, FolderOpen, FolderPlus, AlertTriangle, ListMusic, TrendingUp, Globe, ArrowLeft, Loader2, Download, CheckCircle, ListPlus, Pencil, Check } from 'lucide-react';
import { SavedPlaylistItem, SavedPlaylistButtonItem } from "./components/SavedPlaylists";
import WelcomeModal from './components/WelcomeModal';
import ClosePromptModal from './components/modals/ClosePromptModal';
import ClearPlaylistModal from './components/modals/ClearPlaylistModal';
import SavePlaylistModal from './components/modals/SavePlaylistModal';
import LoadPlaylistModal from './components/modals/LoadPlaylistModal';
import AddToPlaylistModal from './components/modals/AddToPlaylistModal';
import ErrorModal from './components/modals/ErrorModal';
import SuccessModal from './components/modals/SuccessModal';
import Titlebar from './components/Titlebar';
import ChordDisplay from "./components/ChordDisplay";
import WindowBorders from "./components/WindowBorders";
import { useChords } from "./hooks/useChords";
import { useArtistFact } from "./hooks/useArtistFact";
import { useDownloadManager } from "./hooks/useDownloadManager";
import { useSearchPreview } from "./hooks/useSearchPreview";
import { usePlayback } from "./hooks/usePlayback";
import { usePlaylistManager } from "./hooks/usePlaylistManager";
import { useSystemIntegration } from "./hooks/useSystemIntegration";
import { api } from './services/api';
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import './App.css';
const getCachedVideo = query => {
  try {
    const raw = localStorage.getItem('nadanada-yt-cache');
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const normalizedKey = query.toLowerCase().trim();
    return cache[normalizedKey] || null;
  } catch (e) {
    return null;
  }
};
const setCachedVideo = (query, videoObj) => {
  try {
    const raw = localStorage.getItem('nadanada-yt-cache') || '{}';
    const cache = JSON.parse(raw);
    const normalizedKey = query.toLowerCase().trim();
    const {
      queueId,
      rank,
      ...cleanVideo
    } = videoObj;
    cache[normalizedKey] = cleanVideo;
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      delete cache[keys[0]];
    }
    localStorage.setItem('nadanada-yt-cache', JSON.stringify(cache));
  } catch (e) {
    console.error("Failed to save yt-cache:", e);
  }
};
const basePanelStyle = {
  margin: '0 auto 8px auto',
  maxWidth: '800px',
  width: 'calc(100% - 16px)',
  borderRadius: '16px'
};
const topPanelStyle = {
  ...basePanelStyle,
  position: 'relative',
  flex: 'none'
};
const bottomPanelStyle = {
  ...basePanelStyle,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0
};
const staticStyles = {
  headerBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    boxShadow: '0 1px 0 0 var(--panel-border)'
  },
  headerTitle: {
    fontWeight: 'bold',
    fontSize: '0.9rem',
    color: 'var(--text-main)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    whiteSpace: 'nowrap'
  },
  headerLoading: {
    fontSize: '0.8rem',
    color: 'var(--accent-color)'
  },
  headerIcons: {
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
    flex: 1,
    overflow: 'visible'
  },
  iconBtn: {
    padding: '6px'
  },
  iconBtnDanger: {
    padding: '6px',
    color: '#ef4444'
  },
  separator: {
    width: '2px',
    height: '24px',
    background: 'var(--panel-border)',
    margin: '0 2px',
    borderRadius: '1px',
    flexShrink: 0
  },
  appLayout: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  playlistContainer: {
    flex: 1,
    overflow: 'hidden'
  },
  searchContainer: {
    padding: '16px',
    height: '100%',
    display: 'flex',
    flex: 1,
    minHeight: 0
  }
};
function App() {
  const appWindow = getCurrentWindow();

  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const {
    theme, toggleTheme,
    isMaximized,
    isVideoHidden,
    isReconnecting
  } = useSystemIntegration(appWindow, setShowClosePrompt);

  const [showWelcome, setShowWelcome] = useState(() => localStorage.getItem('nadanada-welcome-seen') !== 'true');

  // Ref to Player's imperative handle — used by keyboard shortcuts
  const playerRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  // Stable refs for next/prev so the keyboard handler never becomes stale
  const handleNextRef = useRef(null);
  const handlePreviousRef = useRef(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const hasAddedSongInSearchRef = useRef(false);

  const [showSearch, setShowSearch] = useState(false);
  const {
    playlist, setPlaylist,
    currentIndex, setCurrentIndex,
    savedPlaylist, setSavedPlaylist,
    savedPlaylists, setSavedPlaylists,
    shouldScrollPlaylistToBottom, setShouldScrollPlaylistToBottom,
    handleAddSong, handleAddMultiple,
    handleRemoveSong, handleReorder
  } = usePlaylistManager({
    api,
    showSearch,
    hasAddedSongInSearchRef
  });
  const {
    previewSong, setPreviewSong,
    restoredSong, setRestoredSong,
    previewSavedStateRef,
    handlePlayPreview,
    handleStopPreview
  } = useSearchPreview({
    currentTime,
    playerRef,
    playlist,
    currentIndex,
    isAudioPlaying,
    setIsAudioPlaying
  });
  const handleToggleSearch = () => {
    console.log("Toggle Search. hasAdded:", hasAddedSongInSearchRef.current, "showSearch:", showSearch);
    if (showSearch) {
      // Closing search view
      if (previewSavedStateRef.current || previewSong) {
        handleStopPreview();
      }
      if (hasAddedSongInSearchRef.current) {
        console.log("Setting should scroll to true");
        setShouldScrollPlaylistToBottom(true);
        hasAddedSongInSearchRef.current = false;
      }
      setShowSearch(false);
    } else {
      // Opening search view
      hasAddedSongInSearchRef.current = false;
      setShowDownloadedList(false);
      setShowSearch(true);
    }
  };
  const [isEndlessPlay, setIsEndlessPlay] = useState(false);
  const [showTrendingDropdown, setShowTrendingDropdown] = useState(false);
  const [globalError, setGlobalError] = useState(null);


  const {
    showDownloadedList, setShowDownloadedList,
    downloadedSongs, setDownloadedSongs,
    downloadingSongId,
    downloadedIds,
    loadDownloadedSongs,
    handleDownloadSong
  } = useDownloadManager(api, setGlobalError);
  const [successMessage, setSuccessMessage] = useState(null);
  const {
    isFetchingEndless,
    failedEndlessFetch,
    setFailedEndlessFetch,
    isImporting,
    importProgress,
    importUrl,
    setImportUrl,
    isFetchingTrending,
    trendingType,
    setTrendingType,
    handleImportPlaylist,
    handleLoadTrending
  } = useMusicDiscovery({
    playlist,
    setPlaylist,
    currentIndex,
    isEndlessPlay,
    setCachedVideo,
    setGlobalError,
    setShowTrendingDropdown
  });

  const [showClearPrompt, setShowClearPrompt] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [showLoadPrompt, setShowLoadPrompt] = useState(false);
  const [songToAddToPlaylist, setSongToAddToPlaylist] = useState(null);
  const trendingRef = useRef(null);
  useEffect(() => {
    const handleClickOutside = event => {
      if (trendingRef.current && !trendingRef.current.contains(event.target)) {
        setShowTrendingDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // audioSpectrum state moved to Visualizer component for performance

  const currentSong = useMemo(() => {
    if (previewSong) {
      return {
        ...previewSong,
        startSeconds: 30
      };
    }
    if (restoredSong) {
      return restoredSong;
    }
    return playlist[currentIndex] || null;
  }, [previewSong, restoredSong, playlist, currentIndex]);

  // Fix: Clear restored song if user manually changes track via playlist
  useEffect(() => {
    if (restoredSong) {
      setRestoredSong(null);
    }
  }, [currentIndex, playlist]);
  const { 
    showChords, setShowChords, 
    chordsData, setChordsData, 
    isFetchingChords, 
    chordsError, setChordsError, 
    syncOffset, setSyncOffset, 
    transposeOffset, setTransposeOffset 
  } = useChords(currentSong, isAudioPlaying, api);
  const artistFact = useArtistFact(currentSong);
  // Reset the failed state whenever the user manually plays a different song or adds a song
  useEffect(() => {
    setFailedEndlessFetch(false);
  }, [currentIndex]);
  const {
    repeatMode, setRepeatMode,
    isShuffle, setIsShuffle,
    shuffleHistory, setShuffleHistory,
    handleNext, handlePrevious
  } = usePlayback({
    playlist,
    currentIndex,
    setCurrentIndex,
    previewSong,
    setPreviewSong,
    restoredSong,
    setRestoredSong
  });



  // \u2500\u2500 Keyboard shortcuts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Keep refs current so the effect registered once never becomes stale
  handleNextRef.current = handleNext;
  handlePreviousRef.current = handlePrevious;
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
          handleToggleSearch();
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // Registered once — relies on refs for always-current functions

  const SHARPS_MAP = {
    'C♯': 'C#',
    'D♯': 'D#',
    'E♯': 'F',
    'F♯': 'F#',
    'G♯': 'G#',
    'A♯': 'A#',
    'B♯': 'C'
  };
  return <div className="app-container" style={{
    position: 'relative',
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }}>


      {/* Invisible Resize Borders */}
      <WindowBorders appWindow={appWindow} />

      {/* Native/Custom Titlebar */}
      <Titlebar appWindow={appWindow} />

      {/* ── UNIFIED MAIN CONTENT ──
          Single JSX tree — styles switch via isMaximized.
          Player is rendered ONCE and stays mounted across maximize/restore
          so the song never restarts. ── */}
      <div style={isMaximized ? {
      display: 'flex',
      flex: 1,
      gap: '12px',
      padding: '0 12px 12px 12px',
      minHeight: 0,
      overflow: 'hidden'
    } : {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden'
    }}>

        {/* ── Player Panel ── */}
        <div className={isMaximized ? 'glass-panel' : 'top-section glass-panel'} style={isMaximized ? {
        flex: '0 0 70%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        overflow: 'hidden',
        minHeight: 0
      } : topPanelStyle}>
          <div style={{
          display: 'grid',
          gridTemplateRows: showSearch && !isMaximized ? '0fr' : '1fr',
          transition: 'grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
            <div style={{
            overflow: 'hidden'
          }}>
              <header className="header" style={isMaximized ? {
              display: 'flex',
              alignItems: 'center',
              height: '80px',
              padding: '0 16px',
              flexShrink: 0,
              boxShadow: '0 1px 0 0 var(--panel-border)'
            } : {
              paddingBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              minHeight: '60px',
              height: 'auto',
              opacity: showSearch && !isMaximized ? 0 : 1,
              transition: 'opacity 0.2s ease',
              pointerEvents: showSearch && !isMaximized ? 'none' : 'auto'
            }}>
            <div style={{
                flex: 1,
                display: 'flex',
                paddingRight: '16px',
                height: '100%',
                minWidth: 0
              }}>
              {showChords ? <ChordDisplay data={chordsData} time={currentTime + syncOffset} transpose={transposeOffset} isLoading={isFetchingChords} error={chordsError} onRetry={() => {
                  setChordsData(null);
                  setChordsError(null);
                }} /> : <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: '100%',
                  paddingLeft: '8px',
                  overflow: 'hidden',
                  flex: 1
                }}>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    minWidth: 0,
                    paddingRight: '16px',
                    flex: 1,
                    width: '100%'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '2px'
                    }}>
                      {artistFact ? 'Artist Fact' : 'Up Next'}
                    </div>
                    <div className="marquee-container">
                      <div className={artistFact ? 'running-text' : ''} style={{
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        color: 'var(--text-main)',
                        whiteSpace: 'nowrap',
                        fontStyle: artistFact ? 'italic' : 'normal'
                      }}>
                        {artistFact ? `"${artistFact}"` : playlist[currentIndex + 1] ? playlist[currentIndex + 1].title : isFetchingEndless ? 'Loading Mix...' : 'End of Playlist'}
                      </div>
                    </div>
                  </div>
                </div>}
            </div>
            <div style={{
                flexShrink: 0,
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
              {showChords && chordsData && !isFetchingChords && !chordsError && <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  marginRight: '4px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.7rem',
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--panel-border)',
                    borderRadius: '8px',
                    padding: '2px 6px',
                    color: 'var(--text-muted)'
                  }}>
                    <span style={{
                      marginRight: '4px'
                    }}>Key:</span>
                    <button onClick={() => setTransposeOffset(s => (s - 1) % 12)} style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: '0 4px',
                      fontSize: '0.9rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }} title="Transpose Down">-</button>
                    <span style={{
                      minWidth: '24px',
                      textAlign: 'center',
                      fontWeight: 'bold',
                      color: 'var(--text-main)'
                    }}>{transposeOffset > 0 ? '+' : ''}{transposeOffset}</span>
                    <button onClick={() => setTransposeOffset(s => (s + 1) % 12)} style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: '0 4px',
                      fontSize: '0.9rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }} title="Transpose Up">+</button>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.7rem',
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--panel-border)',
                    borderRadius: '8px',
                    padding: '2px 6px',
                    color: 'var(--text-muted)'
                  }}>
                    <span style={{
                      marginRight: '4px'
                    }}>Sync:</span>
                    <button onClick={() => setSyncOffset(s => Math.max(-30, s - 0.25))} style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: '0 4px',
                      fontSize: '0.9rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }} title="Delay Chords">-</button>
                    <span style={{
                      minWidth: '32px',
                      textAlign: 'center',
                      fontWeight: 'bold',
                      color: 'var(--text-main)'
                    }}>{syncOffset > 0 ? '+' : ''}{syncOffset}s</span>
                    <button onClick={() => setSyncOffset(s => Math.min(30, s + 0.25))} style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: '0 4px',
                      fontSize: '0.9rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }} title="Advance Chords">+</button>
                  </div>
                </div>}
              <button className={`btn btn-icon ${showChords ? 'active' : ''}`} onClick={() => setShowChords(!showChords)} title="Toggle Chords" style={{
                  background: showChords ? 'var(--button-hover)' : 'transparent',
                  boxShadow: 'none',
                  color: showChords ? 'var(--accent-color)' : 'inherit'
                }}>
                <ListMusic size={20} />
              </button>
              <button className="btn btn-icon" onClick={toggleTheme} title="Switch Theme" style={{
                  background: 'transparent',
                  boxShadow: 'none'
                }}>
                <Palette size={20} />
              </button>
            </div>
          </header>
            </div>
          </div>

          {/* Player — ONE instance, never remounts */}
          <div style={isMaximized ? {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '16px',
          minHeight: 0,
          overflow: 'hidden'
        } : {
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}>
            <Player ref={playerRef} currentSong={currentSong} isSearchExpanded={showSearch && !isMaximized} nextSong={playlist[currentIndex + 1]} onNext={handleNext} onPrevious={handlePrevious} hasNext={isShuffle || currentIndex < playlist.length - 1} hasPrevious={isShuffle ? shuffleHistory.length > 0 : currentIndex > 0} onPlayStateChange={setIsAudioPlaying} onTimeUpdate={setCurrentTime} onError={setGlobalError} isMaximized={isMaximized} isVideoHidden={isVideoHidden} repeatMode={repeatMode} onToggleRepeat={() => setRepeatMode(m => (m + 1) % 3)} isShuffle={isShuffle} onToggleShuffle={() => {
            const newVal = !isShuffle;
            setIsShuffle(newVal);
            if (newVal) setIsEndlessPlay(false);
          }} onSongEnded={handleNext} onRestoreHandled={() => setRestoredMainTime(null)} />
          </div>
        </div>

        {/* ── Playlist Panel ── */}
        <div className="bottom-section glass-panel" style={isMaximized ? {
        flex: '0 0 calc(30% - 12px)',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        overflow: 'hidden',
        minHeight: 0
      } : bottomPanelStyle}>
          <div style={staticStyles.headerBar}>
            <div style={staticStyles.headerTitle}>
              {showSearch ? 'Search YouTube' : showDownloadedList ? <button onClick={() => {
              setShowDownloadedList(false);
              if (savedPlaylist) {
                setPlaylist(savedPlaylist);
                setSavedPlaylist(null);
              }
            }} style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-main)',
              fontWeight: 'inherit',
              fontSize: 'inherit',
              fontFamily: 'inherit',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }} title="Return to your original playlist">
                  <ArrowLeft size={18} style={{
                marginTop: '2px'
              }} /> Back to My Playlist
                </button> : isFetchingEndless ? <span>Finding next song...</span> : savedPlaylist ? <button onClick={() => {
              setPlaylist(savedPlaylist);
              setSavedPlaylist(null);
            }} style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-main)',
              fontWeight: 'inherit',
              fontSize: 'inherit',
              fontFamily: 'inherit',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }} title="Return to your original playlist">
                  <ArrowLeft size={18} style={{
                marginTop: '2px'
              }} /> Back to My Playlist
                </button> : `Up Next (${playlist.length})`}
              {!showSearch && !showDownloadedList && failedEndlessFetch && <button onClick={() => setFailedEndlessFetch(false)} style={{
              fontSize: '0.75rem',
              background: 'rgba(239,68,68,0.2)',
              border: '1px solid #ef4444',
              color: '#ef4444',
              borderRadius: '4px',
              padding: '2px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }} title="Click to retry loading Endless Mix">
                  <AlertTriangle size={12} /> Mix Failed (Retry)
                </button>}
            </div>
            <div style={staticStyles.headerIcons}>
              {!showSearch && !showDownloadedList && <>
                  {!savedPlaylist && <button className="btn btn-icon" onClick={() => setShowLoadPrompt(true)} title="Load Playlist" style={staticStyles.iconBtn}>
                      <FolderOpen size={18} />
                    </button>}
                  {playlist.length > 0 && <button className="btn btn-icon" onClick={() => setShowSavePrompt(true)} title="Save Playlist" style={staticStyles.iconBtn}>
                      <Save size={18} />
                    </button>}
                  {playlist.length > 0 && !savedPlaylist && <button className="btn btn-icon" onClick={() => setShowClearPrompt(true)} title="Clear Playlist" style={staticStyles.iconBtnDanger}>
                      <Trash2 size={18} />
                    </button>}
                  <div style={staticStyles.separator} />
                  <button className={`btn btn-icon ${isEndlessPlay ? 'active' : ''}`} onClick={() => {
                const newVal = !isEndlessPlay;
                setIsEndlessPlay(newVal);
                if (newVal) setIsShuffle(false);
              }} title="Endless Play" style={{
                padding: '6px',
                color: isEndlessPlay ? 'var(--accent-color)' : 'inherit'
              }}>
                    {isFetchingEndless ? <Loader2 size={18} className="animate-spin" /> : <Infinity size={18} />}
                  </button>
                  <div style={{
                position: 'relative',
                zIndex: 50
              }} ref={trendingRef}>
                    <button className={`btn btn-icon ${isFetchingTrending || showTrendingDropdown ? 'active' : ''}`} onClick={() => setShowTrendingDropdown(!showTrendingDropdown)} title="Load Trending" disabled={isFetchingTrending} style={{
                  padding: '6px',
                  color: isFetchingTrending || showTrendingDropdown ? 'var(--accent-color)' : 'inherit'
                }}>
                      {isFetchingTrending ? <Loader2 size={18} className="animate-spin" /> : <TrendingUp size={18} />}
                    </button>
                    {showTrendingDropdown && <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '8px',
                  background: 'var(--bg-color)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '8px',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  zIndex: 100,
                  minWidth: '120px'
                }}>
                        <button className="btn" onClick={() => handleLoadTrending('indonesia')} style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    border: 'none',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    width: '100%'
                  }}>Indonesia</button>
                        <button className="btn" onClick={() => handleLoadTrending('global')} style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    border: 'none',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    width: '100%'
                  }}>Worldwide</button>
                      </div>}
                  </div>
                </>}
              <button className={`btn btn-icon ${showDownloadedList ? 'active' : ''}`} onClick={() => {
              if (previewSavedStateRef.current || previewSong) {
                handleStopPreview();
              }
              if (showSearch && hasAddedSongInSearchRef.current) {
                setShouldScrollPlaylistToBottom(true);
                hasAddedSongInSearchRef.current = false;
              }
              if (showDownloadedList && savedPlaylist) {
                setPlaylist(savedPlaylist);
                setSavedPlaylist(null);
              }
              setShowDownloadedList(!showDownloadedList);
              setShowSearch(false);
            }} title="Downloaded Songs" style={{
              padding: '6px',
              color: showDownloadedList ? 'var(--accent-color)' : 'inherit'
            }}>
                <Download size={18} />
              </button>
              {showDownloadedList && <button className="btn btn-icon" onClick={async () => {
              try {
                const filePath = await open({
                  multiple: false,
                  filters: [{
                    name: 'Audio',
                    extensions: ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'webm']
                  }]
                });
                if (filePath) {
                  await api.addLocalSong(filePath);
                  loadDownloadedSongs();
                }
              } catch (e) {
                console.error('Failed to add local song:', e);
                setGlobalError('Failed to add local song.');
              }
            }} title="Add Local Audio File" style={{
              padding: '6px'
            }}>
                  <FolderPlus size={18} />
                </button>}
              {!savedPlaylist && !showDownloadedList && <button className="btn btn-icon" onClick={handleToggleSearch} title={showSearch ? 'Close Search' : 'Search Music'} style={{
              padding: '6px'
            }}>
                  {showSearch ? <X size={18} /> : <SearchIcon size={18} />}
                </button>}
            </div>
          </div>

          <div style={staticStyles.playlistContainer}>
            {showSearch ? <div style={staticStyles.searchContainer}>
                <Search onAdd={handleAddSong} onAddMultiple={handleAddMultiple} playlist={playlist} onError={setGlobalError} onPlayPreview={handlePlayPreview} onStopPreview={handleStopPreview} previewSongId={previewSong?.id} />
              </div> : showDownloadedList ? <Playlist playlist={downloadedSongs} currentIndex={downloadedSongs.findIndex(s => s.id === currentSong?.id)} onSelectIndex={idx => {
            if (!savedPlaylist && playlist !== downloadedSongs) {
              setSavedPlaylist(playlist);
            }
            setPlaylist(downloadedSongs);
            setCurrentIndex(idx);
            setIsAudioPlaying(true);
          }} onRemove={async idx => {
            const song = downloadedSongs[idx];
            try {
              await api.deleteDownloadedSong(song.file_path);
              loadDownloadedSongs();
            } catch (e) {
              console.error('Failed to delete song:', e);
              setGlobalError('Failed to delete song.');
            }
          }} onReorder={(dragIndex, dropIndex) => {
            const newPlaylist = [...downloadedSongs];
            const [draggedItem] = newPlaylist.splice(dragIndex, 1);
            newPlaylist.splice(dropIndex, 0, draggedItem);
            setDownloadedSongs(newPlaylist);
            if (playlist === downloadedSongs) {
              setPlaylist(newPlaylist);
              if (currentIndex === dragIndex) setCurrentIndex(dropIndex);else if (currentIndex > dragIndex && currentIndex <= dropIndex) setCurrentIndex(currentIndex - 1);else if (currentIndex < dragIndex && currentIndex >= dropIndex) setCurrentIndex(currentIndex + 1);
            }
          }} isTrendingMode={true} isDownloadedView={true} onAddSong={() => {}} /> : <Playlist playlist={playlist} currentIndex={currentIndex} onSelectIndex={setCurrentIndex} onRemove={handleRemoveSong} onReorder={handleReorder} isTrendingMode={!!savedPlaylist} onAddSong={song => {
            if (savedPlaylist) {
              setSavedPlaylist([...savedPlaylist, song]);
            }
          }} onDownloadSong={handleDownloadSong} downloadingSongId={downloadingSongId} downloadedIds={downloadedIds} onAddToSavedPlaylist={song => setSongToAddToPlaylist(song)} shouldScrollToBottom={shouldScrollPlaylistToBottom} onScrollToBottomDone={() => setShouldScrollPlaylistToBottom(false)} />}
          </div>
        </div>

      </div>

      {/* ── Reconnection overlay ── shows briefly before auto-reload */}
      {isReconnecting && <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '16px',
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      animation: 'fadeIn 0.3s ease-out'
    }}>
          <Loader2 size={36} className="animate-spin" style={{
        color: 'var(--accent-color)'
      }} />
          <div style={{
        color: 'var(--text-main)',
        fontSize: '0.9rem',
        fontWeight: '500',
        letterSpacing: '0.02em'
      }}>
            Connection restored. Refreshing…
          </div>
        </div>}

      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}

      {showClosePrompt && <ClosePromptModal onClose={() => setShowClosePrompt(false)} />}

      {showClearPrompt && <ClearPlaylistModal onClear={() => {
        setPlaylist([]);
        setSavedPlaylist(null);
        setCurrentIndex(0);
        setIsAudioPlaying(false);
        setShowClearPrompt(false);
      }} onClose={() => setShowClearPrompt(false)} />}

      {showSavePrompt && <SavePlaylistModal onSave={(name) => {
        setSavedPlaylists(prev => [...prev, {
          id: Date.now().toString(),
          name,
          items: playlist
        }]);
        setShowSavePrompt(false);
      }} onClose={() => setShowSavePrompt(false)} />}

      {showLoadPrompt && <LoadPlaylistModal 
        savedPlaylists={savedPlaylists}
        onSelect={(playlistItem) => {
          setPlaylist(playlistItem.items);
          setSavedPlaylist(null);
          setCurrentIndex(0);
          setShowLoadPrompt(false);
        }}
        onDelete={(id) => {
          setSavedPlaylists(prev => prev.filter(p => p.id !== id));
        }}
        onRename={(id, newName) => {
          setSavedPlaylists(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
        }}
        onClose={() => setShowLoadPrompt(false)}
        importUrl={importUrl}
        setImportUrl={setImportUrl}
        isImporting={isImporting}
        importProgress={importProgress}
        handleImportPlaylist={handleImportPlaylist}
      />}


      {songToAddToPlaylist && <AddToPlaylistModal 
        songToAddToPlaylist={songToAddToPlaylist}
        savedPlaylists={savedPlaylists}
        onAddToPlaylist={(playlistItem) => {
          setSavedPlaylists(prev => prev.map(p => {
            if (p.id === playlistItem.id) {
              if (p.items.some(s => s.id === songToAddToPlaylist.id)) return p;
              return { ...p, items: [...p.items, songToAddToPlaylist] };
            }
            return p;
          }));
          setSongToAddToPlaylist(null);
          setSuccessMessage(`Added to ${playlistItem.name}`);
        }}
        onCreatePlaylist={(name) => {
          setSavedPlaylists(prev => [...prev, {
            id: Date.now().toString(),
            name,
            items: [songToAddToPlaylist]
          }]);
          setSongToAddToPlaylist(null);
          setSuccessMessage(`Created and added to ${name}`);
        }}
        onClose={() => setSongToAddToPlaylist(null)}
      />}

      <ErrorModal error={globalError} onClose={() => setGlobalError(null)} />

      <SuccessModal message={successMessage} onClose={() => setSuccessMessage(null)} />
    </div>;
}
export default App;