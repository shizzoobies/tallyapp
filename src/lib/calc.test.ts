import { describe, it, expect } from 'vitest'
import {
  bmr,
  tdee,
  dailyTarget,
  exerciseKcal,
  remaining,
  trendSeries,
  ageOn,
  linregSlope,
  daysToGoal,
} from './calc'

describe('bmr (Mifflin-St Jeor)', () => {
  it('male', () => expect(bmr('male', 80, 180, 30)).toBe(1780))
  it('female', () => expect(bmr('female', 50, 160, 25)).toBe(1214))
})

describe('tdee', () => {
  it('moderate', () => expect(tdee(1780, 'moderate')).toBeCloseTo(2759, 6))
  it('sedentary', () => expect(tdee(1214, 'sedentary')).toBeCloseTo(1456.8, 6))
})

describe('dailyTarget', () => {
  // Hand-checked sample profile (SPEC P1 acceptance): male, 80 kg, 180 cm, age 30,
  // moderate activity, losing 0.5 kg/week -> 2209 kcal.
  it('male, lose 0.5 kg/week', () => expect(dailyTarget(2759, -0.5, 'male')).toBe(2209))
  it('applies the female floor', () => expect(dailyTarget(1456.8, -1, 'female')).toBe(1200))
  it('applies the male floor', () => expect(dailyTarget(1600, -1, 'male')).toBe(1500))
})

describe('exerciseKcal', () => {
  it('brisk walk, 30 min, 80 kg', () => expect(exerciseKcal(4.3, 80, 30)).toBe(172))
})

describe('remaining', () => {
  it('no exercise credit', () => expect(remaining(1800, 600, 172, 0)).toBe(1200))
  it('50 percent credit', () => expect(remaining(1800, 600, 172, 50)).toBe(1286))
  it('100 percent credit', () => expect(remaining(1800, 600, 172, 100)).toBe(1372))
})

describe('trendSeries (EWMA alpha 0.1)', () => {
  it('seeds with the first reading', () => expect(trendSeries([80])[0]).toBe(80))
  it('smooths toward the readings', () => {
    const t = trendSeries([80, 79, 81, 80], 0.1)
    expect(t[0]).toBe(80)
    expect(t[1]).toBeCloseTo(79.9, 6)
    expect(t[2]).toBeCloseTo(80.01, 6)
    expect(t[3]).toBeCloseTo(80.009, 6)
  })
  it('handles an empty series', () => expect(trendSeries([])).toEqual([]))
})

describe('ageOn', () => {
  it('after the birthday this year', () =>
    expect(ageOn('1996-01-01', new Date('2026-06-17'))).toBe(30))
  it('before the birthday this year', () =>
    expect(ageOn('1996-12-31', new Date('2026-06-17'))).toBe(29))
})

describe('linregSlope', () => {
  it('positive line', () => expect(linregSlope([0, 1, 2, 3], [0, 2, 4, 6])).toBeCloseTo(2, 6))
  it('weight loss 0.1 kg/day', () => expect(linregSlope([0, 10, 20], [80, 79, 78])).toBeCloseTo(-0.1, 6))
  it('flat line', () => expect(linregSlope([0, 1, 2], [70, 70, 70])).toBe(0))
  it('needs two points', () => expect(linregSlope([1], [5])).toBe(0))
})

describe('daysToGoal', () => {
  it('50 days at 0.1 kg/day loss', () => expect(daysToGoal(80, 75, -0.1)).toBe(50))
  it('null when moving away from goal', () => expect(daysToGoal(80, 75, 0.1)).toBeNull())
  it('null when flat', () => expect(daysToGoal(80, 75, 0)).toBeNull())
})
