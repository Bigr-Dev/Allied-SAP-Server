import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

/* ============================== unassignUnit ============================== */

/**
 * POST /planner/unassign-unit
 *
 * Body:
 * {
 *   "plan_id": "uuid",
 *   "planned_unit_id": "uuid",
 *   "order_ids": ["uuid", ...]   // optional; if omitted, unassign all orders from this unit in this plan
 * }
 */
export const unassign = async (req, res) => {
  try {
    const { plan_id, planned_unit_id, order_ids } = req.body || {}

    const payload = await planningService.unassignOrders({
      planId: plan_id,
      plannedUnitId: planned_unit_id,
      orderIds: order_ids
    })

    return res
      .status(200)
      .json(new Response(200, 'OK', 'Orders unassigned', payload))
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
