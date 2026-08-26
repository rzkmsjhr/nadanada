
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn force_resize_window(window: tauri::Window, width: f64, height: f64, min_width: f64, min_height: f64, always_on_top: bool) {
    let _ = window.set_always_on_top(always_on_top);
    let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize { width: 1.0, height: 1.0 })));
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize { width: min_width, height: min_height })));

    if let Ok(Some(monitor)) = window.current_monitor() {
        if let Ok(current_pos) = window.outer_position() {
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();
            let scale = monitor.scale_factor();
            
            let target_physical_width = (width * scale).round() as i32;
            let target_physical_height = (height * scale).round() as i32;
            
            let mut new_x = current_pos.x;
            let mut new_y = current_pos.y;
            
            let right_bound = monitor_pos.x + monitor_size.width as i32;
            let bottom_bound = monitor_pos.y + monitor_size.height as i32;
            
            if new_x + target_physical_width > right_bound {
                new_x = right_bound - target_physical_width;
            }
            if new_y + target_physical_height > bottom_bound {
                new_y = bottom_bound - target_physical_height;
            }
            if new_x < monitor_pos.x { new_x = monitor_pos.x; }
            if new_y < monitor_pos.y { new_y = monitor_pos.y; }
            
            if new_x != current_pos.x || new_y != current_pos.y {
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: new_x, y: new_y }));
            }
        }
    }
}

