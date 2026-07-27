import { VertexAI } from '@google-cloud/vertexai';
import type { KlineRow } from '../types.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'gemini' });

const project = process.env.BIGQUERY_PROJECT_ID ?? 'project-513b86da-a04a-494a-8e9';
const location = 'us-central1';

/** Input shape for batch reasoning — one entry per prediction. */
export interface BatchPredictionInput {
  symbol: string;
  direction: -1 | 0 | 1;
  confidence: number;
  ticker: { lastPrice: number; priceChangePercent: number };
  signal: { compositeScore: number; regime?: string | null };
  klines: KlineRow[];
}

/**
 * Parse a JSON response from the batch LLM call into a symbol→reasoning map.
 * Accepts both the structured `{ reasonings: [...] }` format and a bare array.
 */
function parseBatchResponse(
  raw: string,
  symbols: string[],
): Map<string, string> {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    // Support both { reasonings: [...] } and bare [...] formats
    const list = Array.isArray(parsed) ? parsed : (parsed.reasonings ?? parsed.tokens ?? []);
    if (Array.isArray(list)) {
      const map = new Map<string, string>();
      for (const entry of list) {
        const sym = entry.symbol ?? entry.token;
        if (sym) map.set(sym, entry.reasoning ?? '');
      }
      // Ensure every requested symbol has an entry (LLM may skip some)
      for (const sym of symbols) {
        if (!map.has(sym)) map.set(sym, '');
      }
      return map;
    }
  } catch {
    // parse failure → fall through to empty map
  }
  return new Map(symbols.map(s => [s, ''] as [string, string]));
}

/**
 * Batch all predictions into a SINGLE LLM API call instead of N calls.
 *
 * Builds one prompt with every token listed and returns a symbol→reasoning map.
 * Routes through the local OpenAI-compatible provider when RADAR__AI_BASE_URL
 * is configured, otherwise falls back to Vertex AI Gemini.
 *
 * Returns empty reasoning for every symbol on failure (non-blocking).
 */
export async function batchGenerateReasoning(
  predictions: BatchPredictionInput[],
): Promise<Map<string, string>> {
  if (predictions.length === 0) return new Map();

  const symbols = predictions.map(p => p.symbol);
  const tokenDetails = predictions.map((p, i) => {
    const recentCloses = p.klines.slice(0, 10).map(k => k.close).join(', ');
    const dirLabel = p.direction === 1 ? 'BULLISH' : p.direction === -1 ? 'BEARISH' : 'NEUTRAL';
    return `Token ${i + 1}: ${p.symbol}
- Predicted Direction: ${dirLabel}
- ML Confidence: ${(p.confidence * 100).toFixed(1)}%
- Recent Close Prices (last 10 hours, newest first): [${recentCloses}]
- Current Price: $${p.ticker.lastPrice}
- Price Change (24h): ${p.ticker.priceChangePercent}%
- Technical Indicator Scores:
  * Composite Score: ${p.signal.compositeScore}
  * Market Regime: ${p.signal.regime ?? 'unknown'}`;
  }).join('\n\n');

  const prompt = `You are a professional cryptocurrency market intelligence agent. Analyze the following ${predictions.length} tokens and for EACH token provide a concise 1-sentence professional trading reasoning for the predicted trend direction (whether bullish, bearish, or neutral). Keep it professional and technical.

${tokenDetails}

You MUST return a valid JSON object with the following structure:
{
  "reasonings": [
    { "symbol": "BTCUSDT", "reasoning": "Strong momentum ..." },
    { "symbol": "ETHUSDT", "reasoning": "Weakening volume ..." }
  ]
}

Return ONLY the JSON object, no markdown, no code fences.`;

  // ── Route through local OpenAI-compatible provider ──────────────────────
  const baseUrl = process.env['RADAR__AI_BASE_URL'];
  const apiKey = process.env['RADAR__AI_API_KEY'];
  if (baseUrl && apiKey) {
    try {
      const { generateChat } = await import('./openai-compatible.js');
      const raw = await generateChat(
        [{ role: 'user', content: prompt }],
        { responseFormat: { type: 'json' } },
      );
      const result = parseBatchResponse(raw, symbols);
      log.info(`Batch reasoning via local LLM succeeded for ${symbols.length} tokens`);
      return result;
    } catch (err) {
      log.warn('Batch reasoning via local LLM failed — returning empty reasoning', { error: String(err) });
      return new Map(symbols.map(s => [s, ''] as [string, string]));
    }
  }

  // ── Vertex AI Gemini production path ────────────────────────────────────
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.K_SERVICE && !process.env.BIGQUERY_PROJECT_ID) {
    log.debug('No LLM credentials configured for batch reasoning. Returning empty reasoning.');
    return new Map(symbols.map(s => [s, ''] as [string, string]));
  }

  try {
    const vertexAI = new VertexAI({ project, location });
    const generativeModel = vertexAI.getGenerativeModel({
      model: 'gemini-3.1-pro',
    });
    const response = await generativeModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const responseText = response.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (responseText) {
      return parseBatchResponse(responseText, symbols);
    }
  } catch (err) {
    log.warn('Batch Gemini reasoning failed — returning empty reasoning', { error: String(err) });
  }

  return new Map(symbols.map(s => [s, ''] as [string, string]));
}

