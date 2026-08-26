# `services/bff/memory` — in-memory store implementations

**These ship.** They are the demo profile's production defaults: `app.ts` falls back to them
whenever a durable store is not injected (`deps.x ?? new InMemoryX()`), which is exactly what
happens when `DATABASE_URL` is absent. They are not test fixtures, and this directory is
deliberately not named `testing/` or `fixtures/` — in a regulated codebase a name implying
"test-only" would misdescribe code that serves real demo traffic.

## Why they live outside `src/`

Two reasons, both from the 2026-08 improvement plan §4:

1. **Readability.** 27 store classes — ~840 statements — sat interleaved with the production
   service logic they back. `reconciliation/service.ts` alone carried three of them in its last
   150 lines, on top of a 900-line service.
2. **Coverage denominator.** The Q1 gate (HARNESS-09) scopes coverage to `services/bff/src/**`.
   Measured before the move, the in-memory stores were the *worst* branch-covered code in the
   BFF — 286/358 branches, 79.9%, against a file-wide 81.71% and an 80% floor. They were
   consuming the branch headroom that the regulated logic needs.

## Import convention

Each store is re-exported from the module that declares its interface, so the public surface is
unchanged and callers (including ~55 test files) import exactly as before. Type-only imports
point back into `src/`, so there is no runtime cycle — only the construction sites in `app.ts`
create a real `memory/ -> src/` edge, and it runs one way.
