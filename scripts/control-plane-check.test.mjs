// Tests for the control-plane integrity gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate, ownersFor, ruleMatches, parseCodeowners, deriveTargets, CONTROL_TARGETS } from './control-plane-check.mjs';

const TARGETS = [
  '.claude/hooks/pii-guard.sh',
  '.claude/settings.json',
  'discovery/gates/validate.mjs',
  '.github/workflows/ci.yml',
  'CODEOWNERS',
];

const SHARIAH_TARGETS = ['docs/governance/shariah-rulings.json', 'docs/governance/issc-register.json'];

// The shipped template, with the placeholder owner swapped for a real one — the placeholder
// failing is a separate, deliberate control (see the PLACEHOLDER_OWNER tests below), and we
// are asking a different question here: does an adopter get these paths owned for free?
// Resolved across the BUNDLE and ADOPTED layouts: scripts/ ships into an adopted tree and this suite
// runs there, where the template has been installed as the repository-root CODEOWNERS.
const TEMPLATE_PATH = [
  fileURLToPath(new URL('../governance/CODEOWNERS.template', import.meta.url)),
  fileURLToPath(new URL('../CODEOWNERS', import.meta.url)),
].find(existsSync);
// The org prefix is whatever the layout carries: `@your-org/` in the bundle template, and in an
// adopted tree whatever that adopter substituted. Normalise BOTH so the assertions below can name
// one owner — what is being tested is that the dedicated lines exist and resolve to the right TEAM,
// never which organisation happens to own them.
const ORG = /@[A-Za-z0-9._-]+\//g;
const TEMPLATE = TEMPLATE_PATH
  ? readFileSync(TEMPLATE_PATH, 'utf8').replace(ORG, '@acme-bank/')
  : null;

const withoutLines = (text, drop) => text.split('\n').filter((l) => !drop.some((re) => re.test(l))).join('\n');

test('a global owner rule protects every control target', () => {
  const findings = evaluate('* @org/platform-admins\n', TARGETS);
  assert.deepEqual(findings, []);
});

test('specific per-area rules with owners protect their targets', () => {
  const co = [
    '/.claude/ @org/platform',
    '/discovery/gates/ @org/platform',
    '/.github/workflows/ @org/platform',
    '/CODEOWNERS @org/platform',
  ].join('\n');
  assert.deepEqual(evaluate(co, TARGETS), []);
});

test('a control target with no matching rule is reported', () => {
  // Owns everything EXCEPT the workflows directory.
  const co = ['/.claude/ @org/p', '/discovery/ @org/p', '/CODEOWNERS @org/p'].join('\n');
  const findings = evaluate(co, TARGETS);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /\.github\/workflows\/ci\.yml/);
});

test('a later zero-owner rule un-owns a control target (last-match-wins)', () => {
  // Global owner, then a bare pattern that removes ownership of the gates dir.
  const co = ['* @org/platform', '/discovery/gates/'].join('\n');
  const findings = evaluate(co, TARGETS);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /discovery\/gates\/validate\.mjs/);
});

test('an empty CODEOWNERS leaves every target unprotected', () => {
  assert.equal(evaluate('', TARGETS).length, TARGETS.length);
});

test('comments and blank lines are ignored', () => {
  const co = '# platform owns the control plane\n\n*   @org/platform  \n';
  assert.deepEqual(evaluate(co, TARGETS), []);
});

test('extension globs match by basename', () => {
  const rules = parseCodeowners('*.sh @org/sec\n');
  assert.deepEqual(ownersFor(rules, '.claude/hooks/pii-guard.sh'), ['@org/sec']);
  assert.deepEqual(ownersFor(rules, '.claude/settings.json'), []);
});

test('ruleMatches handles global, anchored dir, and exact forms', () => {
  assert.equal(ruleMatches('*', 'anything/at/all'), true);
  assert.equal(ruleMatches('/discovery/gates/', 'discovery/gates/validate.mjs'), true);
  assert.equal(ruleMatches('/discovery/gates/**', 'discovery/gates/validate.mjs'), true);
  assert.equal(ruleMatches('/CODEOWNERS', 'CODEOWNERS'), true);
  assert.equal(ruleMatches('/discovery/gates/', 'discovery/render/x.mjs'), false);
});

test('a placeholder-only owner fails the gate (an unadopted template is not a control)', () => {
  const findings = evaluate('* @your-org/platform-admins\n', TARGETS);
  assert.equal(findings.length, TARGETS.length);
  assert.match(findings[0], /placeholder team @your-org\/platform-admins/);
});

test('a real owner alongside a placeholder still protects the target', () => {
  assert.deepEqual(evaluate('* @your-org/platform-admins @acme-bank/platform\n', TARGETS), []);
});

test('the shipped default control-target list is non-empty and self-protecting', () => {
  assert.ok(CONTROL_TARGETS.length > 0);
  assert.ok(CONTROL_TARGETS.includes('CODEOWNERS'));
  assert.ok(CONTROL_TARGETS.includes('scripts/control-plane-check.mjs'));
  // HG-0014: the two paths an agent must never be able to write — the record of what the
  // committee determined, and the record of who may approve.
  for (const t of SHARIAH_TARGETS) assert.ok(CONTROL_TARGETS.includes(t), `${t} missing from CONTROL_TARGETS`);
});

