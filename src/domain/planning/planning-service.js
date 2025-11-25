import database from '../../config/supabase.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'
import {
  asBool,
  toInt,
  toNumber,
  parseCapacityKg,
} from '../../utils/assignment-utils.js'

/**
 * Planning Service - Encapsulates all planning-related business logic
 */

/**
 * Helper function to parse capacity from various formats
 */
// function parseCapacityKg(raw) {
//   if (raw == null) return 0
//   if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0

//   const s = String(raw).trim().toLowerCase()
//   if (!s) return 0

//   // grab first numeric piece
//   const match = s.match(/([\d.,]+)/)
//   if (!match) return 0

//   const numStr = match[1].replace(/,/g, '')
//   const n = Number(numStr)
//   if (!Number.isFinite(n)) return 0

//   // simple unit handling
//   if (s.includes('ton') || s.includes(' t')) return n * 1000
//   if (s.includes('kg')) return n

//   // default: assume kg
//   return n
// }

export async function listPlans(filters = {}) {
  const {
    limit = 50,
    offset = 0,
    order = 'desc',
    date_from,
    date_to,
    include_units,
    include_counts,
    include_unassigned,
  } = filters

  const limitNum = toInt(limit, 50)
  const offsetNum = toInt(offset, 0)
  const ascending = String(order).toLowerCase() === 'asc'

  const wantUnits = asBool(include_units, false)
  const wantCounts = asBool(include_counts, false)
  const wantUnassigned = asBool(include_unassigned, false)

  let q = database
    .from('plans')
    .select(
      'id, plan_name, delivery_start, delivery_end, scope_all_branches, status, notes, created_at, updated_at',
      { count: 'exact' }
    )

  if (date_from) {
    q = q.gte('delivery_start', date_from)
  }
  if (date_to) {
    q = q.lte('delivery_end', date_to)
  }

  q = q
    .order('delivery_start', { ascending })
    .order('created_at', { ascending })
    .range(offsetNum, offsetNum + limitNum - 1)

  const { data: plans, count, error } = await q
  if (error) throw error

  const planList = plans || []
  if (!planList.length) {
    return {
      total: 0,
      limit: limitNum,
      offset: offsetNum,
      plans: [],
    }
  }

  const augmented = await Promise.all(
    planList.map(async (p) => {
      const base = { ...p }

      if (wantUnits || wantCounts || wantUnassigned) {
        const payload = await buildPlanPayload(p.id)

        if (wantUnits) {
          base.plan_unit_ids = payload.units.map((u) => u.planned_unit_id)
        }

        if (wantCounts) {
          base.summary = {
            units_count: payload.units.length,
            orders_count: payload.assigned_orders.length,
            total_weight: payload.units.reduce(
              (sum, u) => sum + (u.summary?.total_weight || 0),
              0
            ),
          }
        }

        if (wantUnassigned) {
          base.unassigned_count = payload.unassigned_orders.length
        }
      }

      return base
    })
  )

  return {
    total: typeof count === 'number' ? count : augmented.length,
    limit: limitNum,
    offset: offsetNum,
    plans: augmented,
  }
}

export async function getPlanById(planId) {
  return await buildPlanPayload(planId)
}

export async function createPlan(payload) {
  const {
    plan_name,
    delivery_start,
    delivery_end,
    scope_all_branches,
    notes = null,
    status,
  } = payload

  if (!plan_name || !delivery_start) {
    const error = new Error('plan_name and delivery_start are required')
    error.statusCode = 400
    throw error
  }

  const startDate = delivery_start
  const endDate = delivery_end || delivery_start
  const scopeAllBranches = asBool(scope_all_branches, true)
  const planStatus = status || 'planning'

  if (startDate > endDate) {
    const error = new Error('delivery_start cannot be after delivery_end')
    error.statusCode = 400
    throw error
  }

  const { data: inserted, error: insErr } = await database
    .from('plans')
    .insert([
      {
        plan_name,
        delivery_start: startDate,
        delivery_end: endDate,
        scope_all_branches: scopeAllBranches,
        notes,
        status: planStatus,
      },
    ])
    .select('*')
    .single()

  if (insErr) throw insErr

  return await buildPlanPayload(inserted.id)
}

