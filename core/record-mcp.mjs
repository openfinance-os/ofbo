// The read-only record server (2.1.0, hardening plan row 2.11; PRD F7; decision K5). Agents READ
// the external record before they plan, through this server, and nothing here can write: the only
// write path in the harness is the gate runner's attest step. Zero dependencies — a stdio MCP
// server speaking newline-delimited JSON-RPC 2.0 (initialize · tools/list · tools/call · ping) —
// so an adopter mounts it with one line in .mcp.json and no install:
//
//   { "mcpServers": { "loom-record": { "command": "node", "args": ["core/record-mcp.mjs"] } } }
//
// Every tool answers `not-mounted` (with the reason) when no provider is selected — the server is
// always safe to mount, and an agent that reads "not mounted" cites that, never a guess. Tools:
//   record_get_trail          the trail for a change (or run): every record by name, id, status
//   record_trail_gaps         expected (from the catalog) vs present — what the change still owes
//   record_last_failures      the non-compliant records on a trail, newest first
//   record_environment_snapshot   what the provider says is running in an environment
//   record_answers            a natural-language query — `not-mounted` until a provider offers one (question 7)
//   obligation_lookup         an obligation or a control id → the register row(s) and FINOS ids (row 3.5)
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { environmentSnapshot, status as recordStatus, trailStatus } from './external-record.mjs';
import { loadObligations } from './record-controls.mjs';

export const SERVER = { name: 'loom-record', version: '2.1.0' };
export const PROTOCOL_VERSION = '2024-11-05';
const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json', 'governance/control-catalog.template.json'];
const FIXED_STAGES = { delivery: ['risk-class', 'seal-anchor'], discovery: ['intent', 'problem-selected', 'discovery-stopped'] };
const gateName = (m) => `gate.${String(m).replace(/\.mjs$/, '').replace(/[\\/]/g, '-')}`;

export const TOOLS = [
  { name: 'record_get_trail', description: 'The external record\'s trail for a change (delivery) or a discovery run: every record by name with its id, status and compliance. Read-only.', inputSchema: { type: 'object', required: ['trail'], properties: { trail: { type: 'string', description: 'change id (CHG-…) or discovery run slug' }, flow: { type: 'string', enum: ['delivery', 'discovery'], default: 'delivery' } } } },
  { name: 'record_trail_gaps', description: 'What a change still owes the record: the records the control catalog expects on its trail that are not present yet, and extras the catalog does not expect.', inputSchema: { type: 'object', required: ['trail'], properties: { trail: { type: 'string' }, flow: { type: 'string', enum: ['delivery', 'discovery'], default: 'delivery' } } } },
  { name: 'record_last_failures', description: 'The non-compliant records on a change\'s trail, newest first — what failed last and which controls it evidences.', inputSchema: { type: 'object', required: ['trail'], properties: { trail: { type: 'string' }, flow: { type: 'string', enum: ['delivery', 'discovery'], default: 'delivery' }, limit: { type: 'integer', minimum: 1, default: 10 } } } },
  { name: 'record_environment_snapshot', description: 'What the external record says is RUNNING in an environment (artifact, fingerprint, since when). The deploy lane reads the same snapshot.', inputSchema: { type: 'object', required: ['environment'], properties: { environment: { type: 'string', description: 'environment id from docs/governance/environments.json, or the provider\'s own name' } } } },
  { name: 'record_answers', description: 'Ask the external record a natural-language question. Answers `not-mounted` until a provider offers a query surface (kosli-seam.md question 7).', inputSchema: { type: 'object', required: ['question'], properties: { question: { type: 'string' } } } },
  { name: 'obligation_lookup', description: 'Resolve an obligation id (OB-…) to its register row, institution control ids and FINOS ids — or a control id (CTRL-… / a catalog id) to the obligations that cite it.', inputSchema: { type: 'object', properties: { obligation_id: { type: 'string' }, control_id: { type: 'string' } } } },
];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const expectedFor = (flow, cwd) => {
  if (flow !== 'delivery') return [...(FIXED_STAGES[flow] || [])];
  const p = CATALOG_LOCATIONS.map((x) => join(cwd, x)).find(existsSync);
  const cat = p ? readJson(p) : null;
  const names = new Set();
  for (const c of cat?.controls || []) {
    if (typeof c.mechanism_ref !== 'string' || !c.mechanism_ref.endsWith('.mjs') || c.execute === false) continue;
    if (!['pr', 'release'].includes(c.lane || 'pr')) continue;
    names.add(gateName(c.mechanism_ref));
  }
  return [...FIXED_STAGES.delivery, ...[...names].sort()];
};
const notMounted = (st) => ({ status: 'not-mounted', reason: st.reason, note: 'no external-record provider is selected and mounted (docs/governance/provider-selection.json); cite this, do not infer a record' });

