# Cursor vs Claude Code for AI-DLC in a UAE Bank — Decision-Grade Research

**Date:** 2026-06-27
**Question:** Can Cursor (the AI coding IDE/agent) be used for an AI-driven development
lifecycle (AI-DLC) inside a UAE bank building regulated Open Finance software
(CBUAE / Al Tareq / Nebras)? And how does it compare to Claude Code?
**Scope:** Evaluated against four external dimensions — vendor data posture, UAE
financial-sector regulation, the AI-DLC methodology, and EU AI Act / provenance —
with the OFBO harness (CLAUDE.md + ADR 0019) as the bar each tool must clear.

> **Sourcing caveat (applies throughout).** This research was run from an environment
> whose egress proxy returned HTTP 403 on direct fetches to many primary domains
> (CBUAE Rulebook, cursor.com, EUR-Lex, slsa.dev, parts of AWS/Anthropic docs).
> Quotes are search-surfaced from those authoritative pages plus reputable secondary
> analyses, cross-corroborated, and flagged where not byte-verified. Anything fetched
> directly from `code.claude.com` / `platform.claude.com` is verbatim. **Before relying
> on this for a compliance filing, confirm load-bearing wording against:** the in-force
> CBUAE Circular 3/2025, a *signed* vendor DPA (marketing pages are not contractual),
> and the AWS account team on `me-central-1` in-region inference profiles.

---

## Verdict

**Both are "yes-with-conditions," but Claude Code clears the two gates that block
Cursor, and it is the native substrate for the OFBO harness.**

- **Cursor — yes-with-conditions, heavy.** One condition may be a hard "no": Cursor
  *mandatorily* proxies all prompt/context through Anysphere's own US-AWS backend
  (even with your own API key, even in Privacy Mode), which fails OFBO's P6
  no-direct-egress hard stop outright. Its strength is interactive developer ergonomics.
- **Claude Code — yes, lower-friction on every regulated dimension.** Its model backend
  is pluggable: `CLAUDE_CODE_USE_BEDROCK=1` runs inference **inside the bank's own AWS
  account, in-region** (UAE `me-central-1` has Claude), with no third-party SaaS proxy in
  the path. It also natively honours the OFBO harness (hooks, worktrees, subagent
  reviewers, provenance trailers).

The two genuine regulatory gates are **(1) data egress** and **(2) CBUAE outsourcing /
audit-access** — *not* residency-of-code and *not* the EU AI Act, both of which are
commonly over-read (see §3 and §4).

---

## Comparison at a glance

| Dimension | Cursor | Claude Code | Edge |
|---|---|---|---|
| **Egress / residency** | Mandatory proxy through Anysphere US-AWS backend, even BYOK, even Privacy Mode. No UAE region. No air-gap. | `CLAUDE_CODE_USE_BEDROCK=1` → Bedrock in the bank's own AWS account/IAM; prompts/code stay in-boundary, Anthropic never sees them. **UAE `me-central-1` has Claude.** Routable via P6 gateway. | **Claude Code** |
| **CBUAE outsourcing** | New third-party (US startup) that *holds your code*; needs CBUAE non-objection + on-site audit rights at Anysphere. | Data-plane counterparty is **AWS Bedrock** — likely already CBUAE-cleared; Anthropic gets no customer content. | **Claude Code** |
| **Certifications** | SOC 2 Type II; ISO 27001 unconfirmed. | SOC 2 Type II, ISO 27001, ISO 42001, HIPAA, FedRAMP High + inherits AWS in-region certs. | **Claude Code** |
| **AI-DLC fit** | Tool-agnostic methodology lists Cursor; copilot-first, autonomy added. | Same methodology lists Claude Code; autonomous-first/headless-native — the OFBO loop *is* Claude Code. | Claude Code (autonomous loop) |
| **Provenance / EU AI Act** | AI Act binds neither tool. Per-commit AI tracking is a client-side heuristic via Enterprise API, not in the commit. | AI Act binds neither tool. Natively stamps `Co-Authored-By` + session trailers — exactly what ADR 0019 consumes. | **Claude Code** |
| **OFBO harness fit** | Ignores `.claude/hooks`; tripwire layer lost → rebuild as git hooks. No worktree. No subagent reviewers. | Natively honours `.claude/settings.json`, PreToolUse hooks, `bgIsolation` worktrees, subagent reviewers, skills. | **Claude Code** |
| **Interactive dev UX** | Polished IDE: Tab, Cmd-K, in-editor agent. | Terminal/agent-first; no in-IDE tab-completion. | **Cursor** |

