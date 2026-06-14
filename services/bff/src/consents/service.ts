import type { Principal } from '../auth.js'
import { assertScope, ScopeDeniedError } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { DemoConsentDirectory, type ConsentDirectory, type IdentifierType, type PsuConsentSearchResult } from './directory.js'

/**
 * BACKOFFICE-16 — PSU-centric consent search. Every call writes exactly one
 * High-class audit record carrying the searching agent's identity (PII redacted
 * at emission by the sink). Scope is enforced here too (service-layer defence in
 * depth, BACKOFFICE-43) — the BFF middleware is the first layer.
 */

export const SEARCH_SCOPE = 'consents:admin'
export const VALID_IDENTIFIER_TYPES: IdentifierType[] = ['bank_customer_id', 'iban', 'emirates_id']

export class ConsentSearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ConsentSearchDeps {
  directory?: ConsentDirectory
  audit: HighClassAuditSink
}

export class ConsentSearchService {
  private readonly directory: ConsentDirectory
  private readonly audit: HighClassAuditSink
  constructor(deps: ConsentSearchDeps) {
    this.directory = deps.directory ?? new DemoConsentDirectory()
    this.audit = deps.audit
  }

  async search(
    principal: Principal,
    identifierType: string,
    identifier: string,
    traceId: string
  ): Promise<PsuConsentSearchResult> {
    // Service-layer scope check (defence in depth on top of BFF middleware).
    try {
      assertScope(principal, SEARCH_SCOPE)
    } catch (e) {
      if (e instanceof ScopeDeniedError) throw new ConsentSearchError('BACKOFFICE.SCOPE_DENIED', e.message, 403)
      throw e
    }

    if (!VALID_IDENTIFIER_TYPES.includes(identifierType as IdentifierType)) {
      throw new ConsentSearchError(
        'BACKOFFICE.INVALID_IDENTIFIER_TYPE',
        'identifier_type must be one of: bank_customer_id, iban, emirates_id.',
        400
      )
    }
    if (!identifier) {
      throw new ConsentSearchError('BACKOFFICE.MISSING_IDENTIFIER', 'identifier is required.', 400)
    }

    const result = this.directory.search(identifierType as IdentifierType, identifier)

    // Exactly one High-class audit per search — found or not. The raw identifier
    // (PII for emirates_id/iban) is redacted at emission; the durable target is
    // the resolved internal bank_customer_id, never the raw PII value.
    await this.audit.emit({
      event_type: 'consent_search',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: SEARCH_SCOPE,
      target_psu_identifier: result?.psu.bank_customer_id ?? null,
      request_trace_id: traceId,
      request_body: { identifier_type: identifierType, identifier },
      response_status: result ? 200 : 404,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    if (!result) {
      throw new ConsentSearchError('BACKOFFICE.PSU_NOT_FOUND', 'No PSU matches that identifier.', 404)
    }
    return result
  }
}
