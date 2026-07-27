#!/usr/bin/env python3
"""Tests for ml/daemon.py — persistent Python worker daemon.

All ML dependencies (CatBoost, river, OnlineModel) are mocked.
Tests exercise handler methods directly, not through a real HTTP server.
"""

import io
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import numpy as np
import pytest

# ── Path setup: ensure ml/ is on sys.path ──────────────────────────────────
_ML_DIR = Path(__file__).resolve().parent.parent
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(autouse=True)
def _reset_manager():
    """Reset the global ModelManager before each test to avoid cross-test contamination."""
    import daemon as daemon_mod
    daemon_mod.manager.catboost_model = None
    daemon_mod.manager.norm_stats = None
    daemon_mod.manager.feature_names = None
    daemon_mod.manager.classes = None
    daemon_mod.manager.class_to_idx = None
    daemon_mod.manager.online_model = None
    daemon_mod.manager.online_model_path = None
    yield


def _make_mock_catboost_model():
    """Build a MagicMock that acts like a CatBoost model for the daemon."""
    cb = MagicMock()
    cb.classes_ = np.array([-1, 0, 1])
    # Dynamic prediction: return predictions matching input rows
    cb.predict.side_effect = lambda X: np.array([1] * X.shape[0], dtype=int)
    cb.predict_proba.side_effect = lambda X: np.tile(
        [0.1, 0.2, 0.7], (X.shape[0], 1)
    )
    return cb


@pytest.fixture
def mock_manager():
    """Set up a fully-populated ModelManager on the daemon module."""
    import daemon as daemon_mod

    mgr = daemon_mod.manager
    mgr.catboost_model = _make_mock_catboost_model()
    mgr.classes = [-1, 0, 1]
    mgr.class_to_idx = {-1: 0, 0: 1, 1: 2}
    mgr.feature_names = ["rsi", "macd", "volume"]

    # Online model mock
    om = MagicMock()
    om.predict.return_value = 1
    om.predict_proba.return_value = {-1: 0.2, 0: 0.3, 1: 0.5}
    om.get_metrics.return_value = {"accuracy": 0.75, "total_updates": 100}
    om._total_updates = 100
    mgr.online_model = om
    mgr.online_model_path = Path("/tmp/online_model.joblib")

    yield mgr

    # Cleanup
    daemon_mod.manager.catboost_model = None
    daemon_mod.manager.feature_names = None
    daemon_mod.manager.classes = None
    daemon_mod.manager.class_to_idx = None
    daemon_mod.manager.online_model = None


# =============================================================================
# Helpers: create a DaemonHandler without starting an HTTP server
# =============================================================================

def _make_handler(path="/", method="GET", body=b"{}"):
    """Create a bare DaemonHandler instance without calling BaseHTTPRequestHandler.__init__."""
    import daemon as daemon_mod

    handler = daemon_mod.DaemonHandler.__new__(daemon_mod.DaemonHandler)
    handler.server_version = "BaseHTTP/0.6"
    handler.sys_version = "Python/3.x"
    handler.error_message_format = ""
    handler.error_content_type = "text/html"
    handler.protocol_version = "HTTP/1.0"

    # Mock low-level HTTP plumbing
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    # Response buffer
    handler.wfile = io.BytesIO()

    # Request path & method
    handler.path = path
    handler.command = method

    # Request body
    handler.headers = MagicMock()
    handler.headers.get.return_value = str(len(body))
    handler.rfile = io.BytesIO(body)

    return handler


def _read_response(handler) -> dict:
    """Decode the JSON written to handler.wfile."""
    handler.wfile.seek(0)
    raw = handler.wfile.read()
    return json.loads(raw.decode("utf-8"))


# =============================================================================
# _send_response
# =============================================================================

