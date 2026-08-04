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
    static ref CURRENT_CHORD: Arc<Mutex<String>> = Arc::new(Mutex::new(String::from("-")));
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

#[tauri::command]
fn get_current_chord() -> String {
    let chord = CURRENT_CHORD.lock().unwrap();
    chord.clone()
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
    let mut sample_buffer: Vec<f32> = Vec::with_capacity(4096);

    let chord_names = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
        "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm"
    ];
    
    let mut templates = [[0.0_f32; 12]; 24];
    for root in 0..12 {
        // Major: root, major 3rd, perfect 5th
        templates[root][root] = 1.0;
        templates[root][(root + 4) % 12] = 1.0;
        templates[root][(root + 7) % 12] = 1.0;

        // Minor: root, minor 3rd, perfect 5th
        templates[12 + root][root] = 1.0;
        templates[12 + root][(root + 3) % 12] = 1.0;
        templates[12 + root][(root + 7) % 12] = 1.0;
    }

    let mut smoothed_chroma = [0.0_f32; 12];
    let mut smoothed_bass = [0.0_f32; 12];
    let mut current_chord_index = 24; // 24 = silence/none

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

                if sample_buffer.len() == 4096 {
                    // Calculate RMS energy for silence detection
                    let rms: f32 = (sample_buffer.iter().map(|s| s * s).sum::<f32>() / sample_buffer.len() as f32).sqrt();

                    let windowed_samples = hann_window(&sample_buffer);
                    if let Ok(spectrum) = samples_fft_to_spectrum(
                        &windowed_samples,
                        sample_rate,
                        FrequencyLimit::Range(20.0, 20000.0),
                        Some(&divide_by_N_sqrt),
                    ) {
                        let data = spectrum.data();
                        let mut bins = vec![0.0; 24];
                        let mut chroma = [0.0_f32; 12];
                        let mut bass_chroma = [0.0_f32; 12];

                        let min_freq = 40.0_f32;
                        let max_freq = 14000.0_f32;
                        
                        for (freq_val, fr_value) in data {
                            let f = freq_val.val();
                            // Use linear magnitude to keep tonal peaks sharp against broadband noise
                            let mag = fr_value.val();

                            if f >= 27.5 && f <= 4000.0 {
                                let pitch = 12.0 * (f / 440.0).log2() + 69.0;
                                let pitch_class = (pitch.round() as usize).rem_euclid(12);
                                chroma[pitch_class] += mag;

                                // Isolate bass frequencies (C2 to C4 ~ 65Hz to 261Hz)
                                // We use 65Hz as the bottom cutoff to completely ignore 50Hz/60Hz mains electrical hum and sub-bass rumble!
                                if f >= 65.0 && f <= 261.0 {
                                    bass_chroma[pitch_class] += mag;
                                }
                            }

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
                        
                        // Harmonic suppression: the 3rd harmonic of a note leaks into
                        // the pitch class 7 semitones above (perfect fifth), and the 
                        // 5th harmonic leaks into +4 semitones (major third).
                        // Subtract estimated leakage to clean up the chroma.
                        let raw_chroma = chroma.clone();
                        for pc in 0..12 {
                            if raw_chroma[pc] > 0.0 {
                                let h3 = (pc + 7) % 12;
                                chroma[h3] = (chroma[h3] - raw_chroma[pc] * 0.15).max(0.0);
                                let h5 = (pc + 4) % 12;
                                chroma[h5] = (chroma[h5] - raw_chroma[pc] * 0.10).max(0.0);
                            }
                        }

                        // Fill any gaps caused by low FFT resolution at low frequencies
                        for i in 1..24 {
                            if bins[i] == 0.0 {
                                bins[i] = bins[i - 1] * 0.8;
                            }
                        }

                        // Apply Exponential Moving Average (EMA) for temporal smoothing
                        // We use a fast alpha (0.30) so chords don't bleed into each other during transitions!
                        let alpha = 0.30_f32;
                        for i in 0..12 {
                            smoothed_chroma[i] = (alpha * chroma[i]) + ((1.0 - alpha) * smoothed_chroma[i]);
                            smoothed_bass[i] = (alpha * bass_chroma[i]) + ((1.0 - alpha) * smoothed_bass[i]);
                        }

                        // Find the dominant bass note
                        let mut dominant_bass = 24;
                        let mut max_bass = 0.0_f32;
                        for i in 0..12 {
                            if smoothed_bass[i] > max_bass {
                                max_bass = smoothed_bass[i];
                                dominant_bass = i;
                            }
                        }

                        // Noise floor removal: subtract the median chroma value
                        // In a full mix, drums/vocals/harmonics raise ALL pitch classes.
                        // The median represents this broadband floor. Subtracting it
                        // isolates the actual pitched content (the chord tones).
                        let mut norm_chroma = smoothed_chroma.clone();
                        let mut sorted_chroma = norm_chroma.clone();
                        sorted_chroma.sort_by(|a, b| a.partial_cmp(b).unwrap());
                        let noise_floor = sorted_chroma[5]; // lower median of 12 values
                        for val in &mut norm_chroma {
                            *val = (*val - noise_floor).max(0.0);
                        }

                        // Apply same noise floor removal to bass for cleaner root detection
                        let mut clean_bass = smoothed_bass.clone();
                        let mut sorted_bass = clean_bass.clone();
                        sorted_bass.sort_by(|a, b| a.partial_cmp(b).unwrap());
                        let bass_floor = sorted_bass[5];
                        for val in &mut clean_bass {
                            *val = (*val - bass_floor).max(0.0);
                        }

                        // Re-find dominant bass after noise floor removal
                        dominant_bass = 24;
                        max_bass = 0.0;
                        for i in 0..12 {
                            if clean_bass[i] > max_bass {
                                max_bass = clean_bass[i];
                                dominant_bass = i;
                            }
                        }

                        // Normalize the cleaned chroma for scoring
                        let mut max_chroma = 0.0_f32;
                        for &val in &norm_chroma {
                            if val > max_chroma { max_chroma = val; }
                        }
                        if max_chroma > 0.0 {
                            for val in &mut norm_chroma {
                                *val /= max_chroma;
                            }
                        }

                        // Guess chord
                        let mut best_chord = "-";
                        let mut best_score = 0.0_f32;
                        let mut best_index = 24;
                        let mut all_scores: Vec<(usize, f32)> = Vec::new();
                        
                        if rms > 0.005 {
                            for i in 0..24 {
                                let mut dot = 0.0_f32;
                                let mut template_sq = 0.0_f32;
                                let mut chroma_sq = 0.0_f32;
                                
                                for j in 0..12 {
                                    let c = norm_chroma[j];
                                    let t = templates[i][j];
                                    dot += c * t;
                                    template_sq += t * t;
                                    chroma_sq += c * c;
                                }
                                
                                let mut score = 0.0_f32;
                                if template_sq > 0.0 && chroma_sq > 0.0 {
                                    score = dot / (chroma_sq.sqrt() * template_sq.sqrt());
                                }
                        
                                // Bass bonus: nudge if root matches bass note
                                if dominant_bass < 12 && (i % 12) == dominant_bass {
                                    score *= 1.10;
                                }
                        
                                // Hysteresis: reduced from 1.15 to 1.08 for less stickiness
                                if i == current_chord_index {
                                    score *= 1.08;
                                }
                        
                                all_scores.push((i, score));
                        
                                if score > best_score {
                                    best_score = score;
                                    best_chord = chord_names[i];
                                    best_index = i;
                                }
                            }
                            if best_score < 0.5 {
                                best_chord = "-";
                                best_index = 24;
                            }
                        }
                        
                        // Debug log: only print when chord changes to avoid flooding
                        if best_index != current_chord_index {
                            all_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                            let note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
                            let top5: Vec<String> = all_scores.iter().take(5)
                                .map(|(idx, sc)| format!("{}: {:.2}", chord_names[*idx], sc))
                                .collect();
                            let chroma_str: Vec<String> = norm_chroma.iter().enumerate()
                                .map(|(i, v)| format!("{}:{:.2}", note_names[i], v))
                                .collect();
                            let bass_str = if dominant_bass < 12 { note_names[dominant_bass] } else { "-" };
                            println!("─────────────────────────────────────────");
                            println!("🎵 CHORD: {} (score: {:.2}) | bass: {}", best_chord, best_score, bass_str);
                            println!("   top5: [{}]", top5.join(", "));
                            println!("   chroma: [{}]", chroma_str.join(", "));
                        }

                        current_chord_index = best_index;

                        {
                            let mut current = CURRENT_CHORD.lock().unwrap();
                            *current = best_chord.to_string();
                        }
                        
                        if let Ok(mut current) = CURRENT_SPECTRUM.lock() {
                            for i in 0..24 {
                                current[i] = bins[i];
                            }
                        }

                        // Shift buffer for 50% overlap to keep the framerate high (4096 samples = 92ms, shift by 2048 = 46ms updates)
                        sample_buffer.drain(0..2048);
                    }
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
        .invoke_handler(tauri::generate_handler![search_youtube, get_audio_spectrum, get_current_chord, get_youtube_mix, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
