// HG-0013 — the routine-change lane. The Loom's dark boundary is the PR: the loop runs
// autonomous up to proposal, and a human disposes. That rule is deliberately absolute for
// changes that matter — but applying it identically to a lint fix and an auth rewrite taxes
// the one resource that does not scale (the reviewer) on changes no one needs to read.
//
// This gate is the sanctioned, narrow relaxation. A second-line owner authorizes a small
// CLASS of low-risk changes to auto-merge without per-change human review, for a BOUNDED
// time, via a standing `routine-envelope.json`. A routine change then INHERITS that envelope
// (the deck's capability model: validate the capability once, let conforming use-cases inherit
// approval) instead of being individually classified. Human approval moves from per-change to
// per-envelope; it never disappears. Anything outside the envelope RE-EVALUATES to the normal
// human-merge lane — that is a fallback, not a failure.
//
// Three properties make this safe to run unattended:
//   1. The envelope is second-line-OWNED and EXPIRING — the agent uses it, never edits it
//      (routine-envelope.json is a CONTROL_TARGET; the owner resolves to a human in the
//      second-line group, disjoint from builders per the identity gate).
//   2. A FLOOR denylist in THIS file is absolute — no envelope, however misconfigured, can
//      authorize a change that touches the control plane, the API contract, auth, or
//      migrations. The floor is code, not configuration.
//      rc.46 (Shari'ah workstream): the floor also has to cover the surfaces where a product's
//      ECONOMIC SUBSTANCE is decided. No envelope, however configured by its second-line owner,
//      may auto-merge a change to profit-rate configuration, product-structure definition, or a
//      Shari'ah rulings root. The defect this prevents is quiet: a rate table or an ownership-
//      sequencing constant is a one-line diff, it looks exactly like the routine work the lane
//      exists for, and it is where a structure that scholars approved silently becomes riba.
//      The rulings register is already floored for free (docs/governance/), but an adopter's
//      APPLICATION pricing and product-structure code is not — hence the ADOPT line below.
//   3. The lane is CLAIMED, not defaulted. Absent a claim, every PR takes the normal lane.
//      A claim that does not fit the envelope in EVERY respect fails the gate, so a claim can
//      only ever narrow scrutiny to exactly what the second line pre-authorized.
//   4. (2.1.0) The claim is not evidence. Two fields used to be read from it and are not any
//      more: `gates_green` now comes from the gate runner's own records (`gate-run-*.json`, at
//      THIS commit), and `class` is VERIFIED against the diff's content, not just its paths — a
//      `dependency-patch` that introduces a new package name, or bumps a major, is not a patch;
//      a `doc-fix` that touches a source file is not a doc fix; a `formatting` change must
//      leave every non-whitespace character where it was. Before this, a typosquat swap inside
//      the diff cap, under `package-lock.json`, with `gates_green` typed into the claim, would
//      auto-merge.
//
// Enforcement of record: a merge-queue/branch ruleset that auto-merges a PR only when this
// gate is among the passing required checks. As shipped this gate is mechanically-validated;
// platform-enforced is the adopter's (activation-runbook + a negative bypass probe).
//
// Run from the repo root: `node scripts/routine-change-check.mjs [--base <ref>] [--gate-records a.json,b.json]`
// (default: every gate-run-*.json in the working directory).
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { pathToFileURL } from 'node:url';

export const ENVELOPE_PATH = 'docs/governance/routine-envelope.json';
export const CLAIM_PATH = 'docs/governance/routine-claim.json';

// The known routine classes. An envelope may allow a SUBSET of these; it can never invent a
// class outside the set, and a claim must name one the envelope allows.
export const ROUTINE_CLASSES = ['dependency-patch', 'lint-fix', 'doc-fix', 'formatting', 'comment-fix'];

