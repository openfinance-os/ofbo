// AGENT-OUTPUT — the agent output contract, held mechanically (2.1.0, hardening plan rows 5.1 / 5.4).
//
// The Loom's reviewer and assurance agents are prompts. A prompt cannot be unit-tested the way a
// gate can, and the harness has never claimed otherwise (bank-grade-gap.md grades every agent-run
// step Defined). What CAN be held mechanically is the CONTRACT around the prompt:
//
//   1. every agent definition declares the output schema (`loom.agent-output/v1`), the
//      INSUFFICIENT_EVIDENCE verdict, and what it does when its register is absent — the three
//      things a second line needs before it will read agent output as input to a decision;
//   2. every eval fixture's expected output validates against the schema, and its invariants hold:
//      a fixture with the register absent expects INSUFFICIENT_EVIDENCE; every evidence ref names
//      a file in the fixture; a PASS-class verdict carries no high or critical finding;
//   3. every agent that emits this schema is a ROLE in docs/governance/model-manifest.json, so
//      HG-0006 (pinned, tiered, evaluated, validated) applies to the reviewers as it does to the
//      delivery loop.
//
// What this gate does NOT do: run the model. `--run` is a documented seam for an adopter's eval
// rig (an LLM invocation per fixture, output compared to expected.json); in CI this gate is
// structural, and it says so in its OK line. A fixture set nobody has run against the model is a
// specification of behaviour, not a measurement of it.
//
// Resolves both layouts: the plugin's agents (bundle: ../../../agents) and the adopted repo's
// .claude/agents, plus the harness's own reviewer templates (agents/). Fixtures live beside the
// schema under agents/evals/<agent>/<case>/.
//
// Run from the repo root: `node scripts/agent-output-check.mjs` (exit 1 on any finding).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_ID = 'loom.agent-output/v1';
export const PASS_CLASS = new Set(['PASS', 'CONFORMANT', 'ACCEPTABLE', 'CLEAR']);
export const REQUIRED_DECLARATIONS = [
  { re: /loom\.agent-output\/v1/, what: 'the output schema id `loom.agent-output/v1`' },
  { re: /INSUFFICIENT_EVIDENCE/, what: 'the INSUFFICIENT_EVIDENCE verdict' },
  { re: /register_state|register (is )?(absent|not mounted)/i, what: 'what it does when its register is absent' },
  { re: /\bconfidence\b/, what: 'a confidence field' },
  { re: /evidence_refs/, what: 'evidence_refs on every finding' },
];

