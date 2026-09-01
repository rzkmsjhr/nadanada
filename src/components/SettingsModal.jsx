import React from 'react';
import { X, Check, Palette, Sliders, Database, AlertTriangle } from 'lucide-react';

const THEMES = [
  { id: 'lavender-steel', name: 'Lavender Steel', bg: '#FFDBED', accent: '#E34877' },
  { id: 'mahogany-dusk', name: 'Mahogany Dusk', bg: '#CAE7F7', accent: '#F94C00' },
  { id: 'tidal-sage', name: 'Tidal Sage', bg: '#E6D4BE', accent: '#3A74A6' },
  { id: 'sangria-deep', name: 'Sangria Deep', bg: '#E4EAE8', accent: '#479C73' },
  { id: 'midnight-static', name: 'Midnight Static', bg: '#CF98AF', accent: '#144EA0' },
  { id: 'obsidian-root', name: 'Obsidian Root', bg: '#FCFF1A', accent: '#FF2070' },
  { id: 'nox-noir', name: 'Nox Noir', bg: '#CFCFCF', accent: '#7E49B3' },
  { id: 'crimson-night', name: 'Crimson Night', bg: '#080d16', accent: '#BF092F' }
];

export default function SettingsModal({
  onClose,
  theme,
  setTheme,
  crossfadeDuration,
  setCrossfadeDuration
}) {
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '360px',
          width: '90%',
          padding: '24px',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          position: 'relative',
          border: '1px solid var(--panel-border)',
          textAlign: 'left'
        }}
      >
        <button 
          className="btn btn-icon" 
          onClick={onClose} 
          title="Close"
          style={{ 
            position: 'absolute', 
            top: '14px', 
            right: '14px', 
            zIndex: 10,
            padding: '4px' 
          }}
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: '32px' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-main)', fontWeight: 600 }}>
            Settings
          </h3>
        </div>

        {/* Theme Section */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.8rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.75px',
            color: 'var(--text-muted)',
            marginBottom: '12px'
          }}>
            <Palette size={16} />
            <span>Theme Selection</span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '10px'
          }}>
            {THEMES.map(t => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme && setTheme(t.id)}
                  title={t.name}
                  style={{
                    height: '36px',
                    borderRadius: '8px',
                    border: isSelected ? '2px solid var(--accent-color)' : '1px solid var(--panel-border)',
                    background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)`,
                    cursor: 'pointer',
                    boxShadow: isSelected ? '0 0 10px var(--accent-color)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0
                  }}
                >
                  {isSelected && (
                    <Check 
                      size={16} 
                      style={{ 
                        color: '#ffffff', 
                        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' 
                      }} 
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Crossfade Section */}
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.75px',
              color: 'var(--text-muted)'
            }}>
              <Sliders size={16} />
              <span>Crossfade</span>
            </div>
            <span style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              color: 'var(--accent-color)'
            }}>
              {crossfadeDuration === 0 ? 'Off' : `${crossfadeDuration}s`}
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="5"
            step="1"
            value={crossfadeDuration === 0 ? 0 : crossfadeDuration - 1}
            onChange={(e) => {
              const idx = Number(e.target.value);
              const val = idx === 0 ? 0 : idx + 1;
              if (setCrossfadeDuration) setCrossfadeDuration(val);
            }}
            className="seek-bar"
            style={{
              width: '100%',
              accentColor: 'var(--accent-color)',
              background: `linear-gradient(to right, var(--accent-color) ${((crossfadeDuration === 0 ? 0 : crossfadeDuration - 1) / 5) * 100}%, var(--panel-border) ${((crossfadeDuration === 0 ? 0 : crossfadeDuration - 1) / 5) * 100}%)`,
              cursor: 'pointer'
            }}
          />

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            marginTop: '6px',
            userSelect: 'none'
          }}>
            <span>Off</span>
            <span>2s</span>
            <span>3s</span>
            <span>4s</span>
            <span>5s</span>
            <span>6s</span>
          </div>
        </div>

        {/* App Data Section */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.8rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.75px',
            color: 'var(--text-muted)',
            marginBottom: '12px'
          }}>
            <Database size={16} />
            <span>App Data</span>
          </div>

          <button
            onClick={async () => {
              if (window.confirm('Are you sure you want to clear all app data, including saved playlists and settings? This action cannot be undone.')) {
                localStorage.clear();
                sessionStorage.clear();
                
                if (window.caches) {
                  try {
                    const cacheKeys = await window.caches.keys();
                    await Promise.all(cacheKeys.map(key => window.caches.delete(key)));
                  } catch (err) {
                    console.error('Failed to clear caches', err);
                  }
                }

                if (window.indexedDB && window.indexedDB.databases) {
                  try {
                    const dbs = await window.indexedDB.databases();
                    dbs.forEach(db => {
                      if (db.name) window.indexedDB.deleteDatabase(db.name);
                    });
                  } catch (err) {
                    console.error('Failed to clear indexedDB', err);
                  }
                }
                
                window.location.reload();
              }
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px',
              backgroundColor: 'transparent',
              border: '1px solid #ef4444',
              color: '#ef4444',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <AlertTriangle size={18} />
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
}
