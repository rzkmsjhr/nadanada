import React from 'react';
import { AlertTriangle } from 'lucide-react';

const ClearPlaylistModal = ({ onClear, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-icon-container">
          <AlertTriangle className="modal-icon" style={{
            color: '#ef4444',
            animation: 'none'
          }} />
        </div>
        <div>
          <h3 className="modal-title">Clear Playlist?</h3>
          <p className="modal-desc">
            Are you sure you want to clear your current playlist? This action cannot be undone.
          </p>
        </div>
        
        <div className="modal-actions">
          <button 
            onClick={onClear} 
            className="btn btn-primary btn-large" 
            style={{
              background: '#ef4444',
              borderColor: '#ef4444'
            }}
          >
            Clear All
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

export default ClearPlaylistModal;
