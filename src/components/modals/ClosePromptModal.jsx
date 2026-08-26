import React from 'react';
import { Disc } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../../services/api';

const ClosePromptModal = ({ onClose }) => {
  return (
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
              onClose();
              await getCurrentWindow().hide();
            }} 
            className="btn btn-primary btn-large"
          >
            Minimize to Tray
          </button>
          <button 
            onClick={async () => {
              onClose();
              await api.quitApp();
            }} 
            className="btn btn-secondary btn-large"
          >
            Quit App
          </button>
          <button 
            onClick={() => onClose()} 
            className="btn btn-cancel btn-large"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClosePromptModal;
