import { describe, it, expect } from 'vitest';
import { generateTokenPair, hashToken } from '../../src/email/emailService.js';

describe('emailService', () => {
  it('generateTokenPair returns 64-char hex token and hash', () => {
    const { token, hash } = generateTokenPair();
    expect(token).toHaveLength(64);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it('token hash matches when re-hashed', () => {
    const { token, hash } = generateTokenPair();
    expect(hashToken(token)).toBe(hash);
  });

  it('hashToken is deterministic SHA-256', () => {
    const h1 = hashToken('test-value');
    const h2 = hashToken('test-value');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});
