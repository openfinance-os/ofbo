// The identity-registry gate (Loom 2.0 §8). Approvals mean nothing if "who" is a free-text
// field. The registry — docs/governance/identities.json, CODEOWNERS-owned by a non-builder
// group — is the repo-side contract every approver/validator/classifier field resolves
// against. This gate enforces the registry's own invariants:
//
//   every identity has an id, a kind (human|agent) and known groups ·
//   AGENTS HOLD NO APPROVER ROLES (they build; they never approve) ·
//   second-line membership is DISJOINT from builders (you cannot challenge your own work).
//
// DELEGATION AND QUORUM (rc.38 · flow-plan Phase 4.5). The registry named exactly one human per
// role, so a role holder on leave stopped every change needing that role — and the pressure that
// creates is not "wait", it is "put someone else's name in the file". Two mechanisms, both
// RE-PRICING approval rather than removing it:
//
//   delegates  — an identity may name deputies: `[{to, from, until, granted_by}]`. The deputy
//                inherits the delegator's roles FOR THE WINDOW, and inherits every disjointness
//                rule with them: a deputy is still human, still never an agent, and a second-line
//                delegator may not deputise a builder. Delegation EXPIRES (the exemption idiom:
//                a grant with no end date is a permanent transfer wearing a temporary word), and
//                is granted by an independent second-line human who is neither party.
//   quorum     — `"quorum": { "<role>": K }` requires ANY K of the role's holders to approve
//                instead of the default 1. The default is 1 everywhere it is not stated, and K
//                may only be raised: a quorum is a TIGHTENING, and a `K` below 1 is refused.
//
// Neither loosens anything. Delegation moves WHO may approve, inside a window a second-line human
// signed for; quorum moves HOW MANY must.
//
// EXTERNAL IDENTITIES. The identity map (Factory Floor P6) reconciles registry identities against
// the corporate directory, and that reconciliation assumes a joiner/mover/leaver lifecycle: a
// departed human's IdP subject goes disabled and the map's observation catches it. Some approvers
// have no such lifecycle. Committee appointees — the ISSC is the case that forced this — are
// external, not employed, and typically hold no corporate IdP subject at all, so requiring one for
// every scholar approval is either unimplementable or an instruction to create employee accounts
// for non-employees. So an identity may declare:
//
//   external              — true when the identity is NOT governed by the corporate directory
//   reconciliation_source — the register that governs it instead (for scholars: the ISSC register)
//
// enforced as a PAIR in both directions. An external identity with no named register is reconciled
// by nothing; a non-external identity that names one has quietly opted out of the directory
// reconciliation, which is the hole this field would otherwise open. A still-unreplaced `ADOPT:`
// marker is not a register.
//
// THE AGENT AS AN ACTOR (2.1.0 · hardening plan row 2.1; PRD loom-kosli F3). An agent identity is
// the actor an attestation names, and "agent-loom-delivery" on its own says nothing an examiner can
// check. So an agent identity declares what it IS: `model { provider, model_id, prompt_version }`
// (pinned — a floating tag is not an identity), `harness_role` (the model-manifest role it runs as,
// cross-checked against the manifest's pins when one is mounted), and `tool_permissions[]` (what it
// may touch; an empty array means none, and the absent key means unbounded, which is a finding). A
// deterministic service identity that runs no model — the floor projector, freezer, bridge, keeper —
// says so with `runs_model: false`; silence is not that declaration. And an ACCEPTOR (the business
// signature a UAT sign-off carries) resolves through `resolveAcceptor`: a human, outside builders,
// holding a business role — the same shape as an approver, applied to acceptance.
//
// Run from the repo root: `node scripts/identity-registry-check.mjs`.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const REGISTRY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];
export const KINDS = ['human', 'agent'];
// 2.1.0 (row 2.1) — what an agent identity must declare, and what a floating pin looks like.
export const AGENT_MODEL_FIELDS = ['provider', 'model_id', 'prompt_version'];
export const FLOATING = new Set(['', 'latest', 'main', 'head', 'stable', 'edge', '*']);
// The roles that may ACCEPT on the business's behalf (UAT sign-off, hardening plan 4.1).
export const ACCEPTOR_ROLES = ['product-owner', 'business-owner'];
export const MANIFEST_LOCATIONS = ['docs/governance/model-manifest.json', 'model-manifest.json'];
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** The model manifest, when mounted — the agent identities' pins are cross-checked against it. */
export function loadModelManifest(cwd = process.cwd()) {
  const path = MANIFEST_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * 2.1.0 (row 2.1) — findings for ONE agent identity's actor declaration. `manifest` null ⇒ the pins
 * are reported NOT VERIFIED rather than assumed to match.
 */
export function agentActorFindings(i, { manifest = null, notices = null } = {}) {
  const f = [];
  if (i?.kind !== 'agent') return f;
  if (i.runs_model === false) {
    if (i.model !== undefined) f.push(`${i.id}: declares runs_model: false and carries a model block — one or the other`);
    return f;
  }
  if (i.runs_model !== undefined && i.runs_model !== true) f.push(`${i.id}: runs_model must be true or false (got ${JSON.stringify(i.runs_model)})`);
  const m = i.model;
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    f.push(`${i.id}: an agent identity carries no model block { ${AGENT_MODEL_FIELDS.join(', ')} } — an agent that runs a model IS a model (HG-0006), and one that runs none says runs_model: false`);
  } else {
    for (const k of AGENT_MODEL_FIELDS) {
      if (!nonEmpty(m[k])) f.push(`${i.id}: model.${k} is missing`);
      else if (k !== 'provider' && FLOATING.has(m[k].trim().toLowerCase())) f.push(`${i.id}: model.${k} ${JSON.stringify(m[k])} is a floating tag, not a pin — an actor whose model can move under it is not an identity`);
    }
  }
  if (!nonEmpty(i.harness_role)) f.push(`${i.id}: no harness_role — say which model-manifest role this agent runs as`);
  if (!Array.isArray(i.tool_permissions)) f.push(`${i.id}: tool_permissions must be an array (empty means none) — an agent whose tools are undeclared is unbounded`);
  else for (const t of i.tool_permissions) if (!nonEmpty(t)) f.push(`${i.id}: tool_permissions carries a non-string entry`);
  if (m && typeof m === 'object' && nonEmpty(i.harness_role)) {
    if (!manifest) notices?.push(`${i.id}: model pins NOT VERIFIED against the model manifest — none mounted here`);
    else {
      const role = (manifest.models || []).find((r) => r?.role === i.harness_role);
      if (!role) f.push(`${i.id}: harness_role ${JSON.stringify(i.harness_role)} is not a role in the model manifest — an actor running as an uninventoried role`);
      else {
        if (nonEmpty(m.model_id) && role.model_id !== m.model_id) f.push(`${i.id}: model.model_id ${m.model_id} is not the manifest's pin for ${i.harness_role} (${role.model_id}) — the registry and the inventory disagree about what this agent runs`);
        if (nonEmpty(m.prompt_version) && role.prompt_version !== m.prompt_version) f.push(`${i.id}: model.prompt_version ${m.prompt_version} is not the manifest's pin for ${i.harness_role} (${role.prompt_version})`);
      }
    }
  }
  return f;
}

