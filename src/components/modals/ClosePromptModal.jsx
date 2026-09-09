import React, { useState } from 'react';
import { Disc } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../../services/api';

const ClosePromptModal = ({ onClose, setCloseBehavior }) => {
  const [rememberChoice, setRememberChoice] = useState(false);

  const handleMinimize = async () => {
    if (rememberChoice && setCloseBehavior) {
      setCloseBehavior('minimize');
    }
    onClose();
    try {
      await getCurrentWindow().hide();
    } catch (err) {
      console.error('Failed to hide window:', err);
    }
  };

  const handleQuit = async () => {
    if (rememberChoice && setCloseBehavior) {
      setCloseBehavior('close');
    }
    onClose();
    try {
      await api.quitApp();
    } catch (err) {
      console.error('Failed to quit app:', err);
    }
  };

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

        <label style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          cursor: 'pointer',
          marginBottom: '20px',
          fontSize: '0.85rem',
          lineHeight: 1,
          color: 'var(--text-muted)',
          userSelect: 'none'
        }}>
          <input 
            type="checkbox" 
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            style={{
              margin: 0,
              padding: 0,
              accentColor: 'var(--accent-color)',
              width: '15px',
              height: '15px',
              cursor: 'pointer',
              flexShrink: 0,
              position: 'relative',
              top: '1px'
            }}
          />
          <span style={{ lineHeight: 1 }}>Remember this choice</span>
        </label>
        
        <div className="modal-actions">
          <button 
            onClick={handleMinimize} 
            className="btn btn-primary btn-large"
          >
            Minimize to Tray
          </button>
          <button 
            onClick={handleQuit} 
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
