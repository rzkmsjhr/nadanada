use crate::models::{AlbumInfo, KworbTrack, SpotifyTrack, Video};
use regex::Regex;

const YTM_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn get_ytm_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Parses an item from YouTube Music's musicResponsiveListItemRenderer with a default item_type
fn parse_ytm_item_with_type(r: &serde_json::Value, default_type: &str) -> Option<Video> {
    let video_id = r.pointer("/playlistItemData/videoId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            r.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/navigationEndpoint/watchEndpoint/videoId")
                .and_then(|v| v.as_str())
        })?
        .to_string();

    if video_id.is_empty() {
        return None;
    }

    let title = r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/text")
        .or_else(|| r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/title/runs/0/text"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if title.is_empty() {
        return None;
    }

    // Check fixedColumns for explicit duration
    let fixed_dur = r.pointer("/fixedColumns/0/musicResponsiveListItemFixedColumnRenderer/text/runs/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let flex1_runs = r.pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")
        .or_else(|| r.pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/title/runs"))
        .and_then(|v| v.as_array());

    let mut artist = String::new();
    let mut duration = fixed_dur.to_string();

    if let Some(runs) = flex1_runs {
        let texts: Vec<&str> = runs.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect();
        let full_meta = texts.concat();
        let parts: Vec<&str> = full_meta.split(" • ").collect();

        if duration.is_empty() {
            if let Some(last) = parts.last() {
                if last.contains(':') {
                    duration = last.trim().to_string();
                }
            }
        }

        if let Some(first) = parts.first() {
            artist = first.trim().to_string();
        }
    }

    let thumbnail = r.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last().or_else(|| arr.first()))
        .and_then(|thumb| thumb.get("url").and_then(|u| u.as_str()))
        .unwrap_or("")
        .to_string();

    Some(Video {
        id: video_id,
        title,
        thumbnail,
        duration,
        channel: artist,
        is_playlist: false,
        track_count: None,
        first_video_id: None,
        item_type: Some(default_type.to_string()),
    })
}

/// Parses an item from YouTube Music's musicResponsiveListItemRenderer into a "song" Video
fn parse_ytm_song_item(r: &serde_json::Value) -> Option<Video> {
    parse_ytm_item_with_type(r, "song")
}

