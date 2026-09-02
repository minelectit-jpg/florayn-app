/** Shared checks for the tier create and update routes. */
export function validateTier(
  body: unknown,
  { partial }: { partial: boolean }
): { value: Record<string, unknown> } | { error: string } {
  const input = (body ?? {}) as Record<string, unknown>
  const value: Record<string, unknown> = {}

  const num = (key: string, min: number, max: number) => {
    if (input[key] == null) {
      return partial ? null : `${key} is required`
    }
    const parsed = Number(input[key])
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      return `${key} must be between ${min} and ${max}`
    }
    value[key] = Math.round(parsed)
    return null
  }

  for (const [key, min, max] of [
    ["quantity", 2, 99],
    ["discount_amount", 0, 1_000_000],
    ["min_pct", 0, 100],
    ["max_pct", 0, 100],
  ] as [string, number, number][]) {
    const problem = num(key, min, max)
    if (problem) {
      return { error: problem }
    }
  }

  const min = value.min_pct as number | undefined
  const max = value.max_pct as number | undefined
  // A zero ceiling means uncapped, so only a real ceiling has to clear the floor.
  if (min != null && max != null && max > 0 && max < min) {
    return { error: "max_pct must be 0 or greater than min_pct" }
  }

  if (input.badge !== undefined) {
    value.badge =
      typeof input.badge === "string" && input.badge.trim()
        ? input.badge.trim()
        : null
  }
  if (typeof input.is_enabled === "boolean") {
    value.is_enabled = input.is_enabled
  }
  if (input.sort_order != null && Number.isFinite(Number(input.sort_order))) {
    value.sort_order = Math.round(Number(input.sort_order))
  }

  return { value }
}
