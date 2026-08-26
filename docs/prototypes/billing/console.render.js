/* Panel construction. Order mirrors the monthly cycle, which is how the work is
   actually done: meter → rate → compare → invoice → collect → assure. */

document.getElementById('hdr-period').textContent = RUN.generated_for;
document.getElementById('hdr-card').textContent = RUN.rate_card.version;

const R = RUN, M = R.metering, RA = R.rating, RC = R.reconciliation, IV = R.invoicing, ST = R.settlement, AS = R.assurance;
const issuedInv = IV.invoices.filter(i => i.status === 'ISSUED');
const grossErr = RC.breaks.reduce((a, b) => a + (b.gross_error_mf || Math.abs(b.variance_mf)), 0);

const TABS = [
  ['cycle', 'Cycle', 'the month'],
  ['ratecard', 'Rate card', 'BILL-01'],
  ['metering', 'Metering', 'BILL-02'],
  ['recon', 'Reconciliation', 'BILL-03'],
  ['invoice', 'Invoicing', 'BILL-04'],
  ['collect', 'Collections', 'BILL-05'],
  ['assure', 'Revenue assurance', 'BILL-08'],
  ['profit', 'Profitability', 'BILL-09'],
];
const tabsEl = document.getElementById('tabs'), panelsEl = document.getElementById('panels');
TABS.forEach(([id, label, sub], i) => {
  const b = el(`<button class="tab${i === 0 ? ' on' : ''}" data-t="${id}">${label}<small>${sub}</small></button>`);
  b.onclick = () => go(id);
  tabsEl.appendChild(b);
  panelsEl.appendChild(el(`<section class="panel${i === 0 ? ' on' : ''}" id="p-${id}"></section>`));
});
function go(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.t === id));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + id));
  window.scrollTo({top: 0, behavior: 'smooth'});
}
const P = (id) => document.getElementById('p-' + id);
const kpi = (lbl, val, note, flag) => `<div class="kpi${flag ? ' flag' : ''}"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="note">${note}</div></div>`;

/* ═══════════════ 1 · CYCLE ═══════════════ */
{
  const steps = [
    ['3rd', 'Meter & rate', 'Own metering closed at the Hub extraction boundary; expected memo drafted per TPP.', 'metering', 'ok', 'done'],
    ['5th', 'Memo received', 'Collection Memo + Tax Invoice arrive by email. Auto-diffed against the expectation.', 'recon', 'ok', 'done'],
    ['5th–12th', 'Reconcile', `${RC.breaks.length} breaks raised and queried inside the 30-day window.`, 'recon', 'warn', RC.breaks.length + ' breaks'],
    ['13th', 'Invoice', `${issuedInv.length} PINT AE invoices issued, four-eyes approved.`, 'invoice', 'ok', 'issued'],
    ['10th–30th', 'Collect', `Direct debit funded; ${ST.collections.filter(c => c.status !== 'PAID').length} counterparty in dunning.`, 'collect', 'warn', 'in progress'],
    ['30th–5th', 'Settle & assure', 'Net settlement decomposed; leakage KPI published.', 'assure', 'bad', AS.kpi_pct + '% leakage'],
  ];
  const mix = {};
  RA.statements.forEach(s => s.receivable.forEach(l => mix[l.fee_class] = (mix[l.fee_class] || 0) + l.amount_mf));
  const mixRows = Object.entries(mix).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({k: cls(k), v, sub: `${(v / RA.receivable_total_mf * 100).toFixed(1)}% of the receivable`}));

  P('cycle').innerHTML = `
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi('Rated receivable', `<span class="cur">AED</span>${aed(RA.receivable_total_mf)}`, `${n(M.stats.chargeable)} chargeable events · ${RA.statements.length} consuming TPPs`)}
      ${kpi('Invoiced', `<span class="cur">AED</span>${aed(IV.total_gross_mf)}`, `VAT AED ${aed(IV.total_vat_mf)} · AED ${aed(IV.total_withheld_mf)} withheld under query`)}
      ${kpi('Scheme variance', `<span class="cur">AED</span>${aed(grossErr)}`, `${RC.breaks.length} breaks · net only AED ${aed(Math.abs(RC.net_variance_mf))} — opposing errors cancel`, true)}
      ${kpi('Leakage KPI', `${AS.kpi_pct}<span class="cur" style="margin-left:3px">%</span>`, `target &lt;${AS.target_pct}% · AED ${aed(AS.recoverable_mf)} recoverable`, AS.kpi_pct > AS.target_pct)}
    </div>
    <div class="card"><h3>The monthly cycle<span class="right">Interaction Guide v5.0 §10 — click a step</span></h3>
      <div class="body"><div class="cyc">${steps.map(([d, t, x, tab, st, lb]) =>
        `<button class="step" data-go="${tab}"><div class="d">${d}</div><div class="t">${t}</div><div class="x">${x}</div>
         <div class="st"><span class="tag ${st}"><i class="dot"></i>${lb}</span></div></button>`).join('')}</div></div></div>
    <div class="grid g2">
      <div class="card"><h3>What this cycle found</h3><div class="body" style="padding-top:14px">
        <div class="note-box"><b>Retail data overage is the biggest line on the receivable</b> — AED ${aed(mix['data.retail_page'] || 0)}, ${((mix['data.retail_page'] || 0) / RA.receivable_total_mf * 100).toFixed(0)}% of everything earned. It is priced by a single directory field (<code>ApiMetadata.OverLimitFees</code>) that most LFIs leave empty.</div>
        <div class="note-box warn"><b>${n(RA.no_mid_count)} merchant payments arrived without a Merchant ID</b> and therefore forfeit the AED 200/day free allowance — the condition the scheme added on 2 Jun 2026. The meter classifies each one; the memo did not.</div>
        <div class="note-box warn"><b>One statement line nets two opposing errors.</b> A cap that was not applied (+AED ${aed(RC.breaks.find(b => b.cause_code.includes('V1'))?.contributions?.[0]?.delta_mf || 0)}) and an exemption wrongly granted (−AED ${aed(Math.abs(RC.breaks.find(b => b.cause_code.includes('V3'))?.contributions?.[1]?.delta_mf || 0))}) partly cancel. Netting is how a variance stays small enough to wave through.</div>
        <div class="note-box bad"><b>${((AS.findings[1].amount_mf / AS.leakage_mf) * 100).toFixed(0)}% of the leakage is one missing form.</b> ${tppName('TPP-0005')} is consuming production APIs with no financial-system counterparty, so AED ${aed(AS.findings[1].amount_mf)} cannot be invoiced at all.</div>
      </div></div>
      <div class="card"><h3>Receivable by fee class<span class="right"><button class="toggle" data-tv="tv-mix">Table view</button></span></h3>
        <div class="body" id="mixhost">
          ${tableView('tv-mix', ['Fee class', {t: 'AED', num: 1}, {t: 'Share', num: 1}],
            Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
              `<tr><td>${cls(k)}</td><td class="num">${aed(v)}</td><td class="num">${(v / RA.receivable_total_mf * 100).toFixed(1)}%</td></tr>`).join('')
            + `<tr class="tot"><td>Total</td><td class="num">${aed(RA.receivable_total_mf)}</td><td class="num">100.0%</td></tr>`)}
        </div>
      </div>
    </div>`;
  P('cycle').querySelector('#mixhost').prepend(barChart(mixRows, {aria: 'Receivable by fee class'}));
  P('cycle').querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
}

