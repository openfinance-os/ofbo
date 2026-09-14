// The intake check (2.3.0). Two things, and it is worth being plain that neither is a control:
//
//   1. GENERATED-DOC PARITY. intake/questionnaire.html must equal what build-questionnaire.mjs
//      renders from intake/questions.json + intake/prefill/*.json. Edit the bank without rebuilding
//      and this fails — a respondent must be asked the questions the skill will import.
//   2. RECORD SHAPE. If institution/intake/intake-record.json exists (an adopted repo, or --record
//      <path>), it must match intake-record.schema.json's intent: the schema id, authority: none,
//      answers whose ids are in the bank, a disposition that AGREES with the answer/reference
//      pair (an answer with a reference is SOURCED, without one CLAIMED, none UNKNOWN), roles
//      not names (a heuristic: an "Answered by" that looks like "Firstname Lastname" is flagged),
//      and a questions_digest that matches the current bank (a mismatch is a notice, not a fail:
//      the record is still a record of what was said, against an older bank).
//
// WHAT IT IS NOT. It does not judge whether an answer is true, whether a reference resolves, or
// whether the institution is ready. An intake record has authority: none, and this check reads
// the field to make sure it says so — nothing more.
//
//   node scripts/intake-check.mjs                 # parity + record if present
//   node scripts/intake-check.mjs --fix           # rebuild the questionnaire, then check
//   node scripts/intake-check.mjs --record <p>    # check a specific record file
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { render, loadSources, INTAKE as BUNDLE_INTAKE } from '../intake/build-questionnaire.mjs';

export const RECORD_LOCATION = 'institution/intake/intake-record.json';
const NAME_SHAPE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,2}$/; // "Mariam Haddad" — a name, not a role

/** Parity: the shipped HTML equals a fresh render. */
export function checkParity(intakeDir = BUNDLE_INTAKE) {
  const out = join(intakeDir, 'questionnaire.html');
  if (!existsSync(out)) return [`${out}: missing — run node intake/build-questionnaire.mjs`];
  const have = readFileSync(out, 'utf8');
  const want = render(intakeDir);
  return have === want ? [] : ['intake/questionnaire.html is stale — the question bank or a pre-fill pack changed without a rebuild (node scripts/intake-check.mjs --fix)'];
}

/** Record shape. Returns { findings, notices }. */
export function checkRecord(record, sources) {
  const findings = [], notices = [];
  if (!record || typeof record !== 'object') return { findings: ['record is not an object'], notices };
  if (record.schema !== 'loom.intake-record/v1') findings.push(`schema is ${JSON.stringify(record.schema)} — expected loom.intake-record/v1`);
  if (record.authority !== 'none') findings.push(`authority is ${JSON.stringify(record.authority)} — an intake record is never authoritative; it must say authority: none`);
  if (!(typeof record.institution === 'string' && record.institution.trim())) findings.push('institution is empty');
  if (Number.isNaN(Date.parse(record.generated_at))) findings.push('generated_at is not a date-time');
  if (!Array.isArray(record.answers)) { findings.push('answers is not an array'); return { findings, notices }; }
  const ids = new Set(sources.bank.questions.map((q) => q.id));
  const seen = new Set();
  for (const a of record.answers) {
    const tag = `answer ${a?.id ?? '?'}`;
    if (!ids.has(a.id)) { findings.push(`${tag}: not a question in the bank`); continue; }
    if (seen.has(a.id)) findings.push(`${tag}: duplicated`); seen.add(a.id);
    if (a.block !== a.id[0]) findings.push(`${tag}: block ${JSON.stringify(a.block)} does not match the id`);
    const hasA = typeof a.answer === 'string' && a.answer.trim().length > 0;
    const hasR = typeof a.reference === 'string' && a.reference.trim().length > 0;
    const expect = !hasA ? 'UNKNOWN' : hasR ? 'SOURCED' : 'CLAIMED';
    if (a.disposition !== expect) findings.push(`${tag}: disposition ${JSON.stringify(a.disposition)} disagrees with its content — an answer ${hasA ? 'with' : 'without'} text and ${hasR ? 'with' : 'without'} a reference is ${expect}`);
    if (typeof a.respondent_role === 'string' && NAME_SHAPE.test(a.respondent_role.trim())) findings.push(`${tag}: respondent_role ${JSON.stringify(a.respondent_role)} looks like a person's name — roles only; names live in the identity registry`);
  }
  if (record.questions_digest && record.questions_digest !== sources.questions_digest) notices.push(`record answers an older question bank (${record.questions_digest.slice(0, 19)}… vs ${sources.questions_digest.slice(0, 19)}…) — still a record of what was said; re-ask only the questions that changed`);
  const missing = [...ids].filter((id) => !seen.has(id));
  if (missing.length) notices.push(`${missing.length} question(s) have no answer entry at all: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
  return { findings, notices };
}

export function run(cwd = process.cwd(), { recordPath = null, intakeDir = BUNDLE_INTAKE } = {}) {
  const findings = [], notices = [];
  findings.push(...checkParity(intakeDir));
  const rp = recordPath ?? join(cwd, RECORD_LOCATION);
  if (existsSync(rp)) {
    let rec; try { rec = JSON.parse(readFileSync(rp, 'utf8')); } catch (e) { findings.push(`${rp}: not valid JSON (${e.message})`); return { findings, notices, record: rp }; }
    const r = checkRecord(rec, loadSources(intakeDir));
    findings.push(...r.findings.map((f) => `${rp}: ${f}`)); notices.push(...r.notices);
    return { findings, notices, record: rp, summary: rec.summary };
  }
  return { findings, notices, record: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--fix')) { writeFileSync(join(BUNDLE_INTAKE, 'questionnaire.html'), render()); process.stdout.write('intake/questionnaire.html rebuilt\n'); }
  const ri = args.indexOf('--record');
  const res = run(process.cwd(), { recordPath: ri >= 0 ? resolve(args[ri + 1]) : null });
  for (const n of res.notices) process.stdout.write(`  notice: ${n}\n`);
  if (res.findings.length) {
    process.stderr.write('\nIntake check — FAIL\n\n');
    for (const f of res.findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe questionnaire is generated from the question bank, and an intake record says what was said and never more. See ../loom/references/brainkit.md and the institution-intake skill.\n');
    process.exit(1);
  }
  const s = res.summary ? ` · record: ${res.summary.SOURCED ?? 0} sourced, ${res.summary.CLAIMED ?? 0} claimed, ${res.summary.UNKNOWN ?? 0} unknown` : ' · no record present (nothing to import yet)';
  process.stdout.write(`Intake check — OK (questionnaire in step with the bank${s})\n`);
}
