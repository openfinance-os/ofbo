// The product-eval gate — evals as product management (meso ring; enterprise-rings.md). The
// model-provenance gate governs the agent AS A MODEL; this gate governs the PRODUCT's outcome.
// The Loom-native move: a discovery hand-off's success measures (D1) are not left on paper —
// they become the eval a release is SCORED against. "Writing evals is the new product
// management" made a merge condition.
//
//   A product that declares evals MUST link its discovery hand-off, score every success
//   measure from it, and carry a passing eval RUN AGAINST THE SHIPPING COMMIT — a regression
//   on any success measure, or an eval run against a different commit, blocks the release.
//
// The evaluated-commit match is the anti-stale control, the product analogue of the
// model-provenance pin-match (and Q1b's spirit, one ring up): an eval that passed against an
// older build proves nothing about what ships. The eval RIG (how you score a measure) is the
// adopter's to build; this gate enforces that a release cannot claim product-green without a
// fresh, discovery-linked, sealed eval.
//
// An ABSENT product-evals.json is OK — not every repo is product-bearing. A PRESENT manifest
// binds every product it declares (a mounted seam with no products is a finding, not a pass).
//
// Run from the repo root: `node scripts/product-eval-check.mjs [--commit <sha>]`
// (the CLI also reads GITHUB_SHA). Exit 1 on any finding.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { aggregateRequirements, requiredBy } from '../core/compiled-requirements.mjs';
import { pathToFileURL } from 'node:url';

const MANIFEST_LOCATIONS = ['docs/governance/product-evals.json', 'product-evals.json'];

/** Findings (one per violation). Empty ⇒ every declared product is discovery-linked, its
 *  success measures all pass, and its eval is fresh + sealed against the shipping commit.
 *  `shippingCommit` (from CI) enforces the anti-stale match; `baseDir` re-hashes each report. */
export function evaluate(manifest, { shippingCommit = null, baseDir = null } = {}) {
  const findings = [];
  const products = manifest && manifest.products;
  if (!Array.isArray(products)) return ['product-evals.json has no `products` array'];
  if (products.length === 0) {
    return ['product-evals.json is present but declares no products — declare the product(s) this release ships, with their discovery-linked success measures'];
  }
  for (const p of products) {
    const id = (p && p.product_id) || '(unnamed product)';
    if (!(typeof p.discovery === 'string' && p.discovery.trim())) {
      findings.push(`${id}: no discovery link — a product eval scores the hand-off's success measures (D1); name the run`);
    }
    // Every success measure from the hand-off is scored, and none regressed.
    const sms = p.success_measures;
    if (!Array.isArray(sms) || sms.length === 0) {
      findings.push(`${id}: no success_measures — there is nothing to score the release against`);
    } else {
      for (const sm of sms) {
        const sid = (sm && sm.id) || '(unnamed measure)';
        for (const field of ['statement', 'threshold']) {
          if (!(typeof sm[field] === 'string' && sm[field].trim())) findings.push(`${id} · ${sid}: success measure declares no ${field}`);
        }
        if (sm.result !== 'pass' || sm.threshold_met !== true) {
          findings.push(`${id} · ${sid}: success measure did not meet its threshold (result=${JSON.stringify(sm.result)}, threshold_met=${JSON.stringify(sm.threshold_met)}) — a regression blocks the release`);
        }
      }
    }
    // The eval itself: passing, identified, sealed, and RUN AGAINST THE SHIPPING COMMIT.
    const e = p.eval;
    if (!e || typeof e !== 'object') {
      findings.push(`${id}: no eval block — a release cannot claim product-green without a fresh eval`);
      continue;
    }
    if (e.result !== 'pass' || e.threshold_met !== true) {
      findings.push(`${id}: eval did not pass its threshold (result=${JSON.stringify(e.result)}, threshold_met=${JSON.stringify(e.threshold_met)})`);
    }
    if (!(typeof e.evaluated_commit === 'string' && e.evaluated_commit.trim())) {
      findings.push(`${id}: eval declares no evaluated_commit — an eval not bound to a commit cannot be proven fresh`);
    } else if (shippingCommit && e.evaluated_commit !== shippingCommit) {
      findings.push(`${id}: stale eval — it was run against ${e.evaluated_commit.slice(0, 12)}…, not the shipping commit ${shippingCommit.slice(0, 12)}…`);
    }
    for (const field of ['dataset_version', 'runner_version', 'ran_at']) {
      if (!(typeof e[field] === 'string' && e[field].trim())) findings.push(`${id}: eval declares no ${field} — an unidentified eval is a claim, not evidence`);
    }
    const r = e.report;
    if (!r || typeof r.ref !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256 || '')) {
      findings.push(`${id}: eval has no report {ref, sha256} — the evaluation artifact must be sealed, not just its verdict`);
    } else if (baseDir) {
      const path = `${baseDir}/${r.ref}`;
      if (!existsSync(path)) findings.push(`${id}: eval report ${r.ref} not found — a referenced artifact must exist`);
      else if (createHash('sha256').update(readFileSync(path)).digest('hex') !== r.sha256) {
        findings.push(`${id}: eval report ${r.ref} does not match its declared sha256 — the report was altered after the manifest was written`);
      }
    }
  }
  return findings;
}

export function run(cwd = process.cwd(), shippingCommit = null) {
  const path = MANIFEST_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) {
    // Absence is OK for a generic repo — but NOT once a compiled plan requires product evals
    // (W1, closes F3). Optionality is compiled, never hardcoded.
    const agg = aggregateRequirements(cwd);
    if (agg.families.has('product-eval')) {
      return { present: false, findings: [`no product-evals.json, but a compiled plan requires product evals [${requiredBy(agg, 'product-eval').join(', ')}] — a required capability cannot be absent`] };
    }
    return { present: false, findings: [] };
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { present: true, findings: [`product-evals.json is not valid JSON: ${e.message}`] }; }
  return { present: true, findings: evaluate(manifest, { shippingCommit, baseDir: cwd }) };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // On a pull_request build GITHUB_SHA is the EPHEMERAL merge commit, which an eval committed on
  // the PR head cannot possibly name — so relying on it fails every PR as "stale". Prefer an
  // explicit --commit (the CI passes the PR head sha), then GITHUB_HEAD_SHA if the workflow set
  // it, and only then GITHUB_SHA (correct on push / merge_group).
  const ci = process.argv.indexOf('--commit');
  const shippingCommit = ci >= 0 ? process.argv[ci + 1]
    : (process.env.GITHUB_HEAD_SHA || process.env.GITHUB_SHA || null);
  const { present, findings } = run(process.cwd(), shippingCommit);
  if (!present && findings.length === 0) {
    process.stdout.write('Product-eval gate — no product-evals.json; not a product-bearing repo. OK\n');
    process.exit(0);
  }
  if (findings.length) {
    process.stderr.write('\nProduct-eval gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery declared product must link its discovery hand-off, pass every success measure,\nand carry a fresh sealed eval run against the shipping commit. See enterprise-rings.md.\n');
    process.exit(1);
  }
  process.stdout.write('Product-eval gate — every product discovery-linked, measures green, eval fresh. OK\n');
}
