// The residency sign-off gate (Factory Floor WS0 · D0.1 / prerequisite P1).
//
// WHY THIS EXISTS. Every other control in this method is *observed, not declared*. D0.1 was the
// exception: the residency record's §11 carries the two signatures that gate every workstream after
// WS0, its blocking statement says in prose that no workspace may be built and no content of any
// class may reach any floor surface until they are recorded — and nothing read it. An adopter could
// stand a floor up with both signature cells still saying `AWAITING`, and no gate would notice. The
// foundational control of the programme was the one thing running on trust.
//
// WHAT IT REFUSES. In order of how badly each one would end:
//
//   - A floor that exists without a signed record. This is the blocking statement, enforced. The
//     presence of live floor artifacts — approvals, keepers, degradation observations, adapter
//     evidence — while §11 is unsigned is the exact state the record forbids.
//   - A signature that does not resolve to a registry identity. A name in a markdown cell is not an
//     approver; it must be an identity the registry knows, holding the named role.
//   - An AGENT in either cell. Agents prepare evidence; they never approve. The record is a
//     governance decision and no service identity may carry one.
//   - A BUILDER signing. §11 says it outright, and it is the separation the whole method rests on:
//     the people who built the thing do not clear it.
//   - ONE PERSON HOLDING BOTH ROLES. "Roles, not headcount" is right almost everywhere in this
//     method and wrong here — a two-signature record whose point is a second pair of eyes is not
//     satisfied by one pair wearing two hats.
//   - A partially signed record. One signature is not a weaker approval; it is no approval.
//
// WHAT IT CANNOT DO, said plainly because the placement flatters it. It reads a markdown table. It
// can confirm that a decision was recorded by someone entitled to record it — it cannot confirm the
// person read the document, understood the twelve open items, or meant it. The signature is still a
// human act; this gate only stops the act being skipped or forged by someone unqualified.
//
// Mandatory-when-compiled, and additionally mandatory whenever a floor exists: a repo that compiles
// no `residency_approval` capability and runs no floor behaves exactly as it did before this file.
// Tightens, never loosens.

export const CAPABILITY = 'residency_approval';

/** The two roles P1 names. Not widened here — the record says the institution may add its own. */
export const REQUIRED_ROLES = ['data-protection', 'risk-second-line'];

/** The three decisions §11 offers. Anything else in the cell is not a decision. */
export const VERDICTS = ['approve', 'approve with conditions', 'refuse'];

/** A recorded decision that does NOT unblock. Refusal is a valid, signed outcome. */
export const BLOCKING_VERDICTS = ['refuse'];

/** The marker the record uses for a human decision that does not exist yet. */
export const AWAITING = 'AWAITING';

/**
 * Live-floor artifacts. NOT the shipped catalogs — `floor/templates`, `floor/catalog-b` and
 * `floor/catalog-c` are forms the installer copies into every adopting repo, and their presence
 * means only that the Loom was installed. These paths mean a floor is being USED.
 */
export const FLOOR_EVIDENCE = [
  'floor/approvals',
  'docs/governance/floor-keepers.json',
  'docs/governance/floor-degradation',
  'docs/governance/adapter-evidence',
];

