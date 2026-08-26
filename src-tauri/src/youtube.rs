use crate::models::{AlbumInfo, KworbTrack, SpotifyTrack, Video};
use regex::Regex;

#[tauri::command]
pub async fn search_youtube(
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
        .header("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+478")
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
pub async fn get_youtube_mix(video_id: String) -> Result<Vec<Video>, String> {
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
        .header("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+478")
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
pub async fn get_spotify_playlist(playlist_id: String) -> Result<Vec<SpotifyTrack>, String> {
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

    let re =
        Regex::new(r#"<script id="__NEXT_DATA__" type="application/json">(.*?)</script>"#).unwrap();
    if let Some(caps) = re.captures(&text) {
        let json_str = &caps[1];
        let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

        let mut queries = Vec::new();
        if let Some(track_list) = v
            .pointer("/props/pageProps/state/data/entity/trackList")
            .and_then(|v| v.as_array())
        {
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
pub async fn get_youtube_playlist(
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
        .header("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+478")
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
pub async fn get_kworb_chart(region: String) -> Result<Vec<KworbTrack>, String> {
    let url = if region == "global" {
        "https://kworb.net/spotify/country/global_daily.html"
    } else {
        "https://kworb.net/spotify/country/id_daily.html"
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let res = match client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await {
            Ok(r) => r,
            Err(e) => {
                println!("reqwest error: {}", e);
                return Err(e.to_string());
            }
        };

    let text = match res.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("res.text error: {}", e);
            return Err(e.to_string());
        }
    };
    println!("Kworb HTML fetched successfully. Length: {}", text.len());

    let re_cell = Regex::new(r#"(?s)<td class="text mp"><div>(.*?)</div></td>"#).unwrap();
    let re_tag = Regex::new(r#"(?s)<[^>]*>"#).unwrap();

    let mut tracks = Vec::new();
    let mut rank = 1;

    for caps in re_cell.captures_iter(&text) {
        if rank > 50 {
            break;
        }
        let raw_content = &caps[1];
        let clean_text = re_tag.replace_all(raw_content, "").trim().to_string();
        let decoded = clean_text
            .replace("\n", " ")
            .replace("\r", " ")
            .replace("&amp;", "&")
            .replace("&#39;", "'")
            .replace("&quot;", "\"")
            .replace("&lt;", "<")
            .replace("&gt;", ">");
        
        let decoded = Regex::new(r"\s+").unwrap().replace_all(&decoded, " ").trim().to_string();

        if !decoded.is_empty() {
            tracks.push(KworbTrack {
                rank,
                query: decoded,
            });
            rank += 1;
        }
    }

    if tracks.is_empty() {
        println!("Failed to parse tracks from HTML!");
        return Err("Failed to parse Kworb chart data".to_string());
    }

    println!("Successfully parsed {} tracks from Kworb.", tracks.len());
    Ok(tracks)
}

#[tauri::command]
pub async fn get_playlist_title(platform: String, playlist_id: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    if platform == "spotify" {
        let url = format!("https://open.spotify.com/embed/playlist/{}", playlist_id);
        let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
        let text = res.text().await.map_err(|e| e.to_string())?;
        let re = Regex::new(r#"<script id="__NEXT_DATA__" type="application/json">(.*?)</script>"#)
            .unwrap();
        if let Some(caps) = re.captures(&text) {
            let json_str = &caps[1];
            let v: serde_json::Value =
                serde_json::from_str(json_str).unwrap_or(serde_json::Value::Null);
            if let Some(name) = v
                .pointer("/props/pageProps/state/data/entity/name")
                .and_then(|v| v.as_str())
            {
                return Ok(name.to_string());
            }
        }
        return Ok("Imported Spotify Playlist".to_string());
    } else if platform == "youtube" {
        let url = format!("https://www.youtube.com/playlist?list={}", playlist_id);
        let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
        let text = res.text().await.map_err(|e| e.to_string())?;
        let re = Regex::new(r"var ytInitialData = (\{.*?\});</script>").unwrap();
        if let Some(caps) = re.captures(&text) {
            let json_str = &caps[1];
            let v: serde_json::Value =
                serde_json::from_str(json_str).unwrap_or(serde_json::Value::Null);
            if let Some(title) = v
                .pointer("/header/playlistHeaderRenderer/title/simpleText")
                .and_then(|v| v.as_str())
            {
                return Ok(title.to_string());
            }
        }
        return Ok("Imported YouTube Playlist".to_string());
    }

    Err("Unknown platform".to_string())
}

#[tauri::command]
pub async fn get_video_album_info(video_id: String) -> Result<AlbumInfo, String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    
    // 1. Run yt-dlp for reliable album/artist extraction (YouTube's JSON structure is too flaky)
    let exe_path = crate::downloads::get_yt_dlp_path().await?;
    let mut cmd = tokio::process::Command::new(exe_path);
    cmd.stdin(std::process::Stdio::null())
        .arg("--print")
        .arg("%(album)s|||%(artist)s")
        .arg("--no-download")
        .arg("--no-warnings")
        .arg(&url);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    #[cfg(not(target_os = "windows"))]
    {
        let current_path =
            std::env::var("PATH").unwrap_or_else(|_| String::from("/usr/bin:/bin:/usr/sbin:/sbin"));
        cmd.env(
            "PATH",
            format!(
                "{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin",
                current_path
            ),
        );
    }

    // 2. Scrape the page for the OLAK5uy_ playlist ID
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
        
    let mut album_playlist_id = String::new();
    if let Ok(res) = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+478")
        .send()
        .await 
    {
        if let Ok(text) = res.text().await {
            let olak_re = Regex::new(r"OLAK5uy_[a-zA-Z0-9_\-]+").unwrap();
            album_playlist_id = olak_re.find(&text)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
        }
    }

    let mut album = String::new();
    let mut artist = String::new();

    let output_res = tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await;

    if let Ok(Ok(output)) = output_res {
        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parts: Vec<&str> = raw.splitn(2, "|||").collect();
            if parts.len() == 2 {
                album = parts[0].trim().to_string();
                artist = parts[1].trim().to_string();
                if album == "NA" { album = String::new(); }
                if artist == "NA" { artist = String::new(); }
            }
        }
    }

    Ok(AlbumInfo {
        album,
        artist,
        album_playlist_id,
    })
}
