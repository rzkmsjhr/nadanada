import React, { useState, useRef, useEffect } from "react";
import { Check, X, Pencil, Trash2, Loader2 } from "lucide-react";
const SavedPlaylistItem = React.memo(({ pl, onSelect, onDelete, onRename, isLoading }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(pl.name);
  const [isHovered, setIsHovered] = useState(false);
  const [shouldScroll, setShouldScroll] = useState(false);
  const textRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleMouseEnter = () => {
    if (textRef.current) {
      setShouldScroll(textRef.current.scrollWidth > textRef.current.clientWidth);
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShouldScroll(false);
  };

  const handleSaveRename = (e) => {
    if (e) e.stopPropagation();
    const trimmed = editName.trim();
    if (trimmed && trimmed !== pl.name) {
      onRename(pl.id, trimmed);
    } else {
      setEditName(pl.name);
    }
    setIsEditing(false);
  };

  const handleCancelRename = (e) => {
    if (e) e.stopPropagation();
    setEditName(pl.name);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div 
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--panel-bg)', border: '1px solid var(--accent-color)', borderRadius: '12px', gap: '8px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            ref={inputRef}
            type="text"
            className="input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveRename(e);
              if (e.key === 'Escape') handleCancelRename(e);
            }}
            style={{ width: '100%', fontSize: '0.85rem', padding: '4px 8px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button 
            className="btn btn-icon" 
            style={{ border: 'none', color: 'var(--accent-color)', padding: '4px' }}
            onClick={handleSaveRename}
            title="Save Name"
          >
            <Check size={16} />
          </button>
          <button 
            className="btn btn-icon" 
            style={{ border: 'none', color: 'var(--text-muted)', padding: '4px' }}
            onClick={handleCancelRename}
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px',
        background: 'var(--panel-bg)',
        border: isLoading ? '1px solid var(--accent-color)' : '1px solid var(--panel-border)',
        borderRadius: '12px',
        cursor: isLoading ? 'wait' : 'pointer',
        gap: '8px',
        opacity: isLoading ? 0.9 : 1
      }} 
      onClick={() => {
        if (!isLoading) onSelect(pl);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={{ textAlign: 'left', overflow: 'hidden', flex: 1, minWidth: 0 }}>
        <div className="song-title-wrapper">
          <div ref={textRef} className={`song-title ${isHovered && shouldScroll ? 'scrolling' : ''}`} style={{ fontWeight: '600' }}>
            {pl.name}
          </div>
        </div>
        <div style={{ fontSize: '0.8rem', color: isLoading ? 'var(--accent-color)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isLoading ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Checking Hi-Fi (1-5)...</span>
            </>
          ) : (
            <span>{pl.items.length} songs</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        {isLoading ? (
          <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', color: 'var(--accent-color)' }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <>
            <button 
              className="btn btn-icon" 
              style={{ border: 'none', color: 'var(--text-muted)' }}
              onClick={(e) => {
                e.stopPropagation();
                setEditName(pl.name);
                setIsEditing(true);
              }}
              title="Edit Name"
            >
              <Pencil size={15} />
            </button>
            <button 
              className="btn btn-icon" 
              style={{ border: 'none', color: '#ef4444' }}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(pl.id);
              }}
              title="Delete Playlist"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

const SavedPlaylistButtonItem = React.memo(({ pl, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [shouldScroll, setShouldScroll] = useState(false);
  const textRef = useRef(null);

  const handleMouseEnter = () => {
    if (textRef.current) {
      setShouldScroll(textRef.current.scrollWidth > textRef.current.clientWidth);
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShouldScroll(false);
  };

  return (
    <button
      className="btn"
      style={{ padding: '12px', textAlign: 'left', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}
      onClick={() => onClick(pl)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div className="song-title-wrapper">
          <div ref={textRef} className={`song-title ${isHovered && shouldScroll ? 'scrolling' : ''}`} style={{ fontWeight: '600' }}>
            {pl.name}
          </div>
        </div>
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>{pl.items.length} songs</span>
    </button>
  );
});

export { SavedPlaylistItem, SavedPlaylistButtonItem };

