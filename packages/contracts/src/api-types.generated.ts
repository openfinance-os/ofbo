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
        /**
         * Request the monthly reconciliation sign-off (four-eyes; BACKOFFICE-06)
         * @description Locking + signing a month's reconciliation summary is a high-stakes regulated action (a 5-year-immutable compliance_report with the Finance Analyst's attested sign-off), so it is four-eyes-gated: the initiator requests, a different finance:reconciliation:write principal approves, and only then is the report generated + locked. Returns 202 + approval_request; never executes inline (the binding four-eyes hard-stop). The locked Report is produced on approval.
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
                         * @description Calendar month YYYY-MM
                         * @example 2026-07
                         */
                        period: string;
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
    "/care-surface:mint-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mint a short-lived care-surface token (BACKOFFICE-25)
         * @description Console-originated API calls act on a PSU's behalf carrying agent identity (act) and PSU subject (sub). This mints a short-lived (<= 15 min), request-scoped care token via the Platform Auth Service (P1 CareSurfacePort). The agent (act) is taken from the authenticated caller — never the body — so it cannot be spoofed; sub is the resolved PSU. Every mint writes a High-class audit record (act + sub, PII redacted). Mutating: Idempotency-Key required — a replay within the 24h window returns the original token (no duplicate issue or audit); normal use sends a fresh key per request, yielding a fresh <= 15 min token.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        identifier_type: "bank_customer_id" | "iban" | "emirates_id";
                        /** @description PSU identifier; sent only to the BFF, redacted at audit emission. */
                        psu_identifier: string;
                    };
                };
            };
            responses: {
                /** @description A short-lived care-surface token with act/sub claims. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["CareToken"];
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
    "/disputes/{dispute_id}/call-recording": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resolve the originating call recording for a dispute (BACKOFFICE-64)
         * @description Resolves the dispute's originating_call_id to a short-lived link to the contact-centre recording via the P1 CareSurfacePort (the bank's existing integration). The Back Office links, never copies — recording content stays in the bank's system. Every access writes a High-class call_recording_accessed audit. Returns 404 when the dispute has no call linkage (non-voice channels) or the recording is unavailable. Same RBAC posture as the dispute (disputes:admin).
         */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    dispute_id: components["parameters"]["disputeId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description A short-lived link to the originating call recording. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["CallRecording"];
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
    "/back-office/governance/query-purposes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register a cross-fintech query purpose (BACKOFFICE-33)
         * @description Registers a new purpose in the query_purpose_registry that authorises a class of cross-fintech (bank_internal_view) aggregate reads. Four-eyes-gated (BD-13 / ADR 0015): returns 202 + approval_request; a DIFFERENT principal approves before the purpose becomes active (approved_by set) — it never registers inline. The BD-13 starter set is seeded pre-approved; this endpoint governs purposes added afterwards.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description snake_case identifier for the purpose (must be unique per bank) */
                        purpose_code: string;
                        /** @description What class of cross-fintech aggregate reads this purpose authorises */
                        description: string;
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
    "/back-office/str-drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Suspicious Transaction Report (STR) drafts (BACKOFFICE-63)
         * @description STR drafts are auto-created when a fraud-suspected revocation is approved (BACKOFFICE-22) and held by the Back Office. Compliance reviews them before they are handed to the bank's STR workflow. No PII — a draft carries an internal consent ref + case context, never PSU identifiers.
         */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    status?: "draft" | "awaiting_handoff" | "handed_off";
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
                /** @description Paginated STR drafts (cursor in meta.next_cursor). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["StrDraft"][];
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
    "/back-office/str-drafts/{str_draft_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an STR draft (BACKOFFICE-63) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    str_draft_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description A single STR draft. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["StrDraft"];
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
    "/back-office/str-drafts/{str_draft_id}:submit-to-workflow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hand an approved STR draft to the bank's STR workflow — four-eyes (BACKOFFICE-63)
         * @description Submits an STR draft to the bank's existing STR workflow (P10), which is the system of record that files with the CBUAE AML GO portal. The Back Office NEVER submits to AML GO directly — it only hands off. Four-eyes-gated: a Compliance officer (compliance:reports:generate) initiates → 202 + approval_request; a Risk second-line (risk:read, the persona that owns STR triggers) approves via the approvals path. Only on that approval does the handoff to P10 run, recording the workflow reference. High-class audited; no PII.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path: {
                    str_draft_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
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
    "/back-office/billing/console": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Tenant-scoped LFI billing operations read model (BILL-01..10)
         * @description Composes the resolved rate card, collections, accounting close pack, revenue assurance and profitability outputs for the internal billing console. This is a read surface only; metering, reconciliation, rating, dunning progression and journal posting remain headless scheduled jobs. Insurance commissions remain absent until an approved insurance commercial model exists (BILL-06).
         */
        get: {
            parameters: {
                query?: {
                    /** @description Calendar month; defaults to the current UTC month. */
                    period?: string;
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
    "/back-office/billing/profitability:simulate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run a non-persisted billing profitability scenario (BILL-09)
         * @description Pure what-if calculation over persisted tenant evidence; it writes no billing facts.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description BACKOFFICE-80 guardrail (d): REQUIRED (min 20 chars) when the caller holds platform:superadmin and the operation is mutating; recorded on the High-class audit record. Ignored for all other personas. Absence under the marker scope yields 400 BACKOFFICE.JUSTIFICATION_REQUIRED. */
                    "x-superadmin-justification"?: components["parameters"]["superAdminJustification"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["BillingProfitabilityScenarioRequest"];
                };
            };
            responses: {
                200: components["responses"]["AnalyticsView"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/billing/exports:cbuae-fee-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate an integrity-hashed CBUAE annual fee-review export (BILL-09) */
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
                        period: string;
                        scenarios: components["schemas"]["BillingProfitabilityScenario"][];
                    };
                };
            };
            responses: {
                /** @description Deterministic annual fee-review artifact */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: {
                                [key: string]: unknown;
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
    "/back-office/billing/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export all portable billing records for the authenticated tenant (BILL-10)
         * @description Outsourcing exit/portability export. The tenant is derived only from the verified identity-provider claim; callers cannot select another bank by header or query.
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
                /** @description Integrity-hashed tenant billing export */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: {
                                [key: string]: unknown;
                            };
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
    "/back-office/billing/tpp-cost-documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ingest a provider cost document — Nebras invoice primary (verified manual upload, BILL-14)
         * @description The payable-side twin of the billing-records ingest (BACKOFFICE-73), for what the bank owes as TPP-of-record rather than what it is owed as an LFI (ADR 0007). Same verified-manual-upload posture as BACKOFFICE-67: integrity SHA-256 computed and stored, BCBS 239 lineage emitted, second-person verification recorded.
         *
         *     Read `verified_by` for exactly what it is. The UPLOADER is taken from the caller's verified identity-provider claim and is never accepted from the request body. The VERIFIER is operator-attested: `verified_by` is a request field naming the second person, checked against the uploader's own subject and refused when equal. That establishes DISTINCTNESS between the two names — it does not establish that the verifier authenticated, and an uploader can name a colleague who never saw the document.
         *
         *     This paragraph previously asserted that neither name came from the request body, which contradicted this operation's own `verified_by` form field twenty-four lines below and described a control the service does not implement. Ratified as operator attestation rather than silently corrected: a real second-person authenticated step belongs on the existing four-eyes primitive (`202` + `approval_request`, initiator ≠ approver, 2-hour expiry), not on a second mechanism invented here. Raise a story if the bank wants that stronger posture.
         *
         *     Provider payloads are redacted at parse time, before the first INSERT: the cost tables are INSERT-only with no deletion path, so any customer detail a provider line carries would be unremovable. Lines whose provider category has no fee-class mapping are stored flagged `mapped: false` rather than dropped.
         *
         *     Replay of the same `Idempotency-Key` returns the stored result. The same issuer and document reference carrying different content is a conflict, not a second document.
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
                        /** @description The taxonomy is declared in full, but a type is only ingestible once a transport is wired behind the parser adapter. Today that is `nebras_tax_invoice` only — the Nebras invoice is primary (IG §10.2). The other five are accepted vocabulary for the ledger and are refused at ingest with `BACKOFFICE.UNSUPPORTED_DOCUMENT_TYPE` until their transport lands. */
                        document_type: components["schemas"]["TppCostDocumentType"];
                        billing_period: string;
                        /** @description The second person who verified this upload. Checked against the caller's own verified subject claim and refused when equal — it selects the verifier, it does not assert one. */
                        verified_by: string;
                        /** @description e.g. email received date / sender */
                        source_note?: string;
                    };
                };
            };
            responses: {
                /** @description The document was already ingested, so nothing new was written. Reached when the same issuer and document reference arrive again with identical content — including under a new `Idempotency-Key`. A replay of the SAME key returns the original cached response, status included, so a repeated first-ingest replays its `201`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TppCostDocument"];
                        };
                    };
                };
                /** @description Document ingested with its parsed lines; reconciliation NOT yet run (BILL-15) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TppCostDocument"];
                        };
                    };
                };
                /** @description Rejected for one of three reasons: the same issuer and document reference already exists carrying different content (a provider restatement, not a replay); the nominated verifier is the uploader; or the supplied `Idempotency-Key` was already used for a DIFFERENT document, in which case answering with either one would be wrong. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
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
    "/back-office/billing/tpp-cost-documents/{document_id}:reconcile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Three-way reconcile a provider cost document against own metering (BILL-15)
         * @description The payable twin of `/back-office/billing-records/{record_set_id}:reconcile`, and it carries the same scope for the same reason: judging a counterparty's figures against our own is one capability regardless of which direction the money flows.
         *
         *     Matches own metering against the expected statement and the provider document at the invoice category grain, under a configurable tolerance — expected values are milli-fils and documents state fils, so exact equality is never the test. Every difference becomes exactly one break: an expectation and a document line disagreeing on the counterparty produce a single `wrong_recipient` rather than a missing plus an unexpected charge, and a charge appearing on both the Nebras invoice and an LFI self-invoice is a `duplicate_charge` rather than a second cost. IG §10.17 late-payment penalties are accepted only against a recorded late payment for the same period.
         *
         *     Runs synchronously and returns the result, unlike the billing-records twin: this compares stored evidence rather than fetching from the Hub, so there is nothing to wait on. The response carries the IG §10.13 query deadline and the Nebras response clocks, because a break found outside the window is not actionable and the caller must see that with the finding.
         *
         *     Reconciling is not approving. Unresolved breaks withhold the period from payable approval (BILL-16); this endpoint records what was found and never settles it.
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
                    document_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Reconciliation complete. Returned for both a first run and a replay of the same reconciliation run, which writes nothing further — the ledger is INSERT-only with no deletion path, so a retried scheduled job must not double it. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TppCostReconciliation"];
                        };
                    };
                };
                /** @description No such cost document for this tenant */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
                    };
                };
                /** @description No expected cost statement exists for the document's billing period, so there is nothing to reconcile against. Refused rather than reported as an all-unexpected-charges result, which would look like a provider fault when it is a missing projection on our side. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
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
    "/back-office/billing/cost-periods/{period}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * TPP cost-period state — close, payables and what is blocking them (BILL-16)
         * @description The payable side of a billing period in one read: whether the period has closed, which four-eyes approval closed it, the payables it authorises, and the unresolved breaks that are holding it open.
         *
         *     `close_state` is DERIVED, never stored as a workflow column. `blocked` means `open_break_count` is above zero, so a close would be refused; `open` means the period is clear and nobody has asked to close it; `closed` means a second finance principal approved the close and the row exists. There is no `pending_approval` value because a requested close lives on the approvals queue, not here — a period with an outstanding request is still `open`, and `GET /back-office/approvals/pending` is where that request is visible.
         */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    /** @description Cost period as YYYY-MM. */
                    period: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cost-period state. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TppCostPeriod"];
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
    "/back-office/billing/cost-periods/{period}:close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request the four-eyes close of a TPP cost period (BILL-16)
         * @description Never closes inline. Returns `202` with an `approval_request`, and the close executes only when a SECOND finance principal approves it — the binding four-eyes rule, on the existing approvals primitive rather than a second close mechanism.
         *
         *     Refused with `409` while the period carries unresolved material payable breaks. That refusal is what makes BILL-15's reconciliation load-bearing rather than advisory: without it a disputed line reaches an approved payable and gets paid. The check runs again at execution, because approval is a separate act up to two business hours later and a break raised in between must still stop the close.
         *
         *     The close is a gated PRECONDITION feeding the existing BACKOFFICE-06 monthly sign-off. It is not a sign-off of its own, and it does not dispatch anything — honouring the scheme direct debit is a separate, separately-authorised act.
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
                    /** @description Cost period as YYYY-MM. */
                    period: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                202: components["responses"]["ApprovalPending"];
                /** @description The period carries unresolved material payable breaks, or it is already closed. Both are refusals rather than no-ops: closing over an open break would approve a disputed line, and re-closing a closed period would mint a second four-eyes record for one act. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
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
    "/back-office/billing/payables/{payable_id}:dispatch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hand an approved payable to the financial system (BILL-16)
         * @description Authorises HONOURING a scheme direct debit; it does not push a payment. IG v5.0 §10.14–10.15 makes collection a scheme-operated pull — the DDA is presented to the Nebras sponsoring bank on the 10th and collected by the 30th — so P9's role is mandate management plus matching the pulled debit to the approved payable.
         *
         *     The four-eyes period close is a hard precondition, and the cited approval is re-verified here rather than trusted: it must be `approved`, for THIS payable's own period, granted inside its two-business-hour window, and by two distinct principals. The caller must be one of those two — an approval authorises the people who made it, not everyone who can read its id.
         *
         *     `Idempotency-Key` is required and is never generated server-side: a generated key would make every retry a new dispatch, which is exactly how one debit gets authorised twice. The key is stored as a digest, not in the clear.
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
                    /** @description The reconciliation whose accepted payable is being dispatched. */
                    payable_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Dispatched, or replayed. A replay returns the same result without authorising a second debit — `replayed` says which happened. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["TppCostPayableDispatch"];
                        };
                    };
                };
                /** @description The caller took no part in the four-eyes approval being cited, so it does not authorise them to honour this debit. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
                    };
                };
                /** @description No such payable for this tenant */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
                    };
                };
                /** @description The payable has no live four-eyes approval — absent, expired, approved late, rejected, for another period, or evidencing one principal twice — or the dispatch state being recorded does not legally follow the one already on file. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorEnvelope"];
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
    "/back-office/disputes/{dispute_id}:record-cross-scheme": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record cross-scheme (Aani / Al Tareq) context on a dispute (BACKOFFICE-76)
         * @description Records the Aani case id (where one exists) and/or a Sanadak escalation, and the double-compensation guard state. When settled_in_other_scheme is set, the guard marks the case so a subsequent :initiate-refund for the same direct loss is rejected (409) — preventing the same loss being settled in both schemes. High-class audited.
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
                        /** @description Aani instant-payment scheme case id */
                        aani_case_id?: string;
                        /** @description Set when the same direct loss has been settled in the other scheme (arms the double-compensation guard) */
                        settled_in_other_scheme?: boolean;
                        /** @description Consumer-protection-authority (Sanadak) escalation reference */
                        sanadak_reference?: string;
                    };
                };
            };
            responses: {
                /** @description Cross-scheme context recorded */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["DisputeCase"];
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
    "/back-office/service-desk-cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Nebras service-desk cases for the Ops Console (BACKOFFICE-79)
         * @description Any case raised with the Nebras service desk (incident, billing query, onboarding, general) tracked by Nebras case reference with type, priority, and the Interaction Guide SLA applied; linked to the originating break, dispute, or signal where one exists.
         */
        get: {
            parameters: {
                query?: {
                    cursor?: components["parameters"]["cursor"];
                    limit?: components["parameters"]["limit"];
                    case_type?: components["schemas"]["ServiceDeskCaseType"];
                    priority?: components["schemas"]["ServiceDeskCasePriority"];
                    status?: components["schemas"]["ServiceDeskCaseStatus"];
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
                /** @description Paginated service-desk case list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ServiceDeskCase"][];
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /** Track a Nebras service-desk case (BACKOFFICE-79) */
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
                    "application/json": components["schemas"]["ServiceDeskCaseCreate"];
                };
            };
            responses: {
                /** @description Service-desk case tracked; SLA clock started */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ServiceDeskCase"];
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
    "/back-office/service-desk-cases/{case_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Nebras service-desk case detail (BACKOFFICE-79) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    case_id: components["parameters"]["serviceDeskCaseId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Service-desk case detail */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ServiceDeskCase"];
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
    "/back-office/service-desk-cases/{case_id}:update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Update a Nebras service-desk case status / priority (BACKOFFICE-79) */
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
                    case_id: components["parameters"]["serviceDeskCaseId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        status?: components["schemas"]["ServiceDeskCaseStatus"];
                        priority?: components["schemas"]["ServiceDeskCasePriority"];
                        note: string;
                    };
                };
            };
            responses: {
                /** @description Case updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ServiceDeskCase"];
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
    "/back-office/agents:register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register an automation agent identity (DCR) — four-eyes (BACKOFFICE-60)
         * @description Programmatic admin-scope access (ADR 0017). Registers an automation under a pre-defined least-privilege agent persona whose scopes are a STRICT SUBSET of a human persona (PRD §2) and never platform:superadmin (BACKOFFICE-80 — agents are service accounts). The caller NAMES A PERSONA; the server binds that persona's scopes — the request can never request arbitrary scopes, so DCR is not a scope- escalation path. Granting agent authority is four-eyes-gated: returns 202 + approval_request; a different principal approves before the client credential is issued — it never registers inline. Issued read-only (allow_mutations=false, spend_budget=0) until a human raises both AND spend-control (BACKOFFICE-53) is live.
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
                        /** @description Agent persona id from the AGENT_PERSONAS catalogue (e.g. care-readonly-agent). Its scopes are bound server-side. */
                        persona: string;
                        /** @description Human-readable label for the automation (no PII) */
                        display_name: string;
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
    "/back-office/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List registered automation agents (BACKOFFICE-60) */
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
                200: components["responses"]["Agents"];
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
    "/back-office/agents/{agent_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a registered automation agent (BACKOFFICE-60) */
        get: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                };
                path: {
                    agent_id: components["parameters"]["agentId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: components["responses"]["Agent"];
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
    "/back-office/agents/{agent_id}:revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revoke (deactivate) an automation agent — single-actor kill switch (BACKOFFICE-60)
         * @description Deactivates an agent credential immediately. Deliberately NOT four-eyes: granting authority needs two principals, REMOVING it needs one — so a rogue or compromised agent can be killed without waiting for a second approver. High-class audited.
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
                    agent_id: components["parameters"]["agentId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Why the agent is being deactivated (no PII) */
                        reason: string;
                    };
                };
            };
            responses: {
                200: components["responses"]["Agent"];
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/back-office/agents/{agent_id}:mint-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mint a short-lived agent session token (ADR 0018 — BACKOFFICE-53/-60)
         * @description Generalises the ADR 0001 act/sub minting into an agent SESSION token (token-exchange, RFC 8693). Issued ONLY for an `active` registration: returns a short-lived, server-verifiable token whose act = agent_id, scopes = the registration's bound scopes (a strict subset of a human persona; never platform:superadmin), plus a session_id + spend_budget. The MCP gateway presents this token as its bearer; the BFF verifies it (it minted it), re-asserts per-(agent_id, session_id) spend-control BFF-side — closing BACKOFFICE-53's defence-in-depth criterion (the gateway guard is never the sole layer) — and stamps the High-class audit with acting_principal = agent_id. NOT four-eyes: registration already was, and this grants no authority beyond the bound scopes; revoking the agent (single-actor kill switch) denylists the session before its TTL. Mutating: Idempotency-Key required — a replay within the 24h window returns the original session token (no duplicate session); a fresh key yields a fresh session.
         */
        post: {
            parameters: {
                query?: never;
                header: {
                    /** @description Used as the OTel trace ID end-to-end (NFR-26) */
                    "x-fapi-interaction-id": components["parameters"]["fapiInteractionId"];
                    /** @description 24h dedup window (Kong plugin); required on all mutating endpoints */
                    "Idempotency-Key": components["parameters"]["idempotencyKey"];
                };
                path: {
                    agent_id: components["parameters"]["agentId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description A short-lived agent session token. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["AgentSessionToken"];
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
    "/public/readiness/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Port catalog + adopting-bank decision defaults for the readiness wizard
         * @description Serves the P1–P9 system-option catalog and the BD-01..16 decision defaults the public wizard renders. Static, no auth, no PII.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The readiness catalog */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ReadinessCatalog"];
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
    "/public/readiness:assess": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Score an estate mapping into a readiness digest (stateless)
         * @description Deterministic: a port→system mapping and BD-01..16 answers in, a readiness digest (score, per-port effort + contract-test gate, governance register, generated Bank Profile, suggested port-swap sequencing) out. No persistence, no auth, no PII.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ReadinessAssessmentInput"];
                };
            };
            responses: {
                /** @description The computed readiness digest */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ReadinessDigest"];
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
    "/public/readiness/profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Save a named readiness profile, returns a shareable slug
         * @description Persists a named self-assessment (non-regulated bank system-metadata only — never a regulated record, never PII) and returns an unguessable slug for sharing/reopening.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        input: components["schemas"]["ReadinessAssessmentInput"];
                    };
                };
            };
            responses: {
                /** @description The saved profile (with its digest and slug) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ReadinessProfile"];
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
    "/public/readiness/profiles/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Reopen a saved readiness profile by slug */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The saved profile */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["ReadinessProfile"];
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
    "/public/readiness/maturity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Product maturity — what's built vs. what remains (public, ADR 0022)
         * @description The companion to the readiness wizard: the wizard shows how close a given bank is; this shows how complete the product is. Milestone roadmap (M0–M6) + per-port adapter status (every sim adapter ships, and every port now carries a reference enterprise adapter; M6 is the per-bank production cutover). Static, no auth, no PII.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The product maturity summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Envelope"] & {
                            data?: components["schemas"]["MaturitySummary"];
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
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        BillingProfitabilityScenario: {
            scenario_id: string;
            /** Format: date */
            effective_date: string;
            receivable_multiplier_basis_points: number;
            retail_overage: {
                overage_units: number;
                current_rate_milli_fils: number;
                proposed_rate_milli_fils: number;
            };
        };
        BillingProfitabilityScenarioRequest: {
            period: string;
            scenario: components["schemas"]["BillingProfitabilityScenario"];
        };
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
        /** @description A registered automation agent identity (BACKOFFICE-60 / ADR 0017). No PII — this describes a service account, not a person. Scopes are a STRICT SUBSET of the human persona named by `derived_from` (PRD §2) and never include platform:superadmin (BACKOFFICE-80). */
        AgentRegistration: {
            /** Format: uuid */
            agent_id: string;
            /** @description OAuth2 client id issued on approval (DCR */
            client_id: string;
            display_name: string;
            /** @description Agent persona id (e.g. care-readonly-agent) */
            persona: string;
            /** @description Human persona this agent is a strict subset of (PRD §2) */
            derived_from: string;
            /** @description Bound server-side from the persona; strict subset of derived_from's scopes; never platform:superadmin. */
            scopes: string[];
            /** @enum {string} */
            status: "pending" | "active" | "revoked";
            /** @description ADR 0017 — false until a human raises it AND spend-control (BACKOFFICE-53) is live */
            allow_mutations: boolean;
            /** @description Per-session consequential-operation budget (BACKOFFICE-53); 0 = read-only */
            spend_budget: number;
            /** @description IdP subject of the four-eyes initiator */
            registered_by: string;
            /** @description IdP subject of the four-eyes approver (different principal) */
            approved_by?: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            revoked_at?: string | null;
            revoke_reason?: string | null;
        };
        /** @description A short-lived agent session token (ADR 0018, Option 2). Generalises the ADR 0001 act/sub minting: act = agent_id, scopes = the registration's bound scopes (a strict subset of a human persona; never platform:superadmin), plus a session_id + spend_budget so the BFF can re-assert per-(agent_id, session_id) spend-control BFF-side (BACKOFFICE-53). Issued only for an `active` registration. No PII — an agent is a service account, not a person. */
        AgentSessionToken: {
            /** @description Opaque */
            session_token: string;
            /**
             * Format: uuid
             * @description The registry agent id (act). Server-verified — never taken from a client header.
             */
            agent_id: string;
            /** @description Stable id for per-session spend accounting + trace correlation. */
            session_id: string;
            /** @description The registration's bound scopes; a strict subset of a human persona; never platform:superadmin. */
            scopes: string[];
            /** @description Mirrors the registration; mutating tools stay disabled when false. */
            allow_mutations: boolean;
            /** @description Per-session consequential-operation budget re-asserted BFF-side (BACKOFFICE-53); 0 = read-only. */
            spend_budget: number;
            /**
             * Format: date-time
             * @description Short TTL; revoking the agent denylists the session before it expires.
             */
            expires_at: string;
        };
        /** @description A Suspicious Transaction Report draft (BACKOFFICE-63). Auto-created on a fraud-suspected revocation (BACKOFFICE-22); handed to the bank's STR workflow (P10) on four-eyes approval, which submits to AML GO — the Back Office never submits directly. No PII — an internal consent ref + case context only, never PSU identifiers. */
        StrDraft: {
            /** Format: uuid */
            str_draft_id: string;
            /** @description Internal ref to the consent whose fraud-revoke raised this draft. No PII. */
            source_consent_id: string;
            /** @description Free-text investigator context carried into the STR. Synthetic in non-prod; no PII. */
            case_context: string;
            /**
             * @description draft → awaiting_handoff (four-eyes initiated) → handed_off (accepted by the STR workflow).
             * @enum {string}
             */
            status: "draft" | "awaiting_handoff" | "handed_off";
            /** @description IdP subject that raised the draft (the fraud-revoke initiator). */
            created_by: string;
            /** @description The four-eyes approval request gating the handoff. */
            approval_id?: string | null;
            /** @description The bank STR workflow's own reference once it accepts the handoff. */
            workflow_ref?: string | null;
            /** @description IdP subject of the Risk second-line approver (different principal). */
            approved_by?: string | null;
            /** Format: date-time */
            handed_off_at?: string | null;
            /** Format: date-time */
            created_at: string;
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
         * @description Semantic tone for a stat/trend (UIF-SPEC). Maps to the PRD §7 status triad — reconciled=green, break=amber, breach=red — plus neutral. Appearance only.
         * @enum {string}
         */
        StatTone: "reconciled" | "break" | "breach" | "neutral";
        /** @description A typed, named analytics panel (UIF-SPEC / ADR 0016). `kind` selects the bespoke portal primitive; the matching payload property carries its data (e.g. `stats` for kpi-strip, `gauge` for gauge). A client that does not recognise a `kind` MUST degrade it to the generic labelled grid — so producers can add kinds without a breaking change. Bound to the OpenAPI contract; carries no PSU PII. */
        AnalyticsSection: {
            /** @enum {string} */
            kind: "kpi-strip" | "gauge" | "contribution-bars" | "status-cards" | "alert" | "object-table";
            title: string;
            /** @description Payload for kind=kpi-strip. */
            stats?: components["schemas"]["AnalyticsStat"][];
            /** @description Payload for kind=gauge. */
            gauge?: components["schemas"]["AnalyticsGauge"];
            /** @description Payload for kind=contribution-bars. */
            segments?: components["schemas"]["AnalyticsContributionSegment"][];
            /** @description Payload for kind=status-cards. */
            cards?: components["schemas"]["AnalyticsStatusCard"][];
            /** @description Payload for kind=alert. */
            alert?: components["schemas"]["AnalyticsAlert"];
            /** @description Payload for kind=object-table. */
            table?: components["schemas"]["AnalyticsTable"];
        };
        /** @description One big-number stat in a kpi-strip section (renders as KpiStat). */
        AnalyticsStat: {
            label: string;
            /** @description Pre-formatted display value — a string so the producer controls formatting (e.g. AED 4.82M or 32.8%). */
            value: string;
            unit?: string | null;
            sublabel?: string | null;
            trend?: {
                label: string;
                tone?: components["schemas"]["StatTone"];
            } | null;
        };
        /** @description A radial gauge payload (renders as Gauge). */
        AnalyticsGauge: {
            value: number;
            /** @default 100 */
            max: number;
            unit?: string | null;
        };
        /** @description One segment of a contribution-bars section (renders as ContributionBar). */
        AnalyticsContributionSegment: {
            label: string;
            /** @description Relative weight; widths are normalised to the segment total. */
            value: number;
        };
        /** @description One card in a status-cards section (status renders as a StatusBadge). */
        AnalyticsStatusCard: {
            label: string;
            value?: string | null;
            /** @description A status token mapped to a tone via the shared status vocabulary. */
            status: string;
            note?: string | null;
        };
        /** @description An inline alert/callout section. */
        AnalyticsAlert: {
            /** @enum {string} */
            severity: "info" | "warning" | "critical";
            message: string;
            remediation?: string | null;
        };
        /** @description A simple object-table section (the generic grid's typed form). */
        AnalyticsTable: {
            columns: string[];
            rows: {
                [key: string]: unknown;
            }[];
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
        /** @description A short-lived care-surface token (BACKOFFICE-25). act = the acting agent, sub = the PSU subject (both internal refs, no PII). Cap expires_at at <= 15 min. */
        CareToken: {
            /** @description Opaque bearer credential for care-surface calls. */
            token: string;
            /** @description Acting agent identity (internal ref */
            act: string;
            /** @description Resolved PSU subject (internal ref */
            sub: string;
            /** Format: date-time */
            expires_at: string;
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
            /** @description Cross-scheme reference (BACKOFFICE-76) — Aani case id where the same dispute exists in the Aani instant-payment scheme */
            aani_case_id?: string | null;
        };
        /** @description A short-lived link to the contact-centre recording that originated a dispute (BACKOFFICE-64). The Back Office links, never copies — recording_url is a time-boxed locator in the bank's system; cap expires_at short. */
        CallRecording: {
            /** @description Opaque recording reference in the bank's contact-centre system. */
            recording_ref: string;
            /** @description Short-lived locator URL (null when only a reference is returned). */
            recording_url?: string | null;
            /** Format: date-time */
            expires_at: string;
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
            cross_scheme?: components["schemas"]["CrossSchemeContext"] | null;
            /** Format: date-time */
            created_at?: string;
        };
        /** @description Cross-scheme (Aani / Al Tareq) dispute context + double-compensation guard (BACKOFFICE-76). The guard blocks settling the same direct loss in both schemes. */
        CrossSchemeContext: {
            aani_case_id?: string | null;
            /**
             * Format: date-time
             * @description 2-hour Aani fund-recall window (from the payment); surfaced in unauthorized-payment triage
             */
            aani_recall_window_expires_at?: string | null;
            /** @description True when the same direct loss has been settled in the other scheme */
            settled_in_other_scheme?: boolean;
            /** @description Double-compensation guard — when true */
            compensation_blocked?: boolean;
            /** @description Consumer-protection-authority (Sanadak) escalation reference */
            sanadak_reference?: string | null;
            /** Format: date-time */
            sanadak_escalated_at?: string | null;
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
            operation_summary?: components["schemas"]["ApprovalOperationSummary"] | null;
        };
        /** @description UX-03c / ADR 0014 — a minimal, NON-PII summary of the gated operation so the second four-eyes approver can exercise a real judgment (not a rubber-stamp). The BFF composes this server-side at approval-request creation, applying the same redaction it already enforces. HARD CONSTRAINT (the four-eyes surface must never leak PSU PII): this object carries only non-PII institutional facts — it MUST NOT contain PSU identifiers, names, account numbers, IBANs, Emirates IDs, raw payment references, or free text. The closed shape (additionalProperties:false) is the enforcement: nothing else may be attached. */
        ApprovalOperationSummary: {
            /** @description Monetary scale of the operation, when applicable (e.g. an invoice-run total). */
            amount?: components["schemas"]["Money"] | null;
            /** @description Masked INSTITUTIONAL counterparty only — a TPP display_name or client_id. Never a PSU name or identifier. */
            counterparty_label?: string | null;
            /** @description Non-PII count/scope descriptor, e.g. "invoice run · 142 line items · period 2026-05" or "fraud-suspected revoke · 1 consent". No PSU data, no free-text operator input. */
            descriptor?: string | null;
        };
        RiskSignal: {
            /** Format: uuid */
            id?: string;
            /** @enum {string} */
            signal_type?: "consent_anomaly" | "tpp_behaviour" | "cop_mismatch_spike" | "nebras_liability_approach" | "agent_anomaly" | "predictive_liability_forecast" | "lfi_report_cadence_missed";
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
            /**
             * @description The declared scope that authorised the action, or one of exactly three declared non-scope literals. Scheduled jobs previously stamped invented tokens (`billing:rate`, `reconciliation:run`, …) that named scopes an auditor could not resolve against this contract — permanently, since the trail is INSERT-only with a five-year retention and no deletion path. Identity is carried by `acting_principal` and `event_type`, so nothing is lost by recording that no scope was involved (CODE-03).
             *
             *     The three, kept distinct because collapsing them is the blurring the trail exists to prevent — an auditor must be able to tell a headless job from a person whose action no scope mediated:
             *
             *     - `system` — a scheduled actor that no principal authorised.
             *     - `none` — an auth-lifecycle event (signin failure, signout) where a HUMAN acted and no scope was in play. Filing these under `system` would attribute a person's failed signin to a machine.
             *     - `seed` — demo-profile seed provenance, written by the seed scripts. Never an authorisation; the demo environment is permanently non-prod.
             *
             *     This list is the contract half of a closed loop: the three literals are declared once in `packages/db/src/audit.ts`, the CODE-03 resolvability check builds its allow-list from those same constants, and a test asserts every declared constant appears here. An earlier version of this description named only `system` while the code wrote all three, which reproduced CODE-03's own defect — a value an auditor cannot resolve against the contract — inside the change that was supposed to close it.
             */
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
            /** @description The HTTP status returned to the caller, or `0` for an actor that issues no HTTP response at all. Zero is not a status code, which is why it can carry that meaning without colliding with one. Scheduled jobs previously stamped 200/201/202/502 for responses nobody received, including one path that recorded 200 on a SKIP (CODE-03). */
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
        /**
         * @description Provider cost-document taxonomy (ADR 0007 D9, IG v5.0 §10). Nebras tax invoice is primary.
         * @enum {string}
         */
        TppCostDocumentType: "nebras_tax_invoice" | "nebras_settlement_statement" | "lfi_self_invoice" | "credit_note" | "debit_note" | "manual_adjustment";
        /** @description One provider line. `source_category` is the provider's own category, kept verbatim as evidence; `fee_class` is our mapping of it and is null exactly when `mapped` is false. */
        TppCostDocumentLine: {
            line_ref: string;
            source_category: string;
            fee_class?: string | null;
            /** @description False when the provider category resolves to no known fee class. Such a line is flagged, never dropped. */
            mapped: boolean;
            /** @enum {string} */
            cost_recipient_type: "nebras" | "underlying_lfi";
            cost_recipient_id: string;
            units: number;
            /** @description A unit RATE in integer milli-fils (thousandths of a fil), NOT a money amount. The binding money convention governs amounts; a scheme tariff of 2.5 fils per call cannot be expressed in minor units without rounding the price itself away, so rates keep sub-minor resolution. */
            unit_price_milli_fils: number;
            actual_net: components["schemas"]["Money"];
            vat: components["schemas"]["Money"];
            /** @description Always equals actual_net + vat; derived from the rounded parts so the triple ties. */
            actual_gross: components["schemas"]["Money"];
        };
        TppCostDocument: {
            /** Format: uuid */
            document_id: string;
            document_type: components["schemas"]["TppCostDocumentType"];
            issuer_id: string;
            recipient_id: string;
            document_reference: string;
            /** @description YYYY-MM */
            billing_period: string;
            currency: string;
            net: components["schemas"]["Money"];
            vat: components["schemas"]["Money"];
            /** @description Always equals net + vat; derived from the rounded parts so the triple ties. */
            gross: components["schemas"]["Money"];
            document_sha256: string;
            /** Format: date-time */
            issued_at: string;
            /** Format: date-time */
            received_at: string;
            /** @description The second person who verified the upload; never equal to the uploader */
            verified_by: string;
            /** Format: date-time */
            verified_at: string;
            /** @description Lines stored with mapped=false, awaiting a category mapping. Non-zero is a signal, not a failure. */
            unmapped_line_count: number;
            /** @description How many provider fields were redacted at parse time. Key paths are audited; the removed values are never stored or logged. */
            redacted_field_count: number;
            lines: components["schemas"]["TppCostDocumentLine"][];
        };
        /**
         * @description Payable break taxonomy (BILL-13 migration 0039). Narrower than the reconciliation `LineType`, which classifies WHICH STREAM a break belongs to rather than what went wrong; every value here maps onto a LineType via the cost recipient — Hub fees to nebras_fees, underlying-LFI API access to lfi_access_log.
         * @enum {string}
         */
        PayableBreakType: "quantity_variance" | "rate_variance" | "unexpected_charge" | "missing_charge" | "wrong_recipient" | "duplicate_charge" | "vat_variance" | "period_variance" | "unmatched_document_line" | "unmatched_expected_line";
        TppCostDiffLine: {
            line_ref: string;
            break_type: components["schemas"]["PayableBreakType"];
            /** @description The contract class this break is shown as on GET /back-office/reconciliation/breaks. */
            line_type: components["schemas"]["LineType"];
            /** @enum {string} */
            presence: "both" | "expected_only" | "document_only";
            /** @enum {string} */
            cost_recipient_type: "nebras" | "underlying_lfi";
            cost_recipient_id: string;
            fee_class?: string | null;
            /** @description The provider's own wording, retained because a billing query cites it back to them. */
            source_category?: string | null;
            expected_net: components["schemas"]["Money"];
            actual_net: components["schemas"]["Money"];
            /** @description Signed — negative where the provider undercharged. Rounded symmetrically, so a credit is not biased against the bank. */
            variance: components["schemas"]["Money"];
            variance_basis_points: number;
            /** @description Exceeds the tolerance. A wrong recipient is material at zero variance. */
            material: boolean;
            reason_code: string;
            /**
             * Format: uuid
             * @description The E1 break this was escalated as; null until it is escalated.
             */
            reconciliation_break_id?: string | null;
        };
        /** @description Money amounts are `Money` (integer minor units + ISO 4217), per the binding convention. Milli-fils — thousandths of a fil — is a RATING AND STORAGE precision only, needed because ADR 0007 prices scheme tariffs at 2.5 and 0.5 fils; it never reaches the wire as an amount. The two integer fields that remain in milli-fils are a matching threshold and a unit rate, neither of which is an amount. */
        TppCostReconciliation: {
            /** @description YYYY-MM */
            period: string;
            /** @description ISO 4217 for this reconciliation. Every AMOUNT here is a Money carrying its own currency; this field governs the object and the only bare-integer field left on it, `tolerance_milli_fils`, which is a threshold rather than an amount. The previous wording ("for every milli-fils amount in this object") described the pre-CODE-03 shape and survived the sweep that removed those amounts. */
            currency: string;
            /** @description A matching THRESHOLD in integer milli-fils, not a money amount. Expectations are milli-fils and documents state fils, so a sub-fil difference is a unit artefact rather than a dispute — sub-fil resolution is the entire point of the field, and minor units would round it away. Configurable; defaults to one fil. */
            tolerance_milli_fils: number;
            /** @description IG v5.0 §10.13 window in calendar days. Config, not a constant (BD-21). */
            query_window_days: number;
            /** Format: date-time */
            query_deadline: string;
            /** @enum {string} */
            query_window_status: "open" | "expired";
            /** @description Negative once the window closed. Measured at ingest, not at read time, so it is reproducible. */
            days_remaining_at_ingest: number;
            /** @description IG v5.0 §10.13 obligations Nebras owes on an open query. */
            response_clocks: {
                first_response_minutes: number;
                final_response_days: number;
                escalation_review_days: number;
            };
            matched_line_count: number;
            break_count: number;
            expected_total_net: components["schemas"]["Money"];
            /** @description What the provider claims for THIS period. Off-period documents are excluded — they carry their own period_variance break — so this is not the sum of the documents' own totals whenever one is present. */
            actual_total_net: components["schemas"]["Money"];
            /** @description Signed, so opposing errors net. The headline exposure. */
            net_variance: components["schemas"]["Money"];
            /** @description Absolute, so opposing errors do NOT net away. The amount actually in dispute. */
            gross_variance: components["schemas"]["Money"];
            /** @description IG §10.17 penalties matched to a recorded late payment for this period. */
            penalty_lines_accepted: number;
            breaks: components["schemas"]["TppCostDiffLine"][];
        };
        /**
         * @description Coarse lifecycle of an AP dispatch. Mirrors the `dispatch_state` CHECK on `billing_tpp_cost_ap_dispatch` (migration 0039) value for value — the column is in an INSERT-only family with no deletion path, so the two vocabularies cannot be allowed to drift. The P9 port's own finer status (`mandate_active`, `presented`, `collected`) is reported separately as `payable_status`; several of those map onto `dispatched` here, because what this value bounds is "one dispatch per instruction", not the debit's progress.
         * @enum {string}
         */
        TppCostDispatchState: "pending" | "dispatched" | "accepted" | "rejected" | "failed";
        /**
         * @description Derived, never stored. `blocked` = unresolved material payable breaks exist; `open` = clear but not closed; `closed` = a second finance principal approved the close.
         * @enum {string}
         */
        TppCostCloseState: "open" | "blocked" | "closed";
        /** @description One accepted payable, keyed by the reconciliation that established it. `gross_amount` is what the scheme debit collects; `net_amount` is what accrues as cost. Both are Money — integer minor units — even though the ledger stores the finer milli-fils behind the boundary. */
        TppCostPayable: {
            /**
             * Format: uuid
             * @description The reconciliation this payable was established by
             */
            payable_id: string;
            period: string;
            /** @enum {string} */
            cost_recipient_type: "nebras" | "underlying_lfi";
            cost_recipient_id: string;
            /** @description The provider tax invoice the payable was accepted against */
            document_reference: string;
            gross_amount: components["schemas"]["Money"];
            net_amount: components["schemas"]["Money"];
            vat_amount: components["schemas"]["Money"];
            /** @description The four-eyes close that authorises honouring this debit; null until the period closes. */
            approval_request_id: string | null;
            /** @description Latest recorded dispatch state; null when never dispatched. */
            dispatch_state: components["schemas"]["TppCostDispatchState"] | null;
            /** Format: date-time */
            dispatched_at?: string | null;
            /** @description IG §10.16 offset applied where this counterparty also operates as a TPP. */
            netted_against?: components["schemas"]["Money"] | null;
        };
        /** @description One unresolved material payable break holding the period open. */
        TppCostPeriodBlocker: {
            line_ref: string;
            break_type: components["schemas"]["PayableBreakType"];
            /** @enum {string} */
            cost_recipient_type: "nebras" | "underlying_lfi";
            cost_recipient_id: string;
            variance: components["schemas"]["Money"];
            /**
             * Format: uuid
             * @description The E1 break this was escalated as; null means raised but not yet worked.
             */
            reconciliation_break_id: string | null;
        };
        /** @description The payable state of one cost period — close, payables, and blockers — as one read. */
        TppCostPeriod: {
            period: string;
            close_state: components["schemas"]["TppCostCloseState"];
            /** Format: date-time */
            closed_at?: string | null;
            /** @description Principal who requested the close; normalised. */
            initiated_by?: string | null;
            /** @description The second principal who approved it; normalised. */
            approved_by?: string | null;
            approval_request_id?: string | null;
            /** @description Always true. Recorded as data rather than convention so the relationship to the BACKOFFICE-06 monthly sign-off is readable from the row. */
            feeds_monthly_signoff: boolean;
            open_break_count: number;
            blockers: components["schemas"]["TppCostPeriodBlocker"][];
            payables: components["schemas"]["TppCostPayable"][];
        };
        /** @description The outcome of handing one approved payable to P9. `dispatch_ref` is the financial system's own reference, redacted before it is persisted. */
        TppCostPayableDispatch: {
            /** Format: uuid */
            payable_id: string;
            dispatch_ref: string;
            dispatch_state: components["schemas"]["TppCostDispatchState"];
            /**
             * @description The P9 port's own finer status for the debit.
             * @enum {string}
             */
            payable_status: "dispatched" | "mandate_active" | "presented" | "collected" | "rejected";
            /** @description True when the call matched an existing dispatch rather than authorising a new one */
            replayed: boolean;
            approval_request_id: string;
            /** Format: date-time */
            dispatched_at?: string;
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
        /**
         * @description Nebras service-desk case class (BACKOFFICE-79).
         * @enum {string}
         */
        ServiceDeskCaseType: "incident" | "billing_query" | "onboarding" | "general";
        /**
         * @description Interaction-Guide priority; drives the applied SLA.
         * @enum {string}
         */
        ServiceDeskCasePriority: "P1" | "P2" | "P3" | "P4";
        /** @enum {string} */
        ServiceDeskCaseStatus: "open" | "in_progress" | "awaiting_nebras" | "resolved" | "closed";
        ServiceDeskCaseCreate: {
            /** @description Nebras service-desk case reference */
            nebras_case_reference: string;
            case_type: components["schemas"]["ServiceDeskCaseType"];
            priority: components["schemas"]["ServiceDeskCasePriority"];
            /** @description Case summary (no PSU PII) */
            summary: string;
            /**
             * Format: uuid
             * @description Originating reconciliation break
             */
            linked_break_id?: string | null;
            /**
             * Format: uuid
             * @description Originating dispute
             */
            linked_dispute_id?: string | null;
            /**
             * Format: uuid
             * @description Originating risk signal
             */
            linked_signal_id?: string | null;
        };
        ServiceDeskCase: components["schemas"]["ServiceDeskCaseCreate"] & {
            /** Format: uuid */
            id?: string;
            status?: components["schemas"]["ServiceDeskCaseStatus"];
            /**
             * Format: date-time
             * @description Interaction-Guide SLA due time derived from priority
             */
            sla_due_at?: string;
            sla_overdue?: boolean;
            opened_by?: string;
            /** Format: date-time */
            opened_at?: string;
            /** Format: date-time */
            resolved_at?: string | null;
            /** Format: date-time */
            created_at?: string;
        };
        /**
         * @description low = standard protocol/known adapter; medium = config-heavy (e.g. P6 mTLS); scoping = in-house/Other needs sizing
         * @enum {string}
         */
        ReadinessEffortBand: "low" | "medium" | "scoping";
        ReadinessCatalogPortOption: {
            value: string;
            label: string;
            effort_band: components["schemas"]["ReadinessEffortBand"];
        };
        ReadinessCatalogPort: {
            /** @description Port id P1..P9 */
            id: string;
            name: string;
            /** @description What the bank system behind this port does */
            maps_to: string;
            /** @description True for ports a bank may decline (e.g. P8) */
            optional?: boolean;
            options: components["schemas"]["ReadinessCatalogPortOption"][];
        };
        ReadinessCatalogDecision: {
            /** @description Decision id BD-01..BD-16 */
            id: string;
            title: string;
            /** @description The product's pre-set default answer */
            default: string;
            impact: string;
            /** @description Milestone/story this decision blocks if unresolved */
            blocks?: string | null;
        };
        ReadinessCatalog: {
            ports: components["schemas"]["ReadinessCatalogPort"][];
            decisions: components["schemas"]["ReadinessCatalogDecision"][];
        };
        ReadinessAssessmentInput: {
            /** @description Map of port id (P1..P9) to the chosen option value */
            ports: {
                [key: string]: string;
            };
            /** @description Map of decision id (BD-01..BD-16) to the chosen answer; omitted = default */
            decisions?: {
                [key: string]: string;
            };
        };
        ReadinessPortResult: {
            id: string;
            name: string;
            chosen_system: string;
            /**
             * @description sim_ready = built-in / declined (no integration work); enterprise_reference = a reference enterprise adapter ships (ADR 0023/0024), so the remaining work is config + the per-bank production cutover (M6); enterprise_to_write = no reference adapter exists yet (none today)
             * @enum {string}
             */
            adapter_status: "sim_ready" | "enterprise_reference" | "enterprise_to_write";
            /** @description The port-swap acceptance test suite this adapter must pass */
            contract_test_gate: string;
            effort_band: components["schemas"]["ReadinessEffortBand"];
            config_keys: string[];
        };
        ReadinessGovernanceResult: {
            id: string;
            title: string;
            answer: string;
            is_default: boolean;
            blocker?: string | null;
        };
        ReadinessDigest: {
            /** @description Deterministic readiness score */
            score: number;
            verdict: string;
            ports: components["schemas"]["ReadinessPortResult"][];
            governance: components["schemas"]["ReadinessGovernanceResult"][];
            /** @description A pre-populated enterprise Bank Profile skeleton (tfvars-shaped key/value) */
            generated_profile: {
                [key: string]: string;
            };
            /** @description What the product already ships, to frame the remaining work as bounded */
            already_done: {
                sim_adapters_ready?: number;
                ports_total?: number;
                note?: string;
            };
            /** @description Suggested M6 port-swap order with the bank's specifics filled in */
            sequencing: {
                step: number;
                port: string;
                system: string;
                action: string;
            }[];
        };
        ReadinessProfile: {
            /** @description Unguessable share token */
            slug: string;
            name: string;
            /** Format: date-time */
            created_at: string;
            input: components["schemas"]["ReadinessAssessmentInput"];
            digest: components["schemas"]["ReadinessDigest"];
        };
        MaturityMilestone: {
            /** @description Milestone id M0..M6 */
            id: string;
            title: string;
            /** @enum {string} */
            status: "done" | "remaining";
            detail: string;
        };
        MaturityPort: {
            /** @description Port id P1..P9 */
            id: string;
            name: string;
            /**
             * @description Demo-profile adapter — ships today
             * @enum {string}
             */
            sim_status: "ready";
            /**
             * @description Enterprise adapter — 'ready' means a reference adapter ships and swaps via config (ADR 0023/0024); the per-bank production cutover is M6
             * @enum {string}
             */
            enterprise_status: "stub" | "ready";
            /** @description The acceptance suite both adapters must pass */
            contract_test_gate: string;
        };
        MaturitySummary: {
            milestones: components["schemas"]["MaturityMilestone"][];
            ports: components["schemas"]["MaturityPort"][];
            summary: {
                milestones_total: number;
                milestones_done: number;
                ports_total: number;
                sim_adapters_ready: number;
                enterprise_adapters_remaining: number;
                note?: string;
            };
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
        /** @description Registered automation agent */
        Agent: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["AgentRegistration"];
                };
            };
        };
        /** @description Registered automation agents (paginated; cursor in meta.next_cursor) */
        Agents: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Envelope"] & {
                    data?: components["schemas"]["AgentRegistration"][];
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
                    /** @description View-specific widgets. MAY carry an optional `sections` array of typed, named AnalyticsSection panels (UIF-SPEC / ADR 0016): the portal renders each section's `kind` with a bespoke primitive (gauge, contribution bars, KPI strip, status cards, alert, table). Any other keys — and any section whose `kind` the client does not recognise — degrade to the generic labelled grid, so this stays backward-compatible with the previous free-form `data`. */
                    data?: {
                        sections?: components["schemas"]["AnalyticsSection"][];
                    } & {
                        [key: string]: unknown;
                    };
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
        serviceDeskCaseId: string;
        agentId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
