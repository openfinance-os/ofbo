import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'

/**
 * BACKOFFICE-28 — Operations Console read stores. platform_certification (status
 * per role) and platform_outage (active/resolved outages). Read-only here: rows are
 * seeded (M0 seed emits lineage) and progress via the operations write surface in a
 * later story. RLS binds — reads run as ofbo_app with the tenancy context set.
 */

export interface StoredCertification {
  certification_id: string
  role: string
  subject: string
  track: string
  current_stage: string
  stages_total: number
  stages_completed: number
  status: string
  updated_at: string
}

export interface StoredOutage {
  outage_id: string
  title: string
  component: string
  severity: string
  status: string
  started_at: string
  resolved_at: string | null
}

const CERT_COLS = `id, role, subject, track, current_stage, stages_total, stages_completed, status, updated_at`
const OUTAGE_COLS = `id, title, component, severity, status, started_at, resolved_at`
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toCert(r: Record<string, unknown>): StoredCertification {
  return {
    certification_id: r.id as string,
    role: r.role as string,
    subject: r.subject as string,
    track: r.track as string,
    current_stage: r.current_stage as string,
    stages_total: Number(r.stages_total),
    stages_completed: Number(r.stages_completed),
    status: r.status as string,
    updated_at: iso(r.updated_at)
  }
}
function toOutage(r: Record<string, unknown>): StoredOutage {
  return {
    outage_id: r.id as string,
    title: r.title as string,
    component: r.component as string,
    severity: r.severity as string,
    status: r.status as string,
    started_at: iso(r.started_at),
    resolved_at: r.resolved_at ? iso(r.resolved_at) : null
  }
}

abstract class TenantReadStore {
  protected readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    protected readonly config: { bankId: string; channel: string }
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }
  protected async asApp<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query(beginAppTx(this.config.bankId))
      const out = await fn(c)
      await c.query('COMMIT')
      return out
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }
  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class PgCertificationStore extends TenantReadStore {
  async list(): Promise<StoredCertification[]> {
    const rows = await this.asApp(async (c) => (await c.query(`SELECT ${CERT_COLS} FROM platform_certification ORDER BY role, subject`)).rows)
    return rows.map(toCert)
  }
}

export class PgOutageStore extends TenantReadStore {
  /** Active outages (status='active'), most recent first — for the Ops Console. */
  async listActive(): Promise<StoredOutage[]> {
    const rows = await this.asApp(async (c) =>
      (await c.query(`SELECT ${OUTAGE_COLS} FROM platform_outage WHERE status = 'active' ORDER BY started_at DESC`)).rows
    )
    return rows.map(toOutage)
  }
}
