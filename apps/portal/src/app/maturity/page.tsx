import Link from 'next/link'
import { OfboMark } from '../../components/ofbo-mark'
import { MaturityView } from '../../components/readiness/maturity-view'
import { getMaturity, type MaturitySummary } from '../../lib/readiness'

/**
 * PUBLIC, pre-login product-maturity dashboard (ADR 0022). The companion to /readiness: the wizard
 * shows how close a given bank is; this shows how complete the product is. No auth, no PII; the
 * global DemoPill (root layout) keeps the DEMO banner on screen.
 */
export const dynamic = 'force-dynamic'

export default async function MaturityPage() {
  let maturity: MaturitySummary | null = null
  let error: string | null = null
  try {
    maturity = await getMaturity()
  } catch {
    error = 'The maturity service is temporarily unavailable. Please try again shortly.'
  }

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-outline-variant bg-surface-container-lowest px-container-padding">
        <span className="flex items-center gap-2 font-bold text-on-surface">
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-container">
            <OfboMark className="h-5 w-5" />
          </span>
          OFBO · Product Maturity
        </span>
        <nav className="ml-auto flex items-center gap-4 text-sm font-semibold">
          <Link href="/readiness" className="text-secondary hover:underline">
            Check your bank’s readiness →
          </Link>
          <Link href="/" className="text-secondary hover:underline">
            Sign in
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-container-padding py-8">
        {error || !maturity ? (
          <p className="rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm text-on-surface" data-testid="maturity-error">
            {error ?? 'Maturity summary unavailable.'}
          </p>
        ) : (
          <MaturityView maturity={maturity} />
        )}
      </main>
    </div>
  )
}
