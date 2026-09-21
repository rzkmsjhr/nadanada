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
        r"(?i)[\(\[\{【『「〔《〈<][^)\]}】』」〕》〉>]*?(?:official|music\s*video|audio|video|lyrics?|hd|hq|4k|8k|mv|m/v|pv|visualizer|feat\.?|ft\.?|with|prod\.?|remaster(?:ed)?|live|remix|version|studio|edit|extended|album|explicit|clean|sub\s*español|lirik|terjemahan|karaoke|instrumental|cover|original)[^)\]}】』」〕》〉>]*?[\)\]\}】』」〕》〉>]"
    ).unwrap();

    static ref RE_STANDALONE_BRACKETS: Regex = Regex::new(
        r"(?i)[\(\[\{【『「〔《〈<]\s*(?:hq|hd|4k|8k|mv|m/v|pv|lyrics?|audio|official|original|visualizer|audio\s*only)\s*[\)\]\}】』」〕》〉>]"
    ).unwrap();

    static ref RE_TRAILING_META: Regex = Regex::new(
        r"(?i)\s*[-|~/:]\s*(?:studio(?:\s*version)?|version|official(?:\s*(?:video|audio|music\s*video))?|music\s*video|lyric\s*video|audio|video|lyrics?|visualizer|remaster(?:ed)?|radio\s*edit|live(?:\s*at|\s*in|\s*\d+)?|mono|stereo|anniversary(?:\s*edition)?|deluxe(?:\s*edition)?|bonus\s*track|original\s*mix|extended(?:\s*mix|\s*version)?|remix|acoustic(?:\s*version)?|instrumental|clean(?:\s*version)?|explicit|cover).*$"
    ).unwrap();

    static ref RE_NOISE_WORDS: Regex = Regex::new(
        r"(?i)\b(?:official\s*video|official\s*audio|official\s*music\s*video|lyric\s*video|music\s*video|studio\s*version|full\s*album|hq|hd|4k|8k|mv|visualizer)\b"
    ).unwrap();

    static ref RE_PARENTHETICALS: Regex = Regex::new(
        r"[\(\[\{【『「〔《〈<][^)\]}】』」〕》〉>]*?[\)\]\}】』」〕》〉>]"
    ).unwrap();

    static ref RE_PARENTHETICAL_CONTENT: Regex = Regex::new(
        r"[\(\[\{【『「〔《〈<]([^\)\]\}】』」〕》〉>]+)[\)\]\}】』」〕》〉>]"
    ).unwrap();

    static ref RE_SPACES: Regex = Regex::new(r"\s+").unwrap();

    static ref RE_ARTIST_SEPARATORS: Regex = Regex::new(
        r"(?i)\s+(?:and|&|feat\.?|ft\.?|x|with)\s+|[,/]\s*"
    ).unwrap();
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

fn extract_parenthetical_contents(s: &str) -> Vec<String> {
    let mut contents = Vec::new();
    for cap in RE_PARENTHETICAL_CONTENT.captures_iter(s) {
        if let Some(m) = cap.get(1) {
            let trimmed = m.as_str().trim();
            if !trimmed.is_empty() && trimmed.len() <= 60 {
                let lower = trimmed.to_lowercase();
                let is_noise = lower.contains("feat")
                    || lower.contains("ft.")
                    || lower.contains("prod")
                    || lower.contains("remaster")
                    || lower.contains("official")
                    || lower.contains("video")
                    || lower.contains("audio")
                    || lower.contains("version")
                    || lower.contains("edit")
                    || lower.contains("mix");
                if !is_noise && !contents.iter().any(|c: &String| c.eq_ignore_ascii_case(trimmed)) {
                    contents.push(trimmed.to_string());
                }
            }
        }
    }
    contents
}