export async function addIdleUnitToPlan({
  planId,
  vehicle_assignment_id,
  status = 'active',
  notes = null,
}) {
  if (!planId || !vehicle_assignment_id) {
    const error = new Error('planId and vehicle_assignment_id are required')
    error.statusCode = 400
    throw error
  }

  // Check plan exists
  const { data: plans, error: planErr } = await database
    .from('plans')
    .select('id, plan_name, delivery_start, delivery_end')
    .eq('id', planId)
    .limit(1)

  if (planErr) throw planErr
  const plan = plans && plans[0]
  if (!plan) {
    const error = new Error('Plan not found')
    error.statusCode = 404
    throw error
  }

  // Check vehicle_assignment exists
  const { data: vas, error: vaErr } = await database
    .from('vehicle_assignments')
    .select('id, status')
    .eq('id', vehicle_assignment_id)
    .limit(1)

  if (vaErr) throw vaErr
  const va = vas && vas[0]
  if (!va) {
    const error = new Error('Vehicle assignment not found')
    error.statusCode = 404
    throw error
  }

  // Prevent duplicate unit
  const { data: existingUnits, error: existErr } = await database
    .from('planned_units')
    .select('id')
    .eq('plan_id', planId)
    .eq('vehicle_assignment_id', vehicle_assignment_id)
    .limit(1)

  if (existErr) throw existErr
  if (existingUnits && existingUnits[0]) {
    return await buildPlanPayload(planId)
  }

  // Insert planned_unit
  const { data: inserted, error: insErr } = await database
    .from('planned_units')
    .insert([
      {
        plan_id: planId,
        vehicle_assignment_id,
        status,
        notes,
      },
    ])
    .select('*')
    .single()

  if (insErr) throw insErr

  return await buildPlanPayload(planId)
}

export async function bulkAssignOrders({ planId, assignments }) {
  if (!planId) {
    const error = new Error('planId is required')
    error.statusCode = 400
    throw error
  }

  if (!Array.isArray(assignments) || !assignments.length) {
    const error = new Error('assignments must be a non-empty array')
    error.statusCode = 400
    throw error
  }

  // Validate plan
  const { data: plans, error: planErr } = await database
    .from('plans')
    .select('id, delivery_start, delivery_end')
    .eq('id', planId)
    .limit(1)

  if (planErr) throw planErr
  const plan = plans && plans[0]

  if (!plan) {
    const error = new Error('Plan not found')
    error.statusCode = 404
    throw error
  }

  // Validate planned units belong to plan
  const requestedUnitIds = [
    ...new Set(assignments.map((a) => a.planned_unit_id).filter((id) => !!id)),
  ]

  if (!requestedUnitIds.length) {
    const error = new Error('Each assignment must have a planned_unit_id')
    error.statusCode = 400
    throw error
  }

  const { data: units, error: unitsErr } = await database
    .from('planned_units')
    .select('id, plan_id')
    .in('id', requestedUnitIds)

  if (unitsErr) throw unitsErr

  const validUnitIds = new Set(
    (units || []).filter((u) => u.plan_id === planId).map((u) => u.id)
  )

  for (const id of requestedUnitIds) {
    if (!validUnitIds.has(id)) {
      const error = new Error(
        `planned_unit_id ${id} does not belong to plan ${planId}`
      )
      error.statusCode = 400
      throw error
    }
  }

  // Flatten assignments
  const pairs = []
  const allOrderIds = new Set()

  for (const a of assignments) {
    if (!a || !a.planned_unit_id || !Array.isArray(a.orders)) continue

    for (const o of a.orders) {
      if (!o || !o.order_id) continue

      const stop_sequence =
        typeof o.stop_sequence === 'number' ? o.stop_sequence : null

      pairs.push({
        planned_unit_id: a.planned_unit_id,
        order_id: o.order_id,
        stop_sequence,
      })
      allOrderIds.add(o.order_id)
    }
  }

  if (!pairs.length) {
    const error = new Error(
      'No valid (planned_unit_id, order_id) pairs found in assignments'
    )
    error.statusCode = 400
    throw error
  }

  const orderIdArray = Array.from(allOrderIds)

  // Fetch candidate orders and enforce constraints
  const { data: orders, error: ordersErr } = await database
    .from('loads')
    .select(
      'id, sales_order_number, delivery_date, assignment_plan_id, assigned_unit_id, customer_id'
    )
    .in('id', orderIdArray)

  if (ordersErr) throw ordersErr

  const byId = new Map()

  for (const o of orders || []) {
    // Block orders that are locked to another plan
    if (o.assignment_plan_id && o.assignment_plan_id !== planId) {
      continue
    }

    // Enforce plan delivery window
    if (
      o.delivery_date < plan.delivery_start ||
      o.delivery_date > plan.delivery_end
    ) {
      continue
    }

    byId.set(o.id, o)
  }

  // Filter pairs to actual candidates
  const effectiveAssignments = pairs.filter((p) => byId.has(p.order_id))

  if (!effectiveAssignments.length) {
    return await buildPlanPayload(planId)
  }

  // Group by planned_unit_id and apply updates
  const ordersByUnit = new Map()
  for (const p of effectiveAssignments) {
    if (!ordersByUnit.has(p.planned_unit_id)) {
      ordersByUnit.set(p.planned_unit_id, [])
    }
    ordersByUnit.get(p.planned_unit_id).push(p)
  }

  for (const [unitId, list] of ordersByUnit.entries()) {
    if (!list.length) continue

    list.sort((a, b) => {
      const sa = a.stop_sequence ?? 0
      const sb = b.stop_sequence ?? 0
      return sa - sb
    })

    for (const { order_id, stop_sequence } of list) {
      // Header-level update (loads)
      const { error: updLoadsErr } = await database
        .from('loads')
        .update({
          assignment_plan_id: planId,
          assigned_unit_id: unitId,
          is_split: false,
          stop_sequence,
        })
        .eq('id', order_id)

      if (updLoadsErr) throw updLoadsErr

      // Line-level mirror (load_items)
      const { error: updItemsErr } = await database
        .from('load_items')
        .update({
          assignment_plan_id: planId,
          assigned_unit_id: unitId,
          stop_sequence,
        })
        .eq('order_id', order_id)

      if (updItemsErr) throw updItemsErr
    }
  }

  return await buildPlanPayload(planId)
}

