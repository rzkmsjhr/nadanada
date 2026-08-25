use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn load_playlists() -> Result<String, String> {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    let playlists_path = data_dir.join("playlists.json");

    if playlists_path.exists() {
        fs::read_to_string(&playlists_path).map_err(|e| e.to_string())
    } else {
        Ok("[]".to_string())
    }
}

#[tauri::command]
pub fn save_playlists(data: String) -> Result<(), String> {
    let mut data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.push("NadaNada");
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }

    let playlists_path = data_dir.join("playlists.json");
    let temp_path = data_dir.join("playlists.json.tmp");
    fs::write(&temp_path, &data).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, &playlists_path).map_err(|e| e.to_string())?;

    Ok(())
}
