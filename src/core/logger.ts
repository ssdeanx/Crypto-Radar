// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Enterprise Logger
// ═══════════════════════════════════════════════════════════════════════
//
// Default format is human-readable text with picocolors for terminal output.
// JSON format is used automatically when logging to a file.
// ═══════════════════════════════════════════════════════════════════════

import { resolve } from 'node:path';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import pc from 'picocolors';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_NUM: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const LEVEL_STYLE: Record<number, (s: string) => string> = {
  10: pc.dim,
  20: pc.blue,
  30: pc.green,
  40: pc.yellow,
  50: pc.red,
  60: (s: string) => pc.red(pc.bold(s)),
};

const LEVEL_LABEL: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO ',
  40: 'WARN ',
  50: 'ERROR',
  60: 'FATAL',
};

export interface LogEntry {
  level: number;
  time: string;
  msg: string;
  [key: string]: unknown;
}

export type LogFormat = 'json' | 'text';

class Logger {
  private minLevel: number = 30; // info default
  private outputStream: 'stdout' | 'file' = 'stdout';
  private logFilePath = '';
  private format: LogFormat = 'text'; // text for terminal, json for files

  configure(opts: { level?: LogLevel; logDir?: string; logFile?: string; format?: LogFormat }): void {
    if (opts.level) this.minLevel = LEVEL_NUM[opts.level];
    if (opts.logDir && opts.logFile) {
      this.outputStream = 'file';
      this.logFilePath = resolve(opts.logDir, opts.logFile);
      const dir = resolve(opts.logDir);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    if (opts.format) this.format = opts.format;
  }

  private write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    const num = LEVEL_NUM[level];
    if (num < this.minLevel) return;

    const entry: LogEntry = {
      level: num,
      time: new Date().toISOString(),
      msg,
      ...extra,
    };

    const line = this.format === 'text'
      ? this.formatText(entry)
      : JSON.stringify(entry);

    if (this.outputStream === 'file') {
      try {
        appendFileSync(this.logFilePath, line + '\n');
      } catch { /* best effort */ }
    } else {
      process.stderr.write(line + '\n');
    }
  }

  private formatText(entry: LogEntry): string {
    const style = LEVEL_STYLE[entry.level] ?? pc.dim;
    const label = LEVEL_LABEL[entry.level] ?? '????';
    let line = `${style(`[${label}]`)} ${pc.bold(entry.msg)}`;

    // Append extra fields (skip known meta fields)
    const extras: string[] = [];
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'level' || key === 'time' || key === 'msg') continue;
      if (value !== undefined) {
        const formatted = typeof value === 'string'
          ? JSON.stringify(value)
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        extras.push(`${pc.dim(key)}${pc.dim('=')}${pc.cyan(formatted)}`);
      }
    }
    if (extras.length > 0) {
      line += '  ' + extras.join('  ');
    }
    return line;
  }

  trace(msg: string, extra?: Record<string, unknown>): void { this.write('trace', msg, extra); }
  debug(msg: string, extra?: Record<string, unknown>): void { this.write('debug', msg, extra); }
  info(msg: string, extra?: Record<string, unknown>): void { this.write('info', msg, extra); }
  warn(msg: string, extra?: Record<string, unknown>): void { this.write('warn', msg, extra); }
  error(msg: string, extra?: Record<string, unknown>): void { this.write('error', msg, extra); }
  fatal(msg: string, extra?: Record<string, unknown>): void { this.write('fatal', msg, extra); }

  /**
   * Write a message directly to stdout (for tool output, not logs).
   */
  stdout(msg: string): void {
    process.stdout.write(msg + '\n');
  }

  /**
   * Create a child logger with bound context.
   */
  child(bindings: Record<string, unknown>): Logger {
    const child = new Logger();
    child.minLevel = this.minLevel;
    child.outputStream = this.outputStream;
    child.logFilePath = this.logFilePath;
    child.format = this.format;
    const parentWrite = this.write.bind(this);
    child.write = (level, msg, extra) => parentWrite(level, msg, { ...bindings, ...extra });
    return child;
  }

  /** Reset to default state */
  reset(): void {
    this.minLevel = 30;
    this.outputStream = 'stdout';
    this.logFilePath = '';
    this.format = 'text';
  }
}

export const logger = new Logger();
