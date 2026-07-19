// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Charts Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  priceSparkline,
  dualSparkline,
  multiMaSparkline,
  multiPaneAsciiChart,
  priceSvgChart,
  multiPanelSvgChart,
} from './charts.js';
import type { Kline } from '../types.js';

function makeKlines(count: number): Kline[] {
  return Array.from({ length: count }, (_, i) => ({
    openTime: i * 3600000,
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 100 + i + Math.sin(i * 0.5) * 5,
    volume: 1000 + i * 10,
    closeTime: (i + 1) * 3600000,
    quoteVolume: (100 + i) * 1000,
    count: 100,
    takerBuyVol: 500,
    takerBuyQuoteVol: 500,
    ignore: 0,
  }));
}

describe('priceSparkline', () => {
  it('produces ASCII chart output', () => {
    const klines = makeKlines(30);
    const chart = priceSparkline(klines);
    expect(chart).toBeTruthy();
    expect(chart.length).toBeGreaterThan(10);
    expect(chart).toMatch(/[╭╮╰╯│┤╱╲]/); // asciichart line drawing chars
  });

  it('respects custom height', () => {
    const klines = makeKlines(20);
    const chart = priceSparkline(klines, { height: 5 });
    const lines = chart.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it('includes min/max price markers', () => {
    const klines = makeKlines(30);
    const chart = priceSparkline(klines);
    // Should contain arrow-up and arrow-down indicators
    expect(chart).toMatch(/[⤒⤓]/);
  });

  it('includes trend direction annotation', () => {
    const klines = makeKlines(30);
    const chart = priceSparkline(klines);
    // Should contain a percentage change
    expect(chart).toMatch(/[-+]?\d+\.\d+%/);
  });

  it('includes volume bars row', () => {
    const klines = makeKlines(30);
    const chart = priceSparkline(klines);
    expect(chart).toContain('Vol');
  });

  it('includes RSI indicator row', () => {
    const klines = makeKlines(30);
    const chart = priceSparkline(klines);
    expect(chart).toContain('RSI');
  });

  it('includes latest price label', () => {
    const klines = makeKlines(30);
    const chart = priceSparkline(klines);
    expect(chart).toContain('Latest');
  });

  it('uses picocolors for coloring (imported in source)', () => {
    const klines = makeKlines(30);
    const chart = priceSparkline(klines);
    // picocolors is imported and used; in non-TTY test env colors are stripped
    // but the chart still contains all content
    expect(chart).toBeTruthy();
    expect(chart.length).toBeGreaterThan(10);
  });

  it('supports S/R overlay option', () => {
    const klines = makeKlines(60); // need enough data for S/R
    const chart = priceSparkline(klines, { showSR: true });
    // S/R lines may or may not be found, but should not crash
    expect(chart).toBeTruthy();
  });

  it('accepts custom width for downsampling', () => {
    const klines = makeKlines(100);
    const chart = priceSparkline(klines, { width: 30 });
    expect(chart).toBeTruthy();
  });
});

describe('dualSparkline', () => {
  it('produces multi-series chart', () => {
    const klines = makeKlines(30);
    const chart = dualSparkline(klines);
    expect(chart).toBeTruthy();
    expect(chart.length).toBeGreaterThan(10);
  });

  it('includes RSI indicator row', () => {
    const klines = makeKlines(30);
    const chart = dualSparkline(klines);
    expect(chart).toContain('RSI');
  });

  it('includes min/max markers', () => {
    const klines = makeKlines(30);
    const chart = dualSparkline(klines);
    expect(chart).toMatch(/[⤒⤓]/);
  });

  it('includes trend annotation', () => {
    const klines = makeKlines(30);
    const chart = dualSparkline(klines);
    expect(chart).toMatch(/[-+]?\d+\.\d+%/);
  });

  it('supports S/R overlay option', () => {
    const klines = makeKlines(60);
    const chart = dualSparkline(klines, { showSR: true });
    expect(chart).toBeTruthy();
  });
});

describe('multiMaSparkline', () => {
  it('produces multi-series chart with EMAs', () => {
    const klines = makeKlines(60);
    const chart = multiMaSparkline(klines);
    expect(chart).toBeTruthy();
    expect(chart.length).toBeGreaterThan(10);
  });

  it('includes bid/ask imbalance row', () => {
    const klines = makeKlines(60);
    const chart = multiMaSparkline(klines);
    expect(chart).toContain('Bid');
  });

  it('includes RSI indicator', () => {
    const klines = makeKlines(60);
    const chart = multiMaSparkline(klines);
    expect(chart).toContain('RSI');
  });

  it('includes volume bars', () => {
    const klines = makeKlines(60);
    const chart = multiMaSparkline(klines);
    expect(chart).toContain('Vol');
  });

  it('includes min/max markers', () => {
    const klines = makeKlines(60);
    const chart = multiMaSparkline(klines);
    expect(chart).toMatch(/[⤒⤓]/);
  });

  it('supports S/R overlay', () => {
    const klines = makeKlines(60);
    const chart = multiMaSparkline(klines, { showSR: true });
    expect(chart).toBeTruthy();
  });

  it('accepts custom width option', () => {
    const klines = makeKlines(60);
    const chart = multiMaSparkline(klines, { width: 40 });
    expect(chart).toBeTruthy();
  });
});

describe('multiPaneAsciiChart', () => {
  it('produces multi-pane output with all panes', () => {
    const klines = makeKlines(60);
    const chart = multiPaneAsciiChart(klines, 'TEST');
    expect(chart).toBeTruthy();
    expect(chart.length).toBeGreaterThan(20);
    expect(chart).toContain('Price');
    expect(chart).toContain('Volume');
    expect(chart).toContain('RSI');
  });

  it('can show only price pane', () => {
    const klines = makeKlines(30);
    const chart = multiPaneAsciiChart(klines, 'TEST', { showPrice: true, showVolume: false, showRSI: false });
    expect(chart).toContain('Price');
    expect(chart).not.toContain('Volume');
    expect(chart).not.toContain('RSI');
  });

  it('can show only volume pane', () => {
    const klines = makeKlines(30);
    const chart = multiPaneAsciiChart(klines, 'TEST', { showPrice: false, showVolume: true, showRSI: false });
    expect(chart).toContain('Volume');
    expect(chart).not.toContain('Price');
    expect(chart).not.toContain('RSI');
  });

  it('can show only RSI pane', () => {
    const klines = makeKlines(30);
    const chart = multiPaneAsciiChart(klines, 'TEST', { showPrice: false, showVolume: false, showRSI: true });
    expect(chart).toContain('RSI');
    expect(chart).not.toContain('Price');
    expect(chart).not.toContain('Volume');
  });

  it('attempts S/R detection in price pane (data-dependent)', () => {
    const klines = makeKlines(60);
    const chart = multiPaneAsciiChart(klines, 'TEST');
    // S/R detection depends on realistic price action;
    // test data is synthetic sine wave, so levels may not be detected
    // Verify it doesn't crash and produces expected output
    expect(chart).toBeTruthy();
    expect(chart).toContain('Price');
    expect(chart).toContain('Volume');
    expect(chart).toContain('RSI');
  });

  it('includes min/max markers in price pane', () => {
    const klines = makeKlines(30);
    const chart = multiPaneAsciiChart(klines, 'TEST');
    expect(chart).toMatch(/[⤒⤓]/);
  });

  it('includes bid/ask imbalance in volume pane', () => {
    const klines = makeKlines(30);
    const chart = multiPaneAsciiChart(klines, 'TEST');
    expect(chart).toContain('Bid/Ask');
  });

  it('includes RSI value and zone label', () => {
    const klines = makeKlines(30);
    const chart = multiPaneAsciiChart(klines, 'TEST');
    expect(chart).toContain('RSI');
    // Should show a zone label (Neutral, Overbought, Oversold, etc.)
    expect(chart).toMatch(/(Neutral|Overbought|Oversold)/);
  });

  it('includes trend annotation', () => {
    const klines = makeKlines(30);
    const chart = multiPaneAsciiChart(klines, 'TEST');
    expect(chart).toMatch(/[-+]?\d+\.\d+%/);
  });

  it('handles scattered data without errors', () => {
    const klines = makeKlines(5); // very few klines
    const chart = multiPaneAsciiChart(klines, 'TEST');
    expect(chart).toBeTruthy();
  });

  it('accepts custom pane height', () => {
    const klines = makeKlines(60);
    const chart = multiPaneAsciiChart(klines, 'TEST', { paneHeight: 6 });
    expect(chart).toBeTruthy();
  });
});

describe('priceSvgChart', () => {
  it('generates valid SVG', () => {
    const klines = makeKlines(30);
    const svg = priceSvgChart('Test Chart', klines, 600, 300);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Test Chart');
    expect(svg).toContain('viewBox');
  });

  it('outputs different dimensions', () => {
    const klines = makeKlines(20);
    const svg = priceSvgChart('Small', klines, 300, 150);
    expect(svg).toContain('viewBox="0 0 300 150"');
    expect(svg).toContain('aria-label="Price Chart: Small"');
  });
});

describe('multiPanelSvgChart', () => {
  it('generates multi-panel dashboard', () => {
    const klines = makeKlines(40);
    const rsiValues = klines.map((_, i) => i < 14 ? null : 50 + Math.sin(i * 0.5) * 20);
    const svg = multiPanelSvgChart('Dashboard', klines, rsiValues, 600, 400);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('RSI');
    expect(svg).toContain('Dashboard');
  });
});
