import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';

export const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const parts = String(durationStr).split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
};

export const normalizeText = (str) => (str || '').toLowerCase().replace(/[^\w\s\u3040-\u30ff\u4e00-\u9faf]/gi, ' ');

export const cleanTitleForArtistMatch = (title) => {
  return (title || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/[,!?;:~\\/]/g, ' ')
    .trim();
};

export const isKaraokeOrDerivative = (title, channel, query = '') => {
  const normTitle = (title || '').toLowerCase();
  const normChannel = (channel || '').toLowerCase();
  const fullText = normTitle + ' ' + normChannel;
  const queryNorm = (query || '').toLowerCase();

  // If query explicitly requested karaoke/instrumental, allow it
  if (queryNorm.includes('karaoke') || queryNorm.includes('カラオケ') || queryNorm.includes('instrumental')) {
    return false;
  }

  // 1. Karaoke channels & artists
  if (
    normChannel.includes('歌っちゃ王') || 
    normChannel.includes('karafun') || 
    normChannel.includes('sing king') || 
    normChannel.includes('生音風カラオケ') ||
    normChannel.includes('カラオケ')
  ) {
    return true;
  }

  // 2. Japanese & English karaoke / cover / play-along terms
  const badPhrases = [
    '歌っちゃ王', '原曲歌手', '原曲キー', 'キー上げ', 'キー下げ',
    'ガイドメロ', 'ガイドなし', 'ガイド音', 'ガイドボーカル',
    'カラオケ', 'karaoke',
    'off vocal', 'offvocal', 'off-vocal', 'without vocal', 'no vocal',
    'backing track', 'minus one',
    '弾いてみた', '歌ってみた', '演奏してみた', '叩いてみた', '弾いてみ', '歌ってみ',
    '【ベース】', '[ベース]', 'ベースで', 'ベーシスト',
    '【ギター】', '[ギター]', 'ギターで', 'ギタリスト',
    '【ドラム】', '[ドラム]', 'ドラマー',
    '【ピアノ】', '[ピアノ]',
    'tab譜', 'タブ譜',
    'bass cover', 'guitar cover', 'drum cover', 'piano cover', 'vocal cover',
    'play along', 'playalong', 'tutorial', 'how to play', 'fingerstyle',
    'amateur cover', 'fan cover',
    'mashup', 'mash-up', 'mash up', 'bootleg',
    'slowed', 'reverb', 'sped up', 'speed up', 'nightcore',
    'instrumental', 'inst.', 'tribute', 'parody',
    // Covers & amateur performance
    'cover by', 'covered by', '(cover)', '[cover]', ' cover',
    // DJ / Remix / Koplo / Hipdut
    'dj ', 'dj.', 'dj-', 'dj_', 'remix', 'rmx', 'koplo', 'hipdut', 'jedag jedug', 'funkot',
    'tiktok', 'tik tok',
    // Lyrics channels / Megamixes / Music box
    'lirik', 'lyric video', 'lyrics video', 'lirik lagu', 'music box', 'オルゴール', 'orgel',
    'originally performed by', 'original performer', 'megamix', 'kompilasi'
  ];

  for (const bad of badPhrases) {
    if (fullText.includes(bad)) {
      return true;
    }
  }

  // 3. Key shift notation: e.g. "+4Key", "-2 key", "key+3", "Key-1", "+4キー"
  if (/[+-]\s*\d+\s*(?:key|キー)/i.test(normTitle) || /(?:key|キー)\s*[+-]\s*\d+/i.test(normTitle)) {
    return true;
  }

  return false;
};

const JAPANESE_ARTIST_PAIRS = [
  ["mariya takeuchi", "竹内まりや"],
  ["takeuchi mariya", "竹内まりや"],
  ["reiko takahashi", "高橋玲子"],
  ["takahashi reiko", "高橋玲子"],
  ["noriyuki makihara", "槇原敬之"],
  ["makihara noriyuki", "槇原敬之"],
  ["tatsuro yamashita", "山下達郎"],
  ["yamashita tatsuro", "山下達郎"],
  ["miki matsubara", "松原みき"],
  ["matsubara miki", "松原みき"],
  ["taeko onuki", "大貫妙子"],
  ["onuki taeko", "大貫妙子"],
  ["anri", "杏里"],
  ["akina nakamori", "中森明菜"],
  ["nakamori akina", "中森明菜"],
  ["seiko matsuda", "松田聖子"],
  ["matsuda seiko", "松田聖子"],
  ["junko yagami", "八神純子"],
  ["yagami junko", "八神純子"],
  ["tomoko aran", "亜蘭知子"],
  ["aran tomoko", "亜蘭知子"],
  ["meiko nakahara", "中原めいこ"],
  ["nakahara meiko", "中原めいこ"],
  ["masayoshi takanaka", "高中正義"],
  ["takanaka masayoshi", "高中正義"],
];

