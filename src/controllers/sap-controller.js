import database from '../config/supabase.js'
import {
  findCustomerId,
  getOrCreateLoad,
  getOrCreateStop,
  recomputeLoadTotals,
  resolveRoute,
  resolveStopForRoute,
  tidyAfterOrderRemoval,
  toNumber,
  upsertLoadOrder,
} from '../helpers/load-helpers.js'
import { mapOrderFields } from '../helpers/sap-helpers.js'
import { Response } from '../utils/classes.js'
import { buildLogFromReqRes, logApiEvent } from '../utils/db-logger.js'

// const toNumber = (v) => (v == null || v === '' ? null : Number(v))
export const upsertSalesOrder = async (req, res) => {
  // Always respond JSON
  res.set('Content-Type', 'application/json; charset=utf-8')

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
    await logApiEvent({
      level: 'warn',
      ...buildLogFromReqRes(req, res, {
        controller: 'sap-controller',
        action: 'upsertSalesOrder',
        status_code: 400,
        http_status: 'Bad Request',
        message: 'Missing SalesOrderNumber',
        payload: { body: req.body },
      }),
    })
    return res
      .status(400)
      .json(new Response(400, 'Bad Request', 'Missing SalesOrderNumber'))
  }

  try {
    // 1) Closed orders: remove everywhere
    if (DocStatus === 'C') {
      await database
        .from('order_lines')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)
      await database
        .from('sales_orders')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)
      await tidyAfterOrderRemoval(SalesOrderNumber)

      await logApiEvent({
        level: 'warn',
        ...buildLogFromReqRes(req, res, {
          controller: 'sap-controller',
          action: 'upsertSalesOrder',
          status_code: 200,
          http_status: 'OK',
          message: 'Order deleted due to DocStatus=C',
          sales_order_number: SalesOrderNumber,
          payload: { DocStatus },
        }),
      })

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

    // 2) Filter gate: require SendToDispatch or sendToPlanning to be Y/U
    const gateOk =
      ['Y', 'U'].includes(SendToDispatch) || ['Y', 'U'].includes(sendToPlanning)

    if (!gateOk) {
      await database
        .from('order_lines')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)
      await database
        .from('sales_orders')
        .delete()
        .eq('sales_order_number', SalesOrderNumber)
      await tidyAfterOrderRemoval(SalesOrderNumber)

      await logApiEvent({
        level: 'warn',
        ...buildLogFromReqRes(req, res, {
          controller: 'sap-controller',
          action: 'upsertSalesOrder',
          status_code: 200,
          http_status: 'OK',
          message: 'Deleted due to SendToDispatch/Planning not Y/U',
          sales_order_number: SalesOrderNumber,
          payload: { SendToDispatch, sendToPlanning },
        }),
      })

      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            `Order ${SalesOrderNumber} removed (dispatch/planning != Y/U)`
          )
        )
    }

    // 3) Upsert order header
    const mapped = {
      sales_order_number: SalesOrderNumber,
      ...mapOrderFields(req.body),
    }

    const { error: orderErr } = await database
      .from('sales_orders')
      .upsert([mapped], { onConflict: 'sales_order_number' })

    if (orderErr) {
      await logApiEvent({
        level: 'error',
        ...buildLogFromReqRes(req, res, {
          controller: 'sap-controller',
          action: 'upsertSalesOrder',
          status_code: 500,
          http_status: 'Server Error',
          message: 'Order upsert failed',
          sales_order_number: SalesOrderNumber,
          payload: { error: orderErr.message },
        }),
      })
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

    // 4) Process lines: delete those marked D; upsert the rest
    const linesToUpsert = []

    for (const line of OrderLines) {
      const id = line.id ?? line.Id
      const urProd = line.urProd ?? line.UrProd
      const sendToProduction = line.sendToProduction ?? line.SendToProduction
      if (!id) continue

      // Drop deleted lines
      if (urProd === 'D' || sendToProduction === 'D') {
        await database.from('order_lines').delete().eq('id', id)
        continue
      }

      linesToUpsert.push({
        id,
        sales_order_number: SalesOrderNumber,
        description: line.description ?? line.Description,
        lip_channel_quantity:
          line.lipChannelQuantity ?? line.LipChannelQuantity,
        quantity: toNumber(line.quantity ?? line.Quantity),
        weight: toNumber(line.weight ?? line.Weight),
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
        await logApiEvent({
          level: 'error',
          ...buildLogFromReqRes(req, res, {
            controller: 'sap-controller',
            action: 'upsertSalesOrder',
            status_code: 500,
            http_status: 'Server Error',
            message: 'Order line upsert failed',
            sales_order_number: SalesOrderNumber,
            payload: { error: linesErr.message },
          }),
        })
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
      // No surviving lines: tidy and return OK (no-items)
      await tidyAfterOrderRemoval(SalesOrderNumber)

      await logApiEvent({
        level: 'info',
        ...buildLogFromReqRes(req, res, {
          controller: 'sap-controller',
          action: 'upsertSalesOrder',
          status_code: 200,
          http_status: 'OK',
          message: 'Processed (no items)',
          sales_order_number: SalesOrderNumber,
        }),
      })

      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            `Order ${SalesOrderNumber} processed (no items)`
          )
        )
    }

    // 5) Fetch fresh order + lines for allocation
    const { data: orderRow } = await database
      .from('sales_orders')
      .select('*')
      .eq('sales_order_number', SalesOrderNumber)
      .maybeSingle()

    const { data: survivorLines } = await database
      .from('order_lines')
      .select('id, description, quantity, weight, length, ur_prod')
      .eq('sales_order_number', SalesOrderNumber)

    // If no lines after fetch, we’re done (defensive)
    if (!survivorLines || survivorLines.length === 0) {
      await logApiEvent({
        level: 'info',
        ...buildLogFromReqRes(req, res, {
          controller: 'sap-controller',
          action: 'upsertSalesOrder',
          status_code: 200,
          http_status: 'OK',
          message: 'Processed (no items)',
          sales_order_number: SalesOrderNumber,
        }),
      })

      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            `Order ${SalesOrderNumber} processed (no items)`
          )
        )
    }

    // 6) Resolve routing context
    const customer_id = await findCustomerId({
      bp_code: orderRow?.customer_bp_code ?? orderRow?.bp_code,
      card_code: orderRow?.card_code,
    })

    const route = await resolveRoute(orderRow, customer_id)
    if (!route) {
      await logApiEvent({
        level: 'info',
        ...buildLogFromReqRes(req, res, {
          controller: 'sap-controller',
          action: 'upsertSalesOrder',
          status_code: 200,
          http_status: 'OK',
          message: 'Saved but not routed',
          sales_order_number: SalesOrderNumber,
        }),
      })

      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            `Order ${SalesOrderNumber} saved but not routed`
          )
        )
    }

    const stop = await resolveStopForRoute(
      route,
      orderRow?.sales_order_city,
      orderRow?.sales_order_zip_code
    )

    const loadId = await getOrCreateLoad(route, orderRow?.document_due_date)
    if (!loadId) {
      await logApiEvent({
        level: 'info',
        ...buildLogFromReqRes(req, res, {
          controller: 'sap-controller',
          action: 'upsertSalesOrder',
          status_code: 200,
          http_status: 'OK',
          message: 'Saved but no load created',
          sales_order_number: SalesOrderNumber,
        }),
      })

      return res
        .status(200)
        .json(
          new Response(
            200,
            'OK',
            `Order ${SalesOrderNumber} saved but no load created`
          )
        )
    }

    // Allow a stop with minimal locality to avoid losing the order
    const loadStopId = await getOrCreateStop(loadId, {
      route_id: route.id,
      suburb_name:
        stop?.suburb_name ?? (orderRow?.sales_order_city || 'Unknown'),
      city: stop?.city ?? orderRow?.sales_order_city ?? '',
      province: stop?.province ?? orderRow?.state ?? '',
      postal_code: stop?.postal_code ?? orderRow?.sales_order_zip_code ?? '',
      position: stop?.position ?? null,
    })

    // 7) Upsert load_order + items
    await upsertLoadOrder(
      loadId,
      loadStopId,
      orderRow,
      customer_id,
      survivorLines
    )

    // 8) Recompute totals on parent load
    await recomputeLoadTotals(loadId)

    await logApiEvent({
      level: 'info',
      ...buildLogFromReqRes(req, res, {
        controller: 'sap-controller',
        action: 'upsertSalesOrder',
        status_code: 200,
        http_status: 'OK',
        message: 'Allocated to route load',
        sales_order_number: SalesOrderNumber,
        payload: { loadId, loadStopId, route_id: route.id },
      }),
    })

    return res
      .status(200)
      .json(
        new Response(
          200,
          'OK',
          `Order ${SalesOrderNumber} allocated to route load`
        )
      )
  } catch (err) {
    console.error('Server error during upsert:', err)

    await logApiEvent({
      level: 'error',
      ...buildLogFromReqRes(req, res, {
        controller: 'sap-controller',
        action: 'upsertSalesOrder',
        status_code: 500,
        http_status: 'Server Error',
        message: err.message,
        sales_order_number: SalesOrderNumber,
      }),
    })

    return res.status(500).json(new Response(500, 'Server Error', err.message))
  }
}
// export const upsertSalesOrder = async (req, res) => {
//   const {
//     OrderLines = [],
//     DocStatus,
//     SendToDispatch,
//     sendToPlanning,
//   } = req.body

