// controllers/assignment-planner-controllers/set-unit-note.js
import database from '../../config/supabase.js'
import { Response } from '../../utils/classes.js'
import {
  recalcUsedCapacity,
  fetchPlanUnits,
  fetchPlanAssignments,
  fetchUnassignedBucket,
  buildNested,
} from '../../helpers/assignment-planner-helpers.js'

/**
 * Set or clear a per-unit note (ops_note) on assignment_plan_units.
 *
 * Body:
 *  - plan_id: uuid (required)
 *  - plan_unit_id: uuid (required)
 *  - note: string | null | ''  (empty/null clears the note)
 *
 * Returns:
 *  - 200 with the same nested payload shape used elsewhere in the planner
 */
export const setUnitNote = async (req, res) => {
  try {
    const { plan_id, plan_unit_id, note } = req.body || {}

    if (!plan_id || !plan_unit_id) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'plan_id and plan_unit_id are required'
          )
        )
    }

    // Ensure unit exists and belongs to the plan (avoid cross-plan updates)
    const { data: unit, error: unitErr } = await database
      .from('assignment_plan_units')
      .select('id, plan_id')
      .eq('id', plan_unit_id)
      .single()

    if (unitErr || !unit || unit.plan_id !== plan_id) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Unit not found in this plan'))
    }

    // Upsert note; empty string/null clears it
    const sanitized = (note ?? '').toString().trim()
    const ops_note = sanitized.length ? sanitized : null

    const { error: upErr } = await database
      .from('assignment_plan_units')
      .update({ ops_note })
      .eq('id', plan_unit_id)

    if (upErr) throw upErr

    // Keep capacity current and return standard nested payload
    await recalcUsedCapacity(plan_id)
    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(plan_id),
      fetchPlanAssignments(plan_id),
      fetchUnassignedBucket(plan_id),
    ])

    return res.status(200).json(
      new Response(200, 'OK', ops_note ? 'Note saved' : 'Note cleared', {
        ...buildNested(unitsDb, assignsDb, bucket),
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
