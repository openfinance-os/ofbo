// The approval-surface gate (Factory Floor WS5 · D5.1 + D5.4). Two floor surfaces, one gate,
// because they fail the same way: a page that has quietly stopped matching the thing in git that
// it is supposed to serve.
//
//   1. THE APPROVALS SURFACE (D5.1). A stored `floor/approvals/*.json` is checked against the
//      compiled control plan for its change — one section per compiled role, the evidence carried
//      in and out of the approver's reach, the people-property resolving through the P6 map. The
//      rules live in `core/floor-approval-surface.mjs`; this file finds the pairs and reports.
//   2. CATALOG B (D5.4). The `decision-routed` forms — an ADR inbox card and a Solution Direction
//      Record flow — are authored on the floor, but the decision they carry only becomes real once
//      it lands in git through a signed envelope and a human merge. Each form must carry its
//      write-class banner, name the git template it mirrors, and keep that template's SECTION LIST
//      in step. That is D3.1's parity idea applied to a hand-written form: the generated
//      `floor/templates/*.json` definitions cannot drift because they are regenerated, but a
//      catalog-B form is prose a person maintains, so the drift has to be caught rather than
//      prevented.
//
// WHY THE SECTION LIST IS THE THING CHECKED. A form whose sections have drifted from the artifact
// it produces is the quiet failure D3.1 was written for: the author fills in what they were asked
// for, the floor-keeper carries it into git, and the gate reads an artifact missing a section
// nobody was asked about. The check compares section names, order, kind and table columns —
// deliberately NOT the guidance prose, which is rightly rephrased for a floor author, and not the
// gate ids the prose happens to name.
//
//   node scripts/approval-surface-check.mjs
//
// WHAT A GREEN RESULT DOES NOT MEAN. It does not mean approvals work. WS5's entry gate has not
// passed — it needs an independent second-line review of the workstream's design, which does not
// exist — so every surface here ships labelled non-authoritative, and this gate checks that the
// label is present, not that the thing behind it is live. It also cannot see a vendor's page
// grants: `writable_by` is the layout an adopter must configure, and whether the workspace
// actually withholds edit rights is an activation observation, not a property of a JSON file.
//
// Silent where unadopted: no `floor/approvals/` and no `floor/catalog-b/` is a clean no-op.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseTemplate } from '../core/floor-templates.mjs';
import { WRITE_CLASS, verifyApprovalSurface } from '../core/floor-approval-surface.mjs';
import { bannerBlockOf, frontmatterOf } from './floor-only-check.mjs';

export const SURFACE_DIR = 'floor/approvals';
export const CATALOG_DIR = 'floor/catalog-b';
export const CHANGES_DIR = 'docs/governance/changes';

/** Catalog B is the decision-routed class and nothing else. */
export const CATALOG = 'B';

/**
 * What a catalog-B banner must say, in the LEADING quote block — the same discipline as
 * `scripts/floor-only-check.mjs`: a rule an author meets after they have written is a postscript,
 * not a control. Three separate requirements, because they are three different mistakes —
 * forgetting the class, forgetting that the class means the floor does not decide, and forgetting
 * that WS5 is not live.
 */
export const BANNER_REQUIREMENTS = Object.freeze([
  {
    code: 'AS-R12',
    id: 'write-class',
    re: /decision-routed/,
    want: 'the write class, named exactly: `decision-routed`',
    why: 'the one thing no form can infer for its author — what happens to what they write',
  },
  {
    code: 'AS-R12',
    id: 'non-authoritative',
    re: /NON-AUTHORITATIVE/,
    want: 'the non-authoritative label, in capitals: NON-AUTHORITATIVE',
    why: 'WS5\'s entry gate has not passed. A form that does not say so is read as a live one, and it will be read by someone who was not in the design review',
  },
  {
    code: 'AS-R13',
    id: 'envelope',
    re: /signed envelope/i,
    want: 'how the decision becomes real: a **signed envelope**',
    why: 'decision-routed is a promise about routing. Without naming the envelope the class name reads like a filing location, and the author believes the page decided',
  },
  {
    code: 'AS-R13',
    id: 'human-merge',
    re: /(?:human[^.]{0,80}merge)|(?:merge[^.]{0,80}human)/i,
    want: 'who closes the loop: a HUMAN merges',
    why: 'the envelope proves who decided; the merge is where it becomes the record. An author who does not know a human must merge will wait for a robot that is not coming',
  },
]);

const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/**
 * Banner requirements are tested against a whitespace-collapsed copy. A banner is wrapped prose,
 * and a phrase that happens to break across two lines is still a phrase the author reads — a
 * line-sensitive regex would fail a form for its line width, which teaches nobody anything.
 */
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ');

/** Section shape, narrowed to what a mirror must match: names, order, kind, and what is asked for. */
const shapeOf = (s) => ({ name: s.name, kind: s.kind, columns: s.columns ?? null, fields: s.fields ?? null });

