#!/usr/bin/env python3
"""
Crypto-Radar — Institutional Matplotlib Visuals Engine
Generates publication-quality dark-themed financial visuals, candlestick charts,
Markowitz efficient frontiers, correlation heatmaps, and equity curves.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")  # Non-interactive headless backend
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.patches import Rectangle
import numpy as np
import pandas as pd

# Institutional Dark Palette
PALETTE = {
    "bg_dark": "#0d1117",
    "bg_panel": "#161b22",
    "grid": "#21262d",
    "text_primary": "#c9d1d9",
    "text_muted": "#8b949e",
    "bull_green": "#26a69a",
    "bear_red": "#ef5350",
    "accent_blue": "#58a6ff",
    "accent_gold": "#d29922",
    "accent_purple": "#bc8cff",
    "accent_cyan": "#39c5cf",
}


def apply_dark_theme(fig: plt.Figure, axes: List[plt.Axes]) -> None:
    """Applies terminal dark theme aesthetics across figures and subplots."""
    fig.patch.set_facecolor(PALETTE["bg_dark"])
    for ax in axes:
        ax.set_facecolor(PALETTE["bg_panel"])
        ax.grid(True, linestyle="--", linewidth=0.5, color=PALETTE["grid"], alpha=0.7)
        ax.tick_params(colors=PALETTE["text_muted"], labelsize=9)
        for spine in ax.spines.values():
            spine.set_color(PALETTE["grid"])


def fig_to_bytes(fig: plt.Figure, fmt: str = "png", dpi: int = 150) -> bytes:
    """Encodes matplotlib figure to byte stream and closes figure."""
    buf = io.BytesIO()
    fig.savefig(buf, format=fmt, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def plot_candlestick_dashboard(
    symbol: str,
    klines: List[Dict[str, Any]],
    indicators: Optional[Dict[str, Any]] = None,
    fmt: str = "png",
) -> bytes:
    """
    Renders multi-panel candlestick dashboard:
    - Panel 1: Price Action + Candlesticks + Bollinger Bands + EMAs (12, 26, 50, 200)
    - Panel 2: Volume + Volume MA
    - Panel 3: MACD (MACD Line, Signal Line, Histogram)
    - Panel 4: RSI (14) with Overbought (70) and Oversold (30) bands
    """
    if not klines:
        raise ValueError("Cannot plot candlestick dashboard with empty klines")

    df = pd.DataFrame(klines)
    if "open_time" in df.columns:
        df["time"] = pd.to_datetime(df["open_time"], unit="ms")
    elif "openTime" in df.columns:
        df["time"] = pd.to_datetime(df["openTime"], unit="ms")
    else:
        df["time"] = pd.date_range(end=pd.Timestamp.now(), periods=len(df), freq="1h")

    for col in ["open", "high", "low", "close", "volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    fig = plt.figure(figsize=(14, 10))
    gs = gridspec.GridSpec(4, 1, height_ratios=[4, 1.2, 1.8, 1.5], hspace=0.15)
    ax_main = fig.add_subplot(gs[0])
    ax_vol = fig.add_subplot(gs[1], sharex=ax_main)
    ax_macd = fig.add_subplot(gs[2], sharex=ax_main)
    ax_rsi = fig.add_subplot(gs[3], sharex=ax_main)

    apply_dark_theme(fig, [ax_main, ax_vol, ax_macd, ax_rsi])

    # 1. Candlestick Plot
    x = np.arange(len(df))
    width = 0.6
    width2 = 0.1

    up = df[df["close"] >= df["open"]]
    down = df[df["close"] < df["open"]]

    # Up candles
    ax_main.bar(up.index, up["close"] - up["open"], width, bottom=up["open"], color=PALETTE["bull_green"], alpha=0.9)
    ax_main.bar(up.index, up["high"] - up["close"], width2, bottom=up["close"], color=PALETTE["bull_green"], alpha=0.9)
    ax_main.bar(up.index, up["low"] - up["open"], width2, bottom=up["open"], color=PALETTE["bull_green"], alpha=0.9)

    # Down candles
    ax_main.bar(down.index, down["open"] - down["close"], width, bottom=down["close"], color=PALETTE["bear_red"], alpha=0.9)
    ax_main.bar(down.index, down["high"] - down["open"], width2, bottom=down["open"], color=PALETTE["bear_red"], alpha=0.9)
    ax_main.bar(down.index, down["low"] - down["close"], width2, bottom=down["close"], color=PALETTE["bear_red"], alpha=0.9)

    # Moving averages
    if len(df) >= 12:
        df["ema12"] = df["close"].ewm(span=12, adjust=False).mean()
        ax_main.plot(df.index, df["ema12"], color=PALETTE["accent_cyan"], linewidth=1.1, label="EMA 12")
    if len(df) >= 26:
        df["ema26"] = df["close"].ewm(span=26, adjust=False).mean()
        ax_main.plot(df.index, df["ema26"], color=PALETTE["accent_gold"], linewidth=1.1, label="EMA 26")
    if len(df) >= 50:
        df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
        ax_main.plot(df.index, df["ema50"], color=PALETTE["accent_purple"], linewidth=1.2, label="EMA 50")

    # Bollinger Bands
    if len(df) >= 20:
        sma20 = df["close"].rolling(20).mean()
        std20 = df["close"].rolling(20).std()
        upper = sma20 + 2 * std20
        lower = sma20 - 2 * std20
        ax_main.plot(df.index, upper, color=PALETTE["text_muted"], linestyle=":", linewidth=0.9, label="BB Upper")
        ax_main.plot(df.index, lower, color=PALETTE["text_muted"], linestyle=":", linewidth=0.9, label="BB Lower")
        ax_main.fill_between(df.index, lower, upper, color=PALETTE["accent_blue"], alpha=0.05)

    last_price = df["close"].iloc[-1]
    chg = ((last_price - df["open"].iloc[0]) / df["open"].iloc[0]) * 100 if len(df) > 0 else 0.0
    color_chg = PALETTE["bull_green"] if chg >= 0 else PALETTE["bear_red"]
    ax_main.set_title(f"{symbol} / USDT  ·  ${last_price:,.2f} ({chg:+.2f}%)", color=PALETTE["text_primary"], fontsize=13, fontweight="bold", loc="left", pad=10)
    ax_main.legend(loc="upper left", framealpha=0.4, fontsize=8, labelcolor=PALETTE["text_primary"])
    ax_main.set_ylabel("Price (USDT)", color=PALETTE["text_primary"], fontsize=9)

    # 2. Volume Plot
    vol_colors = np.where(df["close"] >= df["open"], PALETTE["bull_green"], PALETTE["bear_red"])
    ax_vol.bar(df.index, df["volume"], width=0.6, color=vol_colors, alpha=0.65)
    if len(df) >= 20:
        vol_ma = df["volume"].rolling(20).mean()
        ax_vol.plot(df.index, vol_ma, color=PALETTE["accent_gold"], linewidth=1.0, label="Vol MA 20")
    ax_vol.set_ylabel("Volume", color=PALETTE["text_primary"], fontsize=9)

    # 3. MACD Plot
    if len(df) >= 26:
        ema12 = df["close"].ewm(span=12, adjust=False).mean()
        ema26 = df["close"].ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        signal = macd.ewm(span=9, adjust=False).mean()
        hist = macd - signal

        ax_macd.plot(df.index, macd, color=PALETTE["accent_blue"], linewidth=1.2, label="MACD")
        ax_macd.plot(df.index, signal, color=PALETTE["accent_gold"], linewidth=1.2, label="Signal")
        hist_colors = np.where(hist >= 0, PALETTE["bull_green"], PALETTE["bear_red"])
        ax_macd.bar(df.index, hist, width=0.6, color=hist_colors, alpha=0.75, label="Hist")
        ax_macd.axhline(0, color=PALETTE["grid"], linewidth=0.8)
    ax_macd.legend(loc="upper left", framealpha=0.4, fontsize=8, labelcolor=PALETTE["text_primary"])
    ax_macd.set_ylabel("MACD", color=PALETTE["text_primary"], fontsize=9)

    # 4. RSI Plot
    if len(df) >= 14:
        delta = df["close"].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.rolling(14).mean()
        avg_loss = loss.rolling(14).mean()
        rs = avg_gain / (avg_loss + 1e-9)
        rsi = 100 - (100 / (1 + rs))

        ax_rsi.plot(df.index, rsi, color=PALETTE["accent_purple"], linewidth=1.3, label="RSI 14")
        ax_rsi.axhline(70, color=PALETTE["bear_red"], linestyle="--", linewidth=0.8, alpha=0.7)
        ax_rsi.axhline(30, color=PALETTE["bull_green"], linestyle="--", linewidth=0.8, alpha=0.7)
        ax_rsi.fill_between(df.index, 30, 70, color=PALETTE["accent_purple"], alpha=0.06)
        ax_rsi.set_ylim(0, 100)
    ax_rsi.set_ylabel("RSI", color=PALETTE["text_primary"], fontsize=9)
    ax_rsi.legend(loc="upper left", framealpha=0.4, fontsize=8, labelcolor=PALETTE["text_primary"])

    # Format x-axis dates
    step = max(1, len(df) // 8)
    ticks = np.arange(0, len(df), step)
    labels = [df["time"].iloc[i].strftime("%m-%d %H:%M") for i in ticks]
    ax_rsi.set_xticks(ticks)
    ax_rsi.set_xticklabels(labels, rotation=30, ha="right")

    plt.setp(ax_main.get_xticklabels(), visible=False)
    plt.setp(ax_vol.get_xticklabels(), visible=False)
    plt.setp(ax_macd.get_xticklabels(), visible=False)

    return fig_to_bytes(fig, fmt=fmt)


def plot_efficient_frontier(
    expected_returns: List[float],
    cov_matrix: List[List[float]],
    optimal_weights: List[float],
    symbols: List[str],
    num_simulations: int = 1500,
    risk_free_rate: float = 0.0,
    fmt: str = "png",
) -> bytes:
    """
    Renders Markowitz Efficient Frontier visualization:
    - Monte Carlo simulated portfolio scatter with Sharpe coloring
    - Maximum Sharpe Tangency Portfolio marker
    - Minimum Variance Portfolio marker
    - Asset weight breakdown donut chart panel
    """
    mu = np.array(expected_returns)
    sigma = np.array(cov_matrix)
    n = len(symbols)

    # Monte Carlo simulation
    sim_returns = []
    sim_volatilities = []
    sim_sharpes = []

    np.random.seed(42)
    for _ in range(num_simulations):
        w = np.random.dirichlet(np.ones(n))
        port_ret = float(np.dot(w, mu))
        port_vol = float(np.sqrt(np.dot(w.T, np.dot(sigma, w))))
        sharpe = (port_ret - risk_free_rate) / (port_vol + 1e-9)
        sim_returns.append(port_ret)
        sim_volatilities.append(port_vol)
        sim_sharpes.append(sharpe)

    # Optimal portfolio point
    opt_w = np.array(optimal_weights)
    opt_ret = float(np.dot(opt_w, mu))
    opt_vol = float(np.sqrt(np.dot(opt_w.T, np.dot(sigma, opt_w))))
    opt_sharpe = (opt_ret - risk_free_rate) / (opt_vol + 1e-9)

    fig, (ax_front, ax_pie) = plt.subplots(1, 2, figsize=(14, 6), gridspec_kw={"width_ratios": [2, 1]})
    apply_dark_theme(fig, [ax_front, ax_pie])

    # Scatter plot
    scatter = ax_front.scatter(
        sim_volatilities,
        sim_returns,
        c=sim_sharpes,
        cmap="viridis",
        marker="o",
        s=15,
        alpha=0.7,
    )
    cbar = fig.colorbar(scatter, ax=ax_front)
    cbar.set_label("Sharpe Ratio", color=PALETTE["text_primary"])
    cbar.ax.yaxis.set_tick_params(color=PALETTE["text_muted"])
    plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color=PALETTE["text_muted"])

    # Mark optimal tangency portfolio
    ax_front.scatter(
        [opt_vol],
        [opt_ret],
        marker="*",
        color=PALETTE["accent_gold"],
        s=250,
        edgecolors="white",
        linewidth=1.5,
        label=f"Tangency Portfolio (Sharpe: {opt_sharpe:.2f})",
        zorder=5,
    )

    ax_front.set_title("Markowitz Mean-Variance Efficient Frontier", color=PALETTE["text_primary"], fontsize=12, fontweight="bold", loc="left")
    ax_front.set_xlabel("Expected Volatility (σ)", color=PALETTE["text_primary"])
    ax_front.set_ylabel("Expected Return (μ)", color=PALETTE["text_primary"])
    ax_front.legend(loc="upper left", framealpha=0.5, fontsize=9, labelcolor=PALETTE["text_primary"])

    # Donut chart of optimal weights
    colors = [PALETTE["accent_blue"], PALETTE["accent_cyan"], PALETTE["accent_gold"], PALETTE["accent_purple"], PALETTE["bull_green"], PALETTE["bear_red"]]
    wedges, texts, autotexts = ax_pie.pie(
        opt_w,
        labels=symbols,
        autopct="%1.1f%%",
        startangle=140,
        colors=colors[:n],
        textprops={"color": PALETTE["text_primary"]},
        wedgeprops=dict(width=0.45, edgecolor=PALETTE["bg_dark"]),
    )
    for autotext in autotexts:
        autotext.set_color("white")
        autotext.set_fontsize(8)

    ax_pie.set_title("Optimal Tangency Allocation", color=PALETTE["text_primary"], fontsize=11, fontweight="bold")

    return fig_to_bytes(fig, fmt=fmt)


def plot_correlation_heatmap(
    corr_matrix: List[List[float]],
    symbols: List[str],
    fmt: str = "png",
) -> bytes:
    """Renders cross-asset correlation matrix heatmap."""
    matrix = np.array(corr_matrix)
    n = len(symbols)

    fig, ax = plt.subplots(figsize=(8, 7))
    apply_dark_theme(fig, [ax])

    im = ax.imshow(matrix, cmap="coolwarm", vmin=-1.0, vmax=1.0)
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("Pearson Correlation", color=PALETTE["text_primary"])
    cbar.ax.yaxis.set_tick_params(color=PALETTE["text_muted"])
    plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color=PALETTE["text_muted"])

    ax.set_xticks(np.arange(n))
    ax.set_yticks(np.arange(n))
    ax.set_xticklabels(symbols, color=PALETTE["text_primary"], rotation=45, ha="right")
    ax.set_yticklabels(symbols, color=PALETTE["text_primary"])

    # Annotate values inside squares
    for i in range(n):
        for j in range(n):
            val = matrix[i, j]
            text_color = "black" if -0.3 < val < 0.3 else "white"
            ax.text(j, i, f"{val:.2f}", ha="center", va="center", color=text_color, fontsize=8, fontweight="bold")

    ax.set_title("Cross-Asset Return Correlation Heatmap", color=PALETTE["text_primary"], fontsize=12, fontweight="bold", pad=12)
    return fig_to_bytes(fig, fmt=fmt)


def plot_paper_trading_equity(
    trades: List[Dict[str, Any]],
    initial_balance: float = 100000.0,
    fmt: str = "png",
) -> bytes:
    """Renders paper trading cumulative equity curve with underwater drawdown chart."""
    if not trades:
        # Fallback flat curve
        equity = [initial_balance, initial_balance]
        timestamps = [pd.Timestamp.now() - pd.Timedelta(days=1), pd.Timestamp.now()]
    else:
        df_trades = pd.DataFrame(trades)
        if "created_at" in df_trades.columns:
            df_trades["time"] = pd.to_datetime(df_trades["created_at"], unit="ms")
        else:
            df_trades["time"] = pd.date_range(end=pd.Timestamp.now(), periods=len(df_trades), freq="1h")

        df_trades = df_trades.sort_values("time")
        pnl_series = df_trades.get("pnl", pd.Series([0.0] * len(df_trades))).fillna(0.0)
        cum_pnl = pnl_series.cumsum()
        equity = (initial_balance + cum_pnl).tolist()
        timestamps = df_trades["time"].tolist()

    eq_series = pd.Series(equity, index=timestamps)
    peak = eq_series.cummax()
    drawdown = (eq_series - peak) / peak * 100

    fig, (ax_eq, ax_dd) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, gridspec_kw={"height_ratios": [3, 1.2]})
    apply_dark_theme(fig, [ax_eq, ax_dd])

    # 1. Equity curve
    total_ret = ((eq_series.iloc[-1] - initial_balance) / initial_balance) * 100
    ret_color = PALETTE["bull_green"] if total_ret >= 0 else PALETTE["bear_red"]

    ax_eq.plot(eq_series.index, eq_series.values, color=PALETTE["accent_blue"], linewidth=1.8, label="Account Equity ($)")
    ax_eq.axhline(initial_balance, color=PALETTE["text_muted"], linestyle="--", linewidth=0.9, alpha=0.7, label="Initial Capital")
    ax_eq.set_title(f"Paper Trading Equity Growth  ·  Current: ${eq_series.iloc[-1]:,.2f} ({total_ret:+.2f}%)", color=PALETTE["text_primary"], fontsize=12, fontweight="bold", loc="left")
    ax_eq.set_ylabel("Portfolio Value ($)", color=PALETTE["text_primary"], fontsize=9)
    ax_eq.legend(loc="upper left", framealpha=0.4, fontsize=9, labelcolor=PALETTE["text_primary"])

    # 2. Drawdown
    ax_dd.plot(drawdown.index, drawdown.values, color=PALETTE["bear_red"], linewidth=1.2)
    ax_dd.fill_between(drawdown.index, drawdown.values, 0, color=PALETTE["bear_red"], alpha=0.25)
    ax_dd.set_ylabel("Drawdown %", color=PALETTE["text_primary"], fontsize=9)
    max_dd = float(drawdown.min())
    ax_dd.set_title(f"Underwater Drawdown (Max DD: {max_dd:.2f}%)", color=PALETTE["text_muted"], fontsize=9, loc="left")

    fig.autofmt_xdate()
    return fig_to_bytes(fig, fmt=fmt)


# ── CLI Interface ──

def main() -> None:
    parser = argparse.ArgumentParser(description="Crypto-Radar Matplotlib Visuals Engine")
    parser.add_argument("--type", choices=["candlestick", "frontier", "correlation", "equity"], required=True)
    parser.add_argument("--format", choices=["png", "svg"], default="png")
    parser.add_argument("--output", help="Optional output filepath to save image")
    parser.add_argument("--base64", action="store_true", help="Print base64-encoded string to stdout")
    args = parser.parse_args()

    # Read input payload from stdin
    input_data = json.load(sys.stdin) if not sys.stdin.isatty() else {}

    if args.type == "candlestick":
        symbol = input_data.get("symbol", "SOL")
        klines = input_data.get("klines", [])
        img_bytes = plot_candlestick_dashboard(symbol, klines, fmt=args.format)

    elif args.type == "frontier":
        mu = input_data.get("expectedReturns", [0.12, 0.18, 0.15])
        cov = input_data.get("covMatrix", [[0.04, 0.01, 0.02], [0.01, 0.06, 0.03], [0.02, 0.03, 0.05]])
        w = input_data.get("weights", [0.3, 0.4, 0.3])
        syms = input_data.get("symbols", ["BTC", "ETH", "SOL"])
        img_bytes = plot_efficient_frontier(mu, cov, w, syms, fmt=args.format)

    elif args.type == "correlation":
        matrix = input_data.get("matrix", [[1.0, 0.65, 0.72], [0.65, 1.0, 0.81], [0.72, 0.81, 1.0]])
        syms = input_data.get("symbols", ["BTC", "ETH", "SOL"])
        img_bytes = plot_correlation_heatmap(matrix, syms, fmt=args.format)

    elif args.type == "equity":
        trades = input_data.get("trades", [])
        bal = input_data.get("startBalance", 100000.0)
        img_bytes = plot_paper_trading_equity(trades, initial_balance=bal, fmt=args.format)

    else:
        raise ValueError(f"Unknown chart type: {args.type}")

    if args.output:
        with open(args.output, "wb") as f:
            f.write(img_bytes)
        print(f"Saved {args.type} chart to {args.output}")
    elif args.base64:
        b64 = base64.b64encode(img_bytes).decode("ascii")
        mime = "image/png" if args.format == "png" else "image/svg+xml"
        print(f"data:{mime};base64,{b64}")
    else:
        sys.stdout.buffer.write(img_bytes)


if __name__ == "__main__":
    main()
