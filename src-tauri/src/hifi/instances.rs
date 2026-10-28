use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT, RANGE};
use serde::Deserialize;

const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

#[derive(Debug)]
pub struct Instance {
    pub base_url: &'static str,
    pub cooldown_until: AtomicU64,
    pub fail_count: AtomicU32,
}

impl Instance {
    const fn new(base_url: &'static str) -> Self {
        Self {
            base_url,
            cooldown_until: AtomicU64::new(0),
            fail_count: AtomicU32::new(0),
        }
    }

    pub fn is_available(&self) -> bool {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        now >= self.cooldown_until.load(Ordering::Relaxed)
    }

    pub fn record_success(&self) {
        self.fail_count.store(0, Ordering::Relaxed);
        self.cooldown_until.store(0, Ordering::Relaxed);
    }

    pub fn record_failure(&self, is_rate_limit: bool) {
        let fails = self.fail_count.fetch_add(1, Ordering::Relaxed) + 1;
        // Keep cooldowns very short (3s - 9s max) so transient bursts reset immediately
        // instead of locking the user out of audio playback for minutes.
        let cooldown_secs = if is_rate_limit {
            3 * (fails as u64).min(3)
        } else {
            2 * (fails as u64).min(3)
        };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        self.cooldown_until.store(now + cooldown_secs, Ordering::Relaxed);
        eprintln!(
            "[HIFI POOL] Instance {} failure #{} (rate_limit: {}), cooling down for {}s",
            self.base_url, fails, is_rate_limit, cooldown_secs
        );
    }
}

pub static INSTANCE_POOL: [Instance; 1] = [
    Instance::new("https://tracks.monochrome.st"),
];

// Global outbound request pacing to prevent burst flooding Cloudflare WAF
static LAST_REQUEST_TIMESTAMP: AtomicU64 = AtomicU64::new(0);

pub async fn pace_request_async() {
    let min_spacing_ms = 350;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let last = LAST_REQUEST_TIMESTAMP.load(Ordering::Relaxed);
    if now < last + min_spacing_ms {
        let wait_ms = (last + min_spacing_ms) - now;
        LAST_REQUEST_TIMESTAMP.store(last + min_spacing_ms, Ordering::Relaxed);
        tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
    } else {
        LAST_REQUEST_TIMESTAMP.store(now, Ordering::Relaxed);
    }
}

pub fn pace_request_blocking() {
    let min_spacing_ms = 350;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let last = LAST_REQUEST_TIMESTAMP.load(Ordering::Relaxed);
    if now < last + min_spacing_ms {
        let wait_ms = (last + min_spacing_ms) - now;
        LAST_REQUEST_TIMESTAMP.store(last + min_spacing_ms, Ordering::Relaxed);
        std::thread::sleep(std::time::Duration::from_millis(wait_ms));
    } else {
        LAST_REQUEST_TIMESTAMP.store(now, Ordering::Relaxed);
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct RawTracksResponse {
    #[serde(default)]
    pub tracks: Vec<RawCandidateTrack>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct RawCandidateTrack {
    #[serde(default, rename = "trackId")]
    pub track_id: Option<String>,
    #[serde(default, rename = "recordingId")]
    pub recording_id: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, rename = "artistNames")]
    pub artist_names: Option<Vec<String>>,
    #[serde(default)]
    pub artists: Option<Vec<RawArtistRef>>,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub isrc: Option<String>,
    #[serde(default)]
    pub artwork: Option<String>,
    #[serde(default)]
    pub cover: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct RawArtistRef {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
}

impl RawCandidateTrack {
    pub fn get_id(&self) -> Option<String> {
        self.track_id.clone().or_else(|| self.id.clone())
    }

    pub fn get_artist_name(&self) -> String {
        if let Some(names) = &self.artist_names {
            let valid: Vec<String> = names.iter().filter(|n| !n.trim().is_empty()).cloned().collect();
            if !valid.is_empty() {
                return valid.join(", ");
            }
        }
        if let Some(artists) = &self.artists {
            let valid: Vec<String> = artists
                .iter()
                .filter_map(|a| a.name.clone().or_else(|| a.display_name.clone()))
                .filter(|n| !n.trim().is_empty())
                .collect();
            if !valid.is_empty() {
                return valid.join(", ");
            }
        }
        "Unknown Artist".to_string()
    }

    pub fn get_duration_secs(&self) -> u64 {
        match self.duration {
            Some(d) if d > 1000 => d / 1000,
            Some(d) => d,
            None => 0,
        }
    }
}

pub fn create_async_client() -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));

    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| format!("Failed to create reqwest async client: {}", e))
}

