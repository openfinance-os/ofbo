// Pre-approved change patterns (rc.38 · flow-plan Phase 4.3). The single biggest lead-time term
// for the changes that are not novel — a dependency bump, a copy fix, a config value inside a
// declared envelope — is that each one collects its own approvals for a route somebody already
// approved, over and over, identically.
//
// A PATTERN moves that approval from per-instance to per-envelope. A second-line human approves
// ONE pattern: a path/size matcher, and the EXACT compiled plan hash that a change matching it
// will compile to. A change declaring `change_class: "standard"` and naming the pattern rides the
// pre-approval instead of re-collecting the signatures.
//
// This is a RE-PRICING, and it holds only while every one of these is true:
//
//   the pattern EXPIRES               — a standing pre-approval with no end date is a policy
//                                       change nobody re-reads; an expired pattern blocks
//   a BUILDER cannot approve one      — the approver is a second-line human, never a builder,
//                                       and never an agent; this is the HG-0013 trust model
//   the ROUTE is provably the one     — the change's compiled plan_hash must EQUAL the pattern's
//   that was pre-approved               pre_compiled_plan_hash. Anything else and the pattern
//                                       pre-approved a different journey
//   a MATCHER MISS falls back         — a claim whose paths or size are outside the matcher gets
//                                       the FULL route, not a smaller one
//   sampling is ENROLLED              — the pattern names a sampling_rate and the change records
//                                       its enrolment; a selected sample owes a post-hoc review
//
// Nothing here removes an approval. It changes WHEN it was given and WHO it covers, and every one
// of the five conditions above fails closed.
//
// Patterns are declared in PROFILES (profiles/*.json `patterns: []`), so they inherit the profile
// system's properties: they are data, they are CODEOWNERS-guarded, and changing one changes the
// profile digest — which makes every stored plan compiled from it stale, exactly as it should.

export const PATTERN_FIELDS = ['pattern_id', 'matcher', 'pre_compiled_plan_hash', 'approved_by', 'expires', 'sampling_rate'];
export const CLAIM_FIELDS = ['pattern_id', 'changed_paths', 'diff_lines'];
/** The hard ceiling on a pattern's aperture. A pattern is a SMALL, shaped change, by definition. */
export const MAX_PATTERN_DIFF_LINES = 400;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

/**
 * A restricted glob: `**` crosses directory separators, `*` and `?` do not. Deliberately small —
 * a matcher is a control surface, and a full regex in a profile would be a control surface nobody
 * can read. Anchored at both ends: `src/*` does not match `src/a/b`, and `lock` does not match
 * `package-lock.json`.
 */
export function globMatch(glob, path) {
  if (!isStr(glob) || typeof path !== 'string') return false;
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; continue; }
    if (c === '*') { re += '[^/]*'; continue; }
    if (c === '?') { re += '[^/]'; continue; }
    re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(path);
}

/**
 * Collect the patterns declared across a set of loaded profiles.
 * Returns `{ patterns: Map<id, {pattern, profile}>, findings }`. Two profiles declaring the SAME
 * pattern_id is a finding, not a merge: a pattern is an approval, and silently picking one of two
 * approvals would mean the aperture in force is whichever file was read first.
 */
export function collectPatterns(profiles) {
  const patterns = new Map();
  const findings = [];
  for (const p of profiles || []) {
    for (const pat of p?.patterns || []) {
      const id = pat?.pattern_id;
      if (!isStr(id)) { findings.push(`profile ${p.profile}: a pattern has no pattern_id`); continue; }
      if (patterns.has(id)) {
        findings.push(`pattern ${id} is declared by BOTH ${patterns.get(id).profile} and ${p.profile} — a pattern is an approval; two approvals under one id means the aperture in force is whichever file was read first`);
        continue;
      }
      patterns.set(id, { pattern: pat, profile: p.profile });
    }
  }
  return { patterns, findings };
}

/**
 * Is this pattern itself well-formed, live, and approved by someone allowed to approve it?
 * Findings ([] ⇒ the pattern may be relied on right now).
 */
