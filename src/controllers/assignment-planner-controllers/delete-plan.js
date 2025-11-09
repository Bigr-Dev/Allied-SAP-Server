// controllers/planner/delete-plan.js

import database from '../../config/supabase.js'
import { Response } from '../../utils/classes.js'

export const deletePlan = async (req, res) => {
  try {
    const plan_id =
      req.params?.plan_id || req.params?.planId || req.body?.plan_id || null

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
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

    // 2) Unassign all loads & load_items associated with this plan
    // Clear load_items first
    const { error: itemsErr } = await database
      .from('load_items')
      .update({
        assignment_plan_id: null,
        assigned_unit_id: null,
      })
      .eq('assignment_plan_id', plan_id)

    if (itemsErr) throw itemsErr

    // Then clear loads
    const { error: loadsErr } = await database
      .from('loads')
      .update({
        assignment_plan_id: null,
        assigned_unit_id: null,
        is_split: false,
      })
      .eq('assignment_plan_id', plan_id)

    if (loadsErr) throw loadsErr

    // 3) Delete planned_units for this plan
    // (If planned_units.plan_id has ON DELETE CASCADE, you can skip this and just delete the plan.)
    const { error: unitsErr } = await database
      .from('planned_units')
      .delete()
      .eq('plan_id', plan_id)

    if (unitsErr) throw unitsErr

    // 4) Delete the plan itself
    const { error: delPlanErr } = await database
      .from('plans')
      .delete()
      .eq('id', plan_id)

    if (delPlanErr) throw delPlanErr

    return res.status(200).json(
      new Response(200, 'OK', 'Plan deleted', {
        plan_id,
        plan_name: plan.plan_name,
        delivery_start: plan.delivery_start,
        delivery_end: plan.delivery_end,
      })
    )
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
