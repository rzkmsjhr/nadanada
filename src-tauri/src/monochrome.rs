use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use serde::Deserialize;
use crate::models::Video;

const TRACKS_BASE_URL: &str = "https://tracks.monochrome.st";
const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

#[derive(Deserialize, Debug)]
struct RawTracksResponse {
    #[serde(default)]
    tracks: Vec<RawTrack>,
}

#[derive(Deserialize, Debug)]
struct RawTrack {
    #[serde(default, rename = "trackId")]
    track_id: Option<String>,
    #[serde(default, rename = "recordingId")]
    recording_id: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default, rename = "artistNames")]
    artist_names: Option<Vec<String>>,
    #[serde(default)]
    artists: Option<Vec<RawArtistRef>>,
    #[serde(default)]
    artwork: Option<String>,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    duration: Option<u64>,
}

#[derive(Deserialize, Debug)]
struct RawArtistRef {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Deserialize, Debug)]
struct RawReleasesResponse {
    #[serde(default)]
    releases: Vec<RawRelease>,
}

#[derive(Deserialize, Debug)]
struct RawRelease {
    #[serde(default, rename = "releaseId")]
    release_id: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default, rename = "artistNames")]
    artist_names: Option<Vec<String>>,
    #[serde(default)]
    artists: Option<Vec<RawArtistRef>>,
    #[serde(default)]
    artwork: Option<String>,
    #[serde(default, rename = "trackCount")]
    track_count: Option<u32>,
    #[serde(default)]
    tracks: Option<Vec<RawTrack>>,
}

fn format_duration(ms: u64) -> String {
    let total_secs = ms / 1000;
    let mins = total_secs / 60;
    let secs = total_secs % 60;
    format!("{}:{:02}", mins, secs)
}

fn extract_artist_names(artist_names: Option<Vec<String>>, artists: Option<Vec<RawArtistRef>>) -> String {
    if let Some(names) = artist_names {
        let valid: Vec<String> = names.into_iter().filter(|n| !n.trim().is_empty()).collect();
        if !valid.is_empty() {
            return valid.join(", ");
        }
    }
    if let Some(artist_list) = artists {
        let valid: Vec<String> = artist_list
            .into_iter()
            .filter_map(|a| a.name.or(a.display_name))
            .filter(|n| !n.trim().is_empty())
            .collect();
        if !valid.is_empty() {
            return valid.join(", ");
        }
    }
    "Unknown Artist".to_string()
}

fn get_client() -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(DEFAULT_USER_AGENT),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json"),
    );

    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

#[tauri::command]
pub async fn search_monochrome(
    query: String,
    search_type: Option<String>,
) -> Result<Vec<Video>, String> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    let client = get_client()?;
    let is_album = search_type.as_deref() == Some("album");

    if is_album {
        let url = format!(
            "{}/search/releases?q={}&limit=25",
            TRACKS_BASE_URL,
            urlencoding::encode(clean_query)
        );

        let res = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Network error querying releases: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("Release search failed with HTTP status: {}", res.status()));
        }

        let parsed: RawReleasesResponse = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse release search response: {}", e))?;

        let mut results = Vec::new();
        for r in parsed.releases {
            let release_id = match r.release_id.or(r.id) {
                Some(id) if !id.trim().is_empty() => id,
                _ => continue,
            };

            let title = r.title.unwrap_or_else(|| "Unknown Album".to_string());
            let channel = extract_artist_names(r.artist_names, r.artists);
            let artwork = r.artwork.unwrap_or_default();
            let track_count_str = r.track_count.map(|c| c.to_string());

            results.push(Video {
                id: release_id,
                title,
                thumbnail: artwork,
                duration: "".to_string(),
                channel,
                is_playlist: true,
                track_count: track_count_str,
                first_video_id: None,
                item_type: Some("album".to_string()),
                stream_url: None,
                source: Some("monochrome".to_string()),
            });
        }

        Ok(results)
    } else {
        let url = format!(
            "{}/search/tracks?q={}&limit=25",
            TRACKS_BASE_URL,
            urlencoding::encode(clean_query)
        );

        let res = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Network error querying tracks: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("Track search failed with HTTP status: {}", res.status()));
        }

        let parsed: RawTracksResponse = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse track search response: {}", e))?;

        let mut results = Vec::new();
        for t in parsed.tracks {
            let track_id = match t.track_id.or(t.id) {
                Some(id) if !id.trim().is_empty() => id,
                _ => continue,
            };

            let title = t.title.unwrap_or_else(|| "Unknown Title".to_string());
            let channel = extract_artist_names(t.artist_names, t.artists);
            let artwork = t.artwork.or(t.cover).unwrap_or_default();
            let duration_str = t.duration.map(format_duration).unwrap_or_default();
            let stream_target_id = t.recording_id.clone().unwrap_or_else(|| track_id.clone());
            let stream_url = crate::hifi::get_hifi_stream_url(stream_target_id);

            results.push(Video {
                id: track_id,
                title,
                thumbnail: artwork,
                duration: duration_str,
                channel,
                is_playlist: false,
                track_count: None,
                first_video_id: None,
                item_type: Some("song".to_string()),
                stream_url: Some(stream_url),
                source: Some("monochrome".to_string()),
            });
        }

        Ok(results)
    }
}

#[tauri::command]
pub async fn get_monochrome_album(release_id: String) -> Result<Vec<Video>, String> {
    let clean_id = release_id.trim();
    if clean_id.is_empty() {
        return Err("Invalid release ID".to_string());
    }

    let client = get_client()?;
    let url = format!("{}/releases/{}", TRACKS_BASE_URL, clean_id);

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error fetching album: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Album fetch failed with HTTP status: {}", res.status()));
    }

    let parsed: RawRelease = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse album release details: {}", e))?;

    let album_channel = extract_artist_names(parsed.artist_names, parsed.artists);
    let album_artwork = parsed.artwork.unwrap_or_default();

    let raw_tracks = match parsed.tracks {
        Some(tracks) => tracks,
        None => return Ok(Vec::new()),
    };

    let mut results = Vec::new();
    for t in raw_tracks {
        let track_id = match t.track_id.or(t.id) {
            Some(id) if !id.trim().is_empty() => id,
            _ => continue,
        };

        let title = t.title.unwrap_or_else(|| "Unknown Title".to_string());
        let channel = if t.artist_names.is_some() || t.artists.is_some() {
            extract_artist_names(t.artist_names, t.artists)
        } else {
            album_channel.clone()
        };

        let artwork = t
            .artwork
            .or(t.cover)
            .filter(|a| !a.trim().is_empty())
            .unwrap_or_else(|| album_artwork.clone());

        let duration_str = t.duration.map(format_duration).unwrap_or_default();
        let stream_target_id = t.recording_id.clone().unwrap_or_else(|| track_id.clone());
        let stream_url = crate::hifi::get_hifi_stream_url(stream_target_id);

        results.push(Video {
            id: track_id,
            title,
            thumbnail: artwork,
            duration: duration_str,
            channel,
            is_playlist: false,
            track_count: None,
            first_video_id: None,
            item_type: Some("song".to_string()),
            stream_url: Some(stream_url),
            source: Some("monochrome".to_string()),
        });
    }

    Ok(results)
}
