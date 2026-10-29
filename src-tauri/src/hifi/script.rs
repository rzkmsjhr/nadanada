use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    static ref VIDEO_NOISE_REGEX: Regex = Regex::new(
        r"(?i)\b(official\s*(?:music\s*)?video|official\s*audio|official\s*visualizer|lyrics?\s*(?:video)?|music\s*video|audio|visualizer|hd|hq|4k|1080p|720p|topic|clip\s*officiel|video\s*oficial|mv|m/v|full\s*ver(?:sion)?|dance\s*practice|teaser|trailer)\b"
    ).unwrap();

    static ref BRACKET_STRIP_REGEX: Regex = Regex::new(r"[\(\[\{【〔〈《「『].*?[\)\]\}】〕〉》」』]").unwrap();
    static ref BRACKET_CONTENT_REGEX: Regex = Regex::new(r"[\(\[\{【〔〈《「『]([^\)\]\}】〕〉》」』]+)[\)\]\}】〕〉》」』]").unwrap();
    static ref UNICODE_WORD_OR_NUM_REGEX: Regex = Regex::new(r"[^\p{L}\p{N}\p{M}]").unwrap();
    static ref MULTI_SPACE_REGEX: Regex = Regex::new(r"\s+").unwrap();
}

/// Checks if string contains Chinese/Japanese/Korean characters (Hanzi, Kanji, Kana, Hangul).
pub fn contains_cjk(s: &str) -> bool {
    s.chars().any(|c| matches!(c,
        '\u{3040}'..='\u{309F}' | // Hiragana
        '\u{30A0}'..='\u{30FF}' | // Katakana
        '\u{4E00}'..='\u{9FFF}' | // CJK Unified Ideographs
        '\u{3400}'..='\u{4DBF}' | // CJK Extension A
        '\u{AC00}'..='\u{D7AF}' | // Hangul Syllables
        '\u{1100}'..='\u{11FF}'   // Hangul Jamo
    ))
}

pub fn contains_japanese(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '\u{3040}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}'))
}

pub fn contains_hangul(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}'))
}

pub fn contains_arabic(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '\u{0600}'..='\u{06FF}' | '\u{0750}'..='\u{077F}' | '\u{08A0}'..='\u{08FF}'))
}

pub fn contains_thai(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '\u{0E00}'..='\u{0E7F}'))
}

pub fn contains_cyrillic(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '\u{0400}'..='\u{04FF}'))
}

pub fn contains_non_latin(s: &str) -> bool {
    contains_cjk(s) || contains_arabic(s) || contains_thai(s) || contains_cyrillic(s)
}

pub fn contains_latin(s: &str) -> bool {
    s.chars().any(|c| matches!(c, 'a'..='z' | 'A'..='Z'))
}

/// Normalizes Arabic text by unifying alef variations, teh marbuta, alef maksura,
/// and stripping harakat (tashkeel short vowels) and tatweel.
pub fn normalize_arabic(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            // Harakat / tashkeel / tatweel to strip
            '\u{064B}'..='\u{0652}' | '\u{0670}' | '\u{0640}' => continue,
            // Alef variants
            'أ' | 'إ' | 'آ' | 'ٱ' => out.push('ا'),
            // Teh marbuta
            'ة' => out.push('ه'),
            // Alef maksura
            'ى' => out.push('ي'),
            _ => out.push(c),
        }
    }
    out
}

/// Normalizes Thai text by stripping optional tone marks and diacritics.
pub fn normalize_thai(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            // Tone marks and special diacritics
            '\u{0E48}'..='\u{0E4E}' => continue,
            _ => out.push(c),
        }
    }
    out
}

