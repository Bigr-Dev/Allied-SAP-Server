import database from '../config/supabase.js'

export const toNumber = (v) => (v == null || v === '' ? null : Number(v))

export async function findCustomerId({ bp_code, card_code }) {
  if (bp_code) {
    const { data } = await database
      .from('customers')
      .select('id')
      .eq('bp_code', bp_code)
      .maybeSingle()
    if (data?.id) return data.id
  }
  if (card_code) {
    const { data } = await database
      .from('customers')
      .select('id')
      .eq('card_code', card_code)
      .maybeSingle()
    if (data?.id) return data.id
  }
  return null
}

export async function resolveRoute(orderRow, customerId) {
  // 1) explicit on the order (exact, then ilike)
  if (orderRow?.sales_order_route) {
    const routeName = orderRow.sales_order_route.trim()
    let { data } = await database
      .from('routes')
      .select('id, name, branch_id')
      .eq('name', routeName)
      .maybeSingle()
    if (data) return data

    const { data: like } = await database
      .from('routes')
      .select('id, name, branch_id')
      .ilike('name', routeName)
      .limit(1)
    if (like?.[0]) return like[0]
  }

  // 2) customer's saved route (exact, then ilike)
  if (customerId) {
    const { data: cust } = await database
      .from('customers')
      .select('route')
      .eq('id', customerId)
      .maybeSingle()
    if (cust?.route) {
      const routeName = String(cust.route).trim()
      let { data } = await database
        .from('routes')
        .select('id, name, branch_id')
        .eq('name', routeName)
        .maybeSingle()
      if (data) return data
      const { data: like } = await database
        .from('routes')
        .select('id, name, branch_id')
        .ilike('name', routeName)
        .limit(1)
      if (like?.[0]) return like[0]
    }
  }

  // 3) nothing
  return null
}

export async function resolveStopForRoute(route, city, postal) {
  if (!route?.id) return null
  const p_city = city || ''
  const p_postal = postal || ''

  // Prefer SQL helper if present
  const { data: picked } = await database.rpc('pick_route_suburb', {
    p_route_id: route.id,
    p_city,
    p_postal,
  })
  if (picked && picked.length) {
    return {
      route_id: picked[0].route_id,
      suburb_name: picked[0].suburb_name,
      city: picked[0].city,
      province: picked[0].province,
      postal_code: picked[0].postal_code,
      position: picked[0].stop_position, // <- updated field name
    }
  }

  // Fallback: light ILIKE
  const { data } = await database
    .from('route_suburbs')
    .select('route_id, suburb_name, city, province, postal_code, position')
    .eq('route_id', route.id)
    .or(`suburb_name.ilike.%${p_city}%,city.ilike.%${p_city}%`)
    .order('position', { ascending: true })
    .limit(1)
  return data?.[0] ?? null
}

