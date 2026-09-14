// Tests for the policy compiler. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { compile, loadProfiles, resolveBindings, resolveProfileContext, automaticRuleFindings, automaticRuleMatches, canonical, planHash, TIERS, mergeCapabilities } from './policy-compiler.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profile = (p) => JSON.parse(readFileSync(`${HARNESS}/profiles/${p}.json`, 'utf8'));
const ALL = [profile('regulated-bank'), profile('jurisdictions/uae-bank'), profile('products/lending'), profile('products/payments')];

// EVERY shipped profile, DISCOVERED rather than listed. The monotonicity property below used to
// run over four NAMED profiles, so a profile added to the bundle was a profile the invariant never
// saw: every profile the Shari'ah work added or changed landed outside it, and one whose
// requirement value was not even iterable compiled nowhere the suite looked. What the property
// then proves for each profile is what it can honestly prove — that it compiles cleanly at every
// tier and flag combination, and that no tier drops what a lower one required. Enumeration is the
// fix, because the next profile is then covered on the day it is committed, by nobody remembering.
const PROFILE_DIRS = ['profiles', 'profiles/jurisdictions', 'profiles/products', 'profiles/institutions'];
const SHIPPED = PROFILE_DIRS.flatMap((dir) => readdirSync(`${HARNESS}/${dir}`)
  .filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ dir, name: f.replace(/\.json$/, ''), data: JSON.parse(readFileSync(`${HARNESS}/${dir}/${f}`, 'utf8')) })));
// Every flag any shipped profile reacts to, so a new conditional is exercised without being named.
const SHIPPED_FLAGS = [...new Set(SHIPPED.flatMap((p) => (p.data.conditional || []).map((c) => c.when)))].sort();

const envelope = (over = {}) => ({
  change_id: 'CHG-T-1', product_id: 'PRD-T', change_type: 'new-product', risk_tier: 'high',
  required_profiles: ['regulated-bank', 'uae-bank', 'lending'],
  flags: {}, ...over,
});

test('PROPERTY — monotonicity: a higher tier only ever ADDS requirements, for EVERY shipped profile', () => {
  // A discovery that finds nothing passes vacuously, which is the failure mode of enumerating by
  // path: assert each directory contributed before trusting a green result.
  for (const dir of PROFILE_DIRS) {
    assert.ok(SHIPPED.some((p) => p.dir === dir), `no profiles enumerated from ${dir} — an empty enumeration proves nothing`);
  }
  const base = SHIPPED.find((p) => p.name === 'regulated-bank').data;
  // Each profile ALONE (its own tiers must be monotone unaided), each one composed on the base
  // (composition must not break it), and all of them at once (the union of everything shipped).
  const combos = [
    ...SHIPPED.map((p) => [p.data]),
    ...SHIPPED.filter((p) => p.data !== base).map((p) => [base, p.data]),
    SHIPPED.map((p) => p.data),
  ];
  const flagSets = [{}, Object.fromEntries(SHIPPED_FLAGS.map((f) => [f, true])), ...SHIPPED_FLAGS.map((f) => ({ [f]: true }))];
  for (const profiles of combos) {
    for (const flags of flagSets) {
      let prev = null;
      for (const tier of TIERS) {
        const { plan, findings } = compile(envelope({ risk_tier: tier, change_type: tier === 'low' ? 'software-change' : 'new-product', flags }), profiles);
        assert.deepEqual(findings, []);
        if (prev) {
          for (const field of ['required_gates', 'required_approver_roles', 'required_evidence', 'pa1_sections', 'pa2_sections']) {
            for (const item of prev[field]) {
              assert.ok(plan[field].includes(item),
                `${tier} dropped ${field}:${item} required at a lower tier (profiles: ${profiles.map((p) => p.profile)}, flags: ${JSON.stringify(flags)})`);
            }
          }
        }
        prev = plan;
      }
    }
  }
});

test('PROPERTY — every shipped profile declares its requirements under a KNOWN tier', () => {
  // The compiler unions `requirements[tier]` by exact tier name, so a misspelled or invented tier
  // key is silently never compiled: a requirement that exists in the file, reads as governance in
  // review, and is enforced by nothing. Monotonicity cannot see it — the requirement never enters
  // any plan — so it is asserted here. `_`-prefixed keys are the file convention for comments.
  for (const p of SHIPPED) {
    for (const key of Object.keys(p.data.requirements || {})) {
      if (key.startsWith('_')) continue;
      assert.ok(TIERS.includes(key),
        `${p.dir}/${p.name}: requirements.${key} is not a tier (${TIERS.join('|')}) — nothing compiles it, so no gate can ever miss it`);
    }
  }
});

