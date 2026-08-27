import React from 'react';
import { AlertTriangle } from 'lucide-react';

const ErrorModal = ({ error, onClose }) => {
  if (!error) return null;
  
  const errorMessage = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
  
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-icon-container">
          <AlertTriangle className="modal-icon" style={{
            color: '#ef4444',
            animation: 'none'
          }} />
        </div>
        <h3 className="modal-title">Error</h3>
        <p className="modal-desc">{errorMessage}</p>
        <div className="modal-actions">
          <button 
            onClick={onClose} 
            className="btn btn-secondary btn-large" 
            style={{ width: '100%' }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorModal;
