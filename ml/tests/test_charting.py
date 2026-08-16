import pytest
import numpy as np
from charting import (
    plot_candlestick_dashboard,
    plot_efficient_frontier,
    plot_correlation_heatmap,
    plot_paper_trading_equity,
)


@pytest.fixture
def sample_klines():
    data = []
    base_price = 100.0
    for i in range(50):
        open_p = base_price + np.random.randn() * 2
        close_p = open_p + np.random.randn() * 2
        high_p = max(open_p, close_p) + abs(np.random.randn())
        low_p = min(open_p, close_p) - abs(np.random.randn())
        vol = 1000 + abs(np.random.randn()) * 500
        data.append({
            "openTime": 1723700000000 + i * 3600000,
            "open": open_p,
            "high": high_p,
            "low": low_p,
            "close": close_p,
            "volume": vol,
        })
        base_price = close_p
    return data


def test_plot_candlestick_dashboard(sample_klines):
    png_bytes = plot_candlestick_dashboard("SOL", sample_klines, fmt="png")
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 1000
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"


def test_plot_candlestick_empty_raises():
    with pytest.raises(ValueError, match="empty klines"):
        plot_candlestick_dashboard("SOL", [])


def test_plot_efficient_frontier():
    mu = [0.12, 0.18, 0.15]
    cov = [[0.04, 0.01, 0.02], [0.01, 0.06, 0.03], [0.02, 0.03, 0.05]]
    w = [0.3, 0.4, 0.3]
    symbols = ["BTC", "ETH", "SOL"]

    png_bytes = plot_efficient_frontier(mu, cov, w, symbols, num_simulations=100, fmt="png")
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 1000
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"


def test_plot_correlation_heatmap():
    matrix = [[1.0, 0.65, 0.72], [0.65, 1.0, 0.81], [0.72, 0.81, 1.0]]
    symbols = ["BTC", "ETH", "SOL"]

    png_bytes = plot_correlation_heatmap(matrix, symbols, fmt="png")
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 1000
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"


def test_plot_paper_trading_equity():
    trades = [
        {"created_at": 1723700000000, "pnl": 150.0},
        {"created_at": 1723703600000, "pnl": -50.0},
        {"created_at": 1723707200000, "pnl": 300.0},
    ]

    png_bytes = plot_paper_trading_equity(trades, initial_balance=10000.0, fmt="png")
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 1000
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"


def test_plot_paper_trading_equity_empty():
    png_bytes = plot_paper_trading_equity([], initial_balance=10000.0, fmt="png")
    assert isinstance(png_bytes, bytes)
    assert len(png_bytes) > 1000
