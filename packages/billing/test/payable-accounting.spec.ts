import { describe, expect, it } from 'vitest'
import {
  buildPayableAcceptance,
  buildPayableAccrual,
  buildPayableSettlement,
  fils,
  type PayableAccountMap,
  type PayableAccrual
} from '../src/index.js'

/**
 * BILL-16 criterion 1 — payable journals (ADR 0007 D4).
 *
 * The lifecycle is accrual → acceptance → settlement, and the property that makes it an accounting
 * lifecycle rather than three unrelated postings is that the accrual REVERSES EXACTLY. Anything left
 * behind sits in the accrued-payable account forever, where no later posting will ever clear it.
 *
 * Expected amounts are milli-fils and the general ledger is fils, so a conversion happens here. That
 * is precisely where an exact reversal is easy to lose: recomputing the reversal from the milli-fils
 * source rounds a second time, and two half-up roundings of different inputs do not have to agree.
 */

const ACCOUNTS: PayableAccountMap = {
  status: 'approved',
  profileRef: 'AP-PROFILE-1',
  ofExternalCostByStream: {
    hub: '6100-of-hub-cost',
    lfi_payment: '6110-of-lfi-payment-cost',
    lfi_data: '6120-of-lfi-data-cost'
  },
  accruedPayable: '2100-accrued-payable',
  accountsPayable: '2110-accounts-payable',
  inputVatReceivable: '1450-input-vat',
  costVariance: '6190-cost-variance',
  schemeClearing: '1210-scheme-clearing',
  cash: '1010-cash'
}

const PERIOD = '2026-06'
const POSTING = '2026-07-05'

function accrualInput(overrides: Record<string, unknown> = {}) {
  return {
    period: PERIOD,
    postingDate: POSTING,
    accounts: ACCOUNTS,
    sourceId: 'STMT-2026-06',
    lines: [{
      feeStream: 'hub' as const,
      costRecipientType: 'nebras' as const,
      costRecipientId: 'NEBRAS',
      expectedNetMilliFils: fils(2500),
      ledgerRef: 'stmt-line-1'
    }],
    ...overrides
  }
}

describe('BILL-16 payable accrual', () => {
  it('books the cost NET of VAT against accrued payable, and balances', () => {
    // ADR 0007 D4: the accrual carries no VAT leg. VAT is only recoverable against a valid tax
    // invoice, which does not exist yet at accrual time — booking it early would claim input VAT the
    // bank cannot yet support.
    const accrual = buildPayableAccrual(accrualInput())

    expect(accrual.journal.debitFils).toBe(accrual.journal.creditFils)
    expect(accrual.journal.sourceType).toBe('nebras_hub_payable')
    const accounts = accrual.journal.lines.map((l) => `${l.side}:${l.account}:${l.amountFils}`)
    expect(accounts).toEqual([
      'debit:6100-of-hub-cost:2500',
      'credit:2100-accrued-payable:2500'
    ])
    expect(accrual.journal.lines.some((l) => l.account === ACCOUNTS.inputVatReceivable)).toBe(false)
  })

  it('routes each fee stream to its own cost account and source type', () => {
    const payment = buildPayableAccrual(accrualInput({
      lines: [{
        feeStream: 'lfi_payment', costRecipientType: 'underlying_lfi', costRecipientId: 'lfi-alpha',
        expectedNetMilliFils: fils(1000), ledgerRef: 'r1'
      }]
    }))
    expect(payment.journal.sourceType).toBe('lfi_payment_fee_payable')
    expect(payment.journal.lines[0]!.account).toBe('6110-of-lfi-payment-cost')

    const data = buildPayableAccrual(accrualInput({
      lines: [{
        feeStream: 'lfi_data', costRecipientType: 'underlying_lfi', costRecipientId: 'lfi-beta',
        expectedNetMilliFils: fils(1000), ledgerRef: 'r2'
      }]
    }))
    expect(data.journal.sourceType).toBe('lfi_data_fee_payable')
    expect(data.journal.lines[0]!.account).toBe('6120-of-lfi-data-cost')
  })

  it('refuses a draft account map, like the receivable side does', () => {
    expect(() => buildPayableAccrual(accrualInput({ accounts: { ...ACCOUNTS, status: 'draft' } })))
      .toThrow(/approved account map/i)
  })
})

