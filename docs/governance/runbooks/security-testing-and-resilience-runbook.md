# Security testing & operational resilience (cluster E)

What ships today is **two security-testing gate SLOTS** — **Q2** (static + SAST) and **Q4**
(security + dependencies / secrets) — and they are **role placeholders that ship empty**. The
bundle does not scan: it provides the seam where *your* scanner blocks merge, and it wires that
seam as a required check so the agent cannot route around it. Everything else in this runbook is
**adopter-side**. The Loom governs how software is *built*; it does not run the system, so it
cannot run a DAST scan against a live target, page an on-call engineer, fail a data centre over,
or commission an independent penetration test. Operational resilience is absent from the bundle
for a structural reason, not an oversight: **it is a run-the-bank domain a build-time frame was
never scoped to cover.** This is `../loom/references/bank-grade-gap.md` **cluster E**, where
*DAST · penetration testing*, *threat-model gate · secrets-history scan*, and *all of
operational resilience* are **Absent**, and *pre-egress DLP (HG-0011)* and *FAPI 2.0 / mTLS
conformance* are **Named-only**.

So read every "enforcement of record" line below as a control *you* must build on your platform.
Where the bundle helps, it helps in one of three bounded ways — a **gate that checks a
declaration** (a doc exists and is signed), a **seam** (a manifest the real tooling writes to),
or a **runbook** (this one). None of those is the control. A gate that checks whether a
threat-model file exists has not threat-modelled anything; and no such gate ships today. State
that honestly to your risk function; do not let a green check stand in for a control that isn't
wired.

> **Why a bundle cannot enforce this.** A plugin bundle cannot ship an inline egress proxy, an
> admission controller, a running staging target, a paging rotation, a rehearsed failover, or an
> independent red team — those are network infrastructure, live systems, people, and reporting
> lines the agent cannot reach. What the bundle gives you is two empty scanner seams (Q2/Q4) and
> a set of horizon triggers (`change-watch`). Nothing else below is enforced by the harness;
> where the runbook says "the gate checks X," it means the repo-side gate checks a *declaration*
> — the enforcement of record is the platform mechanism named alongside it. Cluster E is where
> the enforcement-of-record rule (`../loom/references/governance.md`) bites hardest.

## Where this sits

| | |
|---|---|
| **Bank-grade-gap cluster** | **E · Security & resilience breadth** (`../loom/references/bank-grade-gap.md`) |
| **HG decisions** | HG-0011 (onshore gateway · pre-egress DLP · attested sandbox), HG-0002 (immutable control plane · supply-chain integrity), HG-0005 (promotion + rehearsed rollback), HG-0010 (cease-use switch · accountable officer), HG-0012 (controlled build/eval runtime) |
| **Loom gate seams it fills** | **Q2** static + SAST, **Q4** security + dependencies / secrets (`../loom/references/delivery-harness.md`) — role placeholders, not scanners |
| **Loom agents it leans on** | `change-watch` (① Watch — CVE, cert expiry, cadence drift), `risk-reviewer` (② Assess) — `../loom/references/continuous-assurance.md` |
| **Adjacent runbooks** | `activation-runbook.md` (activate the control plane first), `data-protection-runbook.md` (real-data / DLP overlap), `identity-and-secrets-runbook.md` (scanner + egress identity, HG-0004), `independent-assurance-runbook.md` (pen-test independence, cluster C) |
| **Regulatory frames** | DORA, CBUAE operational-risk & business-continuity standards + Open Finance Regulation, Basel / BCBS operational-resilience principles, FAPI 2.0 / mTLS (Open Finance), ISO 27001, SOC 2 |

## What the bundle ships vs what you build

The honest ledger for cluster E. Keep it in front of your risk function so no green check is
mistaken for a wired control.

