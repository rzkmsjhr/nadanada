import React, { useRef, useEffect } from 'react';

export default function ChordTimeline({ chordHistory, currentChord }) {
  // chordHistory is an array of { chord: string, time: number (seconds) }
  // currentChord is the currently playing chord string
  
  const containerRef = useRef(null);
  
  // Auto-scroll to the end (latest chord) whenever history updates
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth;
    }
  }, [chordHistory.length]);
  
  // Determine chord color based on type
  const getChordColor = (chord) => {
    if (chord === '-') return 'chord-silence';
    if (chord.includes('m7')) return 'chord-min7';
    if (chord.includes('7')) return 'chord-dom7';
    if (chord.includes('sus')) return 'chord-sus';
    if (chord.includes('m')) return 'chord-minor';
    return 'chord-major';
  };
  
  // Calculate width for each chord block based on duration
  // Each chord block's width = proportional to how long it played
  // Minimum width so short chords are still visible
  const getBlockWidth = (index) => {
    if (index >= chordHistory.length - 1) return 60; // current/last chord: fixed width
    const duration = chordHistory[index + 1].time - chordHistory[index].time;
    // Scale: 1 second = 40px, minimum 30px, maximum 200px
    return Math.max(30, Math.min(200, duration * 40));
  };

  if (chordHistory.length === 0) {
    return (
      <div className="chord-timeline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Listening for chords...
      </div>
    );
  }

  return (
    <div className="chord-timeline" ref={containerRef}>
      {chordHistory.map((entry, i) => {
        const isLast = i === chordHistory.length - 1;
        const isCurrent = isLast && entry.chord === currentChord;
        return (
          <div
            key={i}
            className={`chord-block ${getChordColor(entry.chord)} ${isCurrent ? 'chord-current' : ''}`}
            style={{ minWidth: `${getBlockWidth(i)}px` }}
          >
            <span className="chord-label">{entry.chord}</span>
          </div>
        );
      })}
    </div>
  );
}
