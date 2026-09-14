// Tests for the read-only record server (2.1.0, plan row 2.11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, callTool, handle } from './record-mcp.mjs';
import { createFakeKosli, respond } from './kosli-fake.mjs';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), 'record-mcp.mjs');
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

function tree({ mount }) {
  const cwd = mkdtempSync(join(tmpdir(), 'rmcp-'));
  mkdirSync(join(cwd, 'docs/governance/adapters'), { recursive: true });
  writeFileSync(join(cwd, 'docs/governance/control-catalog.json'), JSON.stringify({ controls: [{ control_id: 'A', mechanism_ref: 'scripts/a-check.mjs', lane: 'pr' }] }));
  writeFileSync(join(cwd, 'docs/governance/obligations.json'), JSON.stringify({ obligations: [{ id: 'OB-1', title: 't', source: 's', control_ids: ['CTRL-1'], catalog_controls: ['A'], finos: ['mi-4'] }] }));
  if (mount) {
    writeFileSync(join(cwd, 'docs/governance/provider-selection.json'), JSON.stringify({ selections: [{ role: 'external-record', provider: 'kosli', adapter_id: 'kosli-external-record', decided_by: 'x', decided_at: '2026-09-13', source: 'y' }] }));
    writeFileSync(join(cwd, 'docs/governance/adapters/kosli.json'), JSON.stringify({ role: 'external-record', provider: 'kosli', adapter_id: 'kosli-external-record', config: { org: 'acme' }, activation_evidence: {} }));
  }
  const fake = createFakeKosli(join(cwd, 'fake'));
  return { cwd, fake: fake.dir, env: { ...process.env, KOSLI_BIN: fake.bin } };
}
const trail = () => ({ name: 'CHG-1', compliance_status: { status: 'NON-COMPLIANT', attestations_statuses: [
  { attestation_name: 'risk-class', attestation_type: 'generic', attestation_id: 'a1', status: 'COMPLETE', is_compliant: true, unexpected: false },
  { attestation_name: 'gate.scripts-a-check', attestation_type: 'generic', attestation_id: 'a2', status: 'COMPLETE', is_compliant: false, unexpected: false },
  { attestation_name: 'stray', attestation_type: 'generic', attestation_id: 'a3', status: 'COMPLETE', is_compliant: true, unexpected: true },
] } });

test('the protocol: initialize, tools/list, ping, unknown method, notifications ignored', async () => {
  const init = await handle(rpc(1, 'initialize', {}));
  assert.equal(init.result.protocolVersion, '2024-11-05'); assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal((await handle(rpc(2, 'tools/list'))).result.tools.length, TOOLS.length);
  assert.deepEqual((await handle(rpc(3, 'ping'))).result, {});
  assert.equal((await handle(rpc(4, 'nope'))).error.code, -32601);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await handle(rpc(5, 'tools/call', { name: 'no_such_tool' }))).error.code, -32602);
});

test('unmounted: every record tool answers not-mounted with the reason; obligation_lookup still works from the register', async () => {
  const t = tree({ mount: false });
  try {
    for (const name of ['record_get_trail', 'record_trail_gaps', 'record_last_failures', 'record_environment_snapshot', 'record_answers']) {
      const r = await callTool(name, { trail: 'CHG-1', environment: 'prod', question: 'q' }, { cwd: t.cwd, env: t.env });
      assert.equal(r.status, 'not-mounted', name); assert.match(r.reason, /no provider selected/);
    }
    const o = await callTool('obligation_lookup', { obligation_id: 'OB-1' }, { cwd: t.cwd });
    assert.equal(o.status, 'ok'); assert.deepEqual(o.finos, ['mi-4']); assert.deepEqual(o.institution, ['OB-1', 'CTRL-1']);
    const c = await callTool('obligation_lookup', { control_id: 'A' }, { cwd: t.cwd });
    assert.equal(c.status, 'ok'); assert.equal(c.obligations[0].id, 'OB-1');
    assert.equal((await callTool('obligation_lookup', { obligation_id: 'OB-9' }, { cwd: t.cwd })).status, 'not-found');
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('mounted: trail, gaps (against the catalog), last failures and the snapshot read through the seam; answers stays not-mounted (question 7)', async () => {
  const t = tree({ mount: true });
  try {
    respond(t.fake, ['get', 'trail'], { stdout: trail() });
    respond(t.fake, ['get', 'snapshot', 'prod'], { stdout: [{ artifact: 'app:1', fingerprint: 'ab'.repeat(32), flow: 'f', git_commit: 'c', replicas: 2, running_since: 'now' }] });
    const g = await callTool('record_get_trail', { trail: 'CHG-1' }, { cwd: t.cwd, env: t.env });
    assert.equal(g.status, 'ok'); assert.equal(g.records.length, 3); assert.equal(g.provider, 'kosli');
    const gaps = await callTool('record_trail_gaps', { trail: 'CHG-1' }, { cwd: t.cwd, env: t.env });
    assert.deepEqual(gaps.expected, ['risk-class', 'seal-anchor', 'gate.scripts-a-check']);
    assert.deepEqual(gaps.missing, ['seal-anchor']); assert.deepEqual(gaps.extra, ['stray']);
    const f = await callTool('record_last_failures', { trail: 'CHG-1' }, { cwd: t.cwd, env: t.env });
    assert.deepEqual(f.failures.map((x) => x.name), ['gate.scripts-a-check']);
    const s = await callTool('record_environment_snapshot', { environment: 'prod' }, { cwd: t.cwd, env: t.env });
    assert.equal(s.status, 'ok'); assert.equal(s.artifacts[0].fingerprint, 'ab'.repeat(32));
    const a = await callTool('record_answers', { question: 'what failed?' }, { cwd: t.cwd, env: t.env });
    assert.equal(a.status, 'not-mounted'); assert.match(a.reason, /question 7/);
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('over stdio: newline-delimited JSON-RPC in, one response per request out, parse errors answered, nothing written to the tree', () => {
  const t = tree({ mount: false });
  try {
    const input = [JSON.stringify(rpc(1, 'initialize', {})), '{not json', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), JSON.stringify(rpc(2, 'tools/call', { name: 'record_trail_gaps', arguments: { trail: 'CHG-1' } }))].join('\n') + '\n';
    const r = spawnSync(process.execPath, [SERVER], { cwd: t.cwd, input, encoding: 'utf8', env: t.env });
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(out.length, 3);
    assert.equal(out[0].id, 1); assert.equal(out[1].error.code, -32700);
    assert.equal(out[2].id, 2); assert.match(out[2].result.content[0].text, /not-mounted/);
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});
