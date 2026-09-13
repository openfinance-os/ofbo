// The audit package (2.1.0, hardening plan row 2.12; PRD F4). One page per change, from the
// requirement to the running digest, built by JOINING two things that are kept apart on purpose:
// the external record (what the provider holds, read through the seam) and the sealed evidence
// bundle in the tree (what the collector chained and anchored). Every row is VERIFIED or FLAGGED
// — a kept envelope with a signature that no longer verifies is shown as such, a record the
// provider does not hold is shown as such — and nothing on the page is typed by hand. Rendered
// with the discovery renderer (document surface) under the mounted brand, so the auditor gets
// the institution's page, not the harness's.
//
//   node scripts/record-audit.mjs <CHG-id> [--out docs/governance/audit] [--json]
// Exit 0 when every row verifies, 6 when any row is flagged (the page is still written).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { loadIssuers, loadRegistry, status as recordStatus, trailStatus } from '../core/external-record.mjs';
import { evaluateProvenance } from '../core/provenance.mjs';
import { evaluate as evaluateSeal, MANIFEST_LOCATIONS } from './evidence-seal-check.mjs';
import { render } from '../discovery/render/render.mjs';
import { parseTokens } from '../discovery/render/tokens.mjs';

export const RECORDS_DIR = 'docs/governance/evidence/records';
export const CHANGES_DIR = 'docs/governance/changes';
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const short = (s, n = 12) => (typeof s === 'string' && s ? `${s.slice(0, n)}…` : '—');

/** Gather everything the page shows. Pure over `cwd`; `trailFn` injectable for tests. */
export async function gather(changeId, { cwd = process.cwd(), trailFn = null } = {}) {
  const dir = join(cwd, CHANGES_DIR, changeId);
  const envelope = readJson(join(dir, 'change-envelope.json'));
  const plan = readJson(join(dir, envelope?.control_plan || 'control-plan.json'));
  const riskClass = readJson(join(dir, 'risk-class.json'));
  const st = recordStatus(cwd);
  const flagged = [];
  // ① The record, from the provider.
  let record = { status: 'not-mounted', reason: st.reason, present: [], missing: [] };
  if (st.mounted) {
    const t = trailFn ? await trailFn({ flow: 'delivery', trail: changeId }) : await trailStatus({ flow: 'delivery', trail: changeId }, { cwd });
    record = t.status === 'ok' ? { status: 'ok', provider: st.provider, ...t } : { status: t.status, provider: st.provider, reason: t.reason, present: [], missing: [] };
    if (t.status !== 'ok') flagged.push(`the external record (${st.provider}) did not answer for ${changeId}: ${t.status} — ${t.reason}`);
  }
  // ② The kept envelopes beside the evidence, each re-verified.
  const registry = loadRegistry(cwd), issuers = loadIssuers(cwd);
  const kept = [];
  const rdir = join(cwd, RECORDS_DIR);
  if (existsSync(rdir)) {
    for (const n of readdirSync(rdir).filter((x) => x.endsWith('.json') && x.startsWith(`${changeId}-`)).sort()) {
      const e = readJson(join(rdir, n));
      if (!e) { kept.push({ file: n, name: n, verdict: 'unparseable', findings: ['not JSON'] }); flagged.push(`${n}: unparseable`); continue; }
      const { record: post, ...env } = e;
      const findings = evaluateProvenance(env, { registry, issuers });
      const held = record.status === 'ok' ? record.present.find((a) => a.name === e.name) : null;
      const verdict = findings.length ? 'flagged' : (record.status === 'ok' ? (held ? 'verified' : 'not-on-record') : 'verified-locally');
      if (verdict === 'flagged') flagged.push(`${n}: ${findings[0]}`);
      if (verdict === 'not-on-record') flagged.push(`${n}: verifies locally but the provider holds no record named ${e.name} on ${changeId}`);
      kept.push({ file: n, name: e.name, kind: e.kind, result: e.payload?.result ?? null, controls: e.payload?.controls ?? [], actor: e.actor?.id ?? null, commit: e.commit, posted: post?.status ?? null, id: post?.id ?? held?.id ?? null, verdict, findings, obligations: e.controls || null });
    }
  }
  // ③ The sealed bundle.
  const mp = MANIFEST_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const manifest = mp ? readJson(mp) : null;
  const sealFindings = manifest ? evaluateSeal(manifest, { baseDir: mp.replace(/\/manifest\.json$/, ''), requiredTypes: [] , registry }) : ['no evidence manifest'];
  if (sealFindings.length) flagged.push(`evidence bundle: ${sealFindings[0]}`);
  const anchorHeld = manifest?.external_record?.id ? (record.status === 'ok' ? record.present.some((a) => a.name === (manifest.external_record.ref?.name || 'seal-anchor') && a.id === manifest.external_record.id) : null) : false;
  if (manifest && st.mounted && anchorHeld === false) flagged.push(manifest.external_record?.id ? `the anchor id ${manifest.external_record.id} on the manifest is not on the provider's trail` : 'the manifest carries no external_record id');
  return { changeId, envelope, plan, riskClass, record, kept, manifest, sealFindings, anchorHeld, flagged, provider: st.mounted ? st.provider : null };
}

