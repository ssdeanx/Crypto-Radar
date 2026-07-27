"""Tests for ml/online.py — online learning layer (river)."""

import json
import pickle
import sys
import argparse
from pathlib import Path
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from online import (
    OnlineModel,
    _get_river,
    _MODEL_VERSION,
    parse_args,
    main,
)


# ── Pickleable mock stand-ins for save/load tests ──────────────────────


class _PickleableScaler:
    """Simple pickleable stand-in for river's AdaptiveStandardScaler."""
    def learn_one(self, x): pass
    def transform_one(self, x): return x


class _PickleableLogReg:
    """Simple pickleable stand-in for river's LogisticRegression."""
    def learn_one(self, x, y): pass
    def predict_one(self, x): return 0
    def predict_proba_one(self, x): return {-1: 0.33, 0: 0.34, 1: 0.33}


class _PickleableAccuracy:
    """Simple pickleable stand-in for river's Accuracy metric."""
    def update(self, y_true, y_pred): pass
    def get(self): return 0.75


class _PickleableADWIN:
    """Simple pickleable stand-in for river's ADWIN drift detector."""
    def __init__(self):
        self.drift_detected = False
    def update(self, x): pass


# ── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def mock_river():
    """Return a fake river namespace with minimal mock objects for testing."""
    return {
        "preprocessing": MagicMock(),
        "linear_model": MagicMock(),
        "metrics": MagicMock(),
        "drift": MagicMock(),
    }


@pytest.fixture
def online_model(mocker, mock_river):
    """Create an OnlineModel with a fully mocked river backend."""
    mocker.patch("online._get_river", return_value=mock_river)
    # Wire up the scaler and model so they don't blow up
    mock_scaler = MagicMock()
    mock_scaler.learn_one.return_value = None
    mock_scaler.transform_one.return_value = {"feat1": 1.0}
    mock_river["preprocessing"].AdaptiveStandardScaler.return_value = mock_scaler

    mock_logreg = MagicMock()
    mock_river["linear_model"].LogisticRegression.return_value = mock_logreg

    mock_accuracy = MagicMock()
    mock_accuracy.get.return_value = 0.75
    mock_accuracy.update.return_value = None
    mock_river["metrics"].Accuracy.return_value = mock_accuracy

    mock_adwin = MagicMock()
    mock_adwin.drift_detected = False
    mock_adwin.update.return_value = None
    mock_river["drift"].ADWIN.return_value = mock_adwin

    return OnlineModel(seed=42)


# ── _get_river ──────────────────────────────────────────────────────────


class TestGetRiver:
    """Lazy river import behaviour."""

    def test_returns_dict_with_keys(self, mocker):
        """Successful import returns a dict with expected river subpackages."""
        mocker.patch.dict("sys.modules", {
            "river": MagicMock(),
            "river.drift": MagicMock(),
            "river.linear_model": MagicMock(),
            "river.metrics": MagicMock(),
            "river.preprocessing": MagicMock(),
        })
        # Clear the cached import and test
        mocker.patch("online._river", None)

        rv = _get_river()
        assert isinstance(rv, dict)
        for key in ("drift", "linear_model", "metrics", "preprocessing"):
            assert key in rv

    def test_import_error_raised(self, mocker):
        """When river is not installed, _get_river() raises ImportError."""
        mocker.patch("online._river", None)

        import builtins
        original_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "river" or name.startswith("river."):
                raise ImportError("river not available")
            return original_import(name, *args, **kwargs)

        mocker.patch("builtins.__import__", side_effect=fake_import)

        with pytest.raises(ImportError, match="river is not installed"):
            _get_river()


# ── OnlineModel.__init__ ────────────────────────────────────────────────


class TestOnlineModelInit:
    """OnlineModel constructor sets up river components correctly."""

    def test_sets_model_version(self, online_model):
        """__init__ records the current model version."""
        assert online_model._version == _MODEL_VERSION

    def test_initial_zero_updates(self, online_model):
        """Fresh model starts with zero training updates."""
        assert online_model._total_updates == 0

    def test_initial_class_counts(self, online_model):
        """Class counts start at zero for all three classes."""
        assert online_model._class_counts == {-1: 0, 0: 0, 1: 0}

    def test_initial_drift_events(self, online_model):
        """No concept drift events at initialisation."""
        assert online_model._concept_drift_events == 0

    def test_calls_get_river(self, mocker):
        """OnlineModel.__init__ calls _get_river() to obtain river components."""
        mock_rv = {
            "preprocessing": MagicMock(),
            "linear_model": MagicMock(),
            "metrics": MagicMock(),
            "drift": MagicMock(),
        }
        mock_fn = mocker.patch("online._get_river", return_value=mock_rv)
        OnlineModel(seed=42)
        mock_fn.assert_called_once()


