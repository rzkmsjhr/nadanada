import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Plus, Check, X } from 'lucide-react';

export default function Search({ onAdd, playlist }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      const videos = await invoke('search_youtube', { query });
      setResults(videos);
    } catch (err) {
      console.error(err);
      alert('Search failed: ' + err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflow: 'hidden' }}>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
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
              onClick={() => {
                setQuery('');
              }}
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
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
        {results.map((video) => {
          const isAdded = playlist.some(s => s.id === video.id);
          return (
            <div key={video.id} className="song-item" style={{ borderRadius: '8px', padding: '8px', borderBottom: 'none', background: 'var(--bg-color)' }}>
              <img src={video.thumbnail} alt="" className="song-thumb" style={{ width: '64px', height: '36px' }} />
              <div className="song-info">
                <div className="song-title">{video.title}</div>
                <div className="song-duration">{video.duration}</div>
              </div>
              <button 
                className={`btn btn-icon ${isAdded ? '' : 'btn-primary'}`} 
                onClick={(e) => { e.stopPropagation(); if (!isAdded) onAdd(video); }}
                disabled={isAdded}
                title={isAdded ? "Already in Playlist" : "Add to Playlist"}
              >
                {isAdded ? <Check size={16} /> : <Plus size={16} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
