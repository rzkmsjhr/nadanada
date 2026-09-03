import React from 'react';
import { CheckCircle } from 'lucide-react';

const SuccessModal = ({ message, onClose }) => {
  if (!message) return null;

  const displayMessage = typeof message === 'string' ? message : (message?.text || message?.message || '');
  const failedSongs = (typeof message === 'object' && Array.isArray(message?.failedSongs)) ? message.failedSongs : [];

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '440px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-icon-container">
          <CheckCircle className="modal-icon" style={{
            color: 'var(--accent-color)',
            animation: 'none'
          }} />
        </div>
        <h3 className="modal-title">Success</h3>
        <p className="modal-desc" style={{ marginBottom: failedSongs.length > 0 ? '12px' : '24px' }}>
          {displayMessage}
        </p>

        {failedSongs.length > 0 && (
          <div style={{
            width: '100%',
            textAlign: 'left',
            marginBottom: '20px',
            backgroundColor: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            borderRadius: '10px',
            padding: '10px 14px',
            maxHeight: '160px',
            overflowY: 'auto'
          }}>
            <div style={{
              fontSize: '0.78rem',
              fontWeight: '600',
              color: 'var(--text-muted)',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Unmatched Songs ({failedSongs.length})
            </div>
            <ul style={{
              margin: 0,
              paddingLeft: '18px',
              fontSize: '0.82rem',
              color: 'var(--text-main)',
              lineHeight: '1.4'
            }}>
              {failedSongs.map((song, idx) => (
                <li key={idx} style={{ marginBottom: '3px', wordBreak: 'break-word' }}>
                  {song}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-actions" style={{ width: '100%' }}>
          <button 
            onClick={onClose} 
            className="btn btn-primary btn-large" 
            style={{ width: '100%' }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuccessModal;
