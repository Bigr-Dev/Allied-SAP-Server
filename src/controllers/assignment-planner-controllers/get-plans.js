import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'
import { asBool, toInt } from '../../utils/assignment-utils.js'

/* ============================== getPlans ============================== */

/**
 * GET /planner/plans
 *
 * Query params:
 *  - limit, offset, order ('asc'|'desc')
 *  - date_from (YYYY-MM-DD)
 *  - date_to   (YYYY-MM-DD)
 *  - include_units      ('true'|'false')
 *  - include_counts     ('true'|'false')
 *  - include_unassigned ('true'|'false')
 */
export const getAllPlans = async (req, res) => {
  try {
    const {
      limit = 50,
      offset = 0,
      order = 'desc',
      date_from,
      date_to,
      include_units,
      include_counts,
      include_unassigned,
    } = req.query

    const limitNum = toInt(limit, 50)
    const offsetNum = toInt(offset, 0)
    const ascending = String(order).toLowerCase() === 'asc'

    const wantUnits = asBool(include_units, false)
    const wantCounts = asBool(include_counts, false)
    const wantUnassigned = asBool(include_unassigned, false)

    // base query on plans
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
      return res.status(200).json(
        new Response(200, 'OK', 'No plans found', {
          total: 0,
          limit: limitNum,
          offset: offsetNum,
          plans: [],
        })
      )
    }

    const planIds = planList.map((p) => p.id)

    // attach plan_unit_ids and/or counts as needed
    let unitsByPlan = new Map()
    if (wantUnits || wantCounts) {
      const { data: units, error: unitsErr } = await database
        .from('planned_units')
        .select('id, plan_id')
        .in('plan_id', planIds)

      if (unitsErr) throw unitsErr

      unitsByPlan = new Map()
      for (const u of units || []) {
        if (!unitsByPlan.has(u.plan_id)) {
          unitsByPlan.set(u.plan_id, [])
        }
        unitsByPlan.get(u.plan_id).push(u.id)
      }
    }

    let summaryByPlan = new Map()
    if (wantCounts) {
      const { data: rows, error: rowsErr } = await database
        .from('v_plan_units_summary')
        .select('plan_id, planned_unit_id, orders_assigned, total_weight')
        .in('plan_id', planIds)

      if (rowsErr) throw rowsErr

      summaryByPlan = new Map()
      for (const r of rows || []) {
        if (!summaryByPlan.has(r.plan_id)) {
          summaryByPlan.set(r.plan_id, {
            units_count: 0,
            orders_count: 0,
            total_weight: 0,
          })
        }
        const agg = summaryByPlan.get(r.plan_id)
        agg.units_count += 1
        agg.orders_count += Number(r.orders_assigned || 0)
        agg.total_weight += Number(r.total_weight || 0)
      }
    }

    let unassignedCounts = new Map()
    if (wantUnassigned) {
      const { data: rows, error: rowsErr } = await database
        .from('v_unassigned_orders')
        .select('plan_id, order_id')
        .in('plan_id', planIds)

      if (rowsErr) throw rowsErr

      unassignedCounts = new Map()
      for (const r of rows || []) {
        unassignedCounts.set(
          r.plan_id,
          (unassignedCounts.get(r.plan_id) || 0) + 1
        )
      }
    }

    const augmented = planList.map((p) => {
      const base = {
        ...p,
      }

      if (wantUnits) {
        base.plan_unit_ids = unitsByPlan.get(p.id) || []
      }

      if (wantCounts) {
        const agg = summaryByPlan.get(p.id) || {
          units_count: 0,
          orders_count: 0,
          total_weight: 0,
        }
        base.summary = agg
      }

      if (wantUnassigned) {
        base.unassigned_count = unassignedCounts.get(p.id) || 0
      }

      return base
    })

    return res.status(200).json(
      new Response(200, 'OK', 'Plans fetched', {
        total: typeof count === 'number' ? count : augmented.length,
        limit: limitNum,
        offset: offsetNum,
        plans: augmented,
      })
    )
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
