import {
  buildNested,
  fetchPlanAssignments,
  fetchPlanUnits,
  fetchTripsUsedByVehicle,
  fetchUnassignedBucket,
  fetchUnits,
  recalcUsedCapacity,
  vehicleKey,
} from '../../helpers/assignment-planner-helpers.js'
import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'

/**
 * Unified getPlan endpoint:
 *  - plan-only (default)
 *  - full nested (include_nested=true)
 *  - single unit nested (unit_id provided)
 *
 * Body (or params):
 *  - plan_id: uuid (required)
 *  - include_nested?: boolean (default false)
 *  - unit_id?: uuid (optional; if set, returns nested for that one unit only)
 *  - include_idle?: boolean (optional; only used when include_nested=true and unit_id is NOT set)
 */
export const getPlan = async (req, res) => {
  try {
    const plan_id = req.body?.plan_id ?? req.params?.planId
    const include_nested = req.body?.include_nested ?? true
    const include_idle = req.body?.include_idle ?? false
    const unit_id = req.body?.unit_id ?? req.params?.unitId ?? null

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }

    // 1) Fetch plan
    const planQ = await database
      .from('assignment_plans')
      .select(
        'id, departure_date, scope_branch_id, scope_customer_id, notes, created_at, updated_at'
      )
      .eq('id', plan_id)
      .single()
    if (planQ.error) throw planQ.error
    if (!planQ.data) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Plan not found'))
    }
    const plan = planQ.data

    // Fast path: plan only
    if (!include_nested && !unit_id) {
      return res.status(200).json(new Response(200, 'OK', 'Plan', { plan }))
    }

    // Keep capacity current
    await recalcUsedCapacity(plan.id)

    // 2) Load units/assignments/bucket
    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(plan.id),
      fetchPlanAssignments(plan.id),
      fetchUnassignedBucket(plan.id),
    ])

    // build a weight sum per unit
    const usedByUnit = new Map()
    for (const a of assignsDb || []) {
      const id = a.plan_unit_id
      const w = Number(a.assigned_weight_kg || 0)
      usedByUnit.set(id, (usedByUnit.get(id) || 0) + w)
    }

    // patch units in-memory before buildNested
    const patchedUnits = (unitsDb || []).map((u) => {
      const live = Number(usedByUnit.get(u.plan_unit_id) || 0)
      const stored = Number(u.used_capacity_kg || 0)
      return {
        ...u,
        used_capacity_kg: live > 0 ? Number(live.toFixed(3)) : stored, // prefer live if > 0
      }
    })

    // then pass patchedUnits into buildNested

    // 3) If unit_id provided → return nested just for that unit (like your snippet)
    if (unit_id) {
      const unit = unitsDb.find(
        (u) => String(u.plan_unit_id) === String(unit_id)
      )
      if (!unit) {
        return res
          .status(404)
          .json(new Response(404, 'Not Found', 'Unit not found'))
      }

      const mine = assignsDb.filter(
        (a) => String(a.plan_unit_id) === String(unit_id)
      )
      // Fallback compute used if missing
      const computedUsed = mine.reduce(
        (s, r) => s + Number(r.assigned_weight_kg || 0),
        0
      )
      const patchedUnit = {
        ...unit,
        used_capacity_kg:
          Number(unit.used_capacity_kg || 0) > 0
            ? Number(unit.used_capacity_kg)
            : Number(computedUsed.toFixed(3)),
      }

      //  const nested = buildNested([patchedUnit], mine, bucket)
      const nested = buildNested(patchedUnits, assignsDb, bucket)
      return res
        .status(200)
        .json(new Response(200, 'OK', 'Unit fetched', { plan, ...nested }))
    }

    // 4) Otherwise: full nested plan (optionally include idle list)
    const nested = buildNested(unitsDb, assignsDb, bucket)

    if (!include_idle) {
      return res.status(200).json(
        new Response(200, 'OK', 'Plan with nested manifest', {
          plan,
          ...nested,
        })
      )
    }

    // Idle units for the plan date (trips < 2)
    const tripsUsedMap = await fetchTripsUsedByVehicle(
      database,
      plan.departure_date
    )
    const branchFilter = Array.isArray(plan.scope_branch_id)
      ? plan.scope_branch_id.length
        ? plan.scope_branch_id
        : null
      : plan.scope_branch_id || null
    const allUnits = await fetchUnits(branchFilter)

    let branchNameById = new Map()
    try {
      const { data: branchRows } = await database
        .from('branches')
        .select('id,name')
      if (branchRows?.length)
        branchNameById = new Map(branchRows.map((b) => [String(b.id), b.name]))
    } catch {}

    const idleBy = new Map()
    for (const u of allUnits) {
      const key = vehicleKey(u)
      const trips = Number(tripsUsedMap.get(key) || 0)
      if (trips >= 2) continue
      const bKey = u.branch_id == null ? 'unknown' : String(u.branch_id)
      if (!idleBy.has(bKey)) {
        idleBy.set(bKey, {
          branch_id: u.branch_id ?? null,
          branch_name:
            branchNameById.get(String(u.branch_id ?? '')) ||
            (u.branch_id == null ? 'Unknown' : null),
          total_idle: 0,
          units: [],
        })
      }
      idleBy.get(bKey).total_idle += 1
      idleBy.get(bKey).units.push({
        unit_key:
          u.unit_type === 'rigid'
            ? `rigid:${u.rigid_id ?? 'nil'}`
            : u.unit_type === 'horse+trailer'
            ? `horse:${u.horse_id ?? 'nil'}|trailer:${u.trailer_id ?? 'nil'}`
            : `unit:${u.rigid_id || u.horse_id || u.trailer_id || 'nil'}`,
        unit_type: u.unit_type,
        driver_id: u.driver_id,
        driver_name: u.driver_name,
        fleet_number: u.rigid_fleet || u.horse_fleet || u.trailer_fleet || null,
        plate: u.rigid_plate || u.horse_plate || u.trailer_plate || null,
        capacity_kg: Number(u.capacity_kg),
        length_mm: u.length_mm || 0,
        category: u.category || '',
        priority: u.priority || 0,
        branch_id: u.branch_id ?? null,
        branch_name: branchNameById.get(String(u.branch_id ?? '')) || null,
        trips_used_today: trips,
      })
    }
    const idle_units_by_branch = Array.from(idleBy.values()).sort((a, b) =>
      String(a.branch_name || '').localeCompare(String(b.branch_name || ''))
    )

    return res.status(200).json(
      new Response(200, 'OK', 'Plan with nested manifest and idle units', {
        plan,
        ...nested,
        idle_units_by_branch,
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
