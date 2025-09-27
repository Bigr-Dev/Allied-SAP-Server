// controllers/autoAssignmentController.js
import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'
import {
  normalizeVehicles,
  needWeightKg,
  needMaxLengthMm,
  needMaxWidthMm,
  seedCustomerCapFromLoads,
  respectsCustomerCap,
  chooseUnitForLoad,
} from '../utils/assignmentRules.js'
import {
  parseCapacityToKg,
  parseLengthToMm,
  parseDimsFromString,
} from '../utils/units.js'

async function logAssignment({
  date,
  load_id,
  vehicle_id,
  role,
  source = 'auto',
  assigned_by = null,
}) {
  return database.from('vehicle_assignments').upsert(
    {
      assignment_date: date,
      load_id,
      vehicle_id,
      role,
      source,
      assigned_by,
    },
    { onConflict: 'assignment_date,load_id,role' }
  )
}

async function setVehicleStatus(vehicleId, status = 'assigned') {
  return database.from('vehicles').update({ status }).eq('id', vehicleId)
}

async function fetchLoadsForDate({
  date,
  branch_id,
  route_id,
  route_name,
  order_status,
}) {
  let q = database
    .from('loads_with_tree')
    .select(
      `
      id, route_id, route_name, branch_id, branch_name, delivery_date, status, total_weight, vehicle_id,
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

  if (branch_id) q = q.eq('branch_id', branch_id)
  if (route_id) q = q.eq('route_id', route_id)
  if (route_name) q = q.ilike('route_name', `%${route_name}%`)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const want = (order_status || '').toLowerCase().trim()
  if (want) {
    data.forEach((L) => {
      L.load_stops = (L.load_stops || [])
        .map((s) => {
          const oo = (s.load_orders || []).filter(
            (o) => String(o.order_status || '').toLowerCase() === want
          )
          return { ...s, load_orders: oo }
        })
        .filter((s) => (s.load_orders || []).length > 0)
    })
  }
  return (data || []).filter((L) => (L.load_stops || []).length > 0)
}

async function fetchVehiclesRaw() {
  const { data, error } = await database
    .from('vehicles')
    .select(
      'id, branch_id, status, type, vehicle_category, capacity, length, width, dimensions, priority, assigned_to'
    )
  if (error) throw new Error(error.message)
  return data
}

export const autoAssign = async (req, res) => {
  try {
    const {
      date,
      branch_id,
      route_id,
      route_name,
      order_status,
      capacityHeadroom = 0.1,
      lengthBufferMm = 600,
      widthBufferMm = 0,
      maxLoadsPerVehicle = 6,
      enforceSameBranch = true,
      ignoreWidthIfMissing = true,
      commit = false,
    } = req.body || {}

    if (!date) {
      return res
        .status(400)
        .send(new Response(400, 'Bad Request', 'date is required'))
    }

    const loadsToday = await fetchLoadsForDate({
      date,
      branch_id,
      route_id,
      route_name,
      order_status,
    })
    const vehiclesRaw = await fetchVehiclesRaw()
    const vehicles = normalizeVehicles(vehiclesRaw)

    const trucksByCustomer = new Map()
    seedCustomerCapFromLoads(loadsToday, trucksByCustomer)

    const opts = {
      capacityHeadroom,
      lengthBufferMm,
      widthBufferMm,
      maxLoadsPerVehicle,
      enforceSameBranch,
      ignoreWidthIfMissing,
    }

    const decisions = []
    let assignedKg = 0,
      unassignedKg = 0

    for (const load of loadsToday) {
      const choice = chooseUnitForLoad({
        vehicles,
        load,
        opts,
        trucksByCustomer,
      })
      if (!choice) {
        const reason =
          'No matching unit (capacity/length/width/branch/customer cap or no pre-linked horse+trailer)'
        const needKg = needWeightKg(load)
        unassignedKg += needKg
        decisions.push({ load_id: load.id, vehicle: null, reason, needKg })
        continue
      }

      const needKg = choice.needKg
      assignedKg += needKg

      if (choice.type === 'rigid') {
        const r = choice.rigid
        r.capacityAvailKg = Math.max(0, r.capacityAvailKg - needKg)
        r.assignedCount += 1
        for (const s of load.load_stops || [])
          for (const o of s.load_orders || []) {
            const c = (o.customer_name || '').trim().toUpperCase()
            if (!trucksByCustomer.has(c)) trucksByCustomer.set(c, new Set())
            trucksByCustomer.get(c).add(r.id)
          }
        decisions.push({
          load_id: load.id,
          vehicle: { type: 'RIGID', rigid_id: r.id },
          needKg,
        })
      } else {
        const h = choice.horse,
          t = choice.trailer
        t.capacityAvailKg = Math.max(0, t.capacityAvailKg - needKg)
        t.assignedCount += 1
        h.assignedCount += 1
        for (const s of load.load_stops || [])
          for (const o of s.load_orders || []) {
            const c = (o.customer_name || '').trim().toUpperCase()
            if (!trucksByCustomer.has(c)) trucksByCustomer.set(c, new Set())
            trucksByCustomer.get(c).add(h.id)
          }
        decisions.push({
          load_id: load.id,
          vehicle: { type: 'COMBO', horse_id: h.id, trailer_id: t.id },
          needKg,
        })
      }
    }

    if (commit) {
      for (const d of decisions) {
        if (!d.vehicle) continue
        const loadId = d.load_id

        if (d.vehicle.type === 'RIGID') {
          const rigidId = d.vehicle.rigid_id
          await database
            .from('loads')
            .update({ vehicle_id: rigidId })
            .eq('id', loadId)
          await setVehicleStatus(rigidId, 'assigned')
          await logAssignment({
            date,
            load_id: loadId,
            vehicle_id: rigidId,
            role: 'rigid',
            source: 'auto',
          })
        } else {
          const horseId = d.vehicle.horse_id
          const trailerId = d.vehicle.trailer_id
          await database
            .from('loads')
            .update({ vehicle_id: horseId })
            .eq('id', loadId)
          await setVehicleStatus(horseId, 'assigned')
          await setVehicleStatus(trailerId, 'assigned')
          await logAssignment({
            date,
            load_id: loadId,
            vehicle_id: horseId,
            role: 'horse',
            source: 'auto',
          })
          await logAssignment({
            date,
            load_id: loadId,
            vehicle_id: trailerId,
            role: 'trailer',
            source: 'auto',
          })
        }
      }
    }

    return res.status(200).send(
      new Response(
        200,
        'OK',
        commit ? 'Auto-assignment committed' : 'Auto-assignment preview',
        {
          date,
          totals: { assigned_kg: assignedKg, unassigned_kg: unassignedKg },
          decisions,
        }
      )
    )
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

/** Manual assignment (no link mutations) */
export const manuallyAssign = async (req, res) => {
  try {
    const { id } = req.params
    const {
      rigid_id,
      horse_id,
      trailer_id,
      enforceSameBranch = true,
      enforceDims = true,
      capacityHeadroom = 0.1,
      lengthBufferMm = 600,
      widthBufferMm = 0,
      allowCustomerCapOverride = false,
    } = req.body || {}
    const date = req.body?.date

    if (!rigid_id && !(horse_id && trailer_id)) {
      return res
        .status(400)
        .send(
          new Response(
            400,
            'Bad Request',
            'Provide either rigid_id OR both horse_id and trailer_id'
          )
        )
    }

    const { data: load, error: lerr } = await database
      .from('loads_with_tree')
      .select(
        `id, branch_id, delivery_date, vehicle_id, load_stops ( load_orders ( customer_name, total_weight, load_items ( weight, length, description ) ) )`
      )
      .eq('id', id)
      .single()
    if (lerr || !load)
      return res
        .status(404)
        .send(new Response(404, 'Not Found', 'Load not found'))
    const theDate = date || load.delivery_date

    const getV = async (vid) => {
      const { data, error } = await database
        .from('vehicles')
        .select(
          'id, branch_id, status, type, capacity, length, width, dimensions, assigned_to'
        )
        .eq('id', vid)
        .single()
      if (error) throw new Error(error.message)
      return data
    }

    const needKg = needWeightKg(load)
    const needLen = needMaxLengthMm(load) + Number(lengthBufferMm)
    const needWid = needMaxWidthMm(load) + Number(widthBufferMm)

    const trucksByCustomer = new Map()
    const loadsSameDay = await fetchLoadsForDate({
      date: theDate,
      branch_id: load.branch_id,
    })
    seedCustomerCapFromLoads(loadsSameDay, trucksByCustomer)

    if (rigid_id) {
      const v = await getV(rigid_id)
      if (String(v.status || '').toLowerCase() !== 'available') {
        return res
          .status(400)
          .send(new Response(400, 'Bad Request', 'Rigid is not available'))
      }
      if (
        enforceSameBranch &&
        v.branch_id &&
        load.branch_id &&
        v.branch_id !== load.branch_id
      ) {
        return res
          .status(400)
          .send(
            new Response(
              400,
              'Bad Request',
              'Rigid belongs to different branch'
            )
          )
      }
      if (!allowCustomerCapOverride) {
        const ok = respectsCustomerCap(v.id, load, trucksByCustomer, 2)
        if (!ok)
          return res
            .status(409)
            .send(
              new Response(
                409,
                'Conflict',
                'Customer already has two trucks for the date'
              )
            )
      }
      if (enforceDims) {
        const capKg = parseCapacityToKg(v.capacity)
        const lenMm =
          parseLengthToMm(v.length) ||
          parseDimsFromString(v.dimensions).lengthMm
        const widMm =
          parseLengthToMm(v.width) || parseDimsFromString(v.dimensions).widthMm
        if (capKg < Math.ceil(needKg * (1 + Number(capacityHeadroom)))) {
          return res
            .status(400)
            .send(new Response(400, 'Bad Request', 'Rigid capacity too low'))
        }
        if (!(lenMm && lenMm >= needLen))
          return res
            .status(400)
            .send(new Response(400, 'Bad Request', 'Rigid length too short'))
        if (widMm && widMm < needWid)
          return res
            .status(400)
            .send(new Response(400, 'Bad Request', 'Rigid width too narrow'))
      }
      await database.from('loads').update({ vehicle_id: v.id }).eq('id', id)
      await setVehicleStatus(v.id, 'assigned')
      await logAssignment({
        date: theDate,
        load_id: id,
        vehicle_id: v.id,
        role: 'rigid',
        source: 'manual',
      })
      return res.status(200).send(
        new Response(200, 'OK', 'Rigid assigned', {
          load_id: id,
          vehicle_id: v.id,
        })
      )
    }

    const h = await getV(horse_id)
    const t = await getV(trailer_id)
    for (const obj of [
      { v: h, name: 'Horse' },
      { v: t, name: 'Trailer' },
    ]) {
      if (String(obj.v.status || '').toLowerCase() !== 'available') {
        return res
          .status(400)
          .send(
            new Response(400, 'Bad Request', `${obj.name} is not available`)
          )
      }
    }
    if (enforceSameBranch) {
      const bset = new Set(
        [h.branch_id, t.branch_id, load.branch_id].filter(Boolean)
      )
      if (bset.size > 1)
        return res
          .status(400)
          .send(
            new Response(
              400,
              'Bad Request',
              'Horse/Trailer/Load must be in same branch'
            )
          )
    }
    if (t.assigned_to && t.assigned_to !== h.id) {
      return res
        .status(409)
        .send(
          new Response(
            409,
            'Conflict',
            'Trailer is linked to a different horse. Adjust link in fleet admin before assignment.'
          )
        )
    }
    if (!allowCustomerCapOverride) {
      const ok = respectsCustomerCap(h.id, load, trucksByCustomer, 2)
      if (!ok)
        return res
          .status(409)
          .send(
            new Response(
              409,
              'Conflict',
              'Customer already has two trucks for the date'
            )
          )
    }
    if (enforceDims) {
      const capKg = parseCapacityToKg(t.capacity)
      const lenMm =
        parseLengthToMm(t.length) || parseDimsFromString(t.dimensions).lengthMm
      const widMm =
        parseLengthToMm(t.width) || parseDimsFromString(t.dimensions).widthMm
      if (capKg < Math.ceil(needKg * (1 + Number(capacityHeadroom)))) {
        return res
          .status(400)
          .send(new Response(400, 'Bad Request', 'Trailer capacity too low'))
      }
      if (!(lenMm && lenMm >= needLen))
        return res
          .status(400)
          .send(new Response(400, 'Bad Request', 'Trailer length too short'))
      if (widMm && widMm < needWid)
        return res
          .status(400)
          .send(new Response(400, 'Bad Request', 'Trailer width too narrow'))
    }

    await database.from('loads').update({ vehicle_id: h.id }).eq('id', id)
    await setVehicleStatus(h.id, 'assigned')
    await setVehicleStatus(t.id, 'assigned')
    await logAssignment({
      date: theDate,
      load_id: id,
      vehicle_id: h.id,
      role: 'horse',
      source: 'manual',
    })
    await logAssignment({
      date: theDate,
      load_id: id,
      vehicle_id: t.id,
      role: 'trailer',
      source: 'manual',
    })

    return res.status(200).send(
      new Response(200, 'OK', 'Horse+Trailer assigned', {
        load_id: id,
        horse_id: h.id,
        trailer_id: t.id,
      })
    )
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

/** Unassign with safe status flip */
export const unassign = async (req, res) => {
  try {
    const { id } = await req.params
    const date = req.body?.date
    console.log('id :>> ', { ...req.params })
    console.log('date :>> ', date)

    const { data: load, error: lerr } = await database
      .from('loads')
      .select('id, vehicle_id, delivery_date')
      .eq('id', id)
      .single()
    if (lerr || !load)
      return res
        .status(404)
        .send(new Response(404, 'Not Found', 'Load not found'))
    const theDate = date || load.delivery_date

    const { data: assigns, error: aerr } = await database
      .from('vehicle_assignments')
      .select('vehicle_id, role')
      .eq('assignment_date', theDate)
      .eq('load_id', id)
    if (aerr)
      return res
        .status(400)
        .send(new Response(400, 'Bad Request', aerr.message))

    // delete assignment rows
    await database
      .from('vehicle_assignments')
      .delete()
      .eq('assignment_date', theDate)
      .eq('load_id', id)

    // after deletion, flip status to available only if no other assignments for the date
    const vehIds = Array.from(new Set((assigns || []).map((r) => r.vehicle_id)))
    for (const vid of vehIds) {
      const { data: remain, error: rerr } = await database
        .from('vehicle_assignments')
        .select('id')
        .eq('assignment_date', theDate)
        .eq('vehicle_id', vid)
        .limit(1)
      if (!rerr && (!remain || remain.length === 0)) {
        await database
          .from('vehicles')
          .update({ status: 'available' })
          .eq('id', vid)
      }
    }

    await database.from('loads').update({ vehicle_id: null }).eq('id', id)

    return res
      .status(200)
      .send(new Response(200, 'OK', 'Unassigned', { load_id: id }))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

/** GET /api/vehicle-assignments?date=YYYY-MM-DD */
export const getVehicleAssignmentsByDate = async (req, res) => {
  try {
    const { date } = req.query
    if (!date)
      return res
        .status(400)
        .send(new Response(400, 'Bad Request', 'date is required'))
    const { data, error } = await database
      .from('vehicle_assignments')
      .select('assignment_date, load_id, vehicle_id, role, source, created_at')
      .eq('assignment_date', date)
      .order('created_at', { ascending: true })
    if (error)
      return res
        .status(500)
        .send(new Response(500, 'Server Error', error.message))
    return res.status(200).send(new Response(200, 'OK', 'Assignments', data))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}
