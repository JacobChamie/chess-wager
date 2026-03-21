import { vi } from 'vitest';

/**
 * Mock FairPlayService with vi.fn() spies on all methods.
 * Used by E2E socket tests to verify analysis is triggered.
 */
export class MockFairPlayService {
  constructor() {
    this.analyzeGame = vi.fn().mockResolvedValue(undefined);
    this.submitReport = vi.fn().mockResolvedValue({ id: 'report-1' });
    this.behaviorTracker = {
      saveBehavior: vi.fn().mockResolvedValue(undefined),
    };
  }
}