const JAPANESE_TITLE_PAIRS = [
  ["シングル アゲイン", "single again"],
  ["シングルアゲイン", "single again"],
  ["プラスティック ラブ", "plastic love"],
  ["プラスチック ラブ", "plastic love"],
  ["サンセット ロード", "sunset road"],
  ["ステイ ウィズ ミー", "stay with me"],
  ["フライディ チャイナタウン", "fly day chinatown"],
  ["フライデー チャイナタウン", "friday chinatown"],
  ["真夜中のドア", "stay with me"],
  ["もう恋なんてしない", "mo koi nante shinai"],
  ["元気を出して", "genki wo dashite"],
  ["元気を出して", "genki o dashite"],
  ["縁の糸", "enishi no ito"],
];

export const doesCandidateMatchArtist = (candidate, artistWords, rawArtist) => {
  if (!artistWords || artistWords.length === 0) return true;
  if (!candidate) return false;

  // Never match karaoke or derivative tracks as the original artist
  if (isKaraokeOrDerivative(candidate.title, candidate.channel)) {
    return false;
  }

  const rawChannel = (candidate.channel || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').trim();
  const channelNorm = normalizeText(rawChannel);
  const rawArtistNorm = normalizeText(rawArtist || '').trim();

  // Cross-script Japanese artist matching
  for (const [latin, kanji] of JAPANESE_ARTIST_PAIRS) {
    if (rawArtistNorm.includes(latin) || rawArtistNorm.includes(kanji)) {
      if (channelNorm.includes(latin) || channelNorm.includes(kanji)) {
        return true;
      }
      // Also check title prefix before hyphen for videos (e.g. "竹内まりや - Plastic Love")
      const cleanTitle = cleanTitleForArtistMatch(candidate.title);
      const firstPart = normalizeText(cleanTitle.split(/\s*[-–—:]\s*/)[0] || '');
      if (firstPart.includes(latin) || firstPart.includes(kanji)) {
        return true;
      }
      return false;
    }
  }

  // 1. Channel match (applies to both songs and official video channels)
  const matchedInChannel = artistWords.filter(w => channelNorm.includes(w)).length;
  if (matchedInChannel >= Math.ceil(artistWords.length * 0.6)) {
    return true;
  }
  if (rawArtist && channelNorm.includes(rawArtistNorm)) {
    return true;
  }

  // Multi-artist collaboration matching:
  // When rawArtist is a collaboration like "Breakbot, Irfane" or "A & B" or "A feat. B",
  // candidate matches if channel matches ANY of the individual artists!
  const individualArtists = (rawArtist || '')
    .split(/[,&/]|(?:\s+ft\.?\s+|\s+feat\.?\s+|\s+featuring\s+|\s+x\s+|\s+with\s+)/i)
    .map(a => a.trim())
    .filter(Boolean);

  for (const indArtist of individualArtists) {
    const indNorm = normalizeText(indArtist).trim();
    if (indNorm.length >= 2) {
      if (channelNorm === indNorm || channelNorm.includes(indNorm)) {
        return true;
      }
      if (indNorm.includes(channelNorm) && channelNorm.length >= 3) {
        return true;
      }
      const indWords = indNorm.split(/\s+/).filter(w => w.length > 2);
      if (indWords.length > 0 && indWords.every(w => channelNorm.includes(w))) {
        return true;
      }
    }
  }

  // 2. For songs: in YouTube Music, the artist is ALWAYS the channel.
  // If channel didn't match, this song is a cover / different artist / karaoke producer.
  // Notes in title (e.g. "(Mariya Takeuchi 1984)" or "(原曲歌手:竹内まりや)") are NOT the performer!
  if (candidate.item_type === 'song') {
    return false;
  }

  // 3. For videos only: YouTube video titles often follow "Artist - Title" format
  const cleanTitle = cleanTitleForArtistMatch(candidate.title);
  const parts = cleanTitle.split(/\s*[-–—:]\s*/);
  if (parts.length >= 2) {
    const firstPart = parts[0];
    const firstPartNorm = normalizeText(firstPart).trim();

    // Check individual artists in video title prefix
    for (const indArtist of individualArtists) {
      const indNorm = normalizeText(indArtist).trim();
      if (indNorm.length >= 2 && (firstPartNorm.includes(indNorm) || (firstPartNorm.length >= 3 && indNorm.includes(firstPartNorm)))) {
        return true;
      }
    }

    const ftMatch = firstPart.match(/^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.*)$/i);
    if (ftMatch) {
      const leadArtistNorm = normalizeText(ftMatch[1]);
      const leadMatches = artistWords.filter(w => leadArtistNorm.includes(w)).length;
      if (leadMatches < Math.ceil(artistWords.length * 0.6)) {
        return false;
      }
    }

    const matchedInFirst = artistWords.filter(w => firstPartNorm.includes(w)).length;
    if (matchedInFirst >= Math.ceil(artistWords.length * 0.6)) {
      return true;
    }
  }

  return false;
};

