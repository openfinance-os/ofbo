// HG-0002 — the control-plane integrity gate. An ungoverned agent can edit its own
// guardrails; the decision that closes that gap is an immutable control plane: the hooks,
// gates, workflows, settings, and register live outside the agent's write scope, enforced by
// CODEOWNERS + branch protection. Branch protection is a platform setting (see
// governance/activation-runbook.md); this gate enforces the repo-side half deterministically:
//
//   Every control-plane path MUST be owned in CODEOWNERS by a named group.
//
// CODEOWNERS uses last-match-wins, and a rule with a pattern but no owners *removes*
// ownership. So a control file is "unprotected" if no rule matches it, or the last matching
// rule has zero owners — either way, a change to it would not require Code Owner review. That
// is exactly the failure mode HG-0002 exists to prevent, so this gate fails the build on it.
//
// Run from the repo root: `node scripts/control-plane-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// ADOPT: the control-plane files the agent must never change without four-eyes — EVERY gate,
// hook, workflow, and governance manifest, not representative samples (1.10: an unlisted gate
// is an unprotected gate). Add yours; remove any this repo doesn't have. Keep CODEOWNERS and
// this gate in the list — a control plane that doesn't protect itself isn't one.
//
// 2.1.0 — this list is the BASE, not the whole set. The gates themselves are derived from the
// control catalog at run time (`deriveTargets`): every `mechanism_ref` the catalog names is a
// target, so a gate can no longer be catalogued and unlisted here at the same time. Before this,
// 35 of 67 catalogued mechanisms were outside the list — an agent could rewrite any of them to
// exit 0 without Code Owner review while this gate stayed green. What stays hand-listed is what
// the catalog does not name: hooks and their data, settings, workflows, governance manifests,
// and the ownership probes. The catalog's `paths` field is deliberately NOT used: it names what
// TRIGGERS a control (discovery runs, backlog items — agent-written content), not what protects it.
export const CONTROL_TARGETS = [
  '.claude/hooks/pii-guard.sh',
  '.claude/hooks/pii-patterns.json',       // 2.1.0 — the file whose absence makes pii-guard fail closed; editable, it is the guard's allow-list
  '.claude/hooks/spec-tripwire.sh',
  '.claude/hooks/test-tripwire.sh',
  '.claude/hooks/shariah-term-guard.sh',   // 2.1.0 — a hook is a hook; the Islamic one was catalogued and unlisted
  '.claude/hooks/shariah-surfaces.txt',    // 2.1.0 — the scope list that decides where the term guard bites
  '.claude/settings.json',
  'discovery/gates/validate.mjs',
  'scripts/discovery-link-check.mjs',
  'scripts/control-plane-check.mjs',
  'scripts/model-provenance-check.mjs',
  'scripts/evidence-seal-check.mjs',
  'scripts/data-lifecycle-check.mjs',
  'scripts/operations-signal-check.mjs',
  'scripts/test-integrity-check.mjs',
  'scripts/secrets-scan.mjs',
  'scripts/sast-check.mjs',
  'scripts/supply-chain-check.mjs',
  'scripts/control-catalog-check.mjs',
  'scripts/identity-registry-check.mjs',
  'scripts/change-envelope-check.mjs',
  'scripts/product-approval-check.mjs',
  'scripts/architecture-assurance-check.mjs',
  'scripts/operational-readiness-check.mjs',
  'scripts/assurance-cycle-check.mjs',
  'scripts/decision-log-check.mjs',
  'scripts/adapter-check.mjs',
  'scripts/routine-change-check.mjs',
  'scripts/product-eval-check.mjs',
  'scripts/brainkit-check.mjs',
  'scripts/doc-integrity-check.mjs',
  'scripts/generate-scorecard.mjs',
  'core/policy-compiler.mjs',
  'core/gate-runner.mjs',
  'core/attestations.mjs',
  'core/compiled-requirements.mjs',
  'core/brainkit.mjs',
  'profiles/regulated-bank.json',
  'institution/brainkit/manifest.json', // the Institutional BrainKit is institution-owned, not agent-writable
  'docs/governance/brainkit-registry.json', // rc.15 WS7 — the estate registry (revocation lives here); an agent must not un-revoke a release
  '.github/workflows/ci.yml',
  'docs/governance/data-risk-register/controls.json',
  'docs/governance/control-catalog.json',
  'docs/governance/model-manifest.json',
  'docs/governance/evidence/manifest.json',
  'docs/governance/identities.json',
  'docs/governance/attestation-issuers.json',
  'docs/governance/assertion-issuers.json',  // WS2 D2.4 — the identity-provider material that makes a human approval a human approval; a new root of trust is owned, or it is not a root of trust
  'docs/governance/identity-map.json',       // P6 — the join that says WHO a signed subject is. A service that could write it could decide who is allowed to approve, which is F1 one layer up
  'docs/governance/identity-map-reconciliation.json',  // P6 §4.4 — the observation that the map is current. Unowned, a stale observation could be refreshed by the thing it observes
  'docs/governance/routine-envelope.json', // HG-0013 — the standing routine authorization is second-line-owned, not agent-writable
  'docs/governance/config-baseline.json',  // rc.12 WS2.4 — the approved control-plane config; weakening it would hide drift, so it is owned, not agent-writable
  'docs/governance/platform-activation/any.json', // rc.12 WS2 — ownership probe: the observed-config evidence is owned
  'guardrails/guardrail-policy.json',      // rc.13 WS4 — the guardrail coverage policy; an agent must not weaken its own coverage claims
  'docs/governance/product-evals.json',    // product-outcome evals are product-owner-owned, not agent-writable
  'docs/governance/changes/any/change-envelope.json', // ownership probe: the whole changes/ tree must be owned (by the second line, not builders)
  'docs/governance/changes/any/release-hold.json',    // ownership probe: only the second line can touch the hold
  'docs/governance/services/any.json',                // ownership probe: readiness declarations are owned
  // rc.39 (flow-plan Phase 5) — the exposure plane. The estate says which environments hold
  // personal data and who may promote into them; the flag register is the exposure control
  // itself; the deployment records are what the deploy gate compares against the authorized
  // digest. An agent that could write any of the three could expose customers to its own work.
  'scripts/environments-check.mjs',
  'scripts/feature-flag-check.mjs',
  'scripts/deployed-digest-check.mjs',
  'docs/governance/environments.json',
  'docs/governance/feature-flags.json',
  'docs/governance/deployments/any.json',             // ownership probe: the deploy record is owned
  // The Shari'ah plane. Both paths are institution-issued context, and both are ownership PROBES:
  // this gate never opens the files and makes no Islamic determination — it asks only whether the
  // path WOULD require Code Owner review. Whether that is silent for an adopter with no Islamic
  // product depends on their CODEOWNERS, not on their product, so do not read "no Islamic product"
  // as "no finding". Delete the two shipped `@your-org/shariah-secretariat` lines (governance/
  // CODEOWNERS.template says to) and the blanket /docs/governance/ rule owns both paths, so these
  // entries say nothing. LEAVE those lines in place and both entries FAIL — with the placeholder-
  // team finding every other unadopted target gets, naming the placeholder rather than the product.
  'docs/governance/shariah-rulings.json', // HG-0014 — a Shari'ah determination is institution-issued context; an agent that could write a ruling could authorise its own product structure
  'docs/governance/issc-register.json',   // HG-0014 — committee composition decides who may approve; an agent that could edit the register could appoint its own approvers
  'CODEOWNERS',
];

