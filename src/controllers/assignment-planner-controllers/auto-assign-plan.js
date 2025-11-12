// // controllers/planner/auto-assign-plan.js

// import database from '../../config/supabase.js'
// import { Response } from '../../utils/classes.js'

// function toNumber(value, fallback = 0) {
//   if (value === null || value === undefined) return fallback
//   const n = Number(value)
//   return Number.isFinite(n) ? n : fallback
// }

// function asBool(value, fallback = false) {
//   if (typeof value === 'boolean') return value
//   if (typeof value === 'string') {
//     const v = value.trim().toLowerCase()
//     if (v === 'true' || v === '1' || v === 'yes' || v === 'y') return true
//     if (v === 'false' || v === '0' || v === 'no' || v === 'n') return false
//   }
//   if (typeof value === 'number') return value !== 0
//   return fallback
// }

// function parseCapacityKg(raw) {
//   if (!raw) return 0
//   if (typeof raw === 'number') return raw

//   const s = String(raw).trim().toLowerCase()
//   if (!s) return 0
//   if (s === 'inf' || s === 'infinite' || s === 'unlimited') return Infinity

//   const match = s.match(/([\d.,]+)/)
//   if (!match) return 0

//   let value = match[1].replace(',', '')
//   const n = Number(value)
//   if (!Number.isFinite(n)) return 0

//   if (s.includes('ton') || s.includes('t ')) return n * 1000
//   if (s.includes('kg')) return n

//   return n // default: assume kg
// }

// function shapeOrderRow(row) {
//   const orderId = row.order_id || row.id

//   return {
//     order_id: orderId,
//     sales_order_id: row.sales_order_id ?? null,
//     sales_order_number: row.sales_order_number ?? null,
//     delivery_date: row.delivery_date ?? null,

//     branch_id: row.branch_id ?? null,
//     branch_name: row.branch_name ?? null,

//     route_id: row.route_id ?? null,
//     route_name: row.route_name ?? null,

//     suburb_route_id: row.suburb_route_id ?? null,
//     suburb_name: row.suburb_name ?? null,
//     suburb_city: row.suburb_city ?? null,
//     suburb_province: row.suburb_province ?? null,
//     suburb_postal_code: row.suburb_postal_code ?? null,

//     customer_id: row.customer_id ?? null,
//     customer_name: row.customer_name ?? null,
//     customer_bp_code: row.customer_bp_code ?? null,

//     total_line_items: toNumber(row.total_line_items, 0),
//     total_quantity: toNumber(row.total_quantity, 0),
//     total_weight: toNumber(row.total_weight, 0),

//     status: row.status ?? null,
//     sales_person_name: row.sales_person_name ?? null,
//     address: row.address ?? null,

//     assignment_plan_id: row.assignment_plan_id ?? null,
//     assigned_unit_id: row.assigned_unit_id ?? null,
//     is_split: !!row.is_split,
//     // lines will be added later
//   }
// }

// /**
//  * Auto-assign orders in a plan to vehicles per route.
//  */
// export const autoAssignLoads = async (req, res) => {
//   try {
//     const body = req.body || {}
//     const planId = body.plan_id
//     const branchIdFilter = body.branch_id || null
//     const commitFlag = asBool(body.commit, true)
//     const maxUnitsPerCustomerPerDay = toNumber(
//       body.max_units_per_customer_per_day,
//       2
//     )

//     if (!planId) {
//       return res
//         .status(400)
//         .json(new Response(400, 'Bad Request', 'Missing parameter: plan_id'))
//     }

//     /* --------------------------------------------------------------------- */
//     /* 1) Plan                                                               */
//     /* --------------------------------------------------------------------- */
//     const { data: planRows, error: planError } = await database
//       .from('plans')
//       .select(
//         `
//         id,
//         plan_name,
//         delivery_start,
//         delivery_end,
//         scope_all_branches,
//         status,
//         notes,
//         created_at,
//         updated_at
//       `
//       )
//       .eq('id', planId)
//       .limit(1)

//     if (planError) {
//       console.error('autoAssignPlanByRoute: planError', planError)
//       return res
//         .status(500)
//         .json(
//           new Response(
//             500,
//             'Server Error',
//             'Error fetching plan: ' + planError.message
//           )
//         )
//     }

//     const plan = planRows && planRows[0]
//     if (!plan) {
//       return res
//         .status(404)
//         .json(new Response(404, 'Not Found', 'Plan not found'))
//     }

//     /* --------------------------------------------------------------------- */
//     /* 2) Unassigned orders in scope (similar to loads-controller)           */
//     /* --------------------------------------------------------------------- */
//     let { data: unassignedRows, error: unassignedError } = await database
//       .from('v_unassigned_orders')
//       .select('*')
//       .eq('plan_id', planId)

//     if (unassignedError) {
//       console.error('autoAssignPlanByRoute: unassignedError', unassignedError)
//       return res
//         .status(500)
//         .json(
//           new Response(
//             500,
//             'Server Error',
//             'Error fetching unassigned orders: ' + unassignedError.message
//           )
//         )
//     }

//     let candidateOrders = (unassignedRows || []).map(shapeOrderRow)

//     if (branchIdFilter && branchIdFilter !== 'all') {
//       candidateOrders = candidateOrders.filter(
//         (o) => String(o.branch_id || '') === String(branchIdFilter || '')
//       )
//     }

//     if (!candidateOrders.length) {
//       return res.status(200).json(
//         new Response(
//           200,
//           'OK',
//           'No unassigned orders found for this plan/scope',
//           {
//             plan,
//             units: [],
//             assigned_orders: [],
//             unassigned_orders: [],
//             unassigned_units: [],
//           }
//         )
//       )
//     }

//     /* --------------------------------------------------------------------- */
//     /* 3) Already-assigned loads for this plan                               */
//     /* --------------------------------------------------------------------- */
//     const { data: assignedLoadRows, error: assignedLoadsError } = await database
//       .from('loads')
//       .select(
//         `
//           id,
//           sales_order_id,
//           sales_order_number,
//           delivery_date,
//           branch_id,
//           branch_name,
//           route_id,
//           route_name,
//           suburb_route_id,
//           suburb_name,
//           suburb_city,
//           suburb_province,
//           suburb_postal_code,
//           customer_id,
//           customer_name,
//           customer_bp_code,
//           total_line_items,
//           total_quantity,
//           total_weight,
//           status,
//           sales_person_name,
//           address,
//           assignment_plan_id,
//           assigned_unit_id
//         `
//       )
//       .eq('assignment_plan_id', planId)
//       .not('assigned_unit_id', 'is', null)

//     if (assignedLoadsError) {
//       console.error(
//         'autoAssignPlanByRoute: assignedLoadsError',
//         assignedLoadsError
//       )
//       return res
//         .status(500)
//         .json(
//           new Response(
//             500,
//             'Server Error',
//             'Error fetching assigned loads: ' + assignedLoadsError.message
//           )
//         )
//     }

//     const assignedLoads = (assignedLoadRows || []).map(shapeOrderRow)

//     /* --------------------------------------------------------------------- */
//     /* 4) Planned units                                                      */
//     /* --------------------------------------------------------------------- */
//     const { data: plannedUnitRows, error: plannedUnitsError } = await database
//       .from('planned_units')
//       .select('id, plan_id, vehicle_assignment_id, status, notes')
//       .eq('plan_id', planId)

//     if (plannedUnitsError) {
//       console.error(
//         'autoAssignPlanByRoute: plannedUnitsError',
//         plannedUnitsError
//       )
//       return res
//         .status(500)
//         .json(
//           new Response(
//             500,
//             'Server Error',
//             'Error fetching planned units: ' + plannedUnitsError.message
//           )
//         )
//     }

//     let plannedUnits = (plannedUnitRows || []).filter(
//       (u) => !u.status || u.status === 'active'
//     )

