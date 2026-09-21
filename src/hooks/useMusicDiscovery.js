import { useState, useEffect } from 'react';
import { api } from '../services/api';

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

export const doesCandidateMatchArtist = (candidate, artistWords, rawArtist) => {
  if (!artistWords || artistWords.length === 0) return true;
  if (!candidate) return false;

  const rawChannel = (candidate.channel || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').trim();
  const channelNorm = normalizeText(rawChannel);

  // 1. Channel match (applies to both songs and official video channels)
  const matchedInChannel = artistWords.filter(w => channelNorm.includes(w)).length;
  if (matchedInChannel >= Math.ceil(artistWords.length * 0.6)) {
    return true;
  }
  if (rawArtist && channelNorm.includes(normalizeText(rawArtist).trim())) {
    return true;
  }

  // 2. For songs: in YouTube Music, the artist is ALWAYS the channel.
  // If channel didn't match, this song is a cover / different artist.
  // Notes in title (e.g. "(Mariya Takeuchi 1984)" or "(Cover)") are NOT the performer!
  if (candidate.item_type === 'song') {
    return false;
  }

  // 3. For videos only: YouTube video titles often follow "Artist - Title" format
  const cleanTitle = cleanTitleForArtistMatch(candidate.title);
  const parts = cleanTitle.split(/\s*[-–—:]\s*/);
  if (parts.length >= 2) {
    const firstPart = parts[0];
    // Check if the prefix is "OtherArtist ft. TargetArtist" (e.g. "2Pac ft. Mariya Takeuchi")
    // In that case, the lead artist is OtherArtist, NOT the target artist!
    const ftMatch = firstPart.match(/^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.*)$/i);
    if (ftMatch) {
      const leadArtistNorm = normalizeText(ftMatch[1]);
      const leadMatches = artistWords.filter(w => leadArtistNorm.includes(w)).length;
      if (leadMatches < Math.ceil(artistWords.length * 0.6)) {
        return false;
      }
    }

    const firstPartNorm = normalizeText(firstPart);
    const matchedInFirst = artistWords.filter(w => firstPartNorm.includes(w)).length;
    if (matchedInFirst >= Math.ceil(artistWords.length * 0.6)) {
      return true;
    }
  }

  const titleNorm = normalizeText(cleanTitle);
  if (artistWords.every(w => titleNorm.includes(w))) {
    return true;
  }

  return false;
};

