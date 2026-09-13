// Release trains (rc.38 · flow-plan Phase 4.4). Per-change approval is right and stays exactly
// where it is. The release-LEVEL acts are the ones that were being paid per change and should not
// be: enumerating what is in the release, sealing one evidence bundle, anchoring it, and the
// second line satisfying itself that this release may go. Paying those once per story is what
// pushes an adopter into per-story releases and then into not releasing.
//
// A TRAIN is the enumeration, written down: `docs/governance/release-trains/<id>.json` names N
// change ids and ONE sealed bundle. It changes nothing about PA2 — each change still carries its
// own permission to launch — and it changes nothing about what evidence must exist. What it does
// is make "what is in this release" a governed artifact instead of a question asked in a channel,
// and it lets the seal gate derive its required evidence from the changes ACTUALLY SHIPPING
// rather than from every change in the repository.
//
// The rules are the boring ones that make an enumeration trustworthy:
//
//   a change belongs to at most ONE train   — two trains claiming a change means two releases
//                                             each believing they carried it
//   one train per release commit             — otherwise "what shipped" has two answers
//   every named change EXISTS                — a train naming a change that is not governed is an
//                                             enumeration of something nobody classified
//   the train is released by SECOND LINE     — the same rule as the per-change release hold; a
//                                             train does not become a way to release without it
//
// This module is pure: it takes loaded records and returns findings. The gates that read it are
// scripts/evidence-seal-check.mjs (required evidence derives from the train's changes) and
// scripts/release-attestation-check.mjs (the train, the subject and the manifest name one commit).

export const TRAINS_DIR = 'docs/governance/release-trains';
export const TRAIN_FIELDS = ['train_id', 'release_commit', 'changes', 'bundle', 'sealed_at', 'released_by'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Findings across every train in the repository. `changeIds` is the set of governed change ids
 * (from docs/governance/changes/); pass `null` where the tree cannot be read, and membership is
 * reported as NOT VERIFIED via `notices` rather than passed over.
 */
export function evaluateTrains(trains, { changeIds = null, registry = null, identityOf = null, notices = null } = {}) {
  const findings = [];
  const seenIds = new Set();
  const claimed = new Map();   // change id → train id
  const byCommit = new Map();  // release commit → train id
  for (const { file, train } of trains || []) {
    const id = train?.train_id || file;
    const label = `release train ${id}`;
    if (!train || typeof train !== 'object' || Array.isArray(train)) { findings.push(`${label}: not a JSON object`); continue; }
    for (const f of TRAIN_FIELDS) {
      if (train[f] === undefined || train[f] === null) findings.push(`${label}: missing ${f}`);
    }
    if (isStr(train.train_id)) {
      if (seenIds.has(train.train_id)) findings.push(`${label}: duplicate train_id — two files claiming one train means "what shipped" has two answers`);
      seenIds.add(train.train_id);
    }
    if (train.release_commit !== undefined && !/^[0-9a-f]{40}$/.test(String(train.release_commit))) {
      findings.push(`${label}: release_commit ${JSON.stringify(train.release_commit)} is not a 40-hex commit sha — a train binds to a commit, not to a tag somebody can move`);
    } else if (isStr(train.release_commit)) {
      const prior = byCommit.get(train.release_commit);
      if (prior && prior !== train.train_id) findings.push(`${label}: release_commit ${train.release_commit.slice(0, 12)}… is also claimed by train ${prior} — one commit is one release`);
      byCommit.set(train.release_commit, train.train_id);
    }
    const changes = train.changes;
    if (changes !== undefined && !(Array.isArray(changes) && changes.length > 0 && changes.every(isStr))) {
      findings.push(`${label}: changes must be a non-empty array of governed change ids — a train that enumerates nothing is not an enumeration`);
    } else if (Array.isArray(changes)) {
      for (const c of changes) {
        const prior = claimed.get(c);
        if (prior && prior !== train.train_id) findings.push(`${label}: change ${c} is also carried by train ${prior} — a change belongs to at most one train`);
        claimed.set(c, train.train_id);
        if (changeIds instanceof Set) {
          if (!changeIds.has(c)) findings.push(`${label}: change ${c} is not a governed change under docs/governance/changes/ — a release cannot enumerate something nobody classified`);
        }
      }
      if (!(changeIds instanceof Set)) {
        notices?.push(`${label}: no governed-changes tree was readable here, so train membership is NOT VERIFIED (the ids are taken as written)`);
      }
    }
    if (train.sealed_at !== undefined && Number.isNaN(Date.parse(train.sealed_at))) {
      findings.push(`${label}: sealed_at ${JSON.stringify(train.sealed_at)} is not a parseable ISO-8601 timestamp`);
    }
    if (isStr(train.released_by) && registry && identityOf) {
      const who = identityOf(registry, train.released_by);
      if (!who || who.kind !== 'human' || !(who.groups || []).includes('second-line')) {
        findings.push(`${label}: released_by ${JSON.stringify(train.released_by)} is not a second-line HUMAN identity — a train takes the release-level acts once, it does not take them away`);
      }
    }
  }
  return findings;
}

/** The train binding this release commit, or null. */
export function trainForCommit(trains, commit) {
  if (!isStr(commit)) return null;
  const hit = (trains || []).find(({ train }) => train?.release_commit === commit);
  return hit ? hit.train : null;
}
