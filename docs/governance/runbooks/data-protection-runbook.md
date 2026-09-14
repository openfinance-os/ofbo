# Data protection — the real-PII control surface (cluster D)

> **Identifiers.** Gate ids (`D1`–`D9`, `Q1`–`Q5`) and run-level ids (`S-001` signal,
> `T-1` theme, `H1` hypothesis) are expanded in `discovery/GLOSSARY.md`.

The Loom is **synthetic-only by design**. The `pii-guard.sh` hook denies any build-time write
that introduces a real-shaped Emirates ID (`784…`) or UAE IBAN (bank code other than the
synthetic `000`); the `data-lifecycle-check.mjs` gate refuses a merge unless every data category
*declares* a classification, a lawful basis, a bounded retention, an erasure disposition, and a
residency. Both are **build-time** controls. Neither is a data-protection control for
**production PII**, because the harness never touches production PII — it has none to protect.

This runbook covers the surface the bundle deliberately never builds: KMS and key management,
field-level encryption, tokenization/pseudonymisation, access logging, DSAR (subject-access)
handling, cross-border transfer controls, residency enforcement, the **execution** of the
data-lifecycle dispositions the gate only requires be *declared*, and mounting the **full**
data-risk register behind the D6 seam (the bundled `register-example/` is a one-record DR-1 demo).
This is `bank-grade-gap.md` **cluster D**, where the *Real-data control surface* and *Full risk
taxonomy* rows are **Absent** and *Retention + right-to-erasure* and *Data residency* are
**Named-only**. It maps to **PDPL**, **GDPR**, **BCBS 239**, and **CBUAE** expectations for LFIs.

Everything below is **adopter-side**, written for the institution's data-protection, platform,
and data-governance owners. A plugin bundle cannot ship an HSM, a key policy, a deletion job, a
token vault, a DSAR desk, or a residency boundary. It can ship a **seam**, a **gate that checks a
declaration**, and this **runbook**. Where a control is real, its enforcement of record is *your
platform mechanism*, never the harness: the gate enforces the **declaration**; the institution
enforces the **data**.

> **Why a bundle cannot enforce this.** The bundled machinery can make you *declare* how long you
> keep a customer's data and *how* you would erase it. It cannot delete the row, destroy the key,
> or stop the record crossing a border — those are an HSM, a deletion job, and a network boundary
> the agent cannot reach. A declaration nobody executes is the paper-policy trap the Loom's
> enforcement-of-record rule exists to kill: *a paper policy is hygiene; the control is the
> platform mechanism nobody can bypass.* The `data-lifecycle.json` manifest that passes CI while
> the deletion job never runs is the single most dangerous gap in cluster D — the gate is
> **green** while the erasure obligation is **unmet**.

## Where this sits

| | |
|---|---|
| **Bank-grade-gap cluster** | **D · Data-governance depth** (BCBS 239 · PDPL · residency) |
| **HG decisions** | HG-0004 (least-privilege identity + vaulted secrets → key & DSAR access), HG-0011 (onshore gateway · pre-egress DLP · residency), HG-0003 (sealed evidence → access-log integrity analogue), HG-0008 (solution-agnostic seams → the D6 register mount) |
| **Loom machinery it complements** | `data-lifecycle-check.mjs` gate + the `data-lifecycle.template.json` demo (mounted as `data-lifecycle.json`); the **D6** register seam (`docs/governance/data-risk-register/`, shipped as the `register-example/` demo) + `data-governance-reviewer` agent + `discovery/gates/validate.mjs`; Q4.5 lineage emission + the `pii-guard.sh` hook; `evidence-seal-check.mjs` (the access-log integrity analogue) |
| **Cluster-D grades today** | D6 seam + reviewer: **Enforced**. Q4.5 lineage + pii-guard: **Enforced**. Full taxonomy: **Absent** (DR-1 demo). Retention + right-to-erasure: **Named-only** (declared, not executed). Real-data control surface (KMS · field encryption · tokenization · access logging): **Absent**. Residency (HG-0011): **Named-only**. |

