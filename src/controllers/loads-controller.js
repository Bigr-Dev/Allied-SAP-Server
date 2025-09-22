import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

/**
 * GET /api/loads  (now route-grouped)
 * Query params:
 *   - date: YYYY-MM-DD (optional; filters orders by order.delivery_date)
 *   - status: planned|assigned|loaded|delivered|cancelled (optional; filters orders by order_status)
 *   - route_id: uuid (optional; filters routes)
 *   - route_name: string (optional; ILIKE filter on routes)
 *   - includeItems: 'true' | 'false' (optional; default false)
 *   - page: number (optional; default 1)
 *   - limit: number (optional; default 50; max 200)
 *
 * Response shape (per route):
 * {
 *   route_id, route_name, branch_id, branch_name,
 *   suburbs: [
 *     {
 *       suburb_name, city, province, postal_code, position,
 *       load_orders: [
 *         { id, load_id, delivery_date, sales_order_number, ...,
 *           load_items?: [...] // omitted if includeItems !== 'true'
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
// export const getLoads = async (req, res) => {
//   try {
//     const {
//       date,
//       status,
//       route_id,
//       route_name,
//       includeItems = 'false',
//       page = '1',
//       limit = '50',
//     } = req.query

//     const pageNum = Math.max(parseInt(page, 10) || 1, 1)
//     const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
//     const from = (pageNum - 1) * limitNum
//     const to = from + limitNum - 1

//     // Pull route-grouped tree from the view.
//     // NOTE: The view must be created from the route-first SQL we finalized.
//     let q = database
//       .from('routes_with_tree')
//       .select('route_id, route_name, branch_id, branch_name, suburbs')
//       .order('route_name', { ascending: true, nullsFirst: true })

//     if (route_id) q = q.eq('route_id', route_id)
//     if (route_name) q = q.ilike('route_name', `%${route_name}%`)

//     // Apply DB-level pagination on routes
//     q = q.range(from, to)

//     const { data, error } = await q
//     if (error) {
//       return res
//         .status(500)
//         .send(new Response(500, 'Error fetching routes', error.message))
//     }

//     // Post-filter suburbs & orders by requested date/status.
//     // Also strip items if includeItems !== 'true'.
//     const filtered = (data || [])
//       .map((route) => {
//         const suburbs = (route.suburbs || [])
//           .map((s) => {
//             let orders = s.load_orders || []

//             if (date) {
//               // delivery_date comes from the SQL as a DATE, serialized as 'YYYY-MM-DD'
//               orders = orders.filter((o) => o.delivery_date === date)
//             }
//             if (status) {
//               orders = orders.filter(
//                 (o) =>
//                   (o.order_status || '').toLowerCase() === status.toLowerCase()
//               )
//             }

//             if (includeItems !== 'true') {
//               orders = orders.map(({ load_items, ...rest }) => rest)
//             }

//             return { ...s, load_orders: orders }
//           })
//           // drop suburbs with no remaining orders
//           .filter((s) => (s.load_orders || []).length > 0)

//         return { ...route, suburbs }
//       })
//       // drop routes with no remaining suburbs
//       .filter((r) => (r.suburbs || []).length > 0)

//     // Return the page slice we actually fetched; count = filtered routes in this page
//     return res.status(200).send(
//       new Response(200, 'OK', 'Routes fetched', {
//         page: pageNum,
//         limit: limitNum,
//         count: filtered.length,
//         results: filtered,
//       })
//     )
//   } catch (err) {
//     return res.status(500).send(new Response(500, 'Server Error', err.message))
//   }
// }

// controllers/loadsController.js

/** Roll up orders by customer for quick “prepare by customer” planning */
function groupOrdersByCustomer(orders = []) {
  const map = new Map()
  for (const o of orders) {
    const key = (o.customer_name || 'Unknown').trim()
    const agg = map.get(key) || {
      customer_name: key,
      orders: [],
      total_qty: 0,
      total_wt: 0,
    }
    agg.orders.push(o)
    agg.total_qty += Number(o.total_quantity || 0)
    agg.total_wt += Number(o.total_weight || 0)
    map.set(key, agg)
  }
  return Array.from(map.values()).sort((a, b) =>
    a.customer_name.localeCompare(b.customer_name)
  )
}

/**
 * GET /api/loads
 * Route → suburbs → orders tree (+ customer_groups per suburb).
 * Query:
 *  - branch_id, route_id, route_name
 *  - date=YYYY-MM-DD, status, customer_name (contains, case-insensitive)
 *  - includeItems=true|false (default false)
 *  - page, limit (default 1, 50; limit ≤ 200)
 */
