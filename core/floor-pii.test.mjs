// Tests for the personal-data smell test (Factory Floor WS3 · D3.3). Node built-in runner.
//
// Every value below is SYNTHETIC and fabricated for this file: reserved documentation domains,
// invented institutions, invented people, and the repository's own synthetic markers where they
// exist (`999`-prefixed national id, `AE..000…` IBAN). No value here belongs to a real person,
// and none may be replaced with one — a test suite for a PII detector is the last place personal
// data should end up.
//
// The suite has two halves. The first is ordinary: does each detector class fire on the shape it
// claims. The second is the one that matters — the module must never let a caller read a pass as
// an assurance, and those tests are written against the API SURFACE, not against a behaviour,
// because the failure mode is somebody downstream printing "PII: clean".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from './floor-pii.mjs';
import {
  ASSURANCE, DETECTORS, LIMITS, NO_ASSURANCE, SCHEMA_ID,
  describe as describeFinding, hasFindings, liveFindings, redact, scanText,
} from './floor-pii.mjs';

const codes = (r) => r.findings.map((f) => f.code);
const BENIGN = [
  '# Meeting note — MN-014',
  '',
  'P-01 (SME lender, 3-5 yrs) said onboarding takes about a fortnight, which matches what',
  'P-02 (branch operations) described last quarter. Carried to the research log as S-041.',
].join('\n');

// ---------------------------------------------------------------------------------------------
// Detector classes. For each, the value a catalog-C author actually types by accident.
// ---------------------------------------------------------------------------------------------

test('PII-R01 — an email address is found', () => {
  const r = scanText('Follow up with a.hartley@northwind-bank.example.org about the pilot.');
  assert.deepEqual(codes(r), ['PII-R01']);
  assert.equal(r.findings[0].detector, 'email-address');
  assert.equal(r.findings[0].line, 1);
});

test('PII-R02 — an IBAN-shaped string is found', () => {
  const r = scanText('They quoted GB29 TEST 6016 1331 9268 19 as the settlement account.');
  assert.deepEqual(codes(r), ['PII-R02']);
  assert.equal(r.findings[0].synthetic, false);
});

test('PII-R03 — a national-identifier-shaped string is found', () => {
  const r = scanText('Reference given on the call: 123-4567-8901234-5.');
  assert.deepEqual(codes(r), ['PII-R03']);
});

test('PII-R04 — a telephone number is found, international and national forms alike', () => {
  for (const line of ['Call back on +971 50 555 0143 tomorrow.', 'Best number is 050 555 0143.']) {
    assert.deepEqual(codes(scanText(line)), ['PII-R04'], line);
  }
});

test('PII-R05 — a long run of digits is found (account, card, case reference alike)', () => {
  assert.deepEqual(codes(scanText('Card on file 4111 1111 1111 1111.')), ['PII-R05']);
  assert.deepEqual(codes(scanText('Case reference 987654321098 was raised.')), ['PII-R05']);
});

test('PII-R06 — a personal title followed by a name is found', () => {
  for (const line of ['Ms Amina Al-Farsi chaired the session.', 'Dr. Okonkwo disagreed.', 'Sheikh Rashid Al-Zahra was represented.']) {
    assert.deepEqual(codes(scanText(line)), ['PII-R06'], line);
  }
});

// The negative that would pass if the detectors were absent: ordinary catalog-C prose, written to
// the template's own discipline, must not fire. A detector that flags the compliant note is a
// detector that gets switched off within a week.
test('prose written the way the template asks raises nothing', () => {
  assert.deepEqual(scanText(BENIGN).findings, []);
});

test('a bare title with no name after it is not a finding', () => {
  assert.deepEqual(scanText('The doctor and the branch manager both objected. Drive-through only.').findings, []);
});

// ---------------------------------------------------------------------------------------------
// The half that matters: no result may be readable as a clearance.
// ---------------------------------------------------------------------------------------------

test('a no-findings result is NOT presented as a guarantee — it names its own limits', () => {
  const r = scanText(BENIGN);
  assert.deepEqual(r.findings, []);
  assert.equal(r.assurance, 'none');
  assert.equal(r.assurance, ASSURANCE);
  assert.ok(r.limits.length >= 3, 'an empty result must still carry what the scan cannot see');
  assert.match(r.statement, /never certifies text as clean/);
  assert.match(r.statement, /not a clearance/);
  // The limit that matters most is the one about shapes: it is the reason zero findings proves
  // nothing about a note full of names.
  assert.ok(r.limits.some((l) => /matches shapes, not meaning/i.test(l)));
  assert.equal(r.schema, SCHEMA_ID);
});