## What the bundle ships vs what you build

Read this table as the honesty contract for the rest of the runbook. The left column is real and
non-bypassable *in a correctly activated adoption*, and it is build-time only. The right column is
the enforcement of record for production data — and it is yours.

| Control surface | The bundle ships (Enforced, build-time) | You build (enforcement of record, org-side) |
|---|---|---|
| Keeping real PII out of the build | `pii-guard.sh` denies PII-shaped literals (Emirates ID `784…`; IBAN bank code ≠ `000`); synthetic fixtures use the `999`/`000` markers | Nothing — this is the whole point; there is no real PII in scope for the harness |
| Retention | Gate fails a release with no **bounded** retention declared per category | Scheduled **disposal jobs** that delete/anonymise at term |
| Right-to-erasure | Gate fails a release with no **erasure method** declared (`none` needs a legal-hold exemption) | The **crypto-shred / deletion** mechanism that executes it, including in backups & WORM |
| Encryption | — (out of scope) | **KMS + HSM**, envelope/field-level encryption at the data layer |
| Tokenization / pseudonymisation | — | A **token vault** with an enforced irreversibility boundary |
| Access logging | `evidence-seal-check.mjs` makes the *release bundle* tamper-evident | A **tamper-evident, append-only PII access log** on the running system |
| DSAR | — | An identity-proofed **subject-access fulfilment pipeline** with an SLA |
| Cross-border / residency | Gate requires a `residency` string per personal category (HG-0011 names the decision) | **Data-plane residency enforcement** + a transfer-gating control on model & data egress |
| Data-risk register | D6 gate + reviewer check the *mechanics* of whatever register is mounted | The **full taxonomy** mounted behind the seam (the bundled register is DR-1 only) |

The single honest line, from cluster D: *the shape is right; the depth is demo-grade — the
real-data control surface is unbuilt and untested, and that caveat sits under everything else.*
This runbook is the work of building it, and none of it is buildable from inside the plugin.

## Preconditions

- A named **Data Protection Officer** (or equivalent accountable owner) and a data-platform team
  with production access — **not** the build agent's identity, and outside its write scope.
- The `loom-adopt` harness copied in, with the `data-lifecycle.template.json` demo copied to the
  gate's read path (`data-lifecycle.json` or `docs/governance/data-lifecycle.json`) and
  `data-lifecycle-check.mjs` wired into CI (see the activation runbook for the CI wiring).
- A key-management platform (cloud KMS or on-prem HSM) and a secrets vault already stood up for
  HG-0004 — the same vault the agent identity reads run-time secrets from. Key **administration**
  is a separate, more privileged role than key **use**; do not conflate them.
- A data inventory that is honest about what is personal, sensitive, and non-personal. The
  manifest is only as good as this inventory; a category you forgot to list is a category with
  no disposition.

## 1. KMS and key management (HG-0004)

The real control is a KMS/HSM where key **policy** gates decryption and admin ≠ user. The harness
contributes **nothing** here except the vault seam it already uses for agent secrets (HG-0004).

1. Stand up a **customer-managed key** hierarchy: a per-domain (or per-classification) key
   encryption key (KEK) in the HSM, wrapping per-dataset **data encryption keys** (DEKs).
   Envelope encryption — never encrypt bulk data directly under the root key.
2. Write the **key policy** so that decryption of a personal-data DEK requires an identity in a
   named role, and **key administration** (create, rotate, disable, schedule-destroy) is a
   *different* role. The build agent's identity (HG-0004) is in **neither**.
3. Set **rotation**: automatic KEK rotation on a fixed schedule; DEK rotation on re-encryption
   events. Rotation must not orphan ciphertext — retain the ability to unwrap prior DEK versions
   until re-encryption completes.