export function evaluatePattern(pattern, { profile = '(unknown profile)', registry = null, identityOf = null, now = Date.now() } = {}) {
  const findings = [];
  const id = pattern?.pattern_id || '(unnamed)';
  const label = `pattern ${id} (${profile})`;
  for (const f of PATTERN_FIELDS) {
    if (pattern?.[f] === undefined || pattern?.[f] === null) findings.push(`${label}: missing ${f}`);
  }
  const m = pattern?.matcher;
  if (m !== undefined) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) findings.push(`${label}: matcher must be an object { paths: [glob], max_diff_lines: N }`);
    else {
      if (!(Array.isArray(m.paths) && m.paths.length > 0 && m.paths.every(isStr))) {
        findings.push(`${label}: matcher.paths must be a non-empty array of path globs — a pattern that matches everything pre-approves everything`);
      }
      if (!(Number.isInteger(m.max_diff_lines) && m.max_diff_lines > 0)) {
        findings.push(`${label}: matcher.max_diff_lines must be a positive integer — an unbounded pattern is not a pattern`);
      } else if (m.max_diff_lines > MAX_PATTERN_DIFF_LINES) {
        findings.push(`${label}: matcher.max_diff_lines ${m.max_diff_lines} exceeds the shipped ceiling of ${MAX_PATTERN_DIFF_LINES} — widen the aperture with evidence (routine-change-check --stats), not by editing the ceiling`);
      }
    }
  }
  if (pattern?.pre_compiled_plan_hash !== undefined && !/^[0-9a-f]{64}$/.test(String(pattern.pre_compiled_plan_hash))) {
    findings.push(`${label}: pre_compiled_plan_hash must be the 64-hex plan hash the pattern pre-approves — a pattern that does not name a route pre-approves nothing in particular`);
  }
  const rate = pattern?.sampling_rate;
  if (rate !== undefined && !(typeof rate === 'number' && rate > 0 && rate <= 1)) {
    findings.push(`${label}: sampling_rate must be a number in (0, 1] — a pattern nobody ever samples is a pre-approval nobody ever checks`);
  }
  const exp = parseTime(pattern?.expires);
  if (pattern?.expires !== undefined && exp === null) findings.push(`${label}: expires ${JSON.stringify(pattern.expires)} is not a parseable ISO-8601 date`);
  else if (exp !== null && exp < now) findings.push(`${label}: EXPIRED ${pattern.expires} — an expired pattern pre-approves nothing; renew it as a governed change or take the full route`);
  // A builder cannot approve their own shortcut. Same rule as an envelope exemption and the
  // routine envelope: the aperture is second-line-owned or it is self-service.
  if (isStr(pattern?.approved_by) && registry && identityOf) {
    const who = identityOf(registry, pattern.approved_by);
    if (!who) findings.push(`${label}: approved_by ${JSON.stringify(pattern.approved_by)} is not in the identity registry`);
    else {
      if (who.kind !== 'human') findings.push(`${label}: approved_by ${pattern.approved_by} is an ${who.kind} — agents build, they never approve, least of all a standing pre-approval`);
      if (!(who.groups || []).includes('second-line')) {
        findings.push(`${label}: approved_by ${pattern.approved_by} is not a second-line identity — a pre-approved pattern is an aperture, and a builder cannot widen the aperture they build through`);
      }
      if ((who.groups || []).includes('builders')) {
        findings.push(`${label}: approved_by ${pattern.approved_by} is in the builders group — a builder cannot approve a pattern`);
      }
    }
  }
  return findings;
}

/**
 * Does this change's claim actually fit the pattern, and does the route it compiled match the one
 * the pattern pre-approved?
 *
 * Returns `{ covered, findings, notices }`. `covered: false` means the pre-approval does NOT
 * apply and the change takes the FULL route — which is the fail-open direction: more approval,
 * never less. Every reason is a finding, so a fallback is never silent.
 */
