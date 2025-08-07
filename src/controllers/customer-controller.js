import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

// Helper: Sanitize and parse row_number
const parseRowNumber = (value) => {
  const num = parseFloat(value)
  return isNaN(num) ? null : Math.floor(num)
}

export const createCustomer = async (req, res) => {
  try {
    const body = { ...req.body }

    if ('row_number' in body) {
      body.row_number = parseRowNumber(body.row_number)
    }

    // Optional: Prevent duplicate bp_code
    if (body.bp_code) {
      const { data: existing } = await database
        .from('customers')
        .select('id')
        .eq('bp_code', body.bp_code)
        .maybeSingle()

      if (existing) {
        return res
          .status(409)
          .send(
            new Response(
              409,
              'Conflict',
              'Customer with this BP code already exists'
            )
          )
      }
    }

    const { error } = await database.from('customers').insert([body])
    if (error) throw error

    return res.status(201).send(new Response(201, 'Created', 'Customer added'))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Error', err.message))
  }
}

export const getCustomers = async (req, res) => {
  try {
    const { data, error } = await database.from('customers').select('*')
    if (error) throw error

    return res.status(200).send(new Response(200, 'OK', 'Customer list', data))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Error', err.message))
  }
}

export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params
    const { data, error } = await database
      .from('customers')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error

    return res.status(200).send(new Response(200, 'OK', 'Customer found', data))
  } catch (err) {
    return res.status(404).send(new Response(404, 'Not Found', err.message))
  }
}

export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params
    const body = { ...req.body }

    if ('row_number' in body) {
      body.row_number = parseRowNumber(body.row_number)
    }

    const { data, error } = await database
      .from('customers')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return res
      .status(200)
      .send(new Response(200, 'Updated', 'Customer updated', data))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Error', err.message))
  }
}

export const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await database
      .from('customers')
      .delete()
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return res
      .status(200)
      .send(new Response(200, 'Deleted', 'Customer removed', data))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Error', err.message))
  }
}
