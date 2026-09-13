// Tests for the HG-0007 waist gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseItems, isItemStart, checkItems, coverage, hasContent, FEATURE, parseLicenses, conditionsCarried, isActiveStatus, swallowedListItems } from './discovery-link-check.mjs';

// A resolver whose behaviour is table-driven per slug.
const resolver = (map) => (slug) => (slug in map ? map[slug] : { handoffMissing: true });
const GREEN = null; // resolveRun returns null when a run is gate-green

test('parseItems slices block items and skips milestones', () => {
  const yaml = [
    'milestones:',
    '  - name: M1',
    '    items:',
    '      - id: BACKOFFICE-1',
    '        status: pending',
    '        title: a',
    '      - id: BACKOFFICE-2',
    '        status: done',
  ].join('\n');
  const items = parseItems(yaml);
  assert.equal(items.length, 2, 'two items, milestone header excluded');
  assert.match(items[0], /BACKOFFICE-1/);
  assert.match(items[0], /title: a/); // owns its deeper-indented lines
  assert.ok(!items[0].includes('BACKOFFICE-2'), 'a sibling ends the block');
});

test('parseItems handles inline flow items', () => {
  const items = parseItems('- { id: BACKOFFICE-9, status: pending }\n- name: not-an-item');
  assert.equal(items.length, 1);
  assert.match(items[0], /BACKOFFICE-9/);
});

test('isItemStart accepts item lines, rejects milestones', () => {
  assert.ok(isItemStart('  - id: BACKOFFICE-1'));
  assert.ok(isItemStart('- { id: BACKOFFICE-1 }'));
  assert.ok(!isItemStart('  - name: M1'));
  assert.ok(!isItemStart('    title: x'));
});

test('a pending feature with no discovery link fails (HG-0007)', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending', resolver({}));
  assert.equal(f.length, 1);
  assert.match(f[0], /pending feature with no 'discovery/);
});

// The escape hatch is the one way a feature reaches delivery without an evidenced problem.
// It may be taken — but only out loud. An exemption with no reason is a silent bypass of the
// gate that makes discovery non-optional, and it is the shape a reward-seeking agent finds
// first. The header comment, the failure message and the shipped example all promised a
// reason was required; until rc.33 nothing checked.
test('discovery_exempt:true WITH a reason lets a pending feature through', () => {
  assert.deepEqual(
    checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery_exempt: true\n  reason: Regulatory pin with no user-facing choice', resolver({})),
    [],
  );
});

test('discovery_exempt:true with NO reason is refused', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery_exempt: true', resolver({}));
  assert.equal(f.length, 1);
  assert.match(f[0], /BACKOFFICE-1/);
  assert.match(f[0], /reason/i);
});

test('an exemption reason that is only whitespace is refused', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery_exempt: true\n  reason: "   "', resolver({}));
  assert.equal(f.length, 1, 'blank is not a reason');
});

test('an exemption reason still carrying the ADOPT/TODO placeholder is refused', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery_exempt: true\n  reason: TODO', resolver({}));
  assert.equal(f.length, 1, 'a placeholder is not a reason a human can argue with');
});

test('a reason is only required when the exemption is actually claimed', () => {
  // A linked item needs no reason, and neither does a non-pending one.
  assert.deepEqual(checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: revoke-latency', resolver({ 'revoke-latency': GREEN })), []);
  assert.deepEqual(checkItems('- id: BACKOFFICE-1\n  status: done', resolver({})), []);
});

test('a linked, gate-green run passes', () => {
  assert.deepEqual(checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: revoke-latency', resolver({ 'revoke-latency': GREEN })), []);
});

test('a linked run with a missing hand-off fails', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: ghost', resolver({ ghost: { handoffMissing: true } }));
  assert.match(f[0], /no hand-off/);
});

test('a linked run failing its gates fails, naming the gates', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: leaky', resolver({ leaky: { failedGates: ['D6', 'D9'] } }));
  assert.match(f[0], /not gate-green \(failing: D6, D9\)/);
});

