import database from '../config/supabase.js'
import { mapOrderFields } from '../helpers/sap-helpers.js'
import { Response } from '../utils/classes.js'

// notes from brian
// from object check DocDtatus, if O then open else if C then closed
//send_to_planning||SendToDispatch if U||Y then save else do not save
// check urProd in lines .. if D it means it has been deleted,
// in lines SendToProduction if D it means deleted if Y and N I ignore

export const upsertSalesOrder = async (req, res) => {
  const { orderLines, ...rest } = req.body
  const SalesOrderNumber =
    req.params.SalesOrderNumber ||
    req.params.salesOrderNumber ||
    req.body.SalesOrderNumber ||
    req.body.salesOrderNumber

  try {
    // 1. Upsert sales_orders

    const { error: orderError } = await database.from('sales_orders').upsert(
      [
        {
          sales_order_number: SalesOrderNumber,
          ...mapOrderFields(rest),
        },
      ],
      {
        onConflict: 'sales_order_number',
      }
    )

    if (orderError) {
      return res
        .status(500)
        .send(new Response(500, 'Order upsert failed', orderError.message))
    }

    // 2. Upsert order_lines
    if (Array.isArray(orderLines)) {
      const formattedLines = orderLines.map((line) => ({
        id: line.id ?? line.Id,
        sales_order_number: SalesOrderNumber,
        description: line.description ?? line.Description,
        lip_channel_quantity:
          line.lipChannelQuantity ?? line.LipChannelQuantity,
        quantity: line.quantity ?? line.Quantity,
        weight: line.weight ?? line.Weight,
        length: line.length ?? line.Length,
        ur_prod: line.urProd ?? line.UrProd,
        send_to_production: line.sendToProduction ?? line.SendToProduction,
      }))

      const { error: lineError } = await database
        .from('order_lines')
        .upsert(formattedLines, { onConflict: 'id' })

      if (lineError) {
        return res
          .status(500)
          .send(
            new Response(500, 'Order line upsert failed', lineError.message)
          )
      }
    }

    return res
      .status(200)
      .send(
        new Response(
          200,
          'Upserted',
          `Sales order ${SalesOrderNumber} processed successfully`
        )
      )
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

export const getSalesOrders = async (req, res) => {
  try {
    const { data, error } = await database.from('sales_orders').select(`
        *,
        order_lines (
          id,
          description,
          quantity,
          weight,
          ur_prod
        )
      `)

    if (error) {
      return res
        .status(500)
        .send(new Response(500, 'Fetch failed', error.message))
    }

    res.status(200).send(new Response(200, 'OK', 'Orders retrieved', data))
  } catch (err) {
    res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}

export const deleteSalesOrder = async (req, res) => {
  const { SalesOrderNumber } = req.params

  try {
    // Delete from order_lines first (CASCADE would do this automatically if set)
    await database
      .from('order_lines')
      .delete()
      .eq('sales_order_number', SalesOrderNumber)

    // Delete sales order
    const { error } = await database
      .from('sales_orders')
      .delete()
      .eq('sales_order_number', SalesOrderNumber)
    if (error)
      return res
        .status(500)
        .send(new Response(500, 'Delete failed', error.message))

    return res
      .status(200)
      .send(new Response(200, 'OK', `Order ${SalesOrderNumber} deleted`))
  } catch (err) {
    return res.status(500).send(new Response(500, 'Server Error', err.message))
  }
}
