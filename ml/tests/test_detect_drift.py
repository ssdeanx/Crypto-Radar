"""Tests for ml/detect_drift.py — concept drift detection via river."""

import json
import sys
import argparse
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from detect_drift import (
    parse_args,
    build_detector,
    _load_records,
    _extract_confidence,
    detect_drift,
)


# ═══════════════════════════════════════════════════════════════════════════
#  parse_args
# ═══════════════════════════════════════════════════════════════════════════


class TestParseArgs:
    """CLI argument parsing for detect_drift.py."""

    def test_default_model_is_adwin(self):
        """--model defaults to 'ADWIN'."""
        args = parse_args([])
        assert args.model == "ADWIN"

    def test_model_choices(self):
        """--model accepts ADWIN, PageHinkley, KSWIN."""
        for mdl in ("ADWIN", "PageHinkley", "KSWIN"):
            args = parse_args(["--model", mdl])
            assert args.model == mdl

    def test_delta_default(self):
        """--delta defaults to 0.002."""
        args = parse_args([])
        assert args.delta == 0.002

    def test_verbose(self):
        """--verbose sets verbose=True."""
        args = parse_args(["--verbose"])
        assert args.verbose is True

    def test_custom_delta(self):
        """--delta is parsed as a float."""
        args = parse_args(["--model", "ADWIN", "--delta", "0.01"])
        assert args.delta == 0.01


# ═══════════════════════════════════════════════════════════════════════════
#  build_detector
# ═══════════════════════════════════════════════════════════════════════════


class TestBuildDetector:
    """build_detector() constructs a river drift detector by name."""

    def test_adwin_created(self, mocker):
        """build_detector('ADWIN', ...) creates drift.ADWIN."""
        mock_adwin = MagicMock()
        mocker.patch.dict(
            "sys.modules",
            {"river": MagicMock(), "river.drift": MagicMock()},
        )
        import river.drift as drift
        drift.ADWIN.return_value = mock_adwin

        detector = build_detector("ADWIN", delta=0.002)
        assert detector is mock_adwin
        drift.ADWIN.assert_called_once_with(delta=0.002, clock=1)

    def test_pagehinkley_created(self, mocker):
        """build_detector('PageHinkley', ...) creates drift.PageHinkley."""
        mock_ph = MagicMock()
        mocker.patch.dict(
            "sys.modules",
            {"river": MagicMock(), "river.drift": MagicMock()},
        )
        import river.drift as drift
        drift.PageHinkley.return_value = mock_ph

        detector = build_detector("PageHinkley", delta=0.05)
        assert detector is mock_ph
        drift.PageHinkley.assert_called_once_with(
            delta=0.05, min_instances=30, threshold=50.0
        )

    def test_kswin_created(self, mocker):
        """build_detector('KSWIN', ...) creates drift.KSWIN."""
        mock_kswin = MagicMock()
        mocker.patch.dict(
            "sys.modules",
            {"river": MagicMock(), "river.drift": MagicMock()},
        )
        import river.drift as drift
        drift.KSWIN.return_value = mock_kswin

        detector = build_detector("KSWIN", delta=0.01)
        assert detector is mock_kswin
        drift.KSWIN.assert_called_once_with(alpha=0.01)

    def test_case_insensitive(self, mocker):
        """Detector names are case-insensitive."""
        mocker.patch.dict(
            "sys.modules",
            {"river": MagicMock(), "river.drift": MagicMock()},
        )
        # Should not raise
        build_detector("adwin", delta=0.002)
        build_detector("pagehinkley", delta=0.05)
        build_detector("kswin", delta=0.01)

    def test_unknown_model_raises_valueerror(self, mocker):
        """An unknown model name raises ValueError."""
        mocker.patch.dict(
            "sys.modules",
            {"river": MagicMock(), "river.drift": MagicMock()},
        )
        with pytest.raises(ValueError, match="Unknown drift model"):
            build_detector("UnknownModel", delta=0.002)

    def test_import_error_raised(self, mocker):
        """If river is not installed, raise ImportError."""
        mocker.patch.dict("sys.modules", {})  # river not available
        # Need to make the import truly fail by patching __import__
        import builtins
        original_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "river" or name.startswith("river."):
                raise ImportError("No module named 'river'")
            return original_import(name, *args, **kwargs)

        mocker.patch("builtins.__import__", side_effect=fake_import)
        with pytest.raises(ImportError, match="river is not installed"):
            build_detector("ADWIN", delta=0.002)


# ═══════════════════════════════════════════════════════════════════════════
#  _load_records
# ═══════════════════════════════════════════════════════════════════════════