//   const SalesOrderNumber =
//     req.params.SalesOrderNumber ||
//     req.params.salesOrderNumber ||
//     req.body.SalesOrderNumber ||
//     req.body.salesOrderNumber

//   if (!SalesOrderNumber) {
//     await logApiEvent({
//       level: 'warn',
//       ...buildLogFromReqRes(req, res, {
//         controller: 'sap-controller',
//         action: 'upsertSalesOrder',
//         status_code: 400,
//         http_status: 'Bad Request',
//         message: 'Missing SalesOrderNumber',
//         payload: { body: req.body },
//       }),
//     })
//     return res
//       .status(400)
//       .json(new Response(400, 'Bad Request', 'Missing SalesOrderNumber'))
//   }

//   try {
//     // closed orders: remove everywhere
//     if (DocStatus === 'C') {
//       await database
//         .from('order_lines')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)
//       await database
//         .from('sales_orders')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)
//       await tidyAfterOrderRemoval(SalesOrderNumber)
//       await logApiEvent({
//         level: 'warn',
//         ...buildLogFromReqRes(req, res, {
//           controller: 'sap-controller',
//           action: 'upsertSalesOrder',
//           status_code: 200,
//           http_status: 'Deleted',
//           message: 'Order deleted due to DocStatus=C',
//           sales_order_number: SalesOrderNumber,
//           payload: { DocStatus },
//         }),
//       })
//       return res.status(200).json(
//         new Response(
//           200,
//           'OK',
//           `Order ${SalesOrderNumber} removed (DocStatus=C)`,
//           null,
//           {
//             action: 'deleted',
//             order: SalesOrderNumber,
//             reason: 'DocStatus=C',
//           }
//         )
//       )
//     }

