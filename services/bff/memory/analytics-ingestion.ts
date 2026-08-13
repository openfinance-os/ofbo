// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/analytics/ingestion.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { SnapshotRow, WarmTierExporter } from '../src/analytics/ingestion.js'

export class InMemoryWarmTierExporter implements WarmTierExporter {
  readonly objects = new Map<string, string>()
  async export(snapshot: SnapshotRow): Promise<{ object_key: string }> {
    // Columnar-shaped blob (the format the enterprise adapter swaps for Parquet).
    const columns: Record<string, unknown[]> = {}
    for (const row of snapshot.rows) {
      for (const [k, v] of Object.entries(row)) (columns[k] ??= []).push(v)
    }
    const objectKey = `nebras/${snapshot.source}/${snapshot.period}/${snapshot.snapshot_id}.parquet`
    this.objects.set(objectKey, JSON.stringify({ row_count: snapshot.rows.length, columns }))
    return { object_key: objectKey }
  }
}
