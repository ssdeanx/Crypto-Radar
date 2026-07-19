// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Shared SVG Primitives Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  fmtDollar,
  fmtPct,
  shortPct,
  formatTime,
  formatYLabel,
  clamp,
  lerpColor,
  correlationColor,
  getLayout,
  calcCandleWidth,
  applyLogScale,
  renderTitle,
  renderWatermark,
  svgOpen,
  svgClose,
  chartStyles,
  chartDefs,
  BG,
  TEXT,
  ACCENT,
  SUBTLE,
  MUTED,
  GRID_LINE,
} from './shared-svg.js';
import type { Kline } from '../types.js';

// ── String Utilities ──

describe('escapeXml', () => {
  it('escapes ampersands', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });

  it('escapes < and >', () => {
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeXml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('returns empty string unchanged', () => {
    expect(escapeXml('')).toBe('');
  });

  it('returns plain string unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });
});

describe('fmtDollar', () => {
  it('formats billions', () => {
    expect(fmtDollar(1_500_000_000)).toBe('$1500.00M'); // in millions
  });

  it('formats millions', () => {
    expect(fmtDollar(5_000_000)).toBe('$5.00M');
  });

  it('formats thousands', () => {
    expect(fmtDollar(1_500)).toBe('$1.5K');
  });

  it('formats values >= 1', () => {
    expect(fmtDollar(80.5)).toBe('$80.50');
  });

  it('formats small values with 4 decimal places', () => {
    expect(fmtDollar(0.01234)).toBe('$0.0123');
  });

  it('formats very small values with 6 decimal places', () => {
    expect(fmtDollar(0.0001234)).toBe('$0.000123');
  });
});

describe('fmtPct', () => {
  it('adds + prefix for positive values', () => {
    expect(fmtPct(5.5)).toBe('+5.50%');
  });

  it('adds - prefix for negative values', () => {
    expect(fmtPct(-3.2)).toBe('-3.20%');
  });

  it('handles zero', () => {
    expect(fmtPct(0)).toBe('+0.00%');
  });
});

describe('shortPct', () => {
  it('adds + prefix with one decimal', () => {
    expect(shortPct(5.55)).toBe('+5.5%');
  });

  it('adds - prefix', () => {
    expect(shortPct(-3.24)).toBe('-3.2%');
  });
});

describe('formatTime', () => {
  it('formats a timestamp as MM/DD HH:mm', () => {
    const ts = new Date('2026-07-06T14:30:00Z').getTime();
    const result = formatTime(ts);
    expect(result).toMatch(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
  });
});

describe('formatYLabel', () => {
  it('formats millions', () => {
    expect(formatYLabel(5_000_000)).toBe('$5.00M');
  });

  it('formats thousands', () => {
    expect(formatYLabel(1_500)).toBe('$1.5K');
  });

  it('formats >= 1', () => {
    expect(formatYLabel(80.5)).toBe('$80.50');
  });

  it('formats small values', () => {
    expect(formatYLabel(0.01234)).toBe('$0.0123');
  });
});

// ── Math Utilities ──

describe('clamp', () => {
  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('applyLogScale', () => {
  it('returns value unchanged when logScale is false', () => {
    expect(applyLogScale(100, false)).toBe(100);
  });

  it('applies log when logScale is true', () => {
    expect(applyLogScale(100, true)).toBeCloseTo(4.605, 2);
  });

  it('handles zero prices with epsilon', () => {
    const result = applyLogScale(0, true);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ── Color Utilities ──

describe('lerpColor', () => {
  it('returns exact color at t=0', () => {
    expect(lerpColor('#22c55e', '#ef4444', 0)).toBe('#22c55e');
  });

  it('returns exact color at t=1', () => {
    expect(lerpColor('#22c55e', '#ef4444', 1)).toBe('#ef4444');
  });

  it('interpolates at midpoint', () => {
    const mid = lerpColor('#000000', '#ffffff', 0.5);
    expect(mid).toBe('#808080');
  });
});

describe('correlationColor', () => {
  it('returns neutral at 0', () => {
    expect(correlationColor(0)).toBe('#334155');
  });

  it('returns green at 1.0', () => {
    expect(correlationColor(1)).toBe('#166534');
  });

  it('returns red at -1.0', () => {
    expect(correlationColor(-1)).toBe('#991b1b');
  });

  it('clamps values outside [-1, 1]', () => {
    expect(correlationColor(2)).toBe('#166534');
    expect(correlationColor(-2)).toBe('#991b1b');
  });

  it('returns green-ish for positive values', () => {
    const c = correlationColor(0.5);
    expect(c).toBe('#22c55e');
  });
});

// ── Layout ──

describe('getLayout', () => {
  it('computes plot dimensions correctly', () => {
    const layout = getLayout(800, 400, 50);
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(400);
    expect(layout.padding.top).toBe(30);
    expect(layout.padding.right).toBe(20);
    expect(layout.padding.bottom).toBe(50);
    expect(layout.padding.left).toBe(60);
    expect(layout.plotW).toBe(800 - 60 - 20); // 720
    expect(layout.plotH).toBe(400 - 30 - 50); // 320
  });

  it('uses default bottomPad of 50', () => {
    const layout = getLayout(600, 300);
    expect(layout.padding.bottom).toBe(50);
    expect(layout.plotH).toBe(300 - 30 - 50);
  });
});

// ── SVG Boilerplate ──

describe('chartStyles', () => {
  it('returns a style element with CSS', () => {
    const css = chartStyles();
    expect(css).toContain('<style>');
    expect(css).toContain('</style>');
    expect(css).toContain('.price-line');
    expect(css).toContain('.candle-up');
    expect(css).toContain('.rsi-line');
  });
});

describe('chartDefs', () => {
  it('returns a defs element with gradients', () => {
    const defs = chartDefs();
    expect(defs).toContain('<defs>');
    expect(defs).toContain('</defs>');
    expect(defs).toContain('priceGrad');
    expect(defs).toContain('rsiGrad');
    expect(defs).toContain('lineGlow');
  });
});

describe('svgOpen / svgClose', () => {
  it('svgOpen produces opening SVG tag with styles and defs', () => {
    const svg = svgOpen(800, 400, 'Test Chart');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 800 400"');
    expect(svg).toContain('aria-label="Test Chart"');
    expect(svg).toContain('<style>');
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<rect');
  });

  it('svgClose returns closing tag', () => {
    expect(svgClose()).toBe('</svg>');
  });
});

describe('renderTitle', () => {
  it('renders centered text element', () => {
    const title = renderTitle(800, 20, 'Price Chart');
    expect(title).toContain('<text');
    expect(title).toContain('x="400.0"');
    expect(title).toContain('y="20"');
    expect(title).toContain('Price Chart');
  });
});

describe('renderWatermark', () => {
  it('renders a watermark text element', () => {
    const wm = renderWatermark(800, 400);
    expect(wm).toContain('<text');
    expect(wm).toContain('788.0'); // x = width - 12
    expect(wm).toContain('392.0'); // y = height - 8
    expect(wm).toContain('Crypto Radar');
  });
});

// ── Candle Width ──

describe('calcCandleWidth', () => {
  it('returns maxW for very few candles', () => {
    expect(calcCandleWidth(500, 2)).toBe(12);
  });

  it('calcCandleWidth for many candles returns at least minW', () => {
    const cw = calcCandleWidth(500, 300);
    expect(cw).toBeGreaterThanOrEqual(2);
    expect(cw).toBeLessThanOrEqual(12);
  });

  it('returns 0.7 * (plotW/n) clamped to [minW, maxW]', () => {
    // 500/100 * 0.7 = 3.5
    expect(calcCandleWidth(500, 100)).toBeCloseTo(3.5, 1);
  });
});