/// Parses an album item from YouTube Music into an "album" Video
fn parse_ytm_album_item(r: &serde_json::Value) -> Option<Video> {
    let title = r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/text")
        .or_else(|| r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/title/runs/0/text"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if title.is_empty() {
        return None;
    }

    let playlist_id = r.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchPlaylistEndpoint/playlistId")
        .or_else(|| r.pointer("/navigationEndpoint/browseEndpoint/browseId"))
        .or_else(|| r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/navigationEndpoint/browseEndpoint/browseId"))
        .or_else(|| r.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/playlistId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if playlist_id.is_empty() {
        return None;
    }

    let first_video_id = r.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId")
        .or_else(|| r.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchPlaylistEndpoint/videoId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let flex1_runs = r.pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")
        .or_else(|| r.pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/title/runs"))
        .and_then(|v| v.as_array());

    let mut channel = String::new();
    if let Some(runs) = flex1_runs {
        let texts: Vec<&str> = runs.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect();
        channel = texts.concat();
    }

    let thumbnail = r.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last().or_else(|| arr.first()))
        .and_then(|thumb| thumb.get("url").and_then(|u| u.as_str()))
        .unwrap_or("")
        .to_string();

    Some(Video {
        id: playlist_id,
        title,
        thumbnail,
        duration: String::new(),
        channel,
        is_playlist: true,
        track_count: None,
        first_video_id,
        item_type: Some("album".to_string()),
    })
}

/// Search YouTube Music using the WEB_REMIX client (prioritizing Songs and Albums)
async fn search_youtube_music(query: &str, search_type: Option<&str>) -> Result<Vec<Video>, String> {
    let client = get_ytm_client();
    let is_album = search_type == Some("album");
    let is_video = search_type == Some("video");
    let params = if is_album {
        "EgWKAQIYAWoOEAQQAxAFEAkQEBAKEBU%3D" // Albums filter
    } else if is_video {
        "EgWKAQIQAWoOEAQQAxAFEAkQEBAKEBU%3D" // Videos filter
    } else {
        "EgWKAQIIAWoOEAQQAxAFEAkQEBAKEBU%3D" // Songs filter
    };

    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query,
        "params": params
    });

    let res = client.post("https://music.youtube.com/youtubei/v1/search")
        .header("User-Agent", YTM_USER_AGENT)
        .header("Referer", "https://music.youtube.com/")
        .header("Origin", "https://music.youtube.com")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut videos = Vec::new();

    let sections = v.pointer("/contents/tabbedSearchResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents")
        .and_then(|c| c.as_array());

    if let Some(secs) = sections {
        for s in secs {
            if let Some(shelf) = s.get("musicShelfRenderer") {
                if let Some(contents) = shelf.get("contents").and_then(|c| c.as_array()) {
                    for item in contents {
                        if let Some(r) = item.get("musicResponsiveListItemRenderer") {
                            if is_album {
                                if let Some(v) = parse_ytm_album_item(r) {
                                    videos.push(v);
                                }
                            } else if is_video {
                                if let Some(v) = parse_ytm_item_with_type(r, "video") {
                                    videos.push(v);
                                }
                            } else {
                                if let Some(v) = parse_ytm_song_item(r) {
                                    videos.push(v);
                                }
                            }
                        }
                        if videos.len() >= 20 {
                            break;
                        }
                    }
                }
            }
        }
    }

    Ok(videos)
}

/// Fallback scraper for regular YouTube search (video as last resort)
async fn scrape_regular_youtube_search(
    query: &str,
    search_type: Option<&str>,
) -> Result<Vec<Video>, String> {
    let mut search_query = query.to_string();
    let url = if let Some(st) = search_type {
        if st == "album" {
            format!(
                "https://www.youtube.com/results?search_query={}&sp=EgIQAw%3D%3D",
                urlencoding::encode(&search_query)
            )
        } else {
            search_query.push_str(" topic");
            format!(
                "https://www.youtube.com/results?search_query={}",
                urlencoding::encode(&search_query)
            )
        }
    } else {
        search_query.push_str(" topic");
        format!(
            "https://www.youtube.com/results?search_query={}",
            urlencoding::encode(&search_query)
        )
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
                            videos.push(Video {
                                id,
                                title,
                                thumbnail,
                                duration,
                                channel,
                                is_playlist: false,
                                track_count: None,
                                first_video_id: None,
                                item_type: Some("video".to_string()),
                            });
                        }
                    } else if let Some(playlist) = item.get("playlistRenderer") {
                        let id = playlist.get("playlistId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = playlist.pointer("/title/simpleText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let thumbnail = playlist.pointer("/thumbnails/0/thumbnails/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let track_count = playlist.pointer("/videoCount").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let channel = playlist.pointer("/shortBylineText/runs/0/text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let first_video = playlist.pointer("/navigationEndpoint/watchEndpoint/videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();

                        if !id.is_empty() && !title.is_empty() {
                            videos.push(Video {
                                id,
                                title,
                                thumbnail,
                                duration: "".to_string(),
                                channel,
                                is_playlist: true,
                                track_count: Some(track_count),
                                first_video_id: Some(first_video),
                                item_type: Some("album".to_string()),
                            });
                        }
                    } else if let Some(lockup) = item.get("lockupViewModel") {
                        let lockup_str = lockup.to_string();

                        let mut id = lockup.pointer("/metadata/lockupMetadataViewModel/metadata/runs/0/navigationEndpoint/watchEndpoint/playlistId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = lockup.pointer("/metadata/lockupMetadataViewModel/title/content").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let thumbnail = lockup.pointer("/contentImage/collectionThumbnailViewModel/primaryThumbnail/thumbnailViewModel/image/sources/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();

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
                            videos.push(Video {
                                id,
                                title,
                                thumbnail,
                                duration: "".to_string(),
                                channel: "".to_string(),
                                is_playlist: true,
                                track_count: Some(track_count),
                                first_video_id: Some(first_video),
                                item_type: Some("album".to_string()),
                            });
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

/// Helper to clean title of parenthetical notes like (Mariya Takeuchi 1984), [Cover], etc.
/// Also replaces punctuation that binds words together (like "no,oh" or "yes!") with spaces.
fn clean_title_for_matching(title: &str) -> String {
    let mut clean = String::new();
    let mut depth = 0;
    for c in title.chars() {
        match c {
            '(' | '[' | '（' | '【' => depth += 1,
            ')' | ']' | '）' | '】' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            _ => {
                if depth == 0 {
                    if c == ',' || c == '!' || c == '?' || c == ';' || c == ':' || c == '~' || c == '/' || c == '\\' {
                        clean.push(' ');
                    } else {
                        clean.push(c);
                    }
                }
            }
        }
    }
    clean.to_lowercase()
}

/// Computes a relevance score for a search candidate.
/// Lower is better.
/// - Songs are prioritized over videos (-25 bonus) ONLY when comparing the same song.
/// - If a candidate's title does not match any query terms (different song), it receives a heavy penalty (+350).
/// - If a candidate's channel does not match any artist terms (wrong artist), it receives a heavy penalty (+250).
/// - Mashups, bootlegs, and "OtherArtist ft. TargetArtist" receive heavy penalties (+200 to +300).
fn score_search_candidate(v: &Video, query_words: &[&str]) -> i32 {
    let clean_title = clean_title_for_matching(&v.title);
    let channel_lower = v.channel.to_lowercase();
    let lower_raw_title = v.title.to_lowercase();

    let mut matched_title_words = 0;
    let mut matched_channel_words = 0;

    for &w in query_words {
        if clean_title.contains(w) {
            matched_title_words += 1;
        }
        if channel_lower.contains(w) {
            matched_channel_words += 1;
        }
    }

    let total_matched = query_words
        .iter()
        .filter(|&&w| clean_title.contains(w) || channel_lower.contains(w))
        .count();

    let mut score = 0;

    // Missing query words penalty (60 points per missing word)
    let missing = query_words.len().saturating_sub(total_matched);
    score += (missing as i32) * 60;

    // Title mismatch penalty:
    // If the candidate's clean title matches NONE of the query terms, it is a completely
    // DIFFERENT SONG by the same artist! A different song must NEVER beat the song requested.
    if query_words.len() >= 2 && matched_title_words == 0 {
        score += 350;
    }

    // Check if title has "OtherArtist ft. TargetArtist" format (e.g. "2Pac ft. Mariya Takeuchi")
    // In that case, the main artist is 2Pac, not Mariya Takeuchi!
    let is_ft_lead_mismatch = if let Some(hyphen_idx) = lower_raw_title.find(" - ") {
        let prefix = &lower_raw_title[..hyphen_idx];
        if prefix.contains(" ft. ") || prefix.contains(" ft ") || prefix.contains(" feat. ") || prefix.contains(" feat ") {
            let ft_split = prefix.split(" ft").next().or_else(|| prefix.split(" feat").next()).unwrap_or("");
            !query_words.iter().any(|&w| ft_split.contains(w))
        } else {
            false
        }
    } else {
        false
    };

    if is_ft_lead_mismatch {
        score += 350;
    }

    // Artist mismatch penalty:
    // If query has 3+ words and neither channel nor title prefix matches the artist:
    if query_words.len() >= 3 && matched_channel_words == 0 {
        let title_has_artist = if let Some(hyphen_idx) = lower_raw_title.find(" - ") {
            let prefix = &lower_raw_title[..hyphen_idx];
            query_words.iter().filter(|&w| prefix.contains(w)).count() >= 2
        } else {
            false
        };

        if !title_has_artist {
            let is_label_channel = channel_lower.contains("records")
                || channel_lower.contains("music")
                || channel_lower.contains("vevo")
                || channel_lower.contains("official")
                || channel_lower.contains("topic");

            if !is_label_channel {
                score += 250;
            } else {
                score += 80;
            }
        }
    }

    // Penalize mashups, remixes, bootlegs, sped up, slowed, karaoke if not requested in query
    for bad in &[
        "mashup", "mash-up", "mash up", "bootleg", "remix", 
        "slowed", "reverb", "sped up", "speed up", "nightcore",
        "karaoke", "instrumental", "tribute", "parody"
    ] {
        if lower_raw_title.contains(bad) && !query_words.iter().any(|&w| w == *bad) {
            score += 200;
        }
    }

    // Song bonus: if the candidate matches title and artist, Song takes priority (-25) over Video (0)
    if v.item_type.as_deref() == Some("song") {
        score -= 25;
    }

    score
}

#[tauri::command]
pub async fn search_youtube(
    query: String,
    search_type: Option<String>,
) -> Result<Vec<Video>, String> {
    let st = search_type.as_deref();

    // Clean query of embedded furigana/parentheses for matching
    // e.g. "縁(えにし)の糸 Mariya Takeuchi" -> "縁の糸 mariya takeuchi"
    let clean_query = clean_title_for_matching(&query);

    // 1. Primary: Search YouTube Music ("song", "album", or "video" typed)
    match search_youtube_music(&query, st).await {
        Ok(mut results) if !results.is_empty() => {
            if st.is_none() || st == Some("song") {
                let query_words: Vec<&str> = clean_query
                    .split_whitespace()
                    .filter(|w| !w.is_empty())
                    .collect();

                if query_words.len() >= 2 {
                    // Check if any song strongly matches BOTH title and channel/artist.
                    // A strong match requires:
                    // 1) All query words matched across clean title or channel
                    // 2) Clean title must match at least one query word (to ensure it's not a different song!)
                    // 3) If query has 3+ words, channel must match at least one query word
                    let has_strong_match = results.iter().any(|v| {
                        let clean_title = clean_title_for_matching(&v.title);
                        let channel = v.channel.to_lowercase();
                        let all_matched = query_words
                            .iter()
                            .all(|&w| clean_title.contains(w) || channel.contains(w));
                        let title_matched = query_words.iter().any(|&w| clean_title.contains(w));
                        let channel_matched = if query_words.len() >= 3 {
                            query_words.iter().any(|&w| channel.contains(w))
                        } else {
                            true
                        };
                        all_matched && title_matched && channel_matched
                    });

                    if !has_strong_match {
                        // Song results only returned wrong-artist covers, different songs by same artist, or incomplete matches.
                        // Fetch videos so the original track's video can be ranked!
                        if let Ok(video_results) = search_youtube_music(&query, Some("video")).await {
                            for vid in video_results {
                                if !results.iter().any(|r| r.id == vid.id) {
                                    results.push(vid);
                                }
                            }
                        }
                    }

                    // Sort candidates using score_search_candidate:
                    // Songs are preferred (-25) when artist and title match.
                    // But if a song has the wrong artist or wrong title, the real track's video wins!
                    results.sort_by_key(|v| score_search_candidate(v, &query_words));
                }
            }
            return Ok(results);
        }
        Ok(_) => {
            println!("search_youtube: 0 YTM results for {:?}, falling back to video search", query);
        }
        Err(e) => {
            println!("search_youtube: YTM search error ({}), falling back to video search", e);
        }
    }

    // 2. Fallback: Search regular YouTube (video as last resort)
    scrape_regular_youtube_search(&query, st).await
}

/// Helper function to space out tracks by the same artist (at least 7 tracks apart)
fn space_out_artist_tracks(videos: Vec<Video>) -> Vec<Video> {
    let mut spaced_videos = Vec::new();
    let mut pending = videos;

    if !pending.is_empty() {
        spaced_videos.push(pending.remove(0));
    }

    let get_artist = |v: &Video| -> (String, String) {
        let title = v.title.to_lowercase();
        let channel = v.channel.to_lowercase()
            .replace(" - topic", "")
            .replace("vevo", "")
            .replace("official", "")
            .trim()
            .to_string();
        let title_artist = if let Some(parts) = title.split_once(" - ") {
            parts.0.trim().to_string()
        } else if let Some(parts) = title.split_once(" ~ ") {
            parts.0.trim().to_string()
        } else {
            String::new()
        };
        (title_artist, channel)
    };

    let is_same_artist = |(ta1, ch1): &(String, String), (ta2, ch2): &(String, String)| -> bool {
        let clean = |s: &str| -> String {
            s.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
        };
        let ta1_c = clean(ta1);
        let ch1_c = clean(ch1);
        let ta2_c = clean(ta2);
        let ch2_c = clean(ch2);

        let check_pair = |a: &str, b: &str| -> bool {
            if a.is_empty() || b.is_empty() { return false; }
            if a == b { return true; }
            if a.len() > 3 && b.len() > 3 && (a.contains(b) || b.contains(a)) { return true; }
            false
        };

        check_pair(&ta1_c, &ta2_c)
            || check_pair(&ch1_c, &ch2_c)
            || check_pair(&ta1_c, &ch2_c)
            || check_pair(&ch1_c, &ta2_c)
    };

    while !pending.is_empty() {
        let mut found_index = 0;

        for (i, v) in pending.iter().enumerate() {
            let current_artist = get_artist(v);
            let mut recent_conflict = false;

            let check_len = std::cmp::min(spaced_videos.len(), 7);
            for recent_v in spaced_videos.iter().rev().take(check_len) {
                let recent_artist = get_artist(recent_v);
                if is_same_artist(&current_artist, &recent_artist) {
                    recent_conflict = true;
                    break;
                }
            }

            if !recent_conflict {
                found_index = i;
                break;
            }
        }

        spaced_videos.push(pending.remove(found_index));
    }

    spaced_videos
}

/// YouTube Music Radio Mix via next endpoint (pure Song tracks)
async fn get_ytm_mix_internal(video_id: &str) -> Result<Vec<Video>, String> {
    let client = get_ytm_client();
    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "videoId": video_id,
        "playlistId": format!("RDAMVM{}", video_id),
        "isAudioOnly": true
    });

    let res = client.post("https://music.youtube.com/youtubei/v1/next")
        .header("User-Agent", YTM_USER_AGENT)
        .header("Referer", "https://music.youtube.com/")
        .header("Origin", "https://music.youtube.com")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let contents = v.pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs/0/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")
        .and_then(|c| c.as_array());

    let mut videos = Vec::new();
    if let Some(arr) = contents {
        for item in arr {
            if let Some(video) = item.get("playlistPanelVideoRenderer") {
                let id = video.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let title = video.pointer("/title/runs/0/text")
                    .or_else(|| video.pointer("/title/simpleText"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let thumbnail = video.pointer("/thumbnail/thumbnails/0/url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let duration = video.pointer("/lengthText/runs/0/text")
                    .or_else(|| video.pointer("/lengthText/simpleText"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let channel = video.pointer("/longBylineText/runs/0/text")
                    .or_else(|| video.pointer("/shortBylineText/runs/0/text"))
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
                        item_type: Some("song".to_string()),
                    });
                }
            }
            if videos.len() >= 50 {
                break;
            }
        }
    }

    if videos.is_empty() {
        return Err("No tracks in YTM mix queue".to_string());
    }

    Ok(space_out_artist_tracks(videos))
}

/// Scraper fallback for regular YouTube mix (video as last resort)
async fn scrape_youtube_mix(video_id: &str) -> Result<Vec<Video>, String> {
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
                                item_type: Some("video".to_string()),
                            });
                        }
                    }
                    if videos.len() >= 25 {
                        break;
                    }
                }
            }
        }

        return Ok(space_out_artist_tracks(videos));
    }

    Err("ytInitialData not found in mix".to_string())
}