/// Converts Japanese Hiragana and Katakana characters to standard Hepburn Romaji.
pub fn kana_to_romaji(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];
        let next = if i + 1 < len { Some(chars[i + 1]) } else { None };

        // Two-character combinations (youon & foreign sounds)
        if let Some(n) = next {
            let pair_romaji = match (c, n) {
                ('し' | 'シ', 'ゃ' | 'ャ') => Some("sha"),
                ('し' | 'シ', 'ゅ' | 'ュ') => Some("shu"),
                ('し' | 'シ', 'ょ' | 'ョ') => Some("sho"),
                ('じ' | 'ジ', 'ゃ' | 'ャ') => Some("ja"),
                ('じ' | 'ジ', 'ゅ' | 'ュ') => Some("ju"),
                ('じ' | 'ジ', 'ょ' | 'ョ') => Some("jo"),
                ('ち' | 'チ', 'ゃ' | 'ャ') => Some("cha"),
                ('ち' | 'チ', 'ゅ' | 'ュ') => Some("chu"),
                ('ち' | 'チ', 'ょ' | 'ョ') => Some("cho"),
                ('き' | 'キ', 'ゃ' | 'ャ') => Some("kya"),
                ('き' | 'キ', 'ゅ' | 'ュ') => Some("kyu"),
                ('き' | 'キ', 'ょ' | 'ョ') => Some("kyo"),
                ('ぎ' | 'ギ', 'ゃ' | 'ャ') => Some("gya"),
                ('ぎ' | 'ギ', 'ゅ' | 'ュ') => Some("gyu"),
                ('ぎ' | 'ギ', 'ょ' | 'ョ') => Some("gyo"),
                ('に' | 'ニ', 'ゃ' | 'ャ') => Some("nya"),
                ('に' | 'ニ', 'ゅ' | 'ュ') => Some("nyu"),
                ('に' | 'ニ', 'ょ' | 'ョ') => Some("nyo"),
                ('ひ' | 'ヒ', 'ゃ' | 'ャ') => Some("hya"),
                ('ひ' | 'ヒ', 'ゅ' | 'ュ') => Some("hyu"),
                ('ひ' | 'ヒ', 'ょ' | 'ョ') => Some("hyo"),
                ('び' | 'ビ', 'ゃ' | 'ャ') => Some("bya"),
                ('び' | 'ビ', 'ゅ' | 'ュ') => Some("byu"),
                ('び' | 'ビ', 'ょ' | 'ョ') => Some("byo"),
                ('ぴ' | 'ピ', 'ゃ' | 'ャ') => Some("pya"),
                ('ぴ' | 'ピ', 'ゅ' | 'ュ') => Some("pyu"),
                ('ぴ' | 'ピ', 'ょ' | 'ョ') => Some("pyo"),
                ('み' | 'ミ', 'ゃ' | 'ャ') => Some("mya"),
                ('み' | 'ミ', 'ゅ' | 'ュ') => Some("myu"),
                ('み' | 'ミ', 'ょ' | 'ョ') => Some("myo"),
                ('り' | 'リ', 'ゃ' | 'ャ') => Some("rya"),
                ('り' | 'リ', 'ゅ' | 'ュ') => Some("ryu"),
                ('り' | 'リ', 'ょ' | 'ョ') => Some("ryo"),
                ('て' | 'テ', 'ぃ' | 'ィ') => Some("ti"),
                ('で' | 'デ', 'ぃ' | 'ィ') => Some("di"),
                ('ふ' | 'フ', 'ぇ' | 'ェ') => Some("fe"),
                ('ふ' | 'フ', 'ぉ' | 'ォ') => Some("fo"),
                ('ふ' | 'フ', 'ぁ' | 'ァ') => Some("fa"),
                ('ふ' | 'フ', 'ぃ' | 'ィ') => Some("fi"),
                ('う' | 'ウ', 'ぇ' | 'ェ') => Some("we"),
                ('う' | 'ウ', 'ぉ' | 'ォ') => Some("wo"),
                ('う' | 'ウ', 'ぃ' | 'ィ') => Some("wi"),
                _ => None,
            };

            if let Some(r) = pair_romaji {
                result.push_str(r);
                i += 2;
                continue;
            }
        }

        // Small tsu (sokuon): double next consonant
        if c == 'っ' || c == 'ッ' {
            if let Some(n) = next {
                let next_single = single_kana_to_romaji(n);
                if let Some(first_char) = next_single.chars().next() {
                    result.push(first_char);
                }
            }
            i += 1;
            continue;
        }

        // Choonpu (long vowel mark)
        if c == 'ー' || c == '―' || c == '‐' {
            if let Some(last) = result.chars().last() {
                if matches!(last, 'a' | 'i' | 'u' | 'e' | 'o') {
                    result.push(last);
                }
            }
            i += 1;
            continue;
        }

        let romaji = single_kana_to_romaji(c);
        if !romaji.is_empty() {
            result.push_str(romaji);
        } else {
            result.push(c);
        }
        i += 1;
    }

    result
}

