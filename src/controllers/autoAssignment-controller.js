// controllers/autoAssignment-controller.js
import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

function parseLengthToMm(raw) {
  if (raw == null) return 0
  const s = String(raw).trim().toLowerCase()
  if (!s || s === '0') return 0
  const mm = s.match(/([\d.,]+)\s*mm\b/)
  const m = s.match(/([\d.,]+)\s*m\b/)
  const num = (str) => Number(String(str).replace(/,/g, ''))
  if (mm) return Math.round(num(mm[1]) || 0)
  if (m) return Math.round((num(m[1]) || 0) * 1000)
  const n = num(s)
  if (!Number.isFinite(n)) return 0
  return n > 100 ? Math.round(n) : Math.round(n * 1000)
}

function parseCapacityToKg(raw) {
  if (raw == null) return 0
  const s = String(raw).trim().toLowerCase()
  if (!s) return 0
  const num = Number(s.replace(/[^\d.,]/g, '').replace(/,/g, '')) || 0
  const hasTon = /\b(t|ton|tons|tonne|tonnes)\b/.test(s)
  const hasKg = /\bkg\b/.test(s)
  if (hasTon && !hasKg) return Math.round(num * 1000)
  return Math.round(num)
}

function parseVehicleLengthFromDimensions(raw) {
  if (!raw) return 0
  const s = String(raw).toLowerCase()
  const labeled = s.match(
    /(?:^|[^a-z])l(?:ength)?\s*[:=]?\s*([\d.,]+)\s*(m|mm)\b/
  )
  if (labeled) {
    const [, val, unit] = labeled
    return unit === 'mm'
      ? parseLengthToMm(`${val}mm`)
      : parseLengthToMm(`${val}m`)
  }
  const parts = s.split(/[^0-9.,m]+x[^0-9.,m]+/i).filter(Boolean)
  if (parts.length >= 2) {
    const mmVals = parts.map(parseLengthToMm).filter((n) => n > 0)
    if (mmVals.length) return Math.max(...mmVals)
  }
  const nums = s.match(/[\d.,]+/g)
  if (nums && nums.length) return parseLengthToMm(nums[0])
  return 0
}

function loadRequiredWeightKg(load) {
  if (
    load?.total_weight != null &&
    Number.isFinite(Number(load.total_weight))
  ) {
    return Number(load.total_weight)
  }
  let sum = 0
  for (const stop of load?.load_stops || []) {
    for (const order of stop?.load_orders || []) {
      if (
        order?.total_weight != null &&
        Number.isFinite(Number(order.total_weight))
      ) {
        sum += Number(order.total_weight)
      } else {
        for (const it of order?.load_items || []) sum += Number(it?.weight) || 0
      }
    }
  }
  return Math.round(sum)
}
function loadMaxItemLengthMm(load) {
  let mm = 0,
    topItems = []
  for (const stop of load?.load_stops || []) {
    for (const order of stop?.load_orders || []) {
      for (const it of order?.load_items || []) {
        const L = parseLengthToMm(it?.length)
        if (L > mm) mm = L
        topItems.push({ id: it?.id, length_raw: it?.length, length_mm: L })
      }
    }
  }
  topItems.sort((a, b) => b.length_mm - a.length_mm)
  return { mm, topItems: topItems.slice(0, 5) }
}
function isAssmLoad(load) {
  for (const stop of load?.load_stops || []) {
    for (const order of stop?.load_orders || []) {
      const so = String(order?.sales_order_number || '').trim()
      if (so.startsWith('7')) return true
    }
  }
  return false
}
function zoneKeysForLoad(load) {
  const set = new Set()
  for (const s of load?.load_stops || []) {
    const key = (s?.suburb_name || s?.city || 'UNKNOWN')
      .toUpperCase()
      .replace(/\s+/g, '')
    set.add(key)
  }
  return Array.from(set)
}
function scoreVehicle(v, needKg, needLenMm) {
  const wPart = (v.capacityAvailKg / Math.max(needKg, 1)) * 0.15
  const lPart = (v.lengthMm / Math.max(needLenMm || 1, 1)) * 0.85
  return wPart + lPart
}
function buildLoadManifest(
  load,
  requiredLenMm,
  assmFlag,
  detailLevel = 'order',
  maxItemsPerOrder = 100
) {
  const zones = zoneKeysForLoad(load)
  const needKg = loadRequiredWeightKg(load)
  const manifest = {
    load_id: load.id,
    route_id: load.route_id,
    route_name: load.route_name,
    branch_id: load.branch_id,
    branch_name: load.branch_name,
    required_kg: needKg,
    required_length_mm: requiredLenMm,
    assm_load: assmFlag,
    zones,
  }

  if (detailLevel === 'load') return manifest

  // orders (and optionally items)
  const orders = []
  for (const stop of load.load_stops || []) {
    for (const order of stop.load_orders || []) {
      const o = {
        order_id: order.id,
        sales_order_number: order.sales_order_number,
        customer_name: order.customer_name,
        order_status: order.order_status,
        total_weight:
          Number(order.total_weight) ||
          (order.load_items || []).reduce(
            (s, it) => s + (Number(it.weight) || 0),
            0
          ),
      }
      if (detailLevel === 'item') {
        const items = (order.load_items || [])
          .slice(0, maxItemsPerOrder)
          .map((it) => ({
            id: it.id,
            description: it.description,
            quantity: it.quantity,
            weight: Number(it.weight) || 0,
            length: it.length,
          }))
        o.items = items
        if ((order.load_items || []).length > items.length) {
          o.items_truncated = order.load_items.length - items.length
        }
      }
      orders.push(o)
    }
  }
  manifest.orders = orders
  return manifest
}