| Concern | The bundle ships (repo-side) | You build (the institution's, org-side) |
|---|---|---|
| SAST / SCA / current-tree secrets | Q2/Q4 gate **seams** (required checks that ship **empty**) | The scanners + failing thresholds behind them |
| Secrets **history** scan | — | Full-history scanner + forge push protection |
| Threat model (STRIDE) | — (a declaration gate is **proposed — does not ship today**) | The modelling, the review, and the gate itself |
| DAST | — | Pipeline stage + scheduled scan against a running target |
| Fuzzing | — | Fuzz harnesses + persisted corpus |
| Runtime / container | Supply-chain provenance seam (HG-0002) | Admission control + runtime detection in the cluster |
| IaC | — (a code-scan gate is the adopter's to add) | The IaC scan gate + live drift detection |
| Pen test / TLPT | Cadence tracking via `change-watch` | The **independent** engagement + remediation register |
| Pre-egress DLP (HG-0011) | The residency/gateway **declaration seam** only | The inline egress gateway the agent can't route around |
| FAPI 2.0 / mTLS | A pointer to the Standards pin (`open-finance-uae` skill) | Conformance suite + mTLS edge + cert monitoring |
| **All of operational resilience** | `change-watch` horizon items only | **Everything** — BCP/DR, RTO/RPO, chaos, SEV, on-call, SLOs, capacity, kill-switch, 3rd-party |

The single honest line, from cluster E: *security testing stops at two empty SAST/SCA seams, and
operational resilience is absent because the Loom governs the build, not the running system.*
This runbook is the "you build all of this" list; almost none of it is closable from inside the
plugin.

## Preconditions

- The delivery harness is active and Q2/Q4 are **required** status checks on `main`
  (`activation-runbook.md`). A security gate that isn't a *required* check is a suggestion.
- A protected CI where the security stages are control-plane files owned in CODEOWNERS
  (HG-0002, enforced by `control-plane-check.mjs`) — the build agent cannot edit or disable its
  own scanners.
- A deployed **staging** environment that mirrors production topology, for the controls that need
  a running target (DAST, FAPI conformance, chaos). The harness has none; this is yours.
- A named owner for security testing and for resilience in the **second line** (not the build
  team), and a named accountable officer (HG-0010).

---

# Part 1 — Security testing breadth (build-time and pre-prod)

The bundle stops at two empty SAST + SCA seams. The gap is DAST, threat modelling, secrets
*history*, fuzzing, runtime/container security, IaC drift, penetration testing, pre-egress DLP,
and — for Open Finance — FAPI/mTLS conformance. Some can be **wired as gates** (they run against
the repo or the pipeline); others are **scheduled assurance** or **independent engagements** no
gate can stand in for. Each step says which, and whether anything ships today.

## 1. Fill the Q2/Q4 seams with real scanners

The bundled gates are wiring with no scanner behind them. Wire real tools and set the failing
threshold as a merge condition — not advisory. Concrete role fills (SCA, SAST, container, IaC,
hardened images) are in `../loom/references/supply-chain-security.md`; the canon names roles, not
vendors.

| Seam | What to wire | Enforcement of record |
|---|---|---|
| **Q2 · static + SAST** | A real static analyser (e.g. Snyk Code, CodeQL, Semgrep) with a policy that fails on new high/critical | Required status check on `main`; ruleset owned in CODEOWNERS so the agent can't loosen it |
| **Q4 · dependencies (SCA)** | Dependency/vuln scanner (e.g. Snyk Open Source) with SLA-tiered severity gating | Required check; SBOM sealed into the evidence bundle (delivery step ⑧) |
| **Q4 · secrets (current tree)** | A secrets scanner on the working tree + forge **push protection** | Required check *and* forge-side push protection — the second survives a disabled CI |

**The decisive property:** the threshold config lives outside the agent's write scope. A scanner
the build agent can silence is not a control. This is the one row of this Part where the *gate*
already ships — it is empty until you fill it.

## 2. Secrets-history scanning (full git history)

Q4 scans the current tree. A key committed in 2024 and "removed" in a later commit is still in
history and still valid until rotated. Current-tree scanning misses it entirely.

- Run a **history-aware** scan (e.g. gitleaks/trufflehog with full depth) across all refs, not
  just `HEAD`, on a schedule and on any change to secret-shaped patterns.
- Any live finding triggers **rotation of the real credential first**, then history excision — in
  that order. Excising the commit does not un-leak the secret.
- **Enforcement of record:** forge-side **push protection** (blocks the commit at the seam nobody
  bypasses) + a scheduled full-history scan whose findings open a tracked incident. `change-watch`
  carries the scan cadence so a silently-disabled job surfaces as drift.
- **Absent in the bundle.** No history scanner ships; this is entirely yours.

## 3. Threat modelling (STRIDE) as a gate — proposed, does not ship today

A threat model is a design-time control DORA and ISO 27001 both expect for material change. The
honest limit: **a gate can require that a threat model exists and was reviewed; it cannot do the
threat modelling** — and no such gate ships in the bundle today.

1. Adopt STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service,
   Elevation of privilege) as the per-change decomposition, keyed to change risk tier — a new
   trust boundary, a new external interface, or a new data category mandates one.
2. The model is authored by humans (build + security), reviewed by the second line, and the
   mitigations become backlog items linked to the discovery trace (HG-0007).
3. **What the bundle *could* offer — a declaration gate that is not built:** a `threat-model-check`
   *(proposed — does not ship today)* would fail a release when a tier-triggering change ships
   without a signed, current threat-model artifact. That would be the STRIDE analogue of how the
   **shipped** `data-lifecycle-check.mjs` enforces *a disposition is declared* — a declaration
   check, never a proof the modelling happened. Until it is built, this control is 100%
   adopter-side.
4. **Enforcement of record:** a required declaration check (once you build it) + a second-line
   review sign-off recorded in the evidence bundle. The *quality* of the model is the reviewer's
   judgement, never the gate's.

## 4. DAST against a running target

SAST reads code; DAST attacks a deployed instance. There is no running system inside the harness,
so **this is 100% adopter infrastructure** — a pipeline stage and a scheduled scan against staging.

- Authenticated DAST (e.g. OWASP ZAP, Burp Suite Enterprise) against the deployed staging build
  as a **pre-prod pipeline stage**, plus a heavier scheduled scan against a stable env.
- Seed it with the API contract (OpenAPI) so it exercises real endpoints, auth, and error paths —
  not just an unauthenticated crawl.
- **Enforcement of record:** a pre-prod gate that blocks promotion on new high findings +
  scheduled assurance whose results feed ② Assess (`risk-reviewer`). Tie promotion to HG-0005
  (dev → staging → prod).
- **Absent in the bundle.**

## 5. Fuzzing

For anything parsing untrusted input — API request bodies, file uploads, message decoders, Open
Finance payloads — deterministic tests miss the malformed-input space.

- Coverage-guided fuzzing (e.g. libFuzzer, AFL++, or language-native fuzz harnesses) on parser and
  boundary code; persist the corpus; treat any crash as a regression.
- **Enforcement of record:** a CI fuzz job with a time/iteration budget on changed parser surfaces
  + a nightly deeper run; crashes open tracked defects. The corpus is a versioned asset, not scratch.
- **Absent in the bundle.**

## 6. Runtime & container security

Build-time scanning says nothing about what runs. This is a cluster-side control surface the
harness cannot reach.

| Layer | Control | Enforcement of record |
|---|---|---|
| Image | Hardened/minimal base images, image scanning at build (ties to `supply-chain-security.md`: hardened images + signed SBOM + SLSA provenance under HG-0002) | Signed provenance verified at admission |
| Admission | Policy-as-code admission controller (e.g. OPA/Gatekeeper, Kyverno) — reject unsigned/unscanned/over-privileged workloads | **Admission controller in the cluster** — the seam nobody deploys around |
| Runtime | Runtime threat detection (e.g. Falco) — syscall/behaviour anomalies | Alerting into the SEV pipeline (Part 2 §4) |

**The decisive property:** admission control is enforced by the cluster, not by a reviewer. An
image policy that lives only in a wiki is hygiene; the control is the admission webhook that
rejects the pod. The bundle ships the supply-chain *provenance* seam (HG-0002) only — the
admission and runtime controls are absent.

## 7. IaC scanning + drift detection

Infrastructure is code and drifts. Two distinct controls:

- **Scan** IaC (Terraform/CloudFormation/K8s manifests) for misconfiguration (e.g. tfsec, Checkov,
  Terrascan) as a CI gate on infra changes.
- **Detect drift** — the deployed state diverging from declared state — continuously, and
  reconcile. A gate on the code cannot see out-of-band console changes.
- **Enforcement of record:** the scan is a required check on IaC PRs; drift detection is a
  scheduled reconciliation in the platform that alerts and (ideally) auto-reverts. Manual console
  changes to control-plane infra are themselves a finding.
- **Absent in the bundle.** The *code* scan is a gate you add (no IaC gate ships); **drift
  detection** needs a live cloud account the harness does not have.

## 8. Penetration testing, red team & DORA TLPT

The controls no gate replaces. **Independence is the point** — agents testing agents, or the build
team testing its own build, is not assurance (the cluster-C principle applied to security; see
`independent-assurance-runbook.md`).

1. **Scheduled penetration tests** by testers independent of the build team, against staging and
   (with control) production, scoped from the threat model (§3).
2. **Threat-Led Penetration Testing (TLPT)** where DORA applies — intelligence-led, red-team
   engagements on important business functions, modelled on TIBER-EU. This is a regulatory
   obligation for in-scope entities, not an optional extra.
3. Findings are risk-rated, owned, and **remediation-tracked to closure**; retest verifies the fix.
   An open critical from a pen test is a release blocker.
4. **Enforcement of record:** an independent engagement with scoped rules-of-engagement, a tracked
   remediation register, and retest evidence. `change-watch` carries the **cadence and the
   report-expiry window** so a lapsed pen-test cycle surfaces as a horizon item — but the test
   itself is human and organisational.
5. **Absent in the bundle**, and structurally so: a plugin cannot commission a red team.

## 9. Pre-egress DLP on model traffic (HG-0011, org half)

HG-0011 is Named-only for a reason: **a bundle cannot ship an inline egress proxy.** The harness
can at most *declare* the seam (residency + gateway intent in a manifest); the control is network
infrastructure the agent's traffic is forced through and cannot route around.

- Route **all** agent/LLM egress through an **onshore model gateway** that inline-inspects prompts
  and responses and **blocks** on policy — PII, secrets, source, regulated data leaving the
  boundary. Overlaps the real-data surface in `data-protection-runbook.md`.
- Pair with **attested sandbox execution** and an **egress allow-list** (this also serves HG-0012's
  derivation-vs-retrieval control — the agent cannot exfiltrate or phone home).
- **Enforcement of record:** the **inline egress proxy / DLP gateway** — a chokepoint the agent has
  no path around, terminating outside the agent's trust zone. Not a hook the agent runs; hooks the
  agent can skip are hygiene, the network chokepoint is the control.
- **Named-only in the bundle → Enforced only when you wire the gateway.** Do not describe DLP as
  "enforced by the harness"; the harness at most emits the declaration the gateway consumes.
- **The component, if you want one off the shelf:** `../../../loom/references/agent-runtime.md`
  names the neutral role, a recommended instance (CrabTrap), the two bypass probes, and the
  `egress_proxy` activation mechanism that lets HG-0011/HG-0012 graduate once the gateway is real.
  It also states the half a gateway of that shape does **not** close: it blocks, it does not redact.
- **The credential half, while you are at the chokepoint:** some instances also *substitute*
  credentials in transit, so the agent holds a placeholder and never the secret —
  `../../../loom/references/agent-runtime.md`. That is HG-0004's territory rather than
  HG-0011's, but it is the same box and the same deployment, so decide both at once.

## 10. FAPI 2.0 / mTLS conformance (Open Finance)

Domain-specific and, for CBUAE Open Finance, non-negotiable: the security profile is **FAPI 2.0**
with **mTLS-bound (sender-constrained) tokens**. Conformance is a property of the *deployed*
endpoints, so it is a gate against a running target, not against code.

- Run the **OpenID Foundation FAPI 2.0 conformance suite** against your deployed ASPSP/TPP
  endpoints as a **release gate** — a green suite is the acceptance evidence.
- Enforce **mTLS at the edge** (client-certificate-bound tokens; reject bearer replay); validate
  certificate chains against the scheme's trust framework.
- **Certificate lifecycle:** rotation before expiry is a resilience control, not paperwork — a
  lapsed transport or signing cert is an outage. `change-watch` fires on the certificate **warning
  window** (① Watch) so rotation is scheduled, not discovered at expiry.
- **Enforcement of record:** the conformance suite as a required pre-prod gate + mTLS enforced by
  the gateway/edge + cert-expiry monitoring. See the `open-finance-uae` skill for the current
  Standards pin (FAPI 2.0, mTLS, partial encryption, certificate rotation).
- **Named-only in the bundle.**

---

# Part 2 — Operational resilience (run-the-bank)

**Nothing in this Part is enforced by any bundled gate, and nothing can be.** The Loom is a
build-time frame; resilience is a property of the *running* system — you cannot gate your way to a
rehearsed failover. `change-watch` can surface a lapsed DR test or an expiring cert as a horizon
item, and HG-0005/HG-0010 give you the promotion and cease-use *seams* to hang resilience off —
but BCP/DR, incident response, on-call, SLOs, and capacity are operated, not built. This Part is
the honest "you build all of this" list.

## 1. BCP / DR

- Document business-continuity and disaster-recovery plans per service tier; define failover
  topology (active-active, active-passive, pilot-light) against each tier's objective.
- **Test them.** An untested DR plan is a document, not a control — the operational analogue of a
  configured-but-inactive branch protection (`activation-runbook.md`'s founding incident).
- **Enforcement of record:** a **rehearsed failover** on a schedule with captured evidence
  (achieved recovery time, data loss, sign-off). Tie DR posture to the promotion process (HG-0005)
  so a service can't reach prod without a declared, tested recovery path.

## 2. RTO / RPO tiering

- Set **Recovery Time Objective** (how long down) and **Recovery Point Objective** (how much data
  loss) per service, driven by its importance tier and DORA's impact tolerances for important
  functions.
- Prove them, don't assert them: a measured recovery time from a real drill, not a target on a slide.
- **Enforcement of record:** the service catalogue records tier + **tested** RTO/RPO; a miss
  against tolerance opens a tracked risk with an owner.

## 3. Chaos / resilience testing

- Run **controlled** chaos experiments (instance kill, latency injection, dependency failure, zone
  loss) with a **steady-state hypothesis** and a blast-radius limit; graduate to **game days** on
  important functions.
- Start in staging; earn production chaos only once tooling and rollback are proven.
- **Enforcement of record:** scheduled experiments with recorded hypotheses and outcomes; each
  discovered weakness becomes a tracked remediation. This is DORA's resilience-testing pillar
  beyond point-in-time pen tests.

## 4. SEV / incident management

The single most run-the-bank control, and wholly outside the harness.

| Element | What to stand up | Framework hook |
|---|---|---|
| Severity taxonomy | SEV1–SEVn with declaration criteria and response SLAs | DORA incident classification |
| Roles | Incident Commander, comms lead, scribe — a standing structure, not ad hoc | CBUAE operational-risk governance |
| Detection→declare | Monitoring/runtime alerts (Part 1 §6) auto-open incidents | — |
| Regulatory reporting | Major-incident notification within the mandated window | DORA / CBUAE major-incident reporting |
| Postmortem | Blameless, with tracked corrective actions to closure | Basel/BCBS lessons-learned |

- **Enforcement of record:** an incident-management platform wired to paging, with a **timed,
  evidenced** major-incident reporting path. Reporting late is itself a breach — build the clock
  in. Feeds back to the context brain as a governed record (`../loom/references/continuous-assurance.md`).

## 5. On-call

- Rotations with primary/secondary, a **tested** escalation policy, humane paging load, and a
  **runbook per alert** (an alert with no runbook is a 3am guessing game).
- **Enforcement of record:** a paging system (e.g. PagerDuty/Opsgenie) with escalation that **has
  been test-paged**, plus an alert-to-runbook coverage check. Escalation that has never fired is
  unproven.

## 6. SLOs / error budgets

- Define SLIs and **SLOs** per important function; derive an **error budget**; adopt an
  **error-budget policy** — when the budget is exhausted, feature releases freeze until reliability
  is restored.
- This is the one resilience control that *touches* the delivery line: the freeze is a release
  condition. But it is enforced by your deployment gate against live SLO telemetry — **not** by a
  bundled Q-gate, which has no production signal.
- **Enforcement of record:** SLO monitoring + an automated release freeze on budget exhaustion. A
  policy people "try to honour" is hygiene; the deploy gate that blocks on a burned budget is the
  control.

## 7. Capacity & performance

- A capacity model per service, **load/soak testing** against expected and stress volumes, and
  headroom/autoscaling with alerting before saturation. For Open Finance, size against API Hub
  call-volume peaks and consent-refresh storms.
- **Enforcement of record:** load-test evidence at each release for capacity-sensitive services +
  live utilisation alerting with defined headroom.

## 8. Cease-use / kill-switch (HG-0010)

Resilience includes the ability to **stop** — both the product and the autonomous build loop.

- A **wired** immediate cease-use switch for the autonomous agent's ability to act on the SDLC, and
  a documented halt path for the running product, both exercisable by the named accountable officer
  without engineering assistance.
- **Enforcement of record:** a kill-switch that **has been tested** (attempted and confirmed to
  halt) + a named Senior Manager (SMCR / CBUAE-equivalent) with documented accountability. Named-only
  until wired and drilled — a kill-switch nobody has ever pulled is a claim.

## 9. Third-party / ICT concentration resilience

- Map critical ICT third parties — cloud, the **model gateway** (HG-0011), the Open Finance **API
  Hub** (Nebras/Ozone), certificate authorities — and their concentration risk.
- Maintain **exit and substitutability** plans and monitor provider incidents; a single-provider
  model gateway or cloud region is a concentration the regulator will ask about.
- **Enforcement of record:** a third-party register with tier, exit plan, and monitored SLAs;
  provider incidents route into your SEV pipeline. `change-watch` can carry contract/cert renewal
  windows.

## Regulation mapping

| Framework | What it bears on |
|---|---|
| **DORA** | ICT risk management, resilience testing (incl. TLPT), incident classification & reporting, ICT third-party risk — maps almost one-to-one onto this runbook |
| **CBUAE** | Operational-risk & business-continuity standards; Open Finance Regulation (FAPI/mTLS, major-incident notification) |
| **Basel / BCBS** | Operational-resilience principles; tolerance for disruption of critical operations |
| **FAPI 2.0 / mTLS** | The Open Finance security profile and sender-constrained tokens |
| **ISO 27001 / SOC 2** | The security control environment threat modelling and testing evidence |
| **TIBER-EU** | The intelligence-led red-team model DORA TLPT follows |
| **SMCR** | Accountable Senior Manager over the cease-use switch and resilience |

Named, not clause-cited. Where DORA and the CBUAE standards overlap, treat the stricter obligation
as binding and cite **both** by name — do not paraphrase clause numbers from memory. Cite your own
regulator's clause numbers in your ADRs.

## How it plugs into the Loom

- **Fills** the Q2/Q4 gate seams (`../loom/references/delivery-harness.md`) with real scanners —
  the only place this runbook touches shipped machinery, and the seams ship empty.
- **Sits on** the activated control plane (HG-0002 via `activation-runbook.md`) — the security
  stages must be control-plane files owned in CODEOWNERS, or the agent can silence its own scanners.
- **Leans on** `change-watch` (① Watch) for CVE, certificate-expiry, and pen-test/DR cadence drift,
  and feeds `risk-reviewer` (② Assess) the results of scheduled assurance — `../loom/references/continuous-assurance.md`.
- **Hangs resilience off** the promotion (HG-0005) and cease-use (HG-0010) seams, but the drills,
  paging, freeze, and switch are operated on your platform, never by a gate.

## Close in this order

Sequenced for the most credibility per unit of motion, consistent with the cluster-E grade.

1. **Fill the seams that already exist** — real Q2/Q4 scanners with enforced thresholds, plus
   history-aware secrets and push protection. Cheapest, and it makes the two empty seams mean
   something.
2. **Wire pre-egress DLP (HG-0011).** The highest-risk Named-only in this cluster — an ungoverned
   agent's egress path — and the one HG decision here whose enforcement of record is squarely
   infrastructure you can stand up now.
3. **Add the running-target security gates** — DAST, FAPI/mTLS conformance (if Open Finance),
   admission control — since they need the staging environment resilience will need anyway.
4. **Stand up incident management and on-call**, then **DR/RTO/RPO drills**, then **SLOs and
   chaos.** The run-the-bank domain the harness never touched; it is the largest body of work and
   the one no gate will ever shrink. Build it as operations, evidence it as drills, report it as
   DORA and the CBUAE standards require — by drilling the clock, not by writing the plan.

## Verify — evidence, not vibes

Concrete acceptance evidence. Attempted-and-rejected beats "the tool is configured." Record the
result as an ADR per `../loom/references/governance.md` and keep the status honest — an unwired seam
is *Absent* or *Named-only*, not *Enforced*, whatever the runbook aspires to.

**Part 1 — security testing**

- [ ] Q2/Q4 are **required** checks with real scanners behind them; a PR introducing a **known
      high-severity** SAST/SCA finding was **attempted and blocked** (screenshot the red required
      check). An empty seam with no scanner is not a control.
- [ ] A secret committed to a branch was **rejected by push protection** (attempted and rejected);
      a planted historical secret was **found by the full-history scan**.
- [ ] (If you built the proposed gate) a tier-triggering change **without** a signed threat model
      was **blocked** by the declaration gate; the model carries a second-line sign-off. Note in the
      ADR that this gate does not ship in the bundle.
- [ ] DAST ran against **deployed staging** with authenticated coverage; a seeded vulnerability was
      detected and blocked promotion.
- [ ] The fuzz job is in CI with a persisted corpus; a known-bad input produced a tracked crash
      regression.
- [ ] The admission controller **rejected** an unsigned / over-privileged image (attempted and
      rejected); runtime detection alerts route to the SEV pipeline.
- [ ] IaC scan is required on infra PRs; a deliberate drift (out-of-band console change) was
      **detected and flagged**.
- [ ] The most recent **independent** pen test / TLPT report exists, is within its validity window,
      and every critical finding is closed-and-retested (not just logged).
- [ ] Agent egress is **forced through the DLP gateway**; an attempt to egress a planted secret/PII
      string was **inline-blocked** (attempted and rejected), not merely logged.
- [ ] (Open Finance) the **FAPI 2.0 conformance suite passes** against deployed endpoints; a
      **bearer-token replay without the bound client cert was rejected** at the edge; cert-expiry
      monitoring is live with a warning window.

**Part 2 — operational resilience**

- [ ] A **DR failover was rehearsed** in the last cycle; the drill's **measured** recovery time and
      data loss are within the service tier's RTO/RPO (evidence, not the target slide).
- [ ] Every important-function service in the catalogue has a **tier + tested** RTO/RPO; a tolerance
      breach has an owner and a tracked action.
- [ ] A chaos experiment / game day ran with a recorded steady-state hypothesis; at least one
      discovered weakness is tracked to remediation.
- [ ] A SEV was **declared and run end-to-end** (real or exercise): IC assigned, comms sent,
      **regulatory-reporting clock started within the window**, blameless postmortem filed with
      corrective actions.
- [ ] On-call escalation was **test-paged** and reached a human within SLA; every active alert maps
      to a runbook.
- [ ] SLOs are monitored; an **error-budget exhaustion actually froze a release** (attempted deploy
      blocked), not just triggered a Slack message.
- [ ] Load/soak test evidence exists for capacity-sensitive services at the current release;
      utilisation alerting fires before saturation.
- [ ] The **cease-use kill-switch was pulled in a drill** and halted the agent (attempted and
      confirmed); a named Senior Manager owns it on paper and in the regime filing.
- [ ] The critical-ICT-third-party register exists with exit plans; a provider-incident tabletop
      routed into the SEV pipeline.

## Cross-references

- **HG catalog** (`../loom/references/governance.md`): HG-0011 (onshore gateway · pre-egress DLP),
  HG-0002 (immutable control plane · supply-chain integrity), HG-0005 (promotion + rehearsed
  rollback), HG-0010 (cease-use switch · accountable officer), HG-0012 (controlled build/eval
  runtime).
- **Bank-grade gap** (`../loom/references/bank-grade-gap.md`): **cluster E**. This runbook is the
  work behind the *DAST · pen test · threat-model gate · secrets-history · operational resilience*
  **Absent** rows and the *pre-egress DLP (HG-0011)* / *FAPI 2.0 / mTLS* **Named-only** rows.
  Adjacent: cluster C (independent assurance / pen-test independence) and cluster D (real-data / DLP).
- **Gate seams & agents this fills / leans on:** Q2/Q4 (`../loom/references/delivery-harness.md`) —
  role placeholders, no scanner ships; `../loom/references/supply-chain-security.md` (Snyk /
  Chainguard as instances of those roles); `change-watch` (① Watch) and `risk-reviewer` (② Assess)
  via `../loom/references/continuous-assurance.md`. There is **no** DAST gate, threat-model gate,
  or secrets-history scanner in the bundle today.
- **Adjacent runbooks:** `activation-runbook.md` (activate first), `data-protection-runbook.md`
  (real-data / DLP overlap), `identity-and-secrets-runbook.md` (scanner + egress identity, HG-0004),
  `independent-assurance-runbook.md` (pen-test independence).
- **Open Finance:** the `open-finance-uae` skill for the current FAPI 2.0 / mTLS Standards pin.
- **Frameworks** (named, not clause-cited): DORA; CBUAE operational-risk & business-continuity +
  Open Finance Regulation; Basel / BCBS; FAPI 2.0 / mTLS; ISO 27001 / SOC 2; TIBER-EU; SMCR.
