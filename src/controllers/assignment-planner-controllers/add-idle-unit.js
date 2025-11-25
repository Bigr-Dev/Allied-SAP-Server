// controllers/planner/add-idle-unit.js

import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

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

    const payload = await planningService.addIdleUnitToPlan({
      planId: plan_id,
      vehicle_assignment_id,
      status,
      notes
    })

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
