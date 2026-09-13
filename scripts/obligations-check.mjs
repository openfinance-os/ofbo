// OBLIGATIONS — the obligations-register gate (2.1.0, hardening plan phase 3).
//
// The chain used to be: a regulatory driver remembered in prose → a DR-* risk category → a
// CTRL-* control → a gate. Nothing named the OBLIGATION, so "show me every control for obligation
// X" — the first question an examiner asks — had no answer, and D6 accepted "PDPL Art. 5" typed
// from memory as a driver. docs/governance/obligations.json is the missing object: each entry is
// one obligation with its source, article, owner, verification date, the register risks and
// controls that answer it, the catalog controls that enforce it, and the FINOS draft ids it maps
// to. This gate holds the register to its shape:
//
//   · an id in the OB-<JURISDICTION>-<SOURCE>-<n> form, unique;
//   · a source, a title and (unless illustrative) an article that is not a placeholder;
//   · an owner_role some HUMAN in the identity registry actually holds;
//   · a last_verified date, not in the future, inside verify_every_days — an obligation nobody has
//     checked against its source in a year is a memory, not a register;
//   · at least one risk_id and one control_id that RESOLVE in the data-risk register, and every
//     catalog_controls entry that resolves in the control catalog;
//   · FINOS ids in the draft form (mi-<n> / ri-<n>) under a catalogue edition the loader knows;
//   · ILLUSTRATIVE entries (the shipped example) FAIL under a regulated profile. An example that
//     could pass for a register is the quiet failure this file exists to end.
//
// Missing register: a FAILURE under a regulated profile (the data-risk register is compiled as
// mandatory), a notice otherwise — the same fail-closed rule D6 uses. What this gate does NOT do:
// judge whether these are the right obligations or the articles are right. That is compliance's.
//
// Run from the repo root: `node scripts/obligations-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadRegister, loadObligations, OB_ID, OBLIGATIONS_DEFAULT } from '../discovery/gates/registers.mjs';
import { registerMandatory } from '../discovery/gates/validate.mjs';
import { loadRegistry } from './identity-registry-check.mjs';

export const FINOS_ID = /^(mi|ri)-\d+$/;
export const PLACEHOLDER = /ADOPT[:-]|<[^>]*>|\bTBD\b|\bTODO\b/i;
const DAY = 86400000;

/**
 * Findings for a loaded register. `register` is loadRegister()'s result (or null), `registry` the
 * identity registry (or null), `catalogIds` a Set of control ids (or null), `regulated` whether an
 * illustrative entry is a finding, `now` injectable.
 */
