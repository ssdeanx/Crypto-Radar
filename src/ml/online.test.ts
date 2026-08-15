// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — ML Online Learning Unit Tests
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

interface MockProcess {
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  _emit(event: string, ...args: unknown[]): void;
  _stdoutData(data: string): void;
  _stderrData(data: string): void;
}

let _currentProcess: MockProcess | null = null;

type ProcessHandler = (...args: unknown[]) => void;

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

// We'll control mock drift detection for autoRetrain tests
const mockDriftDetect = vi.fn();

const mockChildProcess = vi.hoisted(() => ({
  spawn: vi.fn(() => createMockProcess()),
}));

vi.mock('node:fs', () => mockFs);
vi.mock('node:child_process', () => mockChildProcess);

// Mock drift.js so autoRetrain's dynamic import returns our mock
vi.mock('./drift.js', () => ({
  detectDrift: mockDriftDetect,
}));

// ── Import after mocks are set up ────────────────────────────────────

import type { Store } from '../store/db.js';
import {
  onlineTrain,
  onlinePredict,
  onlineMetrics,
  onlineReset,
  autoRetrain,
} from './online.js';

// ── Test helpers ─────────────────────────────────────────────────────

function mockStore(): Store {
  return {} as Store;
}

function getSpawnArgs(): string[] {
  const call = mockChildProcess.spawn.mock.calls[0];
  if (!call) return [];
  return (call as unknown[])[1] as string[];
}

/** Complete an in-progress subprocess with stdout JSON data and exit code 0. */
function completeSubprocess(json: unknown) {
  const proc = _currentProcess!;
  proc._stdoutData(JSON.stringify(json));
  proc._emit('close', 0);
}

/** Flush microtasks so async functions can advance past `await`s. */
async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

const sampleFeatures = {
  rsi: 55.2,
  macd_histogram: 0.0012,
  bb_width: 0.05,
  atr_pct: 0.02,
  adx: 25.0,
};

// ═══════════════════════════════════════════════════════════════════════
// onlineTrain
// ═══════════════════════════════════════════════════════════════════════

describe('onlineTrain', () => {
  beforeEach(() => {
    _currentProcess = null;
    mockChildProcess.spawn.mockClear();
    mockFs.existsSync.mockReturnValue(true);
  });

  it('resolves with parsed train result from subprocess', async () => {
    const expected = { status: 'ok', total_updates: 42 };

    // runOnlineAction calls spawn synchronously inside new Promise constructor
    const promise = onlineTrain(sampleFeatures, 1);
    completeSubprocess(expected);

    const result = await promise;
    expect(result).toEqual(expected);

    const args = getSpawnArgs();
    expect(args).toContain('--action');
    expect(args).toContain('train');
    expect(args).toContain('--features');
    expect(args).toContain(JSON.stringify(sampleFeatures));
    expect(args).toContain('--label');
    expect(args).toContain('1');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// onlinePredict
// ═══════════════════════════════════════════════════════════════════════

describe('onlinePredict', () => {
  beforeEach(() => {
    _currentProcess = null;
    mockChildProcess.spawn.mockClear();
  });

  it('resolves with parsed prediction result from subprocess', async () => {
    const expected = { direction: 1, confidence: 0.82, probs: { '-1': 0.1, '0': 0.08, '1': 0.82 } };

    const promise = onlinePredict(sampleFeatures);
    completeSubprocess(expected);

    const result = await promise;
    expect(result).toEqual(expected);

    const args = getSpawnArgs();
    expect(args).toContain('--action');
    expect(args).toContain('predict');
  });

  it('returns uniform fallback when subprocess throws', async () => {
    const promise = onlinePredict(sampleFeatures);

    _currentProcess!._emit('error', new Error('model not found'));

    const result = await promise;
    expect(result).toEqual({
      direction: 0,
      confidence: 1 / 3,
      probs: { '-1': 1 / 3, '0': 1 / 3, '1': 1 / 3 },
    });
  });

  it('returns uniform fallback on non-zero exit', async () => {
    const promise = onlinePredict(sampleFeatures);

    _currentProcess!._emit('close', 1);

    const result = await promise;
    expect(result).toEqual({
      direction: 0,
      confidence: 1 / 3,
      probs: { '-1': 1 / 3, '0': 1 / 3, '1': 1 / 3 },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// onlineMetrics
// ═══════════════════════════════════════════════════════════════════════

describe('onlineMetrics', () => {
  beforeEach(() => {
    _currentProcess = null;
    mockChildProcess.spawn.mockClear();
    mockFs.existsSync.mockReturnValue(true);
  });

  it('returns null when model file does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await onlineMetrics();
    expect(result).toBeNull();
    expect(mockChildProcess.spawn).not.toHaveBeenCalled();
  });

  it('resolves with parsed metrics result from subprocess', async () => {
    const expected = {
      total_updates: 100,
      class_distribution: { '-1': 30, '0': 20, '1': 50 },
      accuracy: 0.65,
      precision: 0.62,
      recall: 0.60,
      f1: 0.61,
      concept_drift_events: 2,
    };

    const promise = onlineMetrics();
    completeSubprocess(expected);

    const result = await promise;
    expect(result).toEqual(expected);

    const args = getSpawnArgs();
    expect(args).toContain('--action');
    expect(args).toContain('metrics');
  });

  it('returns null when subprocess throws', async () => {
    const promise = onlineMetrics();

    _currentProcess!._emit('error', new Error('metrics failed'));

    const result = await promise;
    expect(result).toBeNull();
  });

  it('returns null on subprocess non-zero exit', async () => {
    const promise = onlineMetrics();

    _currentProcess!._emit('close', 2);

    const result = await promise;
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// onlineReset
// ═══════════════════════════════════════════════════════════════════════

describe('onlineReset', () => {
  beforeEach(() => {
    _currentProcess = null;
    mockChildProcess.spawn.mockClear();
  });

  it('calls subprocess with reset action', async () => {
    const promise = onlineReset();
    completeSubprocess({});

    await promise;

    const args = getSpawnArgs();
    expect(args).toContain('--action');
    expect(args).toContain('reset');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// autoRetrain
// ═══════════════════════════════════════════════════════════════════════

describe('autoRetrain', () => {
  beforeEach(() => {
    _currentProcess = null;
    mockChildProcess.spawn.mockClear();
    mockDriftDetect.mockReset();
  });

  it('calls reset when drift is detected', async () => {
    mockDriftDetect.mockResolvedValue({
      drift_detected: true,
      warnings: [{ index: 10, message: 'drift at 10' }],
      detector_stats: { total_observations: 100, current_width: 50, total_detections: 1, model: 'ADWIN' },
    });

    const promise = autoRetrain(mockStore());

    // autoRetrain does await import('./drift.js') + await detectDrift()
    // before calling runOnlineAction('reset'), so flush microtasks first
    await flush();

    // Now the reset subprocess should have been spawned
    const proc = _currentProcess!;
    proc._stdoutData('ok');
    proc._emit('close', 0);

    await promise;

    expect(mockChildProcess.spawn).toHaveBeenCalledTimes(1);
    const args = getSpawnArgs();
    expect(args).toContain('--action');
    expect(args).toContain('reset');
  });

  it('does NOT call reset when no drift is detected', async () => {
    mockDriftDetect.mockResolvedValue({
      drift_detected: false,
      warnings: [],
      detector_stats: { total_observations: 100, current_width: 100, total_detections: 0, model: 'ADWIN' },
    });

    await autoRetrain(mockStore());

    expect(mockChildProcess.spawn).not.toHaveBeenCalled();
  });
});