#[tauri::command]
pub async fn get_youtube_mix(video_id: String) -> Result<Vec<Video>, String> {
    // 1. Primary: YouTube Music Radio (pure Song tracks)
    match get_ytm_mix_internal(&video_id).await {
        Ok(tracks) if !tracks.is_empty() => {
            return Ok(tracks);
        }
        Ok(_) => {}
        Err(e) => {
            println!("get_youtube_mix: YTM radio error ({}), falling back to watch next scraper", e);
        }
    }

    // 2. Fallback: regular YouTube watch next mix scraper (video as last resort)
    scrape_youtube_mix(&video_id).await
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
                    let clean_title = clean_title_for_matching(title);
                    let search_title = if clean_title.trim().is_empty() {
                        title
                    } else {
                        clean_title.trim()
                    };
                    queries.push(SpotifyTrack {
                        title: title.to_string(),
                        artist: artist.to_string(),
                        query: format!("{} {}", search_title, artist).trim().to_string(),
                        duration_ms,
                    });
                }
            }
        }
        return Ok(queries);
    }

    Err("Could not parse Spotify playlist data".to_string())
}

/// Fetch playlist/album tracks via YouTube Music browse API (pure Songs)
async fn get_ytm_playlist_internal(playlist_id: &str) -> Result<Vec<Video>, String> {
    let client = get_ytm_client();
    let browse_id = if playlist_id.starts_with("VL") {
        playlist_id.to_string()
    } else {
        format!("VL{}", playlist_id)
    };

    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "browseId": browse_id
    });

    let res = client.post("https://music.youtube.com/youtubei/v1/browse")
        .header("User-Agent", YTM_USER_AGENT)
        .header("Referer", "https://music.youtube.com/")
        .header("Origin", "https://music.youtube.com")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let shelf_contents = v.pointer("/contents/twoColumnBrowseResultsRenderer/secondaryContents/sectionListRenderer/contents/0/musicPlaylistShelfRenderer/contents")
        .or_else(|| {
            v.pointer("/contents/singleColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/musicPlaylistShelfRenderer/contents")
        })
        .or_else(|| {
            v.pointer("/contents/twoColumnBrowseResultsRenderer/secondaryContents/sectionListRenderer/contents/0/musicShelfRenderer/contents")
        })
        .and_then(|c| c.as_array());

    let mut videos = Vec::new();
    if let Some(arr) = shelf_contents {
        for item in arr {
            if let Some(r) = item.get("musicResponsiveListItemRenderer") {
                if let Some(song) = parse_ytm_song_item(r) {
                    videos.push(song);
                }
            }
            if videos.len() >= 200 {
                break;
            }
        }
    }

    if videos.is_empty() {
        return Err("No tracks found via YTM browse".to_string());
    }

    Ok(videos)
}