# ── OnlineModel.partial_fit ─────────────────────────────────────────────


class TestOnlineModelPartialFit:
    """partial_fit() incrementally updates the model with labeled examples."""

    def test_updates_total_count(self, online_model):
        """Each partial_fit call increments _total_updates by 1."""
        online_model.partial_fit({"feat1": 0.5}, label=0)
        assert online_model._total_updates == 1
        online_model.partial_fit({"feat1": 0.8}, label=1)
        assert online_model._total_updates == 2

    def test_updates_class_counts(self, online_model):
        """Class count for the given label is incremented."""
        online_model.partial_fit({"feat1": 0.5}, label=0)
        assert online_model._class_counts[0] == 1

    def test_calls_scaler_learn_one(self, online_model):
        """partial_fit calls scaler.learn_one with features."""
        features = {"feat1": 0.5}
        online_model.partial_fit(features, label=0)
        online_model.scaler.learn_one.assert_called_with(features)

    def test_calls_scaler_transform_one(self, online_model):
        """partial_fit calls scaler.transform_one after learn_one."""
        features = {"feat1": 0.5}
        online_model.partial_fit(features, label=0)
        online_model.scaler.transform_one.assert_called_with(features)

    def test_calls_model_learn_one(self, online_model):
        """partial_fit passes transformed features and label to the logistic model."""
        features = {"feat1": 0.5}
        online_model.partial_fit(features, label=0)
        expected_X = online_model.scaler.transform_one.return_value
        online_model.model.learn_one.assert_called_with(expected_X, 0)

    def test_updates_accuracy_metric(self, online_model):
        """partial_fit updates the streaming accuracy metric with predicted vs true."""
        online_model.model.predict_one.return_value = 0
        online_model.partial_fit({"feat1": 0.5}, label=0)
        online_model.metric_accuracy.update.assert_called_with(0, 0)

    def test_no_accuracy_update_when_predict_none(self, online_model):
        """When predict_one returns None, metric is not updated."""
        online_model.model.predict_one.return_value = None
        online_model.partial_fit({"feat1": 0.5}, label=0)
        online_model.metric_accuracy.update.assert_not_called()

    def test_drift_detected_increments_counter(self, online_model):
        """When drift_detected is true after update, _concept_drift_events increments."""
        online_model._drift_detector.drift_detected = True
        online_model.partial_fit({"feat1": 0.5}, label=0)
        assert online_model._concept_drift_events == 1


# ── OnlineModel.predict_proba ───────────────────────────────────────────


class TestOnlineModelPredictProba:
    """predict_proba() returns probability dict over classes."""

    def test_returns_dict_with_all_classes(self, online_model):
        """Result has keys -1, 0, 1."""
        online_model.model.predict_proba_one.return_value = {-1: 0.1, 0: 0.7, 1: 0.2}
        result = online_model.predict_proba({"feat1": 0.5})
        assert set(result.keys()) == {-1, 0, 1}

    def test_returns_normalised_probabilities(self, online_model):
        """Probabilities from the model are returned as-is."""
        probs = {-1: 0.1, 0: 0.7, 1: 0.2}
        online_model.model.predict_proba_one.return_value = probs
        result = online_model.predict_proba({"feat1": 0.5})
        assert result == {-1: 0.1, 0: 0.7, 1: 0.2}

    def test_fallback_on_exception(self, online_model):
        """When predict_proba_one raises, return uniform distribution."""
        online_model.model.predict_proba_one.side_effect = ValueError("model not ready")
        result = online_model.predict_proba({"feat1": 0.5})
        assert result == {-1: 1.0 / 3, 0: 1.0 / 3, 1: 1.0 / 3}

    def test_missing_class_defaults_to_zero(self, online_model):
        """If model returns a sparse dict, missing keys default to 0.0."""
        online_model.model.predict_proba_one.return_value = {0: 0.8}
        result = online_model.predict_proba({"feat1": 0.5})
        assert result[-1] == 0.0
        assert result[0] == 0.8
        assert result[1] == 0.0


# ── OnlineModel.predict ─────────────────────────────────────────────────


