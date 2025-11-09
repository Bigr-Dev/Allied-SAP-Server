// controllers/assignment-planner-controllers/set-unit-note.js
import database from '../../config/supabase.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'
import { Response } from '../../utils/classes.js'

/* ============================== setUnitNote ============================== */

/**
 * POST /planner/set-unit-note
 *
 * Body:
 * {
 *   "plan_id": "uuid",
 *   "planned_unit_id": "uuid",
 *   "note": "string or null"
 * }
 */
export const setUnitNote = async (req, res) => {
  try {
    const { plan_id, planned_unit_id, note } = req.body || {}

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

    // Ensure unit belongs to the plan
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

    const { error: updErr } = await database
      .from('planned_units')
      .update({
        notes: note ?? null,
      })
      .eq('id', planned_unit_id)
      .eq('plan_id', plan_id)

    if (updErr) throw updErr

    // Return refreshed plan payload (so UI has updated notes + metrics)
    const payload = await buildPlanPayload(plan_id)
    return res
      .status(200)
      .json(new Response(200, 'OK', 'Unit note updated', payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
