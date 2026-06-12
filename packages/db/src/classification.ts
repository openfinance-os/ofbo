import pg from 'pg'

/**
 * BACKOFFICE-54: classification mismatch detection. A record classified BELOW
 * its table's floor is a governance defect — surfaced here, raised to
 * Compliance review (Risk signal + ITSM wiring lands with the M4 views).
 */

const ORDER: Record<string, number> = {
  'internal-confidential': 0,
  'confidential-restricted': 1,
  restricted: 2
}

export interface ClassificationMismatch {
  table_name: string
  floor: string
  below_floor_count: number
}

export async function validateClassificationFloors(
  databaseUrl: string
): Promise<{ checked: number; mismatches: ClassificationMismatch[] }> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const policies = await pool.query(`SELECT table_name, floor FROM classification_policy ORDER BY table_name`)
    const mismatches: ClassificationMismatch[] = []
    for (const p of policies.rows) {
      if (!/^[a-z_][a-z0-9_]*$/.test(p.table_name)) throw new Error(`invalid table name in classification_policy: ${p.table_name}`)
      const below = Object.entries(ORDER)
        .filter(([, rank]) => rank < ORDER[p.floor]!)
        .map(([name]) => name)
      if (below.length === 0) continue
      const r = await pool.query(
        `SELECT count(*)::int AS n FROM ${p.table_name} WHERE classification = ANY($1)`,
        [below]
      )
      if (r.rows[0].n > 0) {
        mismatches.push({ table_name: p.table_name, floor: p.floor, below_floor_count: r.rows[0].n })
      }
    }
    return { checked: policies.rows.length, mismatches }
  } finally {
    await pool.end()
  }
}
