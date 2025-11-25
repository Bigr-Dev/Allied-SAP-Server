

// import database from '../config/supabase.js'

// /**
//  * Small helper to turn any messy capacity string into a kg number.
//  * Examples:
//  *  - "10t"   -> 10000
//  *  - "8000"  -> 8000
//  *  - "8,000" -> 8000
//  *  - null    -> 0
//  */
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

//   // very simple unit handling
//   if (s.includes('ton') || s.includes(' t')) return n * 1000
//   if (s.includes('kg')) return n

//   // default: assume kg
//   return n
// }

// /**
//  * Helper: build full plan payload
//  * (plan + units + assigned orders + unassigned orders + meta buckets)
//  *
//  * Used by:
//  *  - get-plan
//  *  - after bulk-assign / unassign-unit / set-unit-note
//  */
// export async function buildPlanPayload(planId) {
//   /* --------------------------------------------------------------------- */
//   /* 1) Fetch plan                                                         */
//   /* --------------------------------------------------------------------- */
//   const { data: plans, error: planErr } = await database
//     .from('plans')
//     .select(
//       'id, plan_name, delivery_start, delivery_end, scope_all_branches, status, notes, created_at, updated_at'
//     )
//     .eq('id', planId)
//     .limit(1)

//   if (planErr) throw planErr
//   const plan = plans && plans[0]
//   if (!plan) {
//     const err = new Error('Plan not found')
//     err.statusCode = 404
//     throw err
//   }

//   /* --------------------------------------------------------------------- */
//   /* 2) Units summary (per planned_unit)                                   */
//   /*     v_plan_units_summary should give us:                              */
//   /*     planned_unit_id, plan_id, vehicle_assignment_id, vehicle_id,      */
//   /*     trailer_id (if present), vehicle_type, driver_id, va_branch_id,   */
//   /*     some basic vehicle info, and rollup stats.                        */
//   /* --------------------------------------------------------------------- */
//   const { data: unitsSummary, error: unitsErr } = await database
//     .from('v_plan_units_summary')
//     .select('*')
//     .eq('plan_id', planId)

//   if (unitsErr) throw unitsErr

//   // Map planned_unit_id -> unit object skeleton
//   const unitsMap = new Map()
//   const vehicleIds = new Set()
//   const trailerIds = new Set()
//   const driverIds = new Set()
//   const usedVehicleAssignmentIds = new Set()

//   for (const row of unitsSummary || []) {
//     const unit = {
//       planned_unit_id: row.planned_unit_id,
//       plan_id: row.plan_id,
//       vehicle_assignment_id: row.vehicle_assignment_id,
//       vehicle_id: row.vehicle_id,
//       vehicle_type: row.vehicle_type,
//       driver_id: row.driver_id,
//       branch_id: row.va_branch_id,
//       // keep the basic vehicle info from the view as a starting point
//       vehicle: {
//         reg_number: row.reg_number,
//         license_plate: row.license_plate,
//         plate: row.plate,
//         model: row.model,
//         vehicle_description: row.vehicle_description,
//         capacity: row.capacity,
//         vehicle_category: row.vehicle_category,
//       },
//       status: row.planned_unit_status,
//       notes: row.planned_unit_notes,
//       created_at: row.created_at,
//       updated_at: row.updated_at,
//       summary: {
//         orders_assigned: row.orders_assigned,
//         items_assigned: row.items_assigned,
//         total_quantity: row.total_quantity,
//         total_weight: row.total_weight,
//       },
//       // will fill below
//       driver: null,
//       trailer: null,
//       routes_served: [],
//       orders: [],
//     }

//     // trailer_id may or may not be present in the view
//     if (row.trailer_id) {
//       unit.trailer_id = row.trailer_id
//       trailerIds.add(row.trailer_id)
//     }

//     unitsMap.set(row.planned_unit_id, unit)

//     if (row.vehicle_id) vehicleIds.add(row.vehicle_id)
//     if (row.driver_id) driverIds.add(row.driver_id)
//     if (row.vehicle_assignment_id)
//       usedVehicleAssignmentIds.add(row.vehicle_assignment_id)
//   }

//   /* --------------------------------------------------------------------- */
//   /* 3) Enrich with drivers + vehicles (main + trailer)                    */
//   /* --------------------------------------------------------------------- */