//     /* --------------------------------------------------------------------- */
//     /* 5) Vehicle assignments, vehicles, drivers                             */
//     /* --------------------------------------------------------------------- */
//     const branchIds = new Set()
//     candidateOrders.forEach((o) => {
//       if (o.branch_id) branchIds.add(String(o.branch_id))
//     })

//     let vaQuery = database
//       .from('vehicle_assignments')
//       .select(
//         `
//         id,
//         branch_id,
//         vehicle_id,
//         trailer_id,
//         vehicle_type,
//         driver_id,
//         status
//       `
//       )
//       .eq('status', 'active')

//     if (branchIds.size > 0) {
//       vaQuery = vaQuery.in('branch_id', Array.from(branchIds))
//     }

//     const { data: vaRows, error: vaError } = await vaQuery

//     if (vaError) {
//       console.error('autoAssignPlanByRoute: vaError', vaError)
//       return res
//         .status(500)
//         .json(
//           new Response(
//             500,
//             'Server Error',
//             'Error fetching vehicle assignments: ' + vaError.message
//           )
//         )
//     }

//     const vehicleAssignments = vaRows || []
//     const vaById = new Map()
//     const availableAssignmentsByBranch = new Map()
//     const driverIdSet = new Set()
//     const vehicleIdSet = new Set()

//     vehicleAssignments.forEach((va) => {
//       vaById.set(va.id, va)
//       const bKey = String(va.branch_id || '')
//       if (!availableAssignmentsByBranch.has(bKey)) {
//         availableAssignmentsByBranch.set(bKey, [])
//       }
//       availableAssignmentsByBranch.get(bKey).push(va)

//       if (va.vehicle_id) vehicleIdSet.add(va.vehicle_id)
//       if (va.trailer_id) vehicleIdSet.add(va.trailer_id)
//       if (va.driver_id) driverIdSet.add(va.driver_id)
//     })

//     // Vehicles
//     const vehiclesById = new Map()
//     if (vehicleIdSet.size > 0) {
//       const { data: vehicleRows, error: vehiclesError } = await database
//         .from('vehicles')
//         .select(
//           `
//           id,
//           type,
//           reg_number,
//           license_plate,
//           plate,
//           model,
//           vehicle_description,
//           capacity,
//           vehicle_category,
//           branch_id,
//           status
//         `
//         )
//         .in('id', Array.from(vehicleIdSet))

//       if (vehiclesError) {
//         console.error('autoAssignPlanByRoute: vehiclesError', vehiclesError)
//         return res
//           .status(500)
//           .json(
//             new Response(
//               500,
//               'Server Error',
//               'Error fetching vehicles: ' + vehiclesError.message
//             )
//           )
//       }

//       ;(vehicleRows || []).forEach((v) => {
//         vehiclesById.set(v.id, v)
//       })
//     }

//     // Drivers
//     const driversById = new Map()
//     if (driverIdSet.size > 0) {
//       const { data: driverRows, error: driversError } = await database
//         .from('drivers')
//         .select(
//           `
//           id,
//           branch_id,
//           name,
//           last_name,
//           phone,
//           email,
//           status,
//           license,
//           license_code
//         `
//         )
//         .in('id', Array.from(driverIdSet))

//       if (driversError) {
//         console.error('autoAssignPlanByRoute: driversError', driversError)
//         return res
//           .status(500)
//           .json(
//             new Response(
//               500,
//               'Server Error',
//               'Error fetching drivers: ' + driversError.message
//             )
//           )
//       }

//       ;(driverRows || []).forEach((d) => {
//         driversById.set(d.id, d)
//       })
//     }

//     /* --------------------------------------------------------------------- */
//     /* 6) Build current unit state                                           */
//     /* --------------------------------------------------------------------- */
//     const loadsByUnit = new Map()
//     const unitUsedWeight = new Map()
//     const routesServed = new Map()
//     const customerDayUnits = new Map()
//     const unitsPerRoute = new Map()

//     assignedLoads.forEach((order) => {
//       const unitId = order.assigned_unit_id
//       if (!unitId) return

//       if (!loadsByUnit.has(unitId)) loadsByUnit.set(unitId, [])
//       loadsByUnit.get(unitId).push(order)

//       const w = toNumber(order.total_weight, 0)
//       unitUsedWeight.set(unitId, (unitUsedWeight.get(unitId) || 0) + w)

//       const rSet = routesServed.get(unitId) || new Set()
//       if (order.route_id) rSet.add(order.route_id)
//       routesServed.set(unitId, rSet)

//       const custKey = `${order.customer_id || ''}|${order.delivery_date || ''}`
//       const cSet = customerDayUnits.get(custKey) || new Set()
//       cSet.add(unitId)
//       customerDayUnits.set(custKey, cSet)

//       if (order.route_id) {
//         const rKey = String(order.route_id)
//         const routeSet = unitsPerRoute.get(rKey) || new Set()
//         routeSet.add(unitId)
//         unitsPerRoute.set(rKey, routeSet)
//       }
//     })

//     const units = []
//     const usedVAIds = new Set()

//     plannedUnits.forEach((pu) => {
//       const va = vaById.get(pu.vehicle_assignment_id)
//       if (!va) return

//       const vehicle = vehiclesById.get(va.vehicle_id) || null
//       const trailer = va.trailer_id
//         ? vehiclesById.get(va.trailer_id) || null
//         : null
//       const driver = va.driver_id ? driversById.get(va.driver_id) || null : null

//       // 🚫 BUSINESS RULE: horses without trailers are not usable units
//       if (va.vehicle_type === 'horse' && !trailer) {
//         return
//       }

//       const capacityRaw =
//         va.vehicle_type === 'horse' && trailer
//           ? trailer.capacity
//           : vehicle && vehicle.capacity
//       const capacityKg = parseCapacityKg(capacityRaw)
//       const usedWeight = toNumber(unitUsedWeight.get(pu.id), 0)
//       const remainingCapacity =
//         capacityKg === Infinity
//           ? Infinity
//           : Math.max(capacityKg - usedWeight, 0)

//       const rSet = routesServed.get(pu.id) || new Set()

//       units.push({
//         planned_unit_id: pu.id,
//         plan_id: planId,
//         vehicle_assignment_id: va.id,
//         branch_id: va.branch_id,
//         vehicle_type: va.vehicle_type,
//         vehicle_id: va.vehicle_id,
//         trailer_id: va.trailer_id,
//         driver_id: va.driver_id,
//         driver,
//         vehicle,
//         trailer,
//         capacity_kg: capacityKg,
//         used_weight_kg: usedWeight,
//         remaining_capacity_kg: remainingCapacity,
//         routes_served: rSet,
//         notes: pu.notes || null,
//       })

//       usedVAIds.add(va.id)
//     })

//     // Remove used VAs from "available" pools
//     for (const [bKey, arr] of availableAssignmentsByBranch.entries()) {
//       const filtered = arr.filter((va) => !usedVAIds.has(va.id))
//       availableAssignmentsByBranch.set(bKey, filtered)
//     }

//     /* --------------------------------------------------------------------- */
//     /* 7) Orders map (assigned + candidates)                                 */
//     /* --------------------------------------------------------------------- */
//     const ordersById = new Map()
//     assignedLoads.forEach((o) => {
//       ordersById.set(o.order_id, o)
//     })
//     candidateOrders.forEach((o) => {
//       ordersById.set(o.order_id, o)
//     })

//     // Sort candidates by route, then date, then weight desc
//     candidateOrders.sort((a, b) => {
//       const ra = String(a.route_id || '')
//       const rb = String(b.route_id || '')
//       if (ra < rb) return -1
//       if (ra > rb) return 1

//       const da = a.delivery_date || ''
//       const db = b.delivery_date || ''
//       if (da < db) return -1
//       if (da > db) return 1

//       const wa = toNumber(a.total_weight, 0)
//       const wb = toNumber(b.total_weight, 0)
//       return wb - wa
//     })

//     function findCandidateUnitsForOrder(order) {
//       const branchKey = String(order.branch_id || '')
//       const routeId = order.route_id || null
//       const routeKey = String(routeId || '')
//       const weight = toNumber(order.total_weight, 0)

