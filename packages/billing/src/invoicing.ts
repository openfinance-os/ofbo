import { divideHalfUp, MF_PER_FIL } from './money.js'
import type { BillingFeeClass } from './rate-card.js'
import type { CollectionMemoDiff, ExpectedCollectionMemo } from './memo.js'

export const PINT_AE_VERSION = '1.0.3'
export const PINT_AE_CUSTOMIZATION_ID = 'urn:peppol:pint:billing-1@ae-1'
export const PINT_AE_PROFILE_ID = 'urn:peppol:bis:billing'
export const PINT_AE_PILOT_FROM = '2026-07-01'
export const PINT_AE_PHASE_ONE_ASP_APPOINTMENT_DEADLINE = '2026-10-30'
export const PINT_AE_PHASE_ONE_MANDATORY_FROM = '2027-01-01'
export const PINT_AE_PHASE_TWO_MANDATORY_FROM = '2027-07-01'
export const PINT_AE_PHASE_ONE_REVENUE_THRESHOLD_AED = 50_000_000

export type EInvoicingMode = 'voluntary_pilot' | 'mandatory'
export type PintAeDocumentType = '380' | '381'
export type PintAeTaxCategory = 'S' | 'Z'

export interface BillingAddress {
  street: string
  city: string
  subdivision: string
  countryCode: string
  postalCode?: string
}

export interface BillingParty {
  id: string
  legalName: string
  endpointScheme: string
  endpointId: string
  taxRegistrationId?: string
  legalRegistrationId: string
  address: BillingAddress
}

export interface CreditAdjustment {
  buyerId: string
  feeClass: BillingFeeClass
  amountMilliFils: number
  reason: string
  precedingInvoiceId: string
}

/** BD-19 is a deployment decision, not an inferred default. */
export interface BillingVatPosture {
  status: 'approved'
  decisionRef: string
  domesticTreatment: 'vat_inclusive_5_105'
  foreignTreatment: 'zero_rated_export_article_31'
}

export interface WithheldBillingAmount {
  lineRef: string
  tppId: string
  amountMilliFils: number
  evidenceEventIds: string[]
  evidenceTraceIds: string[]
}

export interface PintAeDocument {
  documentId: string
  uuid: string
  documentType: PintAeDocumentType
  buyerId: string
  period: string
  issueDate: string
  transactionType: '00000000' | '00000001'
  taxCategory: PintAeTaxCategory
  grossFils: number
  netFils: number
  vatFils: number
  tddRequired: true
  vatPostureDecisionRef: string
  customizationId: typeof PINT_AE_CUSTOMIZATION_ID
  profileId: typeof PINT_AE_PROFILE_ID
  xml: string
  pdf: Uint8Array
  sourceLineRefs: string[]
}

export interface BuildPintAeDocumentsInput {
  expected: ExpectedCollectionMemo
  diff?: CollectionMemoDiff
  issueDate: string
  supplier: BillingParty
  buyers: BillingParty[]
  vatPosture: BillingVatPosture
  creditAdjustments?: CreditAdjustment[]
}

interface DocumentLine {
  feeClass: BillingFeeClass
  description: string
  units: number
  grossFils: number
  netFils: number
  vatFils: number
  sourceLineRef: string
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new TypeError(`${label} must be non-empty`)
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new RangeError(`${label} must be YYYY-MM-DD`)
  }
}

