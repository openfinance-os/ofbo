// Tests for the adapter-evidence gate (Factory Floor WS5 · D5.3). Node runner: `node --test`.
//
// Three jobs here, beyond the per-record refusals `core/floor-adapters.test.mjs` covers:
//
//   1. SILENCE WHERE UNADOPTED, proved against a real empty directory rather than reasoned about.
//   2. AGREEMENT WITH THE TWO GATES THAT ALREADY EXIST — `adapter-check.mjs`'s declared-vs-active
//      predicate and `platform-activation-check.mjs`'s canonical hash and mechanism enum. Each of
//      those is a place where a copy could drift; each is asserted rather than commented.
//   3. THE FILESYSTEM PATH, including a delegated stream activating on the OTHER gate's verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SCHEMA_ID, STREAMS, SEAM_MECHANISMS, evidenceHash } from '../core/floor-adapters.mjs';
import { evaluate as evaluateAdapter } from './adapter-check.mjs';
import { MECHANISMS as FORGE_MECHANISMS, activationHash } from './platform-activation-check.mjs';
import { EVIDENCE_DIR, evaluate, loadAdapters, loadDelegations, loadEvidence, run } from './adapter-evidence-check.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signOver = (s) => sign(null, Buffer.from(s, 'utf8'), privateKey).toString('base64');

