// Tests for the HG-0009 develop-diverge gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, sdrRefs, check, MIN_DIRECTIONS } from './develop-direction-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = [join(HARNESS, 'delivery/templates/solution-direction-record.md'), join(HARNESS, 'delivery/templates/solution-direction-record.md.template')].find(existsSync);

const SDR = `---
artifact: solution-direction-record
stage: develop
run: "revoke-latency"
handoff: "discovery/runs/revoke-latency/handoff.md"
---
# Solution direction — revoke-latency

## The directions explored

| # | Direction | Shape in one line | Killed by / survived because |
|---|---|---|---|
| 1 | Reuse-first: cache invalidation event | fan-out on the existing consent bus | survived — no new primitive |
| 2 | Greenfield: consent state service | a new service owning revocation | killed — new primitive, ADR cost |
| 3 | Risk-first: synchronous revoke path | block until every cache acks | killed — SLA breach at peak |

## The judgment

| Criterion (source) | Dir 1 | Dir 2 | Dir 3 |
|---|---|---|---|
| Revoke ack under 5s (D1) | yes | yes | yes |
| No new PII store (D6) | yes | no | yes |
| Institutional fit | reuse | new primitive | reuse |

## The chosen direction

Direction 1: emit a revocation event on the consent bus; each cache subscribes and invalidates.
`;

test('a record with three directions, a judged criterion and a chosen direction passes', () => {
  assert.deepEqual(evaluate(SDR), []);
});

test('fewer than three directions is a straight line, not a diamond', () => {
  const two = SDR.replace(/\| 3 \|.*\n/, '');
  const f = evaluate(two);
  assert.ok(f.some((m) => new RegExp(`2 direction\\(s\\) explored, HG-0009 requires at least ${MIN_DIRECTIONS}`).test(m)), f.join('; '));
  // placeholder rows do not count as directions
  const placeholders = SDR.replace('| 3 | Risk-first: synchronous revoke path | block until every cache acks | killed — SLA breach at peak |', '| 3 | <direction> | | |');
  assert.ok(evaluate(placeholders).some((m) => /2 direction/.test(m)));
});

test('a judgment with no criterion, or one that scores nothing, is a finding', () => {
  const none = SDR.replace(/## The judgment[\s\S]*?## The chosen/, '## The judgment\n\n| Criterion (source) | Dir 1 | Dir 2 | Dir 3 |\n|---|---|---|---|\n\n## The chosen');
  assert.ok(evaluate(none).some((m) => /names no criterion/.test(m)));
  const unscored = SDR.replace(/\| Revoke ack under 5s \(D1\) \| yes \| yes \| yes \|\n\| No new PII store \(D6\) \| yes \| no \| yes \|\n\| Institutional fit \| reuse \| new primitive \| reuse \|/, '| Revoke ack under 5s (D1) | | | |');
  assert.ok(evaluate(unscored).some((m) => /scores nothing/.test(m)), evaluate(unscored).join('; '));
});

test('a record that never converged, or names no hand-off, is a finding', () => {
  const open = SDR.replace(/## The chosen direction[\s\S]*$/, '## The chosen direction\n\n');
  assert.ok(evaluate(open).some((m) => /no chosen direction/.test(m)));
  const orphan = SDR.replace('handoff: "discovery/runs/revoke-latency/handoff.md"', 'handoff: "<slug>"');
  assert.ok(evaluate(orphan).some((m) => /names no hand-off/.test(m)));
});

test('the shipped SDR template, unfilled, fails every structural check (so an unfilled copy cannot pass)', { skip: !TEMPLATE_PATH && 'template not present at this tier' }, () => {
  const f = evaluate(readFileSync(TEMPLATE_PATH, 'utf8'), 'template');
  assert.ok(f.some((m) => /direction\(s\) explored/.test(m)) && f.some((m) => /judgment/.test(m)) && f.some((m) => /no chosen direction/.test(m)), f.join('; '));
});

test('sdrRefs reads every nesting style, and check() follows the backlog to a missing record', () => {
  assert.deepEqual(sdrRefs('- id: STORY-1\n  sdr: docs/develop/a.md\n- { id: STORY-2, sdr: "docs/develop/b.md", x: 1 }\n- id: STORY-3\n  sdr: docs/develop/a.md'), ['docs/develop/a.md', 'docs/develop/b.md']);
  const dir = mkdtempSync(join(tmpdir(), 'ddc-'));
  try {
    mkdirSync(join(dir, 'docs/develop'), { recursive: true });
    writeFileSync(join(dir, 'docs/develop/revoke-latency.md'), SDR);
    writeFileSync(join(dir, 'docs/backlog.yaml'), '- id: STORY-1\n  status: pending\n  discovery: revoke-latency\n  sdr: docs/develop/revoke-latency.md\n- id: STORY-2\n  sdr: docs/develop/ghost.md\n');
    const { findings, examined } = check(dir);
    assert.equal(examined, 1);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /sdr: docs\/develop\/ghost\.md — no such record/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a repository with no records yet reports that it examined nothing rather than passing silently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ddc-'));
  try {
    const { findings, notices, examined } = check(dir);
    assert.deepEqual(findings, []);
    assert.equal(examined, 0);
    assert.match(notices[0], /nothing for HG-0009 to examine/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
