import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, createToken, verifyToken } from '../../src/auth/authService.js';

describe('authService', () => {
  it('hashPassword + verifyPassword: correct password verifies', async () => {
    const hash = await hashPassword('mypassword');
    const result = await verifyPassword('mypassword', hash);
    expect(result).toBe(true);
  });

  it('verifyPassword: wrong password rejected', async () => {
    const hash = await hashPassword('mypassword');
    const result = await verifyPassword('wrongpassword', hash);
    expect(result).toBe(false);
  });

  it('createToken + verifyToken roundtrip', () => {
    const user = { id: 1, username: 'alice', email: 'alice@test.com', is_admin: false };
    const token = createToken(user);
    const decoded = verifyToken(token);
    expect(decoded.id).toBe(1);
    expect(decoded.username).toBe('alice');
    expect(decoded.email).toBe('alice@test.com');
  });

  it('verifyToken returns null for invalid token', () => {
    const result = verifyToken('not-a-real-token');
    expect(result).toBeNull();
  });

  it('verifyToken returns null for tampered token', () => {
    const user = { id: 1, username: 'alice', email: 'alice@test.com' };
    const token = createToken(user);
    // Tamper with the payload
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(verifyToken(tampered)).toBeNull();
  });
});
