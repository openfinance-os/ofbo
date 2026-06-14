# BACKOFFICE-55 — template for a regulated deployment in a different approved
# region. Copy, set `region` to an entry in approved_residency_regions, and
# extend the set ONLY via the bank's documented BD-06 residency assessment.
project_name   = "ofbo"
environment    = "prod"
deploy_profile = "enterprise"
region         = "uaenorth" # Azure UAE North — must be in approved_residency_regions
# To deploy outside the defaults, override the assessment set explicitly, e.g.:
# approved_residency_regions = ["me-central-1", "uaenorth", "<region-from-assessment>"]
# bank_id supplied per tenant at apply time (TF_VAR_bank_id / -var), never committed.
