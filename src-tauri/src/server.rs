use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use lazy_static::lazy_static;
use tiny_http::{Header, Request, Response, StatusCode};

use crate::hifi::{cache, instances, kuwo};

pub const PREFERRED_EMBED_PORT: u16 = 24242;
pub static EMBED_PORT: AtomicU16 = AtomicU16::new(PREFERRED_EMBED_PORT);

pub struct DownloadCoordinator {
    pub track_id: String,
    pub temp_path: PathBuf,
    pub final_path: PathBuf,
    pub content_type: String,
    pub file_ext: String,
    pub total_len: Arc<AtomicU64>,
    pub downloaded_bytes: Arc<AtomicU64>,
    pub is_done: Arc<AtomicBool>,
    pub is_failed: Arc<AtomicBool>,
    pub error_msg: Arc<Mutex<Option<String>>>,
    pub condvar: Arc<Condvar>,
    pub cond_mutex: Arc<Mutex<()>>,
}

lazy_static! {
    static ref COORDINATORS: Mutex<HashMap<String, Arc<DownloadCoordinator>>> = Mutex::new(HashMap::new());
}

struct GrowingFileReader {
    file: File,
    pos: u64,
    end: u64,
    downloaded: Arc<AtomicU64>,
    is_done: Arc<AtomicBool>,
    is_failed: Arc<AtomicBool>,
    condvar: Arc<Condvar>,
    cond_mutex: Arc<Mutex<()>>,
}

impl Read for GrowingFileReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.end {
            return Ok(0);
        }

        let max_to_read = (self.end - self.pos).min(buf.len() as u64) as usize;

        let mut waited_ms = 0;
        while self.pos >= self.downloaded.load(Ordering::Relaxed) {
            if self.is_done.load(Ordering::Relaxed) {
                break;
            }
            if self.is_failed.load(Ordering::Relaxed) {
                return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "Upstream stream failed"));
            }

            // Wait for downloader notification
            if let Ok(guard) = self.cond_mutex.lock() {
                let _ = self.condvar.wait_timeout(guard, Duration::from_millis(40));
            } else {
                std::thread::sleep(Duration::from_millis(20));
            }
            waited_ms += 40;
            if waited_ms > 12_000 {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "Timed out waiting for audio data"));
            }
        }

        let current_avail = self.downloaded.load(Ordering::Relaxed);
        let allowed = if self.is_done.load(Ordering::Relaxed) {
            max_to_read
        } else {
            let avail_from_pos = current_avail.saturating_sub(self.pos);
            if avail_from_pos == 0 {
                return Ok(0);
            }
            (avail_from_pos as usize).min(max_to_read)
        };

        let n = self.file.read(&mut buf[..allowed])?;
        self.pos += n as u64;
        Ok(n)
    }
}

