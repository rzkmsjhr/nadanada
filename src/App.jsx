import { useMusicDiscovery, parseDuration } from "./hooks/useMusicDiscovery";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Player from './components/Player';
import { Music2, Sun, Moon, Palette, Search as SearchIcon, X, Minus, Square, Infinity, Disc, Trash2, Save, FolderOpen, FolderPlus, AlertTriangle, ListMusic, TrendingUp, Globe, ArrowLeft, Loader2, Download, CheckCircle, ListPlus, Pencil, Check } from 'lucide-react';
import { SavedPlaylistItem, SavedPlaylistButtonItem } from "./components/SavedPlaylists";
import AppModals from './components/AppModals';
import PlaylistViews from './components/PlaylistViews';
import { AppContext } from './context/AppContext';
import Titlebar from './components/Titlebar';
import PlayerHeader from './components/PlayerHeader';
import PlaylistHeader from './components/PlaylistHeader';
import ChordDisplay from "./components/ChordDisplay";
import WindowBorders from "./components/WindowBorders";
import { useChords } from "./hooks/useChords";
import { useLyrics } from "./hooks/useLyrics";
import { useArtistFact } from "./hooks/useArtistFact";
import { useDownloadManager } from "./hooks/useDownloadManager";
import { useSearchPreview } from "./hooks/useSearchPreview";
import { usePlayback } from "./hooks/usePlayback";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePlaylistManager } from "./hooks/usePlaylistManager";
import { useSystemIntegration } from "./hooks/useSystemIntegration";
import { useAlbumInfo } from "./hooks/useAlbumInfo";
import { api } from './services/api';
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import './App.css';
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
    theme, setTheme, toggleTheme,
    isMaximized,
    isVideoHidden,
    isReconnecting,
    isMiniPlayer,
    toggleMiniPlayer,
    isFullscreen,
    toggleFullscreen
  } = useSystemIntegration(appWindow, setShowClosePrompt);

  const [crossfadeDuration, setCrossfadeDuration] = useState(() => {
    const saved = localStorage.getItem('nadanada-crossfade-duration');
    const parsed = saved !== null ? parseInt(saved, 10) : 3;
    return isNaN(parsed) ? 3 : Math.max(0, Math.min(5, parsed));
  });

  useEffect(() => {
    localStorage.setItem('nadanada-crossfade-duration', crossfadeDuration.toString());
  }, [crossfadeDuration]);

  const [miniPlayerOpacity, setMiniPlayerOpacity] = useState(() => {
    const saved = localStorage.getItem('nadanada-mini-player-opacity');
    const parsed = saved !== null ? parseInt(saved, 10) : 20;
    return isNaN(parsed) ? 20 : Math.max(10, Math.min(100, Math.round(parsed / 10) * 10));
  });

  useEffect(() => {
    localStorage.setItem('nadanada-mini-player-opacity', miniPlayerOpacity.toString());
    document.documentElement.style.setProperty('--mini-player-opacity', (miniPlayerOpacity / 100).toString());
  }, [miniPlayerOpacity]);

  const [showSettings, setShowSettings] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => localStorage.getItem('nadanada-welcome-seen') !== 'true');

  // Ref to Player's imperative handle — used by keyboard shortcuts
  const playerRef = useRef(null);
  const currentTimeRef = useRef(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const hasAddedSongInSearchRef = useRef(false);

  const handleTimeUpdate = (time) => {
    currentTimeRef.current = time;
    window.dispatchEvent(new CustomEvent('timeupdate', { detail: time }));
  };

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
  const [isEndlessPlay, setIsEndlessPlay] = useState(() => {
    return localStorage.getItem('nadanada-is-endless') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('nadanada-is-endless', isEndlessPlay.toString());
  }, [isEndlessPlay]);
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

  useEffect(() => {
    if ((globalError || successMessage) && isMiniPlayer) {
      toggleMiniPlayer();
    }
  }, [globalError, successMessage, isMiniPlayer, toggleMiniPlayer]);
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
    setGlobalError,
    setShowTrendingDropdown,
    savedPlaylist,
    setSavedPlaylist,
    setCurrentIndex,
    setIsAudioPlaying,
    handleAddMultiple,
    setSavedPlaylists,
    setSuccessMessage
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

  const { albumInfo, isLoadingAlbum, albumCache } = useAlbumInfo(playlist, currentIndex);

  const handleAlbumClick = async (info, clickedVideoId) => {
    if (!info?.album) return;
    try {
      let tracks = null;
      const targetVideoId = clickedVideoId || currentSong?.id || '';

      if (info.albumPlaylistId) {
        // Use the OLAK5uy_ playlist ID scraped from the video page (correct YouTube Music album)
        tracks = await api.getYouTubePlaylist(info.albumPlaylistId, targetVideoId);
      }

      if (!tracks || tracks.length === 0) {
        // Fallback: search for the album
        const searchQuery = `${info.album} ${info.artist}`.trim();
        const results = await api.searchYouTube(searchQuery, 'album');
        const albumResult = results?.[0];
        if (albumResult?.first_video_id) {
          tracks = await api.getYouTubePlaylist(albumResult.id, albumResult.first_video_id);
        }
      }

      if (tracks && tracks.length > 0) {
        if (!savedPlaylist) {
          setSavedPlaylist([...playlist]);
        }
        const timestamp = Date.now();
        const albumTracks = tracks.map((t, i) => ({
          ...t,
          queueId: `${timestamp}-${i}-${Math.random().toString(36).substr(2, 9)}`
        }));
        setPlaylist(albumTracks);
        // Find if the clicked song is in the album, else play first track
        const currentIdxInAlbum = tracks.findIndex(t => t.id === targetVideoId);
        setCurrentIndex(currentIdxInAlbum !== -1 ? currentIdxInAlbum : 0);
        setIsAudioPlaying(true);
      } else {
        setGlobalError('Could not find this album on YouTube.');
      }
    } catch (e) {
      console.error('Failed to load album:', e);
      setGlobalError(`Failed to load album: ${e.message || e}`);
    }
  };
  const { 
    showChords, setShowChords, 
    chordsData, setChordsData, 
    isFetchingChords, 
    chordsError, setChordsError, 
    syncOffset, setSyncOffset, 
    transposeOffset, setTransposeOffset 
  } = useChords(currentSong, isAudioPlaying, api);
  const {
    showLyrics, setShowLyrics,
    lyricsData, setLyricsData,
    isFetchingLyrics,
    lyricsError, setLyricsError,
    syncOffset: lyricsSyncOffset, setSyncOffset: setLyricsSyncOffset,
    handleRetry: handleRetryLyrics
  } = useLyrics(currentSong, isAudioPlaying, api);
  const artistFact = useArtistFact(currentSong);
  const {
    repeatMode, setRepeatMode,
    isShuffle, setIsShuffle,
    shuffleHistory, setShuffleHistory,
    upcomingShuffleIndex,
    handleNext, handlePrevious
  } = usePlayback({
    playlist,
    currentIndex,
    setCurrentIndex,
    previewSong,
    setPreviewSong,
    restoredSong,
    setRestoredSong,
    playerRef
  });

  const trueNextSongIndex = isShuffle ? upcomingShuffleIndex : currentIndex + 1;
  const trueNextSong = trueNextSongIndex !== null && trueNextSongIndex < playlist.length ? playlist[trueNextSongIndex] : null;



  useKeyboardShortcuts({
    playerRef,
    handleNext,
    handlePrevious,
    handleToggleSearch,
    isFullscreen,
    toggleFullscreen
  });

  const SHARPS_MAP = {
    'C♯': 'C#',
    'D♯': 'D#',
    'E♯': 'F',
    'F♯': 'F#',
    'G♯': 'G#',
    'A♯': 'A#',
    'B♯': 'C'
  };

  const contextValue = {
    showSearch, setShowSearch,
    showDownloadedList, setShowDownloadedList,
    playlist, setPlaylist,
    downloadedSongs, setDownloadedSongs,
    currentSong,
    currentIndex, setCurrentIndex,
    savedPlaylist, setSavedPlaylist,
    savedPlaylists, setSavedPlaylists,
    setIsAudioPlaying,
    api,
    loadDownloadedSongs,
    setGlobalError, globalError,
    handleAddSong, handleAddMultiple,
    handlePlayPreview, handleStopPreview,
    previewSong,
    handleRemoveSong, handleReorder,
    handleDownloadSong,
    downloadingSongId, downloadedIds,
    songToAddToPlaylist, setSongToAddToPlaylist,
    shouldScrollPlaylistToBottom, setShouldScrollPlaylistToBottom,
    albumInfo, albumCache, onAlbumClick: handleAlbumClick,
    showWelcome, setShowWelcome,
    showClosePrompt, setShowClosePrompt,
    showClearPrompt, setShowClearPrompt,
    showSavePrompt, setShowSavePrompt,
    showLoadPrompt, setShowLoadPrompt,
    importUrl, setImportUrl,
    isImporting, importProgress, handleImportPlaylist,
    successMessage, setSuccessMessage,
    showSettings, setShowSettings,
    theme, setTheme,
    crossfadeDuration, setCrossfadeDuration,
    miniPlayerOpacity, setMiniPlayerOpacity
  };

  return (
    <AppContext.Provider value={contextValue}>
      <div className={`app-container ${isMiniPlayer ? 'mini-player-mode' : ''} ${isFullscreen ? 'fullscreen-mode' : ''}`} style={{
    position: 'relative',
    width: '100vw',
    background: isMiniPlayer ? 'transparent' : isFullscreen ? '#000' : 'var(--bg-color)',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: isMiniPlayer ? '12px' : '0',
    '--mini-player-opacity': (miniPlayerOpacity / 100).toString()
  }}>


      {/* Invisible Resize Borders */}
      {!isMaximized && !isMiniPlayer && !isFullscreen && <WindowBorders appWindow={appWindow} />}

      {/* Native/Custom Titlebar */}
      {!isMiniPlayer && !isFullscreen && <Titlebar appWindow={appWindow} onToggleMiniPlayer={toggleMiniPlayer} isMiniPlayer={isMiniPlayer} />}

      {/* ── UNIFIED MAIN CONTENT ──
          Single JSX tree — styles switch via isMaximized and isFullscreen.
          Player is rendered ONCE and stays mounted across maximize/restore/fullscreen
          so the song never restarts. ── */}
      <div style={isFullscreen ? {
      display: 'flex',
      flex: 1,
      width: '100vw',
      height: '100vh',
      position: 'absolute',
      inset: 0,
      minHeight: 0,
      overflow: 'hidden',
      background: '#000'
    } : isMaximized ? {
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
        <div className={isFullscreen ? '' : isMaximized ? 'glass-panel' : isMiniPlayer ? '' : 'top-section glass-panel'} style={isFullscreen ? {
        flex: 1,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0,
        overflow: 'hidden',
        minHeight: 0
      } : isMaximized ? {
        flex: '0 0 70%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        overflow: 'hidden',
        minHeight: 0
      } : isMiniPlayer ? { flex: 1, display: 'flex', flexDirection: 'column' } : topPanelStyle}>
          <div style={{
          display: 'grid',
          gridTemplateRows: (showSearch && !isMaximized) || isMiniPlayer || isFullscreen ? '0fr' : '1fr',
          transition: 'grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
            <div style={{
            overflow: 'hidden'
          }}>
              <PlayerHeader 
                isMaximized={isMaximized}
                showSearch={showSearch}
                showChords={showChords}
                setShowChords={setShowChords}
                chordsData={chordsData}
                isFetchingChords={isFetchingChords}
                chordsError={chordsError}
                setChordsData={setChordsData}
                setChordsError={setChordsError}
                syncOffset={syncOffset}
                setSyncOffset={setSyncOffset}
                transposeOffset={transposeOffset}
                setTransposeOffset={setTransposeOffset}
                showLyrics={showLyrics}
                setShowLyrics={setShowLyrics}
                lyricsData={lyricsData}
                isFetchingLyrics={isFetchingLyrics}
                lyricsError={lyricsError}
                lyricsSyncOffset={lyricsSyncOffset}
                setLyricsSyncOffset={setLyricsSyncOffset}
                onRetryLyrics={handleRetryLyrics}
                artistFact={artistFact}
                playlist={playlist}
                currentIndex={currentIndex}
                isFetchingEndless={isFetchingEndless}
                onOpenSettings={() => setShowSettings(true)}
              />
            </div>
          </div>

          {/* Player — ONE instance, never remounts */}
          <div style={isFullscreen ? {
          flex: 1,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          padding: 0
        } : isMaximized ? {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '4px 16px 16px 16px',
          minHeight: 0,
          overflow: 'hidden'
        } : {
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          flex: isMiniPlayer ? 1 : 'unset'
        }}>
            <Player 
              ref={playerRef} 
              currentSong={currentSong} 
              isSearchExpanded={showSearch && !isMaximized} 
              nextSong={trueNextSong} 
              onNext={handleNext} 
              onPrevious={handlePrevious} 
              hasNext={isShuffle || currentIndex < playlist.length - 1} 
              hasPrevious={isShuffle ? shuffleHistory.length > 0 : currentIndex > 0} 
              onPlayStateChange={setIsAudioPlaying} 
              onTimeUpdate={handleTimeUpdate} 
              onError={setGlobalError} 
              isMaximized={isMaximized} 
              isFullscreen={isFullscreen} 
              onToggleFullscreen={toggleFullscreen} 
              isVideoHidden={isVideoHidden} 
              repeatMode={repeatMode} 
              onToggleRepeat={() => setRepeatMode(m => (m + 1) % 3)} 
              isShuffle={isShuffle} 
              onToggleShuffle={() => {
                const newVal = !isShuffle;
                setIsShuffle(newVal);
                if (newVal) setIsEndlessPlay(false);
              }} 
              onSongEnded={handleNext} 
              albumInfo={albumInfo} 
              isLoadingAlbum={isLoadingAlbum} 
              onAlbumClick={handleAlbumClick} 
              isMiniPlayer={isMiniPlayer} 
              onToggleMiniPlayer={toggleMiniPlayer} 
              crossfadeDuration={crossfadeDuration}
              setCrossfadeDuration={setCrossfadeDuration}
            />
          </div>
        </div>

        {/* ── Playlist Panel ── */}
        {!isMiniPlayer && !isFullscreen && (
        <div className="bottom-section glass-panel" style={isMaximized ? {
        flex: '0 0 calc(30% - 12px)',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        overflow: 'hidden',
        minHeight: 0
      } : bottomPanelStyle}>
          <PlaylistHeader 
            showSearch={showSearch}
            showDownloadedList={showDownloadedList}
            setShowDownloadedList={setShowDownloadedList}
            savedPlaylist={savedPlaylist}
            setSavedPlaylist={setSavedPlaylist}
            playlist={playlist}
            setPlaylist={setPlaylist}
            isFetchingEndless={isFetchingEndless}
            failedEndlessFetch={failedEndlessFetch}
            setFailedEndlessFetch={setFailedEndlessFetch}
            setShowLoadPrompt={setShowLoadPrompt}
            setShowSavePrompt={setShowSavePrompt}
            setShowClearPrompt={setShowClearPrompt}
            isEndlessPlay={isEndlessPlay}
            setIsEndlessPlay={setIsEndlessPlay}
            setIsShuffle={setIsShuffle}
            trendingRef={trendingRef}
            isFetchingTrending={isFetchingTrending}
            showTrendingDropdown={showTrendingDropdown}
            setShowTrendingDropdown={setShowTrendingDropdown}
            handleLoadTrending={handleLoadTrending}
            previewSavedStateRef={previewSavedStateRef}
            previewSong={previewSong}
            handleStopPreview={handleStopPreview}
            hasAddedSongInSearchRef={hasAddedSongInSearchRef}
            setShouldScrollPlaylistToBottom={setShouldScrollPlaylistToBottom}
            setShowSearch={setShowSearch}
            handleToggleSearch={handleToggleSearch}
            api={api}
            loadDownloadedSongs={loadDownloadedSongs}
            setGlobalError={setGlobalError}
            staticStyles={staticStyles}
          />

          <div style={staticStyles.playlistContainer}>
            <PlaylistViews />
          </div>
        </div>
        )}

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

      <AppModals />
    </div>
    </AppContext.Provider>
  );
}
export default App;