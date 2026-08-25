use std::sync::atomic::{AtomicU16, Ordering};

pub static EMBED_PORT: AtomicU16 = AtomicU16::new(0);

pub fn start_embed_server() -> u16 {
    let server = tiny_http::Server::http("127.0.0.1:0").expect("Failed to start embed server");
    let port = server.server_addr().to_ip().unwrap().port();
    EMBED_PORT.store(port, Ordering::Relaxed);

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let url = request.url().to_string();
            if url.starts_with("/embed") {
                let html = include_str!("embed.html");
                let response = tiny_http::Response::from_string(html)
                    .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap())
                    .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                let _ = request.respond(response);
            } else {
                let _ = request.respond(tiny_http::Response::empty(404));
            }
        }
    });
    port
}

#[tauri::command]
pub fn get_embed_port() -> u16 {
    EMBED_PORT.load(Ordering::Relaxed)
}
