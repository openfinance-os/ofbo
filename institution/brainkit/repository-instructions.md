# Institutional BrainKit — repository instructions

<!-- Loom 2.0-rc.8 WS6. This is the CANONICAL instruction fragment for a BrainKit-enabled
     repository. It is installed as institution/brainkit/repository-instructions.md and referenced
     from the repository's own agent-instruction file — it is NEVER written over AGENTS.md,
     CLAUDE.md, .cursorrules or any equivalent. loom-adopt inspects the repository and proposes a
     concise pointer to this fragment; an existing instruction file is patched only after the
     adopter confirms. -->

Before creating or modifying any of the following, **read the Institutional BrainKit** under
`institution/brainkit/` and conform to it:

- **Code** — respect the technology policy (`technology-policy.json`: allowed / consult / forbidden)
  and the architecture principles (`architecture.md`).
- **PRDs and discovery artifacts** — use the institution's binding vocabulary (`terminology.md`)
  and identity/voice (`identity/design.md`).
- **ADRs and architecture documents** — conform to the architecture principles and record
  architecture-material changes per `governance.md` decision rights.
- **Interfaces and prototypes** — render against the D7 brand seam, which projects
  `identity/design.md`; visuals carry the BrainKit id/version/digest.
- **Reports and evidence packs** — ground claims in the approved sources listed in
  `source-register.json`; say **institutionally conformant**, never **regulatorily compliant**.

Rules that bind the agent:

1. The BrainKit is **read-before-write**. If a change would contradict the BrainKit, stop and
   escalate to the accountable owner named in `governance.md` — never self-authorize an
   institutional decision, and never invent policy, regulatory interpretation, approval authority,
   or brand rules.
2. Only an **approved**, effective, digest-consistent BrainKit is authoritative. If the BrainKit is
   `draft`, treat its contents as provisional and route decisions to its owners.
3. A change to `institution/` is **never routine** and always requires the context owner's review
   (enforced by CODEOWNERS and the routine-change floor).
4. This fragment is a **pointer, not a replacement**. Do not copy the BrainKit's contents into
   `AGENTS.md`/`CLAUDE.md`/`.cursorrules`; reference this file so the single source of truth stays
   in `institution/brainkit/`.
