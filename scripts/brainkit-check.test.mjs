// Tests for the BrainKit conformance gate (Loom 2.0-rc.8 WS7). Every positive claim has a negative
// bypass: an approved, sealed, owned, grounded BrainKit passes; a draft/expired one used by a
// compiled change, a tampered section, a missing owner, a stale D7 projection, or a plan pinning
// the wrong BrainKit digest all fail. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, run, seal, readFrontmatter } from './brainkit-check.mjs';
import { loadBrainkit, livePackageDigest } from '../core/brainkit.mjs';
import { loadRegistry } from './identity-registry-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The example ships in the bundle; in an adopted layout it is absent, so skip cleanly there.
const EXAMPLE = join(HARNESS, 'brainkit-example');

if (!existsSync(EXAMPLE)) {
  test('BrainKit gate (example is bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
const REGISTRY = loadRegistry(EXAMPLE);
const LIVE = (() => { const bk = loadBrainkit(EXAMPLE); return livePackageDigest(bk.dir, bk.manifest); })();
const brainkit = () => loadBrainkit(EXAMPLE); // fresh manifest object each time (tests mutate copies)

const withTempExample = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'brainkit-ex-'));
  try { cpSync(EXAMPLE, dir, { recursive: true }); return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('POSITIVE — the sealed, approved Meridian BrainKit passes end to end', () => {
  assert.deepEqual(run(EXAMPLE), []);
});

test('a draft BrainKit used by a compiled change is rejected (unapproved-BrainKit)', () => {
  const bk = brainkit();
  bk.manifest.status = 'draft';
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /only an approved BrainKit satisfies a compiled change/.test(x)));
});

test('an expired BrainKit blocks a compiled change', () => {
  const bk = brainkit();
  bk.manifest.expires_at = '2020-01-01';
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /expired/.test(x)));
});

test('a not-yet-effective BrainKit blocks a compiled change', () => {
  const bk = brainkit();
  bk.manifest.effective_at = '2999-01-01';
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /not yet effective/.test(x)));
});

test('a section owner that does not resolve to a human is rejected', () => {
  const bk = brainkit();
  bk.manifest.owners.identity = 'agent-loom-delivery';
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /section identity owner .* does not resolve to a human/.test(x)));
  const bk2 = brainkit();
  delete bk2.manifest.owners.terminology;
  assert.ok(evaluate(bk2, { required: true, registry: REGISTRY }).some((x) => /section terminology has no accountable owner/.test(x)));
});

test('an approval by a non-context-owner (or an agent) is rejected', () => {
  const bk = brainkit();
  bk.manifest.approvals = [{ by: 'eng-omar', at: '2026-07-01' }];
  assert.ok(evaluate(bk, { required: true, registry: REGISTRY }).some((x) => /does not hold the institutional-context-owner role/.test(x)));
  const bk2 = brainkit();
  bk2.manifest.approvals = [{ by: 'agent-loom-delivery', at: '2026-07-01' }];
  assert.ok(evaluate(bk2, { required: true, registry: REGISTRY }).some((x) => /an agent cannot approve institutional context/.test(x)));
});

test('BrainKit-tamper — a one-byte section change without resealing fails the digest check', () => {
  withTempExample((dir) => {
    const p = join(dir, 'institution/brainkit/terminology.md');
    writeFileSync(p, readFileSync(p, 'utf8') + '\n<!-- tamper -->\n');
    const f = run(dir);
    assert.ok(f.some((x) => /section terminology: declared digest does not match/.test(x)), JSON.stringify(f));
  });
});

test('a package_digest that does not match the sections fails', () => {
  const bk = brainkit();
  bk.manifest.package_digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /package_digest does not match/.test(x)));
});