export async function unassignOrders({ planId, plannedUnitId, orderIds }) {
  if (!planId || !plannedUnitId) {
    const error = new Error('planId and plannedUnitId are required')
    error.statusCode = 400
    throw error
  }

  // Validate planned_unit belongs to plan
  const { data: units, error: unitsErr } = await database
    .from('planned_units')
    .select('id, plan_id')
    .eq('id', plannedUnitId)
    .limit(1)

  if (unitsErr) throw unitsErr
  const unit = units && units[0]
  if (!unit || unit.plan_id !== planId) {
    const error = new Error(
      'plannedUnitId does not belong to the specified plan'
    )
    error.statusCode = 400
    throw error
  }

  // Determine which orders to unassign
  const baseQuery = database
    .from('loads')
    .select('id')
    .eq('assignment_plan_id', planId)
    .eq('assigned_unit_id', plannedUnitId)

  let loadsQuery = baseQuery
  if (Array.isArray(orderIds) && orderIds.length) {
    loadsQuery = loadsQuery.in('id', orderIds)
  }

  const { data: loadsToUnassign, error: loadsErr } = await loadsQuery
  if (loadsErr) throw loadsErr

  const ids = (loadsToUnassign || []).map((l) => l.id)
  if (!ids.length) {
    return await buildPlanPayload(planId)
  }

  // Clear assignments on load_items first
  const { error: updItemsErr } = await database
    .from('load_items')
    .update({
      assignment_plan_id: null,
      assigned_unit_id: null,
    })
    .in('order_id', ids)

  if (updItemsErr) throw updItemsErr

  // Clear assignments on loads
  const { error: updLoadsErr } = await database
    .from('loads')
    .update({
      assignment_plan_id: null,
      assigned_unit_id: null,
      is_split: false,
    })
    .in('id', ids)

  if (updLoadsErr) throw updLoadsErr

  return await buildPlanPayload(planId)
}

export async function setPlannedUnitNote({ planId, plannedUnitId, note }) {
  if (!planId || !plannedUnitId) {
    const error = new Error('planId and plannedUnitId are required')
    error.statusCode = 400
    throw error
  }

  // Validate planned_unit belongs to plan
  const { data: units, error: unitsErr } = await database
    .from('planned_units')
    .select('id, plan_id')
    .eq('id', plannedUnitId)
    .limit(1)

  if (unitsErr) throw unitsErr
  const unit = units && units[0]
  if (!unit || unit.plan_id !== planId) {
    const error = new Error(
      'plannedUnitId does not belong to the specified plan'
    )
    error.statusCode = 400
    throw error
  }

  // Update note
  const { error: updateErr } = await database
    .from('planned_units')
    .update({ notes: note })
    .eq('id', plannedUnitId)

  if (updateErr) throw updateErr

  return await buildPlanPayload(planId)
}

export async function removePlannedUnit({ planId, plannedUnitId }) {
  if (!planId || !plannedUnitId) {
    const error = new Error('planId and plannedUnitId are required')
    error.statusCode = 400
    throw error
  }

  // Validate planned_unit belongs to plan
  const { data: units, error: unitsErr } = await database
    .from('planned_units')
    .select('id, plan_id')
    .eq('id', plannedUnitId)
    .limit(1)

  if (unitsErr) throw unitsErr
  const unit = units && units[0]
  if (!unit || unit.plan_id !== planId) {
    const error = new Error(
      'plannedUnitId does not belong to the specified plan'
    )
    error.statusCode = 400
    throw error
  }

  // First unassign all orders from this unit
  await unassignOrders({ planId, plannedUnitId, orderIds: null })

  // Remove the planned unit
  const { error: deleteErr } = await database
    .from('planned_units')
    .delete()
    .eq('id', plannedUnitId)

  if (deleteErr) throw deleteErr

  return await buildPlanPayload(planId)
}

