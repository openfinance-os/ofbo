// AUTO-GENERATED from specs/backoffice-openapi.yaml — run `pnpm gen`. Do not edit.

export interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: string
  tag: string
  scope: string | null
  fourEyes: boolean
}

export const ROUTES: readonly Route[] = [
  {
    "method": "get",
    "path": "/back-office/reconciliation/runs",
    "tag": "reconciliation",
    "scope": "reconciliation:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/reconciliation/runs/{run_id}",
    "tag": "reconciliation",
    "scope": "reconciliation:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reconciliation/runs:replay",
    "tag": "reconciliation",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/reconciliation/breaks",
    "tag": "reconciliation",
    "scope": "reconciliation:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/reconciliation/breaks/{break_id}",
    "tag": "reconciliation",
    "scope": "reconciliation:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reconciliation/breaks/{break_id}/claim",
    "tag": "reconciliation",
    "scope": "finance:reconciliation:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reconciliation/breaks/{break_id}/resolve",
    "tag": "reconciliation",
    "scope": "finance:reconciliation:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reconciliation/breaks/{break_id}/escalate-nebras",
    "tag": "reconciliation",
    "scope": "finance:disputes:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reconciliation/breaks/{break_id}/reopen",
    "tag": "reconciliation",
    "scope": "audit:read",
    "fourEyes": true
  },
  {
    "method": "post",
    "path": "/back-office/reconciliation/monthly-signoff",
    "tag": "reconciliation",
    "scope": "finance:reconciliation:write",
    "fourEyes": true
  },
  {
    "method": "get",
    "path": "/back-office/reconciliation/thresholds",
    "tag": "reconciliation",
    "scope": "reconciliation:read",
    "fourEyes": false
  },
  {
    "method": "put",
    "path": "/back-office/reconciliation/thresholds",
    "tag": "reconciliation",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/reconciliation/exports:cbuae",
    "tag": "reconciliation",
    "scope": "compliance:reports:generate",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/care-surface:mint-token",
    "tag": "consents-admin",
    "scope": "consents:admin",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/consents:search-psu",
    "tag": "consents-admin",
    "scope": "consents:admin",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/consents/{consent_id}:admin",
    "tag": "consents-admin",
    "scope": "consents:admin",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/consents/{consent_id}:revoke-admin",
    "tag": "consents-admin",
    "scope": "consents:admin",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/consents:revoke-bulk",
    "tag": "consents-admin",
    "scope": "consents:admin",
    "fourEyes": true
  },
  {
    "method": "post",
    "path": "/consents/{consent_id}:revoke-fraud",
    "tag": "consents-admin",
    "scope": "consents:admin:fraud-revoke",
    "fourEyes": true
  },
  {
    "method": "get",
    "path": "/consents/{consent_id}/audit-trail",
    "tag": "audit",
    "scope": "audit:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/psu/{psu_identifier}/audit-trail",
    "tag": "audit",
    "scope": "audit:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/payments/{payment_id}:admin",
    "tag": "disputes",
    "scope": "disputes:admin",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/disputes",
    "tag": "disputes",
    "scope": "disputes:admin",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/disputes",
    "tag": "disputes",
    "scope": "disputes:admin",
    "fourEyes": false
  },
  {
    "method": "patch",
    "path": "/disputes/{dispute_id}",
    "tag": "disputes",
    "scope": "disputes:admin",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/disputes/{dispute_id}/call-recording",
    "tag": "disputes",
    "scope": "disputes:admin",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/disputes/{dispute_id}:initiate-refund",
    "tag": "disputes",
    "scope": "disputes:admin",
    "fourEyes": true
  },
  {
    "method": "get",
    "path": "/back-office/disputes/respondent",
    "tag": "disputes",
    "scope": "finance:disputes:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/disputes/respondent",
    "tag": "disputes",
    "scope": "finance:disputes:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/disputes/respondent/{respondent_dispute_id}",
    "tag": "disputes",
    "scope": "finance:disputes:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/disputes/respondent/{respondent_dispute_id}:advance",
    "tag": "disputes",
    "scope": "finance:disputes:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/executive-dashboard",
    "tag": "analytics",
    "scope": "platform:analytics:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/operations-console",
    "tag": "analytics",
    "scope": "platform:operations:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/compliance-view",
    "tag": "analytics",
    "scope": "compliance:reports:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/risk-view",
    "tag": "analytics",
    "scope": "risk:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/finance-view",
    "tag": "analytics",
    "scope": "reconciliation:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/reconciliation-slo",
    "tag": "analytics",
    "scope": "reconciliation:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/onboarding-funnel",
    "tag": "analytics",
    "scope": "pipeline:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/onboarding-handover-health",
    "tag": "analytics",
    "scope": "platform:operations:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/analytics/nebras-liability-monitor",
    "tag": "analytics",
    "scope": "risk:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/analytics/exports",
    "tag": "analytics",
    "scope": "(scope of the exported view)",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reports:generate",
    "tag": "reports",
    "scope": "compliance:reports:generate",
    "fourEyes": true
  },
  {
    "method": "get",
    "path": "/back-office/reports",
    "tag": "reports",
    "scope": "compliance:reports:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/reports/{report_id}",
    "tag": "reports",
    "scope": "compliance:reports:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/reports/{report_id}/download",
    "tag": "reports",
    "scope": "compliance:reports:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reports/{report_id}:approve",
    "tag": "reports",
    "scope": "programme:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/reports/{report_id}:submit",
    "tag": "reports",
    "scope": "compliance:reports:generate",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/lfi-reports",
    "tag": "reports",
    "scope": "compliance:reports:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/lfi-reports",
    "tag": "reports",
    "scope": "compliance:reports:generate",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/inquiries/psu",
    "tag": "reports",
    "scope": "compliance:reports:generate",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/approvals",
    "tag": "approvals",
    "scope": "(initiator scope)",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/approvals/pending",
    "tag": "approvals",
    "scope": "(any internal scope)",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/approvals/{approval_id}",
    "tag": "approvals",
    "scope": "(initiator or approver scope)",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/approvals/{approval_id}:approve",
    "tag": "approvals",
    "scope": "(approver_required_scope of the request)",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/approvals/{approval_id}:reject",
    "tag": "approvals",
    "scope": "(approver_required_scope of the request)",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/audit/events",
    "tag": "audit",
    "scope": "audit:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/audit/events/{event_id}",
    "tag": "audit",
    "scope": "audit:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/risk-signals",
    "tag": "risk-signals",
    "scope": "risk:read",
    "fourEyes": false
  },
  {
    "method": "patch",
    "path": "/back-office/risk-signals/{signal_id}",
    "tag": "risk-signals",
    "scope": "risk:investigations:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/scheme-notifications",
    "tag": "analytics",
    "scope": "platform:operations:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/scheme-notifications",
    "tag": "analytics",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/scheme-notifications/{notification_id}:acknowledge",
    "tag": "analytics",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/fraud-incidents",
    "tag": "risk-signals",
    "scope": "risk:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/fraud-incidents",
    "tag": "risk-signals",
    "scope": "risk:investigations:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/fraud-incidents/{incident_id}:resolve",
    "tag": "risk-signals",
    "scope": "risk:investigations:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/lineage/{table_name}",
    "tag": "audit",
    "scope": "compliance:reports:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/tpp-counterparties",
    "tag": "tpp-billing",
    "scope": "billing:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/tpp-counterparties/{organisation_id}",
    "tag": "tpp-billing",
    "scope": "billing:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/tpp-counterparties:sync-directory",
    "tag": "tpp-billing",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/tpp-counterparties/{organisation_id}:register-financial-system",
    "tag": "tpp-billing",
    "scope": "billing:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/billing-records",
    "tag": "tpp-billing",
    "scope": "billing:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/billing-records",
    "tag": "tpp-billing",
    "scope": "billing:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/billing-records/{record_set_id}:reconcile",
    "tag": "tpp-billing",
    "scope": "finance:reconciliation:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/invoice-runs",
    "tag": "tpp-billing",
    "scope": "billing:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/invoice-runs",
    "tag": "tpp-billing",
    "scope": "billing:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/invoice-runs/{invoice_run_id}",
    "tag": "tpp-billing",
    "scope": "billing:read",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/trust-framework/participants",
    "tag": "analytics",
    "scope": "platform:operations:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/trust-framework/participants",
    "tag": "analytics",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/trust-framework/participants/{participant_id}",
    "tag": "analytics",
    "scope": "platform:operations:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/trust-framework/participants/{participant_id}:nominate-replacement",
    "tag": "analytics",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/disputes/{dispute_id}:record-cross-scheme",
    "tag": "disputes",
    "scope": "disputes:admin",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/service-desk-cases",
    "tag": "analytics",
    "scope": "platform:operations:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/service-desk-cases",
    "tag": "analytics",
    "scope": "platform:operations:write",
    "fourEyes": false
  },
  {
    "method": "get",
    "path": "/back-office/service-desk-cases/{case_id}",
    "tag": "analytics",
    "scope": "platform:operations:read",
    "fourEyes": false
  },
  {
    "method": "post",
    "path": "/back-office/service-desk-cases/{case_id}:update",
    "tag": "analytics",
    "scope": "platform:operations:write",
    "fourEyes": false
  }
] as const
