import {
  insertAssignmentsSafely,
  vehicleKey,
  familyFrom,
  fetchTripsUsedByVehicle,
  fetchPlanAssignments,
  fetchUnassignedBucket,
  recalcUsedCapacity,
  buildNested,
  fetchPlanUnits,
} from '../../helpers/assignment-planner-helpers.js'
import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'

/**
 * Add an idle unit to an existing plan and optionally assign items to it.
 *
 * Body:
 *  - plan_id: uuid (required)
 *  - unit: {
 *      unit_type: 'rigid' | 'horse+trailer',
 *      rigid_id?, horse_id?, trailer_id?,
 *      driver_id?, driver_name?,
 *      rigid_plate?, rigid_fleet?,
 *      horse_plate?, horse_fleet?,
 *      trailer_plate?, trailer_fleet?,
 *      capacity_kg, length_mm?, category?, priority?, branch_id?
 *    }   // required (fields consistent with assignment_plan_units)
 *  - assign_items?: Array<{ item_id: uuid, weight_kg?: number, note?: string }>
 *      // optional manual list
 *  - auto_fill?: boolean
 *      // if true, auto-pack remaining unassigned items into this single unit (family-locked)
 *  - lock_family?: string
 *      // optional override; else inferred from the first assigned/auto-filled item’s route_name
 *  - create_empty?: boolean
 *      // default false; if no items survive duplicate checks and auto_fill=false, don't create unit unless true
 *  - customerUnitCap?: number (default 2)  // kept for parity with auto-assign rules
 */
