use reqwest;
use regex::Regex;
use serde::{Deserialize, Serialize};
use lazy_static::lazy_static;
use std::sync::{Arc, Mutex};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use spectrum_analyzer::{samples_fft_to_spectrum, FrequencyLimit, scaling::divide_by_N_sqrt};
use spectrum_analyzer::windows::hann_window;
use tauri::{Manager, WindowEvent, Emitter, tray::{TrayIconBuilder, MouseButton, TrayIconEvent}};

lazy_static! {
    static ref CURRENT_SPECTRUM: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(vec![0.0; 24]));
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Video {
    id: String,
    title: String,
    thumbnail: String,
    duration: String,
}

#[tauri::command]
async fn search_youtube(mut query: String) -> Result<Vec<Video>, String> {
    query.push_str(" topic");
    let url = format!("https://www.youtube.com/results?search_query={}", query);
    let client = reqwest::Client::new();
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
        
    let text = res.text().await.map_err(|e| e.to_string())?;
    
    let re = Regex::new(r"var ytInitialData = (\{.*?\});</script>").unwrap();
    if let Some(caps) = re.captures(&text) {
        let json_str = &caps[1];
        let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;
        
        let mut videos = Vec::new();
        if let Some(contents) = v.pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents/0/itemSectionRenderer/contents") {
            if let Some(arr) = contents.as_array() {
                for item in arr {
                    if let Some(video) = item.get("videoRenderer") {
                        let id = video.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = video.pointer("/title/runs/0/text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let thumbnail = video.pointer("/thumbnail/thumbnails/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let duration = video.pointer("/lengthText/simpleText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        
                        if !id.is_empty() && !title.is_empty() {
                            videos.push(Video { id, title, thumbnail, duration });
                        }
                    }
                    if videos.len() >= 15 {
                        break;
                    }
                }
            }
        }
        return Ok(videos);
    }
    Err("ytInitialData not found".to_string())
}

#[tauri::command]
async fn get_youtube_mix(video_id: String) -> Result<Vec<Video>, String> {
    let url = format!("https://www.youtube.com/watch?v={}&list=RD{}", video_id, video_id);
    let client = reqwest::Client::new();
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
        
    let text = res.text().await.map_err(|e| e.to_string())?;
    
    let re = Regex::new(r"var ytInitialData = (\{.*?\});</script>").unwrap();
    if let Some(caps) = re.captures(&text) {
        let json_str = &caps[1];
        let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;
        
        let mut videos = Vec::new();
        if let Some(contents) = v.pointer("/contents/twoColumnWatchNextResults/playlist/playlist/contents") {
            if let Some(arr) = contents.as_array() {
                for item in arr {
                    if let Some(video) = item.get("playlistPanelVideoRenderer") {
                        let id = video.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = video.pointer("/title/simpleText").and_then(|v| v.as_str())
                                         .or_else(|| video.pointer("/title/runs/0/text").and_then(|v| v.as_str()))
                                         .unwrap_or("").to_string();
                        let thumbnail = video.pointer("/thumbnail/thumbnails/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let duration = video.pointer("/lengthText/simpleText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        
                        if !id.is_empty() && !title.is_empty() {
                            videos.push(Video { id, title, thumbnail, duration });
                        }
                    }
                    if videos.len() >= 25 {
                        break;
                    }
                }
            }
        }
        return Ok(videos);
    }
    
    Err("ytInitialData not found in mix".to_string())
}

#[tauri::command]
fn get_audio_spectrum() -> Vec<f32> {
    let spectrum = CURRENT_SPECTRUM.lock().unwrap();
    spectrum.clone()
}

pub fn start_audio_monitor() {
    std::thread::spawn(|| {
        let host = cpal::default_host();
        let device = match host.default_output_device() {
            Some(d) => d,
            None => {
                println!("No default output device for loopback");
                return;
            }
        };

        let config = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                println!("Failed to get default output config: {}", e);
                return;
            }
        };

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => run_stream::<f32>(&device, &config.into()),
            cpal::SampleFormat::I16 => run_stream::<i16>(&device, &config.into()),
            cpal::SampleFormat::U16 => run_stream::<u16>(&device, &config.into()),
            _ => return,
        };

        match stream {
            Ok(s) => {
                let _ = s.play();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3600));
                }
            }
            Err(e) => println!("Error running loopback stream: {}", e),
        }
    });
}

fn run_stream<T>(device: &cpal::Device, config: &cpal::StreamConfig) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::Sample + cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0 as u32;
    let mut sample_buffer: Vec<f32> = Vec::with_capacity(2048);

    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            for frame in data.chunks(channels) {
                let mut sum = 0.0;
                for sample in frame {
                    let val: f32 = cpal::FromSample::from_sample_(*sample);
                    sum += val;
                }
                let mono_sample = sum / channels as f32;
                
                sample_buffer.push(mono_sample);

                if sample_buffer.len() == 2048 {
                    let windowed_samples = hann_window(&sample_buffer);
                    if let Ok(spectrum) = samples_fft_to_spectrum(
                        &windowed_samples,
                        sample_rate,
                        FrequencyLimit::Range(20.0, 20000.0),
                        Some(&divide_by_N_sqrt),
                    ) {
                        let data = spectrum.data();
                        let mut bins = vec![0.0; 24];
                        // Tighten the frequency range to focus on active musical frequencies
                        // (YouTube compression often cuts off audio above 15kHz, leaving dead bars on the right)
                        let min_freq = 40.0_f32;
                        let max_freq = 14000.0_f32;
                        
                        for (freq_val, fr_value) in data {
                            let f = freq_val.val();
                            if f < min_freq || f > max_freq { continue; }
                            
                            let log_f = f.log10();
                            let log_min = min_freq.log10();
                            let log_max = max_freq.log10();
                            
                            let mut bin_index = ((log_f - log_min) / (log_max - log_min) * 24.0) as usize;
                            if bin_index >= 24 { bin_index = 23; }
                            
                            let mag = fr_value.val();
                            
                            // Convert linear magnitude to decibels (dB)
                            let db = 20.0 * (mag + 1e-6).log10();
                            
                            // Map -60dB (silence) to 0.0, and 0dB (max volume) to 1.0
                            let scaled = ((db + 60.0) / 60.0).max(0.0).min(1.0);
                            
                            if scaled > bins[bin_index] {
                                bins[bin_index] = scaled;
                            }
                        }
                        
                        // Fill any gaps caused by low FFT resolution at low frequencies
                        for i in 1..24 {
                            if bins[i] == 0.0 {
                                bins[i] = bins[i - 1] * 0.8;
                            }
                        }
                        
                        if let Ok(mut current) = CURRENT_SPECTRUM.lock() {
                            for i in 0..24 {
                                // Smooth transition: 75% old, 25% new
                                current[i] = current[i] * 0.75 + bins[i] * 0.25;
                            }
                        }
                    }
                    sample_buffer.clear();
                }
            }
        },
        |err| eprintln!("Stream error: {}", err),
        None,
    )
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_audio_monitor();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the default close behavior
                api.prevent_close();
                // Tell the frontend that we want to close, so it can show our custom prompt
                window.emit("close-requested", ()).unwrap();
            }
        })
        .invoke_handler(tauri::generate_handler![search_youtube, get_audio_spectrum, get_youtube_mix, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