//       const routeSet = unitsPerRoute.get(routeKey) || new Set()
//       const custKey = `${order.customer_id || ''}|${order.delivery_date || ''}`
//       const custUnits = customerDayUnits.get(custKey) || new Set()

//       const candidates = []

//       units.forEach((u) => {
//         if (order.branch_id && String(u.branch_id || '') !== branchKey) {
//           return
//         }

//         const remaining = u.remaining_capacity_kg
//         if (remaining <= 0 || remaining < weight) return

//         const hasRoutes = u.routes_served.size > 0
//         const servesThisRoute = routeId && u.routes_served.has(routeId)

//         // 1 route per vehicle
//         if (hasRoutes && !servesThisRoute) return

//         // up to 2 vehicles per route
//         // const isNewForRoute = !hasRoutes && routeId
//         // if (isNewForRoute && routeSet.size >= 2) return

//         const alreadyUnitsForCustomer = custUnits.size
//         const unitAlreadyServingCustomer = custUnits.has(u.planned_unit_id)

//         if (
//           !unitAlreadyServingCustomer &&
//           alreadyUnitsForCustomer >= maxUnitsPerCustomerPerDay
//         ) {
//           return
//         }

//         candidates.push(u)
//       })

//       return {
//         routeKey,
//         routeSet,
//         custKey,
//         custUnits,
//         candidates,
//         weight,
//       }
//     }

//     /* --------------------------------------------------------------------- */
//     /* 8) Assign orders                                                      */
//     /* --------------------------------------------------------------------- */
//     const assignments = []
//     const newAssignedOrderIds = new Set()

//     for (const order of candidateOrders) {
//       const { routeKey, routeSet, custKey, custUnits, candidates, weight } =
//         findCandidateUnitsForOrder(order)

//       let chosenUnit = null
//       let candidateList = candidates

//       // if (!candidateList.length) {
//       //   // can we still add a vehicle for this route?
//       //   if (routeSet.size < 2) {
//       //     const branchKey = String(order.branch_id || '')
//       //     const rawAvailableList =
//       //       availableAssignmentsByBranch.get(branchKey) || []

//       //     // Only keep rigids OR horses that have a trailer
//       //     const availableList = rawAvailableList.filter(
//       //       (va) => va.vehicle_type !== 'horse' || va.trailer_id
//       //     )

//       //     if (availableList.length) {
//       //       const va = availableList.shift()
//       //       usedVAIds.add(va.id)

//       //       const { data: newPuRow, error: insertPuError } = await database
//       //         .from('planned_units')
//       //         .insert({
//       //           plan_id: planId,
//       //           vehicle_assignment_id: va.id,
//       //           status: 'active',
//       //         })
//       //         .select('id, plan_id, vehicle_assignment_id, status, notes')
//       //         .single()

//       //       if (!insertPuError && newPuRow) {
//       //         const vehicle = vehiclesById.get(va.vehicle_id) || null
//       //         const trailer = va.trailer_id
//       //           ? vehiclesById.get(va.trailer_id) || null
//       //           : null
//       //         const driver = va.driver_id
//       //           ? driversById.get(va.driver_id) || null
//       //           : null

//       //         const capacityRaw =
//       //           va.vehicle_type === 'horse' && trailer
//       //             ? trailer.capacity
//       //             : vehicle && vehicle.capacity
//       //         const capacityKg = parseCapacityKg(capacityRaw)

//       //         const newUnit = {
//       //           planned_unit_id: newPuRow.id,
//       //           plan_id: planId,
//       //           vehicle_assignment_id: va.id,
//       //           branch_id: va.branch_id,
//       //           vehicle_type: va.vehicle_type,
//       //           vehicle_id: va.vehicle_id,
//       //           trailer_id: va.trailer_id,
//       //           driver_id: va.driver_id,
//       //           driver,
//       //           vehicle,
//       //           trailer,
//       //           capacity_kg: capacityKg,
//       //           used_weight_kg: 0,
//       //           remaining_capacity_kg: capacityKg,
//       //           routes_served: new Set(),
//       //           notes: newPuRow.notes || null,
//       //         }

//       //         units.push(newUnit)

//       //         const recalc = findCandidateUnitsForOrder(order)
//       //         candidateList = recalc.candidates
//       //       }
//       //     }
//       //   }
//       // }
//       if (!candidateList.length) {
//         // ❌ no more limit per route – just try to add a new unit if available
//         const branchKey = String(order.branch_id || '')
//         const rawAvailableList =
//           availableAssignmentsByBranch.get(branchKey) || []

//         // Only keep rigids OR horses that have a trailer
//         const availableList = rawAvailableList.filter(
//           (va) => va.vehicle_type !== 'horse' || va.trailer_id
//         )

//         if (availableList.length) {
//           const va = availableList.shift()
//           usedVAIds.add(va.id)

//           const { data: newPuRow, error: insertPuError } = await database
//             .from('planned_units')
//             .insert({
//               plan_id: planId,
//               vehicle_assignment_id: va.id,
//               status: 'active',
//             })
//             .select('id, plan_id, vehicle_assignment_id, status, notes')
//             .single()

//           if (!insertPuError && newPuRow) {
//             const vehicle = vehiclesById.get(va.vehicle_id) || null
//             const trailer = va.trailer_id
//               ? vehiclesById.get(va.trailer_id) || null
//               : null
//             const driver = va.driver_id
//               ? driversById.get(va.driver_id) || null
//               : null

//             const capacityRaw =
//               va.vehicle_type === 'horse' && trailer
//                 ? trailer.capacity
//                 : vehicle && vehicle.capacity
//             const capacityKg = parseCapacityKg(capacityRaw)

//             const newUnit = {
//               planned_unit_id: newPuRow.id,
//               plan_id: planId,
//               vehicle_assignment_id: va.id,
//               branch_id: va.branch_id,
//               vehicle_type: va.vehicle_type,
//               vehicle_id: va.vehicle_id,
//               trailer_id: va.trailer_id,
//               driver_id: va.driver_id,
//               driver,
//               vehicle,
//               trailer,
//               capacity_kg: capacityKg,
//               used_weight_kg: 0,
//               remaining_capacity_kg: capacityKg,
//               routes_served: new Set(),
//               notes: newPuRow.notes || null,
//             }

//             units.push(newUnit)

//             const recalc = findCandidateUnitsForOrder(order)
//             candidateList = recalc.candidates
//           }
//         }
//       }

//       if (!candidateList.length) continue

//       let bestResidual = Infinity
//       candidateList.forEach((u) => {
//         const residual = u.remaining_capacity_kg - weight
//         if (residual >= 0 && residual < bestResidual) {
//           bestResidual = residual
//           chosenUnit = u
//         }
//       })

//       if (!chosenUnit) continue

//       assignments.push({
//         planned_unit_id: chosenUnit.planned_unit_id,
//         order_id: order.order_id,
//       })
//       newAssignedOrderIds.add(order.order_id)

//       chosenUnit.used_weight_kg += weight
//       chosenUnit.remaining_capacity_kg =
//         chosenUnit.capacity_kg === Infinity
//           ? Infinity
//           : Math.max(chosenUnit.capacity_kg - chosenUnit.used_weight_kg, 0)

//       const routeId = order.route_id || null
//       if (routeId && !chosenUnit.routes_served.has(routeId)) {
//         chosenUnit.routes_served.add(routeId)
//         const rKey = String(routeId || '')
//         const rSet = unitsPerRoute.get(rKey) || new Set()
//         rSet.add(chosenUnit.planned_unit_id)
//         unitsPerRoute.set(rKey, rSet)
//       }

//       const cSet = customerDayUnits.get(custKey) || new Set()
//       cSet.add(chosenUnit.planned_unit_id)
//       customerDayUnits.set(custKey, cSet)
//     }