test('2.4 — automatic profile predicates are conjunctive and tier-aware', () => {
  const rule = {
    profile: 'ai-decision-system',
    when: {
      flags_all: ['model_involved'],
      change_types: ['new-product', 'material-product-change'],
      minimum_tier: 'medium',
    },
  };
  assert.equal(automaticRuleMatches(rule, envelope({ flags: { model_involved: true }, risk_tier: 'medium' })), true);
  assert.equal(automaticRuleMatches(rule, envelope({ flags: {}, risk_tier: 'high' })), false);
  assert.equal(automaticRuleMatches(rule, envelope({ flags: { model_involved: true }, change_type: 'software-change' })), false);
  assert.equal(automaticRuleMatches(rule, envelope({ flags: { model_involved: true }, change_type: 'software-change', risk_tier: 'low' })), false);
});

test('2.4 — malformed automatic profile rules fail closed with actionable findings', () => {
  const malformed = [
    {},
    { profile: 'ai-decision-system', when: { change_typse: ['new-product'] } },
    { profile: 'ai-decision-system', when: { change_types: ['invented-change'] } },
    { profile: 'ai-decision-system', when: { flags_all: [] } },
    { profile: 'ai-decision-system', when: { minimum_tier: 'urgent' } },
  ];
  for (const rule of malformed) {
    assert.ok(automaticRuleFindings(rule).length > 0, `expected findings for ${JSON.stringify(rule)}`);
    assert.equal(automaticRuleMatches(rule, envelope({ flags: { model_involved: true } })), false);
  }
});

