// controllers/assignment-planner-controllers/set-unit-note.js
import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

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

    const payload = await planningService.setPlannedUnitNote({
      planId: plan_id,
      plannedUnitId: planned_unit_id,
      note
    })

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
