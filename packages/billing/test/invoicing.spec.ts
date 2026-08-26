import { describe, expect, it } from 'vitest'
import {
  PINT_AE_CUSTOMIZATION_ID,
  PINT_AE_PROFILE_ID,
  aed,
  buildPintAeDocuments,
  eInvoicingCalendar,
  type BillingParty,
  type CollectionMemoDiff,
  type ExpectedCollectionMemo
} from '../src/index.js'

const supplier: BillingParty = {
  id: 'bank-ae',
  legalName: 'Example UAE Bank PJSC',
  endpointScheme: '0235',
  endpointId: '1357902468',
  taxRegistrationId: '135790246801003',
  legalRegistrationId: '112345678900003',
  address: { street: '1 Finance Street', city: 'Dubai', subdivision: 'DXB', countryCode: 'AE' }
}

const domesticBuyer: BillingParty = {
  id: 'tpp-a',
  legalName: 'Domestic TPP LLC',
  endpointScheme: '0235',
  endpointId: '1345678901',
  taxRegistrationId: '134567890123003',
  legalRegistrationId: '112345679000001',
  address: { street: '2 Market Street', city: 'Abu Dhabi', subdivision: 'AUH', countryCode: 'AE' }
}

const foreignBuyer: BillingParty = {
  id: 'tpp-b',
  legalName: 'Foreign TPP Pty Ltd',
  endpointScheme: '0151',
  endpointId: '51824753556',
  legalRegistrationId: 'AU-51824753556',
  address: { street: '3 Harbour Road', city: 'Sydney', subdivision: 'NSW', countryCode: 'AU' }
}

const vatPosture = {
  status: 'approved' as const,
  decisionRef: 'BD-19-TAX-APPROVAL-001',
  domesticTreatment: 'vat_inclusive_5_105' as const,
  foreignTreatment: 'zero_rated_export_article_31' as const
}

const expected: ExpectedCollectionMemo = {
  period: '2026-06',
  rateCardVersion: '2026.06.02',
  generatedAt: '2026-07-03T01:00:00.000Z',
  dueAt: '2026-07-03T23:59:59.999Z',
  generatedOnTime: true,
  totalMilliFils: aed(115),
  lines: [
    {
      lineRef: '2026-06|tpp-a|payment.merchant_collection',
      tppId: 'tpp-a',
      feeClass: 'payment.merchant_collection',
      units: 21,
      events: 2,
      amountMilliFils: aed(105),
      valueMilliFils: aed(1_000),
      eventIds: ['evt-1', 'evt-2'],
      traceIds: ['trace-1']
    },
    {
      lineRef: '2026-06|tpp-b|data.corporate_page',
      tppId: 'tpp-b',
      feeClass: 'data.corporate_page',
      units: 25,
      events: 1,
      amountMilliFils: aed(10),
      valueMilliFils: 0,
      eventIds: ['evt-3'],
      traceIds: ['trace-2']
    }
  ]
}

const diff: CollectionMemoDiff = {
  expectedPeriod: '2026-06',
  expectedRateCardVersion: '2026.06.02',
  memoReference: 'CM-2026-06-001',
  memoIssuedAt: '2026-07-05T00:00:00.000Z',
  memoReceivedAt: '2026-07-05T08:00:00.000Z',
  thresholdMilliFils: aed(0.01),
  queryDeadline: '2026-08-04T00:00:00.000Z',
  queryWindowStatus: 'open',
  daysRemainingAtIngest: 30,
  matchedLines: 1,
  materialBreaks: 1,
  expectedTotalMilliFils: aed(115),
  memoTotalMilliFils: aed(105),
  netVarianceMilliFils: -aed(10),
  grossVarianceMilliFils: aed(10),
  lines: [
    {
      lineRef: '2026-06|tpp-a|payment.merchant_collection',
      tppId: 'tpp-a',
      feeClass: 'payment.merchant_collection',
      expectedUnits: 21,
      memoUnits: 21,
      expectedMilliFils: aed(105),
      memoMilliFils: aed(95),
      varianceMilliFils: -aed(10),
      materialVariance: true,
      status: 'break',
      presence: 'both',
      eventIds: ['evt-1', 'evt-2'],
      traceIds: ['trace-1']
    },
    {
      lineRef: '2026-06|tpp-b|data.corporate_page',
      tppId: 'tpp-b',
      feeClass: 'data.corporate_page',
      expectedUnits: 25,
      memoUnits: 25,
      expectedMilliFils: aed(10),
      memoMilliFils: aed(10),
      varianceMilliFils: 0,
      materialVariance: false,
      status: 'matched',
      presence: 'both',
      eventIds: ['evt-3'],
      traceIds: ['trace-2']
    }
  ]
}

