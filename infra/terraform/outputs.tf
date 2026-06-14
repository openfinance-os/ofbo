# BACKOFFICE-55 — outputs echo the resolved region wiring so downstream modules
# and the release-evidence bundle (BACKOFFICE-57) can record exactly where a
# given deployment landed.

output "region" {
  value       = var.region
  description = "The region this deployment is parameterised to."
}

output "name_prefix" {
  value       = local.name_prefix
  description = "Region-aware resource naming prefix."
}

output "residency_compliant" {
  value       = contains(var.approved_residency_regions, var.region)
  description = "True when region is within the BD-06 residency set."
}

output "deployment_marker" {
  value       = terraform_data.deployment_marker.output
  description = "Resolved deployment parameters (region threaded through the resource graph)."
}
