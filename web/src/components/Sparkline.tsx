import { useId } from 'react'

interface Props {
  values: number[]
  color: string
  width?: number
  height?: number
  className?: string
  label?: string
}

/**
 * A bare trend line. Colour identifies which price it charts, matching the
 * column it sits under.
 */
export function Sparkline({ values, color, width = 104, height = 32, className, label }: Props) {
  const id = useId()

  if (values.length < 2) {
    return <div style={{ width, height }} className={className} aria-hidden />
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)

  const points = values.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / span) * (height - 4) - 2
    return [x, y] as const
  })

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  // Rough path length, enough for the dash offset that draws the line in.
  let length = 0
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  const area = `${points[0][0]},${height} ${line} ${points[points.length - 1][0]},${height}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#fill-${id})`} />
      <polyline
        className="spark-line"
        style={{ '--dash': Math.ceil(length) } as React.CSSProperties}
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
