import { cache } from 'react'
import { listPendingApprovals } from './approvals'

/**
 * UX-03b — nav badge counts for the app shell. Currently the pending four-eyes count, so an
 * approver notices work waiting from any screen (the approvals entry is always visible — any
 * persona may hold an approver scope). Wrapped in React cache() so it resolves at most once
 * per render; tolerant of a failing/cold BFF (returns no badge rather than breaking the shell).
 * One extra GET per navigation — acceptable for the demo profile; swap for a cached/edge source
 * if it ever shows on the hot path.
 */
export const shellBadges = cache(async (token: string): Promise<Record<string, number>> => {
  try {
    const { approvals } = await listPendingApprovals(token)
    return approvals.length > 0 ? { approvals: approvals.length } : {}
  } catch {
    return {}
  }
})
