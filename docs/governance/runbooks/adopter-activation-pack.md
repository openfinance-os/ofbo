# Adopter Activation Pack — from installed harness to observed bank control

Use this pack for one bounded, model-enabled bank change. Its output is evidence that the
platform and institution operate the Loom controls; it is not another declaration that the
controls ought to exist.

The campaign record is `docs/governance/activation-plan.json`. Keep it `not-started` until the
institution selects the target and four independent owners. Use `activating` while closing gaps;
the readiness gate reports them without blocking. Moving to `ready-for-pilot`, `pilot-active` or
`concluded` is an assertion and therefore fails closed.

## 1. Establish the reference journey

- Select one high-tier, model-enabled governed change with a reversible customer journey.
- Compile its route under `regulated-bank`, the jurisdiction, and the product profile.
- Name a distinct accountable executive, platform administrator, second-line owner and internal
  auditor in the identity registry. Builders and agents hold none of these activation decisions.
- Fill `activation-plan.json`, set `status` to `activating`, and run:

```bash
node scripts/activation-readiness-check.mjs
```

## 2. Observe the platform controls

Create independently signed records under `docs/governance/platform-activation/` for:

| Control | Expected observation and negative probe |
|---|---|
| `HG-0001` | Protected default branch; a builder or agent direct push is rejected |
| `HG-0004` | Separated OIDC/IAM subject and vaulted secret path; an unentitled subject is rejected |
| `HG-0005` | Protected production environment and promotion rule; an unapproved promotion is rejected |
| `HG-0011` | Forced residency/egress gateway; direct outbound traffic around it is rejected |

`platform-activation-check.mjs` cryptographically verifies freshness, observer independence and
the rejected bypass. `loom status` counts only records that pass that verifier; placing an unsigned
JSON file in the directory advances nothing.

## 3. Activate the external record

Record the provider choice in `provider-selection.json`, mount its adapter, and complete every
activation-evidence field. For Kosli:

1. Provision the organisation and the delivery/discovery flows.
2. Put `KOSLI_API_TOKEN` only in the runner's vault and use a separated service identity.
3. Run a real begin-trail, post, read-back and trail-status cycle.
4. Substitute an unknown record id and alter an anchor; both must be rejected by the seal path.
5. Grant Internal Audit read-only query access and retain the grant evidence.
6. Approve whether Kosli meets the institution's retention, immutability and timestamping needs;
   otherwise anchor the same record into the approved WORM/RFC-3161 archive.

Selecting Kosli is not activation. The readiness gate requires the mounted adapter to report
fully completed activation evidence and binds the plan's provider and adapter to that live seam.

## 4. Close the governed joins

- `operating-model-check.mjs`: mandate, oversight, RACI, IAM bindings, cease-use and audit route.
- `ai-governance-check.mjs`: exact model/prompt pins, human oversight, non-AI alternative,
  bilingual disclosure, monitoring, incident and stress evidence.
- `fairness-evaluation-check.mjs`: measurements bound to the shipping model role and pins.
- `decision-contestability-check.mjs`: explanation, challenge and human overturn routes.

All four must be required by and clean for the reference change. An inert gate is not readiness.

## 5. Authorise and run the pilot

When every prerequisite is observed, move the activation plan to `ready-for-pilot`. A second-line
human reviews the complete evidence route before `pilot-record.json` becomes `active`; then move
the activation plan to `pilot-active` as the same change.

Follow `pilot-playbook.md`: synthetic and shadow stages first, bounded real users before financial
execution, explicit caps, frequent observations, a drilled rollback/kill switch, and an evidence
entry for every live adversarial row. Do not widen scope while a stage exit or finding is open.

## 6. Conclude and re-perform

The activation plan may reach `concluded` only when the pilot record is concluded, its live rows
are exercised, its findings are resolved or accepted by the accountable executive, and its
independent report is present. Internal Audit then reconstructs a sample from the external record
using the `re-perform` skill and stores its report outside the release branch.

Only after those observations should the institution update individual catalog rows to
`platform-enforced` or `organisationally-enforced`, retaining every activation and adoption
attestation the catalog requires.

## Standing boundary

The bundle cannot appoint these people, change the platform, connect Kosli, observe a customer,
move money, or perform an audit. The pack makes each missing fact explicit and prevents a readiness
claim from getting ahead of its independently verifiable evidence.