class TestSendResponse:
    """DaemonHandler._send_response writes correct response."""

    def test_writes_json_content_type(self):
        """_send_response sets Content-Type: application/json."""
        handler = _make_handler()
        handler._send_response(200, {"status": "ok"})

        handler.send_response.assert_called_once_with(200)
        handler.send_header.assert_called_once_with("Content-Type", "application/json")
        handler.end_headers.assert_called_once()

    def test_writes_data_dict(self):
        """_send_response writes JSON-encoded dict to wfile."""
        handler = _make_handler()
        handler._send_response(200, {"msg": "hello", "num": 42})

        data = _read_response(handler)
        assert data == {"msg": "hello", "num": 42}

    def test_writes_data_list(self):
        """_send_response writes JSON-encoded list to wfile."""
        handler = _make_handler()
        handler._send_response(200, [{"a": 1}, {"b": 2}])

        data = _read_response(handler)
        assert data == [{"a": 1}, {"b": 2}]


# =============================================================================
# GET /metrics
# =============================================================================

class TestGetMetrics:
    """GET /metrics endpoint."""

    def test_with_online_model_returns_metrics(self, mock_manager):
        """GET /metrics returns online model metrics when loaded."""
        handler = _make_handler(path="/metrics", method="GET")
        handler.do_GET()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(200)
        assert "accuracy" in data
        assert data["accuracy"] == 0.75
        assert data["total_updates"] == 100

    def test_without_online_model_returns_400(self):
        """GET /metrics returns 400 when online model not loaded."""
        import daemon
        daemon.manager.online_model = None

        handler = _make_handler(path="/metrics", method="GET")
        handler.do_GET()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(400)
        assert "error" in data

    def test_unknown_path_returns_404(self):
        """GET on unknown path returns 404."""
        handler = _make_handler(path="/unknown", method="GET")
        handler.do_GET()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(404)
        assert "Not Found" in data["error"]


# =============================================================================
# POST /predict
# =============================================================================

