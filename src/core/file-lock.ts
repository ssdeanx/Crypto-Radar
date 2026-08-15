// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Advisory File Lock (POSIX atomic mkdir)
// ═══════════════════════════════════════════════════════════════════════
//
// Prevents concurrent writes to shared accumulating files (JSONL datasets,
// news cache, etc.) across processes. Uses atomic mkdir as a cross-platform
// advisory lock — no external dependencies, works on any filesystem that
// supports mkdir (POSIX atomic, NTFS/Junction compatible).
//
// Usage:
//   FileLock.withLock('ticker-output', () => {
//     fs.appendFileSync(path, data, 'utf-8');
//   });

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const LOCKS_DIR = path.join(os.tmpdir(), 'crypto-radar-locks');

/**
 * Lightweight advisory file lock using atomic mkdir.
 * Prevents concurrent writes to shared accumulating files.
 */
export class FileLock {
  private lockPath: string;
  private acquired = false;

  constructor(name: string) {
    fs.mkdirSync(LOCKS_DIR, { recursive: true });
    this.lockPath = path.join(LOCKS_DIR, `${name}.lock`);
  }

  /** Acquire the lock. Returns true if acquired, false if busy. */
  tryAcquire(): boolean {
    if (this.acquired) return true;
    try {
      fs.mkdirSync(this.lockPath);
      this.acquired = true;
      return true;
    } catch {
      return false; // EEXIST — lock held by another process
    }
  }

  /** Acquire with retry. Returns true if acquired within timeout. */
  acquire(timeoutMs = 5000): boolean {
    const deadline = Date.now() + timeoutMs;
    while (!this.tryAcquire()) {
      if (Date.now() >= deadline) return false;
      // Sleep 50ms between retries
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    return true;
  }

  /** Release the lock. */
  release(): void {
    if (!this.acquired) return;
    try { fs.rmdirSync(this.lockPath); } catch { /* ignore */ }
    this.acquired = false;
  }

  /** Acquire, run fn, release. Returns fn's result or throws on timeout. */
  static withLock<T>(name: string, fn: () => T, timeoutMs = 5000): T {
    const lock = new FileLock(name);
    if (!lock.acquire(timeoutMs)) {
      throw new Error(`Failed to acquire lock: ${name} (timeout ${timeoutMs}ms)`);
    }
    try {
      return fn();
    } finally {
      lock.release();
    }
  }
}
