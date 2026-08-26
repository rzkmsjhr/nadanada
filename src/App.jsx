import { useMusicDiscovery, parseDuration } from "./hooks/useMusicDiscovery";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Player from './components/Player';
import { Music2, Sun, Moon, Palette, Search as SearchIcon, X, Minus, Square, Infinity, Disc, Trash2, Save, FolderOpen, FolderPlus, AlertTriangle, ListMusic, TrendingUp, Globe, ArrowLeft, Loader2, Download, CheckCircle, ListPlus, Pencil, Check } from 'lucide-react';
import { SavedPlaylistItem, SavedPlaylistButtonItem } from "./components/SavedPlaylists";
import AppModals from './components/AppModals';
import PlaylistViews from './components/PlaylistViews';
import Titlebar from './components/Titlebar';
import PlayerHeader from './components/PlayerHeader';
import PlaylistHeader from './components/PlaylistHeader';
import ChordDisplay from "./components/ChordDisplay";
import WindowBorders from "./components/WindowBorders";
import { useChords } from "./hooks/useChords";
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
    theme, toggleTheme,
    isMaximized,
    isVideoHidden,
    isReconnecting,
    isMiniPlayer,
    toggleMiniPlayer
  } = useSystemIntegration(appWindow, setShowClosePrompt);

  const [showWelcome, setShowWelcome] = useState(() => localStorage.getItem('nadanada-welcome-seen') !== 'true');

  // Ref to Player's imperative handle — used by keyboard shortcuts
  const playerRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
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
    setGlobalError,
    setShowTrendingDropdown,
    savedPlaylist,
    setSavedPlaylist,
    setCurrentIndex,
    setIsAudioPlaying
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



  useKeyboardShortcuts({
    playerRef,
    handleNext,
    handlePrevious,
    handleToggleSearch
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
      <Titlebar appWindow={appWindow} onToggleMiniPlayer={toggleMiniPlayer} isMiniPlayer={isMiniPlayer} />

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
          gridTemplateRows: (showSearch && !isMaximized) || isMiniPlayer ? '0fr' : '1fr',
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
                currentTime={currentTime}
                syncOffset={syncOffset}
                setSyncOffset={setSyncOffset}
                transposeOffset={transposeOffset}
                setTransposeOffset={setTransposeOffset}
                artistFact={artistFact}
                playlist={playlist}
                currentIndex={currentIndex}
                isFetchingEndless={isFetchingEndless}
                toggleTheme={toggleTheme}
              />
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
          minHeight: 0,
          flex: isMiniPlayer ? 1 : 'unset'
        }}>
            <Player ref={playerRef} currentSong={currentSong} isSearchExpanded={showSearch && !isMaximized} nextSong={playlist[currentIndex + 1]} onNext={handleNext} onPrevious={handlePrevious} hasNext={isShuffle || currentIndex < playlist.length - 1} hasPrevious={isShuffle ? shuffleHistory.length > 0 : currentIndex > 0} onPlayStateChange={setIsAudioPlaying} onTimeUpdate={setCurrentTime} onError={setGlobalError} isMaximized={isMaximized} isVideoHidden={isVideoHidden} repeatMode={repeatMode} onToggleRepeat={() => setRepeatMode(m => (m + 1) % 3)} isShuffle={isShuffle} onToggleShuffle={() => {
            const newVal = !isShuffle;
            setIsShuffle(newVal);
            if (newVal) setIsEndlessPlay(false);
          }} onSongEnded={handleNext} onRestoreHandled={() => setRestoredMainTime(null)}
            albumInfo={albumInfo} isLoadingAlbum={isLoadingAlbum} onAlbumClick={handleAlbumClick} />
          </div>
        </div>

        {/* ── Playlist Panel ── */}
        {!isMiniPlayer && (
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
            <PlaylistViews
              showSearch={showSearch}
              showDownloadedList={showDownloadedList}
              playlist={playlist}
              downloadedSongs={downloadedSongs}
              currentSong={currentSong}
              currentIndex={currentIndex}
              savedPlaylist={savedPlaylist}
              setSavedPlaylist={setSavedPlaylist}
              setPlaylist={setPlaylist}
              setCurrentIndex={setCurrentIndex}
              setIsAudioPlaying={setIsAudioPlaying}
              api={api}
              loadDownloadedSongs={loadDownloadedSongs}
              setDownloadedSongs={setDownloadedSongs}
              setGlobalError={setGlobalError}
              handleAddSong={handleAddSong}
              handleAddMultiple={handleAddMultiple}
              handlePlayPreview={handlePlayPreview}
              handleStopPreview={handleStopPreview}
              previewSong={previewSong}
              handleRemoveSong={handleRemoveSong}
              handleReorder={handleReorder}
              handleDownloadSong={handleDownloadSong}
              downloadingSongId={downloadingSongId}
              downloadedIds={downloadedIds}
              setSongToAddToPlaylist={setSongToAddToPlaylist}
              shouldScrollPlaylistToBottom={shouldScrollPlaylistToBottom}
              setShouldScrollPlaylistToBottom={setShouldScrollPlaylistToBottom}
              albumInfo={albumInfo}
              albumCache={albumCache}
              onAlbumClick={handleAlbumClick}
            />
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

      <AppModals
        showWelcome={showWelcome}
        setShowWelcome={setShowWelcome}
        showClosePrompt={showClosePrompt}
        setShowClosePrompt={setShowClosePrompt}
        showClearPrompt={showClearPrompt}
        setShowClearPrompt={setShowClearPrompt}
        setPlaylist={setPlaylist}
        setSavedPlaylist={setSavedPlaylist}
        setCurrentIndex={setCurrentIndex}
        setIsAudioPlaying={setIsAudioPlaying}
        showSavePrompt={showSavePrompt}
        setShowSavePrompt={setShowSavePrompt}
        playlist={playlist}
        setSavedPlaylists={setSavedPlaylists}
        showLoadPrompt={showLoadPrompt}
        setShowLoadPrompt={setShowLoadPrompt}
        savedPlaylists={savedPlaylists}
        importUrl={importUrl}
        setImportUrl={setImportUrl}
        isImporting={isImporting}
        importProgress={importProgress}
        handleImportPlaylist={handleImportPlaylist}
        songToAddToPlaylist={songToAddToPlaylist}
        setSongToAddToPlaylist={setSongToAddToPlaylist}
        setSuccessMessage={setSuccessMessage}
        globalError={globalError}
        setGlobalError={setGlobalError}
        successMessage={successMessage}
      />
    </div>;
}
export default App;