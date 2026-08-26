import React from 'react';
import { ArrowLeft, AlertTriangle, FolderOpen, Save, Trash2, Infinity, Loader2, TrendingUp, Download, FolderPlus, X, Search as SearchIcon } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';

export default function PlaylistHeader({
  showSearch,
  showDownloadedList,
  setShowDownloadedList,
  savedPlaylist,
  setSavedPlaylist,
  playlist,
  setPlaylist,
  isFetchingEndless,
  failedEndlessFetch,
  setFailedEndlessFetch,
  setShowLoadPrompt,
  setShowSavePrompt,
  setShowClearPrompt,
  isEndlessPlay,
  setIsEndlessPlay,
  setIsShuffle,
  trendingRef,
  isFetchingTrending,
  showTrendingDropdown,
  setShowTrendingDropdown,
  handleLoadTrending,
  previewSavedStateRef,
  previewSong,
  handleStopPreview,
  hasAddedSongInSearchRef,
  setShouldScrollPlaylistToBottom,
  setShowSearch,
  handleToggleSearch,
  api,
  loadDownloadedSongs,
  setGlobalError,
  staticStyles
}) {
  return (
    <div style={staticStyles.headerBar}>
      <div style={staticStyles.headerTitle}>
        {showSearch ? 'Search YouTube' : showDownloadedList ? (
          <button onClick={() => {
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
            <ArrowLeft size={18} style={{ marginTop: '2px' }} /> Back to My Playlist
          </button>
        ) : isFetchingEndless ? <span>Finding next song...</span> : savedPlaylist ? (
          <button onClick={() => {
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
            <ArrowLeft size={18} style={{ marginTop: '2px' }} /> Back to My Playlist
          </button>
        ) : `Up Next (${playlist.length})`}
        {!showSearch && !showDownloadedList && failedEndlessFetch && (
          <button onClick={() => setFailedEndlessFetch(false)} style={{
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
          </button>
        )}
      </div>
      <div style={staticStyles.headerIcons}>
        {!showSearch && !showDownloadedList && (
          <>
            {!savedPlaylist && (
              <button className="btn btn-icon" onClick={() => setShowLoadPrompt(true)} title="Load Playlist" style={staticStyles.iconBtn}>
                <FolderOpen size={18} />
              </button>
            )}
            {playlist.length > 0 && (
              <button className="btn btn-icon" onClick={() => setShowSavePrompt(true)} title="Save Playlist" style={staticStyles.iconBtn}>
                <Save size={18} />
              </button>
            )}
            {playlist.length > 0 && !savedPlaylist && (
              <button className="btn btn-icon" onClick={() => setShowClearPrompt(true)} title="Clear Playlist" style={staticStyles.iconBtnDanger}>
                <Trash2 size={18} />
              </button>
            )}
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
            <div style={{ position: 'relative', zIndex: 50 }} ref={trendingRef}>
              <button className={`btn btn-icon ${isFetchingTrending || showTrendingDropdown ? 'active' : ''}`} onClick={() => setShowTrendingDropdown(!showTrendingDropdown)} title="Load Trending" disabled={isFetchingTrending} style={{
                padding: '6px',
                color: isFetchingTrending || showTrendingDropdown ? 'var(--accent-color)' : 'inherit'
              }}>
                {isFetchingTrending ? <Loader2 size={18} className="animate-spin" /> : <TrendingUp size={18} />}
              </button>
              {showTrendingDropdown && (
                <div style={{
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
                </div>
              )}
            </div>
          </>
        )}
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
        {showDownloadedList && (
          <button className="btn btn-icon" onClick={async () => {
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
              setGlobalError(`Failed to add local song: ${e.message || e}`);
            }
          }} title="Add Local Audio File" style={{ padding: '6px' }}>
            <FolderPlus size={18} />
          </button>
        )}
        {!savedPlaylist && !showDownloadedList && (
          <button className="btn btn-icon" onClick={handleToggleSearch} title={showSearch ? 'Close Search' : 'Search Music'} style={{ padding: '6px' }}>
            {showSearch ? <X size={18} /> : <SearchIcon size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}
