use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    static ref FEAT_REGEX: Regex = Regex::new(r"(?i)\b(feat|featuring|ft)\.?\s+.*$").unwrap();
    static ref BRACKETS_REGEX: Regex = Regex::new(r"[\(\[\{【〔〈《「『].*?[\)\]\}】〕〉》」』]").unwrap();
    static ref NON_ALPHANUM_REGEX: Regex = Regex::new(r"[^\p{L}\p{N}\p{M}]").unwrap();
    static ref MULTI_SPACE_REGEX: Regex = Regex::new(r"\s+").unwrap();
    static ref ARTIST_SPLIT_REGEX: Regex = Regex::new(r"(?i)[,&/;|]|(?:\s+(?:feat\.?|ft\.?|featuring|with|x|and)\s+)").unwrap();
    static ref YOUTUBE_NOISE_REGEX: Regex = Regex::new(r"(?i)\b(official\s*(?:music\s*)?video|official\s*audio|official\s*visualizer|lyrics?\s*(?:video)?|music\s*video|audio|visualizer|hd|hq|4k|1080p|720p|topic|clip\s*officiel|video\s*oficial|mv)\b").unwrap();
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

pub fn extract_version_flags(title: &str) -> VersionFlags {
    let s = title.to_lowercase();
    VersionFlags {
        is_acoustic: s.contains("acoustic"),
        is_live: s.contains("live"),
        is_remix: s.contains("remix") || s.contains("mix"),
        is_instrumental: s.contains("instrumental") || s.contains("karaoke"),
        is_piano: s.contains("piano"),
        is_orchestral: s.contains("orchestral"),
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

/// Known upstream catalog IDs where original master was replaced with a modern remake
pub fn is_known_upstream_mismatch(id: &str, title: &str, _artist: &str) -> bool {
    let mismatches = [
        "168395054749057024", // Dewa 19 - Aku Milikmu (2021 Virzha)
        "168589766881927168", // Dewa 19 feat. Virzha - Aku Milikmu
        "168395069831774208", // Dewa 19 - Tak Kan Ada Cinta Yang Lain (2021 Ello)
        "168395062953115648", // Dewa 19 - Mahameru (2021 Virzha)
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

/// Scores a candidate track against target metadata using multilingual cross-script comparison + edition verification.
pub fn score_track_candidate(
    target_title: &str,
    target_artist: &str,
    target_dur_secs: u64,
    target_isrc: Option<&str>,
    cand_id: &str,
    cand_title: &str,
    cand_artist: &str,
    cand_dur_secs: u64,
    cand_isrc: Option<&str>,
) -> u32 {
    // 0. Check upstream mismatch blacklist
    if is_known_upstream_mismatch(cand_id, cand_title, cand_artist) {
        return 0;
    }

    // 1. Version conflict check
    let target_flags = extract_version_flags(target_title);
    let cand_flags = extract_version_flags(cand_title);
    if has_version_conflict(&target_flags, &cand_flags) {
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

    let mut score = 50; // Base score for artist match

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
                    break;
                }
            }
        }
    }

    // 5. Duration comparison
    if target_dur_secs > 0 && cand_dur_secs > 0 {
        let diff = (target_dur_secs as i64 - cand_dur_secs as i64).abs();
        if diff <= 3 {
            score += 25;
        } else if diff <= 7 {
            score += 10;
        } else if diff > 20 {
            // Significant duration difference penalizes score
            if score >= 30 {
                score -= 30;
            } else {
                score = 0;
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
            "1273467",
            "Single Again",
            "竹内まりや",
            264,
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
            "23497005",
            "Through the Night",
            "IU",
            253,
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
            "193944050",
            "พิง",
            "นนท์ ธนนท์",
            235,
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
            "1511586",
            "تملي معاك",
            "عمرو دياب",
            269,
            None,
        );
        assert!(score >= 120, "Score was {}", score);
    }
}
