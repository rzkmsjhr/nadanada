use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, RANGE, USER_AGENT};
use serde::Deserialize;
use std::time::Duration;

pub const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

pub const KUWO_SEARCH_URL: &str = "https://flac.music.hi.cn/ajax.php?act=search";
pub const KUWO_GET_URL: &str = "https://flac.music.hi.cn/ajax.php?act=getUrl";

#[derive(Deserialize, Debug, Clone)]
pub struct KuwoSearchResponse {
    pub code: i32,
    #[serde(default)]
    pub msg: Option<String>,
    #[serde(default)]
    pub data: Option<KuwoSearchData>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct KuwoSearchData {
    #[serde(default)]
    pub list: Vec<KuwoCandidateTrack>,
    #[serde(default)]
    pub total: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct KuwoMinfo {
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub bitrate: Option<serde_json::Value>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
}

impl KuwoMinfo {
    pub fn bitrate_str(&self) -> String {
        match &self.bitrate {
            Some(serde_json::Value::Number(n)) => n.to_string(),
            Some(serde_json::Value::String(s)) => s.clone(),
            _ => "2000".to_string(),
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct KuwoCandidateTrack {
    pub id: serde_json::Value,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album_name: Option<String>,
    #[serde(default)]
    pub duration: Option<serde_json::Value>,
    #[serde(default)]
    pub minfo: Option<Vec<KuwoMinfo>>,
    #[serde(default)]
    pub time: Option<serde_json::Value>,
    #[serde(default)]
    pub sign: Option<String>,
}

impl KuwoCandidateTrack {
    pub fn get_id(&self) -> String {
        match &self.id {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            _ => String::new(),
        }
    }

    pub fn get_duration_secs(&self) -> u64 {
        match &self.duration {
            Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
            Some(serde_json::Value::String(s)) => s.parse::<u64>().unwrap_or(0),
            _ => 0,
        }
    }

    pub fn time_str(&self) -> String {
        match &self.time {
            Some(serde_json::Value::Number(n)) => n.to_string(),
            Some(serde_json::Value::String(s)) => s.clone(),
            _ => String::new(),
        }
    }

    /// Finds the highest-bitrate FLAC option available for this candidate.
    pub fn get_flac_info(&self) -> Option<KuwoMinfo> {
        if let Some(infos) = &self.minfo {
            let flacs: Vec<&KuwoMinfo> = infos
                .iter()
                .filter(|m| {
                    m.format
                        .as_deref()
                        .map(|f| f.eq_ignore_ascii_case("flac"))
                        .unwrap_or(false)
                })
                .collect();

            if !flacs.is_empty() {
                let best = flacs.into_iter().max_by_key(|m| {
                    m.bitrate_str().parse::<u32>().unwrap_or(0)
                });
                return best.cloned();
            }
        }
        None
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct KuwoGetUrlResponse {
    pub code: i32,
    #[serde(default)]
    pub msg: Option<String>,
    #[serde(default)]
    pub data: Option<KuwoGetUrlData>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct KuwoGetUrlData {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub bitrate: Option<serde_json::Value>,
    #[serde(default)]
    pub duration: Option<serde_json::Value>,
    #[serde(default)]
    pub songid: Option<serde_json::Value>,
}

/// Searches tracks on the primary flac.music.hi.cn Kuwo endpoint.
pub async fn search_kuwo(query: &str, size: usize) -> Result<Vec<KuwoCandidateTrack>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let body = format!(
        "platform=kuwo&keyword={}&page=1&size={}",
        urlencoding::encode(query),
        size
    );

    let resp = client
        .post(KUWO_SEARCH_URL)
        .header(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT))
        .header(
            CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded"),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Network error querying flac.music.hi.cn: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {} from flac.music.hi.cn search", status.as_u16()));
    }

    let search_res = resp
        .json::<KuwoSearchResponse>()
        .await
        .map_err(|e| format!("Failed to parse Kuwo search response: {}", e))?;

    if search_res.code != 0 {
        return Err(format!(
            "Kuwo search returned error code {}: {}",
            search_res.code,
            search_res.msg.unwrap_or_default()
        ));
    }

    let list = search_res.data.map(|d| d.list).unwrap_or_default();
    Ok(list)
}

/// Fetches the direct CDN FLAC stream URL from flac.music.hi.cn.
pub async fn get_kuwo_flac_url(
    song_id: &str,
    time: &serde_json::Value,
    sign: &str,
    bitrate: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let time_str = match time {
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        _ => String::new(),
    };

    let body = format!(
        "platform=kuwo&songid={}&format=flac&bitrate={}&time={}&sign={}",
        urlencoding::encode(song_id),
        urlencoding::encode(bitrate),
        urlencoding::encode(&time_str),
        urlencoding::encode(sign)
    );

    let resp = client
        .post(KUWO_GET_URL)
        .header(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT))
        .header(
            CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded"),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Network error querying getUrl: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {} from flac.music.hi.cn getUrl", status.as_u16()));
    }

    let url_res = resp
        .json::<KuwoGetUrlResponse>()
        .await
        .map_err(|e| format!("Failed to parse Kuwo getUrl response: {}", e))?;

    if url_res.code != 0 {
        return Err(format!(
            "Kuwo getUrl returned error code {}: {}",
            url_res.code,
            url_res.msg.unwrap_or_default()
        ));
    }

    let url = url_res
        .data
        .and_then(|d| d.url)
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| "Empty stream URL in Kuwo getUrl response".to_string())?;

    Ok(url)
}

/// Streams a FLAC file directly from Kuwo CDN with Range header support.
pub fn get_kuwo_stream(
    direct_url: &str,
    range_header: Option<&str>,
) -> Result<(reqwest::blocking::Response, Option<u64>, Option<String>), String> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to create blocking client: {}", e))?;

    let mut req = client.get(direct_url);
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
                Ok((resp, content_len, content_range))
            } else {
                Err(format!("HTTP {} from Kuwo CDN: {}", status.as_u16(), direct_url))
            }
        }
        Err(e) => Err(format!("Network error streaming Kuwo CDN: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kuwo_search_and_url() {
        let (url, _first) = tauri::async_runtime::block_on(async {
            let tracks = search_kuwo("Queen Bohemian Rhapsody", 3).await.unwrap();
            assert!(!tracks.is_empty(), "Search should return candidates");
            let first = &tracks[0];
            println!("Candidate: {} - {:?}", first.get_id(), first.name);
            assert!(first.get_duration_secs() > 300);

            let flac_info = first.get_flac_info().expect("Should have FLAC format");
            let time_val = first.time.clone().unwrap_or(serde_json::Value::Null);
            let sign_val = first.sign.as_deref().unwrap_or("");
            let u = get_kuwo_flac_url(&first.get_id(), &time_val, sign_val, &flac_info.bitrate_str())
                .await
                .unwrap();
            println!("FLAC Stream URL: {}", u);
            assert!(u.contains(".flac") || u.contains("trackmedia"));
            (u, first.clone())
        });

        // Run blocking call outside async context
        let (stream, len, range) = get_kuwo_stream(&url, Some("bytes=0-1000")).unwrap();
        assert_eq!(stream.status().as_u16(), 206);
        assert_eq!(len, Some(1001));
        assert!(range.is_some());
    }
}

