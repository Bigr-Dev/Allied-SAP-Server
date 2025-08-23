// controllers/routes-controller.js
import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

// helpers
const toIntOrNull = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
const sortByPosition = (arr = []) =>
  (arr || []).slice().sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))

const buildSuburbRow = (s, route_id) => ({
  route_id,
  position: toIntOrNull(s?.position),
  suburb_name: s?.suburb_name ?? null,
  city: s?.city ?? null,
  province: s?.province ?? null,
  postal_code: s?.postal_code ?? null,
  notes: s?.notes ?? null,
  meta: s?.meta ?? null,
})

// ================= READ: list =================
/**
 * GET /api/routes
 * Query: name (ILIKE), status, branch_id, includeMeta ('true'|'false'), page, limit
 */
export const getRoutes = async (req, res) => {
  try {
    const {
      name,
      status,
      branch_id,
      includeMeta = 'false',
      page = '1',
      limit = '200',
    } = req.query

    const pageNum = Math.max(parseInt(page, 10) || 1, 1)
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500)
    const from = (pageNum - 1) * limitNum
    const to = from + limitNum - 1

    const suburbCols = [
      // no `id` here because your table doesn't have it
      'route_id',
      'position',
      'suburb_name',
      'city',
      'province',
      'postal_code',
      'notes',
      includeMeta === 'true' ? 'meta' : null,
      'created_at',
      'updated_at',
    ]
      .filter(Boolean)
      .join(', ')

    const selectTree = `
      id,
      branch_id,
      name,
      description,
      sap_id,
      status,
      created_at,
      updated_at,
      route_suburbs ( ${suburbCols} )
    `

    let q = database
      .from('routes')
      .select(selectTree)
      .order('name', { ascending: true })
    if (name) q = q.ilike('name', `%${name}%`)
    if (status) q = q.eq('status', status)
    if (branch_id) q = q.eq('branch_id', branch_id)
    q = q.range(from, to)

    const { data, error } = await q
    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error fetching routes', error.message))
    }

    const results = (data || []).map((r) => ({
      ...r,
      route_suburbs: sortByPosition(r.route_suburbs),
    }))

    return res.status(200).send(
      new Response(200, 'OK', 'Routes fetched', {
        page: pageNum,
        limit: limitNum,
        count: results.length,
        results,
      })
    )
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

// ================= READ: single =================
/** GET /api/routes/:id */
export const getRouteById = async (req, res) => {
  try {
    const { id } = req.params
    const { data, error } = await database
      .from('routes')
      .select(
        `
        id,
        branch_id,
        name,
        description,
        sap_id,
        status,
        created_at,
        updated_at,
        route_suburbs (
          route_id, position, suburb_name, city, province, postal_code, notes, meta, created_at, updated_at
        )
      `
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error fetching route', error.message))
    }
    if (!data) {
      return res
        .status(404)
        .send(new Response(404, 'Not Found', 'Route not found'))
    }

    const payload = {
      ...data,
      route_suburbs: sortByPosition(data.route_suburbs),
    }
    return res.status(200).send(new Response(200, 'OK', 'Route found', payload))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

// ================= CREATE =================
/**
 * POST /api/routes
 * Body: route fields + optional route_suburbs: [{ position, suburb_name, city, province, postal_code, notes, meta }]
 */
export const createRoute = async (req, res) => {
  try {
    const { route_suburbs = [], ...routeBody } = req.body

    // 1) Insert route
    const { data: route, error: routeErr } = await database
      .from('routes')
      .insert([routeBody])
      .select('*')
      .single()
    if (routeErr) {
      return res
        .status(500)
        .send(new Response(500, 'Error creating route', routeErr.message))
    }

    // 2) Bulk insert suburbs (no ids to upsert on)
    if (Array.isArray(route_suburbs) && route_suburbs.length) {
      const rows = route_suburbs.map((s) => buildSuburbRow(s, route.id))
      const { error: subErr } = await database
        .from('route_suburbs')
        .insert(rows)
      if (subErr) {
        return res
          .status(500)
          .send(new Response(500, 'Error saving suburbs', subErr.message))
      }
    }

    // 3) Return fresh copy
    const { data: full } = await database
      .from('routes')
      .select(
        `
        id, branch_id, name, description, sap_id, status, created_at, updated_at,
        route_suburbs ( route_id, position, suburb_name, city, province, postal_code, notes, meta, created_at, updated_at )
      `
      )
      .eq('id', route.id)
      .maybeSingle()

    const payload = {
      ...full,
      route_suburbs: sortByPosition(full?.route_suburbs),
    }
    return res
      .status(201)
      .send(new Response(201, 'Created', 'Route created', payload))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Error', err.message))
  }
}

// ================= UPDATE =================
/**
 * PUT /api/routes/:id
 * Body: route fields + optional route_suburbs array
 * Strategy (no suburb IDs): replace list -> delete existing then bulk insert provided
 */
export const updateRoute = async (req, res) => {
  try {
    const { id } = req.params
    const { route_suburbs = null, ...routeBody } = req.body

    // 1) Update route fields
    const { data: updated, error: updErr } = await database
      .from('routes')
      .update(routeBody)
      .eq('id', id)
      .select('*')
      .single()
    if (updErr) {
      return res
        .status(500)
        .send(new Response(500, 'Error updating route', updErr.message))
    }

    // 2) Replace suburbs if provided
    if (Array.isArray(route_suburbs)) {
      // delete all for this route
      const { error: delErr } = await database
        .from('route_suburbs')
        .delete()
        .eq('route_id', id)
      if (delErr) {
        return res
          .status(500)
          .send(new Response(500, 'Error clearing suburbs', delErr.message))
      }

      // insert new set
      if (route_suburbs.length) {
        const rows = route_suburbs.map((s) => buildSuburbRow(s, id))
        const { error: insErr } = await database
          .from('route_suburbs')
          .insert(rows)
        if (insErr) {
          return res
            .status(500)
            .send(new Response(500, 'Error inserting suburbs', insErr.message))
        }
      }
    }

    // 3) Return fresh copy
    const { data: full } = await database
      .from('routes')
      .select(
        `
        id, branch_id, name, description, sap_id, status, created_at, updated_at,
        route_suburbs ( route_id, position, suburb_name, city, province, postal_code, notes, meta, created_at, updated_at )
      `
      )
      .eq('id', id)
      .maybeSingle()

    const payload = {
      ...full,
      route_suburbs: sortByPosition(full?.route_suburbs),
    }
    return res
      .status(200)
      .send(new Response(200, 'Updated', 'Route updated', payload))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Error', err.message))
  }
}

// ================= DELETE =================
/** DELETE /api/routes/:id */
export const deleteRoute = async (req, res) => {
  try {
    const { id } = req.params
    // remove suburbs first (safe even if FK has CASCADE)
    await database.from('route_suburbs').delete().eq('route_id', id)

    const { data, error } = await database
      .from('routes')
      .delete()
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error deleting route', error.message))
    }
    return res
      .status(200)
      .send(new Response(200, 'Deleted', 'Route removed', data))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Error', err.message))
  }
}
