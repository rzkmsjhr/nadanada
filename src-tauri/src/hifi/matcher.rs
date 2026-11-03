use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    static ref FEAT_REGEX: Regex = Regex::new(r"(?i)\b(feat|featuring|ft)\.?\s+.*$").unwrap();
    static ref BRACKETS_REGEX: Regex = Regex::new(r"[\(\[\{【〔〈《「『].*?[\)\]\}】〕〉》」』]").unwrap();
    static ref NON_ALPHANUM_REGEX: Regex = Regex::new(r"[^\p{L}\p{N}\p{M}]").unwrap();
    static ref MULTI_SPACE_REGEX: Regex = Regex::new(r"\s+").unwrap();
    static ref ARTIST_SPLIT_REGEX: Regex = Regex::new(r"(?i)[,&/;|]|(?:\s+(?:feat\.?|ft\.?|featuring|with|x|and)\s+)").unwrap();
    static ref YOUTUBE_NOISE_REGEX: Regex = Regex::new(r"(?i)\b(official\s*(?:music\s*)?video|official\s*audio|official\s*visualizer|lyrics?\s*(?:video)?|music\s*video|audio|visualizer|hd|hq|4k|1080p|720p|topic|clip\s*officiel|video\s*oficial|mv)\b").unwrap();
    static ref REMIX_REGEX: Regex = Regex::new(r"(?i)\b(remix|remixes|club\s*mix|extended\s*mix|vip\s*mix|dub\s*mix)\b").unwrap();
    static ref LIVE_REGEX: Regex = Regex::new(r"(?i)\b(live\s*at|live\s*version|in\s*concert)\b|[\(\[\{]\s*live\s*[\)\]\}]|\s+-\s+live\b|(现场|演唱会|秀场音乐|秀场)").unwrap();
    static ref ACOUSTIC_REGEX: Regex = Regex::new(r"(?i)\b(acoustic|unplugged)\b").unwrap();
    static ref INSTRUMENTAL_REGEX: Regex = Regex::new(r"(?i)\b(instrumental|karaoke)\b|(伴奏|原版伴奏)").unwrap();
}

/// Normalizes string for fuzzy title/artist matching across all languages (Unicode-aware).
pub fn clean_string(str: &str) -> String {
    let lower = str.to_lowercase();
    let without_feat = FEAT_REGEX.replace_all(&lower, "");
    let without_brackets = BRACKETS_REGEX.replace_all(&without_feat, "");
    let normalized = if crate::hifi::script::contains_arabic(&without_brackets) {
        crate::hifi::script::normalize_arabic(&without_brackets)
    } else if crate::hifi::script::contains_thai(&without_brackets) {
        crate::hifi::script::normalize_thai(&without_brackets)
    } else {
        without_brackets.to_string()
    };
    let alnum_only = NON_ALPHANUM_REGEX.replace_all(&normalized, "");
    alnum_only.trim().to_string()
}

