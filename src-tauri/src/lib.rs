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

    // ═══════════════════════════════════════════════════
    // CHORD TEMPLATES (84: Major, Minor, Maj7, Min7, Dom7, Maj6, sus4)
    // ═══════════════════════════════════════════════════
    let mut chord_names = vec![String::new(); 84];
    let note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let mut templates = [[0.0_f32; 12]; 84];
    for i in 0..12 {
        // Major
        chord_names[i] = note_names[i].to_string();
        templates[i][i] = 1.0;
        templates[i][(i + 4) % 12] = 1.0;
        templates[i][(i + 7) % 12] = 1.0;
        // Minor
        chord_names[12 + i] = format!("{}m", note_names[i]);
        templates[12 + i][i] = 1.0;
        templates[12 + i][(i + 3) % 12] = 1.0;
        templates[12 + i][(i + 7) % 12] = 1.0;
        // Maj7
        chord_names[24 + i] = format!("{}maj7", note_names[i]);
        templates[24 + i][i] = 1.0;
        templates[24 + i][(i + 4) % 12] = 1.0;
        templates[24 + i][(i + 7) % 12] = 1.0;
        templates[24 + i][(i + 11) % 12] = 1.0;
        // Min7
        chord_names[36 + i] = format!("{}m7", note_names[i]);
        templates[36 + i][i] = 1.0;
        templates[36 + i][(i + 3) % 12] = 1.0;
        templates[36 + i][(i + 7) % 12] = 1.0;
        templates[36 + i][(i + 10) % 12] = 1.0;
        // Dom7
        chord_names[48 + i] = format!("{}7", note_names[i]);
        templates[48 + i][i] = 1.0;
        templates[48 + i][(i + 4) % 12] = 1.0;
        templates[48 + i][(i + 7) % 12] = 1.0;
        templates[48 + i][(i + 10) % 12] = 1.0;
        // Maj6
        chord_names[60 + i] = format!("{}6", note_names[i]);
        templates[60 + i][i] = 1.0;
        templates[60 + i][(i + 4) % 12] = 1.0;
        templates[60 + i][(i + 7) % 12] = 1.0;
        templates[60 + i][(i + 9) % 12] = 1.0;
        // sus4
        chord_names[72 + i] = format!("{}sus4", note_names[i]);
        templates[72 + i][i] = 1.0;
        templates[72 + i][(i + 5) % 12] = 1.0;
        templates[72 + i][(i + 7) % 12] = 1.0;
    }

    // ═══════════════════════════════════════════════════
    // VITERBI TRANSITION MATRIX (Smart Pop/Rock Prior)
    // ═══════════════════════════════════════════════════
    let mut trans_log = [[0.0_f32; 84]; 84];
    for from in 0..84usize {
        for to in 0..84usize {
            let prob: f32 = if from == to {
                0.80 // Extremely high probability of holding the same chord (pop music is slow)
            } else {
                let from_root = from % 12;
                let to_root = to % 12;
                
                if from_root == to_root {
                    0.05 / 6.0 // Common to change flavor (e.g., Fmaj7 -> F6)
                } else {
                    let interval = (to_root + 12 - from_root) % 12;
                    let p = match interval {
                        7 => 0.03, // Perfect 5th up (C -> G)
                        5 => 0.03, // Perfect 4th up (C -> F)
                        8 => 0.025, // Major 3rd down (Am -> F) - Crucial for Let It Be
                        2 => 0.015, // Major 2nd up (F -> G)
                        10 => 0.015, // Major 2nd down (G -> F)
                        9 => 0.015, // Minor 3rd down (C -> Am)
                        3 => 0.015, // Minor 3rd up (Am -> C)
                        4 => 0.005, // Major 3rd up (F -> Am)
                        _ => 0.0005, // Rare jumps (like F -> A#) heavily mathematically penalized!
                    };
                    p / 7.0 // Spread probability across the 7 target chord flavors
                }
            };
            trans_log[from][to] = (prob + 1e-10).ln();
        }
    }

    // ═══════════════════════════════════════════════════
    // STATE: Beat tracking
    // ═══════════════════════════════════════════════════
    let frame_duration = 2048.0 / sample_rate as f32;
    let mut prev_magnitudes: Vec<f32> = Vec::new();
    let onset_buf_size: usize = 200;
    let mut onset_signal: Vec<f32> = vec![0.0; onset_buf_size];
    let mut onset_idx: usize = 0;
    let mut flux_ema: f32 = 0.0;
    let mut estimated_beat_interval: f32 = 0.0;
    let mut phase: f32 = 0.0;

    // STATE: Beat-synced chroma accumulation
    let mut beat_chroma_accum = [0.0_f32; 12];
    let mut beat_bass_accum = [0.0_f32; 12];
    let mut frames_in_beat: usize = 0;

    // STATE: Viterbi sliding window
    const VITERBI_WINDOW: usize = 4;
    let mut beat_observations: Vec<[f32; 84]> = Vec::with_capacity(VITERBI_WINDOW + 4);
    let mut current_output_chord = String::from("-");
    let mut beat_count: usize = 0;

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
                    let rms: f32 = (sample_buffer.iter().map(|s| s * s).sum::<f32>() / sample_buffer.len() as f32).sqrt();

                    let windowed_samples = hann_window(&sample_buffer);
                    if let Ok(spectrum) = samples_fft_to_spectrum(
                        &windowed_samples,
                        sample_rate,
                        FrequencyLimit::Range(20.0, 20000.0),
                        Some(&divide_by_N_sqrt),
                    ) {
                        let spec_data = spectrum.data();
                        let mut bins = vec![0.0; 24];
                        let mut chroma = [0.0_f32; 12];
                        let mut bass_chroma = [0.0_f32; 12];
                        let mut magnitudes: Vec<f32> = Vec::with_capacity(spec_data.len());

                        let min_freq = 40.0_f32;
                        let max_freq = 14000.0_f32;

                        for (freq_val, fr_value) in spec_data {
                            let f = freq_val.val();
                            let mag = fr_value.val();
                            magnitudes.push(mag);

                            if f >= 27.5 && f <= 4000.0 {
                                let pitch = 12.0 * (f / 440.0).log2() + 69.0;
                                let pitch_class = (pitch.round() as usize).rem_euclid(12);
                                chroma[pitch_class] += mag;
                                if f >= 65.0 && f <= 261.0 {
                                    bass_chroma[pitch_class] += mag;
                                }
                            }

                            if f >= min_freq && f <= max_freq {
                                let log_f = f.log10();
                                let log_min = min_freq.log10();
                                let log_max = max_freq.log10();
                                let mut bin_index = ((log_f - log_min) / (log_max - log_min) * 24.0) as usize;
                                if bin_index >= 24 { bin_index = 23; }
                                let db = 20.0 * (mag + 1e-6).log10();
                                let scaled = ((db + 60.0) / 60.0).max(0.0).min(1.0);
                                if scaled > bins[bin_index] {
                                    bins[bin_index] = scaled;
                                }
                            }
                        }

                        // Harmonic suppression
                        let raw_chroma = chroma.clone();
                        for pc in 0..12 {
                            if raw_chroma[pc] > 0.0 {
                                let h3 = (pc + 7) % 12;
                                chroma[h3] = (chroma[h3] - raw_chroma[pc] * 0.15).max(0.0);
                                let h5 = (pc + 4) % 12;
                                chroma[h5] = (chroma[h5] - raw_chroma[pc] * 0.10).max(0.0);
                            }
                        }

                        // Fill visualizer gaps
                        for i in 1..24 {
                            if bins[i] == 0.0 { bins[i] = bins[i - 1] * 0.8; }
                        }

                        // ═══════════════════════════════════
                        // BEAT TRACKING: Spectral Flux
                        // ═══════════════════════════════════
                        let flux = if prev_magnitudes.is_empty() {
                            prev_magnitudes = magnitudes.clone();
                            0.0_f32
                        } else {
                            let mut f = 0.0_f32;
                            let len = magnitudes.len().min(prev_magnitudes.len());
                            for i in 0..len {
                                let diff = magnitudes[i] - prev_magnitudes[i];
                                if diff > 0.0 { f += diff; }
                            }
                            prev_magnitudes = magnitudes;
                            f
                        };

                        flux_ema = 0.05 * flux + 0.95 * flux_ema;
                        let is_onset = flux > flux_ema * 2.0 && flux > 0.01;
                        onset_signal[onset_idx % onset_buf_size] = if is_onset { flux } else { 0.0 };
                        onset_idx += 1;

                        // BPM estimation via autocorrelation (every ~2s)
                        if onset_idx % 44 == 0 && onset_idx > onset_buf_size / 2 {
                            let min_lag = (60.0 / (200.0 * frame_duration)) as usize;
                            let max_lag = (60.0 / (60.0 * frame_duration)) as usize;
                            let search_len = onset_buf_size / 2;
                            let mut best_lag: usize = 0;
                            let mut best_corr = 0.0_f32;

                            for lag in min_lag..=max_lag.min(search_len) {
                                let mut corr = 0.0_f32;
                                for n in 0..search_len {
                                    let i1 = (onset_idx + onset_buf_size - 1 - n) % onset_buf_size;
                                    let i2 = (onset_idx + onset_buf_size - 1 - n - lag) % onset_buf_size;
                                    corr += onset_signal[i1] * onset_signal[i2];
                                }
                                if corr > best_corr {
                                    best_corr = corr;
                                    best_lag = lag;
                                }
                            }

                            if best_lag > 0 && best_corr > 0.01 {
                                let new_interval = best_lag as f32;
                                // Only accept sane BPMs for pop/rock (60 to 180)
                                if (60.0 / (new_interval * frame_duration)) > 60.0 && (60.0 / (new_interval * frame_duration)) < 180.0 {
                                    if estimated_beat_interval == 0.0 {
                                        estimated_beat_interval = new_interval;
                                    } else {
                                        // Extremely stiff smoothing to prevent jumping
                                        estimated_beat_interval = 0.95 * estimated_beat_interval + 0.05 * new_interval;
                                    }
                                }
                            }
                        }

                        // ═══════════════════════════════════
                        // ACCUMULATE CHROMA FOR CURRENT BEAT
                        // ═══════════════════════════════════
                        if rms > 0.003 {
                            for i in 0..12 {
                                beat_chroma_accum[i] += chroma[i];
                                beat_bass_accum[i] += bass_chroma[i];
                            }
                            frames_in_beat += 1;
                        }

                        // ═══════════════════════════════════
                        // BEAT PHASE TRACKING
                        // ═══════════════════════════════════
                        phase += 1.0;
                        let is_beat = if estimated_beat_interval > 0.0 {
                            if phase >= estimated_beat_interval {
                                phase -= estimated_beat_interval;
                                true
                            } else if is_onset && phase > estimated_beat_interval * 0.85 {
                                phase = 0.0;
                                true
                            } else {
                                false
                            }
                        } else {
                            // No BPM yet — fallback to ~500ms beats
                            frames_in_beat >= 11
                        };

                        // ═══════════════════════════════════
                        // ON BEAT: SCORE + VITERBI
                        // ═══════════════════════════════════
                        if is_beat && frames_in_beat > 0 {
                            beat_count += 1;

                            // Average accumulated chroma over this beat
                            let mut avg_chroma = [0.0_f32; 12];
                            let mut avg_bass = [0.0_f32; 12];
                            for i in 0..12 {
                                avg_chroma[i] = beat_chroma_accum[i] / frames_in_beat as f32;
                                avg_bass[i] = beat_bass_accum[i] / frames_in_beat as f32;
                            }

                            // Noise floor removal (median subtraction)
                            let mut sorted_c = avg_chroma.clone();
                            sorted_c.sort_by(|a, b| a.partial_cmp(b).unwrap());
                            let floor_c = sorted_c[5];
                            for v in &mut avg_chroma { *v = (*v - floor_c).max(0.0); }

                            let max_c = avg_chroma.iter().cloned().fold(0.0_f32, f32::max);
                            if max_c > 0.0 {
                                for v in &mut avg_chroma { *v /= max_c; }
                            }

                            // Bass noise floor + dominant bass
                            let mut sorted_b = avg_bass.clone();
                            sorted_b.sort_by(|a, b| a.partial_cmp(b).unwrap());
                            let floor_b = sorted_b[5];
                            for v in &mut avg_bass { *v = (*v - floor_b).max(0.0); }
                            let dominant_bass = avg_bass.iter().enumerate()
                                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
                                .map(|(i, _)| i).unwrap_or(24);

                            // Emission scores (cosine similarity + bass bonus)
                            let mut emissions = [0.0_f32; 84];
                            for i in 0..84 {
                                let mut dot = 0.0_f32;
                                let mut tsq = 0.0_f32;
                                let mut csq = 0.0_f32;
                                for j in 0..12 {
                                    dot += avg_chroma[j] * templates[i][j];
                                    tsq += templates[i][j] * templates[i][j];
                                    csq += avg_chroma[j] * avg_chroma[j];
                                }
                                if tsq > 0.0 && csq > 0.0 {
                                    emissions[i] = dot / (tsq.sqrt() * csq.sqrt());
                                }
                                // Drastically reduce bass bonus to prevent low-end resonance from overriding the actual chord
                                if dominant_bass < 12 && (i % 12) == dominant_bass {
                                    emissions[i] *= 1.02;
                                }
                                
                                // Major chord priority: Gives a tiny 5% boost to Major chords.
                                // This solves the "F6 vs Dm7" paradox where they share the exact same notes.
                                if i < 12 {
                                    emissions[i] *= 1.05;
                                }
                            }

                            beat_observations.push(emissions);

                            // ═══════════════════════════════
                            // VITERBI DECODING (sliding window)
                            // ═══════════════════════════════
                            if beat_observations.len() >= VITERBI_WINDOW {
                                let n_f = beat_observations.len();
                                let n_c: usize = 84;

                                let mut vtb = vec![vec![f32::NEG_INFINITY; n_c]; n_f];
                                let mut bkp = vec![vec![0usize; n_c]; n_f];

                                for j in 0..n_c {
                                    // Scale emission scores significantly to compete with transition log-probs
                                    vtb[0][j] = beat_observations[0][j] * 20.0;
                                }

                                for t in 1..n_f {
                                    for j in 0..n_c {
                                        let em = beat_observations[t][j] * 20.0;
                                        let mut bp = f32::NEG_INFINITY;
                                        let mut bi: usize = 0;
                                        for i in 0..n_c {
                                            let v = vtb[t - 1][i] + trans_log[i][j];
                                            if v > bp { bp = v; bi = i; }
                                        }
                                        vtb[t][j] = bp + em;
                                        bkp[t][j] = bi;
                                    }
                                }

                                let mut path = vec![0usize; n_f];
                                path[n_f - 1] = vtb[n_f - 1].iter().enumerate()
                                    .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
                                    .map(|(i, _)| i).unwrap_or(0);
                                for t in (0..n_f - 1).rev() {
                                    path[t] = bkp[t + 1][path[t + 1]];
                                }

                                let output_idx = n_f / 2;
                                let chord_idx = path[output_idx];
                                let new_chord = chord_names[chord_idx].to_string();

                                if new_chord != current_output_chord {
                                    let path_str: Vec<String> = path.iter().map(|&i| chord_names[i].clone()).collect();
                                    
                                    // Debug info
                                    let note_names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
                                    let mut chroma_str = String::new();
                                    for i in 0..12 {
                                        if avg_chroma[i] > 0.1 {
                                            chroma_str.push_str(&format!("{}:{:.2} ", note_names[i], avg_chroma[i]));
                                        }
                                    }
                                    let bass_str = if dominant_bass < 12 { note_names[dominant_bass] } else { "-" };
                                    
                                    println!("─────────────────────────────────────────");
                                    println!("🎵 CHORD: {} (window ends at beat #{}) | bass: {}", new_chord, beat_count, bass_str);
                                    println!("   path: [{}]", path_str.join(" → "));
                                    println!("   chroma: [{}]", chroma_str.trim());
                                }

                                current_output_chord = new_chord.clone();
                                {
                                    let mut current = CURRENT_CHORD.lock().unwrap();
                                    *current = new_chord;
                                }

                                beat_observations.remove(0);
                            }

                            // Reset accumulators
                            beat_chroma_accum = [0.0_f32; 12];
                            beat_bass_accum = [0.0_f32; 12];
                            frames_in_beat = 0;
                        }

                        // Visualizer: always update for smooth UI
                        if let Ok(mut current) = CURRENT_SPECTRUM.lock() {
                            for i in 0..24 { current[i] = bins[i]; }
                        }

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
