// The personal-data smell test (Factory Floor WS3 · D3.3). Catalog C — the artifacts that live on
// the floor and are never frozen — is where prose about PEOPLE gets written: who attended, what a
// customer said, an interviewee's circumstances. Nothing freezes it, so no export gate ever reads
// it, so the only controls it will ever have are the template's own discipline and a human who
// looks. This module is the third thing: a shape-matcher a floor-keeper, a freezer, or a reviewer
// can run over a block of text before it goes any further.
//
// READ THIS BEFORE YOU CALL IT.
//
// IT IS HEURISTIC AND DIRECTIONAL. It can raise a finding. It can NEVER say a text is clean. Those
// two sentences are not symmetric and the asymmetry is the whole design: a match means "a human
// should look at this"; zero matches means "zero SHAPES matched", which is a statement about this
// module's regular expressions and nothing whatsoever about the text. An Emirates ID has a shape.
// A customer's name inside a sentence does not, and no amount of pattern tuning will give it one.
//
// SO THERE IS NO PASS. The result object carries `assurance: 'none'` whether it found six things
// or none, it carries its own limits in the payload, and this module deliberately exports no
// `isClean`, no `isSafe`, no `certify`, no boolean that reads as a clearance — because the moment
// such a function exists, somewhere downstream a gate prints "PII: clean" over text nobody read.
// The affirmative is not available here on purpose. `hasFindings()` is the only predicate, and it
// only ever answers the negative direction.
//
// NOTHING IS SUPPRESSED. Values written to this repo's synthetic conventions (a `999`-prefixed
// national id, an `AE..000…` IBAN, a reserved-domain address, a line tagged `[synthetic]`) are
// flagged `synthetic: true` and STILL reported. Callers may choose not to fail on them; the scan
// does not choose for them, because a filter whose silence cannot be distinguished from absence is
// how a real value gets through wearing a synthetic marker.
//
// PURE. No filesystem, no clock, no network, no state. Text in, findings out — which is what makes
// it callable from a gate, from a hook, and from an adopter's floor-keeper alike.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCHEMA_ID = 'loom.pii-scan/v1';

/** The only value this field ever takes. There is no `assurance: 'clean'` and never will be. */
export const ASSURANCE = 'none';

export const NO_ASSURANCE = Object.freeze(
  'This scan raises findings. It never certifies text as clean. Zero findings means zero shapes '
  + 'matched these patterns — it is not a clearance, and no gate, log line, dashboard or reviewer '
  + 'may report it as one.',
);

/** What the scan cannot see. Carried in every result, including the empty ones. */
export const LIMITS = Object.freeze([
  'It matches shapes, not meaning. A name in a sentence, a diagnosis, a job history, a home town, '
  + 'an unusual circumstance that identifies one person in a segment of four — none of these has a '
  + 'shape, and none of them is detected here.',
  'It reads the text it is handed. Attachments, screenshots, images, linked pages, comment threads, '
  + 'page history and anything a person said out loud are outside it entirely.',
  'The identifier patterns are a jurisdiction instance (UAE-shaped national id and IBAN by default). '
  + 'ADOPT: add the shapes of the jurisdictions you actually operate in — an unlisted shape is not a '
  + 'weaker finding, it is no finding at all.',
  'A finding is directional, not a verdict: it may be synthetic, a template placeholder, a product '
  + 'code or a coincidence. A human dispositions it. The scan never dispositions itself.',
  'It sees one text at a time and cannot see aggregation — four withheld details across four notes '
  + 'that identify one person between them is invisible to every pattern below.',
]);