/** The document spec the renderer takes. Pure. */
export function spec(g) {
  const e = g.envelope || {};
  const rows = (g.record.present || []).map((a) => [a.name, a.id ?? '—', a.compliant === false ? 'NON-COMPLIANT' : a.compliant === true ? 'compliant' : a.status ?? '—']);
  return {
    title: `Audit package — ${g.changeId}`,
    subtitle: `${e.title || e.summary || 'change'} · tier ${g.plan?.risk_tier || '—'} · plan ${short(g.plan?.plan_hash)} · ${g.flagged.length ? `${g.flagged.length} row(s) FLAGGED` : 'every row verified'}`,
    sections: [
      { heading: 'The change and its route', blocks: [
        { table: { headers: ['field', 'value'], rows: [['change', g.changeId], ['state', e.current_state || '—'], ['profiles', (e.required_profiles || []).join(', ') || '—'], ['risk tier', g.plan?.risk_tier || '—'], ['plan hash', g.plan?.plan_hash || '—'], ['risk-class record', g.riskClass ? (g.riskClass.attestation ? `signed by ${g.riskClass.attestation.issuer}` : 'UNSIGNED draft') : 'none'], ['required capabilities', Object.keys(g.plan?.required_capabilities || {}).join(', ') || '—']] } },
      ] },
      { heading: `The external record (${g.provider || 'not mounted'})`, blocks: [
        g.record.status === 'ok' ? { table: { headers: ['record', 'id', 'status'], rows } } : { note: `Not read: ${g.record.status} — ${g.record.reason || ''}` },
        ...(g.record.missing?.length ? [{ note: `Expected by the provider's template and MISSING: ${g.record.missing.join(', ')}` }] : []),
      ] },
      { heading: 'Gate records kept beside the evidence, re-verified', blocks: [
        g.kept.length ? { table: { headers: ['record', 'result', 'controls', 'actor', 'commit', 'posted', 'verdict'], rows: g.kept.map((k) => [k.name, k.result ?? k.kind, (k.controls || []).join(', '), k.actor || '—', short(k.commit), k.posted ? `${k.posted}${k.id ? ` · ${k.id}` : ''}` : '—', k.verdict.toUpperCase()]) } } : { note: 'No kept envelopes for this change (core/gate-runner.mjs --record --emit-dir writes them).' },
        ...g.kept.filter((k) => k.findings?.length).map((k) => ({ note: `${k.name}: ${k.findings.join('; ')}` })),
      ] },
      { heading: 'Obligations answered', blocks: [
        (() => { const inst = new Set(), finos = new Set(); for (const k of g.kept) { for (const x of k.obligations?.institution || []) inst.add(x); for (const x of k.obligations?.finos || []) finos.add(x); } return inst.size || finos.size ? { table: { headers: ['institution', 'FINOS'], rows: [[[...inst].sort().join(', ') || '—', [...finos].sort().join(', ') || '—']] } } : { note: 'No obligation ids on the kept records — mount docs/governance/obligations.json (row 3.5).' }; })(),
      ] },
      { heading: 'The sealed evidence bundle', blocks: [
        g.manifest ? { table: { headers: ['field', 'value'], rows: [['release', g.manifest.release || '—'], ['release commit', g.manifest.release_commit || '—'], ['entries', String((g.manifest.entries || []).length)], ['anchor', g.manifest.anchor || '—'], ['anchor attestation', g.manifest.attestation ? `signed by ${g.manifest.attestation.issuer}` : 'UNSIGNED'], ['external record', g.manifest.external_record ? `${g.manifest.external_record.provider} · ${g.manifest.external_record.id} · ${g.anchorHeld === true ? 'HELD by the provider' : g.anchorHeld === false ? 'NOT on the provider\'s trail' : 'not checked (provider not read)'}` : 'none'], ['chain', g.sealFindings.length ? `FLAGGED: ${g.sealFindings[0]}` : 'verified']] } } : { note: 'No evidence manifest.' },
      ] },
      { heading: 'Flags', blocks: [g.flagged.length ? { list: g.flagged } : { p: 'Every row on this page verified against the record it cites.' }] },
    ],
  };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const changeId = argv.find((a) => !a.startsWith('--'));
  if (!changeId) { process.stderr.write('usage: node scripts/record-audit.mjs <CHG-id> [--out dir] [--json]\n'); return 2; }
  const oi = argv.indexOf('--out'); const outDir = join(cwd, oi >= 0 ? argv[oi + 1] : 'docs/governance/audit');
  const g = await gather(changeId, { cwd });
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify({ changeId, provider: g.provider, record: g.record.status, kept: g.kept.map((k) => ({ name: k.name, verdict: k.verdict })), anchorHeld: g.anchorHeld, flagged: g.flagged }, null, 2) + '\n'); return g.flagged.length ? 6 : 0; }
  const brand = parseTokens(join(cwd, 'discovery/brand/design.md'));
  const html = render('document', spec(g), brand);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${changeId}.html`);
  writeFileSync(out, html);
  process.stdout.write(`audit package → ${out} (${g.kept.length} kept record(s), provider ${g.provider || 'not mounted'}, ${g.flagged.length} flag(s))\n`);
  for (const f of g.flagged) process.stdout.write(`  · FLAG ${f}\n`);
  return g.flagged.length ? 6 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
