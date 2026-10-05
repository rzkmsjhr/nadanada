use crate::models::{AlbumInfo, ArtistDetails, ArtistSong, KworbTrack, SpotifyTrack, Video};
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

    let title_lower = title.to_lowercase();
    let channel_lower = artist.to_lowercase();
    let is_video = title_lower.contains("official music video")
        || title_lower.contains("official video")
        || title_lower.contains("music video")
        || title_lower.contains("lyric video")
        || title_lower.contains("visualizer")
        || title_lower.contains("[mv]")
        || title_lower.contains("(mv)")
        || channel_lower.contains("vevo")
        || default_type == "video";

    Some(Video {
        id: video_id,
        title,
        thumbnail,
        duration,
        channel: artist,
        is_playlist: false,
        track_count: None,
        first_video_id: None,
        item_type: Some(if is_video { "video".to_string() } else { default_type.to_string() }),
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

/// Helper to parse duration string (e.g. "3:33", "1:46:12") into seconds
fn parse_duration_secs(dur: &str) -> u64 {
    let parts: Vec<&str> = dur.trim().split(':').collect();
    match parts.len() {
        3 => {
            let h: u64 = parts[0].parse().unwrap_or(0);
            let m: u64 = parts[1].parse().unwrap_or(0);
            let s: u64 = parts[2].parse().unwrap_or(0);
            h * 3600 + m * 60 + s
        }
        2 => {
            let m: u64 = parts[0].parse().unwrap_or(0);
            let s: u64 = parts[1].parse().unwrap_or(0);
            m * 60 + s
        }
        1 => parts[0].parse().unwrap_or(0),
        _ => 0,
    }
}

/// Helper to clean title of parenthetical notes like (Mariya Takeuchi 1984), [Cover], etc.
/// Also replaces punctuation that binds words together (like "no,oh", "yes!", or "artist-title") with spaces.
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
                    if c.is_alphanumeric() {
                        clean.push(c);
                    } else {
                        clean.push(' ');
                    }
                }
            }
        }
    }
    clean.to_lowercase()
}

/// Strips remaster/edition metadata from Spotify track titles for clean searching
/// e.g. "シングル・アゲイン - 2022 Remaster" -> "シングル・アゲイン"
fn clean_spotify_title(title: &str) -> String {
    let cleaned = clean_title_for_matching(title);
    let re = Regex::new(r"(?i)\s*[-–—]\s*(?:\d{4}\s+)?(?:remaster(?:ed)?|mix|edit|version|mono|stereo|anniversary|live).*$").unwrap();
    let stripped = re.replace(&cleaned, "").to_string();
    if stripped.trim().is_empty() {
        cleaned.trim().to_string()
    } else {
        stripped.trim().to_string()
    }
}

/// Converts Katakana string to Romaji for cross-script title matching
fn katakana_to_romaji(s: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        let combo = match (c, next) {
            ('シ', Some('ャ')) => Some(("sha", 2)),
            ('シ', Some('ュ')) => Some(("shu", 2)),
            ('シ', Some('ョ')) => Some(("sho", 2)),
            ('シ', Some('ェ')) => Some(("she", 2)),
            ('チ', Some('ャ')) => Some(("cha", 2)),
            ('チ', Some('ュ')) => Some(("chu", 2)),
            ('チ', Some('ョ')) => Some(("cho", 2)),
            ('チ', Some('ェ')) => Some(("che", 2)),
            ('ジ', Some('ャ')) => Some(("ja", 2)),
            ('ジ', Some('ュ')) => Some(("ju", 2)),
            ('ジ', Some('ョ')) => Some(("jo", 2)),
            ('ジ', Some('ェ')) => Some(("je", 2)),
            ('フ', Some('ァ')) => Some(("fa", 2)),
            ('フ', Some('ィ')) => Some(("fi", 2)),
            ('フ', Some('ェ')) => Some(("fe", 2)),
            ('フ', Some('ォ')) => Some(("fo", 2)),
            ('テ', Some('ィ')) => Some(("ti", 2)),
            ('デ', Some('ィ')) => Some(("di", 2)),
            ('ッ', Some(n)) if ('\u{30a1}'..='\u{30f6}').contains(&n) => {
                i += 1;
                continue;
            }
            _ => None,
        };
        if let Some((romaji, advance)) = combo {
            out.push_str(romaji);
            i += advance;
            continue;
        }
        let single = match c {
            'ア' | 'ァ' => "a", 'イ' | 'ィ' => "i", 'ウ' | 'ゥ' => "u", 'エ' | 'ェ' => "e", 'オ' | 'ォ' => "o",
            'カ' => "ka", 'キ' => "ki", 'ク' => "ku", 'ケ' => "ke", 'コ' => "ko",
            'サ' => "sa", 'シ' => "shi", 'ス' => "su", 'セ' => "se", 'ソ' => "so",
            'タ' => "ta", 'チ' => "chi", 'ツ' => "tsu", 'テ' => "te", 'ト' => "to",
            'ナ' => "na", 'ニ' => "ni", 'ヌ' => "nu", 'ネ' => "ne", 'ノ' => "no",
            'ハ' => "ha", 'ヒ' => "hi", 'フ' => "fu", 'ヘ' => "he", 'ホ' => "ho",
            'マ' => "ma", 'ミ' => "mi", 'ム' => "mu", 'メ' => "me", 'モ' => "mo",
            'ヤ' | 'ャ' => "ya", 'ユ' | 'ュ' => "yu", 'ヨ' | 'ョ' => "yo",
            'ラ' => "ra", 'リ' => "ri", 'ル' => "ru", 'レ' => "re", 'ロ' => "ro",
            'ワ' => "wa", 'ヲ' => "o", 'ン' => "n",
            'ガ' => "ga", 'ギ' => "gi", 'グ' => "gu", 'ゲ' => "ge", 'ゴ' => "go",
            'ザ' => "za", 'ジ' => "ji", 'ズ' => "zu", 'ゼ' => "ze", 'ゾ' => "zo",
            'ダ' => "da", 'ヂ' => "ji", 'ヅ' => "zu", 'デ' => "de", 'ド' => "do",
            'バ' => "ba", 'ビ' => "bi", 'ブ' => "bu", 'ベ' => "be", 'ボ' => "bo",
            'パ' => "pa", 'ピ' => "pi", 'プ' => "pu", 'ペ' => "pe", 'ポ' => "po",
            'ヴ' => "vu",
            'ー' => "", '・' => " ",
            _ => {
                out.push(c);
                i += 1;
                continue;
            }
        };
        out.push_str(single);
        i += 1;
    }
    out
}

