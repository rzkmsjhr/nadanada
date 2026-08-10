import React, { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Plus, Check, X, Disc, Music } from 'lucide-react';

const SongResultItem = ({ video, playlist, onAdd, handleAddAlbum, loadingAlbumId }) => {
  const isAlbum = video.is_playlist;
  const isAdded = !isAlbum && playlist.some(s => s.id === video.id);
  const isLoading = loadingAlbumId === video.id;
  
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
    <div 
      className="song-item" 
      style={{ borderRadius: '8px', padding: '8px', borderBottom: 'none', background: 'var(--bg-color)' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isAlbum ? (
        <div style={{ width: '64px', height: '36px', background: 'var(--border-color)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
           <Disc size={24} />
        </div>
      ) : (
        <img src={video.thumbnail} alt="" className="song-thumb" style={{ width: '64px', height: '36px' }} />
      )}
      
      <div className="song-info">
        <div className="song-title-wrapper">
          <div ref={textRef} className={`song-title ${isHovered && shouldScroll ? 'scrolling' : ''}`}>{video.title}</div>
        </div>
        <div className="song-duration" style={{ color: isAlbum ? 'var(--accent-color)' : 'var(--text-muted)' }}>
          {isAlbum ? (video.track_count ? `${video.track_count} tracks` : 'Album') : video.duration}
          {isAlbum && <span style={{ marginLeft: '6px', opacity: 0.7 }}>• {video.channel}</span>}
        </div>
      </div>
      <button 
        className={`btn btn-icon ${isAdded ? '' : 'btn-primary'}`} 
        onClick={(e) => { 
          e.stopPropagation(); 
          if (isLoading) return;
          if (isAlbum) {
            handleAddAlbum(video);
          } else if (!isAdded) {
            onAdd(video); 
          }
        }}
        disabled={isAdded || isLoading}
        title={isAdded ? "Already in Playlist" : (isAlbum ? "Add Album to Queue" : "Add to Playlist")}
      >
        {isLoading ? <Loader2 size={16} className="animate-spin" /> : (isAdded ? <Check size={16} /> : <Plus size={16} />)}
      </button>
    </div>
  );
};

export default function Search({ onAdd, onAddMultiple, playlist, onError }) {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('song');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingAlbumId, setLoadingAlbumId] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      const videos = await invoke('search_youtube', { query, searchType });
      setResults(videos);
    } catch (err) {
      console.error(err);
      onError('Search failed: ' + err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddAlbum = async (album) => {
    if (!album.first_video_id) {
      onError("Cannot fetch playlist without a starting video.");
      return;
    }
    setLoadingAlbumId(album.id);
    try {
      const tracks = await invoke('get_youtube_playlist', { 
        playlistId: album.id, 
        firstVideoId: album.first_video_id 
      });
      if (tracks && tracks.length > 0) {
        onAddMultiple(tracks);
      }
    } catch (err) {
      console.error(err);
      onError('Failed to load album: ' + err);
    } finally {
      setLoadingAlbumId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflow: 'hidden' }}>
      <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input 
              className="input" 
              style={{ width: '100%', paddingRight: '32px' }}
              placeholder="Search YouTube..." 
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button 
                type="button" 
                onClick={() => setQuery('')}
                style={{ 
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', 
                  background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={isSearching}>
            {isSearching ? <Loader2 size={18} className="animate-spin" /> : 'Search'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', padding: '0 4px' }}>
          <button
            type="button"
            className={`btn ${searchType === 'song' ? 'btn-primary' : ''}`}
            style={{ flex: 1, padding: '4px', fontSize: '12px', display: 'flex', gap: '6px', justifyContent: 'center', background: searchType === 'song' ? '' : 'var(--bg-color)' }}
            onClick={() => setSearchType('song')}
          >
            <Music size={14} /> Songs
          </button>
          <button
            type="button"
            className={`btn ${searchType === 'album' ? 'btn-primary' : ''}`}
            style={{ flex: 1, padding: '4px', fontSize: '12px', display: 'flex', gap: '6px', justifyContent: 'center', background: searchType === 'album' ? '' : 'var(--bg-color)' }}
            onClick={() => setSearchType('album')}
          >
            <Disc size={14} /> Albums
          </button>
        </div>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
        {results.map((video) => (
          <SongResultItem
            key={video.id}
            video={video}
            playlist={playlist}
            onAdd={onAdd}
            handleAddAlbum={handleAddAlbum}
            loadingAlbumId={loadingAlbumId}
          />
        ))}
      </div>
    </div>
  );
}
