-- BACKOFFICE-67: the missed-cadence monitor emits a Risk signal when a login-only
-- Nebras LFI report is overdue against its cadence. Spec PR #90 added
-- lfi_report_cadence_missed to the RiskSignal.signal_type enum; extend the risk_signal
-- CHECK constraint to admit it. Additive value only — existing rows unaffected.

ALTER TABLE risk_signal DROP CONSTRAINT IF EXISTS risk_signal_signal_type_check;
ALTER TABLE risk_signal ADD CONSTRAINT risk_signal_signal_type_check
  CHECK (signal_type IN ('consent_anomaly','tpp_behaviour','cop_mismatch_spike','nebras_liability_approach','agent_anomaly','predictive_liability_forecast','lfi_report_cadence_missed'));
