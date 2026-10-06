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

  // Protect known compound artist names so their internal commas/ampersands are not split
  const placeholders = [];
  let tokenized = cleaned;
  COMPOUND_ARTISTS.forEach((compound, idx) => {
    const escaped = compound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexMatch = new RegExp(`(^|\\s|[,&])${escaped}($|\\s|[,&])`, 'gi');
    tokenized = tokenized.replace(regexMatch, (full, prefix, suffix) => {
      const placeholder = `___COMP_${idx}_${placeholders.length}___`;
      // Preserve the actual matched capitalization/spelling
      const actualMatch = full.slice(prefix.length, full.length - suffix.length);
      placeholders.push({ placeholder, actualMatch });
      return `${prefix}${placeholder}${suffix}`;
    });
  });

  // Delimiters: comma, ampersand, feat., ft., featuring, x
  const regex = /(\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+|\s+x\s+)/i;
  const parts = tokenized.split(regex);
  const result = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    
    if (regex.test(part)) {
      if (result.length > 0) {
        result[result.length - 1].separator = part;
      }
    } else {
      let trimmed = part.trim();
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
