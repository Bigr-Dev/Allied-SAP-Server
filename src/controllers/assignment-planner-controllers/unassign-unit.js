import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'
import {
  fetchPlanUnits,
  fetchPlanAssignments,
  fetchUnassignedBucket,
  recalcUsedCapacity,
  buildNested,
} from '../../helpers/assignment-planner-helpers.js'

/**
 * Unassign items from a plan (single / bulk / whole unit).
 *
 * Body:
 *  - plan_id: uuid (required)
 *  - items:
 *      Array<
 *        { plan_unit_id: uuid, item_id?: uuid }  // if item_id omitted ⇒ unassign ALL items from that unit
 *      >
 *      | { plan_unit_id: uuid, item_id?: uuid }  // single form also accepted
 *  - to_bucket?: boolean         // default false; if true, insert rows into assignment_plan_unassigned_items
 *  - bucket_reason?: string      // optional reason when writing to bucket
 *  - remove_empty_unit?: boolean // default true; delete units with 0 remaining assignments
 *
 * Behavior:
 *  - Removes the specified assignments (duplicate-safe, ignores non-existent pairs).
 *  - Optionally writes unassigned rows to the plan's bucket with a reason.
 *  - Optionally deletes empty units after unassign.
 *  - Recomputes used capacity, then returns standard nested payload.
 
How to use it

Unassign one item from a unit

{
  "plan_id": "…",
  "items": { "plan_unit_id": "…", "item_id": "…"}
}


Unassign multiple items (possibly from different units)

{
  "plan_id": "…",
  "items": [
    { "plan_unit_id": "…", "item_id": "A" },
    { "plan_unit_id": "…", "item_id": "B" },
    { "plan_unit_id": "…", "item_id": "C" }
  ]
}


Unassign an entire unit

{
  "plan_id": "…",
  "items": [{ "plan_unit_id": "…" }]
}


Also write to the plan’s bucket with a reason & delete empty units

{
  "plan_id": "…",
  "to_bucket": true,
  "bucket_reason": "driver unavailable",
  "remove_empty_unit": true,
  "items": [{ "plan_unit_id": "…", "item_id": "…" }]
}


*/
export const unassign = async (req, res) => {
  try {
    const {
      plan_id,
      items,
      to_bucket = false,
      bucket_reason = 'unassigned',
      remove_empty_unit = true,
    } = req.body || {}

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }

    // normalize items
    const list = Array.isArray(items) ? items : items ? [items] : []
    if (!list.length) {
      return res
        .status(400)
        .json(
          new Response(
            400,
            'Bad Request',
            'items array (or single item) is required'
          )
        )
    }
    const unitIdsRequested = [
      ...new Set(list.map((x) => x?.plan_unit_id).filter(Boolean)),
    ]
    if (!unitIdsRequested.length) {
      return res
        .status(400)
        .json(
          new Response(400, 'Bad Request', 'each item needs a plan_unit_id')
        )
    }

    // 1) validate plan and that units belong to plan
    const planQ = await database
      .from('assignment_plans')
      .select('id, departure_date')
      .eq('id', plan_id)
      .single()
    if (planQ.error || !planQ.data)
      throw planQ.error || new Error('Plan not found')
    const plan = planQ.data

    const unitsQ = await database
      .from('assignment_plan_units')
      .select('id')
      .eq('plan_id', plan.id)
      .in('id', unitIdsRequested)
    if (unitsQ.error) throw unitsQ.error
    const validUnitIds = new Set((unitsQ.data || []).map((r) => r.id))
    const invalid = unitIdsRequested.filter((id) => !validUnitIds.has(id))
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

    // 2) figure out what to unassign
    //    - if an entry has item_id => unassign that pair
    //    - if an entry lacks item_id => unassign ALL items from that unit
    const specificPairs = list
      .filter((x) => x.item_id)
      .map((x) => ({ plan_unit_id: x.plan_unit_id, item_id: x.item_id }))
    const unitsAll = new Set(
      list.filter((x) => !x.item_id).map((x) => x.plan_unit_id)
    )

    // pull actual current assignments for those units (to support both modes)
    let baseQ = database
      .from('assignment_plan_item_assignments')
      .select('id, plan_unit_id, item_id, order_id, load_id')
      .in('plan_unit_id', [...new Set([...unitIdsRequested])])

    const { data: current, error: curErr } = await baseQ
    if (curErr) throw curErr

    // select rows to delete
    const toDelete = []
    const byUnit = new Map()
    for (const a of current || []) {
      if (unitsAll.has(a.plan_unit_id)) {
        toDelete.push(a)
      } else if (
        specificPairs.find(
          (p) => p.plan_unit_id === a.plan_unit_id && p.item_id === a.item_id
        )
      ) {
        toDelete.push(a)
      }
      if (!byUnit.has(a.plan_unit_id)) byUnit.set(a.plan_unit_id, [])
      byUnit.get(a.plan_unit_id).push(a)
    }
    if (!toDelete.length) {
      // nothing to do
      const [u, a2, b] = await Promise.all([
        fetchPlanUnits(plan.id),
        fetchPlanAssignments(plan.id),
        fetchUnassignedBucket(plan.id),
      ])
      return res.status(200).json(
        new Response(200, 'OK', 'No matching assignments found.', {
          plan: { id: plan.id, departure_date: plan.departure_date },
          ...buildNested(u, a2, b),
        })
      )
    }

    // 3) Use transaction for bucket + delete operations
    if (to_bucket) {
      // enrich minimal fields for bucket rows
      const itemIds = [...new Set(toDelete.map((r) => r.item_id))]
      let enrich = []
      if (itemIds.length) {
        const { data: rows, error: enrErr } = await database
          .from('v_planner_items')
          .select(
            'item_id, order_id, load_id, order_date, description, weight_kg'
          )
          .in('item_id', itemIds)
        if (enrErr) throw enrErr
        enrich = rows || []
      }
      const byItem = new Map(enrich.map((r) => [r.item_id, r]))

      const bucketRows = toDelete.map((r) => {
        const e = byItem.get(r.item_id)
        return {
          plan_id: plan.id,
          load_id: r.load_id,
          order_id: r.order_id,
          item_id: r.item_id,
          order_date: e?.order_date || null,
          weight_left: e?.weight_kg ?? null,
          reason: bucket_reason || 'unassigned',
        }
      })

      if (bucketRows.length) {
        // Use transaction to ensure atomicity
        const { error: txError } = await database.rpc('begin')
        if (txError) throw txError
        
        try {
          // First delete from assignments
          const delA = await database
            .from('assignment_plan_item_assignments')
            .delete()
            .in('id', toDelete.map((r) => r.id))
          if (delA.error) throw delA.error

          // Then insert to bucket (with duplicate prevention)
          const { error: insErr } = await database
            .from('assignment_plan_unassigned_items')
            .upsert(bucketRows, { 
              onConflict: 'plan_id,item_id',
              ignoreDuplicates: false 
            })
          if (insErr) throw insErr

          const { error: commitErr } = await database.rpc('commit')
          if (commitErr) throw commitErr
        } catch (err) {
          await database.rpc('rollback')
          throw err
        }
      }
    } else {
      // 4) delete assignments only
      const delA = await database
        .from('assignment_plan_item_assignments')
        .delete()
        .in('id', toDelete.map((r) => r.id))
      if (delA.error) throw delA.error
    }

    // 5) optionally delete empty units
    if (remove_empty_unit) {
      const empties = []
      for (const uid of validUnitIds) {
        const rows = (byUnit.get(uid) || []).filter(
          (a) => !toDelete.find((d) => d.id === a.id)
        )
        // rows = remaining assignments snapshot (before delete), but simpler re-check DB:
      }
      const { data: stillAssigned, error: chkErr } = await database
        .from('assignment_plan_item_assignments')
        .select('plan_unit_id, count:id')
        .in('plan_unit_id', [...validUnitIds])
        .group('plan_unit_id')
      if (chkErr) throw chkErr
      const withCounts = new Map(
        (stillAssigned || []).map((r) => [r.plan_unit_id, Number(r.count || 0)])
      )
      const emptyIds = [...validUnitIds].filter(
        (uid) => !withCounts.has(uid) || withCounts.get(uid) === 0
      )
      if (emptyIds.length) {
        const delUnits = await database
          .from('assignment_plan_units')
          .delete()
          .in('id', emptyIds)
        if (delUnits.error) throw delUnits.error
      }
    }

    // 6) recalc and return nested
    await recalcUsedCapacity(plan.id)

    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(plan.id),
      fetchPlanAssignments(plan.id),
      fetchUnassignedBucket(plan.id),
    ])

    return res.status(200).json(
      new Response(200, 'OK', `Unassigned ${toDelete.length} item(s)`, {
        plan: { id: plan.id, departure_date: plan.departure_date },
        ...buildNested(unitsDb, assignsDb, bucket),
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
