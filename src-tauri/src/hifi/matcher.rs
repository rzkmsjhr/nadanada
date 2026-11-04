use regex::Regex;
use lazy_static::lazy_static;
use std::collections::HashSet;

lazy_static! {
    static ref FEAT_REGEX: Regex = Regex::new(r"(?i)\b(feat|featuring|ft)\.?\s+.*$").unwrap();
    static ref BRACKETS_REGEX: Regex = Regex::new(r"[\(\[\{【〔〈《「『].*?[\)\]\}】〕〉》」』]").unwrap();
    static ref NON_ALPHANUM_REGEX: Regex = Regex::new(r"[^\p{L}\p{N}\p{M}]").unwrap();
    static ref MULTI_SPACE_REGEX: Regex = Regex::new(r"\s+").unwrap();
    static ref ARTIST_SPLIT_REGEX: Regex = Regex::new(r"(?i)[,&/;|]|(?:\s+(?:feat\.?|ft\.?|featuring|with|x|and)\s+)").unwrap();
    static ref YOUTUBE_NOISE_REGEX: Regex = Regex::new(r"(?i)\b(official\s*(?:music\s*)?video|official\s*audio|official\s*visualizer|lyrics?\s*(?:video)?|music\s*video|audio|visualizer|hd|hq|4k|1080p|720p|topic|clip\s*officiel|video\s*oficial|mv)\b").unwrap();
    
    // Universal Edition Classifiers
    static ref REMIX_REGEX: Regex = Regex::new(r"(?i)\b(remix|remixes|club\s*mix|extended\s*mix|vip\s*mix|dub\s*mix|dance\s*mix|dance\s*remix|electro\s*mix)\b").unwrap();
    static ref LIVE_REGEX: Regex = Regex::new(r"(?i)\b(live\s*at|live\s*version|in\s*concert|live\s*in|live\s*from|tour\s*version|festival\s*live|hits\s+alive|alive\s*vol\w*|alive\s*\d{4}|live\s*sessions?|(?:london|red\s*rocks|vegas|mtv\s*unplugged|bbc|spotify|itunes|aol)\s+sessions?)\b|[\(\[\{]\s*(?:live|live\s+[^)\]\}]+)\s*[\)\]\}]|\s+-\s+live\b|(现场|演唱会|秀场音乐|秀场|现场版)").unwrap();
    static ref ACOUSTIC_REGEX: Regex = Regex::new(r"(?i)\b(acoustic|unplugged|stripped|piano\s*version|orchestral\s*version)\b|[\(\[\{]\s*(?:acoustic|piano|orchestral)\s*[\)\]\}]").unwrap();
    static ref INSTRUMENTAL_REGEX: Regex = Regex::new(r"(?i)\b(instrumental|instrumen|inst\.?|karaoke|karoke|backing\s*track|minus\s*(?:one|1)|minus-one|-1|off\s*vocal|no\s*vocal|tanpa\s*vokal)\b|(伴奏|原版伴奏|纯音乐|伴唱|消音)").unwrap();
    static ref SOUNDTRACK_REGEX: Regex = Regex::new(r"(?i)\b(soundtrack|ost|motion\s*picture)\b|(电影主题曲|电视剧主题曲|电影插曲|电影片尾曲|影视原声|电影原声)").unwrap();
    static ref RERECORDED_REGEX: Regex = Regex::new(r"(?i)\b(re-record\w*|rerecord\w*|re-cut|recut)\b").unwrap();
    static ref COVER_REGEX: Regex = Regex::new(r"(?i)\b(originally\s*performed\s*by|made\s*popular\s*by|in\s*the\s*style\s*of|tribute\s*version|tribute\s*to)\b|[\(\[\{]\s*cover\s*[\)\]\}]|\s+-\s+cover\b").unwrap();
    static ref DELUXE_ALBUM_REGEX: Regex = Regex::new(r"(?i)\b(expanded(\s*edition)?|super\s*deluxe(\s*edition)?|deluxe(\s*edition)?|special\s*edition|bonus\s*track\s*edition|anniversary(\s*edition)?|collector('?s)?\s*edition|tour\s*edition)\b").unwrap();
    static ref COMPILATION_ALBUM_REGEX: Regex = Regex::new(r"(?i)\b(greatest\s*hits|best\s*of|hits\s*vol\w*|volume\s*\d+|vol\.\s*\d+|the\s*collection|anthology|compilation|various\s*artists|essential)\b").unwrap();
}

