// controllers/planner/delete-plan.js

import { Response } from '../../utils/classes.js'
import * as planningService from '../../domain/planning/index.js'

export const deletePlan = async (req, res) => {
  try {
    const plan_id =
      req.params?.plan_id || req.params?.planId || req.body?.plan_id || null

    const result = await planningService.deletePlan(plan_id)

    return res.status(200).json(
      new Response(200, 'OK', 'Plan deleted', result)
    )
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
