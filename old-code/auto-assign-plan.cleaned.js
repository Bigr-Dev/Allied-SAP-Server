import {
  insertAssignmentsSafely,
  enforcePackingRules,
  fetchTripsUsedByVehicle,
  familyFrom,
  vehicleKey,
  todayTomorrow,
  asISOorNull,
  fetchUnits,
  fetchItems,
  fetchRouteBranchMap,
  packItemsIntoUnits,
  recalcUsedCapacity,
  fetchPlanUnits,
  fetchPlanAssignments,
  fetchUnassignedBucket,
  buildNested,
  parseBranchSingle,
  sumWeightsByUnitIdx,
} from '../../helpers/assignment-planner-helpers.js'
import { Response } from '../../utils/classes.js'
import database from '../../config/supabase.js'

/**
 * Clean auto-assign controller with:
 * - NO per-zone cap
 * - NO per-day trips cap
 * - Per-customer unit cap DISABLED by default (can be re-enabled via body)
 * - Relies on early-family filter in the packer (helper) to spread onto new units
 * - Clear preview vs commit paths with robust bucket writing
 */
export const autoAssignLoads = async (req, res) => {
  try {
    const {
      departure_date,
      cutoff_date,
      branch_id,                 // string UUID | "all" | null
      customer_id = null,        // string UUID | "all" | null
      commit = false,
      notes = null,

      // knobs (kept for compatibility; safe defaults)
      capacityHeadroom = 0.1,
      lengthBufferMm = 600,
      ignoreLengthIfMissing = true,
      ignoreDepartment = true,
      // IMPORTANT: default to Infinity => no per-customer unit cap
      customerUnitCap = Infinity,
      routeAffinitySlop = 0.25,

      // debug
      debug_bypass_rules = false, // if true, skip rule stage entirely (diagnostics only)
    } = req.body || {}

    const { today, tomorrow } = todayTomorrow()
    const dep = asISOorNull(departure_date) || tomorrow
    const cut = asISOorNull(cutoff_date) || today

    // Single-branch-or-all filter used by current helpers
    const branch = parseBranchSingle(branch_id) // uuid or null ("all")
    const customer = customer_id && customer_id !== 'all' ? customer_id : null

    // === Pull data
    const units = await fetchUnits(branch)
    const itemsRaw = await fetchItems(cut, branch, customer)

    // Map route info upfront (stamps normalized route family)
    const routeMap = await fetchRouteBranchMap()
    const items = itemsRaw.map((it) => {
      const fromRoute = it.route_id ? routeMap.get(it.route_id) : null
      const route_name =
        it.route_name || fromRoute?.route_name || it.suburb_name || ''
      const route_group = familyFrom(route_name) // normalized macro family
      return {
        ...it,
        branch_id: it.branch_id || fromRoute?.branch_id || it.branch_id,
        route_name,
        route_group,
      }
    })

    // === Pack (early-family spreading is handled in the helper)
    const { placements, unplaced, state, units: shapedUnits } =
      packItemsIntoUnits(items, units, {
        capacityHeadroom,
        lengthBufferMm,
        ignoreLengthIfMissing,
        ignoreDepartment,
        customerUnitCap,     // soft hint for the packer only
        routeAffinitySlop,
      })

    // === Rules (hard enforcement) — keep minimal; no day/zone caps
    let filteredPlacements = placements
    let ruleRejected = []

    if (!debug_bypass_rules) {
      const resRules = enforcePackingRules(placements, shapedUnits, {
        // Per-customer cap only if finite; Infinity disables it (handled inside helper)
        customerUnitCap,
        // No trips/day cap is passed on purpose.
        // tripsUsedMap is not needed anymore for daily caps; omit to avoid accidental use.
      })
      filteredPlacements = resRules.filtered
      ruleRejected = resRules.rejected
    }

    // === Idle units (purely informational; not filtered by day caps)
    let branchNameById = new Map()
    try {
      const { data: branchRows } = await database.from('branches').select('id,name')
      if (branchRows?.length) branchNameById = new Map(branchRows.map((b) => [String(b.id), b.name]))
    } catch {}

    const usedIdxSetPreview = new Set(filteredPlacements.map((p) => p.unitIdx))
    const idleUnits = shapedUnits
      .map((u, idx) => ({ u, idx }))
      .filter(({ idx }) => !usedIdxSetPreview.has(idx))
      .map(({ u, idx }) => ({
        unit_key:
          u.unit_type === 'rigid'
            ? `rigid:${u.rigid_id ?? idx}`
            : u.unit_type === 'horse+trailer'
            ? `horse:${u.horse_id ?? idx}|trailer:${u.trailer_id ?? idx}`
            : `unit:${idx}`,
        unit_type: u.unit_type,
        driver_id: u.driver_id,
        driver_name: u.driver_name,
        fleet_number: u.rigid_fleet || u.horse_fleet || u.trailer_fleet || null,
        plate: u.rigid_plate || u.horse_plate || u.trailer_plate || null,
        capacity_kg: Number(u.capacity_kg),
        capacity_left_kg: state[idx]?.capacity_left ?? Number(u.capacity_kg),
        length_mm: u.length_mm || 0,
        category: u.category || '',
        priority: u.priority || 0,
        branch_id: u.branch_id ?? null,
        branch_name: branchNameById.get(String(u.branch_id ?? '')) || null,
      }))

    // === PREVIEW
    if (!commit) {
      const weightByIdx = sumWeightsByUnitIdx(filteredPlacements)
      const used = Array.from(weightByIdx.keys())

      const pseudoUnits = used.map((idx, i) => {
        const u = shapedUnits[idx]
        const usedKg = weightByIdx.get(idx) || 0
        return {
          plan_unit_id: `preview-${i}`,
          unit_type: u.unit_type,
          driver_id: u.driver_id,
          driver_name: u.driver_name,
          rigid_id: u.rigid_id,
          rigid_plate: u.rigid_plate,
          rigid_fleet: u.rigid_fleet,
          horse_id: u.horse_id,
          horse_plate: u.horse_plate,
          horse_fleet: u.horse_fleet,
          trailer_id: u.trailer_id,
          trailer_plate: u.trailer_plate,
          trailer_fleet: u.trailer_fleet,
          capacity_kg: Number(u.capacity_kg),
          used_capacity_kg: Number((usedKg || 0).toFixed(3)),
        }
      })

      const pseudoAssignments = filteredPlacements.map((p) => {
        const ordinal = used.indexOf(p.unitIdx)
        const i = p.item
        return {
          assignment_id: `preview-${p.unitIdx}-${i.item_id}`,
          plan_unit_id: `preview-${ordinal}`,
          load_id: i.load_id,
          order_id: i.order_id,
          item_id: i.item_id,
          assigned_weight_kg: p.weight,
          priority_note: 'auto',
          customer_id: i.customer_id,
          customer_name: i.customer_name,
          suburb_name: i.suburb_name,
          route_name: i.route_name,
          order_date: i.order_date,
          description: i.description,
          order_number: i.order_number ?? null,
        }
      })

      // rejected (rules) + original unplaced → bucket
      const bucket = [
        ...unplaced,
        ...ruleRejected.map((p) => ({
          load_id: p.item.load_id,
          order_id: p.item.order_id,
          item_id: p.item.item_id,
          customer_id: p.item.customer_id,
          customer_name: p.item.customer_name,
          suburb_name: p.item.suburb_name,
          route_name: p.item.route_name,
          order_date: p.item.order_date,
          weight_left: p.item.weight_kg,
          description: p.item.description,
          reason: 'rule_rejected',
        })),
      ]

      const nested = buildNested(pseudoUnits, pseudoAssignments, bucket)
      return res.status(200).json(
        new Response(200, 'OK', 'Auto-assignment preview (no DB changes)', {
          plan: {
            departure_date: dep,
            cutoff_date: cut,
            scope_branch_id: branch || null,
            scope_customer_id: customer || null,
            commit: false,
            parameters: {
              capacity_headroom: `${Math.round((capacityHeadroom || 0) * 100)}%`,
              length_buffer_mm: Number(lengthBufferMm || 0),
              ignore_length_if_missing: !!ignoreLengthIfMissing,
              ignore_department: !!ignoreDepartment,
              // If you set a finite number here, it will be enforced.
              customer_unit_cap:
                Number.isFinite(Number(customerUnitCap)) ? Number(customerUnitCap) : 'Infinity',
              route_affinity_slop: routeAffinitySlop,
              hard_route_lock: true, // now handled early in packer
              debug_bypass_rules: !!debug_bypass_rules,
            },
          },
          ...nested,
          idle_units_by_branch: idleUnits.reduce((acc, x) => {
            const key = x.branch_id == null ? 'unknown' : String(x.branch_id)
            if (!acc[key])
              acc[key] = {
                branch_id: x.branch_id ?? null,
                branch_name: x.branch_name || (x.branch_id == null ? 'Unknown' : null),
                total_idle: 0,
                units: [],
              }
            acc[key].total_idle += 1
            acc[key].units.push(x)
            return acc
          }, {}),
        })
      )
    }

    // === COMMIT
    const planIns = await database
      .from('assignment_plans')
      .insert([
        {
          departure_date: dep,
          cutoff_date: cut,
          scope_branch_id: branch,
          scope_customer_id: customer || null,
          notes,
        },
      ])
      .select('*')
      .single()

    if (planIns.error) throw planIns.error
    const plan = planIns.data

    // Build raw rows from filtered placements (keep unitIdx)
    const rawRows = filteredPlacements.map((p) => ({
      unitIdx: p.unitIdx,
      load_id: p.item.load_id,
      order_id: p.item.order_id,
      item_id: p.item.item_id,
      assigned_weight_kg: Number(p.weight || 0),
      priority_note: 'auto',
      _item: p.item,
    }))

    // Filter duplicates at DB level to avoid collisions
    const uniqueIds = [...new Set(rawRows.map((r) => r.item_id).filter(Boolean))]
    const { data: existing } = await database
      .from('assignment_plan_item_assignments')
      .select('item_id')
      .in('item_id', uniqueIds)
    const existingIds = new Set((existing || []).map((r) => r.item_id))
    const rowsToInsert = rawRows.filter(
      (r) => r.item_id && !existingIds.has(r.item_id) && r.assigned_weight_kg > 0
    )

    // No rows => write bucket & finish
    if (!rowsToInsert.length) {
      const finalBucket = await fetchUnassignedBucket(plan.id)
      return res.status(200).json(
        new Response(200, 'OK', 'Nothing to assign (duplicates or zero weight). Plan created without units.', {
          plan,
          assigned_units: [],
          unassigned: finalBucket,
        })
      )
    }

    // Prepare bucket for rejects + unplaced + duplicates/zero-weight
    const rejectedForBucket = [
      ...ruleRejected.map((p) => ({
        load_id: p.item.load_id,
        order_id: p.item.order_id,
        item_id: p.item.item_id,
        order_date: p.item.order_date,
        weight_left: p.item.weight_kg,
        reason: 'rule_rejected',
      })),
      ...unplaced,
      ...rawRows
        .filter((r) => r.item_id && existingIds.has(r.item_id))
        .map((r) => ({
          load_id: r.load_id,
          order_id: r.order_id,
          item_id: r.item_id,
          order_date: r._item.order_date,
          weight_left: r._item.weight_kg,
          reason: 'already_assigned',
        })),
      ...rawRows
        .filter((r) => r.item_id && !existingIds.has(r.item_id) && Number(r.assigned_weight_kg) <= 0)
        .map((r) => ({
          load_id: r.load_id,
          order_id: r.order_id,
          item_id: r.item_id,
          order_date: r._item.order_date,
          weight_left: r._item.weight_kg,
          reason: 'zero_weight',
        })),
    ]

    if (rejectedForBucket.length) {
      const bucketRows = rejectedForBucket
        .filter((r) => r.item_id)
        .map((r) => ({
          plan_id: plan.id,
          load_id: r.load_id,
          order_id: r.order_id,
          item_id: r.item_id,
          order_date: r.order_date || null,
          weight_left: Number(r.weight_left || 0),
          reason: r.reason || 'unplaced',
        }))

      if (bucketRows.length) {
        const { error } = await database.from('assignment_plan_unassigned_items').insert(bucketRows)
        if (error) console.warn('Bucket write failed:', error.message)
      }
    }

    // Create plan units ONLY for indices referenced by rowsToInsert
    const usedIdxSet = new Set(rowsToInsert.map((r) => r.unitIdx))
    const planUnitIdByIdx = new Map()

    // If you keep trip numbers historically, you can still compute "trip_no" without capping:
    // const latestTrips = await fetchTripsUsedByVehicle(database, dep)

    for (const idx of usedIdxSet) {
      const u = shapedUnits[idx]
      if (!u) continue

      const ins = await database
        .from('assignment_plan_units')
        .insert([{
          plan_id: plan.id,
          unit_type: u.unit_type,
          rigid_id: u.rigid_id,
          trailer_id: u.trailer_id,
          horse_id: u.horse_id,
          driver_id: u.driver_id,
          driver_name: u.driver_name,
          rigid_plate: u.rigid_plate,
          rigid_fleet: u.rigid_fleet,
          horse_plate: u.horse_plate,
          horse_fleet: u.horse_fleet,
          trailer_plate: u.trailer_plate,
          trailer_fleet: u.trailer_fleet,
          capacity_kg: u.capacity_kg,
          priority: u.priority || 0,
          branch_id: u.branch_id || null,
          category: u.category || '',
          length_mm: u.length_mm || 0,
          // trip_no: (Number(latestTrips.get(vehicleKey(u)) || 0)) + 1, // optional, no clamp
        }])
        .select('*')
        .single()

      if (ins.error) throw ins.error
      planUnitIdByIdx.set(idx, ins.data.id)
    }

    // Insert assignments for created plan units
    const toInsert = rowsToInsert
      .filter((r) => planUnitIdByIdx.has(r.unitIdx))
      .map((r) => ({
        plan_unit_id: planUnitIdByIdx.get(r.unitIdx),
        load_id: r.load_id,
        order_id: r.order_id,
        item_id: r.item_id,
        assigned_weight_kg: r.assigned_weight_kg,
        priority_note: r.priority_note,
      }))

    const itemsWithoutUnits = rowsToInsert
      .filter((r) => !planUnitIdByIdx.has(r.unitIdx))
      .map((r) => ({
        plan_id: plan.id,
        load_id: r.load_id,
        order_id: r.order_id,
        item_id: r.item_id,
        order_date: r._item?.order_date || null,
        weight_left: Number(r._item?.weight_kg || 0),
        reason: 'unit_creation_failed',
      }))

    if (itemsWithoutUnits.length) {
      const { error } = await database
        .from('assignment_plan_unassigned_items')
        .insert(itemsWithoutUnits)
      if (error) console.warn('Unit-failed bucket write failed:', error.message)
    }

    if (toInsert.length) {
      const insA = await insertAssignmentsSafely(database, toInsert)
      if (insA.error) throw insA.error
    }

    await recalcUsedCapacity(plan.id)

    const [unitsDb, assignsDb, bucket] = await Promise.all([
      fetchPlanUnits(plan.id),
      fetchPlanAssignments(plan.id),
      fetchUnassignedBucket(plan.id),
    ])

    return res.status(200).json(
      new Response(200, 'OK', 'Auto-assignment committed', {
        plan,
        ...buildNested(unitsDb, assignsDb, bucket),
      })
    )
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
