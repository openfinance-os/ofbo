import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DemoPill } from '../components/demo-banner'
import { ClearStatusParam } from '../components/ui'
import './globals.css'

export const metadata: Metadata = {
  title: 'OFBO — Internal Portal (DEMO)',
  description: 'Open Finance Back Office internal portal — demo profile, synthetic data only.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Stitch design-system fonts: Inter (UI), JetBrains Mono (ids/amounts),
            Material Symbols Outlined (icons). Without these the `font-symbols`
            nav/icon glyphs fall back to raw ligature text. Mirrors the Stitch screens. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet" />
      </head>
      <body>
        <DemoPill />
        <ClearStatusParam />
        {children}
      </body>
    </html>
  )
}
