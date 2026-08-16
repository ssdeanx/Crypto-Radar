# Quantitative Math Engine Reference — Crypto-Radar

`src/math/` provides the institutional quantitative linear algebra and mathematical backbone of Crypto-Radar using MathJS and arbitrary-precision arithmetic.

---

## Architecture Overview

```bash
src/math/
├── markowitz.ts    # Modern Portfolio Theory (MPT) & Simplex Projection
├── spectral.ts     # Eigendecomposition & Principal Risk Factors
├── markov.ts       # Markov Regime Transition Matrices & Stationary Distributions
├── curve-fit.ts    # Polynomial S/R Curvature & Inflection Analysis
├── bignum.ts       # BigNumber Financial Precision & Arbitrage Valuation
├── risk.ts         # Fractional Kelly Criterion & Volatility ATR Sizing
├── portfolio.ts    # Covariance, Correlation & Risk Parity Weights
├── filtering.ts    # 1D Kalman Filtering, MAD Z-Scores & Hurst Exponent
├── eval.ts         # Calibration, Brier Score, Sharpe/Sortino/Calmar, MFE/MAE
└── index.ts        # Unified public exports
```

---

## 1. Markowitz Mean-Variance Optimization (`src/math/markowitz.ts`)

### Mathematical Formulation

Solves for the maximum Sharpe / tangency portfolio weights vector $w^* \in \mathbb{R}^N$:

$$w^* = \frac{\Sigma^{-1} (\mu - r_f \mathbf{1})}{\mathbf{1}^T \Sigma^{-1} (\mu - r_f \mathbf{1})}$$

Where:

- $\mu$: Vector of expected asset returns
- $\Sigma$: $N \times N$ regularized asset return covariance matrix
- $r_f$: Risk-free benchmark rate

### Long-Only Simplex Projection

Unconstrained quadratic optimization can produce negative weights (shorting). Crypto-Radar projects the raw weights onto the probability simplex ($\mathcal{S} = \{w \in \mathbb{R}^N \mid w_i \ge 0, \sum w_i = 1\}$) using the Duchi et al. (2008) $\mathcal{O}(N \log N)$ projection algorithm:

$$\Pi_{\mathcal{S}}(v) = \arg\min_{w \in \mathcal{S}} \frac{1}{2} \|w - v\|_2^2$$

### API Signature

```typescript
import { computeOptimalPortfolio, computeEfficientFrontier } from 'crypto-radar/math';

const res = computeOptimalPortfolio(expectedReturns, covMatrix, riskFreeRate);
// res.weights: number[]
// res.expectedReturn: number
// res.expectedVolatility: number
// res.sharpeRatio: number
// res.isEfficient: boolean
```

---

## 2. Spectral Eigendecomposition (`src/math/spectral.ts`)

### Principal Risk Factor Extraction

Uses `math.eigs(\Sigma)` to decompose multi-token covariance into orthogonal eigenvectors and eigenvalues:

$$\Sigma v_k = \lambda_k v_k$$

- **Factor 1 ($\lambda_1$)**: Market Beta / Systemic Crypto Movement ($\sim 60\text{--}80\%$ of variance).
- **Factor 2 ($\lambda_2$)**: Sector Rotation / Altcoin Momentum.
- **Factor 3 ($\lambda_3$)**: Residual Idiosyncratic Variance.

### Variance Explained Ratio

$$\text{Ratio}_k = \frac{\lambda_k}{\sum_{i=1}^N \lambda_i}$$

---

## 3. Markov Regime Switching Engine (`src/math/markov.ts`)

### 1st-Order Transition Matrix

Estimates the empirical transition probability matrix $\mathbf{P} \in \mathbb{R}^{3 \times 3}$ across states $\{\text{Bull}, \text{Bear}, \text{Chop}\}$ with Laplace smoothing $\alpha = 0.1$:

$$P_{ij} = \frac{N_{ij} + \alpha}{\sum_k (N_{ik} + \alpha)}$$

### Persistence & Expected Duration

$$\tau_i = \frac{1}{1 - P_{ii}} \quad (\text{bars})$$

### Ergodic Stationary Distribution

Solves $\pi \mathbf{P} = \pi$ subject to $\sum \pi_i = 1$ via MathJS matrix power iteration:

$$\pi = \lim_{k \to \infty} \pi_0 \mathbf{P}^k$$

---

## 4. Non-Linear Polynomial Curve Fitting (`src/math/curve-fit.ts`)

### Vandermonde Normal Equations

Fits dynamic price support and resistance curves $y = \sum_{j=0}^d w_j x^j$ by solving:

$$w = (X^T X + \lambda I)^{-1} X^T y$$

Where $X_{i,j} = x_i^j$ is the Vandermonde matrix.

### Curvature & Inflection Analysis

- 1st Derivative: $\frac{dy}{dx} = \sum_{j=1}^d j w_j x^{j-1}$ (instantaneous price momentum).
- 2nd Derivative: $\frac{d^2y}{dx^2} = \sum_{j=2}^d j(j-1) w_j x^{j-2}$ (acceleration & support/resistance inflection).

---

## 5. Arbitrary-Precision Financial Arithmetic (`src/math/bignum.ts`)

Prevents IEEE 754 floating-point rounding degradation during high-frequency compounding, fee stacking, and cyclic arbitrage valuation.

### Exact Multi-Period Compounding

$$C_{t} = C_{t-1} \times (1 + r_t) \times (1 - f_{\text{fee}}) \times (1 - s_{\text{slip}})$$

### Cyclic Multi-Hop Arbitrage Path

For a token hop cycle $A \to B \to C \to A$:

$$M_{\text{net}} = \prod_{k=1}^K R_k (1 - f_k)(1 - s_k)$$

If $M_{\text{net}} > 1.0$, the arbitrage path is mathematically profitable.