/// Normalizes diacritics and symbols for comparable title matching while preserving musical version indicators.
pub fn normalize_comparable_title(raw_title: &str) -> String {
    let lower = raw_title.to_lowercase();
    let without_noise = YOUTUBE_NOISE_REGEX.replace_all(&lower, " ");
    let normalized = if crate::hifi::script::contains_arabic(&without_noise) {
        crate::hifi::script::normalize_arabic(&without_noise)
    } else if crate::hifi::script::contains_thai(&without_noise) {
        crate::hifi::script::normalize_thai(&without_noise)
    } else {
        without_noise.to_string()
    };
    let alnum_only = NON_ALPHANUM_REGEX.replace_all(&normalized, "");
    alnum_only.trim().to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionFlags {
    pub is_acoustic: bool,
    pub is_live: bool,
    pub is_remix: bool,
    pub is_instrumental: bool,
    pub is_piano: bool,
    pub is_orchestral: bool,
}

pub fn extract_version_flags(title: &str, album: Option<&str>) -> VersionFlags {
    let s = format!("{} {}", title, album.unwrap_or(""));
    let s_lower = s.to_lowercase();
    VersionFlags {
        is_acoustic: ACOUSTIC_REGEX.is_match(&s),
        is_live: LIVE_REGEX.is_match(&s),
        is_remix: REMIX_REGEX.is_match(&s),
        is_instrumental: INSTRUMENTAL_REGEX.is_match(&s),
        is_piano: s_lower.contains("piano version") || s_lower.contains("(piano)") || s_lower.contains("[piano]"),
        is_orchestral: s_lower.contains("orchestral version") || s_lower.contains("(orchestral)") || s_lower.contains("[orchestral]"),
    }
}

pub fn has_version_conflict(a: &VersionFlags, b: &VersionFlags) -> bool {
    a.is_acoustic != b.is_acoustic
        || a.is_live != b.is_live
        || a.is_remix != b.is_remix
        || a.is_instrumental != b.is_instrumental
        || a.is_piano != b.is_piano
        || a.is_orchestral != b.is_orchestral
}

fn normalize_artist_token(s: &str) -> String {
    let lower = s.to_lowercase();
    let no_topic = lower.replace("- topic", "").replace("topic", "");
    let no_vevo = no_topic.replace("vevo", "");
    let alnum = NON_ALPHANUM_REGEX.replace_all(&no_vevo, " ");
    let single_spaced = MULTI_SPACE_REGEX.replace_all(&alnum, " ");
    single_spaced.trim().to_string()
}

pub fn split_artist_list(s: &str) -> Vec<String> {
    if s.trim().is_empty() {
        return Vec::new();
    }
    let mut parts: Vec<String> = ARTIST_SPLIT_REGEX
        .split(s)
        .map(normalize_artist_token)
        .filter(|t| !t.is_empty())
        .collect();

    let full = normalize_artist_token(s);
    if !full.is_empty() && !parts.contains(&full) {
        parts.push(full);
    }
    parts
}

/// Checks if target artist and candidate artist match across languages and scripts.
pub fn does_artist_match(target_artist: &str, candidate_artist: &str, target_title: &str) -> bool {
    let target_list = split_artist_list(target_artist);
    let cand_list = split_artist_list(candidate_artist);

    // 1. Cross-script bidirectional alias check (Japanese, Korean, Arabic, Thai, Chinese)
    let target_aliases = crate::hifi::script::get_artist_cross_script_aliases(target_artist);
    let cand_aliases = crate::hifi::script::get_artist_cross_script_aliases(candidate_artist);

    for c in &cand_list {
        if target_aliases.iter().any(|&a| clean_string(a) == clean_string(c)) {
            return true;
        }
    }
    for t in &target_list {
        if cand_aliases.iter().any(|&a| clean_string(a) == clean_string(t)) {
            return true;
        }
    }

    // 2. Check if target title contains candidate artist or vice versa (common in YouTube fan uploads)
    let lower_title = target_title.to_lowercase();
    for a in &cand_aliases {
        if lower_title.contains(&a.to_lowercase()) {
            return true;
        }
    }
    for c in &cand_list {
        if !c.is_empty() && lower_title.contains(&c.to_lowercase()) {
            return true;
        }
    }

    if target_list.is_empty() || cand_list.is_empty() {
        return false;
    }

    let mut has_primary_match = false;
    for t in &target_list {
        let t_compact = t.replace(' ', "");
        let t_no_the = t.strip_prefix("the ").unwrap_or(t).trim();

        for c in &cand_list {
            if t == c {
                has_primary_match = true;
                break;
            }
            let c_compact = c.replace(' ', "");
            if t_compact.len() >= 2 && t_compact == c_compact {
                has_primary_match = true;
                break;
            }
            let c_no_the = c.strip_prefix("the ").unwrap_or(c).trim();
            if t_no_the.len() >= 3 && t_no_the == c_no_the {
                has_primary_match = true;
                break;
            }
        }
        if has_primary_match {
            break;
        }
    }

    if !has_primary_match {
        return false;
    }

    // If candidate artist explicitly specifies "feat." or "ft.", reject if target did not request it
    let lower_target = format!("{} {}", target_artist, target_title).to_lowercase();
    let lower_cand = candidate_artist.to_lowercase();
    if (lower_cand.contains("feat") || lower_cand.contains("ft.")) && !lower_target.contains("feat") && !lower_target.contains("ft.") {
        return false;
    }

    true
}

/// Known upstream catalog IDs where original master was replaced with a modern remake or mislabeled audio
pub fn is_known_upstream_mismatch(id: &str, title: &str, _artist: &str) -> bool {
    let mismatches = [
        "168395054749057024", // Dewa 19 - Aku Milikmu (2021 Virzha)
        "168589766881927168", // Dewa 19 feat. Virzha - Aku Milikmu
        "168395069831774208", // Dewa 19 - Tak Kan Ada Cinta Yang Lain (2021 Ello)
        "168395062953115648", // Dewa 19 - Mahameru (2021 Virzha)
        "162001181",          // Kuwo fake tag: Panem. The Land sound-alike cover of Portugal. The Man - Feel It Still
        "kuwo_162001181",
        "228981606",          // Kuwo mislabeled: Andra & The Backbone - Main Hati (audio is actually Kepayang)
        "kuwo_228981606",
        "228983127",          // Kuwo mislabeled: Andra & The Backbone - Kepayang (audio is actually Hitamku)
        "kuwo_228983127",
        "5266278",            // Kuwo: Maroon 5 - Animals (2015 Victoria's Secret runway music, not studio track)
        "kuwo_5266278",
    ];

    if mismatches.contains(&id) {
        let t = title.to_lowercase();
        if !t.contains("virzha") && !t.contains("ello") && !t.contains("2021") && !t.contains("remake") {
            return true;
        }
    }

    let t = title.to_lowercase();
    if t.contains("virzha") || t.contains("ello") || t.contains("2021") || t.contains("remake") {
        return true;
    }

    false
}

/// Scores a candidate track against target metadata using multilingual cross-script comparison + edition verification + album comparison.
pub fn score_track_candidate(
    target_title: &str,
    target_artist: &str,
    target_dur_secs: u64,
    target_isrc: Option<&str>,
    target_album: Option<&str>,
    cand_id: &str,
    cand_title: &str,
    cand_artist: &str,
    cand_dur_secs: u64,
    cand_isrc: Option<&str>,
    cand_album: Option<&str>,
) -> u32 {
    // 0. Check upstream mismatch blacklist
    if is_known_upstream_mismatch(cand_id, cand_title, cand_artist) {
        return 0;
    }

    // 1. Version conflict check (across title and album)
    let target_flags = extract_version_flags(target_title, target_album);
    let cand_flags = extract_version_flags(cand_title, cand_album);
    if has_version_conflict(&target_flags, &cand_flags) {
        return 0;
    }

    // 1b. Reject unwanted feature/remake in candidate title if target did not ask for it
    let lower_target = format!("{} {}", target_artist, target_title).to_lowercase();
    let lower_cand_title = cand_title.to_lowercase();
    if (lower_cand_title.contains("feat.") || lower_cand_title.contains("feat ") || lower_cand_title.contains("ft.") || lower_cand_title.contains("ft "))
        && !lower_target.contains("feat") && !lower_target.contains("ft.") && !lower_target.contains("ft ") {
        return 0;
    }

    // 1c. Album and title edition conflict checks (Re-recorded, live, tribute, etc.)
    let cand_album_lower = cand_album.unwrap_or("").to_lowercase();
    let target_album_lower = target_album.unwrap_or("").to_lowercase();
    let cand_title_lower = cand_title.to_lowercase();
    let target_title_lower = target_title.to_lowercase();

    // Check remix / mix (e.g. "Alamak (Dipha Barus Remix)" vs original "Alamak")
    let is_cand_remix = REMIX_REGEX.is_match(&format!("{} {}", cand_title_lower, cand_album_lower));
    let is_target_remix = REMIX_REGEX.is_match(&format!("{} {}", target_title_lower, target_album_lower));
    if is_cand_remix != is_target_remix {
        return 0;
    }

    // Check re-recorded / rerecorded / re-record
    let is_cand_rerecorded = cand_album_lower.contains("re-record")
        || cand_album_lower.contains("rerecord")
        || cand_title_lower.contains("re-record")
        || cand_title_lower.contains("rerecord");
    let is_target_rerecorded = target_album_lower.contains("re-record")
        || target_album_lower.contains("rerecord")
        || target_title_lower.contains("re-record")
        || target_title_lower.contains("rerecord");
    if is_cand_rerecorded && !is_target_rerecorded {
        return 0;
    }

    // Check live / in concert / runway broadcast
    let is_cand_live = cand_album_lower.contains("live")
        || cand_album_lower.contains("in concert")
        || cand_title_lower.contains("live at")
        || cand_title_lower.contains("(live)")
        || cand_title_lower.contains("[live]")
        || cand_title_lower.ends_with(" - live")
        || cand_title_lower.contains(" live version")
        || LIVE_REGEX.is_match(&cand_title)
        || LIVE_REGEX.is_match(&cand_album_lower);
    let is_target_live = target_album_lower.contains("live")
        || target_album_lower.contains("in concert")
        || target_title_lower.contains("live")
        || LIVE_REGEX.is_match(&target_title)
        || LIVE_REGEX.is_match(&target_album_lower);
    if is_cand_live && !is_target_live {
        return 0;
    }

    // Check tribute / karaoke / sound-alike / cover
    let is_cand_tribute = cand_album_lower.contains("tribute")
        || cand_album_lower.contains("karaoke")
        || cand_title_lower.contains("tribute")
        || cand_title_lower.contains("karaoke")
        || cand_title_lower.contains("originally performed by")
        || cand_title_lower.contains("made popular by")
        || cand_title_lower.contains("in the style of")
        || cand_title_lower.contains("(cover)")
        || cand_title_lower.contains("[cover]");
    let is_target_tribute = target_album_lower.contains("tribute")
        || target_album_lower.contains("karaoke")
        || target_title_lower.contains("tribute")
        || target_title_lower.contains("karaoke")
        || target_title_lower.contains("originally performed by")
        || target_title_lower.contains("made popular by");
    if is_cand_tribute && !is_target_tribute {
        return 0;
    }

    // 2. Exact ISRC match is definitive
    if let (Some(t_isrc), Some(c_isrc)) = (target_isrc, cand_isrc) {
        let t_clean = t_isrc.trim().to_lowercase();
        let c_clean = c_isrc.trim().to_lowercase();
        if !t_clean.is_empty() && t_clean == c_clean {
            return 200;
        }
    }

    // 3. Artist match check
    if !does_artist_match(target_artist, cand_artist, target_title) {
        return 0;
    }

    let mut score: u32 = 50; // Base score for artist match

    // 4. Title comparison
    let target_clean = clean_string(target_title);
    let cand_clean = clean_string(cand_title);

    let mut title_matched = false;
    if !target_clean.is_empty() && !cand_clean.is_empty() {
        if target_clean == cand_clean {
            score += 100;
            title_matched = true;
        } else if target_clean.contains(&cand_clean) || cand_clean.contains(&target_clean) {
            score += 65;
            title_matched = true;
        }
    }

    // Japanese Katakana / Romaji loanword check (e.g. "Single Again" <-> "シングル・アゲイン")
    if !title_matched && (crate::hifi::script::contains_japanese(target_title) || crate::hifi::script::contains_japanese(cand_title)) {
        let meta = crate::hifi::script::parse_multilingual_metadata(target_title, Some(target_artist));
        let title_variants = [
            Some(target_clean.as_str()),
            meta.extracted_title.as_deref(),
            meta.native_title.as_deref(),
        ];

        for variant_opt in title_variants {
            if let Some(variant) = variant_opt {
                let variant_clean = clean_string(variant);
                if variant_clean.is_empty() {
                    continue;
                }
                let romaji_target = crate::hifi::script::kana_to_romaji(&variant_clean);
                let romaji_cand = crate::hifi::script::kana_to_romaji(&cand_clean);

                if !romaji_target.is_empty() && !cand_clean.is_empty() && (romaji_target == cand_clean || romaji_cand == variant_clean || romaji_target == romaji_cand) {
                    score += 90;
                    title_matched = true;
                    break;
                } else if crate::hifi::script::katakana_loanword_phonetic_matches(&romaji_target, &cand_clean)
                    || crate::hifi::script::katakana_loanword_phonetic_matches(&romaji_cand, &variant_clean) {
                    score += 85;
                    title_matched = true;
                    break;
                }
            }
        }
    }

    // Bilingual title check (e.g. "聖母たちのララバイ - Madonna Tachi no Lullaby" or "아이유 - 밤편지 (Through the Night)")
    if !title_matched {
        let meta = crate::hifi::script::parse_multilingual_metadata(target_title, Some(target_artist));
        if let Some(nat) = &meta.native_title {
            let nat_clean = clean_string(nat);
            if !nat_clean.is_empty() && (nat_clean == cand_clean || cand_clean.contains(&nat_clean) || nat_clean.contains(&cand_clean)) {
                score += 85;
                title_matched = true;
            }
        }
        if !title_matched {
            if let Some(ext) = &meta.extracted_title {
                let ext_clean = clean_string(ext);
                if !ext_clean.is_empty() && (ext_clean == cand_clean || cand_clean.contains(&ext_clean) || ext_clean.contains(&cand_clean)) {
                    score += 85;
                    title_matched = true;
                }
            }
        }
        if !title_matched {
            if let Some(lat) = &meta.latin_title {
                let lat_clean = clean_string(lat);
                if !lat_clean.is_empty() && (lat_clean == cand_clean || cand_clean.contains(&lat_clean) || lat_clean.contains(&cand_clean)) {
                    score += 80;
                    title_matched = true;
                }
            }
        }
    }

    // Cross-script title alias check (e.g. "Tamally Maak" <-> "تملي معاك", "Through the Night" <-> "밤편지")
    if !title_matched {
        let meta = crate::hifi::script::parse_multilingual_metadata(target_title, Some(target_artist));
        let effective_title = meta.extracted_title.as_deref().unwrap_or(target_title);
        let t_aliases = crate::hifi::script::get_title_cross_script_aliases(effective_title);
        let c_aliases = crate::hifi::script::get_title_cross_script_aliases(cand_title);

        for a in &t_aliases {
            let a_clean = clean_string(a);
            if !a_clean.is_empty() && (a_clean == cand_clean || cand_clean.contains(&a_clean) || a_clean.contains(&cand_clean)) {
                score += 85;
                title_matched = true;
                break;
            }
        }
        if !title_matched {
            for a in &c_aliases {
                let a_clean = clean_string(a);
                if !a_clean.is_empty() && (a_clean == target_clean || target_clean.contains(&a_clean) || a_clean.contains(&target_clean)) {
                    score += 85;
                    title_matched = true;
                    break;
                }
            }
        }
    }

    // A candidate track MUST match the song title. Without a title match,
    // a song from the same artist/album cannot be considered the same track.
    if !title_matched {
        return 0;
    }

    // 5. Duration comparison (Strict length validation for both Kuwo and Monochrome)
    if target_dur_secs > 0 && cand_dur_secs > 0 {
        let diff = (target_dur_secs as i64 - cand_dur_secs as i64).abs();
        
        // Maximum allowed discrepancy is 15s (or up to 5% for long tracks >300s, max 25s)
        let max_allowed_diff = (target_dur_secs as f64 * 0.05).clamp(15.0, 25.0) as i64;
        if diff > max_allowed_diff {
            // Track length is too different (e.g. 3:01 vs 4:28 is a short edit, radio edit, or different version)
            return 0;
        }

        if diff <= 2 {
            score += 40; // Exact match down to 2s
        } else if diff <= 4 {
            score += 25; // Close match
        } else if diff <= 7 {
            score += 10; // Acceptable padding / fade difference
        } else if diff <= 12 {
            score = score.saturating_sub(15);
        } else {
            // 13s to max_allowed_diff: heavy penalty
            score = score.saturating_sub(45);
        }
    } else if target_dur_secs > 0 && cand_dur_secs == 0 {
        // Target duration is known but candidate has no duration info
        score = score.saturating_sub(20);
    }

    // 6. Album comparison bonus
    if let (Some(t_alb), Some(c_alb)) = (target_album, cand_album) {
        let t_clean = clean_string(t_alb);
        let c_clean = clean_string(c_alb);
        if !t_clean.is_empty() && !c_clean.is_empty() {
            if t_clean == c_clean {
                score += 60; // Exact album match (e.g. "No Protection" == "No Protection")
            } else if t_clean.contains(&c_clean) || c_clean.contains(&t_clean) {
                score += 35; // Partial album match
            }
        }
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_string() {
        assert_eq!(clean_string("Bohemian Rhapsody (Remastered 2011)"), "bohemianrhapsody");
        assert_eq!(clean_string("Song feat. Artist"), "song");
        assert_eq!(clean_string("Title [Official Video]"), "title");
        // Multilingual
        assert_eq!(clean_string("シングル・アゲイン"), "シングルアゲイン");
        assert_eq!(clean_string("밤편지"), "밤편지");
        assert_eq!(clean_string("พิง"), "พิง");
        assert_eq!(clean_string("عمرو دياب"), "عمرو دياب".replace(' ', ""));
    }

    #[test]
    fn test_cross_script_artist_match() {
        assert!(does_artist_match("Mariya Takeuchi", "竹内まりや", "シングル・アゲイン"));
        assert!(does_artist_match("IU", "아이유", "밤편지"));
        assert!(does_artist_match("Amr Diab", "عمرو دياب", "Tamally Maak"));
        assert!(does_artist_match("Nont Tanont", "นนท์ ธนนท์", "พิง"));
    }

    #[test]
    fn test_japanese_loanword_score() {
        let score = score_track_candidate(
            "Mariya Takeuchi シングル・アゲイン",
            "개인소장",
            265,
            None,
            None,
            "1273467",
            "Single Again",
            "竹内まりや",
            264,
            None,
            None,
        );
        assert!(score >= 120, "Score was {}", score);
    }

    #[test]
    fn test_korean_cross_script_score() {
        let score = score_track_candidate(
            "아이유 - 밤편지 (Through the Night)",
            "1theK (원더케이)",
            253,
            None,
            None,
            "23497005",
            "Through the Night",
            "IU",
            253,
            None,
            None,
        );
        assert!(score >= 120, "Score was {}", score);
    }

    #[test]
    fn test_thai_cross_script_score() {
        let score = score_track_candidate(
            "Nont Tanont - พิง",
            "LOVEiS+",
            235,
            None,
            None,
            "193944050",
            "พิง",
            "นนท์ ธนนท์",
            235,
            None,
            None,
        );
        assert!(score >= 120, "Score was {}", score);
    }

    #[test]
    fn test_arabic_cross_script_score() {
        let score = score_track_candidate(
            "Amr Diab - Tamally Maak",
            "Mazzika",
            269,
            None,
            None,
            "1511586",
            "تملي معاك",
            "عمرو دياب",
            269,
            None,
            None,
        );
        assert!(score >= 120, "Score was {}", score);
    }

    #[test]
    fn test_duration_disqualification() {
        // "Sempurna" original is 268s (4:28).
        // Neillusion remake on Kuwo/Monochrome is 181s (3:01).
        // It must be rejected (score == 0).
        let score = score_track_candidate(
            "Sempurna",
            "Andra And The Backbone",
            268,
            None,
            None,
            "163245492",
            "Sempurna(feat. Andra & the Backbone)",
            "Neillusion&Andra & The Backbone",
            181,
            None,
            None,
        );
        assert_eq!(score, 0, "Mismatched duration/remake must be rejected, got score {}", score);

        // Correct 268s original track must score high (>= 180)
        let original_score = score_track_candidate(
            "Sempurna",
            "Andra And The Backbone",
            268,
            None,
            Some("Andra And The BackBone"),
            "172473323077242880",
            "Sempurna",
            "Andra & The Backbone",
            268,
            Some("IDAB30600441"),
            Some("Andra and The BackBone"),
        );
        assert!(original_score >= 180, "Original track must score high, got {}", original_score);
    }

    #[test]
    fn test_album_matching_and_rerecorded_disqualification() {
        // Starship - "Nothing's Gonna Stop Us Now"
        // Target album: "No Protection"
        // 1. Re-recorded version candidate from compilation MUST be disqualified (score == 0)
        let rerecorded_score = score_track_candidate(
            "Nothing's Gonna Stop Us Now",
            "Starship",
            266,
            None,
            Some("No Protection"),
            "45079884",
            "Nothing's Gonna Stop Us Now",
            "Starship",
            264,
            None,
            Some("Greatest Hits of the '80s (Re-Recorded Versions)"),
        );
        assert_eq!(rerecorded_score, 0, "Re-recorded album track must be disqualified");

        // 2. Official "No Protection" album track gets album match bonus (>= 220)
        let official_score = score_track_candidate(
            "Nothing's Gonna Stop Us Now",
            "Starship",
            266,
            None,
            Some("No Protection"),
            "1930566",
            "Nothing's Gonna Stop Us Now",
            "Starship",
            270,
            None,
            Some("No Protection"),
        );
        assert!(official_score >= 220, "Official album match must score >= 220, got {}", official_score);
    }

    #[test]
    fn test_title_match_required_and_mislabeled_kuwo() {
        // 1. Different title from same artist and album MUST score 0 (not allowed by album match alone)
        let diff_title_score = score_track_candidate(
            "Main Hati",
            "Andra And The Backbone",
            174,
            None,
            Some("Season 2"),
            "non_blacklisted_id",
            "Kepayang",
            "Andra And The Backbone",
            174,
            None,
            Some("Season 2"),
        );
        assert_eq!(diff_title_score, 0, "Different title on same album must score 0");

        // 2. Mislabeled Kuwo track IDs must be rejected by is_known_upstream_mismatch
        let kuwo_main_hati_score = score_track_candidate(
            "Main Hati",
            "Andra And The Backbone",
            174,
            None,
            Some("Season 2"),
            "kuwo_228981606",
            "Main Hati",
            "Andra & The Backbone",
            174,
            None,
            Some("Season 2"),
        );
        assert_eq!(kuwo_main_hati_score, 0, "Corrupt Kuwo Main Hati ID must be rejected");

        // 3. Genuine Tidal track for Main Hati must score >= 180
        let tidal_score = score_track_candidate(
            "Main Hati",
            "Andra And The Backbone",
            239,
            None,
            Some("Season 2"),
            "165836656720859136",
            "Main Hati",
            "Andra & The Backbone",
            238,
            Some("IDAB30800008"),
            Some("Season 2"),
        );
        assert!(tidal_score >= 180, "Genuine Tidal track must score >= 180, got {}", tidal_score);
    }

    #[test]
    fn test_remix_album_and_title_conflict() {
        // 1. Target is original "Alamak" by Rizky Febian.
        // Candidate is "Alamak (Dipha Barus Remix)" album track -> MUST be rejected (score == 0)
        let remix_score = score_track_candidate(
            "Alamak",
            "Rizky Febian, Adrian Khalif",
            209,
            None,
            Some("Alamak"),
            "518680784",
            "Alamak",
            "Rizky Febian&Adrian Khalif",
            211,
            None,
            Some("Alamak (Dipha Barus Remix)"),
        );
        assert_eq!(remix_score, 0, "Remix candidate when original requested must score 0, got {}", remix_score);

        // 2. Candidate is original "Alamak" on "Alamak" album -> MUST score >= 200
        let original_score = score_track_candidate(
            "Alamak",
            "Rizky Febian, Adrian Khalif",
            209,
            None,
            Some("Alamak"),
            "502382878",
            "Alamak",
            "Rizky Febian&Adrian Khalif",
            209,
            None,
            Some("Alamak"),
        );
        assert!(original_score >= 200, "Original Alamak track must score >= 200, got {}", original_score);

        // 3. Target explicitly requested remix -> original track must score 0, remix must score >= 200
        let req_remix_original_cand = score_track_candidate(
            "Alamak (Dipha Barus Remix)",
            "Rizky Febian, Adrian Khalif",
            211,
            None,
            Some("Alamak (Dipha Barus Remix)"),
            "502382878",
            "Alamak",
            "Rizky Febian&Adrian Khalif",
            209,
            None,
            Some("Alamak"),
        );
        assert_eq!(req_remix_original_cand, 0, "Original track must be rejected when remix is requested");

        let req_remix_match = score_track_candidate(
            "Alamak (Dipha Barus Remix)",
            "Rizky Febian, Adrian Khalif",
            211,
            None,
            Some("Alamak (Dipha Barus Remix)"),
            "518680784",
            "Alamak",
            "Rizky Febian&Adrian Khalif",
            211,
            None,
            Some("Alamak (Dipha Barus Remix)"),
        );
        assert!(req_remix_match >= 200, "Remix match must score >= 200, got {}", req_remix_match);
    }

    #[test]
    fn test_live_runway_broadcast_disqualification() {
        // Kuwo candidate 5266278 is "Animals-2015年维多利亚的秘密泳装秀秀场音乐" (runway broadcast mix)
        // It must be rejected when original studio track is requested.
        let runway_score = score_track_candidate(
            "Animals",
            "Maroon 5",
            232,
            None,
            Some("V"),
            "5266278",
            "Animals-2015年维多利亚的秘密泳装秀秀场音乐",
            "Maroon 5",
            229,
            None,
            None,
        );
        assert_eq!(runway_score, 0, "Runway broadcast mix must score 0");
    }
}
