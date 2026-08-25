import React from "react";

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS_TO_SHARPS = { 
  'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
  'D♭': 'C#', 'E♭': 'D#', 'G♭': 'F#', 'A♭': 'G#', 'B♭': 'A#',
  'Cb': 'B', 'C♭': 'B', 'Fb': 'E', 'F♭': 'E'
};
const SHARPS_MAP = {
  'C♯': 'C#', 'D♯': 'D#', 'E♯': 'F', 'F♯': 'F#', 'G♯': 'G#', 'A♯': 'A#', 'B♯': 'C'
};

function transposeChord(chord, semitones) {
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

const ChordDisplay = ({ data, time, transpose, isLoading, error, onRetry }) => {
  if (isLoading) return <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', height: '100%' }}>Scraping chords from Chordify...</div>;
  if (error) {
    const isNotFound = error.toLowerCase().includes("not found");
    return (
      <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '12px', height: '100%', fontSize: '0.9rem' }}>
        <span>{error}</span>
        {!isNotFound && (
          <button onClick={onRetry} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>Retry</button>
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

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', height: '100%', overflow: 'hidden', width: '100%', maskImage: 'linear-gradient(to right, black 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 70%, transparent 100%)' }}>
      {visibleChords.map((c, idx) => {
        const globalIdx = startIndex + idx;
        const isActive = globalIdx === activeIndex;
        
        return (
          <div key={globalIdx} style={{ 
            fontSize: isActive ? '2.5rem' : '1.5rem',
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
