// controllers/loads-controller.js
import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'

export const getLoads = async (req, res) => {
  try {
    const { date, from, to, branch_id, route_id, customer_name } = req.query

    const { data, error } = await database.rpc('fn_loads_flat', {
      p_date: date || null,
      p_from: from || null,
      p_to: to || null,
      p_branch_id: branch_id || null,
      p_route_id: route_id || null,
      p_customer_name: customer_name || null,
    })

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Error fetching loads', error.message))
    }

    const rows = data || []
    const tree = new Map()

    for (const r of rows) {
      const bKey = r.branch_id || 'null'
      if (!tree.has(bKey)) {
        tree.set(bKey, {
          branch_id: r.branch_id,
          branch_name: r.branch_name,
          routes: new Map(),
        })
      }
      const b = tree.get(bKey)

      const rtKey = r.route_id || 'null'
      if (!b.routes.has(rtKey)) {
        b.routes.set(rtKey, {
          route_id: r.route_id,
          route_name: r.route_name,
          suburbs: new Map(),
        })
      }
      const rt = b.routes.get(rtKey)

      const sKey = `${r.suburb_route_id || 'null'}::${r.suburb_name || 'null'}`
      if (!rt.suburbs.has(sKey)) {
        rt.suburbs.set(sKey, {
          suburb_route_id: r.suburb_route_id,
          suburb_name: r.suburb_name,
          address: r.address,
          customers: new Map(),
        })
      }
      const s = rt.suburbs.get(sKey)

      const cKey = r.customer_id || `name:${r.customer_name || 'Unknown'}`
      if (!s.customers.has(cKey)) {
        s.customers.set(cKey, {
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          orders: new Map(),
        })
      }
      const c = s.customers.get(cKey)

      const oKey = r.order_id
      if (!c.orders.has(oKey)) {
        // c.orders.set(oKey, {
        //   order_id: r.order_id,
        //   sales_order_id: r.sales_order_id,
        //   sales_order_number: r.sales_order_number,
        //   delivery_date: r.delivery_date,
        //   totals: {
        //     items: r.total_line_items,
        //     quantity: r.total_quantity,
        //     weight: r.total_weight,
        //   },
        //   status: r.status,
        //   assignment: r.load_assignment || 'unassigned', // NEW (header-level)
        //   sales_person_name: r.sales_person_name || null, // NEW
        //   order_lines: [],
        // })
        c.orders.set(oKey, {
          order_id: r.order_id,
          sales_order_id: r.sales_order_id,
          sales_order_number: r.sales_order_number,
          delivery_date: r.delivery_date,
          totals: {
            items: r.total_line_items,
            quantity: r.total_quantity,
            weight: r.total_weight,
          },
          status: r.status,
          sales_person_name: r.sales_person_name || null,

          // NEW: pass-through from RPC
          assignment_plan_id: r.assignment_plan_id || null,
          assigned_unit_id: r.assigned_unit_id || null,
          is_split: !!r.is_split,

          order_lines: [],
        })
      }
      const o = c.orders.get(oKey)

      if (r.order_line_id) {
        o.order_lines.push({
          order_line_id: r.order_line_id,
          description: r.li_description ?? r.ol_description ?? null,
          description_order_lines: r.ol_description ?? null,
          lip_channel_quantity: r.lip_channel_quantity,
          quantity: r.quantity,
          weight: r.weight,
          length: r.length,
          ur_prod: r.ur_prod,
          send_to_production: r.send_to_production,
          assignment: r.assignment, // line-level
        })
      }
    }

    const branches = Array.from(tree.values()).map((b) => {
      const routes = Array.from(b.routes.values()).map((rt) => {
        const suburbs = Array.from(rt.suburbs.values()).map((s) => {
          const customers = Array.from(s.customers.values()).map((c) => {
            const orders = Array.from(c.orders.values())
            return { ...c, orders }
          })
          return { ...s, customers }
        })
        return { ...rt, suburbs }
      })
      return { ...b, routes }
    })

    return res
      .status(200)
      .send(new Response(200, 'OK', 'Loads fetched', { branches }))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}