//     // filter gate
//     const gateOk =
//       ['Y', 'U'].includes(SendToDispatch) || ['Y', 'U'].includes(sendToPlanning)
//     if (!gateOk) {
//       await database
//         .from('order_lines')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)
//       await database
//         .from('sales_orders')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)
//       await tidyAfterOrderRemoval(SalesOrderNumber)
//       await logApiEvent({
//         level: 'warn',
//         ...buildLogFromReqRes(req, res, {
//           controller: 'sap-controller',
//           action: 'upsertSalesOrder',
//           status_code: 200,
//           http_status: 'Filtered',
//           message: 'Deleted due to SendToDispatch/Planning not Y/U',
//           sales_order_number: SalesOrderNumber,
//           payload: { SendToDispatch, sendToPlanning },
//         }),
//       })
//       return res
//         .status(200)
//         .json(
//           new Response(
//             200,
//             'OK',
//             `Order ${SalesOrderNumber} removed (dispatch/planning != Y/U)`,
//             null,
//             {
//               action: 'deleted',
//               order: SalesOrderNumber,
//               reason: 'SendToDispatch/Planning not Y/U',
//             }
//           )
//         )
//     }

//     // upsert order
//     const mapped = {
//       sales_order_number: SalesOrderNumber,
//       ...mapOrderFields(req.body),
//     }
//     const { error: orderErr } = await database
//       .from('sales_orders')
//       .upsert([mapped], { onConflict: 'sales_order_number' })
//     if (orderErr) {
//       return res
//         .status(500)
//         .send(new Response(500, 'Order upsert failed', orderErr.message))
//     }

