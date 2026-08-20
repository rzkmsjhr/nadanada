import React, { useState, useEffect, useRef, useMemo } from 'react';
import Player from './components/Player';
import Search from './components/Search';
import Playlist from './components/Playlist';
import { Music2, Sun, Moon, Palette, Search as SearchIcon, X, Minus, Square, Infinity, Disc, Trash2, Save, FolderOpen, FolderPlus, AlertTriangle, ListMusic, TrendingUp, Globe, ArrowLeft, Loader2, Download, CheckCircle, ListPlus, Pencil, Check } from 'lucide-react';
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

const getCachedVideo = (query) => {
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

const SavedPlaylistItem = React.memo(({ pl, onSelect, onDelete, onRename }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(pl.name);
  const [isHovered, setIsHovered] = useState(false);
  const [shouldScroll, setShouldScroll] = useState(false);
  const textRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleMouseEnter = () => {
    if (textRef.current) {
      setShouldScroll(textRef.current.scrollWidth > textRef.current.clientWidth);
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShouldScroll(false);
  };

  const handleSaveRename = (e) => {
    if (e) e.stopPropagation();
    const trimmed = editName.trim();
    if (trimmed && trimmed !== pl.name) {
      onRename(pl.id, trimmed);
    } else {
      setEditName(pl.name);
    }
    setIsEditing(false);
  };

  const handleCancelRename = (e) => {
    if (e) e.stopPropagation();
    setEditName(pl.name);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div 
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--panel-bg)', border: '1px solid var(--accent-color)', borderRadius: '12px', gap: '8px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            ref={inputRef}
            type="text"
            className="input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveRename(e);
              if (e.key === 'Escape') handleCancelRename(e);
            }}
            style={{ width: '100%', fontSize: '0.85rem', padding: '4px 8px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button 
            className="btn btn-icon" 
            style={{ border: 'none', color: 'var(--accent-color)', padding: '4px' }}
            onClick={handleSaveRename}
            title="Save Name"
          >
            <Check size={16} />
          </button>
          <button 
            className="btn btn-icon" 
            style={{ border: 'none', color: 'var(--text-muted)', padding: '4px' }}
            onClick={handleCancelRename}
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '12px', cursor: 'pointer', gap: '8px' }} 
      onClick={() => onSelect(pl)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={{ textAlign: 'left', overflow: 'hidden', flex: 1, minWidth: 0 }}>
        <div className="song-title-wrapper">
          <div ref={textRef} className={`song-title ${isHovered && shouldScroll ? 'scrolling' : ''}`} style={{ fontWeight: '600' }}>
            {pl.name}
          </div>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{pl.items.length} songs</div>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        <button 
          className="btn btn-icon" 
          style={{ border: 'none', color: 'var(--text-muted)' }}
          onClick={(e) => {
            e.stopPropagation();
            setEditName(pl.name);
            setIsEditing(true);
          }}
          title="Edit Name"
        >
          <Pencil size={15} />
        </button>
        <button 
          className="btn btn-icon" 
          style={{ border: 'none', color: '#ef4444' }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(pl.id);
          }}
          title="Delete Playlist"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
});

