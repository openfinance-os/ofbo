import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DemoPill } from '../components/demo-banner'
import { TrainingPill } from '../components/training-banner'
import { TenantSwitcher } from '../components/tenant-switcher'
import { ClearStatusParam } from '../components/ui'
import { getTenant, isMultiTenantDemo } from '../lib/tenant'
import './globals.css'

export const metadata: Metadata = {
  title: 'OFBO — Internal Portal (DEMO)',
  description: 'Open Finance Back Office internal portal — demo profile, synthetic data only.'
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // HOST-01 scaffold (ADR 0027) — per-tenant brand + banner label, only in the flagged demo.
  const multiTenant = isMultiTenantDemo()
  const tenant = multiTenant ? await getTenant() : undefined
  return (
    <html lang="en" data-tenant={tenant?.slug}>
      <head>
        {/* The Institutional Blue typefaces (ADR 0033 / design/tokens.ts): DM Sans (UI +
            summary figures), Instrument Serif (display titles), JetBrains Mono (ids, exact
            amounts, trace ids), Material Symbols Outlined (icons — without it the
            `font-symbols` glyphs fall back to raw ligature text).

            This list and `fontFamily` in the tokens are ONE decision in two files, and
            nothing in the type system ties them together: the palette change moved the
            tokens to DM Sans while this link still fetched Inter, so every screen rendered
            in the viewer's OS sans and Inter was downloaded for nothing. design-tokens.spec
            now fails when the two drift apart — add a family here whenever you add one
            there, and never the reverse. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Instrument+Serif&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet" />
      </head>
      <body>
        <DemoPill tenantLabel={tenant?.label} />
        <TrainingPill />
        <TenantSwitcher />
        <ClearStatusParam />
        {children}
      </body>
    </html>
  )
}