4. Log every key operation (use, admin, rotate, destroy) to the access log in §4. A
   `ScheduleKeyDeletion` on a subject's DEK is the crypto-shred primitive in §7 — treat it as a
   privileged, four-eyes action.
5. Prove separation of duties by attempting a decrypt with a **key-admin** identity — it must be
   **rejected** (admin ≠ user).

**Enforcement of record:** a KMS/HSM where key **policy** is the gate on decryption, key
**administrators** are separated from key **users** by IAM, and no human or agent identity can
both administer a key and read the plaintext it protects.

## 2. Field-level encryption

Encryption applied **at the data layer** — a database/proxy feature or a persistence-layer
interceptor — so a personal field is ciphertext at rest regardless of which application writes it.
If encryption is an application option a developer can forget, it is not a control. Out of scope
for the harness.

1. Classify fields against the register (§8): every element flagged personal/sensitive gets a
   field-level encryption policy bound to its DEK from §1.
2. Enforce it **below the application**: transparent column encryption, a tokenizing proxy, or a
   mandatory ORM/repository layer no service can bypass. A new service inherits the control by
   construction, not by remembering to call an encrypt function.
3. Make the DEK **per-subject or per-record** where right-to-erasure is by crypto-shred (§7) —
   erasure then means destroying one subject's key, leaving everyone else's ciphertext intact.
   Per-table keys make crypto-shred impossible at subject granularity; decide this **before** you
   encrypt, not after.
4. Confirm at-rest ciphertext by reading the raw storage (disk, backup, replica) for a known
   synthetic subject — the personal fields must be unreadable without a KMS decrypt.

**Enforcement of record:** encryption bound **below the application** — transparent column
encryption, a tokenizing proxy, or a mandatory persistence layer no service can bypass — with
per-subject/per-record DEKs where erasure is by crypto-shred.

## 3. Tokenization / pseudonymisation

A **token vault** (or format-preserving tokenization service) that is the *only* holder of the
token→PII mapping, with its own access role, so downstream analytics, logs, and lower environments
carry tokens — never the raw identifier.

1. Tokenize the high-risk direct identifiers (national ID, PAN, IBAN, phone) at ingestion.
   Downstream systems store and join on the **token**.
2. Draw the **irreversibility boundary** explicitly. Pseudonymisation (reversible via the vault)
   is still **personal data** under PDPL/GDPR — the mapping exists. Anonymisation (irreversible,
   no re-identification path) is out of scope of the law. Do not claim anonymisation for what is
   pseudonymisation; the register (§8) must record which one each element is.
3. Restrict de-tokenization to a narrow role and log every reveal to §4 — a de-tokenization is a
   PII access.
4. Use tokenized/synthetic data to hydrate **lower environments**; the `pii-guard.sh` hook is the
   last-line check that real identifiers never reach fixtures, but the vault is what makes
   tokenized lower environments *possible*.
5. Verify: a de-tokenization attempt from a downstream analytics identity is **rejected**; only
   the vault role resolves a token.

**Enforcement of record:** a **token vault** that is the sole holder of the token→PII mapping,
with its own access role and de-tokenization logged as a PII access.

## 4. Access logging

An **append-only, tamper-evident** log of every read of personal data — subject, accessor,
purpose, timestamp — that the accessing service cannot rewrite or suppress. This is the record
that answers *"who saw this customer's data,"* which you need for DSAR recipient disclosure (§5),
breach notification, and BCBS 239 lineage.

1. Emit an access event on every PII read, de-tokenization (§3), and KMS decrypt (§1): who, which
   subject, which fields, purpose, when.
2. Ship events to a store the producing service **cannot mutate** — a WORM sink, or a hash-chained
   log. This is the runtime analogue of what `evidence-seal-check.mjs` does for the *release
   bundle* (HG-0003): the bundle seal proves build evidence wasn't edited; **you** must provide the
   equivalent for **runtime PII access**. The harness seals its evidence; it does not see your
   production reads.
