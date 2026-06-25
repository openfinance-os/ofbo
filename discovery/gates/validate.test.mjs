// Tests for the discovery gate validator. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRun } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTER_DIR = join(ROOT, 'docs/governance/data-risk-register');
const BRAND_PATH = join(ROOT, 'discovery/brand/design.md');

// Pick real, resolvable ids from the mounted register so D6 referential integrity passes.
const controls = JSON.parse(readFileSync(join(REGISTER_DIR, 'controls.json'), 'utf8'));
const CTRL = controls[0].control_id;
const DR = 'DR-2.1'; // Consent Management Risk — known category in the OFBO register

const FM = 'design_profile: discovery/brand/design.md';

const FILES = {
  'research-log.md': `---\nartifact: research-log\n${FM}\n---\n## Signals\n| S-001 | care queue | revoke ack lag observed | pain | high |\n`,
  'synthesis.md': `---\nartifact: synthesis\n${FM}\n---\n## Themes\n| T-1 | revoke latency erodes trust | S-001 | regulatory + trust risk |\n## Prioritisation\n- **Method:** impact × reach ÷ effort\n`,
  'problem-statement.md': `---\nartifact: problem-statement\n${FM}\n---\n## The problem (falsifiable)\nFor a care agent (synthetic) handling a revoke, today acknowledgement lags, per S-001.\n## Target user\nCare agent, synthetic persona, during a consent revoke.\n## Success measures\n| Measure | Baseline | Target | How |\n| Revoke ack | 12s | under 5s | sim metric |\n## Stakeholders & scope (D3)\n| Care lead | in | owns the queue |\n- Out of scope (explicit): bulk export tooling\n`,
  'data-governance.md': `---\nartifact: data-governance\n${FM}\n---\n## Risk mapping\n| consent record | ${DR} | High | PDPL Art. 5 | ${CTRL} |\n## Residual-risk verdict (D6)\n- **Acceptable for delivery?** Conditional — monitor fee variance\n`,
  'prototype.md': `---\nartifact: prototype\n${FM}\nfidelity: low\nwireframe: wireframe.html\n---\n## What this prototype tests\nMakes the revoke-acknowledgement delay tangible for a care agent.\n`,
  'wireframe.html': `<!doctype html><html><head><!-- brand-profile: discovery/brand/design.md@v1 -->\n<style>body{font-family:"Inter","Helvetica Neue",Arial,sans-serif;background:#F7F8FA;color:#0B1221}.primary{background:#1F4DB8;color:#FFFFFF}</style></head><body>wireframe</body></html>`,
  'handoff.md': `---\nartifact: handoff\n${FM}\n---\n## Problem\nRevoke acknowledgement lags.\n## What delivery owns now\nDelivery authors the solution from the validated brief.\n`,
};

function makeRun(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'disc-run-'));
  const files = { ...FILES, ...overrides };
  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue; // omit this artifact
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const OPTS = { registerDir: REGISTER_DIR, brandPath: BRAND_PATH };
const gateOf = (res, id) => res.gates.find((g) => g.id === id);

test('a complete run passes all gates', () => {
  const dir = makeRun();
  try {
    const res = validateRun(dir, OPTS);
    assert.ok(res.ok, 'expected ok; failures: ' + JSON.stringify(res.gates.filter((g) => g.status === 'fail')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D1 fails without a success measure', () => {
  const dir = makeRun({ 'problem-statement.md': FILES['problem-statement.md'].replace(/## Success measures[\s\S]*?## Stakeholders/, '## Success measures\n## Stakeholders') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D1').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D2 fails when a cited signal is undefined', () => {
  const dir = makeRun({ 'synthesis.md': FILES['synthesis.md'].replace('S-001', 'S-999') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D2').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D3 fails without stakeholders', () => {
  const dir = makeRun({ 'problem-statement.md': FILES['problem-statement.md'].replace(/\| Care lead \| in \| owns the queue \|/, '') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D3').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D4 fails on solutioning (an API route)', () => {
  const dir = makeRun({ 'problem-statement.md': FILES['problem-statement.md'] + '\nWe will add POST /consents to fix it.\n' });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D4').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D5 fails without a prioritisation method', () => {
  const dir = makeRun({ 'synthesis.md': FILES['synthesis.md'].replace(/- \*\*Method:\*\*.*/, '') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D5').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D6 fails when a control id does not resolve', () => {
  const dir = makeRun({ 'data-governance.md': FILES['data-governance.md'].replace(CTRL, 'CTRL-DOES-NOT-EXIST') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D6').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D6 skips when the register is not mounted', () => {
  const dir = makeRun();
  try { assert.equal(gateOf(validateRun(dir, { ...OPTS, register: null }), 'D6').status, 'skip'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D7 fails on a raw (non-token) colour in the wireframe', () => {
  const dir = makeRun({ 'wireframe.html': FILES['wireframe.html'].replace('#1F4DB8', '#ABCDEF') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D7').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D7 fails when a markdown artifact omits the design profile', () => {
  const dir = makeRun({ 'handoff.md': FILES['handoff.md'].replace(FM + '\n', '') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D7').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D8 fails without a prototype', () => {
  const dir = makeRun({ 'prototype.md': null });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D8').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D8 fails when the wireframe asset is missing', () => {
  const dir = makeRun({ 'wireframe.html': null });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D8').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D8 fails when the prototype claims delivery fidelity', () => {
  const dir = makeRun({ 'prototype.md': FILES['prototype.md'].replace('fidelity: low', 'fidelity: high') });
  try { assert.equal(gateOf(validateRun(dir, OPTS), 'D8').status, 'fail'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
