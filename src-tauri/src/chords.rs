#[tauri::command]
pub async fn scrape_chords(
    id: String,
    title: String,
    duration: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;
    let cache_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("chords_cache_v7");
    let _ = std::fs::create_dir_all(&cache_dir);

    let expected_duration_sec: i64 = if let Some(ref dur) = duration {
        let parts: Vec<&str> = dur.split(':').collect();
        if parts.len() == 2 {
            let m: i64 = parts[0].parse().unwrap_or(0);
            let s: i64 = parts[1].parse().unwrap_or(0);
            m * 60 + s
        } else if parts.len() == 3 {
            let h: i64 = parts[0].parse().unwrap_or(0);
            let m: i64 = parts[1].parse().unwrap_or(0);
            let s: i64 = parts[2].parse().unwrap_or(0);
            h * 3600 + m * 60 + s
        } else {
            0
        }
    } else {
        0
    };

    let safe_id = id.replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "");
    let cache_file = cache_dir.join(format!("{}.json", safe_id));

    if cache_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&cache_file) {
            return Ok(content);
        }
    }

    // Remove content inside brackets like (2024 Remaster), [Official Audio]
    // while carefully preserving everything outside (especially the artist name!)
    let mut clean_title = String::new();
    let mut depth = 0;
    for c in title.chars() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            '|' => break,
            _ if depth == 0 => clean_title.push(c),
            _ => {}
        }
    }

    let clean_title_alphanum = clean_title.replace(|c: char| !c.is_alphanumeric() && c != ' ', "");
    let words: Vec<&str> = clean_title_alphanum.split_whitespace().take(8).collect();
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
                    let allLinks = Array.from(document.querySelectorAll('a[href*="chordify.net/chords/"], a[href*="chordify.net%2Fchords%2F"]'));
                    let candidates = [];
                    let seen = new Set();
                    for (let a of allLinks) {{
                        let h = a.href || "";
                        let raw = a.outerHTML || "";
                        if (!raw.includes("translate") && !raw.includes("webcache") && !raw.includes("policies")) {{
                            let match = h.match(/(https?%3A%2F%2Fchordify\.net%2Fchords%2F[^&]+)/i);
                            let cleanUrl = match ? decodeURIComponent(match[1]) : h;
                            if (cleanUrl.includes("chordify.net/chords/") && !seen.has(cleanUrl)) {{
                                seen.add(cleanUrl);
                                let linkText = ((a.innerText || "") + " " + cleanUrl).toLowerCase();
                                let isAcoustic = linkText.includes("acoustic");
                                let isLive = linkText.includes("live");
                                let isCover = linkText.includes("cover");
                                candidates.push({{
                                    url: cleanUrl,
                                    penalty: (isAcoustic ? 3 : 0) + (isLive ? 2 : 0) + (isCover ? 2 : 0)
                                }});
                            }}
                        }}
                    }}

                    if (window.location.pathname.includes("/sorry/index") || (document.body && document.body.innerText && (document.body.innerText.includes("unusual traffic") || document.body.innerText.includes("tidak wajar")))) {{
                        clearInterval(checkGoogle);
                        // Trigger Yahoo fallback since Google is blocked
                        window.location.replace("https://chordify.net/?scraper_result=YAHOO_FALLBACK");
                        return;
                    }}
                    
                    if (candidates.length > 0) {{
                        clearInterval(checkGoogle);
                        candidates.sort((a, b) => a.penalty - b.penalty);
                        let candidateUrls = candidates.map(c => c.url);
                        let target = candidateUrls.shift();
                        sessionStorage.setItem('chord_candidates', JSON.stringify(candidateUrls));
                        window.location.replace(target);
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
                    let allLinks = Array.from(document.querySelectorAll('a[href*="chordify.net/chords/"], a[href*="chordify.net%2Fchords%2F"]'));
                    if (allLinks.length > 0) {{
                        clearInterval(checkSearch);
                        let candidates = [];
                        let seen = new Set();
                        for (let a of allLinks) {{
                            let href = a.href || '';
                            let match = href.match(/(https?%3A%2F%2Fchordify\.net%2Fchords%2F[^&]+)/i);
                            let cleanUrl = match ? decodeURIComponent(match[1]) : href;
                            if (cleanUrl.includes('chordify.net/chords/') && !seen.has(cleanUrl)) {{
                                seen.add(cleanUrl);
                                let linkText = ((a.innerText || '') + ' ' + cleanUrl).toLowerCase();
                                let isAcoustic = linkText.includes('acoustic');
                                let isLive = linkText.includes('live');
                                let isCover = linkText.includes('cover');
                                candidates.push({{
                                    url: cleanUrl,
                                    penalty: (isAcoustic ? 3 : 0) + (isLive ? 2 : 0) + (isCover ? 2 : 0)
                                }});
                            }}
                        }}
                        candidates.sort((a, b) => a.penalty - b.penalty);
                        if (candidates.length > 0) {{
                            let candidateUrls = candidates.map(c => c.url);
                            let target = candidateUrls.shift();
                            sessionStorage.setItem('chord_candidates', JSON.stringify(candidateUrls));
                            window.location.replace(target);
                        }}
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
            let prevChordCount = 0;
            let stableChordAttempts = 0;
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
                    let chordLinks = Array.from(document.querySelectorAll('a[href^="/chords/"]'));
                    let allLinks = document.querySelectorAll('a[href^="/search/"]');
                    if (chordLinks.length > 0) {{
                        clearInterval(checkInterval);
                        let candidates = [];
                        let seen = new Set();
                        for (let a of chordLinks) {{
                            let cleanUrl = a.href || '';
                            if (cleanUrl.includes('/chords/') && !seen.has(cleanUrl)) {{
                                seen.add(cleanUrl);
                                let linkText = ((a.innerText || '') + ' ' + cleanUrl).toLowerCase();
                                let isAcoustic = linkText.includes('acoustic');
                                let isLive = linkText.includes('live');
                                let isCover = linkText.includes('cover');
                                let isEasy = linkText.includes('easy');
                                candidates.push({{
                                    url: cleanUrl,
                                    penalty: (isAcoustic ? 4 : 0) + (isLive ? 3 : 0) + (isCover ? 3 : 0) + (isEasy ? 2 : 0)
                                }});
                            }}
                        }}
                        if (candidates.length > 0) {{
                            candidates.sort((a, b) => a.penalty - b.penalty);
                            let candidateUrls = candidates.map(c => c.url);
                            let target = candidateUrls.shift();
                            sessionStorage.setItem('chord_candidates', JSON.stringify(candidateUrls));
                            // Add human delay before clicking to avoid bot detection
                            setTimeout(() => {{
                                window.location.href = target;
                            }}, 1500 + Math.random() * 1500);
                            return;
                        }}
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
                    let chordElements = document.querySelectorAll('.chord[data-i]');
                    let scrollEl = document.querySelector('[data-bpm]');
                    let bpmMatch = document.body.textContent.match(/BPM\s*(\d{{2,3}})/i);
                    let currentChordCount = chordElements.length;
                    
                    // Wait for both chords AND BPM to load and stabilize in DOM
                    if (currentChordCount > 0) {{
                        if (currentChordCount > prevChordCount) {{
                            prevChordCount = currentChordCount;
                            stableChordAttempts = 0;
                            return; // Chords are still streaming/populating in DOM
                        }} else {{
                            stableChordAttempts++;
                            if (stableChordAttempts < 3 && attempts < 50) {{
                                return; // Count must stay stable for 1.5 seconds
                            }}
                        }}

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

                        // ── Extract the YouTube video ID that Chordify is using ──
                        let chordifyVideoId = null;
                        let chordifyTitle = null;
                        let chordifyChannel = null;
                        let chordifyDuration = null;

                        // 1. Check all meta tags (og:video, twitter:player, og:image) — highest fidelity for main song
                        let metas = document.querySelectorAll('meta[property*="video"], meta[name*="player"], meta[property="og:image"], meta[name="twitter:image"]');
                        for (let i = 0; i < metas.length; i++) {{
                            let c = metas[i].getAttribute('content') || '';
                            let m = c.match(/(?:embed\/|watch\?v=|\/vi\/|youtu\.be\/)([a-zA-Z0-9_-]{{11}})/);
                            if (m) {{ chordifyVideoId = m[1]; break; }}
                        }}

                        // 2. Check main player element or iframe (explicitly avoid recommendations)
                        if (!chordifyVideoId) {{
                            let playerEl = document.querySelector('#player, [id*="player"], [class*="player-container"], [class*="media-player"]');
                            if (playerEl) {{
                                let src = playerEl.src || playerEl.getAttribute('data-video-id') || playerEl.getAttribute('data-yt-id') || '';
                                let m = src.match(/([a-zA-Z0-9_-]{{11}})/);
                                if (m) chordifyVideoId = m[1];
                                if (!chordifyVideoId) {{
                                    let iframe = playerEl.querySelector('iframe');
                                    if (iframe) {{
                                        let ifrSrc = iframe.src || iframe.getAttribute('src') || '';
                                        let im = ifrSrc.match(/(?:embed\/|watch\?v=|\/vi\/|youtu\.be\/)([a-zA-Z0-9_-]{{11}})/);
                                        if (im) chordifyVideoId = im[1];
                                    }}
                                }}
                            }}
                        }}

                        // 3. Check script contents for current song videoId
                        if (!chordifyVideoId) {{
                            let scripts = document.querySelectorAll('script:not([src])');
                            for (let s of scripts) {{
                                let txt = s.textContent || '';
                                let m = txt.match(/["'](?:video_id|videoId|youtube_id|ytId)["']\s*:\s*["']([a-zA-Z0-9_-]{{11}})["']/);
                                if (m) {{ chordifyVideoId = m[1]; break; }}
                            }}
                        }}

                        // 4. Check data attributes on non-sidebar elements
                        if (!chordifyVideoId) {{
                            let dataEls = document.querySelectorAll('[data-video-id], [data-yt-id], [data-youtube-id]');
                            for (let i = 0; i < dataEls.length; i++) {{
                                if (dataEls[i].closest('aside, [class*="related"], [class*="recommend"]')) continue;
                                let id = dataEls[i].getAttribute('data-video-id') || dataEls[i].getAttribute('data-yt-id') || dataEls[i].getAttribute('data-youtube-id');
                                if (id && /^[a-zA-Z0-9_-]{{11}}$/.test(id)) {{ chordifyVideoId = id; break; }}
                            }}
                        }}

                        // 5. Fallback: img tags, strictly EXCLUDING recommendations / related songs sidebar
                        if (!chordifyVideoId) {{
                            let imgs = document.querySelectorAll('img');
                            for (let i = 0; i < imgs.length; i++) {{
                                if (imgs[i].closest('aside, [class*="related"], [class*="recommend"], [class*="sidebar"]')) continue;
                                let src = imgs[i].src || imgs[i].getAttribute('src') || imgs[i].getAttribute('data-src') || '';
                                let m = src.match(/(?:ytimg\.com|youtube\.com)\/vi\/([a-zA-Z0-9_-]{{11}})/);
                                if (m) {{ chordifyVideoId = m[1]; break; }}
                            }}
                        }}

                        // Extract title and artist from h1
                        let h1 = document.querySelector('h1');
                        if (h1) {{
                            let txt = h1.innerText.trim();
                            let byMatch = txt.match(/^(.+?)\s+Chords?\s*(?:&|and)?\s*Lyrics?\s+by\s+(.+)$/i);
                            if (byMatch) {{
                                chordifyTitle = byMatch[1].trim();
                                chordifyChannel = byMatch[2].trim();
                            }} else {{
                                chordifyTitle = txt;
                            }}
                        }}
                        if (!chordifyTitle && document.title) {{
                            let byMatch = document.title.match(/^(.+?)\s+Chords?\s*(?:&|and)?\s*Lyrics?\s+by\s+(.+?)(?:\s*[-|].*)?$/i);
                            if (byMatch) {{
                                chordifyTitle = byMatch[1].trim();
                                chordifyChannel = byMatch[2].trim();
                            }} else {{
                                chordifyTitle = document.title.replace(/\s*[-|]\s*Chordify.*$/i, '').trim();
                            }}
                        }}

                        // Extract duration
                        let durMatches = (document.body.innerText || '').match(/(\d{{1,2}}:\d{{2}})/g);
                        if (durMatches) {{
                            let nonZero = durMatches.filter(d => d !== '00:00' && d !== '0:00');
                            if (nonZero.length > 0) chordifyDuration = nonZero[0];
                        }}

                        let chordifyThumbnail = chordifyVideoId ? ('https://i.ytimg.com/vi/' + chordifyVideoId + '/hqdefault.jpg') : null;
                        
                        // Check if current candidate's duration is a major mismatch (> 5s) and we have more search candidates
                        let chordifyDurSec = 0;
                        if (chordifyDuration) {{
                            let dp = chordifyDuration.split(':').map(Number);
                            if (dp.length === 2) chordifyDurSec = dp[0] * 60 + dp[1];
                            else if (dp.length === 3) chordifyDurSec = dp[0] * 3600 + dp[1] * 60 + dp[2];
                        }}
                        let lastChordTime = chords.length > 0 ? chords[chords.length - 1].time_sec : 0;
                        let candDur = chordifyDurSec > 0 ? chordifyDurSec : lastChordTime;
                        let expectedDur = {expected_duration_sec};
                        let durDiff = expectedDur > 0 && candDur > 0 ? Math.abs(candDur - expectedDur) : 0;
                        let remCandidatesJson = sessionStorage.getItem('chord_candidates');
                        let remCandidates = remCandidatesJson ? JSON.parse(remCandidatesJson) : [];

                        if (expectedDur > 0 && durDiff > 5 && remCandidates.length > 0) {{
                            let nextCandidateUrl = remCandidates.shift();
                            sessionStorage.setItem('chord_candidates', JSON.stringify(remCandidates));
                            console.log('[NadaNada] Duration difference is large (' + durDiff.toFixed(1) + 's). Trying next candidate:', nextCandidateUrl);
                            window.location.replace(nextCandidateUrl);
                            return;
                        }}

                        let result = {{
                            success: true,
                            data: {{
                                bpm: bpm,
                                chords: chords,
                                chordify_video_id: chordifyVideoId,
                                chordify_title: chordifyTitle,
                                chordify_channel: chordifyChannel,
                                chordify_duration: chordifyDuration,
                                chordify_thumbnail: chordifyThumbnail
                            }},
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

        // Also cache under chordify_video_id so when the user adds it to their playlist
        // and plays it, it is an instant cache hit and NEVER re-scrapes or mismatches!
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&current_result) {
            if let Some(vid) = val.get("data").and_then(|d| d.get("chordify_video_id")).and_then(|v| v.as_str()) {
                if !vid.is_empty() && vid != safe_id {
                    let second_cache_file = cache_dir.join(format!("{}.json", vid));
                    let _ = std::fs::write(&second_cache_file, &current_result);
                }
            }
        }
    }

    Ok(current_result)
}
