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
import { sanitizeLegacyHifiTrack, getCachedHifi, HIFI_MATCHER_VERSION } from '../services/hifiResolver';

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
        onSelect={(playlistItem) => {
          const sanitizedItems = Array.isArray(playlistItem?.items)
            ? playlistItem.items.map(sanitizeLegacyHifiTrack)
            : [];
          
          // Immediate synchronous cache check for track 0 and 1 so FLAC plays with 0ms delay
          if (isHifiEnabled && sanitizedItems.length > 0 && !sanitizedItems[0].stream_url && !sanitizedItems[0].is_local) {
            const cached = getCachedHifi(sanitizedItems[0]);
            if (cached && cached.stream_url) {
              sanitizedItems[0] = {
                ...sanitizedItems[0],
                stream_url: cached.stream_url,
                source: 'monochrome',
                hifi_id: cached.hifi_id,
                _hifiChecked: true,
                _hifiVersion: HIFI_MATCHER_VERSION
              };
            }
          }
          if (isHifiEnabled && sanitizedItems.length > 1 && !sanitizedItems[1].stream_url && !sanitizedItems[1].is_local) {
            const cachedNext = getCachedHifi(sanitizedItems[1]);
            if (cachedNext && cachedNext.stream_url) {
              sanitizedItems[1] = {
                ...sanitizedItems[1],
                stream_url: cachedNext.stream_url,
                source: 'monochrome',
                hifi_id: cachedNext.hifi_id,
                _hifiChecked: true,
                _hifiVersion: HIFI_MATCHER_VERSION
              };
            }
          }

          setPlaylist(sanitizedItems);
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
