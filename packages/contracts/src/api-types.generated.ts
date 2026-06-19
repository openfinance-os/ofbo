// AUTO-GENERATED from specs/backoffice-openapi.yaml — run `pnpm gen`. Do not edit.
export interface paths {
    "/back-office/reconciliation/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List reconciliation runs (paginated) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    run_type?: "daily" | "monthly_close" | "replay" | "on_demand";
                    status?: "running" | "completed" | "failed" | "partial";
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated run list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ReconciliationRun"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/runs/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get run summary with line counts */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    run_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["ReconciliationRun"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/runs:replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Trigger replay over a date range (BACKOFFICE-10) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: date-time */
                        window_start: string;
                        /** Format: date-time */
                        window_end: string;
                    };
                };
            };
            responses: {
                202: components["responses"]["ReconciliationRun"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/breaks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List breaks (filter by run_id, status, line_type, client_id) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    run_id?: string;
                    status?: components["schemas"]["BreakStatus"];
                    line_type?: components["schemas"]["LineType"];
                    client_id?: string;
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated break list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ReconciliationBreak"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/breaks/{break_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get break detail with three-source diff (BACKOFFICE-11) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    break_id: components["parameters"]["breakId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["ReconciliationBreak"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/breaks/{break_id}/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Claim a flagged break (BACKOFFICE-03)
         * @description Consent-record breaks may alternatively be claimed with platform:operations:write.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    break_id: components["parameters"]["breakId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["ReconciliationBreak"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/breaks/{break_id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve with outcome + mandatory note (BACKOFFICE-04) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    break_id: components["parameters"]["breakId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        resolution_outcome: "resolved_matched" | "resolved_internal_correction" | "escalated_fintech_billing";
                        resolution_note: string;
                    };
                };
            };
            responses: {
                200: components["responses"]["ReconciliationBreak"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/breaks/{break_id}/escalate-nebras": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Open a Nebras dispute case from a break (BACKOFFICE-05) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    break_id: components["parameters"]["breakId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Break escalated; Nebras case ID persisted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: {
                                /** Format: uuid */
                                break_id?: string;
                                /** @enum {string} */
                                status?: "escalated_nebras_dispute";
                                nebras_dispute_case_id?: string;
                            };
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/breaks/{break_id}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reopen a resolved break (four-eyes; BACKOFFICE-04) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    break_id: components["parameters"]["breakId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        justification: string;
                    };
                };
            };
            responses: {
                202: components["responses"]["ApprovalPending"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/monthly-signoff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate + lock the monthly reconciliation summary (BACKOFFICE-06) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description Calendar month YYYY-MM
                         * @example 2026-07
                         */
                        period: string;
                    };
                };
            };
            responses: {
                200: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/thresholds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read break thresholds by fee class (BACKOFFICE-12) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["Thresholds"];
                default: components["responses"]["Error"];
            };
        };
        /** Update break thresholds (High-class audited) */
        put: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["Threshold"][];
                };
            };
            responses: {
                200: components["responses"]["Thresholds"];
                default: components["responses"]["Error"];
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reconciliation/exports:cbuae": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Generate CBUAE-format reconciliation export (BACKOFFICE-08) */
        get: {
            parameters: {
                query: {
                    period_start: string;
                    period_end: string;
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                202: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/consents:search-psu": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * PSU-centric consent search (BACKOFFICE-16)
         * @description Unified search with identifier_type (BO-OQ-28 default). Every call writes a High-class audit record with the searching agent's identity. < 500 ms p95.
         */
        get: {
            parameters: {
                query: {
                    identifier_type: "bank_customer_id" | "iban" | "emirates_id";
                    identifier: string;
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description PSU + consents across all TPPs (24 months) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["PsuConsentSearchResult"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/consents/{consent_id}:admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin view of a consent with cross-TPP context */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    consent_id: components["parameters"]["consentId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Consent admin view (full 7-state lifecycle status) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ConsentAdminView"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/consents/{consent_id}:revoke-admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Single-consent revocation with reason code (BACKOFFICE-17) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    consent_id: components["parameters"]["consentId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description FRAUD_SUSPECTED is reserved for :revoke-fraud
                         * @enum {string}
                         */
                        reason_code: "TPP_REQUEST" | "CLIENT_INSTRUCTION" | "REGULATORY";
                    };
                };
            };
            responses: {
                200: components["responses"]["RevocationResult"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/consents:revoke-bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Emergency PSU-wide bulk revocation (four-eyes; BACKOFFICE-18) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        psu_identifier_type: "bank_customer_id" | "iban" | "emirates_id";
                        psu_identifier: string;
                        /** @enum {string} */
                        reason_code: "CLIENT_INSTRUCTION";
                    };
                };
            };
            responses: {
                202: components["responses"]["ApprovalPending"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/consents/{consent_id}:revoke-fraud": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Risk Analyst narrow-scope fraud revocation (BACKOFFICE-22)
         * @description Four-eyes-gated (binding adopting-bank default, PRD §10 / CLAUDE.md: four-eyes on fraud revoke). Returns 202 + approval_request; a different principal approves before the revoke executes — it never executes inline.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    consent_id: components["parameters"]["consentId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Investigation context carried into the STR draft */
                        case_context: string;
                    };
                };
            };
            responses: {
                202: components["responses"]["ApprovalPending"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/consents/{consent_id}/audit-trail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 24-month audit trail for a consent (BACKOFFICE-19) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    consent_id: components["parameters"]["consentId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["ConsentEventList"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/psu/{psu_identifier}/audit-trail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 24-month PSU-centric audit trail across all consents (BACKOFFICE-19) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    psu_identifier: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["ConsentEventList"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payments/{payment_id}:admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin payment view with consent-validity-at-time-of-payment (BACKOFFICE-20; Phase 0 reuse) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    payment_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Payment trace + Risk Information Block + CoP outcome */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["PaymentAdminView"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/disputes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List disputes (filter by state, psu, client_id) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    state?: components["schemas"]["DisputeState"];
                    psu_identifier?: string;
                    client_id?: string;
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated dispute list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["DisputeCase"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /** Create unauthorised-payment dispute (BACKOFFICE-20) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DisputeCreate"];
                };
            };
            responses: {
                201: components["responses"]["Dispute"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/disputes/{dispute_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update dispute state (per §6.3.1 state machine) */
        patch: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    dispute_id: components["parameters"]["disputeId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        state?: components["schemas"]["DisputeState"];
                        escalated_to?: string;
                        resolution_note?: string;
                    };
                };
            };
            responses: {
                200: components["responses"]["Dispute"];
                default: components["responses"]["Error"];
            };
        };
        trace?: never;
    };
    "/disputes/{dispute_id}:initiate-refund": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Initiate refund under the next-business-day SLA (four-eyes; BACKOFFICE-21/-62)
         * @description On approval, the refund dispatches via the existing Ozone Connect GET /payment-consents/{consentId}/refund flow through the enterprise egress gateway (Phase 0 reuse) and is tracked with the 5 IPP status codes.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    dispute_id: components["parameters"]["disputeId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        refund_amount: components["schemas"]["Money"];
                    };
                };
            };
            responses: {
                202: components["responses"]["ApprovalPending"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/disputes/respondent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List respondent disputes (filter by state / breach status) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    state?: components["schemas"]["RespondentDisputeState"];
                    /** @description Filter to clocks at risk (amber) or breached (red) */
                    breach_status?: components["schemas"]["SchemeClockStatus"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated respondent-dispute list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["RespondentDispute"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /**
         * Register a Nebras-raised dispute where the bank is the respondent (BACKOFFICE-75)
         * @description Ingests a dispute Nebras has raised against the bank. The response (3 bd) and formal-resolution (15 bd) clocks start from raised_at on registration; appeal and implementation clocks start when the respective verdicts are recorded via :advance.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["RespondentDisputeCreate"];
                };
            };
            responses: {
                /** @description Respondent dispute registered; response + resolution clocks started */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["RespondentDispute"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/disputes/respondent/{respondent_dispute_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Respondent dispute detail — scheme clocks + per-clock breach status */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    respondent_dispute_id: components["parameters"]["respondentDisputeId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Respondent dispute detail */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["RespondentDispute"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/disputes/respondent/{respondent_dispute_id}:advance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record a respondent-side lifecycle action that stops / starts a scheme clock
         * @description respond → stops the response clock (state responded). record_verdict → resolution met, starts the appeal clock (3 bd). appeal → records the bank's appeal. record_final_verdict → starts the implementation clock (3 bd). implement → stops implementation (state implemented). Each action requires a note (≥20 chars) and writes an immutable High-class audit record.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    respondent_dispute_id: components["parameters"]["respondentDisputeId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        action: "respond" | "record_verdict" | "appeal" | "record_final_verdict" | "implement";
                        /** @description Mandatory action note (immutable audit) */
                        note: string;
                        /**
                         * @description Required for record_verdict / record_final_verdict
                         * @enum {string|null}
                         */
                        verdict_outcome?: "upheld" | "partially_upheld" | "rejected" | null;
                    };
                };
            };
            responses: {
                /** @description Action recorded; affected clock updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["RespondentDispute"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/executive-dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Aggregate adoption + commercial + pipeline (BACKOFFICE-27) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/operations-console": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Platform health snapshot (BACKOFFICE-28) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/compliance-view": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Regulatory posture + report queue (BACKOFFICE-29) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/risk-view": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Anomaly signals + TPP behaviour (BACKOFFICE-30) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/finance-view": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fee accrual + margin + dispute queue (BACKOFFICE-31) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/reconciliation-slo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Reconciliation Console SLO dashboard (BACKOFFICE-09)
         * @description Aggregated reconciliation health for the console: open breaks by age bucket, p50/p90 break-resolution time (30-day rolling), dispute pipeline, last/next run, and pass rate. Server-side aggregation to meet the <1.5s p95 target. Returns the standard AnalyticsView envelope (free-form `data` + freshness).
         */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/onboarding-funnel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Five funnel metrics from canonical PRD §4.0.3 (BACKOFFICE-34) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/onboarding-handover-health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** onboarding handover API success / latency / errors */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/nebras-liability-monitor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Approaching Nebras liability triggers, keyed issue × liable party × AED (BACKOFFICE-36) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/analytics/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Export a view to PDF / XLSX / CSV (BACKOFFICE-41) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        view: string;
                        /** @enum {string} */
                        format: "pdf" | "xlsx" | "csv";
                    };
                };
            };
            responses: {
                202: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reports:generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Initiate periodic or ad-hoc report generation (BACKOFFICE-35)
         * @description CBUAE-bound reports require Programme Manager four-eyes approval before submission.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @example cbuae_monthly */
                        report_type: string;
                        /** Format: date */
                        period_start: string;
                        /** Format: date */
                        period_end: string;
                        target_psu_identifier?: string;
                        /** Format: uuid */
                        target_client_id?: string;
                        /**
                         * @default [
                         *       "pdf",
                         *       "xlsx"
                         *     ]
                         */
                        output_formats?: ("pdf" | "xlsx")[];
                    };
                };
            };
            responses: {
                202: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List reports (filter by type, period, state) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    report_type?: string;
                    status?: components["schemas"]["ReportStatus"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated report list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ComplianceReport"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reports/{report_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get report metadata */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    report_id: components["parameters"]["reportId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reports/{report_id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download report PDF / XLSX with integrity hash */
        get: {
            parameters: {
                query: {
                    format: "pdf" | "xlsx";
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    report_id: components["parameters"]["reportId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Binary stream; X-Content-SHA256 header carries the integrity hash */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reports/{report_id}:approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Programme Manager approval for a CBUAE-bound report (four-eyes resolution)
         * @description This IS the four-eyes resolution step — the second principal authorising a CBUAE-bound report that was gated on generation. It executes the approval and returns 200 with the approved report; it is NOT itself a four-eyes-gated operation (which would regress), so it carries no x-four-eyes flag. The initiator ≠ approver rule is enforced by the approvals service.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    report_id: components["parameters"]["reportId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/reports/{report_id}:submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark report submitted to CBUAE (BO-OQ-29 default — status change after manual upload) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    report_id: components["parameters"]["reportId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/lfi-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Cadence health of the 16 login-only Nebras LFI reports (BACKOFFICE-67)
         * @description The 16 Nebras LFI Reports (availability, performance, billing, consent, payments, CoP et al. per API Hub Docs v8) are login-only with no API equivalent (PRD §3 known scheme limitation). This returns, per report type, the latest verified manual ingest and whether it is overdue against its defined cadence (daily availability/performance, weekly consent, monthly billing). A missed cadence raises an ITSM ticket + Risk signal via a headless monitor.
         */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Per-report cadence status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["LfiReportCadenceStatus"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /**
         * Manual verified ingest of a login-only Nebras LFI report (BACKOFFICE-67)
         * @description The 16 Nebras LFI Reports are downloaded from the Nebras portal (no API) and uploaded here. The upload computes an integrity hash, writes a compliance_report record, and emits BCBS 239 lineage — the same verified-ingest pattern as the Nebras billing-record upload (BACKOFFICE-73). High-class audited with the acting principal.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /** Format: binary */
                        file: string;
                        /** @description One of the 16 login-only LFI report types, e.g. availability, performance, consent, billing */
                        report_type: string;
                        /** @description Reporting period the file covers (ISO date for daily, ISO week for weekly, YYYY-MM for monthly) */
                        report_period: string;
                        /** @description e.g. portal download timestamp / operator note */
                        source_note?: string;
                    };
                };
            };
            responses: {
                /** @description Report ingested — compliance_report written with integrity hash; BCBS 239 lineage emitted */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ComplianceReport"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/inquiries/psu": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate per-PSU CBUAE inquiry bundle (BACKOFFICE-23) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        psu_identifier_type: "bank_customer_id" | "iban" | "emirates_id";
                        psu_identifier: string;
                        /** @default 24 */
                        period_months?: number;
                    };
                };
            };
            responses: {
                202: components["responses"]["Report"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an approval request (usually created implicitly by four-eyes endpoints) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @example bulk_consent_revoke */
                        operation_type: string;
                        /** @description PII-redacted operation context */
                        operation_payload: Record<string, never>;
                    };
                };
            };
            responses: {
                201: components["responses"]["Approval"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List approvals pending for the caller */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pending approvals where the caller holds approver_required_scope */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ApprovalRequest"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/{approval_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get approval state */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    approval_id: components["parameters"]["approvalId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["Approval"];
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/{approval_id}:approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve a pending request (initiator ≠ approver enforced; executes the gated operation) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    approval_id: components["parameters"]["approvalId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Approved; execution_result included */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ApprovalRequest"] & {
                                execution_result?: Record<string, never>;
                            };
                        };
                    };
                };
                /** @description Rejected: approver equals initiator, or request expired */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/{approval_id}:reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject with mandatory reason */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    approval_id: components["parameters"]["approvalId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        reject_reason: string;
                    };
                };
            };
            responses: {
                200: components["responses"]["Approval"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Query the High-class audit trail */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    acting_principal?: string;
                    target_psu_identifier?: string;
                    event_type?: string;
                    from?: string;
                    to?: string;
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated audit events (the drill-down itself is logged) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["AuditEvent"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit/events/{event_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single audit event */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    event_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Audit event */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["AuditEvent"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/risk-signals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List risk signals */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    signal_type?: string;
                    severity?: "info" | "low" | "medium" | "high" | "critical";
                    status?: "open" | "acknowledged" | "investigating" | "closed_actioned" | "closed_no_action" | "false_positive";
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated signal list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["RiskSignal"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/risk-signals/{signal_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update signal state (acknowledge, close, false positive) */
        patch: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    signal_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "acknowledged" | "investigating" | "closed_actioned" | "closed_no_action" | "false_positive";
                    };
                };
            };
            responses: {
                /** @description Updated signal */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["RiskSignal"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        trace?: never;
    };
    "/back-office/scheme-notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List outbound downtime/change notifications with notice-clock + ack state (BACKOFFICE-78)
         * @description Planned bank maintenance / version releases must notify Nebras ≥10 days in advance (breaking changes ≥30 days + dual-running checklist). This lists each notification with its notice-compliance, acknowledgment, and downstream-TPP propagation state. The headless monitor flags approaching/breached notice clocks.
         */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    status?: "draft" | "notified" | "acknowledged" | "completed";
                    notification_type?: components["schemas"]["SchemeNotificationType"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated notification list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["SchemeNotification"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /**
         * Raise an outbound downtime/change notification to Nebras (BACKOFFICE-78)
         * @description Starts the notice clock — 10 days for planned maintenance / version releases, 30 days for breaking changes (which additionally require a dual-running checklist). LFI downtime notices propagate to downstream TPP-aaS customers. High-class audited; BCBS 239 lineage emitted.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        notification_type: components["schemas"]["SchemeNotificationType"];
                        title: string;
                        description?: string;
                        /**
                         * Format: date-time
                         * @description When the maintenance/change takes effect
                         */
                        scheduled_start: string;
                        /** Format: date-time */
                        scheduled_end: string;
                        /**
                         * @description Propagate the downtime notice to downstream TPP-aaS customers
                         * @default true
                         */
                        propagate_to_tpp?: boolean;
                    };
                };
            };
            responses: {
                /** @description Notification raised; notice clock started */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["SchemeNotification"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/scheme-notifications/{notification_id}:acknowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Record Nebras acknowledgment of an outbound notification (BACKOFFICE-78) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    notification_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Nebras acknowledgment reference */
                        nebras_ack_reference: string;
                    };
                };
            };
            responses: {
                /** @description Acknowledgment recorded */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["SchemeNotification"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/fraud-incidents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List fraud incidents with operational-pause + scheme-hold state (BACKOFFICE-77)
         * @description The fraud workflow (BACKOFFICE-22) escalates suspected fraud to the Nebras helpdesk and tracks the customer's operational-pause state until resolution. Scheme-imposed holds (systemic-fraud P1 events imposed on the bank) are also surfaced here and in the Ops + Risk Views. Read-only; narrow Risk scope.
         */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    status?: "open" | "reported" | "resolved";
                    nebras_severity?: components["schemas"]["NebrasSeverity"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated fraud-incident list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["FraudIncident"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /**
         * Report a fraud incident to the Nebras helpdesk + open operational pause (BACKOFFICE-77)
         * @description Extends the BACKOFFICE-22 fraud workflow with the "report to Nebras helpdesk" step. Captures the Nebras case reference, maps the Nebras P1–P4 severity taxonomy to the ITSM (P3) priority scheme, raises a P3 ticket, and opens the customer's operational-pause state. High-class audited; BCBS 239 lineage emitted.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * Format: uuid
                         * @description Consent under investigation (links to the fraud revoke)
                         */
                        consent_id?: string;
                        /**
                         * Format: uuid
                         * @description Consuming TPP
                         */
                        client_id?: string;
                        nebras_severity: components["schemas"]["NebrasSeverity"];
                        /** @description Helpdesk case reference */
                        nebras_case_reference?: string;
                        /**
                         * @description Place the customer in operational pause until resolution
                         * @default true
                         */
                        operational_pause?: boolean;
                        /** @description Investigation context (no PSU PII) */
                        summary: string;
                    };
                };
            };
            responses: {
                /** @description Fraud incident opened; reported to Nebras; operational pause set */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["FraudIncident"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/fraud-incidents/{incident_id}:resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve a fraud incident and lift the operational pause (BACKOFFICE-77) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    incident_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Resolution outcome (no PSU PII) */
                        resolution_note: string;
                    };
                };
            };
            responses: {
                /** @description Incident resolved; operational pause lifted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["FraudIncident"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/lineage/{table_name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** BCBS 239 lineage for a Back Office table (via enterprise data catalogue) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    table_name: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Column-level lineage tree */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/tpp-counterparties": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List consuming-TPP counterparties (directory-synced registry, BACKOFFICE-71) */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    production_status?: "directory_only" | "active_traffic" | "dormant" | "decommissioned";
                    registration_state?: "unregistered" | "onboarding" | "registered" | "suspended";
                    /** @description Filter to the alert condition — traffic observed without completed financial-system registration */
                    unbilled_traffic?: boolean;
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated counterparty list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TppCounterparty"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/tpp-counterparties/{organisation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Counterparty detail — directory org data, registration state, fee accruals */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    /** @description Trust Framework Directory OrganisationId */
                    organisation_id: components["parameters"]["organisationId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Counterparty detail */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TppCounterparty"];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/tpp-counterparties:sync-directory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Trigger Trust Framework Directory sync (GET /participants + /organisations via egress gateway) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Sync job accepted; new / changed / decommissioned TPPs flagged on completion */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/tpp-counterparties/{organisation_id}:register-financial-system": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Register counterparty as invoiceable in the financial management system (port P9, BACKOFFICE-72) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    /** @description Trust Framework Directory OrganisationId */
                    organisation_id: components["parameters"]["organisationId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Registration task dispatched to the P9 adapter; registration_state transitions tracked on the counterparty */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/billing-records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List ingested Nebras billing-record sets with reconciliation status */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    billing_period?: string;
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated record-set list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["BillingRecordSet"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * Ingest a Nebras monthly billing-record file (verified manual upload, BACKOFFICE-73 step 1)
         * @description Email-delivered Nebras billing records are uploaded here. Integrity hash computed and stored, BCBS 239 lineage emitted, second-person verification recorded (same pattern as the manual LFI-report ingest, BACKOFFICE-67).
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /** Format: binary */
                        file: string;
                        /** @description YYYY-MM */
                        billing_period: string;
                        /** @description e.g. email received date / sender */
                        source_note?: string;
                    };
                };
            };
            responses: {
                /** @description Record set ingested (status=ingested, integrity hash returned); reconciliation NOT yet run */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["BillingRecordSet"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/billing-records/{record_set_id}:reconcile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reconcile billing records against the bank's own API logs (BACKOFFICE-73 step 2-3 — reconcile BEFORE invoice)
         * @description Nebras figures are never blindly trusted. Variances above threshold create reconciliation_break records (standard E1 workflow) and a Nebras billing query within the 30-day dispute window. Invoice runs are blocked until this completes.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    record_set_id: components["parameters"]["recordSetId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Reconciliation job accepted; record set transitions to reconciling, then reconciled_clean or reconciled_with_breaks */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/invoice-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List invoice runs */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated invoice-run list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["InvoiceRun"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * Create an invoice run for a billing period (BACKOFFICE-73 step 4 — four-eyes gated)
         * @description Rejected with 409 unless the period's billing-record set is reconciled_clean or all breaks are resolved/escalated. Only clean or resolved lines flow into invoice instructions; disputed lines are withheld. Returns 202 + approval_request; dispatch to P9 happens only after second-person approval.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description YYYY-MM */
                        billing_period: string;
                        /** Format: uuid */
                        record_set_id: string;
                    };
                };
            };
            responses: {
                /** @description Invoice run pending four-eyes approval */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ApprovalRequest"];
                        };
                    };
                };
                /** @description Billing-record set not reconciled, or unresolved breaks block the run */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/invoice-runs/{invoice_run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Invoice-run detail — per-TPP instructions, withheld lines, settlement status (incl. net-settlement effects) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    invoice_run_id: components["parameters"]["invoiceRunId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Invoice-run detail */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["InvoiceRun"];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/trust-framework/participants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the bank's Trust Framework directory role-holders (BACKOFFICE-74)
         * @description Registry of the bank's own Trust Framework directory roles (Org Admin, PBC, PTC, STC) with named holders, individual + organisational T&C/DocuSign status, turnover state, and per-onboarding-stage SLA tracking (Interaction Guide). Operations-owned.
         */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    role?: components["schemas"]["TrustFrameworkRole"];
                    status?: "active" | "departing" | "vacant";
                };
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated participant list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TrustFrameworkParticipant"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /** Register a Trust Framework role-holder (BACKOFFICE-74) */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TrustFrameworkParticipantCreate"];
                };
            };
            responses: {
                /** @description Role-holder registered */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TrustFrameworkParticipant"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/trust-framework/participants/{participant_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Trust Framework role-holder detail (BACKOFFICE-74) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    participant_id: components["parameters"]["participantId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Participant detail */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TrustFrameworkParticipant"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/trust-framework/participants/{participant_id}:nominate-replacement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Turnover workflow — nominate a replacement for a departing role-holder (BACKOFFICE-74)
         * @description A role-holder's departure marks the participant departing and records the nominated replacement; the replacement's individual T&C/DocuSign restarts. High-class audited.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path: {
                    participant_id: components["parameters"]["participantId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        replacement_holder_ref: string;
                        /** @description Internal role-holder name (operational */
                        replacement_display_name: string;
                        note: string;
                    };
                };
            };
            responses: {
                /** @description Replacement nominated; participant marked departing */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TrustFrameworkParticipant"];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Envelope: {
            meta?: {
                request_id?: string;
                /** Format: date-time */
                timestamp?: string;
                next_cursor?: string | null;
            };
        };
        ErrorEnvelope: {
            error: {
                /** @example BACKOFFICE.SCOPE_DENIED */
                code: string;
                message: string;
                /** @description What the caller can do to resolve the error */
                remediation: string;
                /** Format: uri */
                docs_url: string;
                /** @description Present on scope-denied errors */
                required_scope?: string | null;
            };
            meta?: {
                request_id?: string;
                /** Format: date-time */
                timestamp?: string;
            };
        };
        /** @description Binding money convention (CLAUDE.md): integer minor units + ISO 4217 — never floating point. Example: { "amount": 150000, "currency": "AED" } = AED 1,500.00. */
        Money: {
            /** @description Integer minor units (fils for AED); may be negative for offsets/credits */
            amount: number;
            /**
             * @description ISO 4217 alphabetic code
             * @example AED
             */
            currency: string;
        };
        /**
         * @description §6.0 channel dimension (attribute, not tenant key)
         * @enum {string}
         */
        Channel: "internal_retail" | "internal_sme" | "internal_corporate" | "external_direct" | "external_tpp_aas";
        /**
         * @description Reconciliation line classes. dao_api_call (BACKOFFICE-68) covers Dynamic Account Opening API calls in the three-way match; it defaults to the data-sharing fee + break threshold until DAO-specific volumes/pricing are observed.
         * @enum {string}
         */
        LineType: "nebras_fees" | "payment_settlement" | "consent_record" | "tpp_aas_pass_through" | "lfi_access_log" | "dao_api_call";
        /** @enum {string} */
        BreakStatus: "flagged" | "assigned" | "resolved_matched" | "resolved_internal_correction" | "escalated_nebras_dispute" | "escalated_fintech_billing";
        /** @enum {string} */
        DisputeState: "open" | "in_progress" | "escalated" | "refund_initiated" | "resolved" | "closed";
        /** @enum {string} */
        ReportStatus: "requested" | "generating" | "awaiting_approval" | "approved" | "submitted" | "rejected" | "archived";
        /**
         * @description Full CBUAE v2.1-final lifecycle. `Suspended` is gated on the platform gap closure (Ready-to-Build Checklist item 2).
         * @enum {string}
         */
        ConsentStatus: "AwaitingAuthorization" | "Authorized" | "Rejected" | "Suspended" | "Consumed" | "Expired" | "Revoked";
        ReconciliationRun: {
            /** Format: uuid */
            id?: string;
            /** @example recon-2026-07-15-daily */
            run_id?: string;
            /** @enum {string} */
            run_type?: "daily" | "monthly_close" | "replay" | "on_demand";
            /** @enum {string} */
            status?: "running" | "completed" | "failed" | "partial";
            /** Format: date-time */
            reconciliation_window_start?: string;
            /** Format: date-time */
            reconciliation_window_end?: string;
            line_count_total?: number | null;
            line_count_matched?: number | null;
            line_count_unmatched?: number | null;
            line_count_disputed?: number | null;
            failure_reason?: string | null;
            /** Format: date-time */
            created_at?: string;
        };
        ReconciliationBreak: {
            /** Format: uuid */
            id?: string;
            run_id?: string;
            /** Format: uuid */
            client_id?: string | null;
            channel?: components["schemas"]["Channel"];
            line_type?: components["schemas"]["LineType"];
            status?: components["schemas"]["BreakStatus"];
            variance_amount?: components["schemas"]["Money"] | null;
            variance_count?: number | null;
            /** @description Nebras source line */
            source_a_ref?: string;
            /** @description Platform internal log line */
            source_b_ref?: string;
            /** @description Fintech billing line */
            source_c_ref?: string | null;
            assigned_to?: string | null;
            /** Format: date-time */
            sla_clock_started_at?: string | null;
            resolution_outcome?: string | null;
            resolution_note?: string | null;
            nebras_dispute_case_id?: string | null;
            reopened_count?: number;
            /** Format: date-time */
            created_at?: string;
        };
        Threshold: {
            /** @example nebras_fees */
            fee_class: string;
            /** @description Integer minor units (fils) when unit=aed — default 1 (= 1 fils) for fees; plain count when unit=count — default 0 for consent drift */
            threshold_value: number;
            /** @enum {string} */
            unit?: "aed" | "count";
        };
        PsuConsentSearchResult: {
            psu?: {
                bank_customer_id?: string;
                account_count?: number;
            };
            consents?: components["schemas"]["ConsentAdminView"][];
        };
        ConsentAdminView: {
            /** Format: uuid */
            consent_id?: string;
            tpp?: {
                /** Format: uuid */
                client_id?: string;
                display_name?: string;
            };
            /** @example AISP_DATA_SHARING */
            purpose?: string;
            scope?: string[];
            status?: components["schemas"]["ConsentStatus"];
            /** Format: date-time */
            granted_at?: string;
            /** Format: date-time */
            expires_at?: string | null;
            /** Format: date-time */
            last_access_at?: string | null;
            /** @description Present for multi-authorisation payment consents (BACKOFFICE-61) — M-of-N authoriser visibility. */
            multi_auth?: {
                /** @description M — authorisers required to authorise the consent */
                threshold?: number;
                /** @description Authorisers who have authorised so far */
                received?: number;
                /** @description True while received < threshold (still pending the authorisation threshold) */
                pending?: boolean;
                authorisers?: {
                    authoriser_ref?: string;
                    /** @description Per-authoriser status (e.g. authorised */
                    status?: string;
                    /** Format: date-time */
                    authorised_at?: string | null;
                }[];
            } | null;
        };
        ConsentEvent: {
            /** Format: uuid */
            id?: string;
            /** Format: uuid */
            consent_id?: string;
            psu_identifier?: string;
            /** @enum {string} */
            event_type?: "granted" | "accessed" | "modified" | "revoked";
            /** @description e.g. revocation reason code */
            event_subtype?: string | null;
            event_data?: Record<string, never>;
            acting_principal?: string | null;
            /** Format: date-time */
            created_at?: string;
        };
        PaymentAdminView: {
            /** Format: uuid */
            payment_id?: string;
            /** @description One of the 5 IPP status codes */
            ipp_status?: string;
            consent_at_time_of_payment?: components["schemas"]["ConsentAdminView"];
            /** @description CoP result from the Phase-0 endpoint */
            cop_outcome?: Record<string, never>;
            /** @description As submitted to the LFI */
            risk_information_block?: Record<string, never>;
            channel?: components["schemas"]["Channel"];
        };
        DisputeCreate: {
            psu_identifier: string;
            /** @enum {string} */
            dispute_type: "unauthorised_payment" | "unrecognised_tpp" | "consent_complaint" | "data_misuse_complaint" | "other";
            /** Format: uuid */
            originating_payment_id?: string | null;
            /** Format: uuid */
            originating_consent_id?: string | null;
            /** @description Contact-centre call linkage (BACKOFFICE-64 */
            originating_call_id?: string | null;
            dispute_reason_code?: string | null;
        };
        DisputeCase: components["schemas"]["DisputeCreate"] & {
            /** Format: uuid */
            id?: string;
            state?: components["schemas"]["DisputeState"];
            /** Format: date-time */
            sla_clock_started_at?: string;
            /**
             * Format: date-time
             * @description Next business day after sla_clock_started_at
             */
            refund_required_by?: string | null;
            /** Format: date-time */
            refund_initiated_at?: string | null;
            refund_amount?: components["schemas"]["Money"] | null;
            nebras_case_id?: string | null;
            care_case_id?: string | null;
            assigned_to?: string | null;
            /** Format: date-time */
            created_at?: string;
        };
        RespondentDisputeCreate: {
            /** @description Nebras Case & Dispute Management reference for the dispute raised against the bank */
            nebras_dispute_ref: string;
            /** @enum {string} */
            category: "billing" | "consent" | "data_sharing" | "liability" | "conduct" | "other";
            /** @description Short synthetic summary — no PSU PII */
            subject_summary?: string | null;
            /**
             * Format: date-time
             * @description When Nebras raised the dispute; the response + resolution clocks start here
             */
            raised_at: string;
            /**
             * Format: uuid
             * @description Linked reconciliation break where one exists
             */
            originating_break_id?: string | null;
        };
        /** @enum {string} */
        RespondentDisputeState: "received" | "responded" | "under_resolution" | "resolved" | "appealed" | "awaiting_implementation" | "implemented" | "closed";
        /**
         * @description on_track; amber within the warning window before due; red past due (breach)
         * @enum {string}
         */
        SchemeClockStatus: "on_track" | "amber" | "red";
        RespondentDispute: components["schemas"]["RespondentDisputeCreate"] & {
            /** Format: uuid */
            id?: string;
            state?: components["schemas"]["RespondentDisputeState"];
            /**
             * Format: date-time
             * @description raised_at + 3 business days
             */
            response_due_at?: string;
            /** Format: date-time */
            responded_at?: string | null;
            /**
             * Format: date-time
             * @description raised_at + 15 business days
             */
            resolution_due_at?: string;
            /** Format: date-time */
            resolved_at?: string | null;
            /**
             * Format: date-time
             * @description verdict + 3 business days
             */
            appeal_due_at?: string | null;
            /** Format: date-time */
            appealed_at?: string | null;
            /**
             * Format: date-time
             * @description final verdict + 3 business days
             */
            implementation_due_at?: string | null;
            /** Format: date-time */
            implemented_at?: string | null;
            response_clock_status?: components["schemas"]["SchemeClockStatus"];
            resolution_clock_status?: components["schemas"]["SchemeClockStatus"];
            appeal_clock_status?: components["schemas"]["SchemeClockStatus"];
            implementation_clock_status?: components["schemas"]["SchemeClockStatus"];
            overall_breach_status?: components["schemas"]["SchemeClockStatus"];
            /** @enum {string|null} */
            verdict_outcome?: "upheld" | "partially_upheld" | "rejected" | null;
            /** Format: date-time */
            created_at?: string;
        };
        ComplianceReport: {
            /** Format: uuid */
            id?: string;
            report_type?: string;
            status?: components["schemas"]["ReportStatus"];
            /** Format: date-time */
            reporting_period_start?: string;
            /** Format: date-time */
            reporting_period_end?: string;
            requested_by?: string;
            approved_by?: string | null;
            /** @description SHA-256 */
            integrity_hash?: string | null;
            /** Format: date-time */
            generated_at?: string | null;
            /** Format: date-time */
            submitted_at?: string | null;
        };
        /**
         * @description Ingest cadence for a login-only Nebras LFI report (BACKOFFICE-67) — daily for availability/performance, weekly for consent, monthly for billing (PRD §7).
         * @enum {string}
         */
        LfiReportCadence: "daily" | "weekly" | "monthly";
        /** @description Cadence health for one of the 16 login-only Nebras LFI report types (BACKOFFICE-67). */
        LfiReportCadenceStatus: {
            /** @example availability */
            report_type?: string;
            cadence?: components["schemas"]["LfiReportCadence"];
            /** Format: date-time */
            last_ingested_at?: string | null;
            /** @description Reporting period of the most recent ingest */
            last_period?: string | null;
            /**
             * Format: uuid
             * @description compliance_report record of the most recent ingest
             */
            last_report_id?: string | null;
            /**
             * Format: date-time
             * @description When the next ingest is due per cadence
             */
            next_due_at?: string;
            /** @description True when now > next_due_at; drives the missed-cadence ITSM ticket + Risk signal */
            overdue?: boolean;
        };
        ApprovalRequest: {
            /** Format: uuid */
            approval_request_id?: string;
            operation_type?: string;
            /** @enum {string} */
            state?: "pending" | "approved" | "rejected" | "timed_out";
            initiator?: string;
            approver_required_scope?: string;
            approver?: string | null;
            /**
             * Format: date-time
             * @description Default initiation + 2 business hours
             */
            expires_at?: string;
            reject_reason?: string | null;
        };
        RiskSignal: {
            /** Format: uuid */
            id?: string;
            /** @enum {string} */
            signal_type?: "consent_anomaly" | "tpp_behaviour" | "cop_mismatch_spike" | "nebras_liability_approach" | "agent_anomaly" | "predictive_liability_forecast";
            /** @enum {string} */
            severity?: "info" | "low" | "medium" | "high" | "critical";
            /** @enum {string} */
            status?: "open" | "acknowledged" | "investigating" | "closed_actioned" | "closed_no_action" | "false_positive";
            /** Format: uuid */
            client_id?: string | null;
            channel?: components["schemas"]["Channel"];
            signal_data?: Record<string, never>;
            /** @description Liability-matrix key issue × liable party (LFI/TPP) × AED amount */
            nebras_liability_event_ref?: string | null;
            /** Format: date-time */
            created_at?: string;
        };
        /**
         * @description Outbound notification class (BACKOFFICE-78). breaking_change enforces the 30-day notice + dual-running checklist; the others require 10-day notice.
         * @enum {string}
         */
        SchemeNotificationType: "planned_maintenance" | "version_release" | "breaking_change";
        /** @description An outbound downtime/change notification to Nebras (BACKOFFICE-78) with its notice-clock compliance, acknowledgment, and downstream-TPP propagation state. */
        SchemeNotification: {
            /** Format: uuid */
            id?: string;
            notification_type?: components["schemas"]["SchemeNotificationType"];
            title?: string;
            description?: string | null;
            /** Format: date-time */
            scheduled_start?: string;
            /** Format: date-time */
            scheduled_end?: string;
            /** @description 10 for maintenance/release */
            notice_required_days?: number;
            /** Format: date-time */
            notified_at?: string | null;
            /**
             * Format: date-time
             * @description scheduled_start − notice_required_days; latest compliant notice time
             */
            notice_deadline?: string;
            /** @description notified_at ≤ notice_deadline */
            notice_compliant?: boolean;
            /** @description True for breaking_change */
            dual_running_required?: boolean;
            dual_running_complete?: boolean;
            acknowledged?: boolean;
            /** Format: date-time */
            acknowledged_at?: string | null;
            nebras_ack_reference?: string | null;
            /** @description Downtime notice propagated to downstream TPP-aaS customers */
            propagate_to_tpp?: boolean;
            /** @enum {string} */
            status?: "draft" | "notified" | "acknowledged" | "completed";
            created_by?: string;
            /** Format: date-time */
            created_at?: string;
        };
        /**
         * @description Nebras incident severity taxonomy (BACKOFFICE-77). Mapped to the ITSM (P3) priority scheme: P1→critical, P2→high, P3→medium, P4→low.
         * @enum {string}
         */
        NebrasSeverity: "P1" | "P2" | "P3" | "P4";
        /** @description A fraud incident escalated to the Nebras helpdesk (BACKOFFICE-77), tracking the captured case reference, the mapped ITSM priority, and the customer operational-pause state until resolution. */
        FraudIncident: {
            /** Format: uuid */
            id?: string;
            /** Format: uuid */
            consent_id?: string | null;
            /** Format: uuid */
            client_id?: string | null;
            nebras_severity?: components["schemas"]["NebrasSeverity"];
            /**
             * @description Derived from nebras_severity
             * @enum {string}
             */
            itsm_priority?: "low" | "medium" | "high" | "critical";
            nebras_case_reference?: string | null;
            /** @enum {string} */
            status?: "open" | "reported" | "resolved";
            /** @description Customer operational-pause active until resolution */
            operational_pause?: boolean;
            /** @description True when Nebras imposed a hold/temporary revocation on the bank (systemic-fraud P1) */
            scheme_imposed_hold?: boolean;
            summary?: string;
            opened_by?: string;
            /** Format: date-time */
            opened_at?: string;
            /** Format: date-time */
            reported_at?: string | null;
            /** Format: date-time */
            resolved_at?: string | null;
        };
        AuditEvent: {
            /** Format: uuid */
            id?: string;
            /** @example psu_lookup */
            event_type?: string;
            acting_principal?: string;
            acting_persona?: string;
            scope_used?: string;
            target_psu_identifier?: string | null;
            /** Format: uuid */
            target_consent_id?: string | null;
            /** Format: uuid */
            target_dispute_id?: string | null;
            /** @description x-fapi-interaction-id */
            request_trace_id?: string;
            /** @description BACKOFFICE-80: stamped true on every record produced under platform:superadmin */
            superadmin_marker?: boolean;
            request_body_redacted?: Record<string, never>;
            response_status?: number;
            /** Format: date-time */
            created_at?: string;
        };
        Freshness: {
            /** Format: date-time */
            source_published_at?: string;
            /** Format: date-time */
            view_refreshed_at?: string;
            /** @description True when older than threshold (default: 2× source refresh cadence — BO-OQ-23) */
            stale?: boolean;
            stale_cause?: string | null;
        };
        TppCounterparty: {
            /** @description Trust Framework Directory OrganisationId */
            organisation_id?: string;
            legal_name?: string;
            registration_number?: string | null;
            directory_contacts?: {
                [key: string]: unknown;
            }[];
            /** Format: date-time */
            directory_synced_at?: string;
            /** @enum {string} */
            production_status?: "directory_only" | "active_traffic" | "dormant" | "decommissioned";
            /** Format: date-time */
            first_traffic_at?: string | null;
            /** @enum {string} */
            registration_state?: "unregistered" | "onboarding" | "registered" | "suspended";
            /** @description Counterparty reference in the P9 financial system */
            financial_system_ref?: string | null;
            /** @description Alert condition — traffic observed without completed financial-system registration */
            unbilled_traffic?: boolean;
            /** @description Month-to-date fee accrual */
            mtd_fee_accrual?: components["schemas"]["Money"] | null;
            channel?: components["schemas"]["Channel"];
        };
        BillingRecordSet: {
            /** Format: uuid */
            record_set_id?: string;
            /** @description YYYY-MM */
            billing_period?: string;
            /** Format: date-time */
            ingested_at?: string;
            /** @description acting principal (High-class audited) */
            ingested_by?: string;
            source_note?: string | null;
            integrity_hash?: string;
            line_count?: number;
            /** @enum {string} */
            status?: "ingested" | "reconciling" | "reconciled_clean" | "reconciled_with_breaks";
            open_break_count?: number;
            /** @description Nebras case references for disputed lines (30-day window) */
            nebras_billing_query_refs?: string[];
        };
        InvoiceRun: {
            /** Format: uuid */
            invoice_run_id?: string;
            billing_period?: string;
            /** Format: uuid */
            record_set_id?: string;
            /** @enum {string} */
            status?: "pending_approval" | "approved" | "dispatched_to_p9" | "partially_settled" | "settled" | "rejected";
            /** Format: uuid */
            approval_id?: string | null;
            invoices?: components["schemas"]["InvoiceInstruction"][];
            /** @description Disputed lines excluded from this cycle */
            withheld_line_count?: number;
            /** @description Amount netted where the bank also owes Nebras fees as TPP-of-record (negative = owed) */
            net_settlement_offset?: components["schemas"]["Money"] | null;
        };
        InvoiceInstruction: {
            organisation_id?: string;
            financial_system_ref?: string;
            line_items?: {
                [key: string]: unknown;
            }[];
            total?: components["schemas"]["Money"];
            /** @enum {string} */
            invoice_status?: "instructed" | "issued" | "settled" | "overdue" | "credit_noted";
            /** @description Issued on post-invoice break resolution */
            credit_note_refs?: string[];
        };
        /**
         * @description Bank Trust Framework directory roles (BACKOFFICE-74): Org Admin, Primary Business Contact (PBC), Primary Technical Contact (PTC), Senior Technical Contact (STC).
         * @enum {string}
         */
        TrustFrameworkRole: "org_admin" | "pbc" | "ptc" | "stc";
        /**
         * @description Individual or organisational T&C / DocuSign status.
         * @enum {string}
         */
        TncStatus: "not_started" | "sent" | "signed" | "expired";
        TrustFrameworkParticipantCreate: {
            role: components["schemas"]["TrustFrameworkRole"];
            /** @description The bank's Trust Framework OrganisationId */
            organisation_id: string;
            /** @description Internal id of the role-holder */
            holder_ref: string;
            /** @description Internal role-holder name (operational */
            holder_display_name: string;
            /** @description Current Interaction-Guide onboarding stage */
            onboarding_stage?: string;
        };
        TrustFrameworkParticipant: components["schemas"]["TrustFrameworkParticipantCreate"] & {
            /** Format: uuid */
            id?: string;
            individual_tnc_status?: components["schemas"]["TncStatus"];
            organisational_tnc_status?: components["schemas"]["TncStatus"];
            /**
             * Format: date-time
             * @description SLA due time for the current onboarding stage
             */
            onboarding_stage_due_at?: string | null;
            onboarding_stage_overdue?: boolean;
            /** @enum {string} */
            status?: "active" | "departing" | "vacant";
            /** @description Set by the turnover workflow when the holder is departing */
            nominated_replacement_ref?: string | null;
            /** Format: date-time */
            created_at?: string;
            /** Format: date-time */
            updated_at?: string;
        };
    };
    responses: {
        /** @description Standard error envelope (per CLAUDE.md) */
        Error: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
        /** @description Four-eyes operation accepted; pending second-person approval (2-business-hour expiry, BO-OQ-30 default) */
        ApprovalPending: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["ApprovalRequest"];
                };
            };
        };
        /** @description Reconciliation run */
        ReconciliationRun: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["ReconciliationRun"];
                };
            };
        };
        /** @description Reconciliation break */
        ReconciliationBreak: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["ReconciliationBreak"];
                };
            };
        };
        /** @description Threshold set */
        Thresholds: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["Threshold"][];
                };
            };
        };
        /** @description Dispute case */
        Dispute: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["DisputeCase"];
                };
            };
        };
        /** @description Compliance report record */
        Report: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["ComplianceReport"];
                };
            };
        };
        /** @description Approval request */
        Approval: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["ApprovalRequest"];
                };
            };
        };
        /** @description Revocation outcome */
        RevocationResult: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: {
                        /** Format: uuid */
                        consent_id?: string;
                        /** @enum {string} */
                        status?: "Revoked";
                        /** @description Must be < 5000 p99 (NFR-18) */
                        nebras_propagation_ms?: number;
                        psu_notified?: boolean;
                    };
                };
            };
        };
        /** @description Paginated consent lifecycle events */
        ConsentEventList: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["ConsentEvent"][];
                };
            };
        };
        /** @description View payload with mandatory freshness metadata (BACKOFFICE-40) */
        AnalyticsView: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    /** @description View-specific widgets */
                    data?: Record<string, never>;
                    freshness?: components["schemas"]["Freshness"];
                };
            };
        };
    };
    parameters: {
        /** @description Used as the OTel trace ID end-to-end (NFR-26) */
        fapiInteractionId: string;
        /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
        idempotencyKey: string;
        /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
        superAdminJustification: string;
        cursor: string;
        limit: number;
        breakId: string;
        consentId: string;
        disputeId: string;
        respondentDisputeId: string;
        reportId: string;
        /** @description Trust Framework Directory OrganisationId */
        organisationId: string;
        recordSetId: string;
        invoiceRunId: string;
        approvalId: string;
        participantId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
