// HG-0007 — the waist gate (discovery → delivery). The delivery loop is excellent at
// building the thing right and silent on whether it is the right thing. This gate makes a
// green discovery hand-off the entry condition for a *new* feature-bearing backlog item, so
// a feature traces to an evidenced problem + a data-governance verdict + a tangible,
// stakeholder-tested direction — not an unsourced request.
//
// Four deterministic checks over docs/backlog.yaml (pure Node, reuses the D1–D9 validator):
//   1. Referential integrity — any feature item that carries `discovery: <slug>` must point
//      at a discovery/runs/<slug>/ whose hand-off exists and passes ALL applicable gates.
//   2. Mandatory link — a feature item (matching FEATURE below) in any ACTIVE status (pending,
//      in-progress, in-review, ready, …) must carry a `discovery:` link (or an explicit
//      `discovery_exempt: true` escape hatch with a reason). Shipped items (done/closed/…) and
//      parked ones (blocked/deferred) are grandfathered: the policy binds work that is being
//      built, never rewrites history. 2.1.0: until now only `pending` was gated, so flipping an
//      item to `in-progress` walked around the waist — the exact moment the agent starts building
//      is the moment the hand-off must exist.
//   2c. What the link admits — a linked run must NAME the item in its hand-off (`licenses:`), so
//      one green run cannot license the whole backlog; its D6 verdict must not be `No`; and a
//      `Conditional` verdict must carry its conditions into the hand-off, or delivery inherits a
//      position nobody wrote down (2.1.0).
//   3. Coverage — the gate must have examined something before it may print OK, and it says how
//      much. A backlog with content but no recognised item, or an `ADOPT:` marker still on the
//      shipped default while the real ids look nothing like it, are the two ways this gate goes
//      quiet without going red. See coverage() for why one of those fails and the other reports.
//   4. YAML-shape integrity — a list item indented inside a block scalar is reported before the
//      YAML parser can silently fold it into prose and remove it from the executable backlog.
//
// Run from the repo root: `node scripts/discovery-link-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { validateRun, registerMandatory } from '../discovery/gates/validate.mjs';
import { frontMatter } from '../discovery/gates/lib.mjs';
import { pathToFileURL } from 'node:url';

const BACKLOG = 'docs/backlog.yaml';
// The shipped default, recorded separately so the gate can tell "never adopted" from "customised
// and currently matching nothing". Do NOT edit this line — edit FEATURE below.
const SHIPPED_DEFAULT = '^STORY-\\d+$';
// ADOPT: set this to your feature-item id convention (infra items should NOT match).
export const FEATURE = /^BACKOFFICE-\d+$/;
// Status classes (2.1.0). TERMINAL never re-enters delivery; PARKED is not being built; everything
// else with an explicit status is ACTIVE and waist-gated. An un-statused stub is a someday-maybe
// and stays ungated until someone gives it a status — which is exactly when the hand-off must exist.
export const TERMINAL_STATUSES = new Set(['done', 'closed', 'superseded', 'cancelled', 'canceled', 'released', 'shipped', 'wontfix', 'dropped']);
export const PARKED_STATUSES = new Set(['blocked', 'deferred', 'on-hold', 'icebox', 'parked']);
export const isActiveStatus = (status) => Boolean(status) && !TERMINAL_STATUSES.has(status) && !PARKED_STATUSES.has(status);

/** Indentation (leading spaces) of a line. */
const indent = (line) => line.length - line.trimStart().length;
/** A list element that is a backlog item (inline `- { id:…}` or block `- id:…`) — NOT a milestone (`- name:`). */
export const isItemStart = (line) => /^\s*-\s+(\{|id:)/.test(line);

/**
 * Slice docs/backlog.yaml into per-item text blocks. An item owns its start line plus every
 * following line indented deeper than its `-` (captures multi-line block items); a sibling at
 * the same indent, any dedent, or the next item start at ANY indent ends it. Milestone headers
 * (`- name:`) never start an item.
 *
 * The last of those boundaries arrived in rc.28, and it closed a specific silent miss:
 *
 *   milestones:
 *     - id: M1          ← looks exactly like an item start
 *       items:
 *         - id: STORY-1 ← swallowed into M1's block under the old rule
 *           status: pending
 *
 * `isItemStart` excludes `- name:` precisely so a milestone keyed by NAME is not mistaken for an
 * item — but nothing stopped a milestone keyed by `id`, which is an entirely natural thing to
 * write. Under the old boundary its children were absorbed, `id` resolved to the MILESTONE's id,
 * that did not match the feature pattern, and every real item beneath it went unexamined. The gate
 * reported OK. HG-0007 is the waist of the double diamond; an inert one that says OK is worse than
 * an absent one, because nobody goes looking.
 *
 * Ending at the next item start makes the container its own short block (no `status`, so it is
 * skipped) and gives every real item a block of its own, in both nesting styles and flat files.
 */
export function parseItems(text) {
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
      if (isItemStart(lines[j])) break; // a nested item is its own block, never this one's tail
      buf.push(lines[j]);
    }
    i = j - 1;
    items.push(buf.join('\n'));
  }
  return items;
}

