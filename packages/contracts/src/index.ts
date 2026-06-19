import createClient from 'openapi-fetch'
import type { paths } from './api-types.generated.js'

export { ROUTES, type Route } from './routes.generated.js'
export { matchRoute, type RouteMatch } from './match.js'
export type { paths, components } from './api-types.generated.js'

export function createApiClient(baseUrl: string, fetchImpl?: typeof fetch) {
  return createClient<paths>({ baseUrl, fetch: fetchImpl })
}
