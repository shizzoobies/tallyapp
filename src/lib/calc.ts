// Shared math for Tally. Pure functions, no I/O, so they are trivially testable
// and run identically on the client and in the Worker. See SPEC section 4.

// Mifflin-St Jeor BMR
export function bmr(sex: 'male' | 'female', kg: number, cm: number, age: number): number {
  const base = 10 * kg + 6.25 * cm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

export const ACTIVITY = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
} as const

export type ActivityKey = keyof typeof ACTIVITY

export function tdee(bmrVal: number, activity: ActivityKey): number {
  return bmrVal * ACTIVITY[activity]
}

// goalRateKgPerWeek is negative for loss (e.g. -0.5). 7700 kcal per kg.
export function dailyTarget(
  tdeeVal: number,
  goalRateKgPerWeek: number,
  sex: 'male' | 'female',
): number {
  const dailyDelta = (goalRateKgPerWeek * 7700) / 7
  const floor = sex === 'male' ? 1500 : 1200 // hard safety floor
  return Math.max(Math.round(tdeeVal + dailyDelta), floor)
}

// MET-based burn. kcal = MET * kg * hours
export function exerciseKcal(met: number, kg: number, minutes: number): number {
  return Math.round(met * kg * (minutes / 60))
}

// Remaining eating budget for the day
export function remaining(
  target: number,
  consumed: number,
  burned: number,
  creditPct: number,
): number {
  return Math.round(target - consumed + burned * (creditPct / 100))
}

// EWMA weight trend, fold over date-sorted weights
export function trendSeries(weightsKg: number[], alpha = 0.1): number[] {
  const out: number[] = []
  weightsKg.forEach((w, i) => {
    out.push(i === 0 ? w : out[i - 1] + alpha * (w - out[i - 1]))
  })
  return out
}

// Whole years from an ISO birthdate to a reference date.
export function ageOn(birthdateISO: string, on: Date): number {
  const b = new Date(birthdateISO)
  let age = on.getFullYear() - b.getFullYear()
  const m = on.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age -= 1
  return age
}
