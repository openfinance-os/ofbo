---
artifact: research-log
stage: discover
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
---

# Research log — consent-lifecycle-hygiene

> Discover (diverge). All signals synthetic — sourced from the Nebras simulator and seeded
> demo care queue. Zero real PII. Each signal is cited downstream.

## Stakeholders consulted

| Stakeholder (role, synthetic) | Scope of input | Date |
|---|---|---|
| Care team lead (P1 surface) | Where revoke handling stalls in the queue | 2026-06-10 |
| Consent operations analyst | Lifecycle state drift between LFI and the API Hub | 2026-06-11 |
| Compliance officer (data privacy) | PDPL withdrawal obligations and evidence needs | 2026-06-12 |

## Signals

| Signal id | Source | Observation | Type | Confidence |
|---|---|---|---|---|
| S-001 | sim TPP Reports `[synthetic]` | Revoke acknowledgement took 9.4s median across a 200-event sample, against the 5s default | pain | high |
| S-002 | care queue `[synthetic]` | Agents re-open revoke cases because the UI shows "active" after the PSU withdrew | pain | high |
| S-003 | sim Consent Manager `[synthetic]` | Lifecycle state drift: Hub reports `revoked`, LFI mirror still `authorised` for up to 14 min | pain | medium |
| S-004 | compliance interview `[synthetic]` | No single evidence view proves "withdrawal honoured within SLA" for an audit | need | high |
| S-005 | sim fault inject `[synthetic]` | Under injected consent-drift fault, no operator signal fires until a customer complains | constraint | medium |
| S-006 | prototype review `[synthetic]` | Consent ops analyst, shown the monitor, called the revoke tile "the number I chase today, blind" — H1 reaction | reaction | high |
| S-007 | prototype review `[synthetic]` | Care lead pointed at the amber drift window as "the thing to catch before the customer calls" — H2 reaction | reaction | high |
| S-008 | prototype review `[synthetic]` | Compliance officer asked "can I export this slice for an audit?" — H3 reaction, wants a dated evidence export | reaction | high |

## Evidence index

| File | Backs signal(s) | Notes |
|---|---|---|
| evidence/revoke-latency-sample.md | S-001 | Synthetic latency distribution export |
| evidence/state-drift-trace.md | S-003, S-005 | Synthetic lifecycle trace showing drift window |