/// Fallback scraper for regular YouTube playlists (video as last resort)
async fn scrape_youtube_playlist(
    playlist_id: &str,
    first_video_id: &str,
) -> Result<Vec<Video>, String> {
    let url = if !first_video_id.is_empty() {
        format!(
            "https://www.youtube.com/watch?v={}&list={}",
            first_video_id, playlist_id
        )
    } else {
        format!("https://www.youtube.com/playlist?list={}", playlist_id)
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

        // 1. Try watch next panel contents
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
                                item_type: Some("video".to_string()),
                            });
                        }
                    }
                    if videos.len() >= 200 {
                        break;
                    }
                }
            }
        }

        // 2. Try playlist page renderer contents if watch next panel was not found
        if videos.is_empty() {
            if let Some(contents) = v.pointer("/contents/twoColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/itemSectionRenderer/contents/0/playlistVideoListRenderer/contents") {
                if let Some(arr) = contents.as_array() {
                    for item in arr {
                        if let Some(video) = item.get("playlistVideoRenderer") {
                            let id = video.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let title = video.pointer("/title/runs/0/text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let thumbnail = video.pointer("/thumbnail/thumbnails/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let duration = video.pointer("/lengthText/simpleText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let channel = video.pointer("/shortBylineText/runs/0/text").and_then(|v| v.as_str()).unwrap_or("").to_string();

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
                                    item_type: Some("video".to_string()),
                                });
                            }
                        }
                        if videos.len() >= 200 {
                            break;
                        }
                    }
                }
            }
        }

        return Ok(videos);
    }

    Err("ytInitialData not found in playlist".to_string())
}