test('2.4 — profile resolution surfaces malformed automatic policy instead of ignoring or crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-automatic-profile-'));
  try {
    mkdirSync(join(dir, 'profiles'));
    writeFileSync(join(dir, 'profiles', 'broken.json'), JSON.stringify({
      profile: 'broken',
      version: '1.0.0',
      automatic_profiles: [{ profile: 'ai-decision-system', when: { change_typse: ['new-product'] } }],
      requirements: {},
    }));
    const context = resolveProfileContext(envelope({ required_profiles: ['broken'] }), dir);
    assert.ok(context.findings.some((finding) => finding.includes('automatic_profiles[0]: unknown predicate change_typse')));
    assert.ok(!context.names.includes('ai-decision-system'));

    writeFileSync(join(dir, 'profiles', 'broken.json'), JSON.stringify({
      profile: 'broken', version: '1.0.0', automatic_profiles: {}, requirements: {},
    }));
    const nonArray = resolveProfileContext(envelope({ required_profiles: ['broken'] }), dir);
    assert.ok(nonArray.findings.some((finding) => finding.includes('automatic_profiles must be an array')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('2.4 — UAE model-involved product changes automatically compile the AI decision profile', () => {
  const input = envelope({
    required_profiles: ['regulated-bank', 'uae-bank', 'lending'],
    flags: { model_involved: true },
  });
  const context = resolveProfileContext(input, HARNESS);
  assert.deepEqual(context.findings, []);
  assert.ok(context.names.includes('ai-decision-system'), 'the route must not depend on a classifier remembering this profile');
  const { plan, findings } = compile(context.envelope, context.profiles, context.bindings);
  assert.deepEqual(findings, []);
  assert.ok(plan.profiles.includes('ai-decision-system'));
  assert.equal(plan.required_capabilities.ai_governance.required, true);
  assert.equal(plan.required_capabilities.fairness_evaluation.required, true);
  assert.equal(plan.required_capabilities.decision_contestability.required, true);
  assert.ok(plan.pa2_sections.includes('human-oversight'));
  assert.ok(plan.pa2_sections.includes('ai-disclosure'));
});

test('2.4 — automatic AI applicability is scoped to consumer-bearing product change types', () => {
  for (const change_type of ['documentation', 'software-change']) {
    const input = envelope({ change_type, required_profiles: ['regulated-bank', 'uae-bank'], flags: { model_involved: true } });
    const context = resolveProfileContext(input, HARNESS);
    assert.deepEqual(context.findings, []);
    assert.ok(!context.names.includes('ai-decision-system'), `${change_type} must not be treated as a customer decision system by inference alone`);
  }
});

test('PROPERTY — every automatic profile rule has a resolvable target and a known predicate shape', () => {
  for (const p of SHIPPED) for (const rule of p.data.automatic_profiles || []) {
    assert.equal(typeof rule.profile, 'string', `${p.name}: automatic profile target must be a string`);
    assert.ok(SHIPPED.some((candidate) => candidate.name === rule.profile), `${p.name}: automatic profile ${rule.profile} does not resolve`);
    assert.ok(rule.when && typeof rule.when === 'object', `${p.name}: automatic profile rule has no predicate`);
    for (const key of Object.keys(rule.when)) assert.ok(['flags_all', 'change_types', 'minimum_tier'].includes(key), `${p.name}: unknown automatic predicate ${key}`);
    for (const t of rule.when.change_types || []) assert.ok(['documentation', 'software-change', 'new-product', 'material-product-change'].includes(t), `${p.name}: unknown automatic change type ${t}`);
    if (rule.when.minimum_tier) assert.ok(TIERS.includes(rule.when.minimum_tier), `${p.name}: unknown automatic minimum tier ${rule.when.minimum_tier}`);
  }
});

test('rc.13 WS3 — a high-tier regulated change compiles the data_risk_register + model_risk capabilities', () => {
  const { plan } = compile(envelope({ risk_tier: 'high' }), ALL.slice(0, 3));
  assert.equal(plan.required_capabilities.data_risk_register.required, true);
  assert.equal(plan.required_capabilities.data_risk_register.minimum_version, '3.1');
  assert.equal(plan.required_capabilities.data_risk_register.institution_owned, true);
  assert.equal(plan.required_capabilities.model_risk.required, true);
});

test('rc.13 WS3 — a low-tier software change does NOT compile the register capability (light path)', () => {
  const { plan } = compile(envelope({ change_type: 'software-change', risk_tier: 'low', required_profiles: ['regulated-bank'] }), [ALL[0]]);
  assert.ok(!plan.required_capabilities.data_risk_register, 'a low-tier change should not require the data-risk register');
});

test('rc.13 WS3 — mergeCapabilities is strongest-wins: version max, tier max, required/institution_owned OR', () => {
  const m = mergeCapabilities({}, { x: { required: false, minimum_version: '3.0', minimum_tier: 'low' } });
  mergeCapabilities(m, { x: { required: true, minimum_version: '3.10', minimum_tier: 'high', institution_owned: true } });
  assert.deepEqual(m.x, { required: true, minimum_version: '3.10', minimum_tier: 'high', institution_owned: true });
});

test('PROPERTY — capabilities are monotonic: never dropped and attributes only strengthen up the tiers', () => {
  let prev = null;
  for (const tier of TIERS) {
    const { plan } = compile(envelope({ risk_tier: tier, change_type: tier === 'low' ? 'software-change' : 'new-product' }), ALL.slice(0, 3));
    if (prev) {
      for (const [name, spec] of Object.entries(prev.required_capabilities)) {
        assert.ok(plan.required_capabilities[name], `${tier} dropped capability ${name}`);
        if (spec.required) assert.equal(plan.required_capabilities[name].required, true, `${tier} un-required ${name}`);
      }
    }
    prev = plan;
  }
});

test('rc.13 WS3.3 — product-type profiles compile DIFFERENT capabilities', () => {
  const compileWith = (names) => compile(
    envelope({ risk_tier: 'high', required_profiles: ['regulated-bank', 'uae-bank', ...names] }),
    [profile('regulated-bank'), profile('jurisdictions/uae-bank'), ...names.map((n) => profile(`products/${n}`))],
  ).plan.required_capabilities;

  const islamic = compileWith(['islamic-product']);
  assert.equal(islamic.shariah_governance.required, true, 'an Islamic product must require Shari’ah governance');

  const ai = compileWith(['ai-decision-system']);
  assert.equal(ai.human_oversight.required, true, 'an AI decision system must require human oversight');
  assert.equal(ai.model_risk.minimum_tier, 'high', 'an AI decision system raises the model-risk floor');

  const of = compileWith(['open-finance']);
  assert.equal(of.consent_management.required, true);
  assert.equal(of.tpp_due_diligence.required, true);
  assert.ok(!of.shariah_governance, 'a non-Islamic product does not require Shari’ah governance');

  // Composition: an Islamic consumer-lending product carries BOTH profiles' capabilities.
  const both = compileWith(['consumer-lending', 'islamic-product']);
  assert.equal(both.consumer_credit_risk.required, true);
  assert.equal(both.shariah_governance.required, true);
});

// ---- Shari'ah governance (WS3.3, extended). The vocabulary is the three LINES, and the tests
// pin it because the failure mode is a rename: a profile that says `shariah-board` compiles a
// role no identity registry holds, and an unheld role is an approval nobody can give. ----

/** Compile the FULL plan for a set of product profiles over base + jurisdiction. */
const planWith = (names, flags = {}, tier = 'high') => compile(
  envelope({ risk_tier: tier, flags, required_profiles: ['regulated-bank', 'uae-bank', ...names] }),
  [profile('regulated-bank'), profile('jurisdictions/uae-bank'), ...names.map((n) => profile(`products/${n}`))],
).plan;

test('WS3.3 — islamic-product compiles the THREE canonical roles, and shariah-audit binds at PA2 only', () => {
  const plan = planWith(['islamic-product']);
  for (const r of ['shariah-committee', 'shariah-compliance', 'shariah-audit']) {
    assert.ok(plan.required_approver_roles.includes(r), `islamic-product must compile ${r}`);
  }
  assert.ok(!plan.required_approver_roles.includes('shariah-board'), 'shariah-board is retired vocabulary');
  assert.ok(plan.pa1_approver_roles.includes('shariah-committee'));
  assert.ok(plan.pa1_approver_roles.includes('shariah-compliance'));
  // Third-line audit certifies what was built; binding it at permission-to-develop would make
  // the assurer a party to the thing it later assures.
  assert.ok(!plan.pa1_approver_roles.includes('shariah-audit'), 'third-line audit must not authorise development');
});

test('WS3.3 — an Islamic product compiles attestation, continuous assurance and its evidence type', () => {
  const plan = planWith(['islamic-product']);
  // A ruling made in a committee sitting has to come home bound to the exact plan it ruled on.
  assert.equal(plan.required_capabilities.approval_attestation.required, true);
  // Continuous monitoring is a medium-tier duty, not a high-tier extra.
  assert.equal(plan.required_capabilities.knowledge_currency.required, true);
  assert.equal(plan.required_capabilities.knowledge_currency.institution_owned, true);
  assert.ok(plan.required_gates.includes('assurance-cadence'));
  assert.ok(plan.required_evidence.includes('shariah-attestation'));

  // …and it is compiled at MEDIUM, not only at high — a medium-tier Islamic product governed
  // once at launch and never again is the defect this tier placement exists to prevent.
  const medium = planWith(['islamic-product'], {}, 'medium');
  assert.ok(medium.required_gates.includes('assurance-cadence'));
  assert.equal(medium.required_capabilities.approval_attestation.required, true);
});

test('WS3.3 — a Shari’ah-significant model adds a DOMAIN validation on top of model risk', () => {
  const plan = planWith(['ai-decision-system', 'shariah-model']);
  assert.equal(plan.required_capabilities.shariah_model_validation.required, true);
  assert.equal(plan.required_capabilities.shariah_model_validation.institution_owned, true);
  // Domain validation ADDS to model risk; it never replaces it.
  assert.equal(plan.required_capabilities.model_risk.required, true);
  assert.equal(plan.required_capabilities.model_risk.minimum_tier, 'high');
  assert.ok(plan.required_approver_roles.includes('model-validator'));
  assert.ok(plan.required_approver_roles.includes('shariah-compliance'));
  assert.ok(plan.pa2_sections.includes('shariah-model-validation'));
  // The customer is told when a model made or shaped the decision, on both routes.
  assert.ok(plan.pa2_sections.includes('ai-disclosure'));
  assert.ok(planWith(['ai-decision-system']).pa2_sections.includes('ai-disclosure'));
});

test('WS3.3 — Open Finance ∩ Islamic compiles the mapping table, disclosures and monetisation screen', () => {
  const plan = planWith(['open-finance', 'islamic-product'], { islamic: true });
  for (const s of ['sharia-structure-mapping', 'islamic-consumer-disclosures', 'monetisation-shariah-screening']) {
    assert.ok(plan.pa2_sections.includes(s), `OF∩Islamic must compile ${s}`);
  }
  // The mapping table is EVIDENCE, not only analysis: the API representation is itself a
  // compliance statement, so the product → contract → ShariaStructure rows (including the
  // explicit GAP rows) have to exist as an artefact an auditor can read.
  assert.ok(plan.required_evidence.includes('sharia-structure-mapping'));
  // The Shari’ah roles come from the ISLAMIC profile, not from open-finance.
  assert.ok(plan.required_approver_roles.includes('shariah-committee'));
});

test('WS3.3 — Open Finance ALONE is untouched: no Shari’ah governance, no Islamic sections', () => {
  for (const flags of [{}, { islamic: false }]) {
    const plan = planWith(['open-finance'], flags);
    assert.ok(!plan.required_capabilities.shariah_governance, 'a conventional Open Finance change must not compile Shari’ah governance');
    for (const s of ['sharia-structure-mapping', 'islamic-consumer-disclosures', 'monetisation-shariah-screening']) {
      assert.ok(!plan.pa2_sections.includes(s), `${s} must be dormant for a non-Islamic adopter`);
    }
    assert.ok(!plan.required_evidence.includes('sharia-structure-mapping'));
    for (const r of ['shariah-committee', 'shariah-compliance', 'shariah-audit']) {
      assert.ok(!plan.required_approver_roles.includes(r), `${r} must not compile without an Islamic product`);
    }
  }
});

test('WS3.3 — the jurisdiction carries its own CX regime: islamic + open_finance fire independently', () => {
  const uae = profile('jurisdictions/uae-bank');
  const plan = compile(envelope({ flags: { islamic: true, open_finance: true } }), [profile('regulated-bank'), uae]).plan;
  assert.ok(plan.pa2_sections.includes('shariah-approval'));
  assert.ok(plan.pa2_sections.includes('altareq-cx-conformance'));
  // Each flag alone fires only its own conditional — the market CX regime is not an Islamic
  // control, and Shari’ah approval is not an Open Finance one.
  const ofOnly = compile(envelope({ flags: { open_finance: true } }), [profile('regulated-bank'), uae]).plan;
  assert.ok(ofOnly.pa2_sections.includes('altareq-cx-conformance'));
  assert.ok(!ofOnly.pa2_sections.includes('shariah-approval'));
});

test('WS3.3 — two jurisdiction profiles compose: local authority vocabulary unions, duplicates collapse', () => {
  // In-test fixtures, because the bundle ships one market and the invariant under test is that a
  // SECOND market is a JSON file and not a code change. The generic Islamic duties live in the
  // product profile; each market adds only its own binding-authority step.
  const marketA = {
    profile: 'market-a', kind: 'jurisdiction',
    requirements: { medium: { pa2_sections: ['market-a-disclosure'] } },
    conditional: [{ when: 'islamic', adds: { approver_roles: ['shariah-committee'], pa2_sections: ['market-a-authority-alignment'] } }],
  };
  const marketB = {
    profile: 'market-b', kind: 'jurisdiction',
    requirements: { medium: { pa2_sections: ['market-b-disclosure'] } },
    conditional: [{ when: 'islamic', adds: { approver_roles: ['shariah-committee'], pa2_sections: ['market-b-authority-alignment'] } }],
  };
  const plan = compile(
    envelope({ flags: { islamic: true }, required_profiles: ['regulated-bank', 'market-a', 'market-b', 'islamic-product'] }),
    [profile('regulated-bank'), marketA, marketB, profile('products/islamic-product')],
  ).plan;
  for (const s of ['market-a-disclosure', 'market-b-disclosure', 'market-a-authority-alignment', 'market-b-authority-alignment']) {
    assert.ok(plan.pa2_sections.includes(s), `both markets' requirements must survive the union (${s})`);
  }
  // The generic duty is stated ONCE by the product profile, and the two markets' duplicate role
  // collapses — union, not concatenation, is what makes composition fork-free.
  assert.equal(plan.required_approver_roles.filter((r) => r === 'shariah-committee').length, 1);
  assert.ok(plan.pa2_sections.includes('purification-of-non-compliant-income'));
});

test('an unclassified change is blocked', () => {
  const { plan, findings } = compile(envelope({ risk_tier: undefined }), ALL);
  assert.equal(plan, null);
  assert.ok(findings.some((f) => /no risk_tier — an unclassified change is blocked/.test(f)));
});

test('a product change cannot ride the low-risk route', () => {
  const { findings } = compile(envelope({ change_type: 'new-product', risk_tier: 'low' }), ALL);
  assert.ok(findings.some((f) => /cannot be classified low/.test(f)));
});

test('a documentation change at low tier compiles the light path', () => {
  const { plan, findings } = compile(envelope({ change_type: 'documentation', risk_tier: 'low', required_profiles: ['regulated-bank'] }), [ALL[0]]);
  assert.deepEqual(findings, []);
  assert.deepEqual(plan.required_gates, ['D', 'Q']);
  assert.ok(!plan.required_approver_roles.includes('risk-second-line'));
  assert.deepEqual(plan.pa1_sections, []);
});

test('a high-tier product compiles PA1 + A + PA2 with control functions', () => {
  const { plan } = compile(envelope(), ALL.slice(0, 3));
  for (const g of ['D', 'Q', 'PA1', 'A', 'PA2']) assert.ok(plan.required_gates.includes(g), `missing gate ${g}`);
  for (const r of ['risk-second-line', 'compliance', 'legal', 'operations', 'information-security', 'accountable-executive', 'credit-risk']) {
    assert.ok(plan.required_approver_roles.includes(r), `missing approver ${r}`);
  }
  assert.ok(plan.pa2_sections.includes('affordability-assessment'), 'lending profile adds affordability');
  assert.ok(plan.pa2_sections.includes('key-facts-statement'), 'uae profile adds KFS');
});

test('conditionals fire on flags: islamic adds Shariah, model adds validator', () => {
  const base = compile(envelope(), ALL.slice(0, 3)).plan;
  assert.ok(!base.required_approver_roles.includes('shariah-committee'));
  const islamic = compile(envelope({ flags: { islamic: true } }), ALL.slice(0, 3)).plan;
  assert.ok(islamic.required_approver_roles.includes('shariah-committee'));
  assert.ok(islamic.pa2_sections.includes('shariah-approval'));
  assert.ok(islamic.pa2_sections.includes('profit-rate-structure'), 'lending islamic conditional');
  const model = compile(envelope({ flags: { model_involved: true } }), ALL.slice(0, 3)).plan;
  assert.ok(model.required_approver_roles.includes('model-validator'));
});

test('different product profiles compile different requirements', () => {
  const lending = compile(envelope({ required_profiles: ['regulated-bank', 'uae-bank', 'lending'] }), [ALL[0], ALL[1], ALL[2]]).plan;
  const payments = compile(envelope({ required_profiles: ['regulated-bank', 'uae-bank', 'payments'] }), [ALL[0], ALL[1], ALL[3]]).plan;
  assert.ok(lending.pa2_sections.includes('affordability-assessment'));
  assert.ok(!payments.pa2_sections.includes('affordability-assessment'));
  assert.ok(payments.pa2_sections.includes('duplicate-transaction-controls'));
  assert.ok(!lending.pa2_sections.includes('duplicate-transaction-controls'));
});

test('the plan is deterministic and its hash is canonical', () => {
  const a = compile(envelope(), ALL.slice(0, 3)).plan;
  const b = compile(envelope(), ALL.slice(0, 3)).plan;
  assert.deepEqual(a, b);
  assert.equal(a.plan_hash, planHash(a));
  const tampered = { ...a, required_gates: a.required_gates.filter((g) => g !== 'PA1') };
  assert.notEqual(planHash(tampered), a.plan_hash);
});

test('a missing profile blocks the change', () => {
  const { findings } = loadProfiles(['regulated-bank', 'no-such-profile'], HARNESS);
  assert.ok(findings.some((f) => /no-such-profile not found/.test(f)));
});

// ---- rc.8 WS3: the institution profile composes with base + jurisdiction + product ----

test('WS3 — an institution profile ADDS brainkit-conformance + provenance + owner, composing on top', () => {
  const inst = profile('institutions/meridian-trust');
  const env = envelope({ required_profiles: ['regulated-bank', 'uae-bank', 'lending', 'meridian-trust'] });
  const plan = compile(env, [...ALL.slice(0, 3), inst]).plan;
  assert.ok(plan.required_gates.includes('brainkit-conformance'), 'institution profile adds its gate family');
  assert.ok(plan.required_evidence.includes('brainkit-provenance'), 'institution profile adds its evidence type');
  assert.ok(plan.required_approver_roles.includes('institutional-context-owner'), 'institution profile adds its approver role');
  // Institution profiles only ADD — base + product requirements survive intact.
  for (const g of ['D', 'Q', 'PA1', 'A', 'PA2']) assert.ok(plan.required_gates.includes(g), `institution profile must not drop base gate ${g}`);
  assert.ok(plan.pa2_sections.includes('affordability-assessment'), 'lending requirements still present');
});

test('WS3 — a generic repo with no institution profile is unaffected (backward compatible)', () => {
  const generic = compile(envelope(), ALL.slice(0, 3)).plan;
  assert.ok(!generic.required_gates.includes('brainkit-conformance'));
  assert.ok(!generic.required_evidence.includes('brainkit-provenance'));
  assert.ok(!generic.required_approver_roles.includes('institutional-context-owner'));
});

test('WS3 — brainkit-conformance is mandatory even at the low tier once the profile is named', () => {
  const inst = profile('institutions/meridian-trust');
  const env = envelope({ change_type: 'documentation', risk_tier: 'low', required_profiles: ['regulated-bank', 'meridian-trust'] });
  const plan = compile(env, [ALL[0], inst]).plan;
  assert.ok(plan.required_gates.includes('brainkit-conformance'), 'even a low-tier documentation change conforms to institutional context');
});

// ---- rc.8 WS4: bind the plan to exact profile content, hashed recursively ----

test('WS4 — canonical serialization is order-independent and recursive', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(canonical({ a: { c: 1 } }), canonical({ a: { c: 2 } }));
  assert.equal(canonical([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]'); // array order preserved, keys sorted
});

test('WS4 — planHash covers NESTED profile_binding content (the flat-replacer bug is dead)', () => {
  const plan = compile(envelope(), ALL.slice(0, 3), [
    { profile: 'acme-bank', kind: 'institution', version: '1.3.0', digest: 'sha256:aaaa' },
  ]).plan;
  const tampered = { ...plan, profile_bindings: [{ ...plan.profile_bindings[0], digest: 'sha256:bbbb' }] };
  // The new recursive hash SEES the nested digest change…
  assert.notEqual(planHash(tampered), plan.plan_hash, 'a nested binding change must change the hash');
  // …whereas the old top-level replacer array was a whitelist that dropped nested keys entirely,
  // so both objects would have hashed identically. This asserts we are no longer doing that.
  const flat = (p) => { const { plan_hash, ...rest } = p; return JSON.stringify(rest, Object.keys(rest).sort()); };
  assert.equal(flat(tampered), flat(plan), 'the OLD flat serializer was blind to the nested change (documents the bug)');
});

test('WS4 — a plan carries a sorted profile_bindings list; the hash is deterministic', () => {
  const bindings = [
    { profile: 'uae-bank', kind: 'jurisdiction', version: null, digest: 'sha256:2' },
    { profile: 'acme-bank', kind: 'institution', version: '1.0.0', digest: 'sha256:1' },
  ];
  const a = compile(envelope(), ALL.slice(0, 3), bindings).plan;
  const b = compile(envelope(), ALL.slice(0, 3), [...bindings].reverse()).plan;
  assert.deepEqual(a.profile_bindings.map((x) => x.profile), ['acme-bank', 'uae-bank']); // sorted
  assert.equal(a.plan_hash, b.plan_hash); // binding input order does not affect the hash
  assert.equal(a.plan_hash, planHash(a));
});

test('WS4 — resolveBindings pins content: a one-byte profile change changes its digest and the plan hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-profiles-'));
  try {
    mkdirSync(join(dir, 'profiles', 'institutions'), { recursive: true });
    const write = (v) => writeFileSync(join(dir, 'profiles', 'institutions', 'acme.json'),
      JSON.stringify({ profile: 'acme', kind: 'institution', version: '1.0.0', note: v }));
    write('alpha');
    const first = resolveBindings(['acme'], dir).bindings;
    write('alphb'); // one byte
    const second = resolveBindings(['acme'], dir).bindings;
    assert.notEqual(first[0].digest, second[0].digest, 'a profile content change must change its binding digest');
    const env = envelope({ required_profiles: ['acme'] });
    assert.notEqual(
      compile(env, ALL.slice(0, 3), first).plan.plan_hash,
      compile(env, ALL.slice(0, 3), second).plan.plan_hash,
      'a changed binding digest must make the compiled plan hash change (stale-plan detection)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
