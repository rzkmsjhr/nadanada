import React from 'react';
import Search from './Search';
import Playlist from './Playlist';

export default function PlaylistViews({
  showSearch,
  showDownloadedList,
  playlist,
  downloadedSongs,
  currentSong,
  currentIndex,
  savedPlaylist,
  setSavedPlaylist,
  setPlaylist,
  setCurrentIndex,
  setIsAudioPlaying,
  api,
  loadDownloadedSongs,
  setDownloadedSongs,
  setGlobalError,
  handleAddSong,
  handleAddMultiple,
  handlePlayPreview,
  handleStopPreview,
  previewSong,
  handleRemoveSong,
  handleReorder,
  handleDownloadSong,
  downloadingSongId,
  downloadedIds,
  setSongToAddToPlaylist,
  shouldScrollPlaylistToBottom,
  setShouldScrollPlaylistToBottom,
  albumInfo,
  albumCache,
  onAlbumClick
}) {
  if (showSearch) {
    return (
      <div style={{ padding: '16px', height: '100%', display: 'flex', flex: 1, minHeight: 0 }}>
        <Search 
          onAdd={handleAddSong} 
          onAddMultiple={handleAddMultiple} 
          playlist={playlist} 
          onError={setGlobalError} 
          onPlayPreview={handlePlayPreview} 
          onStopPreview={handleStopPreview} 
          previewSongId={previewSong?.id} 
        />
      </div>
    );
  }

  if (showDownloadedList) {
    return (
      <Playlist 
        playlist={downloadedSongs} 
        currentIndex={downloadedSongs.findIndex(s => s.id === currentSong?.id)} 
        onSelectIndex={idx => {
          if (!savedPlaylist && playlist !== downloadedSongs) {
            setSavedPlaylist(playlist);
          }
          setPlaylist(downloadedSongs);
          setCurrentIndex(idx);
          setIsAudioPlaying(true);
        }} 
        onRemove={async idx => {
          const song = downloadedSongs[idx];
          try {
            await api.deleteDownloadedSong(song.file_path);
            loadDownloadedSongs();
          } catch (e) {
            console.error('Failed to delete song:', e);
            setGlobalError(`Failed to delete song: ${e.message || e}`);
          }
        }} 
        onReorder={(dragIndex, dropIndex) => {
          const newPlaylist = [...downloadedSongs];
          const [draggedItem] = newPlaylist.splice(dragIndex, 1);
          newPlaylist.splice(dropIndex, 0, draggedItem);
          setDownloadedSongs(newPlaylist);
          if (playlist === downloadedSongs) {
            setPlaylist(newPlaylist);
            if (currentIndex === dragIndex) setCurrentIndex(dropIndex);
            else if (currentIndex > dragIndex && currentIndex <= dropIndex) setCurrentIndex(currentIndex - 1);
            else if (currentIndex < dragIndex && currentIndex >= dropIndex) setCurrentIndex(currentIndex + 1);
          }
        }} 
        isTrendingMode={true} 
        isDownloadedView={true} 
        onAddSong={() => {}} 
        albumCache={albumCache}
      />
    );
  }

  return (
    <Playlist 
      playlist={playlist} 
      currentIndex={currentIndex} 
      onSelectIndex={setCurrentIndex} 
      onRemove={handleRemoveSong} 
      onReorder={handleReorder} 
      isTrendingMode={!!savedPlaylist} 
      onAddSong={song => {
        if (savedPlaylist) {
          setSavedPlaylist([...savedPlaylist, song]);
        }
      }} 
      onDownloadSong={handleDownloadSong} 
      downloadingSongId={downloadingSongId} 
      downloadedIds={downloadedIds} 
      onAddToSavedPlaylist={song => setSongToAddToPlaylist(song)} 
      shouldScrollToBottom={shouldScrollPlaylistToBottom} 
      onScrollToBottomDone={() => setShouldScrollPlaylistToBottom(false)}
      albumInfo={albumInfo}
      albumCache={albumCache}
      onAlbumClick={onAlbumClick}
    />
  );
}
