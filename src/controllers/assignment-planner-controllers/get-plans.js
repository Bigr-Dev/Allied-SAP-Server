// import { Response } from '../../utils/classes.js'
// import database from '../../config/supabase.js'

// export const getAllPlans = async (req, res) => {
//   try {
//     const {
//       limit = 50,
//       offset = 0,
//       order = 'desc',
//       date_from,
//       date_to,
//       branch_id,
//       customer_id,
//       include_units,
//       include_counts,
//       include_branch_name,
//       ids,
//     } = req.query || {}

//     const wantUnits = String(include_units).toLowerCase() === 'true'
//     const wantCounts = String(include_counts).toLowerCase() === 'true'
//     const wantBranch = String(include_branch_name).toLowerCase() === 'true'

//     let q = database
//       .from('assignment_plans')
//       .select(
//         'id, run_at, departure_date, cutoff_date, scope_branch_id, scope_customer_id, notes',
//         { count: 'exact' }
//       )

//     if (ids) {
//       const arr = ids
//         .split(',')
//         .map((s) => s.trim())
//         .filter(Boolean)
//       if (arr.length) q = q.in('id', arr)
//     }

//     if (branch_id) q = q.eq('scope_branch_id', branch_id)
//     if (customer_id) q = q.eq('scope_customer_id', customer_id)
//     if (date_from) q = q.gte('departure_date', date_from)
//     if (date_to) q = q.lte('departure_date', date_to)

//     const asc = String(order).toLowerCase() === 'asc'
//     q = q
//       .order('departure_date', { ascending: asc, nullsFirst: asc })
//       .order('run_at', { ascending: asc, nullsFirst: asc })

//     const start = Number(offset) || 0
//     const end = start + (Number(limit) || 50) - 1
//     q = q.range(start, Math.max(start, end))

//     const { data: plans, error, count } = await q
//     if (error) throw error
//     const out = plans || []

//     // optional enrichments
//     let branchNameById = new Map()
//     if (wantBranch) {
//       try {
//         const { data: rows } = await database.from('branches').select('id,name')
//         if (rows?.length)
//           branchNameById = new Map(rows.map((b) => [String(b.id), b.name]))
//       } catch {}
//     }

//     let unitsByPlan = new Map()
//     let countsByPlan = new Map()

//     if (wantUnits || wantCounts) {
//       const planIds = out.map((p) => p.id)
//       if (planIds.length) {
//         const { data: pu, error: puErr } = await database
//           .from('assignment_plan_units')
//           .select('id, plan_id')
//           .in('plan_id', planIds)
//         if (puErr) throw puErr

//         if (wantUnits) {
//           for (const r of pu || []) {
//             const arr = unitsByPlan.get(r.plan_id) || []
//             arr.push(r.id)
//             unitsByPlan.set(r.plan_id, arr)
//           }
//         }

//         if (wantCounts) {
//           const unitsCount = new Map()
//           for (const r of pu || []) {
//             unitsCount.set(r.plan_id, (unitsCount.get(r.plan_id) || 0) + 1)
//           }
//           const puIds = (pu || []).map((r) => r.id)
//           let assignsCount = new Map()
//           if (puIds.length) {
//             const { data: asn, error: asnErr } = await database
//               .from('assignment_plan_item_assignments')
//               .select('plan_unit_id')
//               .in('plan_unit_id', puIds)
//             if (asnErr) throw asnErr
//             const planByPU = new Map(pu.map((r) => [r.id, r.plan_id]))
//             for (const a of asn || []) {
//               const pid = planByPU.get(a.plan_unit_id)
//               if (!pid) continue
//               assignsCount.set(pid, (assignsCount.get(pid) || 0) + 1)
//             }
//           }
//           for (const pid of planIds) {
//             countsByPlan.set(pid, {
//               units_count: unitsCount.get(pid) || 0,
//               assignments_count: assignsCount.get(pid) || 0,
//             })
//           }
//         }
//       }
//     }

//     const augmented = out.map((p) => ({
//       ...p,
//       ...(wantBranch
//         ? {
//             scope_branch_name:
//               branchNameById.get(String(p.scope_branch_id || '')) || null,
//           }
//         : {}),
//       ...(wantUnits ? { plan_unit_ids: unitsByPlan.get(p.id) || [] } : {}),
//       ...(wantCounts
//         ? countsByPlan.get(p.id) || { units_count: 0, assignments_count: 0 }
//         : {}),
//     }))

//     return res.status(200).json(
//       new Response(200, 'OK', 'Plans fetched', {
//         total: typeof count === 'number' ? count : augmented.length,
//         limit: Number(limit),
//         offset: Number(offset),
//         plans: augmented,
//       })
//     )
//   } catch (err) {
//     return res.status(500).json(new Response(500, 'Server Error', err.message))
//   }
// }
import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'
import { todayTomorrow } from '../../helpers/assignment-planner-helpers.js'

