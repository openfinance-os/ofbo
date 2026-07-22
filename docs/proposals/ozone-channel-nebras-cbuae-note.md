# A note for the scheme — a commercially-distributed operations layer for the mandated tail

### Nebras / CBUAE framing for the MiddleLeap × Ozone distribution partnership

*Companion to `ozone-si-distribution-proposal.md` and ADR 0026. This note explains, for the
operator and the regulator, why an operations layer distributed through Ozone's commercial channel
helps the mandate — and how its regulatory posture is handled.*

- **Status:** Discussion draft for a scheme conversation
- **Reconciles with:** ADR 0026 (accepted positioning; `nebras-vas-pitch.md`), ADR 0027 (the Ozone
  channel), the multi-tenant blueprint's regulatory operating model

---

## 1. The problem the scheme already owns

The mandate covers every licensed bank, insurer and broker — but the scheme's liability apparatus,
SLA clocks, and reporting cadences only work if participants can actually operate them. Across the
long tail, today, they cannot: revoke-acknowledgment SLAs are missed, disputes are malformed,
billing-query windows lapse, and the 16 login-only LFI reports go unread. Each failure lands on
the scheme as support load, certification delay, and systemic risk.

The scheme has solved this class of problem once already — **CAAP** — where the tail could not build
FAPI-grade authentication, so the capability was hosted centrally and extended segment by segment.
**Operations is the next capability the tail cannot build.** The only open question is the
distribution path.

## 2. Two compatible paths, one posture

ADR 0026 already contemplates a **console tier** (consent operations and care, participant-side
dispute management, mandatory reporting with integrity hashes, the STR/AML trail, the regulated
audit posture) distributed to participants — potentially white-labelled as an "Al Tareq Operations
Console" — and an **independent assurance tier** (reconciliation, fee verification, liability
monitoring, scheme-SLA observability) sold direct.

This note adds a second, compatible distribution path for the same console tier: **Ozone, as the
API Hub's technology provider, carrying the operations layer through its existing partner and
system-integrator channel.** The two paths are not in tension — the scheme may prefer to bundle the
console centrally on the CAAP model, while Ozone's channel reaches institutions and new entrants
that come to market through integrators. Either way, the regulatory posture below is the same.

## 3. Why this is good for the scheme

1. **Scheme health.** Tail participants become operationally competent in weeks — SLA compliance,
   dispute discipline, and reporting cadence rise across exactly the segment that drags them today.
2. **Lower support cost.** Well-formed disputes, self-served report ingestion, and SLA-instrumented
   participants generate fewer service-desk cases.
3. **Certification throughput.** Live proving needs functioning participants on both sides; an
   operationally-ready tail accelerates the activation calendar (R4+ Apr 2026, R5 Sep 2026, insurer
   onboarding 2026-Q3).
4. **It exists now.** A live, seeded, synthetic-only demo runs the whole story, and the product is
   multi-tenant by construction with near-zero marginal cost per participant.

## 4. The independence split — and why it protects the scheme

Reconciliation of participant records **against Nebras invoices**, liability-exposure monitoring,
and scheme-SLA measurement are deliberately **not** part of the console tier and are not distributed
by the scheme. An examiner would rightly object to the invoice-issuer operating the invoice-verifier.

Under the Ozone channel the same principle is preserved with one added nuance: Ozone **powers the
hub** but does **not** issue participant invoices (the scheme does). The assurance tier is therefore
distributed by Ozone but **operated independently by MiddleLeap under contract** — a documented
separation of duties that keeps the party auditing the platform distinct from the party providing
it. The boundary keeps the console tier clean for the scheme, and keeps the assurance tier credible
for the regulator: *the scheme gives you the console; only an independent party can audit the
scheme.*

## 5. The outsourcing posture (for a hosted operator)

Where the operations layer is hosted for a participant (rather than deployed on the participant's
own estate), the hosting operator takes on a defined, well-understood regulatory posture — and the
participant remains the licensed party throughout:

- **The participant stays the LFI/TPP on the scheme.** The operator runs the back office *on the
  participant's behalf* under an outsourcing agreement; it never becomes a licensed Open Finance
  participant, and consent and the FAPI plane remain the participant's.
- **The operator is a PDPL Processor.** For each participant-Controller, the operator is a Processor;
  PDPL Article 8 creates joint liability, activating third-party-processor controls.
- **CBUAE Outsourcing Regulation C 14/2021 governs the arrangement** as material outsourcing of a
  regulated activity: an onshore master system-of-record, no cross-border sharing without prior CBUAE
  approval and the customer's explicit consent, operator due diligence, audit and access rights for
  both the participant and CBUAE, a documented exit plan, and explicit treatment of concentration
  risk (many mandated institutions on one operator is itself a matter the regulator will probe).
- **Liability still attaches to the participant.** The scheme's liability schedule has no "operator"
  party; a hosted-platform failure crystallises against the specific participant. The arrangement
  therefore carries back-to-back allocation — operator SLOs that keep the participant inside the
  scheme SLAs, with indemnities where the operator is at fault.
- **The operator is itself audited.** SOC 2 Type II and ISO/IEC 27001 (Ozone already holds ISO/IEC
  27001), demonstrable C 14/2021 compliance, independent penetration testing, and documented
  continuity/exit posture.

These are not novel obligations — they are the standard shape of regulated outsourcing, and the
product's substrate (row-level tenant isolation, INSERT-only audit, BCBS 239 lineage, single P6
egress, consent-only-in-Hub, per-participant residency) is built to evidence them rather than assert
them.

## 6. Suggested next step

A short working session with the scheme on the outsourcing and independence posture, alongside a
45-minute demo (consent revoke → dispute → report → refund → scheme case, with a fault injected
live), and — if useful — a scoped pilot with 2–3 insurer or exchange-house participants on the 2026
onboarding calendar, the segment already on the activation calendar.

---

*All demo data is synthetic; institution names appear only in healthy, non-attributed states; no
PSU PII exists anywhere in the system. Time-sensitive regulatory dates are directional pending CBUAE
confirmation.*