/**
 * Section-list drift between a catalog-B form and the git template it mirrors. This is
 * `core/floor-templates.mjs`'s `diff()` narrowed to the part a mirror is responsible for, and it
 * returns early on a name mismatch for the same reason: once the lists disagree, per-section
 * comparison is noise.
 *
 * `floorOnly` is the set of sections the form declares as its own — the routing or triage block
 * that never travels into git. A declaration cannot launder a mirrored section: a name that
 * appears in the template may not be declared floor-only.
 */
export function mirrorDrift(formText, mirrorText, floorOnly = new Set(), label = 'form') {
  const form = parseTemplate(String(formText || ''));
  const mirror = parseTemplate(String(mirrorText || ''));
  const findings = [];

  for (const name of floorOnly) {
    if (mirror.sections.some((s) => s.name === name)) {
      findings.push(`AS-R15: ${label}: declares \`${name}\` floor-only, but the mirrored template has a section of that name — a floor-only declaration cannot be used to drop a section the record needs`);
    } else if (!form.sections.some((s) => s.name === name)) {
      findings.push(`AS-R15: ${label}: declares \`${name}\` floor-only and has no such section — a stale declaration is how a renamed section stops being compared`);
    }
  }

  const mine = form.sections.filter((s) => !floorOnly.has(s.name)).map(shapeOf);
  const theirs = mirror.sections.map(shapeOf);
  const names = (rows) => rows.map((s) => s.name);
  if (JSON.stringify(names(mine)) !== JSON.stringify(names(theirs))) {
    findings.push(`AS-R15: ${label}: the section list has drifted from the template it mirrors — a section added, removed, renamed or reordered here produces a record missing what its gate reads, and the author is never told\n      form  : ${JSON.stringify(names(mine))}\n      mirror: ${JSON.stringify(names(theirs))}\n      (a section this form owns must be declared in its \`floor_only\` frontmatter)`);
    return findings;
  }
  for (const [i, want] of theirs.entries()) {
    if (JSON.stringify(mine[i]) === JSON.stringify(want)) continue;
    findings.push(`AS-R15: ${label} · ${want.name}: asks for a different shape than the template it mirrors (form ${JSON.stringify(mine[i])}, template ${JSON.stringify(want)}) — a column dropped from a floor table is a column the record will be missing`);
  }
  return findings;
}

/**
 * Findings for one catalog-B form. `mirrorText` is the git template it names, or null when that
 * file could not be read — which is itself a finding, not a reason to skip the parity check.
 */
export function checkForm(name, text, mirrorText) {
  const at = `${CATALOG_DIR}/${name}`;
  if (!isStr(text)) return [`AS-R11: ${at}: unreadable or empty — a form that cannot be read cannot be shown to carry its banner`];

  const findings = [];
  const fm = frontmatterOf(text);
  if (String(fm.catalog || '').toUpperCase() !== CATALOG) {
    findings.push(`AS-R11: ${at}: frontmatter declares catalog ${JSON.stringify(fm.catalog ?? null)}, not ${JSON.stringify(CATALOG)} — the catalog decides which gate reads this form, and an undeclared form is read by none`);
  }
  if (fm.write_class !== WRITE_CLASS) {
    findings.push(`AS-R11: ${at}: frontmatter declares write_class ${JSON.stringify(fm.write_class ?? null)}, not ${JSON.stringify(WRITE_CLASS)} — the generated floor form takes its banner from this field, so an undeclared form ships a banner that promises the author nothing`);
  }

  const banner = bannerBlockOf(text);
  if (banner === '') {
    // One problem, one finding. Listing every requirement against a file with no banner at all
    // would read as several defects and hide that there is one thing to do.
    findings.push(`AS-R12: ${at}: no banner at all — the file opens straight into its sections. A catalog-B form's leading block must carry ${BANNER_REQUIREMENTS.map((r) => r.want).join(', ')}. ${BANNER_REQUIREMENTS[0].why}`);
  } else {
    for (const r of BANNER_REQUIREMENTS) {
      if (r.re.test(flat(banner))) continue;
      findings.push(`${r.code}: ${at}: the banner does not carry ${r.want}${r.re.test(flat(text)) ? ' — it appears further down the file, which is too late: an author meets it after writing, not before' : ''}. ${r.why}`);
    }
  }

  // The mirror. A form that cannot say which git artifact it produces cannot be checked against
  // one, and an unchecked form is exactly the hand-maintained page D3.1 was written about.
  if (!isStr(fm.mirrors)) {
    findings.push(`AS-R14: ${at}: names no \`mirrors\` template in its frontmatter — a decision-routed form produces a git artifact, and one that will not say which cannot be kept in step with it`);
    return findings;
  }
  if (fm.mirrors.includes('..') || fm.mirrors.startsWith('/')) {
    findings.push(`AS-R14: ${at}: mirrors ${JSON.stringify(fm.mirrors)}, a path that escapes the repository — a mirror is a file in this tree or it is not a mirror`);
    return findings;
  }
  if (banner !== '' && !flat(banner).includes(fm.mirrors)) {
    findings.push(`AS-R14: ${at}: the banner does not name \`${fm.mirrors}\` — frontmatter is for the gate, the banner is for the author. Someone filling this in should be able to see which artifact their words end up in`);
  }
  if (!isStr(mirrorText)) {
    findings.push(`AS-R14: ${at}: its mirrored template ${fm.mirrors} does not exist or cannot be read — the pair is broken, not merely stale`);
    return findings;
  }

  const floorOnly = new Set(String(fm.floor_only || '').split(/\s*·\s*|\s*,\s*/).map((s) => s.trim()).filter(Boolean));
  findings.push(...mirrorDrift(text, mirrorText, floorOnly, at));
  return findings;
}

