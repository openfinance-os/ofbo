// The adoption stamp — what version of the Loom this repository is running, and which of its
// files the adopter has since made their own. Pure logic; `adopt.mjs` owns the filesystem.
//
// WHY THIS EXISTS, and it is not really about version numbers. Before the stamp, re-running the
// installer overwrote every managed file unconditionally. That is fine for a gate nobody touches
// and destructive for the ones loom-adopt's own step 3 TELLS the adopter to edit —
// `scripts/discovery-link-check.mjs` (set FEATURE to your story-id convention),
// `.claude/hooks/pii-guard.sh` (swap in your jurisdiction's PII shapes). Following the
// instructions and then upgrading silently threw the work away, with no diff and no warning.
//
// The stamp fixes that by recording, per destination, THE DIGEST OF WHAT THE LOOM INSTALLED —
// never what is on disk now. That one choice is what makes the comparison meaningful:
//
//   on-disk === stamp   → the adopter has not touched it → safe to update
//   on-disk !== stamp   → the adopter owns this file now → preserve it, never overwrite
//
// Recording the on-disk digest instead would invert the meaning: an edited file would look
// "unmodified" on the next run and get clobbered, which is the bug wearing a disguise. So a
// preserved file deliberately keeps its OLD stamp entry — it stays flagged as yours until the
// installed content and your content actually converge.
//
// UNSTAMPED IS NOT UNMODIFIED. A repository adopted before stamping exists has no entries at
// all, and for a file that differs from the new bundle there is no way to tell an adopter's edit
// from an old version of ours. `classifyFile` answers `unverifiable` and the installer preserves,
// because the only safe reading of "I cannot tell" is "assume it is theirs". This is loud and
// one-time: after the first stamped run, every subsequent upgrade knows.
//
// No clock and no filesystem in here — `now` is injected — so the whole state machine is
// testable without a repo, the same discipline as core/floor-project.mjs.

export const STAMP_PATH = '.loom/adoption.json';
export const SCHEMA = 'loom.adoption/1';

/** File classes the installer acts on. `unverifiable` exists so "unknown" is never silently "safe". */
export const CLASS = {
  NEW: 'new',
  CURRENT: 'already-current',
  UPDATE: 'update',
  LOCAL_EDIT: 'local-edit',
  UNVERIFIABLE: 'unverifiable',
};

/** Parse a semver, prerelease included. Returns null for anything unparseable — never a guess. */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : null };
}

/**
 * Semver precedence, prerelease-correct: rc.9 < rc.18 (numeric identifiers compare as numbers,
 * which plain string comparison gets backwards), and a release outranks its own prereleases.
 * Returns null when either side is unparseable, so callers must decide rather than assume order.
 */
export function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return null;
  for (const k of ['major', 'minor', 'patch']) if (A[k] !== B[k]) return A[k] < B[k] ? -1 : 1;
  if (!A.pre && !B.pre) return 0;
  if (!A.pre) return 1; // 2.0.0 > 2.0.0-rc.18
  if (!B.pre) return -1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) { if (+x !== +y) return +x < +y ? -1 : 1; }
    else if (xn !== yn) return xn ? -1 : 1; // numeric identifiers rank below alphanumeric
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * What the installer should do with one destination.
 * `stampDigest` undefined means the stamp has no record of this path (a pre-stamp adoption, or a
 * file the Loom has never installed here).
 */
export function classifyFile({ stampDigest, currentDigest, sourceDigest }) {
  if (currentDigest === null || currentDigest === undefined) return CLASS.NEW;
  if (currentDigest === sourceDigest) return CLASS.CURRENT; // converged, however it got there
  if (stampDigest === undefined || stampDigest === null) return CLASS.UNVERIFIABLE;
  return currentDigest === stampDigest ? CLASS.UPDATE : CLASS.LOCAL_EDIT;
}

/** True when the installer may write this class without destroying something it cannot replace. */
export function isSafeToWrite(cls) {
  return cls === CLASS.NEW || cls === CLASS.CURRENT || cls === CLASS.UPDATE;
}

/** An empty stamp — the shape `readStamp` falls back to, so callers never branch on null. */
export function emptyStamp() {
  return { schema: SCHEMA, bundle_version: null, files: {}, history: [] };
}

/**
 * Build the stamp to write after an install.
 *
 * `installed` maps destination → the digest of the SOURCE the Loom just wrote there. Destinations
 * it did NOT write (preserved local edits) keep whatever the previous stamp said, which is what
 * keeps them classified as the adopter's on every future run.
 */
export function nextStamp({ previous = emptyStamp(), version, installed, manifestDigest, now }) {
  const files = { ...previous.files, ...installed };
  const history = [...(previous.history || [])];
  // Append only on a genuine move. Guarded against BOTH ends disagreeing — a hand-edited stamp
  // whose bundle_version and history have drifted apart would otherwise log the same version
  // twice and make the trail lie about what happened.
  if (previous.bundle_version !== version && history.at(-1)?.version !== version) {
    history.push({ version, at: now });
  }
  return {
    schema: SCHEMA,
    bundle_version: version,
    first_adopted_at: previous.first_adopted_at || now,
    updated_at: now,
    manifest_digest: manifestDigest,
    files,
    history: history.slice(-50), // a trail, not a ledger
  };
}

/**
 * The migration notes an adopter has not seen yet: versions after `from`, up to and including
 * `to`. With no `from` (a first adoption, or a pre-stamp repo) there is nothing to catch up on,
 * so this returns nothing rather than replaying the entire history at someone.
 */
export function notesBetween(notes, from, to) {
  const versions = Array.isArray(notes?.versions) ? notes.versions : [];
  if (!from) return [];
  return versions
    .filter((n) => {
      const after = compareVersions(n.version, from);
      const upto = compareVersions(n.version, to);
      return after !== null && after > 0 && (upto === null || upto <= 0);
    })
    .sort((a, b) => compareVersions(a.version, b.version) ?? 0);
}