// GitHub resolves .github/CODEOWNERS before a root copy, so inspect the effective file first.
const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
// Where the adopted catalog lives (mirrors core/gate-runner.mjs and scripts/ci-catalog-check.mjs).
export const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];

/**
 * The full target set: the hand-listed base plus every mechanism the control catalog names.
 * A catalogued gate is, by the catalog's own claim, a control — so its code is control plane
 * whether or not anyone remembered to list it. Sorted and de-duplicated so the finding order
 * is stable. `mechanism_ref` values that are not repo files (null, a runbook, a URL) are skipped.
 */
export function deriveTargets(catalog, base = CONTROL_TARGETS) {
  const set = new Set(base);
  for (const c of catalog?.controls || []) {
    const m = c?.mechanism_ref;
    if (typeof m === 'string' && /\.(mjs|js|sh|yml|yaml)$/.test(m) && !/^https?:/.test(m)) set.add(m.replace(/^\.\//, ''));
  }
  return [...set].sort();
}

// The shipped template's placeholder owner. A control plane "owned" by @your-org/… is not
// owned by anyone — the gate fails until the ADOPT step replaces it with a real team, so a
// copied-but-never-adopted template cannot read as a green control.
export const PLACEHOLDER_OWNER = /^@your-org(\/|$)/i;

/** Parse CODEOWNERS into ordered rules. Comments and blank lines are dropped. */
export function parseCodeowners(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/).filter(Boolean);
    rules.push({ pattern, owners });
  }
  return rules;
}