//     /* --------------------------------------------------------------------- */
//     /* 9) Commit to DB (optional)                                            */
//     /* --------------------------------------------------------------------- */
//     if (commitFlag && assignments.length > 0) {
//       const ordersByUnitId = new Map()
//       assignments.forEach((a) => {
//         if (!ordersByUnitId.has(a.planned_unit_id)) {
//           ordersByUnitId.set(a.planned_unit_id, new Set())
//         }
//         ordersByUnitId.get(a.planned_unit_id).add(a.order_id)
//       })

//       for (const [unitId, orderIdSet] of ordersByUnitId.entries()) {
//         const orderIds = Array.from(orderIdSet)

//         const { error: loadsUpdateError } = await database
//           .from('loads')
//           .update({
//             assignment_plan_id: planId,
//             assigned_unit_id: unitId,
//             is_split: false,
//           })
//           .in('id', orderIds)

//         if (loadsUpdateError) {
//           console.error(
//             'autoAssignPlanByRoute: loadsUpdateError',
//             loadsUpdateError
//           )
//           return res
//             .status(500)
//             .json(
//               new Response(
//                 500,
//                 'Server Error',
//                 'Error updating loads: ' + loadsUpdateError.message
//               )
//             )
//         }

//         const { error: itemsUpdateError } = await database
//           .from('load_items')
//           .update({
//             assignment_plan_id: planId,
//             assigned_unit_id: unitId,
//           })
//           .in('order_id', orderIds)

//         if (itemsUpdateError) {
//           console.error(
//             'autoAssignPlanByRoute: itemsUpdateError',
//             itemsUpdateError
//           )
//           return res
//             .status(500)
//             .json(
//               new Response(
//                 500,
//                 'Server Error',
//                 'Error updating load_items: ' + itemsUpdateError.message
//               )
//             )
//         }
//       }
//     }

//     /* --------------------------------------------------------------------- */
//     /* 10) Load order lines for ALL orders in scope                          */
//     /* --------------------------------------------------------------------- */
//     const allOrderIds = Array.from(ordersById.keys())
//     if (allOrderIds.length) {
//       const { data: lineRows, error: linesErr } = await database
//         .from('load_items')
//         .select(
//           'order_id, order_line_id, description, lip_channel_quantity, quantity, weight, length, ur_prod, send_to_production'
//         )
//         .in('order_id', allOrderIds)

//       if (linesErr) {
//         console.error('autoAssignPlanByRoute: linesErr', linesErr)
//         return res
//           .status(500)
//           .json(
//             new Response(
//               500,
//               'Server Error',
//               'Error fetching load item lines: ' + linesErr.message
//             )
//           )
//       }

//       const linesByOrderId = new Map()
//       for (const li of lineRows || []) {
//         if (!linesByOrderId.has(li.order_id)) {
//           linesByOrderId.set(li.order_id, [])
//         }
//         linesByOrderId.get(li.order_id).push({
//           order_line_id: li.order_line_id,
//           description: li.description,
//           lip_channel_quantity: li.lip_channel_quantity,
//           quantity: li.quantity,
//           weight: li.weight,
//           length: li.length,
//           ur_prod: li.ur_prod,
//           send_to_production: li.send_to_production,
//         })
//       }

//       // attach lines onto each order in ordersById
//       for (const order of ordersById.values()) {
//         order.lines = linesByOrderId.get(order.order_id) || []
//       }
//     }

//     /* --------------------------------------------------------------------- */
//     /* 11) Build response payload from in-memory state                       */
//     /* --------------------------------------------------------------------- */
//     const unitOrdersMap = new Map()

//     // existing assigned loads
//     assignedLoads.forEach((order) => {
//       const unitId = order.assigned_unit_id
//       if (!unitId) return
//       if (!unitOrdersMap.has(unitId)) unitOrdersMap.set(unitId, [])
//       unitOrdersMap.get(unitId).push(order)
//     })

//     // newly assigned orders
//     assignments.forEach((a) => {
//       const unitId = a.planned_unit_id
//       const order = ordersById.get(a.order_id)
//       if (!order) return

//       order.assignment_plan_id = planId
//       order.assigned_unit_id = unitId

//       if (!unitOrdersMap.has(unitId)) unitOrdersMap.set(unitId, [])
//       const arr = unitOrdersMap.get(unitId)
//       if (!arr.find((o) => o.order_id === order.order_id)) {
//         arr.push(order)
//       }
//     })

//     const assignedOrdersMap = new Map()
//     for (const arr of unitOrdersMap.values()) {
//       arr.forEach((o) => {
//         assignedOrdersMap.set(o.order_id, o)
//       })
//     }

//     const unassignedOrders = candidateOrders.filter((o) => {
//       return !assignments.find((a) => a.order_id === o.order_id)
//     })

//     const unitsPayload = units.map((u) => {
//       const ordersForUnit = unitOrdersMap.get(u.planned_unit_id) || []

//       let totalOrders = ordersForUnit.length
//       let totalLineItems = 0
//       let totalQty = 0
//       let totalWeight = 0

//       ordersForUnit.forEach((order) => {
//         totalLineItems += toNumber(order.total_line_items, 0)
//         totalQty += toNumber(order.total_quantity, 0)
//         totalWeight += toNumber(order.total_weight, 0)
//       })

//       const driver = u.driver
//         ? {
//             id: u.driver.id,
//             branch_id: u.driver.branch_id,
//             name: u.driver.name,
//             last_name: u.driver.last_name,
//             phone: u.driver.phone,
//             email: u.driver.email,
//             status: u.driver.status,
//             license: u.driver.license,
//             license_code: u.driver.license_code,
//           }
//         : null

//       const vehicle = u.vehicle
//         ? {
//             id: u.vehicle.id,
//             type: u.vehicle.type,
//             reg_number: u.vehicle.reg_number,
//             license_plate: u.vehicle.license_plate,
//             plate: u.vehicle.plate,
//             model: u.vehicle.model,
//             vehicle_description: u.vehicle.vehicle_description,
//             capacity: u.vehicle.capacity,
//             branch_id: u.vehicle.branch_id,
//             status: u.vehicle.status,
//           }
//         : null

//       const trailer = u.trailer
//         ? {
//             id: u.trailer.id,
//             type: u.trailer.type,
//             reg_number: u.trailer.reg_number,
//             license_plate: u.trailer.license_plate,
//             plate: u.trailer.plate,
//             model: u.trailer.model,
//             vehicle_description: u.trailer.vehicle_description,
//             capacity: u.trailer.capacity,
//             branch_id: u.trailer.branch_id,
//             status: u.trailer.status,
//           }
//         : null

//       return {
//         planned_unit_id: u.planned_unit_id,
//         plan_id: u.plan_id,
//         vehicle_assignment_id: u.vehicle_assignment_id,
//         branch_id: u.branch_id,
//         vehicle_type: u.vehicle_type,
//         vehicle_id: u.vehicle_id,
//         trailer_id: u.trailer_id,
//         driver_id: u.driver_id,
//         driver,
//         vehicle,
//         trailer,
//         capacity_kg: u.capacity_kg,
//         used_weight_kg: u.used_weight_kg,
//         remaining_capacity_kg: u.remaining_capacity_kg,
//         routes_served: Array.from(u.routes_served || []),
//         notes: u.notes || null,
//         summary: {
//           total_orders: totalOrders,
//           total_line_items: totalLineItems,
//           total_quantity: totalQty,
//           total_weight: totalWeight,
//         },
//         orders: ordersForUnit,
//       }
//     })

//     const unassignedUnits = unitsPayload.filter(
//       (u) => !u.orders || u.orders.length === 0
//     )

//     // Build available_vehicle_assignments for the UI
//     const availableVehicleAssignments = []

//     for (const [branchKey, vaList] of availableAssignmentsByBranch.entries()) {
//       for (const va of vaList) {
//         // Skip any VAs that ended up being used later in the loop
//         if (usedVAIds.has(va.id)) continue

