# Model Card — Predictive Liability Forecast (BACKOFFICE-65)

**Model version:** `liability-forecast-v1.0.0`
**Owner:** Risk (OFBO)
**Status:** Regulated AI artefact (PRD §7). Decision-support only — never an automated control.
**Last updated:** 2026-06-19

## 1. Intended use

Give the Risk function a **24-hour-ahead probability that a Nebras liability threshold will
be crossed**, per `(issue × liable party)` class of the Limitation of Liability Model v2.1,
so mitigation can begin *before* the deterministic threshold monitor (BACKOFFICE-36) fires.

- **In scope:** advance warning + prioritisation on the Risk view; a `predictive_liability_forecast`
  Risk signal for high-probability classes.
- **Out of scope / prohibited:** the forecast NEVER initiates a liability payment, consent
  action, refund, or any four-eyes-gated operation. It does not replace the deterministic
  BACKOFFICE-36 monitor, which remains the authoritative control and the **fallback** whenever
  this model is uncertified.

## 2. Inputs & features

- **Telemetry:** ≥ 90 days of daily incident counts per liability class + party (LFI / TPP).
  **No PSU PII** — telemetry is keyed only by liability class and party; no PSU identifier,
  account, or amount attributable to an individual is used.
- **Features (surfaced per forecast for explainability):** `ewma_daily_rate`, `observed_days`,
  `recent_incidents_7d`.

## 3. Method (deterministic, explainable)

1. **EWMA rate** — exponentially-weighted mean of the daily incident series (α = 0.5,
   half-life ≈ 1 day) → a current per-day incident rate λ.
2. **Crossing probability** — Poisson `P(≥1 incident in 24h) = 1 − exp(−λ · 24/24)`.
3. **Expected accrual** — `λ · per-incident AED (v2.1 matrix)`, reported as integer minor
   units (fils) per the money convention.

No stochastic training, no learned weights, no RNG — the model is fully reproducible from its
inputs. This is a deliberate design choice for a regulated context: every output is auditable
and re-derivable.

## 4. Drift monitoring

A rolling **backtest** predicts each of the most recent days from the days before it and
compares to the actual count. The normalised mean-absolute error is surfaced as
`drift.{status, score, mean_abs_error, backtest_points}` on every view. `breach`
(score > 2 × tolerance, tolerance = 0.5) raises a `liability_forecast_drift` ITSM ticket and
recommends recertification.

## 5. Recertification

The model carries `trained_through` and `recertify_by = trained_through + 90 days`. Once the
evaluation time is past `recertify_by` the model is **uncertified**: `recertification_overdue`
and `fallback_active` are set, no predictive signals are emitted, a
`liability_forecast_recertification` ITSM ticket is raised, and the deterministic BACKOFFICE-36
threshold monitor is the sole authority until a human recertifies (bumping the model version).

## 6. Limitations

- Short half-life favours recent behaviour; sustained regime shifts surface as drift, not as an
  instant re-fit.
- Poisson independence assumption: correlated incident bursts may under-state tail probability —
  mitigated by the deterministic monitor backstop.
- Demo profile uses deterministic synthetic telemetry; an adopting bank wires its own telemetry
  source behind the `LiabilityTelemetrySource` port.

## 7. Governance

- Lineage: emitted forecast signals ride the `risk_signal` BCBS 239 lineage (Q4.5).
- Scope: surfaced only under `risk:read`; no new scope minted.
- Change control: a model change bumps `model_version` and updates this card in the same PR.