/// Matches a candidate title against a query term, handling cross-script Katakana/English
fn title_matches_term(clean_title: &str, term: &str) -> bool {
    if clean_title.contains(term) {
        return true;
    }
    // Katakana <-> English transliteration and loanword matching
    if has_cjk(term) {
        let romaji = katakana_to_romaji(term);
        let clean_romaji = romaji.replace(' ', "");
        let clean_cand = clean_title.replace(' ', "");
        if !clean_romaji.is_empty() && clean_cand.contains(&clean_romaji) {
            return true;
        }
        if (term.contains("シングル") && clean_title.contains("single"))
            || (term.contains("アゲイン") && clean_title.contains("again"))
            || ((term.contains("プラスティック") || term.contains("プラスチック")) && clean_title.contains("plastic"))
            || (term.contains("ラブ") && clean_title.contains("love"))
            || (term.contains("サンセット") && clean_title.contains("sunset"))
            || (term.contains("ロード") && clean_title.contains("road"))
        {
            return true;
        }
    }
    if term == "single" && clean_title.contains("シングル") { return true; }
    if term == "again" && clean_title.contains("アゲイン") { return true; }
    if term == "plastic" && (clean_title.contains("プラスティック") || clean_title.contains("プラスチック")) { return true; }
    if term == "love" && clean_title.contains("ラブ") { return true; }
    if term == "sunset" && clean_title.contains("サンセット") { return true; }
    if term == "road" && clean_title.contains("ロード") { return true; }

    false
}

/// Cross-script Japanese/Latin artist matching (e.g. Mariya Takeuchi <-> 竹内まりや)
/// Only checks channel and title prefix (e.g. "Artist - Song"), NEVER parenthetical notes like (Mariya Takeuchi 1984)
/// Robust artist matching against query
/// Checks cross-script pairs, channel words against query, query parts against channel, and video title prefix
fn artist_matches_query(channel: &str, title: &str, raw_query: &str) -> bool {
    let lower_ch = channel.to_lowercase();
    let lower_title = title.to_lowercase();
    let lower_query = raw_query.to_lowercase();

    // 1. Cross-script Japanese/Latin pairs
    let pairs = [
        ("mariya takeuchi", "竹内まりや"),
        ("takeuchi mariya", "竹内まりや"),
        ("reiko takahashi", "高橋玲子"),
        ("takahashi reiko", "高橋玲子"),
        ("noriyuki makihara", "槇原敬之"),
        ("makihara noriyuki", "槇原敬之"),
        ("tatsuro yamashita", "山下達郎"),
        ("yamashita tatsuro", "山下達郎"),
        ("miki matsubara", "松原みき"),
        ("matsubara miki", "松原みき"),
        ("taeko onuki", "大貫妙子"),
        ("onuki taeko", "大貫妙子"),
        ("anri", "杏里"),
        ("akina nakamori", "中森明菜"),
        ("nakamori akina", "中森明菜"),
        ("seiko matsuda", "松田聖子"),
        ("matsuda seiko", "松田聖子"),
        ("junko yagami", "八神純子"),
        ("yagami junko", "八神純子"),
        ("tomoko aran", "亜蘭知子"),
        ("aran tomoko", "亜蘭知子"),
        ("meiko nakahara", "中原めいこ"),
        ("nakahara meiko", "中原めいこ"),
        ("masayoshi takanaka", "高中正義"),
        ("takanaka masayoshi", "高中正義"),
    ];

    for &(latin, kanji) in &pairs {
        if lower_query.contains(latin) || lower_query.contains(kanji) {
            return lower_ch.contains(latin) || lower_ch.contains(kanji)
                || lower_title.starts_with(latin) || lower_title.starts_with(kanji);
        }
    }

    // Clean channel name: strip "- topic", "vevo", "official", "channel"
    let clean_ch = lower_ch
        .replace("- topic", "")
        .replace("vevo", "")
        .replace("official", "")
        .replace("channel", "")
        .trim()
        .to_string();

    let ch_words: Vec<&str> = clean_ch
        .split_whitespace()
        .filter(|w| w.len() >= 3 && !is_title_stopword(w))
        .collect();

    // 2. If query has "Part1 - Part2" format (e.g. "Tulus - Teh Hijau" or "Teh Hijau - Tulus")
    if let Some((p1, p2)) = lower_query.split_once(" - ")
        .or_else(|| lower_query.split_once(" ~ "))
        .or_else(|| lower_query.split_once(" – "))
        .or_else(|| lower_query.split_once(" — "))
    {
        let p1_clean = p1.trim();
        let p2_clean = p2.trim();
        if !p1_clean.is_empty() && (clean_ch == p1_clean || clean_ch.contains(p1_clean) || p1_clean.contains(&clean_ch)) {
            return true;
        }
        if !p2_clean.is_empty() && (clean_ch == p2_clean || clean_ch.contains(p2_clean) || p2_clean.contains(&clean_ch)) {
            return true;
        }
    }

    let query_clean = clean_title_for_matching(raw_query);
    let q_words: Vec<&str> = query_clean
        .split_whitespace()
        .filter(|w| w.len() >= 3 && !is_title_stopword(w))
        .collect();
    if !ch_words.is_empty() && ch_words.iter().any(|&cw| q_words.contains(&cw)) {
        return true;
    }

    // 4. For videos: If video title starts with "Artist - Title" and artist words are in query
    if let Some((prefix, _)) = lower_title.split_once(" - ") {
        let prefix_clean = prefix.trim();
        let prefix_words: Vec<&str> = prefix_clean
            .split_whitespace()
            .filter(|w| w.len() >= 3 && !is_title_stopword(w))
            .collect();
        if !prefix_words.is_empty() && prefix_words.iter().all(|&pw| lower_query.contains(pw)) {
            return true;
        }
    }

    false
}

