// controllers/assignmentPlanner-controller.js
import express from 'express'
import database from '../config/supabase.js' // mirrors your existing controller import  :contentReference[oaicite:5]{index=5}
import { Response } from '../utils/classes.js'

// const router = express.Router()

/* ============================== helpers ============================== */

function groupBy(arr, keyFn) {
  const m = new Map()
  for (const x of arr) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

/** format v_plan_units_summary + assignments + bucket into nested:
 *  Unit → Customers → Orders → Items
 */
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
  }))

  return { assigned_units: outUnits, unassigned }
}

/** get today & tomorrow (UTC date strings) */
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

/* ============================== SELECT helpers ============================== */

async function fetchUnits(branchId) {
  let q = database.from('v_dispatch_units').select('*')
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

async function fetchItems(cutoffDate, branchId, customerId) {
  let q = database
    .from('v_unassigned_items')
    .select('*')
    .lte('order_date', cutoffDate)
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

async function fetchPlanAssignments(planId) {
  // join items to decorate (customer, route, suburb, description)
  const { data, error } = await database.rpc('exec_sql', {
    // if you do not have an exec_sql rpc, replace with a view or multiple selects
    // NOTE: If you don't have a generic RPC, create a SQL view for this SELECT instead.
    query: `
        select
          a.id as assignment_id,
          u.id as plan_unit_id,
          a.load_id, a.order_id, a.item_id,
          a.assigned_weight_kg,
          a.priority_note,
          ui.customer_id, ui.customer_name, ui.suburb_name, ui.route_name, ui.order_date, ui.description
        from public.assignment_plan_item_assignments a
        join public.assignment_plan_units u on u.id = a.plan_unit_id
        left join public.v_unassigned_items ui on ui.item_id = a.item_id
        where u.plan_id = $1
        order by ui.customer_name nulls last, ui.order_id nulls last
      `,
    params: [planId],
  })
  if (error) throw error
  return data || []
}

async function fetchUnassignedBucket(planId) {
  const { data, error } = await database
    .from('f_plan_item_remainder'.toLowerCase()) // Supabase exposes SQL functions via RPC by default as 'rpc'
    .select('*')
    .eq('plan_id', planId) // if function is not a table function, call via rpc: database.rpc('f_plan_item_remainder', { plan_id: planId })
  if (error) {
    // fall back to RPC call if function is not set as a table
    const alt = await database.rpc('f_plan_item_remainder', { plan_id: planId })
    if (alt.error) throw alt.error
    return alt.data || []
  }
  return data || []
}

async function recalcUsedCapacity(planId) {
  const { error } = await database.rpc('f_recalc_plan_used_capacity', {
    p_plan_id: planId,
  })
  if (error) throw error
}

/* ============================== packer ============================== */
/** First-fit-decreasing by weight with 2-unit-per-customer cap. Atomic items (no weight splitting). */
function packItemsIntoUnits(items, units) {
  const state = units.map((u) => ({
    unit: u,
    capacity_left: Number(u.capacity_kg || 0),
    customers_on_unit: new Set(),
    used: false,
  }))

  const placements = [] // { unitIdx, item, weight }
  const unplaced = []

  const custKey = (it) => it.customer_id || `NAME:${it.customer_name || ''}`

  for (const item of items) {
    const w = Number(item.weight_kg || 0)
    if (w <= 0) continue
    const ck = custKey(item)

    // How many distinct units already used by this customer?
    const unitsForCustomer = new Set()
    state.forEach((s, idx) => {
      if (s.customers_on_unit.has(ck)) unitsForCustomer.add(idx)
    })

    // choose smallest capacity_left that still fits; honor 2-unit cap
    let chosenIdx = -1,
      bestGap = Number.POSITIVE_INFINITY
    for (let i = 0; i < state.length; i++) {
      const s = state[i]
      if (w > s.capacity_left) continue
      const isExisting = s.customers_on_unit.has(ck)
      if (!isExisting && unitsForCustomer.size >= 2) continue
      const gap = s.capacity_left - w
      if (gap < bestGap) {
        bestGap = gap
        chosenIdx = i
      }
    }

    if (chosenIdx === -1) {
      unplaced.push(item)
      continue
    }

    // place atomically
    const s = state[chosenIdx]
    s.capacity_left -= w
    s.used = true
    s.customers_on_unit.add(ck)
    placements.push({ unitIdx: chosenIdx, item, weight: w })
  }

  return { placements, unplaced, state }
}

/* ============================== endpoints ============================== */

/** AUTO (preview or commit) */
export const autoAssignLoads = async (req, res) => {
  try {
    const {
      departure_date,
      cutoff_date,
      branch_id,
      customer_id,
      commit = false,
      notes = null,
    } = req.body || {}

    const { today, tomorrow } = todayTomorrow()
    const dep = departure_date || tomorrow
    const cut = cutoff_date || today

    // units
    const units = await fetchUnits(branch_id)

    // items backlog (unassigned)
    const items = await fetchItems(cut, branch_id, customer_id)

    // pack
    const { placements, unplaced, state } = packItemsIntoUnits(items, units)

    if (!commit) {
      // build a synthetic, ephemeral preview (no DB writes)
      const used = new Set(placements.map((p) => p.unitIdx))
      const pseudoUnits = [...used].map((idx, i) => {
        const u = units[idx]
        const st = state[idx]
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
          capacity_kg: u.capacity_kg,
          used_capacity_kg: Number(u.capacity_kg) - Number(st.capacity_left),
        }
      })
      const pseudoAssignments = placements.map((p) => ({
        assignment_id: `preview-${p.unitIdx}-${p.item.item_id}`,
        plan_unit_id: pseudoUnits.find(
          (x) =>
            Number(x.plan_unit_id.split('-').pop()) ===
            [...used].indexOf(p.unitIdx)
        ).plan_unit_id,
        load_id: p.item.load_id,
        order_id: p.item.order_id,
        item_id: p.item.item_id,
        assigned_weight_kg: p.weight,
        priority_note: 'auto',
        customer_id: p.item.customer_id,
        customer_name: p.item.customer_name,
        suburb_name: p.item.suburb_name,
        route_name: p.item.route_name,
        order_date: p.item.order_date,
        description: p.item.description,
      }))
      const bucket = unplaced.map((u) => ({
        load_id: u.load_id,
        order_id: u.order_id,
        item_id: u.item_id,
        customer_id: u.customer_id,
        customer_name: u.customer_name,
        suburb_name: u.suburb_name,
        route_name: u.route_name,
        order_date: u.order_date,
        weight_left: u.weight_kg,
        description: u.description,
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
          },
          ...nested,
        })
      )
    }

    // commit = true → persist plan
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

    // create plan units (only those used)
    const usedIdx = [...new Set(placements.map((p) => p.unitIdx))]
    const planUnitIdByIdx = new Map()

    for (const idx of usedIdx) {
      const u = units[idx]
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
          },
        ])
        .select('id')
        .single()
      if (ins.error) throw ins.error
      planUnitIdByIdx.set(idx, ins.data.id)
    }

    // insert item assignments
    for (const p of placements) {
      const ins = await database
        .from('assignment_plan_item_assignments')
        .insert([
          {
            plan_unit_id: planUnitIdByIdx.get(p.unitIdx),
            load_id: p.item.load_id,
            order_id: p.item.order_id,
            item_id: p.item.item_id,
            assigned_weight_kg: p.weight,
            priority_note: 'auto',
          },
        ])
      if (ins.error) throw ins.error
    }

    // recalc used capacity
    await recalcUsedCapacity(plan.id)

    // fetch live view
    const unitsDb = await fetchPlanUnits(plan.id)
    const assignsDb = await fetchPlanAssignments(plan.id)
    const bucket = await fetchUnassignedBucket(plan.id)
    const nested = buildNested(unitsDb, assignsDb, bucket)

    return res.status(200).json(
      new Response(200, 'OK', 'Auto-assignment committed', {
        plan,
        ...nested,
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/** MANUAL ASSIGN (add/move an item to a unit; creates unit snapshot if needed) */
export const manuallyAssign = async (req, res) => {
  try {
    const { planId } = req.params
    const {
      plan_unit_id,
      rigid_id,
      trailer_id,
      horse_id,
      load_id,
      order_id,
      item_id,
      assigned_weight_kg,
      priority_note = 'manual',
    } = req.body || {}

    if (!load_id || !order_id || !item_id || !assigned_weight_kg) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'load_id, order_id, item_id, assigned_weight_kg are required'
          )
        )
    }

    // ensure plan exists
    await fetchPlan(planId)

    let targetPlanUnitId = plan_unit_id

    // resolve/create target plan unit if not provided
    if (!targetPlanUnitId) {
      // find a dispatchable unit by vehicle ids
      let q = database.from('v_dispatch_units').select('*')
      if (rigid_id) q = q.eq('rigid_id', rigid_id)
      if (trailer_id) q = q.eq('trailer_id', trailer_id)
      if (horse_id) q = q.eq('horse_id', horse_id)
      const found = await q
      if (found.error) throw found.error
      if (!found.data || found.data.length === 0) {
        return res
          .status(404)
          .json(new Response(404, 'Not Found', 'Target vehicle/unit not found'))
      }
      const u = found.data[0]
      const created = await database
        .from('assignment_plan_units')
        .insert([
          {
            plan_id: planId,
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
          },
        ])
        .select('id')
        .single()
      if (created.error) throw created.error
      targetPlanUnitId = created.data.id
    }

    // create assignment row
    const ins = await database.from('assignment_plan_item_assignments').insert([
      {
        plan_unit_id: targetPlanUnitId,
        load_id,
        order_id,
        item_id,
        assigned_weight_kg,
        priority_note,
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

/** UNASSIGN one assignment row */
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

/** UNASSIGN all in plan (keep plan + units) */
export const unassignAll = async (req, res) => {
  try {
    const { planId } = req.params
    const del = await database.rpc('exec_sql', {
      // if you don’t have exec_sql, replace with two calls: first select unit ids, then delete with .in()
      query: `
          delete from public.assignment_plan_item_assignments
          where plan_unit_id in (select id from public.assignment_plan_units where plan_id = $1)
          returning 1;
        `,
      params: [planId],
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

/** FETCH per-vehicle */
export const getPlanById = async (req, res) => {
  try {
    const { planId, unitId } = req.params
    const unitsDb = await fetchPlanUnits(planId)
    const unit = unitsDb.find((u) => String(u.plan_unit_id) === String(unitId))
    if (!unit)
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Unit not found'))
    const all = await fetchPlanAssignments(planId)
    const mine = all.filter((a) => String(a.plan_unit_id) === String(unitId))
    const bucket = await fetchUnassignedBucket(planId)
    return res
      .status(200)
      .json(
        new Response(
          200,
          'OK',
          'Unit fetched',
          buildNested([unit], mine, bucket)
        )
      )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
