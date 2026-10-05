import React, { useState, useRef } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Plus, 
  Check, 
  Loader2, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  Music2, 
  Disc, 
  AlertCircle 
} from 'lucide-react';
import { parseArtists } from '../utils/artistUtils';

const ArtistSongItem = React.memo(({
  song,
  idx,
  artistName,
  isCurrentTrack,
  isPreviewing,
  isAdded,
  isDownloaded,
  isDownloading,
  onPlaySong,
  onPlayPreview,
  onStopPreview,
  onAddSong,
  onDownloadSong,
  onAlbumClick,
  onArtistClick
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [shouldScrollSubtitle, setShouldScrollSubtitle] = useState(false);
  const textRef = useRef(null);
  const subtitleRef = useRef(null);

  const handleMouseEnter = () => {
    if (textRef.current) {
      setShouldScroll(textRef.current.scrollWidth > textRef.current.clientWidth);
    }
    if (subtitleRef.current) {
      setShouldScrollSubtitle(subtitleRef.current.scrollWidth > subtitleRef.current.clientWidth);
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShouldScroll(false);
    setShouldScrollSubtitle(false);
  };

  const parsedArtists = parseArtists(song.artist || artistName);

  return (
    <div
      className={`song-item ${isCurrentTrack ? 'active' : ''}`}
      onClick={() => onPlaySong?.(song)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '7px 8px',
        borderRadius: '8px',
        gap: '10px',
        cursor: 'pointer',
        borderBottom: 'none',
        transition: 'background 0.15s ease'
      }}
    >
      {/* Rank Index */}
      <div style={{
        width: '24px',
        textAlign: 'center',
        fontSize: '0.85rem',
        fontWeight: 600,
        color: isCurrentTrack ? 'var(--accent-color)' : 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}>
        {idx + 1}
      </div>

      {/* Song Thumbnail */}
      <img
        src={song.thumbnail}
        alt=""
        style={{
          width: '42px',
          height: '42px',
          borderRadius: '5px',
          objectFit: 'cover',
          flexShrink: 0
        }}
      />

      {/* Song Info (Title & Subtitle with marquee animation on hover) */}
      <div className="song-info">
        <div className="song-title-wrapper">
          <div
            ref={textRef}
            className={`song-title ${isHovered && shouldScroll ? 'scrolling' : ''}`}
            style={{
              fontSize: '0.88rem',
              fontWeight: 600,
              color: isCurrentTrack ? 'var(--accent-color)' : 'var(--text-main)'
            }}
          >
            {song.title}
          </div>
        </div>

        <div className="song-title-wrapper" style={{ marginTop: '2px' }}>
          <div
            ref={subtitleRef}
            className={`song-title ${isHovered && shouldScrollSubtitle ? 'scrolling' : ''}`}
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontWeight: 400,
              paddingBottom: 0
            }}
          >
            {/* Multiple Artists Clickable Links */}
            <span>
              {parsedArtists.map((a, i) => (
                <React.Fragment key={i}>
                  <span
                    className="artist-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onArtistClick) onArtistClick(a.name);
                    }}
                    title={`View ${a.name}'s page`}
                  >
                    {a.name}
                  </span>
                  {a.separator && <span style={{ opacity: 0.6 }}>{a.separator}</span>}
                </React.Fragment>
              ))}
            </span>

            {/* Plays count (e.g. 664M plays) */}
            {song.plays && (
              <>
                <span style={{ margin: '0 4px', opacity: 0.4 }}>•</span>
                <span style={{ color: 'var(--text-main)', opacity: 0.85 }}>{song.plays}</span>
              </>
            )}

            {/* Album (clickable) */}
            {song.album && (
              <>
                <span style={{ margin: '0 4px', opacity: 0.4 }}>•</span>
                <span
                  className="album-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onAlbumClick) {
                      onAlbumClick({ album: song.album, artist: song.artist || artistName }, song.id);
                    }
                  }}
                  title={`Browse album "${song.album}"`}
                >
                  {song.album}
                </span>
              </>
            )}

            {/* Duration fallback */}
            {!song.plays && song.duration && (
              <>
                <span style={{ margin: '0 4px', opacity: 0.4 }}>•</span>
                <span>{song.duration}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div 
        style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preview button */}
        {onPlayPreview && (
          <button
            className="btn btn-icon"
            onClick={() => {
              if (isPreviewing) {
                onStopPreview?.();
              } else {
                onPlayPreview({
                  id: song.id,
                  title: song.title,
                  channel: song.artist || artistName,
                  thumbnail: song.thumbnail,
                  duration: song.duration
                });
              }
            }}
            title={isPreviewing ? "Stop Preview" : "Preview song"}
            style={{
              padding: '6px',
              color: isPreviewing ? 'var(--accent-color)' : 'var(--text-muted)'
            }}
          >
            {isPreviewing ? <Square size={15} fill="currentColor" /> : <Sparkles size={15} />}
          </button>
        )}

        {/* Add to Playlist button */}
        {onAddSong && (
          <button
            className="btn btn-icon"
            onClick={() => {
              if (!isAdded) {
                onAddSong({
                  id: song.id,
                  title: song.title,
                  channel: song.artist || artistName,
                  thumbnail: song.thumbnail,
                  duration: song.duration || '',
                  album: song.album
                });
              }
            }}
            disabled={isAdded}
            title={isAdded ? "Already in playlist" : "Add to playlist"}
            style={{
              padding: '6px',
              color: isAdded ? 'var(--accent-color)' : 'var(--text-muted)'
            }}
          >
            {isAdded ? <Check size={16} /> : <Plus size={16} />}
          </button>
        )}

        {/* Download button */}
        {onDownloadSong && (
          isDownloading ? (
            <button className="btn btn-icon" disabled style={{ padding: '6px' }}>
              <Loader2 size={15} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
            </button>
          ) : isDownloaded ? (
            <button className="btn btn-icon" disabled style={{ padding: '6px' }} title="Downloaded">
              <Check size={15} style={{ color: 'var(--accent-color)' }} />
            </button>
          ) : (
            <button
              className="btn btn-icon"
              onClick={() => onDownloadSong({
                id: song.id,
                title: song.title,
                channel: song.artist || artistName
              })}
              title="Download for offline"
              style={{ padding: '6px', color: 'var(--text-muted)' }}
            >
              <Download size={15} />
            </button>
          )
        )}
      </div>
    </div>
  );
});

