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
  addIdleUnit,
  autoAssignLoads,
  getAllPlans,
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

// ───────────────────────────────────────────────────────────────────────────────
// AUTO-ASSIGN (preview or commit)
// POST /plans/auto-assign
// Notes:
//  - commit=false (default) ⇒ preview only
//  - commit=true  ⇒ writes plan, units & assignments
//router.post('/plans/auto-assign', apiClientAuth, autoAssignLoads)
router.post('/auto-assign-loads', apiClientAuth, autoAssignLoads)
// (Optional legacy alias to avoid breaking existing clients)
// router.post('/auto-assign-loads', apiClientAuth, autoAssignLoads)

// ───────────────────────────────────────────────────────────────────────────────
// GET all plans (with optional filters/pagination)
router.get('/plans', apiClientAuth, getAllPlans)

// ───────────────────────────────────────────────────────────────────────────────
// ADD AN IDLE VEHICLE INTO A PLAN
// POST /plans/:planId/units
// Body can specify either `unit_key` (from idle_units_by_branch) or explicit IDs.
// Optionally assign items immediately via `assign_items`.
router.post('/plans/:planId/units', apiClientAuth, addIdleUnit)

// ───────────────────────────────────────────────────────────────────────────────
// MANUAL ASSIGN AN ITEM TO AN EXISTING PLAN UNIT
// POST /plans/:planId/units/:unitId/assign
router.post(
  '/plans/:planId/units/:unitId/assign',
  apiClientAuth,
  manuallyAssign
)

// ───────────────────────────────────────────────────────────────────────────────
// UNASSIGN A SINGLE ASSIGNMENT
// DELETE /plans/:planId/assignments/:assignmentId
router.delete(
  '/plans/:planId/assignments/:assignmentId',
  apiClientAuth,
  unassign
)

// (If you prefer POST semantics, keep this alias too)
// router.post('/unassign/:planId/:assignmentId', apiClientAuth, unassign)

// ───────────────────────────────────────────────────────────────────────────────
// UNASSIGN ALL ITEMS IN A PLAN (keeps the plan & units)
// POST /plans/:planId/assignments/unassign-all
router.post(
  '/plans/:planId/assignments/unassign-all',
  apiClientAuth,
  unassignAll
)

// ───────────────────────────────────────────────────────────────────────────────
// GET FULL PLAN SNAPSHOT (units, assignments, unassigned bucket)
// GET /plans/:planId
router.get('/plans/:planId', apiClientAuth, getFullPlan)

// ───────────────────────────────────────────────────────────────────────────────
// GET A SINGLE UNIT WITHIN A PLAN
// GET /plans/:planId/units/:unitId
router.get('/plans/:planId/units/:unitId', apiClientAuth, getPlanById)

export default router
