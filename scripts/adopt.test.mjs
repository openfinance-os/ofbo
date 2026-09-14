// The installer contract (Loom 2.0-rc.8 WS1). copy-manifest.json is the single source of truth
// for what the Loom lays into an adopting repo, and rc.8 makes it real in CI: the adoption
// dry-run installs THROUGH adopt.mjs, not a hand-maintained `cp` list. These tests pin the
// property that makes that safe — the installer is manifest-driven, so a new entry lands in the
// adopted layout with no per-entry code or CI change, and the generated copy table cannot
// silently drop one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// adopt.mjs and copy-manifest.json are BUNDLE-ONLY — the installer is not itself installed into
// an adopting repo. In an adopted layout scripts/*.test.mjs still runs, so skip cleanly there
// (the doc-integrity gate uses the same "inert where the bundle is absent" pattern).
const HARNESS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADOPT = resolve(HARNESS_DIR, 'adopt.mjs');
if (!existsSync(ADOPT)) {
  test('adopt.mjs installer contract (bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
const { install, loadManifest, copyTable, bundleVersion, TIERS, tierIncludes, entriesForTier } = await import(ADOPT);

const withTempDest = (fn) => {
  const dest = mkdtempSync(join(tmpdir(), 'loom-adopt-'));
  try { return fn(dest); } finally { rmSync(dest, { recursive: true, force: true }); }
};

test('every manifest entry resolves to a real source (adopt.mjs installs clean)', () => {
  // A wrong source path was invisible while CI copied files by hand; running the real installer
  // in CI makes it a build failure — this test makes it a unit failure too.
  const report = withTempDest((dest) => install(dest, { dryRun: true }));
  const missing = report.filter((r) => r.status === 'source-missing');
  assert.equal(missing.length, 0, `source-missing entries: ${missing.map((m) => m.source).join(', ')}`);
});

test('a new copy-manifest entry lands in the adopted layout with no parallel CI copy line', () => {
  // WS1's core promise: adding an entry to the manifest is SUFFICIENT for it to appear in the
  // adopted layout. If this ever needed a companion `cp` line, the manifest would not be the
  // source of truth it claims to be.
  const manifest = loadManifest();
  const synthetic = { source: 'copy-manifest.json', dest: 'docs/governance/_ws1-probe.json', kind: 'file', seam: 'WS1 probe' };
  const augmented = { ...manifest, entries: [...manifest.entries, synthetic] };
  withTempDest((dest) => {
    const report = install(dest, { manifest: augmented });
    const landed = report.find((r) => r.dest === synthetic.dest);
    assert.ok(landed && landed.status !== 'source-missing', 'synthetic entry did not install');
    assert.ok(existsSync(join(dest, synthetic.dest)), 'synthetic dest file was not written');
  });
});

test('the generated copy table lists every manifest entry (docs cannot silently drop one)', () => {
  const manifest = loadManifest();
  const table = copyTable(manifest);
  for (const e of manifest.entries) {
    const src = e.kind === 'glob' ? `${e.source}/${e.glob}` : e.source;
    assert.ok(table.includes(src), `copy table is missing entry source ${src}`);
  }
});

test('re-running the installer is idempotent (second run reports already-current, never source-missing)', () => {
  withTempDest((dest) => {
    install(dest); // first run writes
    const second = install(dest); // second run over the same tree
    assert.equal(second.filter((r) => r.status === 'source-missing').length, 0);
    const files = second.filter((r) => r.status === 'already-current' || r.status === 'adopt-pending');
    assert.ok(files.length > 0, 'a second install should find unchanged files already-current');
  });
});

// --- the version stamp and safe upgrade (rc.18) -----------------------------------------------
//
// The property: following loom-adopt step 3 and then upgrading must not destroy the work. Before
// the stamp, `scripts/discovery-link-check.mjs` (set FEATURE to your story-id convention) and
// `.claude/hooks/pii-guard.sh` (your jurisdiction's PII shapes) were overwritten on every re-run,
// silently. These are end-to-end against the real manifest, because the failure was end-to-end.

test('the installer stamps the adoption with the bundle version and what it installed', () => {
  withTempDest((dest) => {
    install(dest);
    const stamp = JSON.parse(readFileSync(join(dest, '.loom/adoption.json'), 'utf8'));
    assert.equal(stamp.bundle_version, bundleVersion());
    assert.ok(Object.keys(stamp.files).length > 50, 'the stamp should cover the managed tree');
    assert.ok(stamp.files['scripts/discovery-link-check.mjs'], 'globbed files are stamped per file, not per entry');
    assert.equal(stamp.history.at(-1).version, bundleVersion());
  });
});

test('AN ADOPTER EDIT SURVIVES A RE-RUN, with the upstream version beside it', () => {
  withTempDest((dest) => {
    install(dest);
    const edited = join(dest, 'scripts/discovery-link-check.mjs');
    appendFileSync(edited, '\n// MY-PROJECT story-id convention\n');
    const report = install(dest);
    assert.match(readFileSync(edited, 'utf8'), /MY-PROJECT/, 'the adopter edit was destroyed');
    assert.ok(existsSync(`${edited}.loom-new`), 'the new upstream version should be dropped beside it');
    assert.ok(report.some((r) => r.status === 'local-edit-preserved'), 'the report must say what it preserved');
  });
});

test('one customised file does not freeze its neighbours in the same entry', () => {
  withTempDest((dest) => {
    install(dest);
    appendFileSync(join(dest, 'scripts/discovery-link-check.mjs'), '\n// LOOM-TEST-LOCAL-EDIT\n');
    rmSync(join(dest, 'scripts/sast-check.mjs'));
    install(dest);
    assert.ok(existsSync(join(dest, 'scripts/sast-check.mjs')), 'a sibling in the same glob should still be installed');
    assert.match(readFileSync(join(dest, 'scripts/discovery-link-check.mjs'), 'utf8'), /LOOM-TEST-LOCAL-EDIT/);
  });
});

test('a preserved file stays preserved across MANY runs (the stamp is not overwritten with the edit)', () => {
  withTempDest((dest) => {
    install(dest);
    const edited = join(dest, 'scripts/discovery-link-check.mjs');
    appendFileSync(edited, '\n// LOOM-TEST-LOCAL-EDIT\n');
    install(dest); install(dest); install(dest);
    assert.match(readFileSync(edited, 'utf8'), /LOOM-TEST-LOCAL-EDIT/, 'a later run clobbered it — the stamp recorded the wrong digest');
  });
});

test('--force overwrites an edit, and is the ONLY way to', () => {
  withTempDest((dest) => {
    install(dest);
    const edited = join(dest, 'scripts/discovery-link-check.mjs');
    appendFileSync(edited, '\n// LOOM-TEST-LOCAL-EDIT\n');
    install(dest, { force: true });
    assert.doesNotMatch(readFileSync(edited, 'utf8'), /LOOM-TEST-LOCAL-EDIT/, '--force should overwrite');
  });
});

test('a pre-stamp adoption preserves rather than guesses', () => {
  withTempDest((dest) => {
    install(dest);
    rmSync(join(dest, '.loom'), { recursive: true, force: true }); // adopted before stamping existed
    const edited = join(dest, 'scripts/sast-check.mjs');
    appendFileSync(edited, '\n// LOOM-TEST-FOREIGN-EDIT\n');
    const report = install(dest);
    assert.match(readFileSync(edited, 'utf8'), /LOOM-TEST-FOREIGN-EDIT/, 'unknown provenance must not be overwritten');
    assert.ok(report.some((r) => r.status === 'unverifiable-preserved'), 'and it must be reported as unverifiable, not as a clean update');
  });
});

test('a dry run writes nothing at all — not even the stamp', () => {
  withTempDest((dest) => {
    install(dest, { dryRun: true });
    assert.ok(!existsSync(join(dest, '.loom/adoption.json')));
    assert.ok(!existsSync(join(dest, 'scripts/sast-check.mjs')));
  });
});

// --- adoption tiers (rc.24) ------------------------------------------------------------------
//
// The burden this stages is the ADOPT markers, not the gates. Two invariants carry that, and
// both are the kind that a later, well-meaning tier reassignment silently breaks:
//
//   1. EVERY TIER GETS EVERY GATE. Tiering the machinery would reintroduce the failure the
//      scripts glob's own comment warns about — a per-file list that drops new gates.
//   2. THE CATALOG MAY NOT CITE A GHOST. control-catalog-check fails on a mechanism_ref,
//      test_ref or doc_ref that does not exist, so anything the catalog names must be core.
//      This is exactly how the first tier assignment broke (ROUTINE-CONTROLLER.doc_ref).

test('tiers are cumulative, and an entry with no tier is core', () => {
  assert.deepEqual(TIERS, ['core', 'governed', 'full']);
  assert.ok(tierIncludes('full', 'core') && tierIncludes('full', 'governed') && tierIncludes('full', 'full'));
  assert.ok(tierIncludes('governed', 'core') && !tierIncludes('governed', 'full'));
  assert.ok(tierIncludes('core', 'core') && !tierIncludes('core', 'governed'));
  assert.ok(tierIncludes('core', undefined), 'an entry with no tier must land everywhere, not nowhere');
});

test('every manifest entry declares a known tier', () => {
  for (const e of loadManifest().entries) {
    assert.ok(TIERS.includes(e.tier ?? 'core'), `${e.dest} has unknown tier ${e.tier}`);
  }
});

test('EVERY TIER GETS EVERY GATE — only fill-in content is tiered', () => {
  const manifest = loadManifest();
  const core = new Set(entriesForTier(manifest, 'core').map((e) => e.dest));
  for (const dest of ['scripts', 'core', 'discovery/gates', 'discovery/render', 'profiles', '.claude/hooks', '.github/workflows/ci.yml']) {
    assert.ok(core.has(dest), `${dest} is machinery and must be in the core tier`);
  }
});

test('THE CATALOG MAY NOT CITE A GHOST — everything it references is core-tier', async () => {
  // The invariant that broke the first assignment. Derived from the catalog, not a hand list,
  // so a new control citing a deferred file fails here rather than in an adopter's CI.
  const manifest = loadManifest();
  const catalog = JSON.parse(readFileSync(resolve(HARNESS_DIR, 'governance/control-catalog.template.json'), 'utf8'));
  const refs = new Set();
  for (const c of catalog.controls) {
    for (const f of ['mechanism_ref', 'test_ref', 'doc_ref']) if (typeof c[f] === 'string') refs.add(c[f]);
  }
  const ownerTier = (ref) => {
    let best = null;
    for (const e of manifest.entries) {
      if (ref === e.dest || ref.startsWith(`${e.dest.replace(/\/$/, '')}/`)) {
        if (!best || e.dest.length > best.dest.length) best = e;
      }
    }
    return best ? (best.tier ?? 'core') : null;
  };
  const offenders = [...refs].filter((r) => { const t = ownerTier(r); return t && t !== 'core'; });
  assert.deepEqual(offenders, [], `catalog cites files the core tier does not install:\n${offenders.join('\n')}`);
});

test('a core adoption installs fewer entries but every gate, and stamps its tier', () => {
  withTempDest((dest) => {
    const report = install(dest, { tier: 'core' });
    assert.equal(report.tier, 'core');
    assert.ok(report.length < loadManifest().entries.length, 'core should install fewer entries than full');
    assert.ok(existsSync(join(dest, 'scripts/floor-only-check.mjs')), 'a deferred FEATURE must still ship its gate');
    assert.ok(!existsSync(join(dest, 'institution/brainkit/manifest.json')), 'full-tier content should not land at core');
    assert.equal(JSON.parse(readFileSync(join(dest, '.loom/adoption.json'), 'utf8')).tier, 'core');
  });
});

test('a re-run with no --tier keeps the adopted tier — never a silent demotion', () => {
  withTempDest((dest) => {
    install(dest, { tier: 'governed' });
    const again = install(dest);
    assert.equal(again.tier, 'governed');
  });
});

test('raising the tier adds the deferred entries and keeps the rest', () => {
  withTempDest((dest) => {
    install(dest, { tier: 'core' });
    assert.ok(!existsSync(join(dest, 'docs/governance/product-evals.json')));
    install(dest, { tier: 'governed' });
    assert.ok(existsSync(join(dest, 'docs/governance/product-evals.json')), 'governed content should arrive');
    assert.ok(existsSync(join(dest, 'discovery/gates')), 'core content should survive');
    install(dest, { tier: 'full' });
    assert.ok(existsSync(join(dest, 'institution/brainkit/manifest.json')));
  });
});

test('an unknown tier throws rather than installing something arbitrary', () => {
  withTempDest((dest) => {
    assert.throws(() => install(dest, { tier: 'enterprise' }), /unknown tier/);
  });
});

test('the copy table carries the tier column for every entry', () => {
  const manifest = loadManifest();
  const table = copyTable(manifest);
  assert.match(table, /\| Bundle source \| Destination \| Tier \| What it is \|/);
  assert.equal(table.split('\n').length, manifest.entries.length + 2);
});
}
