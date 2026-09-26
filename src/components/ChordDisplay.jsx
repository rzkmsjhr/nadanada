import React, { useState, useEffect } from "react";
import { api } from "../services/api";

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS_TO_SHARPS = { 
  'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
  'D♭': 'C#', 'E♭': 'D#', 'G♭': 'F#', 'A♭': 'G#', 'B♭': 'A#',
  'Cb': 'B', 'C♭': 'B', 'Fb': 'E', 'F♭': 'E'
};
const SHARPS_MAP = {
  'C♯': 'C#', 'D♯': 'D#', 'E♯': 'F', 'F♯': 'F#', 'G♯': 'G#', 'A♯': 'A#', 'B♯': 'C'
};

export function transposeChord(chord, semitones) {
  if (!chord || chord === 'N.C.' || chord === '') return chord;
  if (semitones === 0) return chord;
  
  const transposeSingle = (c) => {
    const match = c.match(/^([A-G][#b♭♯]?)(.*)$/);
    if (!match) return c;
    let root = match[1];
    const suffix = match[2];
    
    if (FLATS_TO_SHARPS[root]) root = FLATS_TO_SHARPS[root];
    if (SHARPS_MAP[root]) root = SHARPS_MAP[root];
    
    let index = NOTES.indexOf(root);
    if (index === -1) return c;
    
    let newIndex = (index + semitones) % 12;
    if (newIndex < 0) newIndex += 12;
    
    let outRoot = NOTES[newIndex];
    return outRoot + suffix;
  };

  return chord.split('/').map(transposeSingle).join('/');
}

const ChordDisplay = ({ data, syncOffset, transpose, fontScale, chordsFontScale = 100, isLoading, error, onRetry, onAddChordifySong, currentSong }) => {
  const [time, setTime] = useState(0);
  const [justAdded, setJustAdded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    const handleTime = (e) => setTime(e.detail + (syncOffset || 0));
    window.addEventListener('timeupdate', handleTime);
    return () => window.removeEventListener('timeupdate', handleTime);
  }, [syncOffset]);

  if (isLoading) return <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', height: '100%' }}>Scraping chords from Chordify...</div>;
  if (error) {
    const isNotFound = error.toLowerCase().includes("not found");
    const isMismatch = error.toLowerCase().includes("mismatch") || error.toLowerCase().includes("different version");

    const handleAddMismatchSong = async () => {
      if (justAdded || isAdding || !onAddChordifySong) return;
      setIsAdding(true);
      try {
        if (data?.chordify_video_id) {
          const cleanTitle = (data.chordify_title || currentSong?.title || 'Unknown')
            .replace(/\s+/g, ' ')
            .replace(/\s*Chords?\s*(?:&|and)?\s*Lyrics?\s*by\s*.*$/i, '')
            .replace(/\s*Chords?\s*by\s*.*$/i, '')
            .trim();
          onAddChordifySong({
            id: data.chordify_video_id,
            title: cleanTitle || data.chordify_title || currentSong?.title || 'Unknown',
            channel: data.chordify_channel || currentSong?.channel || '',
            thumbnail: data.chordify_thumbnail || `https://i.ytimg.com/vi/${data.chordify_video_id}/hqdefault.jpg`,
            duration: data.chordify_duration || ''
          });
          setJustAdded(true);
          setTimeout(() => setJustAdded(false), 3000);
        } else {
          // Fallback: search YouTube for the official music video / Chordify version
          const title = data?.chordify_title || currentSong?.title || '';
          const channel = (data?.chordify_channel || currentSong?.channel || '').replace(/\s*-\s*Topic$/i, '').trim();
          const query = `${title} ${channel} official video`.trim();
          const searchRes = await api.searchYouTube(query, 'video');
          if (searchRes && searchRes.length > 0) {
            onAddChordifySong(searchRes[0]);
            setJustAdded(true);
            setTimeout(() => setJustAdded(false), 3000);
          }
        }
      } catch (err) {
        console.error('Failed to add mismatch song:', err);
      } finally {
        setIsAdding(false);
      }
    };

    return (
      <div style={{ color: isMismatch ? 'var(--text-muted)' : '#ef4444', display: 'flex', alignItems: 'center', gap: '10px', height: '100%', fontSize: '0.82rem', minWidth: 0, width: '100%' }}>
        <span style={{ opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={error}>
          {isMismatch 
            ? `Chordify version mismatch${data?.chordify_title ? ` (${data.chordify_title})` : ''}` 
            : error}
        </span>
        {isMismatch && onAddChordifySong && (
          <button
            onClick={handleAddMismatchSong}
            disabled={isAdding}
            style={{
              background: justAdded ? 'rgba(34,197,94,0.18)' : 'rgba(139,92,246,0.18)',
              border: `1px solid ${justAdded ? 'rgba(34,197,94,0.6)' : 'rgba(139,92,246,0.5)'}`,
              color: justAdded ? '#22c55e' : 'var(--accent-color)',
              borderRadius: '6px',
              padding: '3px 10px',
              cursor: (justAdded || isAdding) ? 'default' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.2s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {justAdded ? '✓ Added' : isAdding ? 'Adding...' : '+ Add to Playlist'}
          </button>
        )}
        {!isNotFound && !isMismatch && (
          <button onClick={onRetry} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap', flexShrink: 0 }}>Retry</button>
        )}
      </div>
    );
  }
  if (!data || !data.chords || data.chords.length === 0) return <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', height: '100%' }}>No chords available.</div>;

  const chords = data.chords;
  let activeIndex = -1;
  for (let i = 0; i < chords.length; i++) {
    if (time >= chords[i].time_sec) {
      activeIndex = i;
    } else {
      break;
    }
  }

  // Show active chord on the left, and next 5 upcoming chords to the right
  const startIndex = Math.max(0, activeIndex);
  const visibleChords = chords.slice(startIndex, startIndex + 6);

  const factor = (fontScale ?? chordsFontScale ?? 100) / 100;
  const f = (val) => Number((val * factor).toFixed(2));

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', height: '100%', overflow: 'hidden', width: '100%', maskImage: 'linear-gradient(to right, black 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 70%, transparent 100%)' }}>
      {visibleChords.map((c, idx) => {
        const globalIdx = startIndex + idx;
        const isActive = globalIdx === activeIndex;
        
        return (
          <div key={globalIdx} style={{ 
            fontSize: isActive ? `clamp(${f(1.4)}rem, ${f(2.8)}vw, ${f(2.1)}rem)` : `clamp(${f(1.0)}rem, ${f(2.0)}vw, ${f(1.4)}rem)`,
            color: isActive ? 'var(--accent-color)' : 'var(--text-muted)',
            fontWeight: isActive ? 'bold' : 'normal',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            opacity: isActive ? 1 : Math.max(0.2, 1 - (idx * 0.2))
          }}>
            {transposeChord(c.chord, transpose || 0)}
          </div>
        );
      })}
    </div>
  );
};

export default ChordDisplay;
