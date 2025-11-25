import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

/* ============================== getPlan ============================== */

/**
 * GET /planner/plans/:plan_id
 *
 * Returns:
 *  {
 *    plan: { ... },
 *    units: [
 *      {
 *        planned_unit_id,
 *        vehicle_assignment_id,
 *        vehicle_id,
 *        vehicle_type,
 *        vehicle: {...},
 *        status,
 *        notes,
 *        summary: { orders_assigned, items_assigned, total_quantity, total_weight },
 *        orders: [
 *          {
 *            order_id,
 *            ... order fields ...,
 *            lines: [ ... ]
 *          }
 *        ]
 *      }
 *    ],
 *    unassigned_orders: [ ... ]
 *  }
 */
export const getPlan = async (req, res) => {
  try {
    const planId = req.params.plan_id || req.query.plan_id
    if (!planId) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'plan_id is required in path or query'
          )
        )
    }

    const payload = await planningService.getPlanById(planId)
    return res
      .status(200)
      .json(new Response(200, 'OK', 'Plan fetched', payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