export function evaluateClaim(envelope, entry, { plan = null, registry = null, identityOf = null, now = Date.now(), diff = null } = {}) {
  const findings = [];
  const notices = [];
  const id = envelope?.change_id || '(no id)';
  const claim = envelope?.pattern_claim;
  if (!entry) {
    return { covered: false, findings: [`${id}: change_class "standard" names pattern ${JSON.stringify(claim?.pattern_id)}, which no profile in required_profiles declares — an unresolvable pattern pre-approves nothing, so this change takes the FULL route`], notices };
  }
  const { pattern, profile } = entry;
  const label = `${id}: pattern ${pattern.pattern_id}`;
  findings.push(...evaluatePattern(pattern, { profile, registry, identityOf, now }).map((f) => `${id}: ${f}`));

  for (const f of CLAIM_FIELDS) {
    if (claim?.[f] === undefined || claim?.[f] === null) findings.push(`${label}: pattern_claim is missing ${f}`);
  }
  const paths = claim?.changed_paths;
  if (paths !== undefined && !(Array.isArray(paths) && paths.length > 0 && paths.every(isStr))) {
    findings.push(`${label}: pattern_claim.changed_paths must be a non-empty array of the paths this change touches`);
  } else if (Array.isArray(paths) && Array.isArray(pattern.matcher?.paths)) {
    for (const p of paths) {
      if (!pattern.matcher.paths.some((g) => globMatch(g, p))) {
        findings.push(`${label}: ${JSON.stringify(p)} is outside the pattern matcher (${pattern.matcher.paths.join(', ')}) — a matcher miss takes the FULL route`);
      }
    }
  }
  const lines = claim?.diff_lines;
  if (lines !== undefined && !(Number.isInteger(lines) && lines >= 0)) findings.push(`${label}: pattern_claim.diff_lines must be a non-negative integer`);
  else if (Number.isInteger(lines) && Number.isInteger(pattern.matcher?.max_diff_lines) && lines > pattern.matcher.max_diff_lines) {
    findings.push(`${label}: ${lines} changed lines exceeds the pattern's ceiling of ${pattern.matcher.max_diff_lines} — over the aperture takes the FULL route`);
  }

  // The declared claim is the CHANGE'S OWN WORD until a diff is available to check it against.
  // Where one is (the gate was given --base), the two are reconciled; where it is not, the gap is
  // stated out loud rather than passed over — an unverifiable claim must not read like a verified
  // one. See scripts/change-envelope-check.mjs's CLI.
  if (diff) {
    const declared = new Set(Array.isArray(paths) ? paths : []);
    for (const f of diff.paths) {
      if (!declared.has(f)) findings.push(`${label}: the diff touches ${JSON.stringify(f)}, which pattern_claim.changed_paths does not declare — the claim is not the change`);
    }
    for (const f of declared) {
      if (!diff.paths.includes(f)) findings.push(`${label}: pattern_claim declares ${JSON.stringify(f)}, which this diff does not touch`);
    }
    if (Number.isInteger(lines) && diff.lines > lines) {
      findings.push(`${label}: pattern_claim declares ${lines} changed lines but the diff has ${diff.lines}`);
    }
  } else {
    notices.push(`${label}: pattern_claim.changed_paths / diff_lines are SELF-DECLARED and NOT VERIFIED here — run the gate with --base <ref> in a checkout with history to reconcile the claim against the actual diff`);
  }

  // The route. This is the load-bearing check: a pattern pre-approves ONE compiled plan, and a
  // change that compiles anything else was not pre-approved, however well it matches the paths.
  if (plan?.plan_hash && isStr(pattern.pre_compiled_plan_hash) && plan.plan_hash !== pattern.pre_compiled_plan_hash) {
    findings.push(`${label}: this change compiles plan ${String(plan.plan_hash).slice(0, 12)}… but the pattern pre-approves ${String(pattern.pre_compiled_plan_hash).slice(0, 12)}… — the pre-approval covers a DIFFERENT route, so this change takes the FULL route`);
  }

  // Post-hoc sampling is the compensating control for approving in advance: without it, a pattern
  // is a promise that nobody ever audits. Enrolment is recorded ON THE CHANGE, so a sampled
  // population can be reconstructed from the tree rather than from a service nobody kept.
  const s = claim?.sampling;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    findings.push(`${label}: pattern_claim.sampling missing — a change riding a pre-approval must record its enrolment { enrolled, rate, selected }`);
  } else {
    if (s.enrolled !== true) findings.push(`${label}: pattern_claim.sampling.enrolled must be true — riding a pattern IS enrolling in its post-hoc sample`);
    if (typeof pattern.sampling_rate === 'number' && s.rate !== pattern.sampling_rate) {
      findings.push(`${label}: pattern_claim.sampling.rate ${JSON.stringify(s.rate)} is not the pattern's declared ${pattern.sampling_rate} — the enrolment must record the rate actually in force`);
    }
    if (s.selected === true) {
      const by = s.reviewed_by;
      if (!isStr(by) || !isStr(s.reviewed_at)) {
        findings.push(`${label}: this change was SELECTED for post-hoc review and carries no completed review (sampling.reviewed_by + sampling.reviewed_at) — a sample nobody reviews is a sample nobody took`);
      } else if (registry && identityOf) {
        const who = identityOf(registry, by);
        if (!who || who.kind !== 'human' || !(who.groups || []).includes('second-line')) {
          findings.push(`${label}: the post-hoc review is credited to ${JSON.stringify(by)}, who is not a second-line human — the sample is reviewed by the function that owns the pattern`);
        }
      }
    }
  }

  const covered = findings.length === 0;
  if (covered) {
    notices.push(`${id}: rides PRE-APPROVED pattern ${pattern.pattern_id} (approved by ${pattern.approved_by}, expires ${pattern.expires}, sampled at ${pattern.sampling_rate}) — the PA receipts were given once, on the pattern, not on this change`);
  }
  return { covered, findings, notices };
}