export async function getOrCreateLoad(route, deliveryDate) {
  if (!route?.id || !deliveryDate) return null

  // try existing
  const { data: existing } = await database
    .from('loads')
    .select('id')
    .eq('route_id', route.id)
    .eq('delivery_date', deliveryDate)
    .maybeSingle()

  if (existing?.id) return existing.id

  // create
  const payload = {
    route_id: route.id,
    branch_id: route.branch_id ?? null,
    delivery_date: deliveryDate,
    status: 'planned',
    route_name: route.name ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { data: ins, error } = await database
    .from('loads')
    .insert([payload])
    .select('id')
    .single()
  if (error) throw error
  return ins.id
}

export async function getOrCreateStop(loadId, stop) {
  if (!loadId || !stop) return null

  // attempt upsert on the composite uniqueness
  const payload = {
    load_id: loadId,
    route_id: stop.route_id,
    suburb_name: stop.suburb_name,
    city: stop.city,
    province: stop.province,
    postal_code: stop.postal_code,
    position: stop.position ?? null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }

  // upsert via insert+onConflict
  const { data, error } = await database
    .from('load_stops')
    .upsert([payload], {
      onConflict: 'load_id,route_id,suburb_name,city,province,postal_code',
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function upsertLoadOrder(
  loadId,
  loadStopId,
  orderRow,
  customerId,
  lines
) {
  const totals = lines.reduce(
    (acc, ln) => {
      acc.q += toNumber(ln.quantity) || 0
      acc.w += toNumber(ln.weight) || 0
      return acc
    },
    { q: 0, w: 0 }
  )

  // upsert parent
  const lo = {
    load_id: loadId,
    load_stop_id: loadStopId,
    sales_order_number: orderRow.sales_order_number,
    customer_id: customerId,
    customer_name: orderRow.customer_name ?? null,
    order_status: orderRow.order_status ?? null,
    dispatch_remarks: orderRow.dispatch_remarks ?? null,
    total_quantity: totals.q,
    total_weight: totals.w,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }

  const { data: loRow, error: loErr } = await database
    .from('load_orders')
    .upsert([lo], { onConflict: 'load_id,sales_order_number' })
    .select('id')
    .single()
  if (loErr) throw loErr

  const loadOrderId = loRow.id

  // sync load_items: delete stale then upsert current
  const currentIds = lines.map((l) => l.id)
  await database
    .from('load_items')
    .delete()
    .eq('load_order_id', loadOrderId)
    .not(
      'order_line_id',
      'in',
      `(${currentIds.map((x) => `'${x}'`).join(',') || `''`})`
    )

  const items = lines.map((ln) => ({
    load_order_id: loadOrderId,
    order_line_id: ln.id,
    description: ln.description,
    quantity: toNumber(ln.quantity),
    weight: toNumber(ln.weight),
    length: ln.length,
    ur_prod: ln.ur_prod,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }))

  if (items.length) {
    const { error: liErr } = await database
      .from('load_items')
      .upsert(items, { onConflict: 'load_order_id,order_line_id' })
    if (liErr) throw liErr
  }

  return { loadOrderId, totals }
}

export async function recomputeLoadTotals(loadId) {
  // sum from load_orders
  const { data: sums } = await database
    .from('load_orders')
    .select('total_quantity, total_weight')
    .eq('load_id', loadId)

  const total_quantity = (sums || []).reduce(
    (a, r) => a + Number(r.total_quantity || 0),
    0
  )
  const total_weight = (sums || []).reduce(
    (a, r) => a + Number(r.total_weight || 0),
    0
  )

  await database
    .from('loads')
    .update({
      total_quantity,
      total_weight,
      updated_at: new Date().toISOString(),
    })
    .eq('id', loadId)
}

export async function tidyAfterOrderRemoval(SalesOrderNumber) {
  // find the load_order
  const { data: lo } = await database
    .from('load_orders')
    .select('id, load_id, load_stop_id')
    .eq('sales_order_number', SalesOrderNumber)
    .maybeSingle()

  if (!lo) return

  // delete items then the load_order
  await database.from('load_items').delete().eq('load_order_id', lo.id)
  await database.from('load_orders').delete().eq('id', lo.id)

  // if stop is now empty, delete it
  const { data: remainingOnStop } = await database
    .from('load_orders')
    .select('id')
    .eq('load_stop_id', lo.load_stop_id)
    .limit(1)

  if (!remainingOnStop || remainingOnStop.length === 0) {
    await database.from('load_stops').delete().eq('id', lo.load_stop_id)
  }

  // if load is now empty, delete it; else recompute totals
  const { data: remainingOnLoad } = await database
    .from('load_orders')
    .select('id')
    .eq('load_id', lo.load_id)
    .limit(1)

  if (!remainingOnLoad || remainingOnLoad.length === 0) {
    await database.from('loads').delete().eq('id', lo.load_id)
  } else {
    await recomputeLoadTotals(lo.load_id)
  }
}

export function parseDueDate(raw) {
  if (!raw) return null
  const s = String(raw).replace(/[^\d]/g, '')
  // try DDMMYYYY then MMDDYYYY
  if (s.length === 8) {
    const ddmm = `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`
    const mmdd = `${s.slice(4, 8)}-${s.slice(0, 2)}-${s.slice(2, 4)}`
    const a = new Date(ddmm)
    if (!isNaN(a)) return ddmm
    const b = new Date(mmdd)
    if (!isNaN(b)) return mmdd
  }
  // ISO already?
  const d = new Date(raw)
  return isNaN(d) ? null : d.toISOString().slice(0, 10)
}
