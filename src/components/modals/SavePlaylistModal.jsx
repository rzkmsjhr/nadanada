import React, { useState } from 'react';
import { Save } from 'lucide-react';

const SavePlaylistModal = ({ onSave, onClose }) => {
  const [name, setName] = useState('');

  const handleSave = () => {
    if (name.trim()) {
      onSave(name.trim());
    }
  };

  return (
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
            value={name} 
            onChange={e => setName(e.target.value)} 
            placeholder="My Awesome Playlist..." 
            style={{ marginBottom: '24px' }} 
            autoFocus 
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave();
            }} 
          />
        </div>
        
        <div className="modal-actions">
          <button 
            onClick={handleSave} 
            className="btn btn-primary btn-large" 
            disabled={!name.trim()}
          >
            Save
          </button>
          <button 
            onClick={onClose} 
            className="btn btn-secondary btn-large"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default SavePlaylistModal;