test('the shipped template owns both Shari\'ah control-plane paths', () => {
  assert.deepEqual(evaluate(TEMPLATE, SHARIAH_TARGETS), []);
  const rules = parseCodeowners(TEMPLATE);
  // Owned by the secretariat specifically, not merely by whoever the blanket rule names —
  // the dedicated line is what keeps the builders' platform team out of a Shari'ah record.
  for (const t of SHARIAH_TARGETS) assert.deepEqual(ownersFor(rules, t), ['@acme-bank/shariah-secretariat']);
});

test('a non-Islamic adopter deleting the dedicated lines stays green on the blanket rule', () => {
  const co = withoutLines(TEMPLATE, [/shariah-secretariat/]);
  assert.deepEqual(evaluate(co, SHARIAH_TARGETS), []);
  assert.deepEqual(evaluate(co, TARGETS), []); // and nothing else regressed
});

test('with the dedicated lines AND the blanket /docs/governance/ rule gone, both paths report unprotected', () => {
  // Also drop the `*` default the template calls optional — an explicit-only adopter has no
  // catch-all, and leaving one in would own the paths by accident and hide the hole.
  const co = withoutLines(TEMPLATE, [/shariah-secretariat/, /^\/docs\/governance\/\s/, /^\*\s/]);
  const findings = evaluate(co, SHARIAH_TARGETS);
  assert.equal(findings.length, 2);
  assert.match(findings[0], /shariah-rulings\.json — not owned in CODEOWNERS/);
  assert.match(findings[1], /issc-register\.json — not owned in CODEOWNERS/);
});

// ── 2.1.0 — targets derived from the catalog (plan row 1.1) ─────────────────────────────────
// Resolved across the BUNDLE (governance/control-catalog.template.json) and ADOPTED
// (docs/governance/control-catalog.json) layouts, like TEMPLATE_PATH above.
const CATALOG_PATH = [
  fileURLToPath(new URL('../governance/control-catalog.template.json', import.meta.url)),
  fileURLToPath(new URL('../docs/governance/control-catalog.json', import.meta.url)),
].find(existsSync);
const CATALOG = CATALOG_PATH ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) : null;

test('every catalogued mechanism is a control-plane target (a catalogued gate cannot be unlisted)', () => {
  assert.ok(CATALOG, 'control catalog not found beside the gate');
  const derived = new Set(deriveTargets(CATALOG));
  const mechanisms = CATALOG.controls.map((c) => c.mechanism_ref).filter((m) => typeof m === 'string' && /\.(mjs|sh|yml)$/.test(m));
  assert.ok(mechanisms.length > 40, `expected a real catalog, saw ${mechanisms.length} mechanisms`);
  const missing = mechanisms.filter((m) => !derived.has(m));
  assert.deepEqual(missing, [], `catalogued mechanisms outside the target set: ${missing.join(', ')}`);
});

test('the derived set is a superset of the hand-listed base', () => {
  const derived = new Set(deriveTargets(CATALOG ?? { controls: [] }));
  for (const t of CONTROL_TARGETS) assert.ok(derived.has(t), `${t} dropped from the derived set`);
});

test('the hook data files that decide what the hooks bite on are targets', () => {
  for (const t of ['.claude/hooks/pii-patterns.json', '.claude/hooks/shariah-term-guard.sh', '.claude/hooks/shariah-surfaces.txt']) {
    assert.ok(CONTROL_TARGETS.includes(t), `${t} missing from CONTROL_TARGETS`);
  }
});

test('a mechanism the base list never heard of becomes a target once catalogued', () => {
  const derived = deriveTargets({ controls: [{ control_id: 'X', mechanism_ref: 'scripts/brand-new-check.mjs' }] });
  assert.ok(derived.includes('scripts/brand-new-check.mjs'));
  // a non-file mechanism (runbook, url, null) is not a path and is skipped, not crashed on
  const skipped = deriveTargets({ controls: [{ mechanism_ref: 'https://example.com/policy' }, { mechanism_ref: null }, { mechanism_ref: 'docs/governance/runbooks/x.md' }] });
  assert.deepEqual(skipped.filter((t) => !CONTROL_TARGETS.includes(t)), []);
});

test('an unlisted catalogued gate that CODEOWNERS does not cover is reported', () => {
  // no global default owner here: the question is whether an explicit-only CODEOWNERS misses a
  // gate that lives outside scripts/ — the template's `*` rule would answer it for us.
  const text = '/scripts/ @acme-bank/platform-admins\n/CODEOWNERS @acme-bank/platform-admins\n';
  const targets = deriveTargets({ controls: [{ mechanism_ref: 'tools/hidden-gate.mjs' }] }, ['CODEOWNERS']);
  const findings = evaluate(text, targets);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /tools\/hidden-gate\.mjs — not owned/);
});
