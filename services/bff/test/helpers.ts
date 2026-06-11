/** Substitute every {param} with a fixed UUID so a template path becomes a concrete request path. */
export const FIXED_UUID = '4d2c2e2a-0000-4000-8000-000000000000'

export function toConcrete(templatePath: string): string {
  return templatePath.replace(/\{\w+\}/g, FIXED_UUID)
}

export const FAPI_HEADERS = { 'x-fapi-interaction-id': FIXED_UUID }

/** Authenticated demo-persona headers (P2 sim tokens; BACKOFFICE-47). */
export const AUTHED_HEADERS = {
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-super-admin'
}