export const doesCandidateMatchTitle = (candidate, expectedTitle) => {
  if (!expectedTitle || !candidate) return false;

  const cleanExpected = cleanTitleForArtistMatch(expectedTitle).trim();
  const cleanCand = cleanTitleForArtistMatch(candidate.title || '').trim();

  const normExpected = normalizeText(cleanExpected);
  const normCand = normalizeText(cleanCand);

  // 1. Direct match with clean expected title
  if (cleanExpected && (candidate.title || '').includes(cleanExpected)) {
    return true;
  }
  if (normExpected && normCand && (normCand.includes(normExpected) || normExpected.includes(normCand))) {
    return true;
  }

  // 2. Cross-script Japanese/English loanword title matching (e.g. "シングル・アゲイン" <-> "Single Again")
  for (const [jp, en] of JAPANESE_TITLE_PAIRS) {
    const normJp = normalizeText(jp);
    const normEn = normalizeText(en);
    if (normExpected.includes(normJp) || normExpected.includes(normEn)) {
      if (normCand.includes(normJp) || normCand.includes(normEn)) {
        return true;
      }
    }
  }

  // 3. Check individual core keywords
  if (normExpected.includes('single') && normCand.includes('single')) return true;
  if (normExpected.includes('again') && normCand.includes('again')) return true;
  if (normExpected.includes('plastic') && normCand.includes('plastic')) return true;
  if (normExpected.includes('sunset') && normCand.includes('sunset')) return true;

  // 4. Check parenthetical reading / alternate title if present (e.g. "えにし")
  const parensMatch = expectedTitle.match(/\(([^)]+)\)|\[([^\]]+)\]/);
  if (parensMatch) {
    const inside = (parensMatch[1] || parensMatch[2] || '').trim();
    if (inside.length >= 2) {
      const normInside = normalizeText(inside);
      if (normInside && (normCand.includes(normInside) || (candidate.title || '').includes(inside))) {
        return true;
      }
    }
  }

  // 5. Check word overlap for multi-word titles
  const expectedWords = normExpected.split(/\s+/).filter(w => w.length > 0);
  if (expectedWords.length >= 1) {
    const matched = expectedWords.filter(w => normCand.includes(w)).length;
    if (matched >= Math.ceil(expectedWords.length * 0.6)) {
      return true;
    }
  }

  return false;
};

const getCachedVideo = query => {
  try {
    const raw = localStorage.getItem('nadanada-yt-cache');
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const normalizedKey = query.toLowerCase().trim();
    const candidate = cache[normalizedKey];
    if (!candidate) return null;

    // Validate cached item: purge if it is karaoke/derivative, DJ remix, or > 10 minutes
    if (isKaraokeOrDerivative(candidate.title, candidate.channel, query)) {
      delete cache[normalizedKey];
      localStorage.setItem('nadanada-yt-cache', JSON.stringify(cache));
      return null;
    }
    const durSec = parseDuration(candidate.duration);
    if (durSec > 600) {
      delete cache[normalizedKey];
      localStorage.setItem('nadanada-yt-cache', JSON.stringify(cache));
      return null;
    }

    return candidate;
  } catch (e) {
    return null;
  }
};

const setCachedVideo = (query, videoObj) => {
  try {
    const raw = localStorage.getItem('nadanada-yt-cache') || '{}';
    const cache = JSON.parse(raw);
    const normalizedKey = query.toLowerCase().trim();
    const { queueId, rank, ...cleanVideo } = videoObj;
    cache[normalizedKey] = cleanVideo;
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      delete cache[keys[0]];
    }
    localStorage.setItem('nadanada-yt-cache', JSON.stringify(cache));
  } catch (e) {
    console.error("Failed to save yt-cache:", e);
  }
};

