/**
 * Newest models first, read from the model name, so a new device (iPhone 18,
 * Samsung S27) lands at the top of every list without anyone reordering it.
 *
 * The generation is the largest number in the name ("iPhone 17 Pro" 17,
 * "Samsung S26" 26, "AirPods 1/2" 2); newer first. Within a generation the
 * bigger model leads: Pro Max / Ultra, Pro, Air, Plus, the base model, Mini,
 * then e / FE. Names without a number (Apple Watch Band, Card Wallet) keep
 * their place after the numbered ones.
 *
 * This file is byte-identical in apps/backend/src/lib and
 * apps/storefront/src/lib (a test enforces it).
 */
const LINES: [RegExp, number][] = [
  [/\bpro\s*max\b|\bultra\b/, 0],
  [/\bpro\b/, 1],
  [/\bair\b/, 2],
  [/\bplus\b|\+/, 3],
  [/\bmini\b/, 5],
  [/\d+e\b|\bfe\b/, 6],
]
const BASE = 4

export function modelOrderKey(name: string): { generation: number; line: number } {
  const lower = name.toLowerCase()
  // "AirPods 1/2", "iPhone 17": the model number, never a storage size or year.
  const numbers = (lower.match(/\d+/g) ?? []).map(Number).filter((n) => n < 1000)
  const generation = numbers.length ? Math.max(...numbers) : -1
  const line = LINES.find(([pattern]) => pattern.test(lower))?.[1] ?? BASE
  return { generation, line }
}

/** Sort comparator: newest generation first, then the bigger model. Ties keep their order. */
export function compareModelNames(a: string, b: string): number {
  const ka = modelOrderKey(a)
  const kb = modelOrderKey(b)
  return kb.generation - ka.generation || ka.line - kb.line
}

/** A copy of `items` newest first, keeping each family's first-seen place (stable). */
export function sortNewestFirst<T>(items: T[], name: (item: T) => string, group: (item: T) => string = () => ""): T[] {
  const groupRank = new Map<string, number>()
  items.forEach((item) => { const g = group(item); if (!groupRank.has(g)) groupRank.set(g, groupRank.size) })
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      groupRank.get(group(a.item))! - groupRank.get(group(b.item))! ||
      compareModelNames(name(a.item), name(b.item)) ||
      a.index - b.index)
    .map(({ item }) => item)
}