class TestOnlineModelPredict:
    """predict() returns the predicted class label."""

    def test_returns_integer_label(self, online_model):
        """predict() returns the integer class label from model.predict_one."""
        online_model.model.predict_one.return_value = 1
        result = online_model.predict({"feat1": 0.5})
        assert result == 1

    def test_returns_none_when_unable(self, online_model):
        """If the model cannot predict, return None."""
        online_model.model.predict_one.return_value = None
        result = online_model.predict({"feat1": 0.5})
        assert result is None

    def test_calls_scaler_transform_one(self, online_model):
        """predict() transforms features through the scaler first."""
        features = {"feat1": 0.5}
        online_model.predict(features)
        online_model.scaler.transform_one.assert_called_with(features)


# ── OnlineModel.get_metrics ─────────────────────────────────────────────


class TestOnlineModelGetMetrics:
    """get_metrics() returns streaming performance metrics."""

    def test_returns_all_keys(self, online_model):
        """Result dict contains expected metric keys."""
        metrics = online_model.get_metrics()
        assert "total_updates" in metrics
        assert "class_distribution" in metrics
        assert "accuracy" in metrics
        assert "concept_drift_events" in metrics

    def test_reflects_training_state(self, online_model):
        """Metrics reflect the model's training history."""
        online_model._total_updates = 5
        online_model._class_counts = {-1: 2, 0: 2, 1: 1}
        online_model._concept_drift_events = 1
        online_model.metric_accuracy.get.return_value = 0.8

        metrics = online_model.get_metrics()
        assert metrics["total_updates"] == 5
        assert metrics["class_distribution"] == {-1: 2, 0: 2, 1: 1}
        assert metrics["accuracy"] == 0.8
        assert metrics["concept_drift_events"] == 1


# ── OnlineModel.save / load ─────────────────────────────────────────────


class TestOnlineModelSaveLoad:
    """save() and load() persist the model to disk via pickle."""

    def test_save_and_load_round_trip(self, mocker, tmp_path, mock_river):
        """A saved model can be loaded back with identical state."""
        # Build model using pickleable stand-ins so pickle works
        mock_river["preprocessing"].AdaptiveStandardScaler.return_value = _PickleableScaler()
        mock_river["linear_model"].LogisticRegression.return_value = _PickleableLogReg()
        mock_river["metrics"].Accuracy.return_value = _PickleableAccuracy()
        mock_river["drift"].ADWIN.return_value = _PickleableADWIN()
        mocker.patch("online._get_river", return_value=mock_river)

        model = OnlineModel(seed=42)
        model._total_updates = 42
        model._class_counts = {-1: 20, 0: 12, 1: 10}

        p = tmp_path / "model.pkl"
        model.save(str(p))
        assert p.exists()

        loaded = OnlineModel.load(str(p))
        assert loaded._total_updates == 42
        assert loaded._version == _MODEL_VERSION

    def test_save_uses_atomic_write(self, mocker, tmp_path, mock_river):
        """save() writes to a .tmp file first, then renames to the final path."""
        mock_river["preprocessing"].AdaptiveStandardScaler.return_value = _PickleableScaler()
        mock_river["linear_model"].LogisticRegression.return_value = _PickleableLogReg()
        mock_river["metrics"].Accuracy.return_value = _PickleableAccuracy()
        mock_river["drift"].ADWIN.return_value = _PickleableADWIN()
        mocker.patch("online._get_river", return_value=mock_river)

        model = OnlineModel(seed=42)
        p = tmp_path / "model.pkl"
        model.save(str(p))
        # No .tmp files should remain after successful save
        assert not (tmp_path / "model.pkl.tmp").exists()
        assert p.exists()

    def test_load_corrupt_file_raises(self, tmp_path):
        """Corrupt pickle raises UnpicklingError."""
        p = tmp_path / "bad.pkl"
        p.write_bytes(b"this is not a pickle")
        with pytest.raises(pickle.UnpicklingError):
            OnlineModel.load(str(p))

    def test_load_wrong_type_raises(self, tmp_path):
        """Loading a non-OnlineModel object raises TypeError."""
        p = tmp_path / "not_model.pkl"
        with open(p, "wb") as f:
            pickle.dump({"some": "dict"}, f)
        with pytest.raises(TypeError, match="Expected OnlineModel"):
            OnlineModel.load(str(p))

    def test_load_version_mismatch_raises(self, tmp_path, mocker, mock_river):
        """Loading a model with a different version raises ValueError."""
        mock_river["preprocessing"].AdaptiveStandardScaler.return_value = _PickleableScaler()
        mock_river["linear_model"].LogisticRegression.return_value = _PickleableLogReg()
        mock_river["metrics"].Accuracy.return_value = _PickleableAccuracy()
        mock_river["drift"].ADWIN.return_value = _PickleableADWIN()
        mocker.patch("online._get_river", return_value=mock_river)

        p = tmp_path / "old_version.pkl"
        model = OnlineModel()
        model._version = 0  # Simulate old version
        model.save(str(p))

        with pytest.raises(ValueError, match="version mismatch"):
            OnlineModel.load(str(p))

    def test_load_file_not_found_raises(self, tmp_path):
        """Loading a non-existent file raises FileNotFoundError."""
        with pytest.raises((FileNotFoundError, OSError)):
            OnlineModel.load(str(tmp_path / "no_file.pkl"))