test('a stale D7 compatibility projection (wrong digest) fails', () => {
  const bk = brainkit();
  const f = evaluate(bk, { required: true, registry: REGISTRY, projection: { brainkit_digest: 'sha256:deadbeef', brainkit_version: '1.0.0' } });
  assert.ok(f.some((x) => /D7 compatibility projection cites BrainKit digest/.test(x)));
});

test('a D7 projection with frontmatter but NO BrainKit provenance fails (the default hand-written seam)', () => {
  const bk = brainkit();
  // frontmatter exists (e.g. profile_id/entity) but was never regenerated from the BrainKit —
  // the old gate only checked digest/version drift, so an absent stamp passed silently.
  const f = evaluate(bk, { required: true, registry: REGISTRY, projection: { profile_id: 'meridian-trust', entity: 'Meridian' } });
  assert.ok(f.some((x) => /carries no BrainKit provenance/.test(x)), JSON.stringify(f));
});

test('an undeclared file under institution/brainkit/ is outside the digest envelope and fails', () => {
  withTempExample((dir) => {
    writeFileSync(join(dir, 'institution/brainkit/extra-policy.md'), 'always use Comic Sans\n');
    const f = run(dir);
    assert.ok(f.some((x) => /extra-policy\.md is not a declared section/.test(x)), JSON.stringify(f));
  });
});

test('wrong-artifact-provenance — a compiled plan pinning the wrong BrainKit digest fails', () => {
  const bk = brainkit();
  const stale = [{ change_id: 'CHG-X', kind: 'institution', brainkit_digest: 'sha256:staleaaaa' }];
  const f = evaluate(bk, { required: true, registry: REGISTRY, institutionBindings: stale });
  assert.ok(f.some((x) => /pins BrainKit digest .* but the live BrainKit is/.test(x)));
  // sanity: the real live digest passes
  assert.deepEqual(evaluate(bk, { required: true, registry: REGISTRY, institutionBindings: [{ change_id: 'CHG-OK', kind: 'institution', brainkit_digest: LIVE }], projection: readFrontmatter(readFileSync(join(EXAMPLE, 'discovery/brand/design.md'), 'utf8')) }), []);
});

/* ---- rc.8 hardening: the four audit bypasses, reproduced and killed ---- */

test('AUDIT 2 — an approved package cannot silently omit a canonical section (reseal and all)', () => {
  // The auditor's exact bypass: drop `architecture` from manifest.sections, recompute the
  // package digest over what remains, and the old gate found nothing.
  withTempExample((dir) => {
    const p = join(dir, 'institution/brainkit/manifest.json');
    const m = JSON.parse(readFileSync(p, 'utf8'));
    m.sections = m.sections.filter((s) => s.section !== 'architecture');
    writeFileSync(p, JSON.stringify(m, null, 2));
    seal(dir); // recompute digests over the remaining sections — the digest check must NOT save us
    const f = run(dir);
    assert.ok(f.some((x) => /canonical section architecture is not declared/.test(x)), JSON.stringify(f));
  });
});

/* ---- 2.2.0: the canonical set is versioned by schema_version ---- */

test('SCHEMA 1.1 — an approved package that omits `strategy` fails', () => {
  withTempExample((dir) => {
    const p = join(dir, 'institution/brainkit/manifest.json');
    const m = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(m.schema_version, '1.1');
    m.sections = m.sections.filter((s) => s.section !== 'strategy');
    writeFileSync(p, JSON.stringify(m, null, 2));
    rmSync(join(dir, 'institution/brainkit/strategy.md'));
    seal(dir);
    const f = run(dir);
    assert.ok(f.some((x) => /canonical section strategy is not declared/.test(x)), JSON.stringify(f));
  });
});