describe('BILL-04 PINT AE document generation', () => {
  it('withholds only the disputed amount and extracts 5/105 VAT from domestic gross fees', () => {
    const result = buildPintAeDocuments({
      expected,
      diff,
      issueDate: '2026-07-06',
      supplier,
      vatPosture,
      buyers: [domesticBuyer, foreignBuyer]
    })

    expect(result.withheld).toEqual([{
      lineRef: '2026-06|tpp-a|payment.merchant_collection',
      tppId: 'tpp-a',
      amountMilliFils: aed(10),
      evidenceEventIds: ['evt-1', 'evt-2'],
      evidenceTraceIds: ['trace-1']
    }])

    const domestic = result.documents.find((document) => document.buyerId === 'tpp-a')!
    expect(domestic).toMatchObject({
      documentType: '380',
      transactionType: '00000000',
      taxCategory: 'S',
      grossFils: 9_500,
      netFils: 9_048,
      vatFils: 452,
      tddRequired: true,
      vatPostureDecisionRef: 'BD-19-TAX-APPROVAL-001'
    })
    expect(domestic.xml).toContain(`<cbc:CustomizationID>${PINT_AE_CUSTOMIZATION_ID}</cbc:CustomizationID>`)
    expect(domestic.xml).toContain(`<cbc:ProfileID>${PINT_AE_PROFILE_ID}</cbc:ProfileID>`)
    expect(domestic.xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>')
    expect(domestic.xml).toContain('<cbc:EndpointID schemeID="0235">1345678901</cbc:EndpointID>')
    expect(domestic.xml).toContain('<cbc:Percent>5.00</cbc:Percent>')
    expect(domestic.xml).toContain('<cbc:ID schemeID="SAC">OFBO-PAYMENT-MERCHANT-COLLECTION</cbc:ID>')
    expect(new TextDecoder().decode(domestic.pdf)).toMatch(/^%PDF-1\.4/)
  })

  it('flags a foreign TPP as a zero-rated export while keeping AED tax totals and TDD reporting', () => {
    const result = buildPintAeDocuments({
      expected,
      diff,
      issueDate: '2026-07-06',
      supplier,
      vatPosture,
      buyers: [domesticBuyer, foreignBuyer]
    })
    const exported = result.documents.find((document) => document.buyerId === 'tpp-b')!

    expect(exported).toMatchObject({
      transactionType: '00000001',
      taxCategory: 'Z',
      grossFils: 1_000,
      netFils: 1_000,
      vatFils: 0,
      tddRequired: true
    })
    expect(exported.xml).toContain('<cbc:IdentificationCode>AU</cbc:IdentificationCode>')
    expect(exported.xml).toContain('<cbc:TaxAmount currencyID="AED">0.00</cbc:TaxAmount>')
    expect(exported.xml).toContain('<cac:Delivery>')
  })

  it('creates a 381 credit note with a reference to the preceding invoice', () => {
    const result = buildPintAeDocuments({
      expected: { ...expected, lines: [], totalMilliFils: 0 },
      issueDate: '2026-08-06',
      supplier,
      vatPosture,
      buyers: [domesticBuyer],
      creditAdjustments: [{
        buyerId: 'tpp-a',
        feeClass: 'payment.merchant_collection',
        amountMilliFils: aed(21),
        reason: 'Approved June billing query',
        precedingInvoiceId: 'INV-2026-06-TPP-A'
      }]
    })
    const credit = result.documents[0]!

    expect(credit).toMatchObject({ documentType: '381', grossFils: 2_100, netFils: 2_000, vatFils: 100 })
    expect(credit.xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>')
    expect(credit.xml).toContain('<cac:BillingReference>')
    expect(credit.xml).toContain('<cbc:ResponseCode>DL8.61.1.C</cbc:ResponseCode>')
    expect(credit.xml).toContain('<cbc:ID>INV-2026-06-TPP-A</cbc:ID>')
    expect(credit.xml).not.toContain('<cac:PaymentMeans>')
  })

  it('surfaces the statutory calendar and switches mode at the applicable revenue threshold', () => {
    expect(eInvoicingCalendar('2026-12-31', 75_000_000)).toMatchObject({
      mode: 'voluntary_pilot',
      aspAppointmentDeadline: '2026-10-30',
      mandatoryFrom: '2027-01-01'
    })
    expect(eInvoicingCalendar('2027-01-01', 75_000_000).mode).toBe('mandatory')
    expect(eInvoicingCalendar('2027-01-01', 10_000_000)).toMatchObject({
      mode: 'voluntary_pilot',
      mandatoryFrom: '2027-07-01'
    })
  })

  it('rejects domestic parties that do not use their 10-digit TIN as endpoint scheme 0235', () => {
    expect(() => buildPintAeDocuments({
      expected,
      issueDate: '2026-07-06',
      supplier,
      vatPosture,
      buyers: [{ ...domesticBuyer, endpointScheme: '9999' }]
    })).toThrow(/0235/)
  })

  it('blocks invoice generation after the BD-19 14-day monthly-cycle limit', () => {
    expect(() => buildPintAeDocuments({
      expected,
      issueDate: '2026-07-15',
      supplier,
      vatPosture,
      buyers: [domesticBuyer, foreignBuyer]
    })).toThrow(/14-day BD-19/)
  })
})