3. Retain access logs under their **own** lifecycle category in the manifest (§7) — they are
   themselves personal data (they name accessors and subjects) and frequently carry a statutory
   AML/CFT hold, so their erasure disposition is legitimately `none` **with** a recorded exemption.
4. Alert on anomalous access (bulk reads, off-hours, un-purposed) — the log is also the detection
   surface for insider misuse.
5. Verify: mutate a past access record as the producing service — it must be **rejected or
   detectable** (chain break). A log the writer can silently edit is not evidence.

**Enforcement of record:** an **append-only, tamper-evident** PII-access log the accessing service
cannot rewrite or suppress, retained under its own lifecycle category.

## 5. DSAR — subject access, erasure, portability, rectification

A **fulfilment pipeline** with identity proofing, an SLA clock, and a complete data-map so a
request reaches every store holding the subject — including backups, logs, tokenized copies, and
the model gateway. There is no bundle artifact here; this is a built service plus an operating
procedure.

1. **Prove identity before disclosing.** The classic DSAR failure is leaking a subject's data to
   an imposter who filed the request. Identity-proof the requester to a strength proportionate to
   the data. A DSAR pipeline with weak identity proofing is a data-breach vector wearing a
   compliance badge.
2. **Resolve the subject across every store** using the data-map from the register (§8) and the
   token vault (§3): primary stores, replicas, analytics, access logs, backups, and any PII that
   reached the model gateway (§6).
3. **Run the SLA clock.** GDPR gives one month (extendable for complexity); PDPL sets a comparable
   statutory window. Track it per request; a missed SLA is a reportable failure.
4. **Right to erasure → crypto-shred (§7).** Fulfil deletion by destroying the subject's DEK, not
   by hoping a `DELETE` reached every replica and tape. Record the shred as the erasure evidence.
5. **Honour the exemptions honestly.** Where an AML/CFT or other statutory hold blocks erasure, the
   response cites the exemption — the same `erasure.method: "none" + exemption` the manifest
   records for `transaction_audit_log`. Consistency between the DSAR response and the manifest is
   the control; a divergence means one of them is lying.
6. **Disclose recipients.** The access log (§4) is what lets you tell a subject *who* their data
   was shared with — a substantive access-request right, not an afterthought.
7. Verify with a synthetic-subject end-to-end drill: request filed → identity proofed → data
   located across all stores → response within SLA → erasure crypto-shreds the DEK → a subsequent
   read returns unrecoverable ciphertext.

**Enforcement of record:** an identity-proofed **subject-access fulfilment pipeline** with an SLA
clock and a data-map that reaches every store, erasure executed as crypto-shred.

## 6. Cross-border transfer controls and residency (HG-0011)

A **data-plane residency boundary** — storage, replicas, backups, and processing pinned to the
permitted jurisdiction — plus a **transfer-gating** control on every egress path, including the
model gateway. HG-0011 *names* onshore gateway + pre-egress DLP + attested sandbox; the
enforcement is your network and data platform.

1. **Pin residency.** For every personal category the manifest declares `residency` (the gate
   requires the field). Make it true in the data plane: region-locked storage, no cross-region
   replication of personal data without a control, backups in-region.
2. **Gate every transfer.** A transfer to a jurisdiction without adequate protection needs a
   lawful mechanism (adequacy, contractual safeguards, or explicit consent). PDPL restricts
   cross-border transfer; CBUAE has residency expectations for LFI data. Encode the permitted
   destinations; block the rest.
3. **Guard the model egress path specifically.** The agent's LLM traffic is a cross-border channel.
   In the synthetic harness there is no real PII to leak — but in a production instantiation the
   **onshore model gateway + pre-egress DLP** is what stops a personal field riding a prompt
   offshore. This is the HG-0011 control the harness can only *name*; wiring the gateway and DLP is
   yours. Do not treat the absence of PII in the demo as evidence the path is safe in production.
