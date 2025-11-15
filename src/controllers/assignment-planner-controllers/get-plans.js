import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'
import { asBool, toInt } from '../../utils/assignment-utils.js'
import { buildPlanPayload } from '../../helpers/assignment-helpers.js'

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
    const {
      limit = 50,
      offset = 0,
      order = 'desc',
      date_from,
      date_to,
      include_units,
      include_counts,
      include_unassigned,
    } = req.query

    const limitNum = toInt(limit, 50)
    const offsetNum = toInt(offset, 0)
    const ascending = String(order).toLowerCase() === 'asc'

    const wantUnits = asBool(include_units, false)
    const wantCounts = asBool(include_counts, false)
    const wantUnassigned = asBool(include_unassigned, false)

    // base query on plans
    let q = database
      .from('plans')
      .select(
        'id, plan_name, delivery_start, delivery_end, scope_all_branches, status, notes, created_at, updated_at',
        { count: 'exact' }
      )

    if (date_from) {
      q = q.gte('delivery_start', date_from)
    }
    if (date_to) {
      q = q.lte('delivery_end', date_to)
    }

    q = q
      .order('delivery_start', { ascending })
      .order('created_at', { ascending })
      .range(offsetNum, offsetNum + limitNum - 1)

    const { data: plans, count, error } = await q
    if (error) throw error

    const planList = plans || []
    if (!planList.length) {
      return res.status(200).json(
        new Response(200, 'OK', 'No plans found', {
          total: 0,
          limit: limitNum,
          offset: offsetNum,
          plans: [],
        })
      )
    }

    const augmented = await Promise.all(
      planList.map(async (p) => {
        const base = { ...p }

        if (wantUnits || wantCounts || wantUnassigned) {
          const payload = await buildPlanPayload(p.id)
          
          if (wantUnits) {
            base.plan_unit_ids = payload.units.map(u => u.planned_unit_id)
          }

          if (wantCounts) {
            base.summary = {
              units_count: payload.units.length,
              orders_count: payload.assigned_orders.length,
              total_weight: payload.units.reduce((sum, u) => sum + (u.summary?.total_weight || 0), 0),
            }
          }

          if (wantUnassigned) {
            base.unassigned_count = payload.unassigned_orders.length
          }
        }

        return base
      })
    )

    return res.status(200).json(
      new Response(200, 'OK', 'Plans fetched', {
        total: typeof count === 'number' ? count : augmented.length,
        limit: limitNum,
        offset: offsetNum,
        plans: augmented,
      })
    )
  } catch (err) {
    const code = err.statusCode || 500
    return res
      .status(code)
      .json(new Response(code, 'Server Error', err.message))
  }
}