/// Checks whether a string contains CJK characters (Hiragana, Katakana, Kanji/Hanzi, Hangul)
fn has_cjk(s: &str) -> bool {
    s.chars().any(|c| {
        ('\u{3040}'..='\u{30ff}').contains(&c) || // Hiragana & Katakana
        ('\u{4e00}'..='\u{9faf}').contains(&c) || // CJK Unified Ideographs (Kanji/Hanzi)
        ('\u{ac00}'..='\u{d7af}').contains(&c)    // Hangul
    })
}

/// Identifies karaoke, vocal-less backing tracks, key shifts, play-along covers, tutorials, and DJ megamixes.
fn is_karaoke_or_derivative(title: &str, channel: &str, query: &str) -> bool {
    let lower_title = title.to_lowercase();
    let lower_channel = channel.to_lowercase();
    let lower_query = query.to_lowercase();

    if lower_query.contains("karaoke") || lower_query.contains("カラオケ") || lower_query.contains("instrumental") {
        return false;
    }

    // Known karaoke / backing track producer channels
    if lower_channel.contains("歌っちゃ王") 
        || lower_channel.contains("karafun")
        || lower_channel.contains("sing king")
        || lower_channel.contains("生音風カラオケ")
        || lower_channel.contains("カラオケ") 
    {
        return true;
    }

    let bad_phrases = [
        "歌っちゃ王", "原曲歌手", "原曲キー", "キー上げ", "キー下げ",
        "ガイドメロ", "ガイドなし", "ガイド音", "ガイドボーカル",
        "カラオケ", "karaoke",
        "off vocal", "offvocal", "off-vocal", "without vocal", "no vocal",
        "backing track", "minus one",
        "弾いてみた", "歌ってみた", "演奏してみた", "叩いてみた", "弾いてみ", "歌ってみ",
        "【ベース】", "[ベース]", "ベースで", "ベーシスト",
        "【ギター】", "[ギター]", "ギターで", "ギタリスト",
        "【ドラム】", "[ドラム]", "ドラマー",
        "【ピアノ】", "[ピアノ]",
        "tab譜", "タブ譜",
        "bass cover", "guitar cover", "drum cover", "piano cover", "vocal cover",
        "play along", "playalong", "tutorial", "how to play", "lesson", "fingerstyle",
        "amateur cover", "fan cover",
        "mashup", "mash-up", "mash up", "bootleg",
        "slowed", "reverb", "sped up", "speed up", "nightcore",
        "instrumental", "tribute", "parody",
        // Additional covers & amateur performance
        "cover by", "covered by", "(cover)", "[cover]", " cover",
        // DJ / Remix / Koplo / Hipdut
        "dj ", "dj.", "dj-", "dj_", "remix", "rmx", "koplo", "hipdut", "jedag jedug", "funkot",
        "tiktok", "tik tok",
        // Lyrics channels / Megamixes / Music box
        "lirik", "lyric video", "lyrics video", "lirik lagu", "music box", "オルゴール", "orgel",
        "originally performed by", "original performer", "megamix", "kompilasi"
    ];

    for bad in &bad_phrases {
        if (lower_title.contains(bad) || lower_channel.contains(bad)) && !lower_query.contains(bad) {
            return true;
        }
    }

    // Key shift notation: +4Key, -2Key, +1 key, key+3, etc.
    let title_bytes = lower_title.as_bytes();
    for (i, &b) in title_bytes.iter().enumerate() {
        if b == b'+' || b == b'-' {
            let rest = &lower_title[i+1..];
            let trimmed = rest.trim_start();
            if let Some(digit_len) = trimmed.find(|c: char| !c.is_ascii_digit()) {
                if digit_len > 0 && digit_len <= 2 {
                    let after_digits = trimmed[digit_len..].trim_start();
                    if after_digits.starts_with("key") || after_digits.starts_with("キー") {
                        return true;
                    }
                }
            }
        }
    }

    false
}

fn is_title_stopword(w: &str) -> bool {
    matches!(w, "no" | "oh" | "to" | "in" | "on" | "at" | "of" | "me" | "my" | "is" | "it" | "de" | "na" | "ga" | "ni" | "wa" | "ha" | "a" | "an" | "the")
}

