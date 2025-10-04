// controllers/assignment-planner-controller.js
// Drop-in controller that merges original constraints (dept/branch/length/zone) with planner packing.
// Tuned to your v_dispatch_units & v_unassigned_items columns.

import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

/* ============================== tiny utils ============================== */

/** parse meters expressed as strings like "13", "13.2", "13,2", "11,5 " → mm */
function parseMetersToMm(raw) {
  if (raw == null) return 0
  const s = String(raw).trim().replace(',', '.')
  const val = parseFloat(s)
  return Number.isFinite(val) ? Math.max(0, Math.round(val * 1000)) : 0
}

function sumWeightsByUnitIdx(placements) {
  const m = new Map()
  for (const p of placements) {
    m.set(p.unitIdx, (m.get(p.unitIdx) || 0) + Number(p.weight || 0))
  }
  return m
}

/** Extract a macro route group from a route name, e.g. "EAST RAND 04" -> "EAST RAND", "VAAL 02" -> "VAAL". */

/** Normalise common typos/joins/hyphens and whitespace */
function normalizeRouteName(raw) {
  if (raw == null) return ''
  let s = String(raw).toUpperCase()

  // unify separators
  s = s.replace(/[-_/]+/g, ' ') // EAST-RAND_01 -> EAST RAND 01
  s = s.replace(/\s+/g, ' ').trim()

  // fix common joins & variants
  s = s.replace(/\bEASTRAND\b/g, 'EAST RAND')
  s = s.replace(/\bEASTR\s+RAND\b/g, 'EAST RAND')
  s = s.replace(/\bWESTRAND\b/g, 'WEST RAND')
  s = s.replace(/\bPRETORIA\b/g, 'PTA') // treat Pretoria as PTA family
  s = s.replace(/\bJHB\s+SOUTH\s+CENTRAL\b/g, 'JHB SOUTH') // fold sub-variants
  s = s.replace(/\bJHB\s+CENTRAL\s+NORTH\b/g, 'JHB CENTRAL')

  // strip duplicate spaces once more
  s = s.replace(/\s+/g, ' ').trim()
  return s
}
// function normalizeRouteName(raw) {
//   if (raw == null) return ''
//   let s = String(raw).toUpperCase()

//   // collapse weird spacing & dups
//   s = s.replace(/\s+/g, ' ').trim() // "JHB  SOUTH" -> "JHB SOUTH"
//   // fix common join/typo variants
//   s = s.replace(/\bEASTRAND\b/g, 'EAST RAND') // "EASTRAND 10" -> "EAST RAND 10"
//   s = s.replace(/\bEASTR\s+RAND\b/g, 'EAST RAND') // "EASTR RAND 11" -> "EAST RAND 11"
//   s = s.replace(/\bWESTRAND\b/g, 'WEST RAND') // "WESTRAND 07" -> "WEST RAND 07"

//   return s
// }

/** Ordered family rules — first match wins */
const FAMILY_RULES = [
  // Johannesburg families (match before generic JHB)
  [/^JHB\s+SOUTH\b/, 'JHB SOUTH'],
  [/^JHB\s+CENTRAL\b/, 'JHB CENTRAL'],
  [/^JHB\s+NORTH\b/, 'JHB NORTH'],
  [/^JHB\s+WEST\b/, 'JHB WEST'],
  [/^JHB\s+EAST\b/, 'JHB EAST'],
  [/^JHB\b/, 'JHB'],

  // Rand/Regional families
  [/^EAST\s*RAND\b/, 'EAST RAND'],
  [/^WEST\s*RAND\b/, 'WEST RAND'],
  [/^NORTH\s*WEST\b/, 'NORTH WEST'],
  [/^SOUTH\s*EAST\b/, 'SOUTH EAST'],
  [/^SOUTH\s*WEST\b/, 'SOUTH WEST'],

  // PTA/VAAL + common macro regions
  [/^PTA\b/, 'PTA'],
  [/^VAAL\b/, 'VAAL'],
  [/^CENTURION\b/, 'CENTURION'],
  [/^MPUMALANGA\b/, 'MPUMALANGA'],

  // Plain compass buckets not tied to RAND (rare but present)
  [/^WEST\b(?!\s*RAND)/, 'WEST'],
  [/^EAST\b(?!\s*RAND)/, 'EAST'],
]

// const FAMILY_RULES = [
//   // Johannesburg subfamilies (match these BEFORE generic JHB)
//   [/^JHB\s+SOUTH\b/, 'JHB SOUTH'],
//   [/^JHB\s+CENTRAL\b/, 'JHB CENTRAL'],
//   [/^JHB\s+NORTH\b/, 'JHB NORTH'],
//   [/^JHB\b/, 'JHB'],

//   // Big region families
//   [/^EAST\s*RAND\b/, 'EAST RAND'],
//   [/^WEST\s*RAND\b/, 'WEST RAND'],
//   [/^NORTH\s*WEST\b/, 'NORTH WEST'],
//   [/^SOUTH\s*EAST\b/, 'SOUTH EAST'],
//   [/^SOUTH\s*WEST\b/, 'SOUTH WEST'],
//   [/^VAAL\b/, 'VAAL'],
//   [/^PTA\b/, 'PTA'],
//   [/^CENTURION\b/, 'CENTURION'],
//   [/^MPUMALANGA\b/, 'MPUMALANGA'],

//   // Plain "WEST 01/02/…" (distinct from WEST RAND)
//   [/^WEST\b(?!\s*RAND)/, 'WEST'],
// ]

/**
 * Extract a macro route group from a (possibly messy) route name.
 * Examples:
 *  "EASTRAND 10" -> "EAST RAND"
 *  "WEST RAND 07" -> "WEST RAND"
 *  "JHB SOUTH WEST" -> "JHB SOUTH"
 *  "PRETORIA NORTH" -> "PTA"
 *  "ALBERTON" -> "ALBERTON"
 *  "MENLO PARK 03" -> "MENLO PARK"
 */
function extractRouteGroup(routeName = '') {
  const s = normalizeRouteName(routeName)
  if (!s) return ''

  for (const [re, label] of FAMILY_RULES) {
    if (re.test(s)) return label
  }

  // Fallbacks: keep locality names sensible (e.g., "MENLO PARK", "ELSIE RIVER", "ALBERTON")
  const cleaned = s
    .replace(/[^\w\s]/g, '')
    .replace(/\d+/g, '')
    .trim()
  if (!cleaned) return s
  const tokens = cleaned.split(/\s+/)
  if (tokens.length === 1) return tokens[0] // "ALBERTON", "ALRODE", "MIDRAND"

  // preserve common two-word localities ("MENLO PARK", "ELSIE RIVER", etc.)
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
  if (keepSecond.has(tokens[1])) return `${tokens[0]} ${tokens[1]}`

  return `${tokens[0]} ${tokens[1]}`
}
// function extractRouteGroup(routeName = '') {
//   const s = normalizeRouteName(routeName)
//   if (!s) return ''

//   for (const [re, label] of FAMILY_RULES) {
//     if (re.test(s)) return label
//   }

//   // Fallbacks: keep locality names sensible (e.g., "MENLO PARK", "ELSIE RIVER", "ALBERTON")
//   const cleaned = s
//     .replace(/[^\w\s]/g, '')
//     .replace(/\d+/g, '')
//     .trim()
//   if (!cleaned) return s
//   const tokens = cleaned.split(/\s+/)
//   if (tokens.length === 1) return tokens[0] // "ALBERTON", "ALRODE"
//   if (
//     [
//       'PARK',
//       'RIVER',
//       'RAND',
//       'NORTH',
//       'SOUTH',
//       'EAST',
//       'WEST',
//       'CENTRAL',
//       'GUY',
//     ].includes(tokens[1])
//   )
//     return `${tokens[0]} ${tokens[1]}` // "MENLO PARK", "ELSIE RIVER", "THE COURIER"
//   return `${tokens[0]} ${tokens[1]}` // default two-word macro
// }

// function extractRouteGroup(routeName = '') {
//   const s = String(routeName || '')
//     .trim()
//     .toUpperCase()
//   if (!s) return ''
//   // hand-picked common families first
//   const families = [
//     /^EAST\s+RAND\b/,
//     /^WEST\s+RAND\b/,
//     /^NORTH\s+RAND\b/,
//     /^SOUTH\s+RAND\b/,
//     /^VAAL\b/,
//     /^PTA\b/,
//   ]
//   for (const re of families) {
//     const m = s.match(re)
//     if (m) return m[0] // the family label itself (e.g., "EAST RAND", "VAAL", "PTA")
//   }
//   // fallback: take first 2 tokens without trailing numerics
//   const tokens = s.replace(/\d+/g, '').trim().split(/\s+/).filter(Boolean)
//   return tokens.slice(0, Math.min(2, tokens.length)).join(' ')
// }

