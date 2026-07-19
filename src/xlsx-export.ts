// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — XLSX Export
// ═══════════════════════════════════════════════════════════════════════
//
// Exports enriched ticker data to Excel (.xlsx) format.
// Ready for Google Sheets, Excel, Numbers, and LibreOffice Calc.
//
// Headers match CSV_HEADER for consistency. Data types are mapped to
// native Excel types (numbers, dates, strings) for proper spreadsheet
// auto-detection.
//
// Dependencies: exceljs

import ExcelJS from 'exceljs';
import type { EnrichedTicker } from './types.js';
import { CSV_HEADER } from './output.js';

const XLSX_COL_WIDTH = 16;       // default column width
const XLSX_DATE_FMT = 'yyyy-mm-dd hh:mm:ss'; // Excel date format

/**
 * Export enriched tickers to an XLSX workbook.
 *
 * Features:
 * - Proper column headers matching CSV schema
 * - Number-typed cells (not strings) for calculations
 * - Date-formatted timestamps for Excel auto-parsing
 * - Frozen header row
 * - Auto-fit column widths
 * - Green/red conditional coloring on priceChangePercent
 *
 * @param tickers  Array of enriched tickers from a radar scan
 * @param filePath Output file path (e.g. 'crypto-radar.xlsx')
 * @returns        The file path on success
 */
export async function exportToXlsx(
  tickers: EnrichedTicker[],
  filePath: string,
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hermes Crypto Radar';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('Radar Data');

  // Parse CSV header into columns
  const headers = CSV_HEADER.split(',');

  // Build column definitions from header names
  sheet.columns = headers.map(h => ({
    header: h,
    key: h,
    width: XLSX_COL_WIDTH,
  }));

  // Add data rows with proper types
  for (const t of tickers) {
    const row: Record<string, unknown> = {
      run_id: t.runId,
      ts_utc: t.tsUtc,
      date_et: t.dateEt,
      symbol: t.symbol,
      chain: t.chain,
      last_price: t.lastPrice,
      bid_price: t.bidPrice,
      bid_qty: t.bidQty,
      ask_price: t.askPrice,
      ask_qty: t.askQty,
      spread_pct: round6(t.spreadPct),
      open_price: t.openPrice,
      high_price: t.highPrice,
      low_price: t.lowPrice,
      prev_close_price: t.prevClosePrice,
      price_change_pct: round2(t.priceChangePercent),
      weighted_avg_price: t.weightedAvgPrice,
      price_change: t.priceChange,
      volume: t.volume,
      quote_volume: round2(t.quoteVolume),
      count: t.count,
      last_qty: t.lastQty,
      vwap_dist_pct: round2(t.vwapDistPct),
      range_pos_pct: round4(t.rangePosPct),
      book_imbalance: round4(t.bookImbalance),
      vol_vs_avg: round2(t.volVsAvg),
      obv: round2(t.obv),
      momentum: round2(t.momentum),
      alerts: t.alerts,
      source: t.source,

      // ── Technical indicators ──
      rsi: t.rsi,
      macd_macd: t.macdMacd,
      macd_signal: t.macdSignal,
      macd_histogram: t.macdHistogram,
      bb_upper: t.bbUpper,
      bb_middle: t.bbMiddle,
      bb_lower: t.bbLower,
      bb_width: t.bbWidth,
      atr_pct: t.atrPct,
      mfi: t.mfi,
      stoch_k: t.stochK,
      stoch_d: t.stochD,
      williams_r: t.williamsR,
      cmf: t.cmf,
      tsi: t.tsi,
      ema50_dist_pct: t.ema50DistPct,
      vol_trend: t.volTrend,

      // ── Strategy signals ──
      momentum_score: t.momentumScore,
      momentum_direction: t.momentumDirection,
      mean_reversion_score: t.meanReversionScore,
      mean_reversion_direction: t.meanReversionDirection,
      trend_following_score: t.trendFollowingScore,
      trend_following_direction: t.trendFollowingDirection,
      composite_score: t.compositeScore,
      composite_direction: t.compositeDirection,
      signal_count: t.signalCount,
      position_size: t.positionSize,

      // ── On-chain metrics ──
      onchain_tvl: t.onchainTvl,
      onchain_fees_1d: t.onchainFees1d,
      onchain_chain_tvl: t.onchainChainTvl,
      onchain_confidence: t.onchainConfidence,

      // ── Market regime ──
      regime: t.regime,
      regime_confidence: t.regimeConfidence,
    };

    const excelRow = sheet.addRow(row);

    // Apply date formatting to timestamp columns
    const tsCell = excelRow.getCell(2); // ts_utc
    if (tsCell.value != null) tsCell.numFmt = XLSX_DATE_FMT;
    const dateEtCell = excelRow.getCell(3); // date_et
    if (dateEtCell.value != null) dateEtCell.numFmt = XLSX_DATE_FMT;

    // Apply conditional coloring on priceChangePercent column (index 16, 0-based)
    const pctCell = excelRow.getCell(16);
    if (typeof pctCell.value === 'number') {
      if (pctCell.value >= 5) {
        pctCell.font = { color: { argb: 'FF22C55E' }, bold: true }; // green
      } else if (pctCell.value <= -5) {
        pctCell.font = { color: { argb: 'FFEF4444' }, bold: true }; // red
      } else if (pctCell.value > 0) {
        pctCell.font = { color: { argb: 'FF4ADE80' } }; // light green
      } else if (pctCell.value < 0) {
        pctCell.font = { color: { argb: 'FFF87171' } }; // light red
      }
    }

    // Style the alert/high-volume cells with a highlight
    const volumeCell = excelRow.getCell(20); // quoteVolume
    if (typeof volumeCell.value === 'number' && volumeCell.value >= 10_000_000) {
      volumeCell.font = { bold: true, color: { argb: 'FF38BDF8' } };
    }

    // Spread warning
    const spreadCell = excelRow.getCell(11); // spreadPct
    if (typeof spreadCell.value === 'number' && spreadCell.value >= 1) {
      spreadCell.font = { bold: true, color: { argb: 'FFF59E0B' } };
    }
  }

  // Freeze top row (header)
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  sheet.views = [
    { state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2' },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  // Auto-fit column widths based on content
  for (let i = 0; i < headers.length; i++) {
    const col = sheet.getColumn(i + 1);
    const headerLen = (headers[i]?.length ?? 10) + 2;
    let maxLen = headerLen;

    // Sample up to 100 rows for width estimation
    const sampleSize = Math.min(tickers.length, 100);
    for (let r = 0; r < sampleSize; r++) {
      const val = sheet.getRow(r + 2)?.getCell(i + 1)?.value;
      if (val != null) {
        const strLen = String(val).length + 2;
        if (strLen > maxLen) maxLen = strLen;
      }
    }

    col.width = Math.min(Math.max(maxLen, 10), 30); // clamp 10-30
  }

  // Write file
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/** Round to 2 decimal places */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Round to 4 decimal places */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Round to 6 decimal places */
function round6(v: number): number {
  return Math.round(v * 1000000) / 1000000;
}
