import { describe, expect, it } from 'vitest'
import {
  buildAccountingBatch,
  fils,
  settlementResidueBreaks,
  type AccountingAccountMap,
  type SettlementDecomposition
} from '../src/index.js'

/**
 * BILL-16 criterion 4 — an unexplained settlement residue must produce BOTH.
 *
 * The suspense line already existed: `settlementJournal` posts the residue so the batch balances.
 * That is exactly the problem it creates — a balanced batch looks finished, and money nobody can
 * explain sits in suspense with nothing owning it. The break is what gives it an owner, an SLA clock
 * and a resolution path through the standard E1 workflow.
 *
 * The two must agree. A suspense line of one amount and a break of another would be worse than no
 * break at all, because the reconciliation would then be chasing a figure the ledger does not hold.
 */

const ACCOUNTS: AccountingAccountMap = {
  status: 'approved',
  profileRef: 'COA-1',
  receivableControl: '1200-ar',
  schemePayable: '2100-scheme-payable',
  cash: '1010-cash',
  outputVat: '2200-output-vat',
  settlementSuspense: '1900-suspense',
  revenueByFeeClass: {},
  hubExpenseByFeeClass: {}
}

function decomposition(overrides: Partial<SettlementDecomposition> = {}): SettlementDecomposition {
  return {
    settlementReference: 'SET-2026-06',
    period: '2026-06',
    receivedMilliFils: fils(9000),
    expectedNetMilliFils: fils(10000),
    residueMilliFils: -fils(1000),
    residueToleranceMilliFils: fils(1),
    lines: [
      { role: 'lfi_receivable', sourceId: 'inv-1', counterpartyId: 'tpp-a', signedMilliFils: fils(10000), ledgerRef: 'led-r1' },
      { role: 'tpp_of_record_payable', sourceId: 'pay-1', counterpartyId: 'NEBRAS', signedMilliFils: 0, ledgerRef: 'led-p1' }
    ],
    break: {
      type: 'settlement_residue',
      settlementReference: 'SET-2026-06',
      period: '2026-06',
      amountMilliFils: -fils(1000),
      receivableLedgerRefs: ['led-r1'],
      payableLedgerRefs: ['led-p1']
    },
    ...overrides
  }
}

describe('BILL-16 settlement residue raises an E1 break', () => {
  it('produces a suspense line AND a reconciliation break, agreeing on the amount', () => {
    const settlement = decomposition()
    const batch = buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-05', accounts: ACCOUNTS,
      invoices: [], hubPayables: [], settlements: [settlement]
    })
    const suspense = batch.journals
      .flatMap((j) => j.lines)
      .filter((l) => l.account === ACCOUNTS.settlementSuspense)
    expect(suspense).toHaveLength(1)

    const breaks = settlementResidueBreaks([settlement])
    expect(breaks).toHaveLength(1)
    // The ledger holds fils; the break must cite the same figure, not the milli-fils source.
    expect(Math.abs(breaks[0]!.varianceAmount.amount)).toBe(suspense[0]!.amountFils)
    expect(breaks[0]!.varianceAmount.currency).toBe('AED')
  })

  it('classifies the break so it enters the standard E1 workflow', () => {
    const breaks = settlementResidueBreaks([decomposition()])
    expect(breaks[0]).toMatchObject({
      lineType: 'payment_settlement',
      status: 'flagged',
      runId: 'SET-2026-06'
    })
    // Both sides of the three-way match are cited, which is what makes it investigable.
    expect(breaks[0]!.sourceARef).toContain('led-r1')
    expect(breaks[0]!.sourceBRef).toContain('led-p1')
  })

  it('raises NO break when the residue is inside tolerance', () => {
    // A sub-fil residue is a rounding artefact. Raising a break for it would train the desk to close
    // them unread, which costs more than the residue.
    const breaks = settlementResidueBreaks([decomposition({ residueMilliFils: 400, break: null })])
    expect(breaks).toEqual([])
  })

  it('raises one break per settlement, not one per residue line', () => {
    const breaks = settlementResidueBreaks([
      decomposition(),
      decomposition({
        settlementReference: 'SET-2026-06-B',
        break: {
          type: 'settlement_residue', settlementReference: 'SET-2026-06-B', period: '2026-06',
          amountMilliFils: fils(500), receivableLedgerRefs: ['led-r2'], payableLedgerRefs: []
        }
      })
    ])
    expect(breaks).toHaveLength(2)
    expect(breaks.map((b) => b.runId)).toEqual(['SET-2026-06', 'SET-2026-06-B'])
  })

  it('rounds the break amount the same way the ledger does', () => {
    // 1500 milli-fils is 1.5 fils. If the break rounded differently from the suspense line the
    // reconciliation would chase a figure the ledger does not hold.
    const settlement = decomposition({
      receivedMilliFils: fils(10000) - 1500,
      residueMilliFils: -1500,
      break: {
        type: 'settlement_residue', settlementReference: 'SET-2026-06', period: '2026-06',
        amountMilliFils: -1500, receivableLedgerRefs: ['led-r1'], payableLedgerRefs: ['led-p1']
      }
    })
    const batch = buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-05', accounts: ACCOUNTS,
      invoices: [], hubPayables: [], settlements: [settlement]
    })
    const suspense = batch.journals.flatMap((j) => j.lines)
      .find((l) => l.account === ACCOUNTS.settlementSuspense)!
    const breaks = settlementResidueBreaks([settlement])
    expect(Math.abs(breaks[0]!.varianceAmount.amount)).toBe(suspense.amountFils)
  })
})
