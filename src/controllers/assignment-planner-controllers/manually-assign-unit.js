// controllers/assignment-planner-controllers/manually-assign-unit.js
import {
  buildNested,
  fetchPlanUnits,
  fetchPlanAssignments, // ✅ add this import
  fetchUnassignedBucket,
  insertAssignmentsSafely,
  recalcUsedCapacity,
} from '../../helpers/assignment-planner-helpers.js'
import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'

/**
 * Manually assign one or many items to an existing unit.
 * - No family lock
 * - No per-customer cap
 * - Duplicate-safe at DB layer
 * - Returns standard nested payload
 *
 * Body:
 *  - plan_id: uuid (required)
 *  - plan_unit_id: uuid (required)
 *  - items: Array<{ item_id: string, weight_kg?: number, note?: string }> | single object (required)
 */
export const manuallyAssign = async (req, res) => {
  try {
    const { plan_id, plan_unit_id, items } = req.body || {}

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }
    if (!plan_unit_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_unit_id is required'))
    }

    const list = Array.isArray(items) ? items : items ? [items] : []
    if (!list.length) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'items[] is required'))
    }

    // Validate plan + unit
    const { data: plan, error: planErr } = await database
      .from('assignment_plans')
      .select('id, scope_branch_id, scope_customer_id, departure_date')
      .eq('id', plan_id)
      .single()
    if (planErr || !plan) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Plan not found'))
    }

    const { data: unit, error: unitErr } = await database
      .from('assignment_plan_units')
      .select('id, plan_id')
      .eq('id', plan_unit_id)
      .single()
    if (unitErr || !unit || unit.plan_id !== plan.id) {
      return res
        .status(404)
        .json(new Response(404, 'Not Found', 'Unit not found in this plan'))
    }

    // Build request IDs
    const requestedIds = [
      ...new Set(
        list.map((it) => String(it?.item_id || '').trim()).filter(Boolean)
      ),
    ]
    if (!requestedIds.length) {
      return res
        .status(400)
        .json(
          new Response(400, 'Bad Request', 'items contain no valid item_id')
        )
    }

    // Check if items are in bucket first, remove them if assigning
    const { data: bucketItems, error: bucketErr } = await database
      .from('assignment_plan_unassigned_items')
      .select('item_id')
      .eq('plan_id', plan.id)
      .in('item_id', requestedIds)
    if (bucketErr) throw bucketErr
    
    const bucketItemIds = new Set((bucketItems || []).map(r => r.item_id))
    if (bucketItemIds.size > 0) {
      // Remove from bucket before assigning
      const { error: delBucketErr } = await database
        .from('assignment_plan_unassigned_items')
        .delete()
        .eq('plan_id', plan.id)
        .in('item_id', [...bucketItemIds])
      if (delBucketErr) throw delBucketErr
    }

    // Pull candidate rows from effective-unassigned view, respecting scope
    let q = database
      .from('v_unassigned_items_effective')
      .select('item_id, weight_kg, customer_id, branch_id, order_id, load_id')
      .in('item_id', requestedIds)

    if (plan.scope_branch_id) q = q.eq('branch_id', plan.scope_branch_id)
    if (plan.scope_customer_id) q = q.eq('customer_id', plan.scope_customer_id)

    const { data: cand, error: candErr } = await q
    if (candErr) throw candErr

    // Shape rows to insert (no cap, no filtering by customer here)
    const weightMap = new Map(
      list.map((it) => [String(it?.item_id || '').trim(), it?.weight_kg])
    )
    const noteMap = new Map(
      list.map((it) => [String(it?.item_id || '').trim(), it?.note])
    )

    const preRows = (cand || []).map((r) => ({
      plan_id: plan.id,
      plan_unit_id,
      load_id: r.load_id,
      order_id: r.order_id,
      item_id: r.item_id,
      assigned_weight_kg: Number.isFinite(+weightMap.get(r.item_id))
        ? +weightMap.get(r.item_id)
        : Number(r.weight_kg || 0),
      priority_note: noteMap.get(r.item_id) ?? 'manual',
    }))

    // Insert assignments with enhanced duplicate checking
    const ins = await insertAssignmentsSafely(database, preRows)
    if (ins.error) {
      // If assignment fails and we removed from bucket, restore to bucket
      if (bucketItemIds.size > 0) {
        const restoreRows = preRows
          .filter(r => bucketItemIds.has(r.item_id))
          .map(r => ({
            plan_id: plan.id,
            load_id: r.load_id,
            order_id: r.order_id, 
            item_id: r.item_id,
            weight_left: r.weight_kg,
            reason: 'assignment_failed'
          }))
        if (restoreRows.length) {
          await database
            .from('assignment_plan_unassigned_items')
            .insert(restoreRows)
        }
      }
      return res
        .status(500)
        .json(new Response(500, 'Server Error', ins.error.message))
    }

    // Recalc used capacity
    await recalcUsedCapacity(plan.id)

    // Return nested payload
    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(plan.id),
      fetchPlanAssignments(plan.id),
      fetchUnassignedBucket(plan.id),
    ])

    return res.status(200).json(
      new Response(
        200,
        'OK',
        `Assigned ${ins.data?.length ?? preRows.length} item(s)`,
        {
          plan: { id: plan.id, departure_date: plan.departure_date },
          ...buildNested(unitsDb, assignsDb, bucket),
        }
      )
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

// import {
//   buildNested,
//   fetchPlanUnits,
//   fetchUnassignedBucket,
//   insertAssignmentsSafely,
//   recalcUsedCapacity,
// } from '../../helpers/assignment-planner-helpers.js'
// import { Response } from '../../utils/classes.js'
// import database from '../../config/supabase.js'

// /**
//  * Manually assign one or multiple items to an existing plan unit.
//  * NO route-family lock (mixed families allowed).
//  *
//  * Body:
//  *  - plan_id: uuid (required)
//  *  - plan_unit_id: uuid (required)
//  *  - items: Array<{ item_id: uuid, weight_kg?: number, note?: string }> | { item_id, weight_kg?, note? }
//  *  - customerUnitCap?: number (default 2) // max distinct units per customer within the plan
//  *
//  * Behavior:
//  *  - Reads candidates from v_unassigned_items_effective (must still be unassigned)
//  *  - Respects plan’s branch/customer scope
//  *  - Enforces per-customer unit cap within the plan
//  *  - Skips items already assigned anywhere (duplicate-safe)
//  *  - Recomputes used capacity and returns your standard nested payload
//  */
// export const manuallyAssign = async (req, res) => {
//   try {
//     const { plan_id, plan_unit_id, items, customerUnitCap = 2 } = req.body || {}

//     if (!plan_id) {
//       return res
//         .status(400)
//         .json(new Response(400, 'Bad Request', 'plan_id is required'))
//     }
//     if (!plan_unit_id) {
//       return res
//         .status(400)
//         .json(new Response(400, 'Bad Request', 'plan_unit_id is required'))
//     }
//     const list = Array.isArray(items) ? items : items ? [items] : []
//     if (!list.length) {
//       return res
//         .status(400)
//         .json(
//           new Response(
//             400,
//             'Bad Request',
//             'items array (or single item) is required'
//           )
//         )
//     }

//     // 1) Fetch plan & unit (and validate they belong together)
//     const planQ = await database
//       .from('assignment_plans')
//       .select('id, departure_date, scope_branch_id, scope_customer_id')
//       .eq('id', plan_id)
//       .single()
//     if (planQ.error || !planQ.data)
//       throw planQ.error || new Error('Plan not found')
//     const plan = planQ.data

//     const unitQ = await database
//       .from('assignment_plan_units')
//       .select('id')
//       .eq('id', plan_unit_id)
//       .eq('plan_id', plan.id)
//       .single()
//     if (unitQ.error || !unitQ.data)
//       throw unitQ.error || new Error('Plan unit not found for this plan')

//     // 2) Pull candidate items from v_unassigned_items_effective (still unassigned)
//     const requestedIds = [
//       ...new Set(list.map((x) => x.item_id).filter(Boolean)),
//     ]
//     if (!requestedIds.length) {
//       return res
//         .status(400)
//         .json(
//           new Response(400, 'Bad Request', 'items contain no valid item_id')
//         )
//     }

//     let q = database
//       .from('v_unassigned_items_effective')
//       .select(
//         'item_id, load_id, order_id, customer_id, customer_name, suburb_name, route_name, order_date, description, weight_kg, order_number, branch_id'
//       )
//       .in('item_id', requestedIds)

//     // Respect plan scope (branch + customer)
//     if (plan.scope_branch_id) {
//       q = q.eq('branch_id', plan.scope_branch_id)
//     }

//     // if (Array.isArray(plan.scope_branch_id) && plan.scope_branch_id.length) {
//     //   q = q.in('branch_id', plan.scope_branch_id)
//     // } else if (plan.scope_branch_id) {
//     //   q = q.eq('branch_id', plan.scope_branch_id)
//     // }
//     if (plan.scope_customer_id) {
//       q = q.eq('customer_id', plan.scope_customer_id)
//     }

//     const { data: cand, error: candErr } = await q
//     if (candErr) throw candErr
//     if (!cand?.length) {
//       return res.status(200).json(
//         new Response(
//           200,
//           'OK',
//           'No items matched scope or are already assigned.',
//           {
//             plan: { id: plan.id, departure_date: plan.departure_date },
//             ...(await (async () => {
//               const [unitsDb, assignsDb, bucket] = await Promise.all([
//                 fetchPlanUnits(plan.id),
//                 fetchPlanAssignments(plan.id),
//                 fetchUnassignedBucket(plan.id),
//               ])
//               return buildNested(unitsDb, assignsDb, bucket)
//             })()),
//           }
//         )
//       )
//     }

//     // Map requested weights/notes
//     const weightById = new Map(
//       list.map((x) => [x.item_id, Number(x.weight_kg || 0)])
//     )
//     const noteById = new Map(list.map((x) => [x.item_id, x.note || 'manual']))

//     // 3) Build preliminary rows (NO family check)
//     const preRows = cand.map((r) => ({
//       load_id: r.load_id,
//       order_id: r.order_id,
//       item_id: r.item_id,
//       assigned_weight_kg: weightById.get(r.item_id) || Number(r.weight_kg || 0),
//       priority_note: noteById.get(r.item_id) || 'manual',
//       _customer_id: r.customer_id,
//     }))

//     // 4) Enforce per-customer unit cap (distinct units per customer within this plan)
//     if (preRows.length && customerUnitCap > 0) {
//       const { data: joins, error: joinErr } = await database
//         .from('assignment_plan_item_assignments')
//         .select(
//           `
//           id,
//           plan_unit_id,
//           assignment_plan_units!inner (plan_id),
//           load_orders:order_id!inner (customer_id)
//         `
//         )
//         .eq('assignment_plan_units.plan_id', plan.id)
//       if (joinErr) throw joinErr

//       // Build current distinct-unit set per customer
//       const unitSetByCustomer = new Map()
//       for (const row of joins || []) {
//         const cid = row?.load_orders?.customer_id || 'anon'
//         const set = unitSetByCustomer.get(cid) || new Set()
//         set.add(row.plan_unit_id)
//         unitSetByCustomer.set(cid, set)
//       }

//       // Filter rows that would exceed the cap (introducing a new unit for that customer)
//       const filtered = []
//       for (const r of preRows) {
//         const cid = r._customer_id || 'anon'
//         const set = unitSetByCustomer.get(cid) || new Set()
//         const alreadyOnThisUnit = set.has(plan_unit_id)
//         if (!alreadyOnThisUnit && set.size >= Number(customerUnitCap)) {
//           continue
//         }
//         filtered.push(r)
//       }
//       preRows.length = 0
//       preRows.push(...filtered)
//     }

//     // 5) Duplicate-safe check: skip items already assigned anywhere
//     const uniqueIds = [
//       ...new Set(preRows.map((r) => r.item_id).filter(Boolean)),
//     ]
//     let rowsToInsert = []
//     if (uniqueIds.length) {
//       const { data: existRows, error: existErr } = await database
//         .from('assignment_plan_item_assignments')
//         .select('item_id')
//         .in('item_id', uniqueIds)
//       if (existErr) throw existErr

//       const existingIds = new Set((existRows || []).map((r) => r.item_id))
//       rowsToInsert = preRows
//         .filter(
//           (r) =>
//             r.item_id &&
//             !existingIds.has(r.item_id) &&
//             Number(r.assigned_weight_kg) > 0
//         )
//         .map((r) => ({
//           plan_unit_id,
//           load_id: r.load_id,
//           order_id: r.order_id,
//           item_id: r.item_id,
//           assigned_weight_kg: r.assigned_weight_kg,
//           priority_note: r.priority_note,
//         }))
//     }

//     // If nothing survived, return a friendly no-op
//     if (!rowsToInsert.length) {
//       return res.status(200).json(
//         new Response(
//           200,
//           'OK',
//           'No items were assignable (duplicates, cap constraints, zero weight, or out of scope).',
//           {
//             plan: { id: plan.id, departure_date: plan.departure_date },
//             ...(await (async () => {
//               const [unitsDb, assignsDb, bucket] = await Promise.all([
//                 fetchPlanUnits(plan.id),
//                 fetchPlanAssignments(plan.id),
//                 fetchUnassignedBucket(plan.id),
//               ])
//               return buildNested(unitsDb, assignsDb, bucket)
//             })()),
//           }
//         )
//       )
//     }

//     // 6) Insert & recalc
//     const insA = await insertAssignmentsSafely(database, rowsToInsert)
//     if (insA.error) throw insA.error

//     await recalcUsedCapacity(plan.id)
//     const [unitsDb, assignsDb, bucket] = await Promise.all([
//       fetchPlanUnits(plan.id),
//       fetchPlanAssignments(plan.id),
//       fetchUnassignedBucket(plan.id),
//     ])

//     return res.status(200).json(
//       new Response(200, 'OK', `Assigned ${rowsToInsert.length} item(s)`, {
//         plan: { id: plan.id, departure_date: plan.departure_date },
//         ...buildNested(unitsDb, assignsDb, bucket),
//       })
//     )
//   } catch (err) {
//     return res.status(500).json(new Response(500, 'Server Error', err.message))
//   }
// }
