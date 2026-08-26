import { PgBillingMemoStore, type LineageSink } from '@ofbo/db'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ReconciliationService } from '../reconciliation/service.js'
import { BillingMemoReconciliationService } from './memo-reconciliation.js'

/** Production composition seam used by the monthly scheduler and verified-email ingest adapter. */
export function createPgBillingMemoReconciliation(
  databaseUrl: string,
  tenancy: { bankId: string; channel: string },
  workflow: Pick<ReconciliationService, 'recordPreparedResult'>,
  audit: HighClassAuditSink,
  lineage?: LineageSink
): { service: BillingMemoReconciliationService; close: () => Promise<void> } {
  const store = new PgBillingMemoStore(databaseUrl, tenancy, lineage)
  return {
    service: new BillingMemoReconciliationService({ store, workflow, audit }),
    close: () => store.close()
  }
}

export function previousUtcMonth(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
}

/** The daily headless job emits the prior month's expectation exactly on day 3 UTC. */
export function isExpectedMemoGenerationDay(at: Date): boolean {
  return at.getUTCDate() === 3
}
