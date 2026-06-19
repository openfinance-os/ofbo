import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { LfiReportError, LfiReportService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-67 — GET cadence dashboard (compliance:reports:read) + POST verified
 * multipart ingest (compliance:reports:generate, Idempotency-Key). Scope is enforced
 * first by the BFF middleware; the service re-checks it.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof LfiReportError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the LFI-report contract (BACKOFFICE-67).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function lfiReportRoutes(service: LfiReportService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'get /back-office/lfi-reports': async (c) => {
      try {
        return c.json(dataEnvelope(await service.cadenceStatus(c.get('principal'))), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/lfi-reports': async (c) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(
          errorEnvelope(
            'BACKOFFICE.MISSING_IDEMPOTENCY_KEY',
            'The Idempotency-Key header is required on every mutating endpoint.',
            'Send a unique Idempotency-Key; replays within 24h return the original result.',
            DOCS_BASE
          ),
          400
        )
      }
      const cacheKey = `lfi-reports:ingest|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)

      let report_type: string | undefined
      let report_period: string | undefined
      let source_note: string | undefined
      let fileBytes: Uint8Array
      try {
        const body = await c.req.parseBody()
        report_type = typeof body.report_type === 'string' ? body.report_type : undefined
        report_period = typeof body.report_period === 'string' ? body.report_period : undefined
        source_note = typeof body.source_note === 'string' ? body.source_note : undefined
        const file = body.file
        if (!(file instanceof File)) {
          return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A multipart file field is required.', 'POST multipart/form-data with { file, report_type, report_period }.', DOCS_BASE), 400)
        }
        fileBytes = new Uint8Array(await file.arrayBuffer())
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A multipart/form-data body with a file is required.', 'Send { file, report_type, report_period, source_note? }.', DOCS_BASE), 400)
      }

      try {
        const record = await service.ingest(c.get('principal'), { report_type, report_period, source_note: source_note ?? null, fileBytes }, trace(c))
        const res = c.json(dataEnvelope(record), 201)
        await idempotency.set(cacheKey, 201, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
