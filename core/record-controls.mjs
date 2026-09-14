// Control ids on every record (2.1.0, hardening plan row 3.5; PRD F9). An envelope that leaves the
// tree says WHICH obligations it answers — the institution's own ids from the obligations register
// (`OB-*` obligations and the `CTRL-*` controls they map to) and the FINOS catalogue ids the
// register pins — filled from the register, never typed by hand, and the source logged so a reader
// knows which edition the ids came from. The register is docs/governance/obligations.json; this
// module reads it directly (core must not import scripts/, ADR-0006) and asks one question of it:
// for these catalog control ids, which obligations cite them?
//
// Absent register: `controls_source: 'none'` and empty lists — said aloud on the envelope, never
// a silent omission. The obligations gate (scripts/obligations-check.mjs) owns whether the
// register is required at all.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const OBLIGATIONS_LOCATIONS = ['docs/governance/obligations.json', 'obligations.json'];

/** Parse the register → { doc, obligations, byId } or null. */
export function loadObligations(cwd = process.cwd()) {
  const p = OBLIGATIONS_LOCATIONS.map((x) => join(cwd, x)).find(existsSync);
  if (!p) return null;
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  const obligations = Array.isArray(doc?.obligations) ? doc.obligations : [];
  return { doc, obligations, byId: new Map(obligations.map((o) => [o.id, o])) };
}

/**
 * The controls block for a record that evidences `catalogControls` (catalog control ids such as
 * HG-0003 or Q4-SUPPLY): every obligation whose catalog_controls cite one of them, the CTRL ids
 * those obligations map to, and their FINOS ids.
 * → { institution: [...], finos: [...], catalog: [...], controls_source }
 */
export function controlsForRecord(loaded, catalogControls = []) {
  const catalog = [...new Set((catalogControls || []).filter((x) => typeof x === 'string' && x))].sort();
  if (!loaded) return { institution: [], finos: [], catalog, controls_source: 'none' };
  const institution = new Set(), finos = new Set();
  for (const o of loaded.obligations) {
    const cites = (o.catalog_controls || []).some((c) => catalog.includes(c));
    if (!cites) continue;
    institution.add(o.id);
    for (const c of o.control_ids || []) institution.add(c);
    for (const f of o.finos || []) finos.add(f);
  }
  const ref = loaded.doc?.finos_catalogue?.ref || loaded.doc?.finos_catalogue?.version || 'unpinned';
  return { institution: [...institution].sort(), finos: [...finos].sort(), catalog, controls_source: `obligations:${ref}` };
}