//   // Drivers
//   const driverById = new Map()
//   if (driverIds.size > 0) {
//     const { data: drivers, error: driversErr } = await database
//       .from('drivers')
//       .select(
//         'id, branch_id, name, last_name, phone, email, status, license, license_code'
//       )
//       .in('id', Array.from(driverIds))

//     if (driversErr) throw driversErr
//     for (const d of drivers || []) {
//       driverById.set(d.id, d)
//     }
//   }

//   // Vehicles (main vehicles + trailers)
//   const allVehicleIds = new Set([...vehicleIds, ...trailerIds])
//   const vehicleById = new Map()

//   if (allVehicleIds.size > 0) {
//     const { data: vehicles, error: vehiclesErr } = await database
//       .from('vehicles')
//       .select(
//         'id, type, reg_number, license_plate, plate, model, vehicle_description, capacity, vehicle_category, branch_id, status, length'
//       )
//       .in('id', Array.from(allVehicleIds))

//     if (vehiclesErr) throw vehiclesErr
//     for (const v of vehicles || []) {
//       vehicleById.set(v.id, v)
//     }
//   }

//   // Attach enriched driver + vehicle + trailer to each unit
//   for (const unit of unitsMap.values()) {
//     // driver
//     if (unit.driver_id) {
//       unit.driver = driverById.get(unit.driver_id) || null
//     }

//     // vehicle
//     if (unit.vehicle_id) {
//       const v = vehicleById.get(unit.vehicle_id)
//       if (v) {
//         const lengthNum = parseFloat(v.length ?? 0)
//         unit.vehicle = {
//           id: v.id,
//           type: v.type,
//           reg_number: v.reg_number,
//           license_plate: v.license_plate,
//           plate: v.plate,
//           model: v.model,
//           vehicle_description: v.vehicle_description,
//           capacity: v.capacity,
//           capacity_kg: parseCapacityKg(v.capacity),
//           vehicle_category: v.vehicle_category,
//           branch_id: v.branch_id,
//           status: v.status,
//           length: v.length,
//           length_m: Number.isFinite(lengthNum) ? lengthNum : 0,
//         }
//       }
//     }

//     // trailer
//     if (unit.trailer_id) {
//       const t = vehicleById.get(unit.trailer_id)
//       if (t) {
//         const lengthNum = parseFloat(t.length ?? 0)
//         unit.trailer = {
//           id: t.id,
//           type: t.type,
//           reg_number: t.reg_number,
//           license_plate: t.license_plate,
//           plate: t.plate,
//           model: t.model,
//           vehicle_description: t.vehicle_description,
//           capacity: t.capacity,
//           capacity_kg: parseCapacityKg(t.capacity),
//           vehicle_category: t.vehicle_category,
//           branch_id: t.branch_id,
//           status: t.status,
//           length: t.length,
//           length_m: Number.isFinite(lengthNum) ? lengthNum : 0,
//         }
//       }
//     }

//     // ✅ Effective capacity rule:
//     const capacityRaw =
//       unit.vehicle_type === 'horse' && unit.trailer
//         ? unit.trailer.capacity // horses use trailer capacity
//         : unit.vehicle?.capacity // rigids & others use vehicle capacity

//     unit.capacity_kg = parseCapacityKg(capacityRaw || '0')

//     // ✅ Effective length rule:
//     // For horses with trailers → combine, else use vehicle length only
//     const totalLength =
//       unit.vehicle_type === 'horse' && unit.trailer
//         ? (unit.vehicle?.length_m || 0) + (unit.trailer?.length_m || 0)
//         : unit.vehicle?.length_m || 0

//     unit.length_m = Number(totalLength.toFixed(2))
//   }

//   /* --------------------------------------------------------------------- */
//   /* 4) Assigned orders per unit (from v_unit_orders)                      */
//   /* --------------------------------------------------------------------- */
//   const { data: unitOrders, error: ordersErr } = await database
//     .from('v_unit_orders')
//     .select('*')
//     .eq('plan_id', planId)

//   if (ordersErr) throw ordersErr

//   // collect order_ids for line fetch
//   const orderIds = new Set()
//   for (const row of unitOrders || []) {
//     orderIds.add(row.order_id)
//   }

//   /* --------------------------------------------------------------------- */
//   /* 5) Load lines from load_items for assigned orders                     */
//   /* --------------------------------------------------------------------- */
//   let linesByOrderId = new Map()

//   if (orderIds.size > 0) {
//     const { data: lines, error: linesErr } = await database
//       .from('load_items')
//       .select(
//         'order_id, order_line_id, description, lip_channel_quantity, quantity, weight, length, ur_prod, send_to_production'
//       )
//       .in('order_id', Array.from(orderIds))

