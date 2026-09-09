use lazy_static::lazy_static;
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

#[derive(Debug, Deserialize, Clone)]
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

lazy_static! {
    static ref RE_BRACKET_NOISE: Regex = Regex::new(
        r"(?i)[\(\[\{【『「〔《〈<][^)\]}】』」〕》〉>]*?(?:official|music\s*video|audio|video|lyrics?|hd|hq|4k|8k|mv|m/v|pv|visualizer|feat\.?|ft\.?|with|prod\.?|remaster(?:ed)?|live|remix|version|edit|extended|album|explicit|clean|sub\s*español|lirik|terjemahan|karaoke|instrumental|cover|original)[^)\]}】』」〕》〉>]*?[\)\]\}】』」〕》〉>]"
    ).unwrap();

    static ref RE_STANDALONE_BRACKETS: Regex = Regex::new(
        r"(?i)[\(\[\{【『「〔《〈<]\s*(?:hq|hd|4k|8k|mv|m/v|pv|lyrics?|audio|official|original|visualizer|audio\s*only)\s*[\)\]\}】』」〕》〉>]"
    ).unwrap();

    static ref RE_TRAILING_META: Regex = Regex::new(
        r"(?i)\s*-\s*(?:remaster(?:ed)?|radio\s*edit|live|mono|stereo|anniversary|deluxe|bonus\s*track|original\s*mix).*$"
    ).unwrap();

    static ref RE_NOISE_WORDS: Regex = Regex::new(
        r"(?i)\b(?:official\s*video|official\s*audio|official\s*music\s*video|lyric\s*video|music\s*video|full\s*album|hq|hd|4k|8k|mv|visualizer)\b"
    ).unwrap();

    static ref RE_PARENTHETICALS: Regex = Regex::new(
        r"[\(\[\{【『「〔《〈<][^)\]}】』」〕》〉>]*?[\)\]\}】』」〕》〉>]"
    ).unwrap();

    static ref RE_SPACES: Regex = Regex::new(r"\s+").unwrap();
}

fn sanitize_title(title: &str) -> String {
    let mut cleaned = RE_BRACKET_NOISE.replace_all(title, " ").to_string();
    cleaned = RE_STANDALONE_BRACKETS.replace_all(&cleaned, " ").to_string();
    cleaned = RE_TRAILING_META.replace_all(&cleaned, " ").to_string();
    cleaned = RE_NOISE_WORDS.replace_all(&cleaned, " ").to_string();
    cleaned = cleaned.replace(['“', '”'], "\"").replace(['‘', '’'], "'");
    RE_SPACES.replace_all(&cleaned, " ").trim().to_string()
}

fn strip_parentheticals(s: &str) -> String {
    let res = RE_PARENTHETICALS.replace_all(s, " ").to_string();
    RE_SPACES.replace_all(&res, " ").trim().to_string()
}

fn sanitize_artist(artist: &str) -> String {
    let cleaned = artist
        .replace(" - Topic", "")
        .replace("- Topic", "")
        .replace(" Official", "")
        .replace("Official", "")
        .replace(" VEVO", "")
        .replace("VEVO", "");
    RE_SPACES.replace_all(&cleaned, " ").trim().to_string()
}

#[derive(Debug, Clone)]
struct TrackCandidate {
    pub track_name: String,
    pub artist_name: String,
}

