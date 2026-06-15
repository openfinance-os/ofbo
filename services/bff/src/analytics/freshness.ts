/**
 * BACKOFFICE-40 — the data-freshness standard for every aggregated view. Each view
 * emits source-publish + view-refresh timestamps and an amber (stale) flag that trips
 * when the source is older than 2× its refresh cadence (BO-OQ-23 default), with a
 * cause for the tooltip. A domain-specific staleness signal (e.g. the last Nebras poll
 * failed) takes precedence over the age check. This is the single helper every view
 * routes its Freshness through, so the contract is uniform.
 */

export const FRESHNESS_CADENCE = {
  HOURLY_MS: 60 * 60 * 1000,
  DAILY_MS: 24 * 60 * 60 * 1000,
  MONTHLY_MS: 30 * 24 * 60 * 60 * 1000
} as const

export interface FreshnessEnvelope {
  source_published_at: string | null
  view_refreshed_at: string
  stale: boolean
  stale_cause: string | null
}

/** A view computed live on read (no external source publication) — always fresh. */
export function liveFreshness(now: Date): FreshnessEnvelope {
  const iso = now.toISOString()
  return { source_published_at: iso, view_refreshed_at: iso, stale: false, stale_cause: null }
}

/**
 * BO-OQ-23: amber when the source is older than 2× its refresh cadence. A domain
 * staleness signal (extraStale) wins over the age check; a missing source is stale.
 */
export function computeFreshness(input: {
  sourcePublishedAt: string | null
  now: Date
  sourceCadenceMs: number
  missingCause?: string
  extraStale?: { stale: boolean; cause: string } | null
}): FreshnessEnvelope {
  const view_refreshed_at = input.now.toISOString()
  if (input.extraStale?.stale) {
    return { source_published_at: input.sourcePublishedAt, view_refreshed_at, stale: true, stale_cause: input.extraStale.cause }
  }
  if (input.sourcePublishedAt === null) {
    return { source_published_at: null, view_refreshed_at, stale: true, stale_cause: input.missingCause ?? 'no_source_data' }
  }
  const ageMs = input.now.getTime() - new Date(input.sourcePublishedAt).getTime()
  const stale = ageMs > 2 * input.sourceCadenceMs
  return { source_published_at: input.sourcePublishedAt, view_refreshed_at, stale, stale_cause: stale ? 'older_than_2x_source_cadence' : null }
}
