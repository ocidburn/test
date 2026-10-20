/**
 * Search normalisation: lower case, Polish letters folded to ASCII, runs of
 * punctuation and whitespace collapsed. Done by table rather than
 * String.prototype.normalize so it behaves the same on every JS engine.
 */
const FOLD: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  ä: 'a',
  ö: 'o',
  ü: 'u',
  é: 'e',
};

export const normalizeSearch = (value: string): string => {
  const lower = value.toLowerCase();
  let out = '';
  for (const char of lower) out += FOLD[char] ?? char;
  return out
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};
