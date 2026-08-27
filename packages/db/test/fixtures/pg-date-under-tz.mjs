/**
 * Runs `isoDateFromPg` in a child process so the parent's TZ does not apply — the only way to
 * exercise the timezone that actually broke it, given Node resolves TZ once per process.
 *
 * Dates are built the way node-postgres builds a `date` column: local midnight via the
 * local-component constructor (month is 0-based).
 */
import process from 'node:process'
import { isoDateFromPg } from '../../src/pg-date.ts'

process.stdout.write(
  JSON.stringify({
    tz: process.env.TZ,
    anchor: isoDateFromPg(new Date(2025, 9, 1)),
    newYear: isoDateFromPg(new Date(2026, 0, 1)),
    yearEnd: isoDateFromPg(new Date(2025, 11, 31))
  })
)
