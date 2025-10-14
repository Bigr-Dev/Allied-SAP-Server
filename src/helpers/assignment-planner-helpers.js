


import database from '../config/supabase.js'

/* ============================== tiny utils ============================== */

export function asISOorNull(x) {
  const s = (x ?? '').toString().trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export function toNumber(n, fallback = 0) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

export function groupBy(arr, keyFn) {
  const m = new Map()
  for (const x of arr || []) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

export function todayTomorrow() {
  const today = new Date()
  const iso = (d) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10)
  const dep = new Date(today)
  dep.setDate(dep.getDate() + 1)
  return { today: iso(today), tomorrow: iso(dep) }
}

export function sumWeightsByUnitIdx(placements) {
  const m = new Map()
  for (const p of placements) {
    m.set(p.unitIdx, (m.get(p.unitIdx) || 0) + Number(p.weight || 0))
  }
  return m
}

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseBranchSingle(input) {
  if (input == null) return null
  if (typeof input !== 'string') input = String(input)
  const val = input.trim().toLowerCase()
  if (val === '' || val === 'all') return null // all branches
  return UUID_RX.test(input) ? input : null // single UUID only; else treat as all
}

/** Apply a single-branch filter (null = all branches). */
export function applySingleBranchFilter(q, branchId) {
  return branchId ? q.eq('branch_id', branchId) : q
}

/* ---------------- Route-group helpers (used to keep macro routes together) ---------------- */

function normalizeRouteName(raw) {
  if (raw == null) return ''
  let s = String(raw).toUpperCase()
  s = s.replace(/[-_/]+/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/\bEASTRAND\b/g, 'EAST RAND')
  s = s.replace(/\bEASTR\s+RAND\b/g, 'EAST RAND')
  s = s.replace(/\bWESTRAND\b/g, 'WEST RAND')
  s = s.replace(/\bPRETORIA\b/g, 'PTA')
  s = s.replace(/\bJHB\s+SOUTH\s+CENTRAL\b/g, 'JHB SOUTH')
  s = s.replace(/\bJHB\s+CENTRAL\s+NORTH\b/g, 'JHB CENTRAL')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

const FAMILY_RULES = [
  [/^JHB\s+SOUTH\b/, 'JHB SOUTH'],
  [/^JHB\s+CENTRAL\b/, 'JHB CENTRAL'],
  [/^JHB\s+NORTH\b/, 'JHB NORTH'],
  [/^JHB\s+WEST\b/, 'JHB WEST'],
  [/^JHB\s+EAST\b/, 'JHB EAST'],
  [/^JHB\b/, 'JHB'],
  [/^EAST\s*RAND\b/, 'EAST RAND'],
  [/^WEST\s*RAND\b/, 'WEST RAND'],
  [/^NORTH\s*WEST\b/, 'NORTH WEST'],
  [/^SOUTH\s*EAST\b/, 'SOUTH EAST'],
  [/^SOUTH\s*WEST\b/, 'SOUTH WEST'],
  [/^PTA\b/, 'PTA'],
  [/^VAAL\b/, 'VAAL'],
  [/^CENTURION\b/, 'CENTURION'],
  [/^MPUMALANGA\b/, 'MPUMALANGA'],
  [/^WEST\b(?!\s*RAND)/, 'WEST'],
  [/^EAST\b(?!\s*RAND)/, 'EAST'],
]

function extractRouteGroup(routeName = '') {
  const s = normalizeRouteName(routeName)
  if (!s) return ''
  for (const [re, label] of FAMILY_RULES) if (re.test(s)) return label
  const cleaned = s
    .replace(/[^\w\s]/g, '')
    .replace(/\d+/g, '')
    .trim()
  if (!cleaned) return s
  const tokens = cleaned.split(/\s+/)
  if (tokens.length === 1) return tokens[0]
  const keepSecond = new Set([
    'PARK',
    'RIVER',
    'RAND',
    'NORTH',
    'SOUTH',
    'EAST',
    'WEST',
    'CENTRAL',
  ])
  return keepSecond.has(tokens[1])
    ? `${tokens[0]} ${tokens[1]}`
    : `${tokens[0]} ${tokens[1]}`
}

function routeAffinity(st, group) {
  if (!st || !st.assigned_count || !group) return 0.5
  const n = (st.routeGroups && st.routeGroups.get(group)) || 0
  return Math.max(0, Math.min(1, n / st.assigned_count))
}

function scoreUnit(u, needKg, needLenMm) {
  const wPart = (toNumber(u.capacity_left) / Math.max(needKg, 1)) * 0.15
  const lPart = (toNumber(u.length_mm) / Math.max(needLenMm || 1, 1)) * 0.85
  return wPart + lPart
}

function parseItemLengthFromDescription(desc) {
  if (!desc) return 0
  const tokens = String(desc).match(/[0-9]+(?:\.[0-9]+)?/g) || []
  const mmCandidates = []
  for (const t of tokens) {
    const val = parseFloat(t)
    if (!Number.isFinite(val)) continue
    if (
      t.includes('.') &&
      Math.abs(val - Math.round(val)) < 1e-9 &&
      val <= 30
    ) {
      mmCandidates.push(Math.round(val * 1000))
      continue
    }
    if (val >= 1000) {
      mmCandidates.push(Math.round(val))
      continue
    }
    if (val > 50) mmCandidates.push(Math.round(val))
  }
  return mmCandidates.length ? Math.max(...mmCandidates) : 0
}

export function scopeBranchForPlanSave(branchFilter) {
  // scope_branch_id column is a single UUID; store null when multi-branch
  return Array.isArray(branchFilter) ? null : branchFilter || null
}

export async function fetchRouteBranchMap() {
  const { data, error } = await database
    .from('routes_with_tree')
    .select('route_id, branch_id, route_name')
  if (error) throw error
  const m = new Map()
  for (const r of data || [])
    m.set(r.route_id, { branch_id: r.branch_id, route_name: r.route_name })
  return m
}

export function packItemsIntoUnits(
  items,
  rawUnits,
  {
    capacityHeadroom = 0.1,
    lengthBufferMm = 600,
    //  maxTrucksPerZone = 2, // reserved for future soft-caps
    ignoreLengthIfMissing = true,
    ignoreDepartment = true,
    customerUnitCap = 2,
    routeAffinitySlop = 0.25, // reserved hook
  } = {}
) {
  // Normalize units (with headroom)
  const units = (rawUnits || []).map((u) => {
    const baseCap = toNumber(u.capacity_kg, 0)
    const effCap = Math.max(
      0,
      Math.round(baseCap * (1 + Number(capacityHeadroom || 0)))
    )
    return {
      ...u,
      capacity_left: effCap,
      length_mm: toNumber(u.length_mm, 0),
      category: String(u.category || '').toUpperCase(),
      priority: toNumber(u.priority, 0),
      branch_id: u.branch_id ?? null,
    }
  })

  const state = units.map(() => ({
    capacity_left: 0,
    assigned_count: 0,
    routeGroups: new Map(),
  }))
  for (let i = 0; i < units.length; i++)
    state[i].capacity_left = toNumber(units[i].capacity_left)

  const placements = []
  const unplaced = []

  const custKey = (it) => it.customer_id || `NAME:${it.customer_name || ''}`

  for (const item of items || []) {
    const needKg = Math.max(0, toNumber(item.weight_kg))
    if (!needKg) continue
    const needLenMm =
      parseItemLengthFromDescription(item.description) +
      Number(lengthBufferMm || 0)
    const itemBranch = item.branch_id ?? null
    const group = extractRouteGroup(item.route_name || item.suburb_name || '')

    // build candidate pool
    const pool = []
    for (let idx = 0; idx < units.length; idx++) {
      const u = units[idx]
      const st = state[idx]

      // branch
      if (itemBranch && String(u.branch_id || '') !== String(itemBranch))
        continue
      // length
      const lengthOk =
        u.length_mm > 0 ? u.length_mm >= needLenMm : !!ignoreLengthIfMissing
      if (!lengthOk) continue
      // capacity
      if (st.capacity_left < needKg) continue

      // NEW: respect family early so we don’t reject later
      const existingFam = st.routeGroups && [...st.routeGroups.keys()][0]
      if (st.assigned_count > 0 && existingFam && existingFam !== group)
        continue

      pool.push({ idx, u, st })
    }

    if (!pool.length) {
      unplaced.push({
        ...item,
        weight_left: needKg,
        reason: 'No unit meets capacity/length/branch constraints',
      })
      continue
    }

    // prefer units already carrying same macro-route; then length/weight fit; then leftover; then priority
    pool.sort((A, B) => {
      const affA = routeAffinity(A.st, group)
      const affB = routeAffinity(B.st, group)
      if (affA !== affB) return affB - affA

      const sa = scoreUnit(A.u, needKg, needLenMm)
      const sb = scoreUnit(B.u, needKg, needLenMm)
      if (sa !== sb) return sa - sb

      const ra = A.st.capacity_left - needKg
      const rb = B.st.capacity_left - needKg
      if (ra !== rb) return ra - rb

      return (B.u.priority || 0) - (A.u.priority || 0)
    })

    const chosen = pool[0]
    const chosenIdx = chosen.idx
    const st = state[chosenIdx]

    placements.push({ unitIdx: chosenIdx, item, weight: needKg })
    st.capacity_left = Math.max(0, st.capacity_left - needKg)
    st.assigned_count += 1
    if (group) st.routeGroups.set(group, (st.routeGroups.get(group) || 0) + 1)
  }

  return { placements, unplaced, state, units }
}

// Helper: filter duplicates, then insert
export async function insertAssignmentsSafely(database, rows) {
  if (!rows?.length) return { data: [], error: null }
  const ids = [...new Set(rows.map((r) => r.item_id).filter(Boolean))]
  if (!ids.length) return { data: [], error: null }

  const { data: existing, error: existErr } = await database
    .from('assignment_plan_item_assignments')
    .select('item_id')
    .in('item_id', ids)
  if (existErr) throw existErr

  const existingIds = new Set((existing || []).map((r) => r.item_id))
  const toInsert = rows.filter(
    (r) =>
      r.item_id &&
      !existingIds.has(r.item_id) &&
      Number(r.assigned_weight_kg) > 0
  )

  if (!toInsert.length) return { data: [], error: null }
  return await database
    .from('assignment_plan_item_assignments')
    .insert(toInsert)
}

// Helper: normalize branch filter (single id | array | 'all')
export function normalizeBranchFilter(branch_id) {
  if (!branch_id || branch_id === 'all') return null
  return Array.isArray(branch_id) ? branch_id.filter(Boolean) : [branch_id]
}

// Helper: make a stable vehicle key from a unit row
export function vehicleKey(u) {
  if (u.unit_type === 'rigid') return `rigid:${u.rigid_id || 'nil'}`
  if (u.unit_type === 'horse+trailer') {
    return `horse:${u.horse_id || 'nil'}|trailer:${u.trailer_id || 'nil'}`
  }
  // fallback (shouldn’t happen with your data)
  return `unit:${u.rigid_id || u.horse_id || u.trailer_id || 'nil'}`
}

// Helper: extract a macro route family from a route name
// (uses your existing extractRouteGroup if present; else a conservative fallback)
export function familyFrom(route_name = '') {
  if (typeof extractRouteGroup === 'function')
    return extractRouteGroup(route_name)
  const s = String(route_name || '').toLowerCase()
  if (s.includes('pta') || s.includes('pretoria') || s.includes('centurion'))
    return 'pta'
  if (s.includes('midrand')) return 'midrand'
  if (
    s.includes('east rand') ||
    s.includes('benoni') ||
    s.includes('boksburg') ||
    s.includes('kempton')
  )
    return 'east rand'
  if (
    s.includes('west rand') ||
    s.includes('krugersdorp') ||
    s.includes('roodepoort')
  )
    return 'west rand'
  if (
    s.includes('jhb') ||
    s.includes('johannesburg') ||
    s.includes('sandton') ||
    s.includes('randburg')
  )
    return 'jhb'
  if (s.includes('vaal') || s.includes('vanderbijl') || s.includes('verenig'))
    return 'vaal'
  return s.split(/\s+/)[0] || 'other'
}

// Helper: get trips used per vehicle for a given departure date
export async function fetchTripsUsedByVehicle(database, departureISO) {
  // 1) Find plans on that date
  const { data: plans, error: e1 } = await database
    .from('assignment_plans')
    .select('id')
    .eq('departure_date', departureISO)
  if (e1) throw e1

  const planIds = (plans || []).map((r) => r.id)
  if (!planIds.length) return new Map()

  // 2) Fetch units that belong to those plans
  const { data: units, error: e2 } = await database
    .from('assignment_plan_units')
    .select('id, unit_type, rigid_id, horse_id, trailer_id, plan_id')
    .in('plan_id', planIds)
  if (e2) throw e2

  // 3) Count trips per vehicle key
  const m = new Map()
  for (const u of units || []) {
    const key =
      u.unit_type === 'rigid'
        ? `rigid:${u.rigid_id || 'nil'}`
        : u.unit_type === 'horse+trailer'
        ? `horse:${u.horse_id || 'nil'}|trailer:${u.trailer_id || 'nil'}`
        : `unit:${u.rigid_id || u.horse_id || u.trailer_id || 'nil'}`
    m.set(key, (m.get(key) || 0) + 1)
  }
  return m
}

export async function fetchUnits(branchId) {
  // Prefer enhanced view if present, fall back to base one
  let { data, error } = await database
    .from('v_dispatch_units_enhanced')
    .select('*')
  if (error) {
    const { data: fall, error: e2 } = await database
      .from('v_dispatch_units')
      .select('*')
    if (e2) throw e2
    data = fall || []
  }
  if (branchId && branchId !== 'all') {
    data = data.filter((r) => String(r.branch_id || '') === String(branchId))
  }
  return data || []
}

// Helper: enforce macro-route lock and customer/unit caps
export function enforcePackingRules(placements, shapedUnits, options) {
  const {
    customerUnitCap = 2,
    //tripsUsedMap, // Map(vehicleKey -> trips used today)
    //maxTripsPerVehiclePerDay = 2,
  } = options

  // track first family set per unitIdx; and per-customer distinct unit count
  const familyByUnit = new Map()
  const unitSetByCustomer = new Map()
  const filtered = []
  const rejected = [] // will go to unplaced bucket in the response

  for (const p of placements) {
    const u = shapedUnits[p.unitIdx]
    if (!u) {
      rejected.push(p)
      continue
    }

    // vehicle eligibility by trips used
    // const vkey = vehicleKey(u)
    // const usedTrips = Number(tripsUsedMap.get(vkey) || 0)
    // if (usedTrips >= maxTripsPerVehiclePerDay) {
    //   rejected.push(p)
    //   continue
    // }

    // strict family lock
    const fam = familyFrom(p.item.route_name)
    const existing = familyByUnit.get(p.unitIdx)
    if (existing == null) {
      familyByUnit.set(p.unitIdx, fam)
    } else if (existing !== fam) {
      rejected.push(p)
      continue
    }

    // per-customer unit cap (distinct unitIdxs per customer)
    const cid = p.item.customer_id || 'anon'
    const set = unitSetByCustomer.get(cid) || new Set()
    if (!set.has(p.unitIdx) && set.size >= Number(customerUnitCap || 2)) {
      rejected.push(p)
      continue
    }
    set.add(p.unitIdx)
    unitSetByCustomer.set(cid, set)

    filtered.push(p)
  }

  return { filtered, rejected }
}

// Helper: fetch Plan Units
export async function fetchPlanUnits(planId) {
  const { data, error } = await database
    .from('v_plan_units_summary')
    .select('*')
    .eq('plan_id', planId)
    .order('unit_type', { ascending: true })
  if (error) throw error
  // console.log('data :>> ', data)
  return data || []
}

// Helper: fetch Planed Assignments
export async function fetchPlanAssignments(planId) {
  // 1) Get plan_unit_ids for the plan
  const { data: unitRows, error: unitErr } = await database
    .from('assignment_plan_units')
    .select('id')
    .eq('plan_id', planId)

  if (unitErr) throw unitErr
  const unitIds = (unitRows || []).map((r) => r.id)
  if (!unitIds.length) return []

  // 2) Get assignments for those units
  const { data: assignments, error: aErr } = await database
    .from('assignment_plan_item_assignments')
    .select(
      'id, plan_unit_id, load_id, order_id, item_id, assigned_weight_kg, priority_note'
    )
    .in('plan_unit_id', unitIds)

  if (aErr) throw aErr
  if (!assignments?.length) return []

  // 3) Enrich with item details from v_unassigned_items
  const itemIds = assignments.map((a) => a.item_id).filter(Boolean)
  const uniqueItemIds = [...new Set(itemIds)]
  let byItem = new Map()
  if (uniqueItemIds.length) {
    const { data: itemRows, error: iErr } = await database
      .from('v_unassigned_items')
      .select(
        'item_id, description, customer_id, customer_name, suburb_name, route_name, order_date, sales_order_number:order_number'
      )
      .in('item_id', uniqueItemIds)

    if (iErr) throw iErr
    byItem = new Map((itemRows || []).map((r) => [r.item_id, r]))
  }

  // Merge and return a flat list (buildNested will group)
  const merged = assignments.map((a) => {
    const d = byItem.get(a.item_id) || {}
    return {
      assignment_id: a.id,
      plan_unit_id: a.plan_unit_id,
      load_id: a.load_id,
      order_id: a.order_id,
      item_id: a.item_id,
      assigned_weight_kg: a.assigned_weight_kg,
      priority_note: a.priority_note,
      // enriched fields
      customer_id: d.customer_id ?? null,
      customer_name: d.customer_name ?? null,
      suburb_name: d.suburb_name ?? null,
      route_name: d.route_name ?? null,
      order_date: d.order_date ?? null,
      description: d.description ?? null,
      order_number: d.order_number ?? null,
    }
  })

  // (Optional) stable, user-friendly sort
  merged.sort(
    (a, b) =>
      String(a.customer_name || '').localeCompare(
        String(b.customer_name || '')
      ) || String(a.order_id || '').localeCompare(String(b.order_id || ''))
  )

  return merged
}

// Helper: fetch unassigned bucket
export async function fetchUnassignedBucket(planId) {
  // Prefer the table used during commit
  let base = []
  // Try assignment_plan_unassigned_items first
  const { data, error } = await database
    .from('assignment_plan_unassigned_items')
    .select('*')
    .eq('plan_id', planId)

  if (!error && data) {
    base = data
  } else {
    // Fallback to function/view if your project uses it
    try {
      const { data: funcData, error: funcErr } = await database.rpc(
        'f_plan_item_remainder',
        { plan_id: planId }
      )
      if (funcErr) throw funcErr
      base = funcData || []
    } catch {
      base = []
    }
  }

  // NEW: Always enrich with descriptive fields
  return await enrichBucketDetails(base)
}

// Helper: recalculate capacity
export async function recalcUsedCapacity(planId) {
  const { error } = await database.rpc('sp_recalc_used_capacity', {
    p_plan_id: planId,
  })
  if (error) throw error
}

// export async function recalcUsedCapacity(planId) {
//   try {
//     await database.rpc('recalc_plan_used_capacity', { p_plan_id: planId })
//   } catch (_) {
//     // keep flow resilient
//   }
// }

// Helper: build nested response
export function buildNested(units, assignments, itemRemainders) {
  const byUnit = groupBy(units, (u) => u.plan_unit_id)
  const assignByUnit = groupBy(assignments, (a) => a.plan_unit_id)

  const outUnits = []
  for (const [unitId, unitRows] of byUnit.entries()) {
    const u = unitRows[0]
    const rows = assignByUnit.get(unitId) || []

    const byCustomer = groupBy(
      rows,
      (r) =>
        `${r.customer_id ?? ''}|${r.customer_name ?? ''}|${
          r.suburb_name ?? ''
        }|${r.route_name ?? ''}`
    )

    const customers = []
    for (const [ckey, crow] of byCustomer.entries()) {
      const [customer_id_raw, customer_name, suburb_name, route_name] =
        ckey.split('|')
      const customer_id = customer_id_raw || null

      // ✅ make sure byOrder is defined in this scope
      const byOrder = groupBy(crow, (r) => r.order_id)

      const orders = []
      for (const [order_id, orows] of byOrder.entries()) {
        const items = orows.map((r) => ({
          item_id: r.item_id,
          description: r.description,
          assigned_weight_kg: Number(r.assigned_weight_kg),
          assignment_id: r.assignment_id,
          // include order fields on each item
          order_id: r.order_id ?? order_id,
          order_number: r.order_number ?? null,
        }))

        orders.push({
          order_id,
          total_assigned_weight_kg: items.reduce(
            (s, i) => s + (i.assigned_weight_kg || 0),
            0
          ),
          items,
        })
      }

      customers.push({
        customer_id,
        customer_name,
        suburb_name,
        route_name,
        orders,
      })
    }

    outUnits.push({
      plan_unit_id: unitId,
      unit_type: u.unit_type,
      driver_id: u.driver_id,
      driver_name: u.driver_name,
      rigid:
        u.unit_type === 'rigid'
          ? {
              id: u.rigid_id,
              plate: u.rigid_plate,
              fleet_number: u.rigid_fleet,
            }
          : null,
      horse:
        u.unit_type === 'horse+trailer'
          ? {
              id: u.horse_id,
              plate: u.horse_plate,
              fleet_number: u.horse_fleet,
            }
          : null,
      trailer:
        u.unit_type === 'horse+trailer'
          ? {
              id: u.trailer_id,
              plate: u.trailer_plate,
              fleet_number: u.trailer_fleet,
            }
          : null,
      capacity_kg: Number(u.capacity_kg),
      used_capacity_kg: Number(u.used_capacity_kg), // make sure upstream SELECT provides this
      customers,
    })
  }

  const unassigned = (itemRemainders || []).map((r) => ({
    load_id: r.load_id,
    order_id: r.order_id,
    order_number: r.order_number ?? null,
    item_id: r.item_id,
    customer_id: r.customer_id ?? null,
    customer_name: r.customer_name ?? null,
    suburb_name: r.suburb_name ?? null,
    route_name: r.route_name ?? null,
    order_date: r.order_date ?? null,
    weight_left: Number(r.weight_left ?? 0),
    description: r.description ?? null,
    reason: r.reason ?? null,
  }))

  return { assigned_units: outUnits, unassigned }
}

export async function fetchItems(cutoffDate, branchId, customerId) {
  let q = database
    .from('v_unassigned_items')
    .select(
      `
      load_id, order_id, item_id,
      customer_id, customer_name, suburb_name, route_name, route_id,
      order_date, description,
      weight_kg,
      branch_id,
      sales_order_number:order_number
    `
    )
    .lte('order_date', cutoffDate)
    .order('order_date', { ascending: true })
    .order('weight_kg', { ascending: false })

  if (branchId && branchId !== 'all') q = q.eq('branch_id', branchId)
  if (customerId && customerId !== 'all') q = q.eq('customer_id', customerId)

  const { data, error } = await q
  if (error) throw error

  return (data || []).map((it) => {
    const w = Number(it.weight_kg || 0)
    return {
      ...it,
      weight_kg: w,
      weight_left: w, // 👈 add alias in JS
    }
  })
}

export async function enrichBucketDetails(bucketRows) {
  const bucket = bucketRows || []
  if (!bucket.length) return bucket

  const itemIds = bucket.map((b) => b.item_id).filter(Boolean)
  if (!itemIds.length) return bucket

  // Pull the descriptive fields from the view
  const { data: details, error } = await database
    .from('v_unassigned_items')
    .select(
      'item_id, description, customer_id, customer_name, suburb_name, route_name, order_date, order_id, load_id, sales_order_number:order_number'
    )
    .in('item_id', itemIds)

  if (error || !details?.length) return bucket

  const byId = new Map(details.map((d) => [d.item_id, d]))
  return bucket.map((b) => ({
    ...b,
    ...(byId.get(b.item_id) || {}),
  }))
}