describe('BILL-16 payable acceptance', () => {
  function accepted(actualNetMilliFils: number, actualVatMilliFils: number, accrual?: PayableAccrual) {
    const base = accrual ?? buildPayableAccrual(accrualInput())
    return buildPayableAcceptance({
      period: PERIOD,
      postingDate: POSTING,
      accounts: ACCOUNTS,
      accrual: base,
      documentReference: 'NEB-INV-1',
      actualNetMilliFils,
      actualVatMilliFils
    })
  }

  it('reverses the accrual EXACTLY, using the posted amount rather than recomputing it', () => {
    // The accrual was rounded from milli-fils once. Recomputing the reversal from the same milli-fils
    // rounds a second time, and any disagreement strands a balance in the accrued-payable account
    // that no later posting clears.
    const accrual = buildPayableAccrual(accrualInput())
    const result = accepted(fils(2500), fils(125), accrual)

    const reversal = result.journals.find((j) => j.sourceId.includes('REVERSAL'))!
    const accrued = reversal.lines.find((l) => l.account === ACCOUNTS.accruedPayable)!
    expect(accrued.side).toBe('debit')
    expect(accrued.amountFils).toBe(accrual.journal.creditFils)

    // Net effect on the accrued-payable account across the pair is exactly zero.
    const net = [accrual.journal, ...result.journals]
      .flatMap((j) => j.lines)
      .filter((l) => l.account === ACCOUNTS.accruedPayable)
      .reduce((sum, l) => sum + (l.side === 'credit' ? l.amountFils : -l.amountFils), 0)
    expect(net).toBe(0)
  })

  it('books input VAT against the tax invoice and credits AP at GROSS', () => {
    const result = accepted(fils(2500), fils(125))
    const acceptance = result.journals.find((j) => !j.sourceId.includes('REVERSAL'))!

    const vat = acceptance.lines.find((l) => l.account === ACCOUNTS.inputVatReceivable)!
    expect(vat).toMatchObject({ side: 'debit', amountFils: 125 })
    // The VAT leg cites the document, because recoverability depends on holding that tax invoice.
    expect(vat.sourceRefs).toContain('NEB-INV-1')

    const ap = acceptance.lines.find((l) => l.account === ACCOUNTS.accountsPayable)!
    expect(ap).toMatchObject({ side: 'credit', amountFils: 2625 })
  })

  it('books a positive cost variance as a debit when the invoice exceeds the accrual', () => {
    const result = accepted(fils(3000), fils(150))
    const acceptance = result.journals.find((j) => !j.sourceId.includes('REVERSAL'))!
    const variance = acceptance.lines.find((l) => l.account === ACCOUNTS.costVariance)!
    expect(variance).toMatchObject({ side: 'debit', amountFils: 500 })
    expect(result.varianceFils).toBe(500)
  })

  it('books a negative cost variance as a credit when the invoice undercuts the accrual', () => {
    const result = accepted(fils(2000), fils(100))
    const acceptance = result.journals.find((j) => !j.sourceId.includes('REVERSAL'))!
    const variance = acceptance.lines.find((l) => l.account === ACCOUNTS.costVariance)!
    expect(variance).toMatchObject({ side: 'credit', amountFils: 500 })
    expect(result.varianceFils).toBe(-500)
  })

  it('emits no variance line at all when the invoice matches', () => {
    const result = accepted(fils(2500), fils(125))
    const acceptance = result.journals.find((j) => !j.sourceId.includes('REVERSAL'))!
    expect(acceptance.lines.some((l) => l.account === ACCOUNTS.costVariance)).toBe(false)
    expect(result.varianceFils).toBe(0)
  })

  it('refuses to accept the same accrual twice', () => {
    // Accepting twice would reverse an accrual that is already gone and credit AP a second time.
    const accrual = buildPayableAccrual(accrualInput())
    const first = accepted(fils(2500), fils(125), accrual)
    expect(() => buildPayableAcceptance({
      period: PERIOD, postingDate: POSTING, accounts: ACCOUNTS,
      accrual: { ...accrual, acceptedBy: first.journals[0]!.journalId },
      documentReference: 'NEB-INV-1', actualNetMilliFils: fils(2500), actualVatMilliFils: fils(125)
    })).toThrow(/already accepted/i)
  })
})

