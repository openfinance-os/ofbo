import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { parse } from 'yaml'

/** Test/build-time spec access. Runtime code (Workers) must use the generated artifacts instead. */

export const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../specs/backoffice-openapi.yaml'
)

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
export type HttpMethod = (typeof METHODS)[number]

export interface RouteInfo {
  method: HttpMethod
  path: string
  tag: string
  scope: string | null
  fourEyes: boolean
  parameters: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawSpec = any

let cached: RawSpec | undefined

export function loadSpec(): RawSpec {
  cached ??= parse(readFileSync(SPEC_PATH, 'utf8'))
  return cached
}

function parameterName(spec: RawSpec, param: RawSpec): string | null {
  if (param?.$ref) {
    const key = String(param.$ref).split('/').at(-1)!
    return spec.components?.parameters?.[key]?.name ?? null
  }
  return param?.name ?? null
}

export function listRoutes(): RouteInfo[] {
  const spec = loadSpec()
  const routes: RouteInfo[] = []
  for (const [path, item] of Object.entries<RawSpec>(spec.paths)) {
    for (const method of METHODS) {
      const op = item?.[method]
      if (!op) continue
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])]
        .map((p: RawSpec) => parameterName(spec, p))
        .filter((n: string | null): n is string => n !== null)
      routes.push({
        method,
        path,
        tag: op.tags?.[0] ?? 'untagged',
        scope: op['x-required-scope'] ?? null,
        fourEyes: Boolean(op['x-four-eyes']),
        parameters: params
      })
    }
  }
  return routes
}