export const getAllPlans = async (req, res) => {
  console.log('tomorrow :>> ', todayTomorrow().tomorrow)
  try {
    const {
      limit = 1000,
      offset = 0,
      order = 'desc',
      date_from = todayTomorrow().today,
      date_to = todayTomorrow().tomorrow,
      branch_id,
      customer_id,
      include_units,
      include_counts,
      include_branch_name,
      ids,
      // NEW:
      include_unassigned, // "true" to include global unassigned pool + count
    } = req.query || {}

    const wantUnits = String(include_units).toLowerCase() === 'true'
    const wantCounts = String(include_counts).toLowerCase() === 'true'
    const wantBranch = String(include_branch_name).toLowerCase() === 'true'
    const wantUnassigned = String(include_unassigned).toLowerCase() === 'true'

    // ── Plans base query
    let q = database
      .from('assignment_plans')
      .select(
        'id, run_at, departure_date, cutoff_date, scope_branch_id, scope_customer_id, notes',
        { count: 'exact' }
      )

    if (ids) {
      const arr = ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (arr.length) q = q.in('id', arr)
    }

    if (branch_id) q = q.eq('scope_branch_id', branch_id)
    if (customer_id) q = q.eq('scope_customer_id', customer_id)
    if (date_from) q = q.gte('departure_date', date_from)
    if (date_to) q = q.lte('departure_date', date_to)

    const asc = String(order).toLowerCase() === 'asc'
    q = q
      .order('departure_date', { ascending: asc, nullsFirst: asc })
      .order('run_at', { ascending: asc, nullsFirst: asc })

    const start = Number(offset) || 0
    const end = start + (Number(limit) || 50) - 1
    q = q.range(start, Math.max(start, end))

    const { data: plans, error, count } = await q
    if (error) throw error
    const out = plans || []

    // ── Optional enrichments for plans
    let branchNameById = new Map()
    if (wantBranch) {
      try {
        const { data: rows } = await database.from('branches').select('id,name')
        if (rows?.length)
          branchNameById = new Map(rows.map((b) => [String(b.id), b.name]))
      } catch {}
    }

    let unitsByPlan = new Map()
    let countsByPlan = new Map()

    if (wantUnits || wantCounts) {
      const planIds = out.map((p) => p.id)
      if (planIds.length) {
        const { data: pu, error: puErr } = await database
          .from('assignment_plan_units')
          .select('id, plan_id')
          .in('plan_id', planIds)
        if (puErr) throw puErr

        if (wantUnits) {
          for (const r of pu || []) {
            const arr = unitsByPlan.get(r.plan_id) || []
            arr.push(r.id)
            unitsByPlan.set(r.plan_id, arr)
          }
        }

        if (wantCounts) {
          const unitsCount = new Map()
          for (const r of pu || []) {
            unitsCount.set(r.plan_id, (unitsCount.get(r.plan_id) || 0) + 1)
          }
          const puIds = (pu || []).map((r) => r.id)
          let assignsCount = new Map()
          if (puIds.length) {
            const { data: asn, error: asnErr } = await database
              .from('assignment_plan_item_assignments')
              .select('plan_unit_id')
              .in('plan_unit_id', puIds)
            if (asnErr) throw asnErr
            const planByPU = new Map(pu.map((r) => [r.id, r.plan_id]))
            for (const a of asn || []) {
              const pid = planByPU.get(a.plan_unit_id)
              if (!pid) continue
              assignsCount.set(pid, (assignsCount.get(pid) || 0) + 1)
            }
          }
          for (const pid of planIds) {
            countsByPlan.set(pid, {
              units_count: unitsCount.get(pid) || 0,
              assignments_count: assignsCount.get(pid) || 0,
            })
          }
        }
      }
    }

    const augmented = out.map((p) => ({
      ...p,
      ...(wantBranch
        ? {
            scope_branch_name:
              branchNameById.get(String(p.scope_branch_id || '')) || null,
          }
        : {}),
      ...(wantUnits ? { plan_unit_ids: unitsByPlan.get(p.id) || [] } : {}),
      ...(wantCounts
        ? countsByPlan.get(p.id) || { units_count: 0, assignments_count: 0 }
        : {}),
    }))

    // ── NEW: global unassigned pool (+ total count), filtered by the same query params
    let unassigned = []
    let total_unassigned = 0

    if (wantUnassigned) {
      let uq = database.from('v_unassigned_items').select(
        `
          load_id, route_id, route_name, branch_id, order_date,
          suburb_name, order_id, customer_id, customer_name,
          item_id, weight_kg, description,
          is_lip_channel,
          sales_order_number:order_number
        `,
        { count: 'exact' }
      )

      if (branch_id) uq = uq.eq('branch_id', branch_id)
      if (customer_id) uq = uq.eq('customer_id', customer_id)
      if (date_from) uq = uq.gte('order_date', date_from)
      if (date_to) uq = uq.lte('order_date', date_to)

      // reuse pagination knobs for the unassigned list, too
      uq = uq
        .order('order_date', { ascending: true })
        .order('weight_kg', { ascending: false })
        .range(start, Math.max(start, end))

      const { data: urows, error: uerr, count: ucount } = await uq
      if (uerr) throw uerr

      unassigned = (urows || []).map((it) => ({
        ...it,
        weight_kg: Number(it.weight_kg || 0),
        weight_left: Number(it.weight_kg || 0),
      }))
      total_unassigned = typeof ucount === 'number' ? ucount : unassigned.length
    }

    return res.status(200).json(
      new Response(200, 'OK', 'Plans fetched', {
        total: typeof count === 'number' ? count : augmented.length,
        limit: Number(limit),
        offset: Number(offset),
        plans: augmented,
        // NEW fields:
        ...(wantUnassigned ? { total_unassigned, unassigned } : {}),
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
