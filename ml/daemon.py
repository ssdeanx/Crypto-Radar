#!/usr/bin/env python3
"""
Hermes Crypto Radar — Persistent Python Worker Daemon

Preloads CatBoost and River models into RAM and exposes HTTP endpoints
for inference and online learning updates, eliminating process spawn overhead.

Endpoints:
- POST /predict
    Body: {"features": {...}} or {"rows": [{...}, {...}]}
- POST /fit
    Body: {"features": {...}, "label": 1}
- GET /metrics
- POST /save
"""

import argparse
import json
import logging
import sys
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np
from online import OnlineModel

# Import from local sibling modules
from predict import _load_norm_stats, load_model

logger = logging.getLogger(__name__)

class ModelManager:
    def __init__(self):
        self.catboost_model = None
        self.norm_stats = None
        self.feature_names = None
        self.classes = None
        self.class_to_idx = None
        self.online_model = None
        self.online_model_path = None

manager = ModelManager()

class DaemonHandler(BaseHTTPRequestHandler):
    def _send_response(self, code: int, data: dict | list):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_GET(self):
        if self.path == "/metrics":
            if manager.online_model:
                metrics = manager.online_model.get_metrics()
                self._send_response(200, metrics)
            else:
                self._send_response(400, {"error": "Online model not loaded"})
        else:
            self._send_response(404, {"error": "Not Found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            req = json.loads(body.decode("utf-8"))
        except Exception as e:
            self._send_response(400, {"error": f"Invalid JSON: {e}"})
            return

        if self.path == "/predict":
            self._handle_predict(req)
        elif self.path == "/fit":
            self._handle_fit(req)
        elif self.path == "/save":
            self._handle_save(req)
        else:
            self._send_response(404, {"error": "Not Found"})

    def _handle_predict(self, req):
        rows = req.get("rows")
        if rows is None:
            if "features" in req:
                rows = [req["features"]]
            else:
                self._send_response(400, {"error": "Expected 'rows' or 'features' in payload"})
                return

        if not manager.catboost_model:
            self._send_response(500, {"error": "CatBoost model not loaded"})
            return

        # Use explicitly provided feature names, or infer from first row
        feature_names = manager.feature_names
        if not feature_names and rows:
            feature_names = [k for k, v in rows[0].items() if isinstance(v, (int, float, bool))]

        if not feature_names:
            self._send_response(400, {"error": "No feature names available"})
            return

        # Build X array
        X = []
        for row in rows:
            x_row = []
            for col in feature_names:
                val = row.get(col)
                if val is None or val == "":
                    # use fill value
                    if manager.norm_stats and col in manager.norm_stats.get("featureNames", []):
                        med = float(manager.norm_stats.get("medians", {}).get(col, 0))
                        mu = float(manager.norm_stats.get("means", {}).get(col, 0))
                        sigma = float(manager.norm_stats.get("stds", {}).get(col, 1))
                        fill = (med - mu) / sigma if sigma != 0 else 0.0
                    else:
                        fill = 0.0
                    x_row.append(fill)
                else:
                    x_row.append(float(val))
            X.append(x_row)

        X = np.array(X, dtype=np.float64)

        try:
            predictions = manager.catboost_model.predict(X)
            probabilities = manager.catboost_model.predict_proba(X)
        except Exception as e:
            logger.error("Prediction failed: %s\\n%s", e, traceback.format_exc())
            self._send_response(500, {"error": f"Prediction failed: {e}"})
            return

        results = []
        for i in range(len(predictions)):
            pred_class = int(predictions[i])
            cls_idx = manager.class_to_idx.get(pred_class)
            confidence = float(probabilities[i][cls_idx]) if cls_idx is not None else 0.0

            probs_map = {
                int(cls): round(float(probabilities[i][j]), 4)
                for j, cls in enumerate(manager.classes)
            }
            ordered_probs = [probs_map.get(c, 0.0) for c in [-1, 0, 1]]

            res = {
                "direction": pred_class,
                "confidence": round(confidence, 4),
                "probs": ordered_probs,
            }

            # Mix in online model prediction if available
            if manager.online_model and i < len(rows):
                om_res = manager.online_model.predict_proba(rows[i])
                res["online_probs"] = om_res
                res["online_direction"] = manager.online_model.predict(rows[i])

            results.append(res)

        self._send_response(200, results)

    def _handle_fit(self, req):
        if not manager.online_model:
            self._send_response(400, {"error": "Online model not loaded"})
            return

        features = req.get("features")
        label = req.get("label")
        if features is None or label is None:
            self._send_response(400, {"error": "Expected 'features' and 'label'"})
            return

        try:
            manager.online_model.partial_fit(features, label)
            self._send_response(200, {"status": "trained", "total_updates": manager.online_model._total_updates})
        except Exception as e:
            logger.error("Online fit failed: %s\\n%s", e, traceback.format_exc())
            self._send_response(500, {"error": str(e)})

    def _handle_save(self, req):
        if not manager.online_model:
            self._send_response(400, {"error": "Online model not loaded"})
            return

        try:
            manager.online_model.save(str(manager.online_model_path))
            self._send_response(200, {"status": "saved", "path": str(manager.online_model_path)})
        except Exception as e:
            self._send_response(500, {"error": str(e)})


def parse_args():
    parser = argparse.ArgumentParser(description="Persistent Worker Daemon for ML Inference & Online Learning")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--model", required=True, help="Path to catboost model")
    parser.add_argument("--model-type", default="auto", choices=["auto", "catboost"], help="Model type")
    parser.add_argument("--norm-stats", default=None, help="Path to norm_stats JSON")
    parser.add_argument("--online-model", default="ml/models/online_model.joblib", help="Path to online model pickle")
    parser.add_argument("--features", default=None, help="Comma separated list of feature names")
    return parser.parse_args()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] daemon: %(message)s")
    args = parse_args()

    # Load CatBoost
    logger.info("Loading CatBoost model from %s", args.model)
    try:
        manager.catboost_model = load_model(args.model, args.model_type)
    except Exception as e:
        logger.error("Failed to load CatBoost model: %s", e)
        sys.exit(1)

    if manager.catboost_model.classes_ is None:
        logger.error("CatBoost model has no classes_")
        sys.exit(1)

    manager.classes = list(manager.catboost_model.classes_)
    manager.class_to_idx = {int(cls): idx for idx, cls in enumerate(manager.classes)}

    # Load norm stats
    manager.norm_stats = _load_norm_stats(args.norm_stats)

    if args.features:
        manager.feature_names = args.features.split(",")
    elif manager.norm_stats and "featureNames" in manager.norm_stats:
        manager.feature_names = manager.norm_stats["featureNames"]

    # Load OnlineModel
    manager.online_model_path = Path(args.online_model)
    if manager.online_model_path.exists():
        logger.info("Loading OnlineModel from %s", manager.online_model_path)
        try:
            manager.online_model = OnlineModel.load(str(manager.online_model_path))
        except Exception as e:
            logger.warning("Failed to load OnlineModel: %s. Creating new.", e)
            manager.online_model = OnlineModel(seed=42)
    else:
        logger.info("Creating new OnlineModel at %s", manager.online_model_path)
        manager.online_model = OnlineModel(seed=42)

    server = HTTPServer((args.host, args.port), DaemonHandler)
    logger.info("Starting daemon on http://%s:%d", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down daemon...")
        if manager.online_model:
            manager.online_model.save(str(manager.online_model_path))
        sys.exit(0)