/** Does a single CODEOWNERS pattern match a (root-relative, no leading slash) path? */
export function ruleMatches(pattern, path) {
  if (pattern === '*' || pattern === '**') return true; // global default
  let p = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  if (pattern.startsWith('*.')) return path.endsWith(pattern.slice(1)); // *.ext
  if (p.endsWith('/**')) p = p.slice(0, -2); // /dir/** → /dir/
  if (p.endsWith('/')) return path === p.slice(0, -1) || path.startsWith(p);
  return path === p || path.startsWith(p + '/'); // exact file or directory prefix
}

/** Owners of a path under last-match-wins, or [] if unowned. */
export function ownersFor(rules, path) {
  let owners = [];
  for (const rule of rules) if (ruleMatches(rule.pattern, path)) owners = rule.owners;
  return owners;
}

/** Findings (one per unprotected control target). Empty ⇒ the control plane is owned. */
export function evaluate(codeownersText, targets = CONTROL_TARGETS) {
  const rules = parseCodeowners(codeownersText);
  const findings = [];
  for (const target of targets) {
    const owners = ownersFor(rules, target);
    if (owners.length === 0) {
      findings.push(`${target} — not owned in CODEOWNERS (a change would not require Code Owner review)`);
    } else if (owners.every((o) => PLACEHOLDER_OWNER.test(o))) {
      findings.push(`${target} — owned only by the placeholder team ${owners.join(', ')} (replace @your-org/… with a real team the agent is not a member of)`);
    }
  }
  return findings;
}

function run(cwd = process.cwd()) {
  const path = CODEOWNERS_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) {
    return [`no CODEOWNERS file found (looked in ${CODEOWNERS_LOCATIONS.join(', ')}) — the control plane is unowned`];
  }
  // Fail closed on a missing catalog: without it the target set is the base list only, and a
  // gate that is catalogued but unlisted would be exactly the unprotected gate this exists to catch.
  const catalogPath = CATALOG_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!catalogPath) {
    return [`no control catalog found (looked in ${CATALOG_LOCATIONS.join(', ')}) — the control-plane target set cannot be derived, so it cannot be shown owned`];
  }
  let catalog;
  try { catalog = JSON.parse(readFileSync(catalogPath, 'utf8')); } catch (e) { return [`${catalogPath}: unreadable control catalog (${e.message})`]; }
  return evaluate(readFileSync(path, 'utf8'), deriveTargets(catalog));
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = run();
  if (findings.length) {
    process.stderr.write('\nControl-plane integrity gate (HG-0002) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery control-plane file must be owned in CODEOWNERS so the agent cannot\nchange its own guardrails without human four-eyes. See governance/activation-runbook.md.\n');
    process.exit(1);
  }
  process.stdout.write('Control-plane integrity gate (HG-0002) — OK\n');
}
