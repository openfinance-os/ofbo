// The residency sign-off gate (Factory Floor WS0 · D0.1 / P1) — filesystem half.
//
//   node scripts/residency-check.mjs
//
// The reasoning, and what this can and cannot prove, is in core/residency.mjs. This file only
// locates the record, the registry and any live-floor artifacts, and hands them to the pure
// evaluator. No network, no clock beyond the date already written in the record.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  APPROVAL_SCHEMA, CAPABILITY, FLOOR_EVIDENCE, approvalsSigned, evaluate, evaluateApprovals,
  isSigned, parseSignoff,
} from '../core/residency.mjs';
import { loadIssuers, verifySignatureOver } from '../core/attestations.mjs';
import { loadAssertionIssuers, sha256 } from '../core/approval-attestations.mjs';
import { loadRegistry } from './identity-registry-check.mjs';

/** rc.36: the SIGNED record. When present it is the record of decision; the markdown fallback
 * below is deprecated and kept for exactly one release. */
export const APPROVAL_LOCATION = 'docs/governance/residency-approval.json';

/** Where an adopting repo may keep the (deprecated) markdown record. First hit wins. */
export const RECORD_LOCATIONS = [
  'docs/governance/residency-review.md',
  'docs/notion-floor-residency-review.md',
  'docs/residency-review.md',
];

export const CHANGES_DIR = 'docs/governance/changes';

export function loadRecord(cwd = process.cwd()) {
  const path = RECORD_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  return path ? readFileSync(path, 'utf8') : null;
}

/** Live-floor artifacts actually present — NOT the shipped catalogs (see FLOOR_EVIDENCE). */
export function floorArtifactsIn(cwd = process.cwd()) {
  return FLOOR_EVIDENCE.filter((p) => existsSync(`${cwd}/${p}`));
}

/** Mandatory-when-compiled: does any compiled change plan require residency approval? */
export function residencyRequired(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return false;
  let entries = [];
  try { entries = readdirSync(dir); } catch { return false; }
  for (const name of entries) {
    const plan = `${dir}/${name}/control-plan.json`;
    if (!existsSync(plan)) continue;
    try {
      const p = JSON.parse(readFileSync(plan, 'utf8'));
      if (p?.required_capabilities?.[CAPABILITY]?.required) return true;
    } catch { /* an unparseable plan is the change-envelope gate's finding, not this one */ }
  }
  return false;
}

export function run(cwd = process.cwd()) {
  const floorArtifacts = floorArtifactsIn(cwd);
  const required = residencyRequired(cwd);
  const notices = [];

  // rc.36: the signed JSON record is authoritative when present — verified through the approval-
  // attestation core's ONE stack (demo keys, revoked issuers and validity windows all refused).
  const approvalPath = `${cwd}/${APPROVAL_LOCATION}`;
  if (existsSync(approvalPath)) {
    let approval = null;
    try { approval = JSON.parse(readFileSync(approvalPath, 'utf8')); } catch { /* falls through to the schema finding */ }
    return {
      findings: evaluateApprovals(approval, {
        registry: loadRegistry(cwd),
        assertionIssuers: loadAssertionIssuers(cwd),
        serviceIssuers: loadIssuers(cwd),
        floorArtifacts,
        required,
        verify: verifySignatureOver,
        sha256,
      }),
      approval,
      record: null,
      floorArtifacts,
      notices,
    };
  }

  const record = loadRecord(cwd);
  if (record !== null) {
    notices.push(`the residency record is a markdown table — DEPRECATED (rc.36). A table cell confirms a decision was transcribed, not signed. Migrate to ${APPROVAL_LOCATION} (schema ${APPROVAL_SCHEMA}: {role, registry_id, verdict, decided_at, assertion} per role, verified through the approval-attestation core); the parser remains for this release only`);
  }
  return {
    findings: evaluate({
      record,
      registry: loadRegistry(cwd),
      floorArtifacts,
      required,
    }),
    approval: null,
    record,
    floorArtifacts,
    notices,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, approval, record, floorArtifacts, notices } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nResidency sign-off gate (WS0 · D0.1 · P1) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nP1 requires data-protection and risk-second-line approval as a signed record\n'
      + 'in git. Two different people, each resolving to a registry identity holding the named\n'
      + 'role, and builders may not sign. Route it with the reviewer brief and decision worksheet;\n'
      + 'never fill a signature cell on someone else\'s behalf.\n');
    process.exit(1);
  }
  if (approval) {
    const who = (approval.approvals || []).map((e) => `${e.role}=${e.registry_id}`).join(' · ');
    process.stdout.write(`Residency sign-off gate (WS0 · D0.1) — ${approvalsSigned(approval) ? `SIGNED (${who})` : 'record present and not yet decided by both roles; nothing depends on it yet'}${floorArtifacts.length ? ` · floor in use: ${floorArtifacts.length} artifact path(s)` : ''}. OK\n`);
  } else if (record === null) {
    process.stdout.write('Residency sign-off gate (WS0 · D0.1) — no residency record, no floor in use, and no compiled plan requires one. OK\n');
  } else if (isSigned(parseSignoff(record))) {
    const who = parseSignoff(record).rows.map((r) => `${r.role}=${r.identity}`).join(' · ');
    process.stdout.write(`Residency sign-off gate (WS0 · D0.1) — SIGNED (${who})${floorArtifacts.length ? ` · floor in use: ${floorArtifacts.length} artifact path(s)` : ''}. OK\n`);
  } else {
    process.stdout.write('Residency sign-off gate (WS0 · D0.1) — record present and not yet signed; no floor is in use, so nothing is blocked yet. OK\n');
  }
}