export function evaluate(loaded, { register = null, registry = null, catalogIds = null, regulated = false, now = Date.now() } = {}) {
  const findings = [...(loaded?.findings || [])];
  const notices = [];
  const obligations = loaded?.obligations || [];
  if (obligations.length === 0) findings.push(`${loaded?.path || OBLIGATIONS_DEFAULT}: declares no obligations — an empty register answers for nothing`);
  const verifyDefault = Number(loaded?.doc?.defaults?.verify_every_days) || 365;
  const humansByRole = new Map();
  for (const i of registry?.identities || []) if (i.kind === 'human') for (const r of i.roles || []) humansByRole.set(r, (humansByRole.get(r) || 0) + 1);
  const seen = new Set();
  for (const o of obligations) {
    const id = typeof o?.id === 'string' ? o.id : '(no id)';
    const F = (m) => findings.push(`${id}: ${m}`);
    if (!OB_ID.test(id)) F(`id does not follow OB-<JURISDICTION>-<SOURCE>-<n>`);
    if (seen.has(id)) F('duplicate id'); seen.add(id);
    for (const k of ['source', 'title']) if (typeof o[k] !== 'string' || !o[k].trim() || PLACEHOLDER.test(o[k])) F(`${k} is missing or a placeholder`);
    if (!o.illustrative && (typeof o.article !== 'string' || !o.article.trim() || PLACEHOLDER.test(o.article))) F('article is missing or a placeholder — an obligation cites the clause it comes from, verified against the source');
    if (o.illustrative) (regulated ? F : (m) => notices.push(`${id}: ${m}`))('is ILLUSTRATIVE — replace it with the compliance function\'s verified entry, or delete it; an example cannot stand for an obligation');
    if (typeof o.owner_role !== 'string' || !o.owner_role.trim() || PLACEHOLDER.test(o.owner_role)) F('names no owner_role');
    else if (registry && !humansByRole.get(o.owner_role)) F(`owner_role ${o.owner_role} is held by no human in the identity registry — an obligation nobody owns is nobody's`);
    const t = Date.parse(o.last_verified);
    if (Number.isNaN(t)) F(`last_verified ${JSON.stringify(o.last_verified)} is not a date`);
    else if (t > now + DAY) F(`last_verified ${o.last_verified} is in the future`);
    else {
      const every = Number(o.verify_every_days) || verifyDefault;
      const age = Math.floor((now - t) / DAY);
      if (age > every) F(`last verified ${age} days ago, over the ${every}-day window — an obligation nobody has checked against its source is a memory, not a register`);
    }
    const risks = Array.isArray(o.risk_ids) ? o.risk_ids : [];
    const ctrls = Array.isArray(o.control_ids) ? o.control_ids : [];
    if (risks.length === 0) F('maps to no risk_ids — an obligation the register cannot place has no control answering it');
    if (ctrls.length === 0) F('maps to no control_ids');
    // Illustrative rows are teaching examples from the Loom bundle, not adopted institutional
    // mappings. Validate their shape above, but do not pretend their placeholder register ids
    // resolve against an adopter's controls. A regulated profile still rejects every such row.
    if (register && !o.illustrative) {
      for (const r of risks) if (!register.drIds.has(r)) F(`risk ${r} does not resolve in the data-risk register`);
      for (const c of ctrls) if (!register.ctrlIds.has(c)) F(`control ${c} does not resolve in the data-risk register`);
    } else if (!register && (risks.length || ctrls.length)) notices.push(`${id}: data-risk register not mounted — risk_ids and control_ids could not be resolved`);
    if (catalogIds) for (const c of o.catalog_controls || []) if (!catalogIds.has(c)) F(`catalog control ${c} is not in the control catalog`);
    for (const f of o.finos || []) if (!FINOS_ID.test(String(f))) F(`FINOS id ${JSON.stringify(f)} is not in the draft form mi-<n> / ri-<n>`);
  }
  // Coverage, reported not gated: a High/Critical register risk no obligation answers for.
  if (register) {
    const covered = new Set(obligations.flatMap((o) => o.risk_ids || []));
    for (const s of register.statements || []) {
      if (!/^(high|critical)$/i.test(String(s.inherent_rating || ''))) continue;
      const cat = String(s.risk_id || '').replace(/-\d+$/, '');
      if (!covered.has(s.risk_id) && !covered.has(cat) && !covered.has(cat.split('.')[0])) notices.push(`register risk ${s.risk_id} (${s.inherent_rating}) is answered by no obligation — either it is not a regulatory risk, or the register is missing an entry`);
    }
  }
  return { findings, notices };
}

export function check(cwd = process.cwd(), { now = Date.now() } = {}) {
  const path = `${cwd}/${OBLIGATIONS_DEFAULT}`;
  const regulated = registerMandatory(cwd, { flag: process.env.LOOM_REQUIRE_REGISTER === '1' });
  if (!existsSync(path)) {
    return regulated
      ? { findings: [`${OBLIGATIONS_DEFAULT} not found — under a regulated profile the obligations register is mandatory; without it no data-governance position can say which obligation it answers`], notices: [], examined: 0 }
      : { findings: [], notices: [`${OBLIGATIONS_DEFAULT} not found — nothing for the obligations gate to examine (mount governance/obligations.template.json)`], examined: 0 };
  }
  const loaded = loadObligations(path);
  const registerDir = `${cwd}/docs/governance/data-risk-register`;
  const register = existsSync(registerDir) ? loadRegister(registerDir) : null;
  let catalogIds = null;
  for (const c of ['docs/governance/control-catalog.json', 'control-catalog.json']) {
    if (existsSync(`${cwd}/${c}`)) { try { catalogIds = new Set(JSON.parse(readFileSync(`${cwd}/${c}`, 'utf8')).controls.map((x) => x.control_id)); } catch { /* reported by control-catalog-check */ } break; }
  }
  const { findings, notices } = evaluate(loaded, { register, registry: loadRegistry(cwd), catalogIds, regulated, now });
  return { findings, notices, examined: loaded?.obligations?.length || 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, examined } = check();
  for (const n of notices) process.stdout.write(`  note: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nObligations register gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery obligation names its source, an owner a human holds, a verification date inside its\nwindow, and the register risks and controls that answer it. See governance/obligations.template.json.\n');
    process.exit(1);
  }
  process.stdout.write(`Obligations register gate — OK (${examined} obligation(s) examined)\n`);
}
