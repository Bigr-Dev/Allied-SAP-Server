import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

export const getAllVehicles = async (req, res) => {
  try {
    const { data, error } = await database.from('vehicles').select('*')
    if (error) throw error
    res.status(200).json(data)
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
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    res.status(200).json(data)
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
