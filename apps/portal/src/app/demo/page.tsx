import Link from 'next/link'
import { OfboMark } from '../../components/ofbo-mark'
import { DemoWalkthrough } from '../../components/demo-walkthrough'

/**
 * PUBLIC guided demo walkthrough — the interactive presenter view of the INC-2026-0042 thread
 * (docs/demo-script.md). No auth, no PII; editorial content + deep links into the consoles. The
 * global DemoPill (root layout) keeps the DEMO banner on screen.
 */
export const dynamic = 'force-dynamic'

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-outline-variant bg-surface-container-lowest px-container-padding">
        <span className="flex items-center gap-2 font-bold text-on-surface">
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-container">
            <OfboMark className="h-5 w-5" />
          </span>
          OFBO · Guided Walkthrough
        </span>
        <nav className="ml-auto flex items-center gap-4 text-sm font-semibold">
          <Link href="/maturity" className="text-secondary hover:underline">
            Product maturity
          </Link>
          <Link href="/readiness" className="text-secondary hover:underline">
            Readiness wizard
          </Link>
          <Link href="/" className="text-secondary hover:underline">
            Sign in
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-container-padding py-8">
        <DemoWalkthrough />
      </main>
    </div>
  )
}
