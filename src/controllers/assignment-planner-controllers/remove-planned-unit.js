// controllers/planner/remove-planned-unit.js

import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

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

    const payload = await planningService.removePlannedUnit({
      planId: plan_id,
      plannedUnitId: planned_unit_id
    })

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
