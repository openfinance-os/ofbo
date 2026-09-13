// Tests for the purification gate (rc.46 · Shari'ah workstream). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPROVER_ROLES, STATUSES, amountValue, evaluate, run } from './purification-check.mjs';

const NOW = Date.parse('2026-08-01T00:00:00Z');

// The registry uses the repo's fictional-institution cast. Note `agent-loom-delivery`: it appears
// as a legitimate `computed_by` and as a refused `approved_by`, which is the distinction the gate
// exists to hold.
const REGISTRY = {
  identities: [
    { id: 'scholar-a', kind: 'human', roles: ['shariah-committee'], groups: ['second-line'], external: true, reconciliation_source: 'ISSC register' },
    { id: 'scf-head', kind: 'human', roles: ['shariah-compliance'], groups: ['second-line'],
      delegates: [{ to: 'scf-deputy', from: '2026-07-01T00:00:00Z', until: '2026-09-01T00:00:00Z', granted_by: 'cro' }] },
    { id: 'scf-deputy', kind: 'human', roles: [], groups: ['second-line'] },
    { id: 'cro', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'po-fatima', kind: 'human', roles: ['product-owner'], groups: ['builders'] },
    { id: 'agent-loom-delivery', kind: 'agent', groups: ['builders'] },
  ],
};

const SIGNALS = [
  { id: 'OPS-77', type: 'shariah-non-compliance', severity: 'medium', route: 'purification', link: 'PUR-2026-0007', evidence_ref: 'evidence/ops-77.json' },
  { id: 'OPS-12', type: 'incident', severity: 'low', route: 'spec-fix', link: 'PR-1' },
];

const METHOD = 'docs/governance/changes/CHG-1/pa2.md#purification-of-non-compliant-income';

const record = (over = {}) => ({
  purification_id: 'PUR-2026-0007',
  source_file: 'PUR-2026-0007.json',
  signal_id: 'OPS-77',
  amount: { value: 4137.5, currency: 'AED' },
  computed_by: 'agent-loom-delivery',
  approved_by: 'scf-head',
  method_ref: METHOD,
  status: 'donated',
  opened_at: '2026-07-02T09:00:00Z',
  donated_at: '2026-07-20T09:00:00Z',
  donation_evidence_ref: 'evidence/PUR-2026-0007-transfer.pdf',
  ...over,
});

const check = (records, over = {}) => evaluate({
  records, signals: SIGNALS, registry: REGISTRY, now: NOW, ...over,
});
const has = (findings, re) => findings.some((f) => re.test(f));

test('a complete, bound, approved and donated record passes clean', () => {
  const { findings, notices } = check([record()]);
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, []);
});

test('an empty record set with nothing routed to purification is silent', () => {
  const { findings, notices } = check([], { signals: [SIGNALS[1]] });
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
});

// ── identity: WHO COMPUTES vs WHO APPROVES ───────────────────────────────────────────────────
test('an AGENT may compute the amount — quantification is arithmetic', () => {
  assert.deepEqual(check([record({ computed_by: 'agent-loom-delivery' })]).findings, []);
  assert.deepEqual(check([record({ computed_by: 'po-fatima' })]).findings, []);
});

test('an AGENT may never approve the disposal — that is human Shari\'ah authority', () => {
  const { findings } = check([record({ approved_by: 'agent-loom-delivery' })]);
  assert.ok(has(findings, /is an AGENT.*Agents never approve/s), findings.join('\n'));
});

test('approved_by must hold shariah-compliance or shariah-committee, and must resolve', () => {
  assert.deepEqual(check([record({ approved_by: 'scholar-a' })]).findings, []);
  assert.ok(has(check([record({ approved_by: 'po-fatima' })]).findings, /holds none of/));
  assert.ok(has(check([record({ approved_by: 'cro' })]).findings, /holds none of/));
  assert.ok(has(check([record({ approved_by: 'nobody' })]).findings, /is not in the identity registry/));
  assert.deepEqual(APPROVER_ROLES, ['shariah-compliance', 'shariah-committee']);
  assert.ok(!APPROVER_ROLES.includes('shariah-board'), 'shariah-board is retired');
});

