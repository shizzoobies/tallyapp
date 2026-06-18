import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { api, formatDate, shiftDate, todayISO, type HistoryPoint, type Me, type WeightPoint } from '../api'
import { daysToGoal, linregSlope } from '../lib/calc'
import { kgToLb } from '../lib/units'

const round1 = (n: number) => Math.round(n * 10) / 10
const shortDate = (iso: string) => iso.slice(5) // MM-DD

export default function Trends({ me, onBack }: { me: Me; onBack: () => void }) {
  const [weights, setWeights] = useState<WeightPoint[] | null>(null)
  const [history, setHistory] = useState<HistoryPoint[] | null>(null)
  const [error, setError] = useState('')

  const imperial = me.units === 'imperial'
  const unit = imperial ? 'lb' : 'kg'
  const toDisp = (kg: number) => (imperial ? kgToLb(kg) : kg)

  useEffect(() => {
    const today = todayISO()
    const from = shiftDate(today, -29)
    Promise.all([api.getWeights(), api.getHistory(from, today)])
      .then(([w, h]) => {
        setWeights(w)
        setHistory(h)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  const weightData = useMemo(
    () =>
      (weights ?? []).map((w) => ({
        label: shortDate(w.date),
        weight: round1(toDisp(w.weight_kg)),
        trend: round1(toDisp(w.trend_kg)),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weights, imperial],
  )

  const calData = useMemo(
    () => (history ?? []).map((h) => ({ label: shortDate(h.date), consumed: h.consumed })),
    [history],
  )

  const projection = useMemo(() => {
    if (!weights || weights.length < 2 || me.goal_weight_kg == null) return null
    const pts = weights.slice(-21)
    const t0 = new Date(pts[0].date + 'T12:00:00').getTime()
    const xs = pts.map((p) => (new Date(p.date + 'T12:00:00').getTime() - t0) / 86_400_000)
    const ys = pts.map((p) => p.trend_kg)
    const slope = linregSlope(xs, ys) // kg per day
    const days = daysToGoal(ys[ys.length - 1], me.goal_weight_kg, slope)
    if (days == null) return { onTrack: false as const }
    const d = new Date()
    d.setDate(d.getDate() + days)
    return { onTrack: true as const, days, date: formatDate(d), weeklyKg: slope * 7 }
  }, [weights, me.goal_weight_kg])

  const goalDisp = me.goal_weight_kg != null ? round1(toDisp(me.goal_weight_kg)) : null

  return (
    <div className="wrap">
      <div className="topbar">
        <button className="link" onClick={onBack}>
          {'<'} Back
        </button>
        <strong>Trends</strong>
        <span style={{ width: 44 }} />
      </div>

      {error && (
        <div className="card">
          <div className="error">{error}</div>
        </div>
      )}

      <div className="card">
        <h2 className="section">Weight trend ({unit})</h2>
        {weightData.length < 2 ? (
          <p className="muted">Log your weight on a few days to see your trend line.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={weightData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="#ece8e0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
              <Tooltip />
              {goalDisp != null && <ReferenceLine y={goalDisp} stroke="#7d8c7b" strokeDasharray="4 4" />}
              <Line type="monotone" dataKey="weight" stroke="#cfc8bd" strokeWidth={1} dot={{ r: 2 }} isAnimationActive={false} name="daily" />
              <Line type="monotone" dataKey="trend" stroke="#566b52" strokeWidth={2.5} dot={false} isAnimationActive={false} name="trend" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <p className="help">
          Faint dots are daily readings. The bold line is the smoothed trend, and goal-pace feedback
          follows the trend, not the daily noise.
        </p>
      </div>

      <div className="card">
        <h2 className="section">Projected goal</h2>
        {projection == null ? (
          <p className="muted">Set a goal weight and log a couple of weeks of weight to see a projection.</p>
        ) : projection.onTrack ? (
          <p>
            At about {Math.abs(round1(imperial ? kgToLb(projection.weeklyKg) : projection.weeklyKg))} {unit}/week, you
            reach your goal around <strong>{projection.date}</strong> (about {projection.days} days).
          </p>
        ) : (
          <p className="muted">Your recent trend is not moving toward your goal yet. Keep logging.</p>
        )}
      </div>

      <div className="card">
        <h2 className="section">Calories vs target (last 30 days)</h2>
        {calData.length === 0 ? (
          <p className="muted">No food logged in this range yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={calData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="#ece8e0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              {me.daily_target != null && <ReferenceLine y={me.daily_target} stroke="#b3473f" strokeDasharray="4 4" />}
              <Bar dataKey="consumed" fill="#7d8c7b" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
        {me.daily_target != null && (
          <p className="help">The dashed line is your current target of {me.daily_target} kcal.</p>
        )}
      </div>
    </div>
  )
}
