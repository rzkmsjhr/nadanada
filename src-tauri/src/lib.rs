use lazy_static::lazy_static;
use regex::Regex;
use reqwest;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tokio::process::Command;

use tauri::{
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

lazy_static! {
    static ref IO_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Video {
    id: String,
    title: String,
    thumbnail: String,
    duration: String,
    channel: String,
    #[serde(default)]
    is_playlist: bool,
    #[serde(default)]
    track_count: Option<String>,
    #[serde(default)]
    first_video_id: Option<String>,
}

#[tauri::command]
async fn search_youtube(
    mut query: String,
    search_type: Option<String>,
) -> Result<Vec<Video>, String> {
    let url = if let Some(st) = &search_type {
        println!("search_youtube called with search_type: {}", st);
        if st == "album" {
            format!(
                "https://www.youtube.com/results?search_query={}&sp=EgIQAw%3D%3D",
                query
            )
        } else {
            query.push_str(" topic");
            format!("https://www.youtube.com/results?search_query={}", query)
        }
    } else {
        query.push_str(" topic");
        format!("https://www.youtube.com/results?search_query={}", query)
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    let re = Regex::new(r"var ytInitialData = (\{.*?\});</script>").unwrap();
    if let Some(caps) = re.captures(&text) {
        let json_str = &caps[1];
        let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

        let mut videos = Vec::new();
        if let Some(contents) = v.pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents/0/itemSectionRenderer/contents") {
            if let Some(arr) = contents.as_array() {
                for item in arr {
                    if let Some(video) = item.get("videoRenderer") {
                        let id = video.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = video.pointer("/title/runs/0/text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let thumbnail = video.pointer("/thumbnail/thumbnails/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let duration = video.pointer("/lengthText/simpleText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let channel = video.pointer("/ownerText/runs/0/text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        
                        if !id.is_empty() && !title.is_empty() {
                            videos.push(Video { id, title, thumbnail, duration, channel, is_playlist: false, track_count: None, first_video_id: None });
                        }
                    } else if let Some(playlist) = item.get("playlistRenderer") {
                        let id = playlist.get("playlistId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = playlist.pointer("/title/simpleText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let thumbnail = playlist.pointer("/thumbnails/0/thumbnails/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let track_count = playlist.pointer("/videoCount").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let channel = playlist.pointer("/shortBylineText/runs/0/text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let first_video = playlist.pointer("/navigationEndpoint/watchEndpoint/videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        
                        if !id.is_empty() && !title.is_empty() {
                            videos.push(Video { id, title, thumbnail, duration: "".to_string(), channel, is_playlist: true, track_count: Some(track_count), first_video_id: Some(first_video) });
                        }
                    } else if let Some(lockup) = item.get("lockupViewModel") {
                        let lockup_str = lockup.to_string();
                        
                        // Try standard pointer first
                        let mut id = lockup.pointer("/metadata/lockupMetadataViewModel/metadata/runs/0/navigationEndpoint/watchEndpoint/playlistId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = lockup.pointer("/metadata/lockupMetadataViewModel/title/content").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let thumbnail = lockup.pointer("/contentImage/collectionThumbnailViewModel/primaryThumbnail/thumbnailViewModel/image/sources/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        
                        // Regex fallback for IDs
                        if id.is_empty() {
                            if let Some(caps) = Regex::new(r#""playlistId":"([^"]+)""#).unwrap().captures(&lockup_str) {
                                id = caps[1].to_string();
                            }
                        }
                        
                        let mut first_video = lockup.pointer("/metadata/lockupMetadataViewModel/metadata/runs/0/navigationEndpoint/watchEndpoint/videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if first_video.is_empty() {
                            if let Some(caps) = Regex::new(r#""videoId":"([^"]+)""#).unwrap().captures(&lockup_str) {
                                first_video = caps[1].to_string();
                            }
                        }
                        
                        let track_count_str = lockup.pointer("/metadata/lockupMetadataViewModel/metadata/runs/0/text").and_then(|v| v.as_str()).unwrap_or("");
                        let mut track_count = track_count_str.split(' ').next().unwrap_or("").to_string();
                        if track_count.is_empty() || !track_count_str.contains("videos") {
                            track_count = String::new();
                        }
                        
                        if !id.is_empty() && !title.is_empty() {
                            videos.push(Video { id, title, thumbnail, duration: "".to_string(), channel: "".to_string(), is_playlist: true, track_count: Some(track_count), first_video_id: Some(first_video) });
                        }
                    }
                    if videos.len() >= 15 {
                        break;
                    }
                }
            }
        }
        return Ok(videos);
    }
    Err("ytInitialData not found".to_string())
}

#[tauri::command]
async fn get_youtube_mix(video_id: String) -> Result<Vec<Video>, String> {
    let url = format!(
        "https://www.youtube.com/watch?v={}&list=RD{}",
        video_id, video_id
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    let re = Regex::new(r"var ytInitialData = (\{.*?\});</script>").unwrap();
    if let Some(caps) = re.captures(&text) {
        let json_str = &caps[1];
        let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

        let mut videos = Vec::new();
        if let Some(contents) =
            v.pointer("/contents/twoColumnWatchNextResults/playlist/playlist/contents")
        {
            if let Some(arr) = contents.as_array() {
                for item in arr {
                    if let Some(video) = item.get("playlistPanelVideoRenderer") {
                        let id = video
                            .get("videoId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let title = video
                            .pointer("/title/simpleText")
                            .and_then(|v| v.as_str())
                            .or_else(|| {
                                video.pointer("/title/runs/0/text").and_then(|v| v.as_str())
                            })
                            .unwrap_or("")
                            .to_string();
                        let thumbnail = video
                            .pointer("/thumbnail/thumbnails/0/url")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let duration = video
                            .pointer("/lengthText/simpleText")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let channel = video
                            .pointer("/shortBylineText/runs/0/text")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        if !id.is_empty() && !title.is_empty() {
                            videos.push(Video {
                                id,
                                title,
                                thumbnail,
                                duration,
                                channel,
                                is_playlist: false,
                                track_count: None,
                                first_video_id: None,
                            });
                        }
                    }
                    if videos.len() >= 25 {
                        break;
                    }
                }
            }
        }
        return Ok(videos);
    }

    Err("ytInitialData not found in mix".to_string())
}

#[tauri::command]
async fn get_stream_url(_app: tauri::AppHandle, video_id: String) -> Result<String, String> {

    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    data_dir.push("NadaNada");
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    let exe_path = data_dir.join("yt-dlp.exe");
    
    if !exe_path.exists() {
        println!("yt-dlp not found, downloading now...");
        let bytes =
            reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
                .await
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
        std::fs::write(&exe_path, bytes).map_err(|e| e.to_string())?;
    }



    // Get the direct audio stream URL using yt-dlp (-g / --get-url)
    let mut cmd = tokio::process::Command::new(exe_path);
    cmd.arg("-g").arg("-f").arg("bestaudio").arg(&url);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output_result = tokio::time::timeout(std::time::Duration::from_secs(30), cmd.output()).await;
    
    let output = match output_result {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => return Err("Stream extraction timed out after 30 seconds".to_string()),
    };

    if output.status.success() {
        let stream_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stream_url.is_empty() {
            return Ok(stream_url);
        }
    }
    
    let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
    Err(format!("yt-dlp failed to extract stream: {}", err_msg))
}

#[derive(serde::Serialize)]
struct SpotifyTrack {
    query: String,
    duration_ms: u64,
}

#[tauri::command]
async fn get_spotify_playlist(playlist_id: String) -> Result<Vec<SpotifyTrack>, String> {
    let url = format!("https://open.spotify.com/embed/playlist/{}", playlist_id);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;
    
    let re = Regex::new(r#"<script id="__NEXT_DATA__" type="application/json">(.*?)</script>"#).unwrap();
    if let Some(caps) = re.captures(&text) {
        let json_str = &caps[1];
        let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;
        
        let mut queries = Vec::new();
        if let Some(track_list) = v.pointer("/props/pageProps/state/data/entity/trackList").and_then(|v| v.as_array()) {
            for track in track_list {
                let title = track.get("title").and_then(|t| t.as_str()).unwrap_or("");
                let artist = track.get("subtitle").and_then(|a| a.as_str()).unwrap_or("");
                let duration_ms = track.get("duration").and_then(|d| d.as_u64()).unwrap_or(0);
                if !title.is_empty() {
                    queries.push(SpotifyTrack {
                        query: format!("{} {}", title, artist).trim().to_string(),
                        duration_ms,
                    });
                }
            }
        }
        return Ok(queries);
    }
    
    Err("Could not parse Spotify playlist data".to_string())
}

#[tauri::command]
async fn get_youtube_playlist(
    playlist_id: String,
    first_video_id: String,
) -> Result<Vec<Video>, String> {
    let url = format!(
        "https://www.youtube.com/watch?v={}&list={}",
        first_video_id, playlist_id
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    let re = Regex::new(r"var ytInitialData = (\{.*?\});</script>").unwrap();
    if let Some(caps) = re.captures(&text) {
        let json_str = &caps[1];
        let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

        let mut videos = Vec::new();
        // Playlist panel rendering is same as mix
        if let Some(contents) =
            v.pointer("/contents/twoColumnWatchNextResults/playlist/playlist/contents")
        {
            if let Some(arr) = contents.as_array() {
                for item in arr {
                    if let Some(video) = item.get("playlistPanelVideoRenderer") {
                        let id = video
                            .get("videoId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let title = video
                            .pointer("/title/simpleText")
                            .and_then(|v| v.as_str())
                            .or_else(|| {
                                video.pointer("/title/runs/0/text").and_then(|v| v.as_str())
                            })
                            .unwrap_or("")
                            .to_string();
                        let thumbnail = video
                            .pointer("/thumbnail/thumbnails/0/url")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let duration = video
                            .pointer("/lengthText/simpleText")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let channel = video
                            .pointer("/shortBylineText/runs/0/text")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        if !id.is_empty() && !title.is_empty() {
                            // These are individual tracks
                            videos.push(Video {
                                id,
                                title,
                                thumbnail,
                                duration,
                                channel,
                                is_playlist: false,
                                track_count: None,
                                first_video_id: None,
                            });
                        }
                    }
                    if videos.len() >= 200 {
                        // Max fetch 200 items for a playlist
                        break;
                    }
                }
            }
        }
        return Ok(videos);
    }

    Err("ytInitialData not found in playlist".to_string())
}



#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn scrape_chords(
    id: String,
    title: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;
    let cache_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("chords_cache_v4");
    let _ = std::fs::create_dir_all(&cache_dir);

    let safe_id = id.replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "");
    let cache_file = cache_dir.join(format!("{}.json", safe_id));

    if cache_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&cache_file) {
            return Ok(content);
        }
    }

    let mut clean_title = title.clone();
    if let Some(idx) = clean_title.find('[') {
        clean_title.truncate(idx);
    }
    if let Some(idx) = clean_title.find('(') {
        clean_title.truncate(idx);
    }
    if let Some(idx) = clean_title.find('{') {
        clean_title.truncate(idx);
    }
    if let Some(idx) = clean_title.find('|') {
        clean_title.truncate(idx);
    }

    let clean_title_alphanum = clean_title.replace(|c: char| !c.is_alphanumeric() && c != ' ', "");
    let words: Vec<&str> = clean_title_alphanum.split_whitespace().take(6).collect();
    let query_str = words.join("+");

    // Primary: Chordify search using the YouTube video URL (most accurate version match)
    let search_url = format!(
        "https://chordify.net/search/https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D{}",
        id
    );
    // Fallback: Google site-search for when Chordify gates behind login
    let google_fallback_url = format!(
        "https://www.google.com/search?q=site:chordify.net+{}",
        query_str
    );

    // Close any existing scraper windows to prevent concurrent request abuse
    for (label, window) in app_handle.webview_windows() {
        if label.starts_with("scraper_") {
            println!(
                "Killing existing scraper window to prevent concurrency abuse: {}",
                label
            );
            let _ = window.destroy();
        }
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    static WINDOW_COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let counter = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let window_label = format!("scraper_{}_{}_{}", safe_id, ts, counter);

    // JS uses format! (not r#) so we can embed the google_fallback_url at compile time
    let js_code = format!(r#"
        (function() {{
            // ── GOOGLE FALLBACK HANDLER ─────────────────────────────────────────
            if (window.location.hostname.includes("google.")) {{
                let googleAttempts = 0;
                let checkGoogle = setInterval(() => {{
                    googleAttempts++;
                    let link = document.querySelector('a[href*="chordify.net/chords/"]:not([href*="translate"])');
                    
                    if (document.body && document.body.innerText && document.body.innerText.includes("unusual traffic")) {{
                        clearInterval(checkGoogle);
                        let err = encodeURIComponent(JSON.stringify({{success: false, error: "Google blocked search (CAPTCHA).", data: null}}));
                        window.location.replace("https://chordify.net/?scraper_result=" + err);
                        return;
                    }}
                    
                    if (link) {{
                        clearInterval(checkGoogle);
                        window.location.replace(link.href);
                    }} else if (googleAttempts > 20) {{ // Timeout after 10 seconds
                        clearInterval(checkGoogle);
                        let err = encodeURIComponent(JSON.stringify({{success: false, error: "Not found on Chordify", data: null}}));
                        window.location.replace("https://chordify.net/?scraper_result=" + err);
                    }}
                }}, 500);
                return;
            }}

            if (!window.location.hostname.includes("chordify.net")) return;
            
            // Stealth overrides to bypass Cloudflare bot detection
            try {{
                Object.defineProperty(navigator, 'webdriver', {{ get: () => undefined }});
                window.chrome = {{ runtime: {{}} }};
                if (!navigator.plugins || navigator.plugins.length === 0) {{
                    Object.defineProperty(navigator, 'plugins', {{ get: () => [1, 2, 3] }});
                }}
                if (!navigator.languages || navigator.languages.length === 0) {{
                    Object.defineProperty(navigator, 'languages', {{ get: () => ['en-US', 'en'] }});
                }}
            }} catch(e) {{}}

            // Clear storage immediately to bypass Chordify's JS-based daily limits
            try {{
                window.localStorage.clear();
                window.sessionStorage.clear();
                document.cookie.split(";").forEach(function(c) {{ 
                    document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
                }});
            }} catch(e) {{}}
            
            let attempts = 0;
            let checkInterval = setInterval(() => {{
                attempts++;
                
                // ── SIGNUP / SIGNIN WALL (redirect) → signal Rust to open fresh Google window ─
                if (window.location.pathname.startsWith('/user/signup') || window.location.pathname.startsWith('/user/signin')) {{
                    clearInterval(checkInterval);
                    console.log('[NadaNada] Chordify login redirect – signalling Google fallback');
                    window.location.replace("https://chordify.net/?scraper_result=GOOGLE_FALLBACK");
                    return;
                }}

                // ── SIGNUP MODAL POPUP (overlay on search page) → same fallback ────
                // Use form selector (structural) + textContent (not innerText, which can miss hidden elements)
                if (document.querySelector('form[action="/user/signup"]') ||
                    (document.body && document.body.textContent && document.body.textContent.includes("Please sign up to add new songs to Chordify"))) {{
                    clearInterval(checkInterval);
                    console.log('[NadaNada] Chordify signup modal detected – signalling Google fallback');
                    window.location.replace("https://chordify.net/?scraper_result=GOOGLE_FALLBACK");
                    return;
                }}
                
                if (attempts > 80) {{
                    clearInterval(checkInterval);
                    let err = encodeURIComponent(JSON.stringify({{success: false, error: "Timeout waiting for chords", data: null}}));
                    window.location.replace("https://chordify.net/?scraper_result=" + err);
                    return;
                }}
                
                if (document.body && document.body.textContent && (document.body.textContent.includes("Ribbit! Nothing here") || document.querySelectorAll('img[src*="404"]').length > 0)) {{
                    clearInterval(checkInterval);
                    let err = encodeURIComponent(JSON.stringify({{success: false, error: "Song not found or IP blocked by Chordify (404)", data: null}}));
                    window.location.replace("https://chordify.net/?scraper_result=" + err);
                    return;
                }}
                
                // ── CHORDIFY SEARCH RESULTS PAGE ─────────────────────────────────
                if (window.location.pathname.startsWith('/search/')) {{
                    let chordLinks = document.querySelectorAll('a[href^="/chords/"]');
                    let allLinks = document.querySelectorAll('a[href^="/search/"]');
                    if (chordLinks.length > 0) {{
                        clearInterval(checkInterval);
                        // Add human delay before clicking to avoid bot detection
                        setTimeout(() => {{
                            window.location.href = chordLinks[0].href;
                        }}, 1500 + Math.random() * 1500);
                    }} else if (document.body.textContent.includes("No results found")) {{
                        // Chordify search yielded nothing – signal Rust to open fresh Google window
                        clearInterval(checkInterval);
                        console.log('[NadaNada] Chordify search found no results – signalling Google fallback');
                        window.location.replace("https://chordify.net/?scraper_result=GOOGLE_FALLBACK");
                        return;
                    }} else if (allLinks.length > 0 && attempts > 6) {{
                        // Results exist but none lead to /chords/ – song is signup-gated
                        clearInterval(checkInterval);
                        console.log('[NadaNada] Chordify results are signup-gated – signalling Google fallback');
                        window.location.replace("https://chordify.net/?scraper_result=GOOGLE_FALLBACK");
                        return;
                    }}
                }} 
                // ── CHORDIFY CHORD PAGE ───────────────────────────────────────────
                else if (window.location.pathname.startsWith('/chords/')) {{
                    let chordElements = document.querySelectorAll('.chord');
                    let scrollEl = document.querySelector('[data-bpm]');
                    let bpmMatch = document.body.textContent.match(/BPM\s*(\d{{2,3}})/i);
                    
                    // Wait for both chords AND BPM to load (or fallback after 5 seconds of seeing chords)
                    if (chordElements.length > 0) {{
                        if (!scrollEl && !bpmMatch && attempts < 40) {{
                            return; // Wait a bit longer for the sidebar to load asynchronously
                        }}
                        
                        clearInterval(checkInterval);
                        
                        let chords = [];
                        let bpm = 120;
                        
                        if (scrollEl) {{
                            bpm = parseFloat(scrollEl.getAttribute('data-bpm')) || 120;
                        }} else if (bpmMatch) {{
                            bpm = parseFloat(bpmMatch[1]) || 120;
                        }}
                        let secondsPerBeat = 60.0 / bpm;
                        
                        let seenBeats = new Set();
                        for (let el of chordElements) {{
                            if (!el.hasAttribute('data-i')) continue;
                            
                            let beatIdx = parseInt(el.getAttribute('data-i'));
                            if (seenBeats.has(beatIdx)) continue;
                            
                            let text = el.innerText.trim();
                            if (text && text !== '' && !el.classList.contains('nolabel')) {{
                                chords.push({{
                                    beat: beatIdx + 1,
                                    time_sec: beatIdx * secondsPerBeat,
                                    chord: text
                                }});
                                seenBeats.add(beatIdx);
                            }}
                        }}
                        
                        chords.sort((a, b) => a.time_sec - b.time_sec);
                        
                        let result = {{
                            success: true,
                            data: {{ bpm: bpm, chords: chords }},
                            error: null
                        }};
                        
                        let payload = encodeURIComponent(JSON.stringify(result));
                        window.location.replace("https://chordify.net/?scraper_result=" + payload);
                        return;
                    }}
                }}
            }}, 500);
        }})();
    "#);

    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx_mutex = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_mutex_clone = tx_mutex.clone();

    println!("Building hidden scraper window for URL: {}", search_url);
    let window = match tauri::WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        tauri::WebviewUrl::External(search_url.parse().unwrap()),
    )
    .incognito(true)
    .visible(false)
    .initialization_script(&js_code)
    .on_navigation(move |url| {
        println!("Navigating to: {}", url.as_str());
        let mut got_result = false;
        let mut json_str = String::new();

        for (key, value) in url.query_pairs() {
            if key == "scraper_result" {
                got_result = true;
                json_str = value.into_owned();
                break;
            }
        }

        if got_result {
            if let Ok(mut guard) = tx_mutex_clone.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(json_str);
                }
            }
            return false; // Cancel navigation
        }
        true
    })
    .build()
    {
        Ok(w) => w,
        Err(e) => {
            if let Some(w) = app_handle.get_webview_window(&window_label) {
                let _ = w.destroy();
            }
            return Err(format!("Failed to build window: {}", e));
        }
    };

    println!("Waiting for scraper result...");
    // Wait for the result with a 45-second timeout
    let result_str = match tokio::time::timeout(std::time::Duration::from_secs(45), rx).await {
        Ok(Ok(data)) => {
            println!("Got result from scraper!");
            data
        }
        _ => {
            println!("Scraper timed out!");
            let _ = window.destroy();
            return Err("Timeout waiting for scraper".to_string());
        }
    };

    let _ = window.destroy();

    if result_str.trim().is_empty() {
        return Err("Scraper returned empty output".to_string());
    }

    // ── GOOGLE FALLBACK: open a brand new fresh incognito window ─────────────
    let result_str = if result_str.trim() == "GOOGLE_FALLBACK" {
        println!("Chordify fallback triggered – opening fresh incognito window at Google");

        let ts2 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let counter2 = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let window_label2 = format!("scraper_{}_{}_{}", safe_id, ts2, counter2);

        let (tx2, rx2) = tokio::sync::oneshot::channel();
        let tx_mutex2 = std::sync::Arc::new(std::sync::Mutex::new(Some(tx2)));
        let tx_mutex2_clone = tx_mutex2.clone();

        let window2 = match tauri::WebviewWindowBuilder::new(
            &app_handle,
            &window_label2,
            tauri::WebviewUrl::External(google_fallback_url.parse().unwrap()),
        )
        .incognito(true)
        .visible(false)
        .initialization_script(&js_code)
        .on_navigation(move |url| {
            println!("[Google fallback] Navigating to: {}", url.as_str());
            let mut got_result = false;
            let mut json_str = String::new();
            for (key, value) in url.query_pairs() {
                if key == "scraper_result" {
                    got_result = true;
                    json_str = value.into_owned();
                    break;
                }
            }
            if got_result {
                if let Ok(mut guard) = tx_mutex2_clone.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(json_str);
                    }
                }
                return false;
            }
            true
        })
        .build()
        {
            Ok(w) => w,
            Err(e) => return Err(format!("Failed to build Google fallback window: {}", e)),
        };

        println!("Waiting for Google fallback scraper result...");
        match tokio::time::timeout(std::time::Duration::from_secs(45), rx2).await {
            Ok(Ok(data)) => {
                println!("Got result from Google fallback scraper!");
                let _ = window2.destroy();
                data
            }
            _ => {
                println!("Google fallback scraper timed out!");
                let _ = window2.destroy();
                return Err("Timeout waiting for Google fallback scraper".to_string());
            }
        }
    } else {
        result_str
    };
    // ─────────────────────────────────────────────────────────────────────────

    if result_str.contains("\"success\": true") || result_str.contains("\"success\":true") {
        let _ = std::fs::write(&cache_file, &result_str);
    }

    Ok(result_str)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DownloadedSong {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub is_local: bool,
    pub file_path: String,
}

#[tauri::command]
async fn download_song(id: String, title: String, artist: String) -> Result<String, String> {
    let url = format!("https://www.youtube.com/watch?v={}", id);

    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }

    let exe_path = data_dir.join("yt-dlp.exe");
    if !exe_path.exists() {
        let bytes =
            reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
                .await
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
        fs::write(&exe_path, bytes).map_err(|e| e.to_string())?;
    }

    let mut music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| PathBuf::from(".")));
    music_dir.push("NadaNada");

    if !music_dir.exists() {
        fs::create_dir_all(&music_dir).map_err(|e| e.to_string())?;
    }

    let safe_artist = artist.replace(
        |c: char| {
            c == '\\'
                || c == '/'
                || c == ':'
                || c == '*'
                || c == '?'
                || c == '"'
                || c == '<'
                || c == '>'
                || c == '|'
        },
        "",
    );
    let safe_title = title.replace(
        |c: char| {
            c == '\\'
                || c == '/'
                || c == ':'
                || c == '*'
                || c == '?'
                || c == '"'
                || c == '<'
                || c == '>'
                || c == '|'
        },
        "",
    );

    // If the frontend couldn't find a real artist (e.g. "Release - Topic" or "Unknown"),
    // let yt-dlp extract it from deep metadata. Otherwise, trust the frontend's clean parsing!
    let out_template = if safe_artist.trim().eq_ignore_ascii_case("release")
        || safe_artist.trim().eq_ignore_ascii_case("unknown")
        || safe_artist.trim().is_empty()
    {
        music_dir
            .join("%(artist,uploader)s - %(title)s.%(ext)s")
            .to_string_lossy()
            .to_string()
    } else {
        music_dir
            .join(format!(
                "{} - {}.%(ext)s",
                safe_artist.trim(),
                safe_title.trim()
            ))
            .to_string_lossy()
            .to_string()
    };

    let mut command = Command::new(&exe_path);
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }
    
    let output = command
        .arg("--js-runtimes")
        .arg("node")
        .arg("--replace-in-metadata")
        .arg("uploader")
        .arg(" - Topic")
        .arg("")
        .arg("--replace-in-metadata")
        .arg("title")
        .arg(r"(?i)(?:official|music|video|audio|hd|hq|lyrics|\[.*?\]|\(.*?\))")
        .arg("")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("--no-simulate")
        .arg("-f")
        .arg("bestaudio[ext=m4a]/bestaudio")
        .arg("-o")
        .arg(&out_template)
        .arg(url)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Use the stdout from yt-dlp which contains the exact final filepath because of `--print after_move:filepath`
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let final_path = stdout_str.trim().lines().last().unwrap_or("").trim().to_string();
    
    if final_path.is_empty() {
        return Err("yt-dlp succeeded but did not output a filepath".to_string());
    }

    let _lock = IO_LOCK.lock().unwrap();
    let registry_path = data_dir.join("youtube_downloads.json");
    let mut registry: std::collections::HashMap<String, String> = if registry_path.exists() {
        if let Ok(content) = fs::read_to_string(&registry_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        }
    } else {
        std::collections::HashMap::new()
    };
    registry.insert(final_path, id);
    let _ = fs::write(&registry_path, serde_json::to_string(&registry).unwrap_or_default());

    Ok("".to_string()) // The frontend ignores this return value and scans the directory
}

#[tauri::command]
fn get_downloaded_songs() -> Result<Vec<DownloadedSong>, String> {
    let mut music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| PathBuf::from(".")));
    music_dir.push("NadaNada");

    let mut songs = Vec::new();

    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    
    let _lock = IO_LOCK.lock().unwrap();
    let hidden_json_path = data_dir.join("hidden_downloads.json");
    let hidden_paths: Vec<String> = if hidden_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&hidden_json_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };
    
    let registry_path = data_dir.join("youtube_downloads.json");
    let registry: std::collections::HashMap<String, String> = if registry_path.exists() {
        if let Ok(content) = fs::read_to_string(&registry_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        }
    } else {
        std::collections::HashMap::new()
    };

    if music_dir.exists() {
        for entry in fs::read_dir(music_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let path_str = path.to_string_lossy().to_string();
                if hidden_paths.contains(&path_str) {
                    continue;
                }
                if let Some(ext) = path.extension() {
                    if ext == "m4a" || ext == "mp3" || ext == "webm" {
                        if let Some(file_name) = path.file_stem().and_then(|n| n.to_str()) {
                            let parts: Vec<&str> = file_name.splitn(2, " - ").collect();
                            let (artist, title) = if parts.len() == 2 {
                                (parts[0].to_string(), parts[1].to_string())
                            } else {
                                ("Unknown".to_string(), file_name.to_string())
                            };

                            let song_id = registry.get(&path_str).cloned().unwrap_or_else(|| path_str.clone());

                            songs.push(DownloadedSong {
                                id: song_id,
                                title,
                                channel: artist,
                                is_local: true,
                                file_path: path_str,
                            });
                        }
                    }
                }
            }
        }
    }

    // Now merge from local_songs.json
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    let json_path = data_dir.join("local_songs.json");
    
    if json_path.exists() {
        if let Ok(content) = fs::read_to_string(&json_path) {
            if let Ok(local_paths) = serde_json::from_str::<Vec<String>>(&content) {
                let mut valid_paths = Vec::new();
                let mut changed = false;
                
                for path_str in local_paths {
                    let path = PathBuf::from(&path_str);
                    if path.exists() && path.is_file() {
                        valid_paths.push(path_str.clone());
                        
                        if let Some(file_name) = path.file_stem().and_then(|n| n.to_str()) {
                            let parts: Vec<&str> = file_name.splitn(2, " - ").collect();
                            let (artist, title) = if parts.len() == 2 {
                                (parts[0].to_string(), parts[1].to_string())
                            } else {
                                ("Unknown".to_string(), file_name.to_string())
                            };
                            
                            // Check if not already in songs to avoid duplicates if they selected the download folder
                            let is_dup = songs.iter().any(|s| s.file_path == path_str);
                            if !is_dup {
                                songs.push(DownloadedSong {
                                    id: path_str.clone(),
                                    title,
                                    channel: artist,
                                    is_local: true,
                                    file_path: path_str,
                                });
                            }
                        }
                    } else {
                        changed = true; // A path doesn't exist anymore, we will filter it out
                    }
                }
                
                if changed {
                    let _ = fs::write(&json_path, serde_json::to_string(&valid_paths).unwrap_or_default());
                }
            }
        }
    }

    Ok(songs)
}

