// Tests for the identifier legibility gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFile, isLoomOwned } from './id-legibility-check.mjs';

const GLOSSARY_LINK = 'See `discovery/GLOSSARY.md` for every identifier.';

test('a file whose first gate id is expanded passes', () => {
  const t = '# Doc\n\nThe D4 (No-solutioning boundary) gate stops leakage. Later D4 is bare.\n';
  assert.deepEqual(checkFile('a.md', t), []);
});

test('an em-dash expansion counts too', () => {
  const t = '# Doc\n\nCrossing the line is a gate failure (D4 — No-solutioning boundary).\n';
  assert.deepEqual(checkFile('a.md', t), []);
});

test('a file that links the glossary passes even with bare ids', () => {
  const t = `# Doc\n\n${GLOSSARY_LINK}\n\nD4 blocks it. D8 too. Q1b as well.\n`;
  assert.deepEqual(checkFile('a.md', t), []);
});

test('a file with a bare first gate id and no glossary link fails', () => {
  const t = '# Doc\n\nThe D4 gate stops leakage.\n';
  const issues = checkFile('a.md', t);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /D4/);
  assert.match(issues[0], /No-solutioning boundary/);
});

test('a floor decision id must carry the word Decision', () => {
  const t = `# Doc\n\n${GLOSSARY_LINK}\n\nPer D5.4 the form is routed.\n`;
  const issues = checkFile('a.md', t);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Decision D5\.4/);
});

test('a correctly written floor decision id passes', () => {
  const t = `# Doc\n\n${GLOSSARY_LINK}\n\nPer Decision D5.4 the form is routed.\n`;
  assert.deepEqual(checkFile('a.md', t), []);
});

test('a bare floor decision id is NOT also reported as a bare gate id', () => {
  // Regression: /\bD([1-9])\b/ matches "D5" inside "D5.4" because the word boundary holds
  // before the dot. Without a lookahead, one mistake would be reported as two, and a
  // correctly-written "Decision D5.4" would be flagged as a bare gate id.
  const t = '# Doc\n\nPer Decision D5.4 the form is routed.\n';
  assert.deepEqual(checkFile('a.md', t), []);
});

test('DR-* register ids are never mistaken for floor decision ids', () => {
  const t = `# Doc\n\n${GLOSSARY_LINK}\n\nRisk DR-1.1-001 maps to CTRL-001.\n`;
  assert.deepEqual(checkFile('a.md', t), []);
});

test('a file with no ids at all passes', () => {
  assert.deepEqual(checkFile('a.md', '# Doc\n\nNothing here.\n'), []);
});

test('a file that establishes "Decision" once may use bare floor ids after', () => {
  // First use per file, matching how the prose is written. Demanding the word on all forty
  // occurrences of a floor-heavy table makes it harder to read, not easier.
  const t = '# Floor\n\nSee `GLOSSARY.md`.\n\n| Decision D0.1 | a |\n| D3.1 | b |\n| D5.4 | c |\n';
  assert.deepEqual(checkFile('floor/x.md', t), []);
});

test('only the FIRST bare floor id is reported, not every one', () => {
  const t = '# Floor\n\nSee `GLOSSARY.md`.\n\n| D3.1 | b |\n| D5.4 | c |\n| D6.3 | d |\n';
  const issues = checkFile('floor/x.md', t);
  assert.equal(issues.length, 1, 'one finding per file, not a pile: ' + JSON.stringify(issues));
  assert.match(issues[0], /D3\.1/);
});

test('the floor-id regex does not leak state between files', () => {
  // FLOOR_DECISION is /g — a stale lastIndex would make the second call miss.
  const t = '# Doc\n\nSee `GLOSSARY.md`.\n\nPer D5.4 the form is routed.\n';
  assert.equal(checkFile('a.md', t).length, 1);
  assert.equal(checkFile('b.md', t).length, 1, 'second call must find it too');
});

test('isLoomOwned scopes the gate to the trees the harness installs', () => {
  assert.equal(isLoomOwned('discovery/DISCOVERY.md'), true);
  assert.equal(isLoomOwned('docs/governance/runbooks/x.md'), true);
  assert.equal(isLoomOwned('.claude/skills/discovery/SKILL.md'), true);
  assert.equal(isLoomOwned('plugins/middleleap-loom/README.md'), true);
  // An adopter's own docs are none of this gate's business — they never opted into the
  // Loom's vocabulary and must not fail their build for using "D1" as a diagram label.
  assert.equal(isLoomOwned('README.md'), false);
  assert.equal(isLoomOwned('docs/architecture/overview.md'), false);
  assert.equal(isLoomOwned('plugins/middleleap-open-finance/README.md'), false);
});

test('generated floor forms are out of bounds — the pointer belongs in their template', () => {
  // Editing a generated form is how it stops matching its source; parity would fail.
  assert.equal(isLoomOwned('floor/catalog-b/adr-inbox-card.md'), false);
  assert.equal(isLoomOwned('floor/templates/problem-statement.md'), false);
  assert.equal(isLoomOwned('plugins/middleleap-loom/skills/loom-adopt/harness/floor/catalog-c/x.md'), false);
});

test('completed discovery runs are out of bounds — a run is evidence, not documentation', () => {
  // Found by upgrading a real adopted repo: the gate failed the build on seven artifacts of a
  // finished, gate-green, already-reviewed run. A run scaffolded from the templates inherits
  // their pointer, so policing finished runs only ever catches runs written before this gate
  // existed — at the cost of pushing people to edit their own evidence.
  assert.equal(isLoomOwned('discovery/runs/sme-liquidity/handoff.md'), false);
  assert.equal(isLoomOwned('discovery/runs/any-slug/problem-statement.md'), false);
  // The machinery around the runs is still in scope.
  assert.equal(isLoomOwned('discovery/DISCOVERY.md'), true);
  assert.equal(isLoomOwned('discovery/templates/handoff.md'), true);
});

test('accepted ADRs are out of bounds — a signed record is not amended for legibility', () => {
  // An ADR is the decision as it was taken, signed and dated. Editing one after approval to
  // add a pointer is precisely what a governance method must not do casually.
  assert.equal(isLoomOwned('docs/adrs/0001-api-compatibility.md'), false);
  assert.equal(isLoomOwned('docs/adr/0007-something.md'), false);
});

test('institutional BrainKit content is out of bounds — it is not the Loom to write in', () => {
  // A BrainKit is the institution's own content, sealed by digest. A gate demanding the
  // Loom's vocabulary there would assert an ownership the method explicitly disclaims.
  assert.equal(isLoomOwned('institution/brainkit/architecture.md'), false);
  assert.equal(isLoomOwned('plugins/middleleap-loom/skills/loom-adopt/harness/brainkit/identity/design.md'), false);
  assert.equal(isLoomOwned('plugins/middleleap-loom/skills/loom-adopt/harness/brainkit-example/institution/brainkit/terminology.md'), false);
});

test('the reported issue names the file and the line', () => {
  const t = '# Doc\n\nline two\n\nThe D6 gate.\n';
  const issues = checkFile('some/path.md', t);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^some\/path\.md:5:/);
});
