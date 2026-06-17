import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../api'
import { downscaleToJpeg } from '../lib/image'
import type { Estimate } from '../lib/estimate'
import Sheet from '../components/Sheet'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
type Stage = 'pick' | 'working' | 'confirm'

export default function SnapMeal({
  date,
  onSaved,
  onClose,
}: {
  date: string
  onSaved: () => void
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('pick')
  const [restaurant, setRestaurant] = useState('')
  const [description, setDescription] = useState('')
  const [photoKey, setPhotoKey] = useState('')
  const [preview, setPreview] = useState('')
  const [est, setEst] = useState<Estimate | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // User-confirmed values (the totals are what get saved and drive the math).
  const [name, setName] = useState('')
  const [meal, setMeal] = useState('lunch')
  const [cal, setCal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setStage('working')
    try {
      const blob = await downscaleToJpeg(file)
      setPreview(URL.createObjectURL(blob))
      const { photo_key } = await api.uploadPhoto(blob)
      setPhotoKey(photo_key)
      const estimate = await api.estimate({ photo_key, restaurant, description })
      setEst(estimate)
      setName(description || restaurant || estimate.items[0]?.name || 'Photographed meal')
      setCal(String(estimate.total.calories))
      setProtein(String(estimate.total.protein_g))
      setCarbs(String(estimate.total.carbs_g))
      setFat(String(estimate.total.fat_g))
      setStage('confirm')
    } catch (err) {
      setError((err as Error).message)
      setStage('pick')
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    const kcal = Number(cal)
    if (!name.trim()) return setError('Please name this meal.')
    if (!Number.isFinite(kcal) || kcal < 0) return setError('Calories must be a number.')
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
        source: 'ai',
        photo_key: photoKey,
        restaurant: restaurant.trim() || null,
        ai_raw_json: est ? JSON.stringify(est) : null,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Snap a meal" onClose={onClose}>
      {stage === 'pick' && (
        <>
          <label htmlFor="rest">Restaurant (optional)</label>
          <input id="rest" value={restaurant} onChange={(e) => setRestaurant(e.target.value)} placeholder="e.g. Chipotle" />
          <label htmlFor="desc">What is it (optional)</label>
          <input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. chicken burrito bowl, no rice" />
          <label htmlFor="photo">Photo</label>
          <input id="photo" type="file" accept="image/*" capture="environment" onChange={onFile} />
          <p className="help">
            Naming the restaurant and dish sharpens the estimate. You can edit everything before saving.
          </p>
          {error && <div className="error">{error}</div>}
        </>
      )}

      {stage === 'working' && (
        <p className="muted" style={{ padding: '24px 0' }}>
          Uploading and estimating from your photo...
        </p>
      )}

      {stage === 'confirm' && est && (
        <form onSubmit={save}>
          {preview && <img src={preview} alt="your meal" className="meal-photo" />}
          <span className={`badge badge-${est.confidence}`}>{est.confidence} confidence</span>
          {est.notes && <p className="help">{est.notes}</p>}

          <div className="est-items">
            {est.items.map((it, i) => (
              <div key={i} className="item">
                <span className="item-name">
                  {it.name}
                  {it.portion ? ` (${it.portion})` : ''}
                </span>
                <span>{it.calories} kcal</span>
              </div>
            ))}
          </div>
          <p className="help">
            The per-item numbers are the AI draft. Edit the totals below; those are what get saved.
          </p>

          <label htmlFor="mname">Name</label>
          <input id="mname" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="mmeal">Meal</label>
          <select id="mmeal" value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {m[0].toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
          <label htmlFor="mcal">Calories (total)</label>
          <input id="mcal" type="number" inputMode="numeric" value={cal} onChange={(e) => setCal(e.target.value)} />
          <label>Macros total (grams)</label>
          <div className="row">
            <input type="number" inputMode="numeric" placeholder="protein" value={protein} onChange={(e) => setProtein(e.target.value)} />
            <input type="number" inputMode="numeric" placeholder="carbs" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
            <input type="number" inputMode="numeric" placeholder="fat" value={fat} onChange={(e) => setFat(e.target.value)} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save to log'}
          </button>
        </form>
      )}
    </Sheet>
  )
}
