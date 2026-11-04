pub mod cache;
pub mod instances;
pub mod kuwo;
pub mod matcher;
pub mod script;

use serde::{Deserialize, Serialize};
use crate::server::EMBED_PORT;
use std::sync::atomic::Ordering;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HifiTrackResult {
    pub stream_url: String,
    pub source: String,
    pub hifi_id: String,
    pub title: String,
    pub artist: String,
    pub duration: u64,
    pub is_cached: bool,
    pub match_score: u32,
}

pub fn parse_duration_to_secs(dur: Option<&str>) -> u64 {
    let s = match dur {
        Some(val) if !val.trim().is_empty() => val.trim(),
        _ => return 0,
    };

    if let Ok(f) = s.parse::<f64>() {
        let num = f.round() as u64;
        return if num > 10000 { num / 1000 } else { num };
    }

    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        2 => {
            let m = parts[0].parse::<u64>().unwrap_or(0);
            let sec = parts[1].parse::<u64>().unwrap_or(0);
            m * 60 + sec
        }
        3 => {
            let h = parts[0].parse::<u64>().unwrap_or(0);
            let m = parts[1].parse::<u64>().unwrap_or(0);
            let sec = parts[2].parse::<u64>().unwrap_or(0);
            h * 3600 + m * 60 + sec
        }
        _ => 0,
    }
}

pub fn is_eligible_track(title: &str, channel: Option<&str>, item_type: Option<&str>) -> bool {
    let t = title.to_lowercase();
    let c = channel.unwrap_or("").to_lowercase();
    let it = item_type.unwrap_or("").to_lowercase();

    if it == "video" {
        return false;
    }
    if c.contains("vevo") {
        return false;
    }

    let video_keywords = [
        "official music video",
        "official video",
        "music video",
        "official audio video",
        "lyric video",
        "lyrics video",
        "visualizer",
        "official visualizer",
        "performance video",
        "live performance",
        "dance practice",
        "full concert",
        "[mv]",
        "(mv)",
        "[m/v]",
        "(m/v)",
    ];

    if video_keywords.iter().any(|k| t.contains(k)) {
        return false;
    }

    // Allow songs and music uploads; candidate matcher verifies duration and artist/title match
    true
}

#[tauri::command]
pub fn get_hifi_stream_url(track_id: String) -> String {
    let port = EMBED_PORT.load(Ordering::Relaxed);
    format!("http://127.0.0.1:{}/hifi/stream?id={}", port, track_id)
}

#[tauri::command]
pub fn clear_hifi_disk_cache() -> Result<usize, String> {
    cache::clear_hifi_cache()
}