/// Computes a relevance score for a search candidate.
/// Lower is better.
/// - Songs are prioritized over videos (-150 bonus) ONLY when comparing the same song AND artist!
/// - If a candidate's title does not match any query terms (different song), it receives a heavy penalty (+500).
/// - If a candidate's channel does not match any artist terms (wrong artist), it receives a penalty (+500).
/// - Mashups, bootlegs, and "OtherArtist ft. TargetArtist" receive heavy penalties (+400).
/// - Durations > 10 minutes receive massive penalties (+1500) for song queries.
/// - Karaoke, backing tracks, amateur covers, and DJ compilations receive heavy penalties (+1000).
fn score_search_candidate(v: &Video, query_words: &[&str], raw_query: &str) -> i32 {
    let clean_title = clean_title_for_matching(&v.title);
    let channel_lower = v.channel.to_lowercase();
    let lower_raw_title = v.title.to_lowercase();

    let mut matched_title_words = 0;
    let mut matched_significant_title_words = 0;
    let mut matched_channel_words = 0;

    let ch_words: Vec<&str> = channel_lower
        .split_whitespace()
        .filter(|cw| cw.len() >= 3 && !is_title_stopword(cw))
        .collect();

    for &w in query_words {
        let in_clean = title_matches_term(&clean_title, w);
        let in_raw = lower_raw_title.contains(w);
        if in_clean || in_raw {
            matched_title_words += 1;
            if !is_title_stopword(w) && w.chars().count() >= 3 {
                matched_significant_title_words += 1;
            }
        }
        // Match channel only against significant words (len >= 3, not stopword)
        // Never allow 1 or 2 letter words (like 'i' or 'm' from "I'm") to match a channel!
        if !is_title_stopword(w) && w.chars().count() >= 3 {
            if ch_words.iter().any(|&cw| cw == w || cw.contains(w) || w.contains(cw)) {
                matched_channel_words += 1;
            }
        }
    }

    let is_song = v.item_type.as_deref() == Some("song");
    let artist_matched = artist_matches_query(&v.channel, &v.title, raw_query)
        || matched_channel_words > 0;

    let has_query_significant = query_words.iter().any(|&w| !is_title_stopword(w) && w.chars().count() >= 3);
    let title_matched = if has_query_significant {
        matched_significant_title_words > 0
    } else {
        matched_title_words > 0
    };

    let mut score = 0;

    // Missing query words penalty (40 points per missing word)
    let missing = query_words.len().saturating_sub(matched_title_words + matched_channel_words);
    score += (missing as i32) * 40;

    // Title mismatch penalty:
    if !title_matched {
        score += 500;
    }

    // Artist mismatch penalty:
    if !artist_matched {
        score += 500;
    }

    // Check if title has "OtherArtist ft. TargetArtist" format (e.g. "2Pac ft. Mariya Takeuchi")
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
        score += 400;
    }

    // Duration penalty: single tracks must not exceed 10 minutes (600s)
    let secs = parse_duration_secs(&v.duration);
    if secs > 600 {
        score += 1500;
    }

    // Penalize karaoke, backing tracks, amateur covers, DJ compilations, etc.
    if is_karaoke_or_derivative(&v.title, &v.channel, raw_query) {
        score += 1000;
    }

    // Official Song bonus:
    // If candidate is an official song matching title & artist, grant strong bonus (-150)
    // If candidate is a video, penalize +50 relative to official songs
    if is_song && title_matched && artist_matched {
        score -= 150;
    } else if !is_song {
        score += 50;
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
                    // 1) Candidate is a song and NOT karaoke / derivative
                    // 2) Duration is <= 10 minutes (600s)
                    // 3) Clean title matches at least one query word
                    // 4) Artist is matched either directly or via cross-script matching
                    let has_strong_match = results.iter().any(|v| {
                        if v.item_type.as_deref() != Some("song") {
                            return false;
                        }
                        if is_karaoke_or_derivative(&v.title, &v.channel, &query) {
                            return false;
                        }
                        if parse_duration_secs(&v.duration) > 600 {
                            return false;
                        }
                        let clean_title = clean_title_for_matching(&v.title);

                        let has_query_significant = query_words.iter().any(|&w| !is_title_stopword(w) && w.chars().count() >= 3);
                        let title_matched = if has_query_significant {
                            query_words.iter().any(|&w| !is_title_stopword(w) && w.chars().count() >= 3 && title_matches_term(&clean_title, w))
                        } else {
                            query_words.iter().any(|&w| title_matches_term(&clean_title, w))
                        };
                        if !title_matched {
                            return false;
                        }

                        let channel_matched = artist_matches_query(&v.channel, &v.title, &query);

                        title_matched && channel_matched
                    });

                    // ONLY fall back to video search if NO strong song match exists
                    // (e.g. Mariya Takeuchi's Single Again / Oh No Oh Yes which are only on video)
                    if !has_strong_match {
                        if let Ok(video_results) = search_youtube_music(&query, Some("video")).await {
                            for vid in video_results {
                                if !results.iter().any(|r| r.id == vid.id) {
                                    results.push(vid);
                                }
                            }
                        }
                    }

                    // Sort candidates using score_search_candidate:
                    // Correct tracks (song or video) by the target artist win over covers and wrong songs.
                    results.sort_by_key(|v| score_search_candidate(v, &query_words, &query));
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
                    let title_lower = title.to_lowercase();
                    let channel_lower = channel.to_lowercase();
                    let is_video = title_lower.contains("official music video")
                        || title_lower.contains("official video")
                        || title_lower.contains("music video")
                        || title_lower.contains("lyric video")
                        || title_lower.contains("visualizer")
                        || title_lower.contains("[mv]")
                        || title_lower.contains("(mv)")
                        || channel_lower.contains("vevo");

                    videos.push(Video {
                        id,
                        title,
                        thumbnail,
                        duration,
                        channel,
                        is_playlist: false,
                        track_count: None,
                        first_video_id: None,
                        item_type: Some(if is_video { "video".to_string() } else { "song".to_string() }),
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
                            let is_topic = channel.to_lowercase().ends_with("- topic");
                            videos.push(Video {
                                id,
                                title,
                                thumbnail,
                                duration,
                                channel,
                                is_playlist: false,
                                track_count: None,
                                first_video_id: None,
                                item_type: Some(if is_topic { "song".to_string() } else { "video".to_string() }),
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
                    let clean_title = clean_spotify_title(title);
                    let search_title = if clean_title.trim().is_empty() {
                        title
                    } else {
                        &clean_title
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
                            let is_topic = channel.to_lowercase().ends_with("- topic");
                            videos.push(Video {
                                id,
                                title,
                                thumbnail,
                                duration,
                                channel,
                                is_playlist: false,
                                track_count: None,
                                first_video_id: None,
                                item_type: Some(if is_topic { "song".to_string() } else { "video".to_string() }),
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
                                let is_topic = channel.to_lowercase().ends_with("- topic");
                                videos.push(Video {
                                    id,
                                    title,
                                    thumbnail,
                                    duration,
                                    channel,
                                    is_playlist: false,
                                    track_count: None,
                                    first_video_id: None,
                                    item_type: Some(if is_topic { "song".to_string() } else { "video".to_string() }),
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
            let (artist, title) = if let Some((a, t)) = decoded.split_once(" - ") {
                (a.trim().to_string(), t.trim().to_string())
            } else {
                ("".to_string(), decoded.clone())
            };

            tracks.push(KworbTrack {
                rank,
                artist,
                title,
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

pub fn decode_process_output(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.trim().to_string();
    }
    // Fallback: Windows-1252 / ISO-8859-1 decoding for legacy OEM/ANSI stdout
    bytes.iter().map(|&b| match b {
        0x00..=0x7F => b as char,
        0x80 => '€',
        0x82 => '‚',
        0x83 => 'ƒ',
        0x84 => '„',
        0x85 => '…',
        0x86 => '†',
        0x87 => '‡',
        0x88 => 'ˆ',
        0x89 => '‰',
        0x8A => 'Š',
        0x8B => '‹',
        0x8C => 'Œ',
        0x8E => 'Ž',
        0x91 => '‘',
        0x92 => '’',
        0x93 => '“',
        0x94 => '”',
        0x95 => '•',
        0x96 => '–',
        0x97 => '—',
        0x98 => '˜',
        0x99 => '™',
        0x9A => 'š',
        0x9B => '›',
        0x9C => 'œ',
        0x9E => 'ž',
        0x9F => 'Ÿ',
        0xA0..=0xFF => b as char,
        _ => ' ',
    }).collect::<String>().trim().to_string()
}

#[tauri::command]
pub async fn get_video_album_info(video_id: String) -> Result<AlbumInfo, String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    // 1. Run yt-dlp for reliable album/artist extraction (YouTube's JSON structure is too flaky)
    let exe_path = crate::downloads::get_yt_dlp_path().await?;
    let mut cmd = tokio::process::Command::new(exe_path);
    cmd.stdin(std::process::Stdio::null())
        .arg("--encoding")
        .arg("utf-8")
        .arg("--print")
        .arg("%(album)s|||%(artist)s")
        .arg("--no-download")
        .arg("--no-warnings")
        .arg(&url);

    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");

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
            let raw = decode_process_output(&output.stdout);
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

fn parse_artist_song(c: &serde_json::Value, default_artist: &str) -> Option<ArtistSong> {
    let r = c.get("musicResponsiveListItemRenderer")?;
    let id = r.pointer("/playlistItemData/videoId")
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

    if id.is_empty() {
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

    let col1_runs = r.pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")
        .and_then(|v| v.as_array());
    let mut artist = String::new();
    if let Some(runs) = col1_runs {
        let texts: Vec<&str> = runs.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect();
        artist = texts.concat();
    }
    if artist.is_empty() {
        artist = default_artist.to_string();
    }

    let col2_runs = r.pointer("/flexColumns/2/musicResponsiveListItemFlexColumnRenderer/text/runs")
        .and_then(|v| v.as_array());
    let mut col2_text = String::new();
    if let Some(runs) = col2_runs {
        let texts: Vec<&str> = runs.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect();
        col2_text = texts.concat();
    }

    let col3_runs = r.pointer("/flexColumns/3/musicResponsiveListItemFlexColumnRenderer/text/runs")
        .and_then(|v| v.as_array());
    let mut col3_text = String::new();
    if let Some(runs) = col3_runs {
        let texts: Vec<&str> = runs.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect();
        col3_text = texts.concat();
    }

    let mut plays = None;
    let mut album = None;

    let col2_lower = col2_text.to_lowercase();
    let col3_lower = col3_text.to_lowercase();

    if col2_lower.contains("play") || col2_lower.contains("view") {
        plays = Some(col2_text.trim().to_string());
        if !col3_text.is_empty() && !col3_lower.contains("play") && !col3_lower.contains("view") {
            album = Some(col3_text.trim().to_string());
        }
    } else if col3_lower.contains("play") || col3_lower.contains("view") {
        plays = Some(col3_text.trim().to_string());
        if !col2_text.is_empty() {
            album = Some(col2_text.trim().to_string());
        }
    } else {
        if !col2_text.is_empty() {
            album = Some(col2_text.trim().to_string());
        }
    }

    let duration = r.pointer("/fixedColumns/0/musicResponsiveListItemFixedColumnRenderer/text/runs/0/text")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let thumbnail = r.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last().or_else(|| arr.first()))
        .and_then(|thumb| thumb.get("url").and_then(|u| u.as_str()))
        .unwrap_or("")
        .to_string();

    Some(ArtistSong {
        id,
        title,
        artist,
        plays,
        album,
        duration,
        thumbnail,
    })
}

#[tauri::command]
pub async fn get_artist_details(
    artist_name: String,
    artist_browse_id: Option<String>,
) -> Result<ArtistDetails, String> {
    let client = get_ytm_client();
    let mut target_browse_id = artist_browse_id.unwrap_or_default().trim().to_string();
    let mut search_avatar: Option<String> = None;

    if target_browse_id.is_empty() {
        let body = serde_json::json!({
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240101.01.00",
                    "hl": "en",
                    "gl": "US"
                }
            },
            "query": artist_name,
            "params": "EgWKAQIgAWoOEAQQAxAFEAkQEBAKEBU%3D"
        });

        let res = client.post("https://music.youtube.com/youtubei/v1/search")
            .header("User-Agent", YTM_USER_AGENT)
            .header("Referer", "https://music.youtube.com/")
            .header("Origin", "https://music.youtube.com")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to search artist: {}", e))?;

        let json: serde_json::Value = res.json().await.map_err(|e| format!("Failed to parse artist search JSON: {}", e))?;
        let shelf = json.pointer("/contents/tabbedSearchResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/musicShelfRenderer");
        let items = shelf.and_then(|s| s.get("contents")).and_then(|c| c.as_array());

        if let Some(items_arr) = items {
            let mut best_item: Option<&serde_json::Value> = None;
            for item in items_arr {
                let title = item.pointer("/musicResponsiveListItemRenderer/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/text")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                if title.eq_ignore_ascii_case(&artist_name) {
                    best_item = Some(item);
                    break;
                }
            }
            if best_item.is_none() {
                best_item = items_arr.first();
            }

            if let Some(item) = best_item {
                let r = item.get("musicResponsiveListItemRenderer");
                target_browse_id = r.and_then(|x| x.pointer("/navigationEndpoint/browseEndpoint/browseId"))
                    .or_else(|| r.and_then(|x| x.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/navigationEndpoint/browseEndpoint/browseId")))
                    .and_then(|b| b.as_str())
                    .unwrap_or("")
                    .to_string();

                search_avatar = r.and_then(|x| x.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails"))
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url").and_then(|u| u.as_str()))
                    .map(|s| s.to_string());
            }
        }
    }

    if target_browse_id.is_empty() {
        return Err(format!("Could not find artist page for '{}'", artist_name));
    }

    // Browse artist endpoint
    let browse_body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "browseId": target_browse_id
    });

    let browse_res = client.post("https://music.youtube.com/youtubei/v1/browse")
        .header("User-Agent", YTM_USER_AGENT)
        .header("Referer", "https://music.youtube.com/")
        .header("Origin", "https://music.youtube.com")
        .header("Content-Type", "application/json")
        .json(&browse_body)
        .send()
        .await
        .map_err(|e| format!("Failed to browse artist: {}", e))?;

    let browse_json: serde_json::Value = browse_res.json().await.map_err(|e| format!("Failed to parse browse JSON: {}", e))?;

    let header = browse_json.pointer("/header/musicImmersiveHeaderRenderer")
        .or_else(|| browse_json.pointer("/header/musicVisualHeaderRenderer"))
        .or_else(|| browse_json.pointer("/header/musicHeaderRenderer"));

    let resolved_name = header.and_then(|h| h.pointer("/title/runs/0/text"))
        .and_then(|t| t.as_str())
        .unwrap_or(&artist_name)
        .to_string();

    let bg_img = header.and_then(|h| h.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url").and_then(|u| u.as_str()))
        .map(|s| s.to_string())
        .or_else(|| search_avatar.clone());

    let subscribers = header.and_then(|h| h.pointer("/subscriptionButton/subscribeButtonRenderer/subscriberCountText/runs/0/text"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    let monthly_audience = header.and_then(|h| h.pointer("/monthlyListenerCount/runs/0/text"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    let description = header.and_then(|h| h.pointer("/description/runs/0/text"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    let mut top_songs = Vec::new();
    let mut top_songs_playlist_id = None;

    if let Some(sections) = browse_json.pointer("/contents/singleColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents").and_then(|v| v.as_array()) {
        for s in sections {
            if let Some(shelf) = s.get("musicShelfRenderer") {
                let shelf_title = shelf.pointer("/title/runs/0/text").and_then(|t| t.as_str()).unwrap_or("").to_lowercase();
                if shelf_title.contains("song") || shelf_title.contains("top") {
                    top_songs_playlist_id = shelf.pointer("/bottomEndpoint/browseEndpoint/browseId")
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string());

                    if let Some(contents) = shelf.get("contents").and_then(|c| c.as_array()) {
                        for item in contents {
                            if let Some(song) = parse_artist_song(item, &resolved_name) {
                                top_songs.push(song);
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    // Fallback: If no top songs in shelf, search for songs by this artist
    if top_songs.is_empty() {
        if let Ok(videos) = search_youtube_music(&resolved_name, Some("song")).await {
            for v in videos.into_iter().take(10) {
                top_songs.push(ArtistSong {
                    id: v.id,
                    title: v.title,
                    artist: v.channel,
                    plays: None,
                    album: None,
                    duration: Some(v.duration),
                    thumbnail: v.thumbnail,
                });
            }
        }
    }

    Ok(ArtistDetails {
        name: resolved_name,
        browse_id: target_browse_id,
        background_image: bg_img,
        avatar: search_avatar,
        subscribers,
        monthly_audience,
        description,
        top_songs,
        top_songs_playlist_id,
    })
}

#[tauri::command]
pub async fn get_artist_top_songs(playlist_id: String) -> Result<Vec<ArtistSong>, String> {
    let client = get_ytm_client();
    let browse_id = if playlist_id.starts_with("VL") {
        playlist_id.clone()
    } else {
        format!("VL{}", playlist_id)
    };

    let browse_body = serde_json::json!({
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

    let browse_res = client.post("https://music.youtube.com/youtubei/v1/browse")
        .header("User-Agent", YTM_USER_AGENT)
        .header("Referer", "https://music.youtube.com/")
        .header("Origin", "https://music.youtube.com")
        .header("Content-Type", "application/json")
        .json(&browse_body)
        .send()
        .await
        .map_err(|e| format!("Failed to browse top songs playlist: {}", e))?;

    let browse_json: serde_json::Value = browse_res.json().await.map_err(|e| format!("Failed to parse playlist JSON: {}", e))?;

    let contents = browse_json.pointer("/contents/twoColumnBrowseResultsRenderer/secondaryContents/sectionListRenderer/contents/0/musicPlaylistShelfRenderer/contents")
        .or_else(|| browse_json.pointer("/contents/twoColumnBrowseResultsRenderer/secondaryContents/sectionListRenderer/contents/0/musicShelfRenderer/contents"))
        .or_else(|| browse_json.pointer("/contents/singleColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/musicPlaylistShelfRenderer/contents"))
        .or_else(|| browse_json.pointer("/contents/singleColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/musicShelfRenderer/contents"))
        .and_then(|v| v.as_array());

    let mut songs = Vec::new();
    if let Some(items) = contents {
        for item in items {
            if let Some(song) = parse_artist_song(item, "") {
                songs.push(song);
            }
        }
    }

    if songs.is_empty() {
        // Fallback: use get_youtube_playlist
        let fallback_tracks = get_youtube_playlist(playlist_id.replace("VL", ""), String::new()).await?;
        for t in fallback_tracks {
            songs.push(ArtistSong {
                id: t.id,
                title: t.title,
                artist: t.channel,
                plays: None,
                album: None,
                duration: Some(t.duration),
                thumbnail: t.thumbnail,
            });
        }
    }

    Ok(songs)
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
            /// Simulates the JS Spotify import logic:
            /// Pass 1: candidate that matches BOTH target artist AND target title
            /// Pass 2: cover matching target title
            /// Pass 3: fallback
            fn simulate_spotify_import<'a>(results: &'a [Video], query: &str, expected_artist: &str) -> &'a Video {
                // Pass 1: artist-matched + title-matched + non-karaoke
                for v in results {
                    if is_karaoke_or_derivative(&v.title, &v.channel, query) { continue; }
                    let clean = clean_title_for_matching(&v.title);
                    let title_ok = query.split_whitespace().any(|w| title_matches_term(&clean, w));
                    let artist_ok = artist_matches_query(&v.channel, &v.title, expected_artist);
                    if title_ok && artist_ok {
                        return v;
                    }
                }
                // Pass 2: title-matched + non-karaoke (cover)
                for v in results {
                    if is_karaoke_or_derivative(&v.title, &v.channel, query) { continue; }
                    let clean = clean_title_for_matching(&v.title);
                    if query.split_whitespace().any(|w| title_matches_term(&clean, w)) {
                        return v;
                    }
                }
                // Pass 3: first non-karaoke
                for v in results {
                    if is_karaoke_or_derivative(&v.title, &v.channel, query) { continue; }
                    return v;
                }
                &results[0]
            }

            // 1. OH NO,OH YES! by Mariya Takeuchi (must reject 2Pac mashup and Tokimeki cover)
            let query_ohno = "OH NO,OH YES! Mariya Takeuchi";
            let results_ohno = search_youtube(query_ohno.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_ohno.is_empty(), "OH NO,OH YES search should return results");
            println!("OH NO top 10 results:");
            let q_words = &["oh", "no", "oh", "yes", "mariya", "takeuchi"];
            for (i, v) in results_ohno.iter().take(10).enumerate() {
                println!("  [{}] title={:?}, channel={:?}, type={:?}, score={}", 
                    i, v.title, v.channel, v.item_type, score_search_candidate(v, q_words, query_ohno)
                );
            }
            let top_ohno = &results_ohno[0];
            assert!(
                top_ohno.title.to_lowercase().contains("mariya takeuchi") || top_ohno.channel.to_lowercase().contains("mariya takeuchi"),
                "Top result must be Mariya Takeuchi's Oh No Oh Yes! Got: title={} channel={}",
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
            println!("Top Enishi result: title={:?}, channel={:?}", top_enishi.title, top_enishi.channel);
            assert!(
                top_enishi.title.contains("縁の糸") || top_enishi.title.contains("Enishi"),
                "Top result must be 縁の糸! Got: {}",
                top_enishi.title
            );

            // 3. Plastic Love by Mariya Takeuchi
            let query_plastic = "Plastic Love Mariya Takeuchi";
            let results_plastic = search_youtube(query_plastic.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_plastic.is_empty(), "Plastic Love search should return results");
            let picked_plastic = simulate_spotify_import(&results_plastic, query_plastic, "Mariya Takeuchi");
            println!("Import picked Plastic Love: title={:?}, channel={:?}", picked_plastic.title, picked_plastic.channel);
            assert!(
                picked_plastic.channel.to_lowercase().contains("mariya") || picked_plastic.channel.to_lowercase().contains("takeuchi"),
                "Import should pick Mariya Takeuchi's Plastic Love! Got channel: {}",
                picked_plastic.channel
            );

            // 4. Sunset Road by Reiko Takahashi (must reject bass cover)
            let query_kanji = "サンセット・ロード 高橋玲子";
            let results_kanji = search_youtube(query_kanji.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_kanji.is_empty(), "Sunset search should return results");
            let top_kanji = &results_kanji[0];
            println!("Top Sunset result: title={:?}, channel={:?}, type={:?}", top_kanji.title, top_kanji.channel, top_kanji.item_type);
            assert!(
                !is_karaoke_or_derivative(&top_kanji.title, &top_kanji.channel, query_kanji),
                "Top result must NOT be karaoke/derivative! Got: title={} channel={}",
                top_kanji.title, top_kanji.channel
            );

            // 5. Genki o Dashite by Mariya Takeuchi (must reject karaoke)
            let query_genki = "元気を出して Mariya Takeuchi";
            let results_genki = search_youtube(query_genki.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_genki.is_empty(), "Genki search should return results");
            let top_genki = &results_genki[0];
            println!("Top Genki result: title={:?}, channel={:?}", top_genki.title, top_genki.channel);
            assert!(
                !is_karaoke_or_derivative(&top_genki.title, &top_genki.channel, query_genki),
                "Top result must NOT be karaoke! Got: title={} channel={}",
                top_genki.title, top_genki.channel
            );
            let picked_genki = simulate_spotify_import(&results_genki, query_genki, "Mariya Takeuchi");
            println!("Import picked Genki: title={:?}, channel={:?}", picked_genki.title, picked_genki.channel);
            assert!(
                picked_genki.title.contains("元気を出して"),
                "Import must pick 元気を出して! Got: {} by {}",
                picked_genki.title, picked_genki.channel
            );

            // 6. シングル・アゲイン (Single Again) by Mariya Takeuchi
            // THE BUG: was picking 僕の街へ (different song, same artist)
            let query_single = "シングル・アゲイン Mariya Takeuchi";
            let results_single = search_youtube(query_single.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_single.is_empty(), "Single Again search should return results");
            println!("Single Again results top 5:");
            for (i, r) in results_single.iter().take(5).enumerate() {
                println!("  [{}] title={:?}, channel={:?}, type={:?}", i, r.title, r.channel, r.item_type);
            }
            let picked_single = simulate_spotify_import(&results_single, query_single, "Mariya Takeuchi");
            println!("Import picked Single Again: title={:?}, channel={:?}", picked_single.title, picked_single.channel);
            assert!(
                picked_single.title.contains("シングル・アゲイン") || picked_single.title.to_lowercase().contains("single again"),
                "Import must pick シングル・アゲイン! Got: title={} channel={}",
                picked_single.title, picked_single.channel
            );
            assert!(
                !picked_single.title.contains("僕の街へ"),
                "Must NOT pick 僕の街へ (different song)! Got: {}",
                picked_single.title
            );

            // 7. もう恋なんてしない by Noriyuki Makihara
            let query_mou = "もう恋なんてしない Noriyuki Makihara";
            let results_mou = search_youtube(query_mou.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            assert!(!results_mou.is_empty(), "Mou Koi search should return results");
            let picked_mou = simulate_spotify_import(&results_mou, query_mou, "Noriyuki Makihara");
            println!("Import picked Mou Koi: title={:?}, channel={:?}", picked_mou.title, picked_mou.channel);
            assert!(
                picked_mou.title.contains("もう恋なんてしない"),
                "Import must pick もう恋なんてしない! Got: title={} channel={}",
                picked_mou.title, picked_mou.channel
            );

            // 8. Tulus - Teh Hijau (Trending Indonesia #1)
            let query_tulus = "Tulus - Teh Hijau";
            let results_tulus = search_youtube(query_tulus.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            let clean_tulus = clean_title_for_matching(query_tulus);
            let q_tulus_words: Vec<&str> = clean_tulus.split_whitespace().collect();
            println!("TULUS results top 5 (query words: {:?}):", q_tulus_words);
            for (i, r) in results_tulus.iter().take(5).enumerate() {
                let score = score_search_candidate(r, &q_tulus_words, query_tulus);
                let is_bad = is_karaoke_or_derivative(&r.title, &r.channel, query_tulus);
                println!("  [{}] score={} is_bad={} title={:?}, channel={:?}, type={:?}, dur={:?}", 
                    i, score, is_bad, r.title, r.channel, r.item_type, r.duration);
            }

            assert_eq!(results_tulus[0].title, "Teh Hijau");
            assert_eq!(results_tulus[0].channel, "Tulus");
            assert_eq!(results_tulus[0].item_type.as_deref(), Some("song"));
            assert!(!results_tulus[0].title.contains("DJ"));

            // 9. Raim Laode - iqro' (Trending Indonesia #4)
            let query_raim = "Raim Laode - iqro'";
            let results_raim = search_youtube(query_raim.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            let clean_raim = clean_title_for_matching(query_raim);
            let q_raim_words: Vec<&str> = clean_raim.split_whitespace().collect();
            println!("RAIM results top 5 (query words: {:?}):", q_raim_words);
            for (i, r) in results_raim.iter().take(5).enumerate() {
                let score = score_search_candidate(r, &q_raim_words, query_raim);
                let is_bad = is_karaoke_or_derivative(&r.title, &r.channel, query_raim);
                println!("  [{}] score={} is_bad={} title={:?}, channel={:?}, type={:?}, dur={:?}", 
                    i, score, is_bad, r.title, r.channel, r.item_type, r.duration);
            }
            assert!(results_raim[0].title.to_lowercase().contains("iqro"));
            assert_eq!(results_raim[0].channel, "Raim Laode");
            assert_eq!(results_raim[0].item_type.as_deref(), Some("song"));
            assert!(!results_raim[0].title.to_lowercase().contains("cover"));

            // 10. Breakbot, Irfane - Baby I'm Yours
            let query_breakbot = "Baby I'm Yours Breakbot, Irfane";
            let results_breakbot = search_youtube(query_breakbot.to_string(), Some("song".to_string()))
                .await
                .expect("Search should succeed");
            let clean_breakbot = clean_title_for_matching(query_breakbot);
            let q_breakbot_words: Vec<&str> = clean_breakbot.split_whitespace().collect();
            println!("BREAKBOT results top 5 (query words: {:?}):", q_breakbot_words);
            for (i, r) in results_breakbot.iter().take(5).enumerate() {
                let score = score_search_candidate(r, &q_breakbot_words, query_breakbot);
                let is_bad = is_karaoke_or_derivative(&r.title, &r.channel, query_breakbot);
                println!("  [{}] score={} is_bad={} title={:?}, channel={:?}, type={:?}, dur={:?}", 
                    i, score, is_bad, r.title, r.channel, r.item_type, r.duration);
            }
            assert_eq!(results_breakbot[0].channel, "Breakbot");
            assert!(results_breakbot[0].title.contains("Baby I'm Yours"));
            assert_eq!(results_breakbot[0].item_type.as_deref(), Some("song"));
        });
    }

    #[test]
    fn test_artist_details() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let details = get_artist_details("Adele".to_string(), None).await;
            assert!(details.is_ok(), "Should fetch artist details for Adele: {:?}", details.err());
            let d = details.unwrap();
            println!("Artist: {}, Top Songs count: {}, Bg: {:?}", d.name, d.top_songs.len(), d.background_image);
            assert!(d.name.to_lowercase().contains("adele"));
            assert!(!d.top_songs.is_empty(), "Should return top songs for Adele");
            assert!(d.background_image.is_some() || d.avatar.is_some(), "Should have background or avatar image");

            if let Some(playlist_id) = d.top_songs_playlist_id {
                let full_top_songs = get_artist_top_songs(playlist_id).await;
                assert!(full_top_songs.is_ok(), "Should fetch full top songs playlist: {:?}", full_top_songs.err());
                let songs = full_top_songs.unwrap();
                println!("Full top songs count: {}", songs.len());
                assert!(songs.len() >= d.top_songs.len(), "Full top songs should have at least as many songs as shelf");
            }
        });
    }
}