/**
 * Detector classes. Ordered: an earlier detector's match claims its span, so a phone number is not
 * also reported as a long digit run and an IBAN is not also reported as a phone number. Reordering
 * this list changes which code a value is reported under — which is why it is a list, not a map.
 *
 * OVERLAPS `floor-project.mjs`'s `PROHIBITED`, deliberately and with different regexes. That module
 * BLOCKS git → floor and is tuned for low false positives, because a hit withholds a whole record.
 * This one ADVISES over floor-authored prose and is tuned for high recall, because a hit only asks a
 * human to look. One shared table would force one of the two to adopt the wrong tolerance, so they
 * stay separate and the relationship between them is asserted as a test instead: the advisory net
 * must never be narrower than the blocking one for personal-data shapes. Credentials — private keys,
 * bearer tokens — are intentionally NOT detected here: they are not personal data, and the Q4
 * secrets gate owns them.
 */
export const DETECTORS = Object.freeze([
  {
    code: 'PII-R01',
    id: 'email-address',
    label: 'an email address',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}\b/g,
    why: 'a direct identifier, and the one people paste without thinking because it reads as a routing label rather than as personal data',
  },
  {
    code: 'PII-R02',
    id: 'iban',
    label: 'an IBAN-shaped string',
    re: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){10,30}\b/g,
    why: 'a financial identifier, prohibited outright on the floor — real or realistic, with no fidelity ceiling and no approval path',
  },
  {
    code: 'PII-R03',
    id: 'national-identifier',
    label: 'a national-identifier-shaped string',
    re: /\b\d{3}[\s.-]?\d{4}[\s.-]?\d{7}[\s.-]?\d\b/g,
    why: 'the 3-4-7-1 grouping of an Emirates ID. ADOPT: this is one jurisdiction’s shape — add yours',
  },
  {
    code: 'PII-R04',
    id: 'telephone-number',
    label: 'a telephone number',
    re: /(?:\+\d{1,3}[\s().-]{0,2}\d(?:[\s().-]?\d){6,13}|\b0\d(?:[\s.-]?\d){7,12})\b/g,
    digits: [9, 15],
    why: 'contact detail — a direct identifier that also happens to be a way to reach the person without going through anyone',
  },
  {
    code: 'PII-R05',
    id: 'long-digit-run',
    label: 'a long run of digits',
    re: /\b\d(?:[ -]?\d){11,}\b/g,
    digits: [12, 34],
    why: 'account numbers, card PANs, customer reference numbers and case ids all look like this, and none of them belongs on a collaboration surface',
  },
  {
    code: 'PII-R06',
    id: 'titled-name',
    label: 'a personal title followed by a name',
    re: /\b(?:Mr|Mrs|Ms|Mx|Miss|Dr|Professor|Prof|Sheikha|Sheikh|Sir|Dame|Eng|Capt|Rev|Hon)\b\.?\s+[A-Z][\p{L}'’-]+(?:\s+(?:[A-Z]\.|[A-Z][\p{L}'’-]+|al[- ][A-Z]?[\p{L}]+|bin|bint|van|von|de))*/gu,
    why: 'the one unstructured shape worth chasing: a title is the tell that the words after it are a person, and it is how a real name gets into a note that was supposed to carry a role',
  },
]);

/**
 * Conventions this repository already uses to mark a value as fabricated (`hooks/pii-guard.sh`,
 * the `[synthetic]` tag in `discovery/templates/research-log.md`, and the reserved documentation
 * domains of RFC 2606). A match against one of these is FLAGGED, not hidden — see the header.
 */
const RESERVED_DOMAINS = /@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|example|invalid|test|localhost)$/i;
const SYNTHETIC_LINE = /\[synthetic\]/i;

const digitsOf = (s) => (String(s).match(/\d/g) || []).length;

/** Does this match use one of the conventions above? Reported, never suppressed. */
function looksSynthetic(detectorId, value, line) {
  if (SYNTHETIC_LINE.test(line)) return true;
  const bare = String(value).replace(/[\s.-]/g, '');
  switch (detectorId) {
    // `hooks/pii-guard.sh`: real Emirates IDs start 784; synthetic fixtures use the 999 prefix.
    case 'national-identifier': return bare.startsWith('999');
    // `hooks/pii-guard.sh`: a synthetic UAE IBAN carries bank code 000 (AEkk000…).
    case 'iban': return /^AE\d{2}000/.test(bare.toUpperCase());
    case 'email-address': return RESERVED_DOMAINS.test(String(value));
    default: return false;
  }
}

