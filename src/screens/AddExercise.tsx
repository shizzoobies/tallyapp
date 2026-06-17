import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { exerciseKcal } from '../lib/calc'
import { METS, MET_BY_KEY } from '../lib/mets'
import Sheet from '../components/Sheet'

export default function AddExercise({
  date,
  latestWeightKg,
  onSaved,
  onClose,
}: {
  date: string
  latestWeightKg: number | null
  onSaved: () => void
  onClose: () => void
}) {
  const [key, setKey] = useState(METS[0].key)
  const [minutes, setMinutes] = useState('30')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const mins = Number(minutes)
  const preview =
    latestWeightKg != null && Number.isFinite(mins) && mins > 0
      ? exerciseKcal(MET_BY_KEY[key], latestWeightKg, mins)
      : null

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!Number.isFinite(mins) || mins <= 0) return setError('Please enter minutes.')
    setBusy(true)
    try {
      await api.postExercise(date, key, mins)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add exercise" onClose={onClose}>
      <form onSubmit={save}>
        <label htmlFor="act">Activity</label>
        <select id="act" value={key} onChange={(e) => setKey(e.target.value)}>
          {METS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        <label htmlFor="mins">Minutes</label>
        <input id="mins" type="number" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />

        <p className="help">
          {preview != null
            ? `Estimated burn: about ${preview} kcal. The server computes the saved value from your latest weight.`
            : 'Estimated burn appears once minutes are set.'}
        </p>

        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Add exercise'}
        </button>
      </form>
    </Sheet>
  )
}
