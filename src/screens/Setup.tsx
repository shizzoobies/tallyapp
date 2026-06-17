import { useState, type FormEvent } from 'react'
import { api, todayISO, type Me } from '../api'
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from '../lib/units'

type Units = 'imperial' | 'metric'

const ACTIVITIES = [
  { key: 'sedentary', label: 'Sedentary (little or no exercise)' },
  { key: 'light', label: 'Light (1 to 3 days per week)' },
  { key: 'moderate', label: 'Moderate (3 to 5 days per week)' },
  { key: 'very', label: 'Very active (6 to 7 days per week)' },
  { key: 'extra', label: 'Extra active (hard daily training or physical job)' },
]

// Goal pace is stored in kg/week; lb equivalents are shown for intuition.
const RATE_OPTIONS = [
  { v: '0', l: 'Maintain weight' },
  { v: '-0.25', l: 'Lose 0.25 kg/week (about 0.5 lb)' },
  { v: '-0.5', l: 'Lose 0.5 kg/week (about 1 lb)' },
  { v: '-0.75', l: 'Lose 0.75 kg/week (about 1.6 lb)' },
  { v: '-1', l: 'Lose 1 kg/week (about 2 lb)' },
]

export default function Setup({ me, onDone }: { me: Me; onDone: () => void }) {
  const [units, setUnits] = useState<Units>(me.units ?? 'imperial')
  const [sex, setSex] = useState<'male' | 'female' | ''>(me.sex ?? '')
  const [birthdate, setBirthdate] = useState(me.birthdate ?? '')

  const init = me.height_cm != null ? cmToFtIn(me.height_cm) : { ft: 5, inch: 8 }
  const [ft, setFt] = useState(String(init.ft))
  const [inch, setInch] = useState(String(init.inch))
  const [cm, setCm] = useState(me.height_cm != null ? String(Math.round(me.height_cm)) : '')

  const [weight, setWeight] = useState(
    me.latest_weight_kg != null
      ? (me.units === 'imperial' ? kgToLb(me.latest_weight_kg) : me.latest_weight_kg).toFixed(1)
      : '',
  )
  const [goalWeight, setGoalWeight] = useState(
    me.goal_weight_kg != null
      ? (me.units === 'imperial' ? kgToLb(me.goal_weight_kg) : me.goal_weight_kg).toFixed(1)
      : '',
  )
  const [activity, setActivity] = useState(me.activity || 'sedentary')
  const [rate, setRate] = useState(String(me.goal_rate_kg_per_week ?? -0.5))
  const [creditPct, setCreditPct] = useState(String(me.exercise_credit_pct ?? 0))

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Switch units and convert any values already entered so they stay the same
  // physical measurement.
  function switchUnits(next: Units) {
    if (next === units) return
    if (next === 'metric') {
      if (ft || inch) setCm(String(Math.round(ftInToCm(Number(ft) || 0, Number(inch) || 0))))
    } else if (cm) {
      const r = cmToFtIn(Number(cm))
      setFt(String(r.ft))
      setInch(String(r.inch))
    }
    if (weight) {
      const kg = units === 'imperial' ? lbToKg(Number(weight)) : Number(weight)
      setWeight((next === 'imperial' ? kgToLb(kg) : kg).toFixed(1))
    }
    if (goalWeight) {
      const kg = units === 'imperial' ? lbToKg(Number(goalWeight)) : Number(goalWeight)
      setGoalWeight((next === 'imperial' ? kgToLb(kg) : kg).toFixed(1))
    }
    setUnits(next)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!sex) return setError('Please select your sex.')
    if (!birthdate) return setError('Please enter your birthdate.')
    const heightCm = units === 'imperial' ? ftInToCm(Number(ft), Number(inch)) : Number(cm)
    if (!(heightCm > 0 && heightCm < 300)) return setError('Please enter a valid height.')
    const weightKg = units === 'imperial' ? lbToKg(Number(weight)) : Number(weight)
    if (!(weightKg > 0 && weightKg < 700)) return setError('Please enter a valid current weight.')
    const goalKg = goalWeight
      ? units === 'imperial'
        ? lbToKg(Number(goalWeight))
        : Number(goalWeight)
      : null

    const round1 = (n: number) => Math.round(n * 10) / 10
    setBusy(true)
    try {
      const fields: Record<string, unknown> = {
        sex,
        birthdate,
        height_cm: round1(heightCm),
        activity,
        goal_rate_kg_per_week: Number(rate),
        exercise_credit_pct: Number(creditPct),
        units,
      }
      if (goalKg != null) fields.goal_weight_kg = round1(goalKg)
      await api.patchMe(fields)
      await api.postWeight(todayISO(), round1(weightKg))
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const weightUnit = units === 'imperial' ? 'lb' : 'kg'

  return (
    <div className="wrap">
      <div className="card">
        <h1>Set up your profile</h1>
        <p className="muted">A few details let us compute your daily calorie target.</p>
        <form onSubmit={save}>
          <label>Units</label>
          <div className="row">
            <button
              type="button"
              className={units === 'imperial' ? '' : 'secondary'}
              style={{ marginTop: 0 }}
              onClick={() => switchUnits('imperial')}
            >
              Imperial
            </button>
            <button
              type="button"
              className={units === 'metric' ? '' : 'secondary'}
              style={{ marginTop: 0 }}
              onClick={() => switchUnits('metric')}
            >
              Metric
            </button>
          </div>

          <label htmlFor="sex">Sex (used by the BMR formula)</label>
          <select id="sex" value={sex} onChange={(e) => setSex(e.target.value as 'male' | 'female' | '')}>
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>

          <label htmlFor="birthdate">Birthdate</label>
          <input id="birthdate" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />

          <label>Height</label>
          {units === 'imperial' ? (
            <div className="row">
              <input type="number" inputMode="numeric" placeholder="ft" value={ft} onChange={(e) => setFt(e.target.value)} />
              <input type="number" inputMode="numeric" placeholder="in" value={inch} onChange={(e) => setInch(e.target.value)} />
            </div>
          ) : (
            <input type="number" inputMode="numeric" placeholder="cm" value={cm} onChange={(e) => setCm(e.target.value)} />
          )}

          <label htmlFor="weight">Current weight ({weightUnit})</label>
          <input id="weight" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />

          <label htmlFor="goal">Goal weight ({weightUnit}, optional)</label>
          <input id="goal" type="number" inputMode="decimal" value={goalWeight} onChange={(e) => setGoalWeight(e.target.value)} />

          <label htmlFor="activity">Activity level</label>
          <select id="activity" value={activity} onChange={(e) => setActivity(e.target.value)}>
            {ACTIVITIES.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>

          <label htmlFor="rate">Weekly goal</label>
          <select id="rate" value={rate} onChange={(e) => setRate(e.target.value)}>
            {RATE_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </select>

          <label htmlFor="credit">Eat back exercise calories</label>
          <select id="credit" value={creditPct} onChange={(e) => setCreditPct(e.target.value)}>
            <option value="0">No (recommended)</option>
            <option value="50">Half (50 percent)</option>
            <option value="100">All (100 percent)</option>
          </select>
          <p className="help">
            Exercise burn is easy to overestimate, so the default credits none of it back to your
            eating budget.
          </p>

          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save and continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