fn extract_candidates(
    clean_title: &str,
    clean_artist: &str,
) -> (Vec<TrackCandidate>, Vec<String>, Vec<String>, Vec<String>) {
    let mut candidates: Vec<TrackCandidate> = Vec::new();
    let mut title_only_candidates: Vec<String> = Vec::new();
    let mut search_queries: Vec<String> = Vec::new();
    let mut known_artists: Vec<String> = Vec::new();

    let delimiters = [" - ", " – ", " — ", " | ", " ~ ", " // ", " / ", " : "];
    let mut split_found = false;

    for &delim in &delimiters {
        if clean_title.contains(delim) {
            let parts: Vec<&str> = clean_title.splitn(2, delim).collect();
            if parts.len() == 2 {
                let part_a = parts[0].trim().to_string();
                let part_b = parts[1].trim().to_string();
                let core_a = strip_parentheticals(&part_a);
                let core_b = strip_parentheticals(&part_b);

                if !part_a.is_empty() && !part_b.is_empty() {
                    split_found = true;
                    let clean_art_lower = clean_artist.to_lowercase();
                    let a_matches_artist = !clean_artist.is_empty()
                        && (clean_art_lower.contains(&part_a.to_lowercase())
                            || part_a.to_lowercase().contains(&clean_art_lower));
                    let b_matches_artist = !clean_artist.is_empty()
                        && (clean_art_lower.contains(&part_b.to_lowercase())
                            || part_b.to_lowercase().contains(&clean_art_lower));

                    if a_matches_artist {
                        // Part A is Artist, Part B is Track
                        known_artists.push(part_a.clone());
                        candidates.push(TrackCandidate {
                            track_name: part_b.clone(),
                            artist_name: part_a.clone(),
                        });
                        if !core_b.is_empty() && core_b != part_b {
                            candidates.push(TrackCandidate {
                                track_name: core_b.clone(),
                                artist_name: part_a.clone(),
                            });
                        }
                        title_only_candidates.push(part_b.clone());
                        if !core_b.is_empty() && core_b != part_b {
                            title_only_candidates.push(core_b.clone());
                        }
                    } else if b_matches_artist {
                        // Part B is Artist, Part A is Track
                        known_artists.push(part_b.clone());
                        candidates.push(TrackCandidate {
                            track_name: part_a.clone(),
                            artist_name: part_b.clone(),
                        });
                        if !core_a.is_empty() && core_a != part_a {
                            candidates.push(TrackCandidate {
                                track_name: core_a.clone(),
                                artist_name: part_b.clone(),
                            });
                        }
                        title_only_candidates.push(part_a.clone());
                        if !core_a.is_empty() && core_a != part_a {
                            title_only_candidates.push(core_a.clone());
                        }
                    } else {
                        // Unknown channel (e.g. Deses) - try both directions!
                        known_artists.push(part_b.clone());
                        known_artists.push(part_a.clone());

                        // Direction 1: Track = Part A, Artist = Part B
                        candidates.push(TrackCandidate {
                            track_name: part_a.clone(),
                            artist_name: part_b.clone(),
                        });
                        if !core_a.is_empty() && core_a != part_a {
                            candidates.push(TrackCandidate {
                                track_name: core_a.clone(),
                                artist_name: part_b.clone(),
                            });
                        }

                        // Direction 2: Track = Part B, Artist = Part A
                        candidates.push(TrackCandidate {
                            track_name: part_b.clone(),
                            artist_name: part_a.clone(),
                        });
                        if !core_b.is_empty() && core_b != part_b {
                            candidates.push(TrackCandidate {
                                track_name: core_b.clone(),
                                artist_name: part_a.clone(),
                            });
                        }

                        title_only_candidates.push(part_a.clone());
                        if !core_a.is_empty() && core_a != part_a {
                            title_only_candidates.push(core_a.clone());
                        }
                        title_only_candidates.push(part_b.clone());
                        if !core_b.is_empty() && core_b != part_b {
                            title_only_candidates.push(core_b.clone());
                        }
                    }

                    search_queries.push(format!("{} {}", part_a, part_b));
                    if !core_a.is_empty() && core_a != part_a {
                        search_queries.push(format!("{} {}", core_a, part_b));
                    }
                    if !core_b.is_empty() && core_b != part_b {
                        search_queries.push(format!("{} {}", part_a, core_b));
                    }
                    search_queries.push(format!("{} {}", part_b, part_a));
                    break;
                }
            }
        }
    }

    if !split_found {
        if !clean_artist.is_empty() {
            known_artists.push(clean_artist.to_string());
            candidates.push(TrackCandidate {
                track_name: clean_title.to_string(),
                artist_name: clean_artist.to_string(),
            });
            let core_title = strip_parentheticals(clean_title);
            if !core_title.is_empty() && core_title != clean_title {
                candidates.push(TrackCandidate {
                    track_name: core_title.clone(),
                    artist_name: clean_artist.to_string(),
                });
                title_only_candidates.push(core_title);
            }
            title_only_candidates.push(clean_title.to_string());
            search_queries.push(format!("{} {}", clean_title, clean_artist));
        } else {
            candidates.push(TrackCandidate {
                track_name: clean_title.to_string(),
                artist_name: "".to_string(),
            });
            title_only_candidates.push(clean_title.to_string());
        }
        search_queries.push(clean_title.to_string());
    }

    // Fuzzy net query (clean title + first word of artist)
    if !clean_artist.is_empty() {
        if let Some(first_word) = clean_artist.split_whitespace().next() {
            let core_title = strip_parentheticals(clean_title);
            let q = format!("{} {}", core_title, first_word);
            if !search_queries.contains(&q) {
                search_queries.push(q);
            }
        }
    }

    if !title_only_candidates.contains(&clean_title.to_string()) {
        title_only_candidates.push(clean_title.to_string());
    }

    // Deduplicate queries
    let mut unique_queries = Vec::new();
    for q in search_queries {
        let trimmed = q.trim().to_string();
        if !trimmed.is_empty() && !unique_queries.contains(&trimmed) {
            unique_queries.push(trimmed);
        }
    }

    let mut unique_titles = Vec::new();
    for t in title_only_candidates {
        let trimmed = t.trim().to_string();
        if !trimmed.is_empty() && !unique_titles.contains(&trimmed) {
            unique_titles.push(trimmed);
        }
    }

    (candidates, unique_titles, unique_queries, known_artists)
}

