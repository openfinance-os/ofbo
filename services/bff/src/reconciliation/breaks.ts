import type { Money } from '@ofbo/ports'
import type { ReconLineResult, ReconResult } from './engine.js'
import { DEFAULT_THRESHOLDS, thresholdFor, type BreakThreshold } from './thresholds.js'

/**
 * BACKOFFICE-02 — turn the engine's unmatched lines into break records when the
 * variance EXCEEDS the configured threshold. Fee-class breaks route to Finance;
 * consent-record drift routes to Operations (PRD §7.1 BACKOFFICE-02). Every
 * break carries all three source refs. Break records are persisted + the teams
 * are notified by the reconciliation service.
 */

export type NotifyTeam = 'finance' | 'operations'

export interface DetectedBreak {
  line_type: ReconLineResult['line_type']
  channel: string
  client_id: string | null
  source_a_ref: string
  source_b_ref: string
  source_c_ref: string | null
  /** Fee breaks carry a money variance; consent-drift breaks carry a count. */
  variance_amount: Money | null
  variance_count: number | null
  reason: string
  notify_team: NotifyTeam
}

const abs = (n: number) => (n < 0 ? -n : n)

/**
 * Detect breaks from a reconciliation result. Only `unmatched` lines are
 * candidates (matched lines tie out; disputed lines are already tracked).
 */
export function detectBreaks(result: ReconResult, thresholds: BreakThreshold[] = DEFAULT_THRESHOLDS): DetectedBreak[] {
  const breaks: DetectedBreak[] = []
  for (const line of result.lines) {
    if (line.classification !== 'unmatched') continue
    const t = thresholdFor(line.line_type, thresholds)

    if (line.line_type === 'consent_record') {
      // Consent drift is counted; a single drifted line is a count of 1.
      const driftCount = 1
      if (driftCount > t.threshold_value) {
        breaks.push(makeBreak(line, { variance_amount: null, variance_count: driftCount, notify_team: 'operations' }))
      }
      continue
    }

    // Fee classes: the variance is the money delta. A missing line has no computed
    // variance — the entire line is unaccounted, which always exceeds a fee
    // threshold, so it is a break by construction (variance recorded where known).
    const varianceAmount = line.variance?.amount ?? null
    const exceeds = varianceAmount === null ? true : abs(varianceAmount) > t.threshold_value
    if (exceeds) {
      breaks.push(makeBreak(line, { variance_amount: line.variance, variance_count: null, notify_team: 'finance' }))
    }
  }
  return breaks
}

function makeBreak(
  line: ReconLineResult,
  over: { variance_amount: Money | null; variance_count: number | null; notify_team: NotifyTeam }
): DetectedBreak {
  return {
    line_type: line.line_type,
    channel: line.channel,
    client_id: line.client_id,
    source_a_ref: line.source_a_ref,
    source_b_ref: line.source_b_ref,
    source_c_ref: line.source_c_ref,
    variance_amount: over.variance_amount,
    variance_count: over.variance_count,
    reason: line.reason ?? 'variance',
    notify_team: over.notify_team
  }
}