/**
 * 2.1.0 — an ACCEPTOR resolves like an approver: a registered HUMAN, outside the builders group,
 * holding a business role. Findings ([] ⇒ this identity may accept on the business's behalf).
 */
export function resolveAcceptor(registry, id, label) {
  if (!nonEmpty(id)) return [`${label}: no identity given — an acceptance names who accepted`];
  const who = identityOf(registry, id);
  if (!who) return [`${label}: identity ${JSON.stringify(id)} is not in the identity registry`];
  const f = [];
  if (who.kind === 'agent') f.push(`${label}: ${id} is an AGENT — agents prepare evidence, they never accept`);
  if ((who.groups || []).includes('builders')) f.push(`${label}: ${id} is in the builders group — the business accepts the work, the builders do not accept their own`);
  if (!(who.roles || []).some((r) => ACCEPTOR_ROLES.includes(r))) f.push(`${label}: ${id} holds none of the business roles (${ACCEPTOR_ROLES.join(', ')})`);
  return f;
}
export const DELEGATION_FIELDS = ['to', 'from', 'until', 'granted_by'];

/** An unreplaced adoption marker. A template value is not a register, a name, or a reference. */
export const isPlaceholder = (v) => typeof v === 'string' && /ADOPT[:-]/.test(v);

/** Load the registry from disk, or null. */
export function loadRegistry(cwd = process.cwd()) {
  const path = REGISTRY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The registry entry for an id, or undefined. */
export const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);

