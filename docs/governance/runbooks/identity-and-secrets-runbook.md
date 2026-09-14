# Identity & secrets (HG-0004) — the agent's least-privilege service identity and vaulted secrets

The build agent needs *some* credential to read the repo, push a `feature/*` branch, open a PR, and read the few secrets a job requires. The default failure mode is that it gets far more: a human's PAT, an admin token, a broad cloud key, a static secret baked into the runner image. That is the gap **HG-0004** names — *broad agent credentials / secrets on disk* — and the decision that closes it: **a least-privilege service identity for the agent + vaulted secrets.** In `bank-grade-gap.md` this is **cluster A**, graded **Named-only**: the decision is made; the enforcement of record is the adopting institution's to build.

> **Why a bundle cannot enforce this.** There is no bundled gate for HG-0004, and there cannot be: a plugin bundle cannot ship your IAM, your PAM broker, your HSM, or your SIEM. The bundle ships one paragraph — step 3 of `activation-runbook.md`, a prose stub — and nothing else. Do not read that stub and believe the control exists. A runbook is not a control; the platform mechanism is. The harness at most *complements* HG-0004: `control-plane-check.mjs` (HG-0002) fails a build if a control-plane file loses its CODEOWNERS owner, and branch protection (HG-0001) rejects a self-merge — neither knows anything about the agent's IAM role.

> **Why this exists.** The origin catalog was prompted by an incident in which an agent identity merged to `main` because branch protection was configured but not activated. The identity half matters just as much: the agent held a credential that *could* merge. Least privilege is the belt to branch protection's suspenders — either alone is one misconfiguration from the incident; together they take two.

## Where this sits

| | |
|---|---|
| **Bank-grade-gap cluster** | **A · Control-plane enforcement** (HG-0004 graded **Named-only**) |
| **Primary HG decision** | HG-0004 (least-privilege identity + vaulted secrets) |
| **Composes with** | HG-0001 (four-eyes merge · branch protection), HG-0002 (immutable control plane), HG-0005 (deployer duty it excludes), HG-0006 (agent-as-model), HG-0010 (accountable Senior Manager) |
| **Loom machinery it complements** | `activation-runbook.md` step 3 (the stub this expands); `control-plane-check.mjs` + branch protection (backstop the separation of duties); `change-watch` (rotation / anomaly trigger); the sealed evidence bundle (HG-0003) the audit trail feeds |

## Enforcement of record

Name it plainly, because the whole point of HG-0004 is that the paper does not enforce anything:

- **Identity & scope** → your **IdP / IAM authorization policy** and the platform's push / merge / settings-write restrictions. Not a file in the repo.
- **No standing privilege** → your **PAM broker** (JIT elevation, session recording).
- **Secrets** → your **HSM-backed vault's access + lease policy** and the CI/CD platform's refusal to expose long-lived secrets to a job. Not `.env`, not a repo secret store used as a filing cabinet.
- **Separation of duties** → co-enforced by **branch protection (HG-0001)** and the **managed-settings / CODEOWNERS control plane (HG-0002)**, which keep the agent out of the approver group and out of the settings-write path even if its IAM scope were misconfigured.
- **Audit trail** → an **append-only / WORM log store outside the agent's write scope** (SIEM, cloud audit log with object-lock), so the agent cannot edit the record of what it did.

## Preconditions

- A **platform / IAM admin** running this — **not the agent identity**, and outside the agent's write scope. If the agent can run this runbook, the runbook is void.
- An IdP that supports **workload / service identities** and **OIDC workload-identity federation** (short-lived credential exchange), or an equivalent (SPIFFE-style attestation).
- A **secrets vault whose keys are held in a FIPS-validated HSM**, supporting dynamic / leased secrets and per-identity access policies.
- A **PAM** capability for just-in-time elevation and session recording.
- An **append-only audit sink** (SIEM or object-locked bucket) the agent cannot write to arbitrarily or delete from.
- HG-0001 and HG-0002 already activated per `activation-runbook.md` — this runbook assumes the branch-protection and control-plane backstops are live, and hardens the identity behind them.

## 1. Give the agent its own first-class service identity