class TestLoadRecords:
    """_load_records() reads JSON array from stdin."""

    def test_valid_json_array(self, mocker):
        """Valid JSON array on stdin returns the parsed list."""
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = '[{"confidence": 0.8}, {"confidence": 0.9}]'
        result = _load_records()
        assert result == [{"confidence": 0.8}, {"confidence": 0.9}]

    def test_empty_stdin_returns_empty_list(self, mocker):
        """Empty stdin returns []."""
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = ""
        assert _load_records() == []

    def test_whitespace_only_returns_empty_list(self, mocker):
        """Whitespace-only stdin returns []."""
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = "   \n  \t  "
        assert _load_records() == []

    def test_invalid_json_raises_valueerror(self, mocker):
        """Malformed JSON raises ValueError."""
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = "not valid json"
        with pytest.raises(ValueError, match="Invalid JSON"):
            _load_records()

    def test_non_array_raises_valueerror(self, mocker):
        """JSON that is not an array raises ValueError."""
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = '{"confidence": 0.5}'
        with pytest.raises(ValueError, match="Expected a JSON array"):
            _load_records()


# ═══════════════════════════════════════════════════════════════════════════
#  _extract_confidence
# ═══════════════════════════════════════════════════════════════════════════


class TestExtractConfidence:
    """_extract_confidence() pulls and validates the confidence field."""

    def test_valid_confidence(self):
        """Numeric confidence values are returned as float."""
        assert _extract_confidence({"confidence": 0.85}, 0) == 0.85
        assert _extract_confidence({"confidence": 42}, 0) == 42.0

    def test_not_a_dict_raises(self):
        """Non-dict records raise ValueError."""
        with pytest.raises(ValueError, match="Record at index 0 is not an object"):
            _extract_confidence("not a dict", 0)

    def test_missing_confidence_raises(self):
        """Records without 'confidence' field raise ValueError."""
        with pytest.raises(ValueError, match="missing 'confidence'"):
            _extract_confidence({"something": "else"}, 0)

    def test_none_confidence_raises(self):
        """None confidence raises ValueError."""
        with pytest.raises(ValueError, match="non-numeric confidence"):
            _extract_confidence({"confidence": None}, 0)

    def test_string_confidence_raises(self):
        """String confidence raises ValueError."""
        with pytest.raises(ValueError, match="non-numeric confidence"):
            _extract_confidence({"confidence": "0.8"}, 0)

    def test_bool_confidence_raises(self):
        """Boolean confidence raises ValueError (bool is subclass of int)."""
        with pytest.raises(ValueError, match="non-numeric confidence"):
            _extract_confidence({"confidence": True}, 0)

    def test_reports_correct_index_in_error(self):
        """Error message includes the record index."""
        with pytest.raises(ValueError, match="index 5"):
            _extract_confidence("bad", 5)
        with pytest.raises(ValueError, match="index 3"):
            _extract_confidence({"confidence": "nope"}, 3)


# ═══════════════════════════════════════════════════════════════════════════
#  detect_drift  (main function)
# ═══════════════════════════════════════════════════════════════════════════


