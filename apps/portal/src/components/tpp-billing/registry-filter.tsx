/**
 * UIF-08b — the consuming-TPP registry filter (ADR 0016, Stitch 3d6d14a3). A server-rendered
 * GET form that narrows the registry by registration_state + unbilled-traffic; the page forwards
 * these to listCounterparties' CounterpartyQuery and the BFF filters server-side (billing:read).
 * Token-only (no raw hex/px); no client JS.
 */

const STATES = [
  { value: 'unregistered', label: 'Unregistered' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'registered', label: 'Registered' },
  { value: 'suspended', label: 'Suspended' }
] as const

export function RegistryFilter({ registrationState, unbilledOnly }: { registrationState?: string; unbilledOnly?: boolean }) {
  const active = Boolean(registrationState) || Boolean(unbilledOnly)
  return (
    <form
      method="get"
      action="/tpp-billing"
      role="search"
      data-testid="registry-filter"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm"
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
        Registration state
        <select
          name="reg_state"
          defaultValue={registrationState ?? ''}
          className="rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-sm text-on-surface"
        >
          <option value="">All</option>
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 py-2 text-sm text-on-surface">
        <input type="checkbox" name="unbilled" value="1" defaultChecked={unbilledOnly} className="rounded border-outline-variant" />
        Unbilled traffic only
      </label>
      <button type="submit" className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-on-secondary hover:bg-secondary-container">
        Filter
      </button>
      {active ? (
        <a
          href="/tpp-billing"
          className="rounded-lg border border-outline-variant px-4 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-low"
        >
          Clear
        </a>
      ) : null}
    </form>
  )
}
