// Tests for the intake check (2.3.0). The questionnaire is generated and a record says only what
// was said: both claims have a positive and a negative here. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkParity, checkRecord, run } from './intake-check.mjs';
import { loadSources, render } from '../intake/build-questionnaire.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTAKE = join(HARNESS, 'intake');
const SOURCES = loadSources(INTAKE);

const withTempIntake = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-intake-'));
  try { cpSync(INTAKE, dir, { recursive: true }); return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const goodRecord = () => ({
  schema: 'loom.intake-record/v1', authority: 'none', institution: 'Meridian Trust', generated_at: '2026-09-13T09:00:00.000Z',
  prefill_pack: 'uae-bank', questions_digest: SOURCES.questions_digest,
  answers: SOURCES.bank.questions.map((q, i) => i % 3 === 0
    ? { id: q.id, block: q.block, answer: 'yes', reference: 'Policy P-1', respondent_role: 'head of architecture', disposition: 'SOURCED' }
    : i % 3 === 1 ? { id: q.id, block: q.block, answer: 'we think so', respondent_role: 'head of brand', disposition: 'CLAIMED' }
    : { id: q.id, block: q.block, disposition: 'UNKNOWN' }),
  summary: { SOURCED: 14, CLAIMED: 14, UNKNOWN: 14 },
});

test('POSITIVE — the shipped questionnaire is in step with the bank and the packs', () => {
  assert.deepEqual(checkParity(INTAKE), []);
});

test('the render is deterministic and embeds every question id and every pack', () => {
  const a = render(INTAKE), b = render(INTAKE);
  assert.equal(a, b);
  for (const q of SOURCES.bank.questions) assert.ok(a.includes(`"id":"${q.id}"`), q.id);
  for (const p of SOURCES.prefill) assert.ok(a.includes(`"pack":"${p.pack}"`), p.pack);
  assert.ok(a.includes(SOURCES.questions_digest));
});

test('NEGATIVE — editing the bank without rebuilding fails parity', () => {
  withTempIntake((dir) => {
    const p = join(dir, 'questions.json');
    const bank = JSON.parse(readFileSync(p, 'utf8'));
    bank.questions.push({ id: 'I9', block: 'I', prompt: 'A new question', hint: '', type: 'text', home: 'x' });
    writeFileSync(p, JSON.stringify(bank, null, 2));
    const f = checkParity(dir);
    assert.ok(f.some((x) => /stale/.test(x)), JSON.stringify(f));
  });
});

test('NEGATIVE — a pack edit without rebuilding fails parity too', () => {
  withTempIntake((dir) => {
    const p = join(dir, 'prefill', 'uae-bank.json');
    const pack = JSON.parse(readFileSync(p, 'utf8'));
    pack.suggestions.A1 = 'Brand Guideline v9';
    writeFileSync(p, JSON.stringify(pack, null, 2));
    assert.ok(checkParity(dir).length === 1);
  });
});

test('POSITIVE — a well-formed record passes with no findings', () => {
  const r = checkRecord(goodRecord(), SOURCES);
  assert.deepEqual(r.findings, []);
});

test('a record that claims authority is refused', () => {
  const rec = goodRecord(); rec.authority = 'approved';
  assert.ok(checkRecord(rec, SOURCES).findings.some((f) => /authority: none/.test(f)));
});

test('a disposition that disagrees with its content is refused (a reference-less answer marked SOURCED)', () => {
  const rec = goodRecord();
  const a = rec.answers.find((x) => x.disposition === 'CLAIMED'); a.disposition = 'SOURCED';
  assert.ok(checkRecord(rec, SOURCES).findings.some((f) => /disagrees/.test(f)));
});

test('an answer to a question not in the bank is refused', () => {
  const rec = goodRecord(); rec.answers.push({ id: 'Z1', block: 'Z', disposition: 'UNKNOWN' });
  assert.ok(checkRecord(rec, SOURCES).findings.some((f) => /not a question in the bank/.test(f)));
});

test('a respondent that looks like a person\'s name is refused — roles only', () => {
  const rec = goodRecord(); rec.answers[0].respondent_role = 'Mariam Haddad';
  assert.ok(checkRecord(rec, SOURCES).findings.some((f) => /looks like a person's name/.test(f)));
});

test('an older question bank is a notice, not a failure', () => {
  const rec = goodRecord(); rec.questions_digest = 'sha256:' + '0'.repeat(64);
  const r = checkRecord(rec, SOURCES);
  assert.deepEqual(r.findings, []);
  assert.ok(r.notices.some((n) => /older question bank/.test(n)));
});

test('run() with no record present is OK and says nothing is there to import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-intake-cwd-'));
  try { const r = run(dir); assert.deepEqual(r.findings, []); assert.equal(r.record, null); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run() reads institution/intake/intake-record.json from the cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-intake-cwd-'));
  try {
    const p = join(dir, 'institution', 'intake'); cpSync(INTAKE, p, { recursive: true }); // any dir; we only need the path to exist
    writeFileSync(join(p, 'intake-record.json'), JSON.stringify(goodRecord()));
    const r = run(dir); assert.deepEqual(r.findings, []); assert.ok(r.record.endsWith('intake-record.json'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
