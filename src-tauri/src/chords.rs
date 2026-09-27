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
            let mut is_valid_cache = true;
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(chords) = val.get("data").and_then(|d| d.get("chords")).and_then(|c| c.as_array()) {
                    if let Some(last_chord) = chords.last() {
                        let last_time = last_chord.get("time_sec").and_then(|t| t.as_f64()).unwrap_or(0.0);
                        let chordify_dur = val.get("data")
                            .and_then(|d| d.get("chordify_duration"))
                            .and_then(|d| d.as_str())
                            .map(|s| {
                                let parts: Vec<&str> = s.split(':').collect();
                                if parts.len() == 2 {
                                    parts[0].parse::<f64>().unwrap_or(0.0) * 60.0 + parts[1].parse::<f64>().unwrap_or(0.0)
                                } else { 0.0 }
                            })
                            .unwrap_or(0.0);
                        let target_dur = if expected_duration_sec > 0 { expected_duration_sec as f64 } else { chordify_dur };
                        if target_dur > 60.0 && last_time < (target_dur * 0.55) {
                            println!("[Cache] Incomplete cached chords detected for {} (last chord at {:.1}s, target: {:.1}s) – invalidating cache", safe_id, last_time, target_dur);
                            is_valid_cache = false;
                        }
                    }
                }
            }
            if is_valid_cache {
                return Ok(content);
            } else {
                let _ = std::fs::remove_file(&cache_file);
            }
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
    let title_words_json = serde_json::to_string(&words).unwrap_or_else(|_| "[]".to_string());

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
                    let titleWords = {title_words_json}.map(w => w.toLowerCase());

                    for (let a of allLinks) {{
                        let h = a.href || "";
                        let raw = a.outerHTML || "";
                        if (!raw.includes("translate") && !raw.includes("webcache") && !raw.includes("policies")) {{
                            let match = h.match(/(https?%3A%2F%2Fchordify\.net%2Fchords%2F[^&]+)/i);
                            let cleanUrl = match ? decodeURIComponent(match[1]) : h;
                            cleanUrl = cleanUrl.split('/RK=')[0].split('/RS=')[0].split('?')[0];

                            // Skip artist discography listing pages (e.g., /chords/pitbull-songs)
                            let path = cleanUrl.replace(/^https?:\/\/[^\/]+/, '');
                            if (/\/chords\/[^\/]+-songs\/?$/i.test(path)) {{
                                continue;
                            }}

                            if (cleanUrl.includes("chordify.net/chords/") && !seen.has(cleanUrl)) {{
                                seen.add(cleanUrl);
                                let linkText = ((a.innerText || "") + " " + cleanUrl).toLowerCase();
                                let isAcoustic = linkText.includes("acoustic");
                                let isLive = linkText.includes("live");
                                let isCover = linkText.includes("cover");
                                let isEasy = linkText.includes("easy");

                                let penalty = 0;
                                if (isAcoustic) penalty += 10;
                                if (isLive) penalty += 8;
                                if (isCover) penalty += 8;
                                if (isEasy) penalty += 4;

                                if (cleanUrl.endsWith("-chords") || cleanUrl.includes("-chords")) {{
                                    penalty -= 10;
                                }}

                                let matchCount = 0;
                                for (let tw of titleWords) {{
                                    if (tw.length >= 3 && linkText.includes(tw)) {{
                                        matchCount++;
                                    }}
                                }}
                                penalty -= (matchCount * 5);

                                candidates.push({{
                                    url: cleanUrl,
                                    penalty: penalty
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
                        try {{ sessionStorage.setItem('chord_candidates', JSON.stringify(candidateUrls)); }} catch(e) {{}}
                        let targetWithHash = candidateUrls.length > 0
                            ? target + '#candidates=' + encodeURIComponent(JSON.stringify(candidateUrls))
                            : target;
                        window.location.replace(targetWithHash);
                        return;
                    }} else if (googleAttempts > 20) {{ // Timeout after 10 seconds
                        clearInterval(checkGoogle);
                        let err = encodeURIComponent(JSON.stringify({{success: false, error: "Chords not found on Chordify.", data: null}}));
                        window.location.replace("https://chordify.net/?scraper_result=" + err);
                        return;
                    }}
                }}, 500);
                return;
            }}

            // ── FALLBACK HANDLER (YAHOO) ─────────────────────────────────────────
            if (window.location.hostname.includes("yahoo.")) {{
                let searchAttempts = 0;
                let checkSearch = setInterval(() => {{
                    searchAttempts++;
                    let allLinks = Array.from(document.querySelectorAll('a[href]')).filter(a => {{
                        let h = (a.href || '').toLowerCase();
                        return h.includes('chordify.net/chords/') || h.includes('chordify.net%2fchords%2f');
                    }});
                    if (allLinks.length > 0) {{
                        let candidates = [];
                        let seen = new Set();
                        let titleWords = {title_words_json}.map(w => w.toLowerCase());

                        for (let a of allLinks) {{
                            let href = a.href || '';
                            let match = href.match(/(https?%3A%2F%2Fchordify\.net%2Fchords%2F[^&]+)/i);
                            let cleanUrl = match ? decodeURIComponent(match[1]) : href;
                            cleanUrl = cleanUrl.split('/RK=')[0].split('/RS=')[0].split('?')[0];

                            // Skip artist discography listing pages (e.g., /chords/pitbull-songs)
                            let path = cleanUrl.replace(/^https?:\/\/[^\/]+/, '');
                            if (/\/chords\/[^\/]+-songs\/?$/i.test(path)) {{
                                continue;
                            }}

                            if (cleanUrl.includes('chordify.net/chords/') && !seen.has(cleanUrl)) {{
                                seen.add(cleanUrl);
                                let linkText = ((a.innerText || '') + ' ' + cleanUrl).toLowerCase();
                                let isAcoustic = linkText.includes('acoustic');
                                let isLive = linkText.includes('live');
                                let isCover = linkText.includes('cover');
                                let isEasy = linkText.includes('easy');

                                let penalty = 0;
                                if (isAcoustic) penalty += 10;
                                if (isLive) penalty += 8;
                                if (isCover) penalty += 8;
                                if (isEasy) penalty += 4;

                                if (cleanUrl.endsWith("-chords") || cleanUrl.includes("-chords")) {{
                                    penalty -= 10;
                                }}

                                let matchCount = 0;
                                for (let tw of titleWords) {{
                                    if (tw.length >= 3 && linkText.includes(tw)) {{
                                        matchCount++;
                                    }}
                                }}
                                penalty -= (matchCount * 5);

                                candidates.push({{
                                    url: cleanUrl,
                                    penalty: penalty
                                }});
                            }}
                        }}
                        candidates.sort((a, b) => a.penalty - b.penalty);
                        if (candidates.length > 0) {{
                            clearInterval(checkSearch);
                            let candidateUrls = candidates.map(c => c.url);
                            let target = candidateUrls.shift();
                            try {{ sessionStorage.setItem('chord_candidates', JSON.stringify(candidateUrls)); }} catch(e) {{}}
                            let targetWithHash = candidateUrls.length > 0
                                ? target + '#candidates=' + encodeURIComponent(JSON.stringify(candidateUrls))
                                : target;
                            window.location.replace(targetWithHash);
                            return;
                        }}
                    }}
                    
                    if (searchAttempts > 20) {{ // Timeout after 10 seconds
                        clearInterval(checkSearch);
                        window.location.replace("https://chordify.net/?scraper_result=GOOGLE_FALLBACK");
                    }}
                }}, 500);
                return;
            }}

            function rustLog(msg) {{
                try {{
                    let ifr = document.createElement('iframe');
                    ifr.style.display = 'none';
                    ifr.src = "https://chordify.net/?scraper_log=" + encodeURIComponent(msg);
                    document.documentElement.appendChild(ifr);
                    setTimeout(() => ifr.remove(), 500);
                }} catch(e) {{}}
            }}

            if (!window.location.hostname.includes("chordify.net")) return;

            function getRemainingCandidates() {{
                let rem = [];
                if (window.location.hash.includes('candidates=')) {{
                    try {{
                        let raw = decodeURIComponent(window.location.hash.split('candidates=')[1].split('&')[0]);
                        rem = JSON.parse(raw);
                    }} catch(e) {{}}
                }}
                if (!rem || rem.length === 0) {{
                    try {{
                        let s = sessionStorage.getItem('chord_candidates');
                        if (s) rem = JSON.parse(s);
                    }} catch(e) {{}}
                }}
                return Array.isArray(rem) ? rem : [];
            }}

            function tryNextCandidate(reason) {{
                let rem = getRemainingCandidates();
                if (rem.length > 0) {{
                    let nextCandidateUrl = rem.shift();
                    let nextWithHash = rem.length > 0
                        ? nextCandidateUrl + '#candidates=' + encodeURIComponent(JSON.stringify(rem))
                        : nextCandidateUrl;
                    try {{ sessionStorage.setItem('chord_candidates', JSON.stringify(rem)); }} catch(e) {{}}
                    console.log('[NadaNada] ' + (reason || 'Advancing') + ', trying next candidate:', nextCandidateUrl);
                    window.location.replace(nextWithHash);
                    return true;
                }}
                return false;
            }}

            // Stealth overrides to pass Cloudflare / Turnstile bot detection
            try {{
                delete Object.getPrototypeOf(navigator).webdriver;
            }} catch(e) {{
                try {{
                    Object.defineProperty(navigator, 'webdriver', {{ get: () => undefined }});
                }} catch(e2) {{}}
            }}
            try {{
                if (!window.chrome) window.chrome = {{}};
                if (!window.chrome.runtime) window.chrome.runtime = {{}};
            }} catch(e) {{}}
            try {{
                if (!navigator.languages || navigator.languages.length === 0) {{
                    Object.defineProperty(navigator, 'languages', {{ get: () => ['en-US', 'en'] }});
                }}
            }} catch(e) {{}}
            
            let attempts = 0;
            let prevChordCount = 0;
            let stableChordAttempts = 0;
            let checkInterval = setInterval(() => {{
                attempts++;
                
                // ── ARTIST DISCOGRAPHY / SETLIST PAGE DETECTOR ───────────────────
                // If we land on an artist collection page (e.g. /chords/pitbull-songs), advance to next candidate immediately!
                let currentPath = window.location.pathname;
                if (/\/chords\/[^\/]+-songs\/?$/i.test(currentPath)) {{
                    clearInterval(checkInterval);
                    if (tryNextCandidate('On artist collection page')) return;
                    let err = encodeURIComponent(JSON.stringify({{success: false, error: "Chords not found on Chordify.", data: null}}));
                    window.location.replace("https://chordify.net/?scraper_result=" + err);
                    return;
                }}

                // ── CLOUDFLARE CHALLENGE DETECTION ─────────────────────────────────
                let isCloudflare = false;
                try {{
                    let title = (document.title || '').toLowerCase();
                    if (title.includes("just a moment") || title.includes("attention required") || title.includes("cloudflare")) {{
                        isCloudflare = true;
                    }}
                    if (document.querySelector('#challenge-running, #challenge-stage, .cf-turnstile, #cf-wrapper')) {{
                        isCloudflare = true;
                    }}
                }} catch(e) {{}}

                if (isCloudflare) {{
                    // Give Cloudflare Turnstile up to 8 checks (4s) to automatically solve itself
                    if (attempts > 8) {{
                        clearInterval(checkInterval);
                        console.log('[NadaNada] Cloudflare challenge detected and unsolved – signalling fallback');
                        let fallbackSig = window.location.hostname.includes("yahoo") ? "GOOGLE_FALLBACK" : "YAHOO_FALLBACK";
                        window.location.replace("https://chordify.net/?scraper_result=" + fallbackSig);
                        return;
                    }}
                    return;
                }}

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
                
                if (attempts > 50) {{
                    clearInterval(checkInterval);
                    if (tryNextCandidate('Timeout waiting for chords')) return;
                    let err = encodeURIComponent(JSON.stringify({{
                        success: false, 
                        error: "Chords not found on Chordify.", 
                        data: null
                    }}));
                    window.location.replace("https://chordify.net/?scraper_result=" + err);
                    return;
                }}
                
                if (document.body && document.body.textContent && (document.body.textContent.includes("Ribbit! Nothing here") || document.querySelectorAll('img[src*="404"]').length > 0)) {{
                    clearInterval(checkInterval);
                    if (tryNextCandidate('404 on current candidate')) return;
                    let err = encodeURIComponent(JSON.stringify({{success: false, error: "Song not found on Chordify.", data: null}}));
                    window.location.replace("https://chordify.net/?scraper_result=" + err);
                    return;
                }}
                
                // ── CHORDIFY SEARCH RESULTS PAGE ─────────────────────────────────
                if (window.location.pathname.startsWith('/search/')) {{
                    let chordLinks = Array.from(document.querySelectorAll('a[href^="/chords/"]'));
                    let allLinks = document.querySelectorAll('a[href^="/search/"]');
                    if (chordLinks.length > 0) {{
                        let candidates = [];
                        let seen = new Set();
                        let titleWords = {title_words_json}.map(w => w.toLowerCase());

                        for (let a of chordLinks) {{
                            let cleanUrl = a.href || '';
                            let path = cleanUrl.replace(/^https?:\/\/[^\/]+/, '');
                            if (/\/chords\/[^\/]+-songs\/?$/i.test(path)) {{
                                continue;
                            }}

                            if (cleanUrl.includes('/chords/') && !seen.has(cleanUrl)) {{
                                seen.add(cleanUrl);
                                let linkText = ((a.innerText || '') + ' ' + cleanUrl).toLowerCase();
                                let isAcoustic = linkText.includes('acoustic');
                                let isLive = linkText.includes('live');
                                let isCover = linkText.includes('cover');
                                let isEasy = linkText.includes('easy');

                                let penalty = 0;
                                if (isAcoustic) penalty += 10;
                                if (isLive) penalty += 8;
                                if (isCover) penalty += 8;
                                if (isEasy) penalty += 4;

                                if (cleanUrl.endsWith("-chords") || cleanUrl.includes("-chords")) {{
                                    penalty -= 10;
                                }}

                                let matchCount = 0;
                                for (let tw of titleWords) {{
                                    if (tw.length >= 3 && linkText.includes(tw)) {{
                                        matchCount++;
                                    }}
                                }}
                                penalty -= (matchCount * 5);

                                candidates.push({{
                                    url: cleanUrl,
                                    penalty: penalty
                                }});
                            }}
                        }}
                        candidates.sort((a, b) => a.penalty - b.penalty);
                        if (candidates.length > 0) {{
                            clearInterval(checkInterval);
                            let candidateUrls = candidates.map(c => c.url);
                            let target = candidateUrls.shift();
                            try {{ sessionStorage.setItem('chord_candidates', JSON.stringify(candidateUrls)); }} catch(e) {{}}
                            let targetWithHash = candidateUrls.length > 0
                                ? target + '#candidates=' + encodeURIComponent(JSON.stringify(candidateUrls))
                                : target;
                            // Add human delay before clicking to avoid bot detection
                            setTimeout(() => {{
                                window.location.href = targetWithHash;
                            }}, 1500 + Math.random() * 1500);
                            return;
                        }}
                    }}
                    if (document.body.textContent.includes("No results found")) {{
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
                    // Click "Chords grid" tab ONCE if present to ensure sheet grid is rendered
                    if (!window._didClickGrid) {{
                        try {{
                            let gridTab = Array.from(document.querySelectorAll('button, [role="tab"], div, a')).find(el => {{
                                let t = (el.textContent || '').trim().toLowerCase();
                                return t === 'chords grid' || t === 'chord grid';
                            }});
                            if (gridTab) {{
                                window._didClickGrid = true;
                                gridTab.click();
                            }}
                        }} catch(e) {{}}
                    }}

                    // Click "Show more" button ONCE if sidebar details are collapsed
                    if (!window._didClickShowMore) {{
                        try {{
                            let showMoreBtn = Array.from(document.querySelectorAll('button, a, span')).find(el => {{
                                let t = (el.textContent || '').trim().toLowerCase();
                                return t.includes('show more');
                            }});
                            if (showMoreBtn) {{
                                window._didClickShowMore = true;
                                showMoreBtn.click();
                            }}
                        }} catch(e) {{}}
                    }}

                    let chordElements = document.querySelectorAll('.chord[data-i], [data-i].chord, [data-i][class*="chord"]');
                    if (chordElements.length === 0) {{
                        chordElements = document.querySelectorAll('[data-i]');
                    }}
                    let currentChordCount = chordElements.length;
                    
                    let bpm = 0;
                    // Check script tags for BPM first
                    try {{
                        let scripts = document.querySelectorAll('script:not([src])');
                        for (let s of scripts) {{
                            let m = s.textContent.match(/["'](?:bpm|tempo)["']\s*[:=]\s*(\d{{2,3}}(?:\.\d+)?)/i);
                            if (m) {{
                                bpm = parseFloat(m[1]);
                                break;
                            }}
                        }}
                    }} catch(e) {{}}
                    if (!bpm) {{
                        let scrollEl = document.querySelector('[data-bpm]');
                        if (scrollEl) {{
                            bpm = parseFloat(scrollEl.getAttribute('data-bpm')) || 0;
                        }}
                    }}
                    if (!bpm) {{
                        let bpmMatch = document.body.textContent.match(/BPM\s*[:\-]?\s*(\d{{2,3}}(?:\.\d+)?)/i);
                        if (bpmMatch) {{
                            bpm = parseFloat(bpmMatch[1]) || 0;
                        }}
                    }}
                    if (!bpm && attempts > 8) {{
                        bpm = 120;
                    }}
                    let effectiveBpm = bpm > 0 ? bpm : 120;
                    let secondsPerBeat = 60.0 / effectiveBpm;

                    // Only scroll once or twice at beginning to trigger lazy grid render
                    if (attempts <= 2) {{
                        let scrollEl = document.querySelector('[data-bpm], [class*="sheet"], [class*="grid"]');
                        if (scrollEl) {{
                            scrollEl.scrollTop = scrollEl.scrollHeight;
                            scrollEl.dispatchEvent(new Event('scroll'));
                        }}
                        window.scrollTo(0, document.body.scrollHeight);
                    }}

                    let expectedDur = {expected_duration_sec};

                    // Extract duration from page if available to know expected song length
                    let pageDurSec = 0;
                    let metaDur = document.querySelector('meta[itemprop="duration"]');
                    if (metaDur && metaDur.content) {{
                        let m = metaDur.content.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
                        if (m) {{
                            pageDurSec = (parseInt(m[1] || '0') * 60) + parseInt(m[2] || '0');
                        }}
                    }}
                    let targetDur = expectedDur > 0 ? expectedDur : pageDurSec;

                    // Calculate highest beat currently present in the DOM
                    let maxBeatInDom = 0;
                    for (let el of chordElements) {{
                        let b = parseInt(el.getAttribute('data-i') || '0');
                        if (b > maxBeatInDom) maxBeatInDom = b;
                    }}
                    let currentCoveredSec = maxBeatInDom * secondsPerBeat;

                    let isLikelyIncomplete = targetDur > 60 && currentCoveredSec < (targetDur * 0.55);

                    // If the sheet appears incomplete and we haven't timed out, keep scrolling to load all chords
                    if (isLikelyIncomplete && attempts < 25) {{
                        let scrollEl = document.querySelector('[data-bpm], [class*="sheet"], [class*="grid"]');
                        if (scrollEl) {{
                            scrollEl.scrollTop = scrollEl.scrollHeight;
                            scrollEl.dispatchEvent(new Event('scroll'));
                        }}
                        window.scrollTo(0, document.body.scrollHeight);
                        stableChordAttempts = 0;
                        return;
                    }}

                    // Wait for both chords AND BPM to load and stabilize in DOM
                    if (currentChordCount >= 10) {{
                        let diff = Math.abs(currentChordCount - prevChordCount);
                        if (diff <= 3) {{
                            stableChordAttempts++;
                        }} else {{
                            stableChordAttempts = 0;
                            prevChordCount = currentChordCount;
                        }}

                        if (stableChordAttempts < 2 && attempts < 15) {{
                            return;
                        }}

                        if (!bpm && attempts < 8) {{
                            return; // Wait a brief moment for the sidebar or script tags to populate
                        }}
                        
                        clearInterval(checkInterval);
                        
                        let chords = [];
                        let finalBpm = bpm > 0 ? bpm : 120;
                        let finalSecondsPerBeat = 60.0 / finalBpm;
                        
                        let seenBeats = new Set();
                        for (let el of chordElements) {{
                            if (!el.hasAttribute('data-i')) continue;
                            
                            let beatIdx = parseInt(el.getAttribute('data-i'));
                            if (isNaN(beatIdx) || seenBeats.has(beatIdx)) continue;
                            
                            let chordText = '';
                            let labelEl = el.querySelector('.chord, .chord-label, [class*="label"], [class*="chord"]');
                            if (labelEl && labelEl.innerText && labelEl.innerText.trim()) {{
                                chordText = labelEl.innerText.trim();
                            }} else if (el.innerText && el.innerText.trim()) {{
                                chordText = el.innerText.trim();
                            }}
                            if (chordText.includes('\n')) {{
                                chordText = chordText.split('\n')[0].trim();
                            }}
                            
                            // Normalize Unicode music symbols to standard notation
                            chordText = chordText
                                .replace(/♭/g, 'b')
                                .replace(/♯/g, '#')
                                .replace(/ᵐᵃʲ/g, 'maj')
                                .replace(/ₘ/g, 'm')
                                .replace(/⁷/g, '7')
                                .replace(/⁹/g, '9')
                                .replace(/⁴/g, '4')
                                .replace(/⁵/g, '5')
                                .replace(/⁶/g, '6')
                                .replace(/²/g, '2');

                            if (chordText && chordText !== '' && !el.classList.contains('nolabel') && /^[A-G]/i.test(chordText)) {{
                                chords.push({{
                                    beat: beatIdx + 1,
                                    time_sec: beatIdx * finalSecondsPerBeat,
                                    chord: chordText
                                }});
                                seenBeats.add(beatIdx);
                            }}
                        }}
                        
                        chords.sort((a, b) => a.time_sec - b.time_sec);
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
                            let txt = h1.innerText.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
                            let byMatch = txt.match(/^(.+?)\s+Chords?\s*(?:(?:&|and)?\s*lyrics)?\s+by\s+(.+)$/i);
                            if (byMatch) {{
                                chordifyTitle = byMatch[1].trim();
                                chordifyChannel = byMatch[2].trim();
                            }} else {{
                                chordifyTitle = txt;
                            }}
                        }}
                        if (!chordifyTitle && document.title) {{
                            let txt = document.title.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
                            let byMatch = txt.match(/^(.+?)\s+Chords?\s*(?:(?:&|and)?\s*lyrics)?\s+by\s+(.+?)(?:\s*[-|].*)?$/i);
                            if (byMatch) {{
                                chordifyTitle = byMatch[1].trim();
                                chordifyChannel = byMatch[2].trim();
                            }} else {{
                                chordifyTitle = txt.replace(/\s*[-|]\s*Chordify.*$/i, '').trim();
                            }}
                        }}

                        // Extract duration accurately with sanity check against lastChordTime
                        let lastChordTime = chords.length > 0 ? chords[chords.length - 1].time_sec : 0;
                        let chordifyDurSec = 0;

                        // 1. Try JSON-LD schema scripts
                        try {{
                            let ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                            for (let s of ldScripts) {{
                                let json = JSON.parse(s.textContent || '{{}}');
                                let d = json.duration || (json.video && json.video.duration) || (json.audio && json.audio.duration);
                                if (d && typeof d === 'string') {{
                                    let m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                                    if (m) {{
                                        let hours = parseInt(m[1] || '0');
                                        let mins = parseInt(m[2] || '0');
                                        let secs = parseInt(m[3] || '0');
                                        let totalSec = hours * 3600 + mins * 60 + secs;
                                        if (totalSec >= lastChordTime - 5) {{
                                            let totM = Math.floor(totalSec / 60);
                                            let totS = totalSec % 60;
                                            chordifyDuration = (totM < 10 ? '0' : '') + totM + ':' + (totS < 10 ? '0' : '') + totS;
                                            chordifyDurSec = totalSec;
                                            break;
                                        }}
                                    }}
                                }}
                            }}
                        }} catch(e) {{}}

                        // 2. Try meta itemprop="duration"
                        if (!chordifyDuration) {{
                            let metaDur = document.querySelector('meta[itemprop="duration"]');
                            if (metaDur && metaDur.content) {{
                                let m = metaDur.content.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                                if (m) {{
                                    let hours = parseInt(m[1] || '0');
                                    let mins = parseInt(m[2] || '0');
                                    let secs = parseInt(m[3] || '0');
                                    let totalSec = hours * 3600 + mins * 60 + secs;
                                    if (totalSec >= lastChordTime - 5) {{
                                        let totM = Math.floor(totalSec / 60);
                                        let totS = totalSec % 60;
                                        chordifyDuration = (totM < 10 ? '0' : '') + totM + ':' + (totS < 10 ? '0' : '') + totS;
                                        chordifyDurSec = totalSec;
                                    }}
                                }}
                            }}
                        }}

                        // 3. Try player-specific time elements
                        if (!chordifyDuration) {{
                            let playerTimeEls = Array.from(document.querySelectorAll('[class*="player"] [class*="time"], [class*="controls"] [class*="time"], [data-testid*="duration"], [class*="total-time"]')).filter(el => {{
                                let txt = (el.innerText || '').trim();
                                return /^\d{{1,2}}:\d{{2}}$/.test(txt) && txt !== '00:00' && txt !== '0:00';
                            }});
                            for (let el of playerTimeEls) {{
                                let txt = el.innerText.trim();
                                let dp = txt.split(':').map(Number);
                                let secVal = dp[0] * 60 + dp[1];
                                if (secVal >= lastChordTime - 5) {{
                                    chordifyDuration = txt;
                                    chordifyDurSec = secVal;
                                    break;
                                }}
                            }}
                        }}

                        // 4. Fallback: if no valid duration found or duration < lastChordTime - 5,
                        // derive it intelligently from targetDur or lastChordTime
                        if (!chordifyDuration || chordifyDurSec < lastChordTime - 5) {{
                            if (targetDur > 0 && Math.abs(targetDur - lastChordTime) <= 15) {{
                                let m = Math.floor(targetDur / 60);
                                let s = Math.floor(targetDur % 60);
                                chordifyDuration = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
                                chordifyDurSec = targetDur;
                            }} else if (lastChordTime > 0) {{
                                let estSec = Math.round(lastChordTime + 5);
                                let m = Math.floor(estSec / 60);
                                let s = estSec % 60;
                                chordifyDuration = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
                                chordifyDurSec = estSec;
                            }}
                        }}

                        let chordifyThumbnail = chordifyVideoId ? ('https://i.ytimg.com/vi/' + chordifyVideoId + '/hqdefault.jpg') : null;

                        // Check if extracted chords are incomplete (< 55% of song duration)
                        let finalTargetDur = targetDur > 0 ? targetDur : chordifyDurSec;
                        let isIncomplete = finalTargetDur > 60 && lastChordTime < (finalTargetDur * 0.55);

                        // Switch to next candidate if chords failed to extract (< 5 chords) OR if transcription is cut short
                        if (chords.length < 5 || isIncomplete) {{
                            if (tryNextCandidate('Candidate rejected (too few chords or incomplete: ' + lastChordTime.toFixed(1) + 's of ' + finalTargetDur + 's)')) {{
                                return;
                            }}
                        }}

                        let result = {{
                            success: true,
                            data: {{
                                bpm: finalBpm,
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
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
    .initialization_script(&js_code)
    .on_navigation(move |url| {
        println!("Navigating to: {}", url.as_str());

        if url.path().starts_with("/user/signup") || url.path().starts_with("/user/signin") {
            println!("[Rust on_navigation] Redirect to signup ({}) – triggering Yahoo fallback immediately", url.path());
            if let Ok(mut guard) = tx_mutex_clone.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send("YAHOO_FALLBACK".to_string());
                }
            }
            return false;
        }

        let mut got_result = false;
        let mut json_str = String::new();

        for (key, value) in url.query_pairs() {
            if key == "scraper_log" {
                println!("[Scraper JS Log] {}", value);
                return false;
            }
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
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .initialization_script(&js_code)
        .on_navigation(move |url| {
            println!("[Yahoo fallback] Navigating to: {}", url.as_str());
            let mut got_result = false;
            let mut json_str = String::new();
            for (key, value) in url.query_pairs() {
                if key == "scraper_log" {
                    println!("[Yahoo Scraper JS Log] {}", value);
                    return false;
                }
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
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
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
        let mut should_cache = true;
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&current_result) {
            if let Some(chords) = val.get("data").and_then(|d| d.get("chords")).and_then(|c| c.as_array()) {
                if let Some(last_chord) = chords.last() {
                    let last_time = last_chord.get("time_sec").and_then(|t| t.as_f64()).unwrap_or(0.0);
                    let chordify_dur = val.get("data")
                        .and_then(|d| d.get("chordify_duration"))
                        .and_then(|d| d.as_str())
                        .map(|s| {
                            let parts: Vec<&str> = s.split(':').collect();
                            if parts.len() == 2 {
                                parts[0].parse::<f64>().unwrap_or(0.0) * 60.0 + parts[1].parse::<f64>().unwrap_or(0.0)
                            } else { 0.0 }
                        })
                        .unwrap_or(0.0);
                    let target_dur = if expected_duration_sec > 0 { expected_duration_sec as f64 } else { chordify_dur };
                    if target_dur > 60.0 && last_time < (target_dur * 0.55) {
                        println!("[Cache] Not saving incomplete chords for {} (last chord at {:.1}s, target: {:.1}s)", safe_id, last_time, target_dur);
                        should_cache = false;
                    }
                }
            }
        }

        if should_cache {
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
    }

    Ok(current_result)
}