fn run_single_flight_download(coord: Arc<DownloadCoordinator>) {
    let track_id = &coord.track_id;
    eprintln!("[HIFI PROXY] Starting single-flight download for {}", track_id);

    let upstream_result = if track_id.starts_with("kuwo_") {
        if let Some(direct_url) = cache::get_direct_url(track_id) {
            let res = kuwo::get_kuwo_stream(&direct_url, None);
            if let Err(ref e) = res {
                if e.contains("410") || e.contains("403") {
                    eprintln!("[HIFI PROXY] Kuwo direct URL expired for {} ({}). Evicting.", track_id, e);
                    cache::clear_direct_url(track_id);
                }
            }
            res
        } else {
            Err(format!("Kuwo direct stream URL not found in cache for {}", track_id))
        }
    } else {
        instances::get_stream_upstream(track_id, None)
    };

    match upstream_result {
        Ok((mut stream_resp, content_len, _)) => {
            if let Some(len) = content_len {
                coord.total_len.store(len, Ordering::Relaxed);
            }

            let mut file_writer = match File::create(&coord.temp_path) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("[HIFI PROXY] Failed to create temp file {:?}: {}", coord.temp_path, e);
                    coord.is_failed.store(true, Ordering::Relaxed);
                    cache::record_upstream_failure(track_id, &e.to_string());
                    coord.condvar.notify_all();
                    if let Ok(mut lock) = COORDINATORS.lock() {
                        lock.remove(track_id);
                    }
                    return;
                }
            };

            let mut buf = [0u8; 65536];
            let mut total_written: u64 = 0;
            let mut stream_error = false;

            loop {
                match stream_resp.read(&mut buf) {
                    Ok(0) => break, // EOF reached
                    Ok(n) => {
                        if let Err(e) = file_writer.write_all(&buf[..n]) {
                            eprintln!("[HIFI PROXY] Error writing to temp cache file: {}", e);
                            stream_error = true;
                            break;
                        }
                        total_written += n as u64;
                        coord.downloaded_bytes.store(total_written, Ordering::Relaxed);
                        coord.condvar.notify_all();
                    }
                    Err(e) => {
                        eprintln!("[HIFI PROXY] Error reading upstream stream for {}: {}", track_id, e);
                        stream_error = true;
                        break;
                    }
                }
            }

            let _ = file_writer.flush();
            drop(file_writer);

            if !stream_error && total_written > 50_000 {
                if let Err(e) = fs::rename(&coord.temp_path, &coord.final_path) {
                    eprintln!("[HIFI PROXY] Rename {:?} -> {:?} deferred/failed: {}", coord.temp_path, coord.final_path, e);
                } else {
                    eprintln!("[HIFI PROXY] Single-flight cached ({:.2} MB) for {}", total_written as f64 / 1_048_576.0, track_id);
                }
                coord.is_done.store(true, Ordering::Relaxed);
            } else {
                eprintln!("[HIFI PROXY] Single-flight aborted or truncated ({:.2} MB) for {}", total_written as f64 / 1_048_576.0, track_id);
                coord.is_failed.store(true, Ordering::Relaxed);
                cache::record_upstream_failure(track_id, "Stream interrupted or truncated");
            }

            coord.condvar.notify_all();
            if let Ok(mut lock) = COORDINATORS.lock() {
                lock.remove(track_id);
            }
        }
        Err(err) => {
            eprintln!("[HIFI PROXY] Upstream failed for {}: {}", track_id, err);
            if let Ok(mut msg) = coord.error_msg.lock() {
                *msg = Some(err.clone());
            }
            coord.is_failed.store(true, Ordering::Relaxed);
            cache::record_upstream_failure(track_id, &err);
            coord.condvar.notify_all();
            if let Ok(mut lock) = COORDINATORS.lock() {
                lock.remove(track_id);
            }
        }
    }
}

fn parse_range(range_header: &str, file_len: u64) -> Option<(u64, u64)> {
    if !range_header.starts_with("bytes=") {
        return None;
    }
    let s = &range_header["bytes=".len()..];
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start_str = parts[0].trim();
    let end_str = parts[1].trim();

    if start_str.is_empty() {
        // Suffix range: bytes=-500 (last 500 bytes)
        let suffix_len = end_str.parse::<u64>().ok()?;
        let start = file_len.saturating_sub(suffix_len);
        let end = file_len.saturating_sub(1);
        Some((start, end))
    } else {
        let start = start_str.parse::<u64>().ok()?;
        let end = if end_str.is_empty() {
            file_len.saturating_sub(1)
        } else {
            end_str.parse::<u64>().ok()?.min(file_len.saturating_sub(1))
        };
        if start <= end && start < file_len {
            Some((start, end))
        } else {
            None
        }
    }
}

fn serve_local_file(request: Request, path: PathBuf, range_header: Option<&str>, content_type: &str) {
    let metadata = match fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => {
            let _ = request.respond(Response::empty(404));
            return;
        }
    };

    let file_len = metadata.len();
    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(_) => {
            let _ = request.respond(Response::empty(500));
            return;
        }
    };

    let (start, end, is_partial) = if let Some(range_str) = range_header {
        if let Some((s, e)) = parse_range(range_str, file_len) {
            (s, e, true)
        } else {
            (0, file_len.saturating_sub(1), false)
        }
    } else {
        (0, file_len.saturating_sub(1), false)
    };

    let chunk_len = end.saturating_sub(start) + 1;
    if start > 0 {
        let _ = file.seek(SeekFrom::Start(start));
    }
    let reader = file.take(chunk_len);

    let mut headers = vec![
        Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
        Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"*"[..]).unwrap(),
    ];

    let status = if is_partial {
        headers.push(
            Header::from_bytes(
                &b"Content-Range"[..],
                format!("bytes {}-{}/{}", start, end, file_len).as_bytes(),
            )
            .unwrap(),
        );
        StatusCode(206)
    } else {
        StatusCode(200)
    };

    // Note: tiny_http automatically adds Content-Length when length is Some.
    // Do NOT push Content-Length manually to headers, preventing duplicate header error.
    let resp = Response::new(
        status,
        headers,
        reader,
        Some(chunk_len as usize),
        None,
    );
    let _ = request.respond(resp);
}

