use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedHifiInfo {
    pub hifi_id: String,
    pub title: String,
    pub artist: String,
    pub duration: u64,
    pub is_cached: bool,
    #[serde(default)]
    pub source: Option<String>,
}

lazy_static! {
    static ref RESOLUTION_CACHE: Mutex<HashMap<String, ResolvedHifiInfo>> = Mutex::new(HashMap::new());
    static ref UNMATCHED_CACHE: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
    static ref ACTIVE_DOWNLOADS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
    static ref DIRECT_URLS: Mutex<HashMap<String, String>> = Mutex::new(load_persisted_urls());
    static ref FAILED_UPSTREAMS: Mutex<HashMap<String, (Instant, String)>> = Mutex::new(HashMap::new());
    static ref RECENT_ATTEMPTS: Mutex<HashMap<String, Instant>> = Mutex::new(HashMap::new());
}

pub fn get_cache_dir() -> PathBuf {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    data_dir.push("hifi_cache");
    if !data_dir.exists() {
        let _ = fs::create_dir_all(&data_dir);
    }
    data_dir
}

fn load_persisted_urls() -> HashMap<String, String> {
    let path = get_cache_dir().join("urls.json");
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&data) {
            return map;
        }
    }
    HashMap::new()
}

pub fn get_direct_url(track_id: &str) -> Option<String> {
    let lock = DIRECT_URLS.lock().ok()?;
    lock.get(track_id).cloned()
}

pub fn set_direct_url(track_id: String, url: String) {
    if let Ok(mut lock) = DIRECT_URLS.lock() {
        lock.insert(track_id, url);
        let path = get_cache_dir().join("urls.json");
        if let Ok(json) = serde_json::to_string(&*lock) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn clear_direct_url(track_id: &str) {
    if let Ok(mut lock) = DIRECT_URLS.lock() {
        lock.remove(track_id);
        let path = get_cache_dir().join("urls.json");
        if let Ok(json) = serde_json::to_string(&*lock) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn get_cached_track_path(track_id: &str) -> Option<PathBuf> {
    let flac_path = get_cache_dir().join(format!("{}.flac", track_id));
    if flac_path.is_file() {
        if let Ok(metadata) = fs::metadata(&flac_path) {
            // Require at least 50KB for a valid audio file
            if metadata.len() > 50_000 {
                return Some(flac_path);
            }
        }
    }
    let mp3_path = get_cache_dir().join(format!("{}.mp3", track_id));
    if mp3_path.is_file() {
        if let Ok(metadata) = fs::metadata(&mp3_path) {
            if metadata.len() > 50_000 {
                return Some(mp3_path);
            }
        }
    }
    None
}

pub fn is_track_cached(track_id: &str) -> bool {
    get_cached_track_path(track_id).is_some()
}

pub fn get_cached_resolution(key: &str) -> Option<ResolvedHifiInfo> {
    let lock = RESOLUTION_CACHE.lock().ok()?;
    let mut info = lock.get(key).cloned()?;
    info.is_cached = is_track_cached(&info.hifi_id);
    Some(info)
}

pub fn set_cached_resolution(key: String, info: ResolvedHifiInfo) {
    if let Ok(mut lock) = RESOLUTION_CACHE.lock() {
        lock.insert(key, info);
    }
}

pub fn is_marked_unmatched(key: &str) -> bool {
    if let Ok(lock) = UNMATCHED_CACHE.lock() {
        lock.contains(key)
    } else {
        false
    }
}

pub fn mark_unmatched(key: String) {
    if let Ok(mut lock) = UNMATCHED_CACHE.lock() {
        lock.insert(key);
    }
}

pub fn try_acquire_download_lock(track_id: &str) -> bool {
    if let Ok(mut lock) = ACTIVE_DOWNLOADS.lock() {
        if lock.contains(track_id) {
            false
        } else {
            lock.insert(track_id.to_string());
            true
        }
    } else {
        false
    }
}

pub fn release_download_lock(track_id: &str) {
    if let Ok(mut lock) = ACTIVE_DOWNLOADS.lock() {
        lock.remove(track_id);
    }
}

/// Checks if a track failed recently and is in cooldown (60s default, 300s for HTTP 429).
pub fn is_in_failure_cooldown(track_id: &str) -> Option<String> {
    let mut lock = FAILED_UPSTREAMS.lock().ok()?;
    if let Some((failed_at, err_msg)) = lock.get(track_id) {
        let cooldown_secs = if err_msg.contains("429") { 300 } else { 60 };
        if failed_at.elapsed().as_secs() < cooldown_secs {
            return Some(err_msg.clone());
        }
    }
    lock.remove(track_id);
    None
}

/// Records that an upstream fetch for a track failed, entering cooldown.
pub fn record_upstream_failure(track_id: &str, err_msg: &str) {
    if let Ok(mut lock) = FAILED_UPSTREAMS.lock() {
        lock.insert(track_id.to_string(), (Instant::now(), err_msg.to_string()));
    }
    let dir = get_cache_dir();
    let _ = fs::remove_file(dir.join(format!("{}.flac.part", track_id)));
    let _ = fs::remove_file(dir.join(format!("{}.mp3.part", track_id)));
}

/// Clears any upstream failure cooldown for a track (e.g. manual user retry).
pub fn clear_upstream_failure(track_id: &str) {
    if let Ok(mut lock) = FAILED_UPSTREAMS.lock() {
        lock.remove(track_id);
    }
}

/// Rate-limits upstream attempts per track: allows at most 1 request per 2.5 seconds per track.
pub fn check_and_record_rate_limit(track_id: &str) -> bool {
    if let Ok(mut lock) = RECENT_ATTEMPTS.lock() {
        if let Some(last) = lock.get(track_id) {
            if last.elapsed().as_millis() < 2500 {
                return false; // Rate-limited!
            }
        }
        lock.insert(track_id.to_string(), Instant::now());
        true
    } else {
        true
    }
}

pub fn clear_hifi_cache() -> Result<usize, String> {
    let dir = get_cache_dir();
    let mut count = 0;
    if dir.exists() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let _ = fs::remove_file(p);
                    count += 1;
                }
            }
        }
    }
    if let Ok(mut lock) = DIRECT_URLS.lock() {
        lock.clear();
    }
    if let Ok(mut lock) = RESOLUTION_CACHE.lock() {
        lock.clear();
    }
    if let Ok(mut lock) = UNMATCHED_CACHE.lock() {
        lock.clear();
    }
    Ok(count)
}
