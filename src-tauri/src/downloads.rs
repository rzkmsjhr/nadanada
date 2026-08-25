use crate::models::DownloadedSong;
use lazy_static::lazy_static;
use std::fs;
use std::path::PathBuf;
use tokio::process::Command;

lazy_static! {
    pub static ref IO_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}

pub async fn get_yt_dlp_path() -> Result<std::path::PathBuf, String> {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    data_dir.push("NadaNada");
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    let exe_name = "yt-dlp.exe";
    #[cfg(target_os = "macos")]
    let exe_name = "yt-dlp_macos";
    #[cfg(target_os = "linux")]
    let exe_name = "yt-dlp";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let exe_name = "yt-dlp";

    let exe_path = data_dir.join(exe_name);

    if !exe_path.exists() {
        println!("{} not found, downloading now...", exe_name);
        let download_url = format!(
            "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/{}",
            exe_name
        );
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?;

        let bytes = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        std::fs::write(&exe_path, bytes).map_err(|e| e.to_string())?;

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(mut perms) = std::fs::metadata(&exe_path).map(|m| m.permissions()) {
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&exe_path, perms);
            }
        }
    }

    Ok(exe_path)
}

#[tauri::command]
pub async fn get_stream_url(_app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    let exe_path = get_yt_dlp_path().await?;

    let mut cmd = tokio::process::Command::new(exe_path);
    cmd.stdin(std::process::Stdio::null())
        .arg("-g")
        .arg("-f")
        .arg("bestaudio")
        .arg(&url);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    #[cfg(not(target_os = "windows"))]
    {
        let current_path =
            std::env::var("PATH").unwrap_or_else(|_| String::from("/usr/bin:/bin:/usr/sbin:/sbin"));
        cmd.env(
            "PATH",
            format!(
                "{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin",
                current_path
            ),
        );
    }

    let output_result =
        tokio::time::timeout(std::time::Duration::from_secs(30), cmd.output()).await;

    let output = match output_result {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => return Err("Stream extraction timed out after 30 seconds".to_string()),
    };

    if output.status.success() {
        let stream_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stream_url.is_empty() {
            return Ok(stream_url);
        }
    }

    let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
    Err(format!("yt-dlp failed to extract stream: {}", err_msg))
}

#[tauri::command]
pub async fn download_song(id: String, title: String, artist: String) -> Result<String, String> {
    let url = format!("https://www.youtube.com/watch?v={}", id);

    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    data_dir.push("NadaNada");
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }

    let exe_path = get_yt_dlp_path().await?;

    let mut music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| PathBuf::from(".")));
    music_dir.push("NadaNada");

    if !music_dir.exists() {
        fs::create_dir_all(&music_dir).map_err(|e| e.to_string())?;
    }

    let safe_artist = artist.replace(
        |c: char| {
            c == '\\'
                || c == '/'
                || c == ':'
                || c == '*'
                || c == '?'
                || c == '"'
                || c == '<'
                || c == '>'
                || c == '|'
        },
        "",
    );
    let safe_title = title.replace(
        |c: char| {
            c == '\\'
                || c == '/'
                || c == ':'
                || c == '*'
                || c == '?'
                || c == '"'
                || c == '<'
                || c == '>'
                || c == '|'
        },
        "",
    );

    // If the frontend couldn't find a real artist (e.g. "Release - Topic" or "Unknown"),
    // let yt-dlp extract it from deep metadata. Otherwise, trust the frontend's clean parsing!
    let out_template = if safe_artist.trim().eq_ignore_ascii_case("release")
        || safe_artist.trim().eq_ignore_ascii_case("unknown")
        || safe_artist.trim().is_empty()
    {
        music_dir
            .join("%(artist,uploader)s - %(title)s.%(ext)s")
            .to_string_lossy()
            .to_string()
    } else {
        music_dir
            .join(format!(
                "{} - {}.%(ext)s",
                safe_artist.trim(),
                safe_title.trim()
            ))
            .to_string_lossy()
            .to_string()
    };

    let mut command = Command::new(&exe_path);
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let current_path =
            std::env::var("PATH").unwrap_or_else(|_| String::from("/usr/bin:/bin:/usr/sbin:/sbin"));
        command.env(
            "PATH",
            format!(
                "{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin",
                current_path
            ),
        );
    }

    let output = command
        .arg("--js-runtimes")
        .arg("node")
        .arg("--replace-in-metadata")
        .arg("uploader")
        .arg(" - Topic")
        .arg("")
        .arg("--replace-in-metadata")
        .arg("title")
        .arg(r"(?i)(?:official|music|video|audio|hd|hq|lyrics|\[.*?\]|\(.*?\))")
        .arg("")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("--no-simulate")
        .arg("-f")
        .arg("bestaudio[ext=m4a]/bestaudio")
        .arg("-o")
        .arg(&out_template)
        .arg(url)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Use the stdout from yt-dlp which contains the exact final filepath because of `--print after_move:filepath`
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let final_path = stdout_str
        .trim()
        .lines()
        .last()
        .unwrap_or("")
        .trim()
        .to_string();

    if final_path.is_empty() {
        return Err("yt-dlp succeeded but did not output a filepath".to_string());
    }

    let _lock = IO_LOCK.lock().unwrap();
    let registry_path = data_dir.join("youtube_downloads.json");
    let mut registry: std::collections::HashMap<String, String> = if registry_path.exists() {
        if let Ok(content) = fs::read_to_string(&registry_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        }
    } else {
        std::collections::HashMap::new()
    };
    registry.insert(final_path, id);
    let _ = fs::write(
        &registry_path,
        serde_json::to_string(&registry).unwrap_or_default(),
    );

    Ok("".to_string()) // The frontend ignores this return value and scans the directory
}

