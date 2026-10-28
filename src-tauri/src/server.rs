use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use tiny_http::{Header, Request, Response, StatusCode};

use crate::hifi::{cache, instances, kuwo};

pub const PREFERRED_EMBED_PORT: u16 = 24242;
pub static EMBED_PORT: AtomicU16 = AtomicU16::new(PREFERRED_EMBED_PORT);

struct TeeReader<R: Read, W: Write> {
    reader: R,
    writer: Option<W>,
    temp_path: Option<PathBuf>,
    final_path: Option<PathBuf>,
    track_id: Option<String>,
    total_written: u64,
}

impl<R: Read, W: Write> TeeReader<R, W> {
    fn new(
        reader: R,
        writer: W,
        temp_path: PathBuf,
        final_path: PathBuf,
        track_id: String,
    ) -> Self {
        Self {
            reader,
            writer: Some(writer),
            temp_path: Some(temp_path),
            final_path: Some(final_path),
            track_id: Some(track_id),
            total_written: 0,
        }
    }
}

impl<R: Read, W: Write> Read for TeeReader<R, W> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.reader.read(buf)?;
        if n > 0 {
            if let Some(w) = self.writer.as_mut() {
                if let Err(e) = w.write_all(&buf[..n]) {
                    eprintln!("[HIFI CACHE] Write error while teeing: {}", e);
                    self.writer = None;
                } else {
                    self.total_written += n as u64;
                }
            }
        } else {
            // EOF reached: flush writer and rename .part to .flac!
            if let Some(mut w) = self.writer.take() {
                let _ = w.flush();
                drop(w);
                if self.total_written > 50_000 {
                    if let (Some(temp), Some(fin)) = (self.temp_path.take(), self.final_path.take()) {
                        if let Err(e) = fs::rename(&temp, &fin) {
                            eprintln!("[HIFI CACHE] Failed to rename {:?} -> {:?}: {}", temp, fin, e);
                        } else {
                            eprintln!(
                                "[HIFI CACHE] Successfully saved FLAC cache ({:.2} MB) at {:?}",
                                self.total_written as f64 / 1_048_576.0,
                                fin
                            );
                        }
                    }
                }
            }
            if let Some(id) = self.track_id.take() {
                cache::release_download_lock(&id);
            }
        }
        Ok(n)
    }
}

impl<R: Read, W: Write> Drop for TeeReader<R, W> {
    fn drop(&mut self) {
        if let Some(id) = self.track_id.take() {
            cache::release_download_lock(&id);
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

fn handle_hifi_stream(request: Request, track_id: String) {
    let range_header = request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("range"))
        .map(|h| h.value.as_str().to_string());

    // 1. Check disk cache first (100% offline playback with 0ms network latency)
    if let Some(cached_path) = cache::get_cached_track_path(&track_id) {
        if let Ok(metadata) = fs::metadata(&cached_path) {
            let file_len = metadata.len();
            if let Ok(mut file) = File::open(&cached_path) {
                if let Some(range_str) = &range_header {
                    if let Some((start, end)) = parse_range(range_str, file_len) {
                        let chunk_len = end - start + 1;
                        let _ = file.seek(SeekFrom::Start(start));
                        let reader = file.take(chunk_len);

                        let resp = Response::new(
                            StatusCode(206),
                            vec![
                                Header::from_bytes(&b"Content-Type"[..], &b"audio/flac"[..]).unwrap(),
                                Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
                                Header::from_bytes(
                                    &b"Content-Range"[..],
                                    format!("bytes {}-{}/{}", start, end, file_len).as_bytes(),
                                )
                                .unwrap(),
                                Header::from_bytes(
                                    &b"Content-Length"[..],
                                    chunk_len.to_string().as_bytes(),
                                )
                                .unwrap(),
                                Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                                Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"*"[..]).unwrap(),
                            ],
                            reader,
                            Some(chunk_len as usize),
                            None,
                        );
                        let _ = request.respond(resp);
                        return;
                    }
                }

                // Full file playback
                let resp = Response::new(
                    StatusCode(200),
                    vec![
                        Header::from_bytes(&b"Content-Type"[..], &b"audio/flac"[..]).unwrap(),
                        Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
                        Header::from_bytes(
                            &b"Content-Length"[..],
                            file_len.to_string().as_bytes(),
                        )
                        .unwrap(),
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"*"[..]).unwrap(),
                    ],
                    file,
                    Some(file_len as usize),
                    None,
                );
                let _ = request.respond(resp);
                return;
            }
        }
    }

    // 2. Not cached: stream from upstream (Kuwo CDN or Monochrome pool) and tee to disk cache
    let upstream_result = if track_id.starts_with("kuwo_") {
        if let Some(direct_url) = cache::get_direct_url(&track_id) {
            kuwo::get_kuwo_stream(&direct_url, range_header.as_deref())
        } else {
            Err(format!("Kuwo direct stream URL not found in cache for {}", track_id))
        }
    } else {
        instances::get_stream_upstream(&track_id, range_header.as_deref())
    };

    match upstream_result {
        Ok((upstream_resp, content_len, content_range)) => {
            let is_partial = content_range.is_some() || range_header.is_some();
            let status = if is_partial { StatusCode(206) } else { StatusCode(200) };

            let mut headers = vec![
                Header::from_bytes(&b"Content-Type"[..], &b"audio/flac"[..]).unwrap(),
                Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
                Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"*"[..]).unwrap(),
            ];

            if let Some(cr) = &content_range {
                if let Ok(h) = Header::from_bytes(&b"Content-Range"[..], cr.as_bytes()) {
                    headers.push(h);
                }
            }
            if let Some(len) = content_len {
                if let Ok(h) = Header::from_bytes(&b"Content-Length"[..], len.to_string().as_bytes()) {
                    headers.push(h);
                }
            }

            // Tee to disk cache if request is starting from the beginning
            let is_from_beginning = range_header
                .as_deref()
                .map(|r| r.starts_with("bytes=0-") || r == "bytes=0")
                .unwrap_or(true);

            if is_from_beginning && cache::try_acquire_download_lock(&track_id) {
                let cache_dir = cache::get_cache_dir();
                let temp_path = cache_dir.join(format!("{}.flac.part", track_id));
                let final_path = cache_dir.join(format!("{}.flac", track_id));

                if let Ok(file_writer) = File::create(&temp_path) {
                    let tee = TeeReader::new(
                        upstream_resp,
                        file_writer,
                        temp_path,
                        final_path,
                        track_id.clone(),
                    );
                    let resp = Response::new(
                        status,
                        headers,
                        tee,
                        content_len.map(|l| l as usize),
                        None,
                    );
                    let _ = request.respond(resp);
                    return;
                } else {
                    cache::release_download_lock(&track_id);
                }
            }

            let resp = Response::new(
                status,
                headers,
                upstream_resp,
                content_len.map(|l| l as usize),
                None,
            );
            let _ = request.respond(resp);
        }
        Err(err) => {
            eprintln!("[HIFI STREAM] Upstream streaming error for {}: {}", track_id, err);
            let resp = Response::from_string(format!("{{\"error\":\"{}\"}}", err))
                .with_status_code(StatusCode(503))
                .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
                .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
                .with_header(Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"*"[..]).unwrap())
                .with_header(Header::from_bytes(&b"Retry-After"[..], &b"3"[..]).unwrap());
            let _ = request.respond(resp);
        }
    }
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
