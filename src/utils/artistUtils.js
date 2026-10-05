/**
 * Utility functions for parsing and handling multiple artist names.
 */

export function parseArtists(artistString) {
  if (!artistString || typeof artistString !== 'string') return [];
  
  let cleaned = artistString.replace(/\s*-\s*Topic$/i, '').trim();
  cleaned = cleaned.replace(/Elley\s+Duh[\uFFFD\?]/gi, 'Elley Duhé');
  
  if (!cleaned) return [];

  // Delimiters: comma, ampersand, feat., ft., featuring, x
  const regex = /(\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+|\s+x\s+)/i;
  const parts = cleaned.split(regex);
  const result = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    
    if (regex.test(part)) {
      if (result.length > 0) {
        result[result.length - 1].separator = part;
      }
    } else {
      const trimmed = part.trim();
      if (trimmed) {
        result.push({ name: trimmed, separator: '' });
      }
    }
  }

  return result.length > 0 ? result : [{ name: cleaned, separator: '' }];
}
