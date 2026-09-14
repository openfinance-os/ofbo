// obligation-lookup — resolve an obligation id (or a control id) to the ids an attestation carries
// (2.1.0, hardening plan row 3.5). The Kosli seam calls this to fill `controls: { institution, finos }`
// on every envelope from the register, never from a claim; a human calls it to answer "what does
// OB-AE-PDPL-001 mean for us" without opening the JSON.
//
//   node scripts/obligation-lookup.mjs OB-AE-PDPL-001            # one obligation
//   node scripts/obligation-lookup.mjs --control CTRL-001        # every obligation a control answers
//   node scripts/obligation-lookup.mjs --json …
//
// Exit 6 on a miss, with the nearest three ids by shared prefix — the code the PRD reserved for a
// lookup miss, kept.
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadObligations, OBLIGATIONS_DEFAULT } from '../discovery/gates/registers.mjs';

/** Shared-prefix similarity, longest common prefix over the id's dash-separated parts. */
function nearest(ids, id, n = 3) {
  const parts = id.toUpperCase().split('-');
  const score = (x) => { const p = x.split('-'); let i = 0; while (i < p.length && i < parts.length && p[i] === parts[i]) i++; return i; };
  return [...ids].map((x) => [x, score(x)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([x]) => x);
}

/** What an attestation carries for a set of obligation ids: the institution ids and the FINOS ids, plus the register source. */
export function controlsFor(loaded, obligationIds) {
  const institution = new Set(), finos = new Set(), missing = [];
  for (const id of obligationIds) {
    const o = loaded?.byId.get(id);
    if (!o) { missing.push(id); continue; }
    institution.add(id);
    for (const c of o.control_ids || []) institution.add(c);
    for (const f of o.finos || []) finos.add(f);
  }
  return { institution: [...institution].sort(), finos: [...finos].sort(), missing, controls_source: `obligations:${loaded?.doc?.finos_catalogue?.ref || 'unpinned'}` };
}

export function lookup(loaded, id) {
  if (!loaded) return { found: false, reason: `${OBLIGATIONS_DEFAULT} not mounted` };
  const o = loaded.byId.get(id);
  if (!o) return { found: false, reason: `no obligation ${id}`, nearest: nearest(loaded.byId.keys(), id) };
  return { found: true, obligation: o, ...controlsFor(loaded, [id]) };
}

export function byControl(loaded, controlId) {
  const hits = (loaded?.obligations || []).filter((o) => (o.control_ids || []).includes(controlId) || (o.catalog_controls || []).includes(controlId));
  return { found: hits.length > 0, obligations: hits.map((o) => o.id), nearest: hits.length ? [] : nearest(new Set((loaded?.obligations || []).flatMap((o) => [...(o.control_ids || []), ...(o.catalog_controls || [])])), controlId) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const ci = args.indexOf('--control');
  const loaded = loadObligations();
  const out = ci >= 0 ? byControl(loaded, args[ci + 1]) : lookup(loaded, args.find((a) => !a.startsWith('--')) || '');
  if (json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); process.exit(out.found ? 0 : 6); }
  if (!out.found) {
    process.stderr.write(`${out.reason || 'not found'}${out.nearest?.length ? ` — nearest: ${out.nearest.join(', ')}` : ''}\n`);
    process.exit(6);
  }
  if (ci >= 0) process.stdout.write(`${args[ci + 1]} answers: ${out.obligations.join(', ')}\n`);
  else {
    const o = out.obligation;
    process.stdout.write(`${o.id} — ${o.title}\n  source: ${o.source} · ${o.article}\n  owner: ${o.owner_role} · last verified ${o.last_verified}${o.illustrative ? ' · ILLUSTRATIVE' : ''}\n  risks: ${(o.risk_ids || []).join(', ')} · controls: ${(o.control_ids || []).join(', ')} · catalog: ${(o.catalog_controls || []).join(', ') || '—'}\n  finos: ${(o.finos || []).join(', ') || '—'}\n`);
  }
}