function assertParty(party: BillingParty, role: string): void {
  requireText(party.id, `${role}.id`)
  requireText(party.legalName, `${role}.legalName`)
  requireText(party.endpointScheme, `${role}.endpointScheme`)
  requireText(party.endpointId, `${role}.endpointId`)
  requireText(party.legalRegistrationId, `${role}.legalRegistrationId`)
  requireText(party.address.street, `${role}.address.street`)
  requireText(party.address.city, `${role}.address.city`)
  requireText(party.address.subdivision, `${role}.address.subdivision`)
  if (!/^[A-Z]{2}$/.test(party.address.countryCode)) throw new TypeError(`${role}.address.countryCode must be ISO 3166-1 alpha-2`)
  if (party.address.countryCode === 'AE') {
    if (party.endpointScheme !== '0235' || !/^\d{10}$/.test(party.endpointId)) {
      throw new TypeError(`${role} in the UAE must use its 10-digit TIN with endpoint scheme 0235`)
    }
    if (!party.taxRegistrationId || !/^\d{15}$/.test(party.taxRegistrationId)) {
      throw new TypeError(`${role} in the UAE must provide a 15-digit VAT TRN`)
    }
  }
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function stableHash(value: string, seed = 0x811c9dc5): number {
  let hash = seed
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

function stableUuid(value: string): string {
  const words = [0, 1, 2, 3].map((index) => stableHash(`${index}|${value}`, 0x811c9dc5 ^ (index * 0x9e3779b1)))
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function slug(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36)
}

function money(fils: number): string {
  const sign = fils < 0 ? '-' : ''
  const absolute = Math.abs(fils)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** Round an internal milli-fil gross amount once at the statutory two-decimal document boundary. */
function milliFilsToFils(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('billing amount must be a non-negative safe integer')
  return divideHalfUp(value, MF_PER_FIL)
}

/** UAE fees are configured VAT-inclusive: VAT is the rounded 5/105 fraction of gross. */
export function extractVatInclusiveFils(grossFils: number): { grossFils: number; netFils: number; vatFils: number } {
  if (!Number.isSafeInteger(grossFils) || grossFils < 0) throw new RangeError('grossFils must be a non-negative safe integer')
  const vatFils = divideHalfUp(grossFils * 5, 105)
  return { grossFils, netFils: grossFils - vatFils, vatFils }
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function eInvoicingCalendar(issueDate: string, priorYearRevenueAed: number): {
  mode: EInvoicingMode
  pilotFrom: string
  aspAppointmentDeadline: string | null
  mandatoryFrom: string
  revenueThresholdAed: number
} {
  assertDate(issueDate, 'issueDate')
  if (!Number.isFinite(priorYearRevenueAed) || priorYearRevenueAed < 0) throw new RangeError('priorYearRevenueAed must be non-negative')
  const phaseOne = priorYearRevenueAed >= PINT_AE_PHASE_ONE_REVENUE_THRESHOLD_AED
  const mandatoryFrom = phaseOne ? PINT_AE_PHASE_ONE_MANDATORY_FROM : PINT_AE_PHASE_TWO_MANDATORY_FROM
  return {
    mode: issueDate >= mandatoryFrom ? 'mandatory' : 'voluntary_pilot',
    pilotFrom: PINT_AE_PILOT_FROM,
    aspAppointmentDeadline: phaseOne ? PINT_AE_PHASE_ONE_ASP_APPOINTMENT_DEADLINE : null,
    mandatoryFrom,
    revenueThresholdAed: PINT_AE_PHASE_ONE_REVENUE_THRESHOLD_AED
  }
}

function partyXml(party: BillingParty): string {
  const tax = party.taxRegistrationId
    ? `<cac:PartyTaxScheme><cbc:CompanyID>${xml(party.taxRegistrationId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
    : ''
  const postal = party.address.postalCode ? `<cbc:PostalZone>${xml(party.address.postalCode)}</cbc:PostalZone>` : ''
  return `<cac:Party>
<cbc:EndpointID schemeID="${xml(party.endpointScheme)}">${xml(party.endpointId)}</cbc:EndpointID>
<cac:PostalAddress><cbc:StreetName>${xml(party.address.street)}</cbc:StreetName><cbc:CityName>${xml(party.address.city)}</cbc:CityName>${postal}<cbc:CountrySubentity>${xml(party.address.subdivision)}</cbc:CountrySubentity><cac:Country><cbc:IdentificationCode>${xml(party.address.countryCode)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
${tax}
<cac:PartyLegalEntity><cbc:RegistrationName>${xml(party.legalName)}</cbc:RegistrationName><cbc:CompanyID schemeAgencyID="TL" schemeAgencyName="Trade License issuing Authority">${xml(party.legalRegistrationId)}</cbc:CompanyID></cac:PartyLegalEntity>
</cac:Party>`
}

function taxXml(category: PintAeTaxCategory, netFils: number, vatFils: number): string {
  const percent = category === 'S' ? '5.00' : '0.00'
  return `<cac:TaxTotal>
<cbc:TaxAmount currencyID="AED">${money(vatFils)}</cbc:TaxAmount><cbc:TaxIncludedIndicator>false</cbc:TaxIncludedIndicator>
<cac:TaxSubtotal><cbc:TaxableAmount currencyID="AED">${money(netFils)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="AED">${money(vatFils)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${category}</cbc:ID><cbc:Percent>${percent}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
</cac:TaxTotal>`
}

function lineXml(line: DocumentLine, index: number, type: PintAeDocumentType, category: PintAeTaxCategory): string {
  const tag = type === '380' ? 'InvoiceLine' : 'CreditNoteLine'
  const quantityTag = type === '380' ? 'InvoicedQuantity' : 'CreditedQuantity'
  const percent = category === 'S' ? '5.00' : '0.00'
  const price = line.units === 0 ? line.netFils : line.netFils / line.units
  return `<cac:${tag}>
<cbc:ID>${index + 1}</cbc:ID><cbc:${quantityTag} unitCode="H87">${line.units || 1}</cbc:${quantityTag}><cbc:LineExtensionAmount currencyID="AED">${money(line.netFils)}</cbc:LineExtensionAmount>
<cac:Item><cbc:Description>${xml(line.description)}</cbc:Description><cbc:Name>${xml(line.feeClass)}</cbc:Name><cac:CommodityClassification><cbc:CommodityCode>S</cbc:CommodityCode></cac:CommodityClassification><cac:AdditionalItemIdentification><cbc:ID schemeID="SAC">OFBO-${slug(line.feeClass)}</cbc:ID></cac:AdditionalItemIdentification><cac:ClassifiedTaxCategory><cbc:ID>${category}</cbc:ID><cbc:Percent>${percent}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
<cac:Price><cbc:PriceAmount currencyID="AED">${(price / 100).toFixed(6)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="H87">1</cbc:BaseQuantity><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="AED">0.00</cbc:Amount><cbc:BaseAmount currencyID="AED">${(price / 100).toFixed(6)}</cbc:BaseAmount></cac:AllowanceCharge></cac:Price>
<cac:ItemPriceExtension><cbc:Amount currencyID="AED">${money(line.grossFils)}</cbc:Amount><cac:TaxTotal><cbc:TaxAmount currencyID="AED">${money(line.vatFils)}</cbc:TaxAmount></cac:TaxTotal></cac:ItemPriceExtension>
</cac:${tag}>`
}

function renderPintXml(input: {
  documentId: string
  uuid: string
  type: PintAeDocumentType
  issueDate: string
  period: string
  supplier: BillingParty
  buyer: BillingParty
  transactionType: '00000000' | '00000001'
  category: PintAeTaxCategory
  lines: DocumentLine[]
  grossFils: number
  netFils: number
  vatFils: number
  note: string
  precedingInvoiceId?: string
}): string {
  const isInvoice = input.type === '380'
  const root = isInvoice ? 'Invoice' : 'CreditNote'
  const namespace = `urn:oasis:names:specification:ubl:schema:xsd:${root}-2`
  const documentType = isInvoice
    ? `<cbc:DueDate>${addDays(input.issueDate, 30)}</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`
    : `<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>`
  const billingReference = input.precedingInvoiceId
    ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${xml(input.precedingInvoiceId)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>`
    : ''
  const discrepancyResponse = isInvoice ? '' : '<cac:DiscrepancyResponse><cbc:ResponseCode>DL8.61.1.C</cbc:ResponseCode></cac:DiscrepancyResponse>'
  const delivery = input.transactionType === '00000001'
    ? `<cac:Delivery><cac:DeliveryLocation><cac:Address><cbc:StreetName>${xml(input.buyer.address.street)}</cbc:StreetName><cbc:CityName>${xml(input.buyer.address.city)}</cbc:CityName><cbc:CountrySubentity>${xml(input.buyer.address.subdivision)}</cbc:CountrySubentity><cac:Country><cbc:IdentificationCode>${xml(input.buyer.address.countryCode)}</cbc:IdentificationCode></cac:Country></cac:Address></cac:DeliveryLocation></cac:Delivery>`
    : ''
  const payment = isInvoice ? '<cac:PaymentMeans><cbc:PaymentMeansCode name="Instrument Not Defined">1</cbc:PaymentMeansCode></cac:PaymentMeans>' : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${namespace}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>${PINT_AE_CUSTOMIZATION_ID}</cbc:CustomizationID>
<cbc:ProfileID>${PINT_AE_PROFILE_ID}</cbc:ProfileID>
<cbc:ProfileExecutionID>${input.transactionType}</cbc:ProfileExecutionID>
<cbc:ID>${xml(input.documentId)}</cbc:ID><cbc:UUID>${input.uuid}</cbc:UUID><cbc:IssueDate>${input.issueDate}</cbc:IssueDate>${documentType}<cbc:Note>${xml(input.note)}</cbc:Note><cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>
${discrepancyResponse}${billingReference}
<cac:InvoicePeriod><cbc:StartDate>${input.period}-01</cbc:StartDate><cbc:EndDate>${periodEnd(input.period)}</cbc:EndDate></cac:InvoicePeriod>
<cac:AccountingSupplierParty>${partyXml(input.supplier)}</cac:AccountingSupplierParty>
<cac:AccountingCustomerParty>${partyXml(input.buyer)}</cac:AccountingCustomerParty>
${delivery}${payment}${taxXml(input.category, input.netFils, input.vatFils)}
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="AED">${money(input.netFils)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="AED">${money(input.netFils)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="AED">${money(input.grossFils)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="AED">${money(input.grossFils)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${input.lines.map((line, index) => lineXml(line, index, input.type, input.category)).join('\n')}
</${root}>`
}

function periodEnd(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10)
}

function pdfEscape(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

/** Small dependency-free PDF writer suitable for the Cloudflare runtime. */
function renderPdf(lines: string[]): Uint8Array {
  const commands = ['BT', '/F1 11 Tf', '50 790 Td']
  for (const [index, line] of lines.slice(0, 46).entries()) {
    if (index > 0) commands.push('0 -16 Td')
    commands.push(`(${pdfEscape(line)}) Tj`)
  }
  commands.push('ET')
  const stream = commands.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(output).length)
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = new TextEncoder().encode(output).length
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(output)
}

function makeDocument(input: {
  type: PintAeDocumentType
  period: string
  issueDate: string
  supplier: BillingParty
  buyer: BillingParty
  lines: DocumentLine[]
  note: string
  precedingInvoiceId?: string
  vatPostureDecisionRef: string
}): PintAeDocument {
  const exported = input.buyer.address.countryCode !== 'AE'
  const category: PintAeTaxCategory = exported ? 'Z' : 'S'
  const lines = input.lines.map((line) => category === 'Z'
    ? { ...line, netFils: line.grossFils, vatFils: 0 }
    : { ...line, ...extractVatInclusiveFils(line.grossFils) })
  const totals = lines.reduce((sum, line) => ({
    grossFils: sum.grossFils + line.grossFils,
    netFils: sum.netFils + line.netFils,
    vatFils: sum.vatFils + line.vatFils
  }), { grossFils: 0, netFils: 0, vatFils: 0 })
  const prefix = input.type === '380' ? 'INV' : 'CRN'
  const creditRef = input.type === '381' && input.precedingInvoiceId ? `-${slug(input.precedingInvoiceId)}` : ''
  const documentId = `${prefix}-${input.period}-${slug(input.buyer.id)}${creditRef}`
  const uuid = stableUuid(`${documentId}|${input.issueDate}|${totals.grossFils}`)
  const transactionType = exported ? '00000001' as const : '00000000' as const
  const xmlDocument = renderPintXml({
    documentId,
    uuid,
    type: input.type,
    issueDate: input.issueDate,
    period: input.period,
    supplier: input.supplier,
    buyer: input.buyer,
    transactionType,
    category,
    lines,
    ...totals,
    note: input.note,
    precedingInvoiceId: input.precedingInvoiceId
  })
  const pdf = renderPdf([
    input.type === '380' ? 'TAX INVOICE' : 'TAX CREDIT NOTE',
    `Document: ${documentId}`,
    `Issue date: ${input.issueDate}`,
    `Billing period: ${input.period}`,
    `Supplier: ${input.supplier.legalName}`,
    `Buyer: ${input.buyer.legalName}`,
    `Tax treatment: ${exported ? 'Zero-rated export' : 'UAE VAT 5% (inclusive)'}`,
    '',
    ...lines.map((line) => `${line.feeClass} | ${line.units || 1} units | AED ${money(line.grossFils)}`),
    '',
    `Net AED ${money(totals.netFils)}`,
    `VAT AED ${money(totals.vatFils)}`,
    `Total AED ${money(totals.grossFils)}`,
    `TDD reporting: required via ASP`,
    `VAT posture: ${input.vatPostureDecisionRef}`,
    `PINT AE ${PINT_AE_VERSION}`,
    `Note: ${input.note}`
  ])
  return {
    documentId,
    uuid,
    documentType: input.type,
    buyerId: input.buyer.id,
    period: input.period,
    issueDate: input.issueDate,
    transactionType,
    taxCategory: category,
    ...totals,
    tddRequired: true,
    vatPostureDecisionRef: input.vatPostureDecisionRef,
    customizationId: PINT_AE_CUSTOMIZATION_ID,
    profileId: PINT_AE_PROFILE_ID,
    xml: xmlDocument,
    pdf,
    sourceLineRefs: lines.map((line) => line.sourceLineRef)
  }
}

export function buildPintAeDocuments(input: BuildPintAeDocumentsInput): {
  documents: PintAeDocument[]
  withheld: WithheldBillingAmount[]
} {
  assertDate(input.issueDate, 'issueDate')
  requireText(input.vatPosture.decisionRef, 'vatPosture.decisionRef')
  if (input.vatPosture.status !== 'approved'
    || input.vatPosture.domesticTreatment !== 'vat_inclusive_5_105'
    || input.vatPosture.foreignTreatment !== 'zero_rated_export_article_31') {
    throw new Error('BD-19 VAT posture must be approved before e-invoice generation')
  }
  assertParty(input.supplier, 'supplier')
  const buyers = new Map(input.buyers.map((buyer) => {
    assertParty(buyer, `buyer ${buyer.id}`)
    return [buyer.id, buyer]
  }))
  if (buyers.size !== input.buyers.length) throw new Error('duplicate buyer id')
  if (input.diff && input.diff.expectedPeriod !== input.expected.period) throw new Error('memo diff period does not match expected memo')
  if (input.expected.lines.length > 0 && input.issueDate > addDays(periodEnd(input.expected.period), 14)) {
    throw new Error(`invoice issue date exceeds the 14-day BD-19 monthly-cycle limit for ${input.expected.period}`)
  }
  const diffByRef = new Map(input.diff?.lines.map((line) => [line.lineRef, line]) ?? [])
  const withheld: WithheldBillingAmount[] = []
  const invoiceLines = new Map<string, DocumentLine[]>()

  for (const line of input.expected.lines) {
    const variance = diffByRef.get(line.lineRef)
    const hold = variance?.materialVariance ? Math.min(Math.abs(variance.varianceMilliFils), line.amountMilliFils) : 0
    if (hold > 0) withheld.push({
      lineRef: line.lineRef,
      tppId: line.tppId,
      amountMilliFils: hold,
      evidenceEventIds: [...line.eventIds],
      evidenceTraceIds: [...line.traceIds]
    })
    const billable = line.amountMilliFils - hold
    if (billable === 0) continue
    if (!buyers.has(line.tppId)) throw new Error(`missing billing party for ${line.tppId}`)
    const grossFils = milliFilsToFils(billable)
    if (grossFils === 0) continue
    const tax = extractVatInclusiveFils(grossFils)
    const current = invoiceLines.get(line.tppId) ?? []
    current.push({
      feeClass: line.feeClass,
      description: `${line.feeClass} fees for ${input.expected.period}`,
      units: line.units,
      ...tax,
      sourceLineRef: line.lineRef
    })
    invoiceLines.set(line.tppId, current)
  }

  const documents = [...invoiceLines.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([buyerId, lines]) => makeDocument({
    type: '380',
    period: input.expected.period,
    issueDate: input.issueDate,
    supplier: input.supplier,
    buyer: buyers.get(buyerId)!,
    lines,
    note: input.diff ? `Undisputed charges; query amounts withheld under ${input.diff.memoReference}` : 'Billing charges',
    vatPostureDecisionRef: input.vatPosture.decisionRef
  }))

  for (const adjustment of input.creditAdjustments ?? []) {
    if (!Number.isSafeInteger(adjustment.amountMilliFils) || adjustment.amountMilliFils <= 0) throw new RangeError('credit amount must be a positive safe integer')
    requireText(adjustment.reason, 'credit reason')
    requireText(adjustment.precedingInvoiceId, 'preceding invoice id')
    const buyer = buyers.get(adjustment.buyerId)
    if (!buyer) throw new Error(`missing billing party for ${adjustment.buyerId}`)
    const grossFils = milliFilsToFils(adjustment.amountMilliFils)
    documents.push(makeDocument({
      type: '381',
      period: input.expected.period,
      issueDate: input.issueDate,
      supplier: input.supplier,
      buyer,
      lines: [{
        feeClass: adjustment.feeClass,
        description: adjustment.reason,
        units: 1,
        ...extractVatInclusiveFils(grossFils),
        sourceLineRef: `credit|${adjustment.precedingInvoiceId}|${adjustment.feeClass}`
      }],
      note: adjustment.reason,
      precedingInvoiceId: adjustment.precedingInvoiceId,
      vatPostureDecisionRef: input.vatPosture.decisionRef
    }))
  }

  return { documents, withheld }
}