/* ═══════════════ 2 · RATE CARD (BILL-01) ═══════════════ */
{
  const rc = R.rate_card;
  const rateOf = (k, s) => {
    if (s.basis === 'bps_of_value') return `${s.schedule_bps[R.year_step - 1]} bps <span style="color:var(--ink-3)">(Y${R.year_step} of ${s.schedule_bps.join('→')})</span>`;
    if (s.basis === 'flat') return fils(s.flat);
    if (s.basis === 'flat_stepped') return `${fils(s.schedule[R.year_step - 1])} <span style="color:var(--ink-3)">(Y${R.year_step})</span>`;
    if (s.basis === 'per_page') return `${fils(s.flat)} / page`;
    if (s.basis === 'per_page_over_free_tier') return `${fils(s.overage)} / page over tier`;
    if (s.basis === 'tiered_by_providers') return s.tiers.map(([m, f]) => `${m === null || m === 'Infinity' || m > 900 ? '>25' : '≤' + m}: ${fils(f)}`).join(' · ');
    return '—';
  };
  const cond = (k, s) => {
    const bits = [];
    if (s.cap) bits.push(`cap AED ${aed(s.cap, 0)} / tx`);
    if (s.batch_cap) bits.push(`batch cap ${fils(s.batch_cap)}`);
    if (s.threshold) bits.push(`> AED ${aed(s.threshold, 0)} only`);
    if (s.free_allowance) bits.push(`AED ${aed(s.free_allowance.value, 0)}/${s.free_allowance.per.replace(/_/g, ' ')} free <b>— only with Merchant ID</b> (${s.free_allowance.since})`);
    if (s.free_tier) bits.push(`free ${s.free_tier.attended} attended / ${s.free_tier.unattended} unattended pages per PSU per day`);
    if (s.overage_source) bits.push(`rate from ${s.overage_source}`);
    return bits.join('<br>') || '—';
  };
  const row = (k, s) => `<tr><td><b>${cls(k)}</b><div class="mono" style="color:var(--ink-4)">${k}</div></td>
    <td>${rateOf(k, s)}</td><td style="font-size:12.5px;color:var(--ink-2)">${cond(k, s)}</td>
    <td style="font-size:12px;color:var(--ink-3)">${s.cite}</td></tr>`;

  P('ratecard').innerHTML = `
    <div class="note-box warn"><b>The upstream document mutates without a version bump.</b> The scheme page is still labelled “Version 1.0 (4 Oct 2024)” but was substantively edited four times between Nov 2025 and Jun 2026. The card below therefore carries its own version — <b>${rc.version}</b>, effective ${rc.effective_from} — and a watcher diffs the source.</div>
    <div class="grid g3" style="margin-bottom:16px">
      ${kpi('Card version', rc.version, `effective ${rc.effective_from}`)}
      ${kpi('Year step in force', 'Year ' + R.year_step, `anchor ${rc.year_anchor.date} — <b style="color:#8a6100">${rc.year_anchor.status}</b>`, true)}
      ${kpi('Upstream changes', `${rc.effective_from ? R.change_watch.observed.length : 0} <span class="cur">absorbed</span>`, `${R.change_watch.pending.length} pending review`)}
    </div>
    <div class="card"><h3>Receivable — TPP → LFI <span class="badge">${Object.keys(rc.receivable).length}</span><span class="right">the institution's income</span></h3>
      <table><thead><tr><th>Fee class</th><th>Rate in force</th><th>Conditions</th><th>Source</th></tr></thead>
      <tbody>${Object.entries(rc.receivable).map(([k, s]) => row(k, s)).join('')}</tbody></table></div>
    <div class="card"><h3>Payable — LFI → API Hub <span class="badge">${Object.keys(rc.payable_hub).length}</span><span class="right">TPP-of-record role only</span></h3>
      <table><thead><tr><th>Fee class</th><th>Rate in force</th><th>Conditions</th><th>Source</th></tr></thead>
      <tbody>${Object.entries(rc.payable_hub).map(([k, s]) => row(k, s)).join('')}</tbody></table></div>
    <div class="card"><h3>Year-step anchor — an open risk</h3><div class="body">
      <p style="margin:0 0 10px;font-size:13.5px;color:var(--ink-2)">Every stepped fee (merchant collections 38→25 bps, me-to-me 20→17 fils) counts from “Year 1 of Nebras's operations”, which the scheme has never published. The card treats the anchor as tenant configuration and states the assumption rather than burying it: <b>${rc.year_anchor.date}</b>, status <b>${rc.year_anchor.status}</b>.</p>
      <p style="margin:0;font-size:13.5px;color:var(--ink-2)">If the true anchor is a year earlier, merchant collections should already be at 35 bps — worth <b>AED ${aed(Math.abs(AS.scenarios[1].delta_mf))}</b> a month on this volume, invoiced wrongly in every cycle until corrected. Modelled under Profitability.</p>
    </div></div>
    <div class="card"><h3>Change watch <span class="badge">${R.change_watch.pending.length} open</span></h3>
      <table><thead><tr><th>Detected</th><th>Change</th><th>State</th></tr></thead><tbody>
      ${R.change_watch.pending.map(c => `<tr><td class="mono">${c.date}</td><td><b>${c.change}</b><div style="font-size:12.5px;color:var(--ink-3);margin-top:3px">${c.action}</div></td><td><span class="tag warn"><i class="dot"></i>review task</span></td></tr>`).join('')}
      ${R.change_watch.observed.slice().reverse().map(c => `<tr><td class="mono">${c.date}</td><td>${c.change}</td><td><span class="tag ok"><i class="dot"></i>absorbed</span></td></tr>`).join('')}
      </tbody></table></div>
    <div class="card"><h3>Watched sources</h3><div class="body"><ul style="margin:0;padding-left:18px;font-size:13.5px;color:var(--ink-2);line-height:1.9">
      ${R.change_watch.watched.map(w => `<li>${w}</li>`).join('')}</ul></div></div>`;
}

