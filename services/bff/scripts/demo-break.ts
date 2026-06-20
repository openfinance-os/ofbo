import {
  PgAuditEmitter,
  PgLineageEmitter,
  PgReconciliationBreakStore,
  PgReconciliationLogStore
} from '@ofbo/db'
import { getAdapter } from '@ofbo/ports'
import { ReconciliationService } from '../src/reconciliation/service.js'

/**
 * Demo helper: trigger a LIVE reconciliation run with an injected fee variance so a fresh
 * flagged break appears in the portal Break Queue on stage — the cause-and-effect moment
 * the Nebras `/admin/faults` path can't show (that feeds ingestion, not the recon engine).
 *
 * Runs the real three-way engine via runDaily(simConfig) against the demo DB — same code the
 * scheduled job runs, just with a variance and a unique run id per invocation so each demo
 * produces a NEW break (not an idempotent no-op). Synthetic + non-prod. NOT wired into deploy.
 *
 *   pnpm demo:break [variance_fils] [variance_lines]    # defaults: 999 fils across 2 lines
 */
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const tenancy = {
  bankId: process.env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
  channel: 'internal_retail'
}
const variancePerLine = Number(process.argv[2] ?? 999)
const feeVarianceLines = Number(process.argv[3] ?? 2)
const trace = crypto.randomUUID()
// unique run id per invocation → a genuinely new run + breaks each time (live demo, not a replay no-op)
const runId = `demo-break-${Date.now()}`

const lineage = new PgLineageEmitter(url, tenancy)
const audit = new PgAuditEmitter(url, tenancy, lineage)
const store = new PgReconciliationLogStore(url, tenancy, lineage)
const breakStore = new PgReconciliationBreakStore(url, tenancy, lineage)
const itsm = getAdapter('p3-itsm', 'demo')
const apm = getAdapter('p5-apm', 'demo')

const service = new ReconciliationService({ store, breakStore, itsm, apm, audit })

const result = await service.runDaily(trace, {
  runType: 'on_demand',
  runId,
  // a small matched set + the injected variance lines → mostly-matched run with N flagged breaks
  simConfig: { matchedLines: 40, feeVarianceLines, missingNebrasLines: 0, failedCalls: 0, disputedLines: 0, variancePerLine }
})

console.log(
  `Live reconciliation run ${runId}: ${result.run.line_count_total} lines, ` +
    `${result.run.line_count_unmatched} unmatched → ${feeVarianceLines} new flagged break(s) of +${variancePerLine} fils each.`
)
console.log('→ refresh the Reconciliation Console Break Queue, then claim + resolve one (four-eyes + audit + lineage).')

await Promise.all([store.close(), breakStore.close(), audit.close(), lineage.close()])
