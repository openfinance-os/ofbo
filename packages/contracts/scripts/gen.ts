import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import openapiTS, { astToString } from 'openapi-typescript'
import { SPEC_PATH, listRoutes } from '../src/spec.js'

const here = dirname(fileURLToPath(import.meta.url))
const out = (f: string) => resolve(here, '../src', f)

const HEADER = '// AUTO-GENERATED from specs/backoffice-openapi.yaml — run `pnpm gen`. Do not edit.\n'

// 1. Types for the OpenAPI client
const ast = await openapiTS(new URL(`file://${SPEC_PATH}`))
writeFileSync(out('api-types.generated.ts'), HEADER + astToString(ast))

// 2. Static route table (the Workers-bound BFF never parses YAML at runtime)
const routes = listRoutes()
const body = `${HEADER}
export interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: string
  tag: string
  scope: string | null
  fourEyes: boolean
}

export const ROUTES: readonly Route[] = ${JSON.stringify(
  routes.map(({ parameters: _p, ...r }) => r),
  null,
  2
)} as const
`
writeFileSync(out('routes.generated.ts'), body)
console.log(`generated: api-types + ${routes.length} routes`)
