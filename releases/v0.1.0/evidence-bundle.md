# Release evidence bundle — v0.1.0

- Commit: `0c6cb2011bace1b6e8087d6a6bc42097a994287c`
- Ref: `refs/tags/v0.1.0`
- Generated: 2026-08-22T08:34:41.455Z
- Schema: 1.0.0
- Integrity (sha256): `a6c36167d339e549448e832119b9067ed9ad3bfa4ec151beb194705adc3aee83`

## Quality gates

| Gate | Name | Status | Summary |
| --- | --- | --- | --- |
| Q1 | build + unit | pass |  |
| Q2 | static analysis + SAST | pass |  |
| Q3 | integration + contract tests | pass |  |
| Q4 | security review + dependency scan | pass |  |
| Q4.5 | BCBS 239 lineage validation (P7) | pass | 55 regulated tables covered, no gaps |
| Q5 | manual approval to production | manual | release published through the protected flow |

## Test results

| Suite | Total | Passed | Failed |
| --- | --- | --- | --- |
| unit | 1528 | 1528 | 0 |

## Scan outputs

| Tool | Status | Findings | Summary |
| --- | --- | --- | --- |
| eslint + tsc + semgrep | pass | 0 | Q2 outcome: pass |
| pnpm audit | pass | 0 | Q4 outcome: pass |

## BCBS 239 lineage proof (Q4.5)

- Covered tables: agent_registry, approval_request, audit_high_sensitivity, billing_accounting_batch, billing_benchmark_snapshot, billing_collection_action, billing_collection_invoice, billing_collection_memo_reconciliation, billing_event, billing_expected_memo, billing_expected_memo_line, billing_journal_dispatch, billing_journal_instruction, billing_journal_line, billing_memo_diff_line, billing_meter_run, billing_metered_line, billing_period_rerating, billing_rate_card_review, billing_rate_card_version, billing_record_set, billing_revenue_assurance_finding, billing_revenue_assurance_report, billing_revenue_recovery, billing_settlement_break, billing_settlement_line, billing_settlement_run, billing_source_snapshot, billing_tpp_cost_diff_line, billing_tpp_cost_document, billing_tpp_cost_document_line, billing_tpp_cost_reconciliation, billing_tpp_cost_rerating, billing_tpp_cost_statement, billing_tpp_cost_statement_line, compliance_report, dispute_case, fraud_incident, invoice_run, nebras_ingest_snapshot, nebras_report_aggregate, platform_certification, platform_outage, query_purpose_registry, reconciliation_break, reconciliation_log, reconciliation_threshold, respondent_dispute, risk_signal, scheme_notification, service_desk_case, str_draft, tenant_configuration, tpp_counterparty, trust_framework_participant
- Gaps: none

## Build provenance (agent attribution — EU AI Act Art. 12/17)

- Build agents: Claude, Claude Fable 5, Claude Opus 4.8, Claude Opus 4.8 (1M context), Claude Opus 5
- Commits in range: 200 (69 unattributed)