/** Where agent definitions live, in whichever layouts are present. */
export function agentDirs(cwd = process.cwd()) {
  // The plugin layout is recognised by the bundle-only copy manifest, so an adopted tree never
  // walks three levels up into whatever happens to sit there.
  const bundle = existsSync(join(HARNESS, 'copy-manifest.json'));
  return [join(cwd, '.claude/agents'), join(HARNESS, 'agents'), ...(bundle ? [resolve(HARNESS, '../../../agents')] : [])]
    .filter((d, i, a) => existsSync(d) && a.indexOf(d) === i);
}
const mdFiles = (d) => existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.md')).map((n) => join(d, n)) : [];
const nameOf = (text, file) => (text.match(/^name:\s*(.+)$/m)?.[1] || file.replace(/.*\//, '').replace(/\.md$/, '')).trim();

/** Findings for one agent definition's text. */
export function checkDefinition(text, label) {
  const findings = [];
  if (!/^## Output/m.test(text)) findings.push(`${label}: has no "## Output" section`);
  for (const d of REQUIRED_DECLARATIONS) if (!d.re.test(text)) findings.push(`${label}: does not declare ${d.what}`);
  return findings;
}

/** Minimal validator for the shape the schema file declares (type, required, enum, const, minLength, minItems, items). */
export function validate(value, schema, path = '$') {
  const out = [];
  if (!schema || typeof schema !== 'object') return out;
  if ('const' in schema && value !== schema.const) out.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: must be an object`];
    for (const k of schema.required || []) if (!(k in value)) out.push(`${path}: missing required ${k}`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in value) out.push(...validate(value[k], sub, `${path}.${k}`));
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: must be an array`];
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) out.push(`${path}: needs at least ${schema.minItems} item(s)`);
    value.forEach((v, i) => out.push(...validate(v, schema.items, `${path}[${i}]`)));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return [`${path}: must be a string`];
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) out.push(`${path}: must not be empty`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') out.push(`${path}: must be a boolean`);
  return out;
}

/** The schema's invariants — the rules a shape check cannot express. */
export function invariants(out, label = 'output') {
  const f = [];
  if (out.register_state === 'absent' && out.verdict !== 'INSUFFICIENT_EVIDENCE') f.push(`${label}: register_state is absent but verdict is ${out.verdict} — with no register there is nothing to judge against`);
  if (out.verdict === 'INSUFFICIENT_EVIDENCE' && !(typeof out.reason === 'string' && out.reason.trim())) f.push(`${label}: INSUFFICIENT_EVIDENCE with no reason — say what was missing`);
  const read = new Set(out.inputs_read || []);
  for (const fd of out.findings || []) for (const r of fd.evidence_refs || []) if (r?.file && !read.has(r.file)) f.push(`${label}: finding ${fd.id} cites ${r.file}, which is not in inputs_read`);
  if (PASS_CLASS.has(out.verdict) && (out.findings || []).some((x) => x.severity === 'critical' || x.severity === 'high')) f.push(`${label}: verdict ${out.verdict} with a high/critical finding — a pass does not carry a blocker`);
  if (out.model === 'unknown' || out.prompt_version === 'unknown') f.push(`${label}: model or prompt_version is "unknown" — the role's pin from the model manifest is the value`);
  return f;
}

/** Fixture directory → findings. A case is <agent>/<case>/{case.json, expected.json, input/...}. */
export function checkFixtures(evalsDir, schema) {
  const findings = [];
  let cases = 0;
  if (!existsSync(evalsDir)) return { findings, cases };
  for (const agent of readdirSync(evalsDir).filter((n) => statSync(join(evalsDir, n)).isDirectory())) {
    for (const c of readdirSync(join(evalsDir, agent)).filter((n) => statSync(join(evalsDir, agent, n)).isDirectory())) {
      const dir = join(evalsDir, agent, c);
      const label = `${agent}/${c}`;
      cases++;
      const caseFile = join(dir, 'case.json'), expFile = join(dir, 'expected.json');
      if (!existsSync(caseFile) || !existsSync(expFile)) { findings.push(`${label}: needs case.json and expected.json`); continue; }
      let meta, exp;
      try { meta = JSON.parse(readFileSync(caseFile, 'utf8')); exp = JSON.parse(readFileSync(expFile, 'utf8')); } catch (e) { findings.push(`${label}: unreadable (${e.message})`); continue; }
      findings.push(...validate(exp, schema, `${label} expected`));
      findings.push(...invariants(exp, `${label} expected`));
      if (exp.agent !== agent) findings.push(`${label}: expected.agent is ${exp.agent}, fixture is under ${agent}`);
      if (meta.register_mounted === false && exp.register_state !== 'absent') findings.push(`${label}: case says the register is not mounted but expected.register_state is ${exp.register_state}`);
      if (meta.register_mounted === false && exp.verdict !== 'INSUFFICIENT_EVIDENCE') findings.push(`${label}: case says the register is not mounted but expects ${exp.verdict} — the one thing a register-less run may say is that it cannot judge`);
      for (const f of exp.inputs_read || []) if (!existsSync(join(dir, 'input', f))) findings.push(`${label}: inputs_read names ${f}, which is not in the fixture's input/`);
      if (typeof meta.expect_verdict === 'string' && meta.expect_verdict !== exp.verdict) findings.push(`${label}: case.json expects ${meta.expect_verdict}, expected.json says ${exp.verdict}`);
    }
  }
  return { findings, cases };
}

/** Every agent that emits the schema must be a role in the model manifest, by name or via a role's `agents` list (HG-0006 applies to the reviewers). */
export function checkManifestRoles(manifest, agentNames) {
  const roles = new Set();
  for (const m of manifest?.models || []) { roles.add(m.role); for (const a of Array.isArray(m.agents) ? m.agents : []) roles.add(a); }
  return agentNames.filter((a) => !roles.has(a)).map((a) => `${a}: emits loom.agent-output/v1 but is not a role in the model manifest — a reviewer that is not inventoried is an ungoverned model (HG-0006)`);
}

export function check(cwd = process.cwd()) {
  const findings = [], notices = [];
  const schemaPath = [join(cwd, '.claude/agents/agent-output.schema.json'), join(HARNESS, 'agents/agent-output.schema.json')].find(existsSync);
  if (!schemaPath) return { findings: ['agent-output.schema.json not found — the agent output contract is not mounted'], notices, agents: 0, cases: 0 };
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const agents = [];
  for (const d of agentDirs(cwd)) for (const f of mdFiles(d)) {
    const text = readFileSync(f, 'utf8');
    const name = nameOf(text, f);
    if (!schema.properties.agent.enum.includes(name)) continue; // not a Loom reviewer/assurance agent
    agents.push(name);
    findings.push(...checkDefinition(text, name));
  }
  const evalsDir = [join(cwd, '.claude/agents/evals'), join(HARNESS, 'agents/evals')].find(existsSync);
  const fx = checkFixtures(evalsDir, schema);
  findings.push(...fx.findings);
  const manifestPath = ['docs/governance/model-manifest.json', 'model-manifest.json'].map((p) => join(cwd, p)).find(existsSync)
    || join(HARNESS, 'governance/model-manifest.template.json');
  if (existsSync(manifestPath)) {
    try { findings.push(...checkManifestRoles(JSON.parse(readFileSync(manifestPath, 'utf8')), agents)); } catch (e) { findings.push(`${manifestPath}: unreadable (${e.message})`); }
  } else notices.push('no model manifest found — reviewer roles could not be checked');
  if (agents.length === 0) notices.push('no Loom reviewer or assurance agent definition found in this layout — nothing to hold to the contract');
  notices.push(`structural only: the fixtures were validated as a specification of behaviour, not run against the model (pass --run with an eval rig to measure)`);
  return { findings, notices, agents: agents.length, cases: fx.cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--run')) {
    process.stderr.write('agent-output-check --run: no eval rig is bundled; wire your rig to invoke each agent on agents/evals/<agent>/<case>/input and compare to expected.json. Exiting 2 — unrun is not a pass.\n');
    process.exit(2);
  }
  const { findings, notices, agents, cases } = check();
  for (const n of notices) process.stdout.write(`  note: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nAgent output contract gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery reviewer and assurance agent declares loom.agent-output/v1, the INSUFFICIENT_EVIDENCE verdict\nand its register-absent behaviour; every fixture validates; every emitting agent is a manifest role.\n');
    process.exit(1);
  }
  process.stdout.write(`Agent output contract gate — OK (${agents} agent definition(s), ${cases} fixture case(s), structural)\n`);
}
