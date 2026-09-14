// Tests for the audit package (2.1.0, plan row 2.12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gather, main, spec } from './record-audit.mjs';
import { buildEnvelope, signEnvelope } from '../core/provenance.mjs';
import { render } from '../discovery/render/render.mjs';
import { parseTokens } from '../discovery/render/tokens.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keys = generateKeyPairSync('ed25519');
const pem = (k, type) => k.export({ type, format: 'pem' }).toString();
const COMMIT = 'a'.repeat(40);
const env = (name, over = {}) => signEnvelope(buildEnvelope({ kind: 'gate', name, subject: { flow: 'delivery', trail: 'CHG-2026-0042' }, commit: COMMIT, actor: { id: 'agent-loom-delivery' }, runner: { subject: 's', repository: 'r', ref: 'x', sha: COMMIT }, payload: { gate: 'scripts/x.mjs', result: 'pass', controls: ['HG-0003'] }, controls: { institution: ['OB-1', 'CTRL-1'], finos: ['mi-4'], catalog: ['HG-0003'], controls_source: 'obligations:v1' }, ...over }), { issuer: 'ci-runner', privateKeyPem: pem(keys.privateKey, 'pkcs8') });

function tree({ mount }) {
  const cwd = mkdtempSync(join(tmpdir(), 'audit-'));
  mkdirSync(join(cwd, 'docs/governance/adapters'), { recursive: true });
  mkdirSync(join(cwd, 'docs/governance/evidence/records'), { recursive: true });
  writeFileSync(join(cwd, 'docs/governance/attestation-issuers.json'), JSON.stringify({ issuers: [{ id: 'ci-runner', mechanism: 'ed25519', verify: { public_key: pem(keys.publicKey, 'spki') } }] }));
  writeFileSync(join(cwd, 'docs/governance/identities.json'), JSON.stringify({ identities: [{ id: 'agent-loom-delivery', kind: 'agent', model: { model_id: 'm@1' } }] }));
  if (existsSync(join(HARNESS, 'change-example'))) cpSync(join(HARNESS, 'change-example'), join(cwd, 'docs/governance/changes/CHG-2026-0042'), { recursive: true });
  cpSync(join(HARNESS, 'discovery/brand/design.md'), join(cwd, 'discovery/brand/design.md'));
  const good = env('gate.scripts-x');
  const tampered = env('gate.scripts-y'); tampered.payload.result = 'fail';
  writeFileSync(join(cwd, 'docs/governance/evidence/records/CHG-2026-0042-gate.scripts-x.json'), JSON.stringify({ ...good, record: { status: 'recorded', id: 'att-x' } }));
  writeFileSync(join(cwd, 'docs/governance/evidence/records/CHG-2026-0042-gate.scripts-y.json'), JSON.stringify({ ...tampered, record: { status: 'recorded', id: 'att-y' } }));
  writeFileSync(join(cwd, 'docs/governance/evidence/records/CHG-2026-0099-gate.scripts-z.json'), JSON.stringify(env('gate.scripts-z')));
  if (mount) {
    writeFileSync(join(cwd, 'docs/governance/provider-selection.json'), JSON.stringify({ selections: [{ role: 'external-record', provider: 'kosli', adapter_id: 'kosli-external-record', decided_by: 'x', decided_at: '2026-09-13', source: 'y' }] }));
    writeFileSync(join(cwd, 'docs/governance/adapters/kosli.json'), JSON.stringify({ role: 'external-record', provider: 'kosli', adapter_id: 'kosli-external-record', config: {}, activation_evidence: {} }));
  }
  return cwd;
}

test('unmounted: kept envelopes are re-verified locally, a tampered one is FLAGGED, other changes\' records are ignored, and the missing manifest is flagged', async () => {
  const cwd = tree({ mount: false });
  try {
    const g = await gather('CHG-2026-0042', { cwd });
    assert.equal(g.provider, null); assert.equal(g.record.status, 'not-mounted');
    assert.deepEqual(g.kept.map((k) => [k.name, k.verdict]), [['gate.scripts-x', 'verified-locally'], ['gate.scripts-y', 'flagged']]);
    assert.ok(g.flagged.some((f) => /gate\.scripts-y\.json: .*payload_digest|does NOT verify/.test(f)));
    assert.ok(g.flagged.some((f) => /no evidence manifest/.test(f)));
    const s = spec(g);
    assert.match(s.title, /CHG-2026-0042/); assert.match(s.subtitle, /FLAGGED/);
    const html = render('document', s, parseTokens(join(cwd, 'discovery/brand/design.md')));
    assert.ok(html.includes('FLAGGED') && html.includes('gate.scripts-x') && html.includes('mi-4'));
    const code = await main(['CHG-2026-0042', '--out', 'out'], cwd);
    assert.equal(code, 6);
    assert.ok(existsSync(join(cwd, 'out/CHG-2026-0042.html')));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('mounted: a kept envelope the provider holds is VERIFIED; one the provider does not hold is not-on-record; the trail is injectable', async () => {
  const cwd = tree({ mount: true });
  try {
    const trailFn = async () => ({ status: 'ok', flow: 'loom-delivery', trail: 'CHG-2026-0042', compliance: 'COMPLETE', present: [{ name: 'gate.scripts-x', id: 'att-x', compliant: true, status: 'COMPLETE' }], missing: ['seal-anchor'], unexpected: [] });
    const g = await gather('CHG-2026-0042', { cwd, trailFn });
    assert.equal(g.provider, 'kosli');
    assert.equal(g.kept.find((k) => k.name === 'gate.scripts-x').verdict, 'verified');
    assert.equal(g.kept.find((k) => k.name === 'gate.scripts-y').verdict, 'flagged');
    const y = { ...JSON.parse(readFileSync(join(cwd, 'docs/governance/evidence/records/CHG-2026-0042-gate.scripts-y.json'), 'utf8')) };
    writeFileSync(join(cwd, 'docs/governance/evidence/records/CHG-2026-0042-gate.scripts-y.json'), JSON.stringify({ ...env('gate.scripts-y'), record: y.record }));
    const g2 = await gather('CHG-2026-0042', { cwd, trailFn });
    assert.equal(g2.kept.find((k) => k.name === 'gate.scripts-y').verdict, 'not-on-record');
    assert.ok(g2.flagged.some((f) => /holds no record named gate\.scripts-y/.test(f)));
    const rows = spec(g2).sections[1].blocks[0].table.rows;
    assert.deepEqual(rows[0], ['gate.scripts-x', 'att-x', 'compliant']);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
