import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'

/* ============================== unassignUnit ============================== */

/**
 * POST /planner/unassign-unit
 *
 * Body:
 * {
 *   "plan_id": "uuid",
 *   "planned_unit_id": "uuid",
 *   "order_ids": ["uuid", ...]   // optional; if omitted, unassign all orders from this unit in this plan
 * }
 */
export const unassign = async (req, res) => {
  try {
    const { plan_id, planned_unit_id, order_ids } = req.body || {}

    if (!plan_id || !planned_unit_id) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'plan_id and planned_unit_id are required'
          )
        )
    }

    // Validate planned_unit belongs to plan
    const { data: units, error: unitsErr } = await database
      .from('planned_units')
      .select('id, plan_id')
      .eq('id', planned_unit_id)
      .limit(1)

    if (unitsErr) throw unitsErr
    const unit = units && units[0]
    if (!unit || unit.plan_id !== plan_id) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'planned_unit_id does not belong to the specified plan'
          )
        )
    }

    // Determine which orders to unassign
    const baseQuery = database
      .from('loads')
      .select('id')
      .eq('assignment_plan_id', plan_id)
      .eq('assigned_unit_id', planned_unit_id)

    let loadsQuery = baseQuery
    if (Array.isArray(order_ids) && order_ids.length) {
      loadsQuery = loadsQuery.in('id', order_ids)
    }

    const { data: loadsToUnassign, error: loadsErr } = await loadsQuery
    if (loadsErr) throw loadsErr

    const ids = (loadsToUnassign || []).map((l) => l.id)
    if (!ids.length) {
      const payload = await buildPlanPayload(plan_id)
      return res.status(200).json(
        new Response(200, 'OK', 'No orders to unassign', {
          ...payload,
        })
      )
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

    const payload = await buildPlanPayload(plan_id)
    return res
      .status(200)
      .json(new Response(200, 'OK', 'Orders unassigned', payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