export default function ArtistPage({
  artistName,
  artistDetails,
  isLoading,
  error,
  onRetry,
  onPlaySong,
  onAddSong,
  onPlayPreview,
  onStopPreview,
  previewSongId,
  currentSongId,
  isPlaying,
  playlist,
  downloadedIds,
  downloadingSongId,
  onDownloadSong,
  onAlbumClick,
  onArtistClick,
  onLoadMoreTopSongs,
  isLoadingMoreSongs
}) {
  const [showFullBio, setShowFullBio] = useState(false);

  const topSongs = artistDetails?.top_songs || [];
  const description = artistDetails?.description;
  const hasMore = Boolean(artistDetails?.top_songs_playlist_id && !artistDetails?.has_loaded_all);

  if (isLoading && !artistDetails) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '14px',
        color: 'var(--text-muted)'
      }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
        <span style={{ fontSize: '0.9rem' }}>Loading artist catalog…</span>
      </div>
    );
  }

  if (error && !artistDetails) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '12px',
        padding: '24px',
        textAlign: 'center'
      }}>
        <AlertCircle size={32} style={{ color: '#ef4444' }} />
        <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>Could not load artist</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '300px' }}>{error}</div>
        {onRetry && (
          <button className="btn btn-primary" onClick={onRetry} style={{ marginTop: '8px', padding: '6px 16px' }}>
            Try Again
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
      padding: '12px 14px',
      gap: '16px'
    }}>
      {/* Top Songs Section */}
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
          padding: '0 4px'
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '1.05rem',
            fontWeight: 700,
            color: 'var(--text-main)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>Top songs</span>
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontWeight: 500,
              background: 'var(--panel-border)',
              padding: '1px 7px',
              borderRadius: '10px'
            }}>
              {topSongs.length}
            </span>
          </h2>
        </div>

        {/* Songs List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {topSongs.map((song, idx) => (
            <ArtistSongItem
              key={song.id || idx}
              song={song}
              idx={idx}
              artistName={artistName}
              isCurrentTrack={currentSongId === song.id}
              isPreviewing={previewSongId === song.id}
              isAdded={playlist.some(s => s.id === song.id)}
              isDownloaded={downloadedIds?.has(song.id)}
              isDownloading={downloadingSongId === song.id}
              onPlaySong={onPlaySong}
              onPlayPreview={onPlayPreview}
              onStopPreview={onStopPreview}
              onAddSong={onAddSong}
              onDownloadSong={onDownloadSong}
              onAlbumClick={onAlbumClick}
              onArtistClick={onArtistClick}
            />
          ))}
        </div>

        {/* Load More Top Songs button */}
        {hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
            <button
              className="btn"
              onClick={onLoadMoreTopSongs}
              disabled={isLoadingMoreSongs}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 18px',
                borderRadius: '20px',
                fontSize: '0.82rem',
                fontWeight: 600,
                background: 'var(--panel-border)',
                color: 'var(--text-main)',
                border: 'none',
                cursor: isLoadingMoreSongs ? 'default' : 'pointer'
              }}
            >
              {isLoadingMoreSongs ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Loading more songs…
                </>
              ) : (
                'Show all songs'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Description / Bio Section */}
      {description && (
        <div style={{
          marginTop: '6px',
          padding: '12px 14px',
          background: 'var(--panel-border)',
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{
            fontSize: '0.78rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--text-muted)'
          }}>
            About {artistDetails?.name || artistName}
          </div>
          <div style={{
            fontSize: '0.83rem',
            lineHeight: 1.5,
            color: 'var(--text-main)',
            opacity: 0.9
          }}>
            {showFullBio || description.length <= 180
              ? description
              : `${description.slice(0, 180)}…`
            }
          </div>
          {description.length > 180 && (
            <button
              onClick={() => setShowFullBio(!showFullBio)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-color)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                marginTop: '2px'
              }}
            >
              {showFullBio ? (
                <>Less <ChevronUp size={13} /></>
              ) : (
                <>More <ChevronDown size={13} /></>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
