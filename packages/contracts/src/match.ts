import { ROUTES, type Route } from './routes.generated.js'

/**
 * OpenAPI paths here include `:action` suffixes (`/consents/{consent_id}:revoke-admin`),
 * which break express/Hono `:param` syntax — so routes are matched with compiled
 * regexes where `{param}` → `([^/:]+)`: a param can never swallow a colon action.
 */

export interface RouteMatch {
  method: Route['method']
  path: string
  params: Record<string, string>
}

interface Compiled {
  route: Route
  regex: RegExp
  paramNames: string[]
}

function compile(route: Route): Compiled {
  const paramNames: string[] = []
  const pattern = route.path
    .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{(\w+)\}/g, (_m, name: string) => {
      paramNames.push(name)
      return '([^/:]+)'
    })
  return { route, regex: new RegExp(`^${pattern}$`), paramNames }
}

const COMPILED: Compiled[] = ROUTES.map(compile)

export function matchRoute(method: string, pathname: string): RouteMatch | null {
  const m = method.toLowerCase()
  for (const c of COMPILED) {
    if (c.route.method !== m) continue
    const hit = c.regex.exec(pathname)
    if (!hit) continue
    const params: Record<string, string> = {}
    c.paramNames.forEach((name, i) => {
      params[name] = hit[i + 1]!
    })
    return { method: c.route.method, path: c.route.path, params }
  }
  return null
}
