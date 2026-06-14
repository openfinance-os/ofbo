import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DemoBanner } from '../components/demo-banner'
import './globals.css'

export const metadata: Metadata = {
  title: 'OFBO — Internal Portal (DEMO)',
  description: 'Open Finance Back Office internal portal — demo profile, synthetic data only.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DemoBanner />
        <main className="portal-main">{children}</main>
      </body>
    </html>
  )
}
