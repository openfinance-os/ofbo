# ADR 0003 — Call/transcript linkage on dispute cases (BACKOFFICE-64)

- Status: **Proposed** — awaiting human decision (new P1 port primitive + contract surface)
- Date: 2026-06-20
- Story: BACKOFFICE-64 — Call/transcript linkage on dispute cases (Priority: Should)
- Related: ADR 0001 (care-surface token minting — the P1 port that also fronts the
  contact-centre integration)

## Context

BACKOFFICE-64 (PRD §7) requires that a dispute case can link to the **contact-centre
recording** that originated it: *"`originating_call_id` links the contact-centre
recording via the bank's existing integration; same RBAC posture as the dispute; null
for non-voice channels."*

Half of this is already built and on the canon:

- **The identifier is captured + surfaced.** `originating_call_id` flows through
  dispute create → store → detail (`packages/db/src/dispute-store.ts`,
  `services/bff/src/disputes/service.ts`), is **nullable** (null for non-voice), and is
  gated by `disputes:admin` (BACKOFFICE-20). The OpenAPI `DisputeCase` carries
  `originating_call_id` (`specs/backoffice-openapi.yaml`, marked *"BACKOFFICE-64,
  fast-follow"*).

What is **not** covered by the canon, and is a humans-decide decision (CLAUDE.md rule 6
— no new platform primitive without an ADR):

1. **Resolving** that `originating_call_id` to an actual recording/transcript. The
   contact centre is an **institution-specific system** → by PRD §3 it is a **port**,
   not a vendor baked into the core. P1 `CareSurfacePort` today exposes only
   `mintCareToken(...)`; resolving a recording needs a **new port method**.
2. **The surface** that exposes the link to the operator (a dedicated endpoint vs. an
   enriched field on the dispute detail) — a **contract** choice.

Non-negotiable constraints (hard stops) regardless of option:

- **Same RBAC as the dispute** (`disputes:admin`); no widening.
- **Zero PII / no recording content in the back office.** The back office *links* to a
  recording in the bank's system — it never copies, stores, or proxies the audio /
  transcript. The locator is a **short-lived reference/URL**, minted on demand.
- **High-class audit on access.** Viewing a PSU's call recording is audit-relevant —
  emit an `audit_high_sensitivity` event (agent `act` + PSU `sub`, PII redacted, trace
  propagated). This is the main reason to prefer per-access resolution over eager inline.
- **`null` for non-voice channels.**

## Options

1. **Dedicated, on-demand endpoint + new P1 method (recommended).**
   - New `CareSurfacePort.resolveCallRecording({ call_id }, trace) → { recording_ref, recording_url?, expires_at } | null`.
   - New contract path `GET /disputes/{dispute_id}/call-recording` (scope
     `disputes:admin`): looks up the dispute's `originating_call_id`, resolves via the
     port, emits one High-class `call_recording_accessed` audit, returns a short-lived
     `{ recording_ref, recording_url, expires_at }` (or `404`/null for non-voice / no
     linkage).
   - **Pros:** link minted **per access** so it is genuinely short-lived; **one audit
     per view** (clean accountability for who saw which PSU's recording); recording
     content never enters the back office; matches the ports model (sim adapter returns
     a deterministic fake link, enterprise adapter wired at M6 and must pass the same
     contract tests). **Cons:** a new contract endpoint + a new port method, both
     human-approved (spec-change first).

2. **Enrich the dispute detail response with a `call_recording` block.**
   - Same new P1 method, but resolve inline whenever the dispute is read and add a
     `call_recording` object to `DisputeCase`.
   - **Pros:** no extra endpoint. **Cons:** mints/refreshes a link on **every** dispute
     read even when nobody wants the recording; broadens the dispute payload; per-access
     audit is muddied (every dispute view becomes a recording access, or the audit no
     longer maps 1:1 to actually viewing a recording); link lifetime awkwardly coupled
     to dispute reads.

3. **Persist a `recording_url` on the dispute at creation. — REJECTED.**
   Couples the link lifetime to the dispute (short-lived links would rot), stores a
   recording locator in the back office (against "link, don't copy"), and provides no
   per-access audit. Documented here as an anti-pattern so it is not re-proposed.

## Recommendation (for the human to confirm)

**Option 1.** A dedicated `GET /disputes/{dispute_id}/call-recording` backed by a new
`CareSurfacePort.resolveCallRecording` port method. It keeps recording content in the
bank's system, mints a short-lived link **per access**, **audits each access**, reuses
the existing `disputes:admin` RBAC, and honours the ports model. It requires (1) a
**human-approved spec-change** adding the endpoint + the recording-link schema, then
(2) the new P1 method (sim + enterprise-stub adapters) and the BFF handler.

## Decision

_Pending._ Once chosen: if Option 1, open the spec-change PR (human-approved), then
implement BACKOFFICE-64 to it; if Option 2, record the surface decision here and adjust
the spec-change accordingly.

## Consequences

- BACKOFFICE-64 stays `blocked` on this ADR **and** the subsequent human-approved
  spec-change; it is a *Should*, so it waits without affecting M0–M5 completion.
- The contact-centre integration becomes the **second** capability behind P1
  `CareSurfacePort` (alongside `mintCareToken`) — two adapters (sim + enterprise),
  swapped at M6 against the same contract suite.
- Whatever surface is chosen MUST: enforce `disputes:admin`, emit a High-class audit on
  access (agent `act` + PSU `sub`, PII redacted, trace propagated), return only a
  short-lived reference/URL (never recording content), and yield null for non-voice
  channels — composing existing primitives (P1 port + audit), never a new approval or
  gateway primitive.