export async function deletePlan(planId) {
  if (!planId) {
    const error = new Error('planId is required')
    error.statusCode = 400
    throw error
  }

  // Check plan exists
  const { data: plans, error: planErr } = await database
    .from('plans')
    .select('id')
    .eq('id', planId)
    .limit(1)

  if (planErr) throw planErr
  if (!plans || !plans[0]) {
    const error = new Error('Plan not found')
    error.statusCode = 404
    throw error
  }

  // First unassign all orders in this plan
  const { error: unassignErr } = await database
    .from('loads')
    .update({
      assignment_plan_id: null,
      assigned_unit_id: null,
      is_split: false,
    })
    .eq('assignment_plan_id', planId)

  if (unassignErr) throw unassignErr

  const { error: unassignItemsErr } = await database
    .from('load_items')
    .update({
      assignment_plan_id: null,
      assigned_unit_id: null,
    })
    .eq('assignment_plan_id', planId)

  if (unassignItemsErr) throw unassignItemsErr

  // Delete planned units
  const { error: deleteUnitsErr } = await database
    .from('planned_units')
    .delete()
    .eq('plan_id', planId)

  if (deleteUnitsErr) throw deleteUnitsErr

  // Delete the plan
  const { error: deletePlanErr } = await database
    .from('plans')
    .delete()
    .eq('id', planId)

  if (deletePlanErr) throw deletePlanErr

  return { success: true }
}

function shapeOrderRow(row) {
  return {
    order_id: row.order_id || row.id,
    sales_order_id: row.sales_order_id,
    sales_order_number: row.sales_order_number,
    delivery_date: row.delivery_date,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    route_id: row.route_id,
    route_name: row.route_name,
    suburb_route_id: row.suburb_route_id,
    suburb_name: row.suburb_name,
    suburb_city: row.suburb_city,
    suburb_province: row.suburb_province,
    suburb_postal_code: row.suburb_postal_code,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_bp_code: row.customer_bp_code,
    total_line_items: row.total_line_items,
    total_quantity: row.total_quantity,
    total_weight: row.total_weight,
    status: row.status,
    sales_person_name: row.sales_person_name,
    address: row.address,
    assignment_plan_id: row.assignment_plan_id,
    assigned_unit_id: row.assigned_unit_id,
    is_split: row.is_split,
  }
}

