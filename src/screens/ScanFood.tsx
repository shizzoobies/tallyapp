import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type BarcodeResult } from '../api'
import Sheet from '../components/Sheet'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
type Stage = 'scan' | 'lookup' | 'confirm' | 'manual'

// Minimal typing for the experimental BarcodeDetector API (not in lib.dom yet).
type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

const round1 = (n: number) => Math.round(n * 10) / 10

export default function ScanFood({
  date,
  onSaved,
  onClose,
}: {
  date: string
  onSaved: () => void
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('scan')
  const [scannedCode, setScannedCode] = useState('')
  const [typed, setTyped] = useState('')
  const [camError, setCamError] = useState('')

  const [result, setResult] = useState<BarcodeResult | null>(null)
  const [name, setName] = useState('')
  const [meal, setMeal] = useState('snack')
  const [qty, setQty] = useState('100')
  const [barcode, setBarcode] = useState('')

  // Manual fallback fields
  const [mCal, setMCal] = useState('')
  const [mProtein, setMProtein] = useState('')
  const [mCarbs, setMCarbs] = useState('')
  const [mFat, setMFat] = useState('')

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Live camera scanning, only while on the scan stage.
  useEffect(() => {
    if (stage !== 'scan') return
    let stopped = false
    let raf = 0
    let stream: MediaStream | null = null
    let zxingControls: { stop: () => void } | null = null

    function gotCode(code: string) {
      if (stopped) return
      stopped = true
      cleanup()
      setScannedCode(code)
      setStage('lookup')
    }
    function cleanup() {
      stopped = true
      if (raf) cancelAnimationFrame(raf)
      if (zxingControls) {
        try {
          zxingControls.stop()
        } catch {
          /* noop */
        }
      }
      if (stream) stream.getTracks().forEach((t) => t.stop())
      stream = null
    }

    async function start() {
      const video = videoRef.current
      if (!video) return
      const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      try {
        if (Ctor) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          if (stopped) return cleanup()
          video.srcObject = stream
          await video.play()
          const detector = new Ctor({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
          })
          const tick = async () => {
            if (stopped) return
            try {
              const hits = await detector.detect(video)
              if (hits.length > 0) return gotCode(hits[0].rawValue)
            } catch {
              /* frame not ready, keep going */
            }
            raf = requestAnimationFrame(tick)
          }
          raf = requestAnimationFrame(tick)
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          zxingControls = await reader.decodeFromVideoDevice(undefined, video, (res) => {
            if (res) gotCode(res.getText())
          })
          if (stopped) cleanup()
        }
      } catch {
        setCamError('Camera unavailable. Type the barcode below, or add the item manually.')
      }
    }
    void start()
    return cleanup
  }, [stage])

  // Look up whatever code we captured (camera or typed).
  useEffect(() => {
    if (stage !== 'lookup' || !scannedCode) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.lookupBarcode(scannedCode)
        if (cancelled) return
        setResult(res)
        setBarcode(scannedCode)
        setName(res.name ?? '')
        if (res.found && res.calories != null) {
          setQty(res.basis === '100g' ? '100' : '1')
          setStage('confirm')
        } else {
          // Unknown barcode or missing calories: fall through to manual entry.
          setStage('manual')
        }
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message)
        setStage('manual')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [stage, scannedCode])

  function submitTyped(e: FormEvent) {
    e.preventDefault()
    const code = typed.trim()
    if (!/^\d{6,14}$/.test(code)) return setCamError('Enter a barcode of 6 to 14 digits.')
    setCamError('')
    setScannedCode(code)
    setStage('lookup')
  }

  const factor = result?.basis === '100g' ? (Number(qty) || 0) / 100 : Number(qty) || 0
  const scaled = {
    calories: Math.round((result?.calories ?? 0) * factor),
    protein_g: round1((result?.protein_g ?? 0) * factor),
    carbs_g: round1((result?.carbs_g ?? 0) * factor),
    fat_g: round1((result?.fat_g ?? 0) * factor),
  }

  async function saveDb(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('Please enter a name.')
    if (!(scaled.calories >= 0) || !(factor > 0)) return setError('Please enter a valid quantity.')
    setBusy(true)
    try {
      await api.postFood({
        date,
        meal,
        name: name.trim(),
        calories: scaled.calories,
        protein_g: scaled.protein_g,
        carbs_g: scaled.carbs_g,
        fat_g: scaled.fat_g,
        source: 'db',
        barcode: barcode || null,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveManual(e: FormEvent) {
    e.preventDefault()
    setError('')
    const kcal = Number(mCal)
    if (!name.trim()) return setError('Please enter a name.')
    if (!Number.isFinite(kcal) || kcal < 0) return setError('Please enter calories as a number.')
    setBusy(true)
    try {
      await api.postFood({
        date,
        meal,
        name: name.trim(),
        calories: kcal,
        protein_g: Number(mProtein) || 0,
        carbs_g: Number(mCarbs) || 0,
        fat_g: Number(mFat) || 0,
        source: 'manual',
        barcode: barcode || null,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const mealField = (
    <>
      <label htmlFor="smeal">Meal</label>
      <select id="smeal" value={meal} onChange={(e) => setMeal(e.target.value)}>
        {MEALS.map((m) => (
          <option key={m} value={m}>
            {m[0].toUpperCase() + m.slice(1)}
          </option>
        ))}
      </select>
    </>
  )

  return (
    <Sheet title="Scan barcode" onClose={onClose}>
      {stage === 'scan' && (
        <>
          <div className="scanner">
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="scanner-line" />
          </div>
          <p className="help">Point the camera at a barcode. Packaged foods scan most accurately.</p>
          {camError && <div className="error">{camError}</div>}
          <form onSubmit={submitTyped}>
            <label htmlFor="typed">Or type the barcode</label>
            <div className="row">
              <input id="typed" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. 3017620422003" />
              <button type="submit" style={{ marginTop: 0, flex: '0 0 auto' }}>
                Look up
              </button>
            </div>
          </form>
          <div className="center">
            <button
              className="link"
              onClick={() => {
                setResult(null)
                setName('')
                setBarcode('')
                setStage('manual')
              }}
            >
              No barcode? Add manually
            </button>
          </div>
        </>
      )}

      {stage === 'lookup' && <p className="muted" style={{ padding: '24px 0' }}>Looking up {scannedCode}...</p>}

      {stage === 'confirm' && result && (
        <form onSubmit={saveDb}>
          <p className="muted">From Open Food Facts {result.serving_text ? `(serving: ${result.serving_text})` : ''}</p>
          <label htmlFor="dbname">Name</label>
          <input id="dbname" value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="qty">{result.basis === '100g' ? 'Grams eaten' : 'Servings'}</label>
          <input id="qty" type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          {result.basis === '100g' && <p className="help">Values from the database are per 100 g and scale to the grams you enter.</p>}

          {mealField}

          <div className="est-items" style={{ marginTop: 14 }}>
            <div className="item"><span className="item-name">Calories</span><span>{scaled.calories} kcal</span></div>
            <div className="item"><span className="item-name">Protein / Carbs / Fat</span><span>{scaled.protein_g} / {scaled.carbs_g} / {scaled.fat_g} g</span></div>
          </div>

          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Add to log'}</button>
        </form>
      )}

      {stage === 'manual' && (
        <form onSubmit={saveManual}>
          <p className="muted">
            {result && !result.found
              ? 'Not in the Open Food Facts database. Enter the details manually.'
              : barcode
                ? 'This item is missing calorie data. Enter the details manually.'
                : 'Add an item manually.'}
          </p>
          <label htmlFor="mname">Name</label>
          <input id="mname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Granola bar" />
          {mealField}
          <label htmlFor="mcal">Calories</label>
          <input id="mcal" type="number" inputMode="numeric" value={mCal} onChange={(e) => setMCal(e.target.value)} />
          <label>Macros (grams, optional)</label>
          <div className="row">
            <input type="number" inputMode="numeric" placeholder="protein" value={mProtein} onChange={(e) => setMProtein(e.target.value)} />
            <input type="number" inputMode="numeric" placeholder="carbs" value={mCarbs} onChange={(e) => setMCarbs(e.target.value)} />
            <input type="number" inputMode="numeric" placeholder="fat" value={mFat} onChange={(e) => setMFat(e.target.value)} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Add to log'}</button>
        </form>
      )}
    </Sheet>
  )
}