| Commit | Model | Story | Session |
| --- | --- | --- | --- |
| `0c6cb2011bac` | — | — | — |
| `fd45519cc7f4` | Claude | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `99dbaef0bdfa` | — | — | — |
| `f9b5856e0910` | Claude | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `5519e8890a4c` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `53d439eac3ee` | — | — | — |
| `f1e9bb808948` | Claude | — | https://claude.ai/code/session_019237AYg54RnaYVKwziM5Yv |
| `026f8f0ab792` | — | — | — |
| `466e745f5f0a` | Claude | — | https://claude.ai/code/session_019237AYg54RnaYVKwziM5Yv |
| `2c1ff41eceeb` | Claude | — | https://claude.ai/code/session_019237AYg54RnaYVKwziM5Yv |
| `e33d7dae9c33` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `276f87c3db61` | — | — | — |
| `9958abb0898f` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `26a6cdf297c3` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `8d139393e8a0` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `cfed1146ab3b` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `91fecc7b676b` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `7cec82b1a55c` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `d8ec576d4414` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `a003b673b606` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `ba858bfd1c5e` | — | — | — |
| `6f296d1893ce` | — | — | — |
| `2abe46bf5b10` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `f08701758e15` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `6341d1bf85cb` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `d433090e97e8` | — | — | — |
| `235c397b7f8c` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `b0ad0d9e90bd` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `f1e18d1a7b63` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `7df6144b214d` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `0a2bd8f3dbe2` | Claude | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `13eb9265499e` | — | — | — |
| `57fd55a5a112` | Claude Fable 5 | — | https://claude.ai/code/session_01SNU2pXr3C888pLpGEG4oUa |
| `9815ea415456` | — | — | — |
| `7bca79d11716` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `3f7f89ab683a` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `020aa6fdabc2` | — | — | — |
| `decaf81be921` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `c3e73edef99d` | — | — | — |
| `f5b32eb3c07d` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `89581ba3f705` | Claude | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `4bb786853319` | Claude | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `efb74aaac0e7` | — | — | — |
| `f076df4353a8` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `8f5d9e07c247` | Claude Fable 5 | — | https://claude.ai/code/session_01SNU2pXr3C888pLpGEG4oUa |
| `e1014357bfe2` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `c3a914fe62c3` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `47fff36796b3` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `7e35dd2ec422` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `4419d868880c` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `bd329ddc87b0` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `86693435e5b7` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `b27d46b30202` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `775eaa2b81a8` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `6e94b2a8aa61` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `2e1eb401a7c2` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `617e75d84827` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `6bbd40b430a4` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `36bd2fad4546` | — | — | — |
| `e6aecda32057` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `406bb36c7b93` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `1acf7660303e` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `6b4111edff74` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `1899785296b3` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `19eb2e14f541` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `8a15dddf14f6` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `ab192a1799ee` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `7f70892bab11` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `fc6528bc5b43` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `8df9cc00263b` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `af4693960303` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `9fb2db1dc02c` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `bad2946c6889` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `82956ded648d` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `e582b7a71f55` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `f37f323568d0` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `c578dbe7a102` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `1b7ca20e27cd` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `6f87bc6ed609` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `46468c903a43` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `eaf5059da306` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `994652c80dab` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `1367e2556ead` | Claude Opus 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `c5ba31b714a9` | — | — | — |
| `a5301b759ef7` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `804cfa2e45c7` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `ed4ebb14969e` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `87a1c8a6c26b` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `5e21269b309a` | — | — | — |
| `a8c7e9146b48` | Claude Fable 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `1ec10a24c51b` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `e47e7f9fc0f2` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `334ccc51f86d` | — | — | — |
| `1e9ebe953ada` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `d37c7916ce1e` | — | — | — |
| `2f1321266b17` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `0345cdbcc59e` | Claude Fable 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `a2c18b05f887` | — | — | — |
| `0f0a79a9fdcc` | Claude Fable 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `e1993e423532` | Claude Fable 5 | — | https://claude.ai/code/session_01GMQvtBjkGCQBZfYCyuNV9Z |
| `75110fdfd4b3` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `e0cc5e7119d9` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `22ebea5d63a1` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `f11c48dd7cfd` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `bcd49993f8b5` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `b77a6995164a` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `293a2a7b5125` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `dad6245746a1` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `dd06b0552b85` | — | — | — |
| `0119f6f6f0b0` | — | — | codex-billing-deploy-smoke-20260816 |
| `491f9a6e45d5` | — | — | — |
| `0b35047b9d66` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `56c45af2038d` | Claude Opus 5 | — | https://claude.ai/code/session_01YYVzNSoS9uGJZBQ5aZHa4o |
| `2f74d1d79405` | — | — | codex-billing-review-20260814 |
| `37a21cfc11b1` | — | — | — |
| `552055677483` | — | — | codex-billing-production-surface-20260813 |
| `d3667a448081` | — | — | codex-billing-production-surface-20260813 |
| `302c6dfac68c` | — | — | codex-billing-production-surface-20260813 |
| `f2814e147f49` | — | — | — |
| `b723b94aed72` | — | — | — |
| `9192c85daa45` | — | — | — |
| `0da25b6b178c` | — | — | codex-bill-09-10-20260813 |
| `7059e6e55300` | — | — | codex-bill-09-10-20260813 |
| `122f2b39a6ac` | — | — | — |
| `be9e2dadadb6` | Claude Fable 5 | — | https://claude.ai/code/session_01Dj34sLp53AqX6xMA1b6513 |
| `1336b414b255` | Claude Fable 5 | — | https://claude.ai/code/session_01Dj34sLp53AqX6xMA1b6513 |
| `e7b00c25e2da` | — | — | — |
| `fd94ae925d96` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `b01241ac6f62` | — | — | — |
| `d32c27d3f67a` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `9507af49e8d9` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `d6e968272804` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `0d34e3dbf0ae` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `6b541b91b029` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `77584d27ec3e` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `0ff8719d5517` | Claude Opus 5 | — | https://claude.ai/code/session_01V5iqJRJXY1JQN6DdZhpaaa |
| `afc84ce380c2` | — | — | — |
| `0208ec6b06be` | Claude Opus 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `ca79f7e742c7` | — | — | — |
| `6eebe759026a` | Claude Opus 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `b4e0a9020eb0` | — | — | — |
| `57f0df5dc095` | Claude Opus 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `a019d8681315` | — | — | — |
| `0589bd5814a1` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `79b07fa21657` | — | — | — |
| `34d4d30fb8bd` | — | — | — |
| `6a096875aff4` | — | — | — |
| `51fcea97b354` | — | — | — |
| `25cc83be26aa` | — | — | — |
| `fc02755bf675` | — | — | — |
| `66d9473fe07f` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `1626d62b95a5` | — | — | — |
| `dda17d681751` | — | — | — |
| `e578031e2ad7` | — | — | — |
| `b26a6622f1ba` | — | — | — |
| `3958e6f9785a` | — | — | — |
| `c03179cdb5ff` | — | — | — |
| `3d1b6d699ce0` | — | — | — |
| `dbad11963fea` | — | — | — |
| `c660c26211c4` | — | — | — |
| `22697fea0e62` | — | — | — |
| `a0162908f692` | — | — | — |
| `2c4d6491fac7` | — | — | — |
| `7e9109e064af` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `d658f768f54d` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `9e2281d27ed7` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `88958efbbea9` | Claude Fable 5 | M6 | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `0017d525a44c` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `70746968fbd5` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `30ffa76c30d2` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `87326afcf042` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `dffeb6951035` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `5cda5e6c62ee` | Claude Fable 5 | — | https://claude.ai/code/session_017mJ3Lppo74FAztQdQ4Fcjx |
| `36454c896291` | Claude Opus 5 | — | https://claude.ai/code/session_012StXpBZoxGpm7K9hi511pP |
| `641999581c5c` | — | — | — |
| `0dc3a07e35a2` | Claude Opus 5 | — | https://claude.ai/code/session_012StXpBZoxGpm7K9hi511pP |
| `dc7c3233b828` | — | — | — |
| `8d3e404079cf` | — | — | — |
| `29322ba0e66b` | Claude Opus 5 | — | https://claude.ai/code/session_012StXpBZoxGpm7K9hi511pP |
| `fd6b33c47997` | Claude Opus 5 | — | https://claude.ai/code/session_012StXpBZoxGpm7K9hi511pP |
| `1d3be253e19b` | Claude Opus 5 | — | https://claude.ai/code/session_012StXpBZoxGpm7K9hi511pP |
| `9555f001b8fa` | Claude Opus 5 | — | https://claude.ai/code/session_012StXpBZoxGpm7K9hi511pP |
| `e27609142ddc` | — | — | — |
| `e269f37f4c3f` | — | — | — |
| `418059aebba9` | — | — | — |
| `89104f8a05a4` | Claude Opus 4.8 | — | https://claude.ai/code/session_01HUA8vC914vctTEW9cfumJE |
| `aaf3dffb80a1` | Claude Opus 4.8 | — | https://claude.ai/code/session_01PoaV7FtU2sjG3XuKAjUjoB |
| `a3437f1f5b72` | Claude Opus 4.8 | — | https://claude.ai/code/session_01HUA8vC914vctTEW9cfumJE |
| `2e06084654d7` | — | — | — |
| `73311b699dc3` | Claude Opus 4.8 | — | https://claude.ai/code/session_01HUA8vC914vctTEW9cfumJE |
| `907e78b8a677` | Claude Fable 5 | — | https://claude.ai/code/session_016VDGead4LxroVzdyLgdSFj |
| `99ab0dd322dc` | — | — | — |
| `45fbba4ec649` | Claude Opus 4.8 (1M context) | — | — |
| `7e8ec5d04cb2` | — | — | — |
| `7dd485a31a86` | Claude Opus 4.8 (1M context) | — | — |
| `aeb1d7ab2fb6` | — | — | — |
| `8591281c8833` | Claude Opus 4.8 (1M context) | — | — |
| `47752a65fec7` | — | — | — |
| `2c44ef1c35a2` | Claude Opus 4.8 (1M context) | — | — |
| `e82d6a6c89ca` | — | — | — |

