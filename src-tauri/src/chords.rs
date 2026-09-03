#[tauri::command]
pub async fn scrape_chords(
    id: String,
    title: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;
    let cache_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("chords_cache_v4");
    let _ = std::fs::create_dir_all(&cache_dir);

    let safe_id = id.replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "");
    let cache_file = cache_dir.join(format!("{}.json", safe_id));

    if cache_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&cache_file) {
            return Ok(content);
        }
    }

    let mut clean_title = title.clone();
    if let Some(idx) = clean_title.find('[') {
        clean_title.truncate(idx);
    }
    if let Some(idx) = clean_title.find('(') {
        clean_title.truncate(idx);
    }
    if let Some(idx) = clean_title.find('{') {
        clean_title.truncate(idx);
    }
    if let Some(idx) = clean_title.find('|') {
        clean_title.truncate(idx);
    }

    let clean_title_alphanum = clean_title.replace(|c: char| !c.is_alphanumeric() && c != ' ', "");
    let words: Vec<&str> = clean_title_alphanum.split_whitespace().take(6).collect();
    let query_str = words.join("+");

    // Primary: Chordify search using the YouTube video URL (most accurate version match)
    let search_url = format!(
        "https://chordify.net/search/https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D{}",
        id
    );
    // Primary fallback: Google
    let google_fallback_url = format!(
        "https://www.google.com/search?q=site:chordify.net+{}",
        query_str
    );
    // Secondary fallback: Yahoo (if Google serves CAPTCHA)
    let yahoo_fallback_url = format!(
        "https://search.yahoo.com/search?p=site:chordify.net+{}",
        query_str
    );

    // Close any existing scraper windows to prevent concurrent request abuse
    for (label, window) in app_handle.webview_windows() {
        if label.starts_with("scraper_") {
            println!(
                "Killing existing scraper window to prevent concurrency abuse: {}",
                label
            );
            let _ = window.destroy();
        }
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    static WINDOW_COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let counter = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let window_label = format!("scraper_{}_{}_{}", safe_id, ts, counter);

    // JS uses format! (not r#) so we can embed the urls at compile time
    let js_code = format!(
        r#"
        (function() {{
            // ── FALLBACK HANDLER (GOOGLE) ─────────────────────────────────────────
            if (window.location.hostname.includes("google.")) {{
                let googleAttempts = 0;
                let checkGoogle = setInterval(() => {{
                    googleAttempts++;
                    let targetLink = null;
                    let links = document.querySelectorAll('a');
                    for (let i = 0; i < links.length; i++) {{
                        let h = links[i].href || "";
                        let raw = links[i].outerHTML || "";
                        if ((h.includes("chordify.net") || raw.includes("chordify.net")) && !raw.includes("translate") && !raw.includes("webcache") && !raw.includes("policies")) {{
                            if (raw.includes("chords") || raw.includes("song")) {{
                                targetLink = links[i];
                                break;
                            }}
                        }}
                    }}
                    
                    if (window.location.pathname.includes("/sorry/index") || (document.body && document.body.innerText && (document.body.innerText.includes("unusual traffic") || document.body.innerText.includes("tidak wajar")))) {{
                        clearInterval(checkGoogle);
                        // Trigger Yahoo fallback since Google is blocked
                        window.location.replace("https://chordify.net/?scraper_result=YAHOO_FALLBACK");
                        return;
                    }}
                    
                    if (targetLink) {{
                        clearInterval(checkGoogle);
                        // Google often sets target="_blank" which Tauri will block or open externally.
                        // We must remove it so it navigates in this exact window.
                        targetLink.removeAttribute('target');
                        targetLink.click();
                        // Fallback navigation if click doesn't trigger
                        setTimeout(() => {{ window.location.href = targetLink.href; }}, 100);
                    }} else if (googleAttempts > 20) {{ // Timeout after 10 seconds
                        clearInterval(checkGoogle);
                        let err = encodeURIComponent(JSON.stringify({{success: false, error: "Not found on Chordify", data: null}}));
                        window.location.replace("https://chordify.net/?scraper_result=" + err);
                    }}
                }}, 500);
                return;
            }}

            // ── FALLBACK HANDLER (YAHOO) ─────────────────────────────────────────
            if (window.location.hostname.includes("yahoo.")) {{
                let searchAttempts = 0;
                let checkSearch = setInterval(() => {{
                    searchAttempts++;
                    // Yahoo uses standard hrefs or redirect URLs containing the encoded target URL
                    let link = document.querySelector('a[href*="chordify.net/chords/"], a[href*="chordify.net%2Fchords%2F"]');
                    
                    if (link) {{
                        clearInterval(checkSearch);
                        window.location.replace(link.href);
                    }} else if (searchAttempts > 20) {{ // Timeout after 10 seconds
                        clearInterval(checkSearch);
                        window.location.replace("https://chordify.net/?scraper_result=GOOGLE_FALLBACK");
                    }}
                }}, 500);
                return;
            }}

            if (!window.location.hostname.includes("chordify.net")) return;
            
            // Stealth overrides to bypass Cloudflare bot detection
            try {{
                Object.defineProperty(navigator, 'webdriver', {{ get: () => undefined }});
                window.chrome = {{ runtime: {{}} }};
                if (!navigator.plugins || navigator.plugins.length === 0) {{
                    Object.defineProperty(navigator, 'plugins', {{ get: () => [1, 2, 3] }});
                }}
                if (!navigator.languages || navigator.languages.length === 0) {{
                    Object.defineProperty(navigator, 'languages', {{ get: () => ['en-US', 'en'] }});
                }}
            }} catch(e) {{}}

            // Clear storage immediately to bypass Chordify's JS-based daily limits
            try {{
                window.localStorage.clear();
                window.sessionStorage.clear();
                document.cookie.split(";").forEach(function(c) {{ 
                    document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
                }});
            }} catch(e) {{}}
            
            let attempts = 0;
            let checkInterval = setInterval(() => {{
                attempts++;
                
                // ── SIGNUP / SIGNIN WALL (redirect) → signal Rust to open fresh Yahoo window ─
                if (window.location.pathname.startsWith('/user/signup') || window.location.pathname.startsWith('/user/signin')) {{
                    clearInterval(checkInterval);
                    console.log('[NadaNada] Chordify login redirect – signalling Yahoo fallback');
                    window.location.replace("https://chordify.net/?scraper_result=YAHOO_FALLBACK");
                    return;
                }}

                // ── SIGNUP MODAL POPUP (overlay on search page) → same fallback ────
                // Use form selector (structural) + textContent (not innerText, which can miss hidden elements)
                if (document.querySelector('form[action="/user/signup"]') ||
                    (document.body && document.body.textContent && document.body.textContent.includes("Please sign up to add new songs to Chordify"))) {{
                    clearInterval(checkInterval);
                    console.log('[NadaNada] Chordify signup modal detected – signalling Yahoo fallback');
                    window.location.replace("https://chordify.net/?scraper_result=YAHOO_FALLBACK");
                    return;
                }}
                
                if (attempts > 80) {{
                    clearInterval(checkInterval);
                    let err = encodeURIComponent(JSON.stringify({{success: false, error: "Timeout waiting for chords", data: null}}));
                    window.location.replace("https://chordify.net/?scraper_result=" + err);
                    return;
                }}
                
                if (document.body && document.body.textContent && (document.body.textContent.includes("Ribbit! Nothing here") || document.querySelectorAll('img[src*="404"]').length > 0)) {{
                    clearInterval(checkInterval);
                    let err = encodeURIComponent(JSON.stringify({{success: false, error: "Song not found or IP blocked by Chordify (404)", data: null}}));
                    window.location.replace("https://chordify.net/?scraper_result=" + err);
                    return;
                }}
                
                // ── CHORDIFY SEARCH RESULTS PAGE ─────────────────────────────────
                if (window.location.pathname.startsWith('/search/')) {{
                    let chordLinks = document.querySelectorAll('a[href^="/chords/"]');
                    let allLinks = document.querySelectorAll('a[href^="/search/"]');
                    if (chordLinks.length > 0) {{
                        clearInterval(checkInterval);
                        // Add human delay before clicking to avoid bot detection
                        setTimeout(() => {{
                            window.location.href = chordLinks[0].href;
                        }}, 1500 + Math.random() * 1500);
                    }} else if (document.body.textContent.includes("No results found")) {{
                        // Chordify search yielded nothing – signal Rust to open fresh Yahoo window
                        clearInterval(checkInterval);
                        console.log('[NadaNada] Chordify search found no results – signalling Yahoo fallback');
                        window.location.replace("https://chordify.net/?scraper_result=YAHOO_FALLBACK");
                        return;
                    }} else if (allLinks.length > 0 && attempts > 6) {{
                        // Results exist but none lead to /chords/ – song is signup-gated
                        clearInterval(checkInterval);
                        console.log('[NadaNada] Chordify results are signup-gated – signalling Yahoo fallback');
                        window.location.replace("https://chordify.net/?scraper_result=YAHOO_FALLBACK");
                        return;
                    }}
                }} 
                // ── CHORDIFY CHORD PAGE ───────────────────────────────────────────
                else if (window.location.pathname.startsWith('/chords/')) {{
                    let chordElements = document.querySelectorAll('.chord');
                    let scrollEl = document.querySelector('[data-bpm]');
                    let bpmMatch = document.body.textContent.match(/BPM\s*(\d{{2,3}})/i);
                    
                    // Wait for both chords AND BPM to load (or fallback after 5 seconds of seeing chords)
                    if (chordElements.length > 0) {{
                        if (!scrollEl && !bpmMatch && attempts < 40) {{
                            return; // Wait a bit longer for the sidebar to load asynchronously
                        }}
                        
                        clearInterval(checkInterval);
                        
                        let chords = [];
                        let bpm = 120;
                        
                        if (scrollEl) {{
                            bpm = parseFloat(scrollEl.getAttribute('data-bpm')) || 120;
                        }} else if (bpmMatch) {{
                            bpm = parseFloat(bpmMatch[1]) || 120;
                        }}
                        let secondsPerBeat = 60.0 / bpm;
                        
                        let seenBeats = new Set();
                        for (let el of chordElements) {{
                            if (!el.hasAttribute('data-i')) continue;
                            
                            let beatIdx = parseInt(el.getAttribute('data-i'));
                            if (seenBeats.has(beatIdx)) continue;
                            
                            let text = el.innerText.trim();
                            if (text && text !== '' && !el.classList.contains('nolabel')) {{
                                chords.push({{
                                    beat: beatIdx + 1,
                                    time_sec: beatIdx * secondsPerBeat,
                                    chord: text
                                }});
                                seenBeats.add(beatIdx);
                            }}
                        }}
                        
                        chords.sort((a, b) => a.time_sec - b.time_sec);
                        
                        let result = {{
                            success: true,
                            data: {{ bpm: bpm, chords: chords }},
                            error: null
                        }};
                        
                        let payload = encodeURIComponent(JSON.stringify(result));
                        window.location.replace("https://chordify.net/?scraper_result=" + payload);
                        return;
                    }}
                }}
            }}, 500);
        }})();
    "#
    );

    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx_mutex = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_mutex_clone = tx_mutex.clone();

    let parsed_search_url = match search_url.parse() {
        Ok(u) => u,
        Err(e) => return Err(format!("Failed to parse search URL: {}", e)),
    };

    println!("Building hidden scraper window for URL: {}", search_url);
    let window = match tauri::WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        tauri::WebviewUrl::External(parsed_search_url),
    )
    .incognito(true)
    .visible(false)
    .decorations(false)
    .skip_taskbar(true)
    .always_on_bottom(true)
    .initialization_script(&js_code)
    .on_navigation(move |url| {
        println!("Navigating to: {}", url.as_str());
        let mut got_result = false;
        let mut json_str = String::new();

        for (key, value) in url.query_pairs() {
            if key == "scraper_result" {
                got_result = true;
                json_str = value.into_owned();
                break;
            }
        }

        if got_result {
            if let Ok(mut guard) = tx_mutex_clone.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(json_str);
                }
            }
            return false; // Cancel navigation
        }
        true
    })
    .build()
    {
        Ok(w) => {
            let _ = w.hide();
            w
        },
        Err(e) => {
            if let Some(w) = app_handle.get_webview_window(&window_label) {
                let _ = w.destroy();
            }
            return Err(format!("Failed to build window: {}", e));
        }
    };

    println!("Waiting for scraper result...");
    // Wait for the result with a 45-second timeout
    let result_str = match tokio::time::timeout(std::time::Duration::from_secs(45), rx).await {
        Ok(Ok(data)) => {
            println!("Got result from scraper!");
            data
        }
        _ => {
            println!("Scraper timed out!");
            let _ = window.destroy();
            return Err("Timeout waiting for scraper".to_string());
        }
    };

    let _ = window.destroy();

    if result_str.trim().is_empty() {
        return Err("Scraper returned empty output".to_string());
    }

    // ── YAHOO FALLBACK: open a brand new fresh incognito window ─────────────
    let mut current_result = result_str;

    if current_result.trim() == "YAHOO_FALLBACK" {
        println!("Chordify fallback triggered – opening fresh incognito window at Yahoo");

        let ts2 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let counter2 = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let window_label2 = format!("scraper_{}_{}_{}_y", safe_id, ts2, counter2);

        let (tx2, rx2) = tokio::sync::oneshot::channel();
        let tx_mutex2 = std::sync::Arc::new(std::sync::Mutex::new(Some(tx2)));
        let tx_mutex2_clone = tx_mutex2.clone();

        let parsed_yahoo_url = match yahoo_fallback_url.parse() {
            Ok(u) => u,
            Err(e) => return Err(format!("Failed to parse Yahoo fallback URL: {}", e)),
        };

        let window2 = match tauri::WebviewWindowBuilder::new(
            &app_handle,
            &window_label2,
            tauri::WebviewUrl::External(parsed_yahoo_url),
        )
        .incognito(true)
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .initialization_script(&js_code)
        .on_navigation(move |url| {
            println!("[Yahoo fallback] Navigating to: {}", url.as_str());
            let mut got_result = false;
            let mut json_str = String::new();
            for (key, value) in url.query_pairs() {
                if key == "scraper_result" {
                    got_result = true;
                    json_str = value.into_owned();
                    break;
                }
            }
            if got_result {
                if let Ok(mut guard) = tx_mutex2_clone.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(json_str);
                    }
                }
                return false;
            }
            true
        })
        .build()
        {
            Ok(w) => {
                let _ = w.hide();
                w
            },
            Err(e) => return Err(format!("Failed to build Yahoo fallback window: {}", e)),
        };

        println!("Waiting for Yahoo fallback scraper result...");
        current_result = match tokio::time::timeout(std::time::Duration::from_secs(45), rx2).await {
            Ok(Ok(data)) => {
                println!("Got result from Yahoo fallback scraper!");
                let _ = window2.destroy();
                data
            }
            _ => {
                println!("Yahoo fallback scraper timed out! Falling back to Google...");
                let _ = window2.destroy();
                "GOOGLE_FALLBACK".to_string()
            }
        };
    }

    // ── GOOGLE FALLBACK: open another window if Yahoo failed ─
    if current_result.trim() == "GOOGLE_FALLBACK" {
        println!("Yahoo fallback blocked or timed out – opening fresh incognito window at Google");

        let ts3 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let counter3 = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let window_label3 = format!("scraper_{}_{}_{}_g", safe_id, ts3, counter3);

        let (tx3, rx3) = tokio::sync::oneshot::channel();
        let tx_mutex3 = std::sync::Arc::new(std::sync::Mutex::new(Some(tx3)));
        let tx_mutex3_clone = tx_mutex3.clone();

        let parsed_google_url = match google_fallback_url.parse() {
            Ok(u) => u,
            Err(e) => return Err(format!("Failed to parse Google fallback URL: {}", e)),
        };

        let window3 = match tauri::WebviewWindowBuilder::new(
            &app_handle,
            &window_label3,
            tauri::WebviewUrl::External(parsed_google_url),
        )
        .incognito(true)
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .initialization_script(&js_code)
        .on_navigation(move |url| {
            println!("[Google fallback] Navigating to: {}", url.as_str());
            let mut got_result = false;
            let mut json_str = String::new();
            for (key, value) in url.query_pairs() {
                if key == "scraper_result" {
                    got_result = true;
                    json_str = value.into_owned();
                    break;
                }
            }
            if got_result {
                if let Ok(mut guard) = tx_mutex3_clone.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(json_str);
                    }
                }
                return false;
            }
            true
        })
        .build()
        {
            Ok(w) => {
                let _ = w.hide();
                w
            },
            Err(e) => return Err(format!("Failed to build Google fallback window: {}", e)),
        };

        println!("Waiting for Google fallback scraper result...");
        current_result = match tokio::time::timeout(std::time::Duration::from_secs(45), rx3).await {
            Ok(Ok(data)) => {
                println!("Got result from Google fallback scraper!");
                let _ = window3.destroy();
                data
            }
            _ => {
                println!("Google fallback scraper timed out!");
                let _ = window3.destroy();
                return Err("Timeout waiting for Google fallback scraper".to_string());
            }
        };
    }

    // ─────────────────────────────────────────────────────────────────────────

    if current_result.contains("\"success\": true") || current_result.contains("\"success\":true") {
        let _ = std::fs::write(&cache_file, &current_result);
    }

    Ok(current_result)
}
