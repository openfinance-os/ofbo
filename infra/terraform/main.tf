# BACKOFFICE-55 — region-parameterised skeleton. The concrete cloud resources
# are written port-by-port at bank adoption (M6), against the bank's own
# provider and credentials; this root module fixes the region-parameterisation
# contract those resources plug into: region flows ONLY from var.region, the
# residency invariant is asserted with a `check` block, and naming is derived
# region-aware so the same module is safe to stand up in any approved region.

locals {
  # Region-aware naming so parallel regional deployments never collide.
  name_prefix = "${var.project_name}-${var.environment}-${var.region}"

  # Demo is synthetic-only and exempt from residency (PRD §3.1); the regulated
  # enterprise profile must sit inside the residency set.
  residency_enforced = var.deploy_profile == "enterprise"
}

# Built-in resource (no cloud provider needed) — proves region threads through
# the resource graph and gives M6 adapters a stable anchor to extend.
resource "terraform_data" "deployment_marker" {
  input = {
    project     = var.project_name
    environment = var.environment
    profile     = var.deploy_profile
    bank_id     = var.bank_id
    region      = var.region
    name_prefix = local.name_prefix
  }
}

# Defence in depth on top of the variable-level validation: a regulated
# deployment whose region drifts out of the residency set fails the plan.
check "data_residency" {
  assert {
    condition     = !local.residency_enforced || contains(var.approved_residency_regions, var.region)
    error_message = "Regulated (enterprise) deployment region ${var.region} is outside the BD-06 residency set ${jsonencode(var.approved_residency_regions)}."
  }
}
