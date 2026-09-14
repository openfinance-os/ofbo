// obligation-report — "every control and its maturity state for obligation X" (2.1.0, hardening
// plan row 3.6). A VIEW for the second line and the examiner, generated from the registers and the
// control catalog with no hand-kept counts, and NEVER A GATE: obligations-check is the control;
// this prints what it holds. Exempt from ci-catalog-check by name, like the other reports.
//
//   node scripts/obligation-report.mjs            # markdown to stdout
//   node scripts/obligation-report.mjs --json
//   node scripts/obligation-report.mjs --check    # CI: input shapes only, exit 0 with a note when unmounted
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadRegister, loadObligations } from '../discovery/gates/registers.mjs';

export function build(cwd = process.cwd()) {
  const loaded = loadObligations(`${cwd}/docs/governance/obligations.json`);
  if (!loaded) return null;
  const registerDir = `${cwd}/docs/governance/data-risk-register`;
  const register = existsSync(registerDir) ? loadRegister(registerDir) : null;
  let catalog = [];
  for (const c of ['docs/governance/control-catalog.json', 'control-catalog.json']) {
    if (existsSync(`${cwd}/${c}`)) { try { catalog = JSON.parse(readFileSync(`${cwd}/${c}`, 'utf8')).controls || []; } catch { /* unreadable */ } break; }
  }
  const byCatalog = new Map(catalog.map((c) => [c.control_id, c]));
  const byCtrl = new Map((register?.controls || []).map((c) => [c.control_id, c]));
  const byRisk = new Map((register?.statements || []).map((s) => [s.risk_id, s]));
  const rows = loaded.obligations.map((o) => ({
    id: o.id, title: o.title, source: o.source, article: o.article, owner_role: o.owner_role,
    last_verified: o.last_verified, illustrative: Boolean(o.illustrative), finos: o.finos || [],
    risks: (o.risk_ids || []).map((r) => ({ id: r, statement: byRisk.get(r)?.statement || null, inherent: byRisk.get(r)?.inherent_rating || null, residual: byRisk.get(r)?.residual_rating || null })),
    register_controls: (o.control_ids || []).map((c) => ({ id: c, name: byCtrl.get(c)?.control_name || null, owner: byCtrl.get(c)?.control_owner || null, automation: byCtrl.get(c)?.automation_level || null, resolved: byCtrl.has(c) })),
    catalog_controls: (o.catalog_controls || []).map((c) => ({ id: c, objective: byCatalog.get(c)?.objective || null, state: byCatalog.get(c)?.state || null, resolved: byCatalog.has(c) })),
  }));
  const states = {};
  for (const r of rows) for (const c of r.catalog_controls) if (c.state) states[c.state] = (states[c.state] || 0) + 1;
  const covered = new Set(rows.flatMap((r) => r.risks.map((x) => x.id)));
  const unanswered = (register?.statements || []).filter((s) => !covered.has(s.risk_id) && !covered.has(String(s.risk_id).replace(/-\d+$/, ''))).map((s) => s.risk_id);
  return { catalogue: loaded.doc?.finos_catalogue?.ref || null, obligations: rows, maturity_states: states, unanswered_risks: unanswered, illustrative: rows.filter((r) => r.illustrative).length };
}

export function markdown(rep) {
  const L = [];
  L.push(`# Obligations → risks → controls → maturity`, '', `FINOS catalogue: ${rep.catalogue || 'unpinned'} · ${rep.obligations.length} obligation(s)${rep.illustrative ? ` · ${rep.illustrative} ILLUSTRATIVE` : ''}`, '');
  const st = Object.entries(rep.maturity_states).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (st) L.push(`Catalog control states across obligations: ${st}`, '');
  for (const o of rep.obligations) {
    L.push(`## ${o.id} — ${o.title}${o.illustrative ? ' (ILLUSTRATIVE)' : ''}`, '', `${o.source} · ${o.article} · owner \`${o.owner_role}\` · last verified ${o.last_verified}${o.finos.length ? ` · FINOS ${o.finos.join(', ')}` : ''}`, '');
    L.push('| Risk | Inherent | Residual |', '|---|---|---|');
    for (const r of o.risks) L.push(`| ${r.id}${r.statement ? ` — ${r.statement}` : ''} | ${r.inherent || '—'} | ${r.residual || '—'} |`);
    L.push('', '| Register control | Owner | Automation |', '|---|---|---|');
    for (const c of o.register_controls) L.push(`| ${c.id}${c.name ? ` — ${c.name}` : ''}${c.resolved ? '' : ' (UNRESOLVED)'} | ${c.owner || '—'} | ${c.automation || '—'} |`);
    L.push('', '| Catalog control | State |', '|---|---|');
    for (const c of o.catalog_controls) L.push(`| ${c.id}${c.objective ? ` — ${c.objective}` : ''}${c.resolved ? '' : ' (UNRESOLVED)'} | ${c.state || '—'} |`);
    L.push('');
  }
  if (rep.unanswered_risks.length) L.push(`## Register risks no obligation answers`, '', ...rep.unanswered_risks.map((r) => `- ${r}`), '');
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const rep = build();
  if (!rep) {
    process.stdout.write('  note: docs/governance/obligations.json not mounted — no obligation report (a view, never a gate)\n');
    process.exit(0);
  }
  if (args.includes('--check')) { process.stdout.write(`Obligation report — shapes OK (${rep.obligations.length} obligation(s), ${rep.unanswered_risks.length} register risk(s) unanswered; a report, never a gate)\n`); process.exit(0); }
  process.stdout.write(args.includes('--json') ? JSON.stringify(rep, null, 2) + '\n' : markdown(rep) + '\n');
}