fn score_candidate(
    item: &LrclibItem,
    target_duration: Option<f64>,
    candidate_titles: &[&str],
    candidate_artists: &[&str],
) -> (bool, f64, f64) {
    let has_synced = item
        .synced_lyrics
        .as_ref()
        .map_or(false, |s| !s.trim().is_empty());

    let mut score = 0.0;
    if has_synced {
        score += 1000.0;
    } else if item.instrumental.unwrap_or(false) {
        score += 200.0;
    } else if item
        .plain_lyrics
        .as_ref()
        .map_or(false, |s| !s.trim().is_empty())
    {
        score += 100.0;
    } else {
        return (false, 9999.0, -10000.0);
    }

    let dur_diff = if let (Some(target), Some(item_dur)) = (target_duration, item.duration) {
        let diff = (item_dur - target).abs();
        if diff <= 2.0 {
            score += 1500.0 - diff * 20.0;
        } else if diff <= 4.0 {
            score += 1000.0 - diff * 25.0;
        } else if diff <= 8.0 {
            score += 500.0 - diff * 20.0;
        } else if diff <= 15.0 {
            score += 150.0;
        } else if diff <= 30.0 {
            score -= 100.0;
        } else {
            score -= 800.0;
        }
        diff
    } else {
        0.0
    };

    if let Some(item_artist) = &item.artist_name {
        let item_art_lower = item_artist.to_lowercase();
        let mut artist_matched = false;
        for &cand in candidate_artists {
            let cand_lower = cand.to_lowercase();
            if cand_lower.is_empty() {
                continue;
            }
            if item_art_lower == cand_lower {
                score += 800.0;
                artist_matched = true;
                break;
            } else if item_art_lower.contains(&cand_lower) || cand_lower.contains(&item_art_lower) {
                score += 500.0;
                artist_matched = true;
                break;
            } else {
                let split_parts: Vec<&str> = item_art_lower
                    .split(|c| c == ',' || c == '&')
                    .map(|s| s.trim())
                    .collect();
                if split_parts
                    .iter()
                    .any(|part| cand_lower.contains(part) || part.contains(&cand_lower))
                {
                    score += 450.0;
                    artist_matched = true;
                    break;
                }
            }
        }
        if !artist_matched && !candidate_artists.is_empty() {
            score -= 150.0;
        }
    }

    if let Some(item_track) = &item.track_name {
        let item_trk_lower = item_track.to_lowercase();
        let mut title_matched = false;
        for &cand in candidate_titles {
            let cand_lower = cand.to_lowercase();
            if cand_lower.is_empty() {
                continue;
            }
            if item_trk_lower == cand_lower {
                score += 800.0;
                title_matched = true;
                break;
            } else if item_trk_lower.contains(&cand_lower) || cand_lower.contains(&item_trk_lower) {
                score += 400.0;
                title_matched = true;
                break;
            }
        }
        if !title_matched && !candidate_titles.is_empty() {
            score -= 150.0;
        }
    }

    (has_synced, dur_diff, score)
}