test('a delegated Shari\'ah-compliance role approves, and is RECORDED as a deputy approval', () => {
  const { findings, notices } = check([record({ approved_by: 'scf-deputy' })]);
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(has(notices, /BY DELEGATION from scf-head/), notices.join('\n'));
  // Outside the window the delegation is not honoured.
  const lapsed = check([record({ approved_by: 'scf-deputy' })], { now: Date.parse('2026-10-01T00:00:00Z') });
  assert.ok(has(lapsed.findings, /holds none of/), lapsed.findings.join('\n'));
});

test('computed_by is required and must resolve; a missing registry is ONE finding, not one per record', () => {
  assert.ok(has(check([record({ computed_by: '' })]).findings, /no computed_by/));
  assert.ok(has(check([record({ computed_by: 'ghost' })]).findings, /is not in the identity registry/));
  const { findings } = check([record(), record({ purification_id: 'PUR-2', source_file: 'PUR-2.json' })], { registry: null });
  assert.equal(findings.filter((f) => /no identity registry was found/.test(f)).length, 1, findings.join('\n'));
});

test('an approval is only demanded once the record claims a decision; open is a notice', () => {
  assert.ok(has(check([record({ approved_by: '', status: 'approved', donated_at: undefined, donation_evidence_ref: undefined })]).findings, /with no approved_by/));
  const open = check([record({ approved_by: '', status: 'open', donated_at: undefined, donation_evidence_ref: undefined })]);
  assert.deepEqual(open.findings, [], open.findings.join('\n'));
  assert.ok(has(open.notices, /still on the institution's books/));
});

// ── binding to a breach ───────────────────────────────────────────────────────────────────────
test('signal_id must resolve, and must be a shariah-non-compliance signal', () => {
  assert.ok(has(check([record({ signal_id: '' })]).findings, /no signal_id/));
  assert.ok(has(check([record({ signal_id: 'OPS-999' })]).findings, /does not resolve in the operations-signal log/));
  assert.ok(has(check([record({ signal_id: 'OPS-12' })]).findings, /is type "incident", not shariah-non-compliance/));
});

test('no operations log at all is NOT VERIFIED, never a quiet pass', () => {
  const { findings, notices } = check([record()], { signals: null });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(has(notices, /NOT VERIFIED/), notices.join('\n'));
});

test('ids: PUR- prefix, no duplicates, and the file name is the id', () => {
  assert.ok(has(check([record({ purification_id: '' })]).findings, /no purification_id/));
  assert.ok(has(check([record({ purification_id: 'CHARITY-1', source_file: 'CHARITY-1.json' })]).findings, /must start with PUR-/));
  assert.ok(has(check([record(), record()]).findings, /duplicate purification_id/));
  assert.ok(has(check([record({ source_file: 'july.json' })]).findings, /filed as july\.json/));
});

// ── quantification ────────────────────────────────────────────────────────────────────────────
test('the amount must be positive, carry a currency, and may be a decimal string', () => {
  assert.ok(has(check([record({ amount: undefined })]).findings, /no amount/));
  assert.ok(has(check([record({ amount: { value: 0, currency: 'AED' } })]).findings, /zero is not a small purification/));
  assert.ok(has(check([record({ amount: { value: -5, currency: 'AED' } })]).findings, /amount\.value is -5/));
  assert.ok(has(check([record({ amount: { value: 'about four thousand', currency: 'AED' } })]).findings, /is not a number/));
  assert.ok(has(check([record({ amount: { value: 4137.5 } })]).findings, /currency is missing/));
  assert.deepEqual(check([record({ amount: { value: '4137.50', currency: 'AED' } })]).findings, []);
  assert.equal(amountValue('4137.50'), 4137.5);
  assert.equal(amountValue(Infinity), null);
  assert.equal(amountValue(true), null);
});

// ── the method: the wire back to the approved PA2 section ─────────────────────────────────────
test('method_ref is required, must not be a placeholder, must not escape, and must exist', () => {
  assert.ok(has(check([record({ method_ref: '' })]).findings, /no method_ref/));
  assert.ok(has(check([record({ method_ref: 'ADOPT: cite the PA2 section' })]).findings, /still an adoption marker/));
  assert.ok(has(check([record({ method_ref: '../../elsewhere/method.md' })]).findings, /escapes the repository/));
  assert.ok(has(check([record({ method_ref: '/etc/method.md' })]).findings, /escapes the repository/));
  const missing = check([record()], { exists: () => false });
  assert.ok(has(missing.findings, /does not exist at docs\/governance\/changes\/CHG-1\/pa2\.md/), missing.findings.join('\n'));
  // The fragment addresses the section inside the document; only the path is resolved.
  const seen = [];
  check([record()], { exists: (p) => { seen.push(p); return true; } });
  assert.deepEqual(seen, ['docs/governance/changes/CHG-1/pa2.md']);
});

test('a FRAGMENT-ONLY method_ref cites no document — and is never resolved against the repo root', () => {
  for (const ref of ['#purification-of-non-compliant-income', '  #s', '#']) {
    const probed = [];
    const { findings } = check([record({ method_ref: ref })], { exists: (p) => { probed.push(p); return true; } });
    assert.ok(has(findings, /is a fragment with no document in front of it/), `${ref}: ${findings.join('\n')}`);
    // The empty path component must never reach exists(): join(cwd, '') is the repo root, which
    // exists, so probing it is what made a citation of nothing read as a citation of something.
    assert.deepEqual(probed, [], `${ref} was resolved against the tree`);
  }
});

// ── disposal ──────────────────────────────────────────────────────────────────────────────────
test('status must be open|approved|donated', () => {
  assert.deepEqual(STATUSES, ['open', 'approved', 'donated']);
  assert.ok(has(check([record({ status: 'written-off' })]).findings, /status must be open\|approved\|donated/));
});

test('donated requires donation evidence and a donated_at at or after opened_at', () => {
  assert.ok(has(check([record({ donation_evidence_ref: '' })]).findings, /no donation_evidence_ref/));
  assert.ok(has(check([record({ donated_at: undefined })]).findings, /no parseable donated_at/));
  assert.ok(has(check([record({ donated_at: 'last summer' })]).findings, /no parseable donated_at/));
  assert.ok(has(check([record({ donated_at: '2026-07-01T00:00:00Z' })]).findings, /precedes opened_at/));
  assert.deepEqual(check([record({ donated_at: '2026-07-02T09:00:00Z' })]).findings, [], 'same instant is allowed');
});

test('opened_at must be a timestamp', () => {
  assert.ok(has(check([record({ opened_at: undefined })]).findings, /opened_at undefined is not a timestamp/));
  assert.ok(has(check([record({ opened_at: 'July' })]).findings, /is not a timestamp/));
});

test('donation evidence on a not-yet-donated record is a stale-record NOTICE, not a finding', () => {
  const { findings, notices } = check([record({ status: 'approved' })]);
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(has(notices, /carries donation evidence while status is "approved"/), notices.join('\n'));
});

// ── mandatory-when-compiled ───────────────────────────────────────────────────────────────────
test('a purification-routed signal with no record: NOTICE when uncompiled, FINDING naming the change when compiled', () => {
  const quiet = check([]);
  assert.deepEqual(quiet.findings, []);
  assert.ok(has(quiet.notices, /no compiled plan requires shariah_governance here/i), quiet.notices.join('\n'));

  const loud = check([], { required: true, requiringChanges: ['CHG-2026-0042'] });
  assert.ok(has(loud.findings, /requires the shariah_governance capability \[CHG-2026-0042\]/), loud.findings.join('\n'));
  // The routed signal is a FINDING, not a notice. The only notice is the empty-register one below.
  assert.ok(!has(loud.notices, /routed to purification/), loud.notices.join('\n'));
});

test('an EMPTY register with the capability compiled says NOTHING WAS VERIFIED — never a green over no records', () => {
  const { findings, notices } = check([], { signals: [SIGNALS[1]], required: true, requiringChanges: ['CHG-1'] });
  // Not a finding: purification records exist only where non-compliant income was found, so an
  // institution that found none has nothing to file and no way to satisfy a finding demanding one.
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(has(notices, /NOTHING WAS VERIFIED.*uncovered, not clean/s), notices.join('\n'));
  // …and it stays silent where no plan requires the capability: this is not a generic-adopter tax.
  assert.deepEqual(check([], { signals: [SIGNALS[1]] }).notices, []);
});

// ── run(): off a real tree ────────────────────────────────────────────────────────────────────
function repo({ islamic = false, signals = null, records = null, method = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'purification-'));
  const base = join(dir, 'docs/governance/changes/CHG-1');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: 'in-delivery', control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
    required_gates: [], required_evidence: [],
    required_capabilities: islamic ? { shariah_governance: { required: true, institution_owned: true } } : { exposure_control: { required: true } },
  }));
  if (method) writeFileSync(join(base, 'pa2.md'), '# PA2\n\n## purification-of-non-compliant-income\n');
  writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
  if (signals) writeFileSync(join(dir, 'docs/governance/operations-signal.json'), JSON.stringify({ signals }));
  if (records) {
    const pdir = join(dir, 'docs/governance/purification');
    mkdirSync(pdir, { recursive: true });
    for (const [name, body] of records) writeFileSync(join(pdir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}
const clean = (d) => rmSync(d, { recursive: true, force: true });

test('run(): a generic adopter — no records, no Shari\'ah capability — is INERT', () => {
  const dir = repo({ signals: [SIGNALS[1]] });
  try {
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.equal(r.required, false);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.notices, []);
  } finally { clean(dir); }
});

test('run(): a compiled Islamic change + a purification-routed signal and NO record FAILS, naming the change', () => {
  const dir = repo({ islamic: true, signals: SIGNALS });
  try {
    const r = run(dir);
    assert.equal(r.required, true);
    assert.ok(r.findings.some((f) => /requires the shariah_governance capability \[CHG-1\]/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run(): the same repository with a complete record passes clean', () => {
  const rec = record({ method_ref: 'docs/governance/changes/CHG-1/pa2.md#purification-of-non-compliant-income' });
  delete rec.source_file;
  const dir = repo({ islamic: true, signals: SIGNALS, records: [['PUR-2026-0007.json', rec]] });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.deepEqual(r.notices, []);
    assert.equal(r.count, 1);
    assert.equal(r.inert, false);
  } finally { clean(dir); }
});

test('run(): a record whose method_ref is not on disk fails; an unparseable record file fails', () => {
  const rec = record();
  delete rec.source_file;
  const gone = repo({ islamic: true, signals: SIGNALS, records: [['PUR-2026-0007.json', rec]], method: false });
  try {
    assert.ok(run(gone).findings.some((f) => /does not exist at/.test(f)), 'a missing PA2 method must fail');
  } finally { clean(gone); }

  const broken = repo({ islamic: true, signals: SIGNALS, records: [['PUR-2026-0007.json', '{ not json']] });
  try {
    const r = run(broken);
    assert.ok(r.findings.some((f) => /not a readable JSON record/.test(f)), r.findings.join('\n'));
  } finally { clean(broken); }
});

test('run(): records present but no compiled Shari\'ah capability still validates them (and never invents one)', () => {
  const rec = record({ approved_by: 'po-fatima' });
  delete rec.source_file;
  const dir = repo({ signals: SIGNALS, records: [['PUR-2026-0007.json', rec]] });
  try {
    const r = run(dir);
    assert.equal(r.required, false);
    assert.equal(r.inert, false);
    assert.ok(r.findings.some((f) => /holds none of/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});
