// Public readiness wizard routes (ADR 0022). These are the ONLY unauthenticated handlers — the
// auth/scope/FAPI/justification/spend middlewares skip `/public/*` (see app.ts skipPublic). They
// never read c.get('principal') and never touch an admin-scoped service or regulated store.

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ReadinessService } from './service.js'
import { ReadinessInputError, type AssessmentInput } from './scoring.js'

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const READINESS_DOCS = `${DOCS_BASE}#tag/readiness`

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>
  } catch {
    throw new ReadinessInputError('BACKOFFICE.INVALID_BODY', 'A JSON request body is required.')
  }
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof ReadinessInputError) {
    return c.json(
      errorEnvelope(e.code, e.message, 'Map ports to options from /public/readiness/catalog; decisions are optional.', READINESS_DOCS),
      e.status as ContentfulStatusCode
    )
  }
  throw e
}

export function readinessRoutes(service: ReadinessService): Record<string, Handler> {
  return {
    'get /public/readiness/catalog': async (c) => {
      return c.json(dataEnvelope(service.catalog()), 200)
    },

    'post /public/readiness:assess': async (c) => {
      try {
        const body = await jsonBody(c)
        return c.json(dataEnvelope(service.assess(body as unknown as AssessmentInput)), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /public/readiness/profiles': async (c) => {
      try {
        const body = await jsonBody(c)
        const profile = await service.saveProfile(
          typeof body.name === 'string' ? body.name : '',
          (body.input as AssessmentInput | undefined) ?? ({} as AssessmentInput)
        )
        return c.json(dataEnvelope(profile), 201)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /public/readiness/profiles/{slug}': async (c, params) => {
      try {
        const profile = await service.getProfile(params.slug ?? '')
        if (!profile) {
          return c.json(
            errorEnvelope(
              'BACKOFFICE.READINESS_PROFILE_NOT_FOUND',
              `No readiness profile for slug "${params.slug}".`,
              'Check the share link, or create a new profile via POST /public/readiness/profiles.',
              READINESS_DOCS
            ),
            404
          )
        }
        return c.json(dataEnvelope(profile), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