---

## Dimension 1 — Vendor data posture (the decisive gate)

### Cursor: mandatory cloud proxy, no UAE region, no air-gap

- Privacy Mode guarantees *retention/training* ("code never stored by model providers,
  never used for training"; ZDR with OpenAI/Anthropic/Google Vertex/xAI) — **not** that
  code stays on your machine.
- **All prompt/context traffic is proxied through Cursor's backend (primarily AWS US) —
  true even with your own API key, even in Privacy Mode.** *"Even if you use your API
  key, your requests will still go through our backend — that's where we do our final
  prompt building."* (cursor.com/data-use; corroborated simonwillison.net/2025/May/11/cursor-security/)
- **No region pinning for residency; no UAE/Middle-East region** (docs silent); **no
  air-gapped / local-inference deployment.** The Self-Hosted Cloud Agents (Helm, ~Mar 2026)
  keep execution/secrets in-network but *still send reasoning context to Cursor's cloud*.
  (cursor.com/blog/self-hosted-cloud-agents; thenewstack.io/cursor-self-hosted-coding-agents/)
- Certs: **SOC 2 Type II** (report on request); **ISO 27001 unconfirmed** — verify.
- Air-gapped alternatives Cursor lacks: Tabnine, Windsurf/Codeium self-hosted, Sourcegraph
  Cody (local models). GitHub Copilot fails the same egress test as Cursor.

**This conflicts directly with OFBO's P6 hard stop** ("all Nebras-bound traffic via the
enterprise egress gateway; no direct egress — non-negotiable"). Cursor is a
*trust-the-vendor-in-transit* model, not a *code-stays-inside-the-perimeter* model.

### Claude Code: pluggable backend → inference in the bank's own account

- **Bedrock and Vertex are first-class backends, selected by env var.**
  `export CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION=me-central-1` routes Claude Code to
  **Bedrock in the bank's own AWS account**, authenticated by the bank's IAM
  (code.claude.com/docs/en/amazon-bedrock). Vertex equivalent: `CLAUDE_CODE_USE_VERTEX=1`.
- **On Bedrock the data plane is governed by AWS terms, not Anthropic's:** *"Model
  providers don't have access to … customer prompts and completions … model invocation
  communications stay in the AWS network"*; content is not used to improve base models and
  Anthropic receives only aggregated usage data excluding customer content.
  (docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html — search-surfaced)
- **A UAE region with Claude exists.** AWS added Claude (Opus 4.6 / Sonnet 4.6 / Opus 4.5 /
  Sonnet 4.5 / Haiku 4.5) in `me-central-1` (UAE) and `me-south-1` (Bahrain) via global
  cross-region inference, ~Feb 2026, with *"data at rest … remains exclusively within your
  source Region."*
  (aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-global-cross-region-inference-for-anthropics-claude-models-in-the-middle-east-regions/ — search-surfaced)
- **LLM-gateway support** lets all of it egress through the bank's P6 gateway: set
  `ANTHROPIC_BASE_URL` to the gateway; per-request audit logging; provider key stays
  server-side. (code.claude.com/docs/en/llm-gateway)
- Anthropic certs: **SOC 2 Type II, ISO 27001, ISO 42001, HIPAA, FedRAMP High**
  (trust.anthropic.com). Consumed via Bedrock, the bank also inherits AWS in-region controls.

**Two honest conditions on the Claude-Code path:**
1. *Global cross-region inference* can route **transient compute** to another AWS region —
   data-at-rest stays in `me-central-1`, but a prompt in flight may briefly process outside
   the UAE. If the bar is "prompts never physically leave the UAE," confirm an in-region-only
   inference profile with AWS. *(Search-surfaced — verify.)*
2. Residual non-inference traffic (update check, login, optional telemetry) must be
   suppressed/proxied: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` + corporate `HTTPS_PROXY`.
   The inference path is fully contained; these control-plane endpoints need explicit closing.

**Note on Anthropic first-party API (not the recommended path here):** residency is **US or
global only** — no Middle-East, no EU. The in-region Gulf path runs specifically through
**Bedrock `me-central-1`**. (platform.claude.com/docs/en/manage-claude/data-residency)

---

## Dimension 2 — UAE financial-sector regulation

### Residency attaches to *data*, not *code*

The instinct "UAE bank ⇒ code must stay in the UAE" is not what the rules say. Every CBUAE
localization clause is scoped to *Consumer / transaction / Personal / Payment Data* — not
application source code.

- **CBUAE Consumer Protection Standards Art. 6:** *"All Licensed Financial Institutions must
  hold and store all Consumer and transaction Data within the UAE"* + in-country backup;
  offshore processing only with **CBUAE pre-clearance + prior written customer consent.**
  (rulebook.centralbank.ae/en/rulebook/article-6-protection-consumer-data-and-assets)
- **CBUAE Open Finance Regulation** (now **Circular 3/2025**, replacing Circular 7/2023
  gazetted Apr 2024; in force 10 Jul 2025): OF Providers *"must store all data relating to
  Open Finance Services within the State and … not maintain copies … outside of the State
  unless … appropriate approvals."* (rulebook.centralbank.ae/en/rulebook/open-finance-regulation-0)
- **UAE PDPL (Law 45/2021)** governs *personal data* only and **carves out CBUAE-regulated
  banking/credit data**. PII-free source code is outside PDPL scope entirely.
  (dlapiperdataprotection.com/countries/uae-general/law.html)

**Source/application code is named in no residency rule; on the face of the texts it is out
of scope (interpretive).** The trigger is whether an artifact *embeds* regulated data — which
OFBO's synthetic-only / zero-PII hard stops already prevent. This weakens the residency
objection to *code* offshore for *both* tools; it does not weaken the egress (§1) or
outsourcing objections.

### Outsourcing is the real obligation — and it favours Claude-via-Bedrock

Using a third-party AI SaaS is **outsourcing under CBUAE Circular 14/2021** (Outsourcing
Regulation & Standards for Banks; in force 15 Jul 2021), which explicitly covers IT/cloud.
If **material** (anything touching core back-office functions or confidential data likely is),
the bank must:

- get **board approval** + run due diligence / risk assessment;
- obtain **CBUAE non-objection before signing**;
- embed mandatory contract clauses — **CBUAE (and its agents) on-site/audit access at the
  provider**, breach notification without undue delay, data ownership/unfettered access,
  destruction on termination, defined subcontracting;
- keep the **Master System of Record in the UAE** and not move Confidential Data offshore
  without approval + consent.
  (rulebook.centralbank.ae article-5 / article-6 / article-8)

The **CBUAE AI Guidance Note (Feb 2026)** — advisory but strong supervisory expectation —
adds: *"regulatory responsibility cannot be outsourced; outsourced AI contracts must include
audit rights, cybersecurity guarantees, and immediate cessation capabilities."* It hooks AI
governance to the binding **Model Management Standards (MMS, Notice 5052/2022)**.
(kiteworks.com/.../cbuae-ai-guidance...; ey.com/.../cbuae-model-management-standard)

**Why this favours Claude Code:** the outsourcing *counterparty* differs.

- **Cursor:** the SaaS that *holds your code* is Anysphere (a US startup). CBUAE
  non-objection + **on-site inspection rights at Anysphere** is a real procurement risk; a
  standard subscription will not grant it.
- **Claude Code via Bedrock:** the data-plane counterparty is **AWS** — a relationship the
  bank very likely already has CBUAE-cleared, in-region, with audit rights and AWS's certs.
  Anthropic is a model provider that receives **no customer content** under Bedrock terms.
  The outsourcing/audit burden collapses into existing cloud governance rather than a new
  third-party with code access.

### No UAE financial-AI rule targets AI coding assistants / the SDLC

This is the most important regulatory clarification. CBUAE MMS (binding) governs
**financial/risk models** (ECL, credit, capital) — not build pipelines. DIFC Regulation 10
(binding, free-zone) governs AI **processing personal data**. DFSA/ADGM have no binding AI
rulebook. **All target AI decisioning/customer-facing models, not developer tooling.**

An OFBO build using an AI assistant on synthetic, PII-free code with four-eyes human merge
sits **outside the explicit triggers of every UAE financial-AI instrument** — regulator
silence, not an explicit exemption, so document the position. ISO/IEC 42001 is the de-facto
SDLC AI-management standard to point at. (lw.com/.../ai-in-the-uae-...; modulos.ai/middle-east-ai-regulations/)

---

## Dimension 3 — AI-DLC methodology

**AI-DLC is a tool-agnostic *methodology*, not a tool — and it lists both Cursor and
Claude Code as supported.** This is the load-bearing fact for the "DLC" half of the question.

- AWS's own repo: *"AI-DLC is fundamentally a methodology, not a tool … works with any IDE,
  agent, or model"* (Inception → Construction → Operations; "mob elaboration"; "bolts"
  replace sprints). (github.com/awslabs/aidlc-workflows)
- Same bet in **GitHub Spec Kit** (spec-as-contract, 30+ agents incl. Cursor); baked-in only
  in **Amazon Kiro** (a product). The rigour — fail-first contract tests, CI gates,
  four-eyes, lineage — lives in the harness around the agent, exactly as OFBO's CLAUDE.md
  encodes it.

**Tool positioning:**
- **Cursor** sits at the copilot end and has extended into autonomy (Plan mode, **Background
  Agents** that open PRs, headless CLI for CI). Default ergonomics are interactive (Tab usage
  still dominates).
- **Claude Code** is **autonomous-first / headless-native** (`claude -p`); the OFBO
  `/loop /next-story` build loop *is* Claude Code. Better fit for an autonomous AI-DLC loop.

Autonomy of the agent and rigour of the lifecycle are orthogonal — the same harness wraps
either. OFBO's CLAUDE.md is effectively a stricter, hand-built AI-DLC instance.

---

## Dimension 4 — EU AI Act & provenance (a myth corrected)

**EU AI Act Art. 12 (record-keeping) and Art. 17 (QMS) do *not* trigger from AI-authored
code.** They bind **providers of high-risk AI *systems*** and govern the **runtime logging /
lifecycle quality of the deployed system**, judged by Annex I/III purpose.

- An AI coding assistant is **limited-risk at most** (Art. 50 transparency), not high-risk.
  (augmentcode.com/.../eu-ai-act-compliance)
- Art. 12 is a *capability* duty; the **"≥6 months" retention lives in Art. 19 / Art. 26(6)**,
  and **for a bank, Art. 26(6) defers to financial-services recordkeeping law.**
  (artificialintelligenceact.eu/article/12, /article/26)
- **Timeline caveat:** the "Digital Omnibus" agreement (7 May 2026) pushes Annex III high-risk
  applicability from 2 Aug 2026 toward **2 Dec 2027** — verify the enacted text.
  (consilium.europa.eu press 2026/05/07)

So **what's regulated is what the bank *ships*, not that an LLM helped write it.** Neither
Cursor nor Claude Code *creates* an AI-Act obligation by being used. OFBO's ADR 0019
provenance bundle is a *self-imposed, defensible* control mapped to Art. 12/17 — good
practice, not a literal mandate the tool must satisfy.

**Provenance/tamper-evidence is a harness property, not an editor property:**
- Tamper-evidence is created at the **CI/build layer** — SLSA provenance signed by a hardened
  control plane, in-toto/DSSE attestations, signed commits (gitsign), Rekor transparency log.
  *"The worker has no influence over the provenance."* (slsa.dev/spec/v1.0/levels) The editor
  is the "worker"; it cannot be the system of record.
- Git trailers (`Co-Authored-By`, emerging `Assisted-by:` / ASF `Generated-by:`) are
  **attribution hints, not proof** — no cryptographic binding.
  (allthingsopen.org/.../assisted-by; dev.to/.../co-authored-by-is-not-enough)

**Tool difference:**
- **Cursor** offers per-commit AI attribution via **AI Code Tracking** (local per-line
  signatures) + an Enterprise **AI Code Tracking API** — but it's a **client-side heuristic
  surfaced via API, not signed provenance in the commit**, and Cursor's audit logs
  deliberately **exclude prompts and generated code** (it recommends *hooks* for that).
  (cursor.com/docs/.../ai-code-tracking-api; .../compliance-and-monitoring)
- **Claude Code** appends **`Co-Authored-By: Claude` + session trailers by default** — exactly
  what ADR 0019's `parseProvenance` + sealed evidence bundle consume. Zero integration work.
  (code.claude.com/docs/en/settings) CLAUDE.md *mandates* keeping these, so they stay on.

---

## Dimension 5 — OFBO harness fit (the OFBO-specific axis)

The OFBO harness *is* Claude Code: `.claude/settings.json` (`worktree.bgIsolation`),
PreToolUse hooks (`pii-guard.sh`, `spec-tripwire.sh`, `test-tripwire.sh`), clean-context
subagent reviewers (hard-stop, contract-conformance), skills, and the `Co-Authored-By` /
`Claude-Session` provenance trailers.

- **Claude Code:** honours all of it natively. Zero re-implementation.
- **Cursor:** does **not** read `.claude/hooks`, so the PII/spec/test tripwire *advisory*
  layer is lost; no worktree concept; no subagent reviewers. The **merge-blocking CI gates
  survive** (Q1b test-integrity, Q4.5 lineage, hard-stop reviewer in CI — deterministic and
  tool-agnostic by ADR 0019's design), but the early defensive layer must be rebuilt as
  **Cursor hooks + tool-neutral git `pre-commit` hooks**. Cursor does support its own hooks
  system and even recommends hooks for prompt logging.

---

## Recommendation

**Not strictly either/or.** A defensible posture:

- **Claude Code (via in-region Bedrock `me-central-1`) as the governed autonomous build loop
  and regulated-pipeline tool of record** — in-tenancy inference, outsourcing that rides the
  existing AWS relationship, broader certifications, native provenance and harness fit.
- **Cursor optionally as a human-at-the-keyboard copilot** — *only if* the bank accepts its
  US-proxy egress for interactive work on synthetic/PII-free code under an Enterprise DPA, or
  restricts Cursor to non-regulated repos.

If the no-direct-egress rule is taken literally for **all** code, Cursor is out, and
Claude-via-Bedrock (or an air-gapped tool such as Tabnine / Windsurf self-hosted / Cody local)
is the only fit.

### Conditions checklist (to clear before adoption)

| # | Condition | Cursor | Claude Code |
|---|---|---|---|
| 1 | Egress / "code never leaves boundary" | ❌ SaaS proxy; pick air-gapped tool if bar is literal | ✅ Bedrock in-tenancy; close residual control-plane traffic |
| 2 | CBUAE outsourcing + audit access | ⚠️ Non-objection + on-site rights at Anysphere (hard) | ✅ Rides existing AWS Bedrock cloud governance |
| 3 | No PII in agent context | ✅ Synthetic-only mandate + enforced Privacy Mode | ✅ Synthetic-only; Bedrock keeps content in-account |
| 4 | Tripwires (PII/spec/test) | ⚠️ Rebuild as Cursor hooks + git pre-commit hooks | ✅ Native `.claude/hooks` |
| 5 | Provenance trailers | ⚠️ `prepare-commit-msg` hook + AI Code Tracking API | ✅ Native `Co-Authored-By` + session |
| 6 | Four-eyes merge / control-plane immutability | ✅ GitHub branch protection + CODEOWNERS (tool-independent) | ✅ Same |

### Items to verify before a compliance memo

1. Whether `me-central-1` offers an **in-region-only** (non-global) Claude inference profile,
   or only global cross-region (transient compute may leave UAE). — AWS account team.
2. Exact wording of the in-force **CBUAE Circular 3/2025** (Open Finance) and **Circular
   14/2021** (Outsourcing) article text, and the on-site-audit clause. — authenticated Rulebook.
3. Cursor's **ISO 27001** status (unconfirmed) and the *contractual* Privacy Mode / ZDR
   wording in a **signed DPA** (public pages are marketing).
4. The final enacted **EU AI Act "Digital Omnibus"** high-risk applicability date.

---

## Primary source index

**Cursor / vendor posture**
- cursor.com/data-use · cursor.com/security · cursor.com/privacy
- cursor.com/blog/self-hosted-cloud-agents · cursor.com/docs/.../ai-code-tracking-api
- cursor.com/docs/enterprise/compliance-and-monitoring
- simonwillison.net/2025/May/11/cursor-security/ · thenewstack.io/cursor-self-hosted-coding-agents/

**Claude Code / Anthropic / AWS Bedrock**
- code.claude.com/docs/en/amazon-bedrock · code.claude.com/docs/en/google-vertex-ai
- code.claude.com/docs/en/llm-gateway · code.claude.com/docs/en/monitoring-usage · code.claude.com/docs/en/settings
- aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-global-cross-region-inference-for-anthropics-claude-models-in-the-middle-east-regions/
- support.claude.com/en/articles/10280791-what-aws-regions-are-claude-models-available-in-amazon-bedrock
- docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html
- platform.claude.com/docs/en/manage-claude/data-residency · .../api-and-data-retention
- privacy.claude.com/en/articles/10015870 · trust.anthropic.com

**UAE regulation**
- rulebook.centralbank.ae/en/rulebook/outsourcing-regulation-banks · .../article-5-outsourcing-agreements · .../article-6-outsourcing-outside-uae · .../article-8-non-objection-central-bank
- rulebook.centralbank.ae/en/rulebook/article-6-protection-consumer-data-and-assets
- rulebook.centralbank.ae/en/rulebook/open-finance-regulation-0 · .../article-22-data-privacy-and-consent-use-personal-data
- rulebook.centralbank.ae/en/rulebook/guidance-note-...-artificial-intelligence
- centralbank.ae/media/0oaarr3a/model-management-standards-attach-to-notice-5052-2022.pdf
- trowers.com/insights/2023/february/... · pinsentmasons.com/out-law/guides/uae-open-finance
- dlapiperdataprotection.com/countries/uae-general/law.html · lw.com/.../ai-in-the-uae-...

**AI-DLC / methodology**
- github.com/awslabs/aidlc-workflows · github.com/github/spec-kit · kiro.dev
- aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/

**EU AI Act / provenance**
- artificialintelligenceact.eu/article/12 · /article/17 · /article/26
- consilium.europa.eu/en/press/press-releases/2026/05/07/...
- slsa.dev/spec/v1.0/levels · in-toto.io · docs.sigstore.dev/about/bundle/
- allthingsopen.org/.../assisted-by · dev.to/.../co-authored-by-is-not-enough
