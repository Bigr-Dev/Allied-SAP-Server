// controllers/planner/add-plan.js

import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

/* ========================================================================== */
/* Controller: addPlan                                                        */
/* ========================================================================== */

/**
 * POST /planner/add-plan
 *
 * Body:
 * {
 *   "plan_name": "string",          // required
 *   "delivery_start": "YYYY-MM-DD", // required
 *   "delivery_end": "YYYY-MM-DD",   // optional, defaults to delivery_start
 *   "scope_all_branches": true,     // optional, default true
 *   "notes": "string",              // optional
 *   "status": "planning"            // optional, default 'planning'
 * }
 */
export const addPlan = async (req, res) => {
  try {
    const payload = await planningService.createPlan(req.body || {})

    return res
      .status(201)
      .json(new Response(201, 'Created', 'Plan created', payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