#[tauri::command]
pub fn get_downloaded_songs() -> Result<Vec<DownloadedSong>, String> {
    let mut music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| PathBuf::from(".")));
    music_dir.push("NadaNada");

    let mut songs = Vec::new();

    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");

    let _lock = IO_LOCK.lock().unwrap();
    let hidden_json_path = data_dir.join("hidden_downloads.json");
    let hidden_paths: Vec<String> = if hidden_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&hidden_json_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let registry_path = data_dir.join("youtube_downloads.json");
    let mut registry: std::collections::HashMap<String, String> = if registry_path.exists() {
        if let Ok(content) = fs::read_to_string(&registry_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        }
    } else {
        std::collections::HashMap::new()
    };

    // Clean up stale registry entries whose files have been moved or deleted.
    // This ensures the frontend's downloadedIds Set correctly un-marks those songs.
    let mut registry_changed = false;
    registry.retain(|path, _| {
        let still_exists = std::path::Path::new(path).exists();
        if !still_exists {
            registry_changed = true;
        }
        still_exists
    });
    if registry_changed {
        let _ = fs::write(
            &registry_path,
            serde_json::to_string(&registry).unwrap_or_default(),
        );
    }

    if music_dir.exists() {
        for entry in fs::read_dir(music_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let path_str = path.to_string_lossy().to_string();
                if hidden_paths.contains(&path_str) {
                    continue;
                }
                if let Some(ext) = path.extension() {
                    if ext == "m4a" || ext == "mp3" || ext == "webm" {
                        if let Some(file_name) = path.file_stem().and_then(|n| n.to_str()) {
                            let parts: Vec<&str> = file_name.splitn(2, " - ").collect();
                            let (artist, title) = if parts.len() == 2 {
                                (parts[0].to_string(), parts[1].to_string())
                            } else {
                                ("Unknown".to_string(), file_name.to_string())
                            };

                            let song_id = registry
                                .get(&path_str)
                                .cloned()
                                .unwrap_or_else(|| path_str.clone());

                            songs.push(DownloadedSong {
                                id: song_id,
                                title,
                                channel: artist,
                                is_local: true,
                                file_path: path_str,
                            });
                        }
                    }
                }
            }
        }
    }

    // Now merge from local_songs.json
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    let json_path = data_dir.join("local_songs.json");

    if json_path.exists() {
        if let Ok(content) = fs::read_to_string(&json_path) {
            if let Ok(local_paths) = serde_json::from_str::<Vec<String>>(&content) {
                let mut valid_paths = Vec::new();
                let mut changed = false;

                for path_str in local_paths {
                    let path = PathBuf::from(&path_str);
                    if path.exists() && path.is_file() {
                        valid_paths.push(path_str.clone());

                        if let Some(file_name) = path.file_stem().and_then(|n| n.to_str()) {
                            let parts: Vec<&str> = file_name.splitn(2, " - ").collect();
                            let (artist, title) = if parts.len() == 2 {
                                (parts[0].to_string(), parts[1].to_string())
                            } else {
                                ("Unknown".to_string(), file_name.to_string())
                            };

                            // Check if not already in songs to avoid duplicates if they selected the download folder
                            let is_dup = songs.iter().any(|s| s.file_path == path_str);
                            if !is_dup {
                                songs.push(DownloadedSong {
                                    id: path_str.clone(),
                                    title,
                                    channel: artist,
                                    is_local: true,
                                    file_path: path_str,
                                });
                            }
                        }
                    } else {
                        changed = true; // A path doesn't exist anymore, we will filter it out
                    }
                }

                if changed {
                    let _ = fs::write(
                        &json_path,
                        serde_json::to_string(&valid_paths).unwrap_or_default(),
                    );
                }
            }
        }
    }

    Ok(songs)
}

#[tauri::command]
pub fn add_local_song(file_path: String) -> Result<(), String> {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }

    let _lock = IO_LOCK.lock().unwrap();
    let json_path = data_dir.join("local_songs.json");
    let mut local_paths: Vec<String> = if json_path.exists() {
        if let Ok(content) = fs::read_to_string(&json_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    if !local_paths.contains(&file_path) {
        local_paths.push(file_path);
        fs::write(
            &json_path,
            serde_json::to_string(&local_paths).unwrap_or_default(),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_downloaded_song(file_path: String) -> Result<(), String> {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");

    // 1. Remove from local_songs.json if it exists there
    let _lock = IO_LOCK.lock().unwrap();
    let local_json_path = data_dir.join("local_songs.json");
    if local_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&local_json_path) {
            if let Ok(mut local_paths) = serde_json::from_str::<Vec<String>>(&content) {
                let original_len = local_paths.len();
                local_paths.retain(|p| p != &file_path);
                if local_paths.len() < original_len {
                    let _ = fs::write(
                        &local_json_path,
                        serde_json::to_string(&local_paths).unwrap_or_default(),
                    );
                }
            }
        }
    }

    // 2. Add to hidden_downloads.json so it gets ignored during folder scans
    let hidden_json_path = data_dir.join("hidden_downloads.json");
    let mut hidden_paths: Vec<String> = if hidden_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&hidden_json_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    if !hidden_paths.contains(&file_path) {
        hidden_paths.push(file_path);
        let _ = fs::write(
            &hidden_json_path,
            serde_json::to_string(&hidden_paths).unwrap_or_default(),
        );
    }

    Ok(())
}