const SavedPlaylistButtonItem = React.memo(({ pl, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [shouldScroll, setShouldScroll] = useState(false);
  const textRef = useRef(null);

  const handleMouseEnter = () => {
    if (textRef.current) {
      setShouldScroll(textRef.current.scrollWidth > textRef.current.clientWidth);
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShouldScroll(false);
  };

  return (
    <button
      className="btn"
      style={{ padding: '12px', textAlign: 'left', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}
      onClick={() => onClick(pl)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div className="song-title-wrapper">
          <div ref={textRef} className={`song-title ${isHovered && shouldScroll ? 'scrolling' : ''}`} style={{ fontWeight: '600' }}>
            {pl.name}
          </div>
        </div>
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>{pl.items.length} songs</span>
    </button>
  );
});

function App() {
  const appWindow = getCurrentWindow();
  const [theme, setTheme] = useState(() => localStorage.getItem('nadanada-theme') || 'nox-noir');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isVideoHidden, setIsVideoHidden] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const isMaximizedRef = useRef(false);

  // Ref to Player's imperative handle — used by keyboard shortcuts
  const playerRef = useRef(null);
  // Stable refs for next/prev so the keyboard handler never becomes stale
  const handleNextRef = useRef(null);
  const handlePreviousRef = useRef(null);

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
  const [shouldScrollPlaylistToBottom, setShouldScrollPlaylistToBottom] = useState(false);
  const hasAddedSongInSearchRef = useRef(false);

  // Search Preview State
  const [previewSong, setPreviewSong] = useState(null);
  const [restoredSong, setRestoredSong] = useState(null);
  const previewSavedStateRef = useRef(null);

  const handlePlayPreview = async (video) => {
    if (!previewSavedStateRef.current) {
      let currentTimeSeconds = currentTime;
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        try {
          const t = await playerRef.current.getCurrentTime();
          if (typeof t === 'number' && !isNaN(t)) {
            currentTimeSeconds = t;
          }
        } catch (e) {}
      }

      previewSavedStateRef.current = {
        song: playlist[currentIndex],
        time: currentTimeSeconds,
        wasPlaying: isAudioPlaying
      };
    }

    // Smoothly fade out currently playing main track
    if (playerRef.current && typeof playerRef.current.fadeOut === 'function') {
      await playerRef.current.fadeOut(200);
    }

    setRestoredSong(null);
    setPreviewSong(video);
    setIsAudioPlaying(true);

    // Smoothly fade in preview track
    setTimeout(() => {
      if (playerRef.current && typeof playerRef.current.fadeIn === 'function') {
        playerRef.current.fadeIn(350);
      }
    }, 120);
  };

  const handleStopPreview = async () => {
    const saved = previewSavedStateRef.current;
    previewSavedStateRef.current = null;

    // Smoothly fade out preview track
    if (playerRef.current && typeof playerRef.current.fadeOut === 'function') {
      await playerRef.current.fadeOut(200);
    }

    setPreviewSong(null);

    if (saved && saved.song) {
      const restoredItem = { ...saved.song, startSeconds: Math.floor(saved.time || 0) };
      setRestoredSong(restoredItem);
      setIsAudioPlaying(saved.wasPlaying);

      setTimeout(() => {
        if (playerRef.current && typeof playerRef.current.fadeIn === 'function') {
          playerRef.current.fadeIn(400);
        }
      }, 150);
    }
  };

  const handleToggleSearch = () => {
    if (showSearch) {
      // Closing search view
      if (previewSavedStateRef.current || previewSong) {
        handleStopPreview();
      }
      if (hasAddedSongInSearchRef.current) {
        setShouldScrollPlaylistToBottom(true);
        hasAddedSongInSearchRef.current = false;
      }
      setShowSearch(false);
    } else {
      // Opening search view
      hasAddedSongInSearchRef.current = false;
      setShowDownloadedList(false);
      setShowSearch(true);
    }
  };
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
  
  // Playback control states
  const [repeatMode, setRepeatMode] = useState(0); // 0=off, 1=repeat, 2=repeat once
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffleHistory, setShuffleHistory] = useState([]);
  
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
    
    // Debounce the online event by 1.5s to let the network stack fully stabilise
    // before reloading, and show a visual indicator so the reload doesn't feel
    // like a crash.
    let reconnectTimer = null;
    const handleOnline = () => {
      setIsReconnecting(true);
      reconnectTimer = setTimeout(() => {
        window.location.reload();
      }, 1500);
    };
    window.addEventListener('online', handleOnline);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const handleDownloadSong = async (song) => {
    if (downloadingSongId) return; // Prevent multiple simultaneous downloads
    setDownloadingSongId(song.id);
    
    try {
      let title = song.title.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/official|music|video|audio|hd|hq|lyrics/ig, ' ').replace(/\s+/g, ' ').trim();
      let artist = '';
      
      const parts = title.split(' - ');
      if (parts.length > 1) {
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
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
  const [songToAddToPlaylist, setSongToAddToPlaylist] = useState(null);
  const [addToPlaylistName, setAddToPlaylistName] = useState('');
  const [savePlaylistName, setSavePlaylistName] = useState('');
  // Saved playlists — persisted to %LOCALAPPDATA%\NadaNada\playlists.json
  // so they survive localStorage wipes. Falls back to localStorage on error
  // and auto-migrates existing data on first run.
  const [savedPlaylists, setSavedPlaylists] = useState([]);
  const playlistsLoadedRef = useRef(false);

  useEffect(() => {
    const loadPlaylists = async () => {
      try {
        const data = await invoke('load_playlists');
        const parsed = JSON.parse(data);
        if (parsed && parsed.length > 0) {
          setSavedPlaylists(parsed);
        } else {
          // One-time migration from localStorage
          const lsData = localStorage.getItem('nadanada-saved-playlists');
          if (lsData) {
            try {
              const lsParsed = JSON.parse(lsData);
              if (lsParsed && lsParsed.length > 0) {
                setSavedPlaylists(lsParsed);
                await invoke('save_playlists', { data: lsData });
                localStorage.removeItem('nadanada-saved-playlists');
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error('Failed to load playlists from file, using localStorage fallback:', e);
        try {
          const lsData = localStorage.getItem('nadanada-saved-playlists');
          if (lsData) setSavedPlaylists(JSON.parse(lsData));
        } catch {}
      } finally {
        playlistsLoadedRef.current = true;
      }
    };
    loadPlaylists();
  }, []);

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
    if (!playlistsLoadedRef.current) return; // Don't overwrite the file before we've loaded it
    const timer = setTimeout(() => {
      invoke('save_playlists', { data: JSON.stringify(savedPlaylists) })
        .catch(e => console.error('Failed to save playlists to file:', e));
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

  const currentSong = useMemo(() => {
    if (previewSong) {
      return { ...previewSong, startSeconds: 30 };
    }
    if (restoredSong) {
      return restoredSong;
    }
    return playlist[currentIndex] || null;
  }, [previewSong, restoredSong, playlist, currentIndex]);
  const [artistFact, setArtistFact] = useState('');

  // Fix: Clear restored song if user manually changes track via playlist
  useEffect(() => {
    if (restoredSong) {
      setRestoredSong(null);
    }
  }, [currentIndex, playlist]);
  
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

  // ── Artist / Song Fun Facts (Wikipedia) ───────────────────────────────────
  // Extracts genuinely interesting sentences from Wikipedia articles — origin
  // stories, accidents, early-career moments — NOT genre tags or chart data.
  useEffect(() => {
    if (!currentSong) { setArtistFact(''); return; }

    const controller = new AbortController();
    const signal = controller.signal;

    // Words that hint at a fun, surprising, or story-driven sentence
    const GOOD = [
      'before', 'originally', 'accident', 'accidentally', 'inspired',
      'inspiration', 'rejected', 'almost', 'discovered', 'signed',
      'grew up', 'childhood', 'school', 'young', 'early', 'first',
      'debut', 'never', 'actually', 'surprisingly', 'unexpected',
      'unknown', 'wrote', 'recorded', 'named after', 'named for',
      'dropped out', 'quit', 'left the band', 'met', 'formed',
      'started', 'began', 'rumoured', 'rumored', 'reportedly',
      'auditioned', 'sampled', 'influenced by', 'influence',
      'originally planned', 'nearly', 'almost', 'decided to',
      'came up with', 'thought of', 'idea for', 'when they were',
    ];

    // Words that reveal a boring descriptor / chart / sales sentence
    const BAD = [
      ' is a ', ' are a ', ' is an ', ' are an ',
      'born in', 'born on', 'citizenship', 'nationality',
      'discography', 'known for', 'best known',
      'certified platinum', 'certified gold', 'billboard',
      'number one', 'topped the', 'peaked at', 'charted',
      'won the', 'grammy', 'brit award', 'mtv award',
    ];

    const scoreSentence = (s) => {
      const l = s.toLowerCase();
      let score = 0;
      for (const w of GOOD) if (l.includes(w)) score += 2;
      for (const w of BAD)  if (l.includes(w)) score -= 3;
      if (s.length < 50 || s.length > 290) score -= 2; // too short or too long
      return score;
    };

    const extractFact = (wikiText) => {
      // Split on ". " or "! " or "? " preserving the sentence text
      const sentences = wikiText
        .split(/\.\s+|\!\s+|\?\s+/)
        .map(s => s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(s => s.length > 50 && s.length < 290);

      // Skip the first sentence (always "X is a <genre> band from <city>")
      const candidates = sentences.slice(1);
      const scored = candidates
        .map(s => ({ text: s, score: scoreSentence(s) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) return null;
      // Pick randomly from the top 3 so each listen to the same song can surface
      // a different fact, making the header feel alive
      const pool = scored.slice(0, Math.min(3, scored.length));
      const { text } = pool[Math.floor(Math.random() * pool.length)];
      return text.endsWith('.') ? text : text + '.';
    };

    const wikiGet = async (title) => {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=${encodeURIComponent(title)}&exintro=true&explaintext=true&redirects=1&format=json&origin=*`,
        { signal }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const pages = Object.values(data.query?.pages || {});
      const page = pages[0];
      if (!page || page.missing !== undefined || !page.extract) return null;
      return page.extract;
    };

    const fetchFunFact = async () => {
      try {
        // --- derive clean artist & title ---
        let artist = currentSong.channel
          ? currentSong.channel.replace(/ - Topic$/i, '').replace(/vevo/i, '').trim()
          : '';
        let title = currentSong.title
          .replace(/\[.*?\]|\(.*?\)/g, ' ')
          .replace(/official|music|video|audio|hd|hq|lyrics/ig, ' ')
          .replace(/\s+/g, ' ').trim();
        const dashParts = title.split(' - ');
        if (dashParts.length > 1) {
          if (!artist) artist = dashParts[0].trim();
          title = dashParts.slice(1).join(' - ').trim();
        }
        if (!artist) { if (!signal.aborted) setArtistFact(''); return; }

        // --- 1. Try the song page first (best chance of "how it was made" facts) ---
        if (!signal.aborted && title) {
          const songText = await wikiGet(`${title} (song)`);
          if (songText && !signal.aborted) {
            const fact = extractFact(songText);
            if (fact) { setArtistFact(fact); return; }
          }
        }

        if (signal.aborted) return;

        // --- 2. Try artist page variants ---
        const artistVariants = [
          artist,
          `${artist} (band)`,
          `${artist} (singer)`,
          `${artist} (rapper)`,
          `${artist} (musician)`,
        ];

        for (const variant of artistVariants) {
          if (signal.aborted) return;
          const text = await wikiGet(variant);
          if (!text) continue;
          
          // Sanity check: Ensure this page is actually about music/artist
          // If the entire Wikipedia intro doesn't mention any of these, it's likely a generic noun (e.g., 'Chillies' -> 'Chili peppers')
          const isMusicRelated = /band|singer|album|music|musician|song|rapper|producer|dj|vocalist|guitarist|chart|record/i.test(text);
          if (!isMusicRelated) continue;

          const fact = extractFact(text);
          if (fact) { if (!signal.aborted) setArtistFact(fact); return; }
        }

        if (!signal.aborted) setArtistFact('');
      } catch (e) {
        if (!signal.aborted) setArtistFact('');
      }
    };

    fetchFunFact();
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
    if (!navigator.onLine) {
      setGlobalError("No internet connection.");
      return;
    }
    setShowTrendingDropdown(false);
    setIsFetchingTrending(true);
    try {
      // Fetch exact real-time Kworb daily chart for Indonesia or Global
      const kworbTracks = await invoke('get_kworb_chart', { region });
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
                const searchResults = await invoke('search_youtube', { query: track.query, searchType: null });
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
      setGlobalError("Failed to fetch trending music. Please check your connection.");
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
          const songs = await invoke('get_youtube_playlist', { playlistId, firstVideoId: '' });
          if (songs && songs.length > 0) {
            handleAddMultiple(songs);
            try {
              const pTitle = await invoke('get_playlist_title', { platform: 'youtube', playlistId });
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
              try {
                const pTitle = await invoke('get_playlist_title', { platform: 'spotify', playlistId });
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


  const handleNext = () => {
    if (previewSong) setPreviewSong(null);
    if (restoredSong) setRestoredSong(null);
    if (isShuffle) {
      if (playlist.length <= 1) return;
      let nextIdx;
      do {
         nextIdx = Math.floor(Math.random() * playlist.length);
      } while (nextIdx === currentIndex);
      setShuffleHistory(prev => [...prev, currentIndex]);
      setCurrentIndex(nextIdx);
    } else {
      if (currentIndex < playlist.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    }
  };

  const handlePrevious = () => {
    if (previewSong) setPreviewSong(null);
    if (restoredSong) setRestoredSong(null);
    if (isShuffle) {
      if (shuffleHistory.length > 0) {
         const newHistory = [...shuffleHistory];
         const prevIdx = newHistory.pop();
         setShuffleHistory(newHistory);
         setCurrentIndex(prevIdx);
      } else {
         if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
      }
    } else {
      if (currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }
    }
  };

  const handleAddSong = (video) => {
    if (previewSong) {
      setPreviewSong(null);
      previewSavedStateRef.current = null;
    }
    if (showSearch) {
      hasAddedSongInSearchRef.current = true;
    }
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
    if (previewSong) {
      setPreviewSong(null);
      previewSavedStateRef.current = null;
    }
    if (showSearch) {
      hasAddedSongInSearchRef.current = true;
    }
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

  // \u2500\u2500 Keyboard shortcuts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Keep refs current so the effect registered once never becomes stale
  handleNextRef.current = handleNext;
  handlePreviousRef.current = handlePrevious;

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't fire shortcuts while the user is typing
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          playerRef.current?.togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleNextRef.current?.();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePreviousRef.current?.();
          break;
        case 'm':
        case 'M':
          playerRef.current?.toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          // Toggle search view
          handleToggleSearch();
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // Registered once — relies on refs for always-current functions


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

      {/* Native/Custom Titlebar */}
      <div 
        className={`titlebar ${navigator.userAgent.toUpperCase().indexOf('MAC') >= 0 ? 'mac' : ''}`} 
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || e.target.classList.contains('titlebar-logo') || e.target.classList.contains('titlebar-center')) {
            appWindow.startDragging().catch(()=>{});
          }
        }}
      >
        {navigator.userAgent.toUpperCase().indexOf('MAC') >= 0 ? (
          <>
            <div className="titlebar-buttons mac">
              <div className="mac-btn close" onClick={() => appWindow.close()} />
              <div className="mac-btn minimize" onClick={() => appWindow.minimize()} />
              <div className="mac-btn maximize" onClick={() => appWindow.toggleMaximize()} />
            </div>
            <div className="titlebar-center">
               <Music2 size={14} /> NadaNada
            </div>
            <div style={{ width: '70px' }}></div>
          </>
        ) : (
          <>
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
          </>
        )}
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
              ref={playerRef}
              currentSong={currentSong}
              nextSong={playlist[currentIndex + 1]}
              onNext={handleNext}
              onPrevious={handlePrevious}
              hasNext={isShuffle || (currentIndex < playlist.length - 1)}
              hasPrevious={isShuffle ? shuffleHistory.length > 0 : currentIndex > 0}
              onPlayStateChange={setIsAudioPlaying}
              onTimeUpdate={setCurrentTime}
              onError={setGlobalError}
              isMaximized={isMaximized}
              isVideoHidden={isVideoHidden}
              repeatMode={repeatMode}
              onToggleRepeat={() => setRepeatMode(m => (m + 1) % 3)}
              isShuffle={isShuffle}
              onToggleShuffle={() => {
                const newVal = !isShuffle;
                setIsShuffle(newVal);
                if (newVal) setIsEndlessPlay(false);
              }}
              onSongEnded={handleNext}
              onRestoreHandled={() => setRestoredMainTime(null)}
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
                    onClick={() => {
                      const newVal = !isEndlessPlay;
                      setIsEndlessPlay(newVal);
                      if (newVal) setIsShuffle(false);
                    }}
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
                onClick={() => {
                  if (previewSavedStateRef.current || previewSong) {
                    handleStopPreview();
                  }
                  if (showSearch && hasAddedSongInSearchRef.current) {
                    setShouldScrollPlaylistToBottom(true);
                    hasAddedSongInSearchRef.current = false;
                  }
                  if (showDownloadedList && savedPlaylist) {
                    setPlaylist(savedPlaylist);
                    setSavedPlaylist(null);
                  }
                  setShowDownloadedList(!showDownloadedList);
                  setShowSearch(false);
                }}
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
                <button className="btn btn-icon" onClick={handleToggleSearch} title={showSearch ? 'Close Search' : 'Search Music'} style={{ padding: '6px' }}>
                  {showSearch ? <X size={18} /> : <SearchIcon size={18} />}
                </button>
              )}
            </div>
          </div>

          <div style={staticStyles.playlistContainer}>
            {showSearch ? (
              <div style={staticStyles.searchContainer}>
                <Search 
                  onAdd={handleAddSong} 
                  onAddMultiple={handleAddMultiple} 
                  playlist={playlist} 
                  onError={setGlobalError} 
                  onPlayPreview={handlePlayPreview}
                  onStopPreview={handleStopPreview}
                  previewSongId={previewSong?.id}
                />
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
                onAddToSavedPlaylist={(song) => setSongToAddToPlaylist(song)}
                shouldScrollToBottom={shouldScrollPlaylistToBottom}
                onScrollToBottomDone={() => setShouldScrollPlaylistToBottom(false)}
              />
            )}
          </div>
        </div>

      </div>

      {/* ── Reconnection overlay ── shows briefly before auto-reload */}
      {isReconnecting && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '16px',
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          animation: 'fadeIn 0.3s ease-out',
        }}>
          <Loader2 size={36} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
          <div style={{ color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: '500', letterSpacing: '0.02em' }}>
            Connection restored. Refreshing…
          </div>
        </div>
      )}

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
                    <SavedPlaylistItem
                      key={pl.id}
                      pl={pl}
                      onSelect={(playlistItem) => {
                        setPlaylist(playlistItem.items);
                        setSavedPlaylist(null);
                        setCurrentIndex(0);
                        setShowLoadPrompt(false);
                      }}
                      onDelete={(id) => {
                        setSavedPlaylists(prev => prev.filter(p => p.id !== id));
                      }}
                      onRename={(id, newName) => {
                        setSavedPlaylists(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            
            <div style={{ width: '100%', marginTop: '16px', marginBottom: '24px', borderTop: '1px solid var(--panel-border)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-main)' }}>Import Playlist</div>
                <img src="/youtube.svg" alt="YouTube" title="YouTube supported" style={{ height: '12px', width: 'auto', objectFit: 'contain', position: 'relative', top: '2px' }} />
                <img src="/spotify.svg" alt="Spotify" title="Spotify supported" style={{ height: '12px', width: 'auto', objectFit: 'contain', position: 'relative', top: '1px' }} />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  className="input" 
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="Your playlist url"
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
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}


      {songToAddToPlaylist && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '90%', maxWidth: '400px' }}>
            <div className="modal-icon-container">
              <ListPlus className="modal-icon" />
            </div>
            <h3 className="modal-title">Add to Playlist</h3>
            <div style={{ width: '100%', marginTop: '16px' }}>
              {savedPlaylists.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto', marginBottom: '16px', paddingRight: '8px' }}>
                  {savedPlaylists.map(pl => (
                    <SavedPlaylistButtonItem
                      key={pl.id}
                      pl={pl}
                      onClick={(playlistItem) => {
                        setSavedPlaylists(prev => prev.map(p => {
                          if (p.id === playlistItem.id) {
                            if (p.items.some(s => s.id === songToAddToPlaylist.id)) return p;
                            return { ...p, items: [...p.items, songToAddToPlaylist] };
                          }
                          return p;
                        }));
                        setSongToAddToPlaylist(null);
                        setSuccessMessage(`Added to ${playlistItem.name}`);
                      }}
                    />
                  ))}
                </div>
              )}
              
              <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '16px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-main)' }}>Create New Playlist</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="input"
                    value={addToPlaylistName}
                    onChange={(e) => setAddToPlaylistName(e.target.value)}
                    placeholder="Playlist name..."
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && addToPlaylistName.trim()) {
                        setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: addToPlaylistName.trim(), items: [songToAddToPlaylist] }]);
                        setAddToPlaylistName('');
                        setSongToAddToPlaylist(null);
                        setSuccessMessage(`Created and added to ${addToPlaylistName.trim()}`);
                      }
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!addToPlaylistName.trim()}
                    onClick={() => {
                      setSavedPlaylists(prev => [...prev, { id: Date.now().toString(), name: addToPlaylistName.trim(), items: [songToAddToPlaylist] }]);
                      setAddToPlaylistName('');
                      setSongToAddToPlaylist(null);
                      setSuccessMessage(`Created and added to ${addToPlaylistName.trim()}`);
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
            
            <div className="modal-actions" style={{ marginTop: '24px' }}>
              <button 
                onClick={() => {
                  setSongToAddToPlaylist(null);
                  setAddToPlaylistName('');
                }}
                className="btn btn-secondary btn-large"
                style={{ width: '100%' }}
              >
                Cancel
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
