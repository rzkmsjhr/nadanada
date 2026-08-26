
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn force_resize_window(window: tauri::Window, width: f64, height: f64) {
    let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize { width: 1.0, height: 1.0 })));
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize { width, height })));
}

