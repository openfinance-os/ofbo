// The layering invariant (ADR-0006).
//
// Three `core/floor-*` modules import from `scripts/`, inverting the usual direction. That is a
// deliberate trade — it is why there is one route table and one seal implementation rather than two
// that agree today and diverge next quarter — and ADR-0006 records the reasoning and the exit path.
//
// What makes the inversion SAFE rather than merely convenient is that it is ACYCLIC: the gates the
// three core modules reach up to import only from *other* core modules, never back down into the
// three. Nothing enforced that. This file does.
//
// A cycle here would not fail loudly. ESM hoists function declarations, so a cyclic import
// typically survives module init and then hands somebody `undefined` for a binding at call time —
// in a governance harness, that is a gate silently evaluating against an empty role set or a
// missing seal helper. The failure mode is a false green, which is the one this repository spends
// most of its effort refusing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = dirname(fileURLToPath(import.meta.url));
const HARNESS = resolve(CORE, '..');

const sources = (dir) => readdirSync(dir)
  .filter((n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs'))
  .map((n) => [n, readFileSync(`${dir}/${n}`, 'utf8')]);

/** Modules imported from `<layer>/`, by relative specifier, ignoring commented-out lines. */
const importsFrom = (src, layer) => [...src.matchAll(
  new RegExp(String.raw`^\s*(?:import|export)[^;]*?from\s+['"]\.\./${layer}/([a-z0-9-]+\.mjs)['"]`, 'gms'),
)].map((m) => m[1]);

test('the core → scripts inversion is confined to the three modules ADR-0006 names', () => {
  const RATIFIED = new Set(['floor-approval-surface.mjs', 'floor-mi.mjs', 'floor-ops-signal.mjs']);

  const actual = new Set(
    sources(CORE).filter(([, src]) => importsFrom(src, 'scripts').length).map(([name]) => name),
  );

  assert.deepEqual([...actual].sort(), [...RATIFIED].sort(),
    'a core module started importing from scripts/, or one stopped. ADR-0006 ratified exactly three '
    + 'and named the exit path; widening the set is a decision, not a refactor — amend the ADR first');
});

test('no scripts/ module reached by core/ imports back into core/floor-*', () => {
  // The three gates the inversion depends on. If any of them (transitively, one hop is enough here
  // — they import no other scripts) reaches back into a core/floor-* module, the inversion closes
  // into a cycle and the bindings become order-dependent.
  const GATES = ['product-approval-check.mjs', 'evidence-seal-check.mjs', 'operations-signal-check.mjs'];
  const byName = new Map(sources(`${HARNESS}/scripts`));

  for (const gate of GATES) {
    const src = byName.get(gate);
    assert.ok(src, `${gate} is missing — the inversion's counterparty vanished`);

    for (const target of importsFrom(src, 'core')) {
      assert.ok(!target.startsWith('floor-'),
        `scripts/${gate} imports core/${target} — that closes the ADR-0006 inversion into a cycle. `
        + 'Extract the shared vocabulary down into core/ instead (the exit path in ADR-0006).');
    }
  }
});

test('the whole core → scripts → core path is acyclic, not just the floor-* slice', () => {
  // Walk it properly rather than trusting the one-hop check above to stay sufficient.
  const coreSrc = new Map(sources(CORE));
  const scriptSrc = new Map(sources(`${HARNESS}/scripts`));

  const seen = new Set();
  const walk = (layer, name, path) => {
    const key = `${layer}/${name}`;
    if (path.includes(key)) assert.fail(`import cycle: ${[...path, key].join(' → ')}`);
    if (seen.has(key)) return;
    seen.add(key);

    const src = (layer === 'core' ? coreSrc : scriptSrc).get(name);
    if (!src) return;
    const next = [...path, key];
    for (const t of importsFrom(src, 'scripts')) walk('scripts', t, next);
    for (const t of importsFrom(src, 'core')) walk('core', t, next);
  };

  for (const [name] of coreSrc) walk('core', name, []);
});
