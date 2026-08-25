import React, { useState } from 'react';
import { Keyboard, Music, Download, Sparkles, X } from 'lucide-react';

export default function WelcomeModal({ onClose }) {
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('nadanada-welcome-seen', 'true');
    }
    onClose();
  };

  const kbdStyle = {
    background: 'var(--bg-color)',
    border: '1px solid var(--panel-border)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '0.75rem',
    fontFamily: 'monospace',
    color: 'var(--text-main)',
    boxShadow: '0 1px 0 var(--panel-border)'
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 10000 }}>
      <div className="modal-content" style={{
        maxWidth: '500px', width: '90%', padding: '24px',
        borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '24px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        position: 'relative',
        border: '1px solid var(--panel-border)',
        textAlign: 'left'
      }}>
        <button className="btn btn-icon" onClick={handleClose} style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10 }}>
          <X size={22} />
        </button>

        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '1.5rem', color: 'var(--text-main)' }}>Welcome to NadaNada</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>Your personal endless music companion.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '4px' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <Sparkles size={22} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '1.05rem' }}>Endless Discovery</h4>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Play any track and let the Endless Mix keep the music going forever.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <Download size={22} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '1.05rem' }}>Offline Listening</h4>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Download your favorite songs to your device for offline playback.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <Keyboard size={22} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '1.05rem' }}>Keyboard Shortcuts</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <div><kbd style={kbdStyle}>Space</kbd> Play/Pause</div>
                <div><kbd style={kbdStyle}>F</kbd> Toggle Search</div>
                <div><kbd style={kbdStyle}>←</kbd> <kbd style={kbdStyle}>→</kbd> Prev/Next</div>
                <div><kbd style={kbdStyle}>M</kbd> Mute</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginTop: '8px', 
          paddingTop: '20px', 
          borderTop: '1px solid var(--panel-border)',
          gap: '8px'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent-color)', width: '16px', height: '16px' }} />
            Don't show this again
          </label>
          <button className="btn btn-primary" onClick={handleClose} style={{ padding: '8px 16px', fontWeight: 'bold', fontSize: '0.9rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
