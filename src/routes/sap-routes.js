import express from 'express'
import { upsertSalesOrder } from '../controllers/sap-controller.js'
import { auth } from '../controllers/auth-controller.js'
import { apiClientAuth } from '../middleware/api-client-auth.js'

const router = express.Router()

// --------------------//
// SAP endpoints
// --------------------//
router.post('/login', auth)
router.post('/orders', apiClientAuth, upsertSalesOrder)

export default router