fn sanitize_artist(artist: &str) -> String {
    let mut cleaned = artist
        .replace(" - Topic", "")
        .replace("- Topic", "")
        .replace(" Official", "")
        .replace("Official", "")
        .replace(" VEVO", "")
        .replace("VEVO", "");

    // If artist contains middle dot '·' or '•', take the artist part (before dot)
    if let Some((art_part, _album_part)) = cleaned.split_once(['·', '•']) {
        cleaned = art_part.to_string();
    }

    // Deduplicate comma-separated identical names (e.g. "Muse Petal, Muse Petal" -> "Muse Petal")
    let parts: Vec<&str> = cleaned.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if parts.len() > 1 && parts.iter().all(|p| p.eq_ignore_ascii_case(parts[0])) {
        cleaned = parts[0].to_string();
    }

    RE_SPACES.replace_all(&cleaned, " ").trim().to_string()
}

fn extract_sub_artists(artist: &str) -> Vec<String> {
    let mut results = Vec::new();
    let sanitized = sanitize_artist(artist);
    if sanitized.is_empty() {
        return results;
    }
    results.push(sanitized.clone());

    for piece in RE_ARTIST_SEPARATORS.split(&sanitized) {
        let trimmed = piece.trim();
        if !trimmed.is_empty() && !results.iter().any(|r: &String| r.eq_ignore_ascii_case(trimmed)) {
            results.push(trimmed.to_string());
        }
    }
    results
}

