import React, { useState, useRef } from 'react';
import { Trash2, GripVertical, Plus, Check, Download, Loader2, ListPlus } from 'lucide-react';

const PlaylistItem = React.memo(({ song, index, isActive, isDragOver, onSelectIndex, handleDragStart, setDragOverIndex, handleDrop, isTrendingMode, isDownloadedView, onAddSong, addedSongs, setAddedSongs, onDownloadSong, downloadingSongId, downloadedIds, onRemove, onAddToSavedPlaylist, albumInfo, onAlbumClick }) => {
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
    <div 
      className={`song-item ${isActive ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onClick={() => onSelectIndex(index)}
      draggable={true}
      onDragStart={(e) => handleDragStart(e, index)}
      onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
      onDragLeave={() => setDragOverIndex(null)}
      onDrop={(e) => handleDrop(e, index)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <GripVertical size={16} style={{ color: 'var(--text-muted)', cursor: 'grab' }} />
      {isTrendingMode && song.rank && (
        <div style={{
          minWidth: '24px', 
          textAlign: 'center', 
          fontSize: '0.9rem', 
          fontWeight: 'bold', 
          color: 'var(--accent-color)'
        }}>
          {song.rank}
        </div>
      )}
      {!isDownloadedView && (
        <img src={song.thumbnail} alt="" className="song-thumb" />
      )}
      <div className="song-info">
        <div className="song-title-wrapper">
          <div ref={textRef} className={`song-title ${isHovered && shouldScroll ? 'scrolling' : ''}`}>{song.title}</div>
        </div>
        {song.channel && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {(() => {
              const cleanChannel = song.channel.replace(/\s*-\s*Topic$/i, '');
              const artist = (albumInfo?.artist) || cleanChannel;
              const album = albumInfo?.album || '';
              return (
                <>
                  <span>{artist}</span>
                  {album && (
                    <>
                      <span style={{ margin: '0 4px', opacity: 0.5 }}>·</span>
                      <span 
                        onClick={(e) => { e.stopPropagation(); if (onAlbumClick) onAlbumClick(albumInfo); }}
                        style={{ color: 'var(--accent-color)', cursor: 'pointer', borderBottom: '1px dotted var(--accent-color)' }}
                        title={`Browse "${album}" album`}
                      >
                        {album}
                      </span>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0px', marginRight: '-6px' }}>
        {isTrendingMode && onAddSong && !isDownloadedView && (
          addedSongs.has(song.queueId) ? (
            <button 
              className="btn btn-icon" 
              style={{ border: 'none', cursor: 'default', padding: '6px' }}
              title="Added to playlist"
              disabled
            >
              <Check size={18} style={{ color: 'var(--accent-color)' }} />
            </button>
          ) : (
            <button 
              className="btn btn-icon" 
              style={{ border: 'none', padding: '6px' }}
              onClick={(e) => {
                e.stopPropagation();
                onAddSong(song);
                setAddedSongs(prev => new Set(prev).add(song.queueId));
              }}
              title="Add to my playlist"
            >
              <Plus size={18} style={{ color: 'var(--accent-color)' }} />
            </button>
          )
        )}
        
        {!isDownloadedView && onDownloadSong && (
          downloadingSongId === song.id ? (
            <button 
              className="btn btn-icon" 
              style={{ border: 'none', cursor: 'default', padding: '6px' }}
              title="Downloading..."
              disabled
            >
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
            </button>
          ) : downloadedIds?.has(song.id) ? (
            <button 
              className="btn btn-icon" 
              style={{ border: 'none', cursor: 'default', padding: '6px' }}
              title="Downloaded successfully"
              disabled
            >
              <Check size={18} style={{ color: 'var(--accent-color)' }} />
            </button>
          ) : (
            <button 
              className="btn btn-icon" 
              style={{ border: 'none', padding: '6px' }}
              onClick={(e) => {
                e.stopPropagation();
                onDownloadSong(song);
              }}
              title="Download for offline playing"
            >
              <Download size={18} style={{ color: 'var(--accent-color)' }} />
            </button>
          )
        )}

        {!isTrendingMode && !isDownloadedView && onAddToSavedPlaylist && (
          <button 
            className="btn btn-icon" 
            style={{ border: 'none', padding: '6px' }}
            onClick={(e) => {
              e.stopPropagation();
              onAddToSavedPlaylist(song);
            }}
            title="Add to a saved playlist"
          >
            <ListPlus size={18} style={{ color: 'var(--accent-color)' }} />
          </button>
        )}

        <button 
          className="btn btn-icon" 
          style={{ border: 'none', padding: '6px' }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(index);
          }}
          title={isDownloadedView ? "Delete from downloads" : "Remove from view"}
        >
          <Trash2 size={18} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>
    </div>
  );
});

export default React.memo(function Playlist({ playlist, currentIndex, onSelectIndex, onRemove, onReorder, isTrendingMode, onAddSong, isDownloadedView, onDownloadSong, downloadingSongId, downloadedIds, onAddToSavedPlaylist, shouldScrollToBottom, onScrollToBottomDone, albumInfo, onAlbumClick }) {
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [addedSongs, setAddedSongs] = useState(new Set());
  const containerRef = useRef(null);

  React.useEffect(() => {
    let timer;
    if (shouldScrollToBottom && containerRef.current) {
      timer = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
        if (onScrollToBottomDone) {
          onScrollToBottomDone();
        }
      }, 300);
    }
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldScrollToBottom]);

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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '12px', padding: '20px', textAlign: 'center' }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '50%' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
        </div>
        <div>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: 'var(--text-color)' }}>Your playlist is empty</h3>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>Click the search icon above to find some music!</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto' }}>
        {playlist.map((song, index) => {
          const isActive = index === currentIndex;
          const isDragOver = dragOverIndex === index;
          
          return (
            <PlaylistItem
               key={song.queueId || index}
               song={song}
               index={index}
               isActive={isActive}
               isDragOver={isDragOver}
               onSelectIndex={onSelectIndex}
               handleDragStart={handleDragStart}
               setDragOverIndex={setDragOverIndex}
               handleDrop={handleDrop}
               isTrendingMode={isTrendingMode}
               isDownloadedView={isDownloadedView}
               onAddSong={onAddSong}
               addedSongs={addedSongs}
               setAddedSongs={setAddedSongs}
               onDownloadSong={onDownloadSong}
               downloadingSongId={downloadingSongId}
               downloadedIds={downloadedIds}
               onRemove={onRemove}
               onAddToSavedPlaylist={onAddToSavedPlaylist}
               albumInfo={isActive ? albumInfo : null}
               onAlbumClick={isActive ? onAlbumClick : null}
            />
          );
        })}
      </div>
    </div>
  );
});
