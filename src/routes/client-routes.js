import express from 'express'

// middleware
import { apiClientAuth } from '../middleware/api-client-auth.js'

// controllers
import { auth } from '../controllers/auth-controller.js'
import { getSalesOrders } from '../controllers/sap-controller.js'
import {
  getAllBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deleteBranch,
} from '../controllers/branch-controller.js'
import {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
} from '../controllers/customer-controller.js'
import {
  getAllDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  deleteDriver,
} from '../controllers/drivers-controller.js'
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} from '../controllers/user-controller.js'
import {
  getAllVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from '../controllers/vehicles-controller.js'
import { getLoads } from '../controllers/loads-controller.js'
import {
  loginWithSupabase,
  logout,
  refreshSupabaseSession,
} from '../controllers/client-auth-controller.js'
import {
  createRoute,
  deleteRoute,
  getRouteById,
  getRoutes,
  updateRoute,
} from '../controllers/routes-controller.js'
import {
  getAllItemsWithContext,
  getGroupedRoutes,
} from '../controllers/groupedRoutesController.js'
import {
  autoAssign,
  getVehicleAssignmentsByDate,
  unassign,
  // manuallyAssign,
  // unassign,
} from '../controllers/autoAssignment-controller.js'
import {
  autoAssignLoads,
  getFullPlan,
  getPlanById,
  manuallyAssign,
  unassignAll,
} from '../controllers/assignment-planner-controller.js'
// import { autoAssignLoads } from '../../old-code/autoAssignment-controller.js'

// --------------------//
// Client endpoints
// --------------------//

// routes
const router = express.Router()

// login
router.post('/login', loginWithSupabase)
router.post('/refresh', refreshSupabaseSession)
router.post('/logout', logout)

// router.post('/login', auth)

// sap data
router.get('/orders', apiClientAuth, getSalesOrders)

// route routes
router.get('/routes', apiClientAuth, getRoutes)
router.get('/routes/:id', apiClientAuth, getRouteById)
router.post('/routes', apiClientAuth, createRoute)
router.put('/routes/:id', apiClientAuth, updateRoute)
router.delete('/routes/:id', apiClientAuth, deleteRoute)

// branch routes
router.get('/branches', apiClientAuth, getAllBranches)
router.get('/branches/:id', apiClientAuth, getBranchById)
router.post('/branches', apiClientAuth, createBranch)
router.put('/branches/:id', apiClientAuth, updateBranch)
router.delete('/branches/:id', apiClientAuth, deleteBranch)

// customer routes
router.post('/customers', createCustomer)
router.get('/customers/', getCustomers)
router.get('/customers/:id', getCustomerById)
router.put('/customers/:id', updateCustomer)
router.delete('/customers/:id', deleteCustomer)

// driver routes
router.get('/drivers', apiClientAuth, getAllDrivers)
router.get('/drivers/:id', apiClientAuth, getDriverById)
router.post('/drivers/', apiClientAuth, createDriver)
router.put('/drivers/:id', apiClientAuth, updateDriver)
router.delete('/drivers/:id', apiClientAuth, deleteDriver)

// user routes
router.get('/users', apiClientAuth, getAllUsers)
router.get('/users/:id', apiClientAuth, getUserById)
router.post('/users/', apiClientAuth, createUser)
router.put('/users/:id', apiClientAuth, updateUser)
router.delete('/users/:id', apiClientAuth, deleteUser)

// vehicle routes
router.get('/vehicles', apiClientAuth, getAllVehicles)
router.get('/vehicles/:id', apiClientAuth, getVehicleById)
router.post('/vehicles/', apiClientAuth, createVehicle)
router.put('/vehicles/:id', apiClientAuth, updateVehicle)
router.delete('/vehicles/:id', apiClientAuth, deleteVehicle)

// loads
router.get('/loads', apiClientAuth, getLoads)

// grouped routes
/**
 * GET /api/grouped-routes
 *
 * Query Parameters:
 * - route: Filter by route ID
 * - route_name: Filter by route name (partial match)
 * - customer_name: Filter by customer name
 * - branch_id: Filter by branch ID
 * - include_suburbs: Include suburbs data (default: true)
 * - include_items: Include detailed items (default: true)
 *
 * Returns grouped routes with compatibility analysis
 */
router.get('/grouped-routes', apiClientAuth, getGroupedRoutes)

/**
 * GET /api/grouped-routes/items
 *
 * Query Parameters:
 * - route: Filter by route ID
 * - route_name: Filter by route name (partial match)
 * - customer_name: Filter by customer name
 * - branch_id: Filter by branch ID
 *
 * Returns all items with full customer and order context
 */
router.get('/grouped-routes/items', apiClientAuth, getAllItemsWithContext)

// vehicle assignment
//router.post('/auto-assign', apiClientAuth, autoAssign)
//router.post('/assignments/:planId/unassign/:assignmentId', async (req, res) => {
//router.post('/assignments/:planId/unassign-all', async (req, res) => {
// router.get('/assignments/:planId/unit/:unitId',
//router.get('/vehicle-assignments', apiClientAuth, getVehicleAssignmentsByDate)
// assignment planner
router.post('/auto-assign-loads', apiClientAuth, autoAssignLoads)
router.post('/manual-assign', apiClientAuth, manuallyAssign)
router.post('/unassign', apiClientAuth, unassign)
router.post('/unassign-all', apiClientAuth, unassignAll)
router.get('/assignments/:planId', apiClientAuth, getFullPlan)
router.get('/assignments/:planId/unit/:unitId', apiClientAuth, getPlanById)

export default router