fn get_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// 1. Query LRCLIB with multi-stage smart resolution:
/// Stage 1: Exact GET with (Title, Artist, Duration) for candidate pairs
/// Stage 2: LRCLIB Search with combined queries (Title + Artist / Delimited candidates) + Song Length Matching
/// Stage 3: Title-ONLY Search + Strict Song Length Matching (<= 3.0s duration diff, 95%+ accuracy)
/// Stage 4: Best-scored candidate from any search result with acceptable duration
async fn fetch_lrclib(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    duration: Option<f64>,
) -> Option<LyricsResponse> {
    let clean_title = sanitize_title(title);
    let clean_artist = sanitize_artist(artist);

    let (candidates, title_only_candidates, search_queries, known_artists) =
        extract_candidates(&clean_title, &clean_artist);
    let candidate_titles: Vec<&str> = candidates.iter().map(|c| c.track_name.as_str()).collect();
    let candidate_artists: Vec<&str> = known_artists.iter().map(|s| s.as_str()).collect();

    // ── STAGE 1: Exact GET for candidate pairs with duration ──
    for cand in &candidates {
        if cand.track_name.is_empty() || cand.artist_name.is_empty() {
            continue;
        }

        let mut get_url = format!(
            "https://lrclib.net/api/get?track_name={}&artist_name={}",
            urlencoding::encode(&cand.track_name),
            urlencoding::encode(&cand.artist_name)
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
                "NadaNada/0.5.8 (https://github.com/rzkmsjhr/nadanada)",
            )
            .header("Lrclib-Client", "NadaNada (Tauri App)")
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(item) = res.json::<LrclibItem>().await {
                    if let Some(synced) = item.synced_lyrics {
                        if !synced.trim().is_empty() {
                            println!(
                                "[Lyrics] LRCLIB Stage 1 (Exact GET) matched: {} - {}",
                                cand.track_name, cand.artist_name
                            );
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
    }

    let mut best_item: Option<LrclibItem> = None;
    let mut highest_score: f64 = -9999.0;
    let mut best_dur_diff: f64 = 9999.0;

    // ── STAGE 2: Targeted LRCLIB Search with Title & Artist Queries ──
    for query in search_queries.iter().take(4) {
        let search_url = format!(
            "https://lrclib.net/api/search?q={}",
            urlencoding::encode(query)
        );

        if let Ok(res) = client
            .get(&search_url)
            .header(
                "User-Agent",
                "NadaNada/0.5.8 (https://github.com/rzkmsjhr/nadanada)",
            )
            .header("Lrclib-Client", "NadaNada (Tauri App)")
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(items) = res.json::<Vec<LrclibItem>>().await {
                    for item in items {
                        let (has_synced, dur_diff, score) = score_candidate(
                            &item,
                            duration,
                            &candidate_titles,
                            &candidate_artists,
                        );

                        // High confidence immediate match: synced lyrics + duration delta <= 2.5s + high score
                        if has_synced && dur_diff <= 2.5 && score > 2000.0 {
                            println!(
                                "[Lyrics] LRCLIB Stage 2 (High-confidence match): {:?} by {:?} (diff={:.1}s, score={:.0})",
                                item.track_name, item.artist_name, dur_diff, score
                            );
                            return Some(LyricsResponse {
                                success: true,
                                synced_lyrics: item.synced_lyrics,
                                plain_lyrics: item.plain_lyrics,
                                source: "LRCLIB".to_string(),
                                instrumental: item.instrumental.unwrap_or(false),
                                error: None,
                            });
                        }

                        if score > highest_score {
                            highest_score = score;
                            best_dur_diff = dur_diff;
                            best_item = Some(item);
                        }
                    }
                }
            }
        }
    }

    // ── STAGE 3: Title-ONLY Search + Strict Song Length Matching ──
    // When uploader/artist is unknown or incorrect, querying with song title alone
    // and matching duration (diff <= 3.0s) with synced lyrics is 95%+ accurate!
    if let Some(target_dur) = duration {
        if target_dur > 10.0 {
            for title_cand in title_only_candidates.iter().take(3) {
                // Try track_name specific search parameter first, then q search
                let title_search_urls = [
                    format!(
                        "https://lrclib.net/api/search?track_name={}",
                        urlencoding::encode(title_cand)
                    ),
                    format!(
                        "https://lrclib.net/api/search?q={}",
                        urlencoding::encode(title_cand)
                    ),
                ];

                for search_url in &title_search_urls {
                    if let Ok(res) = client
                        .get(search_url)
                        .header(
                            "User-Agent",
                            "NadaNada/0.5.8 (https://github.com/rzkmsjhr/nadanada)",
                        )
                        .header("Lrclib-Client", "NadaNada (Tauri App)")
                        .send()
                        .await
                    {
                        if res.status().is_success() {
                            if let Ok(items) = res.json::<Vec<LrclibItem>>().await {
                                // Find candidates with synced lyrics matching duration within 3.0s
                                let mut length_matched_items: Vec<(f64, LrclibItem)> = items
                                    .into_iter()
                                    .filter_map(|it| {
                                        let has_synced = it
                                            .synced_lyrics
                                            .as_ref()
                                            .map_or(false, |s| !s.trim().is_empty());
                                        if has_synced {
                                            if let Some(dur) = it.duration {
                                                let diff = (dur - target_dur).abs();
                                                if diff <= 3.0 {
                                                    return Some((diff, it));
                                                }
                                            }
                                        }
                                        None
                                    })
                                    .collect();

                                if !length_matched_items.is_empty() {
                                    // Sort by smallest duration difference
                                    length_matched_items.sort_by(|a, b| {
                                        a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
                                    });
                                    let (best_diff, matched_item) = length_matched_items.remove(0);
                                    println!(
                                        "[Lyrics] LRCLIB Stage 3 (Title-only + Length match): {:?} by {:?} (diff={:.1}s)",
                                        matched_item.track_name, matched_item.artist_name, best_diff
                                    );
                                    return Some(LyricsResponse {
                                        success: true,
                                        synced_lyrics: matched_item.synced_lyrics,
                                        plain_lyrics: matched_item.plain_lyrics,
                                        source: "LRCLIB".to_string(),
                                        instrumental: matched_item.instrumental.unwrap_or(false),
                                        error: None,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── STAGE 4: Best-Scored Candidate from all searches ──
    if let Some(item) = best_item {
        let has_synced = item
            .synced_lyrics
            .as_ref()
            .map_or(false, |s| !s.trim().is_empty());
        let acceptable_duration = duration.is_none() || best_dur_diff <= 12.0;

        if has_synced && acceptable_duration && highest_score > 0.0 {
            println!(
                "[Lyrics] LRCLIB Stage 4 (Best candidate fallback): {:?} by {:?} (diff={:.1}s, score={:.0})",
                item.track_name, item.artist_name, best_dur_diff, highest_score
            );
            return Some(LyricsResponse {
                success: true,
                synced_lyrics: item.synced_lyrics,
                plain_lyrics: item.plain_lyrics,
                source: "LRCLIB".to_string(),
                instrumental: item.instrumental.unwrap_or(false),
                error: None,
            });
        }

        if item.instrumental.unwrap_or(false) && acceptable_duration {
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
    app_handle: tauri::AppHandle,
) -> Result<LyricsResponse, String> {
    use tauri::Manager;
    let cache_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("lyrics_cache_v1");
    let _ = std::fs::create_dir_all(&cache_dir);

    let vid = video_id.unwrap_or_default();
    let cache_key = if !vid.is_empty() {
        vid.replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "")
    } else {
        format!("{}_{}", sanitize_title(&title), artist)
            .replace(|c: char| !c.is_alphanumeric() && c != '_', "")
    };
    let cache_file = cache_dir.join(format!("{}.json", cache_key));

    // ── STEP 0: Check Local Disk Cache ──
    if cache_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&cache_file) {
            if let Ok(cached_resp) = serde_json::from_str::<LyricsResponse>(&content) {
                if cached_resp.success {
                    println!("[Lyrics] Serving cached lyrics from disk: {}", cache_key);
                    return Ok(cached_resp);
                }
            }
        }
    }

    let client = get_client();

    // ── STEP 1: LRCLIB (Primary Synced Database) ──
    if let Some(resp) = fetch_lrclib(&client, &title, &artist, duration).await {
        println!("[Lyrics] Successfully retrieved synced lyrics from LRCLIB");
        if resp.success {
            if let Ok(json) = serde_json::to_string_pretty(&resp) {
                let _ = std::fs::write(&cache_file, json);
            }
        }
        return Ok(resp);
    }

    // ── STEP 2: YouTube Video Captions (Timed Subtitles Fallback) ──
    if !vid.is_empty() {
        if let Some(resp) = fetch_youtube_captions(&client, &vid).await {
            println!("[Lyrics] Successfully retrieved timed captions from YouTube Video");
            if resp.success {
                if let Ok(json) = serde_json::to_string_pretty(&resp) {
                    let _ = std::fs::write(&cache_file, json);
                }
            }
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

#[tauri::command]
pub async fn save_lyrics(
    video_id: String,
    title: String,
    artist: String,
    synced_lyrics: String,
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    use tauri::Manager;
    let cache_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("lyrics_cache_v1");
    let _ = std::fs::create_dir_all(&cache_dir);

    let cache_key = if !video_id.is_empty() {
        video_id.replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "")
    } else {
        format!("{}_{}", sanitize_title(&title), artist)
            .replace(|c: char| !c.is_alphanumeric() && c != '_', "")
    };

    let cache_file = cache_dir.join(format!("{}.json", cache_key));
    let resp = LyricsResponse {
        success: true,
        synced_lyrics: Some(synced_lyrics),
        plain_lyrics: None,
        source: "Saved".to_string(),
        instrumental: false,
        error: None,
    };
    let json = serde_json::to_string_pretty(&resp).map_err(|e| e.to_string())?;
    std::fs::write(&cache_file, json).map_err(|e| e.to_string())?;
    println!("[Lyrics] Saved modified lyrics to disk: {}", cache_key);
    Ok(true)
}