//     // process lines, drop deleted ones
//     const linesToUpsert = []
//     for (const line of OrderLines) {
//       const id = line.id ?? line.Id
//       const urProd = line.urProd ?? line.UrProd
//       const sendToProduction = line.sendToProduction ?? line.SendToProduction
//       if (!id) continue
//       if (urProd === 'D' || sendToProduction === 'D') {
//         await database.from('order_lines').delete().eq('id', id)
//         continue
//       }
//       linesToUpsert.push({
//         id,
//         sales_order_number: SalesOrderNumber,
//         description: line.description ?? line.Description,
//         lip_channel_quantity:
//           line.lipChannelQuantity ?? line.LipChannelQuantity,
//         quantity: toNumber(line.quantity ?? line.Quantity),
//         weight: toNumber(line.weight ?? line.Weight),
//         length: line.length ?? line.Length,
//         ur_prod: urProd,
//         send_to_production: sendToProduction,
//       })
//     }

//     if (linesToUpsert.length) {
//       const { error: linesErr } = await database
//         .from('order_lines')
//         .upsert(linesToUpsert, { onConflict: 'id' })
//       if (linesErr) {
//         return res
//           .status(500)
//           .send(new Response(500, 'Order line upsert failed', linesErr.message))
//       }
//     } else {
//       // no surviving lines, remove any existing allocation
//       await tidyAfterOrderRemoval(SalesOrderNumber)
//     }

//     // fetch fresh order + lines to allocate into load
//     const { data: orderRow } = await database
//       .from('sales_orders')
//       .select('*')
//       .eq('sales_order_number', SalesOrderNumber)
//       .maybeSingle()

//     const { data: survivorLines } = await database
//       .from('order_lines')
//       .select('id, description, quantity, weight, length, ur_prod')
//       .eq('sales_order_number', SalesOrderNumber)

//     // if no lines, we are done
//     if (!survivorLines || survivorLines.length === 0) {
//       return res
//         .status(200)
//         .send(
//           new Response(
//             200,
//             'Upserted',
//             `Order ${SalesOrderNumber} processed (no items)`
//           )
//         )
//     }

//     // resolve customer, route, stop
//     const customer_id = await findCustomerId({
//       bp_code: orderRow?.customer_bp_code ?? orderRow?.bp_code,
//       card_code: orderRow?.card_code,
//     })

//     const route = await resolveRoute(orderRow, customer_id)
//     if (!route) {
//       // leave the order unassigned to a load for now
//       return res
//         .status(200)
//         .send(
//           new Response(
//             200,
//             'Upserted',
//             `Order ${SalesOrderNumber} saved but not routed`
//           )
//         )
//     }

//     const stop = await resolveStopForRoute(
//       route,
//       orderRow?.sales_order_city,
//       orderRow?.sales_order_zip_code
//     )

//     const loadId = await getOrCreateLoad(route, orderRow?.document_due_date)
//     if (!loadId) {
//       return res
//         .status(200)
//         .send(
//           new Response(
//             200,
//             'Upserted',
//             `Order ${SalesOrderNumber} saved but no load created`
//           )
//         )
//     }

//     // when we have no suburb match, we still allow a stop with empty locality to avoid losing the order
//     const loadStopId = await getOrCreateStop(loadId, {
//       route_id: route.id,
//       suburb_name:
//         stop?.suburb_name ?? (orderRow?.sales_order_city || 'Unknown'),
//       city: stop?.city ?? orderRow?.sales_order_city ?? '',
//       province: stop?.province ?? orderRow?.state ?? '',
//       postal_code: stop?.postal_code ?? orderRow?.sales_order_zip_code ?? '',
//       position: stop?.position ?? null,
//     })

//     // upsert load_order + load_items
//     await upsertLoadOrder(
//       loadId,
//       loadStopId,
//       orderRow,
//       customer_id,
//       survivorLines
//     )

//     // recompute totals on the parent load
//     await recomputeLoadTotals(loadId)

//     return res
//       .status(200)
//       .send(
//         new Response(
//           200,
//           'Upserted',
//           `Order ${SalesOrderNumber} allocated to route load`
//         )
//       )
//   } catch (err) {
//     console.error('Server error during upsert:', err)
//     return res.status(500).send(new Response(500, 'Server Error', err.message))
//   }
// }

// export const upsertSalesOrder = async (req, res) => {
//   const {
//     OrderLines = [],
//     DocStatus,
//     SendToDispatch,
//     sendToPlanning,
//   } = req.body

