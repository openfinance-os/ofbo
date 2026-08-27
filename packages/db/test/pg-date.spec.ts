import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isoDateFromPg } from '../src/pg-date.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Reading a SQL `date` back as the calendar date it is.
 *
 * The defect this guards was invisible for as long as it existed, because every CI runner and
 * every containerised test run is UTC — and in UTC the broken implementation is correct. It only
 * appeared when the code ran in the timezone the product is built for.
 *
 * So the interesting assertions here are the ones that run in a CHILD PROCESS with TZ set. A
 * same-process test cannot do it: Node resolves the timezone once, and reassigning process.env.TZ
 * mid-run does not reliably re-resolve it.
 */
describe('isoDateFromPg', () => {
  it('passes a string straight through', () => {
    expect(isoDateFromPg('2025-10-01')).toBe('2025-10-01')
    expect(isoDateFromPg('2025-10-01T00:00:00.000Z')).toBe('2025-10-01')
  })

  it('reads a Date back as the calendar day node-postgres put in it', () => {
    // How node-postgres builds a `date` column: local midnight, via the local-component
    // constructor. The month argument is 0-based, so 9 is October.
    expect(isoDateFromPg(new Date(2025, 9, 1))).toBe('2025-10-01')
    expect(isoDateFromPg(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(isoDateFromPg(new Date(2025, 11, 31))).toBe('2025-12-31')
  })

  /**
   * The regression test proper, and the reason it runs in a child process.
   *
   * The old implementation was correct in UTC and correct WEST of UTC — local midnight converts
   * forward into the same UTC day — so it failed only east of UTC. Asia/Dubai is where this
   * product runs and is the case that broke; Pacific/Kiritimati (UTC+14) is the extreme of the
   * same error. America/New_York and UTC are controls: they must stay green, and they are exactly
   * why nobody caught this for as long as it existed.
   */
  it.each(['Asia/Dubai', 'America/New_York', 'Pacific/Kiritimati', 'UTC'])(
    'is correct under TZ=%s',
    (tz) => {
      const script = join(here, 'fixtures', 'pg-date-under-tz.mjs')
      const output = execFileSync(process.execPath, [script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8'
      })
      expect(JSON.parse(output)).toEqual({
        tz,
        anchor: '2025-10-01',
        newYear: '2026-01-01',
        yearEnd: '2025-12-31'
      })
    }
  )
})
