import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fils, parseNebrasTaxInvoice, type ParsedTppCostDocument } from '../../billing/src/index.js'
import {
  applyMigrations,
  BillingTppCostDocumentConflictError,
  PgBillingTppCostStore,
  PgLineageEmitter
} from '../src/index.js'

/**
 * BILL-14 — provider-document ingestion against a real database.
 *
 * The properties that only a database can establish: the same issuer + reference cannot become two
 * rows, a differing body under that key is a conflict rather than a silent replay, an unmapped
 * category survives as a flagged line, and — the one that matters most — customer detail a provider
 * document carries never reaches the persisted row. These tables are INSERT-only with no deletion
 * path, so that last one is a hard stop, not a preference.
 *
 * Identifier fixtures use the synthetic forms the PII guard mandates: national-identifier prefix 999
 * (never the real 784) and IBAN bank code 000.
 */

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const OTHER_TENANT = { bankId: '22222222-2222-4222-8222-222222222222', channel: 'internal_retail' }

const SYNTHETIC_IBAN = 'AE070001234567890123456'
const SYNTHETIC_NATIONAL_ID = '999-1990-1234567-1'

function invoice(reference: string, extraLine?: Record<string, unknown>) {
  return {
    invoice_number: reference,
    billing_period: '2026-06',
    currency: 'AED',
    issuer: { id: 'NEBRAS', trn: '100123456700003' },
    recipient: { id: 'bank-as-tpp', trn: '100987654300003' },
    issued_at: '2026-07-03T00:00:00.000Z',
    due_at: '2026-07-10T00:00:00.000Z',
    sections: [{
      name: 'Service Initiation',
      vat_treatment: 'exclusive',
      lines: [
        { line_ref: 'SI-1', category: 'Payment Initiation', units: 1000, unit_price_fils: 2.5 },
        ...(extraLine ? [extraLine] : [])
      ]
    }]
  }
}