export const addIdleUnit = async (req, res) => {
  try {
    const {
      plan_id,
      unit,
      assign_items = [],
      auto_fill = false,
      lock_family = null,
      create_empty = false,
      customerUnitCap = 2,
    } = req.body || {}

    if (!plan_id) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'plan_id is required'))
    }
    if (!unit?.unit_type) {
      return res
        .status(400)
        .json(new Response(400, 'Bad Request', 'unit.unit_type is required'))
    }

    // 1) Fetch plan + its date/scope so we can enforce per-day trip caps and filter items correctly
    const planQ = await database
      .from('assignment_plans')
      .select('id, departure_date, scope_branch_id, scope_customer_id')
      .eq('id', plan_id)
      .single()
    if (planQ.error || !planQ.data)
      throw planQ.error || new Error('Plan not found')
    const plan = planQ.data
    const depISO = plan.departure_date

    // 2) Enforce 2 trips/day/vehicle
    const tripsUsedMap = await fetchTripsUsedByVehicle(database, depISO)
    const vKey = vehicleKey(unit)
    const usedTrips = Number(tripsUsedMap.get(vKey) || 0)
    if (usedTrips >= 2) {
      return res
        .status(409)
        .json(
          new Response(
            409,
            'Conflict',
            'This vehicle already has 2 trips for the plan date.'
          )
        )
    }

    // ---------- Resolve candidate items ----------
    // We build candidate rows (pre-insert) so we can avoid creating an empty unit
    const candidateRows = []

    // 2a) Manual assigns (if provided)
    if (Array.isArray(assign_items) && assign_items.length) {
      // Pull details from v_unassigned_items_effective to get route_name, etc.
      const ids = [
        ...new Set(assign_items.map((x) => x.item_id).filter(Boolean)),
      ]
      if (ids.length) {
        let q = database
          .from('v_unassigned_items_effective')
          .select(
            'item_id, load_id, order_id, customer_id, customer_name, suburb_name, route_name, order_date, description, weight_kg, order_number'
          )
          .in('item_id', ids)
        // Respect plan scope if present
        if (
          Array.isArray(plan.scope_branch_id) &&
          plan.scope_branch_id.length
        ) {
          q = q.in('branch_id', plan.scope_branch_id)
        } else if (plan.scope_branch_id) {
          q = q.eq('branch_id', plan.scope_branch_id)
        }
        if (plan.scope_customer_id) {
          q = q.eq('customer_id', plan.scope_customer_id)
        }
        const { data: rows, error } = await q
        if (error) throw error

        const weightById = new Map(
          assign_items.map((x) => [x.item_id, Number(x.weight_kg || 0)])
        )
        const noteById = new Map(
          assign_items.map((x) => [x.item_id, x.note || 'manual'])
        )

        for (const r of rows || []) {
          candidateRows.push({
            load_id: r.load_id,
            order_id: r.order_id,
            item_id: r.item_id,
            assigned_weight_kg:
              weightById.get(r.item_id) || Number(r.weight_kg || 0),
            priority_note: noteById.get(r.item_id) || 'manual',
            // carry-through to validate family and to enrich preview if needed
            _route_name: r.route_name,
            _customer_id: r.customer_id,
          })
        }
      }
    }

    // 2b) Auto-fill remaining unassigned items (optional)
    if (auto_fill) {
      // Pull all unassigned items in plan scope; we will family-filter below
      let q = database
        .from('v_unassigned_items_effective')
        .select(
          'item_id, load_id, order_id, customer_id, customer_name, suburb_name, route_name, order_date, description, weight_kg, order_number'
        )
      // if (Array.isArray(plan.scope_branch_id) && plan.scope_branch_id.length) {
      //   q = q.in('branch_id', plan.scope_branch_id)
      // } else if (plan.scope_branch_id) {
      //   q = q.eq('branch_id', plan.scope_branch_id)
      // }
      if (plan.scope_branch_id) {
        q = q.eq('branch_id', plan.scope_branch_id) // null => all
      }
      if (plan.scope_customer_id) {
        q = q.eq('customer_id', plan.scope_customer_id)
      }
      const { data: rows, error } = await q
      if (error) throw error

      // Determine the family lock: explicit -> from first manual item -> else first auto candidate
      let fam = lock_family
      if (!fam && candidateRows.length)
        fam = familyFrom(candidateRows[0]._route_name)
      if (!fam && rows?.length) fam = familyFrom(rows[0].route_name)

      for (const r of rows || []) {
        if (fam && familyFrom(r.route_name) !== fam) continue // strict family lock
        candidateRows.push({
          load_id: r.load_id,
          order_id: r.order_id,
          item_id: r.item_id,
          assigned_weight_kg: Number(r.weight_kg || 0),
          priority_note: 'auto_fill',
          _route_name: r.route_name,
          _customer_id: r.customer_id,
        })
      }
    }

    // 3) Enforce per-customer unit cap at add time:
    // Count how many distinct units this customer already occupies in THIS plan, and skip new customer->unit overflow beyond cap.
    // (We only enforce when auto-filling; manual lists are trusted.)
    if (auto_fill && customerUnitCap > 0) {
      // build a quick map customer -> distinct units in plan
      const { data: unitJoins, error: joinErr } = await database
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
      for (const row of unitJoins || []) {
        const cid = row?.load_orders?.customer_id || 'anon'
        const set = unitSetByCustomer.get(cid) || new Set()
        set.add(row.plan_unit_id)
        unitSetByCustomer.set(cid, set)
      }
      // Filter candidates if adding them would exceed the cap for their customer
      const filtered = []
      for (const r of candidateRows) {
        const cid = r._customer_id || 'anon'
        const set = unitSetByCustomer.get(cid) || new Set()
        if (set.size >= Number(customerUnitCap)) {
          continue // skip; customer already has enough units in this plan
        }
        filtered.push(r)
      }
      candidateRows.length = 0
      candidateRows.push(...filtered)
    }

    // 4) Duplicate-safe precheck: skip items already assigned anywhere
    const uniqueItemIds = [
      ...new Set(candidateRows.map((r) => r.item_id).filter(Boolean)),
    ]
    let rowsToInsert = []
    if (uniqueItemIds.length) {
      const { data: existing, error: existErr } = await database
        .from('assignment_plan_item_assignments')
        .select('item_id')
        .in('item_id', uniqueItemIds)
      if (existErr) throw existErr
      const existingIds = new Set((existing || []).map((r) => r.item_id))
      rowsToInsert = candidateRows
        .filter(
          (r) =>
            r.item_id &&
            !existingIds.has(r.item_id) &&
            Number(r.assigned_weight_kg) > 0
        )
        .map((r) => ({
          plan_unit_id: null, // fill after we create unit
          load_id: r.load_id,
          order_id: r.order_id,
          item_id: r.item_id,
          assigned_weight_kg: r.assigned_weight_kg,
          priority_note: r.priority_note,
        }))
    }

    // If nothing to insert and we are not explicitly creating empty units, bail early.
    if (!rowsToInsert.length && !create_empty) {
      return res.status(200).json(
        new Response(
          200,
          'OK',
          'No items to assign (duplicates, family/cap constraints, or zero weight). Unit not created.',
          {
            plan: { id: plan.id, departure_date: plan.departure_date },
            assigned_units: [],
            unassigned: await fetchUnassignedBucket(plan.id),
          }
        )
      )
    }

    // 5) Create the unit (respect trip cap; set trip_no 1 or 2)
    const insUnit = await database
      .from('assignment_plan_units')
      .insert([
        {
          plan_id: plan.id,
          unit_type: unit.unit_type,
          rigid_id: unit.rigid_id ?? null,
          trailer_id: unit.trailer_id ?? null,
          horse_id: unit.horse_id ?? null,
          driver_id: unit.driver_id ?? null,
          driver_name: unit.driver_name ?? null,
          rigid_plate: unit.rigid_plate ?? null,
          rigid_fleet: unit.rigid_fleet ?? null,
          horse_plate: unit.horse_plate ?? null,
          horse_fleet: unit.horse_fleet ?? null,
          trailer_plate: unit.trailer_plate ?? null,
          trailer_fleet: unit.trailer_fleet ?? null,
          capacity_kg: Number(unit.capacity_kg || 0),
          priority: Number(unit.priority || 0),
          branch_id: unit.branch_id ?? null,
          category: unit.category || '',
          length_mm: Number(unit.length_mm || 0),
          trip_no: Math.min(usedTrips + 1, 2),
        },
      ])
      .select('*')
      .single()
    if (insUnit.error) throw insUnit.error
    const planUnitId = insUnit.data.id

    // 6) Insert assignments if any survived
    if (rowsToInsert.length) {
      const toInsert = rowsToInsert.map((r) => ({
        ...r,
        plan_unit_id: planUnitId,
      }))
      const insA = await insertAssignmentsSafely(database, toInsert)
      if (insA.error) throw insA.error
    }

    // 7) Recalc capacity + return nested view
    await recalcUsedCapacity(plan.id)

    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(plan.id),
      fetchPlanAssignments(plan.id),
      fetchUnassignedBucket(plan.id),
    ])

    return res.status(200).json(
      new Response(
        200,
        'OK',
        'Unit added' +
          (rowsToInsert.length
            ? ' with assignments'
            : create_empty
            ? ' (empty by request)'
            : ' (no qualifying items found)'),
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
