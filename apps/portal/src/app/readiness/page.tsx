import Link from 'next/link'
import { OfboMark } from '../../components/ofbo-mark'
import { ReadinessWizard } from '../../components/readiness/readiness-wizard'
import { getReadinessCatalog, getReadinessProfile, type ReadinessCatalog, type ReadinessProfile } from '../../lib/readiness'

/**
 * PUBLIC, pre-login Integration Readiness Wizard (ADR 0022). The prospect hook: map your estate to
 * ports P1–P9, confirm BD-01..16, get a readiness digest. NO auth guard, NO token cookie — anyone
 * can reach it. The global DemoPill (root layout) keeps the DEMO banner on screen. Zero PII.
 */
export const dynamic = 'force-dynamic'

export default async function ReadinessPage({
  searchParams
}: {
  searchParams: Promise<{ profile?: string }>
}) {
  const { profile: slug } = await searchParams

  let catalog: ReadinessCatalog | null = null
  let saved: ReadinessProfile | null = null
  let error: string | null = null
  try {
    catalog = await getReadinessCatalog()
    if (slug) saved = await getReadinessProfile(slug).catch(() => null)
  } catch {
    error = 'The readiness service is temporarily unavailable. Please try again shortly.'
  }

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-outline-variant bg-surface-container-lowest px-container-padding">
        <span className="flex items-center gap-2 font-bold text-on-surface">
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-container">
            <OfboMark className="h-5 w-5" />
          </span>
          OFBO · Integration Readiness
        </span>
        <Link href="/" className="ml-auto text-sm font-semibold text-secondary hover:underline">
          Sign in to the portal
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-container-padding py-8">
        {error || !catalog ? (
          <p className="rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm text-on-surface" data-testid="readiness-error">
            {error ?? 'Catalog unavailable.'}
          </p>
        ) : (
          <ReadinessWizard catalog={catalog} initialProfile={saved} />
        )}
      </main>
    </div>
  )
}