/** Run one tool. Pure over `cwd`; every branch returns a JSON-serialisable object. */
export async function callTool(name, args = {}, { cwd = process.cwd(), env = process.env } = {}) {
  const st = recordStatus(cwd);
  switch (name) {
    case 'record_get_trail': {
      if (!st.mounted) return notMounted(st);
      const t = await trailStatus({ flow: args.flow || 'delivery', trail: String(args.trail || '') }, { cwd, env });
      if (t.status !== 'ok') return { status: t.status, provider: st.provider, reason: t.reason };
      return { status: 'ok', provider: st.provider, flow: t.flow, trail: t.trail, compliance: t.compliance, records: t.present.map((a) => ({ name: a.name, id: a.id, type: a.type, status: a.status, compliant: a.compliant, artifact: a.artifact })), missing_by_template: t.missing, unexpected: t.unexpected };
    }
    case 'record_trail_gaps': {
      if (!st.mounted) return notMounted(st);
      const flow = args.flow || 'delivery';
      const t = await trailStatus({ flow, trail: String(args.trail || '') }, { cwd, env });
      if (t.status !== 'ok') return { status: t.status, provider: st.provider, reason: t.reason };
      const expected = expectedFor(flow, cwd);
      const have = new Set(t.present.map((a) => a.name));
      return { status: 'ok', provider: st.provider, trail: t.trail, expected, present: expected.filter((n) => have.has(n)), missing: expected.filter((n) => !have.has(n)), extra: t.present.map((a) => a.name).filter((n) => !expected.includes(n)) };
    }
    case 'record_last_failures': {
      if (!st.mounted) return notMounted(st);
      const t = await trailStatus({ flow: args.flow || 'delivery', trail: String(args.trail || '') }, { cwd, env });
      if (t.status !== 'ok') return { status: t.status, provider: st.provider, reason: t.reason };
      const failed = t.present.filter((a) => a.compliant === false).reverse().slice(0, Math.max(1, Number(args.limit) || 10));
      return { status: 'ok', provider: st.provider, trail: t.trail, failures: failed.map((a) => ({ name: a.name, id: a.id, status: a.status })) };
    }
    case 'record_environment_snapshot': {
      const s = await environmentSnapshot(String(args.environment || ''), { cwd, env });
      if (s.status === 'unmounted') return notMounted(st);
      return s;
    }
    case 'record_answers':
      return st.mounted ? { status: 'not-mounted', provider: st.provider, reason: `provider ${st.provider} offers no query surface through the CLI at the verified version (docs/kosli-surface.md, question 7) — read the trail with record_get_trail instead` } : notMounted(st);
    case 'obligation_lookup': {
      const loaded = loadObligations(cwd);
      if (!loaded) return { status: 'not-mounted', reason: 'docs/governance/obligations.json is not mounted — no obligation can be resolved' };
      if (args.obligation_id) {
        const o = loaded.byId.get(args.obligation_id);
        if (!o) return { status: 'not-found', obligation_id: args.obligation_id, known: [...loaded.byId.keys()].slice(0, 20) };
        return { status: 'ok', obligation: o, institution: [o.id, ...(o.control_ids || [])], finos: o.finos || [], catalog_controls: o.catalog_controls || [] };
      }
      if (args.control_id) {
        const hits = loaded.obligations.filter((o) => (o.control_ids || []).includes(args.control_id) || (o.catalog_controls || []).includes(args.control_id));
        return { status: hits.length ? 'ok' : 'not-found', control_id: args.control_id, obligations: hits.map((o) => ({ id: o.id, title: o.title, source: o.source, finos: o.finos || [] })) };
      }
      return { status: 'error', reason: 'give obligation_id or control_id' };
    }
    default:
      return { status: 'error', reason: `unknown tool ${name}` };
  }
}

/** Handle one JSON-RPC request → response (null for notifications). */
export async function handle(msg, ctx = {}) {
  if (!msg || typeof msg !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  if (typeof method !== 'string') return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'no method' } };
  if (method.startsWith('notifications/')) return null;
  switch (method) {
    case 'initialize': return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER, instructions: 'Read-only view of the Loom external record. Every tool answers not-mounted when no provider is selected; cite that rather than inferring a record. Nothing here writes.' });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name}` } };
      const out = await callTool(name, params?.arguments || {}, ctx);
      return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: out?.status === 'error' });
    }
    default: return { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `method not found: ${method}` } };
  }
}

/** Serve stdin → stdout until EOF. */
export function serve({ input = process.stdin, output = process.stdout, cwd = process.cwd(), env = process.env } = {}) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      let msg;
      try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
      const res = await handle(msg, { cwd, env });
      if (res) output.write(JSON.stringify(res) + '\n');
    });
  });
  return new Promise((resolve) => rl.on('close', () => chain.then(resolve)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve().then(() => process.exit(0));
