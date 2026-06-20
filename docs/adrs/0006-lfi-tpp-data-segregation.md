# ADR 0006 — LFI ↔ TPP-of-record data segregation (dual-role Chinese wall)

- Status: **Proposed** — awaiting human decision (new cross-cutting control + role-domain taxonomy; likely a PRD addition)
- Date: 2026-06-20
- Related: PRD §2 persona scope matrix; BACKOFFICE-43 (RBAC), BACKOFFICE-54 (data classification), BACKOFFICE-45/-49 (audit + lineage); the OF-UAE dual-role gap analysis (2026-06-20)

## Context

OFBO is built for a bank operating **both** UAE Open Finance roles at once (PRD §1):

- **LFI** — the bank holds PSU accounts/data and serves inbound TPP traffic on it.
- **TPP-of-record** (deemed-license) — the bank acts as a third party consuming
  *other LFIs'* data/payments (TPP-as-a-Service).

CBUAE's deemed-license / conduct framework requires that the bank's **TPP function
must not enjoy privileged access to LFI-held data** beyond what any external TPP would
get through the normal consented Open Finance channels. The bank cannot use its
LFI position to feed its own TPP arm non-consented or preferential data. This is a
conduct/competition **and** data-protection control — a functional "Chinese wall"
between the two roles.

**Current state — the wall is not modeled.** OFBO's scope matrix (BACKOFFICE-43)
segregates by *operational function* (Customer Care ≠ Finance ≠ Risk ≠ Compliance ≠
Operations), and RLS isolates by *bank tenant* (`bank_id`). Neither encodes an
**LFI-role vs TPP-role** boundary. A back-office principal acting on the TPP side can,
through the back office, read LFI-held consent / transaction / PSU data (and vice
versa). Nothing represents, enforces, or audits the dual-role separation. This is the
single most important *dual-role-defining* control and it is absent — so "both LFI and
TPP" is, in the back office, currently a labelling distinction, not an enforced one.

Per CLAUDE.md rule 6 this is a **genuinely uncovered control** (no PRD requirement, a
new cross-cutting primitive), so it is a humans-decide ADR rather than build-loop work.

## Requirements & regulatory basis

- **Deemed-license / conduct (CBUAE).** The LFI must treat its own TPP arm at arm's
  length — no preferential or non-consented data access; consent and FAPI flows apply
  to the in-house TPP exactly as to an external one.
- **Data protection.** PSU data held in the LFI role must not reach the TPP function
  except via the same consented OF channel any TPP uses; an internal back-office
  shortcut around consent is a breach.
- **Audit defensibility.** The bank must be able to *demonstrate* the wall to CBUAE —
  who accessed which role-domain's data, attributable by role-domain, INSERT-only.
- **Liability/competition exposure.** Misuse maps to consumer-protection (AED 1,000)
  and conduct findings; the segregation is the control that bounds that exposure.

## Options

1. **Role-domain dimension on the scope matrix + RLS + audit (recommended).**
   - Add an explicit **`role_domain` (LFI | TPP | shared)** attribute to personas/scopes
     (extending the §2 matrix) and to data classification (BACKOFFICE-54), so every
     persona and every record/table is tagged with the role-domain that owns it.
   - **Enforce at both layers, mirroring BACKOFFICE-43:** the scope check gains a
     role-domain guard (a TPP-domain principal cannot invoke LFI-data reads/writes, and
     vice versa); RLS policies add a role-domain predicate on role-owned tables;
     `shared` data is readable by both.
   - **Audit the seam:** any permitted cross-domain access (only ever via an explicit,
     consented channel) emits a High-class `cross_domain_access` event.
   - **Pros:** composes existing primitives (scope matrix + RLS + classification +
     audit), no new gateway/auth path; demonstrable to CBUAE; aligns with the
     defence-in-depth posture already in place.
   - **Cons:** requires classifying every persona and data class by role-domain
     (incl. a deliberate `shared`/neutral set — e.g. scheme-level reference data,
     reconciliation aggregates); a meaningful cross-cutting change touching -43/-54/RLS.

2. **Physical / deployment separation** — separate BFF deployments, databases, and/or
   tenants per role-domain.
   - **Pros:** strongest possible wall.
   - **Cons:** heavy; duplicates infra and the bank-neutral single-back-office design;
     the control is fundamentally about *access*, not separate systems — likely
     over-engineering for the back office. Reserve only if the bank's conduct policy
     mandates physical isolation.

3. **Policy / process-only** — documented separation of duties, no technical control.
   - **Pros:** cheap. **Cons:** not enforced or demonstrable; CBUAE conduct review and
     pentest expect a *technical* control. **Rejected** as insufficient for a regulated
     wall (documented here so it is not re-proposed).

## Recommendation (for the human to confirm)

**Option 1.** A `role_domain` dimension threaded through the persona matrix, scope
enforcement (both layers), RLS, data classification, and audit. It makes the dual-role
wall an enforced, auditable control using primitives OFBO already has, without a new
gateway or auth path. It requires a bank decision on the **role-domain taxonomy** —
which personas are LFI vs TPP, and which data classes are LFI-owned / TPP-owned /
shared — which should be captured as a BD-style decision and, given its weight, a PRD
§2 amendment + a new BACKOFFICE requirement.

## Decision

_Pending._ Once chosen: if Option 1, (a) record the role-domain taxonomy (BD decision),
(b) amend PRD §2 + raise a BACKOFFICE requirement, (c) implement the role-domain guard
in the scope layer + RLS + classification + the `cross_domain_access` audit, tests-first.

## Consequences

- **Cross-cutting build** touching BACKOFFICE-43 (RBAC), BACKOFFICE-54 (classification),
  RLS migrations, and the audit event set — sequenced as substrate (E4-class), not a
  feature.
- **Bank decision required** on the taxonomy (LFI / TPP / shared) before build; some
  data is legitimately shared (scheme reference data, fee-reconciliation aggregates) and
  must not be over-walled.
- **Until decided/built, the dual-role posture relies on function-personas only** — a
  known, documented gap; the back office should not be represented to CBUAE as enforcing
  LFI/TPP separation until this lands.
- Composes existing primitives only (scope + RLS + classification + audit) — **no new
  approval mechanism, gateway, or auth path.**