fn single_kana_to_romaji(c: char) -> &'static str {
    match c {
        'あ' | 'ア' => "a", 'い' | 'イ' => "i", 'う' | 'ウ' => "u", 'え' | 'エ' => "e", 'お' | 'オ' => "o",
        'か' | 'カ' => "ka", 'き' | 'キ' => "ki", 'く' | 'ク' => "ku", 'け' | 'ケ' => "ke", 'こ' | 'コ' => "ko",
        'が' | 'ガ' => "ga", 'ぎ' | 'ギ' => "gi", 'ぐ' | 'グ' => "gu", 'げ' | 'ゲ' => "ge", 'ご' | 'ゴ' => "go",
        'さ' | 'サ' => "sa", 'し' | 'シ' => "shi", 'す' | 'ス' => "su", 'せ' | 'セ' => "se", 'そ' | 'ソ' => "so",
        'ざ' | 'ザ' => "za", 'じ' | 'ジ' => "ji", 'ず' | 'ズ' => "zu", 'ぜ' | 'ゼ' => "ze", 'ぞ' | 'ゾ' => "zo",
        'た' | 'タ' => "ta", 'ち' | 'チ' => "chi", 'つ' | 'ツ' => "tsu", 'て' | 'テ' => "te", 'と' | 'ト' => "to",
        'だ' | 'ダ' => "da", 'ぢ' | 'ヂ' => "ji", 'づ' | 'ヅ' => "zu", 'で' | 'デ' => "de", 'ど' | 'ド' => "do",
        'な' | 'ナ' => "na", 'に' | 'ニ' => "ni", 'ぬ' | 'ヌ' => "nu", 'ね' | 'ネ' => "ne", 'の' | 'ノ' => "no",
        'は' | 'ハ' => "ha", 'ひ' | 'ヒ' => "hi", 'ふ' | 'フ' => "fu", 'へ' | 'ヘ' => "he", 'ほ' | 'ホ' => "ho",
        'ば' | 'バ' => "ba", 'び' | 'ビ' => "bi", 'ぶ' | 'ブ' => "bu", 'べ' | 'ベ' => "be", 'ぼ' | 'ボ' => "bo",
        'ぱ' | 'パ' => "pa", 'ぴ' | 'ピ' => "pi", 'ぷ' | 'プ' => "pu", 'ぺ' | 'ペ' => "pe", 'ぽ' | 'ポ' => "po",
        'ま' | 'マ' => "ma", 'み' | 'ミ' => "mi", 'む' | 'ム' => "mu", 'め' | 'メ' => "me", 'も' | 'モ' => "mo",
        'や' | 'ヤ' => "ya", 'ゆ' | 'ユ' => "yu", 'よ' | 'ヨ' => "yo",
        'ら' | 'ラ' => "ra", 'り' | 'リ' => "ri", 'る' | 'ル' => "ru", 'れ' | 'レ' => "re", 'ろ' | 'ロ' => "ro",
        'わ' | 'ワ' => "wa", 'を' | 'ヲ' => "wo", 'ん' | 'ン' => "n",
        _ => "",
    }
}

/// Checks if Katakana Romaji phonetically matches an English word (e.g. "shinguru" ≈ "single", "agein" ≈ "again").
pub fn katakana_loanword_phonetic_matches(romaji_kana: &str, english: &str) -> bool {
    let k = romaji_kana.to_lowercase().replace([' ', '-', '_', '\'', '・'], "");
    let e = english.to_lowercase().replace([' ', '-', '_', '\'', '・'], "");

    if k.is_empty() || e.is_empty() {
        return false;
    }

    if k == e || k.contains(&e) || e.contains(&k) {
        return true;
    }

    // 1. Whole-word loanword replacements FIRST (before individual character reductions)
    let loanword_k = k
        .replace("shinguru", "single")
        .replace("singuru", "single")
        .replace("agein", "again")
        .replace("gein", "gain")
        .replace("purasutikku", "plastic")
        .replace("rabu", "love")
        .replace("rarabai", "lullaby")
        .replace("sutei", "stay")
        .replace("doa", "door")
        .replace("wizu", "with")
        .replace("mii", "me")
        .replace("madonna", "madonna")
        .replace("tachino", "tachino")
        .replace("dansu", "dance")
        .replace("bohemiang", "bohemian")
        .replace("rapusodi", "rhapsody");

    if loanword_k == e || loanword_k.contains(&e) || e.contains(&loanword_k) {
        return true;
    }

    // 2. Generic phonetic mappings
    let simplified_k = loanword_k
        .replace("sh", "s")
        .replace("ch", "c")
        .replace("ts", "t")
        .replace("ru", "l")
        .replace("ri", "li")
        .replace("ra", "la")
        .replace("ro", "lo")
        .replace('r', "l")
        .replace("zu", "th")
        .replace("ji", "zi");

    let simplified_e = e
        .replace("sh", "s")
        .replace("ch", "c")
        .replace('r', "l")
        .replace("th", "s");

    simplified_k == simplified_e || simplified_k.contains(&simplified_e) || simplified_e.contains(&simplified_k)
}

