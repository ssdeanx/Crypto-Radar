-- ═══════════════════════════════════════════════════════════════════════
-- Hermes Crypto Radar — prediction Accuracy & A/B Evaluation Queries
-- ═══════════════════════════════════════════════════════════════════════
--
-- These queries are run in BigQuery against the token_traces and
-- ticker_history tables to assess LLM prediction quality, win rates,
-- and perform prompt engineering A/B testing at scale.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. WIN RATE & RETURN BY PREDICTION DIRECTION ───────────────────────
-- Computes the overall accuracy (win rate) and mean return (PnL) for
-- BULLISH and BEARISH predictions where outcomes have been evaluated.
-- Bullish prediction wins if outcome price is higher; Bearish wins if lower.
SELECT
  prediction_direction,
  COUNT(*) as total_predictions,
  SUM(CASE
    WHEN prediction_direction = 'BULLISH' AND outcome_change_pct > 0 THEN 1
    WHEN prediction_direction = 'BEARISH' AND outcome_change_pct < 0 THEN 1
    ELSE 0
  END) as successful_predictions,
  ROUND(SUM(CASE
    WHEN prediction_direction = 'BULLISH' AND outcome_change_pct > 0 THEN 1
    WHEN prediction_direction = 'BEARISH' AND outcome_change_pct < 0 THEN 1
    ELSE 0
  END) / COUNT(*) * 100, 2) as win_rate_pct,
  ROUND(AVG(outcome_pnl_pct), 4) as avg_pnl_pct
FROM `project-513b86da-a04a-494a-8e9.crypto_radar.token_traces`
WHERE outcome_evaluated = 1
  AND prediction_direction IN ('BULLISH', 'BEARISH')
GROUP BY prediction_direction;


-- ── 2. CONFUSION MATRIX (PREDICTED vs ACTUAL) ──────────────────────────
-- Categorises predictions into True Positives (TP), False Positives (FP),
-- and checks accuracy across both classes.
SELECT
  prediction_direction as predicted,
  CASE
    WHEN outcome_change_pct > 1 THEN 'BULLISH'
    WHEN outcome_change_pct < -1 THEN 'BEARISH'
    ELSE 'NEUTRAL'
  END as actual,
  COUNT(*) as total_count,
  outcome_classification as classification
FROM `project-513b86da-a04a-494a-8e9.crypto_radar.token_traces`
WHERE outcome_evaluated = 1
GROUP BY predicted, actual, classification
ORDER BY predicted, total_count DESC;


-- ── 3. TIME-SERIES ACCURACY TREND (BY DAY) ─────────────────────────────
-- Monitors performance degradation or improvement over time by plotting
-- daily win rates.
SELECT
  DATE(observed_at) as observation_date,
  COUNT(*) as total_predictions,
  ROUND(SUM(CASE
    WHEN prediction_direction = 'BULLISH' AND outcome_change_pct > 0 THEN 1
    WHEN prediction_direction = 'BEARISH' AND outcome_change_pct < 0 THEN 1
    ELSE 0
  END) / COUNT(*) * 100, 2) as win_rate_pct,
  ROUND(AVG(outcome_pnl_pct), 4) as daily_avg_pnl_pct
FROM `project-513b86da-a04a-494a-8e9.crypto_radar.token_traces`
WHERE outcome_evaluated = 1
  AND prediction_direction IN ('BULLISH', 'BEARISH')
GROUP BY observation_date
ORDER BY observation_date ASC;


-- ── 4. PROMPT A/B TESTING USING ML.GENERATE_TEXT ────────────────────────
-- Uses BigQuery's ML.GENERATE_TEXT construct to evaluate two candidate
-- prompts (pointing to remote models) against the same 1,000 trace logs.
--
-- Prerequisites (Run once to link BigQuery to Vertex AI):
--   1. Create Cloud Connection: Connection ID `us.vertex_connection`
--   2. Grant connection Service Account "Vertex AI User" IAM role.
--   3. Create model v1:
--      CREATE OR REPLACE MODEL `crypto_radar.gemini_pro_v1`
--        OPTIONS(model_type='TENSORFLOW', remote_service_type='VERTEX_AI_GECO', ...);
--

-- Run candidate prompt V1 evaluation:
WITH ABTestSet AS (
  SELECT *
  FROM `project-513b86da-a04a-494a-8e9.crypto_radar.token_traces`
  ORDER BY observed_at DESC
  LIMIT 1000
),
ModelV1Output AS (
  SELECT
    trace_id,
    symbol,
    prediction_direction as old_prediction,
    outcome_change_pct,
    ml_generate_text_result
  FROM
    ML.GENERATE_TEXT(
      MODEL `project-513b86da-a04a-494a-8e9.crypto_radar.gemini_pro_v1`,
      (
        SELECT
          trace_id,
          symbol,
          CONCAT(
            'Analyze token ', symbol, '. Last price: $', last_price,
            ', 24h change: ', price_change_pct, '%, composite: ', composite_score, '. ',
            'Predict trend. Format: JSON with direction (BULLISH/BEARISH/NEUTRAL) and confidence.'
          ) AS prompt
        FROM ABTestSet
      ),
      STRUCT(
        0.0 AS temperature,
        100 AS max_output_tokens,
        TRUE AS flatten_json_output
      )
    )
),
ModelV2Output AS (
  SELECT
    trace_id,
    symbol,
    ml_generate_text_result
  FROM
    ML.GENERATE_TEXT(
      MODEL `project-513b86da-a04a-494a-8e9.crypto_radar.gemini_pro_v2`,
      (
        SELECT
          trace_id,
          symbol,
          CONCAT(
            'System: You are an expert quant trader. ',
            'Analyze ', symbol, '. Price: $', last_price, ', 24h return: ', price_change_pct,
            '%, momentum score: ', composite_score, '. Indicators: RSI=', rsi, ', Regime=', regime, '. ',
            'Determine market direction. Response format: JSON with direction and confidence.'
          ) AS prompt
        FROM ABTestSet
      ),
      STRUCT(
        0.0 AS temperature,
        100 AS max_output_tokens,
        TRUE AS flatten_json_output
      )
    )
)
SELECT
  v1.symbol,
  v1.outcome_change_pct,
  -- Extract direction from model outputs:
  JSON_VALUE(v1.ml_generate_text_result, '$.direction') as direction_v1,
  JSON_VALUE(v2.ml_generate_text_result, '$.direction') as direction_v2,
  -- Check accuracy of V1:
  CASE
    WHEN JSON_VALUE(v1.ml_generate_text_result, '$.direction') = 'BULLISH' AND v1.outcome_change_pct > 0 THEN 1
    WHEN JSON_VALUE(v1.ml_generate_text_result, '$.direction') = 'BEARISH' AND v1.outcome_change_pct < 0 THEN 1
    ELSE 0
  END as is_correct_v1,
  -- Check accuracy of V2:
  CASE
    WHEN JSON_VALUE(v2.ml_generate_text_result, '$.direction') = 'BULLISH' AND v1.outcome_change_pct > 0 THEN 1
    WHEN JSON_VALUE(v2.ml_generate_text_result, '$.direction') = 'BEARISH' AND v1.outcome_change_pct < 0 THEN 1
    ELSE 0
  END as is_correct_v2
FROM ModelV1Output v1
JOIN ModelV2Output v2 ON v1.trace_id = v2.trace_id;