test('non-feature ids are not waist-gated', () => {
  assert.deepEqual(checkItems('- id: INFRA-3\n  status: pending', resolver({})), []);
});

test('an un-statused stub is grandfathered (only explicit pending triggers)', () => {
  assert.deepEqual(checkItems('- id: BACKOFFICE-1\n  title: someday', resolver({})), []);
});

test('shipped and parked items are grandfathered; in-flight ones are NOT (2.1.0)', () => {
  assert.deepEqual(checkItems('- id: BACKOFFICE-1\n  status: done\n- id: BACKOFFICE-2\n  status: blocked\n- id: BACKOFFICE-3\n  status: deferred', resolver({})), []);
  // flipping pending → in-progress used to walk around the waist; building is when the hand-off must exist
  const f = checkItems('- id: BACKOFFICE-2\n  status: in-progress', resolver({}));
  assert.equal(f.length, 1);
  assert.match(f[0], /in-progress feature with no 'discovery/);
  assert.ok(isActiveStatus('in-review') && isActiveStatus('ready') && !isActiveStatus('done') && !isActiveStatus(undefined));
});

// ── 2.1.0 — what a green link admits (plan row 1.2) ─────────────────────────────────────────
const LICENSED = (ids, extra = {}) => ({ verdict: 'yes', conditionsMissing: false, licenses: ids, ...extra });

test('a linked green run that names the item passes', () => {
  assert.deepEqual(checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: r', resolver({ r: LICENSED(['BACKOFFICE-1']) })), []);
});

test('a D6 verdict of No blocks at the waist even though every gate is green', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: r', resolver({ r: LICENSED(['BACKOFFICE-1'], { verdict: 'no' }) }));
  assert.equal(f.length, 1);
  assert.match(f[0], /verdict of No/);
});

test('a Conditional verdict must carry its conditions into the hand-off', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: r', resolver({ r: LICENSED(['BACKOFFICE-1'], { verdict: 'conditional', conditionsMissing: true }) }));
  assert.match(f[0], /Conditional but handoff.md carries no/);
  assert.deepEqual(checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: r', resolver({ r: LICENSED(['BACKOFFICE-1'], { verdict: 'conditional', conditionsMissing: false }) })), []);
});

test('one run cannot license the whole backlog: an item the hand-off does not name is refused', () => {
  const runs = resolver({ r: LICENSED(['BACKOFFICE-1']) });
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: r\n- id: BACKOFFICE-2\n  status: pending\n  discovery: r', runs);
  assert.equal(f.length, 1);
  assert.match(f[0], /BACKOFFICE-2: discovery run 'r' licenses BACKOFFICE-1, not BACKOFFICE-2/);
});

test('a hand-off with no licenses: list is refused (the template placeholder counts as none)', () => {
  const f = checkItems('- id: BACKOFFICE-1\n  status: pending\n  discovery: r', resolver({ r: LICENSED(undefined) }));
  assert.match(f[0], /names no backlog items it licenses/);
  assert.equal(parseLicenses({ licenses: '[<BACKOFFICE-ids this hand-off admits>]' }), undefined);
  assert.deepEqual(parseLicenses({ licenses: '[BACKOFFICE-1, "BACKOFFICE-2"]' }), ['BACKOFFICE-1', 'BACKOFFICE-2']);
  assert.deepEqual(parseLicenses({ licenses: 'BACKOFFICE-7' }), ['BACKOFFICE-7']);
});

test('conditionsCarried reads an inline value or a bullet list, and rejects placeholders', () => {
  assert.ok(conditionsCarried('- **Conditions delivery inherits:** monitor fee variance monthly\n'));
  assert.ok(conditionsCarried('- **Conditions delivery inherits:**\n  - PII guard active on every write path\n'));
  assert.ok(!conditionsCarried('- **Conditions delivery inherits:**\n\n## Direction\n'));
  assert.ok(!conditionsCarried('- **Conditions delivery inherits:** <fill in>\n'));
  assert.ok(!conditionsCarried('- **Conditions delivery inherits:** TBD\n'));
});

test('the OFBO FEATURE convention matches BACKOFFICE-<n> only', () => {
  assert.ok(FEATURE.test('BACKOFFICE-42') && !FEATURE.test('INFRA-1') && !FEATURE.test('BACKOFFICE-x'));
});

// ── Nesting styles (rc.28) ──────────────────────────────────────────────────────────────────
//
// A milestone keyed by `id` looks exactly like an item start. Under the old block boundary it
// swallowed every item beneath it, `id` resolved to the MILESTONE's id, that did not match the
// feature pattern, and the gate reported OK over an unexamined backlog. Milestones keyed by
// `name` were never affected — `isItemStart` excludes them — which is why this went unseen.

const NESTED_BY_ID = [
  'milestones:',
  '  - id: M1',
  '    name: First milestone',
  '    items:',
  '      - id: BACKOFFICE-1',
  '        status: pending',
  '      - id: BACKOFFICE-2',
  '        status: pending',
].join('\n');

test('a milestone keyed by id does not swallow the items beneath it', () => {
  const items = parseItems(NESTED_BY_ID);
  const ids = items.map((b) => (b.match(/\bid:\s*([A-Za-z0-9-]+)/) || [])[1]);
  assert.deepEqual(ids, ['M1', 'BACKOFFICE-1', 'BACKOFFICE-2'], 'the container is its own block, each item its own');
});

test('both nesting styles reach the same verdict', () => {
  const byName = NESTED_BY_ID.replace('  - id: M1\n    name: First milestone', '  - name: First milestone');
  const f = checkItems(NESTED_BY_ID, resolver({}));
  assert.equal(f.length, 2, 'both pending features are gated through an id-keyed milestone');
  assert.deepEqual(checkItems(byName, resolver({})).length, f.length);
});

test('the milestone container itself is never gated (no status)', () => {
  // M1 matches no feature pattern AND carries no status — it must produce no finding of its own.
  const f = checkItems(NESTED_BY_ID, resolver({}), /^M\d+$/);
  assert.deepEqual(f, [], 'a container block has no status, so nothing to gate');
});

test('STRUCTURAL INVARIANT: no parsed block contains a second item start', () => {
  // This is the shape of the swallow bug, stated as a property. If it ever holds again, some
  // block owns items that will never be examined on their own — the exact silent miss.
  for (const y of [NESTED_BY_ID, '- id: A\n  x: 1\n- id: B', '- { id: A }\n- { id: B }']) {
    for (const block of parseItems(y)) {
      const starts = block.split('\n').filter(isItemStart).length;
      assert.equal(starts, 1, `block owns exactly one item start:\n${block}`);
    }
  }
});

test('a list item folded into a YAML block scalar is rejected before parsing', () => {
  const yaml = [
    '- id: BACKOFFICE-1',
    '  status: done',
    '  note: >-',
    '    explanatory prose',
    '    - id: BACKOFFICE-2',
  ].join('\n');
  const findings = swallowedListItems(yaml);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /BACKOFFICE-2/);
});

