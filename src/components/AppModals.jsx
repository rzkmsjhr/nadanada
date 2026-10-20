import React from 'react';
import WelcomeModal from './WelcomeModal';
import ClosePromptModal from './modals/ClosePromptModal';
import ClearPlaylistModal from './modals/ClearPlaylistModal';
import SavePlaylistModal from './modals/SavePlaylistModal';
import LoadPlaylistModal from './modals/LoadPlaylistModal';
import AddToPlaylistModal from './modals/AddToPlaylistModal';
import ErrorModal from './modals/ErrorModal';
import SuccessModal from './modals/SuccessModal';
import SettingsModal from './SettingsModal';
import { useAppContext } from '../context/AppContext';
import { sanitizeLegacyHifiTrack, getCachedHifi, HIFI_MATCHER_VERSION, resolveInitialPlaylistTracks } from '../services/hifiResolver';

export default function AppModals() {
  const {
    showWelcome,
    setShowWelcome,
    showClosePrompt,
    setShowClosePrompt,
    showClearPrompt,
    setShowClearPrompt,
    setPlaylist,
    setSavedPlaylist,
    setCurrentIndex,
    setIsAudioPlaying,
    showSavePrompt,
    setShowSavePrompt,
    playlist,
    setSavedPlaylists,
    showLoadPrompt,
    setShowLoadPrompt,
    savedPlaylists,
    importUrl,
    setImportUrl,
    isImporting,
    importProgress,
    handleImportPlaylist,
    songToAddToPlaylist,
    setSongToAddToPlaylist,
    setSuccessMessage,
    globalError,
    setGlobalError,
    successMessage,
    showSettings,
    setShowSettings,
    theme,
    setTheme,
    crossfadeDuration,
    setCrossfadeDuration,
    miniPlayerOpacity,
    setMiniPlayerOpacity,
    fontScale,
    setFontScale,
    closeBehavior,
    setCloseBehavior,
    isHifiEnabled,
    setIsHifiEnabled
  } = useAppContext();
  return (
    <>
      {showWelcome && (
        <WelcomeModal onClose={() => setShowWelcome(false)} />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          theme={theme}
          setTheme={setTheme}
          crossfadeDuration={crossfadeDuration}
          setCrossfadeDuration={setCrossfadeDuration}
          miniPlayerOpacity={miniPlayerOpacity}
          setMiniPlayerOpacity={setMiniPlayerOpacity}
          fontScale={fontScale}
          setFontScale={setFontScale}
          closeBehavior={closeBehavior}
          setCloseBehavior={setCloseBehavior}
          isHifiEnabled={isHifiEnabled}
          setIsHifiEnabled={setIsHifiEnabled}
        />
      )}

      {showClosePrompt && (
        <ClosePromptModal 
          onClose={() => setShowClosePrompt(false)} 
          closeBehavior={closeBehavior}
          setCloseBehavior={setCloseBehavior}
        />
      )}

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
          items: playlist.map(sanitizeLegacyHifiTrack)
        }]);
        setShowSavePrompt(false);
      }} onClose={() => setShowSavePrompt(false)} />}

      {showLoadPrompt && <LoadPlaylistModal 
        savedPlaylists={savedPlaylists}
        onSelect={async (playlistItem) => {
          let items = Array.isArray(playlistItem?.items) ? playlistItem.items : [];
          if (isHifiEnabled && items.length > 0) {
            items = await resolveInitialPlaylistTracks(items, 5);
          } else {
            items = items.map(sanitizeLegacyHifiTrack);
          }

          setPlaylist(items);
          setSavedPlaylist(null);
          setCurrentIndex(0);
          setIsAudioPlaying(true);
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
          const trackToAdd = sanitizeLegacyHifiTrack(songToAddToPlaylist);
          setSavedPlaylists(prev => prev.map(p => {
            if (p.id === playlistItem.id) {
              if (p.items.some(s => s.id === trackToAdd.id)) return p;
              return { ...p, items: [...p.items, trackToAdd] };
            }
            return p;
          }));
          setSongToAddToPlaylist(null);
          setSuccessMessage(`Added to ${playlistItem.name}`);
        }}
        onCreatePlaylist={(name) => {
          const trackToAdd = sanitizeLegacyHifiTrack(songToAddToPlaylist);
          setSavedPlaylists(prev => [...prev, {
            id: Date.now().toString(),
            name,
            items: [trackToAdd]
          }]);
          setSongToAddToPlaylist(null);
          setSuccessMessage(`Created and added to ${name}`);
        }}
        onClose={() => setSongToAddToPlaylist(null)}
      />}

      <ErrorModal error={globalError} onClose={() => setGlobalError(null)} />

      <SuccessModal message={successMessage} onClose={() => setSuccessMessage(null)} />
    </>
  );
}
