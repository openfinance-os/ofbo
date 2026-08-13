import { PgBillingMeteringStore, type LineageSink } from '@ofbo/db'
import type { RateCard } from '@ofbo/billing'
import { BillingMeteringIngestService } from './metering-ingest.js'

/** Production composition seam for a Kong, Ozone Connect, queue, or batch adapter. */
export function createPgBillingMeteringIngest(
  databaseUrl: string,
  tenancy: { bankId: string; channel: string },
  card: RateCard,
  lineage?: LineageSink
): { service: BillingMeteringIngestService; close: () => Promise<void> } {
  const store = new PgBillingMeteringStore(databaseUrl, tenancy, lineage)
  return {
    service: new BillingMeteringIngestService(store, card),
    close: () => store.close()
  }
}
