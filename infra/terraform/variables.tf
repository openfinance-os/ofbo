# BACKOFFICE-55 — every region-bearing input is a parameter; nothing about a
# region is hardcoded in the module body. The bank's data-residency assessment
# (BD-06) is expressed as `approved_residency_regions`; `region` must be one of
# them, enforced before plan/apply.

variable "project_name" {
  type        = string
  default     = "ofbo"
  description = "Resource naming prefix for the Back Office deployment."
}

variable "environment" {
  type        = string
  description = "Deployment environment (e.g. dev, staging, prod)."
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "deploy_profile" {
  type        = string
  default     = "enterprise"
  description = "Deployment profile (PRD §3.1). This module targets the regulated `enterprise` profile; the `demo` profile ships via the Cloudflare/Supabase/Railway CLI pipeline and is exempt from residency (synthetic data only)."
  validation {
    condition     = contains(["demo", "enterprise"], var.deploy_profile)
    error_message = "deploy_profile must be demo or enterprise."
  }
}

variable "bank_id" {
  type        = string
  description = "Tenant bank identifier (UUID v4) — the RLS tenancy key carried end to end."
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", var.bank_id))
    error_message = "bank_id must be a UUID v4."
  }
}

variable "approved_residency_regions" {
  type = list(string)
  # PRD §3 / BD-06 default: UAE region for regulated production data. The set is
  # the bank's residency-assessment output — override per the assessment, never
  # silently. Defaults cover the UAE/GCC regions of the major clouds so the SAME
  # module deploys to any approved region by changing only this list + `region`.
  default = [
    "me-central-1", # AWS UAE (Dubai)
    "me-south-1",   # AWS Bahrain (GCC)
    "uaenorth",     # Azure UAE North
    "uaecentral",   # Azure UAE Central
    "me-central1",  # GCP Doha/Dammam (GCC)
  ]
  description = "CBUAE-acceptable residency regions per the bank's BD-06 assessment. `region` must be a member."
  validation {
    condition     = length(var.approved_residency_regions) > 0
    error_message = "approved_residency_regions must list at least one region from the residency assessment."
  }
}

variable "region" {
  type        = string
  description = "Deployment region. Regulated production data MUST reside in a CBUAE-acceptable region (BD-06)."
  # Cross-variable validation (Terraform >= 1.9): residency is enforced at the
  # variable boundary — an out-of-assessment region never reaches a resource.
  validation {
    condition     = contains(var.approved_residency_regions, var.region)
    error_message = "region must be one of approved_residency_regions (BD-06 data-residency assessment). To deploy elsewhere, add the region to the assessment set first."
  }
}
