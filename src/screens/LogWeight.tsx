import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { kgToLb, lbToKg } from '../lib/units'
import Sheet from '../components/Sheet'

export default function LogWeight({
  date,
  units,
  currentKg,
  onSaved,
  onClose,
}: {
  date: string
  units: 'metric' | 'imperial'
  currentKg: number | null
  onSaved: () => void
  onClose: () => void
}) {
  const imperial = units === 'imperial'
  const [value, setValue] = useState(
    currentKg != null ? (imperial ? kgToLb(currentKg) : currentKg).toFixed(1) : '',
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return setError('Please enter your weight.')
    const kg = imperial ? lbToKg(n) : n
    setBusy(true)
    try {
      await api.postWeight(date, Math.round(kg * 10) / 10)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Log weight" onClose={onClose}>
      <form onSubmit={save}>
        <label htmlFor="w">Weight ({imperial ? 'lb' : 'kg'})</label>
        <input id="w" type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save weight'}
        </button>
      </form>
    </Sheet>
  )
}
