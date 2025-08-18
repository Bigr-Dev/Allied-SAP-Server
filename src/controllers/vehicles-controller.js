import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

// export const getAllVehicles = async (req, res) => {
//   try {
//     const { data, error } = await database.from('vehicles').select('*')
//     if (error) throw error
//     res.status(200).json(data)
//   } catch (err) {
//     res
//       .status(500)
//       .json(new Response(500, 'Error fetching vehicles', err.message))
//   }
// }

// export const getVehicleById = async (req, res) => {
//   try {
//     const { id } = req.params
//     const { data, error } = await database
//       .from('vehicles')
//       .select('*')
//       .eq('id', id)
//       .single()
//     if (error) throw error
//     res.status(200).json(data)
//   } catch (err) {
//     res
//       .status(500)
//       .json(new Response(500, 'Error fetching vehicle', err.message))
//   }
// }
// Common select with branch join
const vehicleSelect =
  'id,type,reg_number,license_plate,vin,engine_number,vehicle_category,model,series_name,vehicle_description,tare,registration_date,capacity,fuel_type,status,width,height,length,transmission,branch_id,purchase_date,priority,licence_expiry_date,last_service,service_intervals_km,service_intervals_months,manufacturer,year,color,insurance_expiry,odometer,fuel_efficiency,dimensions,max_speed,current_driver,assigned_to,current_trip_id,last_trip_id,tracker_provider,tracker_device_id,created_at,updated_at,purchase_price,retail_price,service_provider,fleet_number,branch:branches(name)'

export const getAllVehicles = async (req, res) => {
  try {
    const { data, error } = await database
      .from('vehicles')
      .select(vehicleSelect)
    if (error) throw error

    // Flatten branch.name → branch_name
    const withBranchName = (data || []).map((v) => {
      const { branch, ...rest } = v
      return { ...rest, branch_name: branch?.name ?? null }
    })

    res.status(200).json(withBranchName)
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error fetching vehicles', err.message))
  }
}

export const getVehicleById = async (req, res) => {
  try {
    const { id } = req.params
    const { data, error } = await database
      .from('vehicles')
      .select(vehicleSelect)
      .eq('id', id)
      .single()

    if (error) throw error

    const { branch, ...rest } = data
    const flattened = { ...rest, branch_name: branch?.name ?? null }

    res.status(200).json(flattened)
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error fetching vehicle', err.message))
  }
}

export const createVehicle = async (req, res) => {
  try {
    const { data, error } = await database
      .from('vehicles')
      .insert([req.body])
      .select()
    if (error) throw error
    res.status(201).json(data[0])
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error creating vehicle', err.message))
  }
}

export const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params
    const { data, error } = await database
      .from('vehicles')
      .update(req.body)
      .eq('id', id)
      .select()
    if (error) throw error
    res.status(200).json(data[0])
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error updating vehicle', err.message))
  }
}

export const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await database.from('vehicles').delete().eq('id', id)
    if (error) throw error
    res.status(200).json(new Response(200, 'Vehicle deleted'))
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error deleting vehicle', err.message))
  }
}
