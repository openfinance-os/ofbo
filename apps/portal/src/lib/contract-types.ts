/**
 * ADR-0004 — bind the portal's server-side data layer to the generated OpenAPI contract
 * types so a spec change that breaks the portal fails `typecheck` (closing the drift
 * exposure the codebase-vs-PRD review flagged), WITHOUT moving to a client-side query layer.
 *
 * The generated schema types make every field optional and use string-enum unions, while
 * the portal's view types are deliberately narrower (required fields, plain strings). A
 * full structural assignability check would therefore trip on shape differences that are
 * NOT drift. The breaking signal we DO want to catch is a field the portal reads being
 * renamed or removed in the spec — so we assert KEY conformance: every key of a portal
 * view type must exist on its contract schema. Purely type-level (no runtime, no client).
 */
import type { components } from '@ofbo/contracts'

export type Schemas = components['schemas']

/** Resolves to `true` when every key of V exists on C; otherwise to an error tuple naming
 *  the drifted keys (which fails the `Assert` below at typecheck). */
export type KeysConformToContract<V, C> = keyof V extends keyof C
  ? true
  : ['CONTRACT DRIFT — portal view has keys absent from the contract schema:', Exclude<keyof V, keyof C>]

/** Forces a `KeysConformToContract<...>` result to be `true` at compile time. */
export type AssertContract<T extends true> = T
