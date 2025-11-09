// controllers/planner/remove-planned-unit.js

import database from '../../config/supabase.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'
import { Response } from '../../utils/classes.js'

/* ========================================================================== */
/* Controller: remove planned unit from plan (if it has no orders assigned)   */
/* ========================================================================== */

/**
 * POST /planner/remove-planned-unit
 *
 * Body:
 * {
 *   "plan_id": "uuid",
 *   "planned_unit_id": "uuid"
 * }
 *
 * Behaviour:
 *  - Ensure the planned_unit belongs to the given plan
 *  - Check that no loads are assigned:
 *      loads.assignment_plan_id = plan_id AND loads.assigned_unit_id = planned_unit_id
 *  - If any loads exist: 400 error (cannot remove)
 *  - If none: delete from planned_units
 *  - Return updated plan payload (same as getPlan)
 */
export const removePlannedUnit = async (req, res) => {
  try {
    const { plan_id, planned_unit_id } = req.body || {}

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

    // 1) Validate that the planned unit exists and belongs to this plan
    const { data: units, error: unitErr } = await database
      .from('planned_units')
      .select('id, plan_id')
      .eq('id', planned_unit_id)
      .limit(1)

    if (unitErr) throw unitErr

    const unit = units && units[0]
    if (!unit) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Planned unit not found'))
    }

    if (unit.plan_id !== plan_id) {
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

    // 2) Check if any orders are assigned to this unit in this plan
    const { count, error: loadCountErr } = await database
      .from('loads')
      .select('id', { count: 'exact', head: true })
      .eq('assignment_plan_id', plan_id)
      .eq('assigned_unit_id', planned_unit_id)

    if (loadCountErr) throw loadCountErr

    if (typeof count === 'number' && count > 0) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'Cannot remove planned unit: there are orders assigned to it'
          )
        )
    }

    // (Optional extra safety: ensure no load_items still pointing at this unit)
    const { count: itemCount, error: itemErr } = await database
      .from('load_items')
      .select('order_line_id', { count: 'exact', head: true })
      .eq('assignment_plan_id', plan_id)
      .eq('assigned_unit_id', planned_unit_id)

    if (itemErr) throw itemErr

    if (typeof itemCount === 'number' && itemCount > 0) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'Cannot remove planned unit: there are load items still assigned to it'
          )
        )
    }

    // 3) Safe to delete the planned unit
    const { error: delErr } = await database
      .from('planned_units')
      .delete()
      .eq('id', planned_unit_id)
      .eq('plan_id', plan_id)

    if (delErr) throw delErr

    // 4) Return updated plan payload so UI can refresh
    const payload = await buildPlanPayload(plan_id)

    return res.status(200).json(
      new Response(200, 'OK', 'Planned unit removed from plan', {
        removed_planned_unit_id: planned_unit_id,
        ...payload,
      })
    )
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
