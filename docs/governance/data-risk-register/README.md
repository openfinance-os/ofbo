# Data-risk & control register

The authoritative **data-governance spine** referenced by *both* harnesses — discovery
(gate **D6 — data-governance feasibility**, the `data-governance-reviewer` agent) and
delivery (`HG-0008`, `delivery-control-map.md`). It is a single regulation → risk →
control → residual-risk chain.

> **Solution-agnostic seam.** The *mechanism* is generic — "classify the data you touch,
> map it to the register, show residual risk is acceptable." The *content here is the OFBO
> instance* (UAE/CBUAE frameworks). Another solution mounts its own register behind the same
> JSON shape; nothing in the harness machinery hard-codes these IDs.

## Provenance

- **Source:** `source/DATA_REGULATION_V2_5_0.xlsx` (the uploaded register, archived verbatim).
- **Conversion:** `scripts/ingest-data-risk-register.py` (one-time, idempotent). Re-running
  reproduces the JSON byte-for-byte — determinism is a verification gate. The derived
  "embedding text" column is dropped on ingest (it is a pre-concatenation used by an external
  vector store and carries no information the harness needs).
- Runtime consumers read the **JSON only**, so CI stays pure-Node and dependency-free.

## Files

| File | Records | Shape (key fields) |
|---|---|---|
| `regulations.json` | 926 | clause-level rules: `regulation_abbreviation`, `clause_number`, `clause_text`, `in_scope_data_risk`, `risk_category_ids[]`, `risk_ids[]` |
| `risk-taxonomy.json` | 23 | `risk_category_id` (DR-d.c), `risk_domain_id`, `risk_domain_name`, `risk_category_name`, definition |
| `risk-statements.json` | 45 | `risk_id` (DR-d.c-NNN), `regulatory_drivers[]`, `inherent_rating`, `control_ids[]`, `residual_rating` |
| `controls.json` | 77 | `control_id` (CTRL-*), `control_type` (Preventive/Detective/Corrective), `control_owner` (line of defence), `risk_ids[]`, `automation_level`, `effectiveness_score` |
| `residual-risk.json` | 45 | per-risk inherent → control-effectiveness → residual computation |

## The frameworks (instance content)

| Abbrev | Framework | Clauses |
|---|---|---|
| CPS | Consumer Protection Standards (CBUAE) | 512 |
| MMS | Model Management Standards (CBUAE) | 262 |
| PDPL | Personal Data Protection Law (Federal Decree-Law 45/2021) | 62 |
| BCBS239 | Principles for Effective Risk Data Aggregation & Reporting | 56 |
| CPS-AI | Guidance Note on Consumer Protection & AI | 34 |

## The data-risk taxonomy (4 domains, 23 categories)

- **DR-1 Data Quality** — Accuracy, Completeness, Timeliness, Consistency, Validity, Uniqueness.
- **DR-2 Data Privacy, Protection & Security** — Consent Management, Data Subject Rights,
  Processing Controls, Cross-Border Transfer, Breach Management, Unauthorized Access, Data
  Leakage, Third-Party Data, Data Misuse & Manipulation.
- **DR-3 Data Disclosure & Transparency** — Completeness, Accuracy, Accessibility, Timeliness.
- **DR-4 Data Governance & Compliance** — Regulatory Compliance, Policy Adherence, Records
  Management, Accountability.

## How the harness uses it

- **Discovery (D6):** a problem statement's **Data governance** section must cite ≥1 `DR-*`
  category and ≥1 regulatory driver; every cited `DR-*`/`CTRL-*` id must resolve against
  these JSON files (referential integrity), and a residual-risk feasibility verdict must be
  present. The `data-governance-reviewer` additionally checks that cited controls actually
  cover the cited risks and flags inherent-High/Critical risks left without coverage.
- **Delivery:** `delivery-control-map.md` maps these controls onto the delivery hard-stops
  that already enforce them (PII redaction, INSERT-only audit, BCBS 239 lineage gate,
  residency), so the delivery harness is *evidence* for the register rather than a duplicate.
