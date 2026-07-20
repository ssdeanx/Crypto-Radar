// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Dataset Assembly
// ═══════════════════════════════════════════════════════════════════════
//
// Assembles feature rows + labels into JSONL training datasets with
// chronological train/val/test splits and z-score normalization.
// Saves normalization statistics for inference-time reuse.
//
// F5: NaN/Infinity handling — training-set medians are stored for
//     inference-time fill. Rows with NaN features are dropped from
//     training but can be scored during inference using median fill.
// ═══════════════════════════════════════════════════════════════════════

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../core/config.js';
import { DataError } from '../core/errors.js';
import type { FeatureRow, LabelRow, NormalizationStats, DatasetResult, DatasetOpts } from './types.js';
import { mean, standardDeviation, median } from '../math/index.js';

/** Default data directory for ML datasets — respects configured dataDir */
const DATA_DIR = path.join(loadConfig().dataDir, 'ml');


/**
 * Assemble a training dataset from feature rows and label rows.
 *
 * Algorithm:
 * 1. Inner-join features + labels on (symbol, interval, open_time)
 * 2. Drop rows with NaN/Infinity in feature columns
 * 3. Chronological split into train/val/test
 * 4. Z-score normalize features using training set statistics
 * 5. Write JSONL files (one JSON object per line)
 *
 * F5: Normalization statistics include medians for inference-time
 *     NaN/Infinity fill.
 *
 * @throws {DataError} If features or labels arrays are empty
 */
