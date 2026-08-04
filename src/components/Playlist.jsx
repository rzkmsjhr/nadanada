import React, { useState, useRef } from 'react';
import { Trash2, GripVertical } from 'lucide-react';

export default function Playlist({ playlist, currentIndex, onSelectIndex, onRemove, onReorder }) {
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    setDragOverIndex(null);
    const sourceIndex = Number(e.dataTransfer.getData('text/plain'));
    if (sourceIndex === index) return;
    onReorder(sourceIndex, index);
  };
  if (playlist.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Your playlist is empty.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {playlist.map((song, index) => {
          const isActive = index === currentIndex;
          const isDragOver = dragOverIndex === index;
          
          return (
            <div 
              key={song.queueId || index} 
              className={`song-item ${isActive ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}`}
              onClick={() => onSelectIndex(index)}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={(e) => handleDrop(e, index)}
            >
              <GripVertical size={16} style={{ color: 'var(--text-muted)', marginRight: '4px', cursor: 'grab' }} />
              <img src={song.thumbnail} alt="" className="song-thumb" />
              <div className="song-info">
                <div className="song-title">{song.title}</div>
                <div className="song-duration">{song.duration}</div>
              </div>
              <button 
                className="btn btn-icon" 
                style={{ border: 'none' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(index);
                }}
                title="Remove from playlist"
              >
                <Trash2 size={18} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
