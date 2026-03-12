// Profanity word list sourced from https://github.com/censor-text/profanity-list
import wordListRaw from './profanity-list-en.txt?raw';

const PROFANITY_LIST = wordListRaw
  .split('\n')
  .map(w => w.trim())
  .filter(w => w.length > 0);

// Build regex: match whole words, case-insensitive
const pattern = new RegExp(
  '\\b(' + PROFANITY_LIST.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'gi'
);

/**
 * Replace profane words with asterisks of the same length.
 * @param {string} text
 * @returns {string}
 */
export function filterProfanity(text) {
  if (!text) return text;
  return text.replace(pattern, (match) => '*'.repeat(match.length));
}
