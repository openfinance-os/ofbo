// The guardrail-policy gate (Loom 2.0-rc.13 · WS4). The Loom ships as a Claude Code plugin, so its
// pre-write guardrails (hooks/) are Claude-Code-specific. Left implicit, an adopter running agents
// under another runtime would assume the same protection they don't have. This gate makes the
// guardrail coverage EXPLICIT and HONEST: it validates guardrails/guardrail-policy.json so that —
//
//   · every `enforced` / `ci-backstop` state names a mechanism that ACTUALLY EXISTS (no claim of a
//     protection whose script is absent),
//   · every `uncovered` state names NO mechanism (an honest gap, not a hidden one),
//   · a `block` guardrail with no enforcement on ANY runtime must be flagged known_gap:true — so a
//     wholly-unenforced control is acknowledged, never silent,
//   · the CI backstop is the enforcement of record wherever a local hook is absent.
//
// The capability matrix in guardrails/README.md is GENERATED from this policy (doc-integrity-gated),
// so the Loom can never imply equivalent enforcement where a runtime lacks the hook.
//
// Run from the repo root (adopted layout): `node scripts/guardrail-policy-check.mjs`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const POLICY_LOCATIONS = ['guardrails/guardrail-policy.json', 'docs/governance/guardrails/guardrail-policy.json'];
export const STATES = new Set(['enforced', 'ci-backstop', 'uncovered']);

/** Findings ([] ⇒ the policy is well-formed and honest). `exists` is injectable for tests. */
export function evaluate(policy, exists = existsSync) {
  const findings = [];
  if (!policy || typeof policy !== 'object') return ['guardrail-policy.json is not an object'];
  const runtimes = policy.runtimes;
  const events = new Set(policy.events || []);
  if (!Array.isArray(runtimes) || runtimes.length === 0) findings.push('policy names no runtimes');
  if (events.size === 0) findings.push('policy names no events');
  if (!Array.isArray(policy.guardrails) || policy.guardrails.length === 0) return [...findings, 'policy declares no guardrails'];

  const seen = new Set();
  for (const g of policy.guardrails) {
    const id = g && g.id;
    if (!id) { findings.push('a guardrail has no id'); continue; }
    if (seen.has(id)) findings.push(`${id}: duplicate guardrail id`);
    seen.add(id);
    if (!(typeof g.description === 'string' && g.description.trim())) findings.push(`${id}: no description`);
    if (!events.has(g.event)) findings.push(`${id}: event ${JSON.stringify(g.event)} is not in the declared events`);
    if (g.decision !== 'block' && g.decision !== 'warn') findings.push(`${id}: decision must be block|warn (got ${JSON.stringify(g.decision)})`);

    const cov = g.coverage || {};
    let anyEnforcement = false;
    for (const rt of runtimes || []) {
      const c = cov[rt];
      if (!c) { findings.push(`${id}: no coverage declared for runtime ${JSON.stringify(rt)} — every runtime must be stated, even as uncovered`); continue; }
      if (!STATES.has(c.state)) { findings.push(`${id}/${rt}: state must be enforced|ci-backstop|uncovered (got ${JSON.stringify(c.state)})`); continue; }
      if (c.state === 'enforced' || c.state === 'ci-backstop') {
        anyEnforcement = true;
        if (!(typeof c.mechanism === 'string' && c.mechanism.trim())) findings.push(`${id}/${rt}: ${c.state} names no mechanism — a claimed protection must name what enforces it`);
        else if (!exists(c.mechanism)) findings.push(`${id}/${rt}: ${c.state} names mechanism ${c.mechanism} which does not exist — no implied coverage`);
      } else if (c.state === 'uncovered' && typeof c.mechanism === 'string' && c.mechanism.trim()) {
        findings.push(`${id}/${rt}: uncovered but names a mechanism ${c.mechanism} — an uncovered runtime must not imply a protection`);
      }
    }
    // A blocking guardrail enforced NOWHERE must be an acknowledged gap, never silent.
    if (g.decision === 'block' && !anyEnforcement && g.known_gap !== true) {
      findings.push(`${id}: decision is block but no runtime enforces or backstops it — set known_gap:true to acknowledge the gap, or add a mechanism`);
    }
  }
  return findings;
}

/** Generate the capability matrix markdown from the policy (projection — no existence needed). */
export function generateGuardrailMatrix(harnessDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const policy = JSON.parse(readFileSync(resolve(harnessDir, 'guardrails/guardrail-policy.json'), 'utf8'));
  const rt = policy.runtimes;
  const SYM = { enforced: '● enforced', 'ci-backstop': '◐ CI backstop', uncovered: '○ uncovered' };
  const header = `| Guardrail | Event | ${rt.join(' | ')} |`;
  const sep = `|---|---|${rt.map(() => '---').join('|')}|`;
  const rows = policy.guardrails.map((g) => {
    const cells = rt.map((r) => {
      const s = g.coverage?.[r]?.state;
      return SYM[s] || '?';
    });
    const gap = g.known_gap ? ' ⚠︎' : '';
    return `| \`${g.id}\`${gap} | ${g.event} | ${cells.join(' | ')} |`;
  });
  const legend = '_● enforced at the point of action · ◐ no local block but a CI gate catches it before merge (the enforcement of record) · ○ uncovered — no mechanism · ⚠︎ acknowledged gap (blocking, enforced nowhere). Generated from `guardrails/guardrail-policy.json` by `scripts/guardrail-policy-check.mjs`; do not edit by hand — run `node scripts/doc-integrity-check.mjs --fix`._';
  return [header, sep, ...rows, '', legend].join('\n');
}

export function run(cwd = process.cwd()) {
  const path = POLICY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return { present: false, findings: [] };
  let policy;
  try { policy = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { present: true, findings: [`guardrail-policy.json is not valid JSON: ${e.message}`] }; }
  // Mechanisms resolve relative to cwd (adopted layout: .claude/hooks/… and scripts/…).
  return { present: true, findings: evaluate(policy, (m) => existsSync(`${cwd}/${m}`)) };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, findings } = run();
  if (!present) {
    process.stdout.write('Guardrail-policy gate — no guardrail-policy.json; nothing to verify. OK\n');
    process.exit(0);
  }
  if (findings.length) {
    process.stderr.write('\nGuardrail-policy gate (rc.13 · WS4) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe guardrail policy must name only protections that exist and acknowledge every gap.\nSee guardrails/README.md and ../loom/references/governance.md.\n');
    process.exit(1);
  }
  process.stdout.write('Guardrail-policy gate (rc.13 · WS4) — coverage is explicit and honest; no implied protection. OK\n');
}