//     if (linesErr) throw linesErr

//     linesByOrderId = new Map()
//     for (const li of lines || []) {
//       if (!linesByOrderId.has(li.order_id)) {
//         linesByOrderId.set(li.order_id, [])
//       }
//       linesByOrderId.get(li.order_id).push({
//         order_line_id: li.order_line_id,
//         description: li.description,
//         lip_channel_quantity: li.lip_channel_quantity,
//         quantity: li.quantity,
//         weight: li.weight,
//         length: li.length,
//         ur_prod: li.ur_prod,
//         send_to_production: li.send_to_production,
//       })
//     }
//   }

//   /* --------------------------------------------------------------------- */
//   /* 6) Attach orders (with lines) to units                                */
//   /* --------------------------------------------------------------------- */

//   // To build assigned_orders later
//   const assignedOrdersMap = new Map()

//   for (const row of unitOrders || []) {
//     const unit = unitsMap.get(row.planned_unit_id)
//     if (!unit) continue

//     if (!unit.orders) unit.orders = []

//     const lines = linesByOrderId.get(row.order_id) || []

//     const order = {
//       order_id: row.order_id,
//       sales_order_id: row.sales_order_id,
//       sales_order_number: row.sales_order_number,
//       delivery_date: row.delivery_date,
//       branch_id: row.branch_id,
//       branch_name: row.branch_name,
//       route_id: row.route_id,
//       route_name: row.route_name,
//       suburb_route_id: row.suburb_route_id,
//       suburb_name: row.suburb_name,
//       suburb_city: row.suburb_city,
//       suburb_province: row.suburb_province,
//       suburb_postal_code: row.suburb_postal_code,
//       customer_id: row.customer_id,
//       customer_name: row.customer_name,
//       customer_bp_code: row.customer_bp_code,
//       total_line_items: row.total_line_items,
//       total_quantity: row.total_quantity,
//       total_weight: row.total_weight,
//       status: row.status,
//       sales_person_name: row.sales_person_name,
//       address: row.address,
//       assignment_plan_id: row.assignment_plan_id,
//       assigned_unit_id: row.assigned_unit_id,
//       is_split: row.is_split,
//       lines,
//     }

//     unit.orders.push(order)
//     assignedOrdersMap.set(order.order_id, order)
//   }

//   // compute routes_served + summary per unit
//   for (const unit of unitsMap.values()) {
//     const orders = unit.orders || []
//     const routeNames = new Set()
//     let totalOrders = 0
//     let totalItems = 0
//     let totalQty = 0
//     let totalWeight = 0

//     for (const o of orders) {
//       totalOrders += 1
//       totalItems += Number(o.total_line_items || 0)
//       totalQty += Number(o.total_quantity || 0)
//       totalWeight += Number(o.total_weight || 0)
//       if (o.route_name) routeNames.add(o.route_name)
//     }

//     unit.routes_served = Array.from(routeNames)

//     unit.summary = {
//       ...(unit.summary || {}),
//       total_orders: totalOrders,
//       total_items: totalItems,
//       total_quantity: totalQty,
//       total_weight: totalWeight,
//     }
//   }

//   /* --------------------------------------------------------------------- */
//   /* 7) Unassigned orders (order-level only here)                          */
//   /* --------------------------------------------------------------------- */
//   const { data: unassigned, error: unassignedErr } = await database
//     .from('v_unassigned_orders')
//     .select('*')
//     .eq('plan_id', planId)

//   if (unassignedErr) throw unassignedErr

//   /* --------------------------------------------------------------------- */
//   /* 8) Derived buckets: unassigned_units, assigned_orders                 */
//   /* --------------------------------------------------------------------- */
//   const units = Array.from(unitsMap.values())
//   const assigned_orders = Array.from(assignedOrdersMap.values())
//   const unassigned_units = units.filter(
//     (u) => !u.orders || u.orders.length === 0
//   )

//   /* --------------------------------------------------------------------- */
//   /* 8.5) Vehicles not used in this plan (unused_units)                    */
//   /* --------------------------------------------------------------------- */

//   // All active vehicle assignments
//   const { data: activeAssignments, error: vaErr } = await database
//     .from('vehicle_assignments')
//     .select(
//       'id, branch_id, vehicle_id, vehicle_type, trailer_id, driver_id, status'
//     )
//     .eq('status', 'active')

