import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

// export const getAllDrivers = async (req, res) => {
//   try {
//     const { data, error } = await database.from('drivers').select('*')
//     if (error) throw error
//     res.status(200).json(data)
//   } catch (err) {
//     res
//       .status(500)
//       .json(new Response(500, 'Error fetching drivers', err.message))
//   }
// }

// export const getDriverById = async (req, res) => {
//   try {
//     const { id } = req.params
//     const { data, error } = await database
//       .from('drivers')
//       .select('*')
//       .eq('id', id)
//       .single()
//     if (error) throw error
//     res.status(200).json(data)
//   } catch (err) {
//     res
//       .status(500)
//       .json(new Response(500, 'Error fetching driver', err.message))
//   }
// }

// Common select with branch join
const driverSelect =
  'id,branch_id,name,last_name,id_doctype,identity_number,phone,email,emergency_contact,emergency_phone,license_type,license,license_code,license_expiry,attach_license_front,attach_license_back,professional_permit,attach_professional_permit,permit_expiry_date,status,assigned_to,current_trip_id,current_trip,last_trip_id,date_of_birth,medical_exam_expiry,hire_date,certifications,driving_record,recent_trips,created_at,updated_at,current_vehicle,branch:branches(name)'

export const getAllDrivers = async (req, res) => {
  try {
    const { data, error } = await database.from('drivers').select(driverSelect)
    if (error) throw error

    // Flatten branch.name → branch_name
    const withBranchName = (data || []).map((d) => {
      const { branch, ...rest } = d
      return { ...rest, branch_name: branch?.name ?? null }
    })

    res.status(200).json(withBranchName)
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error fetching drivers', err.message))
  }
}

export const getDriverById = async (req, res) => {
  try {
    const { id } = req.params
    const { data, error } = await database
      .from('drivers')
      .select(driverSelect)
      .eq('id', id)
      .single()

    if (error) throw error

    const { branch, ...rest } = data
    const flattened = { ...rest, branch_name: branch?.name ?? null }

    res.status(200).json(flattened)
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error fetching driver', err.message))
  }
}

export const createDriver = async (req, res) => {
  try {
    const { data, error } = await database
      .from('drivers')
      .insert([req.body])
      .select()
    if (error) throw error
    res.status(201).json(data[0])
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error creating driver', err.message))
  }
}

export const updateDriver = async (req, res) => {
  try {
    const { id } = req.params
    const { data, error } = await database
      .from('drivers')
      .update(req.body)
      .eq('id', id)
      .select()
    if (error) throw error
    res.status(200).json(data[0])
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error updating driver', err.message))
  }
}

export const deleteDriver = async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await database.from('drivers').delete().eq('id', id)
    if (error) throw error
    res.status(200).json(new Response(200, 'Driver deleted'))
  } catch (err) {
    res
      .status(500)
      .json(new Response(500, 'Error deleting driver', err.message))
  }
}