export const autoAssignLoads = async (req, res) => {
  try {
    // const {
    //   date,
    //   route_id,
    //   route_name,
    //   order_status,
    //   commit = false,

    //   // new knobs
    //   capacityHeadroom = 0.1,
    //   lengthBufferMm = 600,
    //   maxTrucksPerZone = 2,
    //   maxLoadsPerVehicle = 6,

    //   // NEW fallbacks & toggles
    //   defaultVehicleCapacityKg = 33000,
    //   defaultVehicleLengthMm = 12000,
    //   ignoreLengthIfMissing = true,
    //   ignoreDepartment = false,
    //   debug = false,
    // } = req.body || {}
    const {
      date,
      route_id,
      route_name,
      order_status,
      commit = false,
      capacityHeadroom = 0.1,
      lengthBufferMm = 600,
      maxTrucksPerZone = 2,
      maxLoadsPerVehicle = 6,
      branch_id, // NEW: single branch id
      branch_ids, // NEW: array of branch ids

      // existing fallbacks/debug
      defaultVehicleCapacityKg = 33000,
      defaultVehicleLengthMm = 12000,
      ignoreLengthIfMissing = true,
      ignoreDepartment = false,
      debug = false,

      // NEW: manifest controls
      detailLevel = 'order', // 'load' | 'order' | 'item'
      maxItemsPerOrder = 100, // to cap payload size
    } = req.body || {}

    if (!date) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'date (YYYY-MM-DD) is required'))
    }

    // vehicles
    const { data: vehiclesRaw, error: vehErr } = await database
      .from('vehicles')
      .select('id, vehicle_category, capacity, dimensions, status, priority')
    if (vehErr) throw vehErr

    const vehicles = (vehiclesRaw || [])
      .filter((v) => String(v.status || '').toLowerCase() !== 'inactive')
      .map((v) => {
        let capKg = parseCapacityToKg(v.capacity)
        let lengthMm = parseVehicleLengthFromDimensions(v.dimensions)
        // apply fallbacks
        if (!capKg) capKg = defaultVehicleCapacityKg
        if (!lengthMm && !ignoreLengthIfMissing)
          lengthMm = defaultVehicleLengthMm
        // capacity headroom like C# tonnage * 1.1
        const effCap = Math.max(
          0,
          Math.round(capKg * (1 + Number(capacityHeadroom || 0)))
        )
        const cat = String(v.vehicle_category || '').toUpperCase()
        return {
          id: v.id,
          raw: {
            capacity: v.capacity,
            dimensions: v.dimensions,
            category: cat,
          },
          category: cat,
          priority: Number.isFinite(Number(v.priority))
            ? Number(v.priority)
            : 0,
          capacityAvailKg: effCap,
          lengthMm: lengthMm, // may be 0 if unknown and ignoreLengthIfMissing=true
          assignedCount: 0,
        }
      })

    // loads
    let q = database
      .from('loads_with_tree')
      .select(
        `
        id, route_id, route_name, branch_id, branch_name,
        delivery_date, status, total_weight,
        load_stops (
          suburb_name, city, postal_code, position,
          load_orders (
            id, sales_order_number, customer_name, order_status, total_weight,
            load_items ( id, weight, length, description, quantity )
          )
        )
      `
      )
      .eq('delivery_date', date)
    if (route_id) q = q.eq('route_id', route_id)
    if (route_name) q = q.ilike('route_name', `%${route_name}%`)
    if (branch_id) q = q.eq('branch_id', branch_id)
    if (Array.isArray(branch_ids) && branch_ids.length) {
      q = q.in('branch_id', branch_ids)
    }
    const { data: loadsRaw, error: loadErr } = await q
    if (loadErr) throw loadErr

    const loads = (loadsRaw || [])
      .map((load) => {
        if (!order_status) return load
        const stops = (load.load_stops || [])
          .map((s) => ({
            ...s,
            load_orders: (s.load_orders || []).filter(
              (o) =>
                String(o?.order_status || '').toLowerCase() ===
                String(order_status).toLowerCase()
            ),
          }))
          .filter((s) => (s.load_orders || []).length > 0)
        return { ...load, load_stops: stops }
      })
      .filter((l) => (l.load_stops || []).length > 0)

    const zoneTruckMap = new Map()
    const decisions = []
    const vehicleSnapshot = debug
      ? vehicles.map((v) => ({
          id: v.id,
          category: v.category,
          capacityAvailKg: v.capacityAvailKg,
          lengthMm: v.lengthMm,
          raw: v.raw,
        }))
      : undefined

    let totalAssignedKg = 0
    let totalUnassignedKg = 0

    for (const load of loads) {
      const needKg = loadRequiredWeightKg(load)
      const { mm: maxItemLen, topItems } = loadMaxItemLengthMm(load)
      const needLenMm = (maxItemLen || 0) + Number(lengthBufferMm || 0)
      const assm = isAssmLoad(load)
      const zones = zoneKeysForLoad(load)

      const blocked = zones.some(
        (z) => zoneTruckMap.get(z)?.size >= maxTrucksPerZone
      )
      if (blocked) {
        totalUnassignedKg += needKg
        decisions.push({
          load_id: load.id,
          route_id: load.route_id,
          route_name: load.route_name,
          branch_id: load.branch_id,
          branch_name: load.branch_name,
          required_kg: needKg,
          required_length_mm: needLenMm,
          ...(debug ? { longest_items: topItems } : {}),
          reason: `Zone cap reached (${maxTrucksPerZone})`,
        })
        continue
      }

      const pool = vehicles.filter((v) => {
        const deptOk = ignoreDepartment
          ? true
          : assm
          ? v.category === 'ASSM' || v.category === ''
          : v.category !== 'ASSM' || v.category === ''
        const lengthOk =
          v.lengthMm > 0
            ? v.lengthMm >= needLenMm
            : ignoreLengthIfMissing
            ? true
            : false
        return (
          deptOk &&
          lengthOk &&
          v.capacityAvailKg >= needKg &&
          v.assignedCount < maxLoadsPerVehicle
        )
      })

      if (!pool.length) {
        totalUnassignedKg += needKg
        decisions.push({
          load_id: load.id,
          route_id: load.route_id,
          route_name: load.route_name,
          branch_id: load.branch_id,
          branch_name: load.branch_name,
          required_kg: needKg,
          required_length_mm: needLenMm,
          ...(debug ? { longest_items: topItems } : {}),
          reason: 'No vehicle meets capacity/length/department constraints',
        })
        continue
      }

      pool.sort((a, b) => {
        const sa = scoreVehicle(a, needKg, needLenMm)
        const sb = scoreVehicle(b, needKg, needLenMm)
        if (sa !== sb) return sa - sb
        const ra = a.capacityAvailKg - needKg
        const rb = b.capacityAvailKg - needKg
        if (ra !== rb) return ra - rb
        return (b.priority || 0) - (a.priority || 0)
      })

      const chosen = pool[0]
      chosen.capacityAvailKg -= needKg
      chosen.assignedCount += 1
      zones.forEach((z) => {
        if (!zoneTruckMap.has(z)) zoneTruckMap.set(z, new Set())
        zoneTruckMap.get(z).add(chosen.id)
      })

      totalAssignedKg += needKg
      decisions.push({
        load_id: load.id,
        route_id: load.route_id,
        route_name: load.route_name,
        branch_id: load.branch_id,
        branch_name: load.branch_name,
        required_kg: needKg,
        required_length_mm: needLenMm,
        assm_load: assm,
        vehicle_id: chosen.id,
        vehicle_remaining_capacity_kg: Math.max(
          0,
          Math.round(chosen.capacityAvailKg)
        ),
        ...(debug ? { longest_items: topItems } : {}),
      })
    }

    if (commit) {
      const updates = decisions
        .filter((d) => d.vehicle_id)
        .map((d) => ({ id: d.load_id, vehicle_id: d.vehicle_id }))
      for (const u of updates) {
        const { error: updErr } = await database
          .from('loads')
          .update({ vehicle_id: u.vehicle_id })
          .eq('id', u.id)
        if (updErr) {
          const d = decisions.find((x) => x.load_id === u.id)
          if (d) d.commit_error = updErr.message
        }
      }
    }

    // index loads by id so we can pull full detail for the manifest
    const loadIndex = new Map()
    for (const l of loads) loadIndex.set(l.id, l)

    // group assigned by vehicle
    const assignmentsByVehicle = {}
    let assignmentsByLoad = {}
    for (const d of decisions) {
      const l = loadIndex.get(d.load_id)
      const requiredLen = d.required_length_mm
      const assmFlag = !!d.assm_load

      if (d.vehicle_id) {
        if (!assignmentsByVehicle[d.vehicle_id]) {
          assignmentsByVehicle[d.vehicle_id] = {
            vehicle_id: d.vehicle_id,
            total_assigned_kg: 0,
            assigned_load_count: 0,
            loads: [],
          }
        }
        const m = buildLoadManifest(
          l,
          requiredLen,
          assmFlag,
          detailLevel,
          maxItemsPerOrder
        )
        assignmentsByVehicle[d.vehicle_id].loads.push(m)
        assignmentsByVehicle[d.vehicle_id].assigned_load_count += 1
        assignmentsByVehicle[d.vehicle_id].total_assigned_kg += d.required_kg
        assignmentsByLoad[d.load_id] = { vehicle_id: d.vehicle_id, ...m }
      } else {
        // unassigned – still include a detailed reasoned manifest
        const m = buildLoadManifest(
          l,
          requiredLen,
          assmFlag,
          detailLevel,
          maxItemsPerOrder
        )
        assignmentsByLoad[d.load_id] = {
          vehicle_id: null,
          reason: d.reason,
          ...m,
        }
      }
    }

    // optional: attach basic vehicle metadata for the header row (friendly manifest)
    const vehicleMeta = {}
    if (debug) {
      for (const v of vehicles) {
        vehicleMeta[v.id] = {
          category: v.category,
          lengthMm: v.lengthMm,
          capacityAvailKg: v.capacityAvailKg,
        }
      }
    }

    // const body = {
    //   date,
    //   totals: {
    //     assigned_kg: totalAssignedKg,
    //     unassigned_kg: totalUnassignedKg,
    //   },
    //   parameters: {
    //     capacity_headroom: `${Math.round((capacityHeadroom || 0) * 100)}%`,
    //     length_buffer_mm: Number(lengthBufferMm || 0),
    //     zone_truck_cap: maxTrucksPerZone,
    //     max_loads_per_vehicle: maxLoadsPerVehicle,
    //     default_vehicle_capacity_kg: defaultVehicleCapacityKg,
    //     default_vehicle_length_mm: defaultVehicleLengthMm,
    //     ignore_length_if_missing: !!ignoreLengthIfMissing,
    //     ignore_department: !!ignoreDepartment,
    //   },
    //   ...(debug ? { vehicle_pool_snapshot: vehicleSnapshot } : {}),
    //   decisions,
    // }
    const body = {
      date,
      totals: {
        assigned_kg: totalAssignedKg,
        unassigned_kg: totalUnassignedKg,
      },
      // parameters: {
      //   capacity_headroom: `${Math.round((capacityHeadroom || 0) * 100)}%`,
      //   length_buffer_mm: Number(lengthBufferMm || 0),
      //   zone_truck_cap: maxTrucksPerZone,
      //   max_loads_per_vehicle: maxLoadsPerVehicle,
      //   default_vehicle_capacity_kg: defaultVehicleCapacityKg,
      //   default_vehicle_length_mm: defaultVehicleLengthMm,
      //   ignore_length_if_missing: !!ignoreLengthIfMissing,
      //   ignore_department: !!ignoreDepartment,
      //   detail_level: detailLevel,
      //   max_items_per_order: maxItemsPerOrder,
      // },
      // ...(debug
      //   ? { vehicle_pool_snapshot: vehicleSnapshot, vehicle_meta: vehicleMeta }
      //   : {}),
      // decisions,
      assignments_by_vehicle: Object.values(assignmentsByVehicle),
      assignments_by_load: Object.values(assignmentsByLoad),
      unassigned_details: decisions
        .filter((d) => !d.vehicle_id)
        .map((d) => assignmentsByLoad[d.load_id]), // already contains reason + manifest
    }

    const msg = commit
      ? 'Auto-assignment committed (loads.vehicle_id updated)'
      : 'Auto-assignment preview (no DB changes)'
    return res.status(200).json(new Response(200, 'OK', msg, body))
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