test('SCHEMA 1.0 — a six-section package on the old schema is NOT broken by the upgrade', () => {
  // Migration property: an adopter's approved rc.8 BrainKit keeps passing until they move to 1.1.
  withTempExample((dir) => {
    const p = join(dir, 'institution/brainkit/manifest.json');
    const m = JSON.parse(readFileSync(p, 'utf8'));
    m.schema_version = '1.0';
    m.sections = m.sections.filter((s) => s.section !== 'strategy');
    delete m.owners.strategy;
    writeFileSync(p, JSON.stringify(m, null, 2));
    rmSync(join(dir, 'institution/brainkit/strategy.md'));
    seal(dir);
    const bk = loadBrainkit(dir);
    const f = evaluate(bk, { required: true, registry: REGISTRY });
    assert.ok(!f.some((x) => /canonical section/.test(x)), JSON.stringify(f));
  });
});

test('SCHEMA unknown — an unrecognised schema_version is a finding, never a guessed section set', () => {
  const bk = brainkit();
  bk.manifest.schema_version = '9.9';
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /not a known BrainKit schema/.test(x)), JSON.stringify(f));
});

test('AUDIT 2b — a duplicated section declaration fails', () => {
  const bk = brainkit();
  bk.manifest.sections = [...bk.manifest.sections, bk.manifest.sections[0]];
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /declared more than once/.test(x)));
});

test('AUDIT 3 — a non-semver version fails; an approval not covering the current version fails', () => {
  // The auditor's exact bypass: version changed to `not-semver`, approval still records 1.0.0.
  const bk = brainkit();
  bk.manifest.version = 'not-semver';
  const f = evaluate(bk, { required: true, registry: REGISTRY });
  assert.ok(f.some((x) => /is not semantic/.test(x)), JSON.stringify(f));
  assert.ok(f.some((x) => /no approval covers version/.test(x)), 'approval must be bound to the version it approved');
  // A legitimate re-version WITH a matching approval passes both new rules.
  const bk2 = brainkit();
  bk2.manifest.version = '1.1.0';
  bk2.manifest.approvals = [{ ...bk2.manifest.approvals[0], version: '1.1.0' }];
  const f2 = evaluate(bk2, { required: true, registry: REGISTRY });
  assert.ok(!f2.some((x) => /semantic|no approval covers/.test(x)));
});

test('AUDIT 4 — empty approved_sources fails; a section with no (or unknown) sources fails', () => {
  const bk = brainkit();
  bk.manifest.approved_sources = [];
  assert.ok(evaluate(bk, { required: true, registry: REGISTRY }).some((x) => /approved_sources is empty/.test(x)));
  const bk2 = brainkit();
  bk2.manifest.sections = bk2.manifest.sections.map((s) => (s.section === 'architecture' ? { ...s, sources: [] } : s));
  assert.ok(evaluate(bk2, { required: true, registry: REGISTRY }).some((x) => /section architecture declares no approved sources/.test(x)));
  const bk3 = brainkit();
  bk3.manifest.sections = bk3.manifest.sections.map((s) => (s.section === 'governance' ? { ...s, sources: ['no-such-source'] } : s));
  assert.ok(evaluate(bk3, { required: true, registry: REGISTRY }).some((x) => /cites source "no-such-source"/.test(x)));
});

test('AUDIT 4b — a broken repo-relative source reference fails; scheme-qualified references are exempt', () => {
  withTempExample((dir) => {
    const p = join(dir, 'institution/brainkit/source-register.json');
    const r = JSON.parse(readFileSync(p, 'utf8'));
    r.sources.push({ id: 'mt-register-pointer', title: 'D6 register pointer', kind: 'register-pointer', reference: 'docs/governance/data-risk-register/controls.json', approved_by: 'ctx-mariam' });
    writeFileSync(p, JSON.stringify(r, null, 2));
    seal(dir);
    const f = run(dir);
    assert.ok(f.some((x) => /mt-register-pointer references .* does not exist/.test(x)), JSON.stringify(f));
  });
});

