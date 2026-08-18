import { createHash } from 'node:crypto'
import {
  toWireMoneyTriple,
  UnparseableDocumentError,
  nebrasTaxInvoiceParser,
  type ParsedTppCostDocument,
  type TppCostDocumentParser,
  type TppCostDocumentType
} from '@ofbo/billing'
import { BillingTppCostDocumentConflictError } from '@ofbo/db'
import type { ItsmPort } from '@ofbo/ports'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { assertScope } from '../rbac.js'
import type { Principal } from '../auth.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied } from '../errors.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

/**
 * BILL-14 — ingest a provider cost document (ADR 0007 D9, IG v5.0 §10).
 *
 * The payable twin of the BACKOFFICE-73 billing-records ingest, and deliberately the same posture:
 * a verified manual upload with an integrity hash, BCBS 239 lineage, and second-person verification
 * recorded rather than inferred.
 *
 * Two things here are stricter than the receivable side, both because migration 0039's document
 * tables are INSERT-only with no deletion path:
 *
 * - **Redaction is the parser's job and is re-checked by the store.** This service never sees an
 *   unredacted payload, because `parse` returns an already-redacted one and there is no accessor for
 *   the raw. What it does own is the raw ARTIFACT: the bytes are hashed for integrity and retained
 *   outside the ledger, so the original remains auditable without the ledger carrying its contents.
 * - **The verifier may not be the uploader.** The uploader is taken from the verified P2 subject
 *   claim, never from the body, and an upload nominating the uploader as its own verifier is refused.
 */

export const BILLING_WRITE_SCOPE = 'billing:write'

export class TppCostDocumentError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'TppCostDocumentError'
  }
}

export interface TppCostDocumentStore {
  saveDocument(
    input: {
      document: ParsedTppCostDocument
      documentSha256: string
      rawDocumentRef: string
      receivedAt: string
      verifiedBy: string
      verifiedAt: string
      idempotencyKey: string
    },
    traceId: string
  ): Promise<{
    record: {
      id: string
      documentReference: string
      /** As STORED. On a replay these differ from what this request supplied — see the store. */
      documentSha256?: string
      receivedAt?: string
      verifiedBy?: string
      verifiedAt?: string
    }
    created: boolean
  }>
  documentsForPeriod(period: string): Promise<Array<{ id: string; documentType: string; documentReference: string }>>
}

/** Where the raw artifact is retained. Outside the ledger, so the ledger carries no provider bytes. */
export interface RawDocumentArchive {
  put(input: { reference: string; sha256: string; bytes: Uint8Array }): Promise<{ ref: string }>
}

export interface TppCostDocumentIngestDeps {
  store: TppCostDocumentStore
  audit: HighClassAuditSink
  archive: RawDocumentArchive
  /** Parsers by document type. The seam a PDF/EDI/API transport plugs into. */
  parsers?: Partial<Record<TppCostDocumentType, TppCostDocumentParser>>
  now?: () => Date
}

export interface TppCostDocumentIngestInput {
  documentType?: string
  billingPeriod?: string
  /** Nominates the second person. Checked against the caller's own claim and refused when equal. */
  verifiedBy?: string
  sourceNote?: string | null
  fileBytes?: Uint8Array
}

export interface TppCostDocumentIngestResult {
  document: ParsedTppCostDocument
  id: string
  created: boolean
  unmappedLineCount: number
  redactedFieldCount: number
  documentSha256: string
  receivedAt: string
  verifiedBy: string
  verifiedAt: string
}

const DOCUMENT_TYPES: readonly TppCostDocumentType[] = [
  'nebras_tax_invoice', 'nebras_settlement_statement', 'lfi_self_invoice',
  'credit_note', 'debit_note', 'manual_adjustment'
]

/** Case- and padding-insensitive, so one human under two spellings cannot pass as two people. */
function normalisePrincipal(value: string): string {
  return value.trim().toLowerCase()
}

