// controllers/planner/add-plan.js

import database from '../../config/supabase.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'
import { asBool } from '../../utils/assignment-utils.js'
import { Response } from '../../utils/classes.js'

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
    const {
      plan_name,
      delivery_start,
      delivery_end,
      scope_all_branches,
      notes = null,
      status,
    } = req.body || {}

    if (!plan_name || !delivery_start) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'plan_name and delivery_start are required'
          )
        )
    }

    const startDate = delivery_start
    const endDate = delivery_end || delivery_start
    const scopeAllBranches = asBool(scope_all_branches, true)
    const planStatus = status || 'planning'

    // Basic check: start <= end (string compare on ISO dates works)
    if (startDate > endDate) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'delivery_start cannot be after delivery_end'
          )
        )
    }

    // Insert plan
    const { data: inserted, error: insErr } = await database
      .from('plans')
      .insert([
        {
          plan_name,
          delivery_start: startDate,
          delivery_end: endDate,
          scope_all_branches: scopeAllBranches,
          notes,
          status: planStatus,
        },
      ])
      .select('*')
      .single()

    if (insErr) throw insErr

    // Build full payload (plan + units + unassigned_orders)
    const payload = await buildPlanPayload(inserted.id)

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
