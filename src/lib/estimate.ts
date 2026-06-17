// Shape of the AI food estimate, and a tolerant parser for the model's text.
// The model is told to return raw JSON, but we defend against code fences and
// stray prose so a good estimate is not lost to formatting.

export type EstimateItem = {
  name: string
  portion: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

export type EstimateTotal = {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

export type Estimate = {
  items: EstimateItem[]
  total: EstimateTotal
  confidence: 'low' | 'medium' | 'high'
  notes: string
}

function nn(x: unknown): number {
  const n = Number(x)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function parseEstimateText(text: string): Estimate | null {
  if (!text) return null
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()

  let data: unknown = null
  try {
    data = JSON.parse(cleaned)
  } catch {
    // Fall back to the first {...} block if the model wrapped it in prose.
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      data = JSON.parse(m[0])
    } catch {
      return null
    }
  }

  const d = data as Record<string, unknown>
  if (!d || !Array.isArray(d.items) || typeof d.total !== 'object' || d.total === null) return null

  const items: EstimateItem[] = (d.items as unknown[]).map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>
    return {
      name: String(it.name ?? 'Item'),
      portion: String(it.portion ?? ''),
      calories: nn(it.calories),
      protein_g: nn(it.protein_g),
      carbs_g: nn(it.carbs_g),
      fat_g: nn(it.fat_g),
    }
  })

  const t = d.total as Record<string, unknown>
  const total: EstimateTotal = {
    calories: nn(t.calories),
    protein_g: nn(t.protein_g),
    carbs_g: nn(t.carbs_g),
    fat_g: nn(t.fat_g),
  }

  const confidence =
    d.confidence === 'low' || d.confidence === 'medium' || d.confidence === 'high'
      ? d.confidence
      : 'low'

  return { items, total, confidence, notes: String(d.notes ?? '') }
}
