# BrainKit distribution runbook (multi-repository)

> Loom 2.0-rc.10 (WS9). How one institution's BrainKit is versioned once and mounted across many
> product repositories — **with no live network service**. Every step maps to a mechanism the
> bundled gates already enforce, so distribution is validated locally in CI.

## The operating model

1. **One private canonical BrainKit.** The institution owns a single BrainKit in a private
   repository. Public AI-DLC ships only schemas, machinery, validators and the fictional Meridian
   example — never real institutional content.
2. **Semantically versioned, approved releases.** Each release bumps the manifest `version`, is
   sealed (`brainkit-check.mjs --seal`), and is moved to `status: approved` by accountable owners
   whose identities resolve in the registry. *Mechanism: `brainkit-check` — status, owners,
   approvals, digest consistency.*
3. **Each product repo mounts a digest-pinned snapshot.** The repo copies the approved BrainKit into
   `institution/brainkit/` and pins the release in its institution profile:
   `profiles/institutions/<id>.json → brainkit.release_digest: "sha256:…"`. *Mechanism:
   `brainkit-check` compares the mounted snapshot's live package digest to the pinned
   `release_digest`; a mismatch fails the build — the repo is running an unadopted version.*
4. **CI validates the snapshot with no network dependency.** `brainkit-check` recomputes section and
   package digests from the local files and compares them to the manifest and the pin. There is no
   registry call, no fetch — the snapshot is self-verifying.
5. **Adopt a new version through an explicit reviewed PR.** Bumping the mounted snapshot and its
   `release_digest` touches `institution/` and `profiles/institutions/`, which are CODEOWNERS-owned
   by the context owners and are never a routine change (the routine-change floor blocks them). So a
   version bump is always a reviewed PR. Recompile affected control plans in the same PR — the
   compiler folds the new live digest into each plan binding, so `change-envelope-check` fails any
   plan not recompiled.
6. **Rollback = remount the last approved version + recompile.** Restore the previous approved
   snapshot into `institution/brainkit/`, set `release_digest` back, and recompile. No service call;
   the digests do the reconciling.

## What is deliberately NOT built in rc.8

- **No public BrainKit registry.** Distribution is repo-to-repo via reviewed PRs and pinned digests.
- **No live resolution service.** Nothing fetches a BrainKit at build time; the mounted snapshot is
  the source of truth and is verified locally.
- **No claim of platform- or organisational-enforcement** from these bundled gates. Making a BrainKit
  version *organisationally* mandatory across repos is the institution's control to operate outside
  this repository.
