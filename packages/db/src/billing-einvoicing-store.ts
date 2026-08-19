import { createHash } from 'node:crypto'
import pg from 'pg'
import type { EInvoicingMode, PintAeDocument, WithheldBillingAmount } from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

export interface BillingEInvoiceArtifactInput {
  invoiceRunId: string
  expectedMemoId?: string
  document: PintAeDocument
  mode: EInvoicingMode
  withheld: WithheldBillingAmount[]
}

export interface StoredBillingEInvoiceArtifact {
  id: string
  documentId: string
  xmlSha256: string
  pdfSha256: string
  created: boolean
}

export interface BillingAspSubmissionInput {
  documentArtifactId: string
  adapterProfile: 'demo' | 'enterprise'
  traceId: string
  accepted: boolean
  submissionRef?: string
  documentStatus: 'accepted' | 'rejected' | 'transport_error'
  tddStatus: 'reported' | 'pending' | 'rejected' | 'not_sent'
  errorDetail?: string
}

const DOCUMENT_COLUMNS = [
  'bank_id', 'channel', 'invoice_run_id', 'expected_memo_id', 'document_id', 'document_uuid',
  'document_type', 'pint_ae_version', 'customization_id', 'profile_id', 'transaction_type',
  'billing_period', 'issue_date', 'buyer_id', 'tax_category', 'gross_fils', 'net_fils',
  'vat_fils', 'tdd_required', 'vat_posture_decision_ref', 'einvoicing_mode', 'source_line_refs', 'withheld_payload',
  'xml_sha256', 'pdf_sha256'
]
const SUBMISSION_COLUMNS = [
  'bank_id', 'channel', 'einvoice_document_id', 'attempt_no', 'adapter_profile',
  'fapi_interaction_id', 'accepted', 'submission_ref', 'document_status', 'tdd_status', 'error_detail'
]

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export class PgBillingEInvoicingStore {
  private readonly pool: pg.Pool

  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  private async asApp<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

  private async emit(table: string, columns: string[], traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({ table, columns, source: 'billing-einvoicing-store', trace_id: traceId })
    } catch {
      /* Catalogue availability does not roll back immutable billing evidence. */
    }
  }

  async saveDocument(input: BillingEInvoiceArtifactInput, traceId: string): Promise<StoredBillingEInvoiceArtifact> {
    const document = input.document
    const xmlSha256 = digest(document.xml)
    const pdfSha256 = digest(document.pdf)
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_einvoice_document
           (bank_id, channel, invoice_run_id, expected_memo_id, document_id, document_uuid,
            document_type, pint_ae_version, customization_id, profile_id, transaction_type,
            billing_period, issue_date, buyer_id, tax_category, gross_fils, net_fils, vat_fils,
            tdd_required, vat_posture_decision_ref, einvoicing_mode, source_line_refs, withheld_payload, xml_payload,
            xml_sha256, pdf_payload, pdf_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'1.0.3',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,$18,$19,$20,$21::jsonb,$22,$23,$24,$25)
         ON CONFLICT (bank_id, document_id) DO NOTHING
         RETURNING id`,
        [this.config.bankId, this.config.channel, input.invoiceRunId, input.expectedMemoId ?? null,
          document.documentId, document.uuid, document.documentType, document.customizationId,
          document.profileId, document.transactionType, document.period, document.issueDate,
          document.buyerId, document.taxCategory, document.grossFils, document.netFils,
          document.vatFils, document.vatPostureDecisionRef, input.mode, document.sourceLineRefs,
          JSON.stringify(input.withheld), document.xml, xmlSha256, Buffer.from(document.pdf), pdfSha256]
      )
      if (inserted.rows[0]) return { id: inserted.rows[0].id as string, created: true }
      const existing = await client.query(
        `SELECT id, xml_sha256, pdf_sha256 FROM billing_einvoice_document WHERE document_id = $1`,
        [document.documentId]
      )
      const row = existing.rows[0] as { id?: string; xml_sha256?: string; pdf_sha256?: string } | undefined
      if (!row?.id) throw new Error(`e-invoice ${document.documentId} could not be read after insert`)
      if (row.xml_sha256 !== xmlSha256 || row.pdf_sha256 !== pdfSha256) {
        throw new Error(`conflicting immutable e-invoice ${document.documentId}`)
      }
      return { id: row.id, created: false }
    })
    if (result.created) await this.emit('billing_einvoice_document', DOCUMENT_COLUMNS, traceId)
    return { id: result.id, documentId: document.documentId, xmlSha256, pdfSha256, created: result.created }
  }

  async appendSubmission(input: BillingAspSubmissionInput): Promise<{ id: string; attemptNo: number }> {
    const result = await this.asApp(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [input.documentArtifactId])
      const locked = await client.query(
        `SELECT id FROM billing_einvoice_document WHERE id = $1`,
        [input.documentArtifactId]
      )
      if (!locked.rows[0]) throw new Error(`unknown e-invoice artifact ${input.documentArtifactId}`)
      const next = await client.query(
        `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
           FROM billing_asp_submission WHERE einvoice_document_id = $1`,
        [input.documentArtifactId]
      )
      const attemptNo = Number(next.rows[0].attempt_no)
      const inserted = await client.query(
        `INSERT INTO billing_asp_submission
           (bank_id, channel, einvoice_document_id, attempt_no, adapter_profile,
            fapi_interaction_id, accepted, submission_ref, document_status, tdd_status, error_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [this.config.bankId, this.config.channel, input.documentArtifactId, attemptNo,
          input.adapterProfile, input.traceId, input.accepted, input.submissionRef ?? null,
          input.documentStatus, input.tddStatus, input.errorDetail ?? null]
      )
      return { id: inserted.rows[0].id as string, attemptNo }
    })
    await this.emit('billing_asp_submission', SUBMISSION_COLUMNS, input.traceId)
    return result
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
