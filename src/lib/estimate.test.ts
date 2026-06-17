import { describe, it, expect } from 'vitest'
import { parseEstimateText } from './estimate'

const good = JSON.stringify({
  items: [{ name: 'Burrito bowl', portion: '1 bowl', calories: 720, protein_g: 40, carbs_g: 80, fat_g: 25 }],
  total: { calories: 720, protein_g: 40, carbs_g: 80, fat_g: 25 },
  confidence: 'medium',
  notes: 'Chipotle bowl, anchored to published values.',
})

describe('parseEstimateText', () => {
  it('parses clean JSON', () => {
    const e = parseEstimateText(good)
    expect(e?.total.calories).toBe(720)
    expect(e?.items).toHaveLength(1)
    expect(e?.confidence).toBe('medium')
  })

  it('strips code fences', () => {
    const e = parseEstimateText('```json\n' + good + '\n```')
    expect(e?.total.calories).toBe(720)
  })

  it('recovers JSON wrapped in prose', () => {
    const e = parseEstimateText('Here is the estimate:\n' + good + '\nHope that helps.')
    expect(e?.total.calories).toBe(720)
  })

  it('coerces bad numbers to zero and defaults confidence', () => {
    const e = parseEstimateText(
      JSON.stringify({ items: [{ name: 'X', calories: 'lots' }], total: { calories: -5 }, confidence: 'sure' }),
    )
    expect(e?.items[0].calories).toBe(0)
    expect(e?.total.calories).toBe(0)
    expect(e?.confidence).toBe('low')
  })

  it('returns null for non-JSON', () => expect(parseEstimateText('no json here')).toBeNull())
  it('returns null when items is missing', () =>
    expect(parseEstimateText(JSON.stringify({ total: { calories: 1 } }))).toBeNull())
  it('returns null for empty input', () => expect(parseEstimateText('')).toBeNull())
})
