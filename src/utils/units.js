// utils/units.js
export function parseLengthToMm(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim().toLowerCase().replace(/,/g, '');
  const m = s.match(/([\d.]+)\s*(mm|cm|m)\b/);
  if (m) {
    const val = parseFloat(m[1]);
    const u = m[2];
    if (u === 'mm') return Math.round(val);
    if (u === 'cm') return Math.round(val * 10);
    if (u === 'm')  return Math.round(val * 1000);
  }
  const n = parseFloat(s);
  if (!Number.isNaN(n)) return n > 1000 ? Math.round(n) : Math.round(n * 1000);
  return 0;
}

export function parseCapacityToKg(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim().toLowerCase().replace(/[, ]/g, '');
  const m = s.match(/([\d.]+)\s*(kg|t|ton|tons|tonne|tonnes)?/);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const u = m[2] || (val > 1000 ? 'kg' : 't');
  if (u === 'kg') return Math.round(val);
  return Math.round(val * 1000);
}

export function parseDimsFromString(s) {
  if (!s) return { lengthMm: 0, widthMm: 0 };
  const str = String(s).toLowerCase();
  const L = str.match(/l(?:ength)?\s*[:=]?\s*([\d.]+)\s*(mm|cm|m)/);
  const W = str.match(/w(?:idth)?\s*[:=]?\s*([\d.]+)\s*(mm|cm|m)/);
  if (L || W) {
    return {
      lengthMm: L ? parseLengthToMm(L[1] + L[2]) : 0,
      widthMm:  W ? parseLengthToMm(W[1] + W[2]) : 0,
    };
  }
  const parts = str.split(/x|×/i).map(p => parseLengthToMm(p)).filter(Boolean);
  if (parts.length >= 2) {
    const sorted = [...parts].sort((a,b)=>a-b);
    return { widthMm: sorted[0], lengthMm: sorted[sorted.length - 1] };
  }
  return { lengthMm: parseLengthToMm(str), widthMm: 0 };
}