export async function autoAssignPlan(options) {
  const {
    planId,
    plan_id,
    branchId,
    branch_id,
    commit = true,
    maxUnitsPerCustomerPerDay = 2,
    max_units_per_customer_per_day = 2,
  } = options

  const actualPlanId = planId || plan_id
  const actualBranchId = branchId || branch_id
  const actualCommit = asBool(commit, true)
  const actualMaxUnits = toInt(
    maxUnitsPerCustomerPerDay || max_units_per_customer_per_day,
    2
  )

  if (!actualPlanId) {
    const error = new Error('planId is required')
    error.statusCode = 400
    throw error
  }

  // 1. Fetch and validate plan exists
  const { data: plans, error: planErr } = await database
    .from('plans')
    .select(
      'id, plan_name, delivery_start, delivery_end, scope_all_branches, status'
    )
    .eq('id', actualPlanId)
    .limit(1)

  if (planErr) throw planErr
  const plan = plans && plans[0]
  if (!plan) {
    const error = new Error('Plan not found')
    error.statusCode = 404
    throw error
  }

  // 2. Get unassigned orders for this plan
  let unassignedQuery = database
    .from('v_unassigned_orders')
    .select('*')
    .eq('plan_id', actualPlanId)

  const { data: unassignedOrders, error: unassignedErr } = await unassignedQuery
  if (unassignedErr) throw unassignedErr

  // Shape and filter orders
  let candidateOrders = (unassignedOrders || []).map(shapeOrderRow)

  // Apply branch filter if provided
  if (actualBranchId && actualBranchId !== 'all') {
    candidateOrders = candidateOrders.filter(
      (o) => o.branch_id === actualBranchId
    )
  }

  // Early return if no candidate orders
  if (!candidateOrders.length) {
    return {
      plan,
      units: [],
      assigned_orders: [],
      unassigned_orders: [],
      unassigned_units: [],
      meta: {
        committed: actualCommit,
        assignments_created: 0,
        max_units_per_customer_per_day: actualMaxUnits,
      },
    }
  }

  // 3. Get already-assigned loads for this plan
  const { data: assignedLoads, error: assignedErr } = await database
    .from('loads')
    .select('*')
    .eq('assignment_plan_id', actualPlanId)
    .not('assigned_unit_id', 'is', null)

  if (assignedErr) throw assignedErr
  const shapedAssignedLoads = (assignedLoads || []).map(shapeOrderRow)

  // 4. Get planned units for this plan
  const { data: plannedUnits, error: unitsErr } = await database
    .from('planned_units')
    .select('*')
    .eq('plan_id', actualPlanId)
    .or('status.is.null,status.eq.active')

  if (unitsErr) throw unitsErr

  // 5. Collect branch IDs from candidate orders
  const branchIds = new Set()
  for (const order of candidateOrders) {
    if (order.branch_id) branchIds.add(order.branch_id)
  }

  // 6. Get vehicle assignments for relevant branches
  let vaQuery = database
    .from('vehicle_assignments')
    .select('*')
    .eq('status', 'active')

  if (branchIds.size > 0) {
    vaQuery = vaQuery.in('branch_id', Array.from(branchIds))
  }

  const { data: vehicleAssignments, error: vaErr } = await vaQuery
  if (vaErr) throw vaErr

  // Build maps
  const vaById = new Map()
  const availableAssignmentsByBranch = new Map()
  const vehicleIds = new Set()
  const driverIds = new Set()

  for (const va of vehicleAssignments || []) {
    vaById.set(va.id, va)

    if (!availableAssignmentsByBranch.has(va.branch_id)) {
      availableAssignmentsByBranch.set(va.branch_id, [])
    }
    availableAssignmentsByBranch.get(va.branch_id).push(va)

    if (va.vehicle_id) vehicleIds.add(va.vehicle_id)
    if (va.trailer_id) vehicleIds.add(va.trailer_id)
    if (va.driver_id) driverIds.add(va.driver_id)
  }

  // 7. Fetch vehicles and drivers
  const vehicleById = new Map()
  if (vehicleIds.size > 0) {
    const { data: vehicles, error: vehiclesErr } = await database
      .from('vehicles')
      .select('*')
      .in('id', Array.from(vehicleIds))

    if (vehiclesErr) throw vehiclesErr
    for (const v of vehicles || []) {
      vehicleById.set(v.id, v)
    }
  }

  const driverById = new Map()
  if (driverIds.size > 0) {
    const { data: drivers, error: driversErr } = await database
      .from('drivers')
      .select('*')
      .in('id', Array.from(driverIds))

    if (driversErr) throw driversErr
    for (const d of drivers || []) {
      driverById.set(d.id, d)
    }
  }

  // 8. Build current unit state from assigned loads
  const loadsByUnit = new Map()
  const unitUsedWeight = new Map()
  const routesServed = new Map()
  const customerDayUnits = new Map()
  const unitsPerRoute = new Map()

  for (const load of shapedAssignedLoads) {
    const unitId = load.assigned_unit_id
    if (!unitId) continue

    if (!loadsByUnit.has(unitId)) {
      loadsByUnit.set(unitId, [])
    }
    loadsByUnit.get(unitId).push(load)

    const weight = toNumber(load.total_weight, 0)
    unitUsedWeight.set(unitId, (unitUsedWeight.get(unitId) || 0) + weight)

    if (load.route_id) {
      if (!routesServed.has(unitId)) {
        routesServed.set(unitId, new Set())
      }
      routesServed.get(unitId).add(load.route_id)

      if (!unitsPerRoute.has(load.route_id)) {
        unitsPerRoute.set(load.route_id, new Set())
      }
      unitsPerRoute.get(load.route_id).add(unitId)
    }

    if (load.customer_id && load.delivery_date) {
      const custKey = `${load.customer_id}|${load.delivery_date}`
      if (!customerDayUnits.has(custKey)) {
        customerDayUnits.set(custKey, new Set())
      }
      customerDayUnits.get(custKey).add(unitId)
    }
  }

  // 9. Build active planned units with capacity info
  const units = []
  const usedVAIds = new Set()

  for (const plannedUnit of plannedUnits || []) {
    const va = vaById.get(plannedUnit.vehicle_assignment_id)
    if (!va) continue

    const vehicle = vehicleById.get(va.vehicle_id)
    const trailer = va.trailer_id ? vehicleById.get(va.trailer_id) : null
    const driver = va.driver_id ? driverById.get(va.driver_id) : null

    // Skip horses without trailers
    if (va.vehicle_type === 'horse' && !trailer) continue

    // Determine capacity
    const effectiveCapacityRaw =
      va.vehicle_type === 'horse' && trailer
        ? trailer.capacity
        : vehicle?.capacity

    const capacity_kg = parseCapacityKg(effectiveCapacityRaw || '0')
    const used_weight_kg = unitUsedWeight.get(plannedUnit.id) || 0
    const remaining_capacity_kg = Math.max(0, capacity_kg - used_weight_kg)
    const routes_served_set = routesServed.get(plannedUnit.id) || new Set()

    const unit = {
      planned_unit_id: plannedUnit.id,
      plan_id: plannedUnit.plan_id,
      vehicle_assignment_id: plannedUnit.vehicle_assignment_id,
      branch_id: va.branch_id,
      vehicle_type: va.vehicle_type,
      vehicle_id: va.vehicle_id,
      trailer_id: va.trailer_id,
      driver_id: va.driver_id,
      capacity_kg,
      used_weight_kg,
      remaining_capacity_kg,
      routes_served: routes_served_set,
      vehicle,
      trailer,
      driver,
    }

    units.push(unit)
    usedVAIds.add(va.id)
  }

  // Remove used VAs from available pools
  for (const [branchId, vaList] of availableAssignmentsByBranch.entries()) {
    availableAssignmentsByBranch.set(
      branchId,
      vaList.filter((va) => !usedVAIds.has(va.id))
    )
  }

  // 10. Build ordersById map and sort candidate orders
  const ordersById = new Map()
  for (const order of [...shapedAssignedLoads, ...candidateOrders]) {
    ordersById.set(order.order_id, order)
  }

  // Sort by route_id, delivery_date, total_weight desc
  candidateOrders.sort((a, b) => {
    const routeA = String(a.route_id || '')
    const routeB = String(b.route_id || '')
    if (routeA !== routeB) return routeA.localeCompare(routeB)

    const dateA = a.delivery_date || ''
    const dateB = b.delivery_date || ''
    if (dateA !== dateB) return dateA.localeCompare(dateB)

    const weightA = toNumber(a.total_weight, 0)
    const weightB = toNumber(b.total_weight, 0)
    return weightB - weightA
  })

  // 11. Assignment algorithm
  const assignments = []

  function findCandidateUnitsForOrder(order) {
    const orderWeight = toNumber(order.total_weight, 0)
    const candidates = []

    for (const unit of units) {
      // Branch matching
      if (order.branch_id && unit.branch_id !== order.branch_id) continue

      // Capacity check
      if (unit.remaining_capacity_kg < orderWeight) continue

      // Route rule: 1 route per vehicle
      if (
        unit.routes_served.size > 0 &&
        order.route_id &&
        !unit.routes_served.has(order.route_id)
      ) {
        continue
      }

      // Customer/day rule
      if (order.customer_id && order.delivery_date) {
        const custKey = `${order.customer_id}|${order.delivery_date}`
        const custUnits = customerDayUnits.get(custKey) || new Set()
        if (
          custUnits.size >= actualMaxUnits &&
          !custUnits.has(unit.planned_unit_id)
        ) {
          continue
        }
      }

      candidates.push(unit)
    }

    return {
      candidates,
      weight: orderWeight,
      routeKey: order.route_id,
      custKey:
        order.customer_id && order.delivery_date
          ? `${order.customer_id}|${order.delivery_date}`
          : null,
    }
  }

  for (const order of candidateOrders) {
    let {
      candidates,
      weight: orderWeight,
      routeKey,
      custKey,
    } = findCandidateUnitsForOrder(order)

    // If no candidates, try to create new unit
    if (candidates.length === 0) {
      const availableVAs =
        availableAssignmentsByBranch.get(order.branch_id) || []
      let newUnit = null

      for (const va of availableVAs) {
        const vehicle = vehicleById.get(va.vehicle_id)
        const trailer = va.trailer_id ? vehicleById.get(va.trailer_id) : null

        // Skip horses without trailers
        if (va.vehicle_type === 'horse' && !trailer) continue

        const effectiveCapacityRaw =
          va.vehicle_type === 'horse' && trailer
            ? trailer.capacity
            : vehicle?.capacity

        const capacity_kg = parseCapacityKg(effectiveCapacityRaw || '0')
        if (orderWeight <= capacity_kg) {
          // Create new planned unit
          const { data: insertedUnit, error: insertErr } = await database
            .from('planned_units')
            .insert([
              {
                plan_id: actualPlanId,
                vehicle_assignment_id: va.id,
                status: 'active',
              },
            ])
            .select('*')
            .single()

          if (insertErr) throw insertErr

          newUnit = {
            planned_unit_id: insertedUnit.id,
            plan_id: insertedUnit.plan_id,
            vehicle_assignment_id: va.id,
            branch_id: va.branch_id,
            vehicle_type: va.vehicle_type,
            vehicle_id: va.vehicle_id,
            trailer_id: va.trailer_id,
            driver_id: va.driver_id,
            capacity_kg,
            used_weight_kg: 0,
            remaining_capacity_kg: capacity_kg,
            routes_served: new Set(),
            vehicle,
            trailer,
            driver: va.driver_id ? driverById.get(va.driver_id) : null,
          }

          units.push(newUnit)
          usedVAIds.add(va.id)

          // Remove from available pool
          const branchVAs =
            availableAssignmentsByBranch.get(order.branch_id) || []
          availableAssignmentsByBranch.set(
            order.branch_id,
            branchVAs.filter((v) => v.id !== va.id)
          )

          // Recalculate candidates
          const recalc = findCandidateUnitsForOrder(order)
          candidates = recalc.candidates
          break
        }
      }
    }

    // Find best fit unit (minimum non-negative residual)
    if (candidates.length > 0) {
      let bestUnit = null
      let bestResidual = Infinity

      for (const unit of candidates) {
        const residual = unit.remaining_capacity_kg - orderWeight
        if (residual >= 0 && residual < bestResidual) {
          bestResidual = residual
          bestUnit = unit
        }
      }

      if (bestUnit) {
        // Assign order to unit
        assignments.push({
          planned_unit_id: bestUnit.planned_unit_id,
          order_id: order.order_id,
        })

        // Update unit state
        bestUnit.used_weight_kg += orderWeight
        bestUnit.remaining_capacity_kg =
          bestUnit.capacity_kg - bestUnit.used_weight_kg

        if (routeKey) {
          bestUnit.routes_served.add(routeKey)
          if (!unitsPerRoute.has(routeKey)) {
            unitsPerRoute.set(routeKey, new Set())
          }
          unitsPerRoute.get(routeKey).add(bestUnit.planned_unit_id)
        }

        if (custKey) {
          if (!customerDayUnits.has(custKey)) {
            customerDayUnits.set(custKey, new Set())
          }
          customerDayUnits.get(custKey).add(bestUnit.planned_unit_id)
        }
      }
    }
  }

  // 12. Commit assignments to database
  if (actualCommit) {
    const assignmentsByUnit = new Map()
    for (const assignment of assignments) {
      if (!assignmentsByUnit.has(assignment.planned_unit_id)) {
        assignmentsByUnit.set(assignment.planned_unit_id, [])
      }
      assignmentsByUnit
        .get(assignment.planned_unit_id)
        .push(assignment.order_id)
    }

    for (const [unitId, orderIds] of assignmentsByUnit.entries()) {
      // Update loads
      const { error: loadUpdateErr } = await database
        .from('loads')
        .update({
          assignment_plan_id: actualPlanId,
          assigned_unit_id: unitId,
          is_split: false,
        })
        .in('id', orderIds)

      if (loadUpdateErr) throw loadUpdateErr

      // Update load_items
      const { error: itemsUpdateErr } = await database
        .from('load_items')
        .update({
          assignment_plan_id: actualPlanId,
          assigned_unit_id: unitId,
        })
        .in('order_id', orderIds)

      if (itemsUpdateErr) throw itemsUpdateErr
    }
  }

  // 13. Attach line items for all orders
  const allOrderIds = Array.from(ordersById.keys())
  let linesByOrderId = new Map()

  if (allOrderIds.length > 0) {
    const { data: lines, error: linesErr } = await database
      .from('load_items')
      .select(
        'order_id, order_line_id, description, lip_channel_quantity, quantity, weight, length, ur_prod, send_to_production'
      )
      .in('order_id', allOrderIds)

    if (linesErr) throw linesErr

    for (const line of lines || []) {
      if (!linesByOrderId.has(line.order_id)) {
        linesByOrderId.set(line.order_id, [])
      }
      linesByOrderId.get(line.order_id).push({
        order_line_id: line.order_line_id,
        description: line.description,
        lip_channel_quantity: line.lip_channel_quantity,
        quantity: line.quantity,
        weight: line.weight,
        length: line.length,
        ur_prod: line.ur_prod,
        send_to_production: line.send_to_production,
      })
    }
  }

  // Attach lines to orders
  for (const [orderId, order] of ordersById.entries()) {
    order.lines = linesByOrderId.get(orderId) || []
  }

  // 14. Build response payload
  const unitOrdersMap = new Map()
  const assignedOrdersMap = new Map()

  // Add existing assigned loads
  for (const load of shapedAssignedLoads) {
    if (load.assigned_unit_id) {
      if (!unitOrdersMap.has(load.assigned_unit_id)) {
        unitOrdersMap.set(load.assigned_unit_id, [])
      }
      unitOrdersMap.get(load.assigned_unit_id).push(load)
      assignedOrdersMap.set(load.order_id, load)
    }
  }

  // Add newly assigned orders
  for (const assignment of assignments) {
    const order = ordersById.get(assignment.order_id)
    if (order) {
      if (!unitOrdersMap.has(assignment.planned_unit_id)) {
        unitOrdersMap.set(assignment.planned_unit_id, [])
      }
      unitOrdersMap.get(assignment.planned_unit_id).push(order)
      assignedOrdersMap.set(order.order_id, order)
    }
  }

  // Build units payload
  const unitsPayload = []
  for (const unit of units) {
    const unitOrders = unitOrdersMap.get(unit.planned_unit_id) || []
    const routeNames = new Set()
    let totalOrders = 0
    let totalItems = 0
    let totalQty = 0
    let totalWeight = 0

    for (const order of unitOrders) {
      totalOrders += 1
      totalItems += toNumber(order.total_line_items, 0)
      totalQty += toNumber(order.total_quantity, 0)
      totalWeight += toNumber(order.total_weight, 0)
      if (order.route_name) routeNames.add(order.route_name)
    }

    unitsPayload.push({
      planned_unit_id: unit.planned_unit_id,
      plan_id: unit.plan_id,
      vehicle_assignment_id: unit.vehicle_assignment_id,
      branch_id: unit.branch_id,
      vehicle_type: unit.vehicle_type,
      vehicle_id: unit.vehicle_id,
      trailer_id: unit.trailer_id,
      driver_id: unit.driver_id,
      capacity_kg: unit.capacity_kg,
      used_weight_kg: totalWeight,
      remaining_capacity_kg: Math.max(0, unit.capacity_kg - totalWeight),
      routes_served: Array.from(routeNames),
      driver: unit.driver
        ? {
            id: unit.driver.id,
            name: unit.driver.name,
            last_name: unit.driver.last_name,
            branch_id: unit.driver.branch_id,
          }
        : null,
      vehicle: unit.vehicle
        ? {
            id: unit.vehicle.id,
            type: unit.vehicle.type,
            reg_number: unit.vehicle.reg_number,
            license_plate: unit.vehicle.license_plate,
            fleet_number: unit.vehicle.fleet_number,
            capacity: unit.vehicle.capacity,
          }
        : null,
      trailer: unit.trailer
        ? {
            id: unit.trailer.id,
            type: unit.trailer.type,
            reg_number: unit.trailer.reg_number,
            license_plate: unit.trailer.license_plate,
            fleet_number: unit.trailer.fleet_number,
            capacity: unit.trailer.capacity,
          }
        : null,
      summary: {
        total_orders: totalOrders,
        total_line_items: totalItems,
        total_quantity: totalQty,
        total_weight: totalWeight,
      },
      orders: unitOrders,
    })
  }

  // Unassigned orders
  const finalUnassignedOrders = candidateOrders.filter(
    (order) => !assignedOrdersMap.has(order.order_id)
  )

  // Available vehicle assignments (unassigned_units)
  const availableVehicleAssignments = []
  for (const vaList of availableAssignmentsByBranch.values()) {
    for (const va of vaList) {
      if (usedVAIds.has(va.id)) continue

      const vehicle = vehicleById.get(va.vehicle_id)
      const trailer = va.trailer_id ? vehicleById.get(va.trailer_id) : null
      const driver = va.driver_id ? driverById.get(va.driver_id) : null

      availableVehicleAssignments.push({
        vehicle_assignment_id: va.id,
        branch_id: va.branch_id,
        vehicle_type: va.vehicle_type,
        vehicle_id: va.vehicle_id,
        trailer_id: va.trailer_id,
        driver_id: va.driver_id,
        driver: driver
          ? {
              id: driver.id,
              name: driver.name,
              last_name: driver.last_name,
              branch_id: driver.branch_id,
            }
          : null,
        vehicle: vehicle
          ? {
              id: vehicle.id,
              type: vehicle.type,
              reg_number: vehicle.reg_number,
              license_plate: vehicle.license_plate,
              fleet_number: vehicle.fleet_number,
              capacity: vehicle.capacity,
            }
          : null,
        trailer: trailer
          ? {
              id: trailer.id,
              type: trailer.type,
              reg_number: trailer.reg_number,
              license_plate: trailer.license_plate,
              fleet_number: trailer.fleet_number,
              capacity: trailer.capacity,
            }
          : null,
      })
    }
  }

  return {
    plan,
    units: unitsPayload,
    assigned_orders: Array.from(assignedOrdersMap.values()),
    unassigned_orders: finalUnassignedOrders,
    unassigned_units: availableVehicleAssignments,
    meta: {
      committed: actualCommit,
      assignments_created: assignments.length,
      max_units_per_customer_per_day: actualMaxUnits,
    },
  }
}