// The absolute floor: paths no routine envelope can ever reach, whatever it declares. This is
// the control plane and the other high-blast-radius surfaces — a change touching any of them
// is not routine BY CONSTRUCTION. ADOPT: append your auth and migration roots, and — if this
// repo builds financial products — your profit-rate / pricing configuration root, your
// product-structure definition root, and any Shari'ah rulings root outside docs/governance/;
// never remove a control-plane entry.
export const FLOOR_DENY = [
  '.github/', 'scripts/', 'core/', 'profiles/', 'discovery/gates/',
  'docs/governance/', 'CODEOWNERS', '.claude/hooks/', '.claude/settings.json',
  'institution/', // rc.8: the Institutional BrainKit is never a routine change
  'specs/', 'spec/', // the API contract
  'migrations/', 'auth/', // ADOPT: your auth + schema-migration roots
];

/** Match one path against one pattern: `*.ext`, a `dir/` prefix, or an exact/dir path. */
export function pathMatch(pattern, path) {
  if (pattern.startsWith('*.')) return path.endsWith(pattern.slice(1));
  const p = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  if (p.endsWith('/')) return path === p.slice(0, -1) || path.startsWith(p);
  return path === p || path.startsWith(p + '/');
}
const matchesAny = (patterns, path) => (patterns || []).some((p) => pathMatch(p, path));

/**
 * Pure lane logic. `envelope` is the standing authorization; `claim` is what this PR asserts
 * ({ envelope, class, changed_paths, diff_lines, gates_green }); `registry` resolves the
 * owner; `asOf` is the date the expiry is judged against. Returns findings — [] means the
 * change qualifies for auto-merge; anything else routes it to the normal human-merge lane.
 */
export function evaluate(envelope, claim, registry, asOf) {
  const findings = [];
  if (!envelope) return ['no routine-envelope.json — there is no standing authorization; take the normal lane'];
  const eid = envelope.envelope_id || '(no id)';

  // rc.12 WS2.4: a suspended envelope authorizes nothing. Config-reconciliation (or a human) sets
  // `suspended: true` when the control plane has drifted; the routine lane fails closed until it is
  // restored, so auto-merge cannot ride a weakened platform.
  if (envelope.suspended === true) return [`${eid}: routine lane is SUSPENDED (control-plane drift or manual hold) — every change takes the normal human-review lane until suspension is lifted`];

  // The owner is a human in the second line — never an agent, never a builder.
  const owner = envelope.owner;
  if (!owner) findings.push(`${eid}: envelope has no owner — a routine envelope must be owned by a named second-line human`);
  else if (!registry) findings.push(`${eid}: no identity registry — the owner ${owner} cannot be resolved`);
  else {
    const who = identityOf(registry, owner);
    if (!who) findings.push(`${eid}: owner ${owner} is not in the identity registry`);
    else {
      if (who.kind !== 'human') findings.push(`${eid}: owner ${owner} is not a human — an agent cannot own the routine lane`);
      if (!(who.groups || []).includes('second-line')) findings.push(`${eid}: owner ${owner} is not in the second-line group — the lane must be second-line-owned`);
    }
  }

  // The envelope expires. A stale authorization is no authorization. An unparseable expiry
  // must FAIL, not silently never-expire (`new Date('not-a-date')` is NaN, and every NaN
  // comparison is false — the "bounded in time" property would evaporate without this).
  if (!envelope.expires) findings.push(`${eid}: envelope has no expiry — a routine authorization must be bounded in time`);
  else if (Number.isNaN(new Date(envelope.expires).getTime())) findings.push(`${eid}: envelope expiry ${JSON.stringify(envelope.expires)} is not a valid date — cannot confirm the authorization is in force`);
  else if (asOf && new Date(asOf) > new Date(envelope.expires)) findings.push(`${eid}: envelope expired ${envelope.expires} — re-authorize with the second line`);

  // The claim names a class the envelope allows (and that is a known routine class).
  const cls = claim?.class;
  if (!cls) findings.push(`${eid}: claim names no class`);
  else {
    if (!ROUTINE_CLASSES.includes(cls)) findings.push(`${eid}: class ${JSON.stringify(cls)} is not a routine class (${ROUTINE_CLASSES.join(', ')})`);
    if (!(envelope.allowed_classes || []).includes(cls)) findings.push(`${eid}: class ${cls} is not allowed by this envelope (${(envelope.allowed_classes || []).join(', ') || 'none'})`);
  }

  // Every changed path clears the floor, is inside the allowlist, and outside the denylist.
  const paths = claim?.changed_paths || [];
  if (paths.length === 0) findings.push(`${eid}: claim lists no changed paths — cannot verify the diff is in scope`);
  for (const path of paths) {
    if (matchesAny(FLOOR_DENY, path)) findings.push(`${eid}: ${path} is under the absolute floor (control plane / contract / auth / migrations) — never routine`);
    else if (!matchesAny(envelope.path_allow, path)) findings.push(`${eid}: ${path} is outside the envelope's path_allow`);
    else if (matchesAny(envelope.path_deny, path)) findings.push(`${eid}: ${path} is under the envelope's path_deny`);
  }

  // The diff is small, and every gate the envelope requires is green.
  const max = envelope.max_diff_lines;
  if (typeof max === 'number' && typeof claim?.diff_lines === 'number' && claim.diff_lines > max) {
    findings.push(`${eid}: diff is ${claim.diff_lines} lines, over the envelope cap of ${max}`);
  }
  // 2.1.0: the runner's records are the evidence; `claim.gates_green` is ignored. check() places the
  // record-derived set on the claim as `_green_recorded` (a Set); a test double may do the same.
  // A claim with no records at all has nothing green, whatever it typed.
  const green = claim?._green_recorded instanceof Set ? claim._green_recorded : new Set();
  for (const g of envelope.required_green_gates || []) {
    if (!green.has(String(g).toLowerCase())) findings.push(`${eid}: required gate ${g} is not recorded green by the gate runner at this commit (the claim's own gates_green is not evidence — pass the runner's gate-run-*.json)`);
  }
  // The class is verified against content, not asserted.
  if (cls && ROUTINE_CLASSES.includes(cls) && Array.isArray(claim?._files)) findings.push(...verifyClass(cls, claim._files).map((f) => `${eid}: ${f}`));
  return findings;
}