export function useMusicDiscovery({
  playlist, 
  setPlaylist, 
  currentIndex, 
  isEndlessPlay, 
  setGlobalError,
  setShowTrendingDropdown,
  savedPlaylist,
  setSavedPlaylist,
  setCurrentIndex,
  setIsAudioPlaying,
  handleAddMultiple,
  setSavedPlaylists,
  setSuccessMessage
}) {
  const [isFetchingEndless, setIsFetchingEndless] = useState(false);
  const [failedEndlessFetch, setFailedEndlessFetch] = useState(false);
  
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importUrl, setImportUrl] = useState('');

  const [isFetchingTrending, setIsFetchingTrending] = useState(false);
  const [trendingType, setTrendingType] = useState(null);

  const mixCacheRef = useRef(new Map());

  useEffect(() => {
    if (isEndlessPlay && playlist.length > 0 && currentIndex >= playlist.length - 2 && !isFetchingEndless && !failedEndlessFetch) {
      const fetchNext = async () => {
        if (!navigator.onLine) {
          setFailedEndlessFetch(true);
          setGlobalError("No internet connection.");
          return;
        }
        setIsFetchingEndless(true);
        try {
          // Always extend the playlist from the end!
          const lastIdx = playlist.length - 1;
          const songA = playlist[lastIdx];
          const songB = playlist.length >= 2 ? playlist[lastIdx - 1] : null;

          if (!songA?.id) {
            setIsFetchingEndless(false);
            return;
          }

          // Anchor tracks establish the playlist's original mood and theme.
          // User-added songs have !isEndlessGenerated; fallback to first tracks.
          const userTracks = playlist.filter(s => !s.isEndlessGenerated);
          const anchorSong = userTracks.length > 0 ? userTracks[0] : playlist[0];

          const mixCache = mixCacheRef.current;
          const getMix = async (videoId) => {
            if (!videoId) return [];
            if (mixCache.has(videoId)) return mixCache.get(videoId);
            try {
              const res = await api.getYouTubeMix(videoId);
              if (res && res.length > 0) {
                mixCache.set(videoId, res);
                if (mixCache.size > 40) {
                  const oldestKey = mixCache.keys().next().value;
                  mixCache.delete(oldestKey);
                }
                return res;
              }
            } catch (err) {
              console.error("Failed to fetch mix for", videoId, err);
            }
            return [];
          };

          const mixA = await getMix(songA.id);
          const mixB = songB?.id ? await getMix(songB.id) : [];
          const mixAnchor = (anchorSong?.id && anchorSong.id !== songA.id && anchorSong.id !== songB?.id)
            ? await getMix(anchorSong.id)
            : [];

          const getWords = (song) => {
            const text = ((song.title || '') + ' ' + (song.channel || '')).toLowerCase()
              .replace(/\[.*?\]|\(.*?\)/g, ' ') // remove brackets and parens
              .replace(/official|music|video|audio|hd|hq|lyrics|topic/g, ' ')
              .replace(/[^a-z0-9]/g, ' '); // keep only alphanumeric as spaces
            const words = text.split(/\s+/).filter(w => w.length > 2); // ignore short words
            return new Set(words);
          };

          const calculateSimilarity = (setA, setB) => {
            if (setA.size === 0 || setB.size === 0) return 0;
            let intersection = 0;
            for (let word of setA) {
              if (setB.has(word)) intersection++;
            }
            const union = setA.size + setB.size - intersection;
            return intersection / union;
          };

          const extractArtistClean = (song) => {
            if (!song) return '';
            const channel = (song.channel || '')
              .replace(/\s*-\s*topic$/i, '')
              .replace(/vevo$/i, '')
              .replace(/official(\s+channel|\s+music)?$/i, '')
              .trim();
            const title = song.title || '';
            if (title.includes(' - ')) {
              const prefix = title.split(' - ')[0].trim();
              if (prefix.length >= 2 && prefix.length <= 40) return prefix;
            } else if (title.includes(' ~ ')) {
              const prefix = title.split(' ~ ')[0].trim();
              if (prefix.length >= 2 && prefix.length <= 40) return prefix;
            }
            return channel;
          };

          const normalizeArtistName = (name) => {
            return (name || '').toLowerCase()
              .replace(/\(.*?\)|\[.*?\]/g, ' ')
              .replace(/\b(feat|ft|featuring|with|prod|x)\b.*$/i, ' ')
              .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/gi, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          };

          const isSameArtist = (song1, song2) => {
            if (!song1 || !song2) return false;
            const a = normalizeArtistName(extractArtistClean(song1));
            const b = normalizeArtistName(extractArtistClean(song2));
            if (!a || !b) return false;
            if (a === b) return true;
            if (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) return true;
            return false;
          };

          const analyzeMixSphere = (tracks, baseSong) => {
            const trackIds = new Set();
            const artistNames = new Set();
            const artistWordSet = new Set();

            if (baseSong) {
              if (baseSong.id) trackIds.add(baseSong.id);
              const baseArt = normalizeArtistName(extractArtistClean(baseSong));
              if (baseArt) {
                artistNames.add(baseArt);
                baseArt.split(/\s+/).filter(w => w.length > 2).forEach(w => artistWordSet.add(w));
              }
            }

            for (const t of tracks) {
              if (t.id) trackIds.add(t.id);
              const art = normalizeArtistName(extractArtistClean(t));
              if (art) {
                artistNames.add(art);
                art.split(/\s+/).filter(w => w.length > 2).forEach(w => artistWordSet.add(w));
              }
            }

            return { trackIds, artistNames, artistWordSet };
          };

          const existingIds = new Set(playlist.map(s => s.id));
          const existingWordSets = playlist.map(s => getWords(s));

          // Combine candidate pools from the last song (mixA) and second-to-last (mixB)
          const candidatePool = [];
          const seenPoolIds = new Set();

          for (const v of mixA) {
            if (!existingIds.has(v.id) && !seenPoolIds.has(v.id)) {
              candidatePool.push(v);
              seenPoolIds.add(v.id);
            }
          }

          if (mixB && mixB.length > 0) {
            for (const v of mixB) {
              if (!existingIds.has(v.id) && !seenPoolIds.has(v.id)) {
                candidatePool.push(v);
                seenPoolIds.add(v.id);
              }
            }
          }

          let available = candidatePool.filter(v => {
            const vWords = getWords(v);
            for (let existingSet of existingWordSets) {
              if (calculateSimilarity(vWords, existingSet) > 0.55) {
                return false; // Semantic duplicate
              }
            }
            return true;
          });

          if (available.length === 0) {
            console.log("Primary mix empty or all duplicates. Attempting fallback...");
            try {
              let cleanArtist = songA.channel ? songA.channel.replace(/- topic/i, '').replace(/vevo/i, '').trim() : '';
              let fallbackQuery = cleanArtist ? `${cleanArtist} songs` : `${songA.title} cover`;

              let fallbackResults = await api.searchYouTube(fallbackQuery);
              available = (fallbackResults || []).filter(v => {
                if (existingIds.has(v.id)) return false;
                const vWords = getWords(v);
                for (let existingSet of existingWordSets) {
                  if (calculateSimilarity(vWords, existingSet) > 0.55) return false;
                }
                return true;
              });

              if (available.length === 0 && songB?.id) {
                const prevResults = await getMix(songB.id);
                available = prevResults.filter(v => !existingIds.has(v.id));
              }
            } catch (fallbackErr) {
              console.error("Endless play fallback failed:", fallbackErr);
            }
          }

          if (available.length > 0) {
            const sphereB = songB ? analyzeMixSphere(mixB, songB) : null;
            const sphereAnchor = anchorSong ? analyzeMixSphere(mixAnchor, anchorSong) : null;
            const recentHistory = playlist.slice(Math.max(0, playlist.length - 7));

            const scoredCandidates = available.map(track => {
              let score = 0;
              const candArtistNorm = normalizeArtistName(extractArtistClean(track));
              const candWords = candArtistNorm.split(/\s+/).filter(w => w.length > 2);

              // 1. Fatigue / Repetition penalty:
              // Strictly reject candidate if it is by the immediate predecessor's artist (songA)
              if (isSameArtist(track, songA)) {
                return { track, score: -9999, rejected: true };
              }

              // Penalize if artist appeared in the recent 2-7 tracks
              const recentConflictCount = recentHistory.filter(h => isSameArtist(track, h)).length;
              if (recentConflictCount > 0) {
                score -= recentConflictCount * 80;
              }

              // 2. Position in mixA (YouTube Music relevance rank)
              const rankInA = mixA.findIndex(t => t.id === track.id);
              if (rankInA !== -1) {
                score += Math.max(0, 50 - rankInA);
              }

              // 3. Consistency with Song B (second-to-last song in playlist)
              if (sphereB) {
                if (sphereB.trackIds.has(track.id)) {
                  score += 80; // Direct track match in Song B's sphere
                } else if (sphereB.artistNames.has(candArtistNorm)) {
                  score += 50; // Artist is part of Song B's recommendation sphere
                } else if (candWords.some(w => sphereB.artistWordSet.has(w))) {
                  score += 25; // Shared artist token
                } else {
                  // Disconnected from Song B: penalize jumping away from preceding context
                  score -= 50;
                }
              }

              // 4. Consistency with Playlist Anchor (Original Mood / Theme)
              if (sphereAnchor && playlist.length >= 3) {
                if (sphereAnchor.trackIds.has(track.id)) {
                  score += 70; // Direct track match with anchor theme
                } else if (sphereAnchor.artistNames.has(candArtistNorm)) {
                  score += 45; // Artist belongs to the anchor theme/genre
                } else if (candWords.some(w => sphereAnchor.artistWordSet.has(w))) {
                  score += 20; // Shared token with anchor
                } else {
                  // Complete disconnection from the playlist's original theme
                  score -= 60;
                }
              }

              // 5. Official Song preference over video
              if (track.item_type === 'song') {
                score += 25;
              }

              // 6. Penalize derivatives, karaoke, covers, live
              if (isKaraokeOrDerivative(track.title, track.channel)) {
                score -= 150;
              }

              return { track, score, rejected: false };
            });

            const validCandidates = scoredCandidates
              .filter(c => !c.rejected && c.score > -200)
              .sort((a, b) => b.score - a.score);

            const bestEntry = validCandidates.length > 0
              ? validCandidates[0]
              : scoredCandidates.filter(c => !c.rejected).sort((a, b) => b.score - a.score)[0];

            let picked = bestEntry?.track || available[0];

            // If the recommended track is explicitly a video or lyric version, try to find the official song audio version
            const videoRegex = /(official video|music video|official hd video|official music video|\bvideo\b|lirik|lyrics|lyric|cover|live)/i;
            const isTopic = (picked.channel || '').toLowerCase().includes('- topic');
            const isSong = picked.item_type === 'song';

            if (!isTopic && !isSong && videoRegex.test(picked.title)) {
              const cleanTitle = picked.title
                .replace(/\[.*?\]|\(.*?\)/g, ' ')
                .replace(videoRegex, ' ')
                .replace(/\s+/g, ' ')
                .trim();

              if (cleanTitle.length > 0) {
                try {
                  let searchArtist = picked.channel ? picked.channel.replace(/vevo/i, '').replace(/official/i, '').trim() : '';
                  const searchResults = await api.searchYouTube(`${cleanTitle} ${searchArtist}`, 'song');
                  if (searchResults && searchResults.length > 0) {
                    const candidateSong = searchResults[0];
                    const artistWords = searchArtist ? [...new Set(normalizeText(searchArtist).split(/\s+/).filter(w => w.length > 1))] : [];
                    if (doesCandidateMatchArtist(candidateSong, artistWords, searchArtist)) {
                      picked = candidateSong;
                    }
                  }
                } catch (err) {
                  console.error("Audio fallback search failed:", err);
                }
              }
            }

            if (picked) {
              const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
              setPlaylist(prev => [...prev, { ...picked, queueId, isEndlessGenerated: true }]);
            } else {
              setFailedEndlessFetch(true);
            }
          } else {
            setFailedEndlessFetch(true);
          }
        } catch (e) {
          console.error("Endless play fetch error:", e);
          setFailedEndlessFetch(true);
          setGlobalError(`Endless play mix failed to load: ${e.message || e}`);
        } finally {
          setIsFetchingEndless(false);
        }
      };

      fetchNext();
    }
  }, [currentIndex, playlist.length, isEndlessPlay, isFetchingEndless, failedEndlessFetch]);

  // Reset the failed state whenever the user manually plays a different song or adds a song
  useEffect(() => {
    setFailedEndlessFetch(false);
    if (playlist.length === 0) {
      mixCacheRef.current.clear();
    }
  }, [currentIndex, playlist.length, isEndlessPlay]);

  const handleLoadTrending = async (region) => {
    if (!navigator.onLine) {
      setGlobalError("No internet connection.");
      return;
    }
    setShowTrendingDropdown(false);
    setIsFetchingTrending(true);
    try {
      // Fetch exact real-time Kworb daily chart for Indonesia or Global
      const kworbTracks = await api.getKworbChart(region);
      if (!kworbTracks || kworbTracks.length === 0) {
        setGlobalError("Could not fetch Kworb Spotify chart. Please try again.");
        return;
      }

      const timestamp = Date.now();
      const rankedSongs = [];
      const uncachedTracks = [];

      // 1. Check local cache first for instant loading and re-ordering
      for (const track of kworbTracks) {
        const cached = getCachedVideo(track.query);
        if (cached) {
          rankedSongs.push({
            ...cached,
            queueId: (timestamp + track.rank).toString() + Math.random().toString(36).substr(2, 9),
            rank: track.rank
          });
        } else {
          uncachedTracks.push(track);
        }
      }

      // 2. Resolve any new/uncached tracks via YouTube search in parallel batches
      if (uncachedTracks.length > 0) {
        const batchSize = 5;
        for (let i = 0; i < uncachedTracks.length; i += batchSize) {
          const batch = uncachedTracks.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (track) => {
              try {
                const searchResults = await api.searchYouTube(track.query, 'song');
                if (searchResults && searchResults.length > 0) {
                  const targetArtist = track.artist || (track.query.includes(' - ') ? track.query.split(' - ')[0].trim() : '');
                  const targetTitle = track.title || (track.query.includes(' - ') ? track.query.split(' - ')[1].trim() : track.query.trim());
                  const artistWords = targetArtist ? [...new Set(normalizeText(targetArtist).split(/\s+/).filter(w => w.length > 1))] : [];
                  const individualArtists = targetArtist
                    ? targetArtist.split(/[,&/]|(?:\s+ft\.?\s+|\s+feat\.?\s+|\s+featuring\s+|\s+x\s+|\s+with\s+)/i).map(a => a.trim()).filter(Boolean)
                    : [];

                  // Filter out karaoke, derivatives, and tracks > 10 minutes (600s)
                  const cleanResults = searchResults.filter(r => {
                    if (isKaraokeOrDerivative(r.title, r.channel, track.query)) return false;
                    const durSec = parseDuration(r.duration);
                    if (durSec > 600) return false;
                    return true;
                  });

                  let bestVideo = null;

                  // Pass 1: Official track matching BOTH target artist AND target title
                  if (targetArtist && targetTitle) {
                    bestVideo = cleanResults.find(r => 
                      doesCandidateMatchArtist(r, artistWords, targetArtist) && 
                      doesCandidateMatchTitle(r, targetTitle)
                    );
                  }

                  // Pass 2: Candidate with artist in channel/title matching target title
                  if (!bestVideo && targetArtist && targetTitle) {
                    bestVideo = cleanResults.find(r => {
                      if (!doesCandidateMatchTitle(r, targetTitle)) return false;
                      const candNorm = normalizeText((r.title || '') + " " + (r.channel || ''));
                      return individualArtists.some(ind => {
                        const indNorm = normalizeText(ind).trim();
                        return indNorm.length >= 3 && candNorm.includes(indNorm);
                      });
                    });
                  }

                  // Pass 3: Candidate matching target title AND having artist connection
                  if (!bestVideo && targetTitle) {
                    bestVideo = cleanResults.find(r => {
                      if (!doesCandidateMatchTitle(r, targetTitle)) return false;
                      if (targetArtist && artistWords.length > 0) {
                        const candNorm = normalizeText((r.title || '') + " " + (r.channel || ''));
                        return artistWords.some(w => w.length >= 3 && candNorm.includes(w));
                      }
                      return true;
                    });
                  }

                  // Pass 4: Fallback only if no target artist was provided
                  if (!bestVideo && !targetArtist) {
                    bestVideo = cleanResults.length > 0 ? cleanResults[0] : searchResults[0];
                  }

                  if (bestVideo) {
                    setCachedVideo(track.query, bestVideo);
                    return {
                      ...bestVideo,
                      queueId: (timestamp + track.rank).toString() + Math.random().toString(36).substr(2, 9),
                      rank: track.rank
                    };
                  }
                }
              } catch (e) {
                console.error(`Failed to search YouTube for Kworb rank ${track.rank}:`, track.query, e);
              }
              return null;
            })
          );

          for (const item of batchResults) {
            if (item) rankedSongs.push(item);
          }
        }
      }

      if (rankedSongs.length > 0) {
        // Sort by rank to ensure 1..50 ordering
        rankedSongs.sort((a, b) => a.rank - b.rank);

        if (!savedPlaylist) {
          setSavedPlaylist([...playlist]);
        }
        setPlaylist(rankedSongs);
        setCurrentIndex(0);
        setIsAudioPlaying(true);
      } else {
        setGlobalError("Could not find matching videos on YouTube for trending chart.");
      }
    } catch (e) {
      console.error("Failed to fetch trending:", e);
      setGlobalError(`Failed to fetch trending music: ${e.message || e}`);
    } finally {
      setIsFetchingTrending(false);
    }
  };



  const handleImportPlaylist = async () => {
    if (!navigator.onLine) {
      setGlobalError("No internet connection.");
      return;
    }
    if (!importUrl.trim() || isImporting) return;
    
    setIsImporting(true);
    setImportProgress('');
    let errorMsg = null;
    try {
      const urlStr = importUrl.trim();
      if (urlStr.includes('youtube.com/playlist') || urlStr.includes('youtube.com/watch')) {
        // Extract list ID
        const match = urlStr.match(/[?&]list=([^&]+)/);
        if (match && match[1]) {
          const playlistId = match[1];
          const songs = await api.getYouTubePlaylist(playlistId, '');
          if (songs && songs.length > 0) {
            handleAddMultiple(songs);
            try {
              const pTitle = await api.getPlaylistTitle('youtube', playlistId);
              setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: pTitle, items: songs }]);
            } catch (err) {
              console.error("Failed to fetch youtube title", err);
              setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: "Imported YouTube Playlist", items: songs }]);
            }
            setSuccessMessage(`Imported ${songs.length} songs from YouTube playlist.`);
            setImportUrl('');
          } else {
            errorMsg = "Could not find any songs in this YouTube playlist. It might be private or empty.";
          }
        } else {
          errorMsg = "Invalid YouTube playlist URL.";
        }
      } else if (urlStr.includes('spotify.com/playlist/')) {
        // Extract Spotify playlist ID
        const match = urlStr.match(/playlist\/([a-zA-Z0-9]+)/);
        if (match && match[1]) {
          const playlistId = match[1];
          const spotifyTracks = await api.getSpotifyPlaylist(playlistId);
          if (spotifyTracks && spotifyTracks.length > 0) {
            const importedSongs = [];
            const failedSongs = [];
            
            for (let i = 0; i < spotifyTracks.length; i++) {
              const track = spotifyTracks[i];
              const songLabel = track.artist ? `${track.artist} - ${track.title}` : (track.title || track.query);
              setImportProgress(`Checking ${i + 1}/${spotifyTracks.length}...`);

              // 1. Check local cache first (instant, 0 requests to YouTube)
              const cached = getCachedVideo(track.query);
              if (cached) {
                importedSongs.push(cached);
                continue;
              }

              try {
                let results = await api.searchYouTube(track.query, 'song');
                if (!results) results = [];

                const artistWords = track.artist ? [...new Set(normalizeText(track.artist).split(/\s+/).filter(w => w.length > 1))] : [];
                const individualArtists = track.artist
                  ? track.artist.split(/[,&/]|(?:\s+ft\.?\s+|\s+feat\.?\s+|\s+featuring\s+|\s+x\s+|\s+with\s+)/i).map(a => a.trim()).filter(Boolean)
                  : [];

                // Check if any candidate in results genuinely matches BOTH requested title and artist
                const hasFullMatch = results.some(r => 
                  doesCandidateMatchTitle(r, track.title) && 
                  doesCandidateMatchArtist(r, artistWords, track.artist)
                );

                // If NO candidate matches both title and artist (e.g. Mariya Takeuchi - Plastic Love or Enishi no Ito
                // where the official track only exists as a video on YouTube),
                // query video results as well so the original track is picked!
                if (!hasFullMatch) {
                  try {
                    const videoResults = await api.searchYouTube(track.query, 'video');
                    if (videoResults && videoResults.length > 0) {
                      for (const vid of videoResults) {
                        if (!results.some(r => r.id === vid.id)) {
                          results.push(vid);
                        }
                      }
                    }
                  } catch (vErr) {
                    console.error("Video fallback search error:", vErr);
                  }
                }

                if (results && results.length > 0) {
                  // Trust YouTube Music's relevance ranking (preserved from Rust).
                  // Only skip karaoke/derivative/bad results — pick the first clean match.
                  const badWords = [
                    'karaoke', 'カラオケ', 'cover', 'instrumental', 'inst.', 'live', '8d', 
                    'remix', 'slowed', 'reverb', 'bass boosted',
                    'mashup', 'mash-up', 'mash up', 'bootleg', 'flip', 'sped up', 'speed up', 'nightcore',
                    '弾いてみた', '歌ってみた', '演奏してみた', '叩いてみた', '弾いてみ', '歌ってみ',
                    '【ベース】', '[ベース]', 'ベースで', 'ベーシスト',
                    '【ギター】', '[ギター]', 'ギターで', 'ギタリスト',
                    '【ドラム】', '[ドラム]', 'ドラマー',
                    '【ピアノ】', '[ピアノ]',
                    'tab譜', 'タブ譜',
                    'bass cover', 'guitar cover', 'drum cover', 'piano cover', 'vocal cover',
                    'play along', 'playalong', 'how to play', 'tutorial', 'lesson', 'fingerstyle',
                    'amateur cover', 'fan cover'
                  ];

                  const queryNorm = normalizeText(track.query);
                  let bestVideo = null;

                  // Filter out karaoke and obvious bad words first
                  const cleanResults = results.filter(r => {
                    if (isKaraokeOrDerivative(r.title, r.channel, track.query)) return false;
                    const rawText = normalizeText((r.title || '') + " " + (r.channel || ''));
                    return !badWords.some(bw => rawText.includes(bw) && !queryNorm.includes(bw));
                  });

                  // Pass 1: Official track by the expected artist matching BOTH title AND artist!
                  bestVideo = cleanResults.find(r => 
                    doesCandidateMatchArtist(r, artistWords, track.artist) && 
                    doesCandidateMatchTitle(r, track.title)
                  );

                  // Pass 2: Candidate whose title or channel contains any of the target artists AND matches target title
                  if (!bestVideo && track.artist) {
                    bestVideo = cleanResults.find(r => {
                      if (!doesCandidateMatchTitle(r, track.title)) return false;
                      const candNorm = normalizeText((r.title || '') + " " + (r.channel || ''));
                      return individualArtists.some(ind => {
                        const indNorm = normalizeText(ind).trim();
                        return indNorm.length >= 3 && candNorm.includes(indNorm);
                      });
                    });
                  }

                  // Pass 3: Candidate matching target title AND having artist connection (never pick an unrelated artist)
                  if (!bestVideo) {
                    bestVideo = cleanResults.find(r => {
                      if (!doesCandidateMatchTitle(r, track.title)) return false;
                      if (track.artist && artistWords.length > 0) {
                        const candNorm = normalizeText((r.title || '') + " " + (r.channel || ''));
                        return artistWords.some(w => w.length >= 3 && candNorm.includes(w));
                      }
                      return true;
                    });
                  }

                  // Pass 4: Fallback only if no artist was specified
                  if (!bestVideo && !track.artist) {
                    bestVideo = cleanResults.length > 0 ? cleanResults[0] : results[0];
                  }

                  if (bestVideo) {
                    setCachedVideo(track.query, bestVideo);
                    importedSongs.push(bestVideo);
                  } else {
                    failedSongs.push(songLabel);
                  }
                } else {
                  failedSongs.push(songLabel);
                }
              } catch (e) {
                console.error("Failed to search track:", track.query, e);
                failedSongs.push(songLabel);
              }
              
              // Safe pacing between network requests to prevent HTTP 429 rate limiting
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            if (importedSongs.length > 0) {
              handleAddMultiple(importedSongs);
              try {
                const pTitle = await api.getPlaylistTitle('spotify', playlistId);
                setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: pTitle, items: importedSongs }]);
              } catch (err) {
                console.error("Failed to fetch spotify title", err);
                setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: "Imported Spotify Playlist", items: importedSongs }]);
              }
              let msg = `Imported ${importedSongs.length} out of ${spotifyTracks.length} songs from Spotify.`;
              setSuccessMessage({
                text: msg,
                failedSongs: failedSongs
              });
              setImportUrl('');
            } else {
              errorMsg = "Could not find any playable matching songs. Error from first track: " + (failedSongs[0] || "Unknown");
            }
          } else {
            errorMsg = "Could not find any songs in this Spotify playlist. It might be private or empty.";
          }
        } else {
          errorMsg = "Invalid Spotify playlist URL.";
        }
      } else {
        errorMsg = "Please enter a valid YouTube or Spotify playlist URL.";
      }
    } catch (e) {
      console.error("Import failed:", e);
      errorMsg = `Failed to import playlist: ${e.toString()}`;
    } finally {
      setIsImporting(false);
      if (errorMsg) {
        setGlobalError(errorMsg);
      }
    }
  };




  return {
    isFetchingEndless,
    failedEndlessFetch,
    setFailedEndlessFetch,
    isImporting,
    importProgress,
    importUrl,
    setImportUrl,
    isFetchingTrending,
    trendingType,
    setTrendingType,
    handleImportPlaylist,
    handleLoadTrending
  };
}
