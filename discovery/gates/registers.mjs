// Data-risk register loader for D6 referential integrity. Pure Node.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DIR = 'docs/governance/data-risk-register';

function load(dir, file) {
  const p = join(dir, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
}

/**
 * The vocabulary of regulatory drivers this institution actually answers to, mounted beside the
 * register as `reg-drivers.json`: a FLAT ARRAY OF LITERAL TERMS, e.g.
 *
 *   ["HSA", "AAOIFI", "Shari'ah Standard No.", "ISSC resolution"]
 *
 * D6 ships with a built-in driver regex, and that regex knows one jurisdiction's abbreviations.
 * A document grounded ONLY in a Shariah authority's pronouncements or a standard-setter's
 * standards cited none of them, so D6 reported "cites no regulatory driver" about a document
 * whose every line was a citation. The wrong fix is to edit the regex per jurisdiction — that is
 * gate LOGIC absorbing adopter DATA, which is the seam this harness exists to keep open.
 *
 * Terms are LITERALS, never patterns: the D6 check regex-escapes them, so a mounted term can
 * only ever ADD a way to pass, never rewrite the built-in check into something weaker.
 */
function loadDrivers(dir) {
  const raw = load(dir, 'reg-drivers.json');
  return Array.isArray(raw) ? raw.filter((t) => typeof t === 'string' && t.trim()) : [];
}

/** Build resolvable id sets from the register JSON. Returns null if the register isn't
 *  mounted (so D6 can degrade gracefully on a seam-less run). */
export function loadRegister(dir = DEFAULT_DIR) {
  if (!existsSync(join(dir, 'risk-taxonomy.json'))) return null;
  const taxonomy = load(dir, 'risk-taxonomy.json');
  const statements = load(dir, 'risk-statements.json');
  const controls = load(dir, 'controls.json');
  const drivers = loadDrivers(dir); // absent file → [] → D6 behaves exactly as before

  const drIds = new Set();
  for (const r of taxonomy) {
    if (r.risk_category_id) drIds.add(r.risk_category_id); // DR-2.1
    if (r.risk_domain_id) drIds.add(r.risk_domain_id);     // DR-2
  }
  for (const r of statements) if (r.risk_id) drIds.add(r.risk_id); // DR-2.1-001

  const ctrlIds = new Set();
  for (const c of controls) if (c.control_id) ctrlIds.add(c.control_id);

  return { drIds, ctrlIds, taxonomy, statements, controls, drivers };
}

// ── Obligations register (2.1.0, hardening plan phase 3) ─────────────────────────────────────
export const OBLIGATIONS_DEFAULT = 'docs/governance/obligations.json';
export const OB_ID = /^OB-[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
// The FINOS SDLC controls catalogue editions this loader knows. Draft ids move between editions,
// so an unknown ref is refused loudly rather than matched to ids that may mean something else now.
export const KNOWN_FINOS_CATALOGUES = new Set([
  'finos-labs/SDLC-Controls-Framework readiness report 2026-06-20',
]);

/**
 * Load the obligations register. Returns null when not mounted. `private_path` (a file outside the
 * tree, for an institution whose taxonomy cannot be public) is followed when set. The result carries
 * the raw document, an id → obligation map, and a loader finding list (unknown catalogue, unreadable
 * private file) the gate reports — a loader that silently returned fewer entries would be the quiet
 * failure this register exists to end.
 */
export function loadObligations(path = OBLIGATIONS_DEFAULT) {
  if (!existsSync(path)) return null;
  const findings = [];
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { doc: null, byId: new Map(), obligations: [], findings: [`${path}: unreadable (${e.message})`] }; }
  let obligations = Array.isArray(doc?.obligations) ? doc.obligations : [];
  if (typeof doc?.private_path === 'string' && doc.private_path.trim()) {
    const pp = doc.private_path;
    if (!existsSync(pp)) findings.push(`${path}: private_path ${pp} does not exist — the register it points at is the one that counts, and it is not there`);
    else {
      try {
        const priv = JSON.parse(readFileSync(pp, 'utf8'));
        obligations = Array.isArray(priv?.obligations) ? priv.obligations : [];
        if (priv?.finos_catalogue) doc = { ...doc, finos_catalogue: priv.finos_catalogue };
      } catch (e) { findings.push(`${pp}: unreadable private register (${e.message})`); }
    }
  }
  const ref = doc?.finos_catalogue?.ref;
  if (ref && !KNOWN_FINOS_CATALOGUES.has(ref)) findings.push(`${path}: unknown FINOS catalogue ${JSON.stringify(ref)} — draft ids are edition-bound; known: ${[...KNOWN_FINOS_CATALOGUES].join(', ')}`);
  const byId = new Map();
  for (const o of obligations) if (o && typeof o.id === 'string') byId.set(o.id, o);
  return { doc, obligations, byId, findings, path };
}