# ── CLI parse_args ──────────────────────────────────────────────────────


class TestOnlineParseArgs:
    """CLI argument parsing for online.py."""

    def test_action_required(self):
        """--action is required."""
        with pytest.raises(SystemExit):
            parse_args([])

    def test_action_choices(self):
        """--action accepts valid choices."""
        for action in ("train", "predict", "metrics", "save", "load", "reset"):
            args = parse_args(["--action", action])
            assert args.action == action

    def test_features_optional(self):
        """--features is optional (default None)."""
        args = parse_args(["--action", "metrics"])
        assert args.features is None

    def test_label_optional(self):
        """--label is optional (default None)."""
        args = parse_args(["--action", "predict", "--features", '{"x":1}'])
        assert args.label is None

    def test_path_default(self):
        """--path defaults to DEFAULT_ONLINE_MODEL_PATH."""
        from online import DEFAULT_ONLINE_MODEL_PATH

        args = parse_args(["--action", "train", "--features", '{"x":1}', "--label", "0"])
        assert args.path == DEFAULT_ONLINE_MODEL_PATH

    def test_verbose(self):
        """--verbose sets verbose=True."""
        args = parse_args(["--action", "metrics", "--verbose"])
        assert args.verbose is True


# ── CLI main dispatch ───────────────────────────────────────────────────


class TestOnlineMain:
    """main() CLI dispatch with mocked OnlineModel."""

    def _make_args(self, action="metrics", **overrides):
        kwargs = dict(
            action=action,
            features=None,
            label=None,
            path="/tmp/test_model.pkl",
            verbose=False,
        )
        kwargs.update(overrides)
        return argparse.Namespace(**kwargs)

    def test_reset_deletes_model_file(self, mocker, tmp_path, capsys):
        """Reset action removes the model file."""
        p = tmp_path / "model.pkl"
        p.write_text("dummy")
        args = self._make_args(action="reset", path=str(p))
        main(args)
        assert not p.exists()
        captured = capsys.readouterr()
        result = json.loads(captured.out)
        assert result["status"] == "reset"

    def test_reset_no_model_file(self, mocker, tmp_path, capsys):
        """Reset when no model file exists prints a message."""
        p = tmp_path / "no_model.pkl"
        args = self._make_args(action="reset", path=str(p))
        main(args)
        captured = capsys.readouterr()
        result = json.loads(captured.out)
        assert result["message"] == "No model to delete"

    def test_train_without_features_exits(self, mocker, capsys):
        """Train action without --features exits with error."""
        args = self._make_args(action="train", features=None, label=0)
        with pytest.raises(SystemExit) as exc:
            main(args)
        assert exc.value.code == 1

    def test_train_calls_partial_fit_and_save(self, mocker, tmp_path, capsys):
        """Train action calls partial_fit and save on the model."""
        mock_model = MagicMock(spec=OnlineModel)
        mock_model._total_updates = 1
        mocker.patch("online.OnlineModel", return_value=mock_model)
        mocker.patch("online.OnlineModel.load", return_value=mock_model)

        p = tmp_path / "model.pkl"
        p.write_text("dummy")  # simulate existing model
        args = self._make_args(
            action="train", features='{"x":1}', label=0, path=str(p)
        )
        main(args)
        mock_model.partial_fit.assert_called_once_with({"x": 1}, 0)
        mock_model.save.assert_called_once_with(str(p))
        captured = capsys.readouterr()
        result = json.loads(captured.out)
        assert result["status"] == "trained"