const NOW = Date.parse('2026-07-26T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();

const ISSUERS = {
  issuers: [{ id: 'platform-observer', mechanism: 'ed25519', identity: 'padmin-zoe', verify: { public_key: pem } }],
};
const REGISTRY = {
  groups: { builders: 'first line' },
  identities: [
    { id: 'padmin-zoe', kind: 'human', roles: ['platform-admin'], groups: ['platform-admins'] },
    { id: 'svc-floor-bridge', kind: 'agent', roles: [], groups: ['builders'] },
    { id: 'svc-floor-freezer', kind: 'agent', roles: [], groups: ['builders'] },
  ],
};

const PA_ADAPTER = {
  adapter_id: 'notion-pa-decision',
  system: 'notion',
  capability: 'a subject-bound human decision arrives authenticated',
  satisfies_control: 'PA-GATES',
  mechanism: 'human_decision_assertion',
  activation_source: 'adapter-evidence',
  evidence: {
    kind: 'human-decision',
    envelope_fields: ['change_id', 'stage', 'role', 'subject'],
    observes_identities: ['svc-floor-bridge'],
    required_negatives: ['agent-or-bot-approval', 'unregistered-human', 'replay', 'post-decision-mutation'],
  },
};
const HOLD_ADAPTER = {
  adapter_id: 'github-codeowners-hold',
  system: 'github',
  capability: 'neither freezer nor bridge can alter release-hold.json',
  satisfies_control: 'HG-0002',
  mechanism: 'codeowners',
  activation_source: 'platform-activation',
  evidence: { kind: 'codeowners-protection', envelope_fields: ['path', 'owners'], observes_identities: ['svc-floor-freezer', 'svc-floor-bridge'] },
};

const probe = (negative) => ({ negative, attempted: `attempted ${negative}`, result: 'rejected', tested_at: iso(1) });

function paEvidence(over = {}) {
  const base = {
    schema: SCHEMA_ID,
    adapter_id: 'notion-pa-decision',
    satisfies_control: 'PA-GATES',
    mechanism: 'human_decision_assertion',
    observation: { surface: 'notion', bot_authors_dropped: 2 },
    bypass_tests: PA_ADAPTER.evidence.required_negatives.map(probe),
    observer_identity: 'padmin-zoe',
    observed_at: iso(1),
    ...over,
  };
  base.attestation = { issuer: 'platform-observer', signature: signOver(evidenceHash(base)) };
  return base;
}

/** A forge observation in the shape `platform-activation-check.mjs` verifies. */
function forgeObservation(over = {}) {
  const base = {
    platform: 'github',
    repository: 'org/service',
    satisfies_control: 'HG-0002',
    mechanism: 'codeowners',
    observation: { path: 'docs/governance/release-hold.json', owners: ['@org/second-line'], enforce_admins: true },
    bypass_test: { attempted: 'svc-floor-freezer writes release-hold.json', result: 'rejected', tested_at: iso(2) },
    observer_identity: 'padmin-zoe',
    observed_at: iso(2),
    ...over,
  };
  base.attestation = { issuer: 'platform-observer', signature: signOver(activationHash(base)) };
  return base;
}

/** A throwaway repo on disk. Only what a test names exists — that is how UNADOPTED gets proved. */
function repo({ adapters = [], evidence = [], activation = [], catalog = null, changes = {}, governance = true } = {}) {
  const dir = mkdtempSync(`${tmpdir()}/loom-adapter-evidence-`);
  const gov = `${dir}/docs/governance`;
  if (governance) {
    mkdirSync(gov, { recursive: true });
    writeFileSync(`${gov}/identities.json`, JSON.stringify(REGISTRY));
    writeFileSync(`${gov}/attestation-issuers.json`, JSON.stringify(ISSUERS));
  }
  if (adapters.length) {
    mkdirSync(`${gov}/adapters`, { recursive: true });
    for (const a of adapters) writeFileSync(`${gov}/adapters/${a.adapter_id || 'broken'}.json`, JSON.stringify(a));
  }
  if (evidence.length) {
    mkdirSync(`${dir}/${EVIDENCE_DIR}`, { recursive: true });
    evidence.forEach((e, i) => writeFileSync(`${dir}/${EVIDENCE_DIR}/${i}-${e.adapter_id || 'x'}.json`, JSON.stringify(e)));
  }
  if (activation.length) {
    mkdirSync(`${gov}/platform-activation`, { recursive: true });
    activation.forEach((a, i) => writeFileSync(`${gov}/platform-activation/${i}-${a.mechanism}.json`, JSON.stringify(a)));
  }
  if (catalog) writeFileSync(`${gov}/control-catalog.json`, JSON.stringify(catalog));
  for (const [id, { envelope, plan }] of Object.entries(changes)) {
    mkdirSync(`${gov}/changes/${id}`, { recursive: true });
    writeFileSync(`${gov}/changes/${id}/change-envelope.json`, JSON.stringify(envelope));
    writeFileSync(`${gov}/changes/${id}/control-plan.json`, JSON.stringify(plan));
  }
  return dir;
}
const withRepo = (opts, fn) => { const d = repo(opts); try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

// ---------------------------------------------------------------------------------------------
// Silence where unadopted.
// ---------------------------------------------------------------------------------------------

test('a repo declaring no adapters is a clean no-op', () => {
  withRepo({}, (d) => {
    const r = run(d, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.notices, []);
    assert.deepEqual(r.states, []);
    assert.equal(r.adapters, 0);
  });
});

test('an empty repo with no governance directory at all is a clean no-op', () => {
  withRepo({ governance: false }, (d) => {
    assert.deepEqual(run(d, { now: NOW }).findings, []);
  });
});

test('adapters but no evidence: every stream DECLARED, NOT ACTIVE, and the build stays green', () => {
  withRepo({ adapters: [PA_ADAPTER, HOLD_ADAPTER] }, (d) => {
    const r = run(d, { now: NOW });
    assert.deepEqual(r.findings, [], 'the honest resting state of a wired seam is not a failure');
    assert.equal(r.active, 0);
    assert.equal(r.states.length, 2);
    assert.equal(r.notices.length, 2);
    for (const n of r.notices) assert.match(n, /DECLARED, NOT ACTIVE/);
    assert.equal(r.satisfied.size, 0, 'a declared stream satisfies nothing');
  });
});

// ---------------------------------------------------------------------------------------------
// Agreement with the gates that already exist.
// ---------------------------------------------------------------------------------------------

test('the canonical hash is byte-identical to platform-activation-check\'s activationHash', () => {
  // Same recipe means an adopter's observer signs one kind of string whichever stream it produces,
  // and a record can move between the two verifiers without being re-signed.
  const rec = paEvidence();
  assert.equal(evidenceHash(rec), activationHash(rec));
  const forge = forgeObservation();
  assert.equal(evidenceHash(forge), activationHash(forge));
});

test('the seam mechanisms are DISJOINT from the forge gate\'s enum — one mechanism, one verifier', () => {
  for (const m of SEAM_MECHANISMS) {
    assert.equal(FORGE_MECHANISMS.has(m), false, `${m} must not be owned by two verifiers`);
  }
  // …and every delegated stream in the D5.3 table names a mechanism that gate really does own.
  for (const s of STREAMS.filter((x) => x.activation_source === 'platform-activation')) {
    assert.ok(FORGE_MECHANISMS.has(s.mechanism), `${s.adapter_id} delegates ${s.mechanism}, which the forge gate must own`);
  }
  for (const s of STREAMS.filter((x) => x.activation_source === 'adapter-evidence')) {
    assert.ok(SEAM_MECHANISMS.has(s.mechanism), `${s.adapter_id} verifies ${s.mechanism} here, so it must be a seam mechanism`);
  }
});

test('the self-declared-activation predicate agrees with adapter-check\'s declared/active notice', () => {
  // The two gates read one field: adapter-check turns "empty" into an honest notice, this gate turns
  // "populated with nothing behind it" into a finding. If they disagreed about what "populated"
  // means, "declared, not active" would quietly stop meaning anything.
  const controls = new Set(['PA-GATES']);
  const cases = [
    [PA_ADAPTER, true],
    [{ ...PA_ADAPTER, activation_evidence: { fetched_at: 'ADOPT: your timestamp' } }, true],
    [{ ...PA_ADAPTER, activation_evidence: { _comment: 'notes only' } }, true],
    [{ ...PA_ADAPTER, activation_evidence: { fetched_at: iso(1) } }, false],
  ];
  for (const [adapter, expectNotice] of cases) {
    const { notices } = evaluateAdapter(adapter, controls);
    const saysDeclared = notices.some((n) => /declared, not active/.test(n));
    assert.equal(saysDeclared, expectNotice, JSON.stringify(adapter.activation_evidence ?? null));
    // Our finding fires exactly when adapter-check stops saying "declared".
    const r = evaluate({ adapters: [{ label: 'a.json', adapter }], records: [], registry: REGISTRY, issuers: ISSUERS, now: NOW });
    assert.equal(r.findings.some((f) => f.startsWith('AD-R09')), !expectNotice, 'the two predicates agree');
  }
});

// ---------------------------------------------------------------------------------------------
// The filesystem path.
// ---------------------------------------------------------------------------------------------

test('loaders read adapters and evidence off disk, including a batched evidence file', () => {
  withRepo({ adapters: [PA_ADAPTER], evidence: [paEvidence()] }, (d) => {
    assert.equal(loadAdapters(d).length, 1);
    assert.equal(loadEvidence(d).length, 1);
    // A batched sweep: one commit, several observations.
    writeFileSync(`${d}/${EVIDENCE_DIR}/batch.json`, JSON.stringify({ records: [paEvidence(), paEvidence({ observed_at: iso(2) })] }));
    const loaded = loadEvidence(d);
    assert.equal(loaded.length, 3);
    assert.ok(loaded.some((e) => e.label.endsWith('[1]')));
  });
});

test('a real observation on disk activates its own stream and nothing else', () => {
  withRepo({ adapters: [PA_ADAPTER, HOLD_ADAPTER], evidence: [paEvidence()] }, (d) => {
    const r = run(d, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.active, 1);
    assert.deepEqual([...r.satisfied], ['PA-GATES']);
    assert.equal(r.states.find((s) => s.adapter_id === 'github-codeowners-hold').status, 'declared');
  });
});

test('a delegated stream activates on the forge gate\'s own verdict', () => {
  withRepo({ adapters: [HOLD_ADAPTER], activation: [forgeObservation()] }, (d) => {
    assert.equal(loadDelegations(d, { now: NOW }).length, 1);
    const r = run(d, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.active, 1);
    assert.equal(r.states[0].verified_by, 'scripts/platform-activation-check.mjs');
  });
});

test('a forge observation that FAILS its own gate activates nothing here', () => {
  // Not rejected: the platform never refused the bypass. platform-activation-check owns that finding;
  // this gate simply never sees the record, so the stream stays declared. No second, softer verdict.
  const bad = forgeObservation({ bypass_test: { attempted: 'freezer writes release-hold.json', result: 'allowed', tested_at: iso(2) } });
  withRepo({ adapters: [HOLD_ADAPTER], activation: [bad] }, (d) => {
    assert.deepEqual(loadDelegations(d, { now: NOW }), []);
    assert.equal(run(d, { now: NOW }).active, 0);
  });
});

test('a forge observation signed by an identity the stream OBSERVES activates nothing', () => {
  // The freezer is one of the identities github-codeowners-hold makes a claim about. The forge gate
  // refuses it too (an agent is inside the write authority), which is why the record never arrives.
  const selfSigned = forgeObservation({ observer_identity: 'svc-floor-freezer' });
  withRepo({ adapters: [HOLD_ADAPTER], activation: [selfSigned] }, (d) => {
    assert.deepEqual(loadDelegations(d, { now: NOW }), []);
    assert.equal(run(d, { now: NOW }).active, 0);
  });
});

test('a stale forge observation activates nothing', () => {
  withRepo({ adapters: [HOLD_ADAPTER], activation: [forgeObservation({ observed_at: iso(400) })] }, (d) => {
    assert.equal(run(d, { now: NOW }).active, 0);
  });
});

test('a forge observation for a DIFFERENT control does not activate this stream', () => {
  // The F4 defect end to end: a valid, signed, bypass-tested branch-protection receipt offered as
  // evidence for the CODEOWNERS hold. Both records are real; the binding is what refuses it.
  const branch = forgeObservation({ satisfies_control: 'HG-0001', mechanism: 'branch_protection', bypass_test: { attempted: 'direct push to main by svc-floor-bridge', result: 'rejected', tested_at: iso(2) } });
  withRepo({ adapters: [HOLD_ADAPTER], activation: [branch] }, (d) => {
    assert.equal(loadDelegations(d, { now: NOW }).length, 1, 'the forge gate is happy with it');
    const r = run(d, { now: NOW });
    assert.equal(r.active, 0, 'and it still activates nothing here');
    assert.equal(r.satisfied.size, 0);
  });
});

test('two adapters sharing a control fails the build off disk', () => {
  withRepo({ adapters: [PA_ADAPTER, { ...HOLD_ADAPTER, satisfies_control: 'PA-GATES' }] }, (d) => {
    assert.ok(run(d, { now: NOW }).findings.some((f) => f.startsWith('AD-R05')));
  });
});

test('an unparseable adapter is a NOTICE here — adapter-check owns that finding', () => {
  withRepo({ adapters: [PA_ADAPTER] }, (d) => {
    writeFileSync(`${d}/docs/governance/adapters/broken.json`, '{ not json');
    const r = run(d, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.ok(r.notices.some((n) => /not parseable/.test(n)));
  });
});

test('a catalog control citing a declared adapter fails off disk', () => {
  const catalog = { controls: [{ control_id: 'PA-GATES', state: 'platform-enforced', adapter_ref: 'notion-pa-decision' }] };
  withRepo({ adapters: [PA_ADAPTER], catalog }, (d) => {
    assert.ok(run(d, { now: NOW }).findings.some((f) => f.startsWith('AD-R10')));
  });
  withRepo({ adapters: [PA_ADAPTER], catalog, evidence: [paEvidence()] }, (d) => {
    assert.deepEqual(run(d, { now: NOW }).findings, []);
  });
});

// ---------------------------------------------------------------------------------------------
// Mandatory-when-compiled.
// ---------------------------------------------------------------------------------------------

const REQUIRING = {
  'CHG-1': {
    envelope: { change_id: 'CHG-1', control_plan: 'control-plan.json' },
    plan: { change_id: 'CHG-1', required_capabilities: { adapter_evidence: { required: true } } },
  },
};
const NOT_REQUIRING = {
  'CHG-2': {
    envelope: { change_id: 'CHG-2', control_plan: 'control-plan.json' },
    plan: { change_id: 'CHG-2', required_capabilities: {} },
  },
};

test('a plan compiling the capability with NO adapters mounted is a plan defect, not a pass', () => {
  withRepo({ changes: REQUIRING }, (d) => {
    const r = run(d, { now: NOW });
    assert.ok(r.findings.some((f) => /no adapter is mounted/.test(f)));
  });
});

test('a plan compiling the capability fails while a stream is only declared', () => {
  withRepo({ adapters: [PA_ADAPTER], changes: REQUIRING }, (d) => {
    const f = run(d, { now: NOW }).findings;
    assert.ok(f.some((x) => /DECLARED, NOT ACTIVE/.test(x)));
    assert.ok(f.some((x) => /notion-activation/.test(x)), 'and names the D5.3 streams that are missing');
  });
});

test('a plan that does NOT compile the capability is unaffected by declared streams', () => {
  withRepo({ adapters: [PA_ADAPTER, HOLD_ADAPTER], changes: NOT_REQUIRING }, (d) => {
    assert.deepEqual(run(d, { now: NOW }).findings, []);
  });
});

test('all four streams active satisfies a compiled requirement', () => {
  const adapters = [
    PA_ADAPTER,
    { ...HOLD_ADAPTER },
    { ...HOLD_ADAPTER, adapter_id: 'github-branch-protection', satisfies_control: 'HG-0001', mechanism: 'branch_protection', evidence: { ...HOLD_ADAPTER.evidence, observes_identities: ['svc-floor-bridge', 'svc-floor-freezer'] } },
    {
      adapter_id: 'notion-activation',
      system: 'notion',
      capability: 'the seam is live and was observed refusing a bypass',
      satisfies_control: 'FLOOR-SEAM',
      mechanism: 'seam_liveness',
      activation_source: 'adapter-evidence',
      evidence: { kind: 'seam-liveness', envelope_fields: ['surface', 'observed_at'], observes_identities: ['svc-floor-bridge', 'svc-floor-freezer'], required_negatives: ['seam-bypass'] },
    },
  ];
  const seam = (() => {
    const base = {
      schema: SCHEMA_ID, adapter_id: 'notion-activation', satisfies_control: 'FLOOR-SEAM', mechanism: 'seam_liveness',
      observation: { surface: 'notion', reachable: true },
      bypass_tests: [probe('seam-bypass')],
      observer_identity: 'padmin-zoe', observed_at: iso(1),
    };
    base.attestation = { issuer: 'platform-observer', signature: signOver(evidenceHash(base)) };
    return base;
  })();
  const activation = [
    forgeObservation(),
    forgeObservation({ satisfies_control: 'HG-0001', mechanism: 'branch_protection', bypass_test: { attempted: 'direct push to main by svc-floor-bridge', result: 'rejected', tested_at: iso(2) } }),
  ];
  withRepo({ adapters, evidence: [paEvidence(), seam], activation, changes: REQUIRING }, (d) => {
    const r = run(d, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.active, 4);
    assert.deepEqual([...r.satisfied].sort(), ['FLOOR-SEAM', 'HG-0001', 'HG-0002', 'PA-GATES']);
  });
});

test('the SHIPPED reference adapters pass untouched — the adoption dry-run stays green', (t) => {
  // This is the case that decides whether the gate can be wired into CI at all: the dry-run copies
  // `adapters/reference/*.json` into an adopted layout, and neither declares a mechanism because
  // neither could have. A finding here would be an outage for every existing adopter, so it is
  // asserted against the real files rather than against a fixture that resembles them.
  // Bundle-only: `adapters/reference/` is not installed by copy-manifest — the dry-run stages the
  // same files at the governed path. Look in both, and skip where neither exists rather than
  // failing an adopter's suite over a fixture they were never given.
  const names = ['github-branch-protection.json', 'grc-control-register.json'];
  const base = [new URL('../adapters/reference/', import.meta.url), new URL('../docs/governance/adapters/', import.meta.url)]
    .find((d) => names.every((n) => existsSync(new URL(n, d))));
  if (!base) { t.skip('the reference adapters are absent in this layout'); return; }
  const refs = names.map((n) => JSON.parse(readFileSync(new URL(n, base), 'utf8')));
  withRepo({ adapters: refs }, (d) => {
    const r = run(d, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.active, 0);
    assert.deepEqual(r.notices, [], 'and no second notice — adapter-check owns declared-vs-active for these');
    for (const s of r.states) assert.equal(s.stream, false);
  });
});

test('removing ONE stream\'s evidence leaves only that stream declared — streams are independent', () => {
  withRepo({ adapters: [PA_ADAPTER, HOLD_ADAPTER], evidence: [paEvidence()], activation: [forgeObservation()] }, (d) => {
    assert.equal(run(d, { now: NOW }).active, 2);
    rmSync(`${d}/docs/governance/platform-activation`, { recursive: true, force: true });
    const r = run(d, { now: NOW });
    assert.equal(r.active, 1);
    assert.deepEqual([...r.satisfied], ['PA-GATES'], 'the surviving stream is unaffected, and the lost one is simply declared');
  });
});
