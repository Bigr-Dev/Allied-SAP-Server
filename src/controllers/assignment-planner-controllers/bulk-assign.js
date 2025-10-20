import {
  insertAssignmentsSafely,
  familyFrom,
  fetchPlanUnits,
  fetchPlanAssignments,
  fetchUnassignedBucket,
  recalcUsedCapacity,
  buildNested,
} from '../../helpers/assignment-planner-helpers.js'
import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'

/**
 * Bulk-assign items to multiple units in a plan.
 *
 * Body:
 *  - plan_id: uuid (required)
 *  - assignments: Array<{
 *      plan_unit_id: uuid,
 *      items: Array<{ item_id: uuid, weight_kg?: number, note?: string }>
 *    }>   // required (at least one)
 *  - customerUnitCap?: number  // default 2 (max distinct units per customer within the plan)
 *  - enforce_family?: boolean  // default false (set true to forbid mixing macro-route families per unit)
 *
 * Notes:
 *  - Items must still be unassigned (we read from v_unassigned_items_effective).
 *  - Respects plan scope (branch/customer).
 *  - Duplicate-safe: skips any item_id already present in assignment_plan_item_assignments.
 *  - Returns your standard nested payload.
 */
export const bulkAssignToUnits = async (req, res) => {
  try {
    const {
      plan_id,
      assignments,
      customerUnitCap = 2,
      enforce_family = false,
    } = req.body || {}

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }
    if (!Array.isArray(assignments) || !assignments.length) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'assignments array is required'))
    }

    // 1) Fetch plan + scope
    const planQ = await database
      .from('assignment_plans')
      .select('id, departure_date, scope_branch_id, scope_customer_id')
      .eq('id', plan_id)
      .single()
    if (planQ.error || !planQ.data)
      throw planQ.error || new Error('Plan not found')
    const plan = planQ.data

    // 2) Validate that all plan_unit_ids belong to this plan
    const unitIds = [
      ...new Set(assignments.map((a) => a?.plan_unit_id).filter(Boolean)),
    ]
    if (!unitIds.length) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'assignments must include plan_unit_id'
          )
        )
    }
    const unitsQ = await database
      .from('assignment_plan_units')
      .select('id')
      .eq('plan_id', plan.id)
      .in('id', unitIds)
    if (unitsQ.error) throw unitsQ.error
    const validUnitIds = new Set((unitsQ.data || []).map((r) => r.id))
    const invalid = unitIds.filter((id) => !validUnitIds.has(id))
    if (invalid.length) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            `plan_unit_id not in plan: ${invalid.join(', ')}`
          )
        )
    }

    // 3) Flatten requested items
    const requested = []
    for (const a of assignments) {
      const pid = a?.plan_unit_id
      const items = Array.isArray(a?.items) ? a.items : []
      for (const it of items) {
        if (it?.item_id) {
          requested.push({
            plan_unit_id: pid,
            item_id: it.item_id,
            weight_kg: Number(it.weight_kg || 0),
            note: it.note || 'manual',
          })
        }
      }
    }
    const itemIds = [...new Set(requested.map((x) => x.item_id))]
    if (!itemIds.length) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'no valid item_id found in assignments'
          )
        )
    }

    // 4) Pull candidate item details from v_unassigned_items_effective (still-unassigned + scope)
    let q = database
      .from('v_unassigned_items')
      .select(
        'item_id, load_id, order_id, customer_id, customer_name, suburb_name, route_name, order_date, description, weight_kg, order_number, branch_id'
      )
      .in('item_id', itemIds)
    if (plan.scope_branch_id) {
      q = q.eq('branch_id', plan.scope_branch_id)
    }

    // if (Array.isArray(plan.scope_branch_id) && plan.scope_branch_id.length) {
    //   q = q.in('branch_id', plan.scope_branch_id)
    // } else if (plan.scope_branch_id) {
    //   q = q.eq('branch_id', plan.scope_branch_id)
    // }
    if (plan.scope_customer_id) {
      q = q.eq('customer_id', plan.scope_customer_id)
    }

    const { data: cand, error: candErr } = await q
    if (candErr) throw candErr
    const byItem = new Map((cand || []).map((r) => [r.item_id, r]))
    if (!byItem.size) {
      // Nothing in scope / already assigned
      const [u, a2, b] = await Promise.all([
        fetchPlanUnits(plan.id),
        fetchPlanAssignments(plan.id),
        fetchUnassignedBucket(plan.id),
      ])
      return res.status(200).json(
        new Response(
          200,
          'OK',
          'No items matched scope or are already assigned.',
          {
            plan: { id: plan.id, departure_date: plan.departure_date },
            ...buildNested(u, a2, b),
          }
        )
      )
    }

    // 5) Optional: unit family lock (per unit)
    // Determine existing family per unit from its current assignments (sample).
    const familyByUnit = new Map()
    if (enforce_family) {
      const curA = await database
        .from('assignment_plan_item_assignments')
        .select('plan_unit_id, item_id')
        .in('plan_unit_id', unitIds)
      if (curA.error) throw curA.error
      const existingItemIds = (curA.data || [])
        .map((r) => r.item_id)
        .filter(Boolean)
      if (existingItemIds.length) {
        const famRows = await database
          .from('v_planner_items')
          .select('item_id, route_name')
          .in('item_id', existingItemIds.slice(0, 2000)) // sample plenty
        if (famRows.error) throw famRows.error
        const famMap = new Map(
          (famRows.data || []).map((r) => [r.item_id, r.route_name])
        )
        for (const r of curA.data || []) {
          const rn = famMap.get(r.item_id)
          if (rn) {
            const fam = familyFrom(rn)
            if (!familyByUnit.has(r.plan_unit_id))
              familyByUnit.set(r.plan_unit_id, fam)
          }
        }
      }
    }

    // 6) Build preliminary rows per requested line (respect family if enforced)
    const prelim = []
    for (const reqLine of requested) {
      const r = byItem.get(reqLine.item_id)
      if (!r) continue
      if (enforce_family) {
        const lock = familyByUnit.get(reqLine.plan_unit_id)
        if (lock && familyFrom(r.route_name) !== lock) continue
        if (!lock)
          familyByUnit.set(reqLine.plan_unit_id, familyFrom(r.route_name)) // lock on first
      }
      prelim.push({
        plan_unit_id: reqLine.plan_unit_id,
        load_id: r.load_id,
        order_id: r.order_id,
        item_id: r.item_id,
        assigned_weight_kg:
          reqLine.weight_kg > 0 ? reqLine.weight_kg : Number(r.weight_kg || 0),
        priority_note: reqLine.note || 'manual',
        _customer_id: r.customer_id,
      })
    }

    // 7) Enforce per-customer unit cap (distinct units per customer in this plan)
    if (prelim.length && customerUnitCap > 0) {
      const { data: joins, error: joinErr } = await database
        .from('assignment_plan_item_assignments')
        .select(
          `
          id,
          plan_unit_id,
          assignment_plan_units!inner (plan_id),
          load_orders:order_id!inner (customer_id)
        `
        )
        .eq('assignment_plan_units.plan_id', plan.id)
      if (joinErr) throw joinErr

      const unitSetByCustomer = new Map()
      for (const row of joins || []) {
        const cid = row?.load_orders?.customer_id || 'anon'
        const set = unitSetByCustomer.get(cid) || new Set()
        set.add(row.plan_unit_id)
        unitSetByCustomer.set(cid, set)
      }

      const filtered = []
      for (const r of prelim) {
        const cid = r._customer_id || 'anon'
        const set = unitSetByCustomer.get(cid) || new Set()
        const alreadyOnThisUnit = set.has(r.plan_unit_id)
        if (!alreadyOnThisUnit && set.size >= Number(customerUnitCap)) continue
        filtered.push(r)
      }
      prelim.length = 0
      prelim.push(...filtered)
    }

    // 8) Duplicate-safe: skip items already assigned anywhere
    const uniqueIds = [...new Set(prelim.map((r) => r.item_id).filter(Boolean))]
    let rowsToInsert = []
    if (uniqueIds.length) {
      const { data: existRows, error: existErr } = await database
        .from('assignment_plan_item_assignments')
        .select('item_id')
        .in('item_id', uniqueIds)
      if (existErr) throw existErr

      const existingIds = new Set((existRows || []).map((r) => r.item_id))
      rowsToInsert = prelim
        .filter(
          (r) =>
            r.item_id &&
            !existingIds.has(r.item_id) &&
            Number(r.assigned_weight_kg) > 0
        )
        .map((r) => ({
          plan_unit_id: r.plan_unit_id,
          load_id: r.load_id,
          order_id: r.order_id,
          item_id: r.item_id,
          assigned_weight_kg: r.assigned_weight_kg,
          priority_note: r.priority_note,
        }))
    }

    if (!rowsToInsert.length) {
      const [u, a2, b] = await Promise.all([
        fetchPlanUnits(plan.id),
        fetchPlanAssignments(plan.id),
        fetchUnassignedBucket(plan.id),
      ])
      return res.status(200).json(
        new Response(
          200,
          'OK',
          'No items were assignable (duplicates, cap/family constraints, zero weight, or out of scope).',
          {
            plan: { id: plan.id, departure_date: plan.departure_date },
            ...buildNested(u, a2, b),
          }
        )
      )
    }

    // 9) Insert & recalc
    const insA = await insertAssignmentsSafely(database, rowsToInsert)
    if (insA.error) throw insA.error

    await recalcUsedCapacity(plan.id)
    // const [unitsDb, assignsDb, bucket] = await Promise.all([
    //   fetchPlanUnits(plan.id),
    //   fetchPlanAssignments(plan.id),
    //   fetchUnassignedBucket(plan.id),
    // ])
    const [unitsDb, assignsDb, bucketRaw] = await Promise.all([
      fetchPlanUnits(plan.id),
      fetchPlanAssignments(plan.id),
      fetchUnassignedBucket(plan.id),
    ])

    const bucket = []
    const seen = new Set()
    for (const r of bucketRaw || []) {
      const k = r.item_id ?? `${r.load_id}:${r.order_id}:${r.description}`
      if (seen.has(k)) continue
      seen.add(k)
      bucket.push(r)
    }

    return res.status(200).json(
      new Response(200, 'OK', `Bulk assigned ${rowsToInsert.length} item(s)`, {
        plan: { id: plan.id, departure_date: plan.departure_date },
        ...buildNested(unitsDb, assignsDb, bucket),
      })
    )

    return res.status(200).json(
      new Response(200, 'OK', `Bulk assigned ${rowsToInsert.length} item(s)`, {
        plan: { id: plan.id, departure_date: plan.departure_date },
        ...buildNested(unitsDb, assignsDb, bucket),
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
