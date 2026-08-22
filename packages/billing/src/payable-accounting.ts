import type { JournalInstruction, JournalLine } from './accounting.js'
import { divideHalfUp, MF_PER_FIL } from './money.js'
import type { CostRecipientType, TppCostFeeStream } from './tpp-cost.js'

/**
 * BILL-16 — payable accounting for the TPP-of-record cost side (ADR 0007 D4).
 *
 * Three stages, and they are one lifecycle rather than three postings:
 *
 * - **Accrual**, from the expected statement: `Dr OF external cost / Cr accrued payable`, NET of VAT.
 *   No VAT leg, because input VAT is only recoverable against a valid tax invoice and none exists yet.
 * - **Acceptance**, from the provider's tax invoice: reverse the accrual, `Dr Input VAT receivable`,
 *   `Dr/Cr cost variance` for the difference, `Cr accounts payable` at GROSS.
 * - **Settlement**: `Dr accounts payable / Cr scheme clearing or cash`. IG §10.14–10.15 makes
 *   collection a direct-debit PULL by the scheme, so this records a debit being honoured rather than
 *   a payment we pushed.
 *
 * Amounts arrive in milli-fils and the ledger is in fils, exactly as the receivable side already does
 * it. The conversion is the delicate part — see `buildPayableAcceptance`.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** The five payable journal sources that join the existing receivable set. */
export type PayableJournalSource =
  | 'nebras_hub_payable'
  | 'lfi_payment_fee_payable'
  | 'lfi_data_fee_payable'
  | 'payable_credit_note'
  | 'payable_variance'

export type PayableSettlementRoute = 'scheme_clearing' | 'cash'

export interface PayableAccountMap {
  status: 'draft' | 'approved'
  profileRef: string
  /** One cost account per fee stream, so the P&L shows Hub and underlying-LFI cost separately. */
  ofExternalCostByStream: Record<TppCostFeeStream, string>
  accruedPayable: string
  accountsPayable: string
  inputVatReceivable: string
  costVariance: string
  schemeClearing: string
  cash: string
}

export interface PayableAccrualLine {
  feeStream: TppCostFeeStream
  costRecipientType: CostRecipientType
  costRecipientId: string
  expectedNetMilliFils: number
  ledgerRef: string
}

export interface PayableAccrualInput {
  period: string
  postingDate: string
  accounts: PayableAccountMap
  sourceId: string
  lines: readonly PayableAccrualLine[]
}

export interface PayableAccrual {
  journal: JournalInstruction
  /**
   * The fils actually posted to accrued payable. The reversal reads THIS rather than recomputing —
   * see `buildPayableAcceptance`.
   */
  accruedFils: number
  feeStream: TppCostFeeStream
  sourceId: string
  /** Set once accepted, so a second acceptance can be refused rather than double-posted. */
  acceptedBy?: string
}

export interface PayableAcceptanceInput {
  period: string
  postingDate: string
  accounts: PayableAccountMap
  accrual: PayableAccrual
  /** The provider tax invoice this acceptance is supported by; input VAT depends on holding it. */
  documentReference: string
  actualNetMilliFils: number
  actualVatMilliFils: number
}

export interface PayableAcceptance {
  journals: JournalInstruction[]
  payableGrossFils: number
  actualNetFils: number
  actualVatFils: number
  /** Signed: positive means the invoice exceeded the accrual. */
  varianceFils: number
}

export interface PayableSettlementInput {
  period: string
  postingDate: string
  accounts: PayableAccountMap
  settlementReference: string
  amountFils: number
  via: PayableSettlementRoute
  sourceRefs: readonly string[]
}

const SOURCE_BY_STREAM: Record<TppCostFeeStream, PayableJournalSource> = {
  hub: 'nebras_hub_payable',
  lfi_payment: 'lfi_payment_fee_payable',
  lfi_data: 'lfi_data_fee_payable'
}