// ── Coverage: loud, not silent (rc.28) ──────────────────────────────────────────────────────
//
// A gate that prints OK claims every feature traces to a green hand-off. When it examined
// nothing, that claim has no evidence. HG-0007 is the waist of the double diamond, so an inert
// pass is worse than an absent gate — nobody goes looking at a green light.

test('hasContent tells an empty backlog from an unparsed one', () => {
  assert.equal(hasContent('milestones: []'), false);
  assert.equal(hasContent('# just a comment\n\nmilestones:\n'), false);
  assert.equal(hasContent('---\nitems: {}\n'), false);
  assert.equal(hasContent('milestones:\n  - name: M1'), true);
  assert.equal(hasContent('BACKOFFICE-1:\n  status: pending'), true, 'a mapping-shaped backlog IS content');
});

test('content the parser cannot read FAILS rather than passing quietly', () => {
  // A mapping-shaped backlog: real work, zero recognised items. Reporting OK would be a lie.
  const { findings, stats } = coverage('items:\n  BACKOFFICE-1:\n    status: pending\n');
  assert.equal(stats.items, 0);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /recognised no backlog item/);
  assert.match(findings[0], /docs\/backlog\.example\.yaml/, 'the finding points at the shape the installer ships');
});

test('a genuinely empty backlog passes, and says it examined nothing', () => {
  const { findings, notices, stats } = coverage('milestones: []\n');
  assert.deepEqual(findings, []);
  assert.equal(stats.items, 0);
  assert.match(notices[0], /no items yet/);
});

