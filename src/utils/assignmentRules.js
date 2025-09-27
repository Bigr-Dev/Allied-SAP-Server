// utils/assignmentRules.js
// Normalization, requirement calculators, customer-cap, scoring, and HORSE↔TRAILER pairing
// Uses vehicles.assigned_to to represent a trailer->horse link. The controller NEVER mutates this link.

import { parseLengthToMm, parseCapacityToKg, parseDimsFromString } from './units.js';

/** Build a normalized in-memory pool of vehicles */
export function normalizeVehicles(vehiclesRaw) {
  return (vehiclesRaw || [])
    .filter(v => !v.status || String(v.status).toLowerCase() === 'available')
    .map(v => {
      const capKg = parseCapacityToKg(v.capacity);
      const lengthMm = parseLengthToMm(v.length) || parseDimsFromString(v.dimensions).lengthMm;
      const widthMm  = parseLengthToMm(v.width)  || parseDimsFromString(v.dimensions).widthMm;
      const prio = Number.parseFloat(v.priority) || 0;
      return {
        id: v.id,
        branch_id: v.branch_id || null,
        type: (v.type || '').toUpperCase(),           // 'HORSE', 'TRAILER', 'RIGID', etc.
        category: (v.vehicle_category || '').toUpperCase().trim(),
        capacityKg: capKg,
        lengthMm,
        widthMm,
        priority: prio,
        status: v.status || 'available',
        assigned_to: v.assigned_to || null,           // trailer -> horse.id
        // mutable during assignment:
        capacityAvailKg: capKg,
        assignedCount: 0,
      };
    });
}

/** Compute total needed weight for a load */
export function needWeightKg(load) {
  if (load.total_weight) return Number(load.total_weight) || 0;
  let sum = 0;
  for (const s of load.load_stops || [])
    for (const o of s.load_orders || [])
      sum += Number(o.total_weight || 0);
  if (sum) return sum;
  for (const s of load.load_stops || [])
    for (const o of s.load_orders || [])
      for (const it of o.load_items || [])
        sum += Number(it.weight || 0);
  return sum;
}

/** Find longest item length on a load */
export function needMaxLengthMm(load) {
  let mm = 0;
  for (const s of load.load_stops || [])
    for (const o of s.load_orders || [])
      for (const it of o.load_items || []) {
        const n = parseLengthToMm(it.length || it.description || '');
        if (n > mm) mm = n;
      }
  return mm;
}

/** Best-effort parse of width from item descriptions like "x×y×z" -> treat middle as width */
export function needMaxWidthMm(load) {
  let mm = 0;
  const pat = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i;
  for (const s of load.load_stops || [])
    for (const o of s.load_orders || [])
      for (const it of o.load_items || []) {
        const desc = String(it.description || '');
        const m = desc.match(pat);
        if (m) {
          const candidate = parseLengthToMm(m[2]);
          if (candidate > mm) mm = candidate;
        }
      }
  return mm;
}

/** Customer-cap state and helpers (≤ 2 trucks per customer per date) */
export function seedCustomerCapFromLoads(loadsToday, trucksByCustomer) {
  for (const L of loadsToday || []) {
    const veh = L.vehicle_id;
    if (!veh) continue;
    const custs = new Set();
    for (const s of L.load_stops || [])
      for (const o of L.load_orders || [])
        custs.add((o.customer_name || '').trim().toUpperCase());
    for (const c of custs) {
      if (!trucksByCustomer.has(c)) trucksByCustomer.set(c, new Set());
      trucksByCustomer.get(c).add(veh);
    }
  }
}

export function respectsCustomerCap(vehicleId, load, trucksByCustomer, limit = 2) {
  const custs = new Set();
  for (const s of load.load_stops || [])
    for (const o of s.load_orders || [])
      custs.add((o.customer_name || '').trim().toUpperCase());
  for (const c of custs) {
    const set = trucksByCustomer.get(c) || new Set();
    if (!set.has(vehicleId) && set.size >= limit) return false;
  }
  return true;
}