function text(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be configured`)
  return value
}

function assertPeriod(value: string): void {
  if (!MONTH.test(value)) throw new Error('period must be YYYY-MM')
}

function assertDate(value: string, label: string): void {
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new Error(`${label} must be YYYY-MM-DD`)
  }
}

function assertApproved(accounts: PayableAccountMap): void {
  if (accounts.status !== 'approved') {
    throw new Error('an approved account map is required before payable journal generation')
  }
  for (const key of ['accruedPayable', 'accountsPayable', 'inputVatReceivable', 'costVariance', 'schemeClearing', 'cash'] as const) {
    text(accounts[key], `payable account ${key}`)
  }
}

function slug(value: string): string {
  const result = value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase()
  if (!result) throw new Error('journal source id must contain a letter or number')
  return result
}

function toFils(milliFils: number, label: string): number {
  if (!Number.isSafeInteger(milliFils) || milliFils < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer in milli-fils`)
  }
  return divideHalfUp(milliFils, MF_PER_FIL)
}

function line(
  account: string,
  side: JournalLine['side'],
  amountFils: number,
  feeClass: JournalLine['feeClass'],
  sourceRefs: readonly string[]
): JournalLine {
  return { account: text(account, 'journal account'), side, amountFils, feeClass, sourceRefs: [...sourceRefs] }
}

function assemble(
  period: string,
  postingDate: string,
  sourceType: PayableJournalSource,
  sourceId: string,
  lines: JournalLine[]
): JournalInstruction {
  const kept = lines.filter((entry) => entry.amountFils !== 0)
  const debitFils = kept.filter((entry) => entry.side === 'debit').reduce((sum, entry) => sum + entry.amountFils, 0)
  const creditFils = kept.filter((entry) => entry.side === 'credit').reduce((sum, entry) => sum + entry.amountFils, 0)
  if (debitFils !== creditFils) {
    throw new Error(`unbalanced payable journal ${sourceId}: debits ${debitFils}, credits ${creditFils}`)
  }
  if (kept.length < 2) throw new Error(`payable journal ${sourceId} has insufficient lines`)
  return {
    journalId: `JRN-${period}-${slug(sourceId)}`,
    period,
    postingDate,
    // Widened on JournalInstruction so the payable sources join the receivable ones in one ledger.
    sourceType: sourceType as JournalInstruction['sourceType'],
    sourceId,
    lines: kept,
    debitFils,
    creditFils
  }
}

/** Accrue the expected cost, net of VAT. */
export function buildPayableAccrual(input: PayableAccrualInput): PayableAccrual {
  assertPeriod(input.period)
  assertDate(input.postingDate, 'postingDate')
  assertApproved(input.accounts)
  if (input.lines.length === 0) throw new Error('a payable accrual needs at least one line')

  const streams = new Set(input.lines.map((entry) => entry.feeStream))
  if (streams.size !== 1) {
    // One stream per journal: the cost accounts differ per stream and the source type names the
    // stream, so a mixed journal could not be classified as either.
    throw new Error('a payable accrual journal must cover exactly one fee stream')
  }
  const feeStream = input.lines[0]!.feeStream
  const costAccount = input.accounts.ofExternalCostByStream[feeStream]
  if (!costAccount) throw new Error(`approved account map has no OF external cost account for ${feeStream}`)

  const refs = input.lines.map((entry) => entry.ledgerRef)
  // Sum in milli-fils and round ONCE. Rounding each line and summing would drift from the statement
  // total the reconciliation was run against.
  const totalMilliFils = input.lines.reduce((sum, entry) => sum + entry.expectedNetMilliFils, 0)
  const accruedFils = toFils(totalMilliFils, 'expected net')

  const journal = assemble(input.period, input.postingDate, SOURCE_BY_STREAM[feeStream], input.sourceId, [
    line(costAccount, 'debit', accruedFils, feeStream === 'hub' ? 'hub.standard' : 'settlement_clearing', [input.sourceId, ...refs]),
    line(input.accounts.accruedPayable, 'credit', accruedFils, 'settlement_clearing', [input.sourceId, ...refs])
  ])
  return { journal, accruedFils, feeStream, sourceId: input.sourceId }
}