## Control mappings

| Control | Requirement | Gates | Evidence |
| --- | --- | --- | --- |
| Mandatory MFA sign-in via the enterprise IdP (no skip path) | BACKOFFICE-47 | Q1, Q3 | unit: services/bff/test/auth.spec; portal sign-in path |
| Persona scope-matrix enforcement (BFF + service layer), audited 403 | BACKOFFICE-43 | Q1, Q3 | unit: services/bff/test/rbac.spec; contract-stubs scope checks |
| High-class audit write path is INSERT-only with PII redaction at emission | BACKOFFICE-45/-50/-51 | Q3 | integration: packages/db/test/audit.int.spec, retention.int.spec |
| Four-eyes approval primitive (202 + approval_request, no inline execute) | BACKOFFICE-44 | Q1, Q3 | unit: services/bff/test/approvals.spec; contract conformance |
| Platform super-admin guardrails (auto-signal, justification, no service accounts) | BACKOFFICE-80 | Q1, Q3 | unit: services/bff/test/superadmin.spec; integration superadmin.int.spec |
| OTel emission with x-fapi-interaction-id propagated end to end | BACKOFFICE-48 | Q1 | unit: services/bff/test/telemetry.spec |
| BCBS 239 column-level lineage emitted at write time for every table | BACKOFFICE-49 | Q4.5 | lineage_proof section: validateLineageCoverage (covered/gaps) |
| Data-classification metadata on every regulated record | BACKOFFICE-54 | Q3 | integration: packages/db/test/classification.int.spec |
| UAE data residency — region is an IaC parameter, enforced | BACKOFFICE-55 | Q1 | unit: infra/terraform/test/skeleton.spec |
| OpenAPI contract is ground truth (no drift; generated artifacts current) | API conventions (CLAUDE.md) | Q1, Q3 | Q1 generated-artifact drift check; contract tests |
| Static analysis + SAST clean | CI/CD quality gates (CLAUDE.md) | Q2 | scan_outputs: eslint, tsc, semgrep |
| Dependency vulnerability scan | BACKOFFICE-56 (Q4) | Q4 | scan_outputs: dependency audit |
| Manual production approval (segregation of duties) | CI/CD Q5 (CLAUDE.md) | Q5 | release approval record (GitHub environment / release sign-off) |
| Agent build provenance — model/session/story attributed per change (EU AI Act Art. 12/17) | HARNESS-03 (HG-0003 traceability) | Q5 | provenance section: parseProvenance over the release commit range (git-trailer attribution) |
