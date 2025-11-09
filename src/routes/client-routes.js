import express from 'express'

// middleware
import { apiClientAuth } from '../middleware/api-client-auth.js'

// controllers
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

import { autoAssignLoads } from '../controllers/assignment-planner-controllers/auto-assign-plan.js'
import { getAllPlans } from '../controllers/assignment-planner-controllers/get-plans.js'
import { addIdleUnit } from '../controllers/assignment-planner-controllers/add-idle-unit.js'
import { manuallyAssign } from '../controllers/assignment-planner-controllers/manually-assign-unit.js'
import { bulkAssign } from '../controllers/assignment-planner-controllers/bulk-assign.js'
import { unassign } from '../controllers/assignment-planner-controllers/unassign-unit.js'
import { deletePlan } from '../controllers/assignment-planner-controllers/delete-plan.js'
import { getPlan } from '../controllers/assignment-planner-controllers/get-plan.js'
import { setUnitNote } from '../controllers/assignment-planner-controllers/set-unit-note.js'
import { removePlannedUnit } from '../controllers/assignment-planner-controllers/remove-planned-unit.js'
import { addPlan } from '../controllers/assignment-planner-controllers/add-plan.js'

// --------------------//
// Client endpoints
// --------------------//

// routes
const router = express.Router()

// login
router.post('/login', loginWithSupabase)
router.post('/refresh', refreshSupabaseSession)
router.post('/logout', logout)

// branch routes
router.get('/branches', apiClientAuth, getAllBranches)
router.get('/branches/:id', apiClientAuth, getBranchById)
router.post('/branches', apiClientAuth, createBranch)
router.put('/branches/:id', apiClientAuth, updateBranch)
router.delete('/branches/:id', apiClientAuth, deleteBranch)

// user routes
router.get('/users', apiClientAuth, getAllUsers)
router.get('/users/:id', apiClientAuth, getUserById)
router.post('/users/', apiClientAuth, createUser)
router.put('/users/:id', apiClientAuth, updateUser)
router.delete('/users/:id', apiClientAuth, deleteUser)

// sap data
router.get('/orders', apiClientAuth, getSalesOrders)

// route routes
router.get('/routes', apiClientAuth, getRoutes)
router.get('/routes/:id', apiClientAuth, getRouteById)
router.post('/routes', apiClientAuth, createRoute)
router.put('/routes/:id', apiClientAuth, updateRoute)
router.delete('/routes/:id', apiClientAuth, deleteRoute)

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

// vehicle routes
router.get('/vehicles', apiClientAuth, getAllVehicles)
router.get('/vehicles/:id', apiClientAuth, getVehicleById)
router.post('/vehicles/', apiClientAuth, createVehicle)
router.put('/vehicles/:id', apiClientAuth, updateVehicle)
router.delete('/vehicles/:id', apiClientAuth, deleteVehicle)

// loads
router.get('/loads', apiClientAuth, getLoads)

// plan routes

router.post('/plans/auto-assign', apiClientAuth, autoAssignLoads)
router.post('/plans/add-plan', apiClientAuth, addPlan)
router.get('/plans', apiClientAuth, getAllPlans)
router.get('/plans/:plan_id', apiClientAuth, getPlan)
router.post('/plans/:plan_id/units', apiClientAuth, addIdleUnit)
// router.post(
//   '/plans/:planId/units/:unitId/assign',
//   apiClientAuth,
//   manuallyAssign
// )
router.post('/plans/:planId/bulk-assign', apiClientAuth, bulkAssign)
router.post('/plans/:planId/unassign', apiClientAuth, unassign)
router.delete('/plans/:planId', apiClientAuth, deletePlan)

router.post('/plans/units/note', apiClientAuth, setUnitNote)
router.post('/plans/units/remove', apiClientAuth, removePlannedUnit)

export default router
// comment
