import { loadConfig } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'llm-provider' });

export interface LLMTraceData {
  last_price?: number | null;
  price_change_pct?: number | null;
  volume?: number | null;
  regime?: string | null;
  composite_score?: number | null;
  rsi?: number | null;
  macd_histogram?: number | null;
  bb_width?: number | null;
  atr_pct?: number | null;
  adx?: number | null;
  direction?: string | null;
}

export interface LLMAnalysisResult {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  reasoning: string;
  raw: string;
}

export async function analyzeToken(symbol: string, traceData: LLMTraceData): Promise<LLMAnalysisResult> {
  const config = loadConfig();
  log.debug('Executing analyzeToken', { symbol, dataDir: config.dataDir });
  const prompt = `You are a professional cryptocurrency market intelligence agent.
Analyze the following market trace data for token ${symbol} and provide a direction prediction (BULLISH, BEARISH, or NEUTRAL), a confidence score between 0.0 and 1.0, and your detailed reasoning.

Trace Data:
- Symbol: ${symbol}
- Last Price: $${traceData.last_price}
- Price Change (24h): ${traceData.price_change_pct}%
- Volume (24h): $${traceData.volume}
- Regime: ${traceData.regime}
- Composite Score: ${traceData.composite_score}
- Technical Indicators:
  * RSI (14): ${traceData.rsi ?? 'N/A'}
  * MACD Histogram: ${traceData.macd_histogram ?? 'N/A'}
  * Bollinger Band Width: ${traceData.bb_width ?? 'N/A'}
  * ATR %: ${traceData.atr_pct ?? 'N/A'}
  * ADX: ${traceData.adx ?? 'N/A'}
  * Direction: ${traceData.direction ?? 'N/A'}

You MUST return a JSON object with exactly the following keys:
{
  "direction": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": number (float between 0.0 and 1.0),
  "reasoning": "string explaining your decision"
}
Ensure the output is valid JSON and nothing else.`;

  const baseUrl = process.env['RADAR__AI_BASE_URL'];
  const modelName = process.env['RADAR__AI_MODEL'] || 'gpt-4o-mini';

  let rawResponse: string;

  const aiEnv = process.env['RADAR__AI_ENV'] || (baseUrl ? 'DEV' : 'PROD');

  if (aiEnv === 'DEV') {
    log.info('Using OpenAI-compatible provider (DEV) for analysis', { symbol, model: modelName });
    try {
      const { generateChat } = await import('../analysis/openai-compatible.js');
      rawResponse = await generateChat(
        [{ role: 'user', content: prompt }],
        { responseFormat: { type: 'json' } }
      );
    } catch (err) {
      log.error('OpenAI-compatible analysis request failed', { symbol, error: String(err) });
      throw err;
    }
  } else {
    log.info('Using Vertex AI Gemini provider (PROD) for analysis', { symbol });
    try {
      const { generateGeminiReasoning } = await import('../analysis/gemini.js');
      rawResponse = await generateGeminiReasoning(prompt);
    } catch (err) {
      log.error('Vertex AI Gemini analysis request failed', { symbol, error: String(err) });
      throw err;
    }
  }

  try {
    const cleanJson = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (parsed.direction === 'BULLISH') direction = 'BULLISH';
    else if (parsed.direction === 'BEARISH') direction = 'BEARISH';

    const confidence = parseFloat(parsed.confidence) || 0.5;
    const reasoning = parsed.reasoning || '';

    return {
      direction,
      confidence: Math.max(0, Math.min(1, confidence)),
      reasoning,
      raw: rawResponse,
    };
  } catch (parseErr) {
    log.error('Failed to parse LLM response as JSON', { symbol, rawResponse, error: String(parseErr) });
    return {
      direction: 'NEUTRAL',
      confidence: 0.5,
      reasoning: 'Failed to parse LLM analysis response.',
      raw: rawResponse,
    };
  }
}
