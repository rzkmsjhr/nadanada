import { useState, useEffect } from 'react';

export function useArtistFact(currentSong) {
  const [artistFact, setArtistFact] = useState('');

  // ── Artist / Song Fun Facts (Wikipedia) ───────────────────────────────────
  // Extracts genuinely interesting sentences from Wikipedia articles — origin
  // stories, accidents, early-career moments — NOT genre tags or chart data.
  useEffect(() => {
    if (!currentSong) {
      setArtistFact('');
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;

    // Words that hint at a fun, surprising, or story-driven sentence
    const GOOD = ['before', 'originally', 'accident', 'accidentally', 'inspired', 'inspiration', 'rejected', 'almost', 'discovered', 'signed', 'grew up', 'childhood', 'school', 'young', 'early', 'first', 'debut', 'never', 'actually', 'surprisingly', 'unexpected', 'unknown', 'wrote', 'recorded', 'named after', 'named for', 'dropped out', 'quit', 'left the band', 'met', 'formed', 'started', 'began', 'rumoured', 'rumored', 'reportedly', 'auditioned', 'sampled', 'influenced by', 'influence', 'originally planned', 'nearly', 'almost', 'decided to', 'came up with', 'thought of', 'idea for', 'when they were'];

    // Words that reveal a boring descriptor / chart / sales sentence
    const BAD = [' is a ', ' are a ', ' is an ', ' are an ', 'born in', 'born on', 'citizenship', 'nationality', 'discography', 'known for', 'best known', 'certified platinum', 'certified gold', 'billboard', 'number one', 'topped the', 'peaked at', 'charted', 'won the', 'grammy', 'brit award', 'mtv award'];
    const scoreSentence = s => {
      const l = s.toLowerCase();
      let score = 0;
      for (const w of GOOD) if (l.includes(w)) score += 2;
      for (const w of BAD) if (l.includes(w)) score -= 3;
      if (s.length < 50 || s.length > 290) score -= 2; // too short or too long
      return score;
    };
    const extractFact = wikiText => {
      // Split on ". " or "! " or "? " preserving the sentence text
      const sentences = wikiText.split(/\.\s+|\!\s+|\?\s+/).map(s => s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).filter(s => s.length > 50 && s.length < 290);

      // Skip the first sentence (always "X is a <genre> band from <city>")
      const candidates = sentences.slice(1);
      const scored = candidates.map(s => ({
        text: s,
        score: scoreSentence(s)
      })).filter(({
        score
      }) => score > 0).sort((a, b) => b.score - a.score);
      if (scored.length === 0) return null;
      // Pick randomly from the top 3 so each listen to the same song can surface
      // a different fact, making the header feel alive
      const pool = scored.slice(0, Math.min(3, scored.length));
      const {
        text
      } = pool[Math.floor(Math.random() * pool.length)];
      return text.endsWith('.') ? text : text + '.';
    };
    const wikiGet = async title => {
      const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=${encodeURIComponent(title)}&exintro=true&explaintext=true&redirects=1&format=json&origin=*`, {
        signal
      });
      if (!res.ok) return null;
      const data = await res.json();
      const pages = Object.values(data.query?.pages || {});
      const page = pages[0];
      if (!page || page.missing !== undefined || !page.extract) return null;
      return page.extract;
    };
    const fetchFunFact = async () => {
      try {
        // --- derive clean artist & title ---
        let artist = currentSong.channel ? currentSong.channel.replace(/ - Topic$/i, '').replace(/vevo/i, '').trim() : '';
        let title = currentSong.title.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/official|music|video|audio|hd|hq|lyrics/ig, ' ').replace(/\s+/g, ' ').trim();
        const dashParts = title.split(' - ');
        if (dashParts.length > 1) {
          if (!artist) artist = dashParts[0].trim();
          title = dashParts.slice(1).join(' - ').trim();
        }
        if (!artist) {
          if (!signal.aborted) setArtistFact('');
          return;
        }

        // --- 1. Try the song page first (best chance of "how it was made" facts) ---
        if (!signal.aborted && title) {
          const songText = await wikiGet(`${title} (song)`);
          if (songText && !signal.aborted) {
            const fact = extractFact(songText);
            if (fact) {
              setArtistFact(fact);
              return;
            }
          }
        }
        if (signal.aborted) return;

        // --- 2. Try artist page variants ---
        const artistVariants = [artist, `${artist} (band)`, `${artist} (singer)`, `${artist} (rapper)`, `${artist} (musician)`];
        for (const variant of artistVariants) {
          if (signal.aborted) return;
          const text = await wikiGet(variant);
          if (!text) continue;

          // Sanity check: Ensure this page is actually about music/artist
          // If the entire Wikipedia intro doesn't mention any of these, it's likely a generic noun (e.g., 'Chillies' -> 'Chili peppers')
          const isMusicRelated = /band|singer|album|music|musician|song|rapper|producer|dj|vocalist|guitarist|chart|record/i.test(text);
          if (!isMusicRelated) continue;
          const fact = extractFact(text);
          if (fact) {
            if (!signal.aborted) setArtistFact(fact);
            return;
          }
        }
        if (!signal.aborted) setArtistFact('');
      } catch (e) {
        if (!signal.aborted) setArtistFact('');
      }
    };
    fetchFunFact();
    return () => controller.abort();
  }, [currentSong]);

  return artistFact;
}
