/** Substitute every {param} with a fixed UUID so a template path becomes a concrete request path. */
export const FIXED_UUID = '4d2c2e2a-0000-4000-8000-000000000000'

export function toConcrete(templatePath: string): string {
  return templatePath.replace(/\{\w+\}/g, FIXED_UUID)
}

export const FAPI_HEADERS = { 'x-fapi-interaction-id': FIXED_UUID }

/** Authenticated demo-persona headers (P2 sim tokens; BACKOFFICE-47). */
export const AUTHED_HEADERS = {
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-super-admin',
  // BACKOFFICE-80 guardrail d: super-admin mutations carry a recorded justification
  'x-superadmin-justification': 'contract test sweep across all routes (BACKOFFICE-80)'
}

/**
 * Every camelCase KEY at every depth — the shape check behind CLAUDE.md's snake_case convention.
 *
 * The obvious spelling, `JSON.stringify(payload).not.toMatch(/[a-z][A-Z]/)`, scans the serialised
 * payload and so matches VALUES too: a `tpp_id` of `orgTabby`, a source ref like `invRef1A`, or a
 * product-family label would fail an otherwise-conformant response. That is a false-failure hazard
 * on the assertion that guards the convention, which is the worst place to have one. This walks
 * keys only.
 */
export function camelCaseKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) camelCaseKeys(item, acc)
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (/[a-z][A-Z]/.test(key)) acc.push(key)
      camelCaseKeys(nested, acc)
    }
  }
  return acc
}