//   if (vaErr) throw vaErr

//   // Filter out the ones already used in this plan
//   const rawUnusedAssignments = (activeAssignments || []).filter(
//     (va) => !usedVehicleAssignmentIds.has(va.id)
//   )

//   // Collect any extra driver / vehicle IDs we haven't seen yet
//   const extraDriverIds = new Set()
//   const extraVehicleIds = new Set()

//   for (const va of rawUnusedAssignments) {
//     if (va.driver_id && !driverById.has(va.driver_id)) {
//       extraDriverIds.add(va.driver_id)
//     }
//     if (va.vehicle_id && !vehicleById.has(va.vehicle_id)) {
//       extraVehicleIds.add(va.vehicle_id)
//     }
//     if (va.trailer_id && !vehicleById.has(va.trailer_id)) {
//       extraVehicleIds.add(va.trailer_id)
//     }
//   }

//   // Fetch extra drivers if needed
//   if (extraDriverIds.size > 0) {
//     const { data: extraDrivers, error: extraDriversErr } = await database
//       .from('drivers')
//       .select(
//         'id, branch_id, name, last_name, phone, email, status, license, license_code'
//       )
//       .in('id', Array.from(extraDriverIds))

//     if (extraDriversErr) throw extraDriversErr
//     for (const d of extraDrivers || []) {
//       driverById.set(d.id, d)
//     }
//   }

//   // Fetch extra vehicles (for unused assignments)
//   if (extraVehicleIds.size > 0) {
//     const { data: extraVehicles, error: extraVehiclesErr } = await database
//       .from('vehicles')
//       .select(
//         'id, type, reg_number, license_plate, plate, model, vehicle_description, capacity, vehicle_category, branch_id, status, length'
//       )
//       .in('id', Array.from(extraVehicleIds))

//     if (extraVehiclesErr) throw extraVehiclesErr
//     for (const v of extraVehicles || []) {
//       vehicleById.set(v.id, v)
//     }
//   }

//   // Build enriched unused_units list
//   const unused_units = rawUnusedAssignments.map((va) => {
//     const vehicle = va.vehicle_id ? vehicleById.get(va.vehicle_id) : null
//     const trailer = va.trailer_id ? vehicleById.get(va.trailer_id) : null
//     const driver = va.driver_id ? driverById.get(va.driver_id) : null

//     const vehicleLength = vehicle ? parseFloat(vehicle.length ?? 0) : 0
//     const trailerLength = trailer ? parseFloat(trailer.length ?? 0) : 0

//     const effCapacityRaw =
//       va.vehicle_type === 'horse' && trailer
//         ? trailer.capacity
//         : vehicle?.capacity

//     const capacity_kg = parseCapacityKg(effCapacityRaw || '0')
//     const totalLength =
//       va.vehicle_type === 'horse' && trailer
//         ? (Number.isFinite(vehicleLength) ? vehicleLength : 0) +
//           (Number.isFinite(trailerLength) ? trailerLength : 0)
//         : Number.isFinite(vehicleLength)
//         ? vehicleLength
//         : 0

//     const length_m = Number(totalLength.toFixed(2))

//     return {
//       vehicle_assignment_id: va.id,
//       plan_id: plan.id,
//       vehicle_type: va.vehicle_type,
//       branch_id: va.branch_id,
//       driver_id: va.driver_id,
//       vehicle_id: va.vehicle_id,
//       trailer_id: va.trailer_id,
//       status: va.status,
//       driver: driver || null,
//       vehicle: vehicle
//         ? {
//             id: vehicle.id,
//             type: vehicle.type,
//             reg_number: vehicle.reg_number,
//             license_plate: vehicle.license_plate,
//             plate: vehicle.plate,
//             model: vehicle.model,
//             vehicle_description: vehicle.vehicle_description,
//             capacity: vehicle.capacity,
//             capacity_kg: parseCapacityKg(vehicle.capacity),
//             vehicle_category: vehicle.vehicle_category,
//             branch_id: vehicle.branch_id,
//             status: vehicle.status,
//             length: vehicle.length,
//             length_m: Number.isFinite(vehicleLength) ? vehicleLength : 0,
//           }
//         : null,
//       trailer: trailer
//         ? {
//             id: trailer.id,
//             type: trailer.type,
//             reg_number: trailer.reg_number,
//             license_plate: trailer.license_plate,
//             plate: trailer.plate,
//             model: trailer.model,
//             vehicle_description: trailer.vehicle_description,
//             capacity: trailer.capacity,
//             capacity_kg: parseCapacityKg(trailer.capacity),
//             vehicle_category: trailer.vehicle_category,
//             branch_id: trailer.branch_id,
//             status: trailer.status,
//             length: trailer.length,
//             length_m: Number.isFinite(trailerLength) ? trailerLength : 0,
//           }
//         : null,
//       capacity_kg,
//       length_m,
//     }
//   })

