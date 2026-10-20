pub mod app_commands;
pub mod chords;
pub mod downloads;
pub mod models;
pub mod playlists;
pub mod server;
pub mod youtube;
pub mod lyrics;
pub mod monochrome;

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
                                let _ = window.unminimize();
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

                    let behavior = app_commands::get_close_behavior();
                    match behavior {
                        1 => {
                            // Minimize to tray
                            let _ = window.hide();
                        }
                        2 => {
                            // Close app
                            window.app_handle().exit(0);
                        }
                        _ => {
                            // Prompt user: immediately bring window to front and on top
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_always_on_top(true);
                            let _ = window.set_focus();
                            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));
                            let _ = window.emit("close-requested", ());
                        }
                    }
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
            app_commands::clear_cached_data,
            app_commands::set_close_behavior,
            app_commands::set_always_on_top,
            app_commands::show_close_prompt_window,
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
            lyrics::get_lyrics,
            lyrics::save_lyrics,
            youtube::get_artist_details,
            youtube::get_artist_top_songs,
            monochrome::search_monochrome,
            monochrome::get_monochrome_album
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = _event {
                if !has_visible_windows {
                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
