import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FearGreedRow } from '../types.js';

import { fetchFearGreed } from './fear-greed.js';

const ORIGINAL_FETCH = globalThis.fetch;

function setupMockFetch(result: unknown, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    json: () => Promise.resolve(result),
  } as unknown as Response);
}

function setupFetchError(msg = 'Network failure'): void {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(msg));
}

describe('fetchFearGreed', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns parsed fear-greed rows', async () => {
    const mockData = {
      data: [
        { value: '25', value_classification: 'Fear', timestamp: '1700000000' },
        { value: '55', value_classification: 'Neutral', timestamp: '1700003600' },
      ],
    };
    setupMockFetch(mockData);
    const result = await fetchFearGreed();
    expect(result).toHaveLength(2);
    expect(result[0]!).toEqual<FearGreedRow>({ ts: 1700000000, value: 25, classification: 'Fear' });
    expect(result[1]!).toEqual<FearGreedRow>({ ts: 1700003600, value: 55, classification: 'Neutral' });
  });

  it('handles Extreme Fear and Extreme Greed classifications', async () => {
    const mockData = {
      data: [
        { value: '10', value_classification: 'Extreme Fear', timestamp: '1700000000' },
        { value: '90', value_classification: 'Extreme Greed', timestamp: '1700003600' },
      ],
    };
    setupMockFetch(mockData);
    const result = await fetchFearGreed(2);
    expect(result[0]!.classification).toBe('Extreme Fear');
    expect(result[1]!.classification).toBe('Extreme Greed');
  });

  it('returns empty array on HTTP error', async () => {
    setupMockFetch({}, 500);
    const result = await fetchFearGreed();
    expect(result).toEqual([]);
  });

  it('returns empty array on 429 rate limit', async () => {
    setupMockFetch({}, 429);
    const result = await fetchFearGreed();
    expect(result).toEqual([]);
  });

  it('returns empty array when API returns empty data list', async () => {
    setupMockFetch({ data: [] });
    const result = await fetchFearGreed();
    expect(result).toEqual([]);
  });

  it('throws on network failure', async () => {
    setupFetchError('api.alternative.me unreachable');
    await expect(fetchFearGreed()).rejects.toThrow('api.alternative.me unreachable');
  });

  it('accepts custom limit parameter', async () => {
    setupMockFetch({ data: [] });
    const result = await fetchFearGreed(7);
    expect(result).toEqual([]);
  });
});
