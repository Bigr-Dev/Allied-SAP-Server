import express from 'express'
import { upsertSalesOrder } from '../controllers/sap-controller.js'
import { auth } from '../controllers/auth-controller.js'
import { apiSapAuth } from '../middleware/api-sap-auth.js'

const router = express.Router()

// --------------------//
// SAP endpoints
// --------------------//
router.post('/login', auth)
router.post('/orders', apiSapAuth, upsertSalesOrder)

export default router
