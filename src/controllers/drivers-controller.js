import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

export const getAllDrivers = async (req, res) => {
  try {
    const { data, error } = await database.from('drivers').select('*')
    if (error) throw error
    res.status(200).json(data)
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
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    res.status(200).json(data)
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