/// Bidirectional cross-script alias mapping for top Japanese, Korean, Arabic, Thai, and Chinese artists.
pub fn get_artist_cross_script_aliases(artist: &str) -> Vec<&'static str> {
    let lower = artist.to_lowercase().trim().to_string();
    let clean = lower.replace(['-', '_', '.', '\''], " ");
    let compact = clean.replace(' ', "");

    let table: &[(&[&str], &[&str])] = &[
        // Japanese
        (&["mariya takeuchi", "takeuchi mariya", "mariyatakeuchi"], &["竹内まりや"]),
        (&["miki matsubara", "matsubara miki", "mikimatsubara"], &["松原みき"]),
        (&["hiromi iwasaki", "iwasaki hiromi", "hiromiiwasaki"], &["岩崎宏美"]),
        (&["tatsuro yamashita", "yamashita tatsuro", "tatsuroyamashita"], &["山下達郎"]),
        (&["akina nakamori", "nakamori akina", "akinanakamori"], &["中森明菜"]),
        (&["seiko matsuda", "matsuda seiko", "seikomatsuda"], &["松田聖子"]),
        (&["taeko ohnuki", "taeko onuki", "onuki taeko", "taekoonuki"], &["大貫妙子"]),
        (&["anri"], &["杏里"]),
        (&["hikaru utada", "utada hikaru", "hikaruutada"], &["宇多田ヒカル"]),
        (&["toshiki kadomatsu", "kadomatsu toshiki"], &["角松敏生"]),
        (&["kenshi yonezu", "yonezu kenshi"], &["米津玄師"]),
        (&["fujii kaze", "kaze fujii"], &["藤井風"]),
        (&["yoasobi"], &["夜に駆ける", "ヨアソビ"]),
        (&["aimer"], &["エメ"]),
        (&["lisa"], &["リサ"]),
        (&["radwimps"], &["ラッドウィンプス"]),
        (&["king gnu"], &["キングヌー"]),
        (&["official hige dandism", "officialhigedandism"], &["official髭男dism"]),
        (&["vaundy"], &["バウンディ"]),
        (&["yuuri"], &["優里"]),
        (&["zutomayo", "zutomayo"], &["ずっと真夜中でいいのに。"]),
        (&["yorushika"], &["ヨルシカ"]),
        (&["ryuichi sakamoto", "sakamoto ryuichi"], &["坂本龍一"]),
        (&["joe hisaishi", "hisaishi joe"], &["久石譲"]),
        (&["sheena ringo", "ringo sheena"], &["椎名林檎"]),

        // Korean
        (&["iu", "lee jieun"], &["아이유", "이지은"]),
        (&["bts", "bangtan", "bangtan boys"], &["방탄소년단"]),
        (&["blackpink"], &["블랙핑크"]),
        (&["newjeans"], &["뉴진스"]),
        (&["twice"], &["트와이스"]),
        (&["exo"], &["엑소"]),
        (&["bol4", "bolbbalgan4"], &["볼빨간사춘기"]),
        (&["psy"], &["싸이"]),
        (&["taeyeon"], &["태연"]),
        (&["seventeen"], &["세븐틴"]),
        (&["stray kids"], &["스트레이 키즈"]),
        (&["heize"], &["헤이즈"]),
        (&["crush"], &["크러쉬"]),
        (&["zion t", "zion.t"], &["자이언티"]),
        (&["akmu", "akdong musician"], &["악뮤", "악동뮤ジ션"]),
        (&["red velvet"], &["레드벨벳"]),
        (&["aespa"], &["에스파"]),
        (&["ive"], &["아이브"]),
        (&["le sserafim"], &["르세라핌"]),
        (&["g-dragon", "gdragon"], &["지드래곤", "권지용"]),

        // Arabic
        (&["amr diab"], &["عمرو دياب"]),
        (&["nancy ajram"], &["نانسي عجرم"]),
        (&["fairuz", "fayrouz"], &["فيروز"]),
        (&["elissa"], &["اليسا"]),
        (&["sherine", "sherine abdel wahab"], &["شيرين", "شيرين عبد الوهاب"]),
        (&["saad lamjarred"], &["سعد لمجرد"]),
        (&["tamer hosny"], &["تامر حسني"]),
        (&["mohamed hamaki"], &["محمد حماقي"]),
        (&["assala", "assala nasri"], &["اصالة", "اصالة نصري"]),
        (&["majid al mohandis", "majed al mohandes"], &["ماجد المهندس"]),
        (&["hussain al jassmi"], &["حسين الجسمي"]),
        (&["cairokee"], &["كايروكي"]),

        // Thai
        (&["nont tanont", "tanont chumroen"], &["นนท์ ธนนท์"]),
        (&["billkin", "putthipong assaratanakul"], &["บิวกิ้น"]),
        (&["pp krit", "krit amnuaydechkorn"], &["พีพี กฤษฏ์"]),
        (&["bowkylion"], &["โบกี้ไลออน"]),
        (&["ink waruntorn"], &["อิ้งค์ วรันธร"]),
        (&["three man down"], &["ทรีแมนดาว"]),
        (&["tilly birds"], &["ทิลลี่เบิร์ดส์"]),
        (&["youngohm"], &["ยังโอม"]),
        (&["violette wautier"], &["วิโอเลต วอเทียร์"]),
        (&["cocktail"], &["ค็อกเทล"]),
        (&["bodyslam"], &["บอดี้สแลม"]),
        (&["palmy"], &["ปาล์มมี่"]),
        (&["stamp", "stamp apiwat"], &["แสตมป์"]),
        (&["scrubb"], &["สครับบ์"]),
        (&["anatomy rabbit"], &["อนาโตมี่ แรบบิท"]),

        // Chinese
        (&["jay chou", "chou jay"], &["周杰伦", "周杰倫"]),
        (&["eason chan"], &["陈奕迅", "陳奕迅"]),
        (&["jj lin"], &["林俊杰", "林俊傑"]),
        (&["teresa teng"], &["邓丽君", "鄧麗君", "テレサ・テン"]),
        (&["faye wong"], &["王菲"]),
        (&["jacky cheung"], &["张学友", "張學友"]),
        (&["gem", "g.e.m."], &["邓紫棋", "鄧紫棋"]),
        (&["mayday"], &["五月天"]),
        (&["leehom wang", "wang leehom"], &["王力宏"]),
        (&["eric chou"], &["周兴哲", "周興哲"]),
        (&["accusefive"], &["告五人"]),
        (&["jolin tsai"], &["蔡依林"]),
        (&["stefanie sun"], &["孙燕姿", "孫燕姿"]),
        (&["david tao"], &["陶喆"]),
    ];

    let mut aliases = Vec::new();
    for (latins, natives) in table {
        let is_latin_match = latins.iter().any(|&l| {
            let l_clean = l.replace(['-', '_', '.', '\''], " ");
            let l_compact = l_clean.replace(' ', "");
            lower == l || clean == l_clean || compact == l_compact
        });

        let is_native_match = natives.iter().any(|&n| {
            lower == n.to_lowercase() || compact == n.replace(' ', "")
        });

        if is_latin_match {
            for &n in *natives {
                aliases.push(n);
            }
            for &l in *latins {
                if l != artist {
                    aliases.push(l);
                }
            }
        } else if is_native_match {
            for &l in *latins {
                aliases.push(l);
            }
            for &n in *natives {
                if n != artist {
                    aliases.push(n);
                }
            }
        }
    }

    aliases
}