//         const vehicle = va.vehicle_id
//           ? vehiclesById.get(va.vehicle_id) || null
//           : null
//         const trailer = va.trailer_id
//           ? vehiclesById.get(va.trailer_id) || null
//           : null
//         const driver = va.driver_id
//           ? driversById.get(va.driver_id) || null
//           : null

//         availableVehicleAssignments.push({
//           id: va.id,
//           branch_id: va.branch_id,
//           vehicle_type: va.vehicle_type,
//           vehicle_id: va.vehicle_id,
//           trailer_id: va.trailer_id,
//           driver_id: va.driver_id,
//           status: va.status,

//           driver: driver
//             ? {
//                 id: driver.id,
//                 branch_id: driver.branch_id,
//                 name: driver.name,
//                 last_name: driver.last_name,
//                 phone: driver.phone,
//                 email: driver.email,
//                 status: driver.status,
//                 license: driver.license,
//                 license_code: driver.license_code,
//               }
//             : null,

//           vehicle: vehicle
//             ? {
//                 id: vehicle.id,
//                 type: vehicle.type,
//                 reg_number: vehicle.reg_number,
//                 license_plate: vehicle.license_plate,
//                 plate: vehicle.plate,
//                 model: vehicle.model,
//                 vehicle_description: vehicle.vehicle_description,
//                 capacity: vehicle.capacity,
//                 branch_id: vehicle.branch_id,
//                 status: vehicle.status,
//               }
//             : null,

//           trailer: trailer
//             ? {
//                 id: trailer.id,
//                 type: trailer.type,
//                 reg_number: trailer.reg_number,
//                 license_plate: trailer.license_plate,
//                 plate: trailer.plate,
//                 model: trailer.model,
//                 vehicle_description: trailer.vehicle_description,
//                 capacity: trailer.capacity,
//                 branch_id: trailer.branch_id,
//                 status: trailer.status,
//               }
//             : null,
//         })
//       }
//     }

//     // const payload = {
//     //   plan,
//     //   units: unitsPayload,
//     //   assigned_orders: Array.from(assignedOrdersMap.values()),
//     //   unassigned_orders: unassignedOrders,
//     //   unassigned_units: unassignedUnits,
//     //   meta: {
//     //     committed: commitFlag,
//     //     assignments_created: assignments.length,
//     //     max_units_per_customer_per_day: maxUnitsPerCustomerPerDay,
//     //   },
//     // }

//     const payload = {
//       plan,
//       units: unitsPayload,
//       assigned_orders: Array.from(assignedOrdersMap.values()),
//       unassigned_orders: unassignedOrders,
//       // unassigned_units: unassignedUnits,
//       unassigned_units: availableVehicleAssignments,
//       //available_vehicle_assignments: availableVehicleAssignments, // 👈 NEW
//       meta: {
//         committed: commitFlag,
//         assignments_created: assignments.length,
//         max_units_per_customer_per_day: maxUnitsPerCustomerPerDay,
//       },
//     }

//     const message = commitFlag
//       ? 'Auto-assignment committed successfully'
//       : 'Auto-assignment preview generated successfully'

//     return res.status(200).json(new Response(200, 'OK', message, payload))
//   } catch (err) {
//     console.error('autoAssignPlanByRoute: unexpected error', err)
//     return res
//       .status(500)
//       .json(
//         new Response(
//           500,
//           'Server Error',
//           err.message || 'Unexpected server error'
//         )
//       )
//   }
// }
// controllers/planner/auto-assign-plan.js

import database from '../../config/supabase.js'
import { Response } from '../../utils/classes.js'

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === '1' || v === 'yes' || v === 'y') return true
    if (v === 'false' || v === '0' || v === 'no' || v === 'n') return false
  }
  if (typeof value === 'number') return value !== 0
  return fallback
}

function parseCapacityKg(raw) {
  if (!raw) return 0
  if (typeof raw === 'number') return raw

  const s = String(raw).trim().toLowerCase()
  if (!s) return 0
  if (s === 'inf' || s === 'infinite' || s === 'unlimited') return Infinity

  const match = s.match(/([\d.,]+)/)
  if (!match) return 0

  let value = match[1].replace(',', '')
  const n = Number(value)
  if (!Number.isFinite(n)) return 0

  if (s.includes('ton') || s.includes('t ')) return n * 1000
  if (s.includes('kg')) return n

  return n // default: assume kg
}

function shapeOrderRow(row) {
  const orderId = row.order_id || row.id

  return {
    order_id: orderId,
    sales_order_id: row.sales_order_id ?? null,
    sales_order_number: row.sales_order_number ?? null,
    delivery_date: row.delivery_date ?? null,

    branch_id: row.branch_id ?? null,
    branch_name: row.branch_name ?? null,

    route_id: row.route_id ?? null,
    route_name: row.route_name ?? null,

    suburb_route_id: row.suburb_route_id ?? null,
    suburb_name: row.suburb_name ?? null,
    suburb_city: row.suburb_city ?? null,
    suburb_province: row.suburb_province ?? null,
    suburb_postal_code: row.suburb_postal_code ?? null,

    customer_id: row.customer_id ?? null,
    customer_name: row.customer_name ?? null,
    customer_bp_code: row.customer_bp_code ?? null,

    total_line_items: toNumber(row.total_line_items, 0),
    total_quantity: toNumber(row.total_quantity, 0),
    total_weight: toNumber(row.total_weight, 0),

    status: row.status ?? null,
    sales_person_name: row.sales_person_name ?? null,
    address: row.address ?? null,

    assignment_plan_id: row.assignment_plan_id ?? null,
    assigned_unit_id: row.assigned_unit_id ?? null,
    is_split: !!row.is_split,
    // lines will be added later
  }
}

/**
 * Auto-assign orders in a plan to vehicles per route.
 */
