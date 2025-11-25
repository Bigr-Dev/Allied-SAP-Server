import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

/* ============================== getPlans ============================== */

/**
 * GET /planner/plans
 *
 * Query params:
 *  - limit, offset, order ('asc'|'desc')
 *  - date_from (YYYY-MM-DD)
 *  - date_to   (YYYY-MM-DD)
 *  - include_units      ('true'|'false')
 *  - include_counts     ('true'|'false')
 *  - include_unassigned ('true'|'false')
 */
export const getAllPlans = async (req, res) => {
  try {
    const filters = req.query
    const result = await planningService.listPlans(filters)

    if (!result.plans.length) {
      return res.status(200).json(
        new Response(200, 'OK', 'No plans found', result)
      )
    }

    return res.status(200).json(
      new Response(200, 'OK', 'Plans fetched', result)
    )
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
