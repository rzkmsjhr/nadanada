/**
 * Utility functions for parsing and handling multiple artist names.
 */

const COMPOUND_ARTISTS = [
  'Tyler, The Creator',
  'Earth, Wind & Fire',
  'Blood, Sweat & Tears',
  'Kool & The Gang',
  'King Gizzard & The Lizard Wizard',
  'Above & Beyond',
  'Simon & Garfunkel',
  'The Mamas & The Papas',
  'Bob Marley & The Wailers',
  'Huey Lewis & The News',
  'Joan Jett & The Blackhearts',
  'Echo & The Bunnymen',
  'KC & The Sunshine Band',
  'Katrina & The Waves',
  'Derek & The Dominos',
  'Siouxsie & The Banshees',
  'Captain & Tennille',
  'Peaches & Herb',
  'Hall & Oates',
  'Daryl Hall & John Oates',
  'Brooks & Dunn',
  'Gladys Knight & The Pips',
  'Diana Ross & The Supremes',
  'Smokey Robinson & The Miracles',
  'Martha Reeves & The Vandellas',
  'Bill Haley & His Comets',
  'Buddy Holly & The Crickets',
  'Angus & Julia Stone',
  'Crosby, Stills, Nash & Young',
  'Emerson, Lake & Palmer',
  'Peter, Paul and Mary',
  'Peter, Paul & Mary'
];

export function parseArtists(artistString) {
  if (!artistString || typeof artistString !== 'string') return [];
  
  let cleaned = artistString.replace(/\s*-\s*Topic$/i, '').trim();
  cleaned = cleaned.replace(/Elley\s+Duh[\uFFFD\?]/gi, 'Elley Duhé');
  
  if (!cleaned) return [];

  // Protect known compound artist names with commas so their internal commas are not split
  const placeholders = [];
  let tokenized = cleaned;
  COMPOUND_ARTISTS.forEach((compound, idx) => {
    const escaped = compound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexMatch = new RegExp(`(^|\\s|[,])\\s*${escaped}\\s*($|\\s|[,])`, 'gi');
    tokenized = tokenized.replace(regexMatch, (full, prefix, suffix) => {
      const placeholder = `___COMP_${idx}_${placeholders.length}___`;
      const actualMatch = full.slice(prefix.length, full.length - suffix.length).trim();
      placeholders.push({ placeholder, actualMatch });
      return `${prefix}${placeholder}${suffix}`;
    });
  });

  // Delimiters: feat., ft., featuring, or comma.
  // NEVER split on "&" or "x" because real band names frequently contain them (e.g. "Andra & the Backbone", "Simon & Garfunkel").
  const regex = /(\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+|\s+(?:feat\.?|ft\.?|featuring)\s+|\s*,\s*)/i;
  const parts = tokenized.split(regex);
  const result = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    
    if (regex.test(part)) {
      if (result.length > 0) {
        const sep = /feat/i.test(part) ? ' feat. ' : /ft/i.test(part) ? ' ft. ' : part;
        result[result.length - 1].separator = sep;
      }
    } else {
      let trimmed = part.trim().replace(/[)\]]+$/, '').trim();
      placeholders.forEach(({ placeholder, actualMatch }) => {
        trimmed = trimmed.replace(placeholder, actualMatch);
      });
      if (trimmed) {
        result.push({ name: trimmed, separator: '' });
      }
    }
  }

  return result.length > 0 ? result : [{ name: cleaned, separator: '' }];
}
