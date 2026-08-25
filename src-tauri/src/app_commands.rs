#[tauri::command]
pub fn quit_app(_app: tauri::AppHandle) {
    std::process::exit(0);
}