fn handle_hifi_stream(request: Request, track_id: String) {
    let range_header = request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("range"))
        .map(|h| h.value.as_str().to_string());

    eprintln!("[HIFI PROXY] Client request: track_id={}, range={:?}", track_id, range_header);

    // 0. Reject immediately if known upstream mismatch / blacklisted edition
    if crate::hifi::matcher::is_known_upstream_mismatch(&track_id, "", "") {
        eprintln!("[HIFI PROXY] Fast reject for {} - blacklisted mismatch", track_id);
        if let Some(cached_path) = cache::get_cached_track_path(&track_id) {
            let _ = std::fs::remove_file(cached_path);
        }
        cache::clear_direct_url(&track_id);
        let resp = Response::from_string(r#"{"error":"Track is a known mismatch or disqualified edition"}"#)
            .with_status_code(StatusCode(404))
            .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
            .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // 1. Check disk cache first (100% offline playback with 0ms network latency & 0 upstream requests)
    if let Some(cached_path) = cache::get_cached_track_path(&track_id) {
        let is_mp3 = cached_path.extension().map(|e| e == "mp3").unwrap_or(false);
        let content_type = if is_mp3 { "audio/mpeg" } else { "audio/flac" };
        serve_local_file(request, cached_path, range_header.as_deref(), content_type);
        return;
    }

    // 2. Reject immediately if in upstream failure cooldown (protects against rapid retry storms)
    if let Some(err_msg) = cache::is_in_failure_cooldown(&track_id) {
        eprintln!("[HIFI PROXY] Fast reject for {} - in failure cooldown ({})", track_id, err_msg);
        let resp = Response::from_string(format!(r#"{{"error":"Track temporarily unavailable: {}"}}"#, err_msg))
            .with_status_code(StatusCode(503))
            .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
            .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // 3. Single-flight download coordination
    let coordinator = {
        let mut lock = match COORDINATORS.lock() {
            Ok(l) => l,
            Err(e) => e.into_inner(),
        };

        if let Some(coord) = lock.get(&track_id) {
            coord.clone()
        } else {
            // Rate limit: at most 1 upstream attempt every 2.5s per track
            if !cache::check_and_record_rate_limit(&track_id) {
                eprintln!("[HIFI PROXY] Rate limiting upstream request for {}", track_id);
                let resp = Response::from_string(r#"{"error":"Too many requests for this track"}"#)
                    .with_status_code(StatusCode(429))
                    .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
                    .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                let _ = request.respond(resp);
                return;
            }

            let is_mp3 = if let Some(direct_url) = cache::get_direct_url(&track_id) {
                direct_url.contains(".mp3")
            } else {
                false
            };
            let file_ext = if is_mp3 { "mp3" } else { "flac" };
            let content_type = if is_mp3 { "audio/mpeg" } else { "audio/flac" };
            let cache_dir = cache::get_cache_dir();
            let temp_path = cache_dir.join(format!("{}.{}.part", track_id, file_ext));
            let final_path = cache_dir.join(format!("{}.{}", track_id, file_ext));

            let coord = Arc::new(DownloadCoordinator {
                track_id: track_id.clone(),
                temp_path,
                final_path,
                content_type: content_type.to_string(),
                file_ext: file_ext.to_string(),
                total_len: Arc::new(AtomicU64::new(0)),
                downloaded_bytes: Arc::new(AtomicU64::new(0)),
                is_done: Arc::new(AtomicBool::new(false)),
                is_failed: Arc::new(AtomicBool::new(false)),
                error_msg: Arc::new(Mutex::new(None)),
                condvar: Arc::new(Condvar::new()),
                cond_mutex: Arc::new(Mutex::new(())),
            });

            lock.insert(track_id.clone(), coord.clone());

            let coord_clone = coord.clone();
            std::thread::spawn(move || {
                run_single_flight_download(coord_clone);
            });

            coord
        }
    };

    // 4. Wait for initial audio headers (at least 64KB, or until EOF or error)
    let mut waited_ms = 0;
    while coordinator.downloaded_bytes.load(Ordering::Relaxed) < 65536
        && !coordinator.is_done.load(Ordering::Relaxed)
        && !coordinator.is_failed.load(Ordering::Relaxed)
    {
        std::thread::sleep(Duration::from_millis(20));
        waited_ms += 20;
        if waited_ms > 10_000 {
            break;
        }
    }

    if coordinator.is_failed.load(Ordering::Relaxed) {
        let err = coordinator
            .error_msg
            .lock()
            .ok()
            .and_then(|m| m.clone())
            .unwrap_or_else(|| "Upstream stream failed".to_string());

        let resp = Response::from_string(format!(r#"{{"error":"{}"}}"#, err))
            .with_status_code(StatusCode(503))
            .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
            .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // 5. Open file handle for streaming
    let file_path = if coordinator.final_path.exists() {
        coordinator.final_path.clone()
    } else {
        coordinator.temp_path.clone()
    };

    let mut file = match File::open(&file_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[HIFI PROXY] Failed to open streaming file {:?}: {}", file_path, e);
            let resp = Response::from_string(format!(r#"{{"error":"{}"}}"#, e))
                .with_status_code(StatusCode(500))
                .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
            let _ = request.respond(resp);
            return;
        }
    };

    let total_file_len = coordinator.total_len.load(Ordering::Relaxed);
    let is_done = coordinator.is_done.load(Ordering::Relaxed);
    let effective_total_len = if total_file_len > 0 {
        total_file_len
    } else if is_done {
        file.metadata().map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let (start, end) = if let Some(ref range_str) = range_header {
        if effective_total_len > 0 {
            parse_range(range_str, effective_total_len).unwrap_or((0, effective_total_len.saturating_sub(1)))
        } else {
            (0, u64::MAX.saturating_sub(1))
        }
    } else {
        (0, if effective_total_len > 0 { effective_total_len.saturating_sub(1) } else { u64::MAX.saturating_sub(1) })
    };

    if start > 0 {
        let _ = file.seek(SeekFrom::Start(start));
    }

    let chunk_len = if end >= start && end < u64::MAX - 1 {
        end - start + 1
    } else {
        0
    };

    let is_partial = range_header.is_some() || start > 0;
    let status = if is_partial { StatusCode(206) } else { StatusCode(200) };

    let mut headers = vec![
        Header::from_bytes(&b"Content-Type"[..], coordinator.content_type.as_bytes()).unwrap(),
        Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"*"[..]).unwrap(),
    ];

    if is_partial && effective_total_len > 0 {
        if let Ok(h) = Header::from_bytes(
            &b"Content-Range"[..],
            format!("bytes {}-{}/{}", start, end, effective_total_len).as_bytes(),
        ) {
            headers.push(h);
        }
    }

    let reader = GrowingFileReader {
        file,
        pos: start,
        end: if chunk_len > 0 { start + chunk_len } else { u64::MAX },
        downloaded: coordinator.downloaded_bytes.clone(),
        is_done: coordinator.is_done.clone(),
        is_failed: coordinator.is_failed.clone(),
        condvar: coordinator.condvar.clone(),
        cond_mutex: coordinator.cond_mutex.clone(),
    };

    let resp = Response::new(
        status,
        headers,
        reader,
        if chunk_len > 0 { Some(chunk_len as usize) } else { None },
        None,
    );
    let _ = request.respond(resp);
}

pub fn start_embed_server() -> u16 {
    let server = tiny_http::Server::http(format!("127.0.0.1:{}", PREFERRED_EMBED_PORT))
        .or_else(|_| tiny_http::Server::http("127.0.0.1:0"))
        .expect("Failed to start embed server");
    let port = server.server_addr().to_ip().map(|ip| ip.port()).unwrap_or(PREFERRED_EMBED_PORT);
    EMBED_PORT.store(port, Ordering::Relaxed);

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            std::thread::spawn(move || {
                let url = request.url().to_string();

                if url.starts_with("/embed") {
                    let html = include_str!("embed.html");
                    let response = tiny_http::Response::from_string(html)
                        .with_header(
                            tiny_http::Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"text/html; charset=utf-8"[..],
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                &b"Access-Control-Allow-Origin"[..],
                                &b"*"[..],
                            )
                            .unwrap(),
                        );
                    let _ = request.respond(response);
                    return;
                }

                // Handle Hi-Fi FLAC stream requests
                let track_id_opt = if url.starts_with("/hifi/stream") {
                    url.split('?').nth(1).and_then(|q| {
                        q.split('&').find_map(|pair| {
                            let mut parts = pair.split('=');
                            if parts.next()? == "id" {
                                Some(parts.next()?.to_string())
                            } else {
                                None
                            }
                        })
                    })
                } else if url.starts_with("/hifi/") {
                    let raw = url.strip_prefix("/hifi/").unwrap_or("");
                    let raw = raw.split('?').next().unwrap_or(raw);
                    let id = raw.strip_suffix(".flac").unwrap_or(raw);
                    if !id.is_empty() {
                        Some(id.to_string())
                    } else {
                        None
                    }
                } else {
                    None
                };

                if let Some(track_id) = track_id_opt {
                    handle_hifi_stream(request, track_id);
                } else {
                    let _ = request.respond(tiny_http::Response::empty(404));
                }
            });
        }
    });

    port
}

#[tauri::command]
pub fn get_embed_port() -> u16 {
    EMBED_PORT.load(Ordering::Relaxed)
}
