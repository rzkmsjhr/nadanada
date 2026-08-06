import React, { useState, useEffect } from 'react';
import Player from './components/Player';
import Search from './components/Search';
import Playlist from './components/Playlist';
import { Music2, Sun, Moon, Palette, Search as SearchIcon, X, Minus, Square, Infinity, Disc, Trash2, Save, FolderOpen, AlertTriangle, ListMusic } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
const topPanelStyle = { ...basePanelStyle, position: 'relative' };
const bottomPanelStyle = { ...basePanelStyle, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 };

const staticStyles = {
  headerBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', boxShadow: '0 1px 0 0 var(--panel-border)' },
  headerTitle: { fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' },
  headerLoading: { fontSize: '0.8rem', color: 'var(--accent-color)' },
  headerIcons: { display: 'flex', gap: '8px' },
  iconBtn: { padding: '6px' },
  iconBtnDanger: { padding: '6px', color: '#ef4444' },
  separator: { width: '2px', background: 'var(--panel-border)', margin: '4px 0', borderRadius: '1px' },
  playlistContainer: { flex: 1, overflow: 'hidden' },
  searchContainer: { padding: '16px', height: '100%', display: 'flex', flex: 1, minHeight: 0 }
};

function App() {
  const appWindow = getCurrentWindow();
  const [theme, setTheme] = useState(() => localStorage.getItem('nadanada-theme') || 'lavender-steel');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [playlist, setPlaylist] = useState(() => {
    const saved = localStorage.getItem('nadanada-session-playlist');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = localStorage.getItem('nadanada-session-index');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [showSearch, setShowSearch] = useState(false);
  const [isEndlessPlay, setIsEndlessPlay] = useState(false);
  const [isFetchingEndless, setIsFetchingEndless] = useState(false);
  const [failedEndlessFetch, setFailedEndlessFetch] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  
  // Chords state
  const [showChords, setShowChords] = useState(false);
  const [chordsData, setChordsData] = useState(null);
  const [isFetchingChords, setIsFetchingChords] = useState(false);
  const [chordsError, setChordsError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0);
  const [transposeOffset, setTransposeOffset] = useState(0);
  const [showClearPrompt, setShowClearPrompt] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [showLoadPrompt, setShowLoadPrompt] = useState(false);
  const [savePlaylistName, setSavePlaylistName] = useState('');
  const [savedPlaylists, setSavedPlaylists] = useState(() => {
    const saved = localStorage.getItem('nadanada-saved-playlists');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('nadanada-session-playlist', JSON.stringify(playlist));
    localStorage.setItem('nadanada-session-index', currentIndex.toString());
  }, [playlist, currentIndex]);

  useEffect(() => {
    localStorage.setItem('nadanada-saved-playlists', JSON.stringify(savedPlaylists));
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
      'nox-noir'
    ];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
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
      
      if (showChords && isAudioPlaying && (!chordsData || chordsData._songId !== currentSong.id) && !isFetchingChords) {
        const fetchChords = async () => {
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
    
    const fetchFact = async () => {
      try {
        let artist = currentSong.channel ? currentSong.channel.replace(/ - Topic/i, '').trim() : '';
        if (!artist) {
            const parts = currentSong.title.split('-');
            if (parts.length > 1) {
                artist = parts[0].trim();
            } else {
                setArtistFact('');
                return;
            }
        }
        
        // Wikipedia allows CORS. Try the band specific page first.
        let res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artist + '_(band)')}`);
        if (!res.ok) {
            res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artist)}`);
        }
        
        if (res.ok) {
            const data = await res.json();
            if (data.extract) {
                let firstSentence = data.extract.split('. ')[0];
                if (!firstSentence.endsWith('.')) {
                    firstSentence += '.';
                }
                setArtistFact(firstSentence);
            } else {
                setArtistFact('');
            }
        } else {
            setArtistFact('');
        }
      } catch (e) {
        setArtistFact('');
      }
    };
    
    fetchFact();
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
          
          const results = await invoke('get_youtube_mix', { videoId: current.id });
          
          const existingIds = new Set(playlist.map(s => s.id));
          
          const available = results.filter(v => !existingIds.has(v.id));
          
          if (available.length > 0) {
            let finalPicked = null;
            
            for (let item of available) {
              let picked = item;
              
              // If the recommended song is a "video" version, try to find the audio version
              const videoRegex = /(official video|music video|official hd video|official music video|\bvideo\b)/i;
              if (videoRegex.test(picked.title)) {
                // Clean the title by removing bracketed stuff and the video keywords
                const cleanTitle = picked.title
                  .replace(/\[.*?\]|\(.*?\)/g, ' ')
                  .replace(videoRegex, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                  
                if (cleanTitle.length > 0) {
                  try {
                    const searchResults = await invoke('search_youtube', { query: cleanTitle + ' topic' });
                    if (searchResults && searchResults.length > 0) {
                      picked = searchResults[0];
                    }
                  } catch (err) {
                    console.error("Audio fallback search failed:", err);
                  }
                }
              }
              
              // Check if the final ID is already in the playlist
              if (!existingIds.has(picked.id)) {
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
  }, [currentIndex, playlist]);

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
    const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setPlaylist(prev => [...prev, { ...video, queueId }]);
  };

  const handleRemoveSong = (index) => {
    setPlaylist(prev => {
      const newPlaylist = [...prev];
      newPlaylist.splice(index, 1);
      return newPlaylist;
    });
    if (index < currentIndex) {
      setCurrentIndex(currentIndex - 1);
    } else if (index === currentIndex && currentIndex >= playlist.length - 1) {
      setCurrentIndex(Math.max(0, currentIndex - 1));
    }
  };

  const handleReorder = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    
    setPlaylist(prev => {
      const newPlaylist = [...prev];
      const [movedItem] = newPlaylist.splice(fromIndex, 1);
      newPlaylist.splice(toIndex, 0, movedItem);
      return newPlaylist;
    });

    if (currentIndex === fromIndex) {
      setCurrentIndex(toIndex);
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      setCurrentIndex(currentIndex - 1);
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      setCurrentIndex(currentIndex + 1);
    }
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

      {/* Top Section: Player & Controls */}
      <div className="top-section glass-panel" style={topPanelStyle}>
        <header className="header" style={{ paddingBottom: '12px', display: 'flex', alignItems: 'center', height: '50px' }}>
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
                  <button onClick={() => setTransposeOffset(s => s - 1)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Transpose Down">
                    -
                  </button>
                  <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 'bold', color: 'var(--text-main)' }}>
                    {transposeOffset > 0 ? '+' : ''}{transposeOffset}
                  </span>
                  <button onClick={() => setTransposeOffset(s => s + 1)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Transpose Up">
                    +
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '8px', padding: '2px 6px', color: 'var(--text-muted)' }}>
                  <span style={{ marginRight: '4px' }}>Sync:</span>
                  <button onClick={() => setSyncOffset(s => s - 0.25)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Delay Chords">
                    -
                  </button>
                  <span style={{ minWidth: '32px', textAlign: 'center', fontWeight: 'bold', color: 'var(--text-main)' }}>
                    {syncOffset > 0 ? '+' : ''}{syncOffset}s
                  </span>
                  <button onClick={() => setSyncOffset(s => s + 0.25)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Advance Chords">
                    +
                  </button>
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

        <Player 
          currentSong={currentSong} 
          nextSong={playlist[currentIndex + 1]}
          onNext={handleNext} 
          onPrevious={handlePrevious} 
          hasNext={currentIndex < playlist.length - 1}
          hasPrevious={currentIndex > 0}
          onPlayStateChange={setIsAudioPlaying}
          onTimeUpdate={setCurrentTime}
        />
      </div>

      {/* Bottom Section: Playlist or Search */}
      <div className="bottom-section glass-panel" style={bottomPanelStyle}>
        <div style={staticStyles.headerBar}>
          <div style={staticStyles.headerTitle}>
            {showSearch ? 'Search YouTube' : `Up Next (${playlist.length})`}
            {!showSearch && isFetchingEndless && <span style={staticStyles.headerLoading}>Loading mix...</span>}
            {!showSearch && failedEndlessFetch && (
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
            {!showSearch && (
              <>
                <button className="btn btn-icon" onClick={() => setShowLoadPrompt(true)} title="Load Playlist" style={staticStyles.iconBtn}>
                  <FolderOpen size={18} />
                </button>
                {playlist.length > 0 && (
                  <button className="btn btn-icon" onClick={() => setShowSavePrompt(true)} title="Save Playlist" style={staticStyles.iconBtn}>
                    <Save size={18} />
                  </button>
                )}
                {playlist.length > 0 && (
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
                  <Infinity size={18} />
                </button>
              </>
            )}
            <button className="btn btn-icon" onClick={() => setShowSearch(!showSearch)} title={showSearch ? "Close Search" : "Search Music"} style={{ padding: '6px' }}>
              {showSearch ? <X size={18} /> : <SearchIcon size={18} />}
            </button>
          </div>
        </div>
        
        <div style={staticStyles.playlistContainer}>
          {showSearch ? (
            <div style={staticStyles.searchContainer}>
              <Search onAdd={handleAddSong} playlist={playlist} />
            </div>
          ) : (
            <Playlist 
              playlist={playlist} 
              currentIndex={currentIndex} 
              onSelectIndex={setCurrentIndex} 
              onRemove={handleRemoveSong}
              onReorder={handleReorder}
            />
          )}
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
                    <div key={pl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '12px', cursor: 'pointer' }} onClick={() => { setPlaylist(pl.items); setCurrentIndex(0); setShowLoadPrompt(false); }}>
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
    </div>
  );
}

export default App;
