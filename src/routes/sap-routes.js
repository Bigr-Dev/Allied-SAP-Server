import express from 'express'
import {
  deleteSalesOrder,
  getSalesOrders,
  upsertSalesOrder,
} from '../controllers/sap-controller.js'

const router = express.Router()

// routes
router.post('/orders', upsertSalesOrder)
router.get('/orders', getSalesOrders)
router.put('/orders/:salesOrderNumber', upsertSalesOrder)
router.delete('/orders/:salesOrderNumber', deleteSalesOrder)

export default router