/**
 * Accept the provider invoice: reverse the accrual, book input VAT and the variance, credit AP gross.
 *
 * The reversal reads `accrual.accruedFils` — the amount actually posted — rather than recomputing
 * from the milli-fils source. That is the whole reason `accruedFils` is carried on the accrual.
 * Expected amounts are milli-fils and the ledger is fils, so a recomputed reversal rounds a second
 * time; two half-up roundings need not agree, and any disagreement strands a balance in the accrued
 * payable account that no later posting in this lifecycle will ever clear.
 */
export function buildPayableAcceptance(input: PayableAcceptanceInput): PayableAcceptance {
  assertPeriod(input.period)
  assertDate(input.postingDate, 'postingDate')
  assertApproved(input.accounts)
  if (input.accrual.acceptedBy) {
    throw new Error(
      `payable accrual ${input.accrual.sourceId} was already accepted by ${input.accrual.acceptedBy}: `
      + 'accepting twice would reverse an accrual that is already gone and credit AP a second time'
    )
  }
  const document = text(input.documentReference, 'documentReference')
  const actualNetFils = toFils(input.actualNetMilliFils, 'actual net')
  const actualVatFils = toFils(input.actualVatMilliFils, 'actual VAT')
  const payableGrossFils = actualNetFils + actualVatFils
  const varianceFils = actualNetFils - input.accrual.accruedFils

  const costAccount = input.accounts.ofExternalCostByStream[input.accrual.feeStream]!
  const refs = [input.accrual.sourceId, document]

  const reversal = assemble(
    input.period, input.postingDate, SOURCE_BY_STREAM[input.accrual.feeStream],
    `${input.accrual.sourceId}-REVERSAL`,
    [
      line(input.accounts.accruedPayable, 'debit', input.accrual.accruedFils, 'settlement_clearing', refs),
      line(costAccount, 'credit', input.accrual.accruedFils, 'settlement_clearing', refs)
    ]
  )

  const acceptanceLines: JournalLine[] = [
    line(costAccount, 'debit', actualNetFils, 'settlement_clearing', refs),
    // Cited to the tax invoice: recoverability depends on holding that document, so the leg carries
    // its own evidence rather than relying on the batch to remember why VAT was claimed.
    line(input.accounts.inputVatReceivable, 'debit', actualVatFils, 'output_vat', [document]),
    line(input.accounts.accountsPayable, 'credit', payableGrossFils, 'settlement_clearing', refs)
  ]
  if (varianceFils !== 0) {
    // The variance is already inside `actualNetFils`, which replaced the accrued cost. This line
    // reclassifies that difference OUT of the cost account and into cost variance, so the cost
    // account carries what we expected and the variance is visible as its own number.
    acceptanceLines.push(line(input.accounts.costVariance, varianceFils > 0 ? 'debit' : 'credit', Math.abs(varianceFils), 'settlement_clearing', refs))
    acceptanceLines.push(line(costAccount, varianceFils > 0 ? 'credit' : 'debit', Math.abs(varianceFils), 'settlement_clearing', refs))
  }

  const acceptance = assemble(
    input.period, input.postingDate, 'payable_variance', `${input.accrual.sourceId}-ACCEPT`, acceptanceLines
  )
  return { journals: [reversal, acceptance], payableGrossFils, actualNetFils, actualVatFils, varianceFils }
}

// ---------------------------------------------------------------------------------------------
// Settlement residue → E1 break (criterion 4)
// ---------------------------------------------------------------------------------------------

/** An E1 `reconciliation_break`, in the shape that table and the contract already use. */
export interface SettlementResidueReconciliationBreak {
  runId: string
  lineType: 'payment_settlement'
  status: 'flagged'
  /** Integer minor units + ISO 4217, per the binding money convention. */
  varianceAmount: { amount: number; currency: string }
  sourceARef: string
  sourceBRef: string
  sourceCRef: string
  period: string
}

