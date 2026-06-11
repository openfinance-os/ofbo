/** mulberry32 — tiny deterministic PRNG. Demos must be byte-repeatable (PRD §3.1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makePick(rand: () => number) {
  return {
    int: (min: number, max: number) => min + Math.floor(rand() * (max - min + 1)),
    of: <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!,
    digits: (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join(''),
    uuid: () => {
      // deterministic UUID-v4-shaped id from the PRNG (synthetic data only)
      const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16))
      hex[12] = '4'
      hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
      const s = hex.join('')
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
    }
  }
}