/** Affinity of a unit's current mix to this route group: 0..1 (higher = better match). */
function routeAffinity(st, group) {
  if (!st || !st.assigned_count || !group) return 0.5 // neutral when empty/unknown
  const n = (st.routeGroups && st.routeGroups.get(group)) || 0
  return Math.max(0, Math.min(1, n / st.assigned_count))
}
// function routeAffinity(st, group) {
//   if (!st || !st.assigned_count || !group) return 0.5 // neutral when empty/unknown
//   const n = (st.routeGroups && st.routeGroups.get(group)) || 0
//   return Math.max(0, Math.min(1, n / st.assigned_count))
// }

function toNumber(n, fallback = 0) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function safeUpper(s) {
  return String(s || '').toUpperCase()
}

function groupBy(arr, keyFn) {
  const m = new Map()
  for (const x of arr) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

/** Parse length from item description (e.g., "6.00X1925X11490", "BM 305X102X28.2X13.000") → mm */
function parseItemLengthFromDescription(desc) {
  if (!desc) return 0
  // Grab numeric tokens including decimals; split by non-number/non-dot
  const tokens = String(desc).match(/[0-9]+(?:\.[0-9]+)?/g) || []
  const mmCandidates = []
  for (const t of tokens) {
    const val = parseFloat(t)
    if (!Number.isFinite(val)) continue
    // Treat values with .000 and <= 30 as meters (common in beam lengths like 13.000)
    if (
      t.includes('.') &&
      Math.abs(val - Math.round(val)) < 1e-9 &&
      val <= 30
    ) {
      mmCandidates.push(Math.round(val * 1000))
      continue
    }
    // Big numbers are likely already mm (e.g., 11490)
    if (val >= 1000) {
      mmCandidates.push(Math.round(val))
      continue
    }
    // Otherwise, if > 50, also treat as mm (e.g., widths/heights 120, 305)
    if (val > 50) {
      mmCandidates.push(Math.round(val))
    }
  }
  if (!mmCandidates.length) return 0
  // Use the largest plausible loading dimension
  return Math.max(...mmCandidates)
}

/** score like the original: 85% length fitness, 15% capacity fitness  */
function scoreUnit(u, needKg, needLenMm) {
  const wPart = (toNumber(u.capacity_left) / Math.max(needKg, 1)) * 0.15
  const lPart = (toNumber(u.length_mm) / Math.max(needLenMm || 1, 1)) * 0.85
  return wPart + lPart
}

/** Original ASSM logic is based on SO prefix "7". v_unassigned_items lacks SO, so remain neutral (false). */
function isAssmItem(/* item */) {
  return false
}

// Cap logic selector (kept for clarity; we default to 'client')
const ZONE_CAP_MODE = 'client'

// normalise any key into a compact uppercase token
function normKey(x) {
  return String(x || 'UNKNOWN')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '')
}

/**
 * Zone key(s) for capping. We cap by CLIENT first; when customer is missing,
 * we fall back to route_name. This yields a single-zone key per item.
 */
function zoneKeysForItem(item) {
  if (ZONE_CAP_MODE === 'client') {
    if (item?.customer_id != null) {
      return [`CLIENT:${normKey(item.customer_id)}`]
    }
    // Fallback when no customer_id
    const route = item?.route_name || item?.route_group || item?.suburb_name
    return [`ROUTE:${normKey(route)}`]
  }

  // (Other modes left here for future use)
  const route = item?.route_name || item?.route_group || item?.suburb_name
  return [`ROUTE:${normKey(route)}`]
}

/** Build geo/zone keys (use suburb_name first, then route_name) */
// function zoneKeysForItem(item) {
//   const base =
//     item?.route_group || item?.route_name || item?.suburb_name || 'UNKNOWN'
//   return [safeUpper(base).replace(/\s+/g, '')]
// }
// function zoneKeysForItem(item) {
//   const base = item?.suburb_name || item?.route_name || 'UNKNOWN'
//   return [safeUpper(base).replace(/\s+/g, '')]
// }

/** today & tomorrow in ISO (YYYY-MM-DD) */
function todayTomorrow() {
  const today = new Date()
  const iso = (d) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10)
  const dep = new Date(today)
  dep.setDate(dep.getDate() + 1)
  return { today: iso(today), tomorrow: iso(dep) }
}

/* ============================== data access ============================== */

async function fetchUnits(branchId) {
  // Step 1: get units from the view
  let q = database.from('v_dispatch_units').select('*')
  if (branchId) q = q.eq('branch_id', branchId)
  const { data: units, error } = await q
  if (error) throw error

  if (!units || !units.length) return []

  // Step 2: collect all vehicle ids referenced by each unit
  const ids = new Set()
  for (const u of units) {
    if (u.rigid_id) ids.add(u.rigid_id)
    if (u.horse_id) ids.add(u.horse_id)
    if (u.trailer_id) ids.add(u.trailer_id)
  }

  // Step 3: fetch the referenced vehicles (we need .length (m), .priority, and .geozone)
  const { data: vehs, error: vehErr } = await database
    .from('vehicles')
    .select('id,length,priority,geozone,vehicle_category')
    .in('id', Array.from(ids))
  if (vehErr) throw vehErr

  const vmap = new Map()
  for (const v of vehs || []) vmap.set(v.id, v)

  // helper to compute a unit’s effective length:
  // - prefer trailer length for horse+trailer
  // - else rigid length (rigid units)
  // - else horse length
  // - else the max of any available piece, as a fallback
  function lengthForUnit(u) {
    const lTrailer =
      u.trailer_id && vmap.get(u.trailer_id)
        ? parseMetersToMm(vmap.get(u.trailer_id).length)
        : 0
    const lRigid =
      u.rigid_id && vmap.get(u.rigid_id)
        ? parseMetersToMm(vmap.get(u.rigid_id).length)
        : 0
    const lHorse =
      u.horse_id && vmap.get(u.horse_id)
        ? parseMetersToMm(vmap.get(u.horse_id).length)
        : 0

    if (u.unit_type === 'horse+trailer' && lTrailer) return lTrailer
    if (u.unit_type === 'rigid' && lRigid) return lRigid

    return Math.max(lTrailer, lRigid, lHorse, 0)
  }

  // derive a simple category: flag ASSM if any attached vehicle’s geozone equals 'ASSM'
  function categoryForUnit(u) {
    const geo = [
      u.trailer_id && vmap.get(u.trailer_id)?.geozone,
      u.horse_id && vmap.get(u.horse_id)?.geozone,
      u.rigid_id && vmap.get(u.rigid_id)?.geozone,
    ].map((x) => (x || '').toString().trim().toUpperCase())

    return geo.includes('ASSM') ? 'ASSM' : ''
  }

  // pick a priority (highest of available piece priorities)
  function priorityForUnit(u) {
    const pr = [
      u.trailer_id && vmap.get(u.trailer_id)?.priority,
      u.horse_id && vmap.get(u.horse_id)?.priority,
      u.rigid_id && vmap.get(u.rigid_id)?.priority,
    ]
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n))
    return pr.length ? Math.max(...pr) : 0
  }

  // Step 4: return enriched units
  return units.map((u) => ({
    ...u,
    length_mm: lengthForUnit(u), // <—— hydrated from vehicles.length (meters)
    priority: priorityForUnit(u) || 0, // optional
    category: categoryForUnit(u), // optional ('ASSM' or '')
  }))
}

