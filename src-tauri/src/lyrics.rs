use regex::Regex;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LyricsResponse {
    pub success: bool,
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
    pub source: String,
    pub instrumental: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct LrclibItem {
    pub id: Option<u64>,
    #[serde(rename = "trackName")]
    pub track_name: Option<String>,
    #[serde(rename = "artistName")]
    pub artist_name: Option<String>,
    #[serde(rename = "albumName")]
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: Option<bool>,
    #[serde(rename = "plainLyrics")]
    pub plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CaptionSeg {
    pub utf8: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct CaptionEvent {
    #[serde(rename = "tStartMs")]
    pub t_start_ms: Option<u64>,
    #[serde(rename = "dDurationMs")]
    pub d_duration_ms: Option<u64>,
    pub segs: Option<Vec<CaptionSeg>>,
}

#[derive(Debug, Deserialize)]
struct CaptionJson3 {
    pub events: Option<Vec<CaptionEvent>>,
}

fn sanitize_title(title: &str) -> String {
    // Remove (Official Music Video), [MV], (Audio), etc.
    let re_brackets = Regex::new(r"(?i)[\(\[\{].*?(?:official|music\s*video|audio|video|lyrics?|hd|4k|mv|visualizer|feat|ft\.).*?[\)\]\}]").unwrap();
    let cleaned = re_brackets.replace_all(title, " ");

    let re_noise = Regex::new(r"(?i)\b(official\s*video|official\s*audio|official\s*music\s*video|lyric\s*video|music\s*video|full\s*album|hq|hd|4k|audio|mv)\b").unwrap();
    let cleaned = re_noise.replace_all(&cleaned, " ");

    let re_spaces = Regex::new(r"\s+").unwrap();
    re_spaces.replace_all(&cleaned, " ").trim().to_string()
}

fn sanitize_artist(artist: &str) -> String {
    let cleaned = artist.replace(" - Topic", "").replace("- Topic", "");
    let re_spaces = Regex::new(r"\s+").unwrap();
    re_spaces.replace_all(&cleaned, " ").trim().to_string()
}

fn get_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// 1. Query LRCLIB (Exact match -> Search fallback)
async fn fetch_lrclib(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    duration: Option<f64>,
) -> Option<LyricsResponse> {
    let clean_title = sanitize_title(title);
    let clean_artist = sanitize_artist(artist);

    // 1a. Try exact GET
    let mut get_url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}",
        urlencoding::encode(&clean_title),
        urlencoding::encode(&clean_artist)
    );
    if let Some(dur) = duration {
        if dur > 0.0 {
            get_url.push_str(&format!("&duration={}", dur.round() as u64));
        }
    }

    if let Ok(res) = client
        .get(&get_url)
        .header(
            "User-Agent",
            "NadaNada/0.5.7 (https://github.com/rzkmsjhr/nadanada)",
        )
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(item) = res.json::<LrclibItem>().await {
                if let Some(synced) = item.synced_lyrics {
                    if !synced.trim().is_empty() {
                        return Some(LyricsResponse {
                            success: true,
                            synced_lyrics: Some(synced),
                            plain_lyrics: item.plain_lyrics,
                            source: "LRCLIB".to_string(),
                            instrumental: item.instrumental.unwrap_or(false),
                            error: None,
                        });
                    }
                }
                if item.instrumental.unwrap_or(false) {
                    return Some(LyricsResponse {
                        success: true,
                        synced_lyrics: None,
                        plain_lyrics: None,
                        source: "LRCLIB".to_string(),
                        instrumental: true,
                        error: None,
                    });
                }
            }
        }
    }

    // 1b. Fallback to LRCLIB Search
    let query = format!("{} {}", clean_title, clean_artist);
    let search_url = format!(
        "https://lrclib.net/api/search?q={}",
        urlencoding::encode(query.trim())
    );

    if let Ok(res) = client
        .get(&search_url)
        .header(
            "User-Agent",
            "NadaNada/0.5.7 (https://github.com/rzkmsjhr/nadanada)",
        )
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(items) = res.json::<Vec<LrclibItem>>().await {
                // Find first item with synced lyrics
                for item in &items {
                    if let Some(synced) = &item.synced_lyrics {
                        if !synced.trim().is_empty() {
                            return Some(LyricsResponse {
                                success: true,
                                synced_lyrics: Some(synced.clone()),
                                plain_lyrics: item.plain_lyrics.clone(),
                                source: "LRCLIB".to_string(),
                                instrumental: item.instrumental.unwrap_or(false),
                                error: None,
                            });
                        }
                    }
                }
                // If any has instrumental
                for item in &items {
                    if item.instrumental.unwrap_or(false) {
                        return Some(LyricsResponse {
                            success: true,
                            synced_lyrics: None,
                            plain_lyrics: None,
                            source: "LRCLIB".to_string(),
                            instrumental: true,
                            error: None,
                        });
                    }
                }
            }
        }
    }

    None
}

