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

// DELETE /users/:id            -> hard delete in Auth
// DELETE /users/:id?soft=true  -> soft delete in Auth

export const deleteUser = async (req, res) => {
  const { id } = req.params
  const soft = String(req.query.soft || '').toLowerCase() === 'true'

  try {
    // 0) Look up profile (adjust column if you store auth uid elsewhere)
    const { data: profile, error: lookupErr } = await database
      .from('users')
      .select('id, email')
      .eq('id', id)
      .single()

    if (lookupErr && lookupErr.code !== 'PGRST116') {
      return res
        .status(500)
        .send(new Response(500, 'Lookup failed', lookupErr.message))
    }

    // 1) Remove DB profile first (so the FK can’t block Auth deletion)
    if (profile) {
      const { error: dbErr } = await database
        .from('users')
        .delete()
        .eq('id', id)
      if (dbErr) {
        return res
          .status(500)
          .send(new Response(500, 'DB delete failed', dbErr.message))
      }
    }

    // 2) Remove from Auth (needs service role key)
    const { error: authErr } = await database.auth.admin.deleteUser(
      id,
      !soft ? false : true
    )
    if (authErr) {
      // You can optionally “ban” if soft/hard delete keeps failing:
      // await database.auth.admin.updateUserById(id, { banned_until: '2999-01-01T00:00:00Z' })
      return res
        .status(500)
        .send(new Response(500, 'Auth delete failed', authErr.message))
    }

    return res
      .status(200)
      .send(
        new Response(
          200,
          `User deleted (${soft ? 'soft in Auth' : 'hard in Auth'})`
        )
      )
  } catch (err) {
    return res
      .status(500)
      .send(new Response(500, 'Unexpected error', err.message))
  }
}

// export const deleteUser = async (req, res) => {
//   const { id } = req.params

//   try {
//     // Optional: verify the profile exists first (nice for 404s and logging)
//     const { data: existing, error: fetchErr } = await database
//       .from('users')
//       .select('id, email')
//       .eq('id', id)
//       .single()

//     if (fetchErr && fetchErr.code !== 'PGRST116') {
//       // Unexpected fetch error (not "No rows")
//       return res
//         .status(500)
//         .send(new Response(500, 'Lookup failed', fetchErr.message))
//     }

//     if (!existing) {
//       // No profile row; still try to remove the auth user to avoid stragglers
//       const { error: authErr } = await database.auth.admin.deleteUser(id, {
//         shouldSoftDelete: false,
//       })
//       if (authErr) {
//         return res
//           .status(404)
//           .send(new Response(404, 'User not found in DB or Auth'))
//       }
//       return res
//         .status(200)
//         .send(new Response(200, 'Auth user deleted (no DB profile found)'))
//     }

//     // 1) Delete profile row
//     const { error: dbErr } = await database.from('users').delete().eq('id', id)
//     if (dbErr) {
//       return res
//         .status(500)
//         .send(new Response(500, 'Delete failed', dbErr.message))
//     }

//     // 2) Delete Auth user (server-side admin)
//     const { error: authErr } = await database.auth.admin.deleteUser(id, {
//       shouldSoftDelete: false, // hard delete; omit or set true if you prefer soft-deletion
//     })
//     if (authErr) {
//       // At this point profile is gone but auth remains; report clearly
//       return res
//         .status(500)
//         .send(
//           new Response(
//             500,
//             'Profile deleted, but Auth delete failed',
//             authErr.message
//           )
//         )
//     }

//     return res
//       .status(200)
//       .send(new Response(200, 'User deleted from DB and Auth'))
//   } catch (err) {
//     return res
//       .status(500)
//       .send(new Response(500, 'Unexpected error', err.message))
//   }
// }

// export const deleteUser = async (req, res) => {
//   const { id } = req.params
//   const { error } = await database.from(table).delete().eq('id', id)
//   if (error)
//     return res
//       .status(500)
//       .send(new Response(500, 'Delete failed', error.message))
//   return res.status(200).send(new Response(200, 'User deleted'))
// }