const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

/**
 * The delegation, if any, by which `id` holds `role` at `now`. Returns
 * `{ from: <delegator id>, until }` or null.
 *
 * A delegation only ever transfers what the DELEGATOR actually holds, so a deputy can never end
 * up with a role nobody granted. The window is closed at both ends and both ends must parse: a
 * malformed window is NOT a delegation (fail closed), never an open-ended one.
 */
export function delegationFor(registry, id, role, now = Date.now()) {
  for (const d of registry?.identities || []) {
    if (!(d.roles || []).includes(role)) continue;      // cannot delegate what you do not hold
    if (d.kind !== 'human') continue;                    // and an agent holds nothing to delegate
    for (const g of d.delegates || []) {
      if (g?.to !== id) continue;
      const from = parseTime(g.from);
      const until = parseTime(g.until);
      if (from === null || until === null) continue;     // unparseable window ⇒ no delegation
      if (now < from || now > until) continue;           // lapsed or not yet live
      return { from: d.id, until: g.until, granted_by: g.granted_by };
    }
  }
  return null;
}

/** How many distinct holders of `role` must approve. Default 1; a quorum may only raise it. */
export function quorumFor(registry, role) {
  const k = registry?.quorum?.[role];
  return Number.isInteger(k) && k > 1 ? k : 1;
}

/**
 * Resolve an approval-ish reference: the id must exist, be HUMAN, and hold the role.
 * Returns findings ([] ⇒ resolves cleanly). `label` names the field for the message.
 *
 * rc.38: the role may be held BY DELEGATION (Phase 4.5). The deputy is still resolved, still
 * human, still never an agent — the delegation only supplies the role, and only inside the window
 * a second-line human granted. Every acceptance is pushed to `opts.notices` when one is supplied:
 * an approval given by a deputy must never be indistinguishable from one given by the holder.
 */
export function resolveApprover(registry, id, role, label, opts = {}) {
  if (!(typeof id === 'string' && id.trim())) return [`${label}: no identity given — a role name or free text is not an approver`];
  const who = identityOf(registry, id);
  if (!who) return [`${label}: identity ${JSON.stringify(id)} is not in the registry — unresolvable approvals do not count`];
  const findings = [];
  if (who.kind === 'agent') findings.push(`${label}: ${id} is an AGENT — agents prepare evidence, they never approve`);
  if (role && !(who.roles || []).includes(role)) {
    const via = who.kind === 'agent' ? null : delegationFor(registry, id, role, opts.now ?? Date.now());
    if (via) {
      opts.notices?.push(`${label}: ${id} holds ${role} BY DELEGATION from ${via.from} until ${via.until} (granted by ${via.granted_by}) — a deputy approval, recorded as one`);
    } else {
      findings.push(`${label}: ${id} does not hold the required role ${role}`);
    }
  }
  return findings;
}

/**
 * Registry-invariant findings. Empty ⇒ the registry is internally sound.
 * `notices` (optional) collects lapsed delegations — inert, so not a failure, but a delegation
 * nobody removed is a grant nobody is tracking, and silence about it is how one comes back to life.
 */