export const autoAssignLoads = async (req, res) => {
  try {
    const body = req.body || {}
    const planId = body.plan_id
    const branchIdFilter = body.branch_id || null
    const commitFlag = asBool(body.commit, true)
    const maxUnitsPerCustomerPerDay = toNumber(
      body.max_units_per_customer_per_day,
      2
    )

    if (!planId) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'Missing parameter: plan_id'))
    }

    /* --------------------------------------------------------------------- */
    /* 1) Plan                                                               */
    /* --------------------------------------------------------------------- */
    const { data: planRows, error: planError } = await database
      .from('plans')
      .select(
        `
        id,
        plan_name,
        delivery_start,
        delivery_end,
        scope_all_branches,
        status,
        notes,
        created_at,
        updated_at
      `
      )
      .eq('id', planId)
      .limit(1)

    if (planError) {
      console.error('autoAssignPlanByRoute: planError', planError)
      return res
        .status(500)
        .json(
          new Response(
            500,
            'Server Error',
            'Error fetching plan: ' + planError.message
          )
        )
    }

    const plan = planRows && planRows[0]
    if (!plan) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Plan not found'))
    }

    /* --------------------------------------------------------------------- */
    /* 2) Unassigned orders in scope                                         */
    /* --------------------------------------------------------------------- */
    let { data: unassignedRows, error: unassignedError } = await database
      .from('v_unassigned_orders')
      .select('*')
      .eq('plan_id', planId)

    if (unassignedError) {
      console.error('autoAssignPlanByRoute: unassignedError', unassignedError)
      return res
        .status(500)
        .json(
          new Response(
            500,
            'Server Error',
            'Error fetching unassigned orders: ' + unassignedError.message
          )
        )
    }

    let candidateOrders = (unassignedRows || []).map(shapeOrderRow)

    if (branchIdFilter && branchIdFilter !== 'all') {
      candidateOrders = candidateOrders.filter(
        (o) => String(o.branch_id || '') === String(branchIdFilter || '')
      )
    }

    if (!candidateOrders.length) {
      return res.status(200).json(
        new Response(
          200,
          'OK',
          'No unassigned orders found for this plan/scope',
          {
            plan,
            units: [],
            assigned_orders: [],
            unassigned_orders: [],
            unassigned_units: [],
          }
        )
      )
    }

    /* --------------------------------------------------------------------- */
    /* 3) Already-assigned loads for this plan                               */
    /* --------------------------------------------------------------------- */
    const { data: assignedLoadRows, error: assignedLoadsError } = await database
      .from('loads')
      .select(
        `
          id,
          sales_order_id,
          sales_order_number,
          delivery_date,
          branch_id,
          branch_name,
          route_id,
          route_name,
          suburb_route_id,
          suburb_name,
          suburb_city,
          suburb_province,
          suburb_postal_code,
          customer_id,
          customer_name,
          customer_bp_code,
          total_line_items,
          total_quantity,
          total_weight,
          status,
          sales_person_name,
          address,
          assignment_plan_id,
          assigned_unit_id
        `
      )
      .eq('assignment_plan_id', planId)
      .not('assigned_unit_id', 'is', null)

    if (assignedLoadsError) {
      console.error(
        'autoAssignPlanByRoute: assignedLoadsError',
        assignedLoadsError
      )
      return res
        .status(500)
        .json(
          new Response(
            500,
            'Server Error',
            'Error fetching assigned loads: ' + assignedLoadsError.message
          )
        )
    }

    const assignedLoads = (assignedLoadRows || []).map(shapeOrderRow)

    /* --------------------------------------------------------------------- */
    /* 4) Planned units                                                      */
    /* --------------------------------------------------------------------- */
    const { data: plannedUnitRows, error: plannedUnitsError } = await database
      .from('planned_units')
      .select('id, plan_id, vehicle_assignment_id, status, notes')
      .eq('plan_id', planId)

    if (plannedUnitsError) {
      console.error(
        'autoAssignPlanByRoute: plannedUnitsError',
        plannedUnitsError
      )
      return res
        .status(500)
        .json(
          new Response(
            500,
            'Server Error',
            'Error fetching planned units: ' + plannedUnitsError.message
          )
        )
    }

    let plannedUnits = (plannedUnitRows || []).filter(
      (u) => !u.status || u.status === 'active'
    )

    /* --------------------------------------------------------------------- */
    /* 5) Vehicle assignments, vehicles, drivers                             */
    /* --------------------------------------------------------------------- */
    const branchIds = new Set()
    candidateOrders.forEach((o) => {
      if (o.branch_id) branchIds.add(String(o.branch_id))
    })

    let vaQuery = database
      .from('vehicle_assignments')
      .select(
        `
        id,
        branch_id,
        vehicle_id,
        trailer_id,
        vehicle_type,
        driver_id,
        status
      `
      )
      .eq('status', 'active')

    if (branchIds.size > 0) {
      vaQuery = vaQuery.in('branch_id', Array.from(branchIds))
    }

    const { data: vaRows, error: vaError } = await vaQuery

    if (vaError) {
      console.error('autoAssignPlanByRoute: vaError', vaError)
      return res
        .status(500)
        .json(
          new Response(
            500,
            'Server Error',
            'Error fetching vehicle assignments: ' + vaError.message
          )
        )
    }

    const vehicleAssignments = vaRows || []
    const vaById = new Map()
    const availableAssignmentsByBranch = new Map()
    const driverIdSet = new Set()
    const vehicleIdSet = new Set()

    vehicleAssignments.forEach((va) => {
      vaById.set(va.id, va)
      const bKey = String(va.branch_id || '')
      if (!availableAssignmentsByBranch.has(bKey)) {
        availableAssignmentsByBranch.set(bKey, [])
      }
      availableAssignmentsByBranch.get(bKey).push(va)

      if (va.vehicle_id) vehicleIdSet.add(va.vehicle_id)
      if (va.trailer_id) vehicleIdSet.add(va.trailer_id)
      if (va.driver_id) driverIdSet.add(va.driver_id)
    })

    // Vehicles
    const vehiclesById = new Map()
    if (vehicleIdSet.size > 0) {
      const { data: vehicleRows, error: vehiclesError } = await database
        .from('vehicles')
        .select(
          `
          id,
          type,
          reg_number,
          license_plate,
          plate,
          model,
          vehicle_description,
          capacity,
          vehicle_category,
          branch_id,
          status
        `
        )
        .in('id', Array.from(vehicleIdSet))

      if (vehiclesError) {
        console.error('autoAssignPlanByRoute: vehiclesError', vehiclesError)
        return res
          .status(500)
          .json(
            new Response(
              500,
              'Server Error',
              'Error fetching vehicles: ' + vehiclesError.message
            )
          )
      }

      ;(vehicleRows || []).forEach((v) => {
        vehiclesById.set(v.id, v)
      })
    }

    // Drivers
    const driversById = new Map()
    if (driverIdSet.size > 0) {
      const { data: driverRows, error: driversError } = await database
        .from('drivers')
        .select(
          `
          id,
          branch_id,
          name,
          last_name,
          phone,
          email,
          status,
          license,
          license_code
        `
        )
        .in('id', Array.from(driverIdSet))

      if (driversError) {
        console.error('autoAssignPlanByRoute: driversError', driversError)
        return res
          .status(500)
          .json(
            new Response(
              500,
              'Server Error',
              'Error fetching drivers: ' + driversError.message
            )
          )
      }

      ;(driverRows || []).forEach((d) => {
        driversById.set(d.id, d)
      })
    }

    /* --------------------------------------------------------------------- */
    /* 6) Build current unit state                                           */
    /* --------------------------------------------------------------------- */
    const loadsByUnit = new Map()
    const unitUsedWeight = new Map()
    const routesServed = new Map()
    const customerDayUnits = new Map()
    const unitsPerRoute = new Map()

    assignedLoads.forEach((order) => {
      const unitId = order.assigned_unit_id
      if (!unitId) return

      if (!loadsByUnit.has(unitId)) loadsByUnit.set(unitId, [])
      loadsByUnit.get(unitId).push(order)

      const w = toNumber(order.total_weight, 0)
      unitUsedWeight.set(unitId, (unitUsedWeight.get(unitId) || 0) + w)

      const rSet = routesServed.get(unitId) || new Set()
      if (order.route_id) rSet.add(order.route_id)
      routesServed.set(unitId, rSet)

      const custKey = `${order.customer_id || ''}|${order.delivery_date || ''}`
      const cSet = customerDayUnits.get(custKey) || new Set()
      cSet.add(unitId)
      customerDayUnits.set(custKey, cSet)

      if (order.route_id) {
        const rKey = String(order.route_id)
        const routeSet = unitsPerRoute.get(rKey) || new Set()
        routeSet.add(unitId)
        unitsPerRoute.set(rKey, routeSet)
      }
    })

    const units = []
    const usedVAIds = new Set()

    plannedUnits.forEach((pu) => {
      const va = vaById.get(pu.vehicle_assignment_id)
      if (!va) return

      const vehicle = vehiclesById.get(va.vehicle_id) || null
      const trailer = va.trailer_id
        ? vehiclesById.get(va.trailer_id) || null
        : null
      const driver = va.driver_id ? driversById.get(va.driver_id) || null : null

      // BUSINESS RULE: horses without trailers are not usable units
      if (va.vehicle_type === 'horse' && !trailer) {
        return
      }

      const capacityRaw =
        va.vehicle_type === 'horse' && trailer
          ? trailer.capacity
          : vehicle && vehicle.capacity
      const capacityKg = parseCapacityKg(capacityRaw)
      const usedWeight = toNumber(unitUsedWeight.get(pu.id), 0)
      const remainingCapacity =
        capacityKg === Infinity
          ? Infinity
          : Math.max(capacityKg - usedWeight, 0)

      const rSet = routesServed.get(pu.id) || new Set()

      units.push({
        planned_unit_id: pu.id,
        plan_id: planId,
        vehicle_assignment_id: va.id,
        branch_id: va.branch_id,
        vehicle_type: va.vehicle_type,
        vehicle_id: va.vehicle_id,
        trailer_id: va.trailer_id,
        driver_id: va.driver_id,
        driver,
        vehicle,
        trailer,
        capacity_kg: capacityKg,
        used_weight_kg: usedWeight,
        remaining_capacity_kg: remainingCapacity,
        routes_served: rSet,
        notes: pu.notes || null,
      })

      usedVAIds.add(va.id)
    })

    // Remove used VAs from "available" pools
    for (const [bKey, arr] of availableAssignmentsByBranch.entries()) {
      const filtered = arr.filter((va) => !usedVAIds.has(va.id))
      availableAssignmentsByBranch.set(bKey, filtered)
    }

    /* --------------------------------------------------------------------- */
    /* 7) Orders map (assigned + candidates)                                 */
    /* --------------------------------------------------------------------- */
    const ordersById = new Map()
    assignedLoads.forEach((o) => {
      ordersById.set(o.order_id, o)
    })
    candidateOrders.forEach((o) => {
      ordersById.set(o.order_id, o)
    })

    // Sort candidates by route, then date, then weight desc
    candidateOrders.sort((a, b) => {
      const ra = String(a.route_id || '')
      const rb = String(b.route_id || '')
      if (ra < rb) return -1
      if (ra > rb) return 1

      const da = a.delivery_date || ''
      const db = b.delivery_date || ''
      if (da < db) return -1
      if (da > db) return 1

      const wa = toNumber(a.total_weight, 0)
      const wb = toNumber(b.total_weight, 0)
      return wb - wa
    })

    // NOTE: customer cap is now enforced at selection time, not here.
    function findCandidateUnitsForOrder(order) {
      const branchKey = String(order.branch_id || '')
      const routeId = order.route_id || null
      const routeKey = String(routeId || '')
      const weight = toNumber(order.total_weight, 0)

      const routeSet = unitsPerRoute.get(routeKey) || new Set()
      const candidates = []

      units.forEach((u) => {
        if (order.branch_id && String(u.branch_id || '') !== branchKey) {
          return
        }

        const remaining = u.remaining_capacity_kg
        if (remaining <= 0 || remaining < weight) return

        const hasRoutes = u.routes_served.size > 0
        const servesThisRoute = routeId && u.routes_served.has(routeId)

        // 1 route per vehicle
        if (hasRoutes && !servesThisRoute) return

        candidates.push(u)
      })

      return {
        routeKey,
        routeSet,
        candidates,
        weight,
      }
    }

    /* --------------------------------------------------------------------- */
    /* 8) Assign orders                                                      */
    /* --------------------------------------------------------------------- */
    const assignments = []
    const newAssignedOrderIds = new Set()

    for (const order of candidateOrders) {
      const custKey = `${order.customer_id || ''}|${order.delivery_date || ''}`
      let custUnits = customerDayUnits.get(custKey) || new Set()

      let { routeKey, routeSet, candidates, weight } =
        findCandidateUnitsForOrder(order)

      let candidateList = candidates

      // If no existing units can take it, try to spin up a new unit
      if (!candidateList.length) {
        const branchKey = String(order.branch_id || '')
        const rawAvailableList =
          availableAssignmentsByBranch.get(branchKey) || []

        // Only keep rigids OR horses that have a trailer
        const availableList = rawAvailableList.filter(
          (va) => va.vehicle_type !== 'horse' || va.trailer_id
        )

        if (availableList.length) {
          const va = availableList.shift()
          usedVAIds.add(va.id)

          const { data: newPuRow, error: insertPuError } = await database
            .from('planned_units')
            .insert({
              plan_id: planId,
              vehicle_assignment_id: va.id,
              status: 'active',
            })
            .select('id, plan_id, vehicle_assignment_id, status, notes')
            .single()

          if (!insertPuError && newPuRow) {
            const vehicle = vehiclesById.get(va.vehicle_id) || null
            const trailer = va.trailer_id
              ? vehiclesById.get(va.trailer_id) || null
              : null
            const driver = va.driver_id
              ? driversById.get(va.driver_id) || null
              : null

            const capacityRaw =
              va.vehicle_type === 'horse' && trailer
                ? trailer.capacity
                : vehicle && vehicle.capacity
            const capacityKg = parseCapacityKg(capacityRaw)

            const newUnit = {
              planned_unit_id: newPuRow.id,
              plan_id: planId,
              vehicle_assignment_id: va.id,
              branch_id: va.branch_id,
              vehicle_type: va.vehicle_type,
              vehicle_id: va.vehicle_id,
              trailer_id: va.trailer_id,
              driver_id: va.driver_id,
              driver,
              vehicle,
              trailer,
              capacity_kg: capacityKg,
              used_weight_kg: 0,
              remaining_capacity_kg: capacityKg,
              routes_served: new Set(),
              notes: newPuRow.notes || null,
            }

            units.push(newUnit)

            const recalc = findCandidateUnitsForOrder(order)
            candidateList = recalc.candidates
          }
        }
      }

      if (!candidateList.length) continue

      // Choose best-fit unit while enforcing per-customer-per-day cap
      let chosenUnit = null
      let bestResidual = Infinity

      candidateList.forEach((u) => {
        const residual = u.remaining_capacity_kg - weight
        if (residual < 0) return

        const alreadyServing = custUnits.has(u.planned_unit_id)
        const projectedCount = custUnits.size + (alreadyServing ? 0 : 1)

        // Enforce: max distinct units per (customer, date)
        if (projectedCount > maxUnitsPerCustomerPerDay) {
          return
        }

        if (residual < bestResidual) {
          bestResidual = residual
          chosenUnit = u
        }
      })

      if (!chosenUnit) continue

      assignments.push({
        planned_unit_id: chosenUnit.planned_unit_id,
        order_id: order.order_id,
      })
      newAssignedOrderIds.add(order.order_id)

      chosenUnit.used_weight_kg += weight
      chosenUnit.remaining_capacity_kg =
        chosenUnit.capacity_kg === Infinity
          ? Infinity
          : Math.max(chosenUnit.capacity_kg - chosenUnit.used_weight_kg, 0)

      const routeId = order.route_id || null
      if (routeId && !chosenUnit.routes_served.has(routeId)) {
        chosenUnit.routes_served.add(routeId)
        const rKey = String(routeId || '')
        const rSet = unitsPerRoute.get(rKey) || new Set()
        rSet.add(chosenUnit.planned_unit_id)
        unitsPerRoute.set(rKey, rSet)
      }

      const cSet = customerDayUnits.get(custKey) || new Set()
      cSet.add(chosenUnit.planned_unit_id)
      customerDayUnits.set(custKey, cSet)
      custUnits = cSet
    }

    /* --------------------------------------------------------------------- */
    /* 9) Commit to DB (optional)                                            */
    /* --------------------------------------------------------------------- */
    if (commitFlag && assignments.length > 0) {
      const ordersByUnitId = new Map()
      assignments.forEach((a) => {
        if (!ordersByUnitId.has(a.planned_unit_id)) {
          ordersByUnitId.set(a.planned_unit_id, new Set())
        }
        ordersByUnitId.get(a.planned_unit_id).add(a.order_id)
      })

      for (const [unitId, orderIdSet] of ordersByUnitId.entries()) {
        const orderIds = Array.from(orderIdSet)

        const { error: loadsUpdateError } = await database
          .from('loads')
          .update({
            assignment_plan_id: planId,
            assigned_unit_id: unitId,
            is_split: false,
          })
          .in('id', orderIds)

        if (loadsUpdateError) {
          console.error(
            'autoAssignPlanByRoute: loadsUpdateError',
            loadsUpdateError
          )
          return res
            .status(500)
            .json(
              new Response(
                500,
                'Server Error',
                'Error updating loads: ' + loadsUpdateError.message
              )
            )
        }

        const { error: itemsUpdateError } = await database
          .from('load_items')
          .update({
            assignment_plan_id: planId,
            assigned_unit_id: unitId,
          })
          .in('order_id', orderIds)

        if (itemsUpdateError) {
          console.error(
            'autoAssignPlanByRoute: itemsUpdateError',
            itemsUpdateError
          )
          return res
            .status(500)
            .json(
              new Response(
                500,
                'Server Error',
                'Error updating load_items: ' + itemsUpdateError.message
              )
            )
        }
      }
    }

    /* --------------------------------------------------------------------- */
    /* 10) Load order lines for ALL orders in scope                          */
    /* --------------------------------------------------------------------- */
    const allOrderIds = Array.from(ordersById.keys())
    if (allOrderIds.length) {
      const { data: lineRows, error: linesErr } = await database
        .from('load_items')
        .select(
          'order_id, order_line_id, description, lip_channel_quantity, quantity, weight, length, ur_prod, send_to_production'
        )
        .in('order_id', allOrderIds)

      if (linesErr) {
        console.error('autoAssignPlanByRoute: linesErr', linesErr)
        return res
          .status(500)
          .json(
            new Response(
              500,
              'Server Error',
              'Error fetching load item lines: ' + linesErr.message
            )
          )
      }

      const linesByOrderId = new Map()
      for (const li of lineRows || []) {
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

      // attach lines onto each order in ordersById
      for (const order of ordersById.values()) {
        order.lines = linesByOrderId.get(order.order_id) || []
      }
    }

    /* --------------------------------------------------------------------- */
    /* 11) Build response payload from in-memory state                       */
    /* --------------------------------------------------------------------- */
    const unitOrdersMap = new Map()

    // existing assigned loads
    assignedLoads.forEach((order) => {
      const unitId = order.assigned_unit_id
      if (!unitId) return
      if (!unitOrdersMap.has(unitId)) unitOrdersMap.set(unitId, [])
      unitOrdersMap.get(unitId).push(order)
    })

    // newly assigned orders
    assignments.forEach((a) => {
      const unitId = a.planned_unit_id
      const order = ordersById.get(a.order_id)
      if (!order) return

      order.assignment_plan_id = planId
      order.assigned_unit_id = unitId

      if (!unitOrdersMap.has(unitId)) unitOrdersMap.set(unitId, [])
      const arr = unitOrdersMap.get(unitId)
      if (!arr.find((o) => o.order_id === order.order_id)) {
        arr.push(order)
      }
    })

    const assignedOrdersMap = new Map()
    for (const arr of unitOrdersMap.values()) {
      arr.forEach((o) => {
        assignedOrdersMap.set(o.order_id, o)
      })
    }

    const unassignedOrders = candidateOrders.filter((o) => {
      return !assignments.find((a) => a.order_id === o.order_id)
    })

    const unitsPayload = units.map((u) => {
      const ordersForUnit = unitOrdersMap.get(u.planned_unit_id) || []

      let totalOrders = ordersForUnit.length
      let totalLineItems = 0
      let totalQty = 0
      let totalWeight = 0

      ordersForUnit.forEach((order) => {
        totalLineItems += toNumber(order.total_line_items, 0)
        totalQty += toNumber(order.total_quantity, 0)
        totalWeight += toNumber(order.total_weight, 0)
      })

      const driver = u.driver
        ? {
            id: u.driver.id,
            branch_id: u.driver.branch_id,
            name: u.driver.name,
            last_name: u.driver.last_name,
            phone: u.driver.phone,
            email: u.driver.email,
            status: u.driver.status,
            license: u.driver.license,
            license_code: u.driver.license_code,
          }
        : null

      const vehicle = u.vehicle
        ? {
            id: u.vehicle.id,
            type: u.vehicle.type,
            reg_number: u.vehicle.reg_number,
            license_plate: u.vehicle.license_plate,
            plate: u.vehicle.plate,
            model: u.vehicle.model,
            vehicle_description: u.vehicle.vehicle_description,
            capacity: u.vehicle.capacity,
            branch_id: u.vehicle.branch_id,
            status: u.vehicle.status,
          }
        : null

      const trailer = u.trailer
        ? {
            id: u.trailer.id,
            type: u.trailer.type,
            reg_number: u.trailer.reg_number,
            license_plate: u.trailer.license_plate,
            plate: u.trailer.plate,
            model: u.trailer.model,
            vehicle_description: u.trailer.vehicle_description,
            capacity: u.trailer.capacity,
            branch_id: u.trailer.branch_id,
            status: u.trailer.status,
          }
        : null

      return {
        planned_unit_id: u.planned_unit_id,
        plan_id: u.plan_id,
        vehicle_assignment_id: u.vehicle_assignment_id,
        branch_id: u.branch_id,
        vehicle_type: u.vehicle_type,
        vehicle_id: u.vehicle_id,
        trailer_id: u.trailer_id,
        driver_id: u.driver_id,
        driver,
        vehicle,
        trailer,
        capacity_kg: u.capacity_kg,
        used_weight_kg: u.used_weight_kg,
        remaining_capacity_kg: u.remaining_capacity_kg,
        routes_served: Array.from(u.routes_served || []),
        notes: u.notes || null,
        summary: {
          total_orders: totalOrders,
          total_line_items: totalLineItems,
          total_quantity: totalQty,
          total_weight: totalWeight,
        },
        orders: ordersForUnit,
      }
    })

    const unassignedUnits = unitsPayload.filter(
      (u) => !u.orders || u.orders.length === 0
    )

    // Build available_vehicle_assignments for the UI
    const availableVehicleAssignments = []

    for (const [branchKey, vaList] of availableAssignmentsByBranch.entries()) {
      for (const va of vaList) {
        if (usedVAIds.has(va.id)) continue

        const vehicle = va.vehicle_id
          ? vehiclesById.get(va.vehicle_id) || null
          : null
        const trailer = va.trailer_id
          ? vehiclesById.get(va.trailer_id) || null
          : null
        const driver = va.driver_id
          ? driversById.get(va.driver_id) || null
          : null

        availableVehicleAssignments.push({
          id: va.id,
          branch_id: va.branch_id,
          vehicle_type: va.vehicle_type,
          vehicle_id: va.vehicle_id,
          trailer_id: va.trailer_id,
          driver_id: va.driver_id,
          status: va.status,

          driver: driver
            ? {
                id: driver.id,
                branch_id: driver.branch_id,
                name: driver.name,
                last_name: driver.last_name,
                phone: driver.phone,
                email: driver.email,
                status: driver.status,
                license: driver.license,
                license_code: driver.license_code,
              }
            : null,

          vehicle: vehicle
            ? {
                id: vehicle.id,
                type: vehicle.type,
                reg_number: vehicle.reg_number,
                license_plate: vehicle.license_plate,
                plate: vehicle.plate,
                model: vehicle.model,
                vehicle_description: vehicle.vehicle_description,
                capacity: vehicle.capacity,
                branch_id: vehicle.branch_id,
                status: vehicle.status,
              }
            : null,

          trailer: trailer
            ? {
                id: trailer.id,
                type: trailer.type,
                reg_number: trailer.reg_number,
                license_plate: trailer.license_plate,
                plate: trailer.plate,
                model: trailer.model,
                vehicle_description: trailer.vehicle_description,
                capacity: trailer.capacity,
                branch_id: trailer.branch_id,
                status: trailer.status,
              }
            : null,
        })
      }
    }

    const payload = {
      plan,
      units: unitsPayload,
      assigned_orders: Array.from(assignedOrdersMap.values()),
      unassigned_orders: unassignedOrders,
      // unassigned_units: unassignedUnits,
      unassigned_units: availableVehicleAssignments,
      meta: {
        committed: commitFlag,
        assignments_created: assignments.length,
        max_units_per_customer_per_day: maxUnitsPerCustomerPerDay,
      },
    }

    const message = commitFlag
      ? 'Auto-assignment committed successfully'
      : 'Auto-assignment preview generated successfully'

    return res.status(200).json(new Response(200, 'OK', message, payload))
  } catch (err) {
    console.error('autoAssignPlanByRoute: unexpected error', err)
    return res
      .status(500)
      .json(
        new Response(
          500,
          'Server Error',
          err.message || 'Unexpected server error'
        )
      )
  }
}