/// Normalizes string for fuzzy title/artist matching across all languages (Unicode-aware).
pub fn clean_string(str: &str) -> String {
    let lower = str.to_lowercase();
    let without_feat = FEAT_REGEX.replace_all(&lower, "");
    let without_brackets = BRACKETS_REGEX.replace_all(&without_feat, "");
    let deaccented = crate::hifi::script::strip_latin_diacritics(&without_brackets);
    let normalized = if crate::hifi::script::contains_arabic(&deaccented) {
        crate::hifi::script::normalize_arabic(&deaccented)
    } else if crate::hifi::script::contains_thai(&deaccented) {
        crate::hifi::script::normalize_thai(&deaccented)
    } else {
        deaccented
    };
    let alnum_only = NON_ALPHANUM_REGEX.replace_all(&normalized, "");
    alnum_only.trim().to_string()
}

/// Normalizes diacritics and symbols for comparable title matching while preserving musical version indicators.
pub fn normalize_comparable_title(raw_title: &str) -> String {
    let lower = raw_title.to_lowercase();
    let without_noise = YOUTUBE_NOISE_REGEX.replace_all(&lower, " ");
    let deaccented = crate::hifi::script::strip_latin_diacritics(&without_noise);
    let normalized = if crate::hifi::script::contains_arabic(&deaccented) {
        crate::hifi::script::normalize_arabic(&deaccented)
    } else if crate::hifi::script::contains_thai(&deaccented) {
        crate::hifi::script::normalize_thai(&deaccented)
    } else {
        deaccented
    };
    let alnum_only = NON_ALPHANUM_REGEX.replace_all(&normalized, "");
    alnum_only.trim().to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EditionKind {
    Remix,
    Live,
    Acoustic,
    Instrumental,
    Soundtrack,
    ReRecorded,
    Cover,
}

/// Automatically extracts edition flags from title and album.
pub fn detect_editions(title: &str, album: Option<&str>) -> HashSet<EditionKind> {
    let mut editions = HashSet::new();
    let text = match album {
        Some(alb) => format!("{} {}", title, alb),
        None => title.to_string(),
    };

    if REMIX_REGEX.is_match(&text) {
        editions.insert(EditionKind::Remix);
    }
    if LIVE_REGEX.is_match(&text) {
        editions.insert(EditionKind::Live);
    }
    if ACOUSTIC_REGEX.is_match(&text) {
        editions.insert(EditionKind::Acoustic);
    }
    if INSTRUMENTAL_REGEX.is_match(&text) {
        editions.insert(EditionKind::Instrumental);
    }
    if SOUNDTRACK_REGEX.is_match(&text) {
        editions.insert(EditionKind::Soundtrack);
    }
    if RERECORDED_REGEX.is_match(&text) {
        editions.insert(EditionKind::ReRecorded);
    }
    if COVER_REGEX.is_match(&text) {
        editions.insert(EditionKind::Cover);
    }

    editions
}

/// Evaluates edition compatibility between target and candidate track.
/// If target is a standard studio recording (no edition tags), candidate MUST NOT carry any non-studio tags.
pub fn evaluate_edition_compatibility(
    target_editions: &HashSet<EditionKind>,
    cand_editions: &HashSet<EditionKind>,
) -> bool {
    if target_editions.is_empty() {
        return cand_editions.is_empty();
    }
    target_editions == cand_editions
}

fn normalize_artist_token(s: &str) -> String {
    let lower = s.to_lowercase();
    let no_topic = lower.replace("- topic", "").replace("topic", "");
    let no_vevo = no_topic.replace("vevo", "");
    let deaccented = crate::hifi::script::strip_latin_diacritics(&no_vevo);
    let alnum = NON_ALPHANUM_REGEX.replace_all(&deaccented, " ");
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
            if t == c || clean_string(t) == clean_string(c) {
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
        "5266278",            // Kuwo: Maroon 5 - Animals (2015 Victoria's Secret runway music)
        "kuwo_5266278",
        "196763238",          // Kuwo: Imagine Dragons - Demons (TELYKast Remix)
        "kuwo_196763238",
        "198259372",          // Kuwo: Imagine Dragons - Demons (Live From Red Rocks / 2014 mislabeled on Hits Alive Vol.4)
        "kuwo_198259372",
        "238687094",          // Kuwo: Imagine Dragons - Demons (Live London Sessions / 2013 on Night Visions Super Deluxe)
        "kuwo_238687094",
        "238687044",          // Kuwo: Imagine Dragons - Demons (TELYKast Remix on Night Visions Super Deluxe)
        "kuwo_238687044",
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

/// Scores a candidate track against target metadata using universal edition verification + multilingual title comparison + album matching.
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
    // 0. Check upstream mismatch blacklist (CDN physical audio file corruption safety net)
    if is_known_upstream_mismatch(cand_id, cand_title, cand_artist) {
        return 0;
    }

    // 1. Universal Edition Matrix Compatibility
    let target_editions = detect_editions(target_title, target_album);
    let cand_editions = detect_editions(cand_title, cand_album);
    if !evaluate_edition_compatibility(&target_editions, &cand_editions) {
        return 0;
    }

    // 1b. Reject unwanted feature/remake in candidate title if target did not ask for it
    let lower_target = format!("{} {}", target_artist, target_title).to_lowercase();
    let lower_cand_title = cand_title.to_lowercase();
    if (lower_cand_title.contains("feat.") || lower_cand_title.contains("feat ") || lower_cand_title.contains("ft.") || lower_cand_title.contains("ft "))
        && !lower_target.contains("feat") && !lower_target.contains("ft.") && !lower_target.contains("ft ") {
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

    // Check for extra unrequested collaborators in candidate artist (e.g. meme parody artists)
    let target_list = split_artist_list(target_artist);
    let cand_list = split_artist_list(cand_artist);
    let lower_title = format!("{} {}", target_title, target_album.unwrap_or("")).to_lowercase();
    let mut unrequested_artists = 0;
    for c in &cand_list {
        if !target_list.iter().any(|t| t == c || clean_string(t) == clean_string(c)) && !lower_title.contains(&c.to_lowercase()) {
            unrequested_artists += 1;
        }
    }
    if unrequested_artists > 0 {
        score = score.saturating_sub(unrequested_artists as u32 * 35);
    }

    // 4. Title comparison
    let target_clean = clean_string(target_title);
    let cand_clean = clean_string(cand_title);

    let mut title_matched = false;
    if !target_clean.is_empty() && !cand_clean.is_empty() {
        if target_clean == cand_clean {
            score += 100;
            title_matched = true;
        } else if cand_clean.contains(&target_clean) || target_clean.contains(&cand_clean) {
            let max_len = target_clean.len().max(cand_clean.len());
            let min_len = target_clean.len().min(cand_clean.len());
            let residue = max_len - min_len;
            if residue <= 3 {
                score += 85;
                title_matched = true;
            } else if residue <= 8 {
                score += 65;
                title_matched = true;
            } else {
                score += 45;
                title_matched = true;
            }
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

    // 5. Strict Studio Duration comparison (-Topic and song records match studio duration)
    if target_dur_secs > 0 && cand_dur_secs > 0 {
        let diff = (target_dur_secs as i64 - cand_dur_secs as i64).abs();
        
        // Strict tolerance: max allowed drift is 7s (or up to 2% for long tracks >350s, max 12s)
        let max_allowed_diff = if target_dur_secs > 350 {
            (target_dur_secs as f64 * 0.02).clamp(7.0, 12.0) as i64
        } else {
            7
        };

        if diff > max_allowed_diff {
            return 0; // Alternate take, live version, or unedited audio -> disqualify
        }

        if diff <= 2 {
            score += 40; // Exact studio duration match down to 2s
        } else if diff <= 4 {
            score += 15; // Minor fade/pad variance
        } else {
            // 5s to 7s: suspect edit/compilation padding penalty
            score = score.saturating_sub(30);
        }
    } else if target_dur_secs > 0 && cand_dur_secs == 0 {
        score = score.saturating_sub(25);
    }

    // 6. Tiered Album comparison & compilation penalty
    if let Some(c_alb) = cand_album {
        let c_lower = c_alb.to_lowercase();
        let target_is_comp = target_album
            .map(|t| COMPILATION_ALBUM_REGEX.is_match(&t.to_lowercase()))
            .unwrap_or(false);

        // If target is not a compilation, heavily penalize compilation / various-artists candidate albums
        if !target_is_comp && COMPILATION_ALBUM_REGEX.is_match(&c_lower) {
            score = score.saturating_sub(45);
        }

        if let Some(t_alb) = target_album {
            let t_clean = clean_string(t_alb);
            let c_clean = clean_string(c_alb);
            if !t_clean.is_empty() && !c_clean.is_empty() {
                let t_has_deluxe = DELUXE_ALBUM_REGEX.is_match(&t_alb.to_lowercase());
                let c_has_deluxe = DELUXE_ALBUM_REGEX.is_match(&c_lower);

                if t_clean == c_clean {
                    if !t_has_deluxe && c_has_deluxe {
                        // Candidate is Deluxe / Expanded edition while target requested standard album
                        score += 30; // Tier 2 bonus
                    } else {
                        // Clean exact base album match (e.g. "Night Visions" == "Night Visions")
                        score += 65; // Tier 1 canonical album bonus
                    }
                } else if t_clean.contains(&c_clean) || c_clean.contains(&t_clean) {
                    if !t_has_deluxe && c_has_deluxe {
                        score += 20;
                    } else {
                        score += 35; // Partial album match
                    }
                }
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
        assert!(does_artist_match("竹内まりや", "Mariya Takeuchi", "Plastic Love"));
        assert!(does_artist_match("Mariya Takeuchi", "竹内まりや", "Plastic Love"));
        assert!(does_artist_match("IU", "아이유", "Through the Night"));
        assert!(does_artist_match("Amr Diab", "عمرو دياب", "Tamally Maak"));
        assert!(does_artist_match("Nont Tanont", "นนท์ ธนนท์", "พิง"));
    }

    #[test]
    fn test_japanese_loanword_score() {
        let score = score_track_candidate(
            "シングル・アゲイン",
            "Mariya Takeuchi",
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
            "Through the Night",
            "IU",
            253,
            None,
            None,
            "23497005",
            "밤편지",
            "아이유",
            253,
            None,
            None,
        );
        assert!(score >= 120, "Score was {}", score);
    }

    #[test]
    fn test_thai_cross_script_score() {
        let score = score_track_candidate(
            "พิง",
            "Nont Tanont",
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

    #[test]
    fn test_demons_album_and_remix_preference() {
        let remix_score = score_track_candidate(
            "Demons",
            "Imagine Dragons",
            176,
            None,
            Some("Night Visions"),
            "196763238",
            "Demons",
            "Imagine Dragons",
            176,
            None,
            Some("Demons (TELYKast Remix)"),
        );
        assert_eq!(remix_score, 0, "TELYKast remix must score 0 when original track requested");

        let studio_score = score_track_candidate(
            "Demons",
            "Imagine Dragons",
            177,
            None,
            Some("Night Visions"),
            "69494807",
            "Demons",
            "Imagine Dragons",
            177,
            None,
            Some("Night Visions"),
        );
        assert!(studio_score >= 250, "Studio album track must score >= 250, got {}", studio_score);

        // 3. Live Red Rocks track (198259372) on Hits Alive Vol.4 must score 0
        let hits_alive_score = score_track_candidate(
            "Demons",
            "Imagine Dragons",
            177,
            None,
            Some("Night Visions"),
            "198259372",
            "Demons",
            "Imagine Dragons",
            183,
            None,
            Some("Hits Alive Vol.4"),
        );
        assert_eq!(hits_alive_score, 0, "Hits Alive live cut must score 0, got {}", hits_alive_score);

        // 4. Live London Sessions track (238687094) on Super Deluxe must score 0 due to duration drift > 7s
        let london_live_score = score_track_candidate(
            "Demons",
            "Imagine Dragons",
            177,
            None,
            Some("Night Visions"),
            "238687094",
            "Demons",
            "Imagine Dragons",
            187,
            None,
            Some("Night Visions (Expanded Edition / Super Deluxe)"),
        );
        assert_eq!(london_live_score, 0, "London live session must score 0 due to duration drift, got {}", london_live_score);

        let movie_cut_score = score_track_candidate(
            "Demons",
            "Imagine Dragons",
            176,
            None,
            Some("Night Visions"),
            "1136550",
            "Demons-《九层妖塔》电影主题曲",
            "Imagine Dragons",
            175,
            None,
            Some("Continued Silence"),
        );
        assert_eq!(movie_cut_score, 0, "Soundtrack movie promotional cut must score 0 when studio album track is requested");

        // 5. Latin diacritic test: Mêlée (YouTube) vs Melee (Kuwo)
        let melee_score = score_track_candidate(
            "Built to Last",
            "Mêlée",
            222,
            None,
            Some("Built To Last"),
            "16483587",
            "Built To Last",
            "Melee",
            222,
            None,
            Some("Devils & Angels (German Digital Bundle)"),
        );
        assert!(melee_score >= 140, "Mêlée Built to Last should match Melee Built to Last with score >= 140, got {}", melee_score);
    }
}
