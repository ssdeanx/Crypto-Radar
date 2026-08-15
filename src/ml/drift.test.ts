// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — ML Drift Detection Unit Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Pure unit tests with vi.mock intercepting node:fs and node:child_process
// so no real filesystem access or Python subprocess is needed.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

type ProcessHandler = (...args: unknown[]) => void;

/** Track the single mock process so tests can drive its events. */
let _currentProcess: MockProcess | null = null;

interface MockProcess {
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  /** Simulate a process event (close, error, etc.) */
  _emit(event: string, ...args: unknown[]): void;
  /** Simulate stdout data */
  _stdoutData(data: string): void;
  /** Simulate stderr data */
  _stderrData(data: string): void;
}

function createMockProcess(): MockProcess {
  const handlers = new Map<string, ProcessHandler>();
  const proc: MockProcess = {
    stdout: {
      on: vi.fn((event: string, handler: ProcessHandler) => {
        if (event === 'data') handlers.set('stdout:data', handler);
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: ProcessHandler) => {
        if (event === 'data') handlers.set('stderr:data', handler);
      }),
    },
    on: vi.fn((event: string, handler: ProcessHandler) => {
      handlers.set(event, handler);
    }),
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
    _emit(event: string, ...args: unknown[]) {
      const h = handlers.get(event);
      if (h) h(...args);
    },
    _stdoutData(data: string) {
      const h = handlers.get('stdout:data');
      if (h) h(Buffer.from(data));
    },
    _stderrData(data: string) {
      const h = handlers.get('stderr:data');
      if (h) h(Buffer.from(data));
    },
  };
  _currentProcess = proc;
  return proc;
}

const mockChildProcess = vi.hoisted(() => ({
  spawn: vi.fn(() => createMockProcess()),
}));

vi.mock('node:fs', () => mockFs);
vi.mock('node:child_process', () => mockChildProcess);

// ── Import after mocks are set up ────────────────────────────────────

import type { Store } from '../store/db.js';
import { detectDrift, type DriftReport } from './drift.js';

// ── Test helpers ─────────────────────────────────────────────────────

function mockStore(
  predictions: Array<{
    id?: string;
    symbol: string;
    ts: string;
    direction: string;
    confidence: number;
    model_id?: string;
    horizon?: number;
    ml_score?: number | null;
    features_hash?: string | null;
  }>,
): Store {
  return {
    getPredictions: vi.fn().mockResolvedValue(predictions),
  } as unknown as Store;
}

function getSpawnArgs(): string[] {
  const call = mockChildProcess.spawn.mock.calls[0];
  if (!call) return [];
  return (call as unknown[])[1] as string[];
}

function currentProcess(): MockProcess {
  const p = _currentProcess;
  if (!p) throw new Error('No mock process available — did spawn get called?');
  return p;
}

/** Flush microtasks so async functions can advance past `await`s. */
async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