export async function generateGeminiReasoning(
  symbolOrPrompt: string,
  klines?: KlineRow[],
  ticker?: { lastPrice: number; priceChangePercent: number },
  signal?: { compositeScore: number; regime?: string | null }
): Promise<string> {
  // If klines/ticker/signal are provided, and AI provider env variables are set,
  // route through analyzeToken instead.
  const baseUrl = process.env['RADAR__AI_BASE_URL'];
  const apiKey = process.env['RADAR__AI_API_KEY'];
  if (klines && ticker && signal && baseUrl && apiKey) {
    try {
      const { analyzeToken } = await import('../core/llm-provider.js');
      const traceData = {
        last_price: ticker.lastPrice,
        price_change_pct: ticker.priceChangePercent,
        composite_score: signal.compositeScore,
        regime: signal.regime,
      };
      const result = await analyzeToken(symbolOrPrompt, traceData);
      return result.reasoning;
    } catch (err) {
      log.warn(`Fallback to legacy Vertex AI because analyzeToken failed for ${symbolOrPrompt}`, { error: String(err) });
    }
  }

  // Check if API key or project is configured
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.K_SERVICE && !process.env.BIGQUERY_PROJECT_ID) {
    log.debug('Google credentials/project not configured. Skipping Gemini reasoning.');
    return 'Gemini credentials not configured.';
  }

  try {
    const vertexAI = new VertexAI({ project, location });
    const generativeModel = vertexAI.getGenerativeModel({
      model: 'gemini-3.1-pro',
    });

    let prompt = '';
    if (!klines && !ticker && !signal) {
      // Single prompt argument (called from llm-provider)
      prompt = symbolOrPrompt;
    } else {
      // Legacy signature call
      const recentCloses = klines!.slice(0, 10).map(k => k.close).join(', ');
      prompt = `Analyze the current market state for ${symbolOrPrompt}.
Context details:
- Recent close prices (last 10 hours, newest first): [${recentCloses}]
- Current Price: $${ticker!.lastPrice}
- Price Change (24h): ${ticker!.priceChangePercent}%
- Technical Indicator Scores:
  * Composite Score: ${signal!.compositeScore}
  * Market Regime: ${signal!.regime ?? 'unknown'}

Provide a concise, 1-2 sentence professional trading reasoning for the predicted trend direction (whether bullish, bearish, or neutral). Keep it professional and technical.`;
    }

    const response = await generativeModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const responseText = response.response.candidates?.[0]?.content?.parts?.[0]?.text;
    return responseText?.trim() ?? 'No reasoning generated by Gemini.';
  } catch (err) {
    log.warn(`Gemini reasoning generation failed`, { error: String(err) });
    return `Gemini analysis failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
