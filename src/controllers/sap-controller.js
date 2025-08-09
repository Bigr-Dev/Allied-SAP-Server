import database from '../config/supabase.js'
import { mapOrderFields } from '../helpers/sap-helpers.js'
import { Response } from '../utils/classes.js'

export const upsertSalesOrder = async (req, res) => {
  const {
    OrderLines = [],
    DocStatus,
    SendToDispatch,
    sendToPlanning,
  } = req.body

  const SalesOrderNumber =
    req.params.SalesOrderNumber ||
    req.params.salesOrderNumber ||
    req.body.SalesOrderNumber ||
    req.body.salesOrderNumber

  if (!SalesOrderNumber) {
    return res.status(400).send(new Response(400, 'Missing SalesOrderNumber'))
  }

  try {
    // 1. If DocStatus is "C" (closed), delete from DB and exit
    if (DocStatus === 'C') {
      const { error: delLineErr } = await database
        .from('order_lines')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)

      const { error: delOrderErr } = await database
        .from('sales_orders')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)

      if (delOrderErr || delLineErr) {
        return res
          .status(500)
          .send(
            new Response(
              500,
              'Delete failed due to DocStatus=C',
              delOrderErr?.message || delLineErr?.message
            )
          )
      }

      return res
        .status(200)
        .send(new Response(200, 'Deleted due to DocStatus=C'))
    }

    // 2. If sendToPlanning or SendToDispatch is NOT "Y" or "U", delete from DB and exit
    if (
      !['Y', 'U'].includes(SendToDispatch) &&
      !['Y', 'U'].includes(sendToPlanning)
    ) {
      const { error: delLineErr } = await database
        .from('order_lines')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)

      const { error: delOrderErr } = await database
        .from('sales_orders')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)

      if (delOrderErr || delLineErr) {
        return res
          .status(500)
          .send(
            new Response(
              500,
              'Deleted due to invalid dispatch/planning',
              delOrderErr?.message || delLineErr?.message
            )
          )
      }

      return res
        .status(200)
        .send(
          new Response(200, 'Deleted due to SendToDispatch/Planning not Y/U')
        )
    }

    // 3. Upsert sales order
    const { error: orderError } = await database.from('sales_orders').upsert(
      [
        {
          sales_order_number: SalesOrderNumber,
          ...mapOrderFields(req.body),
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

    // 4. Process order lines
    const linesToUpsert = []

    for (const line of OrderLines) {
      const id = line.id ?? line.Id
      const urProd = line.urProd ?? line.UrProd
      const sendToProduction = line.sendToProduction ?? line.SendToProduction

      if (!id) continue

      // Delete line if marked deleted
      if (urProd === 'D' || sendToProduction === 'D') {
        const { error: delLineError } = await database
          .from('order_lines')
          .delete()
          .eq('id', id)

        if (delLineError) {
          console.error(`Failed to delete line ${id}:`, delLineError.message)
        }

        continue // Skip upserting this deleted line
      }

      // Add to upsert list
      linesToUpsert.push({
        id,
        sales_order_number: SalesOrderNumber,
        description: line.description ?? line.Description,
        lip_channel_quantity:
          line.lipChannelQuantity ?? line.LipChannelQuantity,
        quantity: line.quantity ?? line.Quantity,
        weight: line.weight ?? line.Weight,
        length: line.length ?? line.Length,
        ur_prod: urProd,
        send_to_production: sendToProduction,
      })
    }

    // 5. Upsert remaining lines
    if (linesToUpsert.length > 0) {
      const { error: lineError } = await database
        .from('order_lines')
        .upsert(linesToUpsert, { onConflict: 'id' })

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
    console.error('Server error during upsert:', err)
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
  // const { SalesOrderNumber } = req.params
  const SalesOrderNumber =
    req.params.SalesOrderNumber ||
    req.params.salesOrderNumber ||
    req.body.SalesOrderNumber ||
    req.body.salesOrderNumber

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

// updated get to be implimented with pagination later
// export const getSalesOrders = async (req, res) => {
//   const limit = parseInt(req.query.limit) || 50  // default 50 records
//   const page = parseInt(req.query.page) || 1     // default to page 1
//   const offset = (page - 1) * limit

//   try {
//     const { data, error } = await database
//       .from('sales_orders')
//       .select('*')
//       .order('created_at', { ascending: false }) // optional sorting
//       .range(offset, offset + limit - 1)

//     if (error) {
//       return res.status(500).json({ error: error.message })
//     }

//     return res.status(200).json({
//       page,
//       limit,
//       count: data.length,
//       results: data,
//     })
//   } catch (err) {
//     return res.status(500).json({ error: 'Server error', details: err.message })
//   }
// }
