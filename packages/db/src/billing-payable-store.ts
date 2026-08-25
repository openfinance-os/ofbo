import { createHash } from 'node:crypto'
import pg from 'pg'
import { payableLedgerDispatchState, redactProviderPayload } from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BILL-16 — the write path for the cost-period close and P9 AP dispatch.
 *
 * TWO CLASSES, NOT ONE, AND NOT BOLTED ONTO PgBillingTppCostStore. The dispatch service's own
 * comment states that its store surface is "deliberately two methods — one read, one append of a
 * dispatch record", so that "dispatch cannot mutate billing evidence" holds by construction rather
 * than by everyone remembering not to. Adding `recordDispatch` to PgBillingTppCostStore — which can
 * write statements, documents and reconciliations — would have quietly destroyed that property
 * while leaving the comment that claims it. The claim is only worth anything if the object handed
 * to the service genuinely cannot reach those tables, so each class here exposes exactly the
 * methods its service's interface declares and nothing else.
 *
 * WHAT THE SCHEMA CANNOT CARRY, AND IS THEREFORE ENFORCED HERE. Migration 0039 documents three
 * obligations it pushes onto this layer, each because the constraint it would need is over MUTABLE
 * state on another row:
 *
 *   (a) the cited approval must be in state 'approved' and must have been approved INSIDE its
 *       window — a foreign key constrains existence and tenant, never state or expiry;
 *   (b) `initiated_by` and `approved_by` must be one normalised principal each, taken from the
 *       approval RECORD rather than from operator-supplied input — the CHECK can only prove two
 *       strings differ, not that they name two authenticated humans;
 *   (c) `response_payload` is provider-fed free-form in an INSERT-only family with no deletion
 *       path, so it must be redacted before the first INSERT and re-checked at the boundary that
 *       makes the write permanent.
 *
 * (a) and (b) are discharged by reading approval_request inside the same tenant transaction as the
 * INSERT and stamping from it. Doing the read in the caller and passing the values down would put
 * an operator-shaped argument back in the middle of the evidence chain, which is the defect.
 */

/** Latest-row-wins lifecycle, mirroring the `dispatch_state` CHECK in migration 0039 exactly. */
export type PayableDispatchState = 'pending' | 'dispatched' | 'accepted' | 'rejected' | 'failed'

/**
 * Which states may legally follow which.
 *
 * The UNIQUE (bank_id, idempotency_key, dispatch_state) constraint bounds each state to one row per
 * instruction, but 0039 is explicit that it "constrains no transition ORDER" and that refusing an
 * illegal sequence — an `accepted` appended after a `rejected` — is this write path's job. Terminal
 * states have no successors, so a rejected debit cannot later be recorded as collected.
 */
const LEGAL_NEXT: Record<PayableDispatchState, readonly PayableDispatchState[]> = {
  pending: ['dispatched', 'failed', 'rejected'],
  dispatched: ['accepted', 'rejected', 'failed'],
  accepted: [],
  rejected: [],
  failed: []
}

/**
 * Re-exported, not redefined. The mapping is a domain fact and lives in `@ofbo/billing`, where both
 * this store and the BFF service that reports the state on the wire read the same one.
 */
export const dispatchStateForPayableStatus = payableLedgerDispatchState

/**
 * A refusal from the write path, carrying the HTTP status the contract declares for it.
 *
 * The status lives here rather than in a mapping table at the route because the store is what
 * decides WHICH refusal occurred, and a route-side lookup keyed on the code drifts the moment a new
 * refusal is added — which is how these ended up as unhandled 500s: `PayableWriteError` was mapped
 * nowhere in the BFF, so the declared 404 and 409 branches were unreachable on the deployed path.
 */
const WRITE_ERROR_STATUS: Record<string, number> = {
  'BACKOFFICE.NOT_FOUND': 404,
  'BACKOFFICE.UNREDACTED_PROVIDER_PAYLOAD': 422,
  'BACKOFFICE.UNSAFE_PROVIDER_REFERENCE': 422
}

export class PayableWriteError extends Error {
  readonly status: number

