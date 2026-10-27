// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        let current_args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let mut args = current_args;
        if !args.contains("--autoplay-policy=no-user-gesture-required") {
            if !args.is_empty() { args.push(' '); }
            args.push_str("--autoplay-policy=no-user-gesture-required");
        }
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
    }

    tauri_app_lib::run()
}