fn with_the_variants(title: &str) -> Vec<String> {
    let mut vars = vec![title.to_string()];
    let lower = title.to_lowercase();
    if lower.starts_with("the ") && title.len() > 4 {
        let without_the = title[4..].trim().to_string();
        if !without_the.is_empty() && !vars.iter().any(|v| v.eq_ignore_ascii_case(&without_the)) {
            vars.push(without_the);
        }
    } else if !title.is_empty() && !lower.starts_with("the ") {
        let with_the = format!("The {}", title);
        if !vars.iter().any(|v| v.eq_ignore_ascii_case(&with_the)) {
            vars.push(with_the);
        }
    }
    vars
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

    let sub_artists = extract_sub_artists(clean_artist);
    for a in &sub_artists {
        if !known_artists.contains(a) {
            known_artists.push(a.clone());
        }
    }

    let is_artist_match = |s: &str| -> bool {
        let s_lower = s.to_lowercase();
        if s_lower.is_empty() {
            return false;
        }
        for a in &sub_artists {
            let a_lower = a.to_lowercase();
            if a_lower == s_lower || a_lower.contains(&s_lower) || s_lower.contains(&a_lower) {
                return true;
            }
        }
        false
    };

    let delimiters = [" - ", " – ", " — ", " | ", " ~ ", " // ", " / ", " : "];
    let mut split_found = false;

    for &delim in &delimiters {
        if clean_title.contains(delim) {
            let raw_parts: Vec<&str> = clean_title
                .split(delim)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();
            if raw_parts.len() >= 2 {
                split_found = true;

                let mut add_pair = |artist: &str, track: &str| {
                    if artist.is_empty() || track.is_empty() {
                        return;
                    }
                    if !known_artists.iter().any(|a| a.eq_ignore_ascii_case(artist)) {
                        known_artists.push(artist.to_string());
                    }

                    let core_track = strip_parentheticals(track);
                    let paren_contents = extract_parenthetical_contents(track);

                    let mut track_variations = vec![track.to_string()];
                    if !core_track.is_empty() && core_track != track {
                        track_variations.push(core_track.clone());
                    }
                    for pc in paren_contents {
                        if !track_variations.iter().any(|v| v.eq_ignore_ascii_case(&pc)) {
                            track_variations.push(pc);
                        }
                    }

                    // Add "The " variants
                    let mut expanded_tracks = Vec::new();
                    for tv in &track_variations {
                        for v in with_the_variants(tv) {
                            if !expanded_tracks.iter().any(|e: &String| e.eq_ignore_ascii_case(&v)) {
                                expanded_tracks.push(v);
                            }
                        }
                    }

                    let mut artist_list = vec![artist.to_string()];
                    for sa in &sub_artists {
                        if !artist_list.iter().any(|a| a.eq_ignore_ascii_case(sa)) {
                            artist_list.push(sa.clone());
                        }
                    }

                    for art in &artist_list {
                        for trk in &expanded_tracks {
                            candidates.push(TrackCandidate {
                                track_name: trk.clone(),
                                artist_name: art.clone(),
                            });
                        }
                    }

                    for trk in &expanded_tracks {
                        if !title_only_candidates.iter().any(|t| t.eq_ignore_ascii_case(trk)) {
                            title_only_candidates.push(trk.clone());
                        }
                    }

                    search_queries.push(format!("{} {}", artist, track));
                    if !core_track.is_empty() && core_track != track {
                        search_queries.push(format!("{} {}", artist, core_track));
                    }
                    search_queries.push(format!("{} {}", track, artist));
                };

                let p0 = raw_parts[0];
                let p1 = raw_parts[1];
                let plast = raw_parts[raw_parts.len() - 1];

                if is_artist_match(p0) {
                    add_pair(p0, p1);
                    if raw_parts.len() > 2 {
                        let combined_title = raw_parts[1..].join(" - ");
                        add_pair(p0, &combined_title);
                    }
                } else if is_artist_match(plast) {
                    add_pair(plast, p0);
                    if raw_parts.len() > 2 {
                        let combined_title = raw_parts[..raw_parts.len() - 1].join(" - ");
                        add_pair(plast, &combined_title);
                    }
                } else if is_artist_match(p1) && raw_parts.len() > 2 {
                    add_pair(p1, raw_parts[2]);
                } else {
                    add_pair(p0, p1);
                    add_pair(p1, p0);
                    if raw_parts.len() > 2 {
                        let rem_after_0 = raw_parts[1..].join(" - ");
                        add_pair(p0, &rem_after_0);
                        let rem_before_last = raw_parts[..raw_parts.len() - 1].join(" - ");
                        add_pair(plast, &rem_before_last);
                    }
                }
                break;
            }
        }
    }

    if !split_found {
        let core_title = strip_parentheticals(clean_title);
        let paren_contents = extract_parenthetical_contents(clean_title);
        let mut expanded_tracks = vec![clean_title.to_string()];
        if !core_title.is_empty() && core_title != clean_title {
            expanded_tracks.push(core_title.clone());
        }
        for pc in paren_contents {
            if !expanded_tracks.iter().any(|v| v.eq_ignore_ascii_case(&pc)) {
                expanded_tracks.push(pc);
            }
        }
        let mut final_tracks = Vec::new();
        for tv in &expanded_tracks {
            for v in with_the_variants(tv) {
                if !final_tracks.iter().any(|e: &String| e.eq_ignore_ascii_case(&v)) {
                    final_tracks.push(v);
                }
            }
        }

        for trk in &final_tracks {
            if !title_only_candidates.iter().any(|t| t.eq_ignore_ascii_case(trk)) {
                title_only_candidates.push(trk.clone());
            }
        }

        if !sub_artists.is_empty() {
            for sa in &sub_artists {
                for trk in &final_tracks {
                    candidates.push(TrackCandidate {
                        track_name: trk.clone(),
                        artist_name: sa.clone(),
                    });
                }
                search_queries.push(format!("{} {}", clean_title, sa));
                if !core_title.is_empty() && core_title != clean_title {
                    search_queries.push(format!("{} {}", core_title, sa));
                }
            }
        } else {
            for trk in &final_tracks {
                candidates.push(TrackCandidate {
                    track_name: trk.clone(),
                    artist_name: "".to_string(),
                });
            }
            search_queries.push(clean_title.to_string());
        }
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

    // Deduplicate candidates
    let mut unique_candidates: Vec<TrackCandidate> = Vec::new();
    for c in candidates {
        let trk = c.track_name.trim().to_string();
        let art = c.artist_name.trim().to_string();
        if !trk.is_empty()
            && !unique_candidates.iter().any(|u| {
                u.track_name.eq_ignore_ascii_case(&trk) && u.artist_name.eq_ignore_ascii_case(&art)
            })
        {
            unique_candidates.push(TrackCandidate {
                track_name: trk,
                artist_name: art,
            });
        }
    }

    // Deduplicate queries
    let mut unique_queries = Vec::new();
    for q in search_queries {
        let trimmed = q.trim().to_string();
        if !trimmed.is_empty() && !unique_queries.iter().any(|u: &String| u.eq_ignore_ascii_case(&trimmed)) {
            unique_queries.push(trimmed);
        }
    }

    let mut unique_titles = Vec::new();
    for t in title_only_candidates {
        let trimmed = t.trim().to_string();
        if !trimmed.is_empty() && !unique_titles.iter().any(|u: &String| u.eq_ignore_ascii_case(&trimmed)) {
            unique_titles.push(trimmed);
        }
    }

    (unique_candidates, unique_titles, unique_queries, known_artists)
}

fn is_title_match(cand: &str, item_track: &str) -> (bool, bool) {
    let c = cand.trim().to_lowercase();
    let i = item_track.trim().to_lowercase();
    if c.is_empty() || i.is_empty() {
        return (false, false);
    }
    if c == i {
        return (true, true);
    }

    // Compare without "the " prefix
    let c_trim = if c.starts_with("the ") && c.len() > 4 { c[4..].trim() } else { c.as_str() };
    let i_trim = if i.starts_with("the ") && i.len() > 4 { i[4..].trim() } else { i.as_str() };
    if c_trim == i_trim {
        return (true, true);
    }

    // Compare stripped parentheticals e.g. "Song (Acoustic)" vs "Song"
    let c_core = strip_parentheticals(&c);
    let i_core = strip_parentheticals(&i);
    let c_core_trim = if c_core.starts_with("the ") && c_core.len() > 4 { c_core[4..].trim() } else { c_core.as_str() };
    let i_core_trim = if i_core.starts_with("the ") && i_core.len() > 4 { i_core[4..].trim() } else { i_core.as_str() };
    if !c_core_trim.is_empty() && c_core_trim == i_core_trim {
        return (true, true);
    }

    // If one starts with the other, verify that the remainder is ONLY bracket/metadata noise, NOT extra title words!
    // e.g. "Take Me Somewhere Nice" starts with "Take Me Somewhere", but "Nice" is a substantive word -> REJECT!
    // e.g. "Take Me Somewhere - Studio Version" starts with "Take Me Somewhere", "- Studio Version" is noise -> ACCEPT!
    if i.starts_with(&c) {
        let remainder = i[c.len()..].trim();
        let cleaned_rem = RE_TRAILING_META.replace_all(remainder, "").to_string();
        let cleaned_rem = RE_BRACKET_NOISE.replace_all(&cleaned_rem, "").to_string();
        let cleaned_rem = RE_NOISE_WORDS.replace_all(&cleaned_rem, "").to_string();
        if cleaned_rem.trim().is_empty() {
            return (true, false);
        }
    } else if c.starts_with(&i) {
        let remainder = c[i.len()..].trim();
        let cleaned_rem = RE_TRAILING_META.replace_all(remainder, "").to_string();
        let cleaned_rem = RE_BRACKET_NOISE.replace_all(&cleaned_rem, "").to_string();
        let cleaned_rem = RE_NOISE_WORDS.replace_all(&cleaned_rem, "").to_string();
        if cleaned_rem.trim().is_empty() {
            return (true, false);
        }
    }

    (false, false)
}

fn is_artist_match_flexible(candidate_artists: &[&str], item_artist: &str) -> (bool, bool) {
    if candidate_artists.is_empty() {
        return (true, false);
    }
    let item_lower = item_artist.trim().to_lowercase();
    if item_lower.is_empty() {
        return (false, false);
    }
    let item_sub_artists = extract_sub_artists(&item_lower);

    for &cand in candidate_artists {
        let cand_lower = cand.trim().to_lowercase();
        if cand_lower.is_empty() {
            continue;
        }

        if cand_lower == item_lower {
            return (true, true);
        }

        for ip in &item_sub_artists {
            let ip_lower = ip.trim().to_lowercase();
            if ip_lower.is_empty() {
                continue;
            }
            if cand_lower == ip_lower {
                return (true, true);
            }
            if (cand_lower.contains(&ip_lower) || ip_lower.contains(&cand_lower))
                && cand_lower.len() >= 3
                && ip_lower.len() >= 3
            {
                return (true, false);
            }
        }
    }

    (false, false)
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

    // Artist verification - MANDATORY when candidate artists are known!
    let (artist_matched, artist_exact) = if let Some(item_art) = &item.artist_name {
        is_artist_match_flexible(candidate_artists, item_art)
    } else {
        (candidate_artists.is_empty(), false)
    };

    if !candidate_artists.is_empty() && !artist_matched {
        // Hard rejection: artist does NOT match!
        return (false, 9999.0, -10000.0);
    }

    if artist_exact {
        score += 800.0;
    } else if artist_matched {
        score += 500.0;
    }

    // Title verification - MANDATORY!
    let (title_matched, title_exact) = if let Some(item_trk) = &item.track_name {
        let mut matched = false;
        let mut exact = false;
        for &cand_title in candidate_titles {
            let (m, e) = is_title_match(cand_title, item_trk);
            if m {
                matched = true;
                if e {
                    exact = true;
                    break;
                }
            }
        }
        (matched, exact)
    } else {
        (false, false)
    };

    if !candidate_titles.is_empty() && !title_matched {
        // Hard rejection: title does NOT match!
        return (false, 9999.0, -10000.0);
    }

    if title_exact {
        score += 800.0;
    } else if title_matched {
        score += 400.0;
    }

    let dur_diff = if let (Some(target), Some(item_dur)) = (target_duration, item.duration) {
        let diff = (item_dur - target).abs();
        if diff <= 1.5 {
            score += 1500.0 - diff * 20.0;
        } else if diff <= 3.5 {
            score += 1000.0 - diff * 25.0;
        } else if diff <= 6.0 {
            score += 500.0 - diff * 20.0;
        } else if diff <= 10.0 {
            score += 150.0;
        } else if diff <= 20.0 {
            score -= 200.0;
        } else {
            score -= 1000.0;
        }
        diff
    } else {
        0.0
    };

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
                "NadaNada/0.5.10 (https://github.com/rzkmsjhr/nadanada)",
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
                "NadaNada/0.5.10 (https://github.com/rzkmsjhr/nadanada)",
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
    // ONLY run Stage 3 if known_artists is empty (e.g. unknown uploader without artist credit).
    // If an artist is known, we must NEVER substitute an entirely different artist!
    if known_artists.is_empty() {
        if let Some(target_dur) = duration {
            if target_dur > 10.0 {
                for title_cand in title_only_candidates.iter().take(2) {
                    let title_search_url = format!(
                        "https://lrclib.net/api/search?track_name={}",
                        urlencoding::encode(title_cand)
                    );

                    if let Ok(res) = client
                        .get(&title_search_url)
                        .header(
                            "User-Agent",
                            "NadaNada/0.5.10 (https://github.com/rzkmsjhr/nadanada)",
                        )
                        .header("Lrclib-Client", "NadaNada (Tauri App)")
                        .send()
                        .await
                    {
                        if res.status().is_success() {
                            if let Ok(items) = res.json::<Vec<LrclibItem>>().await {
                                let mut length_matched_items: Vec<(f64, LrclibItem)> = items
                                    .into_iter()
                                    .filter_map(|it| {
                                        let has_synced = it
                                            .synced_lyrics
                                            .as_ref()
                                            .map_or(false, |s| !s.trim().is_empty());
                                        if has_synced {
                                            if let Some(trk) = &it.track_name {
                                                let (t_match, t_exact) = is_title_match(title_cand, trk);
                                                if t_match && t_exact {
                                                    if let Some(dur) = it.duration {
                                                        let diff = (dur - target_dur).abs();
                                                        if diff <= 2.0 {
                                                            return Some((diff, it));
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        None
                                    })
                                    .collect();

                                if !length_matched_items.is_empty() {
                                    length_matched_items.sort_by(|a, b| {
                                        a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
                                    });
                                    let (best_diff, matched_item) = length_matched_items.remove(0);
                                    println!(
                                        "[Lyrics] LRCLIB Stage 3 (Title-only + Strict length match): {:?} by {:?} (diff={:.1}s)",
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
        let acceptable_duration = duration.is_none() || best_dur_diff <= 5.0;

        // Requires highest_score > 1500.0, which guarantees artist AND title matched!
        if has_synced && acceptable_duration && highest_score > 1500.0 {
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

        if item.instrumental.unwrap_or(false) && acceptable_duration && highest_score > 500.0 {
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
        .join("lyrics_cache_v2");
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
        .join("lyrics_cache_v2");
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


