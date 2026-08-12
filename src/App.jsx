import React, { useState, useEffect, useRef, useMemo } from 'react';
import Player from './components/Player';
import Search from './components/Search';
import Playlist from './components/Playlist';
import { Music2, Sun, Moon, Palette, Search as SearchIcon, X, Minus, Square, Infinity, Disc, Trash2, Save, FolderOpen, FolderPlus, AlertTriangle, ListMusic, TrendingUp, Globe, ArrowLeft, Loader2, Download, CheckCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import './App.css';


const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
};

const basePanelStyle = { margin: '0 auto 8px auto', maxWidth: '800px', width: 'calc(100% - 16px)', borderRadius: '16px' };
const topPanelStyle = { ...basePanelStyle, position: 'relative', flex: 'none' };
const bottomPanelStyle = { ...basePanelStyle, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 };

const staticStyles = {
  headerBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', boxShadow: '0 1px 0 0 var(--panel-border)' },
  headerTitle: {
    fontWeight: 'bold',
    fontSize: '0.9rem',
    color: 'var(--text-main)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    whiteSpace: 'nowrap'
  },
  headerLoading: { fontSize: '0.8rem', color: 'var(--accent-color)' },
  headerIcons: {
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
    flex: 1,
    overflow: 'visible'
  },
  iconBtn: { padding: '6px' },
  iconBtnDanger: { padding: '6px', color: '#ef4444' },
  separator: { width: '2px', height: '24px', background: 'var(--panel-border)', margin: '0 2px', borderRadius: '1px', flexShrink: 0 },
  appLayout: { display: 'flex', flex: 1, overflow: 'hidden' },
  playlistContainer: { flex: 1, overflow: 'hidden' },
  searchContainer: { padding: '16px', height: '100%', display: 'flex', flex: 1, minHeight: 0 }
};

