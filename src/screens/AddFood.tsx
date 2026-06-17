import { useState, type FormEvent } from 'react'
import { api } from '../api'
import Sheet from '../components/Sheet'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

export default function AddFood({
  date,
  defaultMeal,
  onSaved,
  onClose,
}: {
  date: string
  defaultMeal?: string
  onSaved: () => void
  onClose: () => void
}) {
  const [meal, setMeal] = useState(defaultMeal ?? 'breakfast')
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    const kcal = Number(calories)
    if (!name.trim()) return setError('Please enter a food name.')
    if (!Number.isFinite(kcal) || kcal < 0) return setError('Please enter calories as a number.')
    setBusy(true)
    try {
      await api.postFood({
        date,
        meal,
        name: name.trim(),
        calories: kcal,
        protein_g: Number(protein) || 0,
        carbs_g: Number(carbs) || 0,
        fat_g: Number(fat) || 0,
        source: 'manual',
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add food" onClose={onClose}>
      <form onSubmit={save}>
        <label htmlFor="meal">Meal</label>
        <select id="meal" value={meal} onChange={(e) => setMeal(e.target.value)}>
          {MEALS.map((m) => (
            <option key={m} value={m}>
              {m[0].toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>

        <label htmlFor="fname">Name</label>
        <input id="fname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Greek yogurt" />

        <label htmlFor="fkcal">Calories</label>
        <input id="fkcal" type="number" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />

        <label>Macros (grams, optional)</label>
        <div className="row">
          <input type="number" inputMode="numeric" placeholder="protein" value={protein} onChange={(e) => setProtein(e.target.value)} />
          <input type="number" inputMode="numeric" placeholder="carbs" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          <input type="number" inputMode="numeric" placeholder="fat" value={fat} onChange={(e) => setFat(e.target.value)} />
        </div>

        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Add food'}
        </button>
      </form>
    </Sheet>
  )
}