export const doesCandidateMatchTitle = (candidate, expectedTitle) => {
  if (!expectedTitle || !candidate) return false;

  const cleanExpected = cleanTitleForArtistMatch(expectedTitle).trim();
  const cleanCand = cleanTitleForArtistMatch(candidate.title || '').trim();

  const normExpected = normalizeText(cleanExpected);
  const normCand = normalizeText(cleanCand);

  // 1. Direct match with clean expected title (e.g. "縁の糸")
  if (cleanExpected && (candidate.title || '').includes(cleanExpected)) {
    return true;
  }
  if (normExpected && normCand && (normCand.includes(normExpected) || normExpected.includes(normCand))) {
    return true;
  }

  // 2. Check parenthetical reading / alternate title if present (e.g. "えにし")
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

  // 3. Check word overlap for multi-word titles
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
    return cache[normalizedKey] || null;
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
          const current = playlist[currentIndex];
          const seedId = current.id;
          const results = await api.getYouTubeMix(seedId);
          
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

          const extractArtistFingerprint = (song) => {
            if (!song) return { clean: '', channelClean: '' };
            const title = (song.title || '').toLowerCase();
            const channel = (song.channel || '').toLowerCase()
              .replace(/\s*-\s*topic$/i, '')
              .replace(/vevo$/i, '')
              .replace(/official(\s+channel|\s+music)?$/i, '')
              .trim();

            let artistCandidate = '';
            if (title.includes(' - ')) {
              artistCandidate = title.split(' - ')[0].trim();
            } else if (title.includes(' ~ ')) {
              artistCandidate = title.split(' ~ ')[0].trim();
            } else {
              artistCandidate = channel;
            }

            const clean = str => str
              .replace(/\(.*?\)|\[.*?\]/g, ' ')
              .replace(/\b(feat|ft|featuring|with|prod|x)\b.*$/i, ' ')
              .replace(/[^a-z0-9]/gi, '')
              .toLowerCase();

            return {
              clean: clean(artistCandidate),
              channelClean: clean(channel)
            };
          };

          const isSameArtist = (songA, songB) => {
            if (!songA || !songB) return false;
            const a = extractArtistFingerprint(songA);
            const b = extractArtistFingerprint(songB);

            if (a.clean && b.clean && a.clean === b.clean) return true;
            if (a.channelClean && b.channelClean && a.channelClean === b.channelClean) return true;
            if (a.clean && b.channelClean && a.clean === b.channelClean) return true;
            if (a.channelClean && b.clean && a.channelClean === b.clean) return true;

            if (a.clean.length > 3 && b.clean.length > 3) {
              if (a.clean.includes(b.clean) || b.clean.includes(a.clean)) return true;
            }
            if (a.channelClean.length > 3 && b.channelClean.length > 3) {
              if (a.channelClean.includes(b.channelClean) || b.channelClean.includes(a.channelClean)) return true;
            }
            if (a.clean.length > 3 && b.channelClean.length > 3) {
              if (a.clean.includes(b.channelClean) || b.channelClean.includes(a.clean)) return true;
            }
            if (a.channelClean.length > 3 && b.clean.length > 3) {
              if (a.channelClean.includes(b.clean) || b.clean.includes(a.channelClean)) return true;
            }

            return false;
          };

          const existingIds = new Set(playlist.map(s => s.id));
          const existingWordSets = playlist.map(s => getWords(s));
          
          let available = results.filter(v => {
            if (existingIds.has(v.id)) return false;
            
            const vWords = getWords(v);
            for (let existingSet of existingWordSets) {
              if (calculateSimilarity(vWords, existingSet) > 0.55) {
                return false; // Semantic duplicate found
              }
            }
            return true;
          });
          
          if (available.length === 0) {
            console.log("Primary mix empty or all duplicates. Attempting fallback...");
            try {
              let cleanArtist = current.channel ? current.channel.replace(/- topic/i, '').replace(/vevo/i, '').trim() : '';
              let fallbackQuery = cleanArtist ? `${cleanArtist} songs` : `${current.title} cover`;
              
              let fallbackResults = await api.searchYouTube(fallbackQuery);
              available = fallbackResults.filter(v => {
                if (existingIds.has(v.id)) return false;
                const vWords = getWords(v);
                for (let existingSet of existingWordSets) {
                  if (calculateSimilarity(vWords, existingSet) > 0.55) return false;
                }
                return true;
              });

              if (available.length === 0 && playlist.length > 1) {
                 // Final fallback: try mixing from the previous song
                 const prevSong = playlist[currentIndex - 1];
                 const prevResults = await api.getYouTubeMix(prevSong.id);
                 available = prevResults.filter(v => !existingIds.has(v.id));
              }
            } catch (fallbackErr) {
              console.error("Endless play fallback failed:", fallbackErr);
            }
          }
          
          if (available.length > 0) {
            const videoRegex = /(official video|music video|official hd video|official music video|\bvideo\b|lirik|lyrics|lyric|cover|live)/i;
            available.sort((a, b) => {
              const aIsSong = a.item_type === 'song' || (!videoRegex.test(a.title) && a.item_type !== 'video');
              const bIsSong = b.item_type === 'song' || (!videoRegex.test(b.title) && b.item_type !== 'video');
              if (aIsSong && !bIsSong) return -1;
              if (!aIsSong && bIsSong) return 1;
              return 0;
            });

            let finalPicked = null;
            let fallbackCandidate = null;

            // Look at the last 7 tracks to prevent same artist repeats within 6-7 tracks
            const recentHistory = playlist.slice(Math.max(0, currentIndex - 6), currentIndex + 1);

            for (let item of available) {
              let picked = item;
              
              // If the recommended track is explicitly a video or lyric version, try to find the official song audio version
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
                      // Only replace if the candidate song is genuinely by the same artist
                      if (doesCandidateMatchArtist(candidateSong, artistWords, searchArtist)) {
                        picked = candidateSong;
                      }
                    }
                  } catch (err) {
                    console.error("Audio fallback search failed:", err);
                  }
                }
              }
              
              // Check if the final ID and signature are already in the playlist
              let isDuplicate = false;
              if (existingIds.has(picked.id)) {
                isDuplicate = true;
              } else {
                const pickedWords = getWords(picked);
                for (let existingSet of existingWordSets) {
                  if (calculateSimilarity(pickedWords, existingSet) > 0.55) {
                    isDuplicate = true;
                    break;
                  }
                }
              }
              
              if (!isDuplicate) {
                // Check if artist appeared in the last 7 tracks
                const hasRecentConflict = recentHistory.some(historyTrack => isSameArtist(picked, historyTrack));
                
                if (!hasRecentConflict) {
                  finalPicked = picked;
                  break;
                } else if (!fallbackCandidate && !isSameArtist(picked, current)) {
                  // Keep as fallback only if it's not the immediately preceding song
                  fallbackCandidate = picked;
                }
              }
            }
            
            // If every available song had an artist conflict, use fallback candidate or first available
            if (!finalPicked) {
              finalPicked = fallbackCandidate || available[0];
            }
            
            if (finalPicked) {
              const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
              setPlaylist(prev => [...prev, { ...finalPicked, queueId }]);
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
                  const bestMatch = searchResults[0];
                  setCachedVideo(track.query, bestMatch);
                  return {
                    ...bestMatch,
                    queueId: (timestamp + track.rank).toString() + Math.random().toString(36).substr(2, 9),
                    rank: track.rank
                  };
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
                  const spotifyDur = track.duration_ms / 1000;
                  const queryWords = [...new Set(normalizeText(track.query).split(/\s+/).filter(w => w.length > 1))];
                  
                  const badWords = [
                    'karaoke', 'カラオケ', 'cover', 'instrumental', 'inst.', 'live', '8d', 
                    'remix', 'slowed', 'reverb', 'bass boosted',
                    'mashup', 'mash-up', 'mash up', 'bootleg', 'flip', 'sped up', 'speed up', 'nightcore'
                  ];
                  
                  let validResults = results.map((r, index) => {
                      const ytCleanText = normalizeText(cleanTitleForArtistMatch(r.title) + " " + (r.channel || ''));
                      let missingWords = 0;
                      for (const word of queryWords) {
                          if (!ytCleanText.includes(word)) missingWords++;
                      }
                      
                      const rawText = normalizeText((r.title || '') + " " + (r.channel || ''));
                      let hasBadWord = false;
                      for (const badWord of badWords) {
                          if (rawText.includes(badWord) && !normalizeText(track.query).includes(badWord)) {
                              hasBadWord = true;
                              break;
                          }
                      }

                      // Check if candidate matches the target artist and title
                      const artistMatched = doesCandidateMatchArtist(r, artistWords, track.artist);
                      const titleMatched = doesCandidateMatchTitle(r, track.title);

                      // Check if title is a mashup/feat where lead artist is someone else (e.g. "2Pac ft. Mariya Takeuchi")
                      const rawLower = (r.title || '').toLowerCase();
                      let ftLeadPenalty = 0;
                      const hyphenIdx = rawLower.indexOf(' - ');
                      if (hyphenIdx !== -1) {
                        const prefix = rawLower.slice(0, hyphenIdx);
                        if (prefix.includes(' ft. ') || prefix.includes(' ft ') || prefix.includes(' feat. ') || prefix.includes(' feat ')) {
                          const ftSplit = prefix.split(' ft')[0].split(' feat')[0];
                          if (!artistWords.some(w => ftSplit.includes(w))) {
                            ftLeadPenalty = 500;
                          }
                        }
                      }

                      // Penalties for mismatches:
                      // - Wrong artist: +500 (covers or wrong artists)
                      // - Wrong title: +500 (completely different song by the same artist!)
                      // - Lead artist mismatch: +500 (other artist featuring target artist)
                      const artistPenalty = artistMatched ? 0 : 500;
                      const titlePenalty = titleMatched ? 0 : 500;

                      // Among candidates of the SAME song and artist:
                      // Song gets bonus (-30) over video (+10)
                      const isSong = r.item_type === 'song';
                      const typeScore = isSong ? -30 : 10;
                      
                      const durationDiff = Math.abs(parseDuration(r.duration) - spotifyDur);
                      const rankPenalty = index * 3;
                      const score = artistPenalty + titlePenalty + ftLeadPenalty + typeScore + durationDiff + (missingWords * 5) + rankPenalty;
                      
                      return {
                          ...r,
                          artistMatched,
                          titleMatched,
                          durationDiff,
                          score,
                          hasBadWord
                      };
                  });

                  // Completely filter out fake/instrumental/karaoke versions unless requested
                  validResults = validResults.filter(r => !r.hasBadWord).sort((a, b) => a.score - b.score);

                  const bestVideo = validResults.length > 0 ? validResults[0] : results[0];
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
