import { describe, expect, it } from 'vitest'
import { computeFreshness, liveFreshness, FRESHNESS_CADENCE } from '../src/analytics/freshness.js'

/**
 * BACKOFFICE-40 — the shared data-freshness standard (BO-OQ-23): source publish +
 * view refresh + amber when older than 2× the source cadence + cause.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z')

describe('liveFreshness', () => {
  it('is always fresh, source = now', () => {
    const f = liveFreshness(NOW)
    expect(f).toEqual({ source_published_at: '2026-06-15T12:00:00.000Z', view_refreshed_at: '2026-06-15T12:00:00.000Z', stale: false, stale_cause: null })
  })
})

describe('computeFreshness (BO-OQ-23 2× cadence)', () => {
  it('is fresh when the source is within 2× the cadence', () => {
    const f = computeFreshness({ sourcePublishedAt: '2026-06-14T12:00:00.000Z', now: NOW, sourceCadenceMs: FRESHNESS_CADENCE.DAILY_MS }) // 24h old, 2×daily = 48h
    expect(f.stale).toBe(false)
    expect(f.stale_cause).toBeNull()
    expect(f.source_published_at).toBe('2026-06-14T12:00:00.000Z')
  })

  it('is amber when the source is older than 2× the cadence', () => {
    const f = computeFreshness({ sourcePublishedAt: '2026-06-12T11:00:00.000Z', now: NOW, sourceCadenceMs: FRESHNESS_CADENCE.DAILY_MS }) // 73h old > 48h
    expect(f.stale).toBe(true)
    expect(f.stale_cause).toBe('older_than_2x_source_cadence')
  })

  it('treats exactly 2× as not-yet-stale (strict >)', () => {
    const f = computeFreshness({ sourcePublishedAt: '2026-06-13T12:00:00.000Z', now: NOW, sourceCadenceMs: FRESHNESS_CADENCE.DAILY_MS }) // exactly 48h
    expect(f.stale).toBe(false)
  })

  it('a missing source is stale with the supplied cause, and omits source_published_at (non-nullable contract field)', () => {
    const f = computeFreshness({ sourcePublishedAt: null, now: NOW, sourceCadenceMs: FRESHNESS_CADENCE.DAILY_MS, missingCause: 'no_ingested_aggregates_for_period' })
    expect(f).toMatchObject({ stale: true, stale_cause: 'no_ingested_aggregates_for_period' })
    expect(f.source_published_at).toBeUndefined() // omitted, never null
  })

  it('a domain staleness signal (extraStale) wins over the age check', () => {
    const f = computeFreshness({ sourcePublishedAt: '2026-06-15T11:00:00.000Z', now: NOW, sourceCadenceMs: FRESHNESS_CADENCE.DAILY_MS, extraStale: { stale: true, cause: 'last_ingestion_failed' } }) // fresh by age, but domain-stale
    expect(f.stale).toBe(true)
    expect(f.stale_cause).toBe('last_ingestion_failed')
  })
})
