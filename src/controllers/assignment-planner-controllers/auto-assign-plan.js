// controllers/planner/auto-assign-plan.js

import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

/**
 * Auto-assign orders in a plan to vehicles per route.
 */
export const autoAssignLoads = async (req, res) => {
  try {
    const body = req.body || {}
    const planId = body.plan_id

    const payload = await planningService.autoAssignPlan({ planId, ...body })

    const message = 'Auto-assignment completed successfully'
    return res.status(200).json(new Response(200, 'OK', message, payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}