test('the empty result and the full result are the same KIND of result', () => {
  const empty = scanText(BENIGN);
  const full = scanText('reach me on a.hartley@northwind-bank.example.org');
  assert.deepEqual(Object.keys(empty).sort(), Object.keys(full).sort());
  assert.equal(empty.assurance, full.assurance);
  assert.equal(empty.statement, full.statement);
  assert.deepEqual(empty.limits, full.limits);
});

// Written against the API surface deliberately. The dangerous version of this module is one that
// grew an `isClean()` for a caller's convenience — after which some gate prints "PII: clean".
test('the module exports no affirmative predicate a caller could print as a pass', () => {
  for (const name of ['isClean', 'isSafe', 'clean', 'safe', 'certify', 'assertClean', 'ok', 'pass', 'verify', 'clear']) {
    assert.equal(mod[name], undefined, `floor-pii must not export ${name}`);
  }
  assert.equal(typeof hasFindings, 'function');
  assert.equal(hasFindings(scanText(BENIGN)), false);
  assert.equal(hasFindings(scanText('a.hartley@northwind-bank.example.org')), true);
});

test('the result shape carries no truthy boolean a caller could read as a verdict', () => {
  const r = scanText(BENIGN);
  for (const [k, v] of Object.entries(r)) {
    assert.notEqual(typeof v, 'boolean', `result.${k} is a boolean — a boolean on this object will be read as a verdict`);
  }
  assert.equal(/clean|safe|pass|clear|approved|certif/i.test(Object.keys(r).join(' ')), false);
});

test('assurance stays `none` even when the scan found six things', () => {
  const r = scanText('Ms Amina Al-Farsi, a.hartley@northwind-bank.example.org, 050 555 0143, GB29 TEST 6016 1331 9268 19, 123-4567-8901234-5, 987654321098');
  assert.ok(r.findings.length >= 5);
  assert.equal(r.assurance, 'none');
});

test('the constants cannot be edited out from under a caller', () => {
  assert.throws(() => { LIMITS.push('nothing to see here'); }, TypeError);
  assert.throws(() => { DETECTORS.length = 0; }, TypeError);
  assert.equal(Object.isFrozen(NO_ASSURANCE) || typeof NO_ASSURANCE === 'string', true);
});

// ---------------------------------------------------------------------------------------------
// Reporting discipline.
// ---------------------------------------------------------------------------------------------

test('a finding never reprints the value it found', () => {
  const value = 'a.hartley@northwind-bank.example.org';
  const r = scanText(`Follow up with ${value} about the pilot.`, { where: 'IN-001' });
  const f = r.findings[0];
  assert.match(f.redacted, /^•+ \(\d+ chars, value withheld\)$/);
  assert.equal(JSON.stringify(r.findings).includes(value), false, 'a finding that quotes the value copies the disclosure into the CI log');
  assert.equal(describeFinding(f).includes(value), false);
  // It still locates it exactly, which is what a human needs to go and look.
  assert.equal(f.line, 1);
  assert.equal(f.column, 'Follow up with '.length + 1);
  assert.equal(f.where, 'IN-001');
});

test('redact discloses nothing but a length', () => {
  assert.equal(/[A-Za-z0-9@.]/.test(redact('a.hartley@northwind-bank.example.org').split(' (')[0]), false);
});

// ---------------------------------------------------------------------------------------------
// Synthetic markers: flagged, never suppressed.
// ---------------------------------------------------------------------------------------------

test("this repository's synthetic conventions are flagged, and STILL reported", () => {
  const cases = [
    ['Fixture id 999-1990-1234567-1 for the walkthrough.', 'PII-R03'],
    ['Settlement to AE07 0001 2345 6789 0123 456 in the demo.', 'PII-R02'],
    ['Write to p-01@example.com in the worked example.', 'PII-R01'],
    ['Best number is 050 555 0143. [synthetic]', 'PII-R04'],
  ];
  for (const [line, code] of cases) {
    const r = scanText(line);
    assert.deepEqual(codes(r), [code], line);
    assert.equal(r.findings[0].synthetic, true, `${line} should carry a synthetic marker`);
    assert.equal(liveFindings(r).length, 0);
    // Reported, not hidden: the finding is in `findings`, and a caller choosing not to fail on it
    // is making that choice in the open.
    assert.equal(hasFindings(r), true);
  }
});

