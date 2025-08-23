// import database from '../config/supabase.js'
// import { Response } from '../utils/classes.js'

// /**
//  * GET /api/loads
//  * Query params:
//  *   - date: YYYY-MM-DD (optional; defaults to today if omitted)
//  *   - route_id: uuid (optional)
//  *   - route_name: string (optional; ILIKE filter)
//  *   - status: planned|assigned|loaded|delivered|cancelled (optional)
//  *   - includeItems: 'true' | 'false' (optional; default false)
//  *   - page: number (optional; default 1)
//  *   - limit: number (optional; default 50)
//  */
// export const getLoads = async (req, res) => {
//   try {
//     const {
//       date,
//       route_id,
//       route_name,
//       status,
//       includeItems = 'false',
//       page = '1',
//       limit = '50',
//     } = req.query

//     const pageNum = Math.max(parseInt(page, 10) || 1, 1)
//     const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
//     const from = (pageNum - 1) * limitNum
//     const to = from + limitNum - 1

//     // Base select tree
//     const itemsPart =
//       includeItems === 'true'
//         ? ', load_items ( id, order_line_id, description, quantity, weight, length, ur_prod )'
//         : ''
//     const selectTree = `
//       id,
//       route_id,
//       branch_id,
//       delivery_date,
//       status,
//       vehicle_id,
//       driver_id,
//       route_name,
//       total_quantity,
//       total_weight,
//       load_stops (
//         id,
//         route_id,
//         suburb_name,
//         city,
//         province,
//         postal_code,
//         position,
//         planned_arrival,
//         planned_departure,
//         load_orders (
//           id,
//           sales_order_number,
//           customer_id,
//           customer_name,
//           order_status,
//           dispatch_remarks,
//           total_quantity,
//           total_weight
//           ${itemsPart}
//         )
//       )
//     `

//     let q = database
//       .from('loads')
//       .select(selectTree)
//       .order('route_name', { ascending: true, nullsFirst: true })

//     // Filters
//     if (date) q = q.eq('delivery_date', date)
//     if (route_id) q = q.eq('route_id', route_id)
//     if (route_name) q = q.ilike('route_name', `%${route_name}%`)
//     if (status) q = q.eq('status', status)

//     // Pagination
//     q = q.range(from, to)

//     const { data, error } = await q
//     if (error) {
//       return res
//         .status(500)
//         .send(new Response(500, 'Error fetching loads', error.message))
//     }

//     // Now, we fetch related data (branches and routes) manually using their ids.
//     const branchIds = data.map((load) => load.branch_id)
//     const routeIds = data.map((load) => load.route_id)

//     // Fetch branch names for all branch_ids
//     const { data: branches, error: branchError } = await database
//       .from('branches')
//       .select('id, name')
//       .in('id', branchIds)

//     if (branchError) {
//       return res
//         .status(500)
//         .send(new Response(500, 'Error fetching branches', branchError.message))
//     }

//     // Fetch route names for all route_ids
//     const { data: routes, error: routeError } = await database
//       .from('routes')
//       .select('id, name')
//       .in('id', routeIds)

//     if (routeError) {
//       return res
//         .status(500)
//         .send(new Response(500, 'Error fetching routes', routeError.message))
//     }

//     // Map branch and route names to the loads data
//     const loadsWithNames = data.map((load) => {
//       const branch = branches.find((b) => b.id === load.branch_id)
//       const route = routes.find((r) => r.id === load.route_id)

//       return {
//         ...load,
//         branch_name: branch ? branch.name : 'Unknown',
//         route_name: route ? route.name : 'Unknown',
//       }
//     })

//     // Sort nested arrays client-side (PostgREST returns as-is)
//     const sorted = (loadsWithNames || []).map((load) => ({
//       ...load,
//       load_stops: (load.load_stops || [])
//         .sort((a, b) => {
//           const ap = a.position ?? 1e9
//           const bp = b.position ?? 1e9
//           return ap - bp
//         })
//         .map((stop) => ({
//           ...stop,
//           load_orders: (stop.load_orders || []).sort((a, b) => {
//             const an = (a.customer_name || '').toLowerCase()
//             const bn = (b.customer_name || '').toLowerCase()
//             return an.localeCompare(bn)
//           }),
//         })),
//     }))

//     return res.status(200).send(
//       new Response(200, 'OK', 'Loads fetched', {
//         page: pageNum,
//         limit: limitNum,
//         count: sorted.length,
//         results: sorted,
//       })
//     )
//   } catch (err) {
//     return res.status(500).send(new Response(500, 'Server Error', err.message))
//   }
// }

import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

/**
 * GET /api/loads
 * Query params:
 *   - date: YYYY-MM-DD (optional)
 *   - route_id: uuid (optional)
 *   - route_name: string (optional; ILIKE filter)
 *   - status: planned|assigned|loaded|delivered|cancelled (optional)
 *   - includeItems: 'true' | 'false' (optional; default false)
 *   - page: number (optional; default 1)
 *   - limit: number (optional; default 50)
 */
export const getLoads = async (req, res) => {
  try {
    const {
      date,
      route_id,
      route_name,
      status,
      includeItems = 'false',
      page = '1',
      limit = '50',
    } = req.query

    const pageNum = Math.max(parseInt(page, 10) || 1, 1)
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
    const from = (pageNum - 1) * limitNum
    const to = from + limitNum - 1

    // Query the view (already nested + filtered to stops that have orders)
    let q = database
      .from('loads_with_tree')
      .select(
        'id, route_id, branch_id, branch_name, delivery_date, status, vehicle_id, driver_id, route_name, total_quantity, total_weight, created_at, updated_at, load_stops'
      )
      .order('route_name', { ascending: true, nullsFirst: true })
      .range(from, to)

    // Filters
    if (date) q = q.eq('delivery_date', date) // must be YYYY-MM-DD
    if (route_id) q = q.eq('route_id', route_id)
    if (route_name) q = q.ilike('route_name', `%${route_name}%`)
    if (status) q = q.eq('status', status)

    const { data, error } = await q
    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error fetching loads', error.message))
    }

    // Optionally strip items if includeItems !== 'true'
    const results = (data || []).map((load) => ({
      ...load,
      load_stops: (load.load_stops || []).map((stop) => ({
        ...stop,
        load_orders: (stop.load_orders || []).map((order) => {
          if (includeItems === 'true') return order
          const { load_items, ...rest } = order
          return rest
        }),
      })),
    }))

    return res.status(200).send(
      new Response(200, 'OK', 'Loads fetched', {
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
