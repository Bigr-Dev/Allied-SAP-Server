/* ============================== utils ============================== */

export function toInt(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function asBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback
  const s = String(v).trim().toLowerCase()
  if (s === 'true' || s === '1') return true
  if (s === 'false' || s === '0') return false
  return fallback
}

export function toNumber(n, fallback = 0) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}


export function parseCapacityKg(raw) {
  if (raw == null) return Infinity
  const cleaned = String(raw).replace(/[^\d.]/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return Infinity
  return n
}