import { useState, useEffect } from 'react';

const WIKI_HEADERS = {
  'User-Agent': 'NadaNada/0.5.13 (music player app; contact: nadanada@app.local)'
};

// Safe JSON fetcher from Wikipedia API with AbortSignal support
async function safeWikiFetch(url, signal) {
  try {
    const res = await fetch(url, { headers: WIKI_HEADERS, signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Fetch Wikipedia article extract (full or lead intro)
async function getWikiExtract(title, full = true, signal) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=${encodeURIComponent(title)}${full ? '' : '&exintro=true'}&explaintext=true&redirects=1&format=json&origin=*`;
  const data = await safeWikiFetch(url, signal);
  const page = Object.values(data?.query?.pages || {})[0];
  if (!page || page.missing !== undefined || !page.extract) return null;
  return { title: page.title, extract: page.extract };
}

// Verify that the lead section actually describes a music artist (and not a mythological figure, city, etc.)
function isMusicArtistText(extract) {
  if (!extract) return false;
  const lead = extract.slice(0, 600).toLowerCase();
  return /\b(singer|musician|band|rapper|duo|group|songwriter|vocalist|composer|dj|record producer|pop group|rock band|boy band|girl group)\b/i.test(lead);
}

// Extract a fascinating, contextual fact sentence from Wikipedia article text
function extractFact(wikiText, artistName, songTitle) {
  if (!wikiText) return null;

  const GOOD = [
    'before', 'originally', 'accident', 'accidentally', 'inspired', 'inspiration',
    'rejected', 'almost', 'discovered', 'signed', 'grew up', 'childhood', 'school',
    'young', 'early', 'first', 'debut', 'never', 'actually', 'surprisingly', 'unexpected',
    'unknown', 'wrote', 'recorded', 'named after', 'named for', 'dropped out', 'quit',
    'left the band', 'met', 'formed', 'started', 'began', 'rumoured', 'rumored',
    'reportedly', 'auditioned', 'sampled', 'influenced by', 'influence', 'originally planned',
    'nearly', 'decided to', 'came up with', 'thought of', 'idea for', 'when they were',
    'nickname', 'awarded', 'chart', 'breakthrough', 'career', 'collaborated', 'released'
  ];

  const BAD = [
    'may refer to', 'is a disambiguation', 'see also', 'external links', 'references',
    'born in', 'born on', 'citizenship', 'nationality', 'discography',
    'table of contents', 'track listing', 'personnel', 'reception', 'critical reception'
  ];

  const sentences = wikiText
    .split(/\.\s+|\!\s+|\?\s+/)
    .map(s => s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(s => {
      if (s.length < 55 || s.length > 250) return false;
      if (/^=+\s*|\s*=+$/.test(s)) return false;
      if (/^\d+\.\s+/.test(s)) return false;
      if (s.includes(';') || s.includes('|')) return false;
      return true;
    });

  if (sentences.length === 0) return null;

  const scored = sentences.map((s, idx) => {
    const l = s.toLowerCase();
    let score = 0;

    // Disregard the very first biographical sentence (e.g. "X is a singer from Y")
    if (idx === 0 && (l.startsWith(artistName.toLowerCase()) || l.includes('better known as') || l.includes('is an') || l.includes('is a'))) {
      score -= 5;
    }

    for (const w of GOOD) if (l.includes(w)) score += 2;
    for (const w of BAD) if (l.includes(w)) score -= 4;

    if (artistName && l.includes(artistName.toLowerCase())) score += 2;
    if (songTitle && l.includes(songTitle.toLowerCase())) score += 4;

    return { text: s, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const top = scored.slice(0, Math.min(3, scored.length));
  const chosen = top[Math.floor(Math.random() * top.length)].text;
  return chosen.endsWith('.') ? chosen : chosen + '.';
}

export function useArtistFact(currentSong, albumInfo) {
  const [artistFact, setArtistFact] = useState('');

  useEffect(() => {
    if (!currentSong) {
      setArtistFact('');
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    const fetchFunFact = async () => {
      try {
        // ── 1. Derive Clean Artist & Title ──
        let artist = albumInfo?.artist || '';
        if (!artist && currentSong.channel) {
          artist = currentSong.channel.replace(/ - Topic$/i, '').replace(/vevo/i, '').trim();
        }
        let title = currentSong.title.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/official|music|video|audio|hd|hq|lyrics/ig, ' ').replace(/\s+/g, ' ').trim();
        const dashParts = title.split(' - ');
        if (dashParts.length > 1) {
          if (!artist) artist = dashParts[0].trim();
          title = dashParts.slice(1).join(' - ').trim();
        }
        artist = artist.replace(/Elley\s+Duh[\uFFFD\?]/gi, 'Elley Duhé').trim();
        const album = (albumInfo?.album || '').replace(/Elley\s+Duh[\uFFFD\?]/gi, 'Elley Duhé').trim();

        if (!artist) {
          if (!signal.aborted) setArtistFact('');
          return;
        }

        const cleanArtist = artist;
        const cleanSong = title;

        // ── Phase 1: Contextual Search on Wikipedia for `${cleanArtist} ${cleanSong}` ──
        // Searches for articles where BOTH artist and song are indexed
        if (!signal.aborted && cleanSong) {
          const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${cleanArtist} ${cleanSong}`)}&srlimit=6&format=json&origin=*`;
          const sRes = await safeWikiFetch(searchUrl, signal);
          const hits = sRes?.query?.search || [];

          for (const hit of hits) {
            if (signal.aborted) return;
            const ht = hit.title.toLowerCase();
            const at = cleanArtist.toLowerCase();
            const st = cleanSong.toLowerCase();

            const isSongMatch = ht === st || ht.startsWith(`${st} (`) || ht.includes('(song)');
            const isArtistMatch = ht === at || ht.startsWith(`${at} (`) || ht.startsWith(`${at},`);

            if (isSongMatch || isArtistMatch) {
              const fullArt = await getWikiExtract(hit.title, true, signal);
              if (fullArt && fullArt.extract) {
                if (isSongMatch && !fullArt.extract.toLowerCase().includes(at)) continue;
                if (isArtistMatch && !isMusicArtistText(fullArt.extract)) continue;

                const fact = extractFact(fullArt.extract, cleanArtist, cleanSong);
                if (fact) {
                  if (!signal.aborted) setArtistFact(fact);
                  return;
                }
              }
            }
          }
        }
        if (signal.aborted) return;

        // ── Phase 2: Direct lookup of `${cleanArtist}` + Disambiguation Resolution ──
        const directArtistUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|categories|links&pllimit=500&plnamespace=0&titles=${encodeURIComponent(cleanArtist)}&exintro=true&explaintext=true&redirects=1&format=json&origin=*`;
        const res = await safeWikiFetch(directArtistUrl, signal);
        const page = Object.values(res?.query?.pages || {})[0];

        if (page && page.missing === undefined) {
          const extract = page.extract || '';
          const isDisambig = (page.categories || []).some(c => c.title.toLowerCase().includes('disambiguation')) ||
                             extract.toLowerCase().includes('may refer to');

          if (!isDisambig && isMusicArtistText(extract)) {
            const fullArt = await getWikiExtract(page.title, true, signal);
            const fact = extractFact(fullArt?.extract || extract, cleanArtist, cleanSong);
            if (fact) {
              if (!signal.aborted) setArtistFact(fact);
              return;
            }
          } else if (isDisambig) {
            // Disambiguation handling: pick the right music artist candidate
            const links = (page.links || []).map(l => l.title);
            const at = cleanArtist.toLowerCase();
            const candidateLinks = links.filter(l => {
              const lt = l.toLowerCase();
              return lt === at || lt.startsWith(`${at} (`) || lt.startsWith(`${at},`) || lt.includes(`(${at})`);
            });

            if (candidateLinks.length > 0) {
              const titlesParam = candidateLinks.map(encodeURIComponent).join('|');
              const batchUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=${titlesParam}&exintro=true&explaintext=true&format=json&origin=*`;
              const bRes = await safeWikiFetch(batchUrl, signal);
              const candidatePages = Object.values(bRes?.query?.pages || {});

              let bestCandidate = null;
              let highestScore = -1;

              for (const cp of candidatePages) {
                if (!cp.extract) continue;
                if (!isMusicArtistText(cp.extract)) continue;

                const lTitle = cp.title.toLowerCase();
                const lExtract = cp.extract.toLowerCase();

                let score = 10;
                if (cleanSong && lExtract.includes(cleanSong.toLowerCase())) score += 100;
                if (album && lExtract.includes(album.toLowerCase())) score += 80;

                // Solo artists on YouTube/Spotify are (singer), (musician), (rapper)
                if (lTitle.includes('(singer)')) score += 35;
                if (lTitle.includes('(musician)')) score += 32;
                if (lTitle.includes('(rapper)')) score += 30;
                if (lTitle.includes('(band)')) score += 18;
                if (lTitle.includes('(album)')) score += 5;

                if (score > highestScore) {
                  highestScore = score;
                  bestCandidate = cp;
                }
              }

              if (bestCandidate) {
                const fullArt = await getWikiExtract(bestCandidate.title, true, signal);
                const fact = extractFact(fullArt?.extract || bestCandidate.extract, cleanArtist, cleanSong);
                if (fact) {
                  if (!signal.aborted) setArtistFact(fact);
                  return;
                }
              }
            }
          }
        }
        if (signal.aborted) return;

        // ── Phase 3: Targeted Search Fallback ──
        const fallbackSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`"${cleanArtist}" singer OR musician OR band`)}&srlimit=5&format=json&origin=*`;
        const fbRes = await safeWikiFetch(fallbackSearchUrl, signal);
        const fbHits = (fbRes?.query?.search || []);

        for (const hit of fbHits) {
          if (signal.aborted) return;
          const fullArt = await getWikiExtract(hit.title, true, signal);
          if (!fullArt || !fullArt.extract) continue;
          if (!isMusicArtistText(fullArt.extract)) continue;
          if (fullArt.title.toLowerCase().startsWith(cleanArtist.toLowerCase()) || fullArt.extract.toLowerCase().includes(cleanArtist.toLowerCase())) {
            const fact = extractFact(fullArt.extract, cleanArtist, cleanSong);
            if (fact) {
              if (!signal.aborted) setArtistFact(fact);
              return;
            }
          }
        }

        if (!signal.aborted) setArtistFact('');
      } catch (e) {
        if (!signal.aborted) setArtistFact('');
      }
    };

    fetchFunFact();
    return () => controller.abort();
  }, [currentSong, albumInfo]);

  return artistFact;
}