describe('PgBillingTppCostStore — provider documents', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const store = new PgBillingTppCostStore(DATABASE_URL!, TENANCY, lineage)
  const otherStore = new PgBillingTppCostStore(DATABASE_URL!, OTHER_TENANT, lineage)
  const admin = new pg.Pool({ connectionString: DATABASE_URL })

  beforeAll(async () => { await applyMigrations(DATABASE_URL!) }, 60_000)
  afterAll(async () => {
    await store.close(); await otherStore.close(); await lineage.close(); await admin.end()
  })

  function ingestInput(document: ParsedTppCostDocument, key = randomUUID()) {
    return {
      document,
      documentSha256: `sha256:${'a'.repeat(64)}`,
      rawDocumentRef: `s3://retained/${document.documentReference}`,
      receivedAt: '2026-07-03T09:00:00.000Z',
      verifiedBy: 'finance.verifier',
      verifiedAt: '2026-07-03T09:05:00.000Z',
      idempotencyKey: key
    }
  }

  it('persists a parsed document with its lines and reads them back intact', async () => {
    const parsed = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`))
    const saved = await store.saveDocument(ingestInput(parsed), 'trace-doc')

    expect(saved.created).toBe(true)
    const row = await admin.query(
      `SELECT net_milli_fils, vat_milli_fils, gross_milli_fils, verified_by, document_type
         FROM billing_tpp_cost_document WHERE id = $1`, [saved.record.id]
    )
    expect(Number(row.rows[0].net_milli_fils)).toBe(fils(2500))
    expect(Number(row.rows[0].vat_milli_fils)).toBe(fils(125))
    expect(Number(row.rows[0].gross_milli_fils)).toBe(fils(2625))
    expect(row.rows[0].document_type).toBe('nebras_tax_invoice')

    const lines = await admin.query(
      `SELECT line_ref, source_category, fee_class, mapped, actual_net_milli_fils
         FROM billing_tpp_cost_document_line WHERE document_id = $1`, [saved.record.id]
    )
    expect(lines.rows).toHaveLength(1)
    expect(lines.rows[0]).toMatchObject({
      line_ref: 'SI-1', source_category: 'Payment Initiation', fee_class: 'hub.standard', mapped: true
    })
  })

  it('is idempotent on replay, and raises a CONFLICT on the same reference with different content', async () => {
    const reference = `NEB-${randomUUID()}`
    const parsed = parseNebrasTaxInvoice(invoice(reference))
    const first = await store.saveDocument(ingestInput(parsed), 'trace-1')
    expect(first.created).toBe(true)

    // Identical document, replayed: the stored row, not a second one.
    const replay = await store.saveDocument(ingestInput(parsed), 'trace-2')
    expect(replay.created).toBe(false)
    expect(replay.record.id).toBe(first.record.id)

    // Same issuer + reference, different body: a provider restatement, which must not pass as a replay.
    const restated = parseNebrasTaxInvoice(invoice(reference, {
      line_ref: 'SI-2', category: 'Bank Data Sharing', units: 5, unit_price_fils: 0.5
    }))
    await expect(store.saveDocument(ingestInput(restated), 'trace-3'))
      .rejects.toThrow(BillingTppCostDocumentConflictError)

    const count = await admin.query(
      `SELECT count(*)::int AS n FROM billing_tpp_cost_document WHERE document_reference = $1`, [reference]
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('honours BOTH unique keys: a reused idempotency key conflicts instead of raising a raw 23505', async () => {
    // The table carries UNIQUE (bank_id, idempotency_key) as well as UNIQUE (bank_id, issuer_id,
    // document_reference). An earlier version handled only the second, so reusing a key raised a bare
    // unique violation the route could not classify — a 500 where the contract promises 409.
    const key = randomUUID()
    const first = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`))
    const saved = await store.saveDocument(ingestInput(first, key), 'trace-key-1')
    expect(saved.created).toBe(true)

    // Same key, SAME document: a genuine replay returns the stored row.
    const replay = await store.saveDocument(ingestInput(first, key), 'trace-key-2')
    expect(replay).toMatchObject({ created: false })
    expect(replay.record.id).toBe(saved.record.id)

    // Same key, DIFFERENT document: the caller reused a key, which is a conflict — answering with
    // either document would be wrong.
    const other = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`))
    await expect(store.saveDocument(ingestInput(other, key), 'trace-key-3'))
      .rejects.toThrow(BillingTppCostDocumentConflictError)
    await expect(store.saveDocument(ingestInput(other, key), 'trace-key-4'))
      .rejects.toThrow(/already used for a different document/i)
  })

  it('stores an unmapped provider category as a flagged line rather than dropping it', async () => {
    const parsed = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`, {
      line_ref: 'SI-9', category: 'CoP (Discounted)', units: 20, unit_price_fils: 0.005
    }))
    expect(parsed.unmappedLineCount).toBe(1)
    const saved = await store.saveDocument(ingestInput(parsed), 'trace-unmapped')

    const unmapped = await admin.query(
      `SELECT source_category, fee_class, mapped FROM billing_tpp_cost_document_line
        WHERE document_id = $1 AND mapped = false`, [saved.record.id]
    )
    expect(unmapped.rows).toHaveLength(1)
    // Flagged, category preserved verbatim, fee_class null — the CHECK ties those last two together.
    expect(unmapped.rows[0]).toMatchObject({ source_category: 'CoP (Discounted)', fee_class: null, mapped: false })
  })

  it('never persists customer detail a provider document carried (BILL-14 criterion 5)', async () => {
    // A document whose lines carry payment-level customer detail, in both forms: PSU-named fields and
    // identifier-shaped values under innocuous keys.
    const parsed = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`, {
      line_ref: 'SI-PII', category: 'Payment Initiation', units: 1, unit_price_fils: 2.5,
      customer_name: 'LEAKED_CUSTOMER_NAME',
      payer: { account_name: 'LEAKED_ACCOUNT_NAME', mobile: '+971500000000' },
      remittance_info: SYNTHETIC_IBAN,
      memo: SYNTHETIC_NATIONAL_ID
    }))
    const saved = await store.saveDocument(ingestInput(parsed), 'trace-pii')

    // Grep the PERSISTED row, not the in-memory object.
    const dump = await admin.query(
      `SELECT to_jsonb(d) AS d FROM billing_tpp_cost_document d WHERE id = $1`, [saved.record.id]
    )
    const lineDump = await admin.query(
      `SELECT to_jsonb(l) AS l FROM billing_tpp_cost_document_line l WHERE document_id = $1`,
      [saved.record.id]
    )
    const serialised = JSON.stringify(dump.rows[0].d) + JSON.stringify(lineDump.rows.map((r) => r.l))

    for (const secret of [
      'LEAKED_CUSTOMER_NAME', 'LEAKED_ACCOUNT_NAME', '+971500000000',
      SYNTHETIC_IBAN, SYNTHETIC_NATIONAL_ID
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret)
    }
    // The line itself still exists — redaction removed the detail, not the evidence.
    expect(lineDump.rows.length).toBeGreaterThan(0)
    expect(serialised).toContain('Payment Initiation')
  })

  it('refuses to persist a payload that bypassed the parser and is still unredacted', async () => {
    // The parser cannot return an unredacted payload, so this is the store's own boundary check —
    // the one that makes the write permanent.
    const parsed = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`))
    const smuggled: ParsedTppCostDocument = {
      ...parsed,
      payload: { lines: [{ customer_name: 'SMUGGLED_PAST_THE_PARSER' }] }
    }
    await expect(store.saveDocument(ingestInput(smuggled), 'trace-smuggle'))
      .rejects.toThrow(/unredacted provider payload/i)
  })

  it('isolates tenants: another bank cannot see this document', async () => {
    const parsed = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`))
    await store.saveDocument(ingestInput(parsed), 'trace-iso')

    expect(await otherStore.documentsForPeriod('2026-06')).toEqual([])
    expect((await store.documentsForPeriod('2026-06')).length).toBeGreaterThan(0)
  })

  it('refuses UPDATE and DELETE on both document tables for the application role', async () => {
    const client = await admin.connect()
    try {
      await client.query(`SET ROLE ofbo_app`)
      for (const table of ['billing_tpp_cost_document', 'billing_tpp_cost_document_line']) {
        await expect(client.query(`UPDATE ${table} SET bank_id = bank_id`), `${table} UPDATE`)
          .rejects.toThrow(/permission denied/i)
        await expect(client.query(`DELETE FROM ${table}`), `${table} DELETE`)
          .rejects.toThrow(/permission denied/i)
      }
    } finally {
      await client.query('RESET ROLE').catch(() => undefined)
      client.release()
    }
  })

  it('grants the internal-view read on documents now that redaction is proven (migration 0040)', async () => {
    // BILL-13 withheld this deliberately; BILL-14 earns it. AP dispatch stays withheld for BILL-16.
    const granted = await admin.query(
      `SELECT has_table_privilege('bank_internal_view', $1, 'SELECT') AS ok`,
      ['billing_tpp_cost_document']
    )
    expect(granted.rows[0].ok).toBe(true)

    const stillWithheld = await admin.query(
      `SELECT has_table_privilege('bank_internal_view', $1, 'SELECT') AS ok`,
      ['billing_tpp_cost_ap_dispatch']
    )
    expect(stillWithheld.rows[0].ok).toBe(false)
  })

  it('emits BCBS 239 lineage for both document tables', async () => {
    const parsed = parseNebrasTaxInvoice(invoice(`NEB-${randomUUID()}`))
    await store.saveDocument(ingestInput(parsed), 'trace-lineage')

    const rows = await admin.query(
      `SELECT DISTINCT table_name FROM lineage_events WHERE table_name LIKE 'billing_tpp_cost_document%'`
    )
    const covered = rows.rows.map((row) => row.table_name as string)
    expect(covered).toContain('billing_tpp_cost_document')
    expect(covered).toContain('billing_tpp_cost_document_line')
  })
})