#[tauri::command]
pub async fn get_youtube_playlist(
    playlist_id: String,
    first_video_id: String,
) -> Result<Vec<Video>, String> {
    // 1. Primary: YouTube Music Browse (pure Song tracks for albums & playlists)
    match get_ytm_playlist_internal(&playlist_id).await {
        Ok(tracks) if !tracks.is_empty() => {
            return Ok(tracks);
        }
        Ok(_) => {}
        Err(e) => {
            println!("get_youtube_playlist: YTM browse error ({}), falling back to watch panel scraper", e);
        }
    }

    // 2. Fallback: regular YouTube playlist / watch panel scraper (video as last resort)
    scrape_youtube_playlist(&playlist_id, &first_video_id).await
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ytm_search_song() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let results = search_youtube("saujana bilal indrajaya".to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results.is_empty(), "Should find songs for Saujana");
            let top = &results[0];
            println!("Found song: {} by {}", top.title, top.channel);
            assert_eq!(top.item_type.as_deref(), Some("song"), "Top result should be a song");
            assert!(top.title.to_lowercase().contains("saujana"), "Title should contain saujana");
        });
    }

    #[test]
    fn test_ytm_search_album() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let results = search_youtube("nelangsa pasar turi".to_string(), Some("album".to_string()))
                .await
                .expect("Album search should succeed");
            assert!(!results.is_empty(), "Should find albums");
            let top = &results[0];
            println!("Found album: {} (id: {})", top.title, top.id);
            assert_eq!(top.item_type.as_deref(), Some("album"), "Top result should be an album");
            assert!(top.is_playlist, "Album should be marked as playlist");
        });
    }

    #[test]
    fn test_ytm_mix_endless_play() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let tracks = get_youtube_mix("MAMSXxLnpXE".to_string())
                .await
                .expect("Mix should succeed");
            assert!(!tracks.is_empty(), "Mix should return tracks");
            println!("Mix returned {} tracks, first: {} by {}", tracks.len(), tracks[0].title, tracks[0].channel);
            assert_eq!(tracks[0].item_type.as_deref(), Some("song"), "Mix tracks should be songs");
        });
    }

    #[test]
    fn test_ytm_playlist_browse() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let tracks = get_youtube_playlist("OLAK5uy_nw7jqj_0l7BJ1s1b1pmlyGsWcNE1W2QK0".to_string(), "".to_string())
                .await
                .expect("Playlist browse should succeed");
            assert!(!tracks.is_empty(), "Album playlist should contain tracks");
            println!("Album playlist returned {} tracks, first: {}", tracks.len(), tracks[0].title);
            assert_eq!(tracks[0].item_type.as_deref(), Some("song"), "Playlist tracks should be songs");
        });
    }

    #[test]
    fn test_ytm_search_wrong_artist_video_fallback() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            // 1. OH NO,OH YES! by Mariya Takeuchi (must reject 2Pac mashup and Tokimeki cover)
            let results_ohno = search_youtube("OH NO,OH YES! Mariya Takeuchi".to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_ohno.is_empty(), "OH NO,OH YES search should return results");
            let top_ohno = &results_ohno[0];
            println!("Top OH NO result: title={:?}, channel={:?}", top_ohno.title, top_ohno.channel);
            assert!(
                top_ohno.title.to_lowercase().contains("mariya takeuchi - oh no") || top_ohno.channel.to_lowercase().contains("mariya takeuchi"),
                "Top result must be Mariya Takeuchi's Oh No Oh Yes, not a 2Pac mashup! Got: title={} channel={}",
                top_ohno.title, top_ohno.channel
            );
            assert!(
                !top_ohno.title.to_lowercase().contains("2pac"),
                "Must not pick 2Pac mashup! Got: {}",
                top_ohno.title
            );

            // 2. Enishi no Ito by Mariya Takeuchi (parenthetical furigana in query)
            let results_enishi = search_youtube("縁(えにし)の糸 Mariya Takeuchi".to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_enishi.is_empty(), "Enishi search should return results");
            let top_enishi = &results_enishi[0];
            assert!(
                top_enishi.title.contains("縁の糸") || top_enishi.title.contains("Enishi"),
                "Top result must be 縁の糸, not a completely different song! Got: {}",
                top_enishi.title
            );

            // 3. Plastic Love by Mariya Takeuchi (official video should beat wrong-artist covers)
            let results_plastic = search_youtube("Plastic Love Mariya Takeuchi".to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_plastic.is_empty(), "Plastic Love search should return results");
            let top_plastic = &results_plastic[0];
            let top_plastic_channel = top_plastic.channel.to_lowercase();
            assert!(
                top_plastic_channel.contains("mariya") || top_plastic_channel.contains("takeuchi"),
                "Top result should be Mariya Takeuchi, not a cover! Got channel: {}",
                top_plastic.channel
            );
        });
    }
}

