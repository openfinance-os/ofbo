# Independent assurance & audit — 2nd and 3rd lines (cluster C)

Agents reviewing agents is not assurance. The bundled harness ships the **first line's** own quality machinery — the hard-stop, contract-conformance, data-governance and discovery-boundary reviewer agents — and it seals the release evidence so it cannot be narrated after the fact (HG-0003, `evidence-seal-check.mjs`). That is the builders checking their own work, thoroughly. It is hygiene. It is **not** the second and third lines a regulated institution runs, because those must be *organisationally separate from the builders*. This is `bank-grade-gap.md` **cluster C**, where the *Independent 2nd line*, *3rd-line audit + portal*, and *SOC 2 / ISO 27001 attestation* rows are **Absent** and *WORM · time-stamped retention* is **Named-only**.

> **Why a bundle cannot enforce this.** A plugin bundle cannot ship an independent risk function, an internal audit team, a WORM store, or a third-party attestation — those are people, reporting lines, infrastructure the agent cannot reach, and an external auditor's opinion. What the bundle gives you is the **seam** the independent lines attach to: a sealed, hash-chained evidence bundle with a place to record an external anchor. Nothing below is enforced by the harness; where the runbook says "the gate checks X," it means the repo-side gate checks a *declaration* — the enforcement of record is the platform mechanism named alongside it.

## Where this sits

| | |
|---|---|
| **Bank-grade-gap cluster** | **C · Assurance & audit (three lines of defence)** |
| **Primary HG decision** | HG-0003 (externally-anchored traceability + tamper-evident evidence) |
| **Composes with** | HG-0001 / HG-0002 (the control plane this sits on — activate first), HG-0006 (independent model validation, in the 2nd line), HG-0010 (accountable Senior Manager) |
| **Loom machinery it complements** | `evidence-seal-check.mjs` + `evidence-manifest.json` seam; the 1st-line reviewer agents; `risk-reviewer` / `model-risk-reviewer` (② Assess inputs); continuous-assurance ⑤ Evidence and ⑥ Confirm & report; `activation-runbook.md` (precondition) |

## What the bundle ships vs what you build

