// Integration Readiness Wizard — port catalog + adopting-bank decision defaults (ADR 0022).
// PUBLIC, pre-login data. Bank SYSTEM METADATA only — never PSU data, never PII.
// Division of truth: this catalog is the data the public wizard renders; scoring.ts turns a
// user's selections into the readiness digest. The catalog is data, so adding a vendor option
// is an edit here — no logic change.

export type EffortBand = 'low' | 'medium' | 'scoping'

export interface PortOption {
  value: string
  label: string
  effort_band: EffortBand
  /** True when the choice needs NO enterprise adapter (built-in / declined) — no M6 work. */
  builtin?: boolean
}

export interface CatalogPort {
  id: string // P1..P9
  name: string
  maps_to: string
  optional?: boolean
  /** Port-swap acceptance suite the enterprise adapter must pass (the M6 gate). */
  contract_test_gate: string
  /** Config keys the enterprise profile sets for this port. */
  config_keys: string[]
  options: PortOption[]
}

export interface CatalogDecision {
  id: string // BD-01..BD-16
  title: string
  default: string
  impact: string
  blocks?: string
}

export interface ReadinessCatalog {
  ports: CatalogPort[]
  decisions: CatalogDecision[]
}

const GATE = (name: string) => `Port-swap acceptance: ${name} (packages/ports/test/port-contracts.spec.ts)`

