import React from 'react';
import { Loader2 } from 'lucide-react';
import { SavedPlaylistItem } from '../SavedPlaylists';

const LoadPlaylistModal = ({
  savedPlaylists,
  onSelect,
  onDelete,
  onRename,
  onClose,
  importUrl,
  setImportUrl,
  isImporting,
  importProgress,
  handleImportPlaylist
}) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div style={{ width: '100%' }}>
          <h3 className="modal-title" style={{ marginBottom: '20px' }}>Your Playlists</h3>
          {savedPlaylists.length === 0 ? (
            <p className="modal-desc">You haven't saved any playlists yet.</p>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '300px',
              overflowY: 'auto',
              marginBottom: '24px',
              paddingRight: '8px',
              width: '100%'
            }}>
              {savedPlaylists.map(pl => (
                <SavedPlaylistItem 
                  key={pl.id} 
                  pl={pl} 
                  onSelect={onSelect} 
                  onDelete={onDelete} 
                  onRename={onRename} 
                />
              ))}
            </div>
          )}
        </div>
        
        <div style={{
          width: '100%',
          marginTop: '16px',
          marginBottom: '24px',
          borderTop: '1px solid var(--panel-border)',
          paddingTop: '16px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '8px'
          }}>
            <div style={{
              fontSize: '0.85rem',
              fontWeight: 'bold',
              color: 'var(--text-main)'
            }}>Import Playlist</div>
            <img src="/youtube.svg" alt="YouTube" title="YouTube supported" style={{
              height: '12px',
              width: 'auto',
              objectFit: 'contain',
              position: 'relative',
              top: '2px'
            }} />
            <img src="/spotify.svg" alt="Spotify" title="Spotify supported" style={{
              height: '12px',
              width: 'auto',
              objectFit: 'contain',
              position: 'relative',
              top: '1px'
            }} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="text" 
              className="input" 
              value={importUrl} 
              onChange={e => setImportUrl(e.target.value)} 
              placeholder="Your playlist url" 
              style={{ flex: 1 }} 
              onKeyDown={e => {
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
          <button onClick={onClose} className="btn btn-secondary btn-large">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoadPlaylistModal;
