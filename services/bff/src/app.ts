import { Hono } from 'hono'
import { matchRoute } from '@ofbo/contracts'
import { errorEnvelope, DOCS_BASE } from './envelope.js'

/**
 * M0 stub BFF: every contract path resolves (via the colon-action-safe matcher,
 * NOT framework path syntax) and returns the binding 501 envelope. Stories
 * replace stubs route-by-route; the [contract-pending] it.fails suite enforces
 * that flip.
 */
export function createApp() {
  const app = new Hono()

  app.use('*', async (c, next) => {
    const fapi = c.req.header('x-fapi-interaction-id')
    if (!fapi) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.MISSING_FAPI_INTERACTION_ID',
          'The x-fapi-interaction-id header is required on every request.',
          'Send a UUID v4 in the x-fapi-interaction-id header; it is propagated end-to-end as the trace id.',
          DOCS_BASE
        ),
        400
      )
    }
    c.header('x-fapi-interaction-id', fapi)
    await next()
  })

  app.all('*', (c) => {
    const url = new URL(c.req.url)
    const match = matchRoute(c.req.method, url.pathname)
    if (!match) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.ROUTE_NOT_FOUND',
          `${c.req.method} ${url.pathname} is not part of the Back Office contract.`,
          'Check the path against specs/backoffice-openapi.yaml — the contract is ground truth.',
          DOCS_BASE
        ),
        404
      )
    }
    return c.json(
      errorEnvelope(
        'BACKOFFICE.NOT_IMPLEMENTED',
        `${match.method.toUpperCase()} ${match.path} is specified but its story has not been implemented yet.`,
        'Implement the owning BACKOFFICE story (PRD §7); contract tests must be written first.',
        DOCS_BASE
      ),
      501
    )
  })

  return app
}
