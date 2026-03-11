import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendDepositReceiptEmail } from '../../src/email/emailService.js';

// Mock the Resend SDK
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ id: 'email-123' }),
    },
  })),
}));

describe('sendDepositReceiptEmail', () => {
  it('should be a function', () => {
    expect(typeof sendDepositReceiptEmail).toBe('function');
  });

  it('should not throw when called with valid params', async () => {
    await expect(
      sendDepositReceiptEmail('alice@test.com', 'Alice', {
        amount: '0.05',
        asset: 'ETH',
        chain: 'ethereum',
        usdValue: '150.00',
        tokensCredited: '150',
        txHash: '0xabc123',
      })
    ).resolves.not.toThrow();
  });
});