// ── 2.1.0 — the claim is not evidence ────────────────────────────────────────────────────────

/** Manifest and lockfile shapes a dependency-patch may touch, with a package-name extractor each. */
export const DEPENDENCY_FILES = [
  { re: /(^|\/)package\.json$/, names: (t) => { try { const j = JSON.parse(t); return new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((k) => Object.keys(j[k] || {}))); } catch { return null; } } },
  { re: /(^|\/)package-lock\.json$/, names: (t) => { try { const j = JSON.parse(t); const out = new Set(); for (const k of Object.keys(j.packages || {})) { const m = k.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/); if (m) out.add(m[1]); } for (const k of Object.keys(j.dependencies || {})) out.add(k); return out; } catch { return null; } } },
  { re: /(^|\/)pnpm-lock\.ya?ml$/, names: (t) => new Set([...t.matchAll(/^ {2}['"]?\/?((?:@[^/@'"\s]+\/)?[^/@'"\s]+)[@/]\d/gm)].map((m) => m[1])) },
  { re: /(^|\/)yarn\.lock$/, names: (t) => new Set([...t.matchAll(/^"?((?:@[^@"\s]+\/)?[^@"\s]+)@/gm)].map((m) => m[1])) },
  { re: /(^|\/)requirements[^/]*\.txt$/, names: (t) => new Set([...t.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*(?:[=<>!~]=|@|$)/gm)].map((m) => m[1].toLowerCase())) },
  { re: /(^|\/)(poetry|uv)\.lock$/, names: (t) => new Set([...t.matchAll(/^name\s*=\s*"([^"]+)"/gm)].map((m) => m[1].toLowerCase())) },
  { re: /(^|\/)pyproject\.toml$/, names: (t) => new Set([...t.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*(?:[=<>!~]=|>=|\[|$)/gm)].map((m) => m[1].toLowerCase())) },
  { re: /(^|\/)go\.(mod|sum)$/, names: (t) => new Set([...t.matchAll(/^\s*(\S+\.\S+\/\S+)\s+v/gm)].map((m) => m[1])) },
  { re: /(^|\/)Cargo\.(toml|lock)$/, names: (t) => new Set([...t.matchAll(/^name\s*=\s*"([^"]+)"|^([A-Za-z0-9_-]+)\s*=\s*["{]/gm)].map((m) => m[1] || m[2])) },
  { re: /(^|\/)Gemfile(\.lock)?$/, names: (t) => new Set([...t.matchAll(/^\s{4}([A-Za-z0-9_-]+) \(|^\s*gem ['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2])) },
];
const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc)$|(^|\/)docs?\//i;
const COMMENT_LINE = /^\s*(\/\/|#(?!!)|\*|\/\*|\*\/|<!--|-->|--\s|;|%|'|rem\s)/i;
const IMPORT = /\bimport\s[^'"]*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]|^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))|^\s*use\s+([A-Za-z_][\w:]*)/;
const majorOf = (spec) => { const m = String(spec || '').match(/(\d+)/); return m ? m[1] : null; };

/**
 * Does the diff's CONTENT fit the claimed class? `files` is [{ path, added, removed, base, head }]
 * (line arrays and full before/after text; base/head null when the file is absent on that side).
 * Findings, [] ⇒ the content is what the class says it is. Path allow/deny/floor are checked
 * separately in evaluate(); this is the question the envelope's class pre-authorized an answer to.
 */
export function verifyClass(cls, files) {
  const findings = [];
  const nonBlank = (lines) => (lines || []).filter((l) => l.trim());
  switch (cls) {
    case 'doc-fix':
      for (const f of files) if (!DOC_FILE.test(f.path)) findings.push(`class doc-fix: ${f.path} is not a documentation file`);
      break;
    case 'comment-fix':
      for (const f of files) {
        if (DOC_FILE.test(f.path)) continue;
        for (const l of [...nonBlank(f.added), ...nonBlank(f.removed)]) {
          if (!COMMENT_LINE.test(l)) { findings.push(`class comment-fix: ${f.path} changes a non-comment line: ${JSON.stringify(l.trim().slice(0, 60))}`); break; }
        }
      }
      break;
    case 'formatting':
      for (const f of files) {
        if (f.base === null || f.head === null) { findings.push(`class formatting: ${f.path} was ${f.base === null ? 'added' : 'deleted'} — formatting changes no file's existence`); continue; }
        if (f.base.replace(/\s+/g, '') !== f.head.replace(/\s+/g, '')) findings.push(`class formatting: ${f.path} changes something other than whitespace`);
      }
      break;
    case 'lint-fix':
      for (const f of files) {
        if (f.base === null) { findings.push(`class lint-fix: ${f.path} is a new file — a lint fix edits, it does not create`); continue; }
        if (DEPENDENCY_FILES.some((d) => d.re.test(f.path))) { findings.push(`class lint-fix: ${f.path} is a dependency manifest — not a lint fix`); continue; }
        const before = new Set([...(f.base || '').split('\n')].map((l) => l.match(IMPORT)).filter(Boolean).map((m) => m.slice(1).find(Boolean)));
        for (const l of nonBlank(f.added)) {
          const m = l.match(IMPORT);
          const mod = m && m.slice(1).find(Boolean);
          if (mod && !before.has(mod)) findings.push(`class lint-fix: ${f.path} imports ${mod}, which the file did not import before — a new dependency is not a lint fix`);
        }
      }
      break;
    case 'dependency-patch':
      for (const f of files) {
        const kind = DEPENDENCY_FILES.find((d) => d.re.test(f.path));
        if (!kind) { findings.push(`class dependency-patch: ${f.path} is not a dependency manifest or lockfile`); continue; }
        if (f.base === null) { findings.push(`class dependency-patch: ${f.path} is a new file — a patch updates a manifest, it does not add one`); continue; }
        const before = kind.names(f.base), after = kind.names(f.head ?? '');
        if (!before || !after) { findings.push(`class dependency-patch: ${f.path} could not be parsed on both sides — unverifiable is not a patch`); continue; }
        const added = [...after].filter((n) => !before.has(n));
        if (added.length) findings.push(`class dependency-patch: ${f.path} introduces ${added.length} package(s) not present before (${added.slice(0, 5).join(', ')}) — a new dependency is a change, not a patch`);
        if (/(^|\/)package\.json$/.test(f.path)) {
          try {
            const b = JSON.parse(f.base), h = JSON.parse(f.head ?? '{}');
            for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
              for (const [name, spec] of Object.entries(h[k] || {})) {
                const was = (b[k] || {})[name];
                if (was !== undefined && majorOf(was) !== null && majorOf(spec) !== majorOf(was)) findings.push(`class dependency-patch: ${f.path} moves ${name} across a major (${was} → ${spec}) — a major bump is not a patch`);
              }
            }
          } catch { /* the name check above already reported an unparseable side */ }
        }
      }
      break;
    default:
      break; // an unknown class is already a finding in evaluate()
  }
  return findings;
}

/**
 * Which gate ids the gate runner recorded green AT THIS COMMIT. `records` are parsed
 * gate-run-*.json documents (core/gate-runner.mjs `--out`, or any tool writing the same shape:
 * `{ commit, executed: [{ controls, status }] }`). A record for another commit is not evidence for
 * this one, and only `pass` / `pass-cached` count. Ids compare case-insensitively (Q1b ≡ Q1B).
 */
export function gatesGreenFromRecords(records, head) {
  const green = new Set();
  for (const r of records || []) {
    if (!r || (head && r.commit && r.commit !== head)) continue;
    for (const row of r.executed || []) {
      if (row.status === 'pass' || row.status === 'pass-cached') for (const id of row.controls || []) green.add(String(id).toLowerCase());
    }
  }
  return green;
}

/** Read every gate-run record named (paths, or a directory scanned for gate-run-*.json). */
export function loadGateRecords(cwd, spec) {
  const out = [];
  const names = spec ? String(spec).split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (!names.length) {
    try { for (const n of readdirSync(cwd)) if (/^gate-run-.*\.json$/.test(n)) names.push(n); } catch { /* no dir */ }
  }
  for (const n of names) {
    try { out.push(JSON.parse(readFileSync(`${cwd}/${n}`, 'utf8'))); } catch { /* unreadable → not evidence */ }
  }
  return out;
}

/** Derive the real changed paths + line count from git, so the lane is judged on the actual
 *  diff, not on what the claim asserts. Returns null if git is unavailable — the caller MUST
 *  treat that as fatal (see check()), never as a fallback to the claim's self-declared paths.
 *  `--no-renames` is essential: with rename detection on, git emits `{src => scripts}/x.mjs`,
 *  a form the FLOOR_DENY patterns do not match, so a rename INTO the control plane would slip. */
export function gitDiff(base) {
  try {
    const out = execSync(`git diff --numstat --no-renames ${base}...HEAD`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const changed_paths = [];
    let diff_lines = 0;
    for (const line of out.split('\n')) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      changed_paths.push(m[3]);
      diff_lines += (m[1] === '-' ? 0 : Number(m[1])) + (m[2] === '-' ? 0 : Number(m[2]));
    }
    return { changed_paths, diff_lines };
  } catch { return null; }
}

/** Per-file added/removed lines plus full before/after text, from git. null if git is unavailable. */
export function gitDiffDetail(base, paths) {
  try {
    const files = [];
    for (const path of paths) {
      const show = (ref) => { try { return execSync(`git show ${ref}:${JSON.stringify(path)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } };
      const patch = execSync(`git diff --no-renames -U0 ${base}...HEAD -- ${JSON.stringify(path)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      const added = [], removed = [];
      for (const line of patch.split('\n')) {
        if (/^\+\+\+ |^--- /.test(line)) continue;
        if (line.startsWith('+')) added.push(line.slice(1));
        else if (line.startsWith('-')) removed.push(line.slice(1));
      }
      files.push({ path, added, removed, base: show(base), head: show('HEAD') });
    }
    return files;
  } catch { return null; }
}

export function check(cwd = process.cwd(), base = 'origin/main', { gateRecords } = {}) {
  if (!existsSync(`${cwd}/${CLAIM_PATH}`)) return { claimed: false, findings: [] };
  const claim = JSON.parse(readFileSync(`${cwd}/${CLAIM_PATH}`, 'utf8'));
  const envelope = existsSync(`${cwd}/${ENVELOPE_PATH}`) ? JSON.parse(readFileSync(`${cwd}/${ENVELOPE_PATH}`, 'utf8')) : null;
  const registry = loadRegistry(cwd);
  // Judge the lane on the REAL git diff, never on the claim's self-declared paths. If git
  // cannot produce the diff (missing base ref, shallow clone, detached worktree), that is
  // fatal for a control whose whole point is "judged on the actual diff" — fail to the normal
  // human-merge lane rather than trusting what the PR author wrote.
  const real = gitDiff(base);
  if (!real) {
    return { claimed: true, findings: [`cannot compute the git diff against ${base} — the routine lane must be judged on the actual diff, not the claim; take the normal human-merge lane`] };
  }
  claim.changed_paths = real.changed_paths;
  claim.diff_lines = real.diff_lines;
  // 2.1.0: content, not assertion. The diff detail feeds verifyClass; the runner's records feed
  // the required-gates check. Neither can be typed into the claim.
  const detail = gitDiffDetail(base, real.changed_paths);
  if (!detail) return { claimed: true, findings: [`cannot read the diff content against ${base} — the class cannot be verified; take the normal human-merge lane`] };
  claim._files = detail;
  let head = null;
  try { head = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* recorded below as no evidence */ }
  claim._green_recorded = gatesGreenFromRecords(loadGateRecords(cwd, gateRecords), head);
  return { claimed: true, findings: evaluate(envelope, claim, registry, new Date()) };
}

// CLI (skipped when imported by the test suite).
//
// Two modes — the split that makes the lane platform-legible (W2, closes F2):
//   default          the normal-lane check: an unqualified CLAIM fails; no claim / ordinary
//                    work passes. This is the required `normal-human-review` status.
//   --assert-routine the routine-qualified check: exits 0 ONLY for a genuinely qualifying
//                    claim; a missing claim or a non-fit both exit non-zero. This is the
//                    separate `routine-qualified` status a merge queue keys auto-merge on.
// A GitHub ruleset cannot read explanatory text — only the exit of a named check — so the two
// outcomes MUST live in two check contexts. Auto-merge requires `routine-qualified`; that an
// ordinary PR fails `--assert-routine` is exactly why it cannot enter the routine queue.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseArg = process.argv.indexOf('--base');
  const base = baseArg >= 0 ? process.argv[baseArg + 1] : 'origin/main';
  const assertRoutine = process.argv.includes('--assert-routine');
  const recArg = process.argv.indexOf('--gate-records');
  const gateRecords = recArg >= 0 ? process.argv[recArg + 1] : undefined;
  const { claimed, findings } = check(process.cwd(), base, { gateRecords });

  if (assertRoutine) {
    // routine-qualified: pass ONLY for a qualifying claim.
    if (!claimed) {
      process.stderr.write('Routine-qualified check — no routine claim: this PR is NOT routine-qualified (it takes the normal human-merge lane). FAIL\n');
      process.exit(1);
    }
    if (findings.length) {
      process.stderr.write('\nRoutine-qualified check — a routine claim that DOES NOT QUALIFY\n\n');
      for (const f of findings) process.stderr.write(`  - ${f}\n`);
      process.exit(1);
    }
    process.stdout.write('Routine-qualified check — change fits the second-line envelope; eligible for the auto-merge queue. OK\n');
    process.exit(0);
  }

  // normal-human-review: an unqualified CLAIM fails; no claim / ordinary work passes.
  if (!claimed) {
    process.stdout.write('Routine-change lane (HG-0013) — no claim; normal human-merge lane applies. OK\n');
    process.exit(0);
  }
  if (findings.length) {
    process.stderr.write('\nRoutine-change lane (HG-0013) — DOES NOT QUALIFY (re-evaluate to the normal lane)\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nDrop the routine claim and take the normal human-merge lane, or bring the change\nwithin the second-line-owned envelope. See governance/routine-envelope.template.json.\n');
    process.exit(1);
  }
  process.stdout.write('Routine-change lane (HG-0013) — change fits the second-line envelope; auto-merge authorized. OK\n');
}