1. Create a **dedicated workload identity** for the build agent in the IdP. Never a human's account, never a shared team token, never an admin service account reused from another system.
2. Type it as a **service / non-human identity** so it inherits your service-account governance: no interactive login, no console access, no MFA-reset path a human could ride in on, subject to periodic access recertification like any privileged account.
3. Record a **named accountable human owner** for the identity. Under **SMCR** the autonomous system needs an accountable Senior Manager (the same officer HG-0010 names); under **CBUAE** and **DORA** outsourcing / ICT-risk expectations, a non-human actor in your SDLC must map to an accountable owner and an inventory entry.
4. Register the identity in your **model / system inventory**. The agent *is a model* (`model-risk.md`, HG-0006); this service identity is that model's hands in your estate, and **SR 11-7 / PRA SS1/23** treat the model's access footprint as part of its risk surface.

> One identity per agent role, not one shared identity for "the harness". If a discovery agent and a delivery agent have different privilege needs, they get different identities. Least privilege is per-role, not per-tool.

## 2. Scope the identity to least privilege — this table *is* the separation-of-duties property

The separation of duties is not a policy sentence; it is the **deny** column below being true in your IdP and platform config. The agent is a **builder** — not an approver, not a deployer, not a settings administrator, not a secrets administrator.

| The agent identity **may** | The agent identity **must not** |
|---|---|
| Read the repository | **Merge** any PR (approver = a human Code Owner, HG-0001) |
| Push to `feature/*` branches only | Push to `main` or any protected branch |
| Open pull requests | Edit **branch protection** or repository settings |
| Trigger its own CI on its branches | Edit **CODEOWNERS**, managed settings, hooks, or workflow files (HG-0002) |
| Read the **specific** runtime secrets a job needs, leased | Read secrets outside its scope, or list the vault |
| Write to its own working artifacts | **Deploy** to dev / staging / prod (deployer = a separate pipeline identity, HG-0005) |
| Emit to the audit sink (append-only) | Edit or delete audit records; disable logging |
| — | **Rotate or re-scope its own credentials**; assume other roles; grant itself privilege |
| — | Hold any org-admin, repo-admin, or wildcard-scope token |

The last two deny rows are the ones people forget. An identity that can rotate or widen its own grants has no least-privilege property at all — privilege escalation is a merge away. Credential and policy management for the agent belongs to the platform admin and the PAM system, **never to the agent**.

The **separation-of-duties invariant**, stated once: *the identity that authors a change can neither approve it, nor deploy it, nor alter the controls that would catch it.*

## 3. Broker access through PAM — no standing privilege

1. Even the scoped grants in step 2 should be **brokered, not standing** wherever PAM supports it. The baseline is deliberately low (read + push `feature/*` + lease named secrets); anything above baseline is **just-in-time**, time-boxed, and requires an out-of-band approval by the accountable owner — not by the agent.
2. Turn on **session recording** for the identity, fed to the audit trail (step 7). This is what lets a second line reconstruct *what the agent actually did with the access*, not just what it was granted.
3. There should be **no case** where the agent needs standing elevated privilege to build. If a workflow seems to require it, split the duty out to the deployer or the platform admin. Standing privilege for a non-human builder is the anti-pattern HG-0004 exists to remove.

## 4. Short-lived credentials via workload-identity federation — no long-lived tokens on disk

This is the "secrets on disk" half of HG-0004, and the highest-leverage step.

1. The runner **must not carry a static credential**. Forbid, by policy and by scanning: PATs, static cloud access keys, SSH keys, and vault-root tokens baked into the runner image, mounted into the filesystem, or set as plaintext CI variables.
2. Instead, the runner **attests its identity** to the IdP at job start (OIDC workload-identity federation / SPIFFE-style attestation) and **exchanges that for a short-TTL credential**. TTL in **minutes to a single-digit number of hours** — long enough for the job, short enough that a leaked token is near-worthless by the time it is exfiltrated.
3. The short-lived credential **auto-expires**; there is nothing to revoke and nothing left on disk when the job ends. Ephemeral runners (destroyed after each job) make this stronger.
4. If a **single bootstrap secret is genuinely unavoidable** (e.g. to authenticate the runner to the vault before federation is available), it is exactly *one* secret, itself short-lived, injected by the platform at runtime, never written to disk, and rotated on the schedule in step 6.

The acceptance evidence is blunt: **a filesystem and image scan of a running build finds no long-lived credential.**

