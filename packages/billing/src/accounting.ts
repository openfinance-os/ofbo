import type { PintAeDocument } from './invoicing.js'
import { divideHalfUp, MF_PER_FIL } from './money.js'
import type { HubFeeClass, ReceivableFeeClass } from './rate-card.js'
import type { SettlementDecomposition } from './collections.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export interface AccountingAccountMap {
  status: 'draft' | 'approved'
  profileRef: string
  receivableControl: string
  schemePayable: string
  cash: string
  outputVat: string
  settlementSuspense: string
  revenueByFeeClass: Partial<Record<ReceivableFeeClass, string>>
  hubExpenseByFeeClass: Partial<Record<HubFeeClass, string>>
}

export interface InvoiceRevenueSplit {
  feeClass: ReceivableFeeClass
  netFils: number
}

export interface InvoiceAccountingInput {
  document: PintAeDocument
  revenueSplits: InvoiceRevenueSplit[]
}

export interface HubPayableAccountingInput {
  sourceId: string
  feeClass: HubFeeClass
  amountFils: number
}

export interface JournalLine {
  account: string
  side: 'debit' | 'credit'
  amountFils: number
  feeClass: ReceivableFeeClass | HubFeeClass | 'output_vat' | 'settlement_cash' | 'settlement_clearing' | 'settlement_residue'
  sourceRefs: string[]
}

export interface JournalInstruction {
  journalId: string
  period: string
  postingDate: string
  /**
   * Receivable sources plus the five BILL-16 payable ones (ADR 0007 D4). One union, because the
   * payable and receivable journals post to a single general ledger and a close pack that could not
   * see both halves would not be a close.
   */
  sourceType:
    | 'pint_ae_invoice' | 'pint_ae_credit_note' | 'hub_payable' | 'net_settlement'
    | 'nebras_hub_payable' | 'lfi_payment_fee_payable' | 'lfi_data_fee_payable'
    | 'payable_credit_note' | 'payable_variance'
  sourceId: string
  lines: JournalLine[]
  debitFils: number
  creditFils: number
}

export interface AccountingBatch {
  batchId: string
  period: string
  postingDate: string
  accountProfileRef: string
  journals: JournalInstruction[]
  debitFils: number
  creditFils: number
  balanced: true
}

export interface AccountingBatchInput {
  period: string
  postingDate: string
  accounts: AccountingAccountMap
  invoices: InvoiceAccountingInput[]
  hubPayables: HubPayableAccountingInput[]
  settlements: SettlementDecomposition[]
}

function safeNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer in fils`)
}

function text(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be configured`)
  return value
}

function calendarDate(value: string, label: string): void {
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new Error(`${label} must be YYYY-MM-DD`)
}

function addLine(lines: JournalLine[], account: string, side: JournalLine['side'], amountFils: number, feeClass: JournalLine['feeClass'], sourceRefs: string[]): void {
  safeNonNegative(amountFils, 'journal line amount')
  if (amountFils === 0) return
  lines.push({ account: text(account, 'journal account'), side, amountFils, feeClass, sourceRefs: [...sourceRefs] })
}

function slug(value: string): string {
  const result = value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase()
  if (!result) throw new Error('journal source id must contain a letter or number')
  return result
}

function journal(period: string, postingDate: string, sourceType: JournalInstruction['sourceType'], sourceId: string, lines: JournalLine[]): JournalInstruction {
  const debitFils = lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amountFils, 0)
  const creditFils = lines.filter((line) => line.side === 'credit').reduce((sum, line) => sum + line.amountFils, 0)
  if (debitFils !== creditFils) throw new Error(`unbalanced journal ${sourceId}: debits ${debitFils}, credits ${creditFils}`)
  if (lines.length < 2) throw new Error(`journal ${sourceId} has insufficient lines`)
  return { journalId: `JRN-${period}-${slug(sourceId)}`, period, postingDate, sourceType, sourceId, lines, debitFils, creditFils }
}