export const PORTS: CatalogPort[] = [
  {
    id: 'P1',
    name: 'Customer-care surface',
    maps_to: 'Where care agents work the consent/dispute queues',
    contract_test_gate: GATE('CareSurfacePort'),
    config_keys: ['P1_CARE_SURFACE_MODE'],
    options: [
      { value: 'portal_resident', label: 'Portal-resident console (built-in)', effort_band: 'low', builtin: true },
      { value: 'crm_salesforce', label: 'CRM-resident — Salesforce', effort_band: 'medium' },
      { value: 'crm_dynamics', label: 'CRM-resident — MS Dynamics', effort_band: 'medium' },
      { value: 'crm_pega', label: 'CRM-resident — Pega', effort_band: 'medium' },
      { value: 'other', label: 'Other / in-house', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P2',
    name: 'Enterprise IdP (OIDC)',
    maps_to: 'Portal sign-in + mandatory MFA',
    contract_test_gate: GATE('IdentityProviderPort'),
    config_keys: ['P2_OIDC_ISSUER', 'P2_OIDC_CLIENT_ID'],
    options: [
      { value: 'entra', label: 'Microsoft Entra ID / Azure AD', effort_band: 'low' },
      { value: 'okta', label: 'Okta', effort_band: 'low' },
      { value: 'forgerock', label: 'ForgeRock', effort_band: 'low' },
      { value: 'pingfederate', label: 'PingFederate', effort_band: 'low' },
      { value: 'internal_oidc', label: 'Internal OIDC provider', effort_band: 'low' },
      { value: 'other', label: 'Other / in-house', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P3',
    name: 'ITSM / alerting',
    maps_to: 'Ticket creation + team routing on SLA breach',
    contract_test_gate: GATE('ItsmPort'),
    config_keys: ['P3_ITSM_BASE_URL', 'P3_ITSM_ROUTING_MAP'],
    options: [
      { value: 'servicenow', label: 'ServiceNow', effort_band: 'low' },
      { value: 'jira_sm', label: 'Jira Service Management', effort_band: 'low' },
      { value: 'bmc_remedy', label: 'BMC Remedy', effort_band: 'medium' },
      { value: 'email_fallback', label: 'Email fallback (built-in)', effort_band: 'low', builtin: true },
      { value: 'other', label: 'Other / in-house', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P4',
    name: 'Core banking adapter',
    maps_to: 'Read-only balance + transaction history for reconciliation',
    contract_test_gate: GATE('CoreBankingPort'),
    config_keys: ['P4_CORE_BASE_URL', 'P4_CORE_AUTH'],
    options: [
      { value: 'finacle', label: 'Infosys Finacle', effort_band: 'medium' },
      { value: 'flexcube', label: 'Oracle FLEXCUBE', effort_band: 'medium' },
      { value: 't24', label: 'Temenos T24 / Transact', effort_band: 'medium' },
      { value: 'mambu', label: 'Mambu', effort_band: 'low' },
      { value: 'inhouse', label: 'In-house core', effort_band: 'scoping' },
      { value: 'other', label: 'Other', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P5',
    name: 'Enterprise APM',
    maps_to: 'Bridge off the OpenTelemetry stream (OTel is canonical)',
    contract_test_gate: GATE('ApmPort'),
    config_keys: ['P5_OTEL_EXPORTER_ENDPOINT'],
    options: [
      { value: 'dynatrace', label: 'Dynatrace', effort_band: 'low' },
      { value: 'appdynamics', label: 'AppDynamics', effort_band: 'low' },
      { value: 'datadog', label: 'Datadog', effort_band: 'low' },
      { value: 'newrelic', label: 'New Relic', effort_band: 'low' },
      { value: 'cloudwatch', label: 'AWS CloudWatch / X-Ray', effort_band: 'low' },
      { value: 'other', label: 'Other (any OTLP sink)', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P6',
    name: 'Enterprise egress gateway',
    maps_to: 'ALL Nebras-bound traffic (FAPI 2.0 mTLS, scheme cert chain) — no direct egress',
    contract_test_gate: GATE('NebrasEgressPort'),
    config_keys: ['P6_EGRESS_BASE_URL', 'P6_MTLS_CERT_REF', 'P6_CERT_CHAIN_OWNER'],
    options: [
      // P6 is always Medium+: even the bank's existing gateway means mTLS + scheme cert wiring.
      { value: 'apigee', label: 'Existing egress — Apigee', effort_band: 'medium' },
      { value: 'kong', label: 'Existing egress — Kong', effort_band: 'medium' },
      { value: 'mulesoft', label: 'Existing egress — MuleSoft', effort_band: 'medium' },
      { value: 'f5', label: 'Existing egress — F5', effort_band: 'medium' },
      { value: 'other', label: 'Other / custom egress', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P7',
    name: 'Data catalogue (lineage)',
    maps_to: 'Column-level BCBS 239 lineage sink at write time',
    contract_test_gate: GATE('LineagePort'),
    config_keys: ['P7_CATALOGUE_BASE_URL'],
    options: [
      { value: 'collibra', label: 'Collibra', effort_band: 'low' },
      { value: 'alation', label: 'Alation', effort_band: 'low' },
      { value: 'informatica', label: 'Informatica', effort_band: 'medium' },
      { value: 'purview', label: 'Microsoft Purview', effort_band: 'low' },
      { value: 'none_yet', label: 'No catalogue yet', effort_band: 'scoping' },
      { value: 'other', label: 'Other', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P8',
    name: 'Onboarding handover',
    maps_to: 'Bank-side onboarding hands off to the OF platform (optional port)',
    optional: true,
    contract_test_gate: GATE('OnboardingHandoverPort'),
    config_keys: ['P8_ONBOARDING_BASE_URL'],
    options: [
      { value: 'bank_onboarding', label: 'Bank onboarding system', effort_band: 'medium' },
      { value: 'not_integrating', label: 'Not integrating (decline this port)', effort_band: 'low', builtin: true },
      { value: 'other', label: 'Other', effort_band: 'scoping' }
    ]
  },
  {
    id: 'P9',
    name: 'Financial management system',
    maps_to: 'TPP counterparty registration + monthly invoicing + settlement status',
    contract_test_gate: GATE('FinancialSystemPort'),
    config_keys: ['P9_FMS_BASE_URL', 'P9_FMS_AUTH'],
    options: [
      { value: 'sap', label: 'SAP', effort_band: 'medium' },
      { value: 'oracle_erp', label: 'Oracle ERP / Fusion', effort_band: 'medium' },
      { value: 'ms_dynamics', label: 'Microsoft Dynamics', effort_band: 'medium' },
      { value: 'custom_ar', label: 'Custom accounts-receivable', effort_band: 'scoping' },
      { value: 'other', label: 'Other', effort_band: 'scoping' }
    ]
  }
]

// PRD §10 adopting-bank decisions. Defaults are the product's pre-sets — the bank confirms or
// overrides. Blockers flag the decisions that gate a milestone/story until closed.
export const DECISIONS: CatalogDecision[] = [
  { id: 'BD-01', title: 'IdP for the Internal Portal (P2)', default: 'Enterprise OIDC/SAML2 provider', impact: 'Portal sign-in + MFA', blocks: 'M1 (substrate)' },
  { id: 'BD-02', title: 'Care surface placement (P1)', default: 'Portal-resident', impact: 'Endpoints identical either way' },
  { id: 'BD-03', title: 'Fraud-revoke scope', default: 'Four-eyes on every fraud revoke', impact: 'Risk View control strictness' },
  { id: 'BD-04', title: 'ITSM platform + team routing (P3)', default: 'Email fallback until confirmed', impact: 'Ticket routing', blocks: 'M1 (substrate)' },
  { id: 'BD-05', title: 'Channel taxonomy values', default: 'internal_retail / internal_sme / internal_corporate / external_direct / external_tpp_aas', impact: 'Every record carries a channel' },
  { id: 'BD-06', title: 'Residency region(s)', default: 'UAE region (me-central)', impact: 'IaC parameter; non-negotiable for regulated prod data' },
  { id: 'BD-07', title: 'Nebras API rate limits', default: 'Conservative back-off cadence', impact: 'P6 integration design' },
  { id: 'BD-08', title: 'CBUAE report templates + channel', default: 'PDF + XLSX, manual submission', impact: 'Compliance handoff' },
  { id: 'BD-09', title: 'Refund-SLA instrument', default: 'Next-business-day refund', impact: 'OF Reg C 3/2025 Art 21 baseline' },
  { id: 'BD-10', title: 'Suspended consent state', default: 'Feature-flag Suspended UI', impact: '7-state consent lifecycle' },
  { id: 'BD-11', title: 'Complaint SLA matrix', default: "Bank's standard complaint matrix", impact: 'Customer Care SLA clock' },
  { id: 'BD-12', title: 'Multi-entity (bank_id) scope', default: 'Single entity', impact: 'Tenancy model (schema supports group)' },
  { id: 'BD-13', title: 'Cross-fintech aggregation governance sign-off', default: 'Sequence single-fintech views first', impact: 'Governed bank_internal_view path', blocks: 'BACKOFFICE-33' },
  { id: 'BD-14', title: 'Demo hosting stack', default: 'Cloudflare + Supabase + Railway', impact: 'Demo profile only — not a bank decision' },
  { id: 'BD-15', title: 'LFI-to-TPP fee collection model', default: 'LFI-issued invoices from Nebras records', impact: 'Dual-role payables model' },
  { id: 'BD-16', title: 'Interaction Guide v4 figures', default: 'Build on v4 figures (clocks configurable)', impact: 'Dispute clocks, incident SLAs, notice periods' }
]

export function getCatalog(): ReadinessCatalog {
  return { ports: PORTS, decisions: DECISIONS }
}

export function findPort(id: string): CatalogPort | undefined {
  return PORTS.find((p) => p.id === id)
}

export function findOption(port: CatalogPort, value: string): PortOption | undefined {
  return port.options.find((o) => o.value === value)
}