const field = (text, re) => (text.match(re) || [])[1];
/** An item's id — the first `id:` in its block, quoted or bare. */
const ID = /\bid:\s*["']?([A-Za-z0-9-]+)/;

/**
 * Detect a list item swallowed by a YAML block scalar. This OFBO control predates the portable
 * Loom parser and remains useful: once parsed, the evidence that an item was folded into prose is
 * gone, so this check intentionally reads the raw file.
 */
export function swallowedListItems(text) {
  const lines = text.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const scalar = /^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s*[>|][-+]?\s*$/.exec(lines[i]);
    if (!scalar) continue;
    const keyIndent = scalar[1].length;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length) continue;
    const contentIndent = indent(lines[j]);
    if (contentIndent <= keyIndent) continue;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (indent(lines[j]) < contentIndent) break;
      if (/^\s*-\s+\S/.test(lines[j]) && indent(lines[j]) === contentIndent) {
        findings.push(
          `${BACKLOG}:${j + 1}: a list item is indented inside the '${scalar[2]}: ` +
          `${lines[i].trim().slice(-2)}' block opened at line ${i + 1}, so YAML folds it into ` +
          `prose instead of tracking it: ${lines[j].trim().slice(0, 60)}…`,
        );
      }
    }
  }
  return findings;
}

/**
 * Does the file carry anything a backlog item could be made of? Blank lines, comments, document
 * markers, bare keys and EMPTY collections do not count — `milestones: []` is a legitimately empty
 * backlog and the SKILL says so. Anything else does.
 */
