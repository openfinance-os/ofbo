/**
 * UX-07 — explicit scope-denied surface. Out-of-scope deep links / bookmarks used to
 * redirect('/dashboard') with no explanation — disorienting, and not auditable for a
 * portal whose §2 scope matrix is load-bearing. Enforcement is unchanged (nav hides the
 * module + the page still gates); this only makes the denial legible: it names the persona
 * and the missing scope. Token-only.
 */
export function AccessDenied({ persona, moduleName, requiredScope }: { persona: string; moduleName: string; requiredScope: string }) {
  return (
    <section aria-labelledby="access-denied-heading" data-testid="access-denied" className="max-w-xl bg-surface-container-lowest border border-outline-variant border-l-4 border-l-breach rounded-xl shadow-sm p-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-symbols text-breach text-2xl" aria-hidden>
          lock
        </span>
        <h1 id="access-denied-heading" className="text-xl font-semibold">
          Access denied
        </h1>
      </div>
      <p className="text-sm text-on-surface-variant">
        Your persona <span className="font-mono text-primary" data-testid="denied-persona">{persona}</span> does not hold the{' '}
        <span className="font-mono text-primary" data-testid="denied-scope">{requiredScope}</span> scope required for{' '}
        <span className="font-semibold text-primary" data-testid="denied-module">{moduleName}</span>.
      </p>
      <p className="text-xs text-on-surface-variant">
        Scope hygiene is enforced (PRD §2 persona matrix). If you need this access, request the scope through your administrator.
      </p>
      <a href="/dashboard" className="inline-block text-sm font-semibold text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        ← Back to dashboard
      </a>
    </section>
  )
}