test('an unedited ADOPT marker matching nothing FAILS — the gate would gate nothing', () => {
  // Every brownfield repo has ids like FEAT-102 or PAY-88; the shipped STORY-<n> default matches
  // none of them, so the gate reads the whole backlog and waist-gates zero items.
  const { findings, stats } = coverage('- id: FEAT-102\n  status: pending\n- id: PAY-88\n  status: pending', /^STORY-\d+$/);
  assert.equal(stats.items, 2);
  assert.equal(stats.matched, 0);
  assert.equal(stats.unedited, true);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /still this bundle's shipped default/);
  assert.match(findings[0], /ADOPT/);
});

test('a CUSTOMISED marker matching nothing today only REPORTS', () => {
  // The adopter told us their convention. A backlog with no feature work in it right now is an
  // ordinary state of a backlog, not an unfinished adoption.
  const { findings, notices, stats } = coverage('- id: INFRA-3\n  status: pending', /^FEAT-\d+$/);
  assert.deepEqual(findings, []);
  assert.equal(stats.unedited, false);
  assert.match(notices[0], /no feature work in the backlog right now/);
});

test('a backlog the gate really does cover is silent about coverage', () => {
  const { findings, notices, stats } = coverage('- id: BACKOFFICE-1\n  status: pending');
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
  assert.deepEqual([stats.items, stats.matched], [1, 1]);
});

// ── The example is the contract ─────────────────────────────────────────────────────────────
//
// backlog-example/backlog.yaml is what the docs point an adopter at for the shape of the file.
// Parsing it here is what stops the documented shape drifting from the understood one. It is
// bundle-only (never installed — a backlog is the adopter's content), so skip in an adopted tree.

const EXAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '../backlog-example/backlog.yaml');
if (!existsSync(EXAMPLE)) {
  test('backlog example (bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
  test('the documented example parses to exactly the items it documents', () => {
    const text = readFileSync(EXAMPLE, 'utf8');
    const ids = parseItems(text).map((b) => (b.match(/\bid:\s*([A-Za-z0-9-]+)/) || [])[1]);
    assert.deepEqual(ids, ['BACKOFFICE-1', 'INFRA-1', 'BACKOFFICE-2', 'M2', 'BACKOFFICE-3', 'BACKOFFICE-4'],
      'both milestone styles, an infra item, an exempt item and an inline flow item');
  });

  test('the documented example is gate-clean when its runs are green', () => {
    const text = readFileSync(EXAMPLE, 'utf8');
    const runs = { 'revoke-latency': GREEN, 'residency-pin': GREEN };
    assert.deepEqual(checkItems(text, resolver(runs)), []);
    const { findings, notices } = coverage(text);
    assert.deepEqual(findings, []);
    assert.deepEqual(notices, []);
  });

  test('the documented example still fails when a linked run is not green', () => {
    // The example must not be gate-clean by accident — remove the evidence and it must go red.
    const text = readFileSync(EXAMPLE, 'utf8');
    const f = checkItems(text, resolver({ 'residency-pin': GREEN }));
    assert.ok(f.length >= 1 && f.every((x) => /revoke-latency/.test(x)), 'the unlinked run is named');
  });
}
