import { useCallback, useEffect, useState } from 'react'
import { api, shiftDate, todayISO, type Day, type Me } from '../api'
import { kgToLb } from '../lib/units'
import { LABEL_BY_KEY } from '../lib/mets'
import CalorieRing from '../components/CalorieRing'
import AddFood from './AddFood'
import AddExercise from './AddExercise'
import LogWeight from './LogWeight'

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

export default function Today({
  me,
  onEdit,
  onLogout,
  onMeChanged,
}: {
  me: Me
  onEdit: () => void
  onLogout: () => void
  onMeChanged: () => void
}) {
  const [date, setDate] = useState(todayISO())
  const [day, setDay] = useState<Day | null>(null)
  const [sheet, setSheet] = useState<null | 'food' | 'exercise' | 'weight'>(null)
  const [busy, setBusy] = useState(false)

  const loadDay = useCallback(async () => {
    setDay(await api.getDay(date))
  }, [date])

  useEffect(() => {
    loadDay()
  }, [loadDay])

  const isToday = date === todayISO()
  const imperial = me.units === 'imperial'

  function weightText(kg: number | null): string {
    if (kg == null) return 'not logged'
    return imperial ? `${kgToLb(kg).toFixed(1)} lb` : `${kg.toFixed(1)} kg`
  }

  async function removeFood(id: string) {
    await api.deleteFood(id)
    loadDay()
  }
  async function removeExercise(id: string) {
    await api.deleteExercise(id)
    loadDay()
  }
  async function logout() {
    setBusy(true)
    try {
      await api.logout()
    } finally {
      onLogout()
    }
  }

  const afterFoodOrExercise = () => {
    setSheet(null)
    loadDay()
  }
  const afterWeight = () => {
    setSheet(null)
    loadDay()
    onMeChanged() // weight changes the target, keep the cached profile fresh
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <button className="link" onClick={() => setDate(shiftDate(date, -1))}>
          {'<'} Prev
        </button>
        <strong>{isToday ? 'Today' : date}</strong>
        <button className="link" onClick={() => setDate(shiftDate(date, 1))} disabled={isToday}>
          Next {'>'}
        </button>
      </div>

      <div className="card center">
        {day && day.target != null ? (
          <CalorieRing target={day.target} consumed={day.consumed} remaining={day.remaining ?? 0} />
        ) : (
          <p className="muted">Loading...</p>
        )}
        {day && (
          <div className="ring-stats">
            <div>
              <div className="muted">Target</div>
              <div className="stat-val">{day.target}</div>
            </div>
            <div>
              <div className="muted">Food</div>
              <div className="stat-val">{day.consumed}</div>
            </div>
            <div>
              <div className="muted">Exercise</div>
              <div className="stat-val">{day.burned}</div>
            </div>
          </div>
        )}
        {day && day.exercise_credit_pct === 0 && day.burned > 0 && (
          <p className="help">Exercise is shown but not added back to your budget (your setting).</p>
        )}
      </div>

      <div className="card">
        <div className="stat">
          <span className="muted">Weight {isToday ? 'today' : 'this day'}</span>
          <span>
            {weightText(day?.weight_kg ?? null)}{' '}
            <button className="link" onClick={() => setSheet('weight')}>
              Log
            </button>
          </span>
        </div>
      </div>

      <div className="actions">
        <button onClick={() => setSheet('food')}>+ Add food</button>
        <button className="secondary" onClick={() => setSheet('exercise')}>
          + Add exercise
        </button>
      </div>

      {day && day.foods.length > 0 && (
        <div className="card">
          <h2 className="section">Food</h2>
          {MEAL_ORDER.filter((m) => day.foods.some((f) => (f.meal ?? 'snack') === m)).map((m) => (
            <div key={m}>
              <div className="meal-head">{m[0].toUpperCase() + m.slice(1)}</div>
              {day.foods
                .filter((f) => (f.meal ?? 'snack') === m)
                .map((f) => (
                  <div key={f.id} className="item">
                    <span className="item-name">{f.name}</span>
                    <span className="item-right">
                      <span>{Math.round(f.calories)} kcal</span>
                      <button className="link danger" onClick={() => removeFood(f.id)}>
                        Delete
                      </button>
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {day && day.exercises.length > 0 && (
        <div className="card">
          <h2 className="section">Exercise</h2>
          {day.exercises.map((e) => (
            <div key={e.id} className="item">
              <span className="item-name">
                {LABEL_BY_KEY[e.activity_key] ?? e.activity_key} ({e.duration_min} min)
              </span>
              <span className="item-right">
                <span>{e.calories_burned} kcal</span>
                <button className="link danger" onClick={() => removeExercise(e.id)}>
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="center" style={{ marginTop: 18 }}>
        <button className="link" onClick={onEdit}>
          Profile
        </button>
        <span className="muted"> | </span>
        <button className="link" onClick={logout} disabled={busy}>
          Log out
        </button>
      </div>

      {sheet === 'food' && <AddFood date={date} onSaved={afterFoodOrExercise} onClose={() => setSheet(null)} />}
      {sheet === 'exercise' && (
        <AddExercise
          date={date}
          latestWeightKg={day?.weight_kg ?? me.latest_weight_kg}
          onSaved={afterFoodOrExercise}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'weight' && (
        <LogWeight
          date={date}
          units={me.units}
          currentKg={day?.weight_kg ?? me.latest_weight_kg}
          onSaved={afterWeight}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
