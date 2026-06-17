import { useState } from 'react'
import { api, type Me } from '../api'
import { kgToLb } from '../lib/units'

export default function Home({
  me,
  onEdit,
  onLogout,
}: {
  me: Me
  onEdit: () => void
  onLogout: () => void
}) {
  const [busy, setBusy] = useState(false)
  const imperial = me.units === 'imperial'

  function weightText(): string {
    if (me.latest_weight_kg == null) return 'not set'
    return imperial
      ? `${kgToLb(me.latest_weight_kg).toFixed(1)} lb`
      : `${me.latest_weight_kg.toFixed(1)} kg`
  }

  function rateText(): string {
    const r = me.goal_rate_kg_per_week ?? 0
    if (r === 0) return 'Maintain'
    const perWeek = imperial ? `${kgToLb(Math.abs(r)).toFixed(1)} lb/week` : `${Math.abs(r)} kg/week`
    return `Lose ${perWeek}`
  }

  async function logout() {
    setBusy(true)
    try {
      await api.logout()
    } finally {
      onLogout()
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>Today</h1>
        <p className="muted">{me.email}</p>

        <p className="muted" style={{ marginTop: 18 }}>Daily calorie target</p>
        <div className="target">{me.daily_target}</div>

        <div className="stat">
          <span className="muted">Maintenance (TDEE)</span>
          <span>{me.tdee} kcal</span>
        </div>
        <div className="stat">
          <span className="muted">Current weight</span>
          <span>{weightText()}</span>
        </div>
        <div className="stat">
          <span className="muted">Goal pace</span>
          <span>{rateText()}</span>
        </div>

        <button className="secondary" onClick={onEdit}>
          Edit profile
        </button>
        <div className="center">
          <button className="link" style={{ marginTop: 12 }} onClick={logout} disabled={busy}>
            Log out
          </button>
        </div>
      </div>
      <p className="muted center" style={{ marginTop: 16 }}>
        Food logging, exercise, and trends arrive in the next phases.
      </p>
    </div>
  )
}
