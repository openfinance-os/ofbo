# Release evidence bundles (BACKOFFICE-57)

One subdirectory per release tag, each git-anchored and committed here by the
release workflow (`.github/workflows/release-evidence.yml`) when a release is
published:

```
releases/
  <tag>/
    evidence-bundle.json   # machine-readable, sha256 integrity digest
    evidence-bundle.md     # human-readable companion
```

Each bundle records, for that exact commit:

- **Control mappings** — each regulatory/PRD control → the quality gate(s) that
  exercise it → the evidence artifact (`@ofbo/release-evidence` control manifest).
- **Quality-gate results** — Q1 build+unit, Q2 static+SAST, Q3 integration+contract,
  Q4 security+deps, **Q4.5** BCBS 239 lineage, Q5 manual prod approval.
- **Test results** and **scan outputs** captured during the release run.
- **BCBS 239 lineage proof** — `validateLineageCoverage` (covered tables / gaps).
- **Git anchor** — tag, commit, ref, timestamp — plus a `sha256` integrity digest
  over the canonicalised content (`verifyEvidenceBundle` re-checks it).

Bundles are append-only audit evidence — never edit a committed bundle; cut a new
release.
