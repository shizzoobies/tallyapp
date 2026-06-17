// MET table for activity-based calorie burn. Seed set per SPEC section 4; extend later.
export type Met = { key: string; label: string; met: number }

export const METS: Met[] = [
  { key: 'walk_slow', label: 'Walking, casual (3.0 km/h)', met: 2.8 },
  { key: 'walk_brisk', label: 'Walking, brisk (5.6 km/h)', met: 4.3 },
  { key: 'run_easy', label: 'Running (8 km/h)', met: 8.3 },
  { key: 'run_fast', label: 'Running (12 km/h)', met: 11.8 },
  { key: 'cycle_mod', label: 'Cycling, moderate', met: 7.5 },
  { key: 'strength', label: 'Weight training, vigorous', met: 6.0 },
  { key: 'elliptical', label: 'Elliptical, moderate', met: 5.0 },
  { key: 'yoga', label: 'Yoga', met: 3.0 },
  { key: 'swim', label: 'Swimming, moderate', met: 5.8 },
  { key: 'hiit', label: 'HIIT / circuit', met: 8.0 },
]

export const MET_BY_KEY: Record<string, number> = Object.fromEntries(
  METS.map((m) => [m.key, m.met]),
)

export const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  METS.map((m) => [m.key, m.label]),
)
