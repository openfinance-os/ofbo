# OFBO Infrastructure as Code (BACKOFFICE-55)

Region-parameterised Terraform skeleton, **from day one** (CLAUDE.md: *Terraform,
region-parameterised*; PRD §3: *Residency region — IaC parameter*). The same
module deploys to **any approved region** by changing only inputs — never the
module body.

## Region-parameterisation contract

- `region` is a required input. Nothing about a region is hardcoded in the module
  body; region flows only from `var.region`.
- `approved_residency_regions` encodes the bank's **BD-06 data-residency
  assessment**. Default = UAE/GCC regions of the major clouds; *UAE region for
  regulated production data* is the binding PRD default until the bank overrides
  it via its assessment.
- Residency is enforced twice (defence in depth): a cross-variable `validation`
  on `region`, and a `check "data_residency"` block for the regulated
  (`enterprise`) profile. An out-of-assessment region never reaches a resource.

## Profiles

This module targets the regulated **`enterprise`** profile (the bank's own
cloud, written port-by-port at adoption — M6). The **`demo`** profile ships via
the Cloudflare/Supabase/Railway CLI pipeline (`.github/workflows/deploy.yml`)
and is exempt from residency — synthetic data only, permanently non-prod.

## Usage

```sh
terraform init
terraform validate
terraform plan  -var-file=environments/enterprise.uae.tfvars -var="bank_id=<uuid-v4>"
terraform apply -var-file=environments/enterprise.uae.tfvars -var="bank_id=<uuid-v4>"
```

`bank_id` is supplied per tenant at apply time (`TF_VAR_bank_id` or `-var`) and
is never committed.

## What's here vs. what M6 adds

The skeleton fixes the region-parameterisation contract (variables, residency
guards, region-aware naming, outputs) and a provider-free `terraform_data`
anchor. Concrete cloud resources (network, data store with RLS, compute, egress
to P6) are added against the bank's provider and credentials at adoption, and
must plug into this contract — `region` stays a parameter.

The region-parameterisation invariants are guarded by an executable test
(`test/skeleton.spec.ts`), which runs in CI (Q1) without a Terraform binary.
