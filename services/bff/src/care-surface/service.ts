import type { CareSurfacePort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ConsentDirectory, IdentifierType } from '../consents/directory.js'

/**
 * BACKOFFICE-25 — care-surface token minting (ADR 0001 Option 1). Mints a
 * short-lived (<=15 min), request-scoped token carrying agent identity (act) and
 * PSU subject (sub) via the P1 CareSurfacePort. The agent (act) is the
 * authenticated caller — never the request body — so it cannot be spoofed; sub is
 * the PSU resolved to its internal id (never the raw identifier, which may be PII).
 * Exactly one High-class `care_token_minted` audit per mint.
 */

export const MINT_SCOPE = 'consents:admin'
const VALID_IDENTIFIER_TYPES: readonly string[] = ['bank_customer_id', 'iban', 'emirates_id']

export interface CareToken {
  token: string
  act: string
  sub: string
  expires_at: string
}

export class CareSurfaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface CareSurfaceDeps {
  careSurface: Pick<CareSurfacePort, 'mintCareToken'>
  directory: ConsentDirectory
  audit: HighClassAuditSink
}

export class CareSurfaceService {
  constructor(private readonly deps: CareSurfaceDeps) {}

  async mintToken(
    principal: Principal,
    input: { identifier_type: string; psu_identifier: string },
    traceId: string
  ): Promise<CareToken> {
    assertScope(principal, MINT_SCOPE) // service-layer defence in depth (→ 403)

    if (!VALID_IDENTIFIER_TYPES.includes(input.identifier_type)) {
      throw new CareSurfaceError(
        'BACKOFFICE.INVALID_IDENTIFIER_TYPE',
        `identifier_type must be one of: ${VALID_IDENTIFIER_TYPES.join(', ')}.`,
        400
      )
    }
    if (!input.psu_identifier) {
      throw new CareSurfaceError('BACKOFFICE.MISSING_IDENTIFIER', 'psu_identifier is required.', 400)
    }

    // Resolve the PSU to its internal id; sub carries the resolved id, never the raw
    // (possibly-PII) identifier the caller sent.
    const found = this.deps.directory.search(input.identifier_type as IdentifierType, input.psu_identifier)
    if (!found) {
      throw new CareSurfaceError('BACKOFFICE.PSU_NOT_FOUND', 'No PSU matches that identifier.', 404)
    }
    const psuId = found.psu.bank_customer_id

    const token = await this.deps.careSurface.mintCareToken(
      { agent_id: principal.subject, psu_id: psuId },
      { trace_id: traceId }
    )

    // Exactly one High-class audit. The raw psu_identifier is NOT recorded; the
    // target is the resolved internal id. act/sub are non-PII internal refs.
    await this.deps.audit.emit({
      event_type: 'care_token_minted',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: MINT_SCOPE,
      target_psu_identifier: psuId,
      request_trace_id: traceId,
      request_body: { identifier_type: input.identifier_type, act: token.act, sub: token.sub, expires_at: token.expires_at },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return token
  }
}