/**
 * A finding names WHERE, never WHAT. Reprinting the matched value would copy the disclosure into
 * the CI log, the pull-request comment and the reviewer's scrollback — three more places holding
 * personal data because something objected to it being in one. Line and column locate it exactly;
 * the person who opens the file can see it, and nobody else has to.
 */
export const redact = (value) => {
  const n = String(value).length;
  return `${'•'.repeat(Math.min(Math.max(n, 1), 12))} (${n} chars, value withheld)`;
};

/**
 * Scan one block of text.
 *
 * Returns `{ schema, where, findings, detectors_run, assurance, statement, limits }`. There is no
 * boolean in that shape and no field a caller can print as a pass — see the header. `findings` is
 * `[]` when nothing matched, and `[]` means exactly that: nothing matched.
 */
export function scanText(text, { where = '' } = {}) {
  const src = typeof text === 'string' ? text : '';
  const findings = [];
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const claimed = [];
    for (const d of DETECTORS) {
      // Fresh lastIndex per line: the /g regexes are module-level constants and would otherwise
      // carry state between lines and between calls — which would make this function impure in
      // the one way that is hardest to notice.
      d.re.lastIndex = 0;
      let m;
      while ((m = d.re.exec(line)) !== null) {
        if (m[0].length === 0) { d.re.lastIndex++; continue; }
        const start = m.index;
        const end = start + m[0].length;
        if (d.digits) {
          const n = digitsOf(m[0]);
          if (n < d.digits[0] || n > d.digits[1]) continue;
        }
        if (claimed.some(([s, e]) => start < e && end > s)) continue;
        claimed.push([start, end]);
        findings.push({
          code: d.code,
          detector: d.id,
          label: d.label,
          where,
          line: i + 1,
          column: start + 1,
          redacted: redact(m[0]),
          synthetic: looksSynthetic(d.id, m[0], line),
          why: d.why,
        });
      }
    }
  }

  // Document order, not detector order: a reader walks the note from the top, and a list that
  // jumps back up the page for the second detector reads as two reports stapled together.
  findings.sort((a, b) => a.line - b.line || a.column - b.column);

  return {
    schema: SCHEMA_ID,
    where,
    findings,
    detectors_run: DETECTORS.map((d) => d.code),
    // Constant. Present on empty results precisely so that an empty result cannot be read as a
    // different KIND of result from a full one.
    assurance: ASSURANCE,
    statement: NO_ASSURANCE,
    limits: LIMITS,
  };
}

/**
 * The only predicate this module offers, and it only answers in the direction the scan can answer.
 * `!hasFindings(r)` is not "clean" — it is "nothing matched", which is why there is no function
 * spelling the opposite.
 */
export const hasFindings = (result) => Array.isArray(result?.findings) && result.findings.length > 0;

/** Findings that did NOT carry a synthetic marker. The synthetic ones are still in `findings`. */
export const liveFindings = (result) => (result?.findings || []).filter((f) => !f.synthetic);

/** One line per finding, safe to print: it names the shape and the place, never the value. */
export const describe = (f) => `${f.code}: ${f.label} at ${f.where ? `${f.where} ` : ''}line ${f.line}:${f.column} — ${f.redacted}${f.synthetic ? ' [synthetic marker present]' : ''}`;

// CLI: scan a file, so an author can run the smell test over a note before it goes anywhere. Exit
// 1 on live findings, 0 otherwise — and the 0 prints the disclaimer, because the exit code is the
// part most likely to be read as a clearance.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node core/floor-pii.mjs <file>\n');
    process.exit(2);
  }
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const result = scanText(text, { where: path });
  for (const f of result.findings) process.stdout.write(`  - ${describe(f)}\n`);
  process.stdout.write(`\n${result.statement}\n\nWhat this scan cannot see:\n${result.limits.map((l) => `  - ${l}\n`).join('')}`);
  process.exit(liveFindings(result).length ? 1 : 0);
}
