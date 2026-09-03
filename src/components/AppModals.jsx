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
    setMiniPlayerOpacity
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
        />
      )}

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
    </>
  );
}
