// controllers/assignment-planner-controller.js
// Drop-in controller: no exec_sql; preview/commit parity; stable nested response.

import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

/* ============================== tiny utils ============================== */

function asISOorNull(x) {
  const s = (x ?? '').toString().trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function toNumber(n, fallback = 0) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function groupBy(arr, keyFn) {
  const m = new Map()
  for (const x of arr || []) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

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

function sumWeightsByUnitIdx(placements) {
  const m = new Map()
  for (const p of placements) {
    m.set(p.unitIdx, (m.get(p.unitIdx) || 0) + Number(p.weight || 0))
  }
  return m
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

// Filters out item_ids that are already assigned, then inserts the rest
async function insertAssignmentsSafely(database, rows) {
  if (!rows?.length) return { data: [], error: null }

  const ids = [...new Set(rows.map((r) => r.item_id).filter(Boolean))]

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

// async function insertAssignmentsSafely(database, rows) {
//   if (!rows?.length) return { data: [], error: null }

//   // Only consider rows with a non-null item_id (your unique index is partial on item_id IS NOT NULL)
//   const nonNull = rows.filter((r) => r.item_id != null)
//   const nullItemRows = rows.filter((r) => r.item_id == null) // these never conflict; insert as-is later

//   if (!nonNull.length && !nullItemRows.length) {
//     return { data: [], error: null }
//   }

//   // Query existing assignments for those item_ids
//   const itemIds = [...new Set(nonNull.map((r) => r.item_id))]
//   const { data: existing, error: existErr } = await database
//     .from('assignment_plan_item_assignments')
//     .select('item_id')
//     .in('item_id', itemIds)

//   if (existErr) throw existErr

//   const existingIds = new Set((existing || []).map((r) => r.item_id))
//   const toInsert = [
//     ...nullItemRows, // safe to insert (no constraint on NULL)
//     ...nonNull.filter((r) => !existingIds.has(r.item_id)), // avoid conflicts
//   ]

//   if (!toInsert.length) return { data: [], error: null }

//   return await database
//     .from('assignment_plan_item_assignments')
//     .insert(toInsert)
// }

/* ============================== data access ============================== */

async function fetchUnits(branchId) {
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

// async function fetchItems(cutoffDate, branchId, customerId) {
//   // Uses your existing view; we alias weight_kg as weight_left for consistent shape
//   let q = database
//     .from('v_unassigned_items')
//     .select(
//       `
//       load_id, order_id, item_id,
//       customer_id, customer_name, suburb_name, route_name, route_id,
//       order_date, description,
//       weight_kg,
//       weight_kg as weight_left,
//       branch_id
//     `
//     )
//     .lte('order_date', cutoffDate)
//     .order('order_date', { ascending: true })
//     .order('weight_kg', { ascending: false })
//   if (branchId && branchId !== 'all') q = q.eq('branch_id', branchId)
//   if (customerId && customerId !== 'all') q = q.eq('customer_id', customerId)

//   const { data, error } = await q
//   if (error) throw error
//   return (data || []).map((it) => ({
//     ...it,
//     weight_kg: Number(it.weight_kg || 0),
//     weight_left: Number(it.weight_left || it.weight_kg || 0),
//   }))
// }
// replace your current fetchItems with this
async function fetchItems(cutoffDate, branchId, customerId) {
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
  // console.log('data :>> ', data)
  return data || []
}

async function fetchPlanAssignments(planId) {
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

// async function fetchPlanAssignments(planId) {
//   // 1) units in this plan
//   const { data: unitRows, error: unitErr } = await database
//     .from('assignment_plan_units')
//     .select('id')
//     .eq('plan_id', planId)
//   if (unitErr) throw unitErr
//   const unitIds = (unitRows || []).map((r) => r.id)
//   if (!unitIds.length) return []

//   // 2) assignments
//   const { data: assigns, error: aErr } = await database
//     .from('assignment_plan_item_assignments')
//     .select(
//       'id,plan_unit_id,load_id,order_id,item_id,assigned_weight_kg,priority_note'
//     )
//     .in('plan_unit_id', unitIds)
//     .order('id', { ascending: true })
//   if (aErr) throw aErr
//   if (!assigns?.length) return []

//   // 3) enrich from v_unassigned_items
//   const itemIds = Array.from(
//     new Set(assigns.map((a) => a.item_id).filter(Boolean))
//   )
//   let itemMap = new Map()
//   if (itemIds.length) {
//     const CHUNK = 1000
//     let rows = []
//     for (let i = 0; i < itemIds.length; i += CHUNK) {
//       const slice = itemIds.slice(i, i + CHUNK)
//       const { data: part, error: iErr } = await database
//         .from('v_unassigned_items')
//         .select(
//           'item_id,customer_id,customer_name,suburb_name,route_name,order_date,description'
//         )
//         .in('item_id', slice)
//       if (iErr) throw iErr
//       rows = rows.concat(part || [])
//     }
//     itemMap = new Map(rows.map((r) => [r.item_id, r]))
//   }

//   const merged = assigns.map((a) => {
//     const ui = itemMap.get(a.item_id) || {}
//     return {
//       assignment_id: a.id,
//       plan_unit_id: a.plan_unit_id,
//       load_id: a.load_id,
//       order_id: a.order_id,
//       item_id: a.item_id,
//       assigned_weight_kg: a.assigned_weight_kg,
//       priority_note: a.priority_note,
//       customer_id: ui.customer_id ?? null,
//       customer_name: ui.customer_name ?? null,
//       suburb_name: ui.suburb_name ?? null,
//       route_name: ui.route_name ?? null,
//       order_date: ui.order_date ?? null,
//       description: ui.description ?? null,
//     }
//   })

//   merged.sort((x, y) => {
//     const a = x.order_date || ''
//     const b = y.order_date || ''
//     if (a !== b) return String(a).localeCompare(String(b))
//     return Number(x.assignment_id) - Number(y.assignment_id)
//   })

//   return merged
// }

async function enrichBucketDetails(bucketRows) {
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

async function fetchUnassignedBucket(planId) {
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

// async function fetchUnassignedBucket(planId) {
//   const { data, error } = await database
//     .from('assignment_plan_unassigned_items')
//     .select('*')
//     .eq('plan_id', planId)
//     .order('order_date', { ascending: true })
//   if (error) throw error
//   return data || []
// }

async function recalcUsedCapacity(planId) {
  try {
    await database.rpc('recalc_plan_used_capacity', { p_plan_id: planId })
  } catch (_) {
    // keep flow resilient
  }
}

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

// function buildNested(units, assignments, itemRemainders) {
//   const byUnit = groupBy(units, (u) => u.plan_unit_id)
//   const assignByUnit = groupBy(assignments, (a) => a.plan_unit_id)

//   const outUnits = []

//   // inside buildNested(...)
//   for (const [order_id, orows] of byOrder.entries()) {
//     const items = orows.map((r) => ({
//       item_id: r.item_id,
//       description: r.description,
//       assigned_weight_kg: Number(r.assigned_weight_kg),
//       assignment_id: r.assignment_id,
//       // NEW: include the order id (and order_number if you have it in the SELECT)
//       order_id: r.order_id,
//       order_number: r.order_number ?? null, // keep if your view exposes it; otherwise safe null
//     }))

//     orders.push({
//       order_id,
//       total_assigned_weight_kg: items.reduce(
//         (s, i) => s + i.assigned_weight_kg,
//         0
//       ),
//       items,
//     })
//   }

//   // for (const [unitId, unitRows] of byUnit.entries()) {
//   //   const u = unitRows[0]
//   //   const rows = assignByUnit.get(unitId) || []
//   //   const byCustomer = groupBy(
//   //     rows,
//   //     (r) =>
//   //       `${r.customer_id ?? ''}|${r.customer_name ?? ''}|${
//   //         r.suburb_name ?? ''
//   //       }|${r.route_name ?? ''}`
//   //   )

//   //   const customers = []
//   //   for (const [ckey, crow] of byCustomer.entries()) {
//   //     const [customer_id_raw, customer_name, suburb_name, route_name] =
//   //       ckey.split('|')
//   //     const customer_id = customer_id_raw || null

//   //     const byOrder = groupBy(crow, (r) => r.order_id)
//   //     const orders = []
//   //     for (const [order_id, orows] of byOrder.entries()) {
//   //       const items = orows.map((r) => ({
//   //         item_id: r.item_id,
//   //         description: r.description,
//   //         assigned_weight_kg: Number(r.assigned_weight_kg),
//   //         assignment_id: r.assignment_id,
//   //       }))
//   //       orders.push({
//   //         order_id,
//   //         total_assigned_weight_kg: items.reduce(
//   //           (s, i) => s + i.assigned_weight_kg,
//   //           0
//   //         ),
//   //         items,
//   //       })
//   //     }

//   //     customers.push({
//   //       customer_id,
//   //       customer_name,
//   //       suburb_name,
//   //       route_name,
//   //       orders,
//   //     })
//   //   }

//   //   outUnits.push({
//   //     plan_unit_id: unitId,
//   //     unit_type: u.unit_type,
//   //     driver_id: u.driver_id,
//   //     driver_name: u.driver_name,
//   //     rigid:
//   //       u.unit_type === 'rigid'
//   //         ? {
//   //             id: u.rigid_id,
//   //             plate: u.rigid_plate,
//   //             fleet_number: u.rigid_fleet,
//   //           }
//   //         : null,
//   //     horse:
//   //       u.unit_type === 'horse+trailer'
//   //         ? {
//   //             id: u.horse_id,
//   //             plate: u.horse_plate,
//   //             fleet_number: u.horse_fleet,
//   //           }
//   //         : null,
//   //     trailer:
//   //       u.unit_type === 'horse+trailer'
//   //         ? {
//   //             id: u.trailer_id,
//   //             plate: u.trailer_plate,
//   //             fleet_number: u.trailer_fleet,
//   //           }
//   //         : null,
//   //     capacity_kg: Number(u.capacity_kg),
//   //     used_capacity_kg: Number(u.used_capacity_kg),
//   //     customers,
//   //   })
//   // }

//   const unassigned = (itemRemainders || []).map((r) => ({
//     load_id: r.load_id,
//     order_id: r.order_id,
//     item_id: r.item_id,
//     customer_id: r.customer_id,
//     customer_name: r.customer_name,
//     suburb_name: r.suburb_name,
//     route_name: r.route_name,
//     order_date: r.order_date,
//     weight_left: Number(r.weight_left),
//     description: r.description,
//     reason: r.reason || null,
//   }))

//   return { assigned_units: outUnits, unassigned }
// }

/* ============================== PACKER (FFD + customer 2-unit cap) ============================== */

function packItemsIntoUnits(
  items,
  rawUnits,
  {
    capacityHeadroom = 0.1,
    lengthBufferMm = 600,
    maxTrucksPerZone = 2, // reserved for future soft-caps
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

/* ============================== endpoints ============================== */

/** List plans (with optional enrichments) */
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
    const wantBranch = String(include_branch_name).toLowerCase() === 'true'

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

    const start = Number(offset) || 0
    const end = start + (Number(limit) || 50) - 1
    q = q.range(start, Math.max(start, end))

    const { data: plans, error, count } = await q
    if (error) throw error
    const out = plans || []

    // optional enrichments
    let branchNameById = new Map()
    if (wantBranch) {
      try {
        const { data: rows } = await database.from('branches').select('id,name')
        if (rows?.length)
          branchNameById = new Map(rows.map((b) => [String(b.id), b.name]))
      } catch {}
    }

    let unitsByPlan = new Map()
    let countsByPlan = new Map()

    if (wantUnits || wantCounts) {
      const planIds = out.map((p) => p.id)
      if (planIds.length) {
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
          const unitsCount = new Map()
          for (const r of pu || []) {
            unitsCount.set(r.plan_id, (unitsCount.get(r.plan_id) || 0) + 1)
          }
          const puIds = (pu || []).map((r) => r.id)
          let assignsCount = new Map()
          if (puIds.length) {
            const { data: asn, error: asnErr } = await database
              .from('assignment_plan_item_assignments')
              .select('plan_unit_id')
              .in('plan_unit_id', puIds)
            if (asnErr) throw asnErr
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

    const augmented = out.map((p) => ({
      ...p,
      ...(wantBranch
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
        total: typeof count === 'number' ? count : augmented.length,
        limit: Number(limit),
        offset: Number(offset),
        plans: augmented,
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** DELETE a whole plan (cascade child rows) */
export const deletePlan = async (req, res) => {
  try {
    const { planId } = req.params
    if (!planId) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'planId required'))
    }
    const { data: exists, error: getErr } = await database
      .from('assignment_plans')
      .select('id')
      .eq('id', planId)
      .single()
    if (getErr?.code === 'PGRST116') {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Plan not found'))
    } else if (getErr) throw getErr

    const { error: delErr } = await database
      .from('assignment_plans')
      .delete()
      .eq('id', planId)
    if (delErr) throw delErr
    return res
      .status(200)
      .json(new Response(200, 'OK', 'Plan deleted', { plan_id: planId }))
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** AUTO (preview or commit) */
export const autoAssignLoads = async (req, res) => {
  try {
    const {
      departure_date,
      cutoff_date,
      branch_id,
      customer_id = null,
      commit = false,
      notes = null,
      // knobs
      capacityHeadroom = 0.1,
      lengthBufferMm = 600,
      maxTrucksPerZone = 2,
      ignoreLengthIfMissing = true,
      ignoreDepartment = true,
      customerUnitCap = 2,
      routeAffinitySlop = 0.25,
    } = req.body || {}

    const { today, tomorrow } = todayTomorrow()
    const dep = asISOorNull(departure_date) || tomorrow
    const cut = asISOorNull(cutoff_date) || today
    const branch = branch_id ?? req.body?.scope_branch_id ?? null
    const customer = customer_id && customer_id !== 'all' ? customer_id : null

    // data
    const units = await fetchUnits(branch)
    const itemsRaw = await fetchItems(cut, branch, customer)

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
      routeAffinitySlop,
    })

    // idle units by branch (those not used in placements)
    let branchNameById = new Map()
    try {
      const { data: branchRows } = await database
        .from('branches')
        .select('id,name')
      if (branchRows?.length)
        branchNameById = new Map(branchRows.map((b) => [String(b.id), b.name]))
    } catch {}
    let usedIdxSet = new Set(placements.map((p) => p.unitIdx))

    const idleUnits = shapedUnits
      .map((u, idx) => ({ u, idx }))
      .filter(({ idx }) => !usedIdxSet.has(idx))
      .map(({ u, idx }) => ({
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

    if (!commit) {
      // preview — derive used list solely from placements with non-zero weights
      const weightByIdx = sumWeightsByUnitIdx(placements)
      const used = Array.from(weightByIdx.keys())

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
          used_capacity_kg: Number(usedKg.toFixed(3)),
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
            scope_branch_id: branch || null,
            scope_customer_id: customer || null,
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
          idle_units_by_branch,
        })
      )
    }
    // commit
    const planIns = await database
      .from('assignment_plans')
      .insert([
        {
          departure_date: dep,
          cutoff_date: cut,
          scope_branch_id: branch || null,
          scope_customer_id: customer || null,
          notes,
        },
      ])
      .select('*')
      .single()
    if (planIns.error) throw planIns.error
    const plan = planIns.data

    // 1) Build raw rows from placements (include unitIdx so we can decide which units to create)
    const rawRows = placements.map((p) => ({
      unitIdx: p.unitIdx,
      load_id: p.item.load_id,
      order_id: p.item.order_id,
      item_id: p.item.item_id,
      assigned_weight_kg: Number(p.weight || 0),
      priority_note: 'auto',
    }))

    // 2) Filter out duplicates BEFORE creating units
    const uniqueIds = [
      ...new Set(rawRows.map((r) => r.item_id).filter(Boolean)),
    ]
    const { data: existing, error: existErr } = await database
      .from('assignment_plan_item_assignments')
      .select('item_id')
      .in('item_id', uniqueIds)
    if (existErr) throw existErr

    const existingIds = new Set((existing || []).map((r) => r.item_id))
    const rowsToInsert = rawRows.filter(
      (r) =>
        r.item_id && !existingIds.has(r.item_id) && r.assigned_weight_kg > 0
    )

    // 3) If nothing remains, short-circuit (no empty units)
    if (!rowsToInsert.length) {
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

      return res.status(200).json(
        new Response(
          200,
          'OK',
          'Nothing to assign (duplicates or zero weight). Plan created without units.',
          {
            plan,
            assigned_units: [],
            unassigned: bucket,
            idle_units_by_branch,
          }
        )
      )
    }

    // 4) Create plan units ONLY for indices referenced by rowsToInsert
    usedIdxSet = new Set(rowsToInsert.map((r) => r.unitIdx))
    const planUnitIdByIdx = new Map()

    for (const idx of usedIdxSet) {
      const u = shapedUnits[idx]
      if (!u) continue
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

    // 5) Insert ONLY the filtered assignment rows
    const toInsert = rowsToInsert
      .filter((r) => planUnitIdByIdx.has(r.unitIdx))
      .map((r) => ({
        plan_unit_id: planUnitIdByIdx.get(r.unitIdx),
        load_id: r.load_id,
        order_id: r.order_id,
        item_id: r.item_id,
        assigned_weight_kg: r.assigned_weight_kg,
        priority_note: r.priority_note,
      }))

    if (toInsert.length) {
      const insA = await database
        .from('assignment_plan_item_assignments')
        .insert(toInsert)
      if (insA.error) throw insA.error
    }

    // // commit
    // const planIns = await database
    //   .from('assignment_plans')
    //   .insert([
    //     {
    //       departure_date: dep,
    //       cutoff_date: cut,
    //       scope_branch_id: branch || null,
    //       scope_customer_id: customer || null,
    //       notes,
    //     },
    //   ])
    //   .select('*')
    //   .single()
    // if (planIns.error) throw planIns.error
    // const plan = planIns.data

    // // only create plan_units for indices that truly got items (non-zero)
    // const weightByIdx = sumWeightsByUnitIdx(placements)
    // const EPS = 1e-3
    // const usedIdx = Array.from(weightByIdx.entries())
    //   .filter(([, w]) => w > EPS)
    //   .map(([idx]) => idx)

    // const planUnitIdByIdx = new Map()
    // for (const idx of usedIdx) {
    //   const u = shapedUnits[idx]
    //   const ins = await database
    //     .from('assignment_plan_units')
    //     .insert([
    //       {
    //         plan_id: plan.id,
    //         unit_type: u.unit_type,
    //         rigid_id: u.rigid_id,
    //         trailer_id: u.trailer_id,
    //         horse_id: u.horse_id,
    //         driver_id: u.driver_id,
    //         driver_name: u.driver_name,
    //         rigid_plate: u.rigid_plate,
    //         rigid_fleet: u.rigid_fleet,
    //         horse_plate: u.horse_plate,
    //         horse_fleet: u.horse_fleet,
    //         trailer_plate: u.trailer_plate,
    //         trailer_fleet: u.trailer_fleet,
    //         capacity_kg: u.capacity_kg,
    //         priority: u.priority || 0,
    //         branch_id: u.branch_id || null,
    //         category: u.category || '',
    //         length_mm: u.length_mm || 0,
    //       },
    //     ])
    //     .select('*')
    //     .single()
    //   if (ins.error) throw ins.error
    //   planUnitIdByIdx.set(idx, ins.data.id)
    // }

    // if (placements.length) {
    //   const rows = placements
    //     .filter((p) => planUnitIdByIdx.has(p.unitIdx))
    //     .map((p) => ({
    //       plan_unit_id: planUnitIdByIdx.get(p.unitIdx),
    //       load_id: p.item.load_id,
    //       order_id: p.item.order_id,
    //       item_id: p.item.item_id,
    //       assigned_weight_kg: p.weight, // must be > 0 (DB check)
    //       priority_note: 'auto',
    //     }))
    //   if (rows.length) {
    //     const insA = await insertAssignmentsSafely(database, rows)
    //     if (insA.error) throw insA.error
    //     // const insA = await database
    //     //   .from('assignment_plan_item_assignments')
    //     //   .upsert(rows, {
    //     //     onConflict: 'item_id', // conflict target
    //     //     ignoreDuplicates: true, // DO NOTHING
    //     //   })
    //     //   .select() // optional: return inserted rows
    //     // if (insA.error) throw insA.error
    //   }
    //   //   const insA = await database
    //   //     .from('assignment_plan_item_assignments')
    //   //     .insert(rows, { upsert: false })
    //   //     .onConflict('item_id')
    //   //     .ignore()
    //   //   if (insA.error) throw insA.error
    //   // }
    // }

    // if (unplaced.length) {
    //   const rows = unplaced.map((u) => ({
    //     plan_id: plan.id,
    //     load_id: u.load_id,
    //     order_id: u.order_id,
    //     item_id: u.item_id,
    //     weight_left: u.weight_left,
    //     reason: u.reason || null,
    //   }))
    //   const insB = await database
    //     .from('assignment_plan_unassigned_items')
    //     .insert(rows)
    //   if (insB.error) throw insB.error
    // }

    await recalcUsedCapacity(plan.id)

    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(plan.id),
      fetchPlanAssignments(plan.id),
      fetchUnassignedBucket(plan.id),
    ])

    return res.status(200).json(
      new Response(200, 'OK', 'Auto-assignment committed', {
        plan,
        ...buildNested(unitsDb, assignsDb, bucket),
        idle_units_by_branch,
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** Add an idle vehicle to an existing plan (optionally assign items immediately) */
export const addIdleUnit = async (req, res) => {
  try {
    const { planId } = req.params
    const {
      unit_key, // e.g. "rigid:123" or "horse:45|trailer:78"
      unit_type, // 'rigid' | 'horse+trailer'
      rigid_id = null,
      horse_id = null,
      trailer_id = null,
      assign_items = [], // [{ item_id, weight_kg?, note? }]
    } = req.body || {}

    // derive IDs from unit_key if provided
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

    if (!planId)
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'planId required'))
    if (utype !== 'rigid' && utype !== 'horse+trailer')
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'unit_type must be "rigid" or "horse+trailer"'
          )
        )
    if (utype === 'rigid' && !rid)
      return res
        .status(400)
        .json(
          new Response(400, 'Bad Request', 'rigid_id required for rigid unit')
        )
    if (utype === 'horse+trailer' && (!hid || !tid))
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'horse_id and trailer_id required for horse+trailer'
          )
        )

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

    // prevent duplicate on the plan
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

    // Insert plan unit with hydrated basics
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
          priority: src.priority || 0,
          branch_id: src.branch_id || null,
          category: src.category || '',
          length_mm: src.length_mm || 0,
        },
      ])
      .select('*')
      .single()
    if (ins.error) throw ins.error

    const planUnitId = ins.data.id

    // optional immediate assigns
    if (assign_items && assign_items.length) {
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
        const insA = await insertAssignmentsSafely(database, rows)
        if (insA.error) throw insA.error
        // const insA = await database
        //   .from('assignment_plan_item_assignments')
        //   .insert(rows)
        // if (insA.error) throw insA.error
      }
      await recalcUsedCapacity(planId)
    }

    // return updated snapshot
    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(planId),
      fetchPlanAssignments(planId),
      fetchUnassignedBucket(planId),
    ])
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
    if (!item_id || !unitId || !planId) {
      return res
        .status(400)
        .json(
          new Response(400, 'Bad Request', 'planId, unitId, item_id required')
        )
    }

    const { error } = await insertAssignmentsSafely(database, [
      {
        plan_unit_id: unitId,
        item_id,
        assigned_weight_kg: toNumber(weight_kg, 0),
        priority_note: note,
      },
    ])
    if (error) throw error

    // const ins = await database.from('assignment_plan_item_assignments').insert([
    //   {
    //     plan_unit_id: unitId,
    //     item_id,
    //     assigned_weight_kg: toNumber(weight_kg, 0), // DB check enforces > 0
    //     priority_note: note,
    //   },
    // ])
    // if (ins.error) throw ins.error

    await recalcUsedCapacity(planId)

    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(planId),
      fetchPlanAssignments(planId),
      fetchUnassignedBucket(planId),
    ])
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

    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(planId),
      fetchPlanAssignments(planId),
      fetchUnassignedBucket(planId),
    ])
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

/** UNASSIGN all items in a plan */
export const unassignAll = async (req, res) => {
  try {
    const { planId } = req.params
    const del = await database.rpc('unassign_all_from_plan', {
      p_plan_id: planId,
    })
    if (del.error) throw del.error

    await recalcUsedCapacity(planId)

    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(planId),
      fetchPlanAssignments(planId),
      fetchUnassignedBucket(planId),
    ])
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

/** FETCH full plan (parity with auto-assign response) */
export const getFullPlan = async (req, res) => {
  try {
    const { planId } = req.params
    // console.log('planId :>> ', planId)
    await recalcUsedCapacity(planId)

    const plan = await fetchPlan(planId)
    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(planId),
      fetchPlanAssignments(planId),
      fetchUnassignedBucket(planId),
    ])

    // safety net: recompute used if 0
    const usedByUnit = new Map()
    for (const a of assignsDb) {
      usedByUnit.set(
        a.plan_unit_id,
        (usedByUnit.get(a.plan_unit_id) || 0) +
          Number(a.assigned_weight_kg || 0)
      )
    }
    for (const u of unitsDb) {
      if (!u.used_capacity_kg || Number(u.used_capacity_kg) === 0) {
        u.used_capacity_kg = usedByUnit.get(u.plan_unit_id) || 0
      }
    }

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

/** FETCH per-vehicle snapshot (same nested shape but for a single unit) */
/** FETCH per-vehicle */
export const getPlanById = async (req, res) => {
  try {
    const { planId, unitId } = req.params

    // Ensure the aggregate column is up-to-date (cheap safeguard).
    // If you prefer not to touch DB here, you can remove this line.
    try {
      await recalcUsedCapacity(planId)
    } catch (_) {}

    const unitsDb = await fetchPlanUnits(planId)
    const unit = unitsDb.find((u) => String(u.plan_unit_id) === String(unitId))
    if (!unit) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Unit not found'))
    }

    // Get all assignments and isolate those for this unit
    const all = await fetchPlanAssignments(planId)
    const mine = all.filter((a) => String(a.plan_unit_id) === String(unitId))

    // Fallback compute used capacity if the view says 0/null
    const computedUsed =
      mine.reduce((s, r) => s + Number(r.assigned_weight_kg || 0), 0) || 0

    const patchedUnit = {
      ...unit,
      used_capacity_kg:
        Number(unit.used_capacity_kg || 0) > 0
          ? Number(unit.used_capacity_kg)
          : Number(computedUsed.toFixed(3)),
    }

    const bucket = await fetchUnassignedBucket(planId)

    return res
      .status(200)
      .json(
        new Response(
          200,
          'OK',
          'Unit fetched',
          buildNested([patchedUnit], mine, bucket)
        )
      )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

// export const getPlanById = async (req, res) => {
//   try {
//     const { planId, unitId } = req.params
//     const unitsDb = await fetchPlanUnits(planId)
//     const unit = unitsDb.find((u) => String(u.plan_unit_id) === String(unitId))
//     if (!unit) {
//       return res
//         .status(404)
//         .json(new Response(404, 'Not Found', 'Unit not found'))
//     }
//     const all = await fetchPlanAssignments(planId)
//     const mine = all.filter((a) => String(a.plan_unit_id) === String(unitId))
//     const bucket = await fetchUnassignedBucket(planId)

//     return res
//       .status(200)
//       .json(
//         new Response(
//           200,
//           'OK',
//           'Unit fetched',
//           buildNested([unit], mine, bucket)
//         )
//       )
//   } catch (err) {
//     return res.status(500).json(new Response(500, 'Server Error', err.message))
//   }
// }