class TestPostPredict:
    """POST /predict endpoint."""

    def test_predict_with_features(self, mock_manager):
        """POST /predict with 'features' field returns one prediction."""
        body = json.dumps({"features": {"rsi": 70, "macd": 0.5, "volume": 1000}}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(200)
        assert isinstance(data, list)
        assert len(data) == 1
        result = data[0]
        assert "direction" in result
        assert "confidence" in result
        assert "probs" in result
        # Online model should also be mixed in
        assert "online_probs" in result
        assert "online_direction" in result

    def test_predict_with_rows(self, mock_manager):
        """POST /predict with 'rows' array returns multiple predictions."""
        rows = [
            {"rsi": 70, "macd": 0.5, "volume": 1000},
            {"rsi": 30, "macd": -0.3, "volume": 500},
        ]
        body = json.dumps({"rows": rows}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        assert isinstance(data, list)
        assert len(data) == 2

    def test_predict_no_features_returns_400(self, mock_manager):
        """POST /predict with neither 'rows' nor 'features' returns 400."""
        body = json.dumps({"foo": "bar"}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(400)
        assert "Expected" in data["error"]

    def test_predict_no_model_returns_500(self):
        """POST /predict returns 500 when CatBoost model not loaded."""
        import daemon
        daemon.manager.catboost_model = None

        body = json.dumps({"features": {"rsi": 70}}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(500)
        assert "model not loaded" in data["error"].lower()

    def test_predict_no_feature_names_returns_400(self, mock_manager):
        """POST /predict returns 400 when no feature names available and rows have no numeric keys."""
        import daemon
        daemon.manager.feature_names = None

        # Use a features dict with non-numeric values so the inference also fails
        body = json.dumps({"features": {"rsi": "non_numeric", "macd": "also_bad"}}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(400)
        assert "feature names" in data["error"].lower()

    def test_predict_nan_fill_from_norm_stats(self, mock_manager):
        """Missing feature values are filled using norm_stats."""
        import daemon
        daemon.manager.norm_stats = {
            "featureNames": ["rsi", "macd"],
            "medians": {"rsi": 50, "macd": 0},
            "means": {"rsi": 40, "macd": 0.5},
            "stds": {"rsi": 10, "macd": 1},
        }
        daemon.manager.feature_names = ["rsi", "macd", "volume"]

        # 'volume' is missing from the input feature
        body = json.dumps({"features": {"rsi": 70, "macd": 0.5}}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(200)

    def test_predict_probs_ordered(self, mock_manager):
        """Predict probabilities are ordered as [-1, 0, 1]."""
        body = json.dumps({"features": {"rsi": 70, "macd": 0.5, "volume": 1000}}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        probs = data[0]["probs"]
        assert len(probs) == 3
        assert isinstance(probs, list)

    def test_predict_online_model_disabled(self, mock_manager):
        """Online probs/direction omitted when online_model is None."""
        import daemon
        daemon.manager.online_model = None

        body = json.dumps({"features": {"rsi": 70, "macd": 0.5, "volume": 1000}}).encode()
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        assert "online_probs" not in data[0]
        assert "online_direction" not in data[0]


# =============================================================================
# POST /fit
# =============================================================================

class TestPostFit:
    """POST /fit endpoint."""

    def test_fit_with_features_and_label(self, mock_manager):
        """POST /fit with features + label updates the online model."""
        body = json.dumps({
            "features": {"rsi": 70, "macd": 0.5, "volume": 1000},
            "label": 1,
        }).encode()
        handler = _make_handler(path="/fit", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(200)
        assert data["status"] == "trained"
        assert data["total_updates"] == 100
        mock_manager.online_model.partial_fit.assert_called_once_with(
            {"rsi": 70, "macd": 0.5, "volume": 1000}, 1
        )

    def test_fit_no_online_model_returns_400(self):
        """POST /fit returns 400 when online model not loaded."""
        import daemon
        daemon.manager.online_model = None

        body = json.dumps({"features": {"rsi": 70}, "label": 1}).encode()
        handler = _make_handler(path="/fit", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(400)
        assert "not loaded" in data["error"]

    def test_fit_missing_fields_returns_400(self, mock_manager):
        """POST /fit missing 'features' or 'label' returns 400."""
        body = json.dumps({"features": {"rsi": 70}}).encode()  # no label
        handler = _make_handler(path="/fit", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(400)
        assert "Expected" in data["error"]

    def test_fit_error_returns_500(self, mock_manager):
        """POST /fit when partial_fit raises returns 500."""
        mock_manager.online_model.partial_fit.side_effect = ValueError("bad data")

        body = json.dumps({
            "features": {"rsi": 70},
            "label": 1,
        }).encode()
        handler = _make_handler(path="/fit", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(500)
        assert "bad data" in data["error"]


# =============================================================================
# POST /save
# =============================================================================

class TestPostSave:
    """POST /save endpoint."""

    def test_save_triggers_save(self, mock_manager):
        """POST /save calls online_model.save with the right path."""
        body = json.dumps({}).encode()
        handler = _make_handler(path="/save", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(200)
        assert data["status"] == "saved"
        mock_manager.online_model.save.assert_called_once_with(
            str(mock_manager.online_model_path)
        )

    def test_save_no_online_model_returns_400(self):
        """POST /save returns 400 when online model not loaded."""
        import daemon
        daemon.manager.online_model = None

        body = json.dumps({}).encode()
        handler = _make_handler(path="/save", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(400)
        assert "not loaded" in data["error"]

    def test_save_error_returns_500(self, mock_manager):
        """POST /save when save raises returns 500."""
        mock_manager.online_model.save.side_effect = OSError("disk full")

        body = json.dumps({}).encode()
        handler = _make_handler(path="/save", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(500)
        assert "disk full" in data["error"]


# =============================================================================
# POST unknown path
# =============================================================================

class TestPostUnknown:
    """POST to unknown path returns 404."""

    def test_unknown_path_returns_404(self, mock_manager):
        """POST on unknown path returns 404."""
        body = json.dumps({"foo": "bar"}).encode()
        handler = _make_handler(path="/unknown", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(404)
        assert "Not Found" in data["error"]

    def test_invalid_json_returns_400(self, mock_manager):
        """POST with invalid JSON body returns 400."""
        body = b"not json"
        handler = _make_handler(path="/predict", method="POST", body=body)
        handler.do_POST()

        data = _read_response(handler)
        handler.send_response.assert_called_once_with(400)
        assert "Invalid JSON" in data["error"]
