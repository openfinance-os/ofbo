// The gate runner (Loom 2.0 — risk-proportionate execution). Running every gate on every
// PR contradicts Promise 1: a documentation fix should not take the route of a lending
// model. The runner reads the CONTROL CATALOG — lane assignment is governed data, not
// ad-hoc CI editing — and executes only what this diff implicates:
//
//   lane   pr | release | scheduled — which trigger a control runs on
//   always the tamper-detection core: never skipped in its lane, whatever the diff
//   paths  path prefixes that implicate the control; a diff touching none of them skips it
//
// Three honesty rules: SKIPPING IS RECORDED, never silent (the run record lists every skip
// and why); an UNKNOWN diff runs everything in the lane (fail open toward more control,
// never less); selection comes from the catalog + compiled plans, so a change cannot talk
// its way onto the light path. This file is control plane (CONTROL_TARGETS).
//
// rc.40 (flow-plan Phase 6) — the loop is a bounded-concurrency POOL, not a serial queue. Three
// properties come with it and none of them may be traded for the speed:
//
//   waves      optional `depends_on: [control_id]` on a catalog entry orders the pool
//              topologically; the wave number is recorded per execution. Nothing else changes
//              order, and a dependency on a control that this run skipped is simply not a
//              constraint (the skip is already recorded, with its reason).
//   timeout    `--timeout-ms` (default 300000). A hung gate used to hang CI forever. A timeout
//              is a FAILURE, recorded as status `timeout` — never a pass, never a skip.
//   order      output is captured per gate and flushed in CATALOG order once the pool drains,
//              so a parallel run's log reads exactly like the serial one's.
//
// Run: `node core/gate-runner.mjs --lane pr [--base <ref>] [--out record.json] [--emit-dir <dir>]
//       [--jobs N] [--timeout-ms N] [--no-cache]
//       [--record [--actor <registry-id>] [--record-issuer <id>] [--record-key <pem-path>]]`.
//
// 2.1.0 (hardening plan row 2.4, decision K9): with --record, every executed mechanism's result is
// posted through core/external-record.mjs as a signed `gate` envelope on the trail of each
// implicated change — the record outside the tree that HG-0003 needs. The envelope is the runner's
// own emitted row (PR1), signed with the key the runner holds (never the tree), carrying the actor
// and the CI runner identity (PR6). Unmounted, the run record says `external_record: not mounted`
// and nothing else changes; a rejected envelope is recorded as rejected, never posted.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { aggregateRequirements, requiredBy } from './compiled-requirements.mjs';
import { TIERS } from './policy-compiler.mjs';
import { CACHE_DIR, cacheability, computeKey, read as cacheRead, write as cacheWrite } from './gate-cache.mjs';
import { pathToFileURL } from 'node:url';
import { actorFor, post as recordPost, runnerFromEnv, signerFromArgs, status as recordStatus } from './external-record.mjs';
import { buildEnvelope, signEnvelope } from './provenance.mjs';
import { controlsForRecord, loadObligations } from './record-controls.mjs';

// rc.11 (WS1.4): the lane model extends from pr|release|scheduled to cover the artifact's life —
// `build` produces the immutable artifact + provenance, `deploy` verifies the deployed digest is
// the authorized one. Release-evidence checks stop masquerading as PR-source checks.
export const LANES = ['pr', 'build', 'release', 'deploy', 'scheduled'];
const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];

const runnable = (c) => typeof c.mechanism_ref === 'string' && c.mechanism_ref.endsWith('.mjs');

/**
 * Pure selection: which controls run, which skip (each skip with its reason).
 * `changedPaths === null` means the diff is unknown → run everything in the lane.
 * `requirements` is the aggregated compiled requirements (see compiled-requirements.mjs): a
 * control whose `gate_family` any active change requires becomes UNSKIPPABLE in its lane —
 * path scoping can no longer talk a plan-mandated control off the route (W1, closes F1).
 */
