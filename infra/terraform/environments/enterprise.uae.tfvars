# BACKOFFICE-55 — regulated UAE production deployment (PRD §3 / BD-06 default:
# UAE region for regulated production data). Same module, region as a parameter.
project_name   = "ofbo"
environment    = "prod"
deploy_profile = "enterprise"
region         = "me-central-1" # AWS UAE (Dubai)
# bank_id supplied per tenant at apply time (TF_VAR_bank_id / -var), never committed.