4. **Attested sandbox execution** where residency rules bind the *compute*, not just the storage —
   so agent execution over regulated data stays in-region and is evidenced.
5. Verify: attempt to write a personal record to an out-of-region store and to send a PII-shaped
   payload through the model gateway — **both rejected**, and the DLP block logged.

**Enforcement of record:** a **data-plane residency boundary** plus a **transfer-gating** control
on every egress path, the model gateway included.

## 7. Executing the data-lifecycle dispositions — retention & crypto-shred

**Scheduled disposal jobs** and a **crypto-shred mechanism** bound to the same manifest the gate
reads — so the disposition the gate *checks* is the disposition the platform *executes*. This is
where Named-only becomes Enforced, and it is entirely adopter-side.

The gate (`data-lifecycle-check.mjs`) enforces that every category declares a classification, a
lawful basis (for personal data), a **bounded** retention (or a justified indefinite hold), an
**erasure method** (or a legal-hold exemption), and a residency. It enforces *declared and
bounded*. It does **not** delete anything. Read the shipped `data-lifecycle.template.json` demo as
your contract:

| Category | Retention | Erasure | What you must run |
|---|---|---|---|
| `customer_contact_details` | `P6Y` | `crypto-shred` | A disposal job that at term destroys the DEK / anonymises; an erasure job that crypto-shreds on DSAR |
| `transaction_audit_log` | `P5Y` | `none` + AML/CFT exemption | A hold that **blocks** deletion for 5 years, then disposes; the exemption must be real, not a dodge |
| `aggregate_usage_metrics` | `P2Y` | `hard-delete` | A hard-delete job at term |

1. **Bind the job to the manifest.** The disposal scheduler reads the same `data-lifecycle.json`
   the gate validates and holds the same retention terms. If the two drift, the green gate is
   lying. Treat the manifest as the single source of truth for both check and execution.
2. **Implement crypto-shred as the erasure primitive.** In a bank, physical `DELETE` never reaches
   everywhere — WORM stores, immutable backups, and tape defeat it. Destroying the subject's
   per-record DEK (§1/§2) renders every copy, everywhere, unrecoverable in one privileged action.
   This is why field-level, per-subject keying (§2) is a **precondition** for real
   right-to-erasure, not an optimisation.
3. **Run retention disposal on schedule** and log each disposal to the access log (§4) as evidence
   the term was honoured. Un-run retention is silent over-retention — a standing PDPL/GDPR
   storage-limitation breach.
4. **Enforce legal holds as an override.** An AML/CFT hold must *win* over an erasure request and
   be recorded as the exemption in both the manifest and the DSAR response (§5). A hold that can be
   bypassed by a deletion job is as bad as an erasure that can be bypassed by a hold.
5. **Reconcile periodically.** A scheduled reconciliation proves the executed state matches the
   declared disposition: nothing past term still live, every crypto-shred irreversible. This is the
   `change-watch`-style continuous check applied to data lifecycle — evidence-by-construction, not
   an audit-time scramble.
6. Verify: pick a synthetic record past its retention term — it is **gone**. Crypto-shred a
   synthetic subject's DEK — a raw read of any store (including a backup) returns unrecoverable
   ciphertext.

**Enforcement of record:** **scheduled disposal jobs** and a **crypto-shred mechanism** bound to
the same `data-lifecycle.json` manifest the gate reads, so the declared disposition is the executed
one.

## 8. Mount the full data-risk register behind the D6 seam (HG-0008)

The D6 gate (`discovery/gates/validate.mjs`) checks referential integrity of whatever register is
mounted, and the `data-governance-reviewer` agent judges coverage. Both are **Enforced** — but
they are only as strong as the register behind the seam. The bundled `register-example/` is
**DR-1, a one-record demo**. The enforcement of the *content* is your taxonomy.