async function fetchItems(cutoffDate, branchId, customerId) {
  // v_unassigned_items columns: load_id, route_id, route_name, branch_id, order_date, suburb_name, order_id, customer_id, customer_name, item_id, weight_kg, description, is_lip_channel
  let q = database
    .from('v_unassigned_items')
    .select('*')
    .lte('order_date', cutoffDate)
  // Stable, useful packing order: oldest first, heavier first within day
  q = q
    .order('order_date', { ascending: true })
    .order('weight_kg', { ascending: false })
  if (branchId) q = q.eq('branch_id', branchId)
  if (customerId) q = q.eq('customer_id', customerId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

async function fetchPlan(planId) {
  const { data, error } = await database
    .from('assignment_plans')
    .select('*')
    .eq('id', planId)
    .single()
  if (error) throw error
  return data
}

async function fetchPlanUnits(planId) {
  const { data, error } = await database
    .from('v_plan_units_summary')
    .select('*')
    .eq('plan_id', planId)
    .order('unit_type', { ascending: true })
  if (error) throw error
  return data || []
}

// Fetch assignments for a plan and enrich with display fields.

// No RPCs; uses standard selects and merges in JS.
async function fetchPlanAssignments(planId) {
  // 1) Get plan_unit ids for this plan
  const { data: unitRows, error: unitErr } = await database
    .from('assignment_plan_units')
    .select('id')
    .eq('plan_id', planId)
  if (unitErr) throw unitErr
  const unitIds = (unitRows || []).map((r) => r.id)
  if (!unitIds.length) return []

  // 2) Get assignments for those units
  const { data: assigns, error: aErr } = await database
    .from('assignment_plan_item_assignments')
    .select(
      'id,plan_unit_id,load_id,order_id,item_id,assigned_weight_kg,priority_note'
    )
    .in('plan_unit_id', unitIds)
    .order('id', { ascending: true })
  if (aErr) throw aErr
  if (!assigns?.length) return []

  // 3) Enrich with display fields from v_unassigned_items (left-join semantics)
  //    Note: once items are assigned, they may no longer appear in this view—fields will be null.
  const itemIds = Array.from(
    new Set(assigns.map((a) => a.item_id).filter(Boolean))
  )
  let itemMap = new Map()
  if (itemIds.length) {
    // chunk IN() if you expect very large plans
    const CHUNK = 1000
    let rows = []
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      const slice = itemIds.slice(i, i + CHUNK)
      const { data: part, error: iErr } = await database
        .from('v_unassigned_items')
        .select(
          'item_id,customer_id,customer_name,suburb_name,route_name,order_date,description'
        )
        .in('item_id', slice)
      if (iErr) throw iErr
      rows = rows.concat(part || [])
    }
    itemMap = new Map(rows.map((r) => [r.item_id, r]))
  }

  // 4) Merge and sort (order_date asc, then id asc)
  const merged = assigns.map((a) => {
    const ui = itemMap.get(a.item_id) || {}
    return {
      assignment_id: a.id,
      plan_unit_id: a.plan_unit_id,
      load_id: a.load_id,
      order_id: a.order_id,
      item_id: a.item_id,
      assigned_weight_kg: a.assigned_weight_kg,
      priority_note: a.priority_note,
      customer_id: ui.customer_id ?? null,
      customer_name: ui.customer_name ?? null,
      suburb_name: ui.suburb_name ?? null,
      route_name: ui.route_name ?? null,
      order_date: ui.order_date ?? null,
      description: ui.description ?? null,
    }
  })

  merged.sort((x, y) => {
    const a = x.order_date || ''
    const b = y.order_date || ''
    if (a !== b) return String(a).localeCompare(String(b))
    return Number(x.assignment_id) - Number(y.assignment_id)
  })

  return merged
}

// async function fetchPlanAssignments(planId) {
//   // If you don't have exec_sql, replace with a view or multi-selects.
//   const { data, error } = await database.rpc('exec_sql', {
//     query: `
//       select
//         a.id as assignment_id,
//         u.id as plan_unit_id,
//         a.load_id, a.order_id, a.item_id,
//         a.assigned_weight_kg,
//         a.priority_note,
//         ui.customer_id, ui.customer_name, ui.suburb_name, ui.route_name, ui.order_date, ui.description
//       from public.assignment_plan_item_assignments a
//       join public.assignment_plan_units u on u.id = a.plan_unit_id
//       left join public.v_unassigned_items ui on ui.item_id = a.item_id
//       where u.plan_id = $1
//       order by ui.order_date asc, a.id asc
//     `,
//     params: [planId],
//   })
//   if (error) throw error
//   return data || []
// }

async function fetchUnassignedBucket(planId) {
  const { data, error } = await database
    .from('assignment_plan_unassigned_items')
    .select('*')
    .eq('plan_id', planId)
    .order('order_date', { ascending: true })
  if (error) throw error
  return data || []
}

async function recalcUsedCapacity(planId) {
  await database
    .rpc('recalc_plan_used_capacity', { p_plan_id: planId })
    .catch(() => {})
}

/** route_id -> { branch_id, route_name } */
async function fetchRouteBranchMap() {
  const { data, error } = await database
    .from('routes_with_tree')
    .select('route_id, branch_id, route_name')
  if (error) throw error
  const m = new Map()
  for (const r of data || [])
    m.set(r.route_id, { branch_id: r.branch_id, route_name: r.route_name })
  return m
}

/* ============================== nested manifest ============================== */

function buildNested(units, assignments, itemRemainders) {
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

      const byOrder = groupBy(crow, (r) => r.order_id)
      const orders = []
      for (const [order_id, orows] of byOrder.entries()) {
        const items = orows.map((r) => ({
          item_id: r.item_id,
          description: r.description,
          assigned_weight_kg: Number(r.assigned_weight_kg),
          assignment_id: r.assignment_id,
        }))
        orders.push({
          order_id,
          total_assigned_weight_kg: items.reduce(
            (s, i) => s + i.assigned_weight_kg,
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
      used_capacity_kg: Number(u.used_capacity_kg),
      customers,
    })
  }

  const unassigned = (itemRemainders || []).map((r) => ({
    load_id: r.load_id,
    order_id: r.order_id,
    item_id: r.item_id,
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    suburb_name: r.suburb_name,
    route_name: r.route_name,
    order_date: r.order_date,
    weight_left: Number(r.weight_left),
    description: r.description,
    reason: r.reason || null,
  }))

  return { assigned_units: outUnits, unassigned }
}

/* ============================== PACKER with original constraints ============================== */
function packItemsIntoUnits(
  items,
  rawUnits,
  {
    capacityHeadroom = 0.1,
    lengthBufferMm = 600,
    maxTrucksPerZone = 2,
    ignoreLengthIfMissing = true,
    ignoreDepartment = false,
    customerUnitCap = 2,
    routeAffinitySlop = 0.25, // prefer keeping the same macro-route on a unit
  } = {}
) {
  // Normalize units
  const units = (rawUnits || []).map((u) => {
    const baseCap = toNumber(u.capacity_kg, 0)
    const effCap = Math.max(
      0,
      Math.round(baseCap * (1 + Number(capacityHeadroom || 0)))
    )
    return {
      ...u,
      capacity_left: effCap,
      // preserve hydrated values, with safe fallbacks:
      length_mm: toNumber(u.length_mm, 0),
      category: safeUpper(u.category || ''),
      priority: toNumber(u.priority, 0),
      branch_id: u.branch_id ?? null,
    }
  })

  // per-plan state
  const state = units.map(() => ({
    capacity_left: 0, // will be set below
    assigned_count: 0,
    routeGroups: new Map(), // macro-route group -> count
  }))
  for (let i = 0; i < units.length; i++) {
    state[i].capacity_left = toNumber(units[i].capacity_left)
  }

  const zoneUnitMap = new Map() // zoneKey -> Set(unitId/index) of units already active in that zone
  const customerUnitCounts = new Map() // `${customerId}|${unitId}` -> count

  const placements = []
  const unplaced = []

  for (const item of items) {
    const needKg = Math.max(0, toNumber(item.weight_kg))
    const needLenMm =
      parseItemLengthFromDescription(item.description) +
      Number(lengthBufferMm || 0)
    const assm = isAssmItem(item)
    const zones = zoneKeysForItem(item)
    const itemBranch = item.branch_id ?? null

    // ------ Soft zone cap logic ------
    // If any touched zone is at cap, restrict pool to units already active in those zones.
    let allowedUnitIds = null
    if (zones && zones.length) {
      const over = zones.filter(
        (z) => (zoneUnitMap.get(z)?.size || 0) >= Number(maxTrucksPerZone || 0)
      )
      if (over.length) {
        allowedUnitIds = new Set()
        for (const z of zones) {
          const set = zoneUnitMap.get(z)
          if (set) for (const id of set) allowedUnitIds.add(id)
        }
      }
    }

    // Build candidate pool
    const pool = []
    for (let idx = 0; idx < units.length; idx++) {
      const u = units[idx]
      const st = state[idx]
      const unitKey = u.id ?? idx

      // If cap reached: only allow units already serving these zones
      if (allowedUnitIds && !allowedUnitIds.has(unitKey)) continue

      // Department gating
      const deptOk = ignoreDepartment
        ? true
        : assm
        ? u.category === 'ASSM' || u.category === ''
        : u.category !== 'ASSM' || u.category === ''
      if (!deptOk) continue

      // Branch gating
      if (itemBranch && String(u.branch_id || '') !== String(itemBranch))
        continue

      // Length rule (+buffer), allow unknown if ignoreLengthIfMissing
      const lengthOk =
        u.length_mm > 0 ? u.length_mm >= needLenMm : !!ignoreLengthIfMissing
      if (!lengthOk) continue

      // Capacity rule
      if (st.capacity_left < needKg) continue

      // Zone rule (only when cap NOT reached): prevent opening more than maxTrucksPerZone units
      if (!allowedUnitIds) {
        const zoneOk = zones.every(
          (z) => (zoneUnitMap.get(z)?.size || 0) < Number(maxTrucksPerZone || 0)
        )
        if (!zoneOk) continue
      }

      // Customer spread rule (≤ customerUnitCap per unit)
      const custId = item.customer_id ?? null
      if (custId != null && Number(customerUnitCap) > 0) {
        const key = `${custId}|${unitKey}`
        const count = customerUnitCounts.get(key) || 0
        if (count >= Number(customerUnitCap)) continue
      }

      pool.push({ idx, u, st })
    }

    if (!pool.length) {
      unplaced.push({
        ...item,
        weight_left: needKg,
        reason: allowedUnitIds
          ? 'All active trucks for this zone lack capacity/length/branch/department/customer cap'
          : 'No unit meets capacity/length/department/branch/zone constraints or customer cap',
      })
      continue
    }

    // Select with route-affinity → length-dominant score → leftover capacity → priority
    pool.sort((A, B) => {
      // Prefer units already carrying this macro-route group
      const affA = routeAffinity(A.st, item.route_group)
      const affB = routeAffinity(B.st, item.route_group)
      if (affA !== affB) return affB - affA // higher affinity first

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
    const chosenUnit = chosen.u
    const st = state[chosenIdx]

    // place entire item (atomic)
    placements.push({ unitIdx: chosenIdx, item, weight: needKg })

    // mutate state
    st.capacity_left = Math.max(0, st.capacity_left - needKg)
    st.assigned_count += 1

    // remember this unit is now carrying this macro-route group
    if (item.route_group) {
      const prev = st.routeGroups.get(item.route_group) || 0
      st.routeGroups.set(item.route_group, prev + 1)
    }

    // reserve unit across zones (for zone cap accounting)
    zones.forEach((z) => {
      if (!zoneUnitMap.has(z)) zoneUnitMap.set(z, new Set())
      zoneUnitMap.get(z).add(chosenUnit.id ?? chosenIdx)
    })

    // bump customer usage on this unit
    const custId = item.customer_id ?? null
    if (custId != null && Number(customerUnitCap) > 0) {
      const key = `${custId}|${chosenUnit.id ?? chosenIdx}`
      customerUnitCounts.set(key, (customerUnitCounts.get(key) || 0) + 1)
    }
  }

  return { placements, unplaced, state, units }
}

// function packItemsIntoUnits(
//   items,
//   rawUnits,
//   {
//     capacityHeadroom = 0.1,
//     lengthBufferMm = 600,
//     maxTrucksPerZone = 2,
//     ignoreLengthIfMissing = true,
//     ignoreDepartment = false,
//     customerUnitCap = 2,
//     routeAffinitySlop = 0.25, // NEW: how strongly to prefer keeping the same macro-route on a unit
//   } = {}
// ) {
//   // Normalize units
//   const units = (rawUnits || []).map((u) => {
//     const baseCap = toNumber(u.capacity_kg, 0)
//     const effCap = Math.max(
//       0,
//       Math.round(baseCap * (1 + Number(capacityHeadroom || 0)))
//     )
//     return {
//       ...u,
//       capacity_left: effCap,
//       // ⛔️ OLD (remove): length_mm: 0, category: '', priority: 0
//       // ✅ NEW: preserve hydrated values, with safe fallbacks:
//       length_mm: toNumber(u.length_mm, 0),
//       category: safeUpper(u.category || ''),
//       priority: toNumber(u.priority, 0),
//       branch_id: u.branch_id ?? null,
//     }
//   })

//   // per-plan state
//   // const state = units.map((u) => ({
//   //   capacity_left: toNumber(u.capacity_left),
//   //   assigned_count: 0,
//   // }))
//   const state = units.map((u) => ({
//     capacity_left: toNumber(u.capacity_left),
//     assigned_count: 0,
//     routeGroups: new Map(), // NEW: group -> count
//   }))

//   const zoneUnitMap = new Map() // zoneKey -> Set(unitId/index)
//   const customerUnitCounts = new Map() // `${customerId}|${unitId}` -> count

//   const placements = []
//   const unplaced = []

//   for (const item of items) {
//     const needKg = Math.max(0, toNumber(item.weight_kg))
//     const needLenMm =
//       parseItemLengthFromDescription(item.description) +
//       Number(lengthBufferMm || 0)
//     const assm = isAssmItem(item)
//     const zones = zoneKeysForItem(item)
//     const itemBranch = item.branch_id ?? null

//     // zone cap pre-check
//     const zoneBlocked = zones.some(
//       (z) => (zoneUnitMap.get(z)?.size || 0) >= Number(maxTrucksPerZone || 0)
//     )
//     if (zoneBlocked) {
//       unplaced.push({
//         ...item,
//         weight_left: needKg,
//         reason: `Zone cap reached (${maxTrucksPerZone})`,
//       })
//       continue
//     }

//     // build candidate pool
//     const pool = []
//     for (let idx = 0; idx < units.length; idx++) {
//       const u = units[idx]
//       const st = state[idx]

//       // Department gating—neutral unless you later add unit.category or item SO detection
//       const deptOk = ignoreDepartment
//         ? true
//         : assm
//         ? u.category === 'ASSM' || u.category === ''
//         : u.category !== 'ASSM' || u.category === ''
//       if (!deptOk) continue

//       // Branch gating
//       if (itemBranch && String(u.branch_id || '') !== String(itemBranch))
//         continue

//       // Length rule (+buffer), allow unknown if ignoreLengthIfMissing
//       const lengthOk =
//         u.length_mm > 0 ? u.length_mm >= needLenMm : !!ignoreLengthIfMissing
//       if (!lengthOk) continue

//       // Capacity rule
//       if (st.capacity_left < needKg) continue

//       // Zone rule
//       const zoneOk = zones.every(
//         (z) => (zoneUnitMap.get(z)?.size || 0) < Number(maxTrucksPerZone || 0)
//       )
//       if (!zoneOk) continue

//       // Customer spread rule (≤ customerUnitCap per unit)
//       const custId = item.customer_id ?? null
//       if (custId != null && Number(customerUnitCap) > 0) {
//         const key = `${custId}|${u.id || idx}`
//         const count = customerUnitCounts.get(key) || 0
//         if (count >= Number(customerUnitCap)) continue
//       }

//       pool.push({ idx, u, st })
//     }

//     if (!pool.length) {
//       unplaced.push({
//         ...item,
//         weight_left: needKg,
//         reason:
//           'No unit meets capacity/length/department/branch/zone constraints or customer cap',
//       })
//       continue
//     }

//     // Select with length-dominant scoring → leftover capacity → priority
//     pool.sort((A, B) => {
//       const sa = scoreUnit(A.u, needKg, needLenMm)
//       const sb = scoreUnit(B.u, needKg, needLenMm)

//       // Prefer units already carrying this macro-route group
//       const affA = routeAffinity(A.st, item.route_group)
//       const affB = routeAffinity(B.st, item.route_group)
//       const saAdj = sa + routeAffinitySlop * (1 - affA)
//       const sbAdj = sb + routeAffinitySlop * (1 - affB)
//       if (saAdj !== sbAdj) return saAdj - sbAdj

//       const ra = A.st.capacity_left - needKg
//       const rb = B.st.capacity_left - needKg
//       if (ra !== rb) return ra - rb

//       return (B.u.priority || 0) - (A.u.priority || 0)
//     })
//     // pool.sort((A, B) => {
//     //   const sa = scoreUnit(A.u, needKg, needLenMm)
//     //   const sb = scoreUnit(B.u, needKg, needLenMm)
//     //   if (sa !== sb) return sa - sb
//     //   const ra = A.st.capacity_left - needKg
//     //   const rb = B.st.capacity_left - needKg
//     //   if (ra !== rb) return ra - rb
//     //   return (B.u.priority || 0) - (A.u.priority || 0)
//     // })

//     const chosen = pool[0]
//     const chosenIdx = chosen.idx
//     const chosenUnit = chosen.u
//     const st = state[chosenIdx]

//     // place entire item (atomic)
//     placements.push({ unitIdx: chosenIdx, item, weight: needKg })

//     // mutate state
//     st.capacity_left = Math.max(0, st.capacity_left - needKg)
//     st.assigned_count += 1

//     // NEW: remember this unit is now carrying this macro-route group
//     if (item.route_group) {
//       const prev = state[chosenIdx].routeGroups.get(item.route_group) || 0
//       state[chosenIdx].routeGroups.set(item.route_group, prev + 1)
//     }

//     // reserve unit across zones
//     zones.forEach((z) => {
//       if (!zoneUnitMap.has(z)) zoneUnitMap.set(z, new Set())
//       zoneUnitMap.get(z).add(chosenUnit.id ?? chosenIdx)
//     })

//     // bump customer usage on this unit
//     const custId = item.customer_id ?? null
//     if (custId != null && Number(customerUnitCap) > 0) {
//       const key = `${custId}|${chosenUnit.id || chosenIdx}`
//       customerUnitCounts.set(key, (customerUnitCounts.get(key) || 0) + 1)
//     }
//   }

//   return { placements, unplaced, state, units }
// }

/* ============================== endpoints ============================== */

// List plans from the assignment_plans table
// GET /plans
// Query params (all optional):
//   limit, offset, order ('asc'|'desc'; default 'desc')
//   date_from, date_to  (filter on departure_date)
//   branch_id, customer_id
//   include_units=true             -> attach plan_unit_ids per plan
//   include_counts=true            -> attach units_count and assignments_count
//   include_branch_name=true       -> attach scope_branch_name
//   ids=<comma-separated UUIDs>    -> fetch only these plan IDs (order preserved by run_at desc)

export const getAllPlans = async (req, res) => {
  try {
    const {
      limit = 50,
      offset = 0,
      order = 'desc',
      date_from,
      date_to,
      branch_id,
      customer_id,
      include_units,
      include_counts,
      include_branch_name,
      ids,
    } = req.query || {}

    const wantUnits = String(include_units).toLowerCase() === 'true'
    const wantCounts = String(include_counts).toLowerCase() === 'true'
    const wantBranchN = String(include_branch_name).toLowerCase() === 'true'

    let q = database
      .from('assignment_plans')
      .select(
        'id, run_at, departure_date, cutoff_date, scope_branch_id, scope_customer_id, notes',
        { count: 'exact' }
      )

    if (ids) {
      const arr = ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (arr.length) q = q.in('id', arr)
    }

    if (branch_id) q = q.eq('scope_branch_id', branch_id)
    if (customer_id) q = q.eq('scope_customer_id', customer_id)
    if (date_from) q = q.gte('departure_date', date_from)
    if (date_to) q = q.lte('departure_date', date_to)

    const asc = String(order).toLowerCase() === 'asc'
    q = q
      .order('departure_date', { ascending: asc, nullsFirst: asc })
      .order('run_at', { ascending: asc, nullsFirst: asc })

    // pagination
    const start = Number(offset) || 0
    const end = start + (Number(limit) || 50) - 1
    q = q.range(start, Math.max(start, end))

    const { data: plans, error, count } = await q
    if (error) throw error
    const plansOut = plans || []

    // ---- Optional enrichments ----
    let branchNameById = new Map()
    if (wantBranchN) {
      try {
        const { data: rows } = await database.from('branches').select('id,name')
        if (rows?.length)
          branchNameById = new Map(rows.map((b) => [String(b.id), b.name]))
      } catch (_) {}
    }

    let unitsByPlan = new Map()
    let countsByPlan = new Map()

    if (wantUnits || wantCounts) {
      const planIds = plansOut.map((p) => p.id)
      if (planIds.length) {
        // fetch plan units
        const { data: pu, error: puErr } = await database
          .from('assignment_plan_units')
          .select('id, plan_id')
          .in('plan_id', planIds)
        if (puErr) throw puErr

        if (wantUnits) {
          for (const r of pu || []) {
            const arr = unitsByPlan.get(r.plan_id) || []
            arr.push(r.id)
            unitsByPlan.set(r.plan_id, arr)
          }
        }

        if (wantCounts) {
          // unit counts
          const unitsCount = new Map()
          for (const r of pu || []) {
            unitsCount.set(r.plan_id, (unitsCount.get(r.plan_id) || 0) + 1)
          }

          // assignment counts
          const puIds = (pu || []).map((r) => r.id)
          let assignsCount = new Map()
          if (puIds.length) {
            const { data: asn, error: asnErr } = await database
              .from('assignment_plan_item_assignments')
              .select('plan_unit_id', { count: 'exact', head: false })
              .in('plan_unit_id', puIds)
            if (asnErr) throw asnErr
            // count per plan via their plan_unit_id -> plan_id
            const planByPU = new Map(pu.map((r) => [r.id, r.plan_id]))
            for (const a of asn || []) {
              const pid = planByPU.get(a.plan_unit_id)
              if (!pid) continue
              assignsCount.set(pid, (assignsCount.get(pid) || 0) + 1)
            }
          }

          for (const pid of planIds) {
            countsByPlan.set(pid, {
              units_count: unitsCount.get(pid) || 0,
              assignments_count: assignsCount.get(pid) || 0,
            })
          }
        }
      }
    }

    // shape final payload
    const augmented = plansOut.map((p) => ({
      ...p,
      ...(wantBranchN
        ? {
            scope_branch_name:
              branchNameById.get(String(p.scope_branch_id || '')) || null,
          }
        : {}),
      ...(wantUnits ? { plan_unit_ids: unitsByPlan.get(p.id) || [] } : {}),
      ...(wantCounts
        ? countsByPlan.get(p.id) || { units_count: 0, assignments_count: 0 }
        : {}),
    }))

    return res.status(200).json(
      new Response(200, 'OK', 'Plans fetched', {
        total: typeof count === 'number' ? count : plansOut.length || 0,
        limit: Number(limit),
        offset: Number(offset),
        plans: augmented,
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/**
 * AUTO (preview or commit)
 * Body:
 *  departure_date?, cutoff_date?, branch_id?, customer_id?, commit?, notes?
 *  capacityHeadroom?, lengthBufferMm?, maxTrucksPerZone?, ignoreLengthIfMissing?, ignoreDepartment?, customerUnitCap?
 */
export const autoAssignLoads = async (req, res) => {
  try {
    const {
      departure_date,
      cutoff_date,
      branch_id,
      customer_id,
      commit = false,
      notes = null,

      // knobs
      capacityHeadroom = 0.1,
      lengthBufferMm = 600,
      maxTrucksPerZone = 2,
      ignoreLengthIfMissing = false,
      ignoreDepartment = false,
      customerUnitCap = 2,
      routeAffinitySlop = 0.25, // NEW
    } = req.body || {}

    const { today, tomorrow } = todayTomorrow()
    const dep = departure_date || tomorrow
    const cut = cutoff_date || today

    // units + backlog
    const units = await fetchUnits(branch_id)
    const itemsRaw = await fetchItems(cut, branch_id, customer_id)

    // enrich items with route group + branch fallback from routes table
    const routeMap = await fetchRouteBranchMap()
    const items = itemsRaw.map((it) => {
      const fromRoute = it.route_id ? routeMap.get(it.route_id) : null
      const route_name =
        it.route_name || fromRoute?.route_name || it.suburb_name || ''
      const route_group = extractRouteGroup(route_name)
      return {
        ...it,
        branch_id: it.branch_id || fromRoute?.branch_id || it.branch_id,
        route_name,
        route_group,
      }
    })

    // pack
    const {
      placements,
      unplaced,
      state,
      units: shapedUnits,
    } = packItemsIntoUnits(items, units, {
      capacityHeadroom,
      lengthBufferMm,
      maxTrucksPerZone,
      ignoreLengthIfMissing,
      ignoreDepartment,
      customerUnitCap,
      routeAffinitySlop, // NEW
    })

    // ---------- NEW: compute idle (unassigned) units by branch ----------
    // Build a quick branch id -> name map
    let branchNameById = new Map()
    try {
      const { data: branchRows } = await database
        .from('branches')
        .select('id,name')
      if (branchRows && branchRows.length) {
        branchNameById = new Map(branchRows.map((b) => [String(b.id), b.name]))
      }
    } catch (_) {}

    const usedIdxSet = new Set(placements.map((p) => p.unitIdx))
    const idleUnits = shapedUnits
      .map((u, idx) => ({ u, idx }))
      .filter(({ idx }) => !usedIdxSet.has(idx))
      .map(({ u, idx }) => ({
        // a stable key even if the view has no single id
        unit_key:
          u.unit_type === 'rigid'
            ? `rigid:${u.rigid_id ?? idx}`
            : u.unit_type === 'horse+trailer'
            ? `horse:${u.horse_id ?? idx}|trailer:${u.trailer_id ?? idx}`
            : `unit:${idx}`,
        unit_type: u.unit_type,
        driver_id: u.driver_id,
        driver_name: u.driver_name,
        fleet_number: u.rigid_fleet || u.horse_fleet || u.trailer_fleet || null,
        plate: u.rigid_plate || u.horse_plate || u.trailer_plate || null,
        capacity_kg: Number(u.capacity_kg),
        capacity_left_kg: state[idx]?.capacity_left ?? Number(u.capacity_kg),
        length_mm: u.length_mm || 0,
        category: u.category || '',
        priority: u.priority || 0,
        branch_id: u.branch_id ?? null,
        branch_name: branchNameById.get(String(u.branch_id ?? '')) || null,
      }))

    // group by branch
    const idleByBranchMap = new Map()
    for (const x of idleUnits) {
      const key = x.branch_id == null ? 'unknown' : String(x.branch_id)
      if (!idleByBranchMap.has(key)) {
        idleByBranchMap.set(key, {
          branch_id: x.branch_id ?? null,
          branch_name:
            x.branch_name || (x.branch_id == null ? 'Unknown' : null),
          total_idle: 0,
          units: [],
        })
      }
      const g = idleByBranchMap.get(key)
      g.total_idle += 1
      g.units.push(x)
    }
    const idle_units_by_branch = Array.from(idleByBranchMap.values()).sort(
      (a, b) =>
        String(a.branch_name || '').localeCompare(String(b.branch_name || ''))
    )
    // ---------- /NEW ----------

    if (!commit) {
      // ephemeral preview
      // Build from actual placements
      const weightByIdx = sumWeightsByUnitIdx(placements)
      const used = Array.from(weightByIdx.keys()) // only units that truly have at least one item

      const pseudoUnits = used.map((idx, i) => {
        const u = shapedUnits[idx]
        const usedKg = weightByIdx.get(idx) || 0
        return {
          plan_unit_id: `preview-${i}`,
          unit_type: u.unit_type,
          driver_id: u.driver_id,
          driver_name: u.driver_name,
          rigid_id: u.rigid_id,
          rigid_plate: u.rigid_plate,
          rigid_fleet: u.rigid_fleet,
          horse_id: u.horse_id,
          horse_plate: u.horse_plate,
          horse_fleet: u.horse_fleet,
          trailer_id: u.trailer_id,
          trailer_plate: u.trailer_plate,
          trailer_fleet: u.trailer_fleet,
          capacity_kg: Number(u.capacity_kg),
          used_capacity_kg: Number(usedKg.toFixed(3)), // <- robust, from placements
        }
      })

      const pseudoAssignments = placements.map((p) => {
        const ordinal = used.indexOf(p.unitIdx)
        const i = p.item
        return {
          assignment_id: `preview-${p.unitIdx}-${i.item_id}`,
          plan_unit_id: `preview-${ordinal}`,
          load_id: i.load_id,
          order_id: i.order_id,
          item_id: i.item_id,
          assigned_weight_kg: p.weight,
          priority_note: 'auto',
          customer_id: i.customer_id,
          customer_name: i.customer_name,
          suburb_name: i.suburb_name,
          route_name: i.route_name,
          order_date: i.order_date,
          description: i.description,
        }
      })

      // const used = Array.from(new Set(placements.map((p) => p.unitIdx)))
      // const pseudoUnits = used.map((idx, i) => {
      //   const u = shapedUnits[idx]
      //   const st = state[idx]
      //   return {
      //     plan_unit_id: `preview-${i}`,
      //     unit_type: u.unit_type,
      //     driver_id: u.driver_id,
      //     driver_name: u.driver_name,
      //     rigid_id: u.rigid_id,
      //     rigid_plate: u.rigid_plate,
      //     rigid_fleet: u.rigid_fleet,
      //     horse_id: u.horse_id,
      //     horse_plate: u.horse_plate,
      //     horse_fleet: u.horse_fleet,
      //     trailer_id: u.trailer_id,
      //     trailer_plate: u.trailer_plate,
      //     trailer_fleet: u.trailer_fleet,
      //     capacity_kg: Number(u.capacity_kg),
      //     used_capacity_kg: Math.max(
      //       0,
      //       Number(u.capacity_kg) - Number(st.capacity_left)
      //     ),
      //   }
      // })

      // const pseudoAssignments = placements.map((p) => {
      //   const ordinal = used.indexOf(p.unitIdx)
      //   const i = p.item
      //   return {
      //     assignment_id: `preview-${p.unitIdx}-${i.item_id}`,
      //     plan_unit_id: `preview-${ordinal}`,
      //     load_id: i.load_id,
      //     order_id: i.order_id,
      //     item_id: i.item_id,
      //     assigned_weight_kg: p.weight,
      //     priority_note: 'auto',
      //     customer_id: i.customer_id,
      //     customer_name: i.customer_name,
      //     suburb_name: i.suburb_name,
      //     route_name: i.route_name,
      //     order_date: i.order_date,
      //     description: i.description,
      //   }
      // })

      const bucket = unplaced.map((u) => ({
        load_id: u.load_id,
        order_id: u.order_id,
        item_id: u.item_id,
        customer_id: u.customer_id,
        customer_name: u.customer_name,
        suburb_name: u.suburb_name,
        route_name: u.route_name,
        order_date: u.order_date,
        weight_left: u.weight_left,
        description: u.description,
        reason: u.reason || null,
      }))

      const nested = buildNested(pseudoUnits, pseudoAssignments, bucket)
      return res.status(200).json(
        new Response(200, 'OK', 'Auto-assignment preview (no DB changes)', {
          plan: {
            departure_date: dep,
            cutoff_date: cut,
            scope_branch_id: branch_id || null,
            scope_customer_id: customer_id || null,
            commit: false,
            parameters: {
              capacity_headroom: `${Math.round(
                (capacityHeadroom || 0) * 100
              )}%`,
              length_buffer_mm: Number(lengthBufferMm || 0),
              zone_unit_cap: maxTrucksPerZone,
              ignore_length_if_missing: !!ignoreLengthIfMissing,
              ignore_department: !!ignoreDepartment,
              customer_unit_cap: Number(customerUnitCap),
              route_affinity_slop: routeAffinitySlop,
            },
          },
          ...nested,
          idle_units_by_branch, // <-- NEW in preview
        })
      )
    }

    // commit flow — persist plan, units, assignments, bucket
    const planIns = await database
      .from('assignment_plans')
      .insert([
        {
          departure_date: dep,
          cutoff_date: cut,
          scope_branch_id: branch_id || null,
          scope_customer_id: customer_id || null,
          notes,
        },
      ])
      .select('*')
      .single()
    if (planIns.error) throw planIns.error
    const plan = planIns.data

    // create plan units (only used ones)
    const weightByIdx = sumWeightsByUnitIdx(placements)
    // const usedIdx = Array.from(weightByIdx.keys()) // only units that actually got items
    const EPS = 1e-3
    const usedIdx = Array.from(weightByIdx.entries())
      .filter(([, w]) => w > EPS)
      .map(([idx]) => idx)

    // const usedIdx = Array.from(new Set(placements.map((p) => p.unitIdx)))
    const planUnitIdByIdx = new Map()
    for (const idx of usedIdx) {
      const u = shapedUnits[idx]
      const ins = await database
        .from('assignment_plan_units')
        .insert([
          {
            plan_id: plan.id,
            unit_type: u.unit_type,
            rigid_id: u.rigid_id,
            trailer_id: u.trailer_id,
            horse_id: u.horse_id,
            driver_id: u.driver_id,
            driver_name: u.driver_name,
            rigid_plate: u.rigid_plate,
            rigid_fleet: u.rigid_fleet,
            horse_plate: u.horse_plate,
            horse_fleet: u.horse_fleet,
            trailer_plate: u.trailer_plate,
            trailer_fleet: u.trailer_fleet,
            capacity_kg: u.capacity_kg,
            priority: u.priority || 0,
            branch_id: u.branch_id || null,
            category: u.category || '',
            length_mm: u.length_mm || 0,
          },
        ])
        .select('*')
        .single()
      if (ins.error) throw ins.error
      planUnitIdByIdx.set(idx, ins.data.id)
    }

    // assignments
    if (placements.length) {
      const rows = placements.map((p) => ({
        plan_unit_id: planUnitIdByIdx.get(p.unitIdx),
        load_id: p.item.load_id,
        order_id: p.item.order_id,
        item_id: p.item.item_id,
        assigned_weight_kg: p.weight,
        priority_note: 'auto',
      }))
      const insA = await database
        .from('assignment_plan_item_assignments')
        .insert(rows)
      if (insA.error) throw insA.error
    }

    // unassigned bucket
    if (unplaced.length) {
      const rows = unplaced.map((u) => ({
        plan_id: plan.id,
        load_id: u.load_id,
        order_id: u.order_id,
        item_id: u.item_id,
        weight_left: u.weight_left,
        reason: u.reason || null,
      }))
      const insB = await database
        .from('assignment_plan_unassigned_items')
        .insert(rows)
      if (insB.error) throw insB.error
    }

    await recalcUsedCapacity(plan.id)

    const unitsDb = await fetchPlanUnits(plan.id)
    const assignsDb = await fetchPlanAssignments(plan.id)
    const bucket = await fetchUnassignedBucket(plan.id)

    return res.status(200).json(
      new Response(200, 'OK', 'Auto-assignment committed', {
        plan,
        ...buildNested(unitsDb, assignsDb, bucket),
        idle_units_by_branch, // <-- NEW in commit
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

// export const autoAssignLoads = async (req, res) => {
//   try {
//     const {
//       departure_date,
//       cutoff_date,
//       branch_id,
//       customer_id,
//       commit = false,
//       notes = null,

//       // knobs
//       capacityHeadroom = 0.1,
//       lengthBufferMm = 600,
//       maxTrucksPerZone = 2,
//       ignoreLengthIfMissing = false,
//       ignoreDepartment = false,
//       customerUnitCap = 2,
//       routeAffinitySlop = 0.25, // NEW
//     } = req.body || {}

//     const { today, tomorrow } = todayTomorrow()
//     const dep = departure_date || tomorrow
//     const cut = cutoff_date || today

//     // units + backlog
//     const units = await fetchUnits(branch_id)
//     const itemsRaw = await fetchItems(cut, branch_id, customer_id)

//     // enrich items with route group + branch fallback from routes table
//     const routeMap = await fetchRouteBranchMap()
//     const items = itemsRaw.map((it) => {
//       const fromRoute = it.route_id ? routeMap.get(it.route_id) : null
//       const route_name =
//         it.route_name || fromRoute?.route_name || it.suburb_name || ''
//       const route_group = extractRouteGroup(route_name)
//       return {
//         ...it,
//         branch_id: it.branch_id || fromRoute?.branch_id || it.branch_id,
//         route_name,
//         route_group,
//       }
//     })

//     // pack
//     const {
//       placements,
//       unplaced,
//       state,
//       units: shapedUnits,
//     } = packItemsIntoUnits(items, units, {
//       capacityHeadroom,
//       lengthBufferMm,
//       maxTrucksPerZone,
//       ignoreLengthIfMissing,
//       ignoreDepartment,
//       customerUnitCap,
//       routeAffinitySlop, // NEW
//     })
//     // const {
//     //   placements,
//     //   unplaced,
//     //   state,
//     //   units: shapedUnits,
//     // } = packItemsIntoUnits(items, units, {
//     //   capacityHeadroom,
//     //   lengthBufferMm,
//     //   maxTrucksPerZone,
//     //   ignoreLengthIfMissing,
//     //   ignoreDepartment,
//     //   customerUnitCap,
//     // })

//     if (!commit) {
//       // ephemeral preview
//       const used = Array.from(new Set(placements.map((p) => p.unitIdx)))
//       const pseudoUnits = used.map((idx, i) => {
//         const u = shapedUnits[idx]
//         const st = state[idx]
//         return {
//           plan_unit_id: `preview-${i}`,
//           unit_type: u.unit_type,
//           driver_id: u.driver_id,
//           driver_name: u.driver_name,
//           rigid_id: u.rigid_id,
//           rigid_plate: u.rigid_plate,
//           rigid_fleet: u.rigid_fleet,
//           horse_id: u.horse_id,
//           horse_plate: u.horse_plate,
//           horse_fleet: u.horse_fleet,
//           trailer_id: u.trailer_id,
//           trailer_plate: u.trailer_plate,
//           trailer_fleet: u.trailer_fleet,
//           capacity_kg: Number(u.capacity_kg),
//           used_capacity_kg: Math.max(
//             0,
//             Number(u.capacity_kg) - Number(st.capacity_left)
//           ),
//         }
//       })

//       const pseudoAssignments = placements.map((p) => {
//         const ordinal = used.indexOf(p.unitIdx)
//         const i = p.item
//         return {
//           assignment_id: `preview-${p.unitIdx}-${i.item_id}`,
//           plan_unit_id: `preview-${ordinal}`,
//           load_id: i.load_id,
//           order_id: i.order_id,
//           item_id: i.item_id,
//           assigned_weight_kg: p.weight,
//           priority_note: 'auto',
//           customer_id: i.customer_id,
//           customer_name: i.customer_name,
//           suburb_name: i.suburb_name,
//           route_name: i.route_name,
//           order_date: i.order_date,
//           description: i.description,
//         }
//       })

//       const bucket = unplaced.map((u) => ({
//         load_id: u.load_id,
//         order_id: u.order_id,
//         item_id: u.item_id,
//         customer_id: u.customer_id,
//         customer_name: u.customer_name,
//         suburb_name: u.suburb_name,
//         route_name: u.route_name,
//         order_date: u.order_date,
//         weight_left: u.weight_left,
//         description: u.description,
//         reason: u.reason || null,
//       }))

//       const nested = buildNested(pseudoUnits, pseudoAssignments, bucket)
//       return res.status(200).json(
//         new Response(200, 'OK', 'Auto-assignment preview (no DB changes)', {
//           plan: {
//             departure_date: dep,
//             cutoff_date: cut,
//             scope_branch_id: branch_id || null,
//             scope_customer_id: customer_id || null,
//             commit: false,
//             parameters: {
//               capacity_headroom: `${Math.round(
//                 (capacityHeadroom || 0) * 100
//               )}%`,
//               length_buffer_mm: Number(lengthBufferMm || 0),
//               zone_unit_cap: maxTrucksPerZone,
//               ignore_length_if_missing: !!ignoreLengthIfMissing,
//               ignore_department: !!ignoreDepartment,
//               customer_unit_cap: Number(customerUnitCap),
//             },
//           },
//           ...nested,
//         })
//       )
//     }

//     // commit flow — persist plan, units, assignments, bucket
//     const planIns = await database
//       .from('assignment_plans')
//       .insert([
//         {
//           departure_date: dep,
//           cutoff_date: cut,
//           scope_branch_id: branch_id || null,
//           scope_customer_id: customer_id || null,
//           notes,
//         },
//       ])
//       .select('*')
//       .single()
//     if (planIns.error) throw planIns.error
//     const plan = planIns.data

//     // create plan units (only used ones)
//     const usedIdx = Array.from(new Set(placements.map((p) => p.unitIdx)))
//     const planUnitIdByIdx = new Map()
//     for (const idx of usedIdx) {
//       const u = shapedUnits[idx]
//       const ins = await database
//         .from('assignment_plan_units')
//         .insert([
//           {
//             plan_id: plan.id,
//             unit_type: u.unit_type,
//             rigid_id: u.rigid_id,
//             trailer_id: u.trailer_id,
//             horse_id: u.horse_id,
//             driver_id: u.driver_id,
//             driver_name: u.driver_name,
//             rigid_plate: u.rigid_plate,
//             rigid_fleet: u.rigid_fleet,
//             horse_plate: u.horse_plate,
//             horse_fleet: u.horse_fleet,
//             trailer_plate: u.trailer_plate,
//             trailer_fleet: u.trailer_fleet,
//             capacity_kg: u.capacity_kg,
//             priority: u.priority || 0,
//             branch_id: u.branch_id || null,
//             category: u.category || '',
//             length_mm: u.length_mm || 0,
//           },
//         ])
//         .select('*')
//         .single()
//       if (ins.error) throw ins.error
//       planUnitIdByIdx.set(idx, ins.data.id)
//     }

//     // assignments
//     if (placements.length) {
//       const rows = placements.map((p) => ({
//         plan_unit_id: planUnitIdByIdx.get(p.unitIdx),
//         load_id: p.item.load_id,
//         order_id: p.item.order_id,
//         item_id: p.item.item_id,
//         assigned_weight_kg: p.weight,
//         priority_note: 'auto',
//       }))
//       const insA = await database
//         .from('assignment_plan_item_assignments')
//         .insert(rows)
//       if (insA.error) throw insA.error
//     }

//     // unassigned bucket
//     if (unplaced.length) {
//       const rows = unplaced.map((u) => ({
//         plan_id: plan.id,
//         load_id: u.load_id,
//         order_id: u.order_id,
//         item_id: u.item_id,
//         weight_left: u.weight_left,
//         reason: u.reason || null,
//       }))
//       const insB = await database
//         .from('assignment_plan_unassigned_items')
//         .insert(rows)
//       if (insB.error) throw insB.error
//     }

//     await recalcUsedCapacity(plan.id)

//     const unitsDb = await fetchPlanUnits(plan.id)
//     const assignsDb = await fetchPlanAssignments(plan.id)
//     const bucket = await fetchUnassignedBucket(plan.id)
//     return res.status(200).json(
//       new Response(200, 'OK', 'Auto-assignment committed', {
//         plan,
//         ...buildNested(unitsDb, assignsDb, bucket),
//       })
//     )
//   } catch (err) {
//     return res.status(500).json(new Response(500, 'Server Error', err.message))
//   }
// }

/** Add an idle vehicle to a plan (and optionally assign items to it) */
export const addIdleUnit = async (req, res) => {
  try {
    const { planId } = req.params
    const {
      // choose ONE of the following ways to identify the vehicle:
      // 1) unit_key from idle_units_by_branch: "rigid:123" or "horse:45|trailer:78"
      unit_key,

      // 2) or explicit fields:
      unit_type, // 'rigid' | 'horse+trailer'
      rigid_id = null,
      horse_id = null,
      trailer_id = null,

      // optional immediate assignments: [{ item_id, weight_kg?, note? }]
      assign_items = [],
    } = req.body || {}

    // ---- parse unit_key if present ----
    let utype = unit_type
    let rid = rigid_id,
      hid = horse_id,
      tid = trailer_id

    if (unit_key && !utype) {
      if (unit_key.startsWith('rigid:')) {
        utype = 'rigid'
        rid = unit_key.split(':')[1]
      } else if (unit_key.startsWith('horse:')) {
        utype = 'horse+trailer'
        const m = unit_key.match(/^horse:(.+)\|trailer:(.+)$/)
        if (m) {
          hid = m[1]
          tid = m[2]
        }
      }
    }

    // ---- validate input ----
    if (!planId) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'planId required'))
    }
    if (utype !== 'rigid' && utype !== 'horse+trailer') {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'unit_type must be "rigid" or "horse+trailer"'
          )
        )
    }
    if (utype === 'rigid' && !rid) {
      return res
        .status(400)
        .json(
          new Response(400, 'Bad Request', 'rigid_id required for rigid unit')
        )
    }
    if (utype === 'horse+trailer' && (!hid || !tid)) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'horse_id and trailer_id required for horse+trailer unit'
          )
        )
    }

    // ---- fetch the matching row from v_dispatch_units ----
    let q = database.from('v_dispatch_units').select('*').eq('unit_type', utype)
    if (utype === 'rigid') q = q.eq('rigid_id', rid)
    else q = q.eq('horse_id', hid).eq('trailer_id', tid)
    const { data: viewUnits, error: viewErr } = await q
    if (viewErr) throw viewErr
    const src = (viewUnits && viewUnits[0]) || null
    if (!src) {
      return res
        .status(404)
        .json(
          new Response(
            404,
            'Not Found',
            'Vehicle not found in v_dispatch_units'
          )
        )
    }

    // ---- avoid duplicates: already in this plan? ----
    const { data: existing } = await database
      .from('assignment_plan_units')
      .select('id')
      .eq('plan_id', planId)
      .eq('unit_type', utype)
      .eq('rigid_id', utype === 'rigid' ? rid : null)
      .eq('horse_id', utype === 'horse+trailer' ? hid : null)
      .eq('trailer_id', utype === 'horse+trailer' ? tid : null)
      .limit(1)
    if (existing && existing.length) {
      return res.status(200).json(
        new Response(200, 'OK', 'Unit already on plan', {
          plan_unit_id: existing[0].id,
        })
      )
    }

    // ---- hydrate length/category/priority from vehicles (same rules as fetchUnits) ----
    const vehIds = []
    if (src.rigid_id) vehIds.push(src.rigid_id)
    if (src.horse_id) vehIds.push(src.horse_id)
    if (src.trailer_id) vehIds.push(src.trailer_id)

    const { data: vehs, error: vehErr } = await database
      .from('vehicles')
      .select('id,length,priority,geozone,vehicle_category')
      .in('id', vehIds)
    if (vehErr) throw vehErr
    const vmap = new Map((vehs || []).map((v) => [v.id, v]))

    const parseMetersToMm = (raw) => {
      if (raw == null) return 0
      const s = String(raw).trim().replace(',', '.')
      const val = parseFloat(s)
      return Number.isFinite(val) ? Math.max(0, Math.round(val * 1000)) : 0
    }

    const lTrailer =
      src.trailer_id && vmap.get(src.trailer_id)
        ? parseMetersToMm(vmap.get(src.trailer_id).length)
        : 0
    const lRigid =
      src.rigid_id && vmap.get(src.rigid_id)
        ? parseMetersToMm(vmap.get(src.rigid_id).length)
        : 0
    const lHorse =
      src.horse_id && vmap.get(src.horse_id)
        ? parseMetersToMm(vmap.get(src.horse_id).length)
        : 0
    const length_mm =
      utype === 'horse+trailer' && lTrailer
        ? lTrailer
        : utype === 'rigid' && lRigid
        ? lRigid
        : Math.max(lTrailer, lRigid, lHorse, 0)

    const priority = Math.max(
      ...[src.trailer_id, src.horse_id, src.rigid_id].map(
        (id) => (id && Number(vmap.get(id)?.priority)) || -Infinity
      )
    )
    const priority_safe = Number.isFinite(priority) ? priority : 0

    const category = ['ASSM'].includes(
      String(
        vmap.get(src.trailer_id)?.geozone ||
          vmap.get(src.horse_id)?.geozone ||
          vmap.get(src.rigid_id)?.geozone ||
          ''
      ).toUpperCase()
    )
      ? 'ASSM'
      : ''

    // ---- insert the plan unit ----
    const ins = await database
      .from('assignment_plan_units')
      .insert([
        {
          plan_id: planId,
          unit_type: src.unit_type,
          rigid_id: src.rigid_id,
          trailer_id: src.trailer_id,
          horse_id: src.horse_id,
          driver_id: src.driver_id,
          driver_name: src.driver_name,
          rigid_plate: src.rigid_plate,
          rigid_fleet: src.rigid_fleet,
          horse_plate: src.horse_plate,
          horse_fleet: src.horse_fleet,
          trailer_plate: src.trailer_plate,
          trailer_fleet: src.trailer_fleet,
          capacity_kg: src.capacity_kg,
          priority: priority_safe,
          branch_id: src.branch_id || null,
          category,
          length_mm,
        },
      ])
      .select('*')
      .single()
    if (ins.error) throw ins.error

    const planUnitId = ins.data.id

    // ---- optional: assign items immediately ----
    if (assign_items && assign_items.length) {
      // fetch missing weights for items that didn't provide weight_kg
      const needWeightsFor = assign_items
        .filter((x) => x.weight_kg == null)
        .map((x) => x.item_id)
      let weightByItem = new Map()
      if (needWeightsFor.length) {
        const { data: itemRows, error: itemsErr } = await database
          .from('v_unassigned_items')
          .select('item_id, weight_kg')
          .in('item_id', needWeightsFor)
        if (itemsErr) throw itemsErr
        weightByItem = new Map(
          itemRows.map((r) => [r.item_id, Number(r.weight_kg || 0)])
        )
      }

      const rows = assign_items.map((x) => ({
        plan_unit_id: planUnitId,
        item_id: x.item_id,
        assigned_weight_kg: Number(
          x.weight_kg ?? weightByItem.get(x.item_id) ?? 0
        ),
        priority_note: x.note || 'manual',
      }))
      if (rows.length) {
        const insA = await database
          .from('assignment_plan_item_assignments')
          .insert(rows)
        if (insA.error) throw insA.error
      }
      await database
        .rpc('recalc_plan_used_capacity', { p_plan_id: planId })
        .catch(() => {})
    }

    // ---- return updated plan snapshot ----
    const unitsDb = await fetchPlanUnits(planId)
    const assignsDb = await fetchPlanAssignments(planId)
    const bucket = await fetchUnassignedBucket(planId)
    return res.status(200).json(
      new Response(
        200,
        'OK',
        assign_items?.length ? 'Unit added and items assigned' : 'Unit added',
        {
          plan_unit_id: planUnitId,
          ...buildNested(unitsDb, assignsDb, bucket),
        }
      )
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** MANUAL assign a single item to a unit */
export const manuallyAssign = async (req, res) => {
  try {
    const { planId, unitId } = req.params
    const { item_id, weight_kg, note = 'manual' } = req.body || {}
    if (!item_id || !unitId || !planId)
      return res
        .status(400)
        .json(
          new Response(400, 'Bad Request', 'planId, unitId, item_id required')
        )

    const ins = await database.from('assignment_plan_item_assignments').insert([
      {
        plan_unit_id: unitId,
        item_id,
        assigned_weight_kg: toNumber(weight_kg, 0),
        priority_note: note,
      },
    ])
    if (ins.error) throw ins.error

    await recalcUsedCapacity(planId)

    const unitsDb = await fetchPlanUnits(planId)
    const assignsDb = await fetchPlanAssignments(planId)
    const bucket = await fetchUnassignedBucket(planId)
    return res
      .status(200)
      .json(
        new Response(
          200,
          'OK',
          'Item assigned',
          buildNested(unitsDb, assignsDb, bucket)
        )
      )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** UNASSIGN a single assignment */
export const unassign = async (req, res) => {
  try {
    const { planId, assignmentId } = req.params
    const del = await database
      .from('assignment_plan_item_assignments')
      .delete()
      .eq('id', assignmentId)
    if (del.error) throw del.error

    await recalcUsedCapacity(planId)

    const unitsDb = await fetchPlanUnits(planId)
    const assignsDb = await fetchPlanAssignments(planId)
    const bucket = await fetchUnassignedBucket(planId)
    return res
      .status(200)
      .json(
        new Response(
          200,
          'OK',
          'Item unassigned',
          buildNested(unitsDb, assignsDb, bucket)
        )
      )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** UNASSIGN all in a plan */
export const unassignAll = async (req, res) => {
  try {
    const { planId } = req.params
    // Prefer a DB function for performance/locking if available
    const del = await database.rpc('unassign_all_from_plan', {
      p_plan_id: planId,
    })
    if (del.error) throw del.error

    await recalcUsedCapacity(planId)

    const unitsDb = await fetchPlanUnits(planId)
    const assignsDb = await fetchPlanAssignments(planId)
    const bucket = await fetchUnassignedBucket(planId)
    return res
      .status(200)
      .json(
        new Response(
          200,
          'OK',
          'All items unassigned',
          buildNested(unitsDb, assignsDb, bucket)
        )
      )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** FETCH full plan */
export const getFullPlan = async (req, res) => {
  try {
    const { planId } = req.params
    const plan = await fetchPlan(planId)
    const unitsDb = await fetchPlanUnits(planId)
    const assignsDb = await fetchPlanAssignments(planId)
    const bucket = await fetchUnassignedBucket(planId)
    return res.status(200).json(
      new Response(200, 'OK', 'Plan fetched', {
        plan,
        ...buildNested(unitsDb, assignsDb, bucket),
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** FETCH single unit */
export const getPlanById = async (req, res) => {
  try {
    const { planId, unitId } = req.params
    const unitsDb = await fetchPlanUnits(planId)
    const unit = unitsDb.find((u) => String(u.plan_unit_id) === String(unitId))
    if (!unit)
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Unit not found in plan'))
    const assignsDb = await fetchPlanAssignments(planId)
    const bucket = await fetchUnassignedBucket(planId)
    return res.status(200).json(
      new Response(200, 'OK', 'Unit fetched', {
        plan_unit: unit,
        ...buildNested(
          [unit],
          assignsDb.filter((a) => String(a.plan_unit_id) === String(unitId)),
          bucket
        ),
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