function signedMilliFilsToFils(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer in milli-fils`)
  return divideHalfUp(value, MF_PER_FIL)
}

function invoiceJournal(input: InvoiceAccountingInput, period: string, postingDate: string, accounts: AccountingAccountMap): JournalInstruction {
  const { document, revenueSplits } = input
  if (document.period !== period) throw new Error(`invoice ${document.documentId} belongs to ${document.period}, not ${period}`)
  safeNonNegative(document.grossFils, 'invoice gross')
  safeNonNegative(document.netFils, 'invoice net')
  safeNonNegative(document.vatFils, 'invoice VAT')
  if (document.grossFils !== document.netFils + document.vatFils) throw new Error(`invoice ${document.documentId} VAT totals do not tie`)
  if ((document.taxCategory === 'Z') !== (document.vatFils === 0)) throw new Error(`invoice ${document.documentId} tax category and VAT disagree`)
  const splitTotal = revenueSplits.reduce((sum, split) => {
    safeNonNegative(split.netFils, `invoice ${document.documentId} revenue split`)
    return sum + split.netFils
  }, 0)
  if (splitTotal !== document.netFils) throw new Error(`invoice ${document.documentId} revenue splits do not equal net total`)
  const lines: JournalLine[] = []
  const isCredit = document.documentType === '381'
  addLine(lines, accounts.receivableControl, isCredit ? 'credit' : 'debit', document.grossFils, 'settlement_clearing', [document.documentId])
  for (const split of revenueSplits) {
    const account = accounts.revenueByFeeClass[split.feeClass]
    if (!account) throw new Error(`approved account map has no revenue account for ${split.feeClass}`)
    addLine(lines, account, isCredit ? 'debit' : 'credit', split.netFils, split.feeClass, [document.documentId, ...document.sourceLineRefs])
  }
  addLine(lines, accounts.outputVat, isCredit ? 'debit' : 'credit', document.vatFils, 'output_vat', [document.documentId, document.vatPostureDecisionRef])
  return journal(period, postingDate, isCredit ? 'pint_ae_credit_note' : 'pint_ae_invoice', document.documentId, lines)
}

function payableJournal(input: HubPayableAccountingInput, period: string, postingDate: string, accounts: AccountingAccountMap): JournalInstruction {
  safeNonNegative(input.amountFils, `payable ${input.sourceId}`)
  const expense = accounts.hubExpenseByFeeClass[input.feeClass]
  if (!expense) throw new Error(`approved account map has no Hub expense account for ${input.feeClass}`)
  const refs = [input.sourceId]
  const lines: JournalLine[] = []
  addLine(lines, expense, 'debit', input.amountFils, input.feeClass, refs)
  addLine(lines, accounts.schemePayable, 'credit', input.amountFils, input.feeClass, refs)
  return journal(period, postingDate, 'hub_payable', input.sourceId, lines)
}

function settlementJournal(input: SettlementDecomposition, period: string, postingDate: string, accounts: AccountingAccountMap): JournalInstruction {
  if (input.period !== period) throw new Error(`settlement ${input.settlementReference} belongs to ${input.period}, not ${period}`)
  const receivableMilliFils = input.lines.filter((line) => line.role === 'lfi_receivable').reduce((sum, line) => sum + line.signedMilliFils, 0)
  const payableMilliFils = -input.lines.filter((line) => line.role === 'tpp_of_record_payable').reduce((sum, line) => sum + line.signedMilliFils, 0)
  const receivedFils = signedMilliFilsToFils(input.receivedMilliFils, 'settlement received')
  const receivableFils = signedMilliFilsToFils(receivableMilliFils, 'settlement receivables')
  const payableFils = signedMilliFilsToFils(payableMilliFils, 'settlement payables')
  const residueFils = receivedFils - (receivableFils - payableFils)
  const receivableRefs = input.lines.filter((line) => line.role === 'lfi_receivable').map((line) => line.ledgerRef)
  const payableRefs = input.lines.filter((line) => line.role === 'tpp_of_record_payable').map((line) => line.ledgerRef)
  const lines: JournalLine[] = []
  addLine(lines, accounts.cash, receivedFils >= 0 ? 'debit' : 'credit', Math.abs(receivedFils), 'settlement_cash', [input.settlementReference])
  addLine(lines, accounts.schemePayable, 'debit', payableFils, 'settlement_clearing', payableRefs)
  addLine(lines, accounts.receivableControl, 'credit', receivableFils, 'settlement_clearing', receivableRefs)
  addLine(lines, accounts.settlementSuspense, residueFils < 0 ? 'debit' : 'credit', Math.abs(residueFils), 'settlement_residue', [input.settlementReference, ...receivableRefs, ...payableRefs])
  return journal(period, postingDate, 'net_settlement', input.settlementReference, lines)
}

export function buildAccountingBatch(input: AccountingBatchInput): AccountingBatch {
  if (!MONTH.test(input.period)) throw new Error('period must be YYYY-MM')
  calendarDate(input.postingDate, 'postingDate')
  if (input.accounts.status !== 'approved') throw new Error('an approved account map is required before journal generation')
  text(input.accounts.profileRef, 'account profileRef')
  for (const key of ['receivableControl', 'schemePayable', 'cash', 'outputVat', 'settlementSuspense'] as const) text(input.accounts[key], `account ${key}`)
  const journals = [
    ...input.invoices.map((item) => invoiceJournal(item, input.period, input.postingDate, input.accounts)),
    ...input.hubPayables.map((item) => payableJournal(item, input.period, input.postingDate, input.accounts)),
    ...input.settlements.map((item) => settlementJournal(item, input.period, input.postingDate, input.accounts))
  ]
  const sourceKeys = journals.map((item) => `${item.sourceType}|${item.sourceId}`)
  if (new Set(sourceKeys).size !== sourceKeys.length) throw new Error('duplicate accounting source in batch')
  const debitFils = journals.reduce((sum, item) => sum + item.debitFils, 0)
  const creditFils = journals.reduce((sum, item) => sum + item.creditFils, 0)
  if (debitFils !== creditFils) throw new Error('accounting batch is unbalanced')
  return {
    batchId: `GL-${input.period}-${slug(input.accounts.profileRef)}`,
    period: input.period,
    postingDate: input.postingDate,
    accountProfileRef: input.accounts.profileRef,
    journals,
    debitFils,
    creditFils,
    balanced: true
  }
}

export interface AccountingClosePack {
  period: string
  batchId: string
  accountProfileRef: string
  balanced: boolean
  journalCount: number
  debitFils: number
  creditFils: number
  outputVatFils: number
  settlementResidueFils: number
  invoiceDocumentIds: string[]
  payableSourceIds: string[]
  settlementReferences: string[]
}

export function buildAccountingClosePack(batch: AccountingBatch): AccountingClosePack {
  const allLines = batch.journals.flatMap((item) => item.lines)
  const signed = (feeClass: JournalLine['feeClass']) => allLines.filter((line) => line.feeClass === feeClass)
    .reduce((sum, line) => sum + (line.side === 'credit' ? line.amountFils : -line.amountFils), 0)
  return {
    period: batch.period,
    batchId: batch.batchId,
    accountProfileRef: batch.accountProfileRef,
    balanced: batch.balanced && batch.debitFils === batch.creditFils,
    journalCount: batch.journals.length,
    debitFils: batch.debitFils,
    creditFils: batch.creditFils,
    outputVatFils: signed('output_vat'),
    settlementResidueFils: signed('settlement_residue'),
    invoiceDocumentIds: batch.journals.filter((item) => item.sourceType === 'pint_ae_invoice' || item.sourceType === 'pint_ae_credit_note').map((item) => item.sourceId),
    payableSourceIds: batch.journals.filter((item) => item.sourceType === 'hub_payable').map((item) => item.sourceId),
    settlementReferences: batch.journals.filter((item) => item.sourceType === 'net_settlement').map((item) => item.sourceId)
  }
}
