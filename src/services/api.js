import { invoke } from '@tauri-apps/api/core';

export const DEFAULT_EMBED_PORT = 24242;
let cachedEmbedPort = DEFAULT_EMBED_PORT;

export const api = {
  // Playlists
  loadPlaylists: () => invoke('load_playlists'),
  savePlaylists: (data) => invoke('save_playlists', { data }),
  getPlaylistTitle: (platform, playlistId) => invoke('get_playlist_title', { platform, playlistId }),

  // YouTube / Search
  searchYouTube: (query, searchType = null) => invoke('search_youtube', { query, searchType }),
  getYouTubeMix: (videoId) => invoke('get_youtube_mix', { videoId }),
  getYouTubePlaylist: (playlistId, firstVideoId = '') => invoke('get_youtube_playlist', { playlistId, firstVideoId }),

  // Monochrome / Hi-Fi (FLAC)
  searchMonochrome: (query, searchType = 'song') => invoke('search_monochrome', { query, searchType }),
  getMonochromeAlbum: (releaseId) => invoke('get_monochrome_album', { releaseId }),
  resolveHifiTrack: (songId, title, channel = null, duration = null, itemType = null, isrc = null) =>
    invoke('resolve_hifi_track', {
      songId: songId ? String(songId) : null,
      title: title || '',
      channel: channel || null,
      duration: duration ? String(duration) : null,
      itemType: itemType || null,
      isrc: isrc || null,
    }),
  getHifiStreamUrl: (trackId) => invoke('get_hifi_stream_url', { trackId: String(trackId) }),
  clearHifiDiskCache: () => invoke('clear_hifi_disk_cache'),
  
  // Spotify / Charts
  getSpotifyPlaylist: (playlistId) => invoke('get_spotify_playlist', { playlistId }),
  getKworbChart: (region) => invoke('get_kworb_chart', { region }),

  // Downloads / Local
  getDownloadedSongs: () => invoke('get_downloaded_songs'),
  downloadSong: (id, title, artist, streamUrl = null) => invoke('download_song', { id, title, artist, streamUrl }),
  addLocalSong: (filePath) => invoke('add_local_song', { filePath }),
  deleteDownloadedSong: (filePath) => invoke('delete_downloaded_song', { filePath }),
  
  scrapeChords: (id, title, duration = null) => invoke('scrape_chords', { id, title, duration }),
  getLyrics: (title, artist, duration = null, videoId = null) => invoke('get_lyrics', { title, artist, duration, videoId }),
  saveLyrics: (videoId, title, artist, syncedLyrics) => invoke('save_lyrics', { videoId, title, artist, syncedLyrics }),
  getStreamUrl: (videoId) => invoke('get_stream_url', { videoId }),
  getVideoAlbumInfo: (videoId) => invoke('get_video_album_info', { videoId }),
  getArtistDetails: (artistName, artistBrowseId = null) => invoke('get_artist_details', { artistName, artistBrowseId }),
  getArtistTopSongs: (playlistId) => invoke('get_artist_top_songs', { playlistId }),
  getEmbedPort: async () => {
    if (cachedEmbedPort) return cachedEmbedPort;
    try {
      const port = await invoke('get_embed_port');
      if (port) cachedEmbedPort = port;
      return port;
    } catch (e) {
      return null;
    }
  },
  getCachedEmbedPort: () => cachedEmbedPort,
  clearCachedData: () => invoke('clear_cached_data'),
  quitApp: () => invoke('quit_app'),
  setCloseBehavior: (behavior) => invoke('set_close_behavior', { behavior }),
  setAlwaysOnTop: (alwaysOnTop) => invoke('set_always_on_top', { alwaysOnTop }),
  showClosePromptWindow: () => invoke('show_close_prompt_window')
};

// Eagerly fetch port at startup
api.getEmbedPort().catch(() => {});
