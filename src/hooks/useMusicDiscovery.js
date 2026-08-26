import { useState, useEffect } from 'react';
import { api } from '../services/api';

export const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
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
  setIsAudioPlaying
}) {
  const [isFetchingEndless, setIsFetchingEndless] = useState(false);
  const [failedEndlessFetch, setFailedEndlessFetch] = useState(false);
  
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importUrl, setImportUrl] = useState('');

  const [isFetchingTrending, setIsFetchingTrending] = useState(false);
  const [trendingType, setTrendingType] = useState(null);

  useEffect(() => {
    if (isEndlessPlay && playlist.length > 0 && currentIndex === playlist.length - 1 && !isFetchingEndless && !failedEndlessFetch) {
      const fetchNext = async () => {
        if (!navigator.onLine) {
          setFailedEndlessFetch(true);
          setGlobalError("No internet connection.");
          return;
        }
        setIsFetchingEndless(true);
        try {
          const current = playlist[currentIndex];
          let seedId = current.id;
          
          // YouTube's "Topic" auto-generated tracks often have poor recommendation seeds
          // that drift into unrelated genres. If the current song is a Topic track, 
          // search for its official video counterpart to seed a much better mix.
          if (current.channel && current.channel.toLowerCase().includes('- topic')) {
            try {
              const cleanArtist = current.channel.replace(/- topic/i, '').trim();
              const searchResults = await api.searchYouTube(`${current.title} ${cleanArtist}`);
              if (searchResults && searchResults.length > 0) {
                // Find the first result that is NOT a topic channel to use as the seed
                const officialVideo = searchResults.find(v => !(v.channel || '').toLowerCase().includes('- topic')) || searchResults[0];
                seedId = officialVideo.id;
              }
            } catch (e) {
              console.error("Failed to fetch official video for mix seed:", e);
            }
          }

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
            let finalPicked = null;

            // Prioritize official Topic or Vevo channels to avoid lyric videos / unofficial covers
            available.sort((a, b) => {
              const aOfficial = (a.channel || '').toLowerCase().includes('- topic') || (a.channel || '').toLowerCase().includes('vevo');
              const bOfficial = (b.channel || '').toLowerCase().includes('- topic') || (b.channel || '').toLowerCase().includes('vevo');
              if (aOfficial && !bOfficial) return -1;
              if (!aOfficial && bOfficial) return 1;
              return 0;
            });
            
            for (let item of available) {
              let picked = item;
              
              // If the recommended song is a "video" or "lyric" version, try to find the official audio version
              const unofficialRegex = /(official video|music video|official hd video|official music video|\bvideo\b|lirik|lyrics|lyric|cover|live)/i;
              const isTopic = (picked.channel || '').toLowerCase().includes('- topic');
              
              if (!isTopic && unofficialRegex.test(picked.title)) {
                // Clean the title by removing bracketed stuff and the unofficial keywords
                const cleanTitle = picked.title
                  .replace(/\[.*?\]|\(.*?\)/g, ' ')
                  .replace(unofficialRegex, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                  
                if (cleanTitle.length > 0) {
                  try {
                    // Search for the clean title + artist + 'topic' to find the official audio
                    let searchArtist = picked.channel ? picked.channel.replace(/vevo/i, '').replace(/official/i, '').trim() : '';
                    const searchResults = await api.searchYouTube(`${cleanTitle} ${searchArtist} topic`);
                    if (searchResults && searchResults.length > 0) {
                      picked = searchResults[0];
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
                finalPicked = picked;
                break;
              }
            }
            
            // If somehow all mapped to existing songs, fallback to the original first suggestion
            if (!finalPicked) {
              finalPicked = available[0];
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
          setGlobalError("Endless play mix failed to load. Please check your connection.");
        } finally {
          setIsFetchingEndless(false);
        }
      };
      
      fetchNext();
    }
  }, [currentIndex, playlist.length, isEndlessPlay, isFetchingEndless, failedEndlessFetch]);

  // Reset the failed state whenever the user manually plays a different song or adds a song


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
                const searchResults = await api.searchYouTube(track.query, null);
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
              setImportProgress(`Checking ${i + 1}/${spotifyTracks.length}...`);
              try {
                const results = await api.searchYouTube(track.query, null);
                if (results && results.length > 0) {
                  const spotifyDur = track.duration_ms / 1000;
                  const normalize = (str) => str.toLowerCase().replace(/[^\w\s\u3040-\u30ff\u4e00-\u9faf]/gi, ' ');
                  const queryWords = [...new Set(normalize(track.query).split(/\s+/).filter(w => w.length > 1))];
                  
                  const badWords = ['karaoke', 'カラオケ', 'cover', 'instrumental', 'inst.', 'live', '8d', 'remix', 'slowed', 'reverb', 'bass boosted'];
                  
                  let validResults = results.map((r, index) => {
                      const ytText = normalize(r.title + " " + r.channel);
                      let missingWords = 0;
                      for (const word of queryWords) {
                          if (!ytText.includes(word)) missingWords++;
                      }
                      
                      let hasBadWord = false;
                      for (const badWord of badWords) {
                          if (ytText.includes(badWord) && !normalize(track.query).includes(badWord)) {
                              hasBadWord = true;
                              break;
                          }
                      }
                      
                      let officialBonus = 0;
                      if (ytText.includes('official') || ytText.includes('topic') || ytText.includes('mv') || ytText.includes('music video')) {
                          officialBonus = 40; // 40 seconds leniency for official uploads (to account for MV intros/outros)
                      }
                      
                      const durationDiff = Math.abs(parseDuration(r.duration) - spotifyDur);
                      
                      // YouTube's search is very smart (it knows Japanese translations, etc.).
                      // We add a penalty for lower-ranked search results (15 secs per rank position)
                      // so we don't accidentally pick the 9th result just because its duration matched closer.
                      const rankPenalty = index * 15;
                      
                      const score = durationDiff + (missingWords * 2) + rankPenalty - officialBonus;
                      
                      return {
                          ...r,
                          durationDiff,
                          score,
                          hasBadWord
                      };
                  });

                  // Completely filter out fake/instrumental/karaoke versions unless requested
                  validResults = validResults.filter(r => !r.hasBadWord).sort((a, b) => a.score - b.score);

                  let bestVideo = null;
                  let lastError = null;
                  for (const v of validResults.slice(0, 3)) {
                      try {
                          await api.getStreamUrl(v.id);
                          bestVideo = v;
                          break;
                      } catch (e) {
                          lastError = e;
                          console.log(`Video ${v.id} blocked/premium, trying next...`, e);
                      }
                  }
                  
                  if (bestVideo) {
                    importedSongs.push(bestVideo);
                  } else {
                    failedSongs.push(track.query + " (" + (lastError ? lastError.toString() : "unknown") + ")");
                  }
                } else {
                  failedSongs.push(track.query);
                }
              } catch (e) {
                console.error("Failed to search track:", track.query, e);
                failedSongs.push(track.query);
              }
              
              // THROTTLING: Add a 1.5-second delay between each track to prevent 
              // flooding YouTube and getting IP banned (HTTP 429 Too Many Requests).
              await new Promise(resolve => setTimeout(resolve, 1500));
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
              if (failedSongs.length > 0) {
                msg += ` Failed to import ${failedSongs.length} songs (premium/blocked).`;
              }
              setSuccessMessage(msg);
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