export class TppCostDocumentIngestService {
  private readonly now: () => Date
  private readonly parsers: Partial<Record<TppCostDocumentType, TppCostDocumentParser>>

  constructor(private readonly deps: TppCostDocumentIngestDeps) {
    this.now = deps.now ?? (() => new Date())
    this.parsers = deps.parsers ?? { nebras_tax_invoice: nebrasTaxInvoiceParser }
  }

  async ingest(
    principal: Principal,
    input: TppCostDocumentIngestInput,
    idempotencyKey: string,
    traceId: string
  ): Promise<TppCostDocumentIngestResult> {
    assertScope(principal, BILLING_WRITE_SCOPE)

    const documentType = input.documentType as TppCostDocumentType | undefined
    if (!documentType || !DOCUMENT_TYPES.includes(documentType)) {
      throw new TppCostDocumentError(
        'BACKOFFICE.INVALID_DOCUMENT_TYPE',
        `document_type must be one of: ${DOCUMENT_TYPES.join(', ')}.`,
        400
      )
    }
    if (!input.billingPeriod || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(input.billingPeriod)) {
      throw new TppCostDocumentError('BACKOFFICE.INVALID_BODY', 'billing_period must be YYYY-MM.', 400)
    }
    if (!input.fileBytes || input.fileBytes.byteLength === 0) {
      throw new TppCostDocumentError('BACKOFFICE.INVALID_BODY', 'A non-empty file is required (multipart/form-data).', 400)
    }
    if (!input.verifiedBy || input.verifiedBy.trim() === '') {
      throw new TppCostDocumentError(
        'BACKOFFICE.INVALID_BODY',
        'verified_by is required: a manual upload is only evidence if a second person verified it.',
        400
      )
    }

    // The uploader comes from the verified claim, never the body. Distinctness is enforced here
    // because the schema cannot: verified_by is a denormalised evidence column.
    //
    // Honest about what this does and does not prove: it proves the recorded verifier is a DIFFERENT
    // principal from the uploader. It does not prove that verifier authenticated — a request carries
    // one credential. An operation needing proof of the second person's own authority is four-eyes
    // gated (202 + approval_request), which this ingest deliberately is not, matching BACKOFFICE-67.
    const uploader = principal.subject
    if (normalisePrincipal(input.verifiedBy) === normalisePrincipal(uploader)) {
      throw new TppCostDocumentError(
        'BACKOFFICE.SELF_VERIFICATION_REFUSED',
        'The verifier of a manual upload cannot be its uploader.',
        409
      )
    }

    const parser = this.parsers[documentType]
    if (!parser) {
      throw new TppCostDocumentError(
        'BACKOFFICE.UNSUPPORTED_DOCUMENT_TYPE',
        `No parser is configured for ${documentType}. Parsing sits behind an adapter; a transport for `
        + 'this document type has not been wired.',
        400
      )
    }

    const raw = Buffer.from(input.fileBytes)
    const documentSha256 = `sha256:${createHash('sha256').update(raw).digest('hex')}`

    let document: ParsedTppCostDocument
    try {
      document = parser.parse(JSON.parse(raw.toString('utf8')))
    } catch (error) {
      if (error instanceof UnparseableDocumentError || error instanceof SyntaxError) {
        throw new TppCostDocumentError('BACKOFFICE.UNPARSEABLE_DOCUMENT', error.message, 422)
      }
      throw error
    }
    if (document.billingPeriod !== input.billingPeriod) {
      throw new TppCostDocumentError(
        'BACKOFFICE.PERIOD_MISMATCH',
        `the document states billing period ${document.billingPeriod}, the request says ${input.billingPeriod}.`,
        422
      )
    }

    const nowIso = this.now().toISOString()
    let saved: Awaited<ReturnType<TppCostDocumentStore['saveDocument']>>
    try {
      // Retain the original outside the ledger FIRST, so the ledger row can point at it — but only
      // after every refusal above has passed. An earlier version archived before validating, so a
      // document rejected as a conflict had already had its raw bytes retained. The archive holds
      // UNREDACTED provider content, which is the point (the original must stay auditable) and also
      // why it must not accumulate copies of documents we refused.
      //
      // Obligations on whoever implements RawDocumentArchive, since the interface cannot enforce them:
      // tenant-scoped access, the same 24-month/5-year retention as the ledger, a classification no
      // weaker than confidential-restricted, and no cross-tenant read. It is deliberately NOT one of
      // the cost tables for that reason — an unredacted artifact does not belong behind the
      // governed-aggregate seam.
      const archived = await this.deps.archive.put({
        reference: document.documentReference, sha256: documentSha256, bytes: input.fileBytes
      })
      saved = await this.deps.store.saveDocument({
        document,
        documentSha256,
        rawDocumentRef: archived.ref,
        receivedAt: nowIso,
        verifiedBy: input.verifiedBy,
        verifiedAt: nowIso,
        idempotencyKey
      }, traceId)
    } catch (error) {
      // Typed, not message-matched: the same reference with a different body is a provider
      // restatement and answers 409, while anything else is a defect and must surface as one.
      if (error instanceof BillingTppCostDocumentConflictError) {
        throw new TppCostDocumentError('BACKOFFICE.DOCUMENT_CONFLICT', error.message, 409)
      }
      throw error
    }

    if (saved.created) {
      await this.deps.audit.emit({
        event_type: 'billing_tpp_cost_document_ingested',
        acting_principal: uploader,
        acting_persona: String(principal.persona),
        scope_used: BILLING_WRITE_SCOPE,
        request_trace_id: traceId,
        response_status: 201,
        request_body: {
          document_id: saved.record.id,
          document_type: documentType,
          document_reference: document.documentReference,
          billing_period: document.billingPeriod,
          issuer_id: document.issuerId,
          net_milli_fils: document.netMilliFils,
          vat_milli_fils: document.vatMilliFils,
          gross_milli_fils: document.grossMilliFils,
          document_sha256: documentSha256,
          verified_by: input.verifiedBy,
          // Provenance the operator typed (e.g. "email received 3 Jul, from billing@…"). There is no
          // column for it on billing_tpp_cost_document, and the contract accepts the field — so it is
          // recorded here, in the INSERT-only audit trail, rather than accepted and silently dropped.
          ...(input.sourceNote ? { source_note: input.sourceNote } : {}),
          unmapped_line_count: document.unmappedLineCount,
          // Counts and key PATHS only — never the redacted values.
          redacted_field_count: document.redactedFieldCount,
          redacted_paths: document.redactedPaths
        }
      })
    }

    return {
      document,
      id: saved.record.id,
      created: saved.created,
      unmappedLineCount: document.unmappedLineCount,
      redactedFieldCount: document.redactedFieldCount,
      // The verified-manual-upload evidence the endpoint description leans on. An earlier version
      // computed all four and then omitted them from the response, which made the integrity hash and
      // the second-person record unverifiable by the caller that just supplied them.
      //
      // On a replay we report what is STORED, not what this request carried. Dedupe keys on commercial
      // substance rather than bytes, so a byte-different file stating the same charges takes the 200
      // path — and returning this request's own sha256 would hand back a hash matching no stored row,
      // breaking exactly the reconciliation the field exists for.
      documentSha256: saved.record.documentSha256 ?? documentSha256,
      receivedAt: saved.record.receivedAt ?? nowIso,
      verifiedBy: saved.record.verifiedBy ?? input.verifiedBy,
      verifiedAt: saved.record.verifiedAt ?? nowIso
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------

/** Wire shape for the ingested document — snake_case, per the API conventions. */
export function tppCostDocumentWire(result: TppCostDocumentIngestResult): Record<string, unknown> {
  const { id, document } = result
  return {
    document_id: id,
    document_sha256: result.documentSha256,
    received_at: result.receivedAt,
    verified_by: result.verifiedBy,
    verified_at: result.verifiedAt,
    document_type: document.documentType,
    issuer_id: document.issuerId,
    recipient_id: document.recipientId,
    document_reference: document.documentReference,
    billing_period: document.billingPeriod,
    currency: document.currency,
    // Money at the boundary. Milli-fils is a rating and storage precision (ADR 0007 prices tariffs at
    // 2.5 and 0.5 fils); the wire carries the binding convention's integer minor units. `gross` is
    // derived from the rounded parts by toWireMoneyTriple so net + VAT always ties on the wire.
    ...(() => {
      const money = toWireMoneyTriple({
        netMilliFils: document.netMilliFils,
        vatMilliFils: document.vatMilliFils,
        grossMilliFils: document.grossMilliFils
      }, document.currency)
      return { net: money.net, vat: money.vat, gross: money.gross }
    })(),
    issued_at: document.issuedAt,
    unmapped_line_count: document.unmappedLineCount,
    redacted_field_count: document.redactedFieldCount,
    lines: document.lines.map((line) => ({
      line_ref: line.lineRef,
      source_category: line.sourceCategory,
      fee_class: line.feeClass,
      mapped: line.mapped,
      cost_recipient_type: line.costRecipientType,
      cost_recipient_id: line.costRecipientId,
      units: line.units,
      // A unit RATE, not an amount, so it stays integer milli-fils: the convention governs money
      // amounts, and rounding a 2.5-fils scheme tariff to 3 would destroy the price itself.
      unit_price_milli_fils: line.unitPriceMilliFils,
      ...(() => {
        const money = toWireMoneyTriple({
          netMilliFils: line.actualNetMilliFils,
          vatMilliFils: line.vatMilliFils,
          grossMilliFils: line.actualGrossMilliFils
        }, document.currency)
        return { actual_net: money.net, vat: money.vat, actual_gross: money.gross }
      })()
    }))
  }
}
/**
 * `POST /back-office/billing/tpp-cost-documents`.
 *
 * Multipart, replay-protected by `Idempotency-Key`. A replay returns 200 with the stored document; a
 * first ingest returns 201. Every rejection the service raises carries its own API code and status,
 * so the handler maps rather than re-decides.
 */
export function tppCostDocumentRoutes(
  service: TppCostDocumentIngestService,
  idempotency: IdempotencyStore
): Record<string, Handler> {
  return {
    'post /back-office/billing/tpp-cost-documents': replayable(
      idempotency,
      (_params, subject, key) => `billing:tpp-cost-document|${subject}|${key}`,
      async (c) => {
        let fields: { documentType?: string; billingPeriod?: string; verifiedBy?: string; sourceNote?: string }
        let bytes: Uint8Array
        try {
          const body = await c.req.parseBody()
          fields = {
            ...(typeof body.document_type === 'string' ? { documentType: body.document_type } : {}),
            ...(typeof body.billing_period === 'string' ? { billingPeriod: body.billing_period } : {}),
            ...(typeof body.verified_by === 'string' ? { verifiedBy: body.verified_by } : {}),
            ...(typeof body.source_note === 'string' ? { sourceNote: body.source_note } : {})
          }
          const file = body.file
          if (!(file instanceof File)) {
            return c.json(errorEnvelope(
              'BACKOFFICE.INVALID_BODY', 'A multipart file field is required.',
              'POST multipart/form-data with { file, document_type, billing_period, verified_by }.', DOCS_BASE
            ), 400)
          }
          bytes = new Uint8Array(await file.arrayBuffer())
        } catch {
          return c.json(errorEnvelope(
            'BACKOFFICE.INVALID_BODY', 'A multipart/form-data body with a file is required.',
            'Send { file, document_type, billing_period, verified_by, source_note? }.', DOCS_BASE
          ), 400)
        }

        const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
        const idempotencyKey = c.req.header('idempotency-key') ?? ''
        try {
          const result = await service.ingest(c.get('principal'), { ...fields, fileBytes: bytes }, idempotencyKey, traceId)
          return c.json(dataEnvelope(tppCostDocumentWire(result)), result.created ? 201 : 200)
        } catch (error) {
          if (error instanceof TppCostDocumentError) {
            return c.json(
              errorEnvelope(error.code, error.message, 'See the endpoint description for the accepted document layouts.', DOCS_BASE),
              error.status as ContentfulStatusCode
            )
          }
          const denied = scopeDenied(c, error)
          if (denied) return denied
          throw error
        }
      }
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Missing-document alarm
// ---------------------------------------------------------------------------------------------

/**
 * The scheme billing calendar anchor: the invoice/memo is due on or before the 5th of the month
 * following the period, moving to the next business day when the 5th is a weekend (IG §10.12.3).
 *
 * Weekend only — public holidays are an institution calendar the Back Office does not own, so the
 * anchor errs LATE rather than alarming on a day the Hub was never obliged to deliver. Reporting
 * non-receipt is the participant's own obligation (IG §10.12.2), which is what makes this a
 * compliance control rather than a convenience.
 */
export function documentDueAnchor(period: string, dayOfMonth = 5): Date {
  const match = /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(period)
  if (!match) throw new RangeError(`period must be YYYY-MM, received ${period}`)
  const year = Number(match[1])
  const month = Number(match[2])
  // The month AFTER the billing period, in UTC.
  const anchor = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, dayOfMonth))
  // 0 = Sunday, 6 = Saturday. UAE business week is Monday–Friday for scheme settlement purposes.
  while (anchor.getUTCDay() === 0 || anchor.getUTCDay() === 6) {
    anchor.setUTCDate(anchor.getUTCDate() + 1)
  }
  return anchor
}

export interface DocumentAbsenceAlarmDeps {
  store: Pick<TppCostDocumentStore, 'documentsForPeriod'>
  itsm: ItsmPort
  audit: HighClassAuditSink
  now?: () => Date
  dayOfMonth?: number
}

export interface DocumentAbsenceAlarmResult {
  status: 'not_due' | 'received' | 'raised'
  dueAt: string
  ticketId?: string
}

/**
 * Raise a P3 ticket when no provider invoice has arrived for a closed period by its calendar anchor.
 *
 * Fires only ONCE the anchor has passed — alarming early would train operators to ignore it — and
 * only when no document of an invoicing type exists for the period.
 */
export class TppCostDocumentAbsenceAlarm {
  private readonly now: () => Date
  private readonly dayOfMonth: number

  constructor(private readonly deps: DocumentAbsenceAlarmDeps) {
    this.now = deps.now ?? (() => new Date())
    this.dayOfMonth = deps.dayOfMonth ?? 5
  }

  async check(period: string, traceId: string): Promise<DocumentAbsenceAlarmResult> {
    const dueAt = documentDueAnchor(period, this.dayOfMonth)
    const dueIso = dueAt.toISOString()
    if (this.now().getTime() < dueAt.getTime()) return { status: 'not_due', dueAt: dueIso }

    const documents = await this.deps.store.documentsForPeriod(period)
    const invoicing = documents.filter((doc) =>
      doc.documentType === 'nebras_tax_invoice' || doc.documentType === 'nebras_settlement_statement')
    if (invoicing.length > 0) return { status: 'received', dueAt: dueIso }

    const ticket = await this.deps.itsm.createTicket({
      type: 'billing.tpp_cost.document_missing',
      severity: 'high',
      team: 'finance-operations',
      summary: `No Nebras invoice or settlement statement received for ${period}; due by ${dueIso}. `
        + 'IG v5.0 §10.12.2 makes reporting non-receipt the participant obligation.'
    }, { trace_id: traceId })

    await this.deps.audit.emit({
      event_type: 'billing_tpp_cost_document_missing',
      acting_principal: 'system:billing-document-alarm',
      acting_persona: 'system',
      scope_used: BILLING_WRITE_SCOPE,
      request_trace_id: traceId,
      response_status: 201,
      request_body: { period, due_at: dueIso, ticket_id: ticket.ticket_id }
    })

    return { status: 'raised', dueAt: dueIso, ticketId: ticket.ticket_id }
  }
}
