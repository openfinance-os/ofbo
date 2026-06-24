// Data-risk register loader for D6 referential integrity. Pure Node.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DIR = 'docs/governance/data-risk-register';

function load(dir, file) {
  const p = join(dir, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
}

/** Build resolvable id sets from the register JSON. Returns null if the register isn't
 *  mounted (so D6 can degrade gracefully on a seam-less run). */
export function loadRegister(dir = DEFAULT_DIR) {
  if (!existsSync(join(dir, 'risk-taxonomy.json'))) return null;
  const taxonomy = load(dir, 'risk-taxonomy.json');
  const statements = load(dir, 'risk-statements.json');
  const controls = load(dir, 'controls.json');

  const drIds = new Set();
  for (const r of taxonomy) {
    if (r.risk_category_id) drIds.add(r.risk_category_id); // DR-2.1
    if (r.risk_domain_id) drIds.add(r.risk_domain_id);     // DR-2
  }
  for (const r of statements) if (r.risk_id) drIds.add(r.risk_id); // DR-2.1-001

  const ctrlIds = new Set();
  for (const c of controls) if (c.control_id) ctrlIds.add(c.control_id);

  return { drIds, ctrlIds, taxonomy, statements, controls };
}
