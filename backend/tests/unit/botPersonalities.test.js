import { describe, it, expect } from 'vitest';
import { BOT_PERSONALITIES, getPersonality } from '../../src/bot/botPersonalities.js';

describe('botPersonalities', () => {
  it('has 6 personalities', () => {
    expect(BOT_PERSONALITIES).toHaveLength(6);
  });

  it('getPersonality("medium") returns Sierra with rating 1400', () => {
    const p = getPersonality('medium');
    expect(p).toBeTruthy();
    expect(p.name).toBe('Sierra');
    expect(p.rating).toBe(1400);
  });

  it('getPersonality("nonexistent") returns null', () => {
    expect(getPersonality('nonexistent')).toBeNull();
  });
});