/** The decomposition fields the residue break is derived from. */
export interface ResidueBreakSource {
  settlementReference: string
  period: string
  receivedMilliFils: number
  lines: ReadonlyArray<{ role: 'lfi_receivable' | 'tpp_of_record_payable'; signedMilliFils: number; ledgerRef: string }>
  break: {
    amountMilliFils: number
    receivableLedgerRefs: readonly string[]
    payableLedgerRefs: readonly string[]
  } | null
}

/**
 * Raise an E1 break for every settlement carrying an unexplained residue.
 *
 * The suspense posting alone is the problem this solves, not the solution. `settlementJournal`
 * already books the residue so the batch balances — and a balanced batch reads as finished, leaving
 * money nobody can explain sitting in suspense with no owner, no SLA clock and no resolution path.
 * The break supplies all three by putting the residue through the standard E1 workflow.
 *
 * The amount is DERIVED THE SAME WAY THE LEDGER DERIVES IT — `received − (receivable − payable)`, each
 * component rounded to fils first — rather than by rounding `residueMilliFils` directly. Those two are
 * not the same number. A residue of −1500 milli-fils against a received total of 9,998,500 rounds
 * directly to −2 fils, while the ledger posts −1, because 9998.5 rounds up before the subtraction.
 * A break citing a figure the ledger does not hold sends the desk chasing a number that appears
 * nowhere — the same trap as recomputing an accrual reversal from its milli-fils source.
 */
export function settlementResidueBreaks(
  settlements: readonly ResidueBreakSource[],
  currency = 'AED'
): SettlementResidueReconciliationBreak[] {
  const out: SettlementResidueReconciliationBreak[] = []
  for (const settlement of settlements) {
    // Null when the decomposition found the residue inside tolerance. A sub-fil residue is a rounding
    // artefact, and raising a break for it trains the desk to close them unread.
    if (!settlement.break) continue
    const sum = (role: 'lfi_receivable' | 'tpp_of_record_payable') =>
      settlement.lines.filter((line) => line.role === role).reduce((total, line) => total + line.signedMilliFils, 0)
    const signedToFils = (value: number) =>
      value < 0 ? -divideHalfUp(-value, MF_PER_FIL) : divideHalfUp(value, MF_PER_FIL)

    const receivedFils = signedToFils(settlement.receivedMilliFils)
    const receivableFils = signedToFils(sum('lfi_receivable'))
    const payableFils = signedToFils(-sum('tpp_of_record_payable'))
    const residueFils = receivedFils - (receivableFils - payableFils)

    out.push({
      runId: settlement.settlementReference,
      lineType: 'payment_settlement',
      status: 'flagged',
      varianceAmount: { amount: residueFils, currency },
      // Both sides of the match are cited, which is what makes the break investigable rather than
      // just a number with a status.
      sourceARef: settlement.break.receivableLedgerRefs.join(','),
      sourceBRef: settlement.break.payableLedgerRefs.join(','),
      sourceCRef: settlement.settlementReference,
      period: settlement.period
    })
  }
  return out
}

/** Clear accounts payable once the scheme's direct debit is honoured. */
export function buildPayableSettlement(input: PayableSettlementInput): JournalInstruction {
  assertPeriod(input.period)
  assertDate(input.postingDate, 'postingDate')
  assertApproved(input.accounts)
  if (!Number.isSafeInteger(input.amountFils) || input.amountFils <= 0) {
    throw new RangeError('payable settlement amountFils must be a positive safe integer')
  }
  const contra = input.via === 'cash' ? input.accounts.cash : input.accounts.schemeClearing
  return assemble(input.period, input.postingDate, 'nebras_hub_payable', input.settlementReference, [
    line(input.accounts.accountsPayable, 'debit', input.amountFils, 'settlement_clearing', input.sourceRefs),
    line(contra, 'credit', input.amountFils, input.via === 'cash' ? 'settlement_cash' : 'settlement_clearing', input.sourceRefs)
  ])
}
