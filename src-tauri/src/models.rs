use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub thumbnail: String,
    pub duration: String,
    pub channel: String,
    #[serde(default)]
    pub is_playlist: bool,
    #[serde(default)]
    pub track_count: Option<String>,
    #[serde(default)]
    pub first_video_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AlbumInfo {
    pub album: String,
    pub artist: String,
    pub album_playlist_id: String,
}

#[derive(serde::Serialize, Clone)]
pub struct SpotifyTrack {
    pub title: String,
    pub artist: String,
    pub query: String,
    pub duration_ms: u64,
}

#[derive(serde::Serialize, Clone)]
pub struct KworbTrack {
    pub rank: usize,
    pub query: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadedSong {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub is_local: bool,
    pub file_path: String,
}
