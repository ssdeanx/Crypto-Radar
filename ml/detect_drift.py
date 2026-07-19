#!/usr/bin/env python3
"""
Hermes Crypto Radar — Concept Drift Detection (river drift detectors)

Reads a JSON array of signal records from stdin, runs a river drift detector
(ADWIN by default, also PageHinkley / KSWIN) on the `confidence` values, and
writes a drift-status report to stdout.

Input (stdin):
    [{"symbol": "SOL", "confidence": 0.85, "open_time": 1712345678000}, ...]

Output (stdout):
    {
      "drift_detected": false,
      "warnings": [],
      "detector_stats": {
        "total_observations": 100,
        "current_width": 85.0,
        "total_detections": 0,
        "model": "ADWIN"
      }
    }

When drift is detected, `warnings` carries one entry per detection with the
observation index, the record's `open_time` (when present), and a message.

Exit codes:
    0 — always. Drift is data, not an error.
    1 — fatal error (bad JSON, missing confidence, river unavailable).
    2 — stdin read timeout (SIGALRM).

F3: Reads JSON array from stdin (not CSV) — each element must carry a numeric
    `confidence`. Optional `symbol` / `open_time` are echoed back in warnings
    for traceability.

F5: Missing or non-numeric `confidence` is a data error (exit 1), not silently
    coerced, because drift detection on garbage input is meaningless.
"""

import argparse
import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path

logger = logging.getLogger(__name__)


# ── Logging ──


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] detect_drift: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


# ── CLI ──


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Concept drift detection via river drift detectors"
    )
    parser.add_argument(
        "--model",
        default="ADWIN",
        choices=["ADWIN", "PageHinkley", "KSWIN"],
        help="Drift detector to use (default: ADWIN)",
    )
    parser.add_argument(
        "--delta",
        type=float,
        default=0.002,
        help="Significance value delta for ADWIN/KSWIN, or threshold for PageHinkley (default: 0.002)",
    )
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    return parser.parse_args(argv)


# ── Detector factory ──


def build_detector(model: str, delta: float):
    """Construct a river drift detector by name.

    Args:
        model: One of "ADWIN", "PageHinkley", "KSWIN" (case-insensitive).
        delta: Significance value passed to the detector where supported.

    Returns:
        A river DriftDetector instance with `.update(x)` and `.drift_detected`.

    Raises:
        ImportError: If river is not installed.
        ValueError: If the model name is unknown.
    """
    try:
        from river import drift
    except ImportError as e:  # pragma: no cover — environment guard
        raise ImportError(
            "river is not installed; run: npm run setup:ml"
        ) from e

    name = model.strip().lower()
    if name == "adwin":
        # clock=1 → check for change on every observation (lowest detection delay)
        return drift.ADWIN(delta=delta, clock=1)
    if name == "pagehinkley":
        # PageHinkley: delta = threshold, min_instances before detection
        return drift.PageHinkley(delta=delta, min_instances=30, threshold=50.0)
    if name == "kswin":
        # KSWIN: alpha is the significance level (analogous to delta)
        return drift.KSWIN(alpha=delta)
    raise ValueError(
        f"Unknown drift model: {model!r} (expected ADWIN, PageHinkley, KSWIN)"
    )


# ── Helpers ──


def _load_records() -> list[dict]:
    """Read and parse the JSON array from stdin. Raises on malformed input."""
    raw = sys.stdin.read()
    if not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON on stdin: {e}") from e
    if not isinstance(data, list):
        raise ValueError("Expected a JSON array of records on stdin")
    return data


def _extract_confidence(record: object, index: int) -> float:
    """Pull the confidence value from a single record, validating type."""
    if not isinstance(record, dict):
        raise ValueError(f"Record at index {index} is not an object")
    if "confidence" not in record:
        raise ValueError(f"Record at index {index} missing 'confidence' field")
    value = record["confidence"]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(
            f"Record at index {index} has non-numeric confidence: {value!r}"
        )
    return float(value)


# ── Main ──


def detect_drift(args: argparse.Namespace) -> None:
    setup_logging(args.verbose)

    # ── Build detector ──
    try:
        detector = build_detector(args.model, args.delta)
    except (ImportError, ValueError) as e:
        logger.error("Detector init failed: %s", e)
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    # ── Read stdin with timeout (prevent hang if pipe not closed) ──
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_load_records)
            records = future.result(timeout=60)
    except TimeoutError:
        logger.error("stdin read timed out after 60s")
        sys.exit(2)
    except ValueError as e:
        logger.error("Failed to read records: %s", e)
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    if not records:
        logger.info("No records received on stdin — reporting empty stats")
        print(
            json.dumps(
                {
                    "drift_detected": False,
                    "warnings": [],
                    "detector_stats": {
                        "total_observations": 0,
                        "current_width": 0.0,
                        "total_detections": 0,
                        "model": args.model,
                    },
                }
            )
        )
        return

    # ── Run detector over confidence values ──
    warnings: list[dict] = []
    total_observations = 0
    total_detections = 0

    for index, record in enumerate(records):
        try:
            confidence = _extract_confidence(record, index)
        except ValueError as e:
            logger.error("Bad record: %s", e)
            print(json.dumps({"error": str(e)}))
            sys.exit(1)

        detector.update(confidence)
        total_observations += 1

        if detector.drift_detected:
            total_detections += 1
            logger.warning(
                "Drift detected at index %d (confidence=%.4f, width=%.1f)",
                index,
                confidence,
                getattr(detector, "width", 0),
            )
            warning = {
                "index": index,
                "message": (
                    f"Concept drift detected at index {index}"
                    + (f" (symbol={record.get('symbol')})"
                       if record.get("symbol") is not None else "")
                    + f" — confidence={confidence:.4f}"
                ),
            }
            open_time = record.get("open_time")
            if open_time is not None:
                warning["open_time"] = open_time
            warnings.append(warning)
            # ADWIN auto-resets on the next update() call (drops the old window
            # and starts fresh), so detections are naturally independent. We
            # count them manually via total_detections since the internal
            # n_detections is reset alongside the window.

    # ── Build report ──
    report = {
        "drift_detected": len(warnings) > 0,
        "warnings": warnings,
        "detector_stats": {
            "total_observations": total_observations,
            "current_width": float(getattr(detector, "width", 0)),
            "total_detections": total_detections,
            "model": args.model,
        },
    }
    print(json.dumps(report))


if __name__ == "__main__":
    args = parse_args()
    detect_drift(args)