//   const SalesOrderNumber =
//     req.params.SalesOrderNumber ||
//     req.params.salesOrderNumber ||
//     req.body.SalesOrderNumber ||
//     req.body.salesOrderNumber

//   if (!SalesOrderNumber) {
//     return res.status(400).send(new Response(400, 'Missing SalesOrderNumber'))
//   }

//   try {
//     // 1. If DocStatus is "C" (closed), delete from DB and exit
//     if (DocStatus === 'C') {
//       const { error: delLineErr } = await database
//         .from('order_lines')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)

//       const { error: delOrderErr } = await database
//         .from('sales_orders')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)

//       if (delOrderErr || delLineErr) {
//         return res
//           .status(500)
//           .send(
//             new Response(
//               500,
//               'Delete failed due to DocStatus=C',
//               delOrderErr?.message || delLineErr?.message
//             )
//           )
//       }

//       return res
//         .status(200)
//         .send(new Response(200, 'Deleted due to DocStatus=C'))
//     }

//     // 2. If sendToPlanning or SendToDispatch is NOT "Y" or "U", delete from DB and exit
//     if (
//       !['Y', 'U'].includes(SendToDispatch) &&
//       !['Y', 'U'].includes(sendToPlanning)
//     ) {
//       const { error: delLineErr } = await database
//         .from('order_lines')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)

//       const { error: delOrderErr } = await database
//         .from('sales_orders')
//         .delete()
//         .eq('sales_order_number', SalesOrderNumber)

//       if (delOrderErr || delLineErr) {
//         return res
//           .status(500)
//           .send(
//             new Response(
//               500,
//               'Deleted due to invalid dispatch/planning',
//               delOrderErr?.message || delLineErr?.message
//             )
//           )
//       }

//       return res
//         .status(200)
//         .send(
//           new Response(200, 'Deleted due to SendToDispatch/Planning not Y/U')
//         )
//     }

//     // 3. Upsert sales order
//     const { error: orderError } = await database.from('sales_orders').upsert(
//       [
//         {
//           sales_order_number: SalesOrderNumber,
//           ...mapOrderFields(req.body),
//         },
//       ],
//       {
//         onConflict: 'sales_order_number',
//       }
//     )

//     if (orderError) {
//       return res
//         .status(500)
//         .send(new Response(500, 'Order upsert failed', orderError.message))
//     }

//     // 4. Process order lines
//     const linesToUpsert = []

//     for (const line of OrderLines) {
//       const id = line.id ?? line.Id
//       const urProd = line.urProd ?? line.UrProd
//       const sendToProduction = line.sendToProduction ?? line.SendToProduction

//       if (!id) continue

//       // Delete line if marked deleted
//       if (urProd === 'D' || sendToProduction === 'D') {
//         const { error: delLineError } = await database
//           .from('order_lines')
//           .delete()
//           .eq('id', id)

//         if (delLineError) {
//           console.error(`Failed to delete line ${id}:`, delLineError.message)
//         }

//         continue // Skip upserting this deleted line
//       }

//       // Add to upsert list
//       linesToUpsert.push({
//         id,
//         sales_order_number: SalesOrderNumber,
//         description: line.description ?? line.Description,
//         lip_channel_quantity:
//           line.lipChannelQuantity ?? line.LipChannelQuantity,
//         quantity: line.quantity ?? line.Quantity,
//         weight: line.weight ?? line.Weight,
//         length: line.length ?? line.Length,
//         ur_prod: urProd,
//         send_to_production: sendToProduction,
//       })
//     }

//     // 5. Upsert remaining lines
//     if (linesToUpsert.length > 0) {
//       const { error: lineError } = await database
//         .from('order_lines')
//         .upsert(linesToUpsert, { onConflict: 'id' })

//       if (lineError) {
//         return res
//           .status(500)
//           .send(
//             new Response(500, 'Order line upsert failed', lineError.message)
//           )
//       }
//     }

//     return res
//       .status(200)
//       .send(
//         new Response(
//           200,
//           'Upserted',
//           `Sales order ${SalesOrderNumber} processed successfully`
//         )
//       )
//   } catch (err) {
//     console.error('Server error during upsert:', err)
//     return res.status(500).send(new Response(500, 'Server Error', err.message))
//   }
// }

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
