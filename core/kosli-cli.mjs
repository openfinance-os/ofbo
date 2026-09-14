// The one seam through which the harness ever talks to Kosli (2.1.0, hardening plan phase 2 prep;
// kosli-seam.md decision K7). The official `kosli` CLI is the supported surface — auth, fingerprinting
// and the API stay Kosli's — so nothing in the harness re-implements the API, and nothing calls the
// binary except this module. Everything that will post an attestation (kosli-attest), begin a trail
// (kosli-trail) or read one back (the audit package) goes through `runKosli`, which means the whole
// seam is testable against ONE test double: core/kosli-fake.mjs records every invocation and answers
// from a canned response table, so CI never needs a Kosli org (decision K8).
//
// What this module does NOT do: decide what to attest, retry, or queue. A failed call is returned as
// a result with a non-zero status and the stderr Kosli gave; the outbox (phase 2 proper) decides
// what to do with it. Throwing is reserved for a binary that cannot be started at all, and even that
// is returned, not thrown, so a missing CLI is a finding-shaped result rather than a crash.
import { spawnSync } from 'node:child_process';

/** Where the binary comes from: KOSLI_BIN (the fake in CI, a pinned path in production) or PATH. */
export const DEFAULT_BIN = 'kosli';
export const binary = (env = process.env) => (typeof env.KOSLI_BIN === 'string' && env.KOSLI_BIN.trim()) ? env.KOSLI_BIN.trim() : DEFAULT_BIN;

/**
 * Run `kosli <args>` and return { ok, status, stdout, stderr, json, bin, args }. `json` is the parsed
 * stdout when it parses, else null — Kosli prints JSON for `--output json` and prose otherwise, and
 * the caller knows which it asked for. `stdin` is written to the child when given (attestation
 * payloads travel this way rather than as argv, which is visible in process listings).
 */
export function runKosli(args, { cwd = process.cwd(), env = process.env, stdin = null, timeoutMs = 60_000 } = {}) {
  const bin = binary(env);
  const list = Array.isArray(args) ? args.map(String) : [];
  const r = spawnSync(bin, list, { cwd, env, input: stdin ?? undefined, encoding: 'utf8', timeout: timeoutMs });
  if (r.error) {
    return { ok: false, status: null, stdout: '', stderr: `${bin}: ${r.error.code === 'ENOENT' ? 'not found — set KOSLI_BIN or install the kosli CLI' : r.error.message}`, json: null, bin, args: list };
  }
  const stdout = r.stdout || '';
  let json = null;
  try { json = JSON.parse(stdout); } catch { /* prose output */ }
  return { ok: r.status === 0, status: r.status, stdout, stderr: r.stderr || '', json, bin, args: list };
}