#[tauri::command]
fn add_local_song(file_path: String) -> Result<(), String> {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    
    let _lock = IO_LOCK.lock().unwrap();
    let json_path = data_dir.join("local_songs.json");
    let mut local_paths: Vec<String> = if json_path.exists() {
        if let Ok(content) = fs::read_to_string(&json_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };
    
    if !local_paths.contains(&file_path) {
        local_paths.push(file_path);
        fs::write(&json_path, serde_json::to_string(&local_paths).unwrap_or_default()).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
fn delete_downloaded_song(file_path: String) -> Result<(), String> {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    
    // 1. Remove from local_songs.json if it exists there
    let _lock = IO_LOCK.lock().unwrap();
    let local_json_path = data_dir.join("local_songs.json");
    if local_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&local_json_path) {
            if let Ok(mut local_paths) = serde_json::from_str::<Vec<String>>(&content) {
                let original_len = local_paths.len();
                local_paths.retain(|p| p != &file_path);
                if local_paths.len() < original_len {
                    let _ = fs::write(&local_json_path, serde_json::to_string(&local_paths).unwrap_or_default());
                }
            }
        }
    }
    
    // 2. Add to hidden_downloads.json so it gets ignored during folder scans
    let hidden_json_path = data_dir.join("hidden_downloads.json");
    let mut hidden_paths: Vec<String> = if hidden_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&hidden_json_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };
    
    if !hidden_paths.contains(&file_path) {
        hidden_paths.push(file_path);
        let _ = fs::write(&hidden_json_path, serde_json::to_string(&hidden_paths).unwrap_or_default());
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Prevent the default close behavior
                    api.prevent_close();
                    // Tell the frontend that we want to close, so it can show our custom prompt
                    window.emit("close-requested", ()).unwrap();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            search_youtube,
            get_youtube_mix,
            get_youtube_playlist,
            get_spotify_playlist,
            quit_app,
            scrape_chords,
            download_song,
            get_downloaded_songs,
            add_local_song,
            delete_downloaded_song,
            get_stream_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