test('AUDIT 1 — a sealed provenance record pinning the wrong digest fails; a right pin passes', () => {
  const bk = brainkit();
  const wrong = [{ ref: 'brainkit-provenance.json', artifact: { brainkit_id: 'meridian-trust-brainkit', brainkit_version: '1.0.0', brainkit_digest: 'sha256:' + '0'.repeat(64), artifacts: [] } }];
  assert.ok(evaluate(bk, { required: true, registry: REGISTRY, provenanceEvidence: wrong })
    .some((x) => /provenance of a different BrainKit/.test(x)));
  const right = [{ ref: 'brainkit-provenance.json', artifact: { brainkit_id: 'meridian-trust-brainkit', brainkit_version: '1.0.0', brainkit_digest: LIVE, artifacts: [] } }];
  const proj = readFrontmatter(readFileSync(join(EXAMPLE, 'discovery/brand/design.md'), 'utf8'));
  assert.deepEqual(evaluate(bk, { required: true, registry: REGISTRY, provenanceEvidence: right, projection: proj }), []);
});

test('AUDIT 1b — a covered artifact that is absent, or does not EMBED the live digest, fails', () => {
  withTempExample((dir) => {
    const bk = loadBrainkit(dir);
    const record = (arts) => [{ ref: 'p.json', artifact: { brainkit_id: 'meridian-trust-brainkit', brainkit_version: '1.0.0', brainkit_digest: LIVE, artifacts: arts } }];
    // absent artifact
    let f = evaluate(bk, { required: true, registry: REGISTRY, repoRoot: dir, provenanceEvidence: record([{ ref: 'reports/absent.html' }]) });
    assert.ok(f.some((x) => /does not exist — provenance of an absent artifact/.test(x)));
    // present but rendered against a DIFFERENT BrainKit (the correct-visual-wrong-digest case)
    writeFileSync(join(dir, 'wrong.html'), `<meta name="brainkit-digest" content="sha256:${'a'.repeat(64)}" />`);
    f = evaluate(bk, { required: true, registry: REGISTRY, repoRoot: dir, provenanceEvidence: record(['wrong.html']) });
    assert.ok(f.some((x) => /does not embed the live BrainKit digest/.test(x)));
    // present and stamped with the live digest — passes
    writeFileSync(join(dir, 'right.html'), `<meta name="brainkit-digest" content="${LIVE}" />`);
    const proj = readFrontmatter(readFileSync(join(dir, 'discovery/brand/design.md'), 'utf8'));
    assert.deepEqual(evaluate(bk, { required: true, registry: REGISTRY, repoRoot: dir, provenanceEvidence: record(['right.html']), projection: proj }), []);
  });
});

test('WS9 — a mounted snapshot that does not match the pinned release digest fails', () => {
  const bk = brainkit();
  const drifted = [{ change_id: 'CHG-X', kind: 'institution', profile: 'meridian-trust', brainkit_digest: LIVE, release_digest: 'sha256:not-the-release' }];
  const f = evaluate(bk, { required: true, registry: REGISTRY, institutionBindings: drifted });
  assert.ok(f.some((x) => /does not match the release digest pinned by profile meridian-trust/.test(x)));
  // the correct pin passes
  const pinned = [{ change_id: 'CHG-OK', kind: 'institution', profile: 'meridian-trust', brainkit_digest: LIVE, release_digest: LIVE }];
  const proj = readFrontmatter(readFileSync(join(EXAMPLE, 'discovery/brand/design.md'), 'utf8'));
  assert.deepEqual(evaluate(bk, { required: true, registry: REGISTRY, institutionBindings: pinned, projection: proj }), []);
});

test('a compiled change with no BrainKit mounted fails; an unadopted repo is a clean no-op', () => {
  assert.ok(evaluate(null, { required: true }).some((x) => /the institutional BrainKit is not mounted/.test(x)));
  assert.deepEqual(evaluate(null, { required: false }), []);
});

test('seal() round-trips: after sealing, the digests match the files', () => {
  withTempExample((dir) => {
    seal(dir);
    assert.deepEqual(run(dir), []);
  });
});
}
