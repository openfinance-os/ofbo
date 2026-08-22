import {
  RATE_CARD_CHANGE_NOTIFY,
  detectUpstreamChange,
  type RateCard,
  type RateCardDiff
} from '@ofbo/billing'
import type { ItsmPort } from '@ofbo/ports'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../high-class-audit.js'

export const BILLING_RATE_CARD_WATCH_CRON = '0 2 * * 1'
export const BILLING_RATE_CARD_WATCH_PRINCIPAL = 'system:billing-rate-card-watcher'

export interface BillingRateCardWatchSource {
  name: string
  url: string
}

export const BILLING_RATE_CARD_SOURCES: readonly BillingRateCardWatchSource[] = [
  {
    name: 'Commercial and Pricing Model',
    url: 'https://openfinanceuae.atlassian.net/wiki/spaces/OF/pages/124846096/Commercial+and+Pricing+Model'
  },
  {
    name: 'Nebras chargeable endpoints',
    url: 'https://nebras-open-finance.com/pricing/endpoints/'
  },
  {
    name: 'Nebras LFI-published rates',
    url: 'https://nebras-open-finance.com/pricing/lfi-rates/'
  }
] as const

export interface BillingRateCardVersionInput {
  version: string
  effectiveFrom: string
  sourceUrl: string
  configHash: string
  cardConfig: unknown
}

export interface StoredBillingRateCardVersion extends BillingRateCardVersionInput {
  id: string
  createdAt: string
}

export interface BillingSourceSnapshotInput {
  sourceName: string
  sourceUrl: string
  contentHash: string
  contentText: string
  httpStatus: number
  etag: string | null
  lastModified: string | null
  capturedAt: string
}

export interface StoredBillingSourceSnapshot extends BillingSourceSnapshotInput {
  id: string
}

export type BillingReviewAudience = (typeof RATE_CARD_CHANGE_NOTIFY)[number]

export interface BillingRateCardReviewInput {
  sourceName: string
  sourceUrl: string
  previousSnapshotId: string
  currentSnapshotId: string
  previousHash: string
  currentHash: string
  detectedAt: string
  changes: unknown[]
}

export interface StoredBillingRateCardReview extends BillingRateCardReviewInput {
  id: string
  classification: 'High'
  status: 'notification_pending' | 'notified'
  notifyAudiences: BillingReviewAudience[]
  financeTicketId: string | null
  complianceTicketId: string | null
}

export interface BillingRateCardStore {
  ensureRateCardVersion(input: BillingRateCardVersionInput, traceId: string): Promise<StoredBillingRateCardVersion>
  latestSnapshot(sourceUrl: string): Promise<StoredBillingSourceSnapshot | null>
  createSnapshot(input: BillingSourceSnapshotInput, traceId: string): Promise<StoredBillingSourceSnapshot>
  createReview(input: BillingRateCardReviewInput, traceId: string): Promise<{ review: StoredBillingRateCardReview; created: boolean }>
  reviewsAwaitingNotification(): Promise<StoredBillingRateCardReview[]>
  markReviewRecipientNotified(
    reviewId: string,
    audience: BillingReviewAudience,
    ticketId: string,
    traceId: string
  ): Promise<StoredBillingRateCardReview>
}

export class InMemoryBillingRateCardStore implements BillingRateCardStore {
  readonly rateCardVersions: StoredBillingRateCardVersion[] = []
  readonly snapshots: StoredBillingSourceSnapshot[] = []
  readonly reviews: StoredBillingRateCardReview[] = []

  async ensureRateCardVersion(input: BillingRateCardVersionInput): Promise<StoredBillingRateCardVersion> {
    const existing = this.rateCardVersions.find((row) => row.version === input.version)
    if (existing) return structuredClone(existing)
    const row = { ...structuredClone(input), id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    this.rateCardVersions.push(row)
    return structuredClone(row)
  }

  async latestSnapshot(sourceUrl: string): Promise<StoredBillingSourceSnapshot | null> {
    const row = [...this.snapshots].reverse().find((snapshot) => snapshot.sourceUrl === sourceUrl)
    return row ? structuredClone(row) : null
  }

  async createSnapshot(input: BillingSourceSnapshotInput): Promise<StoredBillingSourceSnapshot> {
    const row = { ...input, id: crypto.randomUUID() }
    this.snapshots.push(row)
    return structuredClone(row)
  }

  async createReview(input: BillingRateCardReviewInput): Promise<{ review: StoredBillingRateCardReview; created: boolean }> {
    const existing = this.reviews.find((row) =>
      row.previousSnapshotId === input.previousSnapshotId && row.currentSnapshotId === input.currentSnapshotId
    )
    if (existing) return { review: structuredClone(existing), created: false }
    const review: StoredBillingRateCardReview = {
      ...structuredClone(input),
      id: crypto.randomUUID(),
      classification: 'High',
      status: 'notification_pending',
      notifyAudiences: [...RATE_CARD_CHANGE_NOTIFY],
      financeTicketId: null,
      complianceTicketId: null
    }
    this.reviews.push(review)
    return { review: structuredClone(review), created: true }
  }

  async reviewsAwaitingNotification(): Promise<StoredBillingRateCardReview[]> {
    return this.reviews.filter((review) => review.status === 'notification_pending').map((review) => structuredClone(review))
  }

  async markReviewRecipientNotified(
    reviewId: string,
    audience: BillingReviewAudience,
    ticketId: string
  ): Promise<StoredBillingRateCardReview> {
    const review = this.reviews.find((row) => row.id === reviewId)
    if (!review) throw new Error(`billing rate-card review ${reviewId} does not exist`)
    if (audience === 'Finance') review.financeTicketId = ticketId
    else review.complianceTicketId = ticketId
    if (review.financeTicketId && review.complianceTicketId) review.status = 'notified'
    return structuredClone(review)
  }
}

export interface BillingSourceDocument {
  body: string
  httpStatus: number
  etag: string | null
  lastModified: string | null
}

export interface BillingRateCardSourceFetcher {
  fetchSource(source: BillingRateCardWatchSource): Promise<BillingSourceDocument>
}

const DEFAULT_MAX_SOURCE_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000

export class HttpRateCardSourceFetcher implements BillingRateCardSourceFetcher {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {}