/** Score vehicle fitness */
export function scoreVehicle(v, needKg, needLenMm, needWidMm) {
  const cap = v.capacityAvailKg / Math.max(needKg, 1);
  const len = (v.lengthMm || 1) / Math.max(needLenMm || 1, 1);
  const wid = (v.widthMm  || 1) / Math.max(needWidMm || 1, 1);
  return cap * 0.2 + len * 0.5 + wid * 0.3 + (v.priority || 0) * 0.01;
}

/**
 * Choose an assignable unit for a load:
 * - RIGID alone (if it meets constraints), OR
 * - Only pre-linked HORSE↔TRAILER (trailer.assigned_to = horse.id).
 *   No ad-hoc pairing; trailers must have an existing link.
 */
export function chooseUnitForLoad({ vehicles, load, opts, trucksByCustomer }) {
  const {
    capacityHeadroom = 0.1,
    lengthBufferMm = 600,
    widthBufferMm = 0,
    maxLoadsPerVehicle = 6,
    enforceSameBranch = true,
    ignoreWidthIfMissing = true,
  } = opts || {};

  const needKg  = needWeightKg(load);
  const needLen = needMaxLengthMm(load) + lengthBufferMm;
  const needWid = needMaxWidthMm(load)  + widthBufferMm;

  const capOk = (v) => v.capacityAvailKg >= Math.ceil(needKg * (1 + capacityHeadroom));
  const lenOk = (v) => v.lengthMm > 0 && v.lengthMm >= needLen;
  const widOk = (v) => (v.widthMm > 0 ? v.widthMm >= needWid : !!ignoreWidthIfMissing);
  const cntOk = (v) => v.assignedCount < maxLoadsPerVehicle;
  const brOk  = (v) => !enforceSameBranch || !v.branch_id || !load.branch_id || v.branch_id === load.branch_id;
  const custOk= (vId) => respectsCustomerCap(vId, load, trucksByCustomer, 2);

  const rigs   = vehicles.filter(v => v.type === 'RIGID'   && brOk(v) && capOk(v) && lenOk(v) && widOk(v) && cntOk(v) && custOk(v.id));
  const horses = vehicles.filter(v => v.type === 'HORSE'   && brOk(v) && cntOk(v) && custOk(v.id));
  const trails = vehicles.filter(v => v.type === 'TRAILER' && brOk(v) && capOk(v) && lenOk(v) && widOk(v) && cntOk(v));

  // 0) Use only pre-linked trailer->horse pairs
  const linkedPairs = [];
  for (const t of trails) {
    if (!t.assigned_to) continue;
    const h = horses.find(x => x.id === t.assigned_to);
    if (!h) continue;
    linkedPairs.push({ horse: h, trailer: t });
  }
  if (linkedPairs.length) {
    linkedPairs.sort((A,B)=>{
      const sa = scoreVehicle(A.trailer, needKg, needLen, needWid);
      const sb = scoreVehicle(B.trailer, needKg, needLen, needWid);
      if (sb !== sa) return sb - sa;
      const la = A.trailer.capacityAvailKg - needKg;
      const lb = B.trailer.capacityAvailKg - needKg;
      if (la !== lb) return la - lb;
      return (B.horse.priority||0) - (A.horse.priority||0);
    });
    const best = linkedPairs[0];
    return { type: 'combo', horse: best.horse, trailer: best.trailer, needKg, needLen, needWid };
  }

  // 1) Try RIGIDs
  if (rigs.length) {
    rigs.sort((a,b)=>{
      const sa = scoreVehicle(a, needKg, needLen, needWid);
      const sb = scoreVehicle(b, needKg, needLen, needWid);
      if (sb !== sa) return sb - sa;
      const la = a.capacityAvailKg - needKg;
      const lb = b.capacityAvailKg - needKg;
      if (la !== lb) return la - lb;
      return (b.priority||0) - (a.priority||0);
    });
    return { type: 'rigid', rigid: rigs[0], needKg, needLen, needWid };
  }

  return null;
}