const clean = (cell) => String(cell ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();
const isAwaiting = (v) => new RegExp(`\\b${AWAITING}\\b`, 'i').test(String(v ?? ''));

/**
 * Pull the sign-off rows out of the record. Returns `{ found, rows }`; `found:false` means no row
 * keyed by either required role exists anywhere, which is different from present-but-unsigned and
 * is reported differently.
 */
export function parseSignoff(markdown) {
  const rows = [];
  for (const line of String(markdown ?? '').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(clean);
    if (cells.length < 4) continue;
    const role = cells[0].toLowerCase();
    // The anchor is the ROLE KEY in the first cell, not the heading above it. Heading text is the
    // first thing a human reformats — the shipped worked example calls its section "The decision",
    // the live record calls it "Sign-off" — whereas a row whose first cell is exactly
    // `data-protection` is the signature row in any layout. Prose tables that merely mention the
    // roles do not match: §10's review-cadence table keys its rows on the trigger, not the role.
    if (!REQUIRED_ROLES.includes(role)) continue;
    if (rows.some((r) => r.role === role)) continue; // first occurrence wins; a later restatement is prose
    rows.push({ role, name: cells[1], identity: cells[2], decision: cells[3], date: cells[4] ?? '' });
  }
  return { found: rows.length > 0, rows };
}

/** Is this record signed by both roles with a non-blocking verdict? Pure; no findings. */
export function isSigned(parsed) {
  if (!parsed?.found) return false;
  return REQUIRED_ROLES.every((role) => {
    const row = parsed.rows.find((r) => r.role === role);
    if (!row) return false;
    const verdict = row.decision.toLowerCase();
    return VERDICTS.some((v) => verdict.startsWith(v))
      && !BLOCKING_VERDICTS.some((v) => verdict.startsWith(v))
      && !isAwaiting(row.decision) && !isAwaiting(row.identity) && !isAwaiting(row.name);
  });
}

const groupsOf = (who) => new Set(who?.groups || []);

/**
 * The gate. `floorArtifacts` is the list of live-floor paths found (empty ⇒ no floor in use);
 * `required` is the compiled-capability answer. Findings empty ⇒ pass.
 */
export function evaluate({ record = null, registry = null, floorArtifacts = [], required = false } = {}) {
  const findings = [];
  const floorInUse = floorArtifacts.length > 0;

  // A repo with no floor and no compiled requirement is none of this gate's business.
  if (record === null && !floorInUse && !required) return findings;

  if (record === null) {
    findings.push(
      floorInUse
        ? `a floor is in use (${floorArtifacts.join(', ')}) but there is no residency record — P1 gates `
          + 'every workstream after WS0, and its blocking statement forbids content on any floor surface'
        : 'a compiled plan requires residency approval but no residency record is present',
    );
    return findings;
  }

  const parsed = parseSignoff(record);
  if (!parsed.found) {
    findings.push(`the residency record has no sign-off rows — no table row is keyed by ${REQUIRED_ROLES.join(' or ')}. The signatures gate everything downstream, so a record without them is a draft`);
    return findings;
  }

  const seen = new Map(); // identity → roles it signed for, to catch one person wearing both hats
  for (const role of REQUIRED_ROLES) {
    const row = parsed.rows.find((r) => r.role === role);
    if (!row) { findings.push(`${role}: no signature row in §11 — the record does not even ask for this signature`); continue; }

    // Unsigned is the ORDINARY state of a drafted record and is not by itself a defect. The
    // blocking statement blocks workspace construction, token issue and floor content — it does not
    // block drafting, and the paper deliverables (D0.2, D0.4, D0.5) are meant to proceed without it.
    // So an unsigned record fails only once something depends on it. A gate that went red the moment
    // a record was drafted would be red for the entire life of every programme that writes one
    // honestly, and a gate that is always red is a gate nobody reads.
    //
    // Everything BELOW this branch is different in kind: those are defects in a signature that was
    // actually recorded, and an unsound signature is unsound whether or not anyone compiled it.
    if (isAwaiting(row.decision) || isAwaiting(row.identity) || isAwaiting(row.name)) {
      if (floorInUse || required) {
        findings.push(`${role}: AWAITING — unsigned, and ${floorInUse ? 'a floor is already in use' : 'a compiled plan requires residency approval'}. Route the record (docs/notion-floor-p1-reviewer-brief.md); never fill a signature cell on someone's behalf`);
      }
      continue;
    }

    const verdict = row.decision.toLowerCase();
    // Longest match first: 'approve with conditions' must not be shortened to 'approve'.
    const matched = [...VERDICTS].sort((a, b) => b.length - a.length).find((v) => verdict.startsWith(v));
    if (!matched) {
      findings.push(`${role}: decision ${JSON.stringify(row.decision)} is not one of ${VERDICTS.join(' / ')} — a note is not a decision`);
      continue;
    }
    if (BLOCKING_VERDICTS.includes(matched)) {
      findings.push(`${role}: REFUSED by ${row.identity}. This gate is doing its job — a refusal is a signed outcome and it blocks. Only the paper deliverables (D0.2, D0.4, D0.5) may proceed`);
      continue;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      findings.push(`${role}: date ${JSON.stringify(row.date)} is not an ISO date — an undated signature cannot be aged, and §10 requires re-review`);
    }

    if (!registry) {
      findings.push(`${role}: signed by ${row.identity}, but there is no identity registry to resolve it against — a name in a table is not an approver`);
      continue;
    }
    const who = (registry.identities || []).find((i) => i.id === row.identity);
    if (!who) {
      findings.push(`${role}: ${JSON.stringify(row.identity)} is not in the identity registry — unresolvable signatures do not count`);
      continue;
    }
    if (who.kind === 'agent') {
      findings.push(`${role}: ${row.identity} is an AGENT — agents prepare evidence, they never approve, and least of all the record that gates the programme`);
    }
    if (!(who.roles || []).includes(role)) {
      findings.push(`${role}: ${row.identity} does not hold the role ${role} — signing for a role you do not hold is not a signature`);
    }
    if (groupsOf(who).has('builders')) {
      findings.push(`${role}: ${row.identity} is in the builders group — §11 says builders may not sign, and it is the separation the method rests on`);
    }

    const already = seen.get(row.identity);
    if (already) {
      findings.push(`${row.identity} signed as both ${already} and ${role} — "roles, not headcount" holds almost everywhere in this method and not here: a two-signature record whose point is a second pair of eyes is not satisfied by one pair wearing two hats`);
    }
    seen.set(row.identity, role);
  }

  // The blocking statement, enforced. A partially signed record does not partially unblock.
  if (floorInUse && findings.length) {
    findings.push(`a floor is IN USE while the record is not cleanly signed — found ${floorArtifacts.join(', ')}. §11's blocking statement forbids workspace construction, token issue, and content of any class on any floor surface until both signatures are recorded and merged`);
  }
  return findings;
}

/* ------------------------------------------------------------------------------------------------
 * rc.36 (flow-plan Phase 2.5): residency joins the SIGNED world. The markdown table above can
 * confirm a decision was recorded by someone entitled to record it; it cannot confirm the person
 * signed anything — a name in a table cell is transcription, not signature. The JSON record
 * (docs/governance/residency-approval.json) carries one entry per required role, each bound by a
 * REAL assertion verified through the approval-attestation core's one unified stack: the payload
 * is canonical and order-fixed, the nonce binds it, the issuer comes from the ASSERTION registry
 * (an identity provider — a SERVICE key never vouches for a human), and demo keys, revoked
 * issuers and validity windows are refused by core/attestations.mjs. The markdown parser stays
 * for exactly one release as a deprecated fallback (residency-check.mjs prints the migration
 * notice); every identity rule above (registry resolution, no agents, no builders, role held,
 * two different humans) applies to both forms identically.
 * ---------------------------------------------------------------------------------------------- */

export const APPROVAL_SCHEMA = 'loom.residency-approval/v1';

/**
 * The exact string a residency assertion binds — deterministic and order-fixed, each field
 * JSON-encoded before joining so no value can shift a field boundary (the approval core's rule).
 */
export function canonicalApprovalPayload(entry) {
  return [APPROVAL_SCHEMA, entry?.role ?? '', entry?.registry_id ?? '', entry?.verdict ?? '', entry?.decided_at ?? '']
    .map((v) => JSON.stringify(typeof v === 'string' ? v : String(v ?? ''))).join('\n');
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * The signed-record gate. `ctx`: { registry, assertionIssuers (IdP material), serviceIssuers
 * (attestation-issuers — a key from here may NEVER vouch for a human), floorArtifacts, required,
 * verify (injected verifySignatureOver), sha256 (injected digest fn) }. Findings empty ⇒ both
 * roles decided, verifiably, by two different qualified humans.
 */
export function evaluateApprovals(record, {
  registry = null, assertionIssuers = null, serviceIssuers = null,
  floorArtifacts = [], required = false, verify, sha256,
} = {}) {
  const findings = [];
  const floorInUse = floorArtifacts.length > 0;
  if (record?.schema !== APPROVAL_SCHEMA) {
    findings.push(`residency-approval record schema ${JSON.stringify(record?.schema)} is not ${APPROVAL_SCHEMA} — an unversioned record cannot be verified`);
    return findings;
  }
  const entries = Array.isArray(record.approvals) ? record.approvals : [];
  const seen = new Map(); // identity → role, one pair of eyes per role
  for (const role of REQUIRED_ROLES) {
    const rows = entries.filter((e) => e?.role === role);
    if (rows.length === 0) {
      // Same posture as an AWAITING markdown cell: undecided is the ordinary state of a draft,
      // and blocks only once something depends on it.
      if (floorInUse || required) {
        findings.push(`${role}: no approval entry — undecided, and ${floorInUse ? 'a floor is already in use' : 'a compiled plan requires residency approval'}`);
      }
      continue;
    }
    if (rows.length > 1) findings.push(`${role}: ${rows.length} approval entries — one role, one decision; a second entry is a contested record, not extra assurance`);
    const e = rows[0];
    const label = `${role} (${e.registry_id ?? 'unattributed'})`;

    const verdict = String(e.verdict ?? '').toLowerCase();
    const matched = [...VERDICTS].sort((a, b) => b.length - a.length).find((v) => verdict === v);
    if (!matched) { findings.push(`${label}: verdict ${JSON.stringify(e.verdict)} is not one of ${VERDICTS.join(' / ')} — a note is not a decision`); continue; }
    if (BLOCKING_VERDICTS.includes(matched)) {
      findings.push(`${label}: REFUSED. This gate is doing its job — a refusal is a signed outcome and it blocks. Only the paper deliverables (D0.2, D0.4, D0.5) may proceed`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(e.decided_at ?? ''))) {
      findings.push(`${label}: decided_at ${JSON.stringify(e.decided_at)} is not an ISO date — an undated decision cannot be aged, and §10 requires re-review`);
    }

    // WHO — identical rules to the markdown path.
    if (!registry) { findings.push(`${label}: no identity registry to resolve the signer against — a name in a record is not an approver`); continue; }
    const who = (registry.identities || []).find((i) => i.id === e.registry_id);
    if (!who) { findings.push(`${label}: ${JSON.stringify(e.registry_id)} is not in the identity registry — unresolvable signatures do not count`); continue; }
    if (who.kind === 'agent') findings.push(`${label}: ${e.registry_id} is an AGENT — agents prepare evidence, they never approve`);
    if (!(who.roles || []).includes(role)) findings.push(`${label}: ${e.registry_id} does not hold the role ${role}`);
    if (groupsOf(who).has('builders')) findings.push(`${label}: ${e.registry_id} is in the builders group — builders may not sign`);
    const already = seen.get(e.registry_id);
    if (already) findings.push(`${e.registry_id} signed as both ${already} and ${role} — a two-signature record whose point is a second pair of eyes is not satisfied by one pair wearing two hats`);
    seen.set(e.registry_id, role);

    // The ASSERTION — the human's proof, through the one unified stack.
    const a = e.assertion;
    if (!a) { findings.push(`${label}: no assertion — without it the record proves only that somebody wrote JSON, which is the markdown table with extra steps`); continue; }
    if ((serviceIssuers?.issuers || []).some((i) => i.id === a.issuer)) {
      findings.push(`${label}: assertion issuer ${JSON.stringify(a.issuer)} is a registered SERVICE attestation issuer — a service signing for a human authenticates the service, not the approver`);
    }
    const payload = canonicalApprovalPayload(e);
    if (!isStr(a.nonce)) findings.push(`${label}: assertion carries no nonce over the decision payload — binding is what separates an approval from a login`);
    else if (sha256 && a.nonce !== sha256(payload)) findings.push(`${label}: assertion nonce does not bind the decision payload — the assertion could be replayed onto a different decision`);
    if (!assertionIssuers) {
      findings.push(`${label}: no assertion-issuers registry — the identity provider's verification material is not pinned, so the assertion is UNVERIFIED-HERE`);
    } else if (verify) {
      findings.push(...verify(payload, { issuer: a.issuer, signature: a.signature }, assertionIssuers, 'residency decision payload')
        .map((f) => `${label}: ${f}`));
    }
  }
  if (floorInUse && findings.length) {
    findings.push(`a floor is IN USE while the residency-approval record is not cleanly signed — found ${floorArtifacts.join(', ')}. §11's blocking statement holds for the signed form exactly as for the table`);
  }
  return findings;
}

/** Is the JSON record cleanly decided by both roles with non-blocking verdicts? Pure; no findings. */
export function approvalsSigned(record) {
  const entries = Array.isArray(record?.approvals) ? record.approvals : [];
  return REQUIRED_ROLES.every((role) => {
    const e = entries.find((x) => x?.role === role);
    return e && VERDICTS.includes(String(e.verdict ?? '').toLowerCase()) && !BLOCKING_VERDICTS.includes(String(e.verdict).toLowerCase());
  });
}