export function assembleDataset(
  features: FeatureRow[],
  labels: LabelRow[],
  opts: DatasetOpts,
): DatasetResult {
  if (features.length === 0) {
    throw new DataError('ml:dataset', 'Empty feature set — cannot assemble dataset');
  }
  if (labels.length === 0) {
    throw new DataError('ml:dataset', 'Empty label set — cannot assemble dataset');
  }

  const {
    testSplit = 0.15,
    valSplit = 0.15,
    normalize = true,
    excludeFeatures = [],
    outputPathPrefix = `${DATA_DIR}/dataset`,
  } = opts;

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPathPrefix), { recursive: true });

  // 1. Build feature→label map keyed by (symbol, interval, open_time)
  const labelMap = new Map<string, LabelRow>();
  for (const lbl of labels) {
    const key = `${lbl.symbol}|${lbl.interval}|${lbl.open_time}`;
    labelMap.set(key, lbl);
  }

  // 2. Inner-join: keep rows that have both features and labels, and non-null label
  type JoinedRow = Record<string, unknown>;
  const joined: JoinedRow[] = [];

  // Identify feature columns (all FeatureRow fields except symbol, interval, open_time)
  const featureKeys = new Set<string>();
  for (const row of features) {
    for (const key of Object.keys(row)) {
      if (key !== 'symbol' && key !== 'interval' && key !== 'open_time') {
        featureKeys.add(key);
      }
    }
  }

  // Remove excluded features
  for (const ex of excludeFeatures) {
    featureKeys.delete(ex);
  }

  const featureNames = Array.from(featureKeys).sort();

  for (const f of features) {
    const key = `${f.symbol}|${f.interval}|${f.open_time}`;
    const lbl = labelMap.get(key);
    if (!lbl) continue;

    // Only use rows where label is non-null (has lookahead data)
    if (lbl.label_class === null) continue;

    const row: JoinedRow = {
      symbol: f.symbol,
      interval: f.interval,
      open_time: f.open_time,
    };

    // Add features
    for (const fn of featureNames) {
      row[fn] = f[fn] ?? null;
    }

    // Add label
    row.label_class = lbl.label_class;

    joined.push(row);
  }

  // 3. Chronological sort
  joined.sort((a, b) => (a.open_time as number) - (b.open_time as number));

  // 4. Drop rows with NaN/Infinity in any feature (F5)
  const clean: JoinedRow[] = [];
  let droppedCount = 0;
  for (const row of joined) {
    let hasBad = false;
    for (const fn of featureNames) {
      const val = row[fn];
      if (val === null || val === undefined || (typeof val === 'number' && !Number.isFinite(val))) {
        hasBad = true;
        break;
      }
    }
    if (hasBad) {
      droppedCount++;
    } else {
      clean.push(row);
    }
  }

  // 5. Compute split indices (chronological)
  const n = clean.length;
  const valIdx = Math.floor(n * (1 - testSplit - valSplit));
  const testIdx = Math.floor(n * (1 - testSplit));

  const trainSet = clean.slice(0, valIdx);
  const valSet = clean.slice(valIdx, testIdx);
  const testSet = clean.slice(testIdx);

  // 6. Compute normalization statistics from training set (F5)
  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};
  const medians: Record<string, number> = {};

  if (normalize) {
    for (const fn of featureNames) {
      const values = trainSet
        .map(r => r[fn])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (values.length === 0) {
        means[fn] = 0;
        stds[fn] = 1;
        medians[fn] = 0;
        continue;
      }

      // Mean
      means[fn] = mean(values);

      // Std — uses population std dev (divides by n)
      stds[fn] = standardDeviation(values) || 1;

      // Median (F5: for NaN fill during inference)
      medians[fn] = median(values);
    }

    // Apply normalization
    const normVal = (fn: string, rawVal: unknown): number | null => {
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return null;
      const mean = means[fn] ?? 0;
      const std = stds[fn] ?? 1;
      return (rawVal - mean) / std;
    };

    for (const row of trainSet) {
      for (const fn of featureNames) {
        row[fn] = normVal(fn, row[fn]);
      }
    }
    for (const row of valSet) {
      for (const fn of featureNames) {
        row[fn] = normVal(fn, row[fn]);
      }
    }
    for (const row of testSet) {
      for (const fn of featureNames) {
        row[fn] = normVal(fn, row[fn]);
      }
    }
  }

  // 7. Write JSONL files (one JSON object per line)
  // Column ordering: symbol, interval, open_time, ...featureNames, label_class
  const outputCols = ['symbol', 'interval', 'open_time', ...featureNames, 'label_class'];

  const id = randomUUID().slice(0, 8);

  const writeJsonl = (rows: JoinedRow[], suffix: string): string => {
    const filePath = `${outputPathPrefix}_${suffix}_${id}.jsonl`;
    const lines: string[] = [];
    for (const row of rows) {
      // Build object with consistent column ordering for readability
      const obj: Record<string, unknown> = {};
      for (const col of outputCols) {
        obj[col] = row[col] ?? null;
      }
      lines.push(JSON.stringify(obj));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    return filePath;
  };

  const trainPath = writeJsonl(trainSet, 'train');
  const valPath = writeJsonl(valSet, 'val');
  const testPath = writeJsonl(testSet, 'test');

  // 8. Write normalization stats as JSON alongside
  const statsPath = `${outputPathPrefix}_norm_${id}.json`;
  const normStats: NormalizationStats = {
    means,
    stds,
    medians,
    featureNames,
    rowCount: n,
  };
  fs.writeFileSync(statsPath, JSON.stringify(normStats, null, 2) + '\n', 'utf-8');

  return {
    trainPath,
    valPath,
    testPath,
    featureCount: featureNames.length,
    rowCount: n,
    droppedCount,
    normalizationStats: normStats,
  };
}

/**
 * Normalize a single feature row using pre-computed statistics.
 * F5: Uses training-set medians to fill NaN/Infinity values.
 */
export function normalizeRow(
  row: Record<string, unknown>,
  stats: NormalizationStats,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };
  for (const fn of stats.featureNames) {
    const val = result[fn];
    if (val === null || val === undefined || (typeof val === 'number' && !Number.isFinite(val))) {
      // F5: Fill NaN with training-set median's z-score (not raw 0)
      // This preserves the 'neutral' activation the model learned during
      // training, where NaN rows were dropped entirely.
      const median = stats.medians[fn] ?? 0;
      const mean = stats.means[fn] ?? 0;
      const std = stats.stds[fn] ?? 1;
      result[fn] = std !== 0 ? (median - mean) / std : 0;
      continue;
    }
    if (typeof val === 'number') {
      result[fn] = (val - (stats.means[fn] ?? 0)) / (stats.stds[fn] ?? 1);
    }
  }
  return result;
}