  async fetchSource(source: BillingRateCardWatchSource): Promise<BillingSourceDocument> {
    const response = await this.fetchImpl(source.url, {
      headers: { accept: 'text/html,application/json;q=0.9,text/plain;q=0.8', 'user-agent': 'OFBO-BILL-01-Rate-Card-Watcher/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) throw new Error(`${source.name} returned HTTP ${response.status}`)
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > this.maxSourceBytes) {
      throw new Error(`${source.name} exceeded the ${this.maxSourceBytes}-byte source limit`)
    }
    return {
      body,
      httpStatus: response.status,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    }
  }
}

export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

/** Suppress formatting-only upstream edits while keeping semantically visible text. */
export function normalizeSourceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** A bounded, persisted excerpt around the first/last changed characters. */
export function diffSourceText(before: string, after: string): RateCardDiff[] {
  if (before === after) return []
  let prefix = 0
  const prefixLimit = Math.min(before.length, after.length)
  while (prefix < prefixLimit && before[prefix] === after[prefix]) prefix += 1

  let suffix = 0
  const suffixLimit = Math.min(before.length - prefix, after.length - prefix)
  while (suffix < suffixLimit && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1

  const context = 120
  const beforeEnd = Math.min(before.length, before.length - suffix + context)
  const afterEnd = Math.min(after.length, after.length - suffix + context)
  return [
    {
      path: 'upstream.content',
      before: before.slice(Math.max(0, prefix - context), beforeEnd),
      after: after.slice(Math.max(0, prefix - context), afterEnd)
    },
    { path: 'upstream.contentLength', before: before.length, after: after.length }
  ]
}

export interface BillingRateCardWatcherDeps {
  store: BillingRateCardStore
  audit: HighClassAuditSink
  itsm: Pick<ItsmPort, 'createTicket'>
  fetcher: BillingRateCardSourceFetcher
  sources: readonly BillingRateCardWatchSource[]
  rateCard: RateCard
  now?: () => Date
}

export interface BillingRateCardWatchResult {
  checkedSources: number
  changedSources: number
  failedSources: number
  notificationFailures: number
}

export class BillingRateCardWatcher {
  private readonly now: () => Date

  constructor(private readonly deps: BillingRateCardWatcherDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  private async notifyReview(reviewInput: StoredBillingRateCardReview, traceId: string): Promise<number> {
    let review = reviewInput
    let failures = 0
    const recipients: Array<{ audience: BillingReviewAudience; team: string; ticketId: string | null }> = [
      { audience: 'Finance', team: 'finance', ticketId: review.financeTicketId },
      { audience: 'Compliance', team: 'compliance', ticketId: review.complianceTicketId }
    ]

    for (const recipient of recipients) {
      if (recipient.ticketId) continue
      try {
        const ticket = await this.deps.itsm.createTicket(
          {
            type: 'billing_rate_card_upstream_change',
            severity: 'high',
            team: recipient.team,
            summary: `Review ${review.id}: ${review.sourceName} changed (${review.previousHash.slice(0, 23)} → ${review.currentHash.slice(0, 23)})`
          },
          { trace_id: traceId }
        )
        review = await this.deps.store.markReviewRecipientNotified(review.id, recipient.audience, ticket.ticket_id, traceId)
      } catch (error) {
        failures += 1
        await this.deps.audit.emit({
          event_type: 'billing_rate_card_notification_failed',
          acting_principal: BILLING_RATE_CARD_WATCH_PRINCIPAL,
          acting_persona: 'system',
          scope_used: SYSTEM_ACTOR_SCOPE,
          request_trace_id: traceId,
          request_body: { review_id: review.id, audience: recipient.audience, error: error instanceof Error ? error.message : String(error) },
          response_status: SYSTEM_ACTOR_RESPONSE_STATUS
        })
      }
    }
    return failures
  }

  async run(traceId: string): Promise<BillingRateCardWatchResult> {
    const cardJson = JSON.stringify(this.deps.rateCard)
    await this.deps.store.ensureRateCardVersion(
      {
        version: this.deps.rateCard.version,
        effectiveFrom: this.deps.rateCard.effectiveFrom,
        sourceUrl: this.deps.rateCard.source,
        configHash: await sha256Text(cardJson),
        cardConfig: this.deps.rateCard
      },
      traceId
    )

    let notificationFailures = 0
    for (const pending of await this.deps.store.reviewsAwaitingNotification()) {
      notificationFailures += await this.notifyReview(pending, traceId)
    }

    let checkedSources = 0
    let changedSources = 0
    let failedSources = 0

    for (const source of this.deps.sources) {
      try {
        const document = await this.deps.fetcher.fetchSource(source)
        const capturedAt = this.now().toISOString()
        const contentText = normalizeSourceText(document.body)
        const contentHash = await sha256Text(contentText)
        const previous = await this.deps.store.latestSnapshot(source.url)
        if (previous?.contentHash === contentHash) {
          checkedSources += 1
          continue
        }
        const current = await this.deps.store.createSnapshot(
          {
            sourceName: source.name,
            sourceUrl: source.url,
            contentHash,
            contentText,
            httpStatus: document.httpStatus,
            etag: document.etag,
            lastModified: document.lastModified,
            capturedAt
          },
          traceId
        )
        checkedSources += 1

        if (!previous) continue
        const decision = detectUpstreamChange(
          { sourceUrl: source.url, contentHash: previous.contentHash, capturedAt: previous.capturedAt },
          { sourceUrl: source.url, contentHash: current.contentHash, capturedAt: current.capturedAt }
        )
        if (!decision.changed) continue

        const changes = diffSourceText(previous.contentText, current.contentText)
        const { review, created } = await this.deps.store.createReview(
          {
            sourceName: source.name,
            sourceUrl: source.url,
            previousSnapshotId: previous.id,
            currentSnapshotId: current.id,
            previousHash: previous.contentHash,
            currentHash: current.contentHash,
            detectedAt: capturedAt,
            changes
          },
          traceId
        )
        if (!created) continue
        changedSources += 1

        await this.deps.audit.emit({
          event_type: 'billing_rate_card_upstream_change_detected',
          acting_principal: BILLING_RATE_CARD_WATCH_PRINCIPAL,
          acting_persona: 'system',
          scope_used: SYSTEM_ACTOR_SCOPE,
          request_trace_id: traceId,
          request_body: {
            review_id: review.id,
            source_name: review.sourceName,
            source_url: review.sourceUrl,
            previous_hash: review.previousHash,
            current_hash: review.currentHash,
            classification: review.classification,
            notify: review.notifyAudiences,
            auto_apply: false
          },
          response_status: SYSTEM_ACTOR_RESPONSE_STATUS
        })
        notificationFailures += await this.notifyReview(review, traceId)
      } catch (error) {
        failedSources += 1
        await this.deps.audit.emit({
          event_type: 'billing_rate_card_watch_failed',
          acting_principal: BILLING_RATE_CARD_WATCH_PRINCIPAL,
          acting_persona: 'system',
          scope_used: SYSTEM_ACTOR_SCOPE,
          request_trace_id: traceId,
          request_body: { source_name: source.name, source_url: source.url, error: error instanceof Error ? error.message : String(error) },
          response_status: SYSTEM_ACTOR_RESPONSE_STATUS
        })
      }
    }

    return { checkedSources, changedSources, failedSources, notificationFailures }
  }
}

export interface BillingRateCardScheduledRunDeps {
  databaseUrl: string
  tenancy: { bankId: string; channel: string }
  makeStore: (databaseUrl: string, tenancy: { bankId: string; channel: string }) => BillingRateCardStore & { close(): Promise<void> }
  makeAudit: (databaseUrl: string, tenancy: { bankId: string; channel: string }) => HighClassAuditSink & { close(): Promise<void> }
  itsm: Pick<ItsmPort, 'createTicket'>
  fetcher?: BillingRateCardSourceFetcher
  sources?: readonly BillingRateCardWatchSource[]
  rateCard: RateCard
}

/** Scheduled-entry seam: runs the watcher and always closes DB-backed resources. */
export async function runBillingRateCardWatch(deps: BillingRateCardScheduledRunDeps, traceId: string): Promise<BillingRateCardWatchResult> {
  const store = deps.makeStore(deps.databaseUrl, deps.tenancy)
  const audit = deps.makeAudit(deps.databaseUrl, deps.tenancy)
  try {
    return await new BillingRateCardWatcher({
      store,
      audit,
      itsm: deps.itsm,
      fetcher: deps.fetcher ?? new HttpRateCardSourceFetcher(),
      sources: deps.sources ?? BILLING_RATE_CARD_SOURCES,
      rateCard: deps.rateCard
    }).run(traceId)
  } finally {
    await Promise.allSettled([store.close(), audit.close()])
  }
}
