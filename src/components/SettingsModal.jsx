import React from 'react';
import { X, Check, Palette, Sliders, Database, AlertTriangle, PictureInPicture2, AppWindow, Type } from 'lucide-react';
import { api } from '../services/api';

const THEMES = [
  { id: 'crimson-night', name: 'Crimson Night', bg: '#080d16', accent: '#BF092F' },
  { id: 'nox-noir', name: 'Nox Noir', bg: '#121316', accent: '#8B5CF6' },
  { id: 'snickers-dark', name: 'Snickers Dark', bg: '#18092B', accent: '#3B72FF' },
  { id: 'golden-hour', name: 'Golden Hour', bg: '#1C1126', accent: '#FF7A59' },
  { id: 'lavender-steel', name: 'Lavender Steel', bg: '#FFDBED', accent: '#E34877' },
  { id: 'mahogany-dusk', name: 'Mahogany Dusk', bg: '#CAE7F7', accent: '#F94C00' },
  { id: 'tidal-sage', name: 'Tidal Sage', bg: '#E6D4BE', accent: '#3A74A6' },
  { id: 'sangria-deep', name: 'Sangria Deep', bg: '#E4EAE8', accent: '#479C73' }
];

const OPACITY_OPTIONS = [10, 30, 50, 70, 100];
const FONT_SIZE_OPTIONS = [70, 85, 100, 110, 125, 150];

function getClosestIndex(arr, val, defaultIdx = 0) {
  const direct = arr.indexOf(val);
  if (direct !== -1) return direct;
  let closest = defaultIdx;
  let minDiff = Infinity;
  arr.forEach((opt, idx) => {
    const diff = Math.abs(opt - val);
    if (diff < minDiff) {
      minDiff = diff;
      closest = idx;
    }
  });
  return closest;
}

export default function SettingsModal({
  onClose,
  theme,
  setTheme,
  crossfadeDuration,
  setCrossfadeDuration,
  miniPlayerOpacity = 30,
  setMiniPlayerOpacity,
  fontScale = 100,
  setFontScale,
  closeBehavior = 'prompt',
  setCloseBehavior
}) {
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '360px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
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

          <div style={{
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
            marginTop: '8px',
            opacity: 0.8
          }}>
            Crossfade applies to online playback. Automatically turned off for downloaded &amp; offline tracks.
          </div>
        </div>

        {/* Mini Player Transparency Section */}
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
              <PictureInPicture2 size={16} />
              <span>Mini Player Transparency</span>
            </div>
            <span style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              color: 'var(--accent-color)'
            }}>
              {miniPlayerOpacity}%
            </span>
          </div>

          {(() => {
            const currentIdx = getClosestIndex(OPACITY_OPTIONS, miniPlayerOpacity, 1);
            return (
              <>
                <input
                  type="range"
                  min="0"
                  max={OPACITY_OPTIONS.length - 1}
                  step="1"
                  value={currentIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    if (setMiniPlayerOpacity) setMiniPlayerOpacity(OPACITY_OPTIONS[idx]);
                  }}
                  className="seek-bar"
                  style={{
                    width: '100%',
                    accentColor: 'var(--accent-color)',
                    background: `linear-gradient(to right, var(--accent-color) ${(currentIdx / (OPACITY_OPTIONS.length - 1)) * 100}%, var(--panel-border) ${(currentIdx / (OPACITY_OPTIONS.length - 1)) * 100}%)`,
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
                  {OPACITY_OPTIONS.map(val => (
                    <span key={val}>{val}%</span>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* Lyrics & Chords Font Size Section (Merged) */}
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
              <Type size={16} />
              <span>Lyrics &amp; Chords Font Size</span>
            </div>
            <span style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              color: 'var(--accent-color)'
            }}>
              {fontScale}%{fontScale === 100 ? ' (Default)' : ''}
            </span>
          </div>

          {(() => {
            const currentIdx = getClosestIndex(FONT_SIZE_OPTIONS, fontScale, 2);
            return (
              <>
                <input
                  type="range"
                  min="0"
                  max={FONT_SIZE_OPTIONS.length - 1}
                  step="1"
                  value={currentIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    if (setFontScale) setFontScale(FONT_SIZE_OPTIONS[idx]);
                  }}
                  className="seek-bar"
                  style={{
                    width: '100%',
                    accentColor: 'var(--accent-color)',
                    background: `linear-gradient(to right, var(--accent-color) ${(currentIdx / (FONT_SIZE_OPTIONS.length - 1)) * 100}%, var(--panel-border) ${(currentIdx / (FONT_SIZE_OPTIONS.length - 1)) * 100}%)`,
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
                  {FONT_SIZE_OPTIONS.map(val => (
                    <span key={val}>{val}%</span>
                  ))}
                </div>
              </>
            );
          })()}

          <div style={{
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
            marginTop: '8px',
            opacity: 0.8
          }}>
            Scales lyrics and chords across fullscreen, maximized, regular, and mini player modes.
          </div>
        </div>

        {/* Window Close Behavior Section */}
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
            <AppWindow size={16} />
            <span>Window Close Button Behavior</span>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            {[
              { id: 'minimize', label: 'Minimize to Tray' },
              { id: 'close', label: 'Close the App' },
              { id: 'prompt', label: 'Ask Every Time' }
            ].map(item => {
              const isSelected = (closeBehavior || 'prompt') === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCloseBehavior && setCloseBehavior(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid var(--accent-color)' : '1px solid var(--panel-border)',
                    background: isSelected ? 'var(--panel-border)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    color: 'inherit'
                  }}
                >
                  <span style={{ 
                    fontSize: '0.85rem', 
                    fontWeight: 600, 
                    color: isSelected ? 'var(--accent-color)' : 'var(--text-main)' 
                  }}>
                    {item.label}
                  </span>
                  <div style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    border: isSelected ? '4px solid var(--accent-color)' : '1.5px solid var(--text-muted)',
                    background: isSelected ? 'var(--text-main)' : 'transparent',
                    boxSizing: 'border-box',
                    flexShrink: 0,
                    marginLeft: '8px'
                  }} />
                </button>
              );
            })}
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
              if (window.confirm('Are you sure you want to clear app data and cache? Your saved playlists and downloaded songs will be kept.')) {
                // Preserve saved playlists (NOT the current "my playlist" queue)
                const savedPlaylists = localStorage.getItem('nadanada-saved-playlists');

                localStorage.clear();
                sessionStorage.clear();

                if (savedPlaylists) {
                  localStorage.setItem('nadanada-saved-playlists', savedPlaylists);
                }
                
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

                // Clear offline lyrics and chords disk cache
                try {
                  await api.clearCachedData();
                } catch (err) {
                  console.error('Failed to clear cached disk data', err);
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
