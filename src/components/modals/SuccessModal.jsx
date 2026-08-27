import React from 'react';
import { CheckCircle } from 'lucide-react';

const SuccessModal = ({ message, onClose }) => {
  if (!message) return null;

  const displayMessage = typeof message === 'string' ? message : (message?.message || JSON.stringify(message));

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-icon-container">
          <CheckCircle className="modal-icon" style={{
            color: 'var(--accent-color)',
            animation: 'none'
          }} />
        </div>
        <h3 className="modal-title">Success</h3>
        <p className="modal-desc">{displayMessage}</p>
        <div className="modal-actions">
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
