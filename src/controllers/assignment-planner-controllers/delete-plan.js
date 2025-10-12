import database from '../../config/supabase.js'
import { Response } from '../../utils/classes.js'

export const deletePlan = async (req, res) => {
  try {
    const plan_id = req.params?.plan_id || req.params?.planId || null
    console.log('plan_id :>> ', plan_id)
    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }

    // Optional: check existence for nicer 404
    const planQ = await database
      .from('assignment_plans')
      .select('id, departure_date')
      .eq('id', plan_id)
      .single()
    if (planQ.error) throw planQ.error
    if (!planQ.data) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Plan not found'))
    }

    const { error } = await database.rpc('sp_delete_plan', {
      p_plan_id: plan_id,
    })
    if (error) throw error

    return res.status(200).json(
      new Response(200, 'OK', 'Plan deleted', {
        plan_id,
        departure_date: planQ.data.departure_date,
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
