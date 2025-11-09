import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'

/* ============================== bulkAssign ============================== */

/**
 * POST /plan/bulk-assign
 *
 * Body:
 * {
 *   "plan_id": "uuid",
 *   "assignments": [
 *     {
 *       "planned_unit_id": "uuid",
 *       "orders": [
 *         { "order_id": "uuid" }
 *       ]
 *     }
 *   ]
 * }
 */
export const bulkAssign = async (req, res) => {
  try {
    const { plan_id, assignments } = req.body || {}

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }

    if (!Array.isArray(assignments) || !assignments.length) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'assignments must be a non-empty array'
          )
        )
    }

    // 1) Validate plan
    const { data: plans, error: planErr } = await database
      .from('plans')
      .select('id, delivery_start, delivery_end')
      .eq('id', plan_id)
      .limit(1)

    if (planErr) throw planErr
    const plan = plans && plans[0]
    if (!plan) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Plan not found'))
    }

    // 2) Validate planned units belong to this plan
    const requestedUnitIds = [
      ...new Set(
        assignments.map((a) => a.planned_unit_id).filter((id) => !!id)
      ),
    ]

    if (!requestedUnitIds.length) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'Each assignment must have a planned_unit_id'
          )
        )
    }

    const { data: units, error: unitsErr } = await database
      .from('planned_units')
      .select('id, plan_id')
      .in('id', requestedUnitIds)

    if (unitsErr) throw unitsErr

    const validUnitIds = new Set(
      (units || []).filter((u) => u.plan_id === plan_id).map((u) => u.id)
    )

    for (const id of requestedUnitIds) {
      if (!validUnitIds.has(id)) {
        return res
          .status(400)
          .json(
            new Response(
              400,
              'Bad Request',
              `planned_unit_id ${id} does not belong to plan ${plan_id}`
            )
          )
      }
    }

    // 3) Flatten requested order_ids
    const pairs = [] // { planned_unit_id, order_id }
    const allOrderIds = new Set()

    for (const a of assignments) {
      if (!a || !a.planned_unit_id || !Array.isArray(a.orders)) continue
      for (const o of a.orders) {
        if (!o || !o.order_id) continue
        pairs.push({
          planned_unit_id: a.planned_unit_id,
          order_id: o.order_id,
        })
        allOrderIds.add(o.order_id)
      }
    }

    if (!pairs.length) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'No valid (planned_unit_id, order_id) pairs found in assignments'
          )
        )
    }

    const orderIdArray = Array.from(allOrderIds)

    // 4) Fetch candidate orders (unassigned, in plan window)
    const { data: orders, error: ordersErr } = await database
      .from('loads')
      .select(
        'id, sales_order_number, delivery_date, assignment_plan_id, assigned_unit_id, customer_id'
      )
      .in('id', orderIdArray)

    if (ordersErr) throw ordersErr

    const byId = new Map()
    for (const o of orders || []) {
      // Must not already be assigned to another plan
      if (o.assignment_plan_id && o.assignment_plan_id !== plan_id) {
        continue
      }
      // optional: enforce in-window
      if (
        o.delivery_date < plan.delivery_start ||
        o.delivery_date > plan.delivery_end
      ) {
        continue
      }
      // Only accept currently unassigned
      if (o.assignment_plan_id) continue
      byId.set(o.id, o)
    }

    // Filter pairs to actual candidates
    const effectiveAssignments = pairs.filter((p) => byId.has(p.order_id))

    if (!effectiveAssignments.length) {
      const payload = await buildPlanPayload(plan_id)
      return res.status(200).json(
        new Response(200, 'OK', 'No orders could be assigned', {
          ...payload,
        })
      )
    }

    // Group order_ids by planned_unit_id
    const ordersByUnit = new Map()
    for (const p of effectiveAssignments) {
      if (!ordersByUnit.has(p.planned_unit_id)) {
        ordersByUnit.set(p.planned_unit_id, new Set())
      }
      ordersByUnit.get(p.planned_unit_id).add(p.order_id)
    }

    // 5) Apply updates (no explicit DB transaction available via Supabase client,
    //    but we keep operations simple and idempotent)
    for (const [unitId, idsSet] of ordersByUnit.entries()) {
      const ids = Array.from(idsSet)

      if (!ids.length) continue

      // Update loads (header)
      const { error: updLoadsErr } = await database
        .from('loads')
        .update({
          assignment_plan_id: plan_id,
          assigned_unit_id: unitId,
          is_split: false,
        })
        .in('id', ids)

      if (updLoadsErr) throw updLoadsErr

      // Mirror to load_items
      const { error: updItemsErr } = await database
        .from('load_items')
        .update({
          assignment_plan_id: plan_id,
          assigned_unit_id: unitId,
        })
        .in('order_id', ids)

      if (updItemsErr) throw updItemsErr
    }

    // 6) Return updated plan payload
    const payload = await buildPlanPayload(plan_id)
    return res
      .status(200)
      .json(new Response(200, 'OK', 'Orders assigned', payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
