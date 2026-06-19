import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { LineageError, LineageService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'

/**
 * BACKOFFICE-49 — GET /back-office/lineage/{table_name} (compliance:reports:read).
 * Read-only; the column-level lineage tree rides the standard data envelope.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>
const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

export function lineageRoutes(service: LineageService): Record<string, Handler> {
  return {
    'get /back-office/lineage/{table_name}': async (c, params) => {
      try {
        return c.json(dataEnvelope(await service.readTable(c.get('principal'), params.table_name!, trace(c))), 200)
      } catch (e) {
        if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
        if (e instanceof LineageError) {
          return c.json(errorEnvelope(e.code, e.message, 'See the lineage contract (BACKOFFICE-49).', DOCS_BASE), e.status as ContentfulStatusCode)
        }
        throw e
      }
    }
  }
}