pub fn create_blocking_client() -> Result<reqwest::blocking::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));

    reqwest::blocking::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| format!("Failed to create reqwest blocking client: {}", e))
}

/// Queries track candidates across the instance pool with pacing, failover, and cooldowns.
pub async fn search_tracks_pool(query: &str, limit: usize) -> Result<Vec<RawCandidateTrack>, String> {
    pace_request_async().await;
    let client = create_async_client()?;
    let encoded_query = urlencoding::encode(query);

    for instance in INSTANCE_POOL.iter() {
        if !instance.is_available() {
            // Briefly wait if in cooling down rather than immediately giving up
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
            let cd = instance.cooldown_until.load(Ordering::Relaxed);
            if cd > now && cd - now <= 3 {
                tokio::time::sleep(std::time::Duration::from_secs(cd - now)).await;
            } else if cd > now {
                continue;
            }
        }

        let url = format!("{}/search/tracks?q={}&limit={}", instance.base_url, encoded_query, limit);
        match client.get(&url).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    match resp.json::<RawTracksResponse>().await {
                        Ok(parsed) => {
                            instance.record_success();
                            return Ok(parsed.tracks);
                        }
                        Err(e) => {
                            instance.record_failure(false);
                            return Err(format!("JSON parse error from {}: {}", instance.base_url, e));
                        }
                    }
                } else if status.as_u16() == 429 {
                    instance.record_failure(true);
                    return Err(format!("HTTP 429 Too Many Requests from {}", instance.base_url));
                } else {
                    instance.record_failure(false);
                    return Err(format!("HTTP {} from {}", status, instance.base_url));
                }
            }
            Err(e) => {
                instance.record_failure(false);
                return Err(format!("Network error querying {}: {}", instance.base_url, e));
            }
        }
    }

    Err(String::from("No upstream instances available"))
}

/// Fetches an upstream FLAC audio stream with range forwarding and request pacing.
pub fn get_stream_upstream(
    track_id: &str,
    range_header: Option<&str>,
) -> Result<(reqwest::blocking::Response, Option<u64>, Option<String>), String> {
    pace_request_blocking();
    let client = create_blocking_client()?;

    for instance in INSTANCE_POOL.iter() {
        if !instance.is_available() {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
            let cd = instance.cooldown_until.load(Ordering::Relaxed);
            if cd > now && cd - now <= 2 {
                std::thread::sleep(std::time::Duration::from_secs(cd - now));
            } else if cd > now {
                continue;
            }
        }

        let url = format!("{}/track/{}", instance.base_url, track_id);
        let mut req = client.get(&url);
        if let Some(range) = range_header {
            if let Ok(val) = HeaderValue::from_str(range) {
                req = req.header(RANGE, val);
            }
        }

        match req.send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.as_u16() == 206 {
                    let content_len = resp.content_length();
                    let content_range = resp
                        .headers()
                        .get("content-range")
                        .and_then(|h| h.to_str().ok())
                        .map(|s| s.to_string());

                    instance.record_success();
                    return Ok((resp, content_len, content_range));
                } else if status.as_u16() == 429 {
                    instance.record_failure(true);
                    return Err(format!("HTTP 429 Too Many Requests from {}", instance.base_url));
                } else {
                    let status_code = status.as_u16();
                    instance.record_failure(false);
                    return Err(format!("HTTP {} from {}", status_code, instance.base_url));
                }
            }
            Err(e) => {
                instance.record_failure(false);
                return Err(format!("Network error connecting to {}: {}", instance.base_url, e));
            }
        }
    }

    Err(String::from("No upstream instances available"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_direct_reqwest() {
        let client = create_blocking_client().unwrap();
        let res = client.get("https://tracks.monochrome.st/track/156929735690203136")
            .header("Range", "bytes=0-1000")
            .send();
        if let Ok(r) = res {
            println!("Status: {}", r.status());
            println!("Headers: {:?}", r.headers());
        } else if let Err(e) = res {
            println!("Error: {}", e);
        }
    }
}
