/**
 * BILL-17 — the write-path result type for the TPP Cost Management console.
 *
 * Its own module so the `'use client'` form islands can import the TYPE without pulling the
 * `'use server'` action module (and, through it, `next/headers`) into a client bundle.
 */
export interface TppCostWriteResult {
  ok: boolean
  error?: string
  remediation?: string | null
  docsUrl?: string | null
  values?: Record<string, string>
}