/// Bidirectional cross-script alias mapping for iconic song titles across Japanese, Korean, Arabic, Thai, and Chinese.
pub fn get_title_cross_script_aliases(title: &str) -> Vec<&'static str> {
    let lower = title.to_lowercase().trim().to_string();
    let clean = lower.replace(['-', '_', '.', '\'', ' '], "");

    let table: &[(&[&str], &[&str])] = &[
        // Japanese
        (&["single again", "singleagain"], &["シングルアゲイン", "シングル・アゲイン"]),
        (&["plastic love", "plasticlove"], &["プラスティックラブ", "プラスティック・ラヴ", "プラスティック・ラブ"]),
        (&["stay with me", "staywithme"], &["真夜中のドア", "真夜中のドア stay with me"]),
        (&["madonna tachi no lullaby", "madonnatachinolullaby"], &["聖母たちのララバイ"]),
        (&["first love", "firstlove"], &["初恋", "初戀"]),
        (&["racing into the night", "yoruni kakeru", "yorunikakeru"], &["夜に駆ける"]),
        (&["lemon"], &["レモン"]),
        (&["pretender"], &["プリテンダー"]),

        // Korean
        (&["through the night", "throughthenight"], &["밤편지"]),
        (&["spring day", "springday"], &["봄날"]),
        (&["love scenario", "lovescenario"], &["사랑을 했다"]),
        (&["palette"], &["팔레트"]),
        (&["eight"], &["에잇"]),
        (&["celebrity"], &["셀러브리티"]),
        (&["dynamite"], &["다이너마イト"]),
        (&["butter"], &["버터"]),
        (&["hype boy", "hypeboy"], &["하입보이"]),
        (&["ditto"], &["디토"]),
        (&["omg"], &["오엠지"]),

        // Arabic
        (&["tamally maak", "tamallymaak", "tamali maak"], &["تملي معاك"]),
        (&["nour el ain", "nourelain"], &["نور العين"]),
        (&["wayah"], &["وياه"]),
        (&["habibi ya nour el ain"], &["حبيبي يا نور العين"]),
        (&["el leila"], &["الليلة"]),
        (&["enta eih"], &["انت ايه"]),
        (&["ya tabtab"], &["يا طبطب"]),

        // Thai
        (&["phing", "ping"], &["พิง"]),
        (&["i told sunset about you"], &["แปลรักฉันด้วยใจเธอ"]),
        (&["melt"], &["โต๊ะริม"]),
    ];

    let mut aliases = Vec::new();
    for (latins, natives) in table {
        let is_latin = latins.iter().any(|&l| {
            let l_clean = l.replace(['-', '_', '.', '\'', ' '], "");
            clean == l_clean || lower == l
        });
        let is_native = natives.iter().any(|&n| {
            let n_clean = n.replace(['-', '_', '.', '\'', ' ', '・'], "");
            clean == n_clean || lower == n.to_lowercase()
        });

        if is_latin {
            for &n in *natives {
                aliases.push(n);
            }
        } else if is_native {
            for &l in *latins {
                aliases.push(l);
            }
        }
    }

    aliases
}

