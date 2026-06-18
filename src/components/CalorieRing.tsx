// Remaining-calories ring. Fills with consumed vs target; turns red when over.
export default function CalorieRing({
  target,
  consumed,
  remaining,
}: {
  target: number
  consumed: number
  remaining: number
}) {
  const R = 80
  const CIRC = 2 * Math.PI * R
  const frac = target > 0 ? Math.min(Math.max(consumed / target, 0), 1) : 0
  const over = consumed > target
  const dash = over ? CIRC : CIRC * frac

  return (
    <svg viewBox="0 0 200 200" className="ring" role="img" aria-label={`${remaining} calories remaining`}>
      <circle cx="100" cy="100" r={R} fill="none" stroke="#ece8e0" strokeWidth="16" />
      <circle
        cx="100"
        cy="100"
        r={R}
        fill="none"
        stroke={over ? '#b3473f' : '#7d8c7b'}
        strokeWidth="16"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${CIRC}`}
        transform="rotate(-90 100 100)"
      />
      <text x="100" y="96" textAnchor="middle" className="ring-num">
        {remaining}
      </text>
      <text x="100" y="120" textAnchor="middle" className="ring-label">
        {over ? 'calories over' : 'calories left'}
      </text>
    </svg>
  )
}
