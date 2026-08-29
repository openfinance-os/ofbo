import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { CHANNELS, PRODUCTION_STATUSES, REGISTRATION_STATES } from '../src/tpp-counterparty-store.js'

/**
 * The store narrows three database strings to contract enums at the read boundary, and to do that at
 * RUNTIME it needs the members as values. The generated client is types only, so the members have to
 * be written down in `tpp-counterparty-store.ts` — which makes them copies of contract values, the
 * exact thing this branch has spent its time removing. So they are bound here rather than trusted.
 *
 * This is not hypothetical. On the first pass I hand-wrote `production_status` as
 * `[directory_only, onboarding, live, suspended, decommissioned]` and `registration_state` as
 * `[unregistered, registered, exempt]`. Both were inventions: the contract says `active_traffic` and
 * `dormant` for the first, `onboarding` and `suspended` for the second. Nothing in the type system
 * could see it — the arrays are `as const`, so they type-check perfectly against themselves — and it
 * surfaced only because the DB CHECK constraint happened to be visible in the same terminal.
 *
 * A wrong member list here does not fail loudly at the point of the mistake. It makes `enumOr` reject
 * a legitimate row, so the operator sees a store error instead of a registry.
 *
 * The spec is read and parsed directly rather than through a package subpath: `@ofbo/contracts`
 * exports only `.` and `./testing`, and neither carries the raw document. Test-time `fs` on the
 * repository's own ground-truth file, not a runtime dependency.
 */
const SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs', 'backoffice-openapi.yaml')

interface EnumSchema {
  enum?: string[]
}
interface Spec {
  components: {
    schemas: {
      Channel: EnumSchema
      TppCounterparty: { properties: Record<string, EnumSchema> }
    }
  }
}

describe("the store's runtime enum members agree with the contract", () => {
  const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as Spec
  const tpp = spec.components.schemas.TppCounterparty.properties

  it('channel matches the Channel schema', () => {
    expect([...CHANNELS]).toEqual(spec.components.schemas.Channel.enum)
  })

  it('production_status matches TppCounterparty.production_status', () => {
    expect([...PRODUCTION_STATUSES]).toEqual(tpp.production_status!.enum)
  })

  it('registration_state matches TppCounterparty.registration_state', () => {
    expect([...REGISTRATION_STATES]).toEqual(tpp.registration_state!.enum)
  })

  /**
   * Order matters to `toEqual`, deliberately: these arrays exist to mirror the contract, so a
   * reordering is a divergence worth seeing even though it changes no behaviour. If that ever gets
   * noisy, sort both sides — do not drop the assertion.
   */
  it('reads a real spec, so the checks above cannot pass against an empty parse', () => {
    expect(spec.components.schemas.Channel.enum).toBeInstanceOf(Array)
    expect(spec.components.schemas.Channel.enum!.length).toBeGreaterThan(1)
  })

  /**
   * The three narrowed fields are the three the store converts. If a fourth enum is added to
   * `TppCounterparty`, `toRow` will keep passing it through as a bare string and no assertion above
   * would notice — this is the one that does.
   */
  it('covers every inline enum on TppCounterparty, so a fourth cannot be added unbound', () => {
    const inlineEnums = Object.entries(tpp)
      .filter(([, v]) => Array.isArray(v?.enum))
      .map(([k]) => k)
      .sort()
    // `channel` is a $ref to the shared Channel schema, so it carries no inline enum and is asserted
    // separately above.
    expect(inlineEnums).toEqual(['production_status', 'registration_state'])
  })
})
