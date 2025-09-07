import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

const table = 'branches'

// export const getAllBranches = async (req, res) => {
//   const { data, error } = await database
//     .from(table)
//     .select('*')
//     .order('created_at', { ascending: false })

//   if (error)
//     return res
//       .status(500)
//       .send(new Response(500, 'Error fetching branches', error.message))
//   return res.status(200).send(new Response(200, 'OK', data))
// }
export const getAllBranches = async (req, res) => {
  try {
    const { data, error } = await database
      .from('branches')
      .select(
        `
        *,
        user_count:users!users_branch_id_fkey(count),
        vehicle_count:vehicles!vehicles_branch_id_fkey(count)
      `
      )
      .order('created_at', { ascending: false })

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error fetching branches', error.message))
    }

    // The nested counts come back as arrays like [{ count: 3 }]
    const shaped = data.map(({ user_count, vehicle_count, ...b }) => ({
      ...b,
      user_count: user_count?.[0]?.count ?? 0,
      vehicle_count: vehicle_count?.[0]?.count ?? 0,
    }))

    return res.status(200).send(new Response(200, 'OK', shaped))
  } catch (err) {
    return res
      .status(500)
      .send(new Response(500, 'Error fetching branches', err.message))
  }
}

export const getBranchById = async (req, res) => {
  const { id } = req.params
  const { data, error } = await database
    .from(table)
    .select('*')
    .eq('id', id)
    .single()

  if (error)
    return res
      .status(404)
      .send(new Response(404, 'Branch not found', error.message))
  return res.status(200).send(new Response(200, 'OK', data))
}

export const createBranch = async (req, res) => {
  try {
    const branch = {
      ...req.body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await database
      .from(table) // e.g. 'branches'
      .insert(branch) // no need for [branch] when inserting one row
      .select('id') // ask Postgres to RETURNING id
      .single() // because we inserted one row

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Create failed', error.message))
    }

    // Optional but nice REST touch:
    res.setHeader('Location', `/api/branches/${data.id}`)

    return res
      .status(201)
      .send(new Response(201, 'Branch created', { id: data.id }))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Create failed', err.message))
  }
}

export const updateBranch = async (req, res) => {
  const { id } = req.params

  const updatedBranch = {
    ...req.body,
    updated_at: new Date().toISOString(),
  }

  const { error } = await database
    .from(table)
    .update(updatedBranch)
    .eq('id', id)
  if (error)
    return res
      .status(500)
      .send(new Response(500, 'Update failed', error.message))

  return res.status(200).send(new Response(200, 'Branch updated'))
}

export const deleteBranch = async (req, res) => {
  const { id } = req.params
  const { error } = await database.from(table).delete().eq('id', id)

  if (error)
    return res
      .status(500)
      .send(new Response(500, 'Delete failed', error.message))
  return res.status(200).send(new Response(200, 'Branch deleted'))
}
