// Tests for the guardrail-policy gate (rc.13 · WS4): policy honesty + hostile scenarios driven
// through the real Claude Code adapters. Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './guardrail-policy-check.mjs';

// TIER-AWARE (rc.24): this asserts properties of content that a `core` or `governed` adoption
// deliberately does not install. Absent content is not a failing test — it is a tier boundary — so
// these skip cleanly, the same "inert where absent" pattern the doc-integrity gate uses.
const GUARDRAILS_PRESENT = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'guardrails'));

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allExist = () => true;
// The hooks live at hooks/ in the bundle and .claude/hooks/ in an adopted repo — resolve either.
const HOOKS_DIR = ['.claude/hooks', 'hooks'].map((d) => join(HARNESS, d)).find((d) => existsSync(join(d, 'pii-guard.sh')));
// A policy mechanism resolves in either layout (.claude/hooks/foo.sh ↔ hooks/foo.sh; scripts/… as-is).
const mechExists = (m) => [m, m.replace(/^\.claude\/hooks\//, 'hooks/')].some((x) => existsSync(join(HARNESS, x)));

const guardrail = (over = {}) => ({
  id: 'g1', event: 'before-file-write', decision: 'block', description: 'x',
  coverage: { 'claude-code': { state: 'enforced', mechanism: 'hooks/x.sh' }, ci: { state: 'uncovered' } },
  ...over,
});
const policy = (guardrails) => ({ schema_version: '1.0', runtimes: ['claude-code', 'ci'], events: ['before-file-write', 'before-test-modification'], guardrails });

test('a well-formed, honest policy passes', () => {
  assert.deepEqual(evaluate(policy([guardrail()]), allExist), []);
});

test('an enforced state naming a NON-existent mechanism fails — no implied coverage', () => {
  const f = evaluate(policy([guardrail()]), (m) => m !== 'hooks/x.sh');
  assert.ok(f.some((x) => /does not exist — no implied coverage/.test(x)));
});

test('an uncovered state that names a mechanism fails — no implied protection', () => {
  const g = guardrail({ coverage: { 'claude-code': { state: 'uncovered', mechanism: 'hooks/x.sh' }, ci: { state: 'uncovered' } } });
  assert.ok(evaluate(policy([g]), allExist).some((x) => /uncovered but names a mechanism/.test(x)));
});

test('a blocking guardrail enforced NOWHERE without known_gap fails — no silent gap', () => {
  const g = guardrail({ coverage: { 'claude-code': { state: 'uncovered' }, ci: { state: 'uncovered' } } });
  assert.ok(evaluate(policy([g]), allExist).some((x) => /set known_gap:true to acknowledge/.test(x)));
});

test('a blocking guardrail enforced nowhere WITH known_gap:true is accepted (acknowledged)', () => {
  const g = guardrail({ known_gap: true, coverage: { 'claude-code': { state: 'uncovered' }, ci: { state: 'uncovered' } } });
  assert.deepEqual(evaluate(policy([g]), allExist), []);
});

test('a runtime with no coverage stated fails — every runtime must be declared', () => {
  const g = guardrail({ coverage: { 'claude-code': { state: 'enforced', mechanism: 'hooks/x.sh' } } });
  assert.ok(evaluate(policy([g]), allExist).some((x) => /no coverage declared for runtime "ci"/.test(x)));
});

// The SHIPPED policy must be well-formed and honest, resolving mechanisms in the bundle layout
// (.claude/hooks/foo.sh → hooks/foo.sh).
test('the shipped guardrail policy is honest — every claimed mechanism exists', { skip: !GUARDRAILS_PRESENT && 'guardrails/ not installed at this tier' }, () => {
  const p = JSON.parse(readFileSync(join(HARNESS, 'guardrails/guardrail-policy.json'), 'utf8'));
  assert.deepEqual(evaluate(p, mechExists), []);
});

// ---- Hostile scenarios through the claude-code adapter (prove `enforced` is REAL) ----
// Skip cleanly in a bare layout with no hooks (same pattern as the attestation/register tests).
const runHook = (script, input, opts = {}) =>
  spawnSync('bash', [join(HOOKS_DIR, script)], { input: JSON.stringify(input), encoding: 'utf8', ...opts }).stdout || '';

test('hostile: a PII-shaped literal is DENIED by the claude-code pii-guard adapter', { skip: !HOOKS_DIR }, () => {
  const out = runHook('pii-guard.sh', { tool_input: { content: 'Emirates ID 784-1990-1234567-1' } });
  assert.match(out, /"permissionDecision":\s*"deny"/);
});

test('hostile: a synthetic (999-prefixed) id is ALLOWED — the guard is not a blunt block', { skip: !HOOKS_DIR }, () => {
  const out = runHook('pii-guard.sh', { tool_input: { content: 'synthetic 999-1990-1234567-1' } });
  assert.doesNotMatch(out, /"permissionDecision":\s*"deny"/);
});

test('hostile: a test-weakening edit is DENIED by the claude-code test-tripwire adapter', { skip: !HOOKS_DIR }, () => {
  // test-tripwire only fires on a spec/test path inside a feature/claude branch.
  const repo = mkdtempSync(join(tmpdir(), 'gr-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'claude/test'], { cwd: repo });
    const out = runHook('test-tripwire.sh',
      { tool_input: { file_path: 'tests/foo.spec.ts', new_string: `it.${'skip'}("x", () => {})` } },
      { env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
    assert.match(out, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// ---- F3: the PII shapes are MOUNTED DATA, and the mount is part of the control ----
// hooks/pii-patterns.json replaced two hardcoded shapes. Two properties have to hold together, and
// they pull in opposite directions: a new jurisdiction must be addable WITHOUT touching the script
// (or the shapes are still code), and a pattern file that will not load must DENY (or the cheapest
// attack on the guard — delete one file — produces a run that looks clean because nothing was read).
// Each case runs against a COPY of the hooks directory: the guard resolves its patterns beside
// itself, deliberately not from an environment variable, since an env-overridable pattern path is a
// disarm switch.
const hooksCopy = () => {
  const d = mkdtempSync(join(tmpdir(), 'gr-hooks-'));
  cpSync(HOOKS_DIR, d, { recursive: true });
  return d;
};
const runIn = (dir, script, input) =>
  spawnSync('bash', [join(dir, script)], { input: JSON.stringify(input), encoding: 'utf8' }).stdout || '';

test('F3: a NEW pattern row denies with no edit to pii-guard.sh — the shapes are data', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    const before = readFileSync(join(dir, 'pii-guard.sh'), 'utf8');
    const patterns = JSON.parse(readFileSync(join(dir, 'pii-patterns.json'), 'utf8'));
    patterns.patterns.push({
      id: 'xx-national-id', jurisdiction: 'XX', match: 'NID[0-9]{9}', allow: null,
      reason: 'PII guard: XX national-id-shaped literal detected.',
    });
    writeFileSync(join(dir, 'pii-patterns.json'), JSON.stringify(patterns, null, 2));
    const out = runIn(dir, 'pii-guard.sh', { tool_input: { content: 'ref NID-123-456-789' } });
    assert.match(out, /"permissionDecision":\s*"deny"/);
    assert.match(out, /XX national-id-shaped literal/);
    assert.equal(readFileSync(join(dir, 'pii-guard.sh'), 'utf8'), before, 'the guard script must not need editing to add a shape');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F3 fail-closed: a MISSING pattern file DENIES — a guard that cannot load its patterns must not pass', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    rmSync(join(dir, 'pii-patterns.json'));
    const out = runIn(dir, 'pii-guard.sh', { tool_input: { content: 'entirely innocent text' } });
    assert.match(out, /"permissionDecision":\s*"deny"/);
    assert.match(out, /pattern file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F3 fail-closed: an UNPARSEABLE pattern file DENIES', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'pii-patterns.json'), '{ this is not json');
    const out = runIn(dir, 'pii-guard.sh', { tool_input: { content: 'entirely innocent text' } });
    assert.match(out, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F3 fail-closed: an EMPTY pattern list DENIES — zero shapes is not a clean scan', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'pii-patterns.json'), JSON.stringify({ patterns: [] }));
    const out = runIn(dir, 'pii-guard.sh', { tool_input: { content: 'entirely innocent text' } });
    assert.match(out, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F3 fail-closed: a MALFORMED row DENIES rather than being skipped', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'pii-patterns.json'), JSON.stringify({ patterns: [{ id: 'broken', jurisdiction: 'XX', allow: null, reason: 'x' }] }));
    const out = runIn(dir, 'pii-guard.sh', { tool_input: { content: 'entirely innocent text' } });
    assert.match(out, /"permissionDecision":\s*"deny"/);
    assert.match(out, /malformed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The evasion regression that produced the normalisation in the first place: a DOT-separated
// Emirates ID slipped a space/hyphen-only strip, and a lowercase IBAN dodged the uppercase pattern.
// Moving the shapes into JSON must not quietly move the normalisation with them.
test('regression: separator/case evasion still fails — normalisation survived the move to data', { skip: !HOOKS_DIR }, () => {
  for (const content of ['784.1990.1234567.1', '78 4-1990-1234567-1', 'ae07 0331 2345 6789 0123 456']) {
    const out = runHook('pii-guard.sh', { tool_input: { content } });
    assert.match(out, /"permissionDecision":\s*"deny"/, `evasion not caught: ${content}`);
  }
});

// ---- The Shari'ah terminology tripwire: DORMANT unless a surface is declared ----
// The central idiom, at hook level. A conventional adopter must never be blocked by an Islamic
// control, so the shipped surfaces file is EMPTY and the hook is a no-op until someone opts a path in.
test('shariah-term-guard is a NO-OP as shipped — no declared surface, no finding', { skip: !HOOKS_DIR }, () => {
  const out = runHook('shariah-term-guard.sh', {
    tool_input: { file_path: 'docs/product/islamic/savings.md', content: 'This account pays interest monthly.' },
  });
  assert.doesNotMatch(out, /"permissionDecision":\s*"deny"/);
});

test('shariah-term-guard DENIES interest prose once a surface is opted in', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'shariah-surfaces.txt'), '# opted in\ndocs/product/islamic/\n');
    const out = runIn(dir, 'shariah-term-guard.sh', {
      tool_input: { file_path: 'docs/product/islamic/savings.md', content: 'This account pays an interest rate of 4%.' },
    });
    assert.match(out, /"permissionDecision":\s*"deny"/);
    assert.match(out, /interest rate/);
    assert.match(out, /shariah-surfaces\.txt/, 'the deny must name the file that put this path in scope');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shariah-term-guard leaves paths OUTSIDE the declared surfaces alone', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'shariah-surfaces.txt'), 'docs/product/islamic/\n');
    const out = runIn(dir, 'shariah-term-guard.sh', {
      tool_input: { file_path: 'docs/product/conventional/savings.md', content: 'This account pays an interest rate of 4%.' },
    });
    assert.doesNotMatch(out, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The false positive that would get this hook switched off within a week: a mapping layer MUST be
// able to name the standard's field it is mapping AWAY from.
test('shariah-term-guard does NOT trip on identifiers, backticks or fenced code', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'shariah-surfaces.txt'), 'docs/product/islamic/\n');
    const content = 'Map `InterestRate` and interest_rate to ProfitRate.\n```json\n{"interest rate": 1}\n```\nThe customer receives a profit.';
    const out = runIn(dir, 'shariah-term-guard.sh', { tool_input: { file_path: 'docs/product/islamic/mapping.md', content } });
    assert.doesNotMatch(out, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shariah-term-guard: "Apr 2026" is a month, "APR" is not — caps terms match case-sensitively', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'shariah-surfaces.txt'), 'docs/product/islamic/\n');
    const month = runIn(dir, 'shariah-term-guard.sh', { tool_input: { file_path: 'docs/product/islamic/a.md', content: 'Effective from Apr 2026.' } });
    assert.doesNotMatch(month, /"permissionDecision":\s*"deny"/);
    const apr = runIn(dir, 'shariah-term-guard.sh', { tool_input: { file_path: 'docs/product/islamic/a.md', content: 'The APR is 3.5%.' } });
    assert.match(apr, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shariah-term-guard: "conflict of interest" is not riba — idiomatic uses are allowed through', { skip: !HOOKS_DIR }, () => {
  const dir = hooksCopy();
  try {
    writeFileSync(join(dir, 'shariah-surfaces.txt'), 'docs/product/islamic/\n');
    const out = runIn(dir, 'shariah-term-guard.sh', {
      tool_input: { file_path: 'docs/product/islamic/a.md', content: 'We manage any conflict of interest in the best interests of the customer.' },
    });
    assert.doesNotMatch(out, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Both hooks must fail CLOSED with jq absent — a non-zero exit is a NON-BLOCKING error in the
// runtime, so a guard that merely errors has disarmed itself silently.
test('pii-guard DENIES when jq is absent, and still exits 0', { skip: !HOOKS_DIR }, () => {
  const empty = mkdtempSync(join(tmpdir(), 'gr-nopath-'));
  try {
    const r = spawnSync('/bin/bash', [join(HOOKS_DIR, 'pii-guard.sh')], {
      input: JSON.stringify({ tool_input: { file_path: 'x.md', content: 'x' } }),
      encoding: 'utf8', env: { PATH: empty },
    });
    assert.match(r.stdout || '', /"permissionDecision":\s*"deny"/, 'pii-guard must deny without jq');
    assert.equal(r.status, 0, 'pii-guard must exit 0 — a non-zero exit is a non-blocking error');
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

// The Shari'ah term guard fails closed like its sibling, but ONLY once the institution has opted in.
// The distinction is the whole reason this test is separate, and it encodes a real defect that was
// shipped and caught: the jq deny used to be evaluated BEFORE the scope check, so on a machine
// without jq a control nobody had opted into denied every write in the repository. Dormancy that
// depends on an external binary being installed is not dormancy — so the opt-in question is answered
// with shell builtins alone, and only a repository that HAS declared a surface can fail closed here.
test('the Shari\'ah term guard is DORMANT without jq until a surface is declared, then fails closed', { skip: !HOOKS_DIR }, () => {
  const empty = mkdtempSync(join(tmpdir(), 'gr-nopath-'));
  const stage = mkdtempSync(join(tmpdir(), 'gr-surfaces-'));
  try {
    cpSync(join(HOOKS_DIR, 'shariah-term-guard.sh'), join(stage, 'shariah-term-guard.sh'));
    const run = () => spawnSync('/bin/bash', [join(stage, 'shariah-term-guard.sh')], {
      input: JSON.stringify({ tool_input: { file_path: 'x.md', content: 'x' } }),
      encoding: 'utf8', env: { PATH: empty },
    });

    // No surfaces file at all — the state of every adopter with no Islamic product.
    let r = run();
    assert.equal(r.status, 0, 'must exit 0');
    assert.doesNotMatch(r.stdout || '', /"permissionDecision"/, 'no surfaces file ⇒ no decision at all');

    // A surfaces file that declares nothing (the shipped state) is equally dormant.
    writeFileSync(join(stage, 'shariah-surfaces.txt'), '# ADOPT: one path prefix per line\n\n');
    r = run();
    assert.equal(r.status, 0, 'must exit 0');
    assert.doesNotMatch(r.stdout || '', /"permissionDecision"/, 'comments-only surfaces list ⇒ still dormant');

    // One declared surface — the institution has opted in, so a guard that cannot read the write
    // must now refuse it rather than wave it through.
    writeFileSync(join(stage, 'shariah-surfaces.txt'), 'docs/customer/\n');
    r = run();
    assert.equal(r.status, 0, 'must exit 0 — a non-zero exit is a non-blocking error, i.e. a silent disarm');
    assert.match(r.stdout || '', /"permissionDecision":\s*"deny"/, 'a declared surface without jq must fail closed');
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
  }
});

test('the ci-backstop mechanism for every guardrail exists (the enforcement of record is real)', { skip: !GUARDRAILS_PRESENT && 'guardrails/ not installed at this tier' }, () => {
  const p = JSON.parse(readFileSync(join(HARNESS, 'guardrails/guardrail-policy.json'), 'utf8'));
  for (const g of p.guardrails) {
    for (const [rt, c] of Object.entries(g.coverage)) {
      if (c.state === 'ci-backstop') assert.ok(existsSync(join(HARNESS, c.mechanism)), `${g.id}/${rt} backstop ${c.mechanism} must exist`);
    }
  }
});