| Concern | The bundle ships (Enforced repo-side) | You build (the institution's, org-side) |
|---|---|---|
| First-line review | hard-stop · conformance · data-gov · boundary reviewer agents | Nothing extra — this is the 1st line, and it is the builders |
| Evidence integrity | `evidence-seal-check.mjs` — a tamper-evident, complete, append-only hash chain over the release bundle | The **external WORM + RFC-3161 store** that anchors it, and detects a fully-recomputed chain |
| Second-line challenge | `risk-reviewer` / `model-risk-reviewer` agents (② Assess **inputs**) | The **organisationally-separate** risk & compliance function with veto authority |
| Third-line audit | The sealed evidence trail to audit *against* | Internal audit reporting to the board's audit committee; the **read-only auditor portal** |
| Retention | A place to record a retention disposition | The retention **lock** nobody can shorten, and the policy behind it |
| Attestation | The control environment to be examined | A **third party's** SOC 2 Type II / ISO 27001 opinion on the harness |

The single honest line, from cluster C: *the evidence bundle is sealed but not yet shown to be WORM, time-stamped, or examinable by an independent party — the difference between self-assurance and examinable assurance.* This runbook closes that difference, and none of it is closable from inside the plugin.

## The three lines, and where the harness sits

| Line | Owns | Reports to | The bundle's contribution |
|---|---|---|---|
| **1st** | The build; runs its own reviewer agents and gates | Delivery / engineering leadership | The four 1st-line reviewer agents + all Q-gates (Enforced) |
| **2nd** | Risk & compliance *challenge*; sets policy, can hold a release | CRO / Chief Compliance Officer — **not** the delivery lead | `risk-reviewer` / `model-risk-reviewer` produce challenge *material*; the **function** is yours |
| **3rd** | Internal audit; independent assurance to the board | The board's audit committee | The sealed, anchored evidence trail is what it audits; the **portal + independence** are yours |

The decisive property, mirroring the control-plane rule (`activation-runbook.md`): **the identity that builds must not be the identity that independently challenges, and neither may be the identity that audits.** If one team wears two of these hats, you have one line wearing three coats.

## Preconditions

- The control plane is already **activated**, not merely present — run `activation-runbook.md` first. Independent assurance over an evidence trail the agent can still rewrite is theatre. HG-0001/HG-0002 are load-bearing here.
- The delivery loop writes an **evidence bundle** at release and `evidence-seal-check.mjs` is a **required** status check. Verify it is green on a recent release; if the bundle is unsealed, stop and fix that first.
- IAM/PAM that can express **read-only, scoped, logged** access and role separation — the same platform capability HG-0004 needs.
- A named **Senior Manager** accountable for the assurance function (HG-0010; SMCR-style regimes).
- Budget and mandate to procure an **external WORM store**, an **RFC-3161 timestamping authority**, and a **third-party attestation** engagement.

## 1. Draw the independence boundary

Independence is not a document; it is a reporting line and an access boundary the builders cannot cross.

1. **Reporting lines.** The 2nd line reports to the CRO/CCO and the 3rd line to the board's audit committee. Neither reports, directly or by dotted line, to the delivery lead who owns the harness. Record this as an org-design decision, not a wiki page.
2. **Access boundary in IAM.** Create three distinct identity groups — `builders`, `second-line-challenge`, `internal-audit` — with disjoint membership. The agent's service identity (HG-0004) is in **none**. Enforce that no principal is in more than one.
3. **Authority asymmetry.** The 2nd line may **hold** a release; the 3rd line may **read everything** but changes nothing; the 1st line builds and merges (within branch protection) but cannot grant itself 2nd/3rd-line rights.

**Enforcement of record:** the org chart's reporting lines plus IAM group membership with a segregation-of-duties rule. A CODEOWNERS entry or a reviewer agent cannot create independence — it can only *honour* a boundary that IAM enforces.

## 2. Constitute the second line (risk & compliance challenge)

The 2nd line independently challenges the 1st line's risk decisions — it does not build, and it is not the `risk-reviewer` agent. Running an agent that produces risk findings is a 1st-line convenience; the 2nd line is the separate function that *judges whether those findings, and the 1st line's response, are adequate*.

1. **Staff it separately.** Members are in `second-line-challenge`, report to the CRO/CCO, and have no merge rights on the product repo. They own risk policy and the risk appetite.
2. **Wire the challenge into the release path — as a hold, not a suggestion.** Add a **second-line sign-off** as a required, separately-owned status on releases above an agreed risk tier. Only an identity in `second-line-challenge` can set it; the 1st line and the agent cannot set or bypass it (no-bypass branch protection, HG-0001).
3. **Feed it the harness's challenge material.** The `risk-reviewer` (② Assess) and `model-risk-reviewer` agents attach findings to the evidence bundle. The 2nd line consumes these as *inputs to its own challenge*, not as its verdict. For model risk, this is where **SR 11-7 / PRA SS1/23** independent model validation lives — the `validated_by` field in `model-manifest.json` must name a party in this function, not a builder (see `../loom/references/model-risk.md`).
4. **Give it standing agenda authority** — commission remediation, raise risk acceptance to the accountable Senior Manager, escalate to the 3rd line.

**Enforcement of record:** a required, separately-owned release sign-off that only the independent group can set, protected by no-bypass branch protection.

> Honest limit: the harness can attach the 2nd line's sign-off to the seal and refuse a release without it, but the harness cannot make the signer *independent*. If a builder holds the `second-line-challenge` credential, the gate is green and the assurance is fictional. Independence is verified in Step-1 IAM and in the org chart, never by the gate.

## 3. Constitute the third line (internal audit)

1. **Reporting and mandate.** Internal audit reports to the audit committee of the board, with a charter that explicitly covers the AI build harness, its control plane, and the 1st/2nd lines. Under DORA and BCBS 239 the ICT/data-governance control environment is in scope; name it so.
2. **Right of access, not right of change.** Audit's identities are in `internal-audit`, with read access to the sealed evidence trail, the HG ADRs, the CI configuration, and the IAM segregation records — and **no** write, merge, or admin rights anywhere.
3. **Audit programme.** Risk-based and recurring: sample releases, re-verify the seal chain independently, confirm the 2nd line's holds were real, test that the control plane was activated (not just present), and trace a sample of risks from discovery register to a merged control. Audit does not trust the gate's green — it re-derives it.
4. **Findings to the board** on a cadence, tracked to closure.

**Enforcement of record:** the audit charter (a board record) plus read-only, no-write IAM scoping. The bundle contributes the *auditable* artifact; audit's independence and access are yours.

## 4. Read-only auditor evidence portal

1. **Read-only, provably.** The portal principal has `read` on the evidence objects and **nothing else** — no write, no delete, no list on unrelated buckets, no access to secrets, source, or managed settings. Least privilege, HG-0004 discipline applied to auditors.
2. **Scope to sealed evidence only** — the evidence bundles, their manifests, the HG ADRs, the reviewer-agent outputs, and the model/data manifests.
3. **Every access is logged** to an append-only access log the auditor cannot edit (itself in scope for the 3rd line).
4. **Independent verification built in.** The portal lets an auditor download a bundle and run `evidence-seal-check.mjs` (or an independent re-implementation of its `sealOf` / `buildChain`) themselves, and compare the resolved chain head against the anchor published in the WORM store (Step 5).

**Enforcement of record:** IAM read-only scoping plus an append-only access log. A portal that *could* write is not read-only no matter what its UI says — verify with an attempted write.

## 5. External WORM + RFC-3161 timestamping store (anchor the seal chain)

This is the step the bundle structurally cannot do, and the one that converts self-assurance into examinable assurance. `evidence-seal-check.mjs` proves the bundle is an intact, complete, append-only hash chain *inside the repo*. It cannot prove the chain was not **fully recomputed** by an actor who rebuilt every seal — because that actor also controls the repo. Only an **external, append-only, time-stamped anchor** makes a full recompute detectable.

1. **Provision immutable storage.** An object store in **compliance-mode object lock** (WORM): once written, an object cannot be overwritten or deleted before retention expires, *by anyone, including the account root and the platform admin*. DORA's ICT integrity and BCBS 239's record-integrity expectations point here.
2. **Publish the anchor on every release.** The seal chain head — the value recorded as `manifest.anchor` — is written to the WORM store as an immutable object, keyed by release version.
3. **Time-stamp it with an RFC-3161 authority.** Obtain a token over the anchor from a trusted Time-Stamping Authority (internal HSM-backed TSA or an external qualified TSA). Store the token beside the anchor. It binds *this seal* to *this time*.
4. **Close the loop back to the gate.** Record the published anchor as `manifest.anchor` in the evidence manifest. `evidence-seal-check.mjs` then checks the in-repo chain **resolves to that anchor** — otherwise it emits `external anchor mismatch — the chain resolves to …`. The repo can no longer quietly diverge from the WORM record.
5. **Separate the write path.** The identity that publishes to WORM is a release/CD identity in neither `builders` nor the agent's group; the WORM account's retention and legal-hold settings are owned by the 2nd/3rd line, not by delivery.

**Enforcement of record:** the WORM store's compliance-mode object lock + the RFC-3161 token, held under an identity the builders and the agent cannot reach. The repo-side gate is a *consistency check against* this anchor; the **immutability lives in the external store**. The bundle ships the `anchor` field and the check — it does not and cannot ship the immutability.

## 6. Evidence retention policy

A retention *schedule* is a document; the control is a retention *lock* nobody can shorten.

1. **Set the retention period** on the WORM objects to the longest applicable of: your regulator's records-retention requirement (e.g. CBUAE record-keeping), model-risk evidence retention (SR 11-7 / PRA SS1/23 expect a reconstructable validation trail), and any litigation-hold horizon. Encode it as the object-lock **retention period**, not a calendar reminder.
2. **Legal hold** as an override that *extends*, never shortens.
3. **Reconcile with data-protection retention.** Evidence retention and personal-data retention (delete on schedule / on erasure under PDPL, GDPR) can conflict. The sealed evidence should reference **hashes and identifiers**, not raw personal data, so the audit trail survives an erasure of the underlying record. This is the seam to `data-lifecycle.json` and cluster D — the chain proves *a control ran*, it does not need to *retain the subject's PII*.
4. **Disposition on expiry** is deliberate and logged, and blocked for anything under hold or in a regulatory window.

**Enforcement of record:** the object-lock retention period and legal-hold flag on the WORM store. The lock that refuses an early delete — tested by attempting one — is the control.

## 7. Third-party attestation of the harness (SOC 2 / ISO 27001)

1. **Scope the engagement to the harness itself** — the control plane, the CI gates, the evidence-seal and WORM chain, IAM/segregation, model-risk and data-governance controls — not merely the hosting cloud. Name the harness in the system description / statement of applicability.
2. **Pick the right instrument.** **SOC 2 Type II** tests operating effectiveness over a window; **ISO 27001** certifies the ISMS; **ISO 42001** is the emerging AI-management-system standard directly on point. Where the EU AI Act applies, its conformity-assessment expectations are the regulatory analogue.
3. **Independent auditor, recurring** — a qualified external firm, re-performed on a cadence.
4. **Feed exceptions back** into the 2nd-line risk items and 3rd-line audit findings, tracked to closure.

**Enforcement of record:** an in-scope, in-date, independent attestation report. This is *assurance*, not a bypass-proof mechanism — no gate can produce it, and the harness must never claim it. The honest state (cluster C) is **Absent until an external party issues an opinion**.

## Regulation mapping

| Framework | What it bears on |
|---|---|
| **IIA three-lines model** | The 1st/2nd/3rd-line separation this runbook builds |
| **SR 11-7 / PRA SS1/23** | Independent model validation, sited in the 2nd line |
| **BCBS 239 / DORA** | Record integrity, ICT third-party, resilience — internal-audit scope |
| **PDPL** | Evidence retention vs. right-to-erasure reconciliation |
| **SOC 2 / ISO 27001 / ISO 42001 / EU AI Act** | Independent oversight and conformity assessment of the harness |
| **SMCR** | Accountable Senior Manager over the assurance function |

Named, not clause-cited. Cite your own regulator's clause numbers in your ADRs.

## How it plugs into the Loom

- **Sits on** the activated control plane (HG-0001 / HG-0002 via `activation-runbook.md`) — activate it first, or the evidence the lines examine is rewritable.
- **Anchors** `evidence-seal-check.mjs` (HG-0003): the gate proves the in-repo chain is intact; Step 5's external WORM + RFC-3161 anchor is what the gate's `manifest.anchor` check resolves against.
- **Consumes** the 1st-line reviewer agents and the `risk-reviewer` / `model-risk-reviewer` (② Assess) outputs as *inputs* to independent challenge — never as the verdict.
- **Runs continuously** via the assurance lifecycle (`../loom/references/continuous-assurance.md`): the harness pulls ⑤ Evidence and ⑥ Confirm & report every release, landing the sealed bundle + anchor in WORM; the 2nd line subscribes to ② Assess and the anchor stream; the 3rd line samples from the always-available portal on its own programme. Accountability and four-eyes stay human — agents make assurance *evidence-by-construction*, not *independent*.

## Verify — evidence, not vibes

A green seal gate is necessary and nowhere near sufficient.

- [ ] **Independence is real.** Org chart shows 2nd line → CRO and 3rd line → audit committee, neither under the delivery lead. IAM confirms `builders`, `second-line-challenge`, `internal-audit` have **disjoint** membership; the agent identity is in none. *(HR record + IAM export attached.)*
- [ ] **The 2nd line has teeth.** A release was **held** by a 2nd-line challenge and could not merge until resolved (attempted-and-rejected). A builder identity **cannot** set the second-line sign-off (attempted-and-rejected).
- [ ] **The auditor portal is read-only.** An auditor identity attempted a **write/delete** to the evidence store → rejected. The same identity attempted to read a control-plane secret or source outside evidence → rejected. Access appears in the append-only access log.
- [ ] **The anchor is external and immutable.** An attempt to **overwrite or delete** a published anchor in the WORM store before retention expiry → rejected by object lock, even for the platform admin (attempted-and-rejected).
- [ ] **The timestamp verifies.** The RFC-3161 token over the anchor validates against the TSA certificate, and its time precedes any later chain activity.
- [ ] **The gate is bound to the anchor.** `manifest.anchor` matches the WORM-published seal; `evidence-seal-check.mjs` reports OK, and a deliberately mismatched anchor produces `external anchor mismatch — the chain resolves to …` (fault injected and detected).
- [ ] **An independent re-computation matches.** The 3rd line re-derived the chain head from the raw artifacts using an independent implementation of `sealOf` / `buildChain` and it equals the anchor.
- [ ] **Retention holds.** An early-delete on a retained object → rejected; a legal hold blocks disposition past natural expiry (attempted-and-rejected).
- [ ] **Attestation exists and is in scope.** A current SOC 2 Type II / ISO 27001 (map to ISO 42001 as adopted) report is in date, from an independent firm, and its system description explicitly includes the harness control plane — not just the hosting cloud.
- [ ] **The accountable Senior Manager is named** for the assurance function (HG-0010), and the appointment is recorded.

Only when every box is checked is the assurance **examinable**, not merely *self-asserted*. Record the result as an ADR per `../loom/references/governance.md` and keep the status honest — Absent rows (2nd-line function, 3rd-line audit, attestation) stay Absent until the org-side work is done, no matter how green the repo gate is.

## Cross-references

- **HG catalog** (`../loom/references/governance.md`): **HG-0003** (the decision this operationalises); **HG-0001 / HG-0002** (activate first); **HG-0006** (model-risk validation, in the 2nd line); **HG-0010** (accountable Senior Manager).
- **Bank-grade gap** (`../loom/references/bank-grade-gap.md`): **cluster C**. This runbook moves the *Independent 2nd line*, *3rd-line audit + portal*, and *SOC 2 / ISO 27001 attestation* rows from **Absent**, and *WORM · time-stamped retention* from **Named-only** toward examinable. Adjacent: cluster **B** (model risk) and cluster **D** (retention vs. erasure).
- **Gates & agents this complements:** `evidence-seal-check.mjs` (HG-0003) + `evidence-manifest.json`; the 1st-line reviewer agents; `risk-reviewer` / `model-risk-reviewer`; continuous-assurance ⑤/⑥ (`../loom/references/continuous-assurance.md`); `activation-runbook.md`.
- **Frameworks** (named, not clause-cited): IIA three-lines; SMCR; SR 11-7 / PRA SS1/23; BCBS 239 / DORA; PDPL; SOC 2 / ISO 27001 / ISO 42001 / EU AI Act.
