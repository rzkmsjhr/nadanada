pub mod app_commands;
pub mod chords;
pub mod downloads;
pub mod models;
pub mod playlists;
pub mod server;
pub mod youtube;
pub mod lyrics;

use tauri::{
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            server::start_embed_server();
            if let Some(icon) = app.default_window_icon() {
                let _tray = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .on_tray_icon_event(|tray, event| match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            ..
                        } => {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Prevent the default close behavior
                    api.prevent_close();
                    // Tell the frontend that we want to close, so it can show our custom prompt
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            youtube::search_youtube,
            youtube::get_youtube_mix,
            youtube::get_youtube_playlist,
            youtube::get_spotify_playlist,
            youtube::get_kworb_chart,
            downloads::get_stream_url,
            app_commands::quit_app,
            app_commands::force_resize_window,
            server::get_embed_port,
            youtube::get_playlist_title,
            youtube::get_video_album_info,
            chords::scrape_chords,
            downloads::download_song,
            downloads::get_downloaded_songs,
            downloads::add_local_song,
            downloads::delete_downloaded_song,
            playlists::load_playlists,
            playlists::save_playlists,
            lyrics::get_lyrics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