#[tauri::command]
pub async fn resolve_hifi_track(
    song_id: Option<String>,
    title: String,
    channel: Option<String>,
    duration: Option<String>,
    item_type: Option<String>,
    isrc: Option<String>,
    album: Option<String>,
) -> Result<Option<HifiTrackResult>, String> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Ok(None);
    }

    let channel_str = channel.as_deref().unwrap_or("");
    let item_type_str = item_type.as_deref();
    let target_album = album.as_deref();

    // Check eligibility
    if !is_eligible_track(clean_title, Some(channel_str), item_type_str) {
        return Ok(None);
    }

    let port = EMBED_PORT.load(Ordering::Relaxed);
    let dur_secs = parse_duration_to_secs(duration.as_deref());

    // 1. Check in-memory fast resolution cache
    let id_key = song_id.as_deref().unwrap_or("");
    if !id_key.is_empty() {
        if cache::is_marked_unmatched(id_key) {
            return Ok(None);
        }
        if let Some(cached) = cache::get_cached_resolution(id_key) {
            let source = cached.source.unwrap_or_else(|| {
                if cached.hifi_id.starts_with("kuwo_") {
                    "kuwo".to_string()
                } else {
                    "monochrome".to_string()
                }
            });
            return Ok(Some(HifiTrackResult {
                stream_url: format!("http://127.0.0.1:{}/hifi/stream?id={}", port, cached.hifi_id),
                source,
                hifi_id: cached.hifi_id,
                title: cached.title,
                artist: cached.artist,
                duration: cached.duration,
                is_cached: cached.is_cached,
                match_score: 100,
            }));
        }
    }

    let text_key = format!("{}:::{}", channel_str.to_lowercase(), clean_title.to_lowercase());
    if cache::is_marked_unmatched(&text_key) {
        return Ok(None);
    }
    if let Some(cached) = cache::get_cached_resolution(&text_key) {
        let source = cached.source.unwrap_or_else(|| {
            if cached.hifi_id.starts_with("kuwo_") {
                "kuwo".to_string()
            } else {
                "monochrome".to_string()
            }
        });
        return Ok(Some(HifiTrackResult {
            stream_url: format!("http://127.0.0.1:{}/hifi/stream?id={}", port, cached.hifi_id),
            source,
            hifi_id: cached.hifi_id,
            title: cached.title,
            artist: cached.artist,
            duration: cached.duration,
            is_cached: cached.is_cached,
            match_score: 100,
        }));
    }

    let meta = script::parse_multilingual_metadata(clean_title, Some(channel_str));
    let mut queries = Vec::new();

    // 1. If album is known, prioritize album query first (finds the official album master immediately)
    if let Some(alb) = target_album {
        let alb_clean = alb.trim();
        if !alb_clean.is_empty() {
            queries.push(format!("{} {} {}", channel_str, clean_title, alb_clean));
            let de_ch = script::strip_latin_diacritics(channel_str);
            let de_ti = script::strip_latin_diacritics(clean_title);
            let de_al = script::strip_latin_diacritics(alb_clean);
            if de_ch != channel_str || de_ti != clean_title || de_al != alb_clean {
                let de_alb_query = format!("{} {} {}", de_ch, de_ti, de_al);
                if !queries.contains(&de_alb_query) {
                    queries.push(de_alb_query);
                }
            }
        }
    }

    // 2. Base artist + title query
    let base_query = format!("{} {}", channel_str, clean_title);
    let de_base = format!(
        "{} {}",
        script::strip_latin_diacritics(channel_str),
        script::strip_latin_diacritics(clean_title)
    );
    if de_base != base_query && !queries.contains(&de_base) {
        queries.push(de_base);
    }
    if !queries.contains(&base_query) {
        queries.push(base_query);
    }

    // 3. Multilingual / script queries
    for q in meta.search_queries {
        if !queries.contains(&q) {
            queries.push(q);
        }
    }

    // 2. Primary Provider: flac.music.hi.cn (Kuwo lossless FLAC multi-query)
    let mut best_kuwo: Option<(kuwo::KuwoCandidateTrack, kuwo::KuwoMinfo, u32)> = None;

    for (q_idx, query) in queries.iter().take(4).enumerate() {
        eprintln!("[HIFI RESOLVE] [Pass {}] Querying Kuwo for: {}", q_idx + 1, query);
        if let Ok(candidates) = kuwo::search_kuwo(query, 12).await {
            // Detect albums containing multiple tracks with the identical title (e.g. single releases with Track 1 = Vocal, Track 2 = Minus One/Karaoke)
            let mut album_title_min_id: std::collections::HashMap<(String, String), u64> = std::collections::HashMap::new();
            for c in &candidates {
                let ct = matcher::clean_string(c.name.as_deref().unwrap_or(""));
                let ca = matcher::clean_string(c.album_name.as_deref().unwrap_or(""));
                if !ct.is_empty() && !ca.is_empty() {
                    let id_num: u64 = c.get_id().parse().unwrap_or(u64::MAX);
                    album_title_min_id
                        .entry((ct, ca))
                        .and_modify(|min_id| *min_id = (*min_id).min(id_num))
                        .or_insert(id_num);
                }
            }

            for cand in candidates {
                let flac_info = match cand.get_flac_info() {
                    Some(f) => f,
                    None => continue,
                };
                let cand_id = cand.get_id();
                if cand_id.is_empty() {
                    continue;
                }
                let cand_title = cand.name.as_deref().unwrap_or("");
                let cand_artist = cand.artist.as_deref().unwrap_or("");
                let cand_dur = cand.get_duration_secs();

                let mut score = matcher::score_track_candidate(
                    clean_title,
                    channel_str,
                    dur_secs,
                    isrc.as_deref(),
                    target_album,
                    &cand_id,
                    cand_title,
                    cand_artist,
                    cand_dur,
                    None,
                    cand.album_name.as_deref(),
                );

                if score == 0 {
                    continue;
                }

                // If album has multiple tracks sharing the identical title, the primary vocal track is Track 1 (lowest numeric song ID).
                // Any subsequent track (Track 2+, higher ID) is an unlabelled Minus-One / Accompaniment cut -> penalize heavily.
                let ct = matcher::clean_string(cand_title);
                let ca = matcher::clean_string(cand.album_name.as_deref().unwrap_or(""));
                let id_num: u64 = cand_id.parse().unwrap_or(u64::MAX);
                if let Some(&min_id) = album_title_min_id.get(&(ct, ca)) {
                    if id_num > min_id {
                        score = score.saturating_sub(60);
                    }
                }

                if score >= 140 {
                    if let Some((best_cand, _, best_score)) = &best_kuwo {
                        let is_better = if score > *best_score {
                            true
                        } else if score == *best_score {
                            let curr_id: u64 = cand_id.parse().unwrap_or(u64::MAX);
                            let best_id: u64 = best_cand.get_id().parse().unwrap_or(0);
                            curr_id < best_id
                        } else {
                            false
                        };
                        if is_better {
                            best_kuwo = Some((cand, flac_info, score));
                        }
                    } else {
                        best_kuwo = Some((cand, flac_info, score));
                    }
                }
            }
        }

        // Early exit on definitive high-confidence match
        let early_exit_threshold = if target_album.is_some() { 200 } else { 170 };
        if let Some((_, _, s)) = &best_kuwo {
            if *s >= early_exit_threshold {
                break;
            }
        }
    }

    if let Some((cand, flac_info, score)) = best_kuwo {
                let song_id = cand.get_id();
                let bitrate = flac_info.bitrate_str();
                let time_val = cand.time.clone().unwrap_or(serde_json::Value::Null);
                let sign_val = cand.sign.as_deref().unwrap_or("");

                let format = flac_info.format.as_deref().unwrap_or("flac");
                match kuwo::get_kuwo_flac_url(&song_id, &time_val, sign_val, &bitrate, format).await {
                    Ok(direct_url) => {
                        let hifi_id = format!("kuwo_{}", song_id);
                        let matched_title = cand.name.clone().unwrap_or_else(|| clean_title.to_string());
                        let matched_artist = cand.artist.clone().unwrap_or_else(|| channel_str.to_string());
                        let matched_dur = cand.get_duration_secs();
                        let is_cached = cache::is_track_cached(&hifi_id);

                        cache::set_direct_url(hifi_id.clone(), direct_url);

                        let info = cache::ResolvedHifiInfo {
                            hifi_id: hifi_id.clone(),
                            title: matched_title.clone(),
                            artist: matched_artist.clone(),
                            duration: matched_dur,
                            is_cached,
                            source: Some("kuwo".to_string()),
                        };

                        if !id_key.is_empty() {
                            cache::set_cached_resolution(id_key.to_string(), info.clone());
                        }
                        cache::set_cached_resolution(text_key.clone(), info);

                        eprintln!(
                            "[HIFI RESOLVE] [KUWO PRIMARY] MATCH SUCCESS: \"{}\" -> \"{}\" by {} (ID: {}, score: {}, cached: {})",
                            clean_title, matched_title, matched_artist, hifi_id, score, is_cached
                        );

                        return Ok(Some(HifiTrackResult {
                            stream_url: format!("http://127.0.0.1:{}/hifi/stream?id={}", port, hifi_id),
                            source: "kuwo".to_string(),
                            hifi_id,
                            title: matched_title,
                            artist: matched_artist,
                            duration: matched_dur,
                            is_cached,
                            match_score: score,
                        }));
                    }
                    Err(e) => {
                        eprintln!("[HIFI RESOLVE] Kuwo getUrl error: {}. Falling back to Monochrome.", e);
                    }
                }
    } else {
        eprintln!("[HIFI RESOLVE] Kuwo search returned no qualifying lossless studio candidate >= 140. Falling back to Monochrome.");
    }

    // 3. Fallback Provider: Monochrome Instance Pool (Multi-query fallback)
    let mut mono_queries = Vec::new();
    let base_mono = format!("{} {}", channel_str, clean_title);
    mono_queries.push(base_mono);
    let de_mono = format!(
        "{} {}",
        script::strip_latin_diacritics(channel_str),
        script::strip_latin_diacritics(clean_title)
    );
    if de_mono != mono_queries[0] {
        mono_queries.push(de_mono);
    }
    for q in &queries {
        if !mono_queries.contains(q) {
            mono_queries.push(q.clone());
        }
    }

    let mut best_match: Option<(instances::RawCandidateTrack, u32)> = None;

    for (m_idx, mono_query) in mono_queries.iter().take(3).enumerate() {
        eprintln!("[HIFI RESOLVE] [Monochrome Pass {}] Querying pool for: {}", m_idx + 1, mono_query);
        let candidates = match instances::search_tracks_pool(mono_query, 12).await {
            Ok(tracks) => tracks,
            Err(e) => {
                eprintln!("[HIFI RESOLVE] Monochrome upstream search failed on '{}': {}", mono_query, e);
                continue;
            }
        };

        for cand in candidates {
            let cand_id = match cand.get_id() {
                Some(id) if !id.trim().is_empty() => id,
                _ => continue,
            };
            let cand_title = cand.title.as_deref().unwrap_or("");
            let cand_artist = cand.get_artist_name();
            let cand_dur = cand.get_duration_secs();
            let cand_isrc = cand.isrc.as_deref();

            let score = matcher::score_track_candidate(
                clean_title,
                channel_str,
                dur_secs,
                isrc.as_deref(),
                target_album,
                &cand_id,
                cand_title,
                &cand_artist,
                cand_dur,
                cand_isrc,
                cand.get_album_name(),
            );

            if score >= 140 {
                if let Some((best_cand, best_score)) = &best_match {
                    let is_better = if score > *best_score {
                        true
                    } else if score == *best_score {
                        let curr_id: u64 = cand_id.parse().unwrap_or(u64::MAX);
                        let best_id: u64 = best_cand.get_id().and_then(|id| id.parse().ok()).unwrap_or(0);
                        curr_id < best_id
                    } else {
                        false
                    };
                    if is_better {
                        best_match = Some((cand, score));
                    }
                } else {
                    best_match = Some((cand, score));
                }
            }
        }

        if let Some((_, s)) = &best_match {
            if *s >= 170 {
                break;
            }
        }
    }

    if let Some((matched, score)) = best_match {
        let hifi_id = matched.get_id().unwrap();
        let is_cached = cache::is_track_cached(&hifi_id);

        let is_streamable = if is_cached {
            true
        } else {
            instances::check_stream_availability_pool(&hifi_id).await
        };

        if !is_streamable {
            eprintln!("[HIFI RESOLVE] Monochrome candidate {} failed stream availability check. Rejecting.", hifi_id);
        } else {
            let matched_title = matched.title.clone().unwrap_or_else(|| clean_title.to_string());
            let matched_artist = matched.get_artist_name();
            let matched_dur = matched.get_duration_secs();

            let info = cache::ResolvedHifiInfo {
                hifi_id: hifi_id.clone(),
                title: matched_title.clone(),
                artist: matched_artist.clone(),
                duration: matched_dur,
                is_cached,
                source: Some("monochrome".to_string()),
            };

            if !id_key.is_empty() {
                cache::set_cached_resolution(id_key.to_string(), info.clone());
            }
            cache::set_cached_resolution(text_key.clone(), info);

            eprintln!(
                "[HIFI RESOLVE] [MONOCHROME FALLBACK] MATCH SUCCESS: \"{}\" -> \"{}\" by {} (ID: {}, score: {}, cached: {})",
                clean_title, matched_title, matched_artist, hifi_id, score, is_cached
            );

            return Ok(Some(HifiTrackResult {
                stream_url: format!("http://127.0.0.1:{}/hifi/stream?id={}", port, hifi_id),
                source: "monochrome".to_string(),
                hifi_id,
                title: matched_title,
                artist: matched_artist,
                duration: matched_dur,
                is_cached,
                match_score: score,
            }));
        }
    }

    // No valid match found on either provider
    if !id_key.is_empty() {
        cache::mark_unmatched(id_key.to_string());
    }
    cache::mark_unmatched(text_key);
    eprintln!("[HIFI RESOLVE] No high-confidence candidate found for: \"{}\"", clean_title);

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_and_stream() {
        tauri::async_runtime::block_on(async {
            crate::server::start_embed_server();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            let port = crate::server::EMBED_PORT.load(Ordering::Relaxed);
            assert!(port > 0, "Embed server port should be bound");

            let res = resolve_hifi_track(
                Some("queen_br_123".to_string()),
                "Bohemian Rhapsody".to_string(),
                Some("Queen - Topic".to_string()),
                Some("5:55".to_string()),
                Some("song".to_string()),
                None,
                Some("A Night at the Opera".to_string()),
            ).await;

            match res {
                Ok(Some(matched)) => {
                    println!("Resolved track: {:?}", matched);
                    assert!(!matched.hifi_id.is_empty());
                    assert!(matched.stream_url.starts_with(&format!("http://127.0.0.1:{}", port)));

                    let client = reqwest::Client::new();
                    let stream_res = client.get(&matched.stream_url)
                        .header("Range", "bytes=0-1000")
                        .send()
                        .await;
                    assert!(stream_res.is_ok(), "Local proxy request should succeed");
                    let resp = stream_res.unwrap();
                    println!("Proxy status: {}, content-type: {:?}", resp.status(), resp.headers().get("content-type"));
                    assert!(resp.status().as_u16() == 206 || resp.status().as_u16() == 200 || resp.status().as_u16() == 503);
                }
                Ok(None) => {
                    println!("No candidate matched");
                }
                Err(e) => {
                    panic!("Error: {}", e);
                }
            }
        });
    }

    #[test]
    fn test_cached_stream_range() {
        tauri::async_runtime::block_on(async {
            crate::server::start_embed_server();
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            let port = crate::server::EMBED_PORT.load(Ordering::Relaxed);
            assert!(port > 0);

            // Create a fake cached FLAC file in cache dir
            let cache_dir = cache::get_cache_dir();
            let fake_track_path = cache_dir.join("test_cached_999.flac");
            let fake_data = vec![42u8; 100_000]; // 100KB
            std::fs::write(&fake_track_path, &fake_data).unwrap();

            assert!(cache::is_track_cached("test_cached_999"));

            let client = reqwest::Client::new();
            let url = format!("http://127.0.0.1:{}/hifi/stream?id=test_cached_999", port);
            let res = client.get(&url)
                .header("Range", "bytes=1000-4999")
                .send()
                .await
                .unwrap();

            assert_eq!(res.status().as_u16(), 206);
            assert_eq!(res.headers().get("content-type").unwrap(), "audio/flac");
            assert_eq!(res.headers().get("content-length").unwrap(), "4000");
            assert_eq!(res.headers().get("content-range").unwrap(), "bytes 1000-4999/100000");

            let bytes = res.bytes().await.unwrap();
            assert_eq!(bytes.len(), 4000);
            assert_eq!(bytes[0], 42);

            // Clean up fake file
            let _ = std::fs::remove_file(fake_track_path);
        });
    }

    #[test]
    fn test_feel_it_still_resolution() {
        tauri::async_runtime::block_on(async {
            let res = resolve_hifi_track(
                None,
                "Feel It Still".to_string(),
                Some("Portugal. The Man".to_string()),
                Some("2:45".to_string()),
                None,
                None,
                Some("Woodstock".to_string()),
            ).await.unwrap();
            let track = res.expect("Should resolve track");
            assert_ne!(track.hifi_id, "kuwo_162001181");
            assert_ne!(track.hifi_id, "kuwo_300232622");
        });
    }

    #[test]
    fn test_user_reported_three_tracks() {
        tauri::async_runtime::block_on(async {
            println!("\n>>> TESTING ALAMAK");
            let alamak = resolve_hifi_track(
                None,
                "Alamak".to_string(),
                Some("Rizky Febian, Adrian Khalif".to_string()),
                Some("3:29".to_string()),
                None,
                None,
                Some("Alamak".to_string()),
            ).await.unwrap();
            println!("ALAMAK RESULT: {:?}", alamak);

            println!("\n>>> TESTING SENJA SUDUT KOTA");
            let senja = resolve_hifi_track(
                None,
                "Senja Sudut Kota".to_string(),
                Some("Samuel Cipta".to_string()),
                Some("3:43".to_string()),
                None,
                None,
                Some("Senja Sudut Kota".to_string()),
            ).await.unwrap();
            println!("SENJA RESULT: {:?}", senja);

            println!("\n>>> TESTING MASA LALU");
            let masa = resolve_hifi_track(
                None,
                "Masa Lalu".to_string(),
                Some("Faith".to_string()),
                Some("3:23".to_string()),
                None,
                None,
                Some("Masa Lalu".to_string()),
            ).await.unwrap();
            println!("MASA LALU RESULT: {:?}", masa);
        });
    }
}
