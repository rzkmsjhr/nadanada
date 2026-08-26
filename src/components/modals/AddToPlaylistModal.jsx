import React, { useState } from 'react';
import { ListPlus } from 'lucide-react';
import { SavedPlaylistButtonItem } from '../SavedPlaylists';

const AddToPlaylistModal = ({
  songToAddToPlaylist,
  savedPlaylists,
  onAddToPlaylist,
  onCreatePlaylist,
  onClose
}) => {
  const [name, setName] = useState('');

  const handleCreate = () => {
    if (name.trim()) {
      onCreatePlaylist(name.trim());
      setName('');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: '90%', maxWidth: '400px' }}>
        <div className="modal-icon-container">
          <ListPlus className="modal-icon" />
        </div>
        <h3 className="modal-title">Add to Playlist</h3>
        <div style={{ width: '100%', marginTop: '16px' }}>
          {savedPlaylists.length > 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '200px',
              overflowY: 'auto',
              marginBottom: '16px',
              paddingRight: '8px'
            }}>
              {savedPlaylists.map(pl => (
                <SavedPlaylistButtonItem 
                  key={pl.id} 
                  pl={pl} 
                  onClick={() => onAddToPlaylist(pl)} 
                />
              ))}
            </div>
          )}
          
          <div style={{
            borderTop: '1px solid var(--panel-border)',
            paddingTop: '16px'
          }}>
            <div style={{
              fontSize: '0.85rem',
              fontWeight: 'bold',
              marginBottom: '8px',
              color: 'var(--text-main)'
            }}>Create New Playlist</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                className="input" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Playlist name..." 
                style={{ flex: 1 }} 
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate();
                }} 
              />
              <button 
                className="btn btn-primary" 
                disabled={!name.trim()} 
                onClick={handleCreate}
              >
                Create
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-actions" style={{ marginTop: '24px' }}>
          <button 
            onClick={() => {
              setName('');
              onClose();
            }} 
            className="btn btn-secondary btn-large" 
            style={{ width: '100%' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddToPlaylistModal;