const samplePredictions10 = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`,
  symbol: 'SOLUSDT',
  ts: '2026-07-20T12:00:00Z',
  direction: 'buy' as const,
  confidence: 0.75,
  model_id: 'catboost_v1',
  horizon: 5,
  ml_score: 0.8,
  features_hash: 'abc123',
}));

// ═══════════════════════════════════════════════════════════════════════
// detectDrift
// ═══════════════════════════════════════════════════════════════════════

describe('detectDrift', () => {
  beforeEach(() => {
    _currentProcess = null;
    mockChildProcess.spawn.mockClear();
    mockFs.existsSync.mockReturnValue(true);
  });

  it('returns empty report when drift script does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);

    const report = await detectDrift(mockStore([]));

    expect(report.drift_detected).toBe(false);
    expect(report.warnings).toEqual([]);
    expect(report.detector_stats.total_observations).toBe(0);
    expect(report.detector_stats.model).toBe('ADWIN');
  });

  it('returns empty report when fewer than 10 predictions are available', async () => {
    const store = mockStore(
      Array.from({ length: 9 }, (_, i) => ({
        id: `p${i}`,
        symbol: 'SOLUSDT',
        ts: '2026-07-20T12:00:00Z',
        direction: 'buy' as const,
        confidence: 0.75,
        model_id: 'catboost_v1',
        horizon: 5,
        ml_score: 0.8,
        features_hash: 'abc123',
      })),
    );

    const report = await detectDrift(store);

    expect(report.drift_detected).toBe(false);
    expect(report.detector_stats.total_observations).toBe(0);
    expect(mockChildProcess.spawn).not.toHaveBeenCalled();
  });

  it('parses drift report from successful subprocess', async () => {
    const expectedReport: DriftReport = {
      drift_detected: true,
      warnings: [
        { index: 42, message: 'ADWIN detected change at observation 42', open_time: 1721500000000 },
      ],
      detector_stats: {
        total_observations: 100,
        current_width: 58,
        total_detections: 1,
        model: 'ADWIN',
      },
    };

    // Start detectDrift; it awaits getPredictions then calls spawn
    const promise = detectDrift(mockStore(samplePredictions10));

    // Flush microtasks so the await in detectDrift resolves and spawn runs
    await flush();

    // Now spawn should have been called and _currentProcess set
    const proc = currentProcess();
    proc._stdoutData(JSON.stringify(expectedReport));
    proc._emit('close', 0);

    const report = await promise;

    expect(report.drift_detected).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]!.message).toContain('ADWIN');
    expect(report.detector_stats.total_observations).toBe(100);

    expect(mockChildProcess.spawn).toHaveBeenCalledTimes(1);
    const args = getSpawnArgs();
    expect(args).toContain('--model');
    expect(args).toContain('ADWIN');
    expect(args).toContain('--delta');
    expect(args).toContain('0.002');
  });

  it('returns empty report on subprocess timeout', async () => {
    const promise = detectDrift(mockStore(samplePredictions10), { timeoutMs: 1 });

    // 1ms timeout fires, promise resolves to empty report
    const report = await promise;

    expect(report.drift_detected).toBe(false);
    expect(report.detector_stats.total_observations).toBe(0);
    // kill should have been called when the timer fired
    expect(currentProcess().kill).toHaveBeenCalled();
  });

  it('returns empty report on subprocess non-zero exit', async () => {
    const promise = detectDrift(mockStore(samplePredictions10));
    await flush();

    const proc = currentProcess();
    proc._stderrData('Something went wrong');
    proc._emit('close', 1);

    const report = await promise;

    expect(report.drift_detected).toBe(false);
    expect(report.detector_stats.total_observations).toBe(0);
  });

  it('returns empty report on subprocess error event', async () => {
    const promise = detectDrift(mockStore(samplePredictions10));
    await flush();

    const proc = currentProcess();
    proc._emit('error', new Error('ENOENT: python not found'));

    const report = await promise;

    expect(report.drift_detected).toBe(false);
    expect(report.detector_stats.total_observations).toBe(0);
  });

  it('returns empty report when subprocess outputs invalid JSON', async () => {
    const promise = detectDrift(mockStore(samplePredictions10));
    await flush();

    const proc = currentProcess();
    proc._stdoutData('not valid json');
    proc._emit('close', 0);

    const report = await promise;

    expect(report.drift_detected).toBe(false);
    expect(report.detector_stats.total_observations).toBe(0);
  });

  it('passes custom model and delta options to subprocess', async () => {
    const promise = detectDrift(mockStore(samplePredictions10), {
      model: 'PageHinkley',
      delta: 0.005,
    });
    await flush();

    const proc = currentProcess();
    proc._stdoutData(JSON.stringify({
      drift_detected: false,
      warnings: [],
      detector_stats: { total_observations: 10, current_width: 10, total_detections: 0, model: 'PageHinkley' },
    }));
    proc._emit('close', 0);

    await promise;

    const args = getSpawnArgs();
    expect(args).toContain('--model');
    expect(args).toContain('PageHinkley');
    expect(args).toContain('--delta');
    expect(args).toContain('0.005');
  });
});