//   /* --------------------------------------------------------------------- */
//   /* 9) Final payload                                                      */
//   /* --------------------------------------------------------------------- */
//   return {
//     plan,
//     units,
//     unassigned_orders: unassigned || [],
//     unassigned_units,
//     assigned_orders,
//     unused_units, // 👈 new: vehicles not used in this plan
//   }
// }
import database from '../config/supabase.js'

/**
 * Small helper to turn any messy capacity string into a kg number.
 * Examples:
 *  - "10t"   -> 10000
 *  - "8000"  -> 8000
 *  - "8,000" -> 8000
 *  - null    -> 0
 */
function parseCapacityKg(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0

  const s = String(raw).trim().toLowerCase()
  if (!s) return 0

  // grab first numeric piece
  const match = s.match(/([\d.,]+)/)
  if (!match) return 0

  const numStr = match[1].replace(/,/g, '')
  const n = Number(numStr)
  if (!Number.isFinite(n)) return 0

  // very simple unit handling
  if (s.includes('ton') || s.includes(' t')) return n * 1000
  if (s.includes('kg')) return n

  // default: assume kg
  return n
}

/**
 * Helper: build full plan payload
 * (plan + units + assigned orders + unassigned orders + meta buckets)
 *
 * Used by:
 *  - get-plan
 *  - after bulk-assign / unassign-unit / set-unit-note
 */