#[derive(Debug, Clone)]
pub struct MultilingualMetadata {
    pub clean_title: String,
    pub extracted_artist: Option<String>,
    pub extracted_title: Option<String>,
    pub native_title: Option<String>,
    pub latin_title: Option<String>,
    pub search_queries: Vec<String>,
}

/// Intelligently parses YouTube titles that combine Latin and native scripts (Japanese, Korean, Arabic, Thai, Chinese),
/// handles uploader channels (e.g. "개인소장"), and generates high-probability search queries for Kuwo.
pub fn parse_multilingual_metadata(raw_title: &str, raw_channel: Option<&str>) -> MultilingualMetadata {
    // 0. Extract bracketed text before stripping to detect bilingual titles
    // e.g. "밤편지 (Through the Night)" or "シングル・アゲイン (Single Again)"
    let title_without_noise = VIDEO_NOISE_REGEX.replace_all(raw_title, " ");
    let mut bracket_latin: Option<String> = None;
    let mut bracket_native: Option<String> = None;
    for cap in BRACKET_CONTENT_REGEX.captures_iter(&title_without_noise) {
        if let Some(m) = cap.get(1) {
            let b_text = m.as_str().trim();
            if !b_text.is_empty() && !VIDEO_NOISE_REGEX.is_match(b_text) {
                if contains_latin(b_text) && contains_non_latin(raw_title) {
                    bracket_latin = Some(b_text.to_string());
                } else if contains_non_latin(b_text) && contains_latin(raw_title) {
                    bracket_native = Some(b_text.to_string());
                }
            }
        }
    }

    // 1. Strip noise and brackets for clean base title
    let title_without_brackets = BRACKET_STRIP_REGEX.replace_all(&title_without_noise, " ");
    let clean_title = MULTI_SPACE_REGEX.replace_all(&title_without_brackets, " ").trim().to_string();

    let channel = raw_channel
        .map(|c| c.replace("- Topic", "").replace("- topic", "").replace("Topic", "").trim().to_string())
        .unwrap_or_default();

    // Check if channel is a generic uploader channel
    let is_generic_channel = channel.is_empty()
        || channel.eq_ignore_ascii_case("topic")
        || channel.contains("개인소장")
        || channel.contains("Collection")
        || channel.contains("Official")
        || channel.contains("VEVO")
        || channel.contains("Channel")
        || channel.contains("Music");

    let mut extracted_artist: Option<String> = if !is_generic_channel {
        Some(channel.clone())
    } else {
        None
    };

    let mut extracted_title: Option<String> = Some(clean_title.clone());
    let mut native_title: Option<String> = None;
    let mut latin_title: Option<String> = None;

    // 1b. Check for major bilingual section delimiters: " | ", " // "
    // e.g. "Amr Diab - Tamally Maak | عمرو دياب - تملي معاك"
    let mut major_section_matched = false;
    for md in [" | ", " // "] {
        if clean_title.contains(md) {
            let sections: Vec<&str> = clean_title.split(md).map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
            if sections.len() >= 2 {
                let sec1 = sections[0];
                let sec2 = sections[1];
                let sec1_has_latin = contains_latin(sec1);
                let sec1_has_native = contains_non_latin(sec1);
                let sec2_has_latin = contains_latin(sec2);
                let sec2_has_native = contains_non_latin(sec2);

                if (sec1_has_latin && !sec1_has_native && sec2_has_native) || (sec2_has_latin && !sec2_has_native && sec1_has_native) {
                    let (latin_sec, native_sec) = if sec1_has_latin { (sec1, sec2) } else { (sec2, sec1) };

                    let latin_parts: Vec<&str> = latin_sec.split(" - ").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                    if latin_parts.len() >= 2 {
                        extracted_artist = Some(latin_parts[0].to_string());
                        extracted_title = Some(latin_parts[1].to_string());
                        latin_title = Some(latin_parts[1].to_string());
                    } else {
                        latin_title = Some(latin_sec.to_string());
                    }

                    let native_parts: Vec<&str> = native_sec.split(" - ").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                    if native_parts.len() >= 2 {
                        native_title = Some(native_parts[1].to_string());
                    } else {
                        native_title = Some(native_sec.to_string());
                    }
                    major_section_matched = true;
                    break;
                }
            }
        }
    }

    // 2. Check for standard delimiters in title: " - ", " / ", " | ", " ~ "
    if !major_section_matched {
        let delimiters = [" - ", " – ", " — ", " | ", " / ", "／", " ~ "];
        for d in delimiters {
            if clean_title.contains(d) {
                let parts: Vec<&str> = clean_title.split(d).map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
                if parts.len() >= 2 {
                    let part1 = parts[0];
                    let part2 = parts[1];

                    // If part 1 has Latin and part 2 has native script (or vice versa):
                    let part1_has_latin = contains_latin(part1);
                    let part1_has_native = contains_non_latin(part1);
                    let part2_has_latin = contains_latin(part2);
                    let part2_has_native = contains_non_latin(part2);

                    if part1_has_latin && !part1_has_native && part2_has_native {
                        // e.g. "Mariya Takeuchi - シングル・アゲイン" or "NONT TANONT - พิง"
                        extracted_artist = Some(part1.to_string());
                        extracted_title = Some(part2.to_string());
                        native_title = Some(part2.to_string());
                    } else if part1_has_native && part2_has_latin && !part2_has_native {
                        // e.g. "聖母たちのララバイ - Madonna Tachi no Lullaby"
                        native_title = Some(part1.to_string());
                        latin_title = Some(part2.to_string());
                        extracted_title = Some(part1.to_string());
                    } else {
                        // Standard "Artist - Title"
                        if extracted_artist.is_none() || is_generic_channel {
                            extracted_artist = Some(part1.to_string());
                            extracted_title = Some(part2.to_string());
                        }
                    }
                    break;
                }
            }
        }
    }

    // 3. Script transition heuristic without delimiter (e.g. "Mariya Takeuchi シングル・アゲイン")
    if extracted_artist.is_none() || is_generic_channel {
        let words: Vec<&str> = clean_title.split_whitespace().collect();
        let mut latin_words = Vec::new();
        let mut native_words = Vec::new();

        for w in &words {
            if contains_non_latin(w) {
                native_words.push(*w);
            } else if contains_latin(w) {
                latin_words.push(*w);
            }
        }

        if !latin_words.is_empty() && !native_words.is_empty() {
            let latin_part = latin_words.join(" ");
            let native_part = native_words.join(" ");

            extracted_artist = Some(latin_part);
            extracted_title = Some(native_part.clone());
            native_title = Some(native_part);
        }
    }

    // Fall back to bracketed translations if native/latin title not determined
    if latin_title.is_none() {
        latin_title = bracket_latin;
    }
    if native_title.is_none() {
        native_title = bracket_native;
    }

    // 4. Generate query permutations for Kuwo
    let mut queries = Vec::new();

    // Query Pass 1: Direct combined search (Artist + Title)
    let effective_artist = extracted_artist.as_deref().unwrap_or(&channel);
    let effective_title = extracted_title.as_deref().unwrap_or(&clean_title);

    let primary_query = format!("{} {}", effective_artist, effective_title).trim().to_string();
    if !primary_query.is_empty() {
        queries.push(primary_query);
    }

    // Query Pass 2: If we have cross-script aliases for the artist
    let aliases = get_artist_cross_script_aliases(effective_artist);
    for alias in &aliases {
        let alias_query = format!("{} {}", alias, effective_title).trim().to_string();
        if !queries.contains(&alias_query) {
            queries.push(alias_query);
        }
    }

    // Query Pass 3: If Japanese Katakana, try Hepburn Romaji loanword query (e.g. "Mariya Takeuchi Single Again")
    if contains_japanese(effective_title) {
        let romaji = kana_to_romaji(effective_title);
        if !romaji.trim().is_empty() {
            let romaji_query = format!("{} {}", effective_artist, romaji).trim().to_string();
            if !queries.contains(&romaji_query) {
                queries.push(romaji_query);
            }

            // Also check for loanword phonetic translation (e.g. "shinguru agein" -> "single again")
            let loanword_title = romaji
                .replace("shinguru", "single")
                .replace("singuru", "single")
                .replace("agein", "again")
                .replace("gein", "gain")
                .replace("purasutikku", "plastic")
                .replace("rabu", "love")
                .replace("rarabai", "lullaby")
                .replace("sutei", "stay")
                .replace("doa", "door")
                .replace("wizu", "with")
                .replace("mii", "me");

            if loanword_title != romaji {
                let loanword_query = format!("{} {}", effective_artist, loanword_title).trim().to_string();
                if !queries.contains(&loanword_query) {
                    queries.push(loanword_query);
                }
                for alias in &aliases {
                    let alias_loanword_query = format!("{} {}", alias, loanword_title).trim().to_string();
                    if !queries.contains(&alias_loanword_query) {
                        queries.push(alias_loanword_query);
                    }
                }
            }
        }
    }

    // Query Pass 4: If bilingual title exists (e.g. "聖母たちのララバイ" and "Madonna Tachi no Lullaby" or "밤편지" and "Through the Night")
    if let Some(lat) = &latin_title {
        let lat_query = format!("{} {}", effective_artist, lat).trim().to_string();
        if !queries.contains(&lat_query) {
            queries.push(lat_query);
        }
        for alias in &aliases {
            let alias_lat_query = format!("{} {}", alias, lat).trim().to_string();
            if !queries.contains(&alias_lat_query) {
                queries.push(alias_lat_query);
            }
        }
    }

    if let Some(nat) = &native_title {
        let nat_query = format!("{} {}", effective_artist, nat).trim().to_string();
        if !queries.contains(&nat_query) {
            queries.push(nat_query);
        }
    }

    // Query Pass 4b: Title cross-script aliases (e.g. "Tamally Maak" <-> "تملي معاك", "Through the Night" <-> "밤편지")
    let title_aliases = get_title_cross_script_aliases(effective_title);
    for t_alias in &title_aliases {
        let t_alias_query = format!("{} {}", effective_artist, t_alias).trim().to_string();
        if !queries.contains(&t_alias_query) {
            queries.push(t_alias_query);
        }
        for alias in &aliases {
            let combined = format!("{} {}", alias, t_alias).trim().to_string();
            if !queries.contains(&combined) {
                queries.push(combined);
            }
        }
    }

    // Query Pass 5: Fallback to title only if artist might have been noisy
    if !effective_title.is_empty() && !queries.contains(&effective_title.to_string()) {
        queries.push(effective_title.to_string());
    }

    MultilingualMetadata {
        clean_title,
        extracted_artist,
        extracted_title,
        native_title,
        latin_title,
        search_queries: queries,
    }
}