export function evaluate(registry, { notices = null, now = Date.now(), manifest = null } = {}) {
  const findings = [];
  const ids = new Set();
  const identities = registry?.identities;
  if (!Array.isArray(identities) || identities.length === 0) {
    return ['registry has no identities — approvals cannot resolve (Loom 2.0 §8)'];
  }
  const knownGroups = new Set(Object.keys(registry.groups || {}));
  for (const i of identities) {
    if (!i.id) { findings.push('an identity has no id'); continue; }
    if (ids.has(i.id)) findings.push(`${i.id}: duplicate identity id`);
    ids.add(i.id);
    if (!KINDS.includes(i.kind)) findings.push(`${i.id}: kind must be human|agent (got ${JSON.stringify(i.kind)})`);
    for (const g of i.groups || []) if (!knownGroups.has(g)) findings.push(`${i.id}: unknown group ${g}`);
    if (i.kind === 'agent' && (i.roles || []).length > 0) {
      findings.push(`${i.id}: an agent identity holds approver roles (${i.roles.join(', ')}) — agents build, they never approve`);
    }
    findings.push(...agentActorFindings(i, { manifest, notices }));
    const groups = new Set(i.groups || []);
    if (groups.has('second-line') && groups.has('builders')) {
      findings.push(`${i.id}: is in BOTH builders and second-line — independence requires disjoint membership`);
    }
    findings.push(...externalFindings(i));
  }
  findings.push(...evaluateDelegations(registry, { notices, now }));
  findings.push(...evaluateQuorum(registry));
  return findings;
}

/**
 * The `external` / `reconciliation_source` pair for ONE identity. Both directions are findings,
 * because the failure modes are opposite and both are silent:
 *
 *   external with no register  — nothing reconciles this identity at all. The identity-map's
 *                                joiner/mover/leaver observation does not cover it (that is why it
 *                                is flagged external), so an unnamed register means a resigned
 *                                committee member keeps approving until someone remembers.
 *   register with no external  — an employee reconciled against an ad-hoc list has stepped OUT of
 *                                the directory reconciliation without saying so. The field would
 *                                become the way to make any identity unreconcilable.
 *
 * The gate checks the declaration, never the register's contents: whether the named register
 * actually lists this person, and whether their appointment still stands, is read by the register's
 * own gate. Here, `uncovered` is the honest word for everything beyond the pairing.
 */
export function externalFindings(i) {
  const findings = [];
  const src = i.reconciliation_source;
  if (i.external !== undefined && typeof i.external !== 'boolean') {
    findings.push(`${i.id}: external must be true or false (got ${JSON.stringify(i.external)}) — a truthy string is not a declaration`);
  }
  if (i.external === true) {
    if (!(typeof src === 'string' && src.trim())) {
      findings.push(`${i.id}: external identities must name a reconciliation_source — the register that governs them. An external appointee has no joiner/mover/leaver record in the corporate directory, so with no register named, nothing reconciles them at all`);
    } else if (isPlaceholder(src)) {
      findings.push(`${i.id}: reconciliation_source is still an adoption marker (${JSON.stringify(src)}) — an unreplaced placeholder is not a register`);
    }
  } else if (src !== undefined) {
    findings.push(`${i.id}: names a reconciliation_source but is not external:true — an identity inside the corporate directory is reconciled against it, and reconciling one against an ad-hoc register instead is a hole, not an exemption`);
  }
  return findings;
}

/**
 * rc.38 (flow-plan Phase 4.5) — the delegation blocks. A delegate inherits the role AND every
 * rule attached to it, so this is where those rules are asserted at registration time rather than
 * discovered at approval time.
 */
