import type { MaturitySummary } from '../../lib/readiness'

// Public product-maturity view (ADR 0022). Companion to the wizard: what's built vs. what remains.
// Presentational, token-only, no PII. Server-rendered from /public/readiness/maturity.
export function MaturityView({ maturity }: { maturity: MaturitySummary }) {
  const s = maturity.summary
  return (
    <div className="space-y-6" data-testid="maturity-view">
      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-secondary">Product maturity</p>
        <h1 className="mt-1 text-3xl font-semibold">What’s already built — and what the last mile is</h1>
        <p className="mt-3 max-w-2xl text-on-surface-variant">{s.note}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat value={`${s.milestones_done}/${s.milestones_total}`} label="milestones delivered" tone="reconciled" />
        <Stat value={`${s.sim_adapters_ready}/${s.ports_total}`} label="simulator adapters live" tone="reconciled" />
        <Stat value={`${s.enterprise_adapters_remaining}`} label="enterprise adapters remaining (M6)" tone="break" />
      </div>

      <Card title="Build roadmap (PRD §9)">
        <ol className="divide-y divide-outline-variant/60" data-testid="milestone-list">
          {maturity.milestones.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-4 py-3" data-testid={`milestone-${m.id}`}>
              <span
                className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  m.status === 'done' ? 'bg-reconciled/15 text-reconciled' : 'bg-break/15 text-break'
                }`}
                aria-hidden
              >
                {m.status === 'done' ? '✓' : '…'}
              </span>
              <div>
                <p className="font-semibold">
                  <span className="mr-1.5 font-mono text-xs text-on-surface-variant">{m.id}</span>
                  {m.title}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      m.status === 'done' ? 'bg-reconciled/15 text-reconciled' : 'bg-break/15 text-break'
                    }`}
                  >
                    {m.status === 'done' ? 'delivered' : 'remaining'}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-on-surface-variant">{m.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Port adapters — sim ships today, enterprise is the M6 work">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs uppercase tracking-wide text-on-surface-variant">
                <th className="px-4 py-2">Port</th>
                <th className="px-4 py-2">Demo adapter</th>
                <th className="px-4 py-2">Enterprise adapter</th>
                <th className="px-4 py-2">Contract-test gate</th>
              </tr>
            </thead>
            <tbody>
              {maturity.ports.map((p) => (
                <tr key={p.id} className="border-b border-outline-variant/60" data-testid={`maturity-port-${p.id}`}>
                  <td className="px-4 py-2 font-semibold">
                    <span className="mr-1.5 font-mono text-xs text-on-surface-variant">{p.id}</span>
                    {p.name}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-reconciled/15 px-2 py-0.5 text-xs font-semibold text-reconciled">ready</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-break/15 px-2 py-0.5 text-xs font-semibold text-break">
                      {p.enterprise_status === 'ready' ? 'ready' : 'to write (M6)'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-on-surface-variant">{p.contract_test_gate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Stat({ value, label, tone }: { value: string; label: string; tone: 'reconciled' | 'break' }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className={`text-3xl font-bold ${tone === 'reconciled' ? 'text-reconciled' : 'text-break'}`}>{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">{label}</div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="border-b border-outline-variant px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-primary">{title}</h2>
      </div>
      {children}
    </section>
  )
}
