// Display conversions. Storage is always metric (kg, cm) per SPEC 3.5; these run
// only at the UI edge so the user can work in imperial.

export const KG_PER_LB = 0.45359237

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB
}

export function ftInToCm(ft: number, inch: number): number {
  return (ft * 12 + inch) * 2.54
}

export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / 2.54
  const ft = Math.floor(totalIn / 12)
  let inch = Math.round(totalIn - ft * 12)
  // Rounding can push inches to 12; carry into feet.
  if (inch === 12) return { ft: ft + 1, inch: 0 }
  return { ft, inch }
}
