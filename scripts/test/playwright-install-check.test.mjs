// HARNESS-17 guards. The portal E2E job's Playwright install is the step that, on 2026-08-19,
// timed out four times in a row and took the whole 20-minute job with it — the suite never ran,
// and three of those runs reported `cancelled`, which reads as neither pass nor fail.
//
// The shape that fixes it is easy to undo with a one-line edit that leaves CI green until the next
// slow apt mirror, so it is asserted here, in a suite CI always runs.
//
//  1. The browsers are CACHED, keyed on the resolved Playwright version, and that key cannot
//     silently degrade to a version-less constant.
//  2. The apt step is GONE, and `--with-deps` is not reintroduced on the browser install — either
//     one puts an external Ubuntu mirror back in the critical path of every PR.
//  3. NOTHING in the job is `continue-on-error`. Every step must be able to red it.
//  4. The JOB timeout is not raised. The step cap is a diagnosis aid; raising either cap to make a
//     genuinely slow step pass is the reward-hacking Q1b/ADR 0019 exist to prevent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')

/** The q3-e2e job block, so a match in another job cannot satisfy these assertions. */
function e2eJob() {
  const start = ci.indexOf('\n  q3-e2e:')
  assert.ok(start > 0, 'ci.yml must declare a q3-e2e job')
  // Next sibling job — two-space indent followed by a key — or end of file.
  const rest = ci.slice(start + 1)
  const next = rest.search(/\n {2}[a-z0-9-]+:\n/)
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * The job with comment lines removed.
 *
 * Assertions about what the job DOES must not be satisfiable, or defeated, by prose. The comment
 * above the browser install explains at length why there is no apt step and why nothing is
 * continue-on-error — mentioning both strings. Counting raw text would read those mentions as
 * declarations; a guard that a comment can flip is not a guard.
 */
function e2eJobCode() {
  return e2eJob()
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
}

test('portal E2E caches the Playwright browsers, keyed on the resolved version', () => {
  const job = e2eJobCode()
  assert.match(
    job, /uses: actions\/cache@/,
    'the q3-e2e job must cache the Playwright browser download'
  )
  assert.match(
    job, /path:\s*~\/\.cache\/ms-playwright/,
    'the cache must cover ~/.cache/ms-playwright, where Playwright stores browsers'
  )
  assert.match(
    job, /key:\s*ms-playwright-\$\{\{\s*runner\.os\s*\}\}-\$\{\{\s*steps\.pw\.outputs\.version\s*\}\}/,
    'the cache key must include the RESOLVED Playwright version — keying on a lockfile hash would '
    + 'evict 290 MiB of browsers on any unrelated dependency bump'
  )
  assert.match(
    job, /playwright --version/,
    'the version used in the cache key must be resolved from the installed Playwright, not hardcoded'
  )
})

test('the cache key cannot silently degrade to a version-less constant', () => {
  // `echo "v=$(cmd)"` exits 0 even when cmd fails, so an unresolved version would produce the key
  // `ms-playwright-Linux-` for EVERY Playwright version — one version's browsers served to another,
  // with no signal. The resolution step must refuse rather than emit an empty value.
  const job = e2eJobCode()
  const step = job.match(/- name: resolve Playwright version\n([\s\S]*?)(?=\n {6}- )/)
  assert.ok(step, 'the version-resolution step must exist')
  assert.match(
    step[1], /if \[ -z "\$version" \]|::error::/,
    'the version-resolution step must fail loudly on an empty version rather than emitting one'
  )
})

test('no apt step, and no --with-deps — the Ubuntu mirror stays out of the critical path', () => {
  // `playwright install-deps` installs FONTS and nothing else on this runner image (apt resolves
  // the full chromium dependency set and reported only fonts missing). It failed the job four
  // times in one day on an external mirror, and on run 32237329042 it was killed at its cap having
  // logged zero `Setting up` lines — no package installed — after which the suite ran and passed.
  // Reintroducing it in either form puts a mirror outage back in front of every PR.
  const job = e2eJobCode()
  assert.doesNotMatch(
    job, /install-deps/,
    'the apt step was removed on evidence (fonts only; the suite passes without it) — reintroducing '
    + 'it puts an external Ubuntu mirror back in the critical path of every PR'
  )
  const browser = job.match(/- name: install Playwright Chromium\n([\s\S]*?)(?=\n {6}- )/)
  assert.ok(browser, 'the browser download must be its own step')
  assert.doesNotMatch(
    browser[1], /--with-deps/,
    'combining apt and the download into one step is the exact shape that made a slow apt mirror '
    + 'indistinguishable from a slow CDN, and consumed the whole job timeout'
  )
  const cap = browser[1].match(/timeout-minutes:\s*(\d+)/)
  assert.ok(cap, 'the browser download must carry a timeout so it cannot consume the job budget')
  assert.ok(
    Number(cap[1]) <= 6,
    `the browser-download cap is ${cap[1]}m; measured cost is ~12s cold and ~1s warm, so a cap `
    + 'above 6m is being used to wait out a problem rather than surface it'
  )
})

test('nothing in q3-e2e is continue-on-error — every step can red the job', () => {
  // Counted across the whole job rather than checked step by step. A per-step list would have to
  // name each step it protects, and would then quietly stop protecting any step that gets renamed
  // or added — a guard that reports green because it no longer looks.
  //
  // Zero, not "one, on the harmless step": with the apt step gone there is nothing left whose
  // failure is cosmetic, so any continue-on-error here would be a step that has been made unable
  // to fail. Comments are stripped first, because the workflow's own comments discuss the flag.
  const job = e2eJobCode()
  const occurrences = job.match(/continue-on-error/g) ?? []
  assert.equal(
    occurrences.length, 0,
    `q3-e2e declares continue-on-error ${occurrences.length} time(s); it must declare none. The `
    + 'browser download, the services, the portal build and the E2E suite itself must each be able '
    + 'to red the job.'
  )
})

test('the q3-e2e job timeout is not raised to paper over a slow install', () => {
  const job = e2eJobCode()
  // Anchored to the JOB's indent (4 spaces), not "the first timeout-minutes in the block".
  // The unanchored version read whichever cap appeared first, which is only the job cap because
  // this file happens to put job keys above `steps:`. YAML does not require that: move the job
  // cap below `steps:` and the match becomes a step's `timeout-minutes: 6`, which sails through
  // `<= 20` — a guard passing on the wrong number while reporting on the right one. Indent
  // identifies the job mapping's own key regardless of where in the mapping it sits.
  const cap = job.match(/^ {4}timeout-minutes:\s*(\d+)/m)
  assert.ok(cap, 'q3-e2e must keep a JOB-level timeout (4-space indent), not only per-step caps')
  assert.ok(
    Number(cap[1]) <= 20,
    `q3-e2e job timeout is ${cap[1]}m, above the 20m it has held. A healthy run is ~3m; raising `
    + 'the cap hides a regression rather than fixing one.'
  )
})