class TestDetectDrift:
    """detect_drift() — full flow with mocked detector and stdin."""

    # ── helpers ───────────────────────────────────────────────────────

    def _make_args(self, **overrides):
        kwargs = dict(model="ADWIN", delta=0.002, verbose=False)
        kwargs.update(overrides)
        return argparse.Namespace(**kwargs)

    def _build_mock_detector(self):
        """Return a mock river drift detector."""
        detector = MagicMock()
        detector.drift_detected = False
        detector.width = 85.0
        detector.update.return_value = None
        return detector

    # ── Empty input ───────────────────────────────────────────────────

    def test_empty_input_reports_no_drift(self, mocker, capsys):
        """Empty input gives drift_detected: False, total_observations: 0."""
        detector = self._build_mock_detector()
        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = ""

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert report["drift_detected"] is False
        assert report["detector_stats"]["total_observations"] == 0
        assert report["warnings"] == []

    def test_empty_input_reports_model_name(self, mocker, capsys):
        """The model name is reflected in the empty report."""
        detector = self._build_mock_detector()
        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = ""

        args = self._make_args(model="ADWIN")
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)
        assert report["detector_stats"]["model"] == "ADWIN"

    # ── Single record ─────────────────────────────────────────────────

    def test_single_record_no_drift(self, mocker, capsys):
        """Single record gives one observation and no drift warning."""
        detector = self._build_mock_detector()
        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = '[{"confidence": 0.85}]'

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert report["detector_stats"]["total_observations"] == 1
        assert report["drift_detected"] is False
        assert report["warnings"] == []

    # ── Stable confidence values ──────────────────────────────────────

    def test_stable_values_no_drift(self, mocker, capsys):
        """Multiple stable confidence values produce no drift."""
        detector = self._build_mock_detector()
        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = json.dumps(
            [{"confidence": 0.85}] * 10
        )

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert report["detector_stats"]["total_observations"] == 10
        assert report["drift_detected"] is False

    # ── Mock ADWIN triggers drift ─────────────────────────────────────

    def test_drift_detected_populates_warnings(self, mocker, capsys):
        """When the detector signals drift, warnings contain one entry per event."""
        detector = self._build_mock_detector()

        # Toggle drift_detected: first 2 records no drift, next 3 drift,
        # last 2 no drift
        drift_flags = [False, False, True, True, True, False, False]
        flag_iter = iter(drift_flags)

        def update_side_effect(value):
            try:
                detector.drift_detected = next(flag_iter)
            except StopIteration:
                detector.drift_detected = False

        detector.update.side_effect = update_side_effect

        mocker.patch("detect_drift.build_detector", return_value=detector)
        mocker.patch("detect_drift.sys.stdin")
        sys.stdin.read.return_value = json.dumps(
            [
                {"confidence": 0.85, "symbol": "SOL", "open_time": 1001},
                {"confidence": 0.84},
                {"confidence": 0.60, "symbol": "BTC"},
                {"confidence": 0.55},
                {"confidence": 0.50},
                {"confidence": 0.80},
                {"confidence": 0.82},
            ]
        )

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert report["drift_detected"] is True
        assert len(report["warnings"]) == 3  # three drift events
        assert report["detector_stats"]["total_observations"] == 7
        assert report["detector_stats"]["total_detections"] == 3

        # Verify warning structure
        for w in report["warnings"]:
            assert "index" in w
            assert "message" in w
            assert "Concept drift detected" in w["message"]

    def test_drift_warning_includes_open_time(self, mocker, capsys):
        """When the record has open_time, it's included in the warning."""
        detector = self._build_mock_detector()
        detector.drift_detected = False  # default

        def update_side_effect(value):
            detector.drift_detected = True  # trigger on every update

        detector.update.side_effect = update_side_effect

        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = json.dumps(
            [{"confidence": 0.85, "open_time": 1712345678000, "symbol": "SOL"}]
        )

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert report["warnings"][0]["open_time"] == 1712345678000

    def test_drift_warning_omits_open_time_when_absent(self, mocker, capsys):
        """When open_time is absent from the record, it's not in the warning."""
        detector = self._build_mock_detector()

        def update_side_effect(value):
            detector.drift_detected = True

        detector.update.side_effect = update_side_effect

        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = json.dumps(
            [{"confidence": 0.85}]  # no open_time
        )

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert "open_time" not in report["warnings"][0]

    def test_drift_warning_includes_symbol_in_message(self, mocker, capsys):
        """When the record has a symbol, it's mentioned in the warning message."""
        detector = self._build_mock_detector()

        def update_side_effect(value):
            detector.drift_detected = True

        detector.update.side_effect = update_side_effect

        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = json.dumps(
            [{"confidence": 0.85, "symbol": "ETH"}]
        )

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert "symbol=ETH" in report["warnings"][0]["message"]

    # ── Error paths ───────────────────────────────────────────────────

    def test_non_numeric_confidence_exits(self, mocker, capsys):
        """Non-numeric confidence causes exit code 1."""
        detector = self._build_mock_detector()
        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = json.dumps(
            [{"confidence": "not_a_number"}]
        )

        args = self._make_args()
        with pytest.raises(SystemExit) as exc:
            detect_drift(args)
        assert exc.value.code == 1
        captured = capsys.readouterr()
        err = json.loads(captured.out)
        assert "error" in err

    def test_bad_json_exits(self, mocker, capsys):
        """Malformed JSON input causes exit code 1."""
        detector = self._build_mock_detector()
        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = "not json at all"

        args = self._make_args()
        with pytest.raises(SystemExit) as exc:
            detect_drift(args)
        assert exc.value.code == 1
        captured = capsys.readouterr()
        err = json.loads(captured.out)
        assert "error" in err

    def test_detector_import_error_exits(self, mocker, capsys):
        """When build_detector raises ImportError, exit code 1."""
        mocker.patch(
            "detect_drift.build_detector",
            side_effect=ImportError("river is not installed; run: npm run setup:ml"),
        )
        # We still need stdin to return at least something to avoid double exit
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = ""

        args = self._make_args()
        with pytest.raises(SystemExit) as exc:
            detect_drift(args)
        assert exc.value.code == 1
        captured = capsys.readouterr()
        err = json.loads(captured.out)
        assert "error" in err

    def test_detector_value_error_exits(self, mocker, capsys):
        """When build_detector raises ValueError, exit code 1."""
        mocker.patch(
            "detect_drift.build_detector",
            side_effect=ValueError("Unknown drift model: 'FOO'"),
        )
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = ""

        args = self._make_args()
        with pytest.raises(SystemExit) as exc:
            detect_drift(args)
        assert exc.value.code == 1
        captured = capsys.readouterr()
        err = json.loads(captured.out)
        assert "error" in err

    def test_detector_stats_width(self, mocker, capsys):
        """The report includes the detector's width attribute."""
        detector = self._build_mock_detector()
        detector.width = 42.5
        mocker.patch("detect_drift.build_detector", return_value=detector)
        mock_stdin = mocker.patch("detect_drift.sys.stdin")
        mock_stdin.read.return_value = '[{"confidence": 0.85}]'

        args = self._make_args()
        detect_drift(args)
        captured = capsys.readouterr()
        report = json.loads(captured.out)

        assert report["detector_stats"]["current_width"] == 42.5