export async function buildPlanPayload(planId) {
  /* --------------------------------------------------------------------- */
  /* 1) Fetch plan                                                         */
  /* --------------------------------------------------------------------- */
  const { data: plans, error: planErr } = await database
    .from('plans')
    .select(
      'id, plan_name, delivery_start, delivery_end, scope_all_branches, status, notes, created_at, updated_at'
    )
    .eq('id', planId)
    .limit(1)

  if (planErr) throw planErr
  const plan = plans && plans[0]
  if (!plan) {
    const err = new Error('Plan not found')
    err.statusCode = 404
    throw err
  }

  /* --------------------------------------------------------------------- */
  /* 2) Units summary (per planned_unit)                                   */
  /*     v_plan_units_summary should give us:                              */
  /*     planned_unit_id, plan_id, vehicle_assignment_id, vehicle_id,      */
  /*     trailer_id (if present), vehicle_type, driver_id, va_branch_id,   */
  /*     some basic vehicle info, and rollup stats.                        */
  /* --------------------------------------------------------------------- */
  const { data: unitsSummary, error: unitsErr } = await database
    .from('v_plan_units_summary')
    .select('*')
    .eq('plan_id', planId)

  if (unitsErr) throw unitsErr

  // Map planned_unit_id -> unit object skeleton
  const unitsMap = new Map()
  const vehicleIds = new Set()
  const trailerIds = new Set()
  const driverIds = new Set()
  const usedVehicleAssignmentIds = new Set()

  for (const row of unitsSummary || []) {
    const unit = {
      planned_unit_id: row.planned_unit_id,
      plan_id: row.plan_id,
      vehicle_assignment_id: row.vehicle_assignment_id,
      vehicle_id: row.vehicle_id,
      vehicle_type: row.vehicle_type,
      driver_id: row.driver_id,
      branch_id: row.va_branch_id,
      // keep the basic vehicle info from the view as a starting point
      vehicle: {
        reg_number: row.reg_number,
        license_plate: row.license_plate,
        plate: row.plate,
        model: row.model,
        vehicle_description: row.vehicle_description,
        capacity: row.capacity,
        vehicle_category: row.vehicle_category,
      },
      status: row.planned_unit_status,
      notes: row.planned_unit_notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      summary: {
        orders_assigned: row.orders_assigned,
        items_assigned: row.items_assigned,
        total_quantity: row.total_quantity,
        total_weight: row.total_weight,
      },
      // will fill below
      driver: null,
      trailer: null,
      routes_served: [],
      orders: [],
    }

    // trailer_id may or may not be present in the view
    if (row.trailer_id) {
      unit.trailer_id = row.trailer_id
      trailerIds.add(row.trailer_id)
    }

    unitsMap.set(row.planned_unit_id, unit)

    if (row.vehicle_id) vehicleIds.add(row.vehicle_id)
    if (row.driver_id) driverIds.add(row.driver_id)
    if (row.vehicle_assignment_id)
      usedVehicleAssignmentIds.add(row.vehicle_assignment_id)
  }

  /* --------------------------------------------------------------------- */
  /* 3) Enrich with drivers + vehicles (main + trailer)                    */
  /* --------------------------------------------------------------------- */

  // Drivers
  const driverById = new Map()
  if (driverIds.size > 0) {
    const { data: drivers, error: driversErr } = await database
      .from('drivers')
      .select(
        'id, branch_id, name, last_name, phone, email, status, license, license_code'
      )
      .in('id', Array.from(driverIds))

    if (driversErr) throw driversErr
    for (const d of drivers || []) {
      driverById.set(d.id, d)
    }
  }

  // Vehicles (main vehicles + trailers)
  const allVehicleIds = new Set([...vehicleIds, ...trailerIds])
  const vehicleById = new Map()

  if (allVehicleIds.size > 0) {
    const { data: vehicles, error: vehiclesErr } = await database
      .from('vehicles')
      .select(
        'id, type, reg_number, license_plate, plate, model, vehicle_description, capacity, vehicle_category, branch_id, status, length, fleet_number'
      )
      .in('id', Array.from(allVehicleIds))

    if (vehiclesErr) throw vehiclesErr
    for (const v of vehicles || []) {
      vehicleById.set(v.id, v)
    }
  }

  // Attach enriched driver + vehicle + trailer to each unit
  for (const unit of unitsMap.values()) {
    // driver
    if (unit.driver_id) {
      unit.driver = driverById.get(unit.driver_id) || null
    }

    // vehicle
    if (unit.vehicle_id) {
      const v = vehicleById.get(unit.vehicle_id)
      if (v) {
        const lengthNum = parseFloat(v.length ?? 0)
        unit.vehicle = {
          id: v.id,
          type: v.type,
          reg_number: v.reg_number,
          license_plate: v.license_plate,
          plate: v.plate,
          model: v.model,
          vehicle_description: v.vehicle_description,
          capacity: v.capacity,
          capacity_kg: parseCapacityKg(v.capacity),
          vehicle_category: v.vehicle_category,
          branch_id: v.branch_id,
          status: v.status,
          length: v.length,
          length_m: Number.isFinite(lengthNum) ? lengthNum : 0,
        }
      }
    }

    // trailer
    if (unit.trailer_id) {
      const t = vehicleById.get(unit.trailer_id)
      if (t) {
        const lengthNum = parseFloat(t.length ?? 0)
        unit.trailer = {
          id: t.id,
          type: t.type,
          reg_number: t.reg_number,
          license_plate: t.license_plate,
          plate: t.plate,
          model: t.model,
          vehicle_description: t.vehicle_description,
          capacity: t.capacity,
          capacity_kg: parseCapacityKg(t.capacity),
          vehicle_category: t.vehicle_category,
          branch_id: t.branch_id,
          status: t.status,
          length: t.length,
          length_m: Number.isFinite(lengthNum) ? lengthNum : 0,
        }
      }
    }

    // ✅ Effective capacity rule:
    const capacityRaw =
      unit.vehicle_type === 'horse' && unit.trailer
        ? unit.trailer.capacity // horses use trailer capacity
        : unit.vehicle?.capacity // rigids & others use vehicle capacity

    unit.capacity_kg = parseCapacityKg(capacityRaw || '0')

    // ✅ Effective length rule:
    // For horses with trailers → combine, else use vehicle length only
    const totalLength =
      unit.vehicle_type === 'horse' && unit.trailer
        ? (unit.vehicle?.length_m || 0) + (unit.trailer?.length_m || 0)
        : unit.vehicle?.length_m || 0

    unit.length_m = Number(totalLength.toFixed(2))
  }

  /* --------------------------------------------------------------------- */
  /* 4) Assigned orders per unit (from v_unit_orders)                      */
  /* --------------------------------------------------------------------- */
  const { data: unitOrders, error: ordersErr } = await database
    .from('v_unit_orders')
    .select('*')
    .eq('plan_id', planId)

  if (ordersErr) throw ordersErr

  // collect order_ids for line fetch
  const orderIds = new Set()
  for (const row of unitOrders || []) {
    orderIds.add(row.order_id)
  }

  /* --------------------------------------------------------------------- */
  /* 5) Load lines from load_items for assigned orders                     */
  /* --------------------------------------------------------------------- */
  let linesByOrderId = new Map()

  if (orderIds.size > 0) {
    const { data: lines, error: linesErr } = await database
      .from('load_items')
      .select(
        'order_id, order_line_id, description, lip_channel_quantity, quantity, weight, length, ur_prod, send_to_production'
      )
      .in('order_id', Array.from(orderIds))

    if (linesErr) throw linesErr

    linesByOrderId = new Map()
    for (const li of lines || []) {
      if (!linesByOrderId.has(li.order_id)) {
        linesByOrderId.set(li.order_id, [])
      }
      linesByOrderId.get(li.order_id).push({
        order_line_id: li.order_line_id,
        description: li.description,
        lip_channel_quantity: li.lip_channel_quantity,
        quantity: li.quantity,
        weight: li.weight,
        length: li.length,
        ur_prod: li.ur_prod,
        send_to_production: li.send_to_production,
      })
    }
  }

  /* --------------------------------------------------------------------- */
  /* 6) Attach orders (with lines) to units                                */
  /* --------------------------------------------------------------------- */

  // To build assigned_orders later
  const assignedOrdersMap = new Map()

  for (const row of unitOrders || []) {
    const unit = unitsMap.get(row.planned_unit_id)
    if (!unit) continue

    if (!unit.orders) unit.orders = []

    const lines = linesByOrderId.get(row.order_id) || []

    const order = {
      order_id: row.order_id,
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
      stop_sequence: row.stop_sequence, // 👈 new
      lines,
    }

    unit.orders.push(order)
    assignedOrdersMap.set(order.order_id, order)
  }

  // compute routes_served + summary per unit
  for (const unit of unitsMap.values()) {
    const orders = unit.orders || []
    const routeNames = new Set()
    let totalOrders = 0
    let totalItems = 0
    let totalQty = 0
    let totalWeight = 0

    for (const o of orders) {
      totalOrders += 1
      totalItems += Number(o.total_line_items || 0)
      totalQty += Number(o.total_quantity || 0)
      totalWeight += Number(o.total_weight || 0)
      if (o.route_name) routeNames.add(o.route_name)
    }

    unit.routes_served = Array.from(routeNames)

    unit.summary = {
      ...(unit.summary || {}),
      total_orders: totalOrders,
      total_items: totalItems,
      total_quantity: totalQty,
      total_weight: totalWeight,
    }
  }

  /* --------------------------------------------------------------------- */
  /* 7) Unassigned orders (order-level only here)                          */
  /* --------------------------------------------------------------------- */
  const { data: unassigned, error: unassignedErr } = await database
    .from('v_unassigned_orders')
    .select('*')
    .eq('plan_id', planId)

  if (unassignedErr) throw unassignedErr

  /* --------------------------------------------------------------------- */
  /* 8) Derived buckets: unassigned_units, assigned_orders                 */
  /* --------------------------------------------------------------------- */
  const units = Array.from(unitsMap.values())
  const assigned_orders = Array.from(assignedOrdersMap.values())
  const unassigned_units = units.filter(
    (u) => !u.orders || u.orders.length === 0
  )

  /* --------------------------------------------------------------------- */
  /* 8.5) Vehicles not used in this plan (unused_units)                    */
  /* --------------------------------------------------------------------- */

  // All active vehicle assignments
  const { data: activeAssignments, error: vaErr } = await database
    .from('vehicle_assignments')
    .select(
      'id, branch_id, vehicle_id, vehicle_type, trailer_id, driver_id, status'
    )
    .eq('status', 'active')

  if (vaErr) throw vaErr

  // Filter out the ones already used in this plan
  const rawUnusedAssignments = (activeAssignments || []).filter(
    (va) => !usedVehicleAssignmentIds.has(va.id)
  )

  // Collect any extra driver / vehicle IDs we haven't seen yet
  const extraDriverIds = new Set()
  const extraVehicleIds = new Set()

  for (const va of rawUnusedAssignments) {
    if (va.driver_id && !driverById.has(va.driver_id)) {
      extraDriverIds.add(va.driver_id)
    }
    if (va.vehicle_id && !vehicleById.has(va.vehicle_id)) {
      extraVehicleIds.add(va.vehicle_id)
    }
    if (va.trailer_id && !vehicleById.has(va.trailer_id)) {
      extraVehicleIds.add(va.trailer_id)
    }
  }

  // Fetch extra drivers if needed
  if (extraDriverIds.size > 0) {
    const { data: extraDrivers, error: extraDriversErr } = await database
      .from('drivers')
      .select(
        'id, branch_id, name, last_name, phone, email, status, license, license_code'
      )
      .in('id', Array.from(extraDriverIds))

    if (extraDriversErr) throw extraDriversErr
    for (const d of extraDrivers || []) {
      driverById.set(d.id, d)
    }
  }

  // Fetch extra vehicles (for unused assignments)
  if (extraVehicleIds.size > 0) {
    const { data: extraVehicles, error: extraVehiclesErr } = await database
      .from('vehicles')
      .select(
        'id, type, reg_number, license_plate, plate, model, vehicle_description, capacity, vehicle_category, branch_id, status, length, fleet_number'
      )
      .in('id', Array.from(extraVehicleIds))

    if (extraVehiclesErr) throw extraVehiclesErr
    for (const v of extraVehicles || []) {
      vehicleById.set(v.id, v)
    }
  }

  // Build enriched unused_units list
  const unused_units = rawUnusedAssignments.map((va) => {
    const vehicle = va.vehicle_id ? vehicleById.get(va.vehicle_id) : null
    const trailer = va.trailer_id ? vehicleById.get(va.trailer_id) : null
    const driver = va.driver_id ? driverById.get(va.driver_id) : null

    const vehicleLength = vehicle ? parseFloat(vehicle.length ?? 0) : 0
    const trailerLength = trailer ? parseFloat(trailer.length ?? 0) : 0

    const effCapacityRaw =
      va.vehicle_type === 'horse' && trailer
        ? trailer.capacity
        : vehicle?.capacity

    const capacity_kg = parseCapacityKg(effCapacityRaw || '0')
    const totalLength =
      va.vehicle_type === 'horse' && trailer
        ? (Number.isFinite(vehicleLength) ? vehicleLength : 0) +
          (Number.isFinite(trailerLength) ? trailerLength : 0)
        : Number.isFinite(vehicleLength)
        ? vehicleLength
        : 0

    const length_m = Number(totalLength.toFixed(2))

    return {
      vehicle_assignment_id: va.id,
      plan_id: plan.id,
      vehicle_type: va.vehicle_type,
      branch_id: va.branch_id,
      driver_id: va.driver_id,
      vehicle_id: va.vehicle_id,
      trailer_id: va.trailer_id,
      status: va.status,
      driver: driver || null,
      vehicle: vehicle
        ? {
            id: vehicle.id,
            type: vehicle.type,
            reg_number: vehicle.reg_number,
            license_plate: vehicle.license_plate,
            fleet_number: vehicle.fleet_number,
            plate: vehicle.plate,
            model: vehicle.model,
            vehicle_description: vehicle.vehicle_description,
            capacity: vehicle.capacity,
            capacity_kg: parseCapacityKg(vehicle.capacity),
            vehicle_category: vehicle.vehicle_category,
            branch_id: vehicle.branch_id,
            status: vehicle.status,
            length: vehicle.length,
            length_m: Number.isFinite(vehicleLength) ? vehicleLength : 0,
          }
        : null,
      trailer: trailer
        ? {
            id: trailer.id,
            type: trailer.type,
            reg_number: trailer.reg_number,
            license_plate: trailer.license_plate,
            fleet_number: trailer.fleet_number,
            plate: trailer.plate,
            model: trailer.model,
            vehicle_description: trailer.vehicle_description,
            capacity: trailer.capacity,
            capacity_kg: parseCapacityKg(trailer.capacity),
            vehicle_category: trailer.vehicle_category,
            branch_id: trailer.branch_id,
            status: trailer.status,
            length: trailer.length,
            length_m: Number.isFinite(trailerLength) ? trailerLength : 0,
          }
        : null,
      capacity_kg,
      length_m,
    }
  })

  /* --------------------------------------------------------------------- */
  /* 9) Final payload                                                      */
  /* --------------------------------------------------------------------- */
  return {
    plan,
    units,
    unassigned_orders: unassigned || [],
    unassigned_units,
    assigned_orders,
    unused_units, // 👈 new: vehicles not used in this plan
  }
}
