import {
  buildPintAeDocuments,
  eInvoicingCalendar,
  type BuildPintAeDocumentsInput,
  type PintAeDocument,
  type WithheldBillingAmount
} from '@ofbo/billing'
import type { EInvoicingAspPort } from '@ofbo/ports'

export interface EInvoiceArtifactStore {
  saveDocument(input: {
    invoiceRunId: string
    expectedMemoId?: string
    document: PintAeDocument
    mode: 'voluntary_pilot' | 'mandatory'
    withheld: WithheldBillingAmount[]
  }, traceId: string): Promise<{ id: string; documentId: string; created: boolean }>
  appendSubmission(input: {
    documentArtifactId: string
    adapterProfile: 'demo' | 'enterprise'
    traceId: string
    accepted: boolean
    submissionRef?: string
    documentStatus: 'accepted' | 'rejected' | 'transport_error'
    tddStatus: 'reported' | 'pending' | 'rejected' | 'not_sent'
    errorDetail?: string
  }): Promise<{ id: string; attemptNo: number }>
}

export interface EInvoiceDispatchInput {
  invoiceRunId: string
  expectedMemoId?: string
  issueDate: string
  priorYearRevenueAed: number
  documents: PintAeDocument[]
  withheld: WithheldBillingAmount[]
  adapterProfile: 'demo' | 'enterprise'
  traceId: string
}

export interface ExecutePintAeInvoiceRunInput extends BuildPintAeDocumentsInput {
  invoiceRunId: string
  expectedMemoId?: string
  priorYearRevenueAed: number
  adapterProfile: 'demo' | 'enterprise'
  traceId: string
}

/** Invoice-run entry point: reconcile-derived documents → immutable evidence → P11. */
export async function executePintAeInvoiceRun(
  input: ExecutePintAeInvoiceRunInput,
  store: EInvoiceArtifactStore,
  asp: EInvoicingAspPort
): Promise<Awaited<ReturnType<typeof dispatchPintAeDocuments>> & ReturnType<typeof buildPintAeDocuments>> {
  const generated = buildPintAeDocuments(input)
  const dispatched = await dispatchPintAeDocuments({
    invoiceRunId: input.invoiceRunId,
    expectedMemoId: input.expectedMemoId,
    issueDate: input.issueDate,
    priorYearRevenueAed: input.priorYearRevenueAed,
    documents: generated.documents,
    withheld: generated.withheld,
    adapterProfile: input.adapterProfile,
    traceId: input.traceId
  }, store, asp)
  return { ...generated, ...dispatched }
}

/** Persist exact bytes first, then submit those bytes to P11 and append every outcome. */
export async function dispatchPintAeDocuments(
  input: EInvoiceDispatchInput,
  store: EInvoiceArtifactStore,
  asp: EInvoicingAspPort
): Promise<{
  mode: 'voluntary_pilot' | 'mandatory'
  mandatoryFrom: string
  aspAppointmentDeadline: string | null
  submissions: { documentId: string; submissionRef?: string; accepted: boolean; tddStatus: string }[]
}> {
  const calendar = eInvoicingCalendar(input.issueDate, input.priorYearRevenueAed)
  const submissions = [] as { documentId: string; submissionRef?: string; accepted: boolean; tddStatus: string }[]

  for (const document of input.documents) {
    const relevantWithholding = input.withheld.filter((held) => held.tppId === document.buyerId)
    const artifact = await store.saveDocument({
      invoiceRunId: input.invoiceRunId,
      expectedMemoId: input.expectedMemoId,
      document,
      mode: calendar.mode,
      withheld: relevantWithholding
    }, input.traceId)
    try {
      const response = await asp.submitDocument({
        document_id: document.documentId,
        document_type: document.documentType,
        customization_id: document.customizationId,
        profile_id: document.profileId,
        mode: calendar.mode,
        xml: document.xml,
        pdf: document.pdf
      }, { trace_id: input.traceId })
      await store.appendSubmission({
        documentArtifactId: artifact.id,
        adapterProfile: input.adapterProfile,
        traceId: input.traceId,
        accepted: response.accepted,
        submissionRef: response.submission_ref,
        documentStatus: response.document_status,
        tddStatus: response.tdd_status
      })
      submissions.push({
        documentId: document.documentId,
        submissionRef: response.submission_ref,
        accepted: response.accepted,
        tddStatus: response.tdd_status
      })
    } catch (error) {
      await store.appendSubmission({
        documentArtifactId: artifact.id,
        adapterProfile: input.adapterProfile,
        traceId: input.traceId,
        accepted: false,
        documentStatus: 'transport_error',
        tddStatus: 'not_sent',
        errorDetail: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  return {
    mode: calendar.mode,
    mandatoryFrom: calendar.mandatoryFrom,
    aspAppointmentDeadline: calendar.aspAppointmentDeadline,
    submissions
  }
}
