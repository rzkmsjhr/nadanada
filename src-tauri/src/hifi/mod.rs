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
) -> Result<Option<HifiTrackResult>, String> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Ok(None);
    }

    let channel_str = channel.as_deref().unwrap_or("");
    let item_type_str = item_type.as_deref();

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
    let queries = if !meta.search_queries.is_empty() {
        meta.search_queries
    } else {
        vec![format!("{} {}", channel_str, clean_title)]
    };

    // 2. Primary Provider: flac.music.hi.cn (Kuwo lossless FLAC multi-query)
    let mut best_kuwo: Option<(kuwo::KuwoCandidateTrack, kuwo::KuwoMinfo, u32)> = None;

    for (q_idx, query) in queries.iter().take(3).enumerate() {
        eprintln!("[HIFI RESOLVE] [Pass {}] Querying Kuwo for: {}", q_idx + 1, query);
        if let Ok(candidates) = kuwo::search_kuwo(query, 8).await {
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

                let score = matcher::score_track_candidate(
                    clean_title,
                    channel_str,
                    dur_secs,
                    isrc.as_deref(),
                    &cand_id,
                    cand_title,
                    cand_artist,
                    cand_dur,
                    None,
                );

                if score >= 85 {
                    if let Some((_, _, best_score)) = &best_kuwo {
                        if score > *best_score {
                            best_kuwo = Some((cand, flac_info, score));
                        }
                    } else {
                        best_kuwo = Some((cand, flac_info, score));
                    }
                }
            }
        }

        // Early exit on definitive high-confidence match
        if let Some((_, _, s)) = &best_kuwo {
            if *s >= 120 {
                break;
            }
        }
    }

    if let Some((cand, flac_info, score)) = best_kuwo {
                let song_id = cand.get_id();
                let bitrate = flac_info.bitrate_str();
                let time_val = cand.time.clone().unwrap_or(serde_json::Value::Null);
                let sign_val = cand.sign.as_deref().unwrap_or("");

                match kuwo::get_kuwo_flac_url(&song_id, &time_val, sign_val, &bitrate).await {
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
        eprintln!("[HIFI RESOLVE] Kuwo search returned no matching candidate >= 85. Falling back to Monochrome.");
    }

    // 3. Fallback Provider: Monochrome Instance Pool
    let fallback_query = queries.first().map(|s| s.as_str()).unwrap_or(clean_title);
    eprintln!("[HIFI RESOLVE] Searching fallback Monochrome instance pool for: {}", fallback_query);

    let candidates = match instances::search_tracks_pool(fallback_query, 12).await {
        Ok(tracks) => tracks,
        Err(e) => {
            eprintln!("[HIFI RESOLVE] Monochrome upstream search failed: {}", e);
            if !id_key.is_empty() {
                cache::mark_unmatched(id_key.to_string());
            }
            cache::mark_unmatched(text_key);
            return Ok(None);
        }
    };

    let mut best_match: Option<(instances::RawCandidateTrack, u32)> = None;

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
            &cand_id,
            cand_title,
            &cand_artist,
            cand_dur,
            cand_isrc,
        );

        if score >= 85 {
            if let Some((_, best_score)) = &best_match {
                if score > *best_score {
                    best_match = Some((cand, score));
                }
            } else {
                best_match = Some((cand, score));
            }
        }
    }

    if let Some((matched, score)) = best_match {
        let hifi_id = matched.get_id().unwrap();
        let matched_title = matched.title.clone().unwrap_or_else(|| clean_title.to_string());
        let matched_artist = matched.get_artist_name();
        let matched_dur = matched.get_duration_secs();
        let is_cached = cache::is_track_cached(&hifi_id);

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
        cache::set_cached_resolution(text_key, info);

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
}
