import { invoke } from '@tauri-apps/api/core';

export const api = {
  // Playlists
  loadPlaylists: () => invoke('load_playlists'),
  savePlaylists: (data) => invoke('save_playlists', { data }),
  getPlaylistTitle: (platform, playlistId) => invoke('get_playlist_title', { platform, playlistId }),

  // YouTube / Search
  searchYouTube: (query, searchType = null) => invoke('search_youtube', { query, searchType }),
  getYouTubeMix: (videoId) => invoke('get_youtube_mix', { videoId }),
  getYouTubePlaylist: (playlistId, firstVideoId = '') => invoke('get_youtube_playlist', { playlistId, firstVideoId }),
  
  // Spotify / Charts
  getSpotifyPlaylist: (playlistId) => invoke('get_spotify_playlist', { playlistId }),
  getKworbChart: (region) => invoke('get_kworb_chart', { region }),

  // Downloads / Local
  getDownloadedSongs: () => invoke('get_downloaded_songs'),
  downloadSong: (id, title, artist) => invoke('download_song', { id, title, artist }),
  addLocalSong: (filePath) => invoke('add_local_song', { filePath }),
  deleteDownloadedSong: (filePath) => invoke('delete_downloaded_song', { filePath }),
  
  // Utilities
  scrapeChords: (id, title) => invoke('scrape_chords', { id, title }),
  getStreamUrl: (videoId) => invoke('get_stream_url', { videoId }),
  getEmbedPort: () => invoke('get_embed_port'),
  quitApp: () => invoke('quit_app')
};
