// --- USERS CONTROLLER WITH BRANCH RELATIONSHIP ---
import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

const table = 'users'

// export const getAllUsers = async (req, res) => {
//   const { branch_id } = req.query
//   const query = database
//     .from(table)
//     .select('*')
//     .order('created_at', { ascending: false })
//   if (branch_id) query.eq('branch_id', branch_id)

//   const { data, error } = await query
//   if (error)
//     return res
//       .status(500)
//       .send(new Response(500, 'Error fetching users', error.message))
//   return res.status(200).send(new Response(200, 'OK', data))
// }

// export const getUserById = async (req, res) => {
//   const { id } = req.params
//   const { data, error } = await database
//     .from(table)
//     .select('*')
//     .eq('id', id)
//     .single()
//   if (error)
//     return res
//       .status(404)
//       .send(new Response(404, 'User not found', error.message))
//   return res.status(200).send(new Response(200, 'OK', data))
// }

// Common select including the related branch
const userSelect =
  'id,name,last_name,email,role,branch_id,status,phone,department,position,join_date,permissions,managed_branches,recent_activities,created_at,updated_at,branch:branches(name)'

export const getAllUsers = async (req, res) => {
  try {
    const { branch_id } = req.query

    let query = database
      .from(table) // e.g. 'users'
      .select(userSelect)
      .order('created_at', { ascending: false })

    if (branch_id) query = query.eq('branch_id', branch_id)

    const { data, error } = await query
    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error fetching users', error.message))
    }

    // Flatten branch.name → branch_name and remove the nested object
    const withBranchName = (data || []).map((u) => {
      const { branch, ...rest } = u
      return { ...rest, branch_name: branch?.name ?? null }
    })

    return res.status(200).send(new Response(200, 'OK', withBranchName))
  } catch (err) {
    return res
      .status(500)
      .send(new Response(500, 'Unexpected error', err.message))
  }
}

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await database
      .from(table) // e.g. 'users'
      .select(userSelect)
      .eq('id', id)
      .single()

    if (error) {
      return res
        .status(404)
        .send(new Response(404, 'User not found', error.message))
    }

    const { branch, ...rest } = data
    const flattened = { ...rest, branch_name: branch?.name ?? null }

    return res.status(200).send(new Response(200, 'OK', flattened))
  } catch (err) {
    return res
      .status(500)
      .send(new Response(500, 'Unexpected error', err.message))
  }
}

// export const createUser = async (req, res) => {
//   const {
//     id,
//     name,
//     last_name,
//     email,
//     role = 'user',
//     branch_id,
//     status = 'active',
//     phone,
//     department,
//     position,
//     join_date,
//     permissions = [],
//     managed_branches = [],
//     recent_activities = [],
//   } = req.body

//   if (!id || !branch_id) {
//     return res
//       .status(400)
//       .send(new Response(400, 'Missing required fields: id and branch_id'))
//   }

//   const user = {
//     id,
//     name,
//     last_name,
//     email,
//     role,
//     branch_id,
//     status,
//     phone,
//     department,
//     position,
//     join_date,
//     permissions,
//     managed_branches,
//     recent_activities,
//     created_at: new Date().toISOString(),
//     updated_at: new Date().toISOString(),
//   }

//   const { error } = await database.from(table).insert([user])
//   if (error)
//     return res
//       .status(500)
//       .send(new Response(500, 'Create failed', error.message))
//   return res.status(201).send(new Response(201, 'User created'))
// }
export const createUser = async (req, res) => {
  try {
    const {
      // Auth fields
      email,
      password = 'password', // default; you can pass your own in the body
      // Profile fields
      name,
      last_name,
      role = 'user',
      branch_id,
      status = 'active',
      phone,
      department,
      position,
      join_date,
      permissions = [],
      managed_branches = [],
      recent_activities = [],
    } = req.body

    // Minimal required fields for your app logic
    if (!email || !branch_id) {
      return res
        .status(400)
        .send(new Response(400, 'Missing required fields: email and branch_id'))
    }

    // 1) Create the Auth user first (server-side client with service_role)
    const { data: authData, error: authError } =
      await database.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // consider whether you want this
        user_metadata: { name, last_name, role, branch_id },
      })

    if (authError) {
      // Common duplicate email from GoTrue returns 422
      const status = authError.status === 422 ? 409 : authError.status || 500
      return res
        .status(status)
        .send(new Response(status, 'Auth create failed', authError.message))
    }

    const authUserId = authData?.user?.id
    if (!authUserId) {
      return res
        .status(500)
        .send(new Response(500, 'Auth did not return a user id'))
    }

    // 2) Insert the profile using the Auth user id
    const now = new Date().toISOString()
    const row = {
      id: authUserId,
      name,
      last_name,
      email,
      role,
      branch_id,
      status,
      phone,
      department,
      position,
      join_date,
      permissions,
      managed_branches,
      recent_activities,
      created_at: now,
      updated_at: now,
    }

    const { error: dbError } = await database.from('users').insert([row])

    if (dbError) {
      // 3) Roll back the Auth user to keep things consistent
      try {
        await database.auth.admin.deleteUser(authUserId, {
          shouldSoftDelete: false,
        })
      } catch (_) {
        // swallow rollback errors, but still report the DB failure
      }
      return res
        .status(500)
        .send(new Response(500, 'Create failed (DB insert)', dbError.message))
    }

    return res
      .status(201)
      .send(new Response(201, 'User created', { id: authUserId }))
  } catch (err) {
    return res
      .status(500)
      .send(new Response(500, 'Unexpected error', err.message))
  }
}

export const updateUser = async (req, res) => {
  const { id } = req.params
  const updatedUser = {
    ...req.body,
    updated_at: new Date().toISOString(),
  }
  const { error } = await database.from(table).update(updatedUser).eq('id', id)
  if (error)
    return res
      .status(500)
      .send(new Response(500, 'Update failed', error.message))
  return res.status(200).send(new Response(200, 'User updated'))
}

export const deleteUser = async (req, res) => {
  const { id } = req.params
  const { error } = await database.from(table).delete().eq('id', id)
  if (error)
    return res
      .status(500)
      .send(new Response(500, 'Delete failed', error.message))
  return res.status(200).send(new Response(200, 'User deleted'))
}
