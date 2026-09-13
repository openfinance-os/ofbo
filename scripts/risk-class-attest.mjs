// risk-class-attest — write (and optionally sign) the risk-class record for a governed change
// (2.1.0, hardening plan row 2.8). The record is the compiler's decision leaving the tree: the tier,
// the plan hash, the profile inputs, the flags, the classifier. Unsigned it is a draft the envelope
// gate can compare with the plan; signed — with a key that lives where the runner is, never in the
// tree — it is the attestation kosli-attest posts (phase 2 proper).
//
//   node scripts/risk-class-attest.mjs docs/governance/changes/<CHG>            write a draft
//   node scripts/risk-class-attest.mjs <dir> --issuer ci-runner --key path.pem  write it signed
//   node scripts/risk-class-attest.mjs <dir> --verify [--draft]                 verify against the plan
//                                                                             (--draft: accept an unsigned record — a shape check, never evidence)
//
// Exit 0 on success, 1 on a verification finding, 2 on usage.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { buildRiskClassRecord, RECORD_FILE, signRiskClass, verifyRiskClass } from '../core/risk-class-attestation.mjs';
import { compile, planHash, resolveProfileContext } from '../core/policy-compiler.mjs';
import { loadIssuers } from '../core/attestations.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Build the draft for a change directory; findings when the envelope or plan cannot be read. */
export function draft(changeDir, { cwd = process.cwd(), compiledAt = new Date().toISOString() } = {}) {
  const envelope = readJson(join(changeDir, 'change-envelope.json'));
  if (!envelope) return { record: null, findings: [`${changeDir}: no parseable change-envelope.json`] };
  const plan = readJson(join(changeDir, envelope.control_plan || 'control-plan.json'));
  if (!plan) return { record: null, findings: [`${changeDir}: no stored control plan — run the policy compiler first`] };
  const context = resolveProfileContext(envelope, cwd);
  const findings = [...context.findings];
  let freshPlan = null;
  if (!findings.length) {
    const compiled = compile(context.envelope, context.profiles, context.bindings);
    findings.push(...compiled.findings);
    freshPlan = compiled.plan;
  }
  if (planHash(plan) !== plan.plan_hash) findings.push('the stored control plan does not match its own plan_hash — recompile before attesting');
  if (freshPlan && freshPlan.plan_hash !== plan.plan_hash) findings.push('the stored control plan does not reconcile with current profile policy — recompile before attesting');
  if (findings.length) return { record: null, envelope, plan, findings };
  return { record: buildRiskClassRecord(envelope, plan, { compiledAt }), envelope, plan, findings: [] };
}

/** Verify the stored record against the stored plan, a fresh compile, the envelope and the issuers. */
export function verifyStored(changeDir, { cwd = process.cwd(), now = Date.now(), requireSignature = true } = {}) {
  const notices = [];
  const rec = readJson(join(changeDir, RECORD_FILE));
  if (!rec) return { findings: [`${changeDir}: no ${RECORD_FILE}`], notices };
  const envelope = readJson(join(changeDir, 'change-envelope.json'));
  const plan = envelope ? readJson(join(changeDir, envelope.control_plan || 'control-plan.json')) : null;
  let freshPlan = null;
  const compilationFindings = [];
  if (envelope) {
    const context = resolveProfileContext(envelope, cwd);
    compilationFindings.push(...context.findings.map((finding) => `fresh compile blocked: ${finding}`));
    if (!context.findings.length) {
      const compiled = compile(context.envelope, context.profiles, context.bindings);
      freshPlan = compiled.plan;
      compilationFindings.push(...compiled.findings.map((finding) => `fresh compile blocked: ${finding}`));
    }
  }
  return { findings: [...compilationFindings, ...verifyRiskClass(rec, { plan, freshPlan, envelope, issuers: loadIssuers(cwd), now, notices, requireSignature })], notices };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('--'));
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (!dir || !existsSync(dir)) { process.stderr.write('usage: node scripts/risk-class-attest.mjs <change-dir> [--issuer <id> --key <pem-file>] [--verify]\n'); process.exit(2); }
  if (argv.includes('--verify')) {
    const draftOk = argv.includes('--draft');
    const { findings, notices } = verifyStored(dir, { requireSignature: !draftOk });
    for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
    if (findings.length) { process.stderr.write('\nRisk-class attestation — FAIL\n\n'); for (const f of findings) process.stderr.write(`  - ${f}\n`); process.exit(1); }
    process.stdout.write(`Risk-class attestation — OK (record matches the stored plan, a fresh compile and the envelope${draftOk ? '; UNSIGNED draft accepted by --draft, not evidence' : ''})\n`);
  } else {
    const { record, findings } = draft(dir);
    if (findings.length) { for (const f of findings) process.stderr.write(`  - ${f}\n`); process.exit(1); }
    const issuer = opt('--issuer'), key = opt('--key');
    const out = issuer && key ? signRiskClass(record, { issuer, privateKeyPem: readFileSync(key, 'utf8') }) : record;
    writeFileSync(join(dir, RECORD_FILE), JSON.stringify(out, null, 2) + '\n');
    process.stdout.write(`${out.attestation ? 'signed' : 'DRAFT (unsigned)'} risk-class record → ${join(dir, RECORD_FILE)} (tier ${out.risk_tier}, plan ${String(out.plan_hash).slice(0, 12)}…)\n`);
  }
}
