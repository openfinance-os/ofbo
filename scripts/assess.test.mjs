// Tests for the brownfield assessment. Node runner: `node --test`.
//
// The risk in a tool like this is not that it crashes — it is that it FLATTERS. A report that
// lists what it found, says nothing about what it could not see, and calls the result a posture
// is precisely the "claim outruns evidence" failure this method exists to refuse, dressed up as
// a feature. So most of what is pinned here is restraint:
//
//   · a file present is never reported as a control operating
//   · an inference is labelled an inference, separately from observations
//   · the unknowable list is printed on EVERY run, including the most flattering one
//   · an existing file is reported as preserved, never as something adoption would overwrite
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSESS = join(HARNESS, 'assess.mjs');
// assess.mjs is BUNDLE-ONLY (it drives the installer against a target repo), like adopt.mjs.
if (!existsSync(ASSESS)) {
  test('brownfield assessment (bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
const { observe, assess, costOfTier, availableBases, UNKNOWABLE, main } = await import(ASSESS);

/** Build a throwaway repository with the given files. */
function repo(files = {}, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brown-'));
  if (git) mkdirSync(join(dir, '.git'), { recursive: true });
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  return dir;
}
const withRepo = (files, opts, fn) => {
  const dir = repo(files, opts);
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// --- observation is fact-only ------------------------------------------------------------------

test('an empty repository observes nothing and claims nothing', () => {
  withRepo({}, {}, (dir) => {
    const { observed, inferred, recommendation } = assess(observe(dir));
    assert.deepEqual(observed, []);
    assert.deepEqual(inferred, []);
    assert.equal(recommendation.tier, 'core');
  });
});

test('a real CODEOWNERS is observed; a placeholder one is not credited', () => {
  withRepo({ CODEOWNERS: '* @acme/engineering\n' }, {}, (dir) => {
    const o = observe(dir);
    assert.equal(o.codeowners.present, true);
    assert.equal(o.codeowners.placeholder, false);
    assert.deepEqual(o.codeowners.teams, ['@acme/engineering']);
    assert.ok(assess(o).observed.some((s) => /CODEOWNERS names 1 team/.test(s)));
  });
  withRepo({ CODEOWNERS: '* @your-org/platform-admins\n' }, {}, (dir) => {
    const { observed, actions } = assess(observe(dir));
    assert.ok(!observed.some((s) => /names \d+ team/.test(s)), 'a placeholder must not read as a real owner');
    assert.ok(actions.some((a) => /HG-0002/.test(a)));
  });
});

test('CODEOWNERS is also found at .github/CODEOWNERS', () => {
  withRepo({ '.github/CODEOWNERS': '* @acme/eng\n' }, {}, (dir) => {
    assert.equal(observe(dir).codeowners.present, true);
  });
});

test('a non-git directory is called out — the merge policy assumes git', () => {
  withRepo({}, { git: false }, (dir) => {
    assert.ok(assess(observe(dir)).actions.some((a) => /git repository/.test(a)));
  });
});

// --- inference is labelled, never mixed into observations ---------------------------------------

test('a regulated-looking repo yields an INFERENCE, not an observation', () => {
  withRepo({ 'docs/governance/control-catalog.json': '{}', 'compliance/policy.md': '#' }, {}, (dir) => {
    const { observed, inferred, recommendation } = assess(observe(dir));
    assert.ok(inferred.some((s) => /regulated posture/.test(s)));
    assert.ok(!observed.some((s) => /regulated/.test(s)), 'a guess must never appear among the observed facts');
    assert.equal(recommendation.profile, 'regulated-bank');
    assert.match(recommendation.profileWhy, /cannot tell a regulator from a folder name/);
  });
});

test('an ordinary repo gets the lightest base this bundle SHIPS — never one it does not', () => {
  // The tool must not name a profile the adopter cannot use. `standard` ships in a later bundle
  // than `regulated-bank`, so the recommendation is read from profiles/, not hard-coded.
  withRepo({ 'package.json': '{"scripts":{"test":"node --test"}}' }, {}, (dir) => {
    const { recommendation } = assess(observe(dir));
    assert.ok(availableBases().includes(recommendation.profile), `recommended ${recommendation.profile}, which this bundle does not ship`);
  });
});

test('with both bases available, an ordinary repo gets standard and a regulated one gets the bank', () => {
  withRepo({ 'package.json': '{}' }, {}, (dir) => {
    assert.equal(assess(observe(dir), ['regulated-bank', 'standard']).recommendation.profile, 'standard');
  });
  withRepo({ 'compliance/policy.md': '#' }, {}, (dir) => {
    assert.equal(assess(observe(dir), ['regulated-bank', 'standard']).recommendation.profile, 'regulated-bank');
  });
});

test('with ONLY the bank base available, it is recommended and the extra weight is admitted', () => {
  withRepo({ 'package.json': '{}' }, {}, (dir) => {
    const { recommendation } = assess(observe(dir), ['regulated-bank']);
    assert.equal(recommendation.profile, 'regulated-bank');
    assert.match(recommendation.profileWhy, /more than you need/);
  });
});

// --- the tier bar is CARRIED DATA, not apparent sophistication ----------------------------------

test('core is recommended even to a well-equipped repo that carries no governance data', () => {
  withRepo({
    CODEOWNERS: '* @acme/eng\n',
    '.github/workflows/ci.yml': 'name: ci\n',
    'package.json': '{"scripts":{"test":"vitest"}}',
  }, {}, (dir) => {
    const { recommendation } = assess(observe(dir));
    assert.equal(recommendation.tier, 'core', 'looking capable is not the bar — carrying the data is');
  });
});

test('governed is recommended only when the repo already carries the data that tier governs', () => {
  withRepo({
    'docs/governance/identities.json': '{}',
    'docs/governance/model-manifest.json': '{}',
  }, {}, (dir) => {
    const { recommendation } = assess(observe(dir));
    assert.equal(recommendation.tier, 'governed');
    assert.match(recommendation.tierWhy, /real content to gate, not empty templates/);
  });
});

test('an already-adopted repo is told it is not a brownfield case', () => {
  withRepo({ '.loom/adoption.json': JSON.stringify({ bundle_version: '2.0.0-rc.24', tier: 'core', files: {} }) }, {}, (dir) => {
    const { observed, actions } = assess(observe(dir));
    assert.ok(observed.some((s) => /already adopted/.test(s)));
    assert.ok(actions.some((a) => /not a brownfield adoption/.test(a)));
  });
});

// --- cost comes from a real dry run, and collisions are PRESERVED -------------------------------

test('cost of a tier is measured by dry-running the real installer', () => {
  withRepo({}, {}, (dir) => {
    const core = costOfTier(dir, 'core');
    const full = costOfTier(dir, 'full');
    assert.ok(core.lands > 0);
    assert.ok(full.entries > core.entries, 'full must cost more than core');
    assert.ok(!existsSync(join(dir, 'scripts')), 'assessing must not install anything');
  });
});

test('an existing file is reported as a COLLISION that will be preserved, never overwritten', () => {
  withRepo({ CODEOWNERS: '* @acme/eng\n' }, {}, (dir) => {
    assert.ok(costOfTier(dir, 'core').collisions.includes('CODEOWNERS'));
  });
});

// --- the restraint that matters -----------------------------------------------------------------

test('the unknowable list is printed on EVERY run, including the most flattering', () => {
  const dir = repo({
    CODEOWNERS: '* @acme/eng\n',
    '.github/workflows/ci.yml': 'name: ci\n',
    'package.json': '{"scripts":{"test":"node --test"}}',
    'docs/governance/identities.json': '{}',
    'docs/governance/model-manifest.json': '{}',
  });
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try { main(['--dest', dir]); } finally { process.stdout.write = write; rmSync(dir, { recursive: true, force: true }); }
  const out = chunks.join('');
  assert.match(out, /WHAT THIS ASSESSMENT CANNOT SEE/);
  for (const u of UNKNOWABLE) assert.ok(out.includes(u), `missing: ${u}`);
  assert.match(out, /A file is not a control/);
  assert.match(out, /not a grade/);
});

test('--json carries the same separation of observed, inferred and unknowable', () => {
  const dir = repo({ 'docs/governance/control-catalog.json': '{}' });
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try { main(['--dest', dir, '--json']); } finally { process.stdout.write = write; rmSync(dir, { recursive: true, force: true }); }
  const j = JSON.parse(chunks.join(''));
  for (const k of ['observed', 'inferred', 'unknowable', 'recommendation', 'costs']) assert.ok(k in j, `--json is missing ${k}`);
  assert.ok(j.unknowable.length > 0);
});

test('a directory that does not exist exits non-zero rather than assessing nothing', () => {
  const err = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try { assert.equal(main(['--dest', join(tmpdir(), 'definitely-not-here-9f2a')]), 2); }
  finally { process.stderr.write = err; }
});
}