  constructor(readonly code: string, message: string, readonly remediation?: string) {
    super(message)
    this.name = 'PayableWriteError'
    // 409 by default: every remaining refusal here is a conflict between what the caller asked for
    // and the state the ledger is actually in.
    this.status = WRITE_ERROR_STATUS[code] ?? 409
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function evidenceHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

/** pg returns timestamptz as a Date under some drivers and a string under others; normalise both. */
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** The one sanctioned principal comparator, duplicated from auth.ts because packages/db must not depend on the BFF. */
function normalise(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * `financial_system_ref` is provider free text, and redaction alone cannot make it safe.
 *
 * 0039 enumerated three free-form columns and missed this one; the service's `redactText` masks
 * exactly three SHAPES (Emirates ID, IBAN, e-mail) and passes everything else through verbatim — so
 * a vendor reference carrying a personal name matches nothing and survives, permanently, in a table
 * with no deletion path. That is the same class of unconstrained provider text 0039 withheld the
 * cross-tenant grant over, which means the grant cannot rest on the response-payload check alone.
 *
 * Constraining the SHAPE is what closes it, and it is total in the way masking is not: a dispatch
 * reference is an opaque vendor identifier, so anything that is not one — prose, spaces, commas,
 * punctuation a reference would never carry — is REFUSED rather than partially masked. The
 * `[REDACTED:*]` markers the service may have substituted are admitted, because a masked value is
 * still a legitimate thing to store; what cannot get in is free text nobody recognised.
 *
 * Fails closed: an unrecognisable reference stops the dispatch being RECORDED. That is the correct
 * direction — the debit has already been authorised by P9 at that point, and an operator
 * investigating an unrecorded dispatch is a far better outcome than a permanent, unremovable name.
 */
const REFERENCE_SHAPE = /^[A-Za-z0-9._:/=+-]{1,128}$/

function assertReferenceShaped(value: string, label: string): void {
  const withoutMarkers = value.replace(/\[REDACTED:[a-z_]+\]/g, 'X')
  if (!REFERENCE_SHAPE.test(withoutMarkers)) {
    throw new PayableWriteError(
      'BACKOFFICE.UNSAFE_PROVIDER_REFERENCE',
      `refusing to persist a ${label} that is not reference-shaped. The column is provider free text `
      + 'in an INSERT-only family with no deletion path, and masking recognises only known identifier '
      + 'shapes — so an opaque-identifier shape is the only check that is total. Expected up to 128 '
      + 'characters of [A-Za-z0-9._:/=+-]; got a value containing other characters (value not echoed).',
      'Have the financial system return an opaque dispatch reference; free text cannot be stored here.'
    )
  }
}

/**
 * Criterion 5(c), at the boundary that makes a write permanent.
 *
 * The service redacts before it calls; this refuses if anything still matches a customer-detail
 * shape. Two controls rather than one because the write is unremovable and P9's response shape is
 * the vendor's to change — BILL-14 found two real redaction bugs through exactly this double-check
 * rather than in review.
 */
function assertRedactedResponse(payload: unknown): void {
  const { removedPaths } = redactProviderPayload(payload)
  if (removedPaths.length > 0) {
    throw new PayableWriteError(
      'BACKOFFICE.UNREDACTED_PROVIDER_PAYLOAD',
      'refusing to persist an unredacted financial-system response: '
      + `${removedPaths.length} field(s) still match a customer-detail shape. Paths (names only, no `
      + `values): ${removedPaths.join(', ')}`,
      'Redact the P9 response before dispatch; the named fields carry customer detail into an '
      + 'INSERT-only table with no deletion path.'
    )
  }
}

const PERIOD_CLOSE_LINEAGE = [
  'bank_id', 'channel', 'billing_period', 'initiated_by', 'approved_by', 'approval_request_id',
  'feeds_monthly_signoff', 'closed_at', 'evidence_hash'
]

const AP_DISPATCH_LINEAGE = [
  'bank_id', 'channel', 'statement_id', 'reconciliation_id', 'approval_request_id', 'initiated_by',
  'approved_by', 'approved_at', 'dispatch_state', 'financial_system_ref', 'idempotency_key',
  'dispatched_at', 'payable_net_milli_fils', 'response_payload', 'evidence_hash'
]

/**
 * The open-break gate, shared by the close store and the read model.
 *
 * "Unresolved" means raised and not yet settled on the E1 break it points at: the diff-line table is
 * INSERT-only and carries no status of its own. A line with no break id has been raised and not
 * worked; a line whose break is still open is being worked. Either way the payable is not clear.
 */
export const OPEN_PAYABLE_BREAKS_SQL = `
  SELECT d.reconciliation_id, d.line_ref, d.break_type, d.cost_recipient_type,
         d.cost_recipient_id, d.variance_milli_fils, d.reconciliation_break_id
    FROM billing_tpp_cost_diff_line d
    JOIN billing_tpp_cost_reconciliation r ON r.id = d.reconciliation_id
    LEFT JOIN reconciliation_break b ON b.id = d.reconciliation_break_id
   WHERE r.billing_period = $1
     AND d.material
     AND (d.reconciliation_break_id IS NULL
          OR b.status NOT IN ('resolved_matched','resolved_internal_correction'))
   ORDER BY d.created_at ASC, d.line_ref ASC`

export interface OpenPayableBreakRow {
  reconciliationId: string
  lineRef: string
  breakType: string
  costRecipientType: string
  costRecipientId: string
  varianceMilliFils: number
  reconciliationBreakId: string | null
}

export function mapOpenPayableBreak(row: Record<string, unknown>): OpenPayableBreakRow {
  return {
    reconciliationId: row.reconciliation_id as string,
    lineRef: row.line_ref as string,
    breakType: row.break_type as string,
    costRecipientType: row.cost_recipient_type as string,
    costRecipientId: row.cost_recipient_id as string,
    varianceMilliFils: Number(row.variance_milli_fils),
    reconciliationBreakId: (row.reconciliation_break_id as string | null) ?? null
  }
}

abstract class TenantScopedStore {
  protected readonly pool: pg.Pool

  constructor(
    databaseUrl: string,
    protected readonly config: { bankId: string; channel: string },
    protected readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  protected async asApp<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query(beginAppTx(this.config.bankId))
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  protected async emit(table: string, columns: string[], traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({ table, columns, source: 'billing-payable-store', trace_id: traceId })
    } catch {
      /* Catalogue availability never rolls back immutable billing evidence. */
    }
  }

  /**
   * The four-eyes facts, read from the approval RECORD inside the caller's transaction.
   *
   * Criterion 5(a) and 5(b) in one place. Returning the record rather than a boolean is deliberate:
   * the caller needs the two principals to STAMP, and the only way to guarantee they match the
   * approval is to take them from it here rather than to compare them to something passed in.
   */
  protected async fourEyesEvidence(
    client: pg.PoolClient,
    approvalRequestId: string,
    expectedOperationType: string,
    expectedPeriod: string
  ): Promise<{ initiatedBy: string; approvedBy: string; approvedAt: string }> {
    const row = (await client.query(
      `SELECT operation_type, operation_payload, state, initiator, approver, expires_at, approved_at
         FROM approval_request
        WHERE approval_request_id = $1`,
      [approvalRequestId]
    )).rows[0] as Record<string, unknown> | undefined

    if (!row) {
      throw new PayableWriteError('BACKOFFICE.APPROVAL_NOT_FOUND',
        `approval ${approvalRequestId} does not exist for this tenant`,
        'Re-request the four-eyes approval for this period before writing.')
    }
    if (row.operation_type !== expectedOperationType) {
      throw new PayableWriteError('BACKOFFICE.APPROVAL_WRONG_OPERATION',
        `approval ${approvalRequestId} authorises ${String(row.operation_type)}, not ${expectedOperationType}`,
        'Cite the approval granted for this operation.')
    }
    const payload = (row.operation_payload ?? {}) as Record<string, unknown>
    if (payload.period !== expectedPeriod) {
      throw new PayableWriteError('BACKOFFICE.APPROVAL_WRONG_PERIOD',
        `approval ${approvalRequestId} covers ${String(payload.period)}, not ${expectedPeriod}`,
        'Cite the approval granted for this period.')
    }
    if (row.state !== 'approved') {
      throw new PayableWriteError('BACKOFFICE.APPROVAL_NOT_APPROVED',
        `approval ${approvalRequestId} is ${String(row.state)}, so nothing has authorised this write`,
        'Have a second finance principal approve the close first.')
    }
    const approver = (row.approver as string | null) ?? ''
    const initiator = (row.initiator as string | null) ?? ''
    if (!approver.trim() || normalise(approver) === normalise(initiator)) {
      throw new PayableWriteError('BACKOFFICE.FOUR_EYES_SAME_PRINCIPAL',
        `approval ${approvalRequestId} records no second principal, so it evidences one person twice`,
        'Have a different finance principal approve the close.')
    }
    // Refused rather than assumed. `approved_at` is nullable on approval_request (migration 0042)
    // because legacy rows predate the column — but it is NOT NULL on the dispatch row, and for money
    // movement the absence of evidence is not evidence.
    const approvedAt = row.approved_at as Date | string | null
    if (!approvedAt) {
      throw new PayableWriteError('BACKOFFICE.APPROVAL_TIME_UNPROVEN',
        `approval ${approvalRequestId} is approved but carries no approved_at, so it cannot be shown `
        + 'to have been approved within its window',
        'Re-request the close so the approval records when it was granted (migration 0042).')
    }
    const approvedAtIso = approvedAt instanceof Date ? approvedAt.toISOString() : new Date(approvedAt).toISOString()
    const expiresAt = row.expires_at as Date | string
    const expiresIso = expiresAt instanceof Date ? expiresAt.toISOString() : new Date(expiresAt).toISOString()
    if (Date.parse(approvedAtIso) > Date.parse(expiresIso)) {
      throw new PayableWriteError('BACKOFFICE.APPROVAL_EXPIRED',
        `approval ${approvalRequestId} was approved at ${approvedAtIso}, after its window closed at `
        + `${expiresIso}. A late approval authorises nothing.`,
        'Re-request the close so a live approval authorises it.')
    }
    return {
      initiatedBy: normalise(initiator),
      approvedBy: normalise(approver),
      approvedAt: approvedAtIso
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/** BILL-16 criterion 2 — `PayableCloseStore`, nothing more. */
export class PgPayableCloseStore extends TenantScopedStore {
  async openPayableBreaks(period: string): Promise<OpenPayableBreakRow[]> {
    const rows = await this.asApp(async (client) =>
      (await client.query(OPEN_PAYABLE_BREAKS_SQL, [period])).rows as Array<Record<string, unknown>>)
    return rows.map(mapOpenPayableBreak)
  }

  /**
   * The close already on file, or null — the request path's already-closed refusal reads this.
   *
   * Read-only, and deliberately narrow: it returns when and under what approval, which is what a
   * refusal message needs to name, and nothing else.
   */
  async closeForPeriod(period: string): Promise<{ closedAt: string; approvalRequestId: string } | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT closed_at, approval_request_id FROM billing_tpp_cost_period_close
        WHERE billing_period = $1`,
      [period]
    )).rows[0] as Record<string, unknown> | undefined)
    if (!row) return null
    return {
      closedAt: iso(row.closed_at as Date | string),
      approvalRequestId: row.approval_request_id as string
    }
  }

  /**
   * Append the close.
   *
   * Idempotent on (bank_id, billing_period) so a retried execution returns the existing row instead
   * of minting a second four-eyes record for one act — and, because the family has no UPDATE grant,
   * a conflicting second close cannot silently overwrite the first either. A DIVERGENT retry is
   * refused rather than reported as success: if the stored row names different principals from the
   * ones the cited approval carries, something other than a retry is happening.
   */
  async saveClose(
    input: {
      period: string
      initiatedBy: string
      approvedBy: string
      approvalRequestId: string | null
      feedsMonthlySignOff: true
    },
    traceId: string
  ): Promise<{ closeId: string; created: boolean }> {
    if (!input.approvalRequestId?.trim()) {
      // A close row cites an approval by construction — the column is NOT NULL. The service's
      // interface types this nullable because the approval id is minted after the request, so an
      // absent one at execution means the operation was invoked outside the approvals primitive.
      throw new PayableWriteError('BACKOFFICE.FOUR_EYES_NO_APPROVAL',
        `the close of ${input.period} cites no approval, so nothing evidences a second principal`,
        'Request the close through POST /back-office/billing/cost-periods/{period}:close.')
    }
    const approvalRequestId = input.approvalRequestId
    const result = await this.asApp(async (client) => {
      const evidence = await this.fourEyesEvidence(
        client, approvalRequestId, 'billing.tpp_cost.period_close', input.period)

      // The caller's own view of who did what, checked against the record rather than trusted. The
      // service already takes both names from the approval ctx; this catches a future caller that
      // does not, at the boundary where it would otherwise become permanent evidence.
      if (normalise(input.initiatedBy) !== evidence.initiatedBy
        || normalise(input.approvedBy) !== evidence.approvedBy) {
        throw new PayableWriteError(
          'BACKOFFICE.FOUR_EYES_EVIDENCE_MISMATCH',
          `the close of ${input.period} names principals that are not the ones who granted approval `
          + `${approvalRequestId}. Denormalised evidence that disagrees with the row it cites is `
          + 'worse than none, because it reads as corroboration.',
          'Re-request the close so the recorded principals are the ones who granted the approval.'
        )
      }

      const hash = evidenceHash({
        period: input.period,
        approval: approvalRequestId,
        initiatedBy: evidence.initiatedBy,
        approvedBy: evidence.approvedBy,
        approvedAt: evidence.approvedAt
      })

      const inserted = (await client.query(
        `INSERT INTO billing_tpp_cost_period_close
           (bank_id, channel, billing_period, initiated_by, approved_by, approval_request_id,
            feeds_monthly_signoff, evidence_hash)
         VALUES (NULLIF(current_setting('app.bank_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (bank_id, billing_period) DO NOTHING
         RETURNING id`,
        [this.config.channel, input.period, evidence.initiatedBy, evidence.approvedBy,
          approvalRequestId, input.feedsMonthlySignOff, hash]
      )).rows[0] as { id: string } | undefined

      if (inserted) return { closeId: inserted.id, created: true }

      const existing = (await client.query(
        `SELECT id, evidence_hash FROM billing_tpp_cost_period_close
          WHERE billing_period = $1`,
        [input.period]
      )).rows[0] as { id: string; evidence_hash: string } | undefined
      if (!existing) {
        throw new PayableWriteError('BACKOFFICE.CLOSE_WRITE_LOST',
          `the close of ${input.period} neither inserted nor resolved to an existing row`,
          'Retry the close; if it recurs the ledger is in an unexpected state and needs investigation.')
      }
      if (existing.evidence_hash !== hash) {
        throw new PayableWriteError(
          'BACKOFFICE.PERIOD_ALREADY_CLOSED',
          `cost period ${input.period} is already closed under different four-eyes evidence. `
          + 'Re-closing would mint a second record for one act; correct the period by re-rating, '
          + 'which appends an immutable delta rather than reopening a closed period.',
          'Correct a closed period by re-rating it, not by closing it again.'
        )
      }
      return { closeId: existing.id, created: false }
    })

    if (result.created) await this.emit('billing_tpp_cost_period_close', PERIOD_CLOSE_LINEAGE, traceId)
    return result
  }
}

/** BILL-16 criterion 3 — `PayableDispatchStore`: one read, one append. Nothing that touches evidence. */
export class PgPayableDispatchStore extends TenantScopedStore {
  /**
   * The payable a dispatch would act on.
   *
   * A payable is not a table: it is what a reconciliation ESTABLISHES once the document it matched
   * has been accepted. So `payableId` is the reconciliation id, and the amounts come from the
   * provider document that reconciliation ran against — the tax invoice is what the scheme actually
   * debits, and the expected statement is what we thought it would be.
   *
   * `approvalRequestId` is the period close, joined in rather than stored on the payable: authority
   * to honour a debit belongs to the period, and reading it here is what makes an unclosed period
   * produce a null the service can refuse on.
   */
  async approvedPayable(payableId: string): Promise<{
    payableId: string
    period: string
    counterpartyId: string
    counterpartyType: 'nebras' | 'underlying_lfi'
    amountFils: number
    netMilliFils: number
    currency: string
    approvalRequestId: string | null
    documentReference: string
    statementId: string
  } | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT r.id, r.billing_period, r.statement_id,
              d.document_type, d.issuer_id, d.document_reference, d.currency,
              d.net_milli_fils, d.gross_milli_fils,
              c.approval_request_id
         FROM billing_tpp_cost_reconciliation r
         JOIN billing_tpp_cost_document d ON d.id = r.document_id
         LEFT JOIN billing_tpp_cost_period_close c ON c.billing_period = r.billing_period
        WHERE r.id = $1`,
      [payableId]
    )).rows[0] as Record<string, unknown> | undefined)

    if (!row) return null
    // The document's own taxonomy decides who is being paid. A self-invoice from an underlying LFI
    // is that LFI's charge; everything else on the primary path is the Hub's. Derived rather than
    // stored so it cannot disagree with the document it came from.
    const counterpartyType = row.document_type === 'lfi_self_invoice' ? 'underlying_lfi' : 'nebras'
    const grossMilliFils = Number(row.gross_milli_fils)
    return {
      payableId: row.id as string,
      period: row.billing_period as string,
      counterpartyId: row.issuer_id as string,
      counterpartyType,
      // GROSS on the wire to P9: the scheme direct debit collects the invoice total including VAT.
      // The ledger's own accrual is net — those are different numbers answering different questions,
      // and conflating them would either under-collect or over-accrue.
      amountFils: Math.round(grossMilliFils / 1000),
      netMilliFils: Number(row.net_milli_fils),
      currency: (row.currency as string) ?? 'AED',
      approvalRequestId: (row.approval_request_id as string | null) ?? null,
      documentReference: row.document_reference as string,
      statementId: row.statement_id as string
    }
  }

  /**
   * Append one dispatch state.
   *
   * Every NOT NULL column the caller does not supply is derived here rather than accepted as an
   * argument: the two principals and `approved_at` from the cited approval record (criterion 5(b)),
   * the statement and reconciliation ids and the net amount from the payable itself. That is what
   * keeps the dispatch service's store surface to two methods — it has nothing to pass that could
   * be wrong.
   */
  async recordDispatch(
    input: {
      payableId: string
      dispatchRef: string
      status: string
      approvalRequestId: string
      idempotencyKey: string
      responsePayload?: unknown
    },
    traceId: string
  ): Promise<{ dispatchId: string; created: boolean; dispatchedAt: string }> {
    const dispatchState = dispatchStateForPayableStatus(input.status)
    const responsePayload = input.responsePayload === undefined ? null : input.responsePayload
    // Both provider-fed columns, checked before anything can be written. The payload screen catches
    // recognised identifier shapes and known PSU keys; the reference screen catches everything else
    // by refusing any value that is not an opaque identifier in the first place.
    assertRedactedResponse(responsePayload)
    assertReferenceShaped(input.dispatchRef, 'financial_system_ref')

    const result = await this.asApp(async (client) => {
      const payable = (await client.query(
        `SELECT r.id, r.statement_id, r.billing_period, d.net_milli_fils
           FROM billing_tpp_cost_reconciliation r
           JOIN billing_tpp_cost_document d ON d.id = r.document_id
          WHERE r.id = $1`,
        [input.payableId]
      )).rows[0] as Record<string, unknown> | undefined
      if (!payable) {
        throw new PayableWriteError('BACKOFFICE.NOT_FOUND', `no payable ${input.payableId} for this tenant`,
          'Check the payable id against GET /back-office/billing/cost-periods/{period}.')
      }

      const evidence = await this.fourEyesEvidence(
        client, input.approvalRequestId, 'billing.tpp_cost.period_close', payable.billing_period as string)

      // Transition order, which 0039 states the UNIQUE constraint does not carry. Read the states
      // already on file for this instruction and refuse anything that does not legally follow.
      const priorStates = ((await client.query(
        `SELECT dispatch_state FROM billing_tpp_cost_ap_dispatch
          WHERE idempotency_key = $1 ORDER BY created_at ASC`,
        [input.idempotencyKey]
      )).rows as Array<{ dispatch_state: PayableDispatchState }>).map((r) => r.dispatch_state)

      if (priorStates.length > 0) {
        const latest = priorStates[priorStates.length - 1]!
        if (latest === dispatchState) {
          // Same state again is a retry, not a transition. Return the row rather than fighting the
          // unique constraint, so a replayed dispatch is idempotent end to end.
          const existing = (await client.query(
            `SELECT id, dispatched_at FROM billing_tpp_cost_ap_dispatch
              WHERE idempotency_key = $1 AND dispatch_state = $2`,
            [input.idempotencyKey, dispatchState]
          )).rows[0] as { id: string; dispatched_at: Date | string } | undefined
          if (existing) return { dispatchId: existing.id, created: false, dispatchedAt: iso(existing.dispatched_at) }
        } else if (!LEGAL_NEXT[latest].includes(dispatchState)) {
          throw new PayableWriteError(
            'BACKOFFICE.ILLEGAL_DISPATCH_TRANSITION',
            `dispatch ${input.idempotencyKey} is ${latest}; ${dispatchState} does not legally follow `
            + `it. ${LEGAL_NEXT[latest].length === 0
              ? `${latest} is terminal.`
              : `Legal next states: ${LEGAL_NEXT[latest].join(', ')}.`}`,
            'Record only a state that legally follows the one already on file.'
          )
        }
      }

      const netMilliFils = Number(payable.net_milli_fils)
      const hash = evidenceHash({
        payable: input.payableId,
        approval: input.approvalRequestId,
        state: dispatchState,
        net: netMilliFils,
        initiatedBy: evidence.initiatedBy,
        approvedBy: evidence.approvedBy
      })

      const inserted = (await client.query(
        `INSERT INTO billing_tpp_cost_ap_dispatch
           (bank_id, channel, statement_id, reconciliation_id, approval_request_id, initiated_by,
            approved_by, approved_at, dispatch_state, financial_system_ref, idempotency_key,
            dispatched_at, payable_net_milli_fils, response_payload, evidence_hash)
         VALUES (NULLIF(current_setting('app.bank_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, now(), $11, $12, $13)
         ON CONFLICT (bank_id, idempotency_key, dispatch_state) DO NOTHING
         RETURNING id, dispatched_at`,
        [this.config.channel, payable.statement_id, payable.id, input.approvalRequestId,
          evidence.initiatedBy, evidence.approvedBy, evidence.approvedAt, dispatchState,
          input.dispatchRef, input.idempotencyKey, netMilliFils,
          responsePayload === null ? null : JSON.stringify(responsePayload), hash]
      )).rows[0] as { id: string; dispatched_at: Date | string } | undefined

      if (inserted) return { dispatchId: inserted.id, created: true, dispatchedAt: iso(inserted.dispatched_at) }

      const existing = (await client.query(
        `SELECT id, dispatched_at FROM billing_tpp_cost_ap_dispatch
          WHERE idempotency_key = $1 AND dispatch_state = $2`,
        [input.idempotencyKey, dispatchState]
      )).rows[0] as { id: string; dispatched_at: Date | string } | undefined
      if (!existing) {
        throw new PayableWriteError('BACKOFFICE.DISPATCH_WRITE_LOST',
          `dispatch ${input.idempotencyKey} neither inserted nor resolved to an existing row`,
          'Retry the dispatch with the same Idempotency-Key; it will not double-authorise the debit.')
      }
      return { dispatchId: existing.id, created: false, dispatchedAt: iso(existing.dispatched_at) }
    })

    if (result.created) await this.emit('billing_tpp_cost_ap_dispatch', AP_DISPATCH_LINEAGE, traceId)
    return result
  }
}

/**
 * BILL-16 — the read model behind `GET /back-office/billing/cost-periods/{period}`.
 *
 * READ-ONLY BY CONSTRUCTION: it exposes no method that writes, so the console's data path cannot
 * become a second way into the ledger. Separate from the two write stores for the same reason they
 * are separate from each other — the surface handed to a service is the guarantee.
 */
export class PgPayablePeriodStore extends TenantScopedStore {
  async periodClose(period: string): Promise<{
    closeId: string
    period: string
    initiatedBy: string
    approvedBy: string
    approvalRequestId: string
    feedsMonthlySignOff: boolean
    closedAt: string
  } | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT id, billing_period, initiated_by, approved_by, approval_request_id,
              feeds_monthly_signoff, closed_at
         FROM billing_tpp_cost_period_close
        WHERE billing_period = $1`,
      [period]
    )).rows[0] as Record<string, unknown> | undefined)
    if (!row) return null
    const closedAt = row.closed_at as Date | string
    return {
      closeId: row.id as string,
      period: row.billing_period as string,
      initiatedBy: row.initiated_by as string,
      approvedBy: row.approved_by as string,
      approvalRequestId: row.approval_request_id as string,
      feedsMonthlySignOff: row.feeds_monthly_signoff as boolean,
      closedAt: closedAt instanceof Date ? closedAt.toISOString() : new Date(closedAt).toISOString()
    }
  }

  /**
   * Every payable the period established, with its latest dispatch state.
   *
   * The dispatch join is a LATERAL taking the newest row by created_at, because the dispatch table
   * is an append-only state log rather than a mutable status — "the current state" is a query, not
   * a column. Ordering ties are broken by id so the result is deterministic when two states land in
   * the same transaction, which the tests do.
   */
  async payablesForPeriod(period: string): Promise<Array<{
    payableId: string
    period: string
    costRecipientType: 'nebras' | 'underlying_lfi'
    costRecipientId: string
    documentReference: string
    grossMilliFils: number
    netMilliFils: number
    vatMilliFils: number
    dispatchState: string | null
    dispatchedAt: string | null
    nettedAgainstMilliFils: number | null
  }>> {
    const rows = await this.asApp(async (client) => (await client.query(
      `SELECT r.id, r.billing_period, d.document_type, d.issuer_id, d.document_reference,
              d.gross_milli_fils, d.net_milli_fils, d.vat_milli_fils,
              a.dispatch_state, a.dispatched_at
         FROM billing_tpp_cost_reconciliation r
         JOIN billing_tpp_cost_document d ON d.id = r.document_id
         LEFT JOIN LATERAL (
           SELECT dispatch_state, dispatched_at
             FROM billing_tpp_cost_ap_dispatch x
            WHERE x.reconciliation_id = r.id
            ORDER BY x.created_at DESC, x.id DESC
            LIMIT 1
         ) a ON true
        WHERE r.billing_period = $1
        ORDER BY d.document_reference ASC, r.id ASC`,
      [period]
    )).rows as Array<Record<string, unknown>>)

    return rows.map((row) => {
      const dispatchedAt = row.dispatched_at as Date | string | null
      return {
        payableId: row.id as string,
        period: row.billing_period as string,
        costRecipientType: (row.document_type === 'lfi_self_invoice' ? 'underlying_lfi' : 'nebras') as
          'nebras' | 'underlying_lfi',
        costRecipientId: row.issuer_id as string,
        documentReference: row.document_reference as string,
        grossMilliFils: Number(row.gross_milli_fils),
        netMilliFils: Number(row.net_milli_fils),
        vatMilliFils: Number(row.vat_milli_fils),
        dispatchState: (row.dispatch_state as string | null) ?? null,
        dispatchedAt: dispatchedAt === null
          ? null
          : (dispatchedAt instanceof Date ? dispatchedAt.toISOString() : new Date(dispatchedAt).toISOString()),
        // IG §10.16 netting is computed from the settlement decomposition, which is a different
        // projection with its own inputs. Reported as null here rather than guessed: a number the
        // ledger cannot show you the derivation of is worse than an honest absence.
        nettedAgainstMilliFils: null
      }
    })
  }

  async openPayableBreaks(period: string): Promise<OpenPayableBreakRow[]> {
    const rows = await this.asApp(async (client) =>
      (await client.query(OPEN_PAYABLE_BREAKS_SQL, [period])).rows as Array<Record<string, unknown>>)
    return rows.map(mapOpenPayableBreak)
  }
}