export function evaluateDelegations(registry, { notices = null, now = Date.now() } = {}) {
  const findings = [];
  for (const i of registry?.identities || []) {
    const delegates = i.delegates;
    if (delegates === undefined || delegates === null) continue;
    const label = `${i.id}: delegation`;
    if (!Array.isArray(delegates)) { findings.push(`${label} — delegates must be an ARRAY of {${DELEGATION_FIELDS.join(', ')}}`); continue; }
    if (delegates.length && (i.roles || []).length === 0) {
      findings.push(`${label} — ${i.id} holds no roles, so there is nothing to delegate; a deputy for nobody is a name with unexplained standing`);
    }
    if (delegates.length && i.kind !== 'human') {
      findings.push(`${label} — an ${i.kind} identity cannot delegate approval authority it may never hold`);
    }
    for (const g of delegates) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) { findings.push(`${label} — each entry must be an object {${DELEGATION_FIELDS.join(', ')}}`); continue; }
      const who = `${label} to ${JSON.stringify(g.to)}`;
      for (const f of DELEGATION_FIELDS) {
        if (!(typeof g[f] === 'string' && g[f].trim())) findings.push(`${who} — missing ${f}${f === 'until' ? ' (a delegation with no end date is a permanent transfer of authority wearing a temporary word)' : ''}`);
      }
      const to = identityOf(registry, g.to);
      const grantor = identityOf(registry, g.granted_by);
      if (g.to && !to) findings.push(`${who} — the deputy is not in the registry; an unresolvable deputy cannot inherit anything`);
      if (to && to.kind !== 'human') findings.push(`${who} — the deputy is an ${to.kind}; agents build, they never approve, and delegation does not change that`);
      if (g.to === i.id) findings.push(`${who} — an identity cannot deputise itself`);
      // The deputy inherits the delegator's independence. A second-line holder deputising a
      // builder would hand the challenge function to the people being challenged — the exact
      // disjointness the registry asserts for direct membership, asserted for the inherited case.
      if (to && (i.groups || []).includes('second-line') && (to.groups || []).includes('builders')) {
        findings.push(`${who} — a second-line identity cannot deputise a BUILDER: a delegate inherits the independence the role requires, not just its name`);
      }
      // Independent grant, same idiom as an exemption: neither party may authorise the transfer.
      if (g.granted_by && !grantor) findings.push(`${who} — granted_by ${JSON.stringify(g.granted_by)} is not in the registry`);
      else if (grantor && !(grantor.groups || []).includes('second-line')) {
        findings.push(`${who} — granted_by ${g.granted_by} is not a second-line identity; delegating approval authority needs independent approval`);
      }
      if (g.granted_by && (g.granted_by === i.id || g.granted_by === g.to)) {
        findings.push(`${who} — granted_by ${g.granted_by} is a party to the delegation; neither the delegator nor the deputy may authorise it`);
      }
      const from = parseTime(g.from);
      const until = parseTime(g.until);
      if (g.from !== undefined && typeof g.from === 'string' && from === null) findings.push(`${who} — from ${JSON.stringify(g.from)} is not a parseable ISO-8601 timestamp`);
      if (g.until !== undefined && typeof g.until === 'string' && until === null) findings.push(`${who} — until ${JSON.stringify(g.until)} is not a parseable ISO-8601 timestamp`);
      if (from !== null && until !== null && until <= from) findings.push(`${who} — until ${g.until} does not follow from ${g.from}; the window is empty`);
      if (until !== null && until < now) {
        notices?.push(`${i.id} → ${g.to}: the delegation of ${(i.roles || []).join(', ')} LAPSED at ${g.until} and is no longer honoured. Remove it or renew it with a fresh second-line grant`);
      }
    }
  }
  return findings;
}

/**
 * rc.38 — `quorum: { role: K }`. A quorum can only ever demand MORE signatures, and it must be
 * satisfiable: a K larger than the number of humans holding the role is a rule that blocks every
 * change forever, which reads as rigour and functions as an outage.
 */
export function evaluateQuorum(registry) {
  const findings = [];
  const quorum = registry?.quorum;
  if (quorum === undefined || quorum === null) return findings;
  if (typeof quorum !== 'object' || Array.isArray(quorum)) return ['quorum must be an object mapping role → K'];
  for (const [role, k] of Object.entries(quorum)) {
    if (!Number.isInteger(k) || k < 1) {
      findings.push(`quorum for ${role} must be an integer ≥ 1 (got ${JSON.stringify(k)}) — a quorum may only ever raise the number of approvals, never lower it`);
      continue;
    }
    const holders = (registry.identities || []).filter((i) => i.kind === 'human' && (i.roles || []).includes(role));
    if (k > holders.length) {
      findings.push(`quorum for ${role} is ${k} but only ${holders.length} human identit${holders.length === 1 ? 'y holds' : 'ies hold'} it — an unsatisfiable quorum blocks every change that needs the role`);
    }
  }
  return findings;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registry = loadRegistry();
  const notices = [];
  const findings = registry ? evaluate(registry, { notices, manifest: loadModelManifest() })
    : [`no identity registry found (looked in ${REGISTRY_LOCATIONS.join(', ')}) — approvals cannot resolve`];
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nIdentity-registry gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nApprovals resolve against the registry: agents never approve, and second line is\ndisjoint from builders. See governance/identities.template.json.\n');
    process.exit(1);
  }
  process.stdout.write('Identity-registry gate — OK\n');
}