1. **Mount your real register** at `docs/governance/data-risk-register/` (the gate's default path),
   replacing the shipped `register-example/` demo. The seam reads **shape, not content**: keep the
   four records the example ships behind the same fields — `risk-taxonomy.json`,
   `risk-statements.json`, `controls.json`, `residual-risk.json`.
2. **Make every control in this runbook a `CTRL-*` record** — KMS/key policy, field encryption,
   tokenization, access logging, DSAR fulfilment, residency/transfer gating, retention disposal,
   crypto-shred — and map each to the `DR-*` risks it mitigates. A control is only *real* if it has
   an enforcement of record from §1–§7; a `CTRL-*` with no platform mechanism behind it is the
   paper-policy trap in register form.
3. **Keep the mappings sound.** The `data-governance-reviewer` agent flags a control cited against a
   risk it doesn't list, an uncovered High/Critical inherent risk, or a residual verdict rosier
   than `residual-risk.json` supports. Its judgement is only as good as the register you mount.
4. **Carry the conditions into the hand-off** — PII redaction, INSERT-only audit, egress limits,
   residency — so the delivery backlog inherits the data-protection constraints, and the Q4.5
   lineage emission ties data movement back to the declared elements.
5. Verify: `node discovery/gates/validate.mjs <runDir>` is green against the **full** register (not
   the demo), and a deliberately mis-mapped control is **caught** by the `data-governance-reviewer`.

**Enforcement of record:** the **full taxonomy** mounted behind the D6 seam, every `CTRL-*` backed
by a platform mechanism from §1–§7 — the mechanical gate and the reviewer only check the register
you provide.

## Regulation mapping

| Control (§) | PDPL | GDPR | BCBS 239 | CBUAE |
|---|---|---|---|---|
| KMS & key mgmt (§1) | Security of processing | Security of processing | Data architecture integrity | Information-security expectations |
| Field encryption (§2) | Appropriate technical measures | Encryption as a safeguard | Protection travels with data | LFI data protection |
| Tokenization (§3) | Pseudonymisation (still personal) | Pseudonymisation safeguard | Lineage across token boundary | — |
| Access logging (§4) | Accountability; breach evidence | Accountability; recipient record | Lineage · adaptability · timeliness | Audit-trail expectations |
| DSAR (§5) | Data-subject rights | Access/erasure/portability/rectification | Locate-the-subject completeness | Consumer protection |
| Cross-border / residency (§6) | Transfer restrictions | International-transfer rules | — | Data-residency expectations |
| Retention & crypto-shred (§7) | Storage limitation; erasure | Storage limitation; erasure | Dispose-what-you-locate | AML/CFT record-keeping holds |
| Full register (§8) | Records of processing | Records of processing | Risk-data aggregation completeness | Risk governance |

Named, not clause-cited. Cite your own regulator's clause numbers in your ADRs; do not inherit
clause references from this runbook.

## How it plugs into the Loom

- **Mounts** the D6 data-risk register seam (`docs/governance/data-risk-register/`) that
  discovery's `data-governance.md` cites — so delivery inherits the residual-risk verdict rather
  than rediscovering it. The shipped `register-example/` is a DR-1 demo; §8 replaces it.
- **Binds to** `data-lifecycle-check.mjs`: the gate makes a bounded retention + erasure disposition
  a merge condition; the disposal and crypto-shred jobs of §7 *execute* what the gate only requires
  be *declared*, reading the same manifest so the two never drift.
- **Backstopped by** the `pii-guard.sh` hook and Q4.5 lineage emission — build-time guards that keep
  real PII out of fixtures and tie data movement to the declared elements. Neither is a production
  data-protection control; they protect the *build*, not the *bank*.
- **Reuses** the HG-0004 vault seam (agent secrets) as the identity substrate for §1's key roles
  and §5's DSAR access — the same least-privilege discipline, applied to real data.
- **Hands off** the data-protection constraints (PII redaction, INSERT-only audit, egress limits,
  residency) into the delivery backlog so Definition-of-Done carries them, not a bolt-on.

## Verify — evidence, not vibes

Acceptance is attempted-and-rejected tests, sign-offs, and config proofs — not a green gate over an
unexecuted declaration. Keep the status honest (Named-only until every box is a demonstrated
platform mechanism).

- [ ] **KMS separation of duties:** a **key-admin** identity attempts to decrypt personal data —
  **rejected**. The build agent's identity is in neither key role (config proof).
- [ ] **Field encryption at rest:** a raw read of storage, a replica, **and a backup** for a
  synthetic subject returns ciphertext; plaintext requires a KMS decrypt.
- [ ] **Tokenization boundary:** a downstream analytics identity attempts de-tokenization —
  **rejected**; only the vault role resolves a token; every reveal is logged.
- [ ] **Access log integrity:** the producing service attempts to alter a past PII-access record —
  **rejected or detectable** (hash-chain break). Access logs have their own retention category.
- [ ] **DSAR end-to-end:** a synthetic subject-access request is identity-proofed, resolved across
  **all** stores (incl. backups, logs, model gateway), answered within SLA, with recipient
  disclosure from the access log.
- [ ] **Right-to-erasure:** a synthetic subject's DEK is crypto-shredded; a subsequent read of every
  store (incl. backup) returns **unrecoverable** ciphertext.
- [ ] **Legal-hold override:** an erasure request against `transaction_audit_log`-class data is
  **blocked** and cites the AML/CFT exemption, matching the manifest.
- [ ] **Residency & transfer:** an attempt to persist a personal record out-of-region and to send a
  PII-shaped payload through the model gateway are **both rejected**, DLP block logged.
- [ ] **Retention execution:** a synthetic record past its manifest term is **gone**; the disposal
  scheduler reads the same `data-lifecycle.json` the gate validates (no drift).
- [ ] **Full register mounted:** `discovery/gates/validate.mjs` green against the **real** taxonomy
  (not DR-1); a mis-mapped control is caught by `data-governance-reviewer`.
- [ ] **Manifest↔platform reconciliation:** a scheduled reconciliation proves executed state matches
  every declared disposition; discrepancies alert.

Only when every box is a demonstrated platform mechanism is cluster D's real-data surface **built**
— not merely *declared* by a passing gate. Record the result as an ADR per
`../loom/references/governance.md`, and be explicit in it: the harness enforces the
**declaration**; the institution enforces the **data**.

## Cross-references

- **HG catalog** (`../loom/references/governance.md`): **HG-0004** (least-privilege identity +
  vaulted secrets → key & DSAR access); **HG-0011** (onshore gateway · pre-egress DLP · residency);
  **HG-0008** (solution-agnostic seams → the D6 register mount); **HG-0003** (sealed evidence → the
  access-log integrity analogue in §4).
- **Bank-grade gap** (`../loom/references/bank-grade-gap.md`): **cluster D**. This runbook builds
  the *Real-data control surface* and *Full risk taxonomy* rows (both **Absent**) and moves
  *Retention + right-to-erasure* and *Data residency* from **Named-only** toward Enforced by
  *executing* the declared disposition. Adjacent: cluster **C** (evidence retention vs. erasure).
- **Discovery harness** (`../loom/references/discovery-harness.md` §5.1): the D6 data-risk register
  seam this register mounts behind, and the `data-governance-reviewer` coverage judgement.
- **Gates & agents this complements:** `data-lifecycle-check.mjs` + the `data-lifecycle.template.json`
  demo (mounted as `data-lifecycle.json`); `discovery/gates/validate.mjs` (D6) + the
  `register-example/` demo; `data-governance-reviewer`; `pii-guard.sh`; `evidence-seal-check.mjs`
  (HG-0003).
- **Frameworks** (named, not clause-cited): PDPL; GDPR; BCBS 239; CBUAE; plus AML/CFT statutory
  holds, ISO 27001, and DORA where noted.
