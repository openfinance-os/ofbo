/**
 * OFBO brand mark — a layered "ledger" glyph: two stacked record cards (depth = the
 * back office sitting behind the front line) with ledger lines on the face (the books
 * being kept + reconciled). Token-driven fills only (fill-white / fill-nav / fill-nav-active)
 * so it inherits the design system and never hardcodes a colour. Scales from the 24px
 * collapsed-rail tile up to the sign-in hero.
 */
export function OfboMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* back card — the office behind the counter */}
      <rect x="9" y="4" width="11" height="11" rx="2.5" className="fill-nav-active" />
      {/* front card — the open ledger */}
      <rect x="4" y="9" width="12" height="11" rx="2.5" className="fill-white" />
      {/* ledger lines on the open book */}
      <rect x="6.4" y="12" width="7.2" height="1.5" rx="0.75" className="fill-nav" />
      <rect x="6.4" y="15.2" width="4.6" height="1.5" rx="0.75" className="fill-nav" />
    </svg>
  )
}