function App() {
  const appWindow = getCurrentWindow();
  const [theme, setTheme] = useState(() => localStorage.getItem('nadanada-theme') || 'nox-noir');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isVideoHidden, setIsVideoHidden] = useState(false);
  const isMaximizedRef = useRef(false);

  useEffect(() => {
    // Sync initial maximized state (no animation needed on load)
    appWindow.isMaximized().then(v => {
      isMaximizedRef.current = v;
      setIsMaximized(v);
    }).catch(() => {});

    let debounceTimer = null;
    let showTimer = null;

    const unlisten = appWindow.onResized(async () => {
      // Debounce: onResized fires repeatedly during the Windows maximize/restore
      // animation. Wait until resize events stop before acting so we never
      // switch the layout mid-animation.
      clearTimeout(debounceTimer);
      clearTimeout(showTimer);

      debounceTimer = setTimeout(async () => {
        try {
          const maximized = await appWindow.isMaximized();
          if (maximized === isMaximizedRef.current) return; // not a maximize change

          // Step 1 — hide video now (synchronous state update)
          setIsVideoHidden(true);

          // Step 2 — wait two animation frames so the hide actually paints
          // before we touch the layout (double-rAF = guaranteed post-paint)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              isMaximizedRef.current = maximized;
              setIsMaximized(maximized);

              // Step 3 — reveal video after the new layout has settled
              showTimer = setTimeout(() => setIsVideoHidden(false), 250);
            });
          });
        } catch {}
      }, 150); // 150ms debounce — longer than Windows Aero animation (~100ms)
    });

    return () => {
      unlisten.then(f => f()).catch(() => {});
      clearTimeout(debounceTimer);
      clearTimeout(showTimer);
    };
  }, []);

  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [playlist, setPlaylist] = useState(() => {
    try {
      const saved = localStorage.getItem('nadanada-session-playlist');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to parse session playlist:', e);
      return [];
    }
  });
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = localStorage.getItem('nadanada-session-index');
    const parsed = saved ? parseInt(saved, 10) : 0;
    return isNaN(parsed) ? 0 : parsed;
  });
  const [showSearch, setShowSearch] = useState(false);
  const [isEndlessPlay, setIsEndlessPlay] = useState(false);
  const [isFetchingEndless, setIsFetchingEndless] = useState(false);
  const [isFetchingTrending, setIsFetchingTrending] = useState(false);
  const [showTrendingDropdown, setShowTrendingDropdown] = useState(false);
  const [savedPlaylist, setSavedPlaylist] = useState(null);
  const [failedEndlessFetch, setFailedEndlessFetch] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [globalError, setGlobalError] = useState(null);
  
  const [showDownloadedList, setShowDownloadedList] = useState(false);
  const [downloadedSongs, setDownloadedSongs] = useState([]);
  const [downloadingSongId, setDownloadingSongId] = useState(null);
  
  // Derive Set so it maintains a stable reference unless the actual song IDs change
  const downloadedIdsStr = downloadedSongs.map(s => s.id).sort().join(',');
  const downloadedIds = useMemo(() => new Set(downloadedSongs.map(s => s.id)), [downloadedIdsStr]);
  
  const [successMessage, setSuccessMessage] = useState(null);
  
  useEffect(() => {
    if (showDownloadedList) {
      loadDownloadedSongs();
    }
  }, [showDownloadedList]);

  const loadDownloadedSongs = async () => {
    try {
      const songs = await invoke('get_downloaded_songs');
      setDownloadedSongs(prev => {
        if (prev.length === songs.length && prev.every((s, i) => s.id === songs[i].id)) return prev;
        return songs;
      });
    } catch (e) {
      console.error('Failed to load downloaded songs:', e);
    }
  };

  useEffect(() => {
    loadDownloadedSongs();
    const interval = setInterval(loadDownloadedSongs, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDownloadSong = async (song) => {
    if (downloadingSongId) return; // Prevent multiple simultaneous downloads
    setDownloadingSongId(song.id);
    
    try {
      let title = song.title.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/official|music|video|audio|hd|hq|lyrics/ig, ' ').replace(/\s+/g, ' ').trim();
      let artist = '';
      
      const parts = title.split('-');
      if (parts.length > 1) {
          artist = parts[0].trim();
          title = parts[1].trim();
      } else {
          artist = song.channel ? song.channel.replace(/ - Topic/i, '').trim() : 'Unknown';
      }
      await invoke('download_song', { id: song.id, title, artist });
      
      if (showDownloadedList) {
        loadDownloadedSongs();
      }
      setDownloadedSongs(prev => {
        if (prev.find(s => s.id === song.id)) return prev;
        return [...prev, { id: song.id, file_path: '' }]; // Optimistic update
      });
      
    } catch (e) {
      console.error('Download failed:', e);
      setGlobalError(`Failed to download song: ${e.toString()}`);
    } finally {
      setDownloadingSongId(null);
    }
  };
  
  // Chords state
  const [showChords, setShowChords] = useState(false);
  const [chordsData, setChordsData] = useState(null);
  const [isFetchingChords, setIsFetchingChords] = useState(false);
  const isFetchingChordsRef = useRef(false);
  const [chordsError, setChordsError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0);
  const [transposeOffset, setTransposeOffset] = useState(0);
  const [showClearPrompt, setShowClearPrompt] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [showLoadPrompt, setShowLoadPrompt] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [savePlaylistName, setSavePlaylistName] = useState('');
  const [savedPlaylists, setSavedPlaylists] = useState(() => {
    try {
      const saved = localStorage.getItem('nadanada-saved-playlists');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to parse saved playlists:', e);
      return [];
    }
  });

  const trendingRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (trendingRef.current && !trendingRef.current.contains(event.target)) {
        setShowTrendingDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('nadanada-session-playlist', JSON.stringify(playlist));
      localStorage.setItem('nadanada-session-index', currentIndex.toString());
    }, 500);
    return () => clearTimeout(timer);
  }, [playlist, currentIndex]);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('nadanada-saved-playlists', JSON.stringify(savedPlaylists));
    }, 500);
    return () => clearTimeout(timer);
  }, [savedPlaylists]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nadanada-theme', theme);
  }, [theme]);

  useEffect(() => {
    const unlisten = listen('close-requested', () => {
      setShowClosePrompt(true);
    });
    
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // audioSpectrum state moved to Visualizer component for performance

  const toggleTheme = () => {
    const themes = [
      'lavender-steel', 
      'mahogany-dusk', 
      'tidal-sage', 
      'sangria-deep', 
      'midnight-static',
      'obsidian-root',
      'nox-noir',
      'crimson-night'
    ];
    const currentThemeIndex = themes.indexOf(theme);
    const nextIndex = (currentThemeIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const currentSong = playlist[currentIndex] || null;
  const [artistFact, setArtistFact] = useState('');
  
  useEffect(() => {
    if (currentSong) {
      const savedSync = localStorage.getItem(`sync_${currentSong.id}`);
      setSyncOffset(savedSync ? parseFloat(savedSync) : 0);
      
      const savedTranspose = localStorage.getItem(`transpose_${currentSong.id}`);
      setTransposeOffset(savedTranspose ? parseInt(savedTranspose, 10) : 0);
      
      if (showChords && isAudioPlaying && (!chordsData || chordsData._songId !== currentSong.id) && !isFetchingChordsRef.current) {
        const fetchChords = async () => {
          isFetchingChordsRef.current = true;
          setIsFetchingChords(true);
          setChordsError(null);
          try {
            // Append the channel/artist name to the title so Google finds the exact artist's version
            let searchTitle = currentSong.title;
            if (currentSong.channel) {
              const cleanChannel = currentSong.channel.replace(/ - Topic/i, '').trim();
              searchTitle = `${searchTitle} ${cleanChannel}`;
            }
            const res = await invoke('scrape_chords', { id: currentSong.id, title: searchTitle });
            const parsed = JSON.parse(res);
            if (parsed.success) {
              const chordsList = parsed.data.chords;
              if (chordsList && chordsList.length > 0) {
                const lastChordTime = chordsList[chordsList.length - 1].time_sec;
                const videoDuration = parseDuration(currentSong.duration);
                
                // Mismatch if chords extend past the video (meaning Chordify's version has a longer intro/body)
                const isTooLong = videoDuration > 0 && lastChordTime > videoDuration + 15;
                // Mismatch if chords end suspiciously early (e.g. they only cover less than 60% of the video length)
                const isTooShort = videoDuration > 0 && lastChordTime < videoDuration * 0.6;

                if (isTooLong || isTooShort) {
                  setChordsError(`Mismatched song version. Not found on Chordify.`);
                  setChordsData({ _songId: currentSong.id });
                } else {
                  setChordsData({ ...parsed.data, _songId: currentSong.id });
                }
              } else {
                setChordsData({ ...parsed.data, _songId: currentSong.id });
              }
            } else {
              setChordsError(parsed.error);
              setChordsData({ _songId: currentSong.id });
            }
          } catch (e) {
            setChordsError(e.toString());
            setChordsData({ _songId: currentSong.id });
          } finally {
            isFetchingChordsRef.current = false;
            setIsFetchingChords(false);
          }
        };
        fetchChords();
      } else if (!showChords) {
        setChordsData(null);
        setChordsError(null);
      }
    } else {
      setSyncOffset(0);
      setTransposeOffset(0);
      setChordsData(null);
      setChordsError(null);
    }
  }, [currentSong, showChords, isAudioPlaying]);

  useEffect(() => {
    if (!currentSong) {
      setArtistFact('');
      return;
    }
    
    const controller = new AbortController();
    const signal = controller.signal;

    const fetchFact = async () => {
      try {
        let artist = currentSong.channel ? currentSong.channel.replace(/ - Topic/i, '').trim() : '';
        if (!artist) {
            const parts = currentSong.title.split('-');
            if (parts.length > 1) {
                artist = parts[0].trim();
            } else {
                if (!signal.aborted) setArtistFact('');
                return;
            }
        }
        
        const suffixes = ['_(singer)', '_(musician)', '_(band)', ''];
        let factFound = false;
        
        for (const suffix of suffixes) {
            if (signal.aborted) return;
            const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artist + suffix)}`, { signal });
            if (res.ok) {
                const data = await res.json();
                if (data.extract) {
                    // Quick sanity check if we fell back to the raw artist name without suffix
                    if (suffix === '') {
                        const desc = (data.description || '').toLowerCase();
                        const ext = data.extract.toLowerCase();
                        if (!desc.includes('singer') && !desc.includes('band') && !desc.includes('musician') && !desc.includes('music') && 
                            !ext.includes('singer') && !ext.includes('band') && !ext.includes('musician') && !ext.includes('music') && !ext.includes('rapper') && !ext.includes('dj')) {
                            continue; // Likely not a musician, try next or fail
                        }
                    }

                    let firstSentence = data.extract.split('. ')[0];
                    if (!firstSentence.endsWith('.')) {
                        firstSentence += '.';
                    }
                    if (!signal.aborted) setArtistFact(firstSentence);
                    factFound = true;
                    break;
                }
            }
        }
        
        if (!factFound && !signal.aborted) {
            setArtistFact('');
        }
      } catch (e) {
        if (!signal.aborted) {
          setArtistFact('');
        }
      }
    };
    
    fetchFact();
    return () => controller.abort();
  }, [currentSong]);

  // Save sync and transpose offsets when changed
  useEffect(() => {
    if (currentSong) {
      if (syncOffset !== 0) {
        localStorage.setItem(`sync_${currentSong.id}`, syncOffset.toString());
      } else {
        localStorage.removeItem(`sync_${currentSong.id}`);
      }
      
      if (transposeOffset !== 0) {
        localStorage.setItem(`transpose_${currentSong.id}`, transposeOffset.toString());
      } else {
        localStorage.removeItem(`transpose_${currentSong.id}`);
      }
    }
  }, [syncOffset, transposeOffset, currentSong]);

  useEffect(() => {
    if (isEndlessPlay && playlist.length > 0 && currentIndex === playlist.length - 1 && !isFetchingEndless && !failedEndlessFetch) {
      const fetchNext = async () => {
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
              const searchResults = await invoke('search_youtube', { query: `${current.title} ${cleanArtist}` });
              if (searchResults && searchResults.length > 0) {
                // Find the first result that is NOT a topic channel to use as the seed
                const officialVideo = searchResults.find(v => !(v.channel || '').toLowerCase().includes('- topic')) || searchResults[0];
                seedId = officialVideo.id;
              }
            } catch (e) {
              console.error("Failed to fetch official video for mix seed:", e);
            }
          }

          const results = await invoke('get_youtube_mix', { videoId: seedId });
          
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
              
              let fallbackResults = await invoke('search_youtube', { query: fallbackQuery });
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
                 const prevResults = await invoke('get_youtube_mix', { videoId: prevSong.id });
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
                    const searchResults = await invoke('search_youtube', { query: `${cleanTitle} ${searchArtist} topic` });
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
  useEffect(() => {
    setFailedEndlessFetch(false);
  }, [currentIndex]);

  const handleLoadTrending = async (region) => {
    setShowTrendingDropdown(false);
    setShowSearch(false);
    if (isFetchingTrending) return;
    setIsFetchingTrending(true);
    try {
      const query = region === 'global' ? 'Top 50 Spotify Global' : 'Top 50 Spotify Indonesia';
      const results = await invoke('search_youtube', { query, searchType: 'album' });
      const playlistItem = results.find(v => v.is_playlist);
      if (playlistItem) {
        const songs = await invoke('get_youtube_playlist', { playlistId: playlistItem.id, firstVideoId: playlistItem.first_video_id || '' });
        if (songs && songs.length > 0) {
          const timestamp = Date.now();
          const rankedSongs = songs.slice(0, 50).map((song, idx) => ({
            ...song,
            queueId: (timestamp + idx).toString() + Math.random().toString(36).substr(2, 9),
            rank: idx + 1
          }));
          if (!savedPlaylist) {
            setSavedPlaylist([...playlist]);
          }
          setPlaylist(rankedSongs);
          setCurrentIndex(0);
          setIsAudioPlaying(true);
        }
      } else {
        setGlobalError("Could not find a trending playlist right now. Try again later.");
      }
    } catch (e) {
      console.error("Failed to fetch trending:", e);
      setGlobalError("Failed to fetch trending music. Please check your connection.");
    } finally {
      setIsFetchingTrending(false);
    }
  };

  const handleImportPlaylist = async () => {
    if (!importUrl.trim() || isImporting) return;
    
    setIsImporting(true);
    let errorMsg = null;
    try {
      const urlStr = importUrl.trim();
      if (urlStr.includes('youtube.com/playlist') || urlStr.includes('youtube.com/watch')) {
        // Extract list ID
        const match = urlStr.match(/[?&]list=([^&]+)/);
        if (match && match[1]) {
          const playlistId = match[1];
          const songs = await invoke('get_youtube_playlist', { playlistId, firstVideoId: '' });
          if (songs && songs.length > 0) {
            handleAddMultiple(songs);
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
          const spotifyTracks = await invoke('get_spotify_playlist', { playlistId });
          if (spotifyTracks && spotifyTracks.length > 0) {
            const importedSongs = [];
            const failedSongs = [];
            
            for (let i = 0; i < spotifyTracks.length; i++) {
              const track = spotifyTracks[i];
              setImportProgress(`Checking ${i + 1}/${spotifyTracks.length}...`);
              try {
                const results = await invoke('search_youtube', { query: track.query, searchType: null });
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
                          await invoke('get_stream_url', { videoId: v.id });
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


  const handleNext = () => {
    if (currentIndex < playlist.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleAddSong = (video) => {
    setFailedEndlessFetch(false);
    const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newSong = { ...video, queueId };
    if (savedPlaylist) {
      setSavedPlaylist(prev => [...prev, newSong]);
    } else {
      setPlaylist(prev => [...prev, newSong]);
    }
  };

  const handleAddMultiple = (videos) => {
    setFailedEndlessFetch(false);
    const timestamp = Date.now();
    const newSongs = videos.map((video, idx) => ({
      ...video,
      queueId: (timestamp + idx).toString() + Math.random().toString(36).substr(2, 9)
    }));
    setPlaylist(prev => [...prev, ...newSongs]);
    if (savedPlaylist) {
      setSavedPlaylist(prev => [...prev, ...newSongs]);
    }
  };

  const handleRemoveSong = (index) => {
    const isLast = index >= playlist.length - 1;
    setPlaylist(prev => {
      const newPlaylist = [...prev];
      newPlaylist.splice(index, 1);
      return newPlaylist;
    });
    setCurrentIndex(prev => {
      if (index < prev) {
        return prev - 1;
      } else if (index === prev && isLast) {
        return Math.max(0, prev - 1);
      }
      return prev;
    });
  };

  const handleReorder = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    
    setPlaylist(prev => {
      const newPlaylist = [...prev];
      const [movedItem] = newPlaylist.splice(fromIndex, 1);
      newPlaylist.splice(toIndex, 0, movedItem);
      return newPlaylist;
    });

    setCurrentIndex(prev => {
      if (prev === fromIndex) {
        return toIndex;
      } else if (fromIndex < prev && toIndex >= prev) {
        return prev - 1;
      } else if (fromIndex > prev && toIndex <= prev) {
        return prev + 1;
      }
      return prev;
    });
  };



const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS_TO_SHARPS = { 
  'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
  'D♭': 'C#', 'E♭': 'D#', 'G♭': 'F#', 'A♭': 'G#', 'B♭': 'A#',
  'Cb': 'B', 'C♭': 'B', 'Fb': 'E', 'F♭': 'E'
};
const SHARPS_MAP = {
  'C♯': 'C#', 'D♯': 'D#', 'E♯': 'F', 'F♯': 'F#', 'G♯': 'G#', 'A♯': 'A#', 'B♯': 'C'
};

function transposeChord(chord, semitones) {
  if (!chord || chord === 'N.C.' || chord === '') return chord;
  if (semitones === 0) return chord;
  
  const transposeSingle = (c) => {
    const match = c.match(/^([A-G][#b♯♭]?)(.*)$/);
    if (!match) return c;
    let root = match[1];
    const suffix = match[2];
    
    if (FLATS_TO_SHARPS[root]) root = FLATS_TO_SHARPS[root];
    if (SHARPS_MAP[root]) root = SHARPS_MAP[root];
    
    let index = NOTES.indexOf(root);
    if (index === -1) return c;
    
    let newIndex = (index + semitones) % 12;
    if (newIndex < 0) newIndex += 12;
    
    let outRoot = NOTES[newIndex];
    return outRoot + suffix;
  };

  return chord.split('/').map(transposeSingle).join('/');
}

const ChordDisplay = ({ data, time, transpose, isLoading, error, onRetry }) => {
  if (isLoading) return <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', height: '100%' }}>Scraping chords from Chordify...</div>;
  if (error) {
    const isNotFound = error.toLowerCase().includes("not found");
    return (
      <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '12px', height: '100%', fontSize: '0.9rem' }}>
        <span>{error}</span>
        {!isNotFound && (
          <button onClick={onRetry} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>Retry</button>
        )}
      </div>
    );
  }
  if (!data || !data.chords || data.chords.length === 0) return <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', height: '100%' }}>No chords available.</div>;

  const chords = data.chords;
  let activeIndex = -1;
  for (let i = 0; i < chords.length; i++) {
    if (time >= chords[i].time_sec) {
      activeIndex = i;
    } else {
      break;
    }
  }

  // Show active chord on the left, and next 5 upcoming chords to the right
  const startIndex = Math.max(0, activeIndex);
  const visibleChords = chords.slice(startIndex, startIndex + 6);

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', height: '100%', overflow: 'hidden', width: '100%', maskImage: 'linear-gradient(to right, black 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 70%, transparent 100%)' }}>
      {visibleChords.map((c, idx) => {
        const globalIdx = startIndex + idx;
        const isActive = globalIdx === activeIndex;
        
        return (
          <div key={globalIdx} style={{ 
            fontSize: isActive ? '2.5rem' : '1.5rem',
            color: isActive ? 'var(--accent-color)' : 'var(--text-muted)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            fontWeight: isActive ? 'bold' : 'normal',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            opacity: isActive ? 1 : Math.max(0.2, 1 - (idx * 0.2)),
            transform: isActive ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(2px)',
          }}>
            {transposeChord(c.chord, transpose || 0)}
          </div>
        );
      })}
    </div>
  );
};

const ResizeBorder = ({ cursor, direction, style, windowObj }) => (
  <div 
    style={{ position: 'absolute', zIndex: 9999, cursor, background: 'rgba(0,0,0,0.01)', ...style }}
    onMouseDown={() => windowObj.startResizing(direction).catch(()=>windowObj.startResizing(direction.toLowerCase()).catch(()=>{}))}
  />
);

  return (
    <div className="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>


      {/* Invisible Resize Borders */}
      <ResizeBorder windowObj={appWindow} cursor="n-resize" direction="Top" style={{ top: 0, left: 4, right: 4, height: '4px' }} />
      <ResizeBorder windowObj={appWindow} cursor="s-resize" direction="Bottom" style={{ bottom: 0, left: 4, right: 4, height: '12px' }} />
      <ResizeBorder windowObj={appWindow} cursor="e-resize" direction="Right" style={{ top: 4, bottom: 4, right: 0, width: '4px' }} />
      <ResizeBorder windowObj={appWindow} cursor="w-resize" direction="Left" style={{ top: 4, bottom: 4, left: 0, width: '4px' }} />
      <ResizeBorder windowObj={appWindow} cursor="nw-resize" direction="TopLeft" style={{ top: 0, left: 0, width: '8px', height: '8px' }} />
      <ResizeBorder windowObj={appWindow} cursor="ne-resize" direction="TopRight" style={{ top: 0, right: 0, width: '8px', height: '8px' }} />
      <ResizeBorder windowObj={appWindow} cursor="sw-resize" direction="BottomLeft" style={{ bottom: 0, left: 0, width: '8px', height: '8px' }} />
      <ResizeBorder windowObj={appWindow} cursor="se-resize" direction="BottomRight" style={{ bottom: 0, right: 0, width: '8px', height: '8px' }} />

      {/* Native Titlebar */}
      <div 
        className="titlebar" 
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || e.target.classList.contains('titlebar-logo')) {
            appWindow.startDragging().catch(()=>{});
          }
        }}
      >
        <div className="titlebar-logo">
          <Music2 size={14} /> NadaNada
        </div>
        <div className="titlebar-buttons">
          <div className="titlebar-button" onClick={() => appWindow.minimize()}>
            <Minus size={14} />
          </div>
          <div className="titlebar-button" onClick={() => appWindow.toggleMaximize()}>
            <Square size={12} />
          </div>
          <div className="titlebar-button close" onClick={() => appWindow.close()}>
            <X size={14} />
          </div>
        </div>
      </div>


      {/* ── UNIFIED MAIN CONTENT ──
          Single JSX tree — styles switch via isMaximized.
          Player is rendered ONCE and stays mounted across maximize/restore
          so the song never restarts. ── */}
      <div style={isMaximized ? {
        display: 'flex', flex: 1, gap: '12px',
        padding: '0 12px 12px 12px', minHeight: 0, overflow: 'hidden',
      } : {
        display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
      }}>

        {/* ── Player Panel ── */}
        <div
          className={isMaximized ? 'glass-panel' : 'top-section glass-panel'}
          style={isMaximized ? {
            flex: '0 0 70%', display: 'flex', flexDirection: 'column',
            borderRadius: '16px', overflow: 'hidden', minHeight: 0,
          } : topPanelStyle}
        >
          <header className="header" style={isMaximized ? {
            display: 'flex', alignItems: 'center', height: '80px',
            padding: '0 16px', flexShrink: 0, boxShadow: '0 1px 0 0 var(--panel-border)',
          } : {
            paddingBottom: '12px', display: 'flex', alignItems: 'center', height: '50px',
          }}>
            <div style={{ flex: 1, display: 'flex', paddingRight: '16px', height: '100%', minWidth: 0 }}>
              {showChords ? (
                <ChordDisplay
                  data={chordsData}
                  time={currentTime + syncOffset}
                  transpose={transposeOffset}
                  isLoading={isFetchingChords}
                  error={chordsError}
                  onRetry={() => { setChordsData(null); setChordsError(null); }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%', paddingLeft: '8px', overflow: 'hidden', flex: 1 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, paddingRight: '16px', flex: 1, width: '100%' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
                      {artistFact ? 'Artist Fact' : 'Up Next'}
                    </div>
                    <div className="marquee-container">
                      <div className={artistFact ? 'running-text' : ''} style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-main)', whiteSpace: 'nowrap', fontStyle: artistFact ? 'italic' : 'normal' }}>
                        {artistFact ? `"${artistFact}"` : (playlist[currentIndex + 1] ? playlist[currentIndex + 1].title : (isFetchingEndless ? 'Loading Mix...' : 'End of Playlist'))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'center' }}>
              {showChords && chordsData && !isFetchingChords && !chordsError && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginRight: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '8px', padding: '2px 6px', color: 'var(--text-muted)' }}>
                    <span style={{ marginRight: '4px' }}>Key:</span>
                    <button onClick={() => setTransposeOffset(s => (s - 1) % 12)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Transpose Down">-</button>
                    <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 'bold', color: 'var(--text-main)' }}>{transposeOffset > 0 ? '+' : ''}{transposeOffset}</span>
                    <button onClick={() => setTransposeOffset(s => (s + 1) % 12)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Transpose Up">+</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '8px', padding: '2px 6px', color: 'var(--text-muted)' }}>
                    <span style={{ marginRight: '4px' }}>Sync:</span>
                    <button onClick={() => setSyncOffset(s => Math.max(-30, s - 0.25))} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Delay Chords">-</button>
                    <span style={{ minWidth: '32px', textAlign: 'center', fontWeight: 'bold', color: 'var(--text-main)' }}>{syncOffset > 0 ? '+' : ''}{syncOffset}s</span>
                    <button onClick={() => setSyncOffset(s => Math.min(30, s + 0.25))} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Advance Chords">+</button>
                  </div>
                </div>
              )}
              <button className={`btn btn-icon ${showChords ? 'active' : ''}`} onClick={() => setShowChords(!showChords)} title="Toggle Chords" style={{ background: showChords ? 'var(--button-hover)' : 'transparent', boxShadow: 'none', color: showChords ? 'var(--accent-color)' : 'inherit' }}>
                <ListMusic size={20} />
              </button>
              <button className="btn btn-icon" onClick={toggleTheme} title="Switch Theme" style={{ background: 'transparent', boxShadow: 'none' }}>
                <Palette size={20} />
              </button>
            </div>
          </header>

          {/* Player — ONE instance, never remounts */}
          <div style={isMaximized ? {
            flex: 1, display: 'flex', flexDirection: 'column',
            padding: '16px', minHeight: 0, overflow: 'hidden',
          } : { display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Player
              currentSong={currentSong}
              nextSong={playlist[currentIndex + 1]}
              onNext={handleNext}
              onPrevious={handlePrevious}
              hasNext={currentIndex < playlist.length - 1}
              hasPrevious={currentIndex > 0}
              onPlayStateChange={setIsAudioPlaying}
              onTimeUpdate={setCurrentTime}
              onError={setGlobalError}
              isMaximized={isMaximized}
              isVideoHidden={isVideoHidden}
            />
          </div>
        </div>

        {/* ── Playlist Panel ── */}
        <div
          className="bottom-section glass-panel"
          style={isMaximized ? {
            flex: '0 0 calc(30% - 12px)', display: 'flex', flexDirection: 'column',
            borderRadius: '16px', overflow: 'hidden', minHeight: 0,
          } : bottomPanelStyle}
        >
          <div style={staticStyles.headerBar}>
            <div style={staticStyles.headerTitle}>
              {showSearch ? (
                'Search YouTube'
              ) : showDownloadedList ? (
                <button
                  onClick={() => { setShowDownloadedList(false); if (savedPlaylist) { setPlaylist(savedPlaylist); setSavedPlaylist(null); } }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontWeight: 'inherit', fontSize: 'inherit', fontFamily: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
                  title="Return to your original playlist"
                >
                  <ArrowLeft size={18} style={{ marginTop: '2px' }} /> Back to My Playlist
                </button>
              ) : isFetchingEndless ? (
                <span>Finding next song...</span>
              ) : savedPlaylist ? (
                <button
                  onClick={() => { setPlaylist(savedPlaylist); setSavedPlaylist(null); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontWeight: 'inherit', fontSize: 'inherit', fontFamily: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
                  title="Return to your original playlist"
                >
                  <ArrowLeft size={18} style={{ marginTop: '2px' }} /> Back to My Playlist
                </button>
              ) : (
                `Up Next (${playlist.length})`
              )}
              {!showSearch && !showDownloadedList && failedEndlessFetch && (
                <button
                  onClick={() => setFailedEndlessFetch(false)}
                  style={{ fontSize: '0.75rem', background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  title="Click to retry loading Endless Mix"
                >
                  <AlertTriangle size={12} /> Mix Failed (Retry)
                </button>
              )}
            </div>
            <div style={staticStyles.headerIcons}>
              {!showSearch && !showDownloadedList && (
                <>
                  {!savedPlaylist && (
                    <button className="btn btn-icon" onClick={() => setShowLoadPrompt(true)} title="Load Playlist" style={staticStyles.iconBtn}>
                      <FolderOpen size={18} />
                    </button>
                  )}
                  {playlist.length > 0 && (
                    <button className="btn btn-icon" onClick={() => setShowSavePrompt(true)} title="Save Playlist" style={staticStyles.iconBtn}>
                      <Save size={18} />
                    </button>
                  )}
                  {playlist.length > 0 && !savedPlaylist && (
                    <button className="btn btn-icon" onClick={() => setShowClearPrompt(true)} title="Clear Playlist" style={staticStyles.iconBtnDanger}>
                      <Trash2 size={18} />
                    </button>
                  )}
                  <div style={staticStyles.separator} />
                  <button
                    className={`btn btn-icon ${isEndlessPlay ? 'active' : ''}`}
                    onClick={() => setIsEndlessPlay(!isEndlessPlay)}
                    title="Endless Play"
                    style={{ padding: '6px', color: isEndlessPlay ? 'var(--accent-color)' : 'inherit' }}
                  >
                    {isFetchingEndless ? <Loader2 size={18} className="animate-spin" /> : <Infinity size={18} />}
                  </button>
                  <div style={{ position: 'relative', zIndex: 50 }} ref={trendingRef}>
                    <button
                      className={`btn btn-icon ${isFetchingTrending || showTrendingDropdown ? 'active' : ''}`}
                      onClick={() => setShowTrendingDropdown(!showTrendingDropdown)}
                      title="Load Trending"
                      disabled={isFetchingTrending}
                      style={{ padding: '6px', color: (isFetchingTrending || showTrendingDropdown) ? 'var(--accent-color)' : 'inherit' }}
                    >
                      {isFetchingTrending ? <Loader2 size={18} className="animate-spin" /> : <TrendingUp size={18} />}
                    </button>
                    {showTrendingDropdown && (
                      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', borderRadius: '8px', padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 100, minWidth: '120px' }}>
                        <button className="btn" onClick={() => handleLoadTrending('indonesia')} style={{ padding: '8px 12px', textAlign: 'left', border: 'none', color: 'var(--text-main)', fontSize: '0.9rem', cursor: 'pointer', borderRadius: '4px', width: '100%' }}>Indonesia</button>
                        <button className="btn" onClick={() => handleLoadTrending('global')} style={{ padding: '8px 12px', textAlign: 'left', border: 'none', color: 'var(--text-main)', fontSize: '0.9rem', cursor: 'pointer', borderRadius: '4px', width: '100%' }}>Worldwide</button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <button
                className={`btn btn-icon ${showDownloadedList ? 'active' : ''}`}
                onClick={() => { if (showDownloadedList && savedPlaylist) { setPlaylist(savedPlaylist); setSavedPlaylist(null); } setShowDownloadedList(!showDownloadedList); setShowSearch(false); }}
                title="Downloaded Songs"
                style={{ padding: '6px', color: showDownloadedList ? 'var(--accent-color)' : 'inherit' }}
              >
                <Download size={18} />
              </button>
              {showDownloadedList && (
                <button
                  className="btn btn-icon"
                  onClick={async () => {
                    try {
                      const filePath = await open({ multiple: false, filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'webm'] }] });
                      if (filePath) { await invoke('add_local_song', { filePath }); loadDownloadedSongs(); }
                    } catch (e) { console.error('Failed to add local song:', e); setGlobalError('Failed to add local song.'); }
                  }}
                  title="Add Local Audio File"
                  style={{ padding: '6px' }}
                >
                  <FolderPlus size={18} />
                </button>
              )}
              {!savedPlaylist && !showDownloadedList && (
                <button className="btn btn-icon" onClick={() => { setShowSearch(!showSearch); setShowDownloadedList(false); }} title={showSearch ? 'Close Search' : 'Search Music'} style={{ padding: '6px' }}>
                  {showSearch ? <X size={18} /> : <SearchIcon size={18} />}
                </button>
              )}
            </div>
          </div>

          <div style={staticStyles.playlistContainer}>
            {showSearch ? (
              <div style={staticStyles.searchContainer}>
                <Search onAdd={handleAddSong} onAddMultiple={handleAddMultiple} playlist={playlist} onError={setGlobalError} />
              </div>
            ) : showDownloadedList ? (
              <Playlist
                playlist={downloadedSongs}
                currentIndex={downloadedSongs.findIndex(s => s.id === (currentSong?.id))}
                onSelectIndex={(idx) => { if (!savedPlaylist && playlist !== downloadedSongs) { setSavedPlaylist(playlist); } setPlaylist(downloadedSongs); setCurrentIndex(idx); setIsAudioPlaying(true); }}
                onRemove={async (idx) => { const song = downloadedSongs[idx]; try { await invoke('delete_downloaded_song', { filePath: song.file_path }); loadDownloadedSongs(); } catch (e) { console.error('Failed to delete song:', e); setGlobalError('Failed to delete song.'); } }}
                onReorder={(dragIndex, dropIndex) => { const newPlaylist = [...downloadedSongs]; const [draggedItem] = newPlaylist.splice(dragIndex, 1); newPlaylist.splice(dropIndex, 0, draggedItem); setDownloadedSongs(newPlaylist); if (playlist === downloadedSongs) { setPlaylist(newPlaylist); if (currentIndex === dragIndex) setCurrentIndex(dropIndex); else if (currentIndex > dragIndex && currentIndex <= dropIndex) setCurrentIndex(currentIndex - 1); else if (currentIndex < dragIndex && currentIndex >= dropIndex) setCurrentIndex(currentIndex + 1); } }}
                isTrendingMode={true}
                isDownloadedView={true}
                onAddSong={() => {}}
              />
            ) : (
              <Playlist
                playlist={playlist}
                currentIndex={currentIndex}
                onSelectIndex={setCurrentIndex}
                onRemove={handleRemoveSong}
                onReorder={handleReorder}
                isTrendingMode={!!savedPlaylist}
                onAddSong={(song) => { if (savedPlaylist) { setSavedPlaylist([...savedPlaylist, song]); } }}
                onDownloadSong={handleDownloadSong}
                downloadingSongId={downloadingSongId}
                downloadedIds={downloadedIds}
              />
            )}
          </div>
        </div>

      </div>

      {showClosePrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon-container">
              <Disc className="modal-icon" />
            </div>
            <div>
              <h3 className="modal-title">Keep the music playing?</h3>
              <p className="modal-desc">
                You can minimize NadaNada to the system tray so it continues playing in the background.
              </p>
            </div>
            
            <div className="modal-actions">
              <button 
                onClick={async () => {
                  setShowClosePrompt(false);
                  await getCurrentWindow().hide();
                }}
                className="btn btn-primary btn-large"
              >
                Minimize to Tray
              </button>
              <button 
                onClick={async () => {
                  setShowClosePrompt(false);
                  await invoke('quit_app');
                }}
                className="btn btn-secondary btn-large"
              >
                Quit App
              </button>
              <button 
                onClick={() => setShowClosePrompt(false)}
                className="btn btn-cancel btn-large"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearPrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon-container">
              <AlertTriangle className="modal-icon" style={{ color: '#ef4444', animation: 'none' }} />
            </div>
            <div>
              <h3 className="modal-title">Clear Playlist?</h3>
              <p className="modal-desc">
                Are you sure you want to clear your current playlist? This action cannot be undone.
              </p>
            </div>
            
            <div className="modal-actions">
              <button 
                onClick={() => {
                  setPlaylist([]);
                  setSavedPlaylist(null);
                  setCurrentIndex(0);
                  setIsAudioPlaying(false);
                  setShowClearPrompt(false);
                }}
                className="btn btn-primary btn-large"
                style={{ background: '#ef4444', borderColor: '#ef4444' }}
              >
                Clear All
              </button>
              <button 
                onClick={() => setShowClearPrompt(false)}
                className="btn btn-secondary btn-large"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showSavePrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon-container">
              <Save className="modal-icon" style={{ animation: 'none' }} />
            </div>
            <div style={{ width: '100%' }}>
              <h3 className="modal-title">Save Playlist</h3>
              <p className="modal-desc">
                Enter a name for your current mix.
              </p>
              <input 
                type="text" 
                className="input" 
                value={savePlaylistName}
                onChange={(e) => setSavePlaylistName(e.target.value)}
                placeholder="My Awesome Playlist..."
                style={{ marginBottom: '24px' }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && savePlaylistName.trim()) {
                    setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: savePlaylistName.trim(), items: playlist }]);
                    setSavePlaylistName('');
                    setShowSavePrompt(false);
                  }
                }}
              />
            </div>
            
            <div className="modal-actions">
              <button 
                onClick={() => {
                  if (savePlaylistName.trim()) {
                    setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: savePlaylistName.trim(), items: playlist }]);
                    setSavePlaylistName('');
                    setShowSavePrompt(false);
                  }
                }}
                className="btn btn-primary btn-large"
                disabled={!savePlaylistName.trim()}
              >
                Save
              </button>
              <button 
                onClick={() => setShowSavePrompt(false)}
                className="btn btn-secondary btn-large"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showLoadPrompt && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div style={{ width: '100%' }}>
              <h3 className="modal-title" style={{ marginBottom: '20px' }}>Your Playlists</h3>
              {savedPlaylists.length === 0 ? (
                <p className="modal-desc">You haven't saved any playlists yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto', marginBottom: '24px', paddingRight: '8px', width: '100%' }}>
                  {savedPlaylists.map(pl => (
                    <div key={pl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '12px', cursor: 'pointer' }} onClick={() => { setPlaylist(pl.items); setSavedPlaylist(null); setCurrentIndex(0); setShowLoadPrompt(false); }}>
                      <div style={{ textAlign: 'left', overflow: 'hidden' }}>
                        <div style={{ fontWeight: '600', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{pl.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{pl.items.length} songs</div>
                      </div>
                      <button 
                        className="btn btn-icon" 
                        style={{ border: 'none', color: '#ef4444' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSavedPlaylists(prev => prev.filter(p => p.id !== pl.id));
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div style={{ width: '100%', marginTop: '16px', marginBottom: '24px', borderTop: '1px solid var(--panel-border)', paddingTop: '16px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-main)' }}>Import Playlist</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  className="input" 
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="Spotify or YouTube playlist URL..."
                  style={{ flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleImportPlaylist();
                  }}
                  disabled={isImporting}
                />
                <button 
                  onClick={handleImportPlaylist}
                  className="btn btn-primary"
                  disabled={!importUrl.trim() || isImporting}
                  style={{ padding: '8px 16px', minWidth: '120px' }}
                >
                  {isImporting ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Loader2 size={16} className="animate-spin" />
                      <span style={{ fontSize: '0.8rem' }}>{importProgress || 'Importing'}</span>
                    </div>
                  ) : 'Import'}
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button 
                onClick={() => setShowLoadPrompt(false)}
                className="btn btn-secondary btn-large"
                disabled={isImporting}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}


      {globalError && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon-container">
              <AlertTriangle className="modal-icon" style={{ color: '#ef4444', animation: 'none' }} />
            </div>
            <h3 className="modal-title">Error</h3>
            <p className="modal-desc">{globalError}</p>
            <div className="modal-actions">
              <button 
                onClick={() => setGlobalError(null)}
                className="btn btn-secondary btn-large"
                style={{ width: '100%' }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon-container">
              <CheckCircle className="modal-icon" style={{ color: 'var(--accent-color)', animation: 'none' }} />
            </div>
            <h3 className="modal-title">Success</h3>
            <p className="modal-desc">{successMessage}</p>
            <div className="modal-actions">
              <button 
                onClick={() => setSuccessMessage(null)}
                className="btn btn-primary btn-large"
                style={{ width: '100%' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
