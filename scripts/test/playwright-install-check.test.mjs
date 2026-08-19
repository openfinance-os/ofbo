// HARNESS-17 guards. The portal E2E job's Playwright install is the step that, on 2026-08-19,
// timed out three times in a row and took the whole 20-minute job with it — the suite never ran,
// and the job reported `cancelled`, which reads as neither pass nor fail.
//
// The shape that fixes it is easy to undo with a one-line edit that leaves CI green until the next
// slow apt mirror, so it is asserted here, in a suite CI always runs.
//
//  1. The browsers are CACHED, keyed on the resolved Playwright version.
//  2. The apt install and the browser install are SEPARATE, individually bounded steps — a slow
//     apt must fail fast and name itself rather than silently eating the job budget.
//  3. `--with-deps` is not reintroduced on the browser install, which would re-couple them and
//     restore the failure mode.
//  4. The JOB timeout is not raised. The step caps are diagnosis aids; raising either cap to make
//     a genuinely slow step pass is the reward-hacking Q1b/ADR 0019 exist to prevent.
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

test('portal E2E caches the Playwright browsers, keyed on the resolved version', () => {
  const job = e2eJob()
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

test('the apt install and the browser install are separate, individually bounded steps', () => {
  const job = e2eJob()
  const deps = job.match(/- name: install Playwright system deps\n([\s\S]*?)(?=\n {6}- )/)
  const browser = job.match(/- name: install Playwright Chromium\n([\s\S]*?)(?=\n {6}- )/)
  assert.ok(deps, 'the apt half must be its own step, so a slow mirror is attributable')
  assert.ok(browser, 'the browser download must be its own step')

  for (const [label, step] of [['system deps', deps[1]], ['chromium', browser[1]]]) {
    const cap = step.match(/timeout-minutes:\s*(\d+)/)
    assert.ok(cap, `the ${label} step must carry a timeout so it cannot consume the job budget`)
    assert.ok(
      Number(cap[1]) <= 6,
      `the ${label} step cap is ${cap[1]}m; measured healthy cost is ~92s (apt) and ~11s (download), `
      + 'so a cap above 6m is being used to wait out a problem rather than surface it'
    )
  }
})

test('--with-deps is not reintroduced on the browser install', () => {
  const job = e2eJob()
  const browser = job.match(/- name: install Playwright Chromium\n([\s\S]*?)(?=\n {6}- )/)
  assert.ok(browser)
  assert.doesNotMatch(
    browser[1], /--with-deps/,
    'combining apt and the download into one step is the exact shape that made a slow apt mirror '
    + 'indistinguishable from a slow CDN, and consumed the whole job timeout'
  )
})

test('the q3-e2e job timeout is not raised to paper over a slow install', () => {
  const job = e2eJob()
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
    `q3-e2e job timeout is ${cap[1]}m, above the 20m it has held. A healthy run is ~4m30s; raising `
    + 'the cap hides a regression rather than fixing one.'
  )
})
