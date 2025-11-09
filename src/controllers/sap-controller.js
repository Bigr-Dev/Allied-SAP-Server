// controllers/sap-controller.js
import database from '../config/supabase.js'
import { mapOrderFields } from '../helpers/sap-helpers.js'
import { Response } from '../utils/classes.js'

// Local numeric helper (used to be imported from load-helpers)
const toNumber = (v) => (v == null || v === '' ? null : Number(v))

/**
 * Upsert a Sales Order and its Order Lines ONLY.
 * - No load creation, no routing, no external logging.
 * - Honors DocStatus=C (hard delete) and simple dispatch/planning gate.
 */
export const upsertSalesOrder = async (req, res) => {
  res.set('Content-Type', 'application/json; charset=utf-8')

  const {
    OrderLines = [],
    DocStatus,
    SendToDispatch,
    sendToPlanning,
  } = req.body

  const SalesOrderNumber =
    req.params?.SalesOrderNumber ||
    req.params?.salesOrderNumber ||
    req.body?.SalesOrderNumber ||
    req.body?.salesOrderNumber

  if (!SalesOrderNumber) {
    return res
      .status(400)
      .json(new Response(400, 'Bad Request', 'Missing SalesOrderNumber'))
  }

  try {
    // 1) If the doc is closed, delete header + lines and return
    if (DocStatus === 'C') {
      await database
        .from('order_lines')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)
      await database
        .from('sales_orders')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)

      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            `Order ${SalesOrderNumber} removed (DocStatus=C)`
          )
        )
    }

    // 2) Optional gate: only keep orders intended for dispatch/planning
    //    (keep if Y/U/2; remove otherwise)
    const gateOk =
      ['Y', 'U', '2'].includes(SendToDispatch) ||
      ['Y', 'U', '2'].includes(sendToPlanning)

    if (!gateOk) {
      await database
        .from('order_lines')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)
      await database
        .from('sales_orders')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)

      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            `Order ${SalesOrderNumber} removed (dispatch/planning != Y/U/2)`
          )
        )
    }

    // 3) Upsert order header (aligned to public.sales_orders)
    const mapped = {
      sales_order_number: SalesOrderNumber,
      ...mapOrderFields(req.body),
    }

    const { error: orderErr } = await database
      .from('sales_orders')
      .upsert([mapped], { onConflict: 'sales_order_number' })

    if (orderErr) {
      return res
        .status(500)
        .json(
          new Response(
            500,
            'Server Error',
            'Order upsert failed',
            orderErr.message
          )
        )
    }

    // 4) Upsert lines:
    //    - Drop lines where urProd/sendToProduction === 'D'
    //    - Otherwise upsert on PK id
    const linesToUpsert = []

    for (const line of OrderLines) {
      const id = line.id ?? line.Id
      if (!id) continue

      const urProd = line.urProd ?? line.UrProd
      const sendToProduction = line.sendToProduction ?? line.SendToProduction

      // Deleted lines from SAP
      if (urProd === 'D' || sendToProduction === 'D') {
        await database.from('order_lines').delete().eq('id', id)
        continue
      }

      linesToUpsert.push({
        id, // PK in public.order_lines
        sales_order_number: SalesOrderNumber, // FK → sales_orders.sales_order_number (CASCADE ON DELETE)
        description: line.description ?? line.Description,
        lip_channel_quantity:
          line.lipChannelQuantity ?? line.LipChannelQuantity,
        quantity: toNumber(line.quantity ?? line.Quantity), // numeric
        weight: toNumber(line.weight ?? line.Weight), // numeric
        length: line.length ?? line.Length,
        ur_prod: urProd,
        send_to_production: sendToProduction,
      })
    }

    if (linesToUpsert.length) {
      const { error: linesErr } = await database
        .from('order_lines')
        .upsert(linesToUpsert, { onConflict: 'id' })

      if (linesErr) {
        return res
          .status(500)
          .json(
            new Response(
              500,
              'Server Error',
              'Order line upsert failed',
              linesErr.message
            )
          )
      }
    } else {
      // If no surviving lines, you may choose to keep header
      // or also remove it. The current behavior is to keep header.
      // If you prefer removal when no items, uncomment below:
      // await database.from('sales_orders').delete().eq('sales_order_number', SalesOrderNumber);
    }

    return res
      .status(200)
      .json(new Response(200, 'OK', `Order ${SalesOrderNumber} saved`))
  } catch (err) {
    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}

/**
 * Fetch orders with nested lines (pure read from 2 tables).
 */
export const getSalesOrders = async (req, res) => {
  try {
    const { data, error } = await database.from('sales_orders').select(`
      *,
      order_lines (
        id,
        description,
        quantity,
        weight,
        length,
        ur_prod,
        send_to_production
      )
    `)

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Fetch failed', error.message))
    }

    return res
      .status(200)
      .send(new Response(200, 'OK', 'Orders retrieved', data))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

/**
 * Delete an order (header) — lines removed via explicit delete (FK also has CASCADE).
 */
export const deleteSalesOrder = async (req, res) => {
  const SalesOrderNumber =
    req.params?.SalesOrderNumber ||
    req.params?.salesOrderNumber ||
    req.body?.SalesOrderNumber ||
    req.body?.salesOrderNumber

  try {
    await database
      .from('order_lines')
      .delete()
      .eq('sales_order_number', SalesOrderNumber)
    const { error } = await database
      .from('sales_orders')
      .delete()
      .eq('sales_order_number', SalesOrderNumber)

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Delete failed', error.message))
    }

    return res
      .status(200)
      .send(new Response(200, 'OK', `Order ${SalesOrderNumber} deleted`))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}
