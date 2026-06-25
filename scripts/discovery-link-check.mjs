// HG-0007 — the waist gate (discovery → delivery). The delivery loop is excellent at
// building the thing right and silent on whether it is the right thing. This gate makes a
// green discovery hand-off the entry condition for a *new* feature-bearing backlog item, so
// a feature traces to an evidenced problem + a data-governance verdict + a tangible,
// stakeholder-tested direction — not an unsourced request.
//
// Two deterministic checks over docs/backlog.yaml (pure Node, reuses the D1–D9 validator):
//   1. Referential integrity — any feature item that carries `discovery: <slug>` must point
//      at a discovery/runs/<slug>/ whose hand-off exists and passes ALL applicable gates.
//   2. Mandatory link — a feature item (BACKOFFICE-NN) that is `pending` must carry a
//      `discovery:` link (or an explicit `discovery_exempt: true` escape hatch with a reason).
//      Items already in flight or shipped (done/in-progress/blocked/deferred) are grandfathered:
//      the policy binds work that enters the queue AFTER it, never rewrites history.
//
// Run from the repo root: `node scripts/discovery-link-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { validateRun } from '../discovery/gates/validate.mjs';

const BACKLOG = 'docs/backlog.yaml';
const FEATURE = /^BACKOFFICE-\d+$/; // PRD §7 requirement = a feature-bearing item

/** Indentation (leading spaces) of a line. */
const indent = (line) => line.length - line.trimStart().length;
/** A list element that is a backlog item (inline `- { id:…}` or block `- id:…`) — NOT a milestone (`- name:`). */
const isItemStart = (line) => /^\s*-\s+(\{|id:)/.test(line);

/**
 * Slice docs/backlog.yaml into per-item text blocks. An item owns its start line plus every
 * following line indented deeper than its `-` (captures multi-line block items); a sibling at
 * the same indent, or any dedent, ends it. Milestone headers (`- name:`) never start an item.
 */
function parseItems(text) {
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isItemStart(lines[i])) continue;
    const base = indent(lines[i]);
    const buf = [lines[i]];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') { buf.push(lines[j]); continue; }
      if (indent(lines[j]) <= base) break;
      buf.push(lines[j]);
    }
    i = j - 1;
    items.push(buf.join('\n'));
  }
  return items;
}

const field = (text, re) => (text.match(re) || [])[1];

function check() {
  if (!existsSync(BACKLOG)) return [`${BACKLOG} not found`];
  const findings = [];
  for (const block of parseItems(readFileSync(BACKLOG, 'utf8'))) {
    const id = field(block, /\bid:\s*([A-Za-z0-9-]+)/);
    if (!id || !FEATURE.test(id)) continue; // only PRD feature items are waist-gated
    // Trigger on EXPLICIT `status: pending` only. The loop's Pick step picks pending items, so
    // an un-statused stub (id+title, a someday-maybe) cannot enter delivery until someone marks
    // it pending — which is exactly when the hand-off must exist. No status ≠ pending here.
    const status = field(block, /\bstatus:\s*([a-z-]+)/);
    const slug = field(block, /\bdiscovery:\s*([a-z0-9-]+)/);
    const exempt = /\bdiscovery_exempt:\s*true\b/.test(block);

    if (slug) {
      // Check 1 — the link must resolve to a green discovery run.
      const runDir = `discovery/runs/${slug}`;
      if (!existsSync(`${runDir}/handoff.md`)) {
        findings.push(`${id}: discovery: ${slug} — no hand-off at ${runDir}/handoff.md`);
        continue;
      }
      const res = validateRun(runDir, {});
      if (!res.ok) {
        const failed = res.gates.filter((g) => g.status === 'fail').map((g) => g.id).join(', ');
        findings.push(`${id}: discovery run '${slug}' is not gate-green (failing: ${failed})`);
      }
    } else if (status === 'pending' && !exempt) {
      // Check 2 — a new feature may not enter delivery without an evidenced problem.
      findings.push(
        `${id}: pending feature with no 'discovery: <slug>' hand-off (HG-0007). ` +
        `Run the discovery harness first, or set 'discovery_exempt: true' with a reason.`,
      );
    }
  }
  return findings;
}

const findings = check();
if (findings.length) {
  process.stderr.write('\nDiscovery → delivery waist gate (HG-0007) — FAIL\n\n');
  for (const f of findings) process.stderr.write(`  - ${f}\n`);
  process.stderr.write('\nA feature backlog item must trace to a green discovery hand-off.\n');
  process.exit(1);
}
process.stdout.write('Discovery → delivery waist gate (HG-0007) — OK\n');
