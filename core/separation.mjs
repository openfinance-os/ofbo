// Separation of parties — the one rule, exported once (2.1.0, plan row 1.6).
//
// Three floor gates carried the same rule in three spellings: the transcriber and the approver
// must differ (DC-R21), the reconciler and the observer must differ (DG-R06), the freezer and the
// corroborating watcher must differ (DR-F06). Each was a bare `===` on two identity strings, and
// the seam to Kosli needs the same rule a fourth time as PR2 — a review whose signer is the
// author of the thing reviewed is not a review. A rule that exists in four places is a rule that
// will drift in one of them, so it lives here and the gates import it.
//
// What "same" means is deliberately narrow: two identity references resolve to one registry id
// after trimming and case-folding. Aliases, group membership and delegation are NOT collapsed
// here — an identity registered twice under two ids is a registry defect the identity gate owns,
// and a group is a set of parties, not a party. Where a comparison must reach through the
// identity map (a floor click bound to a registry id), the caller resolves first and passes the
// resolved id; this module never reads a file.
/** The registry id an identity reference names: a string, or an object carrying one of the usual keys. */
export function identityKey(ref) {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'string') { const t = ref.trim(); return t ? t.toLowerCase() : null; }
  if (typeof ref === 'object') {
    for (const k of ['registry_id', 'id', 'actor_id', 'identity', 'ran_by', 'observed_by', 'signed_by']) {
      if (typeof ref[k] === 'string' && ref[k].trim()) return ref[k].trim().toLowerCase();
    }
  }
  return null;
}

/** Are these two references the same party? Unknown on either side is NOT the same (a rule must not fire on nothing). */
export function sameIdentity(a, b) {
  const ka = identityKey(a), kb = identityKey(b);
  return ka !== null && kb !== null && ka === kb;
}

/**
 * The finding a gate emits when two roles that must be separable are held by one party. `code`
 * is the gate's own rule id (DC-R21, DG-R06, PR2 …) so its numbering stays; `what` labels the
 * record; `roleA`/`roleB` are the two roles in plain words. The sentence is the same everywhere
 * because the rule is the same everywhere.
 */
export function separationFinding({ code, what, actor, roleA, roleB }) {
  const who = typeof actor === 'string' ? JSON.stringify(actor) : JSON.stringify(identityKey(actor));
  return `${code}: ${what}: the ${roleA} and the ${roleB} are the same identity (${who}) — one party asserting twice. The ${roleA} and the ${roleB} must be separable, and an identity that is both is neither`;
}

/**
 * Convenience for the common shape: resolve both parties through `resolve(id)` (the identity
 * registry's lookup, injected so this module depends on nothing) when one is given, and report. Returns [] when separable, one finding when not. A party that does not resolve is not
 * compared — the identity gate reports unresolvable ids; this rule reports collapsed ones.
 */
export function requireSeparate({ code, what, a, roleA, b, roleB, resolve = null }) {
  const ra = resolve ? resolve(identityKey(a)) : null;
  const rb = resolve ? resolve(identityKey(b)) : null;
  const ka = ra ? identityKey(ra) ?? identityKey(a) : identityKey(a);
  const kb = rb ? identityKey(rb) ?? identityKey(b) : identityKey(b);
  if (ka === null || kb === null || ka !== kb) return [];
  return [separationFinding({ code, what, actor: ka, roleA, roleB })];
}