## 5. HSM-backed vault for every runtime secret

1. Any secret the agent must read at run time lives in a **vault whose encryption keys are custodied in a FIPS-validated HSM** — the cryptographic-key-management expectation under **ISO 27001**, **DORA**, and **CBUAE / PDPL** handling of sensitive material. **Key custody is separated from the agent** — it can request a secret, it cannot export, manage, or escrow the keys.
2. Prefer **dynamic / leased secrets**: the vault mints a scoped, short-lived credential (a per-session DB credential, a per-job API token) on request, tied to the agent's workload identity, with a **lease that expires** and is **revoked at job end**.
3. The agent authenticates to the vault **via its workload identity from step 4**, not via a stored vault token. The vault's **per-identity access policy** — not the agent — decides which secrets it may lease; the agent cannot list the vault or reach another identity's secrets.
4. Secrets are **held in memory only**, never written unencrypted to disk, never echoed into logs (the audit trail records *that* a secret was leased and its lease id, never its value).

> **A stronger shape where it fits: brokering instead of leasing.** Steps 4–5 still leave a real, short-lived secret in the agent's memory. A coding agent is an **untrusted-input processor by construction** — it reads issues, PR comments, dependency READMEs, web pages, tool output — so the process holding the secret is the same process an attacker gets to write prompts for. The stronger option is a **credential-brokering egress proxy**: it holds the credential itself, hands the agent only a placeholder, and substitutes the real value server-side on the way to the upstream. The agent then has nothing to leak, and step 4's filesystem-and-image test passes by construction rather than by discipline. It does not replace steps 1–3, it does not remove the need for a vault (the broker needs one), and it brings costs of its own — TLS interception, and a new high-value target holding every credential. See `../loom/references/agent-runtime.md`.

## 6. Rotate — on a schedule and on events

1. **Scheduled rotation** for the vault-auth root, any residual bootstrap secret, and the signing material behind workload attestation. Dynamic secrets rotate themselves by construction; what remains is the small set of roots that bootstrap them.
2. **Event-driven rotation** on: suspected compromise, a leaver among the identity's owners/operators, a change of vendor / runner provider, or any audit finding. Rotation must be a **runbook the platform admin can execute in minutes** — a `change-watch` (continuous assurance ① Watch) or SIEM signal should be able to trigger it.
3. **Rehearse the rotation.** An unrehearsed rotation control is the inert-control failure again: present-looking, fails when you reach for it. Rotate the roots at least once as a drill and record the evidence.

## 7. Audit trail of the identity's actions — independent and tamper-evident

1. Log **every** authentication, credential exchange, secret lease (id + scope, never value), git operation, and API call with the **agent identity as the principal**.
2. Ship the log to an **append-only / WORM store outside the agent's write scope**. The decisive property mirrors the control plane: **the agent cannot edit the record of what it did.**
3. **Retain** per your record-keeping obligations (**CBUAE**, **DORA**, **SOC 2**, **ISO 27001** logging and monitoring). Time-stamped, immutable retention is what turns self-assurance into examinable assurance — the same gap `bank-grade-gap.md` cluster C names for evidence generally.
4. This trail is the identity-layer feed into continuous assurance ⑤ **Evidence** and, at release, into the sealed evidence bundle (**HG-0003**). The seal proves the bundle is intact; **the audit store proving the agent's access footprint is the adopter's platform**, not the harness's seal.

## Regulation mapping

| Framework | What it bears on |
|---|---|
| **CBUAE** | Outsourcing / technology & model-management expectations; audit-trail retention |
| **PDPL / ISO 27001** | Access control, cryptographic key management, logging & monitoring |
| **DORA** | ICT & third-party risk, key custody, resilience |
| **SR 11-7 / PRA SS1/23** | The model's access footprint as part of its risk surface |
| **SMCR** | Accountable Senior Manager for the identity |
| **SOC 2** | Logical access & change management |
| **EU AI Act / ISO 42001** | Controls around a governed AI system's access |

Named for orientation; map to the specific clauses your regulator applies. Do not inherit clause numbers from this runbook.

## How it plugs into the Loom

HG-0004 is the credential-layer half of a defence the control plane completes — two independent layers, so the incident needs two failures, not one:

