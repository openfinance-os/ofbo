import type { NebrasEgressPort } from '@ofbo/ports'
import { DemoConsentDirectory, RevocableConsentDirectory, type ConsentDirectory } from '../consents/directory.js'
import { DemoPaymentDirectory, type PaymentSource } from '../disputes/payments.js'
import type { HighClassAuditEvent, HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-59 — Training environment for Customer Care.
 *
 * Modelled as a SEPARATE app composition (an environment, not a per-request flag): the
 * training app shares no sinks with production, so a trainee's action can NEVER reach the
 * production audit trail or move a real consent. Three isolations:
 *   1. a distinct synthetic-PSU dataset (separate seed → mirrors production's shape, different
 *      records) so a trainee can never act on a real operator's PSU;
 *   2. a TrainingHighClassAuditSink that is structurally separate from audit_high_sensitivity
 *      and is never the production emitter (the load-bearing acceptance criterion);
 *   3. a sandbox Nebras egress so a practised revoke/dispute is acknowledged locally and never
 *      propagates to the real scheme.
 * Synthetic data only — zero PII, the same hard stop as the demo profile.
 */

/** A distinct seed so the training dataset mirrors production's shape but is a SEPARATE set. */
export const TRAINING_DATASET_SEED = 590000 // BACKOFFICE-59

/** The header that marks a training response so the portal renders a persistent TRAINING banner. */
export const TRAINING_ENV_HEADER = 'x-ofbo-environment'
export const TRAINING_ENV_VALUE = 'training'

// Built once per isolate (deterministic), wrapped per-app in a RevocableConsentDirectory so a
// training revoke reflects on re-lookup within the running process without mutating the seed.
let trainingConsentSeed: ConsentDirectory | undefined
export function sharedTrainingConsentSeed(): ConsentDirectory {
  return (trainingConsentSeed ??= new DemoConsentDirectory(TRAINING_DATASET_SEED))
}
export function trainingConsentDirectory(): ConsentDirectory {
  return new RevocableConsentDirectory(sharedTrainingConsentSeed())
}

let trainingPaymentDirectory: PaymentSource | undefined
export function trainingPaymentSource(): PaymentSource {
  return (trainingPaymentDirectory ??= new DemoPaymentDirectory(TRAINING_DATASET_SEED))
}

/**
 * Training High-class audit sink — structurally separate from the production
 * audit_high_sensitivity writer. Stamps every event training:true and keeps it in a
 * training-only store. A training action therefore can never land in the production audit
 * trail / compliance reporting (BACKOFFICE-59). At M6 the worker wires a dedicated
 * training_audit table here; the production emitter is NEVER passed to a training app.
 */
export class TrainingHighClassAuditSink implements HighClassAuditSink {
  readonly events: HighClassAuditEvent[] = []
  async emit(event: HighClassAuditEvent): Promise<void> {
    this.events.push({ ...event, training: true })
  }
}

/**
 * Sandbox Nebras egress for training — a practised revoke / dispute / refund is acknowledged
 * LOCALLY and never propagates to the real Hub (or even the demo Nebras sim). Deterministic
 * acks keep the drill repeatable. Only the three Customer-Care-relevant methods are needed
 * (the BFF consumes exactly these from the egress port).
 */
export function sandboxTrainingEgress(): Pick<NebrasEgressPort, 'revokeConsent' | 'createDisputeCase' | 'dispatchRefund'> {
  return {
    async revokeConsent() {
      return { acknowledged_in_ms: 0 }
    },
    async createDisputeCase() {
      return { nebras_case_id: 'training-sandbox-case' }
    },
    async dispatchRefund() {
      return { ipp_status: 'ACSP' }
    }
  }
}