test('a synthetic marker on one line does not silence the next line', () => {
  const r = scanText('Fixture 999-1990-1234567-1 [synthetic]\nReal-shaped 123-4567-8901234-5');
  assert.deepEqual(codes(r), ['PII-R03', 'PII-R03']);
  assert.deepEqual(r.findings.map((f) => f.synthetic), [true, false]);
  assert.equal(liveFindings(r).length, 1);
});

// ---------------------------------------------------------------------------------------------
// Precedence and purity.
// ---------------------------------------------------------------------------------------------

test('one value is reported once, under the most specific class that claims it', () => {
  // An IBAN also contains a run of digits long enough for PII-R05 and a group that PII-R04 would
  // take for a trunk number. Reporting it three times would make the output unreadable and the
  // detector look broken.
  const r = scanText('Settlement to GB29 TEST 6016 1331 9268 19.');
  assert.deepEqual(codes(r), ['PII-R02']);
  const phone = scanText('Call +971 50 555 0143 back.');
  assert.deepEqual(codes(phone), ['PII-R04']);
});

test('scanning the same text twice gives the same answer (the /g regexes hold no state)', () => {
  const text = 'Ms Amina Al-Farsi — a.hartley@northwind-bank.example.org — 050 555 0143';
  assert.deepEqual(scanText(text), scanText(text));
  assert.deepEqual(scanText(text), scanText(text)); // and a third time, after two exec walks
});

test('non-string input is scanned as empty rather than thrown at', () => {
  for (const v of [undefined, null, 42, {}, []]) assert.deepEqual(scanText(v).findings, []);
});

test('line and column are 1-based and point at the value', () => {
  const r = scanText(`${BENIGN}\nchase a.hartley@northwind-bank.example.org`);
  assert.equal(r.findings[0].line, 5);
  assert.equal(r.findings[0].column, 'chase '.length + 1);
});

test('every detector declares a code, an id, a label and a reason', () => {
  const seen = new Set();
  for (const d of DETECTORS) {
    assert.match(d.code, /^PII-R\d\d$/);
    assert.equal(seen.has(d.code), false, `duplicate code ${d.code}`);
    seen.add(d.code);
    for (const f of ['id', 'label', 'why']) assert.equal(typeof d[f], 'string', `${d.code} has no ${f}`);
    assert.ok(d.re instanceof RegExp);
    assert.ok(d.re.flags.includes('g'), `${d.code} must be a global regex`);
  }
  assert.deepEqual(scanText('').detectors_run, DETECTORS.map((d) => d.code));
});

// --- the relationship to the BLOCKING filter -----------------------------------------------
// floor-project.mjs blocks git → floor and is tuned for low false positives; this module advises
// over floor prose and is tuned for high recall. They keep separate tables on purpose (see both
// module headers). What must hold between them is asserted here, so "separate" never quietly
// becomes "divergent": the advisory net is never narrower than the blocking one for personal data,
// and the credential shapes are excluded by decision rather than by omission.

test('every personal-data shape the egress filter BLOCKS is also caught here', async () => {
  const { PROHIBITED, scan } = await import('./floor-project.mjs');

  // Synthetic, shape-valid samples — one per blocking rule. Fabricated for this file.
  const SAMPLES = {
    'emirates-id': '784123456789012',
    'uae-iban': 'AE070331234567890123456',
    'email-address': 'someone@example.co',
    'private-key': '-----BEGIN RSA PRIVATE KEY-----', // loom-allow-secret — a header, no key material
    'bearer-token': 'ghp_abcdefghijklmnop123', // loom-allow-secret — fabricated, matches no real token
  };
  // Credentials are not personal data. The Q4 secrets gate owns them, and this module deliberately
  // does not look for them — recorded here so the absence stays a decision.
  const NOT_PERSONAL_DATA = new Set(['private-key', 'bearer-token']);

  assert.deepEqual(
    PROHIBITED.map((p) => p.id).sort(), Object.keys(SAMPLES).sort(),
    'a blocking rule was added or renamed — give it a sample here and decide which side it falls on',
  );

  for (const rule of PROHIBITED) {
    const sample = SAMPLES[rule.id];
    assert.ok(scan(sample), `${rule.id}: the sample must actually trip the blocking filter`);

    const caught = liveFindings(scanText(sample)).length > 0;
    if (NOT_PERSONAL_DATA.has(rule.id)) {
      assert.equal(caught, false,
        `${rule.id} is a credential, not personal data — if this module started flagging it, the `
        + 'boundary with the Q4 secrets gate has blurred and one of the two should own it, not both');
    } else {
      assert.ok(caught,
        `${rule.id} is blocked on egress but invisible to the smell test — the advisory net is `
        + 'narrower than the blocking one, which is the wrong way round');
    }
  }
});