- **With HG-0001 (four-eyes merge · branch protection).** Branch protection keeps the agent out of the approver group and rejects a direct push to `main` — but only if the agent's credential cannot bypass it. Step 2's deny rows are what make the bypass impossible; conversely, if step 2 were ever misconfigured, branch protection is the backstop that still stops the self-merge. **Belt and suspenders.**
- **With HG-0002 (immutable control plane).** `control-plane-check.mjs` *detects* an ownership regression after the fact; step 2's deny (no write to those paths at all) *prevents* the edit in the first place. An agent that cannot reach the control-plane files cannot edit its own guardrails.
- **Feeds:** the sealed evidence bundle (HG-0003) at release; `change-watch` (① Watch) as a rotation/anomaly trigger.

Stated as one composite invariant: **the agent proposes; it holds no credential that could approve, deploy, or disarm.** HG-0001/HG-0002 assert it at the platform-config layer; HG-0004 asserts it at the credential layer, so the property survives a single misconfiguration in either.

## Verify — evidence, not vibes

Every box is an attempted-and-rejected test, a config proof, or an independent sign-off. A policy document is not evidence for any of these.

- [ ] The agent uses a **dedicated service identity** — proven by the IdP record; **not** a human account, shared token, or admin service account.
- [ ] The agent identity **cannot merge** a PR — attempted and rejected (composes with HG-0001).
- [ ] The agent identity **cannot push to `main`** — attempted and rejected.
- [ ] The agent identity **cannot edit branch protection, repository settings, CODEOWNERS, hooks, or workflow files** — attempted and rejected (composes with HG-0002).
- [ ] The agent identity **cannot deploy** to any environment — attempted and rejected (composes with HG-0005).
- [ ] The agent identity **cannot rotate, widen, or re-scope its own credentials, or assume another role** — attempted and rejected.
- [ ] A **filesystem and image scan of a live build** finds **no long-lived credential** — no PAT, static cloud key, SSH key, or vault-root token on disk or in the image.
- [ ] Runtime credentials are **short-lived** — a captured token's TTL is minutes-to-hours and it is **rejected after expiry** (attempted and rejected).
- [ ] Runtime secrets are **leased from an HSM-backed vault** via the workload identity — the vault access policy is shown; the agent **cannot list the vault or lease another identity's secrets** (attempted and rejected).
- [ ] **HSM key custody is separated** from the agent — it can use keys, not export or manage them (config proof).
- [ ] **Rotation has been rehearsed** — the roots were rotated at least once as a drill, with a dated record; an event trigger for emergency rotation exists and was tested.
- [ ] The **audit trail** records the identity's auths, secret leases (id + scope, never value), git ops, and API calls, and ships to a store the **agent cannot edit or delete** (attempted edit rejected; retention policy shown).
- [ ] Secret **values never appear** in logs or the audit trail (log inspection).
- [ ] A **named accountable owner** and an **inventory entry** exist for the identity (document + register entry).

Only when every box is checked is HG-0004 **enforced for this adoption**, not merely *runbooked*. Record the result as an ADR per `../loom/references/governance.md`, keep the status honest (Proposed / Accepted / Enforced), and re-run the attempted-and-rejected tests on a schedule — an identity control, like branch protection, drifts silently and fails exactly when you need it.

## Cross-references

- **HG catalog** (`../loom/references/governance.md`): HG-0004 (this runbook); composes with HG-0001, HG-0002; deployer duty → HG-0005; accountable owner → HG-0010; agent-as-model → HG-0006 (`../loom/references/model-risk.md`).
- **Bank-grade gap** (`../loom/references/bank-grade-gap.md`): cluster **A**, where HG-0004 is **Named-only** — real IAM/PAM, HSM-backed vault, short-lived tokens, and rotation flip it to Enforced. Adjacent: cluster **C** (the WORM audit store).
- **Agent credential brokering** (`../loom/references/agent-runtime.md`): the shape that satisfies the "secrets on disk" half of this runbook by construction, the peer instances, and the substitution failure that looks green. Its network sibling is `../loom/references/agent-runtime.md` (the chokepoint and the per-agent network identity).
- **Loom machinery it complements (does not replace):** `activation-runbook.md` step 3; `control-plane-check.mjs` + branch protection (HG-0001/0002); `change-watch`; the sealed evidence bundle (HG-0003).