/**
 * Pure. Everything this gate decides, decided over content already read.
 *
 *   surfaces: [{ name, surface }]            — `floor/approvals/*.json`
 *   plans:    [{ change_id, plan }]          — the compiled control plans found in the repo
 *   forms:    [{ name, text, mirror }]       — `floor/catalog-b/*.md` + the template each names
 */
export function evaluate({ surfaces = [], plans = [], forms = [] } = {}) {
  const findings = [];
  const byChange = new Map(plans.filter((p) => isStr(p.change_id)).map((p) => [p.change_id, p.plan]));

  for (const { name, surface } of surfaces) {
    const at = `${SURFACE_DIR}/${name}`;
    if (!surface || typeof surface !== 'object') {
      findings.push(`AS-R10: ${at}: not readable as a JSON object`);
      continue;
    }
    const plan = byChange.get(surface.change_id);
    if (!plan) {
      // No plan, no coverage claim — and `verifyApprovalSurface(surface, null)` says so too, so
      // the surface is still checked rather than skipped.
      findings.push(`AS-R10: ${at}: names change ${JSON.stringify(surface.change_id ?? null)}, and no compiled control plan under ${CHANGES_DIR} names it — a surface derived from a plan nobody can find is a page drawn by hand`);
    }
    findings.push(...verifyApprovalSurface(surface, plan ?? null, at));
  }

  for (const f of forms) findings.push(...checkForm(f.name, f.text, f.mirror));
  return { findings, surfaces: surfaces.length, forms: forms.length, plans: byChange.size };
}

/** Every compiled control plan in the repo, keyed by the change it belongs to. */
export function loadPlans(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const base = `${dir}/${name}`;
    let stat;
    try { stat = statSync(base); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const envelope = readJson(`${base}/change-envelope.json`);
    const plan = readJson(`${base}/${envelope?.control_plan || 'control-plan.json'}`);
    if (plan && isStr(plan.change_id)) out.push({ change_id: plan.change_id, plan });
  }
  return out;
}

export function run(cwd = process.cwd()) {
  const surfaceDir = `${cwd}/${SURFACE_DIR}`;
  const surfaces = existsSync(surfaceDir)
    ? readdirSync(surfaceDir).filter((n) => n.endsWith('.json')).sort()
      .map((n) => ({ name: n, surface: readJson(`${surfaceDir}/${n}`) }))
    : [];

  const catalogDir = `${cwd}/${CATALOG_DIR}`;
  const forms = existsSync(catalogDir)
    ? readdirSync(catalogDir).filter((n) => n.endsWith('.md')).sort().map((n) => {
      const text = readText(`${catalogDir}/${n}`);
      const mirrors = isStr(text) ? frontmatterOf(text).mirrors : null;
      const safe = isStr(mirrors) && !mirrors.includes('..') && !mirrors.startsWith('/');
      return { name: n, text, mirror: safe ? readText(`${cwd}/${mirrors}`) : null };
    })
    : [];

  return evaluate({ surfaces, plans: loadPlans(cwd), forms });
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, surfaces, forms } = run();
  if (findings.length) {
    process.stderr.write('\nApproval-surface gate (D5.1 · D5.4) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nAn approvals surface is DERIVED from the compiled control plan, and a catalog-B\nform mirrors the git template it produces. Regenerate the surface\n(`node core/floor-approval-surface.mjs <control-plan.json> <PA1|PA2>`) and bring\nthe form back into step — a page that asks the wrong people, or asks for the\nwrong things, fails at the gate instead, for a role nobody was asked about.\n');
    process.exit(1);
  }
  if (!surfaces && !forms) {
    process.stdout.write('Approval-surface gate (D5.1 · D5.4) — no approval surfaces and no catalog-B forms (WS5\'s floor surfaces are not adopted)\n');
  } else {
    process.stdout.write(`Approval-surface gate (D5.1 · D5.4) — OK (${surfaces} approval surface${surfaces === 1 ? '' : 's'} against their compiled plans, ${forms} catalog-B form${forms === 1 ? '' : 's'} in step with the templates they mirror)\n`
      + 'This says the pages bind the compiled roles, carry their evidence in, and are\nlabelled non-authoritative. It does NOT say approvals work: WS5\'s entry gate has\nnot passed, and the decision of record is a signed envelope, never a page.\n');
  }
}
