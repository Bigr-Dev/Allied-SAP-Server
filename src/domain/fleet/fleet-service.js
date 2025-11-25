import database from '../../config/supabase.js'

/**
 * Fleet Service - Encapsulates vehicle assignment and fleet management logic
 */

export async function getVehicleAssignments(filters = {}) {
  const {
    branch_id,
    status = 'active',
    vehicle_type,
    limit = 100,
    offset = 0
  } = filters

  let query = database
    .from('vehicle_assignments')
    .select(`
      id,
      branch_id,
      vehicle_id,
      trailer_id,
      vehicle_type,
      driver_id,
      status,
      created_at,
      updated_at
    `, { count: 'exact' })

  if (branch_id) {
    query = query.eq('branch_id', branch_id)
  }
  if (status) {
    query = query.eq('status', status)
  }
  if (vehicle_type) {
    query = query.eq('vehicle_type', vehicle_type)
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data: assignments, count, error } = await query
  if (error) throw error

  return {
    assignments: assignments || [],
    total: count || 0,
    limit,
    offset
  }
}

export async function getVehicleAssignmentById(assignmentId) {
  if (!assignmentId) {
    const error = new Error('assignmentId is required')
    error.statusCode = 400
    throw error
  }

  const { data: assignments, error: assignmentErr } = await database
    .from('vehicle_assignments')
    .select('*')
    .eq('id', assignmentId)
    .limit(1)

  if (assignmentErr) throw assignmentErr
  const assignment = assignments && assignments[0]
  if (!assignment) {
    const error = new Error('Vehicle assignment not found')
    error.statusCode = 404
    throw error
  }

  // Get related vehicle, trailer, and driver info
  const vehicleIds = [assignment.vehicle_id, assignment.trailer_id].filter(Boolean)
  const vehicles = new Map()
  
  if (vehicleIds.length > 0) {
    const { data: vehicleData, error: vehicleErr } = await database
      .from('vehicles')
      .select('*')
      .in('id', vehicleIds)

    if (vehicleErr) throw vehicleErr
    vehicleData?.forEach(v => vehicles.set(v.id, v))
  }

  let driver = null
  if (assignment.driver_id) {
    const { data: driverData, error: driverErr } = await database
      .from('drivers')
      .select('*')
      .eq('id', assignment.driver_id)
      .limit(1)

    if (driverErr) throw driverErr
    driver = driverData && driverData[0]
  }

  return {
    ...assignment,
    vehicle: assignment.vehicle_id ? vehicles.get(assignment.vehicle_id) : null,
    trailer: assignment.trailer_id ? vehicles.get(assignment.trailer_id) : null,
    driver
  }
}

export async function createVehicleAssignment(payload) {
  const {
    branch_id,
    vehicle_id,
    trailer_id,
    vehicle_type,
    driver_id,
    status = 'active'
  } = payload

  if (!branch_id || !vehicle_id || !vehicle_type) {
    const error = new Error('branch_id, vehicle_id, and vehicle_type are required')
    error.statusCode = 400
    throw error
  }

  // Validate vehicle exists
  const { data: vehicles, error: vehicleErr } = await database
    .from('vehicles')
    .select('id, type')
    .eq('id', vehicle_id)
    .limit(1)

  if (vehicleErr) throw vehicleErr
  if (!vehicles || !vehicles[0]) {
    const error = new Error('Vehicle not found')
    error.statusCode = 404
    throw error
  }

  // Validate trailer if provided
  if (trailer_id) {
    const { data: trailers, error: trailerErr } = await database
      .from('vehicles')
      .select('id, type')
      .eq('id', trailer_id)
      .limit(1)

    if (trailerErr) throw trailerErr
    if (!trailers || !trailers[0]) {
      const error = new Error('Trailer not found')
      error.statusCode = 404
      throw error
    }
  }

  // Validate driver if provided
  if (driver_id) {
    const { data: drivers, error: driverErr } = await database
      .from('drivers')
      .select('id')
      .eq('id', driver_id)
      .limit(1)

    if (driverErr) throw driverErr
    if (!drivers || !drivers[0]) {
      const error = new Error('Driver not found')
      error.statusCode = 404
      throw error
    }
  }

  const { data: assignment, error: insertErr } = await database
    .from('vehicle_assignments')
    .insert([{
      branch_id,
      vehicle_id,
      trailer_id,
      vehicle_type,
      driver_id,
      status
    }])
    .select('*')
    .single()

  if (insertErr) throw insertErr

  return assignment
}

export async function updateVehicleAssignment(assignmentId, payload) {
  if (!assignmentId) {
    const error = new Error('assignmentId is required')
    error.statusCode = 400
    throw error
  }

  // Check if assignment exists
  const { data: existing, error: existErr } = await database
    .from('vehicle_assignments')
    .select('id')
    .eq('id', assignmentId)
    .limit(1)

  if (existErr) throw existErr
  if (!existing || !existing[0]) {
    const error = new Error('Vehicle assignment not found')
    error.statusCode = 404
    throw error
  }

  const { data: assignment, error: updateErr } = await database
    .from('vehicle_assignments')
    .update(payload)
    .eq('id', assignmentId)
    .select('*')
    .single()

  if (updateErr) throw updateErr

  return assignment
}

export async function deleteVehicleAssignment(assignmentId) {
  if (!assignmentId) {
    const error = new Error('assignmentId is required')
    error.statusCode = 400
    throw error
  }

  // Check if assignment is being used in any plans
  const { data: planUsage, error: usageErr } = await database
    .from('planned_units')
    .select('id')
    .eq('vehicle_assignment_id', assignmentId)
    .limit(1)

  if (usageErr) throw usageErr
  if (planUsage && planUsage[0]) {
    const error = new Error('Cannot delete vehicle assignment: it is being used in active plans')
    error.statusCode = 400
    throw error
  }

  const { error: deleteErr } = await database
    .from('vehicle_assignments')
    .delete()
    .eq('id', assignmentId)

  if (deleteErr) throw deleteErr

  return { success: true, assignmentId }
}