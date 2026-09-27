import { Text } from "@medusajs/ui"

/**
 * The Live page's small time chart (TRACKING.md 9): plain inline SVG, no
 * chart library. Line and bar series share one scale; "dot" series (rare
 * events such as purchases) get their own lane under the chart so a single
 * order is visible next to thousands of page views. Every column has a
 * <title> with its numbers for hover and screen readers.
 */

export type SparkSeries = {
  key: string
  label: string
  kind: "line" | "bar" | "dot"
  /** A text colour class; the marks draw in currentColor. */
  className: string
}

export type SparkDatum = { label: string; values: Record<string, number> }

const WIDTH = 720
const PAD_LEFT = 64
const PAD_RIGHT = 8
const PAD_TOP = 10
const LANE = 14
const AXIS = 18

function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

export function LiveSpark({ data, series, height = 150, caption }: {
  data: SparkDatum[]
  series: SparkSeries[]
  height?: number
  caption: string
}) {
  const lines = series.filter((s) => s.kind !== "dot")
  const dots = series.filter((s) => s.kind === "dot")
  const chartBottom = height - AXIS - dots.length * LANE
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT
  const count = Math.max(1, data.length)
  const step = plotWidth / count
  const max = Math.max(1, ...data.flatMap((d) => lines.map((s) => d.values[s.key] ?? 0)))
  const x = (i: number) => PAD_LEFT + step * i + step / 2
  const y = (v: number) => chartBottom - ((chartBottom - PAD_TOP) * v) / max
  const ticks = data.length > 1 ? [0, Math.floor((data.length - 1) / 3), Math.floor(((data.length - 1) * 2) / 3), data.length - 1] : [0]
  const totals = series.map((s) => ({ ...s, total: data.reduce((sum, d) => sum + (d.values[s.key] ?? 0), 0) }))

  if (!data.length) return <Text size="small" className="text-ui-fg-subtle">Nothing to chart yet.</Text>

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full" role="img" aria-label={caption}>
        <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={chartBottom} y2={chartBottom} stroke="currentColor" className="text-ui-fg-muted" strokeWidth={1} opacity={0.4} />
        <text x={PAD_LEFT - 6} y={PAD_TOP + 8} textAnchor="end" fontSize={10} fill="currentColor" className="text-ui-fg-muted">{formatCount(max)}</text>
        <text x={PAD_LEFT - 6} y={chartBottom} textAnchor="end" fontSize={10} fill="currentColor" className="text-ui-fg-muted">0</text>
        {lines.filter((s) => s.kind === "bar").map((s) => (
          <g key={s.key} className={s.className} fill="currentColor" opacity={0.55}>
            {data.map((d, i) => {
              const v = d.values[s.key] ?? 0
              return v > 0 ? <rect key={i} x={x(i) - Math.max(1, step * 0.35)} width={Math.max(2, step * 0.7)} y={y(v)} height={chartBottom - y(v)} /> : null
            })}
          </g>
        ))}
        {lines.filter((s) => s.kind === "line").map((s) => (
          <polyline key={s.key} className={s.className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round"
            points={data.map((d, i) => `${x(i).toFixed(1)},${y(d.values[s.key] ?? 0).toFixed(1)}`).join(" ")} />
        ))}
        {dots.map((s, lane) => {
          const cy = chartBottom + LANE * lane + LANE / 2 + 2
          return (
            <g key={s.key} className={s.className} fill="currentColor">
              <text x={PAD_LEFT - 6} y={cy + 3} textAnchor="end" fontSize={9} fill="currentColor">{s.label}</text>
              {data.map((d, i) => {
                const v = d.values[s.key] ?? 0
                if (v <= 0) return null
                // Wide columns (days) get a dot sized by the count; narrow ones (5 minutes) a tick, darker for more.
                return step >= 10
                  ? <circle key={i} cx={x(i)} cy={cy} r={Math.min(5, 2.5 + v / 2)} />
                  : <rect key={i} x={x(i) - Math.max(1.5, step * 0.8) / 2} y={cy - 4} width={Math.max(1.5, step * 0.8)} height={8}
                    opacity={Math.min(1, 0.45 + v * 0.2)} />
              })}
            </g>
          )
        })}
        {ticks.map((i, n) => {
          // The outer labels hug the edges so they are never cut off.
          const edge = n === 0 ? "start" : n === ticks.length - 1 ? "end" : "middle"
          const tx = edge === "start" ? PAD_LEFT : edge === "end" ? WIDTH - PAD_RIGHT : x(i)
          return <text key={i} x={tx} y={height - 4} textAnchor={edge} fontSize={10} fill="currentColor" className="text-ui-fg-muted">
            {data[i]?.label}
          </text>
        })}
        {data.map((d, i) => (
          <rect key={`hit-${i}`} x={PAD_LEFT + step * i} y={PAD_TOP} width={step} height={height - PAD_TOP - AXIS} fill="transparent">
            <title>{`${d.label}: ${series.map((s) => `${formatCount(d.values[s.key] ?? 0)} ${s.label.toLowerCase()}`).join(", ")}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1">
        {totals.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs">
            <svg width={14} height={10} aria-hidden className={s.className}>
              {s.kind === "line" ? <line x1={0} x2={14} y1={5} y2={5} stroke="currentColor" strokeWidth={2} />
                : s.kind === "bar" ? <rect x={3} y={1} width={8} height={8} fill="currentColor" opacity={0.55} />
                  : <circle cx={7} cy={5} r={3.5} fill="currentColor" />}
            </svg>
            <span className="text-ui-fg-subtle">{s.label}</span>
            <span className="text-ui-fg-base">{formatCount(s.total)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
