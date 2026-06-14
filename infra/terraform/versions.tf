# BACKOFFICE-55 — region-parameterised IaC, from day one (CLAUDE.md: "Terraform,
# region-parameterised"; PRD §3 residency = IaC parameter). Terraform >= 1.9 is
# required so input-variable `validation` blocks may reference other variables —
# that is what lets the residency guard check `region` against the bank's
# approved residency set (BD-06) declaratively, before any resource is created.
terraform {
  required_version = ">= 1.9.0"
}