/// 2. Query YouTube Video Captions (TimedText) and convert to LRC
async fn fetch_youtube_captions(
    client: &reqwest::Client,
    video_id: &str,
) -> Option<LyricsResponse> {
    if video_id.is_empty() {
        return None;
    }

    let watch_url = format!("https://www.youtube.com/watch?v={}", video_id);
    let html = client
        .get(&watch_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    // Extract captionTracks from ytInitialPlayerResponse
    let re_captions = Regex::new(r#""captionTracks":\s*\[(.*?)\]"#).ok()?;
    let caps_match = re_captions.captures(&html)?;
    let caps_json = format!("[{}]", &caps_match[1]);

    #[derive(Deserialize)]
    struct TrackInfo {
        #[serde(rename = "baseUrl")]
        pub base_url: Option<String>,
        #[serde(rename = "languageCode")]
        pub language_code: Option<String>,
    }

    let tracks: Vec<TrackInfo> = serde_json::from_str(&caps_json).ok()?;
    if tracks.is_empty() {
        return None;
    }

    // Prefer English/Indonesian, or first available track
    let track = tracks
        .iter()
        .find(|t| {
            if let Some(lang) = &t.language_code {
                lang.starts_with("en") || lang.starts_with("id")
            } else {
                false
            }
        })
        .or_else(|| tracks.first())?;

    let base_url = track.base_url.as_ref()?;
    let json3_url = if base_url.contains("fmt=") {
        base_url.to_string()
    } else {
        format!("{}&fmt=json3", base_url)
    };

    let caption_data = client
        .get(&json3_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .ok()?
        .json::<CaptionJson3>()
        .await
        .ok()?;

    let events = caption_data.events?;
    let mut lrc_lines = Vec::new();
    let mut plain_lines = Vec::new();

    for ev in events {
        if let (Some(start_ms), Some(segs)) = (ev.t_start_ms, ev.segs) {
            let mut text = String::new();
            for s in segs {
                if let Some(u) = s.utf8 {
                    text.push_str(&u);
                }
            }
            let text = text.trim().replace('\n', " ");
            if !text.is_empty() {
                let total_sec = start_ms as f64 / 1000.0;
                let minutes = (total_sec / 60.0).floor() as u32;
                let seconds = total_sec % 60.0;
                let lrc_line = format!("[{:02}:{:05.2}] {}", minutes, seconds, text);
                lrc_lines.push(lrc_line);
                plain_lines.push(text);
            }
        }
    }

    if !lrc_lines.is_empty() {
        Some(LyricsResponse {
            success: true,
            synced_lyrics: Some(lrc_lines.join("\n")),
            plain_lyrics: Some(plain_lines.join("\n")),
            source: "YouTube Captions".to_string(),
            instrumental: false,
            error: None,
        })
    } else {
        None
    }
}

#[tauri::command]
pub async fn get_lyrics(
    title: String,
    artist: String,
    duration: Option<f64>,
    video_id: Option<String>,
) -> Result<LyricsResponse, String> {
    let client = get_client();
    let vid = video_id.unwrap_or_default();

    // ── STEP 1: LRCLIB (Primary Synced Database) ──
    if let Some(resp) = fetch_lrclib(&client, &title, &artist, duration).await {
        println!("[Lyrics] Successfully retrieved synced lyrics from LRCLIB");
        return Ok(resp);
    }

    // ── STEP 2: YouTube Video Captions (Timed Subtitles Fallback) ──
    if !vid.is_empty() {
        if let Some(resp) = fetch_youtube_captions(&client, &vid).await {
            println!("[Lyrics] Successfully retrieved timed captions from YouTube Video");
            return Ok(resp);
        }
    }

    // All sources exhausted — no synced lyrics found
    Ok(LyricsResponse {
        success: false,
        synced_lyrics: None,
        plain_lyrics: None,
        source: "None".to_string(),
        instrumental: false,
        error: Some("No synced lyrics found for this song.".to_string()),
    })
}