export function hasContent(text) {
  return text.split('\n').some((line) => {
    const t = line.replace(/#.*$/, '').trim();
    if (!t || t === '---' || t === '-') return false;
    return !/^[\w.-]+:\s*(\[\s*\]|\{\s*\}|~|null)?$/.test(t);
  });
}

/**
 * How much of the backlog this gate actually examined — the loud-not-silent half (rc.28).
 *
 * A gate that prints OK is making a claim: "every feature backlog item traces to a green discovery
 * hand-off". When it examined nothing, that claim has no evidence behind it, and HG-0007 is the one
 * gate where an inert pass is worse than an absent gate — the waist of the double diamond is exactly
 * where nobody goes looking, because the light is green. Two ways it can go quiet, both real:
 *
 *   · the parser recognises no items in a backlog that plainly has content (an unanticipated
 *     shape — a mapping instead of a list, a nesting style nobody tried);
 *   · items parse, but none matches FEATURE, because the `ADOPT:` marker above was never set to
 *     the adopter's own id convention. Every brownfield repo has ids like FEAT-102 or PAY-88, so
 *     the shipped `STORY-<n>` default matches nothing and the gate gates nothing.
 *
 * The second distinguishes UNEDITED from CUSTOMISED, and treats them differently on purpose. An
 * unedited marker is an unfinished adoption and fails. A marker the adopter deliberately set that
 * happens to match nothing today is an ordinary state of a backlog — reported, never failed.
 */
export function coverage(text, feature = FEATURE) {
  const items = parseItems(text);
  const ids = items.map((b) => field(b, ID)).filter(Boolean);
  const matched = ids.filter((id) => feature.test(id));
  const unedited = feature.source === SHIPPED_DEFAULT;
  const stats = { items: items.length, ids: ids.length, matched: matched.length, unedited };
  const findings = [];
  const notices = [];

  if (!items.length) {
    if (hasContent(text)) {
      findings.push(
        `${BACKLOG} has content, but the waist gate recognised no backlog item in it. An item is a ` +
        `list element keyed by id — '- id: STORY-1' on its own line, or inline '- { id: STORY-1, … }'; ` +
        `docs/backlog.example.yaml shows both nesting styles. Passing here would claim every ` +
        `feature traces to a green hand-off on the strength of having examined nothing.`,
      );
    } else {
      notices.push(`${BACKLOG} declares no items yet — nothing for the waist gate to examine.`);
    }
  } else if (!matched.length && unedited) {
    findings.push(
      `${BACKLOG} has ${items.length} item(s) and none carries an id matching ${feature} — which is ` +
      `still this bundle's shipped default. Set FEATURE in scripts/discovery-link-check.mjs (the ` +
      `'ADOPT:' line) to your own feature-item id convention. Until you do, HG-0007 reads every item ` +
      `and gates none of them.`,
    );
  } else if (!matched.length) {
    notices.push(`${items.length} item(s) examined, none matching ${feature} — no feature work in the backlog right now.`);
  }
  return { findings, notices, stats };
}

/**
 * Pure waist-gate logic over backlog TEXT. `resolveRun(slug)` reports a linked run's state:
 * `{ handoffMissing: true }`, `{ failedGates: [...] }`, or `null` when the run is gate-green.
 * `feature` decides which ids are waist-gated. No filesystem here — see check() for the wiring.
 */
/**
 * Does this item carry a reason a human could argue with? Presence is not enough — an empty
 * string, whitespace, or a leftover placeholder is the same silence the check exists to stop,
 * dressed as compliance.
 */
function hasReason(block) {
  const raw = field(block, /\breason:\s*(.+)/);
  if (!raw) return false;
  const reason = raw.trim().replace(/^["']|["'],?$/g, '').replace(/[,}]\s*$/, '').trim();
  if (!reason) return false;
  return !/^(TODO|TBD|ADOPT|N\/?A|none|<[^>]*>)$/i.test(reason);
}

export function checkItems(text, resolveRun, feature = FEATURE) {
  const findings = [];
  for (const block of parseItems(text)) {
    const id = field(block, ID);
    if (!id || !feature.test(id)) continue; // only PRD feature items are waist-gated
    // Trigger on EXPLICIT `status: pending` only. The loop's Pick step picks pending items, so
    // an un-statused stub (id+title, a someday-maybe) cannot enter delivery until someone marks
    // it pending — which is exactly when the hand-off must exist. No status ≠ pending here.
    // Tolerate quoted/cased YAML scalars: `status: "Pending"` is the same as `status: pending`.
    // Matching only bare lowercase let a quoted or capitalized status slip the waist gate.
    const rawStatus = field(block, /\bstatus:\s*["']?([A-Za-z-]+)/);
    const status = rawStatus ? rawStatus.toLowerCase() : undefined;
    const slug = field(block, /\bdiscovery:\s*["']?([A-Za-z0-9-]+)/);
    const exempt = /\bdiscovery_exempt:\s*["']?true\b/i.test(block);

    if (slug) {
      // Check 1 — the link must resolve to a green discovery run.
      const r = resolveRun(slug);
      if (r && r.handoffMissing) {
        findings.push(`${id}: discovery: ${slug} — no hand-off at discovery/runs/${slug}/handoff.md`);
      } else if (r && r.failedGates && r.failedGates.length) {
        findings.push(`${id}: discovery run '${slug}' is not gate-green (failing: ${r.failedGates.join(', ')})`);
      } else if (r) {
        // Check 2c — what a green link actually admits (2.1.0). `r === null` is the legacy
        // "green, nothing more known" answer test doubles give; the filesystem resolver always
        // returns the full record, so production never takes the null path.
        if (r.verdict === 'no') {
          findings.push(`${id}: discovery run '${slug}' recorded a residual-risk verdict of No — the data-governance position says this direction is not acceptable for delivery (D6); a "No" is a decision, not a gate to walk through`);
        } else if (r.verdict === 'conditional' && r.conditionsMissing) {
          findings.push(`${id}: discovery run '${slug}' is Conditional but handoff.md carries no "Conditions delivery inherits" — delivery would inherit a position nobody wrote down`);
        }
        if (!Array.isArray(r.licenses)) {
          findings.push(`${id}: discovery run '${slug}' names no backlog items it licenses — add licenses: [${id}, …] to handoff.md front-matter (one run licenses the items it names, never the backlog)`);
        } else if (!r.licenses.includes(id)) {
          findings.push(`${id}: discovery run '${slug}' licenses ${r.licenses.length ? r.licenses.join(', ') : 'nothing'}, not ${id} — a hand-off admits the items it names; add ${id} to its licenses: or run discovery for it`);
        }
      }
    } else if (isActiveStatus(status) && !exempt) {
      // Check 2 — a new feature may not enter delivery without an evidenced problem.
      findings.push(
        `${id}: ${status} feature with no 'discovery: <slug>' hand-off (HG-0007). ` +
        `Run the discovery harness first, or set 'discovery_exempt: true' with a reason.`,
      );
    } else if (isActiveStatus(status) && exempt && !hasReason(block)) {
      // Check 2b — the escape hatch may be taken, but only OUT LOUD. An exemption with no
      // reason is a silent bypass of the gate that makes discovery non-optional: one line,
      // no justification, and the gate prints OK. Three places promised a reason was
      // required (the header comment, the failure message above, and the shipped example's
      // "Silence is not an option; an exemption is") and until rc.33 nothing checked.
      findings.push(
        `${id}: discovery_exempt: true with no reason (HG-0007). An exemption is allowed; ` +
        `a silent one is not. Add 'reason: <why no discovery applies>' — a sentence a human can argue with.`,
      );
    }
  }
  return findings;
}

/** `licenses: [STORY-1, STORY-2]` (or a bare comma list) from hand-off front-matter → array, or undefined. */
export function parseLicenses(fm) {
  const raw = fm?.licenses;
  if (raw === undefined) return undefined;
  const inner = String(raw).trim().replace(/^\[|\]$/g, '');
  if (/<[^>]*>/.test(inner)) return undefined; // the template placeholder is not a list
  return inner.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Is the hand-off's "Conditions delivery inherits" bullet filled with something a human wrote? */
export function conditionsCarried(handoffBody) {
  const m = handoffBody.match(/\*\*Conditions delivery inherits:\*\*[ \t]*(.*)/i); // [ \t] not \s: a newline must not let the next heading read as the value
  const text = (m?.[1] || '').trim();
  if (!text) {
    // allow the conditions on the following lines (a bullet list under the heading)
    const after = handoffBody.split(/\*\*Conditions delivery inherits:\*\*/i)[1] || '';
    const next = after.split('\n').slice(1).find((l) => l.trim()) || '';
    return /^\s*[-*]\s+\S/.test(next) && !/<[^>]*>|\bTBD\b|\bTODO\b/.test(next);
  }
  return !/<[^>]*>|\bTBD\b|\bTODO\b|^none$|^n\/a$/i.test(text);
}

/**
 * The filesystem-backed run resolver the CLI uses (reuses the D1–D9 validator). 2.1.0: the register
 * requirement is passed through (it was not — under a regulated profile the CI loop failed D6 on an
 * unmounted register while this gate's own view of the same run said green), and a green run is
 * reported with what it admits: its D6 verdict, whether a Conditional verdict's conditions reached
 * the hand-off, and which backlog items the hand-off licenses.
 */
function fsResolveRun(slug) {
  const runDir = `discovery/runs/${slug}`;
  if (!existsSync(`${runDir}/handoff.md`)) return { handoffMissing: true };
  const res = validateRun(runDir, { requireRegister: registerMandatory(process.cwd(), { flag: process.env.LOOM_REQUIRE_REGISTER === '1' }) });
  if (!res.ok) return { failedGates: res.gates.filter((g) => g.status === 'fail').map((g) => g.id) };
  const { fm, body } = frontMatter(readFileSync(`${runDir}/handoff.md`, 'utf8'));
  const verdict = res.gates.find((g) => g.id === 'D6')?.verdict ?? null;
  return { verdict, conditionsMissing: verdict === 'conditional' && !conditionsCarried(body), licenses: parseLicenses(fm) };
}

export function check() {
  // The installer deliberately does not ship a backlog — it is the adopter's own content, not a
  // template — so a freshly adopted repo meets this gate before the file exists. That is still a
  // failure and not a no-op: an absent backlog means the waist is unwired, and passing here would
  // make "no backlog" indistinguishable from "every item traces to a green hand-off". But the
  // finding has to say what to DO, because the reader is an adopter on their first CI run who has
  // not done anything wrong.
  if (!existsSync(BACKLOG)) {
    return {
      findings: [`${BACKLOG} not found — the installer does not ship one because a backlog is your `
        + `content, not a template. Create it (the loom-adopt SKILL lists it under "Also create if `
        + `missing"), copying the shape from the docs/backlog.example.yaml this bundle installs beside it; an empty \`milestones: []\` `
        + `is valid and passes this gate.`],
      notices: [],
      stats: null,
    };
  }
  const text = readFileSync(BACKLOG, 'utf8');
  const { findings, notices, stats } = coverage(text);
  return { findings: [...findings, ...swallowedListItems(text), ...checkItems(text, fsResolveRun)], notices, stats };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, stats } = check();
  for (const n of notices) process.stdout.write(`  note: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nDiscovery → delivery waist gate (HG-0007) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA feature backlog item must trace to a green discovery hand-off, and YAML must preserve every item as an item.\n');
    process.exit(1);
  }
  // OK states its coverage. A bare OK is the shape of claim this gate exists to refuse.
  const scope = stats ? ` (${stats.matched} of ${stats.items} backlog item(s) waist-gated)` : '';
  process.stdout.write(`Discovery → delivery waist gate (HG-0007) — OK${scope}\n`);
}