describe('BILL-16 payable settlement', () => {
  it('clears AP against scheme clearing and balances', () => {
    // IG §10.14–10.15: collection is the scheme's direct-debit PULL, so settlement records the debit
    // being honoured rather than a push payment we initiated.
    const journal = buildPayableSettlement({
      period: PERIOD, postingDate: POSTING, accounts: ACCOUNTS,
      settlementReference: 'DD-2026-06', amountFils: 2625, via: 'scheme_clearing',
      sourceRefs: ['NEB-INV-1']
    })
    expect(journal.debitFils).toBe(journal.creditFils)
    expect(journal.lines.map((l) => `${l.side}:${l.account}`)).toEqual([
      'debit:2110-accounts-payable', 'credit:1210-scheme-clearing'
    ])
  })

  it('clears against cash when the debit settles directly', () => {
    const journal = buildPayableSettlement({
      period: PERIOD, postingDate: POSTING, accounts: ACCOUNTS,
      settlementReference: 'DD-2026-06', amountFils: 2625, via: 'cash', sourceRefs: ['NEB-INV-1']
    })
    expect(journal.lines[1]!.account).toBe('1010-cash')
  })
})

describe('BILL-16 journal balance property (criterion 1)', () => {
  /**
   * Deterministic pseudo-random sweep. A fixed seed rather than a live RNG so a failure is
   * reproducible from the test name alone — a property test that cannot be re-run on the same inputs
   * reports a defect nobody can then chase.
   */
  function* cases(): Generator<{ net: number; vat: number; actualNet: number; actualVat: number }> {
    let seed = 20260616
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % max
    }
    for (let i = 0; i < 400; i += 1) {
      const net = next(5_000_000) + 1
      const actualNet = next(5_000_000) + 1
      yield {
        net,
        vat: Math.round(net * 0.05),
        actualNet,
        actualVat: Math.round(actualNet * 0.05)
      }
    }
  }

  it('every journal in every lifecycle stage balances, VAT leg included', () => {
    let checked = 0
    for (const sample of cases()) {
      const accrual = buildPayableAccrual(accrualInput({
        lines: [{
          feeStream: 'hub', costRecipientType: 'nebras', costRecipientId: 'NEBRAS',
          expectedNetMilliFils: sample.net, ledgerRef: 'r'
        }]
      }))
      const acceptance = buildPayableAcceptance({
        period: PERIOD, postingDate: POSTING, accounts: ACCOUNTS, accrual,
        documentReference: 'NEB-INV-1',
        actualNetMilliFils: sample.actualNet, actualVatMilliFils: sample.actualVat
      })
      const settlement = buildPayableSettlement({
        period: PERIOD, postingDate: POSTING, accounts: ACCOUNTS,
        settlementReference: 'DD-1', amountFils: acceptance.payableGrossFils,
        via: 'scheme_clearing', sourceRefs: ['NEB-INV-1']
      })

      for (const journal of [accrual.journal, ...acceptance.journals, settlement]) {
        expect(journal.debitFils, `${journal.journalId} debits`).toBe(journal.creditFils)
        expect(journal.lines.length).toBeGreaterThanOrEqual(2)
      }
      checked += 1
    }
    // The sweep must actually have run; a generator that yields nothing would pass vacuously.
    expect(checked).toBe(400)
  })

  it('the accrual nets to exactly zero across accrual + acceptance, for every sample', () => {
    for (const sample of cases()) {
      const accrual = buildPayableAccrual(accrualInput({
        lines: [{
          feeStream: 'hub', costRecipientType: 'nebras', costRecipientId: 'NEBRAS',
          expectedNetMilliFils: sample.net, ledgerRef: 'r'
        }]
      }))
      const acceptance = buildPayableAcceptance({
        period: PERIOD, postingDate: POSTING, accounts: ACCOUNTS, accrual,
        documentReference: 'NEB-INV-1',
        actualNetMilliFils: sample.actualNet, actualVatMilliFils: sample.actualVat
      })
      const net = [accrual.journal, ...acceptance.journals]
        .flatMap((j) => j.lines)
        .filter((l) => l.account === ACCOUNTS.accruedPayable)
        .reduce((sum, l) => sum + (l.side === 'credit' ? l.amountFils : -l.amountFils), 0)
      expect(net, `accrued payable residue for net=${sample.net}`).toBe(0)
    }
  })
})