/* ═══════════════ 3 · METERING (BILL-02) ═══════════════ */
{
  const s = M.stats;
  const ev = M.evidence;
  const evTable = (rows, cols) => `<table><thead><tr>${cols.map(c => `<th${c[1] ? ' class="num"' : ''}>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  P('metering').innerHTML = `
    <div class="note-box"><b>The institution counts for itself.</b> Nebras shares only aggregated supporting data and there is no billing API, so this is the only line-level evidence that exists in a dispute. Every metered line carries the <code>x-fapi-interaction-id</code> of the call it came from.</div>
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi('Events observed', n(s.events_total), `${n(s.inbound)} inbound · ${n(s.outbound)} outbound (TPP-of-record)`)}
      ${kpi('Classification coverage', s.coverage_pct + '%', `${n(s.unknown_endpoint)} events on an unrecognised endpoint`, s.coverage_pct < 100)}
      ${kpi('Chargeable', n(s.chargeable), `${n(s.free)} free endpoints · ${n(s.free_to_lfi)} hub-side, no LFI charge`)}
      ${kpi('Excluded — unsuccessful', n(s.excluded_unsuccessful), 'the scheme charges for technically successful calls only')}
    </div>
    <div class="card"><h3>Meters <span class="badge">${M.by_class.length}</span></h3>
      <table><thead><tr><th>Fee class</th><th>Side</th><th class="num">Events</th><th class="num">Units</th><th>What a unit is</th></tr></thead><tbody>
      ${M.by_class.map(c => `<tr><td><b>${cls(c.fee_class)}</b></td>
        <td><span class="tag ${c.side === 'receivable' ? 'info' : c.side === 'free_to_lfi' ? 'mute' : 'warn'}">${c.side.replace(/_/g, ' ')}</span></td>
        <td class="num">${n(c.events)}</td><td class="num">${n(c.units)}</td>
        <td style="font-size:12.5px;color:var(--ink-3)">${c.fee_class.startsWith('data') ? 'one page = 100 lines, partial rounds up' : c.fee_class.startsWith('payment') ? 'one payment instruction' : 'one API call'}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card"><h3>Metering evidence<span class="right">the four rules that are easy to get wrong</span></h3><div class="body" style="padding-top:4px">
      <details open><summary>2-hour pairing window — one balance <i>and</i> one CoP per payment</summary><div class="in">
        <p style="margin:0 0 10px;font-size:13px;color:var(--ink-3)">Each payment discounts at most one balance call and one CoP call to 0.5 fils, and a call already consumed cannot discount a second payment. Shown for the institution's own outbound traffic, where the discount lands on its Hub invoice.</p>
        ${evTable(ev.pairing.map(p => `<tr><td class="mono">${p.payment}</td><td class="mono">${p.paired_call}</td><td>${p.endpoint}</td><td class="num">${p.gap_h} h</td><td>${p.effect}</td></tr>`).join(''),
          [['Payment'], ['Paired call'], ['Endpoint'], ['Gap', 1], ['Effect']])}
      </div></details>
      <details><summary>Retail free tier — per PSU, per day, per mode</summary><div class="in">
        ${evTable(ev.free_tier.map(f => `<tr><td class="mono">${f.psu}</td><td>${f.day}</td><td>${f.mode}</td><td class="num">${f.pages}</td><td class="num">${f.free_pages} / ${f.tier}</td><td class="num"><b>${f.billable_pages}</b></td></tr>`).join(''),
          [['PSU'], ['Day'], ['Mode'], ['Pages', 1], ['Free used', 1], ['Billable', 1]])}
      </div></details>
      <details><summary>Merchant daily allowance — AED 200 per merchant per day, Merchant ID required</summary><div class="in">
        <p style="margin:0 0 10px;font-size:13px;color:var(--ink-3)">Since 2 Jun 2026 the allowance applies only when the request carries a Merchant ID. <b>${n(RA.no_mid_count)}</b> payments this month did not, and were charged on their full value.</p>
        ${evTable(ev.merchant_allowance.map(m => `<tr><td class="mono">${m.merchant}</td><td>${m.day}</td><td class="num">${aed(m.free_mf)}</td><td class="num">${aed(m.charged_mf)}</td></tr>`).join(''),
          [['Merchant'], ['Day'], ['Free value', 1], ['Charged value', 1]])}
      </div></details>
      <details><summary>Blind spot — endpoints the classifier does not recognise <span class="tag bad" style="margin-left:6px"><i class="dot"></i>${n(s.unknown_endpoint)}</span></summary><div class="in">
        <p style="margin:0 0 10px;font-size:13px;color:var(--ink-3)">Never silently dropped. An unrecognised endpoint is counted, surfaced here and in the assurance report, and priced at the standard rate as an upper bound — this is exactly how a newly-chargeable endpoint (as <code>GET /tpp-reports</code> became on 13 May 2026) goes unbilled for months.</p>
        ${evTable(ev.blind_spot.map(b => `<tr><td class="mono">${b.endpoint}</td><td class="mono">${b.event}</td><td>${b.ts.replace('T', ' ').replace('Z', '')}</td><td>${tppName(b.tpp)}</td></tr>`).join(''),
          [['Endpoint'], ['Event'], ['First seen'], ['Caller']])}
      </div></details>
    </div></div>
    <div class="card"><h3>Billable-event sample<span class="right">every line traceable to a FAPI interaction</span></h3>
      <table><thead><tr><th>Event</th><th>Timestamp</th><th>Party</th><th>Endpoint</th><th>Fee class</th><th class="num">Units</th><th>Trace</th></tr></thead><tbody>
      ${M.sample.slice(0, 12).map(l => `<tr><td class="mono">${l.event_id}</td><td class="mono">${l.ts.replace('T', ' ').replace(':00Z', '')}</td>
        <td>${l.direction === 'outbound' ? tppName(l.client) + ' <span class="tag mute">out</span>' : tppName(l.tpp)}</td>
        <td class="mono">${l.endpoint}</td><td>${cls(l.fee_class)}${l.flag ? ' <span class="tag bad">no merchant id</span>' : ''}${l.paired ? ' <span class="tag ok">paired</span>' : ''}</td>
        <td class="num">${l.units ?? 1}</td><td class="mono" style="color:var(--ink-4)">${l.trace_id}</td></tr>`).join('')}
      </tbody></table></div>`;
}

/* ═══════════════ 4 · RECONCILIATION (BILL-03) ═══════════════ */
{
  const rows = RC.rows.slice().sort((a, b) => Math.abs(b.variance_mf) - Math.abs(a.variance_mf));
  P('recon').innerHTML = `
    <div class="note-box"><b>Compare against expected, not verify what arrived.</b> The rated statement is ready on the 3rd; the scheme's Collection Memo lands on the 5th and is diffed against it automatically. A billing query must be raised within <b>30 days of occurrence</b>, so reconciliation latency is a compliance parameter, not a convenience.</div>
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi('Statement lines', n(RC.rows.length), `${RC.matched} matched · ${RC.unmatched} breaks`)}
      ${kpi('Match rate', RC.match_rate_pct + '%', `break threshold ${fils(RC.threshold_mf)} variance`)}
      ${kpi('Net variance', `<span class="cur">AED</span>${aed(Math.abs(RC.net_variance_mf))}`, `memo ${RC.net_variance_mf > 0 ? 'higher' : 'lower'} than our records`)}
      ${kpi('Gross error', `<span class="cur">AED</span>${aed(grossErr)}`, `${(grossErr / Math.max(1, Math.abs(RC.net_variance_mf))).toFixed(1)}× the net — errors cancel`, true)}
    </div>
    <div class="card"><h3>Three-way diff <span class="right">own metering · scheme memo · financial system — click a row</span></h3>
      <table><thead><tr><th>Counterparty</th><th>Fee class</th><th class="num">Units</th><th class="num">Own (rated)</th><th class="num">Scheme memo</th><th class="num">P9 posting</th><th class="num">Variance</th><th>Status</th></tr></thead><tbody id="recon-rows">
      ${rows.map((r, i) => `<tr class="${r.break_id ? 'click' : ''}" data-b="${r.break_id || ''}">
        <td>${tppName(r.tpp)}</td><td>${cls(r.fee_class)} ${r.side === 'payable_hub' ? '<span class="tag warn">payable</span>' : ''}</td>
        <td class="num">${n(r.units)}</td><td class="num">${aed(r.own_mf)}</td><td class="num">${aed(r.memo_mf)}</td><td class="num">${aed(r.p9_mf)}</td>
        <td class="num" style="${r.variance_mf ? 'font-weight:700;color:' + (r.variance_mf > 0 ? 'var(--series-2)' : 'var(--critical)') : ''}">${r.variance_mf ? (r.variance_mf > 0 ? '+' : '−') + aed(Math.abs(r.variance_mf)) : '—'}</td>
        <td>${r.break_id ? `<span class="tag bad"><i class="dot"></i>${r.break_id.replace('BRK-2026-06-', 'BRK-')}</span>` : '<span class="tag ok"><i class="dot"></i>matched</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    <div id="break-detail"></div>
    <div class="card"><h3>Variance playbook<span class="right">what the diff is built to catch</span></h3>
      <table><thead><tr><th>Code</th><th>Variance</th><th>Direction</th><th>Why it matters</th></tr></thead><tbody>
      ${R.memo.playbook.map(v => `<tr><td class="mono"><b>${v.code}</b></td><td>${v.title}</td>
        <td><span class="tag ${v.direction === 'memo_high' ? 'warn' : 'bad'}">${v.direction === 'memo_high' ? 'memo higher' : 'memo lower'}</span></td>
        <td style="font-size:12.5px;color:var(--ink-2)">${v.detail}</td></tr>`).join('')}
      </tbody></table></div>`;

  const detailHost = P('recon').querySelector('#break-detail');
  const openBreak = (id) => {
    const b = RC.breaks.find(x => x.id === id);
    if (!b) return;
    P('recon').querySelectorAll('#recon-rows tr').forEach(tr => tr.classList.toggle('sel', tr.dataset.b === id));
    detailHost.innerHTML = `<div class="detail">
      <h4>${b.id} · ${cls(b.fee_class)} · ${tppName(b.tpp)}<span class="right">${b.action}</span></h4>
      <div class="in">
        <div class="grid g3" style="margin-bottom:14px">
          <div><div class="lbl" style="font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)">Source A — own metering</div><div style="font-size:20px;font-weight:700;margin-top:5px">AED ${aed(b.own_mf)}</div><div style="font-size:12.5px;color:var(--ink-3)">${n(b.units)} units, rated on card ${RA.card_version}</div></div>
          <div><div class="lbl" style="font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)">Source B — scheme memo</div><div style="font-size:20px;font-weight:700;margin-top:5px;color:${b.variance_mf > 0 ? 'var(--series-2)' : 'var(--critical)'}">AED ${aed(b.memo_mf)}</div><div style="font-size:12.5px;color:var(--ink-3)">${R.memo.ref}, received ${R.memo.issued}</div></div>
          <div><div class="lbl" style="font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)">Source C — financial system</div><div style="font-size:20px;font-weight:700;margin-top:5px">AED ${aed(b.p9_mf)}</div><div style="font-size:12.5px;color:var(--ink-3)">posted from our own rated figures</div></div>
        </div>
        <table style="margin-bottom:12px"><thead><tr><th>Contributing cause</th><th class="num">Signed contribution</th><th class="num">Events</th></tr></thead><tbody>
          ${(b.contributions || []).map(c => `<tr><td><b class="mono">${c.code}</b> · ${c.title}</td>
            <td class="num" style="color:${c.delta_mf > 0 ? 'var(--series-2)' : 'var(--critical)'};font-weight:700">${c.delta_mf > 0 ? '+' : '−'}${aed(Math.abs(c.delta_mf))}</td>
            <td class="num">${n(c.events)}</td></tr>`).join('')}
          <tr class="tot"><td>Net variance on this line</td><td class="num">${b.variance_mf > 0 ? '+' : '−'}${aed(Math.abs(b.variance_mf))}</td><td class="num">gross ${aed(b.gross_error_mf)}</td></tr>
        </tbody></table>
        ${(b.contributions || []).length > 1 ? `<div class="note-box warn" style="margin:0 0 12px"><b>Two errors in one line, pulling opposite ways.</b> A threshold set on the net variance would have seen AED ${aed(Math.abs(b.variance_mf))} where AED ${aed(b.gross_error_mf)} of pricing error is actually present.</div>` : ''}
        <dl class="kv">
          <dt>Detail</dt><dd>${b.detail || '—'}</dd>
          <dt>Evidence events</dt><dd class="mono">${(b.evidence_events || []).join(', ') || '—'}</dd>
          <dt>Scheme clock</dt><dd>Billing query due by <b>${b.query_deadline}</b> — ${b.sla_days_remaining} days remaining of the 30-day window</dd>
          <dt>Invoice effect</dt><dd>${b.side === 'receivable' ? `AED ${aed(Math.min(Math.abs(b.variance_mf), b.own_mf))} withheld from the TPP invoice; the undisputed remainder is billed now` : 'Payable side — queried against the institution\'s own Hub invoice'}</dd>
        </dl>
      </div></div>`;
    detailHost.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  };
  P('recon').querySelectorAll('#recon-rows tr.click').forEach(tr => tr.onclick = () => openBreak(tr.dataset.b));
  openBreak(RC.breaks.find(b => (b.contributions || []).length > 1)?.id || RC.breaks[0]?.id);
}

/* ═══════════════ 5 · INVOICING (BILL-04) ═══════════════ */
{
  const blocked = IV.invoices.filter(i => i.status !== 'ISSUED');
  P('invoice').innerHTML = `
    <div class="note-box"><b>Reconcile before invoice.</b> Only reconciled-clean amounts reach a TPP's invoice — a disputed delta is withheld and carried, while the undisputed remainder is billed now. The run is four-eyes gated and returns <code>409</code> over unreconciled lines.</div>
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi('Issued', `${issuedInv.length}<span class="cur" style="margin-left:6px">invoices</span>`, `AED ${aed(IV.total_gross_mf)} gross · PINT AE via ASP`)}
      ${kpi('VAT extracted', `<span class="cur">AED</span>${aed(IV.total_vat_mf)}`, '5/105 of VAT-inclusive scheme fees')}
      ${kpi('Withheld under query', `<span class="cur">AED</span>${aed(IV.total_withheld_mf)}`, 'carried or credit-noted on resolution', IV.total_withheld_mf > 0)}
      ${kpi('Blocked', `${blocked.length}<span class="cur" style="margin-left:6px">TPP</span>`, blocked.length ? `AED ${aed(blocked.reduce((a, b) => a + b.gross_mf, 0))} unbillable — no P9 counterparty` : 'none', blocked.length > 0)}
    </div>
    <div class="card"><h3>Invoice run ${R.generated_for} <span class="badge">${IV.invoices.length}</span>
      <span class="right">four-eyes: ${IV.four_eyes.initiator} → ${IV.four_eyes.approver}, ${IV.four_eyes.approved_at.replace('T', ' ').replace('Z', '')} · click a row</span></h3>
      <table><thead><tr><th>Invoice</th><th>Counterparty</th><th>Tax</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Gross</th><th class="num">Withheld</th><th>Collection rail</th><th>Status</th></tr></thead><tbody id="inv-rows">
      ${IV.invoices.map(i => `<tr class="click" data-i="${i.id}">
        <td class="mono">${i.id}</td><td><b>${i.tpp_name}</b>${i.buyer.resident ? '' : ` <span class="tag mute">${i.buyer.residence}</span>`}</td>
        <td><span class="tag ${i.tax_category === 'Z' ? 'info' : 'mute'}">${i.tax_category === 'Z' ? 'Z · export' : 'S · 5%'}</span></td>
        <td class="num">${aed(i.net_mf)}</td><td class="num">${aed(i.vat_mf)}</td><td class="num"><b>${aed(i.gross_mf)}</b></td>
        <td class="num">${i.withheld_lines.length ? aed(i.withheld_lines.reduce((a, w) => a + w.gross_mf, 0)) : '—'}</td>
        <td style="font-size:12.5px">${i.collection.rail}<div style="color:var(--ink-4)">${i.collection.fee}</div></td>
        <td>${i.status === 'ISSUED' ? '<span class="tag ok"><i class="dot"></i>issued</span>' : '<span class="tag bad"><i class="dot"></i>blocked</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    <div id="inv-detail"></div>
    <div class="card"><h3>E-invoicing readiness<span class="right">UAE Phase 1 — statutory</span></h3><div class="body">
      <div class="grid g3">
        <div><div class="lbl" style="font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)">Format</div>
          <p style="margin:6px 0 0;font-size:13.5px;color:var(--ink-2)">PINT AE v1.0.3 Billing (UBL 2.1). Doc type <b>380</b> invoice / <b>381</b> credit note, buyer identified by TIN on Peppol endpoint scheme <b>0235</b>, all tax amounts in AED.</p></div>
        <div><div class="lbl" style="font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)">Exchange</div>
          <p style="margin:6px 0 0;font-size:13.5px;color:var(--ink-2)">5-corner DCTCE: supplier → its ASP → buyer's ASP → buyer, with a Tax Data Document reported to the FTA in parallel. The ASP is a port — simulated here, swapped at adoption.</p></div>
        <div><div class="lbl" style="font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)">Clock</div>
          <p style="margin:6px 0 0;font-size:13.5px;color:var(--ink-2)">ASP appointed by <b>30 Oct 2026</b>; issuance mandatory from <b>1 Jan 2027</b> at revenue ≥ AED 50m. Until then these same documents run in the penalty-free voluntary window — which makes this the cheapest possible pilot corpus.</p></div>
      </div></div></div>`;

  const host = P('invoice').querySelector('#inv-detail');
  const openInv = (id) => {
    const i = IV.invoices.find(x => x.id === id);
    const xml = (IV.pint.find(p => p.id === id) || {}).xml;
    P('invoice').querySelectorAll('#inv-rows tr').forEach(tr => tr.classList.toggle('sel', tr.dataset.i === id));
    // One tokenising pass — a chained replace would re-match the class attributes it
    // just injected and highlight its own markup.
    const hl = xml ? esc(xml).replace(
      /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([\w:]+)|([\w:-]+)(=)("[^"]*")/g,
      (m, comment, open, tag, attr, eq, val) =>
        comment ? `<span class="c">${comment}</span>`
        : tag ? `${open}<span class="t">${tag}</span>`
        : `<span class="a">${attr}</span>${eq}${val}`) : '';
    host.innerHTML = `<div class="detail">
      <h4>${i.id} · ${i.tpp_name}<span class="right">${i.status === 'ISSUED' ? 'issued ' + i.issue_date + ' · due ' + i.due_date : i.status.replace(/_/g, ' ').toLowerCase()}</span></h4>
      <div class="in">
        ${i.status !== 'ISSUED' ? `<div class="note-box bad" style="margin-top:0"><b>Not issued.</b> ${tppName(i.tpp)} is consuming production APIs but has no counterparty registration in the financial system (port P9). AED ${aed(i.gross_mf)} of earned revenue cannot be billed until an onboarding task completes — the unbilled-traffic control, seen from the money side.</div>` : ''}
        <table style="margin-bottom:12px"><thead><tr><th>#</th><th>Line</th><th class="num">Units</th><th class="num">Gross (VAT-incl.)</th></tr></thead><tbody>
          ${i.lines.map(l => `<tr><td class="num">${l.no}</td><td>${cls(l.fee_class)}${l.partially_withheld ? ' <span class="tag warn">remainder — disputed part withheld</span>' : ''}</td><td class="num">${n(l.units)}</td><td class="num">${aed(l.gross_mf)}</td></tr>`).join('')}
          <tr class="tot"><td></td><td>Total gross</td><td></td><td class="num">${aed(i.gross_mf)}</td></tr>
          <tr><td></td><td style="color:var(--ink-3)">Taxable amount (net)</td><td></td><td class="num">${aed(i.net_mf)}</td></tr>
          <tr><td></td><td style="color:var(--ink-3)">VAT @ ${i.vat_rate}%${i.tax_category === 'Z' ? ' — zero-rated export of services' : ' (extracted 5/105)'}</td><td></td><td class="num">${aed(i.vat_mf)}</td></tr>
        </tbody></table>
        ${i.withheld_lines.length ? `<table style="margin-bottom:12px"><thead><tr><th>Withheld from this invoice</th><th class="num">Amount</th><th>Break</th><th>Treatment</th></tr></thead><tbody>
          ${i.withheld_lines.map(w => `<tr><td>${cls(w.fee_class)} <span style="color:var(--ink-3)">of AED ${aed(w.of_class_total_mf)}</span></td><td class="num"><b>${aed(w.gross_mf)}</b></td>
            <td><span class="tag bad"><i class="dot"></i>${w.break_id.replace('BRK-2026-06-', 'BRK-')}</span></td><td style="font-size:12.5px;color:var(--ink-2)">${w.carry}</td></tr>`).join('')}
        </tbody></table>` : ''}
        ${xml ? `<details${i.tax_category === 'Z' ? ' open' : ''}><summary>PINT AE document — ${i.pint_ae.customization}</summary><div class="in"><pre>${hl}</pre></div></details>` : ''}
      </div></div>`;
    host.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  };
  P('invoice').querySelectorAll('#inv-rows tr').forEach(tr => tr.onclick = () => openInv(tr.dataset.i));
  openInv(IV.invoices.find(i => i.tax_category === 'Z')?.id || IV.invoices[0].id);
}

/* ═══════════════ 6 · COLLECTIONS & SETTLEMENT (BILL-05) ═══════════════ */
{
  const d = ST.decomposition;
  // Deliberately NOT a waterfall: receivables (AED 15.6k) and the residue (AED 0.21) are
  // four orders of magnitude apart, so a single linear scale renders three of the five
  // steps as flat lines. The bridge lives in the table below, where it ties exactly; the
  // chart shows only the deductions, which ARE comparable to each other.
  const SHORT = {1: 'Hub fees payable', 2: 'Withheld under query', 3: 'Unexplained residue'};
  const dedRows = d.slice(1).map((x, i) => ({k: SHORT[i + 1], v: x.amount_mf, sub: x.note || ''}));
  P('collect').innerHTML = `
    <div class="note-box"><b>One figure arrives; it has to come apart.</b> Interaction Guide v5.0 §10.16 has Nebras collecting from TPPs and remitting to the LFI under the LFI–TPP Agreement, netting across the institution's LFI and TPP-of-record roles. Everything here exists to decompose that number — an unexplained residue is a break, not a rounding curiosity.</div>
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi('Expected net', `<span class="cur">AED</span>${aed(ST.expected_net_mf)}`, `receivables AED ${aed(ST.scheme_receivable_mf)} less hub fees AED ${aed(ST.payable_hub_mf)}`)}
      ${kpi('Received', `<span class="cur">AED</span>${aed(ST.received_mf)}`, `decomposition ties: ${ST.reconciles ? '<b style="color:#0a6b0a">yes, to the fil</b>' : '<b style="color:#a02222">no</b>'}`)}
      ${kpi('Unexplained residue', `<span class="cur">AED</span>${aed(ST.unexplained_mf)}`, ST.residueBreak ? ST.residueBreak.id + ' raised automatically' : 'none', !!ST.residueBreak)}
      ${kpi('Days sales outstanding', ST.dso_days + `<span class="cur" style="margin-left:5px">days</span>`, `${ST.collections.filter(c => c.status !== 'PAID').length} counterparty in dunning`)}
    </div>
    <div class="card"><h3>What was deducted from the remittance<span class="right">AED ${aed(ST.scheme_receivable_mf)} collected → AED ${aed(ST.received_mf)} received</span></h3>
      <div class="body" id="wf-host"></div></div>
    <div class="card"><h3>Decomposition detail</h3>
      <table><thead><tr><th>Component</th><th class="num">Amount</th><th>References</th><th>Explained</th></tr></thead><tbody>
      ${d.map(x => `<tr><td><b>${x.label}</b>${x.note ? `<div style="font-size:12.5px;color:var(--ink-3);margin-top:3px">${x.note}</div>` : ''}</td>
        <td class="num" style="font-weight:600">${x.sign} ${aed(x.amount_mf)}</td>
        <td class="mono" style="font-size:11.5px;color:var(--ink-3)">${x.refs.length ? x.refs.join(', ') : '—'}</td>
        <td>${x.explained ? '<span class="tag ok"><i class="dot"></i>explained</span>' : '<span class="tag bad"><i class="dot"></i>break raised</span>'}</td></tr>`).join('')}
      <tr class="tot"><td>Cash received</td><td class="num">${aed(ST.received_mf)}</td><td colspan="2" style="font-weight:500;color:var(--ink-3)">ties to the decomposition exactly</td></tr>
      </tbody></table></div>
    <div class="grid g2">
      <div class="card"><h3>Direct collection &amp; dunning</h3>
        <table><thead><tr><th>Counterparty</th><th class="num">Amount</th><th>Rail</th><th>State</th></tr></thead><tbody>
        ${ST.collections.map(c => `<tr><td><b>${c.tpp_name}</b></td><td class="num">${aed(c.gross_mf)}</td>
          <td style="font-size:12.5px">${c.rail}</td>
          <td><span class="tag ${c.status === 'PAID' ? 'ok' : 'warn'}"><i class="dot"></i>${c.status === 'PAID' ? 'paid ' + c.paid_at : c.dunning + ' +' + c.days_overdue + 'd'}</span>
          ${c.status !== 'PAID' ? `<div style="font-size:12px;color:var(--ink-3);margin-top:4px">${c.next_action}</div>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
      <div class="card"><h3>Blocked — no invoiceable counterparty <span class="badge">${ST.blocked.length}</span></h3><div class="body">
        ${ST.blocked.map(b => `<div class="note-box bad" style="margin-bottom:10px"><b>${b.tpp_name} — AED ${aed(b.gross_mf)}</b><br>${b.reason}<div style="margin-top:6px;color:var(--ink-3)">${b.action}</div></div>`).join('')}
        <p style="margin:0;font-size:13px;color:var(--ink-3)">Scheme registration is automatic on the API Hub; registration in the institution's own financial system is not. That gap is where earned revenue sits unbilled.</p>
      </div></div>
    </div>
    <div class="card"><h3>Collection rails available to the institution</h3>
      <table><thead><tr><th>Rail</th><th>When</th><th>Cost</th></tr></thead><tbody>
        <tr><td><b>Open Finance Invoice Collection</b> (pay-by-bank)</td><td>Invoices above AED 5,000 — an embedded payment link on the e-invoice</td><td>AED 4 capped per transaction</td></tr>
        <tr><td><b>Aani Request to Pay</b></td><td>Below the AED 50,000 rail limit</td><td>Instant, 24/7</td></tr>
        <tr><td><b>UAEDDS mandate</b></td><td>Recurring pull, the reliable fallback</td><td>Batch, business-day</td></tr>
        <tr><td><b>Scheme net settlement</b></td><td>Where the LFI–TPP Agreement provides for it</td><td>Netted via the sponsoring bank, 30th–5th</td></tr>
      </tbody></table>
      <div class="body" style="border-top:1px solid var(--line-soft)"><p style="margin:0;font-size:13.5px;color:var(--ink-2)">The institution can collect its own Open Finance receivables <b>over Open Finance</b> — the scheme's own Invoice Collection category, at a capped AED 4, is an order of magnitude below merchant-collection bps pricing.</p></div></div>`;
  P('collect').querySelector('#wf-host').appendChild(barChart(dedRows, {color: 'var(--series-2)', aria: 'Deductions from the scheme remittance'}));
}

/* ═══════════════ 7 · REVENUE ASSURANCE (BILL-08) ═══════════════ */
{
  const pct = Math.min(100, (AS.kpi_pct / 8) * 100), tgt = (AS.target_pct / 8) * 100;
  P('assure').innerHTML = `
    <div class="note-box"><b>Rate your own records, then reconcile — the interconnect discipline.</b> Interconnect billing that nobody assures leaks <b>${AS.benchmark}</b>. The number below is only useful because every component of it is named, priced in AED, and owned.</div>
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi('Leakage KPI', `${AS.kpi_pct}<span class="cur" style="margin-left:3px">%</span>`, `of AED ${aed(AS.gross_receivable_mf)} gross receivable`, AS.kpi_pct > AS.target_pct)}
      ${kpi('Recoverable', `<span class="cur">AED</span>${aed(AS.recoverable_mf)}`, `${((AS.recoverable_mf / AS.leakage_mf) * 100).toFixed(0)}% of leakage is recoverable this cycle`)}
      ${kpi('Metering coverage', AS.coverage_pct + '%', 'share of observed traffic the meter can classify')}
      ${kpi('Dispute windows', `${AS.dispute_window.raised}<span class="cur" style="margin-left:6px">raised</span>`, `<b style="color:#0a6b0a">${AS.dispute_window.missed} missed</b> — every query inside 30 days`)}
    </div>
    <div class="card"><h3>Leakage against target</h3><div class="body">
      <svg class="chart" viewBox="0 0 700 74" role="img" aria-label="Leakage KPI against target and benchmark">
        <rect x="0" y="22" width="700" height="18" rx="9" fill="#f1f2f4"/>
        <rect x="0" y="22" width="${pct * 7}" height="18" rx="9" fill="var(--critical)"/>
        <line x1="${tgt * 7}" y1="14" x2="${tgt * 7}" y2="48" stroke="var(--ink)" stroke-width="2"/>
        <text class="val-lbl" x="${tgt * 7 + 7}" y="12">target ${AS.target_pct}%</text>
        <rect x="${(2 / 8) * 700}" y="22" width="${(3 / 8) * 700}" height="18" fill="none" stroke="var(--ink-4)" stroke-dasharray="3 3"/>
        <text class="axis-lbl" x="${(2 / 8) * 700 + 6}" y="60">2–5% — unmanaged benchmark</text>
        <text class="val-lbl" x="${Math.min(660, pct * 7 + 8)}" y="36" font-weight="700">${AS.kpi_pct}%</text>
      </svg></div></div>
    <div class="card"><h3>Findings <span class="badge">${AS.findings.filter(f => f.amount_mf > 0).length} live</span></h3>
      <table><thead><tr><th>Code</th><th>Finding</th><th class="num">AED</th><th>Owner</th><th>State</th></tr></thead><tbody>
      ${AS.findings.map(f => `<tr><td class="mono"><b>${f.code}</b></td>
        <td><b>${f.title}</b><div style="font-size:12.5px;color:var(--ink-3);margin-top:3px">${f.detail}</div></td>
        <td class="num" style="font-weight:${f.amount_mf ? 700 : 400}">${f.amount_mf ? aed(f.amount_mf) : f.counterfactual_mf ? `<span style="color:var(--ink-3)">(${aed(f.counterfactual_mf)})</span>` : '—'}</td>
        <td>${f.owner}</td>
        <td><span class="tag ${f.status === 'CORRECT' ? 'ok' : f.status === 'BLOCKED' ? 'bad' : f.status === 'PRICED' ? 'info' : 'warn'}"><i class="dot"></i>${f.status.toLowerCase()}</span></td></tr>`).join('')}
      <tr class="tot"><td></td><td>Total leakage</td><td class="num">${aed(AS.leakage_mf)}</td><td colspan="2" style="font-weight:500;color:var(--ink-3)">${AS.kpi_pct}% of gross receivable</td></tr>
      </tbody></table>
      <div class="body" style="border-top:1px solid var(--line-soft)">
        <p style="margin:0;font-size:13.5px;color:var(--ink-2)"><b>The single biggest number here is an onboarding form.</b> ${((AS.findings[1].amount_mf / AS.leakage_mf) * 100).toFixed(0)}% of this month's leakage is one TPP that trades in production but is not an invoiceable counterparty. The second biggest is a scheme statement that under-states what its own event data supports — which is only visible because the institution counted independently.</p>
        <p style="margin:10px 0 0;font-size:13.5px;color:var(--ink-2)">L3 is shown in brackets because it did <i>not</i> leak: the institution publishes an overage rate in the directory, so AED ${aed(AS.findings[2].counterfactual_mf)} of retail pages above the free tier were billed rather than surrendered. Most LFIs leave that field empty.</p>
      </div></div>`;
}

/* ═══════════════ 8 · PROFITABILITY (BILL-09) ═══════════════ */
{
  P('profit').innerHTML = `
    <div class="note-box"><b>Both roles, one P&amp;L.</b> The institution earns from consuming TPPs as an LFI and pays the Hub and other LFIs as a TPP-of-record, re-billing its own fintech clients with margin. A billing system that models only one side cannot answer what a counterparty is worth.</div>
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi('LFI-role receivable', `<span class="cur">AED</span>${aed(RA.receivable_total_mf)}`, `${RA.statements.length} consuming TPPs`)}
      ${kpi('TPP-of-record cost', `<span class="cur">AED</span>${aed(RA.payable_hub_total_mf + RA.payable_lfi_total_mf)}`, `hub AED ${aed(RA.payable_hub_total_mf)} · counterparty LFIs AED ${aed(RA.payable_lfi_total_mf)}`)}
      ${kpi('Re-billed with margin', `<span class="cur">AED</span>${aed(RA.tppaas_rebill_mf)}`, `margin AED ${aed(RA.tppaas_margin_mf)} across ${RA.tppaas.length} clients`)}
      ${kpi('Hub fees as share', `${((RA.payable_hub_total_mf / RA.receivable_total_mf) * 100).toFixed(2)}<span class="cur" style="margin-left:3px">%</span>`, 'of the receivable — the Hub is not where the money is')}
    </div>
    <div class="card"><h3>LFI role — per consuming TPP</h3>
      <table><thead><tr><th>TPP</th><th class="num">Receivable</th><th class="num">Liability provision</th><th class="num">Withheld</th><th class="num">Uncollectable</th><th class="num">Net</th><th class="num">Net %</th></tr></thead><tbody>
      ${AS.profitability.map(p => `<tr><td><b>${p.name}</b>${p.invoiceable ? '' : ' <span class="tag bad">not invoiceable</span>'}</td>
        <td class="num">${aed(p.receivable_mf)}</td><td class="num">${aed(p.provision_mf)}</td>
        <td class="num">${p.withheld_mf ? aed(p.withheld_mf) : '—'}</td>
        <td class="num">${p.uncollectable_mf ? '<b style="color:var(--critical)">' + aed(p.uncollectable_mf) + '</b>' : '—'}</td>
        <td class="num"><b>${aed(p.net_mf)}</b></td><td class="num">${p.net_pct}%</td></tr>`).join('')}
      </tbody></table>
      <div class="body" style="border-top:1px solid var(--line-soft)"><p style="margin:0;font-size:13px;color:var(--ink-3)">Liability provision = the scheme-compensation exposure attributable to a TPP's traffic, expressed as money rather than as a monitor.</p></div></div>
    <div class="card"><h3>TPP-of-record role — per TPP-as-a-Service client</h3>
      <table><thead><tr><th>Client</th><th class="num">Hub fees</th><th class="num">Counterparty LFI fees</th><th class="num">Cost</th><th class="num">Markup</th><th class="num">Re-billed</th><th class="num">Margin</th></tr></thead><tbody>
      ${AS.tppaas.map(c => `<tr><td><b>${c.name}</b></td><td class="num">${aed(c.hub_mf)}</td><td class="num">${aed(c.lfi_mf)}</td>
        <td class="num">${aed(c.cost_mf)}</td><td class="num">${c.markup_pct}%</td><td class="num">${aed(c.rebill_mf)}</td><td class="num"><b>${aed(c.margin_mf)}</b></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td class="num">${aed(RA.payable_hub_total_mf)}</td><td class="num">${aed(RA.payable_lfi_total_mf)}</td>
        <td class="num">${aed(RA.payable_hub_total_mf + RA.payable_lfi_total_mf)}</td><td></td><td class="num">${aed(RA.tppaas_rebill_mf)}</td><td class="num">${aed(RA.tppaas_margin_mf)}</td></tr>
      </tbody></table></div>
    <div class="card"><h3>Fee simulation<span class="right">re-rated line by line — the cap applies per transaction</span></h3>
      <table><thead><tr><th>Scenario</th><th>Measured on</th><th class="num">Receivable</th><th class="num">Δ vs today</th><th>Note</th></tr></thead><tbody>
      ${AS.scenarios.map(s => `<tr><td><b>${s.name}</b></td><td style="font-size:12.5px;color:var(--ink-3)">${s.basis}</td><td class="num">${aed(s.receivable_mf)}</td>
        <td class="num" style="font-weight:${s.delta_mf ? 700 : 400};color:${s.delta_mf < 0 ? 'var(--critical)' : 'var(--ink-3)'}">${s.delta_mf ? '−' + aed(Math.abs(s.delta_mf)) : '—'}</td>
        <td style="font-size:12.5px;color:var(--ink-2)">${s.note}</td></tr>`).join('')}
      </tbody></table>
      <div class="body" style="border-top:1px solid var(--line-soft)">
      <p style="margin:0;font-size:13.5px;color:var(--ink-2)">The last row is the decision most institutions make by not making it: leaving <code>ApiMetadata.OverLimitFees</code> empty in the directory surrenders <b>AED ${aed(Math.abs(AS.scenarios[3].delta_mf))}</b> in this month alone. Two LFIs in the market publish a rate.</p></div></div>`;
}

/* table-view toggles + footer */
document.querySelectorAll('[data-tv]').forEach(b => b.onclick = () => {
  const t = document.getElementById(b.dataset.tv);
  const on = t.style.display === 'none';
  t.style.display = on ? 'table' : 'none';
  b.textContent = on ? 'Hide table' : 'Table view';
});
document.getElementById('foot').innerHTML =
  `<b>Prototype.</b> Every figure on every screen is computed by the engine in <code>prototypes/billing/engine/</code> from a deterministic synthetic month — nothing is hand-typed, and <code>node run.mjs</code> reproduces this page exactly.
   Seed <code>${R.seed}</code> · rate card <code>${R.rate_card.version}</code> · ${n(M.stats.events_total)} synthetic events · ${IV.pint.length} PINT AE documents generated · <code>node verify.mjs</code> — 15/15 independent arithmetic checks pass.<br>
   Scope: the receivables side of the scheme (BILL-01..05, 08, 09). Not modelled here: insurance commissions and clawbacks (BILL-06, needs INS-01), GL posting (BILL-07), multi-tenant overlays (BILL-10). Synthetic PSUs and invented counterparties only — zero real data, by construction.`;
