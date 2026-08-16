/**
 * Stable JSON representation used for billing integrity digests and replay keys.
 * Object keys are sorted recursively; array order and key spelling are preserved.
 */
export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => item === null || typeof item !== 'object'
    ? item
    : Array.isArray(item)
      ? item.map(normalize)
      : Object.fromEntries(
          Object.keys(item as Record<string, unknown>)
            .sort()
            .map((key) => [key, normalize((item as Record<string, unknown>)[key])])
        )

  return JSON.stringify(normalize(value))
}
