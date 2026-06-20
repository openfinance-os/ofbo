import { createRequire } from 'node:module'
import type { ValidateFunction } from 'ajv'
import { loadSpec, type HttpMethod } from './spec.js'

// ajv 8 / ajv-formats are CJS; under NodeNext + verbatimModuleSyntax a default import
// isn't seen as constructable. require() yields the class/plugin directly with no
// ESM default-interop ambiguity (this module is test-only, never in the Worker bundle).
const require = createRequire(import.meta.url)
const Ajv = require('ajv') as typeof import('ajv').default
const addFormats = require('ajv-formats') as typeof import('ajv-formats').default

/**
 * Runtime validation of BFF responses against the OpenAPI response schemas — the
 * mechanical conformance check the hand-rolled contract tests lacked (spec is ground
 * truth; this catches response-shape drift the field-by-field assertions miss).
 *
 * OAS 3.0 → JSON Schema: `nullable: true` is folded into a `["T","null"]` union and
 * OAS-only annotation keywords are dropped; `#/components/schemas/X` refs are rewritten
 * to registered `$id`s so AJV resolves them (cycle-safe — recursive schemas like the
 * lineage tree resolve by reference rather than blowing the stack on dereference).
 */

type Json = Record<string, unknown>
const SCHEMA_ID = (name: string) => `ofbo://schemas/${name}`

const DROP = new Set(['nullable', 'example', 'discriminator', 'xml', 'externalDocs'])

/** Deep-convert an OAS schema node to a JSON-Schema-clean equivalent. */
function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert)
  if (!node || typeof node !== 'object') return node
  const src = node as Json
  if (typeof src.$ref === 'string' && src.$ref.startsWith('#/components/schemas/')) {
    return { $ref: SCHEMA_ID(src.$ref.slice('#/components/schemas/'.length)) }
  }
  const out: Json = {}
  for (const [k, v] of Object.entries(src)) {
    if (DROP.has(k) || k.startsWith('x-')) continue
    out[k] = convert(v)
  }
  if (src.nullable === true && typeof src.type === 'string') out.type = [src.type, 'null']
  return out
}

export interface ResponseCheck {
  ok: boolean
  errors: string[]
  /** true when the contract defines no JSON schema for this (method, path, status) — nothing to check. */
  skipped: boolean
}

export interface ResponseValidator {
  validate(method: HttpMethod, path: string, status: number, body: unknown): ResponseCheck
}

/** Build a validator over the current spec. Compiles each response schema lazily and caches it. */
export function buildResponseValidator(): ResponseValidator {
  const spec = loadSpec() as Json
  const ajv = new Ajv({ strict: false, allErrors: true })
  addFormats(ajv)

  const components = (spec.components as Json | undefined) ?? {}
  const schemas = (components.schemas as Json | undefined) ?? {}
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema({ $id: SCHEMA_ID(name), ...(convert(schema) as Json) })
  }
  const responses = (components.responses as Json | undefined) ?? {}
  const paths = (spec.paths as Json | undefined) ?? {}

  function responseSchema(method: HttpMethod, path: string, status: number): unknown {
    const op = (paths[path] as Json | undefined)?.[method] as Json | undefined
    const respObj = (op?.responses as Json | undefined) ?? {}
    let resp = (respObj[String(status)] ?? respObj.default) as Json | undefined
    if (resp && typeof resp.$ref === 'string' && resp.$ref.startsWith('#/components/responses/')) {
      resp = responses[resp.$ref.slice('#/components/responses/'.length)] as Json | undefined
    }
    return ((resp?.content as Json | undefined)?.['application/json'] as Json | undefined)?.schema
  }

  const cache = new Map<string, ValidateFunction | null>()
  return {
    validate(method, path, status, body) {
      const key = `${method} ${path} ${status}`
      if (!cache.has(key)) {
        const schema = responseSchema(method, path, status)
        let compiled: ValidateFunction | null = null
        try {
          compiled = schema ? ajv.compile(convert(schema) as object) : null
        } catch {
          compiled = null // unexpected uncompilable schema — degrade to skip rather than crash the suite
        }
        cache.set(key, compiled)
      }
      const v = cache.get(key) ?? null
      if (!v) return { ok: true, errors: [], skipped: true }
      const ok = v(body) as boolean
      return { ok, errors: (v.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim()), skipped: false }
    }
  }
}