export function select(catalog, { lane = 'pr', changedPaths = null, requirements = null } = {}) {
  const run = new Map(); // mechanism → {mechanism, ids[]}
  const skipped = [];
  const reqFamilies = requirements ? requirements.families : new Set();
  const tierIdx = (t) => TIERS.indexOf(t);
  for (const c of catalog?.controls || []) {
    if (!runnable(c)) continue; // documented/absent controls have nothing to execute
    if (c.execute === false) { skipped.push({ id: c.control_id, reason: c.execute_note || 'not directly executable — enforced via another gate' }); continue; }
    const cLane = c.lane || 'pr';
    if (cLane !== lane) { skipped.push({ id: c.control_id, reason: `lane:${cLane} (this is a ${lane} run)` }); continue; }
    // A compiled plan requires this control's family → it runs, whatever the diff.
    const mandated = c.gate_family && reqFamilies.has(c.gate_family);
    // rc.34 — tier-aware selection, OPT-IN per control. A control declaring `min_tier` runs only
    // when the highest risk tier among the implicated changes reaches it. `always` and
    // plan-mandated controls ignore it (the override goes upward, never downward), and it only
    // applies when requirements were aggregated at all — no aggregate, no tier scoping (fail
    // open). The shipped catalog declares none; adding min_tier is how an adopter gives a
    // documentation-only PR a genuinely shorter route.
    if (!mandated && !c.always && c.min_tier && requirements) {
      const maxT = requirements.maxTier ?? null;
      if (maxT === null || tierIdx(maxT) < tierIdx(c.min_tier)) {
        skipped.push({ id: c.control_id, reason: `min_tier:${c.min_tier} — highest implicated change tier is ${maxT || 'none'}` });
        continue;
      }
    }
    let why = null;
    if (mandated) why = `required by compiled plan [${requiredBy(requirements, c.gate_family).join(', ')}] (family ${c.gate_family})`;
    else if (c.always) why = 'always';
    else if (changedPaths === null) why = 'diff unknown — fail open to running';
    // Path scopes match a file exactly, or as a DIRECTORY prefix (a scope of `docs/backlog.yaml`
    // must not implicate `docs/backlog.yaml.bak`; a scope of `floor/cat` must not match
    // `floor/catalogue-x/`). rc.33 — raw startsWith did both.
    else if (Array.isArray(c.paths) && c.paths.some((p) => changedPaths.some((f) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`)))) why = 'implicated by diff';
    else if (!Array.isArray(c.paths)) why = 'no path scope declared — runs by default';
    if (!why) { skipped.push({ id: c.control_id, reason: `no implicated paths in this diff (scope: ${c.paths.join(', ')})` }); continue; }
    const entry = run.get(c.mechanism_ref) || { mechanism: c.mechanism_ref, ids: [], args: c.mechanism_args || [], controls: [] };
    entry.ids.push(c.control_id);
    entry.controls.push(c); // rc.40 — the cache reads the entries, not just their ids
    run.set(c.mechanism_ref, entry);
  }
  return { run: [...run.values()], skipped };
}

/**
 * Topological WAVES over the selected mechanisms (rc.40 — flow-plan Phase 6.1).
 *
 * `depends_on: [control_id]` on a catalog entry says "do not start me until that control has
 * finished". Execution is per MECHANISM (controls sharing one mechanism run once), so a control
 * dependency is projected onto the mechanism that carries it. Two rules keep it honest:
 *
 *   · a dependency on a control that is NOT in this run is not a constraint — it was skipped,
 *     with a recorded reason, and inventing a barrier for it would serialize on nothing;
 *   · a CYCLE is refused, not flattened. Silently running a cycle in one wave would mean the
 *     declared order is not the executed order, and the catalog would be lying.
 *
 * Returns an array of waves, each an array of run entries in catalog order. Throws on a cycle.
 */
export function planWaves(run, catalog) {
  const mechOf = new Map();
  const depsOf = new Map();
  for (const c of catalog?.controls || []) {
    if (!c || !c.control_id) continue;
    if (typeof c.mechanism_ref === 'string') mechOf.set(c.control_id, c.mechanism_ref);
    if (Array.isArray(c.depends_on)) depsOf.set(c.control_id, c.depends_on);
  }
  const byMech = new Map(run.map((g) => [g.mechanism, g]));
  const deps = new Map();
  for (const g of run) {
    const s = new Set();
    for (const id of g.ids) {
      for (const dep of depsOf.get(id) || []) {
        const m = mechOf.get(dep);
        if (m && m !== g.mechanism && byMech.has(m)) s.add(m);
      }
    }
    deps.set(g.mechanism, s);
  }
  const waves = [];
  const done = new Set();
  let remaining = run.map((g) => g.mechanism);
  while (remaining.length) {
    const ready = remaining.filter((m) => [...deps.get(m)].every((d) => done.has(d)));
    if (!ready.length) throw new Error(`depends_on cycle among selected controls (${remaining.join(', ')}) — the declared order cannot be executed`);
    waves.push(ready.map((m) => byMech.get(m)));
    for (const m of ready) done.add(m);
    remaining = remaining.filter((m) => !done.has(m));
  }
  return waves;
}

/** Default pool size: leave one core for the machine that is watching. */
export function defaultJobs() {
  const n = typeof availableParallelism === 'function' ? availableParallelism() : (cpus() || []).length;
  return Math.max(1, (Number.isFinite(n) && n > 0 ? n : 2) - 1);
}

/**
 * Spawn one mechanism, capturing its output. Resolves — never rejects — with
 * `{ status: 'pass'|'fail'|'timeout', ms, stdout, stderr }`. A timeout is a FAILURE: the child is
 * killed and the run record says `timeout`, so a hung gate stops the build instead of the clock.
 */
export function runMechanism(g, { timeoutMs = 300000, cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: timedOut ? 'timeout' : (code === 0 ? 'pass' : 'fail'), ms: Date.now() - t0, stdout, stderr });
    };
    let child;
    const timer = setTimeout(() => { timedOut = true; stderr += `${g.mechanism}: no result after ${timeoutMs}ms — killed and recorded as a TIMEOUT (a timeout is a failure, never a pass)\n`; try { child.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutMs);
    try {
      child = spawn(process.execPath, [g.mechanism, ...g.args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      stderr += `${g.mechanism}: ${e.message}\n`;
      return finish(1);
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += `${g.mechanism}: ${e.message}\n`; finish(1); });
    child.on('close', (code) => finish(code));
  });
}

/** Run one wave through a bounded pool of `jobs` workers. Results are keyed by mechanism. */
async function runWave(wave, { jobs, timeoutMs, cwd, onResult }) {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= wave.length) return;
      const g = wave[i];
      onResult(g, await runMechanism(g, { timeoutMs, cwd }));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, wave.length)) }, worker));
}

function changedSince(base) {
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch { return null; } // unknown diff → the runner fails open to running everything
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv;
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const lane = arg('--lane') || 'pr';
  if (!LANES.includes(lane)) { process.stderr.write(`lane must be ${LANES.join('|')}\n`); process.exit(2); }
  const base = arg('--base');
  const path = CATALOG_LOCATIONS.map((p) => `${process.cwd()}/${p}`).find(existsSync);
  if (!path) { process.stderr.write('no control catalog — the runner has no state of record to read\n'); process.exit(2); }
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  // A lane with NO runnable catalogued control is a CI step that structurally cannot fail — two
  // of those ran green for months (build, deploy). An empty lane is a hole, not a pass: refuse
  // to report OK about nothing (rc.33). Catalogue a control for the lane, or drop the invocation.
  const laneControls = (catalog?.controls || []).filter((c) => runnable(c) && c.execute !== false && (c.lane || 'pr') === lane);
  if (laneControls.length === 0) {
    process.stderr.write(`lane ${lane} has no runnable catalogued controls — an empty lane is a hole, not a pass.\nCatalogue a control with lane "${lane}", or remove this invocation from the workflow until one exists.\n`);
    process.exit(2);
  }
  const changedPaths = base ? changedSince(base) : null;
  // rc.34 — the aggregate is scoped to the changes THIS diff implicates (a change counts when
  // the diff touches its envelope directory or a declared scope_path). No base, or a git error,
  // means an unknown diff: every non-terminal change counts — fail open toward more control.
  const requirements = aggregateRequirements(process.cwd(), { changedPaths });
  const { run, skipped } = select(catalog, { lane, changedPaths, requirements });

  // rc.35 (flow-plan Phase 2): with --emit-dir, control-plane-style evidence becomes a gate
  // OUTPUT rather than a human transcription — one result record per mechanism, plus the run
  // record, each carrying the commit and timestamp. A hand-typed "PASS" is fabricatable; a
  // runner-emitted one is what the evidence seal was built to chain.
  const emitDir = arg('--emit-dir');
  if (emitDir) mkdirSync(emitDir, { recursive: true });
  let head = null;
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* no git */ }

  // rc.40 (flow-plan Phase 6.1/6.2) — the pool, the timeout, and the cache.
  const jobs = Math.max(1, Number.parseInt(arg('--jobs') ?? '', 10) || defaultJobs());
  const timeoutMs = Math.max(1, Number.parseInt(arg('--timeout-ms') ?? '', 10) || 300000);
  const cacheEnabled = !argv.includes('--no-cache');
  const cwd = process.cwd();
  const planHashes = requirements.changes.map((c) => c.plan_hash).filter(Boolean);

  let waves;
  try { waves = planWaves(run, catalog); }
  catch (e) {
    process.stderr.write(`\n${e.message}\nRemove or correct the depends_on edges in the control catalog; the runner will not\nflatten a cycle, because then the declared order would not be the executed order.\n`);
    process.exit(2);
  }

  // Cacheability is decided ONCE per mechanism and RECORDED either way — a control that is never
  // cached says so on every run, so the fast path can never become the quiet path.
  const cacheDecision = new Map();
  for (const g of run) {
    const d = cacheability(g.controls, lane);
    cacheDecision.set(g.mechanism, d);
  }

  const results = new Map(); // mechanism → { status, ms, stdout, stderr, wave, cache_key? }
  let hits = 0, stored = 0;
  for (const [wave, entries] of waves.entries()) {
    const toRun = [];
    for (const g of entries) {
      const d = cacheDecision.get(g.mechanism);
      const key = cacheEnabled && d.cacheable
        ? computeKey({ cwd, mechanism: g.mechanism, args: g.args, controls: g.controls, planHashes })
        : null;
      const hit = key ? cacheRead(cwd, key) : null;
      if (hit) {
        hits++;
        results.set(g.mechanism, { status: 'pass-cached', ms: 0, stdout: hit.stdout || '', stderr: hit.stderr || '', wave, cache_key: key });
        continue;
      }
      toRun.push({ g, key });
    }
    // eslint-disable-next-line no-await-in-loop -- waves are ordered by construction
    await runWave(toRun.map((x) => x.g), {
      jobs, timeoutMs, cwd,
      onResult: (g, r) => { results.set(g.mechanism, { ...r, wave }); },
    });
    for (const { g, key } of toRun) {
      const r = results.get(g.mechanism);
      if (key && r.status === 'pass' && cacheWrite(cwd, key, { mechanism: g.mechanism, controls: g.ids, status: 'pass', ms: r.ms, stdout: r.stdout, stderr: r.stderr, commit: head, stored_at: new Date().toISOString() })) {
        stored++;
        r.cache_key = key;
      }
    }
  }

  // Flush in CATALOG order once the pool has drained, so a parallel run's log reads like a
  // serial one's — the ordering is the runner's, not the scheduler's.
  const executed = [];
  let failed = 0;
  for (const g of run) {
    const r = results.get(g.mechanism);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 'pass' && r.status !== 'pass-cached') failed++;
    const row = { controls: g.ids, mechanism: g.mechanism, status: r.status, ms: r.ms, wave: r.wave };
    if (r.cache_key) row.cache_key = r.cache_key;
    if (r.status === 'pass-cached') row.cached_from = `${CACHE_DIR}/${r.cache_key}.json`;
    executed.push(row);
    if (emitDir) {
      const text = [r.stderr, r.stdout].filter(Boolean).join('\n').trim();
      const emitted = {
        gate: g.mechanism,
        controls: g.ids,
        result: r.status,
        findings_excerpt: text.split('\n').slice(-40).join('\n').slice(-4000),
        commit: head,
        produced_at: new Date().toISOString(),
      };
      if (r.cache_key) emitted.cache_key = r.cache_key;
      const name = g.mechanism.replace(/\.mjs$/, '').replace(/[\\/]/g, '-');
      writeFileSync(join(emitDir, `${name}.json`), JSON.stringify(emitted, null, 2) + '\n');
    }
  }
  const record = {
    lane, base: base || null, commit: head,
    changed_paths: changedPaths,
    requirements_scope: requirements.scoped ? 'diff' : 'all', // rc.34 — which changes the aggregate counted
    implicated_changes: requirements.changes.map((c) => c.change_id).sort(),
    max_implicated_tier: requirements.maxTier,
    required_families: [...requirements.families].sort(), // what the counted plans compiled
    // rc.40 — how it was executed. Recorded because a wave structure and a pool size change WHEN
    // a gate ran, and a reader of the record is entitled to know that without re-deriving it.
    concurrency: { jobs, timeout_ms: timeoutMs, waves: waves.length },
    cache: {
      enabled: cacheEnabled,
      dir: CACHE_DIR,
      hits,
      stored,
      // Nothing served from cache is silent: every mechanism NOT eligible says why, here.
      not_cacheable: run.filter((g) => !cacheDecision.get(g.mechanism).cacheable)
        .map((g) => ({ mechanism: g.mechanism, reason: cacheDecision.get(g.mechanism).reason })),
    },
    executed, skipped,
    result: failed === 0 ? 'pass' : 'fail',
    produced_at: new Date().toISOString(), // rc.35 — when this record was emitted
  };
  // 2.1.0 row 2.4 — post each result to the external record (a named no-op when unmounted).
  if (argv.includes('--record')) {
    const st = recordStatus(cwd);
    const xr = { provider: st.mounted ? st.provider : null, mounted: st.mounted, posted: [], queued: [], rejected: [], notes: [] };
    if (!st.mounted) xr.notes.push(`not mounted — ${st.reason}`);
    const signer = signerFromArgs({ issuer: arg('--record-issuer'), keyPath: arg('--record-key') });
    if (!signer) xr.notes.push('no signing material (--record-issuer/--record-key or LOOM_RECORD_ISSUER/LOOM_RECORD_KEY) — envelopes are unsigned and the provenance rules refuse them');
    const actorId = arg('--actor') || process.env.LOOM_ACTOR_ID || null;
    const actor = actorFor(cwd, actorId);
    const runner = runnerFromEnv(process.env, head);
    const trails = requirements.changes.map((c) => c.change_id).filter(Boolean).sort();
    if (!trails.length) xr.notes.push('no implicated change envelope — nothing to record against (a record binds to a change)');
    const obligations = loadObligations(cwd); // row 3.5 — which obligations each record answers
    const recDir = emitDir ? join(emitDir, 'records') : null;
    if (recDir) mkdirSync(recDir, { recursive: true });
    for (const trail of trails) {
      for (const e of executed) {
        const name = `gate.${e.mechanism.replace(/\.mjs$/, '').replace(/[\\/]/g, '-')}`;
        let envl = buildEnvelope({ kind: 'gate', name, subject: { flow: 'delivery', trail }, commit: head, actor, runner, compliant: e.status === 'pass' || e.status === 'pass-cached', controls: controlsForRecord(obligations, e.controls),
          payload: { gate: e.mechanism, result: e.status, controls: e.controls, ms: e.ms, wave: e.wave, lane, cache_key: e.cache_key ?? null } });
        if (signer) envl = signEnvelope(envl, signer);
        // eslint-disable-next-line no-await-in-loop -- one record at a time, in catalog order
        const r = await recordPost(envl, { cwd });
        const row = { trail, name, status: r.status };
        if (r.status === 'recorded') { row.id = r.id; xr.posted.push(row); }
        else if (r.status === 'queued') { row.file = r.file; xr.queued.push(row); }
        else if (r.status === 'rejected') { row.findings = r.findings; xr.rejected.push(row); }
        if (recDir) writeFileSync(join(recDir, `${trail}-${name}.json`), JSON.stringify({ ...envl, record: r }, null, 2) + '\n');
        if (r.status === 'unmounted') break;
      }
      if (!st.mounted) break;
    }
    record.external_record = xr;
  }
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
  // The run record itself is evidence: emitted beside the per-mechanism records under the name
  // the evidence collector (scripts/seal-evidence.mjs) recognises and seals into the chain.
  if (emitDir) writeFileSync(join(emitDir, 'gate-run.json'), JSON.stringify(record, null, 2) + '\n');
  process.stdout.write(`\nGate runner [${lane}] — ${record.result.toUpperCase()}: ${executed.length} mechanism(s) run, ${skipped.length} control(s) skipped (recorded${out ? ` → ${out}` : ''})\n`);
  process.stdout.write(`  · ${waves.length} wave(s), ${jobs} job(s), ${timeoutMs}ms per-gate timeout; cache ${cacheEnabled ? `on — ${hits} hit(s), ${stored} stored` : 'OFF (--no-cache)'}\n`);
  for (const e of executed) {
    if (e.status === 'pass-cached') process.stdout.write(`  · pass-cached ${e.mechanism} — key ${e.cache_key} (inputs provably identical; ${e.controls.join(', ')})\n`);
    if (e.status === 'timeout') process.stdout.write(`  · TIMEOUT ${e.mechanism} after ${e.ms}ms — recorded as a failure\n`);
  }
  for (const s of skipped) process.stdout.write(`  · skipped ${s.id} — ${s.reason}\n`);
  if (record.external_record) {
    const xr = record.external_record;
    process.stdout.write(`  · external record: ${xr.mounted ? xr.provider : 'not mounted'} — ${xr.posted.length} recorded, ${xr.queued.length} queued, ${xr.rejected.length} rejected\n`);
    for (const n of xr.notes) process.stdout.write(`      ${n}\n`);
    for (const r of xr.rejected) process.stdout.write(`      REJECTED ${r.name} (${r.trail}): ${r.findings[0]}\n`);
  }
  process.exit(failed === 0 ? 0 : 1);
}
