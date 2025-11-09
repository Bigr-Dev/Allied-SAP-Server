// controllers/planner/add-idle-unit.js

import database from '../../config/supabase.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'
import { Response } from '../../utils/classes.js'

/**
 * Add an idle unit (planned unit) to an existing plan.
 *
 * Body:
 *  - plan_id: uuid (required)
 *  - vehicle_assignment_id: uuid (required)
 *  - status?: 'active' | 'paused' | 'oos' (default 'active')
 *  - notes?: string
 */
export const addIdleUnit = async (req, res) => {
  try {
    const {
      plan_id,
      vehicle_assignment_id,
      status = 'active',
      notes = null,
    } = req.body || {}

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }
    if (!vehicle_assignment_id) {
      return res
        .status(400)
        .json(
          new Response(400, 'Bad Request', 'vehicle_assignment_id is required')
        )
    }

    // 1) Check plan exists
    const { data: plans, error: planErr } = await database
      .from('plans')
      .select('id, plan_name, delivery_start, delivery_end')
      .eq('id', plan_id)
      .limit(1)

    if (planErr) throw planErr
    const plan = plans && plans[0]
    if (!plan) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Plan not found'))
    }

    // 2) Check vehicle_assignment exists (and optionally is active)
    const { data: vas, error: vaErr } = await database
      .from('vehicle_assignments')
      .select('id, status')
      .eq('id', vehicle_assignment_id)
      .limit(1)

    if (vaErr) throw vaErr
    const va = vas && vas[0]
    if (!va) {
      return res
        .status(404)
        .json(
          new Response(
            404,
            'Not Found',
            'Vehicle assignment not found for vehicle_assignment_id'
          )
        )
    }

    // optional: only allow active assignments
    // if (va.status !== 'active') { ... }

    // 3) Prevent duplicate unit (plan_id, vehicle_assignment_id)
    const { data: existingUnits, error: existErr } = await database
      .from('planned_units')
      .select('id')
      .eq('plan_id', plan_id)
      .eq('vehicle_assignment_id', vehicle_assignment_id)
      .limit(1)

    if (existErr) throw existErr
    if (existingUnits && existingUnits[0]) {
      // Already exists; return plan as-is
      const payload = await buildPlanPayload(plan_id)
      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            'Unit already present in this plan (no new unit created)',
            payload
          )
        )
    }

    // 4) Insert planned_unit
    const { data: inserted, error: insErr } = await database
      .from('planned_units')
      .insert([
        {
          plan_id,
          vehicle_assignment_id,
          status,
          notes,
        },
      ])
      .select('*')
      .single()

    if (insErr) throw insErr

    // 5) Return refreshed plan payload
    const payload = await buildPlanPayload(plan_id)
    return res
      .status(200)
      .json(new Response(200, 'OK', 'Unit added to plan', payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
