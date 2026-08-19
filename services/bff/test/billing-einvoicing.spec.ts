import { describe, expect, it, vi } from 'vitest'
import { aed, type PintAeDocument } from '@ofbo/billing'
import { dispatchPintAeDocuments, executePintAeInvoiceRun, type EInvoiceArtifactStore } from '../src/billing/einvoicing.js'

const document: PintAeDocument = {
  documentId: 'INV-2026-06-TPP-A',
  uuid: '4b6000ca-0128-4bdc-99a6-406f2909247f',
  documentType: '380',
  buyerId: 'tpp-a',
  period: '2026-06',
  issueDate: '2026-07-06',
  transactionType: '00000000',
  taxCategory: 'S',
  grossFils: 10_500,
  netFils: 10_000,
  vatFils: 500,
  tddRequired: true,
  vatPostureDecisionRef: 'BD-19-TAX-APPROVAL-001',
  customizationId: 'urn:peppol:pint:billing-1@ae-1',
  profileId: 'urn:peppol:bis:billing',
  xml: '<Invoice />',
  pdf: new TextEncoder().encode('%PDF-1.4'),
  sourceLineRefs: ['2026-06|tpp-a|payment.merchant_collection']
}

function store(): EInvoiceArtifactStore & { saveDocument: ReturnType<typeof vi.fn>; appendSubmission: ReturnType<typeof vi.fn> } {
  return {
    saveDocument: vi.fn(async () => ({ id: 'artifact-1', documentId: document.documentId, created: true })),
    appendSubmission: vi.fn(async () => ({ id: 'attempt-1', attemptNo: 1 }))
  }
}

describe('BILL-04 e-invoice dispatch', () => {
  it('runs from the expected memo through PINT generation, persistence, ASP and TDD evidence', async () => {
    const artifactStore = store()
    const asp = { submitDocument: vi.fn(async () => ({ accepted: true, submission_ref: 'asp-1', document_status: 'accepted' as const, tdd_status: 'reported' as const })) }
    const result = await executePintAeInvoiceRun({
      invoiceRunId: 'run-1',
      expectedMemoId: 'memo-1',
      issueDate: '2026-07-06',
      priorYearRevenueAed: 75_000_000,
      adapterProfile: 'demo',
      traceId: 'trace-1',
      vatPosture: { status: 'approved', decisionRef: 'BD-19-TAX-APPROVAL-001', domesticTreatment: 'vat_inclusive_5_105', foreignTreatment: 'zero_rated_export_article_31' },
      supplier: { id: 'bank', legalName: 'Example UAE Bank', endpointScheme: '0235', endpointId: '1357902468', taxRegistrationId: '135790246801003', legalRegistrationId: '112345678900003', address: { street: '1 Finance Street', city: 'Dubai', subdivision: 'DXB', countryCode: 'AE' } },
      buyers: [{ id: 'tpp-a', legalName: 'TPP A LLC', endpointScheme: '0235', endpointId: '1345678901', taxRegistrationId: '134567890123003', legalRegistrationId: '112345679000001', address: { street: '2 Market Street', city: 'Abu Dhabi', subdivision: 'AUH', countryCode: 'AE' } }],
      expected: {
        period: '2026-06', rateCardVersion: '2026.06.02', generatedAt: '2026-07-03T01:00:00.000Z', dueAt: '2026-07-03T23:59:59.999Z', generatedOnTime: true, totalMilliFils: aed(105),
        lines: [{ lineRef: '2026-06|tpp-a|payment.merchant_collection', tppId: 'tpp-a', feeClass: 'payment.merchant_collection', units: 1, events: 1, amountMilliFils: aed(105), valueMilliFils: 0, eventIds: ['evt-1'], traceIds: ['trace-1'] }]
      }
    }, artifactStore, asp)

    expect(result.documents).toHaveLength(1)
    expect(result.submissions).toEqual([{ documentId: 'INV-2026-06-TPP-A', submissionRef: 'asp-1', accepted: true, tddStatus: 'reported' }])
    expect(artifactStore.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ invoiceRunId: 'run-1', expectedMemoId: 'memo-1' }), 'trace-1')
  })

  it('persists exact bytes before P11 submission and records the ASP/TDD acknowledgement', async () => {
    const artifactStore = store()
    const asp = { submitDocument: vi.fn(async () => ({
      accepted: true,
      submission_ref: 'asp-sim-1',
      document_status: 'accepted' as const,
      tdd_status: 'reported' as const
    })) }

    const result = await dispatchPintAeDocuments({
      invoiceRunId: 'run-1',
      expectedMemoId: 'memo-1',
      issueDate: '2026-07-06',
      priorYearRevenueAed: 75_000_000,
      documents: [document],
      withheld: [],
      adapterProfile: 'demo',
      traceId: 'trace-1'
    }, artifactStore, asp)

    expect(artifactStore.saveDocument.mock.invocationCallOrder[0]).toBeLessThan(asp.submitDocument.mock.invocationCallOrder[0]!)
    expect(asp.submitDocument).toHaveBeenCalledWith(expect.objectContaining({
      document_id: document.documentId,
      xml: document.xml,
      pdf: document.pdf,
      mode: 'voluntary_pilot'
    }), { trace_id: 'trace-1' })
    expect(artifactStore.appendSubmission).toHaveBeenCalledWith(expect.objectContaining({
      documentArtifactId: 'artifact-1',
      tddStatus: 'reported'
    }))
    expect(result.submissions[0]).toMatchObject({ accepted: true, tddStatus: 'reported' })
  })

  it('records a transport error against the immutable artifact before rethrowing', async () => {
    const artifactStore = store()
    const asp = { submitDocument: vi.fn(async () => { throw new Error('ASP unavailable') }) }

    await expect(dispatchPintAeDocuments({
      invoiceRunId: 'run-1',
      issueDate: '2027-01-02',
      priorYearRevenueAed: 75_000_000,
      documents: [document],
      withheld: [],
      adapterProfile: 'enterprise',
      traceId: 'trace-2'
    }, artifactStore, asp)).rejects.toThrow('ASP unavailable')
    expect(artifactStore.appendSubmission).toHaveBeenCalledWith(expect.objectContaining({
      documentStatus: 'transport_error',
      tddStatus: 'not_sent',
      errorDetail: 'ASP unavailable'
    }))
  })
})
