/**
 * The non-prod refusal shared by `db:reset` and the three seed entry points.
 *
 * IT LIVES IN ITS OWN MODULE FOR A STRUCTURAL REASON, not for tidiness. It used to be exported from
 * `reset.ts`, and the three seeds imported it from there — which put `reset.ts` into the module graph
 * of anything importing a seed. `packages/db/src/index.ts` re-exports all three seeds and
 * `services/bff/src/worker.ts` imports from `@ofbo/db`, so that edge linked `resetDatabase` — a
 * function that TRUNCATEs every table in the schema — into the request-path service, and put the
 * one non-ports `DEPLOY_PROFILE` read there with it.
 *
 * Nothing called it, and a bundler may well have shaken it out. Neither is a reason to keep the edge:
 * the whole argument for the rule-7 exemption (ADR 0035) is that these modules are non-prod CLI
 * tooling rather than request-path core, and an import edge into `worker.ts` is precisely the line
 * that ADR says its ruling does not cross. The exemption was recorded, and the same change quietly
 * undermined the premise it rests on. Splitting the guard out removes the edge instead of arguing
 * about whether it matters — `reset.ts` is now reachable only from `db:reset` itself.
 *
 * So this module holds the refusal and nothing else: no pool, no SQL, no truncation. It is the only
 * non-`packages/ports` module permitted to read `DEPLOY_PROFILE` (see eslint.config.mjs), and it is
 * cheap for anything to import.
 */
export function assertNonProdBulkMutation(operation: string): void {
  // ALLOWLIST, not denylist: proceed only for a profile that resolves to `demo`.
  //
  // This was `=== 'enterprise' || NODE_ENV === 'production'`, which fails OPEN on anything it does
  // not recognise — `DEPLOY_PROFILE=production`, `Enterprise`, a typo — all of which reached a bulk
  // lifecycle UPDATE over retained records. While both seeds were strictly additive a mis-set
  // environment was harmless; it is not any more, which is exactly what makes the default matter.
  //
  // The resolution mirrors `profileFromConfig` in packages/ports: unset means `demo`, so local dev
  // and CI (which set nothing) are unaffected; `demo` and `enterprise` are the only valid values;
  // anything else is a configuration error rather than a silent permit. Mirrored rather than
  // imported because `packages/db` sits below `packages/ports` and must not depend on it — the
  // convention is named here so the two cannot drift unnoticed.
  const profile = process.env.DEPLOY_PROFILE ?? 'demo'
  if (profile !== 'demo' && profile !== 'enterprise') {
    throw new Error(`${operation} refuses to run: DEPLOY_PROFILE must be demo|enterprise, got: ${profile}`)
  }
  if (profile !== 'demo' || process.env.NODE_ENV === 'production') {
    throw new Error(`${operation} is non-prod only and refuses to run under the enterprise/production profile (regulated records are not bulk-mutated by tooling).`)
  }
}
