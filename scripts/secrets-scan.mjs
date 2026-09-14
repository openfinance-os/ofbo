// Q4 — the secrets gate, history-aware. A secret that was committed and then deleted is
// still leaked: it lives in every clone's history until rotated. So this gate scans BOTH
// the current tree and the reachable git history for secret-shaped content, and fails on
// either — the fix for a historical hit is rotation, not deletion.
//
// Patterns are deliberately high-precision (provider-prefixed tokens, key blocks, assigned
// credentials) — a secrets gate that cries wolf gets disabled. A line carrying the marker
// `loom-allow-secret` is an explicit, visible, reviewable exemption (e.g. test fixtures);
// placeholder values (example/changeme/your-/xxx/<...>) are ignored.
//
// Run from the repo root: `node scripts/secrets-scan.mjs [--no-history] [--depth N]`.
// Exit 1 on findings; exit 2 when history was requested but there is no git repo.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const ALLOW_MARKER = 'loom-allow-secret';
export const HISTORY_DEPTH = 400; // ADOPT: commits of history to scan (--depth overrides)

export const PATTERNS = [
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'gcp-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'assigned-credential', re: /\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|password|auth[_-]?token)\b['"]?\s*[:=]\s*['"][A-Za-z0-9+/_-]{16,}['"]/i },
];

const PLACEHOLDER = /example|placeholder|changeme|your[-_]|xxxx|dummy|<[^>]+>|\$\{|%s\b/i;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp[34]|mov|glb|wasm)$/i;

/** Findings for one blob of text. `where` labels the source (path or commit:path). */
export function scanText(text, where = '') {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARKER)) continue;
    for (const { name, re } of PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      if (name === 'assigned-credential' && PLACEHOLDER.test(m[0])) continue;
      findings.push(`${where}:${i + 1} — ${name} (${m[0].slice(0, 12)}…)`);
    }
  }
  return findings;
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });

export function scanTree() {
  const findings = [];
  const names = git(['ls-files']).trimEnd().split('\n');
  for (const name of names) {
    if (!name || BINARY_EXT.test(name)) continue;
    try {
      if (statSync(name).size > 1024 * 1024) continue; // large blobs: not source
      findings.push(...scanText(readFileSync(name, 'utf8'), name));
    } catch { /* unreadable ⇒ skip */ }
  }
  return findings;
}

export function scanHistory(depth = HISTORY_DEPTH) {
  // Scan ADDED lines in recent history; a hit that is gone from the tree is still a leak.
  const log = git(['log', `-n${depth}`, '-p', '--no-color', '--unified=0', '--pretty=format:@@commit %h']);
  const findings = [];
  let commit = '?', file = '?';
  for (const raw of log.split('\n')) {
    if (raw.startsWith('@@commit ')) { commit = raw.slice(9); continue; }
    if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    for (const f of scanText(raw.slice(1), `${commit}:${file}`)) {
      findings.push(`${f} — in HISTORY: deleting is not enough, ROTATE the credential`);
    }
  }
  return [...new Set(findings)];
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv;
  const noHistory = argv.includes('--no-history');
  const di = argv.indexOf('--depth');
  const depth = di >= 0 ? Number(argv[di + 1]) || HISTORY_DEPTH : HISTORY_DEPTH;
  try { git(['rev-parse', '--git-dir']); }
  catch {
    process.stderr.write('Secrets gate (Q4) — CANNOT VERIFY: not a git checkout.\n');
    process.exit(2);
  }
  const findings = [...scanTree(), ...(noHistory ? [] : scanHistory(depth))];
  if (findings.length) {
    process.stderr.write('\nSecrets gate (Q4, history-aware) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write(`\nA committed secret is leaked even after deletion — rotate it, then rewrite or accept\nthe history. A deliberate fixture carries the ${ALLOW_MARKER} marker in the open.\n`);
    process.exit(1);
  }
  process.stdout.write(`Secrets gate (Q4) — OK (tree${noHistory ? '' : ` + ${depth}-commit history`})\n`);
}