export const getLoads = async (req, res) => {
  try {
    const {
      branch_id,
      route_id,
      route_name,
      date,
      status,
      customer_name,
      includeItems = 'false',
      page = '1',
      limit = '200',
    } = req.query

    const pageNum = Math.max(parseInt(page, 10) || 1, 1)
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
    const from = (pageNum - 1) * limitNum
    const to = from + limitNum - 1

    // Pull: route_id, route_name, branch_id, branch_name, suburbs (agg JSON)
    let q = database
      .from('routes_with_tree')
      .select('route_id, route_name, branch_id, branch_name, suburbs')
      .order('route_name', { ascending: true, nullsFirst: true })

    if (branch_id) q = q.eq('branch_id', branch_id)
    if (route_id) q = q.eq('route_id', route_id)
    if (route_name) q = q.ilike('route_name', `%${route_name}%`)

    q = q.range(from, to)

    const { data, error } = await q
    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error fetching routes', error.message))
    }

    const needle = (customer_name || '').toLowerCase().trim()
    const wantStatus = (status || '').toLowerCase().trim()

    const results = (data || [])
      .map((route) => {
        const suburbs = (route.suburbs || [])
          .map((s) => {
            let orders = s.load_orders || []

            if (date) {
              // delivery_date is emitted by your view as 'YYYY-MM-DD'
              orders = orders.filter((o) => o.delivery_date === date)
            }
            if (wantStatus) {
              orders = orders.filter(
                (o) => (o.order_status || '').toLowerCase() === wantStatus
              )
            }
            if (needle) {
              orders = orders.filter((o) =>
                (o.customer_name || '').toLowerCase().includes(needle)
              )
            }

            if (includeItems !== 'true') {
              orders = orders.map(({ load_items, ...rest }) => rest)
            }

            const customer_groups = groupOrdersByCustomer(orders)

            return {
              suburb_name: s.suburb_name,
              city: s.city,
              province: s.province,
              postal_code: s.postal_code,
              position: s.position,
              customer_groups,
              load_orders: orders,
            }
          })
          .filter((s) => (s.load_orders || []).length > 0)

        return {
          route_id: route.route_id,
          route_name: route.route_name,
          branch_id: route.branch_id,
          branch_name: route.branch_name,
          suburbs,
        }
      })
      .filter((r) => (r.suburbs || []).length > 0)

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

/**
 * GET /api/loads/items
 * Flattened items list with full route/suburb/order context.
 * Filters: branch_id, route_id, route_name, customer_name
 */
export const getAllItemsWithContext = async (req, res) => {
  try {
    const { branch_id, route_id, route_name, customer_name } = req.query

    let q = database
      .from('routes_with_tree')
      .select('route_id, route_name, branch_id, branch_name, suburbs')

    if (branch_id) q = q.eq('branch_id', branch_id)
    if (route_id) q = q.eq('route_id', route_id)
    if (route_name) q = q.ilike('route_name', `%${route_name}%`)

    const { data, error } = await q
    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Failed to fetch routes data', error.message))
    }

    if (!data || data.length === 0) {
      return res
        .status(200)
        .send(new Response(200, 'OK', 'No routes found', { items: [] }))
    }

    const needle = (customer_name || '').toLowerCase().trim()
    const items = []

    data.forEach((route) => {
      ;(route.suburbs || []).forEach((suburb) => {
        ;(suburb.load_orders || []).forEach((order) => {
          if (
            needle &&
            !(order.customer_name || '').toLowerCase().includes(needle)
          )
            return
          ;(order.load_items || []).forEach((item) => {
            items.push({
              // Item
              id: item.id,
              order_line_id: item.order_line_id,
              description: item.description,
              quantity: item.quantity,
              weight: item.weight,
              length: item.length,
              ur_prod: item.ur_prod,
              // Order context
              load_order_id: order.id,
              load_id: order.load_id,
              customer_id: order.customer_id,
              customer_name: order.customer_name,
              order_status: order.order_status,
              delivery_date: order.delivery_date,
              sales_order_number: order.sales_order_number,
              dispatch_remarks: order.dispatch_remarks,
              total_quantity: order.total_quantity,
              total_weight: order.total_weight,
              // Route context
              route_id: route.route_id,
              route_name: route.route_name,
              branch_id: route.branch_id,
              branch_name: route.branch_name,
              // Suburb context
              city: suburb.city,
              suburb_name: suburb.suburb_name,
              postal_code: suburb.postal_code,
            })
          })
        })
      })
    })

    return res.status(200).send(
      new Response(200, 'OK', 'Items retrieved successfully', {
        items,
        count: items.length,
      })
    )
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

/**
 * POST /api/load-orders/:id/reassign
 * Move an order to another load_stop (and auto-align load_id to that stop’s load).
 * Body:
 *  - load_stop_id: uuid (required) → target stop
 *  - enforce_same_branch: boolean (default true)
 *  - enforce_same_route:  boolean (default false)
 *
 * Notes:
 *  - Your load_orders table has UNIQUE (load_id, sales_order_number).
 *    We pre-check for duplicates on the target load and fail gracefully (409).
 *  - Because load_stops(load_id) → loads(id), we set the order’s load_id to
 *    targetStop.load_id automatically to maintain referential consistency.
 */
export const reassignLoadOrder = async (req, res) => {
  try {
    const { id } = req.params
    const {
      load_stop_id,
      enforce_same_branch = true,
      enforce_same_route = false,
    } = req.body || {}

    if (!id) {
      return res
        .status(400)
        .send(new Response(400, 'Bad Request', 'Order id is required'))
    }
    if (!load_stop_id) {
      return res
        .status(400)
        .send(
          new Response(400, 'Bad Request', 'Target load_stop_id is required')
        )
    }

    // 1) Load the order (get current SON to check duplicates later)
    const { data: order, error: orderErr } = await database
      .from('load_orders')
      .select('id, load_id, load_stop_id, sales_order_number')
      .eq('id', id)
      .single()
    if (orderErr || !order) {
      return res
        .status(404)
        .send(new Response(404, 'Not Found', 'Order not found'))
    }

    // 2) Fetch current stop + its load (route & branch for rule enforcement)
    const { data: currentStop, error: curStopErr } = await database
      .from('load_stops')
      .select(
        'id, load_id, suburb_name, city, province, postal_code, loads(id, route_id, branch_id)'
      )
      .eq('id', order.load_stop_id)
      .single()
    if (curStopErr || !currentStop) {
      return res
        .status(400)
        .send(
          new Response(
            400,
            'Bad Request',
            'Current stop not found or inaccessible'
          )
        )
    }

    // 3) Fetch target stop + its load
    const { data: targetStop, error: tgtStopErr } = await database
      .from('load_stops')
      .select(
        'id, load_id, suburb_name, city, province, postal_code, loads(id, route_id, branch_id)'
      )
      .eq('id', load_stop_id)
      .single()
    if (tgtStopErr || !targetStop) {
      return res
        .status(400)
        .send(new Response(400, 'Bad Request', 'Target stop not found'))
    }

    // 4) Enforce optional business rules
    if (
      enforce_same_branch &&
      currentStop.loads?.branch_id !== targetStop.loads?.branch_id
    ) {
      return res
        .status(400)
        .send(
          new Response(
            400,
            'Branch mismatch',
            'Target stop belongs to a different branch. Set enforce_same_branch=false to override (if policy allows).'
          )
        )
    }
    if (
      enforce_same_route &&
      currentStop.loads?.route_id !== targetStop.loads?.route_id
    ) {
      return res
        .status(400)
        .send(
          new Response(
            400,
            'Route mismatch',
            'Target stop belongs to a different route. Set enforce_same_route=false to override (if policy allows).'
          )
        )
    }

    // 5) Guard against UNIQUE (load_id, sales_order_number) collision on target load
    const { data: dupe, error: dupeErr } = await database
      .from('load_orders')
      .select('id')
      .eq('load_id', targetStop.load_id)
      .eq('sales_order_number', order.sales_order_number)
      .neq('id', order.id)
      .maybeSingle()
    if (dupeErr) {
      return res
        .status(400)
        .send(new Response(400, 'Pre-check failed', dupeErr.message))
    }
    if (dupe) {
      return res
        .status(409)
        .send(
          new Response(
            409,
            'Duplicate sales order',
            'Another order with the same sales_order_number already exists on the target load.'
          )
        )
    }

    // 6) Apply the move (auto-align load_id to target stop’s load)
    const patch = { load_stop_id, load_id: targetStop.load_id }
    const { data: updated, error: updErr } = await database
      .from('load_orders')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (updErr) {
      return res
        .status(400)
        .send(new Response(400, 'Reassign failed', updErr.message))
    }

    return res
      .status(200)
      .send(new Response(200, 'OK', 'Order reassigned', updated))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}
