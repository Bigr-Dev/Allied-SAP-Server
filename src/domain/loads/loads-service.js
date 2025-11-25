import database from '../../config/supabase.js'

/**
 * Loads Service - Encapsulates load/order-related business logic
 */

export async function assignVehicleToLoad({ loadId, vehicleAssignmentId, planId }) {
  if (!loadId || !vehicleAssignmentId) {
    const error = new Error('loadId and vehicleAssignmentId are required')
    error.statusCode = 400
    throw error
  }

  // Check if load exists
  const { data: loads, error: loadErr } = await database
    .from('loads')
    .select('id, assignment_plan_id, assigned_unit_id')
    .eq('id', loadId)
    .limit(1)

  if (loadErr) throw loadErr
  const load = loads && loads[0]
  if (!load) {
    const error = new Error('Load not found')
    error.statusCode = 404
    throw error
  }

  // Update load assignment
  const { error: updateErr } = await database
    .from('loads')
    .update({
      assignment_plan_id: planId || null,
      assigned_unit_id: vehicleAssignmentId,
      is_split: false,
    })
    .eq('id', loadId)

  if (updateErr) throw updateErr

  // Update load items
  const { error: itemsErr } = await database
    .from('load_items')
    .update({
      assignment_plan_id: planId || null,
      assigned_unit_id: vehicleAssignmentId,
    })
    .eq('order_id', loadId)

  if (itemsErr) throw itemsErr

  return { success: true, loadId, vehicleAssignmentId }
}

export async function unassignVehicleFromLoad({ loadId }) {
  if (!loadId) {
    const error = new Error('loadId is required')
    error.statusCode = 400
    throw error
  }

  // Update load assignment
  const { error: updateErr } = await database
    .from('loads')
    .update({
      assignment_plan_id: null,
      assigned_unit_id: null,
      is_split: false,
    })
    .eq('id', loadId)

  if (updateErr) throw updateErr

  // Update load items
  const { error: itemsErr } = await database
    .from('load_items')
    .update({
      assignment_plan_id: null,
      assigned_unit_id: null,
    })
    .eq('order_id', loadId)

  if (itemsErr) throw itemsErr

  return { success: true, loadId }
}

export async function getLoadById(loadId) {
  if (!loadId) {
    const error = new Error('loadId is required')
    error.statusCode = 400
    throw error
  }

  const { data: loads, error: loadErr } = await database
    .from('loads')
    .select('*')
    .eq('id', loadId)
    .limit(1)

  if (loadErr) throw loadErr
  const load = loads && loads[0]
  if (!load) {
    const error = new Error('Load not found')
    error.statusCode = 404
    throw error
  }

  // Get load items
  const { data: items, error: itemsErr } = await database
    .from('load_items')
    .select('*')
    .eq('order_id', loadId)

  if (itemsErr) throw itemsErr

  return {
    ...load,
    items: items || []
  }
}

export async function listLoads(filters = {}) {
  const {
    limit = 50,
    offset = 0,
    assignment_plan_id,
    assigned_unit_id,
    branch_id,
    customer_id,
    delivery_date_from,
    delivery_date_to,
  } = filters

  let query = database
    .from('loads')
    .select('*', { count: 'exact' })

  if (assignment_plan_id) {
    query = query.eq('assignment_plan_id', assignment_plan_id)
  }
  if (assigned_unit_id) {
    query = query.eq('assigned_unit_id', assigned_unit_id)
  }
  if (branch_id) {
    query = query.eq('branch_id', branch_id)
  }
  if (customer_id) {
    query = query.eq('customer_id', customer_id)
  }
  if (delivery_date_from) {
    query = query.gte('delivery_date', delivery_date_from)
  }
  if (delivery_date_to) {
    query = query.lte('delivery_date', delivery_date_to)
  }

  query = query
    .order('delivery_date', { ascending: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data: loads, count, error } = await query
  if (error) throw error

  return {
    loads: loads || [],
    total: count || 0,
    limit,
    offset
  }
}