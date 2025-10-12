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
import { autoAssignLoads } from '../controllers/assignment-planner-controllers/auto-assign-plan.js'
import { getAllPlans } from '../controllers/assignment-planner-controller.js'
import { addIdleUnit } from '../controllers/assignment-planner-controllers/add-idle-unit.js'
import { manuallyAssign } from '../controllers/assignment-planner-controllers/manually-assign-unit.js'
import { bulkAssignToUnits } from '../controllers/assignment-planner-controllers/bulk-assign.js'
import { unassign } from '../controllers/assignment-planner-controllers/unassign-unit.js'
import { deletePlan } from '../controllers/assignment-planner-controllers/delete-plan.js'
import { getPlan } from '../controllers/assignment-planner-controllers/get-plan.js'

// import {
//   autoAssignLoads,      // preview/commit plans (strict family lock baked in here)
//   addIdleUnit,          // add a unit to a plan (optional manual/auto-fill)
//   manuallyAssign,       // assign one or many items to an existing unit (no family lock version)
//   bulkAssignToUnits,    // assign many items across multiple units in one call
//   unassign,             // unassign items (single/bulk) or entire unit
//   deletePlan,           // delete a whole plan (units, assignments, bucket)
//   getPlan,              // unified: plan-only / full nested / single-unit / idle
//   getAllPlans,          // list plans
// } from './controllers.js'
// import {
//   autoAssign,
//   getVehicleAssignmentsByDate,
//   unassign,
//   // manuallyAssign,
//   // unassign,
// } from '../controllers/autoAssignment-controller.js'
// import {
//   addIdleUnit,
//   autoAssignLoads,
//   deletePlan,
//   getAllPlans,
//   getFullPlan,
//   getPlanById,
//   manuallyAssign,
//   unassignAll,
//   unassign,
// } from '../controllers/assignment-planner-controller.js'
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
// AUTO-ASSIGN (preview OR commit)
// POST /plans/auto-assign
//
// Body:
//  {
//    "departure_date": "2025-10-12",    // default = tomorrow
//    "cutoff_date": "2025-10-11",       // default = today
//    "branch_id": "uuid" | ["uuid"] | "all",
//    "customer_id": "uuid" | "all" | null,
//    "commit": false,                    // false = preview, true = write plan+units+assignments
//    "notes": "optional free text",
//    // knobs (optional; defaults shown):
//    "capacityHeadroom": 0.10,
//    "lengthBufferMm": 600,
//    "maxTrucksPerZone": 2,
//    "ignoreLengthIfMissing": true,
//    "ignoreDepartment": true,
//    "customerUnitCap": 2,
//    "routeAffinitySlop": 0.25
//  }
//
// Notes:
//  - Enforces: strict route-family lock, per-vehicle max 2 trips per day, customerUnitCap.
//  - commit=false → returns preview only (no DB writes).
//  - commit=true  → creates a plan, only persists units that actually receive items.
//  - “trip_no” is set on units if the column exists.
//
// Example (preview):
//  POST /plans/auto-assign  { "branch_id":"all", "commit":false }
//
// Example (commit):
//  POST /plans/auto-assign  { "branch_id":["b1","b2"], "departure_date":"2025-10-13", "commit":true }
router.post('/plans/auto-assign', apiClientAuth, autoAssignLoads)

// Legacy alias (kept for backwards compatibility)
// router.post('/auto-assign-loads', apiClientAuth, autoAssignLoads)

// ───────────────────────────────────────────────────────────────────────────────
// LIST PLANS (with optional filters/pagination your existing handler supports)
// GET /plans
router.get('/plans', apiClientAuth, getAllPlans)

// ───────────────────────────────────────────────────────────────────────────────
// ADD AN IDLE UNIT INTO A PLAN (and optionally assign items to it)
// POST /plans/:planId/units
//
// Body:
//  {
//    "unit": {                        // same shape as assignment_plan_units fields
//      "unit_type": "rigid" | "horse+trailer",
//      "rigid_id": "...", "horse_id": "...", "trailer_id": "...",
//      "driver_id": "...", "driver_name": "...",
//      "rigid_plate": "...", "rigid_fleet": "...",
//      "horse_plate": "...", "horse_fleet": "...",
//      "trailer_plate": "...", "trailer_fleet": "...",
//      "capacity_kg": 12000, "length_mm": 8500, "category": "", "priority": 0, "branch_id": "..." },
//    "assign_items": [                // optional; manual list to place on the unit
//      { "item_id":"...", "weight_kg": 450, "note": "manual" }
//    ],
//    "auto_fill": false,              // optional; if true, auto-pack remaining unassigned items (family-locked)
//    "lock_family": null,             // optional explicit family; else inferred from first item
//    "create_empty": false,           // don’t create the unit if nothing survives (unless true)
//    "customerUnitCap": 2             // optional; mirrors auto-assign cap
//  }
//
// Notes:
//  - Enforces max 2 trips per vehicle per plan date.
//  - Duplicate-safe; doesn’t create “empty” units unless create_empty=true.
//  - If auto_fill=true, it will greedily fill the unit with matching-family items in scope.
router.post('/plans/:planId/units', apiClientAuth, addIdleUnit)

// ───────────────────────────────────────────────────────────────────────────────
// MANUAL ASSIGN ITEMS TO AN EXISTING UNIT (no family lock)
// POST /plans/:planId/units/:unitId/assign
//
// Body:
//  {
//    "items": [{ "item_id":"...", "weight_kg": 120, "note":"manual" }, ...],
//    "customerUnitCap": 2
//  }
//
// Notes:
//  - Reads eligible items from v_unassigned_items_effective (must still be unassigned + in plan scope).
//  - Enforces per-customer “distinct units” cap inside this plan.
//  - Skips duplicates and zero-weight rows.
//  - Recalculates used_capacity_kg and returns the standard nested structure.
router.post(
  '/plans/:planId/units/:unitId/assign',
  apiClientAuth,
  manuallyAssign
)

// ───────────────────────────────────────────────────────────────────────────────
// BULK ASSIGNMENT TO MULTIPLE UNITS IN ONE CALL
// POST /plans/:planId/bulk-assign
//
// Body:
//  {
//    "assignments": [
//      { "plan_unit_id":"unit-1", "items":[ {"item_id":"a","weight_kg":300}, {"item_id":"b"} ] },
//      { "plan_unit_id":"unit-2", "items":[ {"item_id":"c","note":"rush"} ] }
//    ],
//    "customerUnitCap": 2,
//    "enforce_family": false          // set true to forbid mixing macro-families per unit
//  }
//
// Notes:
//  - Duplicate-safe, scope-aware, optional family enforcement.
//  - Returns the same nested manifest after insert.
router.post('/plans/:planId/bulk-assign', apiClientAuth, bulkAssignToUnits)

// ───────────────────────────────────────────────────────────────────────────────
// UNASSIGN (single item, many items, or entire unit)
// POST /plans/:planId/unassign
//
// Body:
//  {
//    "items": [
//      { "plan_unit_id":"unit-1", "item_id":"x" },   // remove specific item
//      { "plan_unit_id":"unit-2" }                   // remove ALL items from this unit
//    ],
//    "to_bucket": true,                // optional: write to plan bucket with a reason
//    "bucket_reason": "driver unavailable",
//    "remove_empty_unit": true         // delete units that end up with 0 assignments
//  }
//
// Notes:
//  - No-op if a pair doesn’t exist (safe to repeat).
//  - Recalculates capacity and returns standard nested manifest.
router.post('/plans/:planId/unassign', apiClientAuth, unassign)

// (If you still want the old per-assignment DELETE by id, keep this too.)
// router.delete('/plans/:planId/assignments/:assignmentId', apiClientAuth, unassign)

// ───────────────────────────────────────────────────────────────────────────────
// DELETE A PLAN (units, assignments, bucket). Hard delete.
// DELETE /plans/:planId
//
// Notes:
//  - If you created the `sp_delete_plan` RPC, the controller uses it atomically.
//  - Otherwise it deletes children first, then the plan.
router.delete('/plans/:planId', apiClientAuth, deletePlan)

// ───────────────────────────────────────────────────────────────────────────────
// GET PLAN (unified)
// POST /plans/get
//
// Body:
//  {
//    "plan_id": "uuid",               // required
//    "include_nested": true,          // false => plan header only
//    "include_idle": true,            // only if include_nested=true
//    "unit_id": "uuid"                // optional: return nested for THIS unit only
//  }
//
// Notes:
//  - Replaces both: getFullPlan (full manifest) and per-unit getPlanById.
//  - include_nested=false → { plan } only.
//  - include_nested=true  → { plan, assigned_units, customers, unassigned }.
//  - include_idle=true    → also returns { idle_units_by_branch }.
//  - unit_id present      → returns nested view for just that unit (same shape).
router.post('/plans', apiClientAuth, getPlan)

// ───────────────────────────────────────────────────────────────────────────────
// (Optional) Legacy readers to avoid breaking older clients:

// GET full plan snapshot (legacy):
// router.get('/plans/:planId', apiClientAuth, (req, res) =>
//   getPlan({
//     body: { plan_id: req.params.planId, include_nested: true },
//     // ...arguments,
//   })
// )

// GET single unit within a plan (legacy):
// router.get('/plans/:planId/units/:unitId', apiClientAuth, (req, res) =>
//   getPlan({
//     body: { plan_id: req.params.planId, unit_id: req.params.unitId },
//     ...arguments,
//   })
// )

export default router

// // ───────────────────────────────────────────────────────────────────────────────
// // AUTO-ASSIGN (preview or commit)
// // POST /plans/auto-assign
// // Notes:
// //  - commit=false (default) ⇒ preview only
// //  - commit=true  ⇒ writes plan, units & assignments
// //router.post('/plans/auto-assign', apiClientAuth, autoAssignLoads)
// router.post('/auto-assign-loads', apiClientAuth, autoAssignLoads)
// // (Optional legacy alias to avoid breaking existing clients)
// // router.post('/auto-assign-loads', apiClientAuth, autoAssignLoads)

// // ───────────────────────────────────────────────────────────────────────────────
// // GET all plans (with optional filters/pagination)
// router.get('/plans', apiClientAuth, getAllPlans)

// // ───────────────────────────────────────────────────────────────────────────────
// // ADD AN IDLE VEHICLE INTO A PLAN
// // POST /plans/:planId/units
// // Body can specify either `unit_key` (from idle_units_by_branch) or explicit IDs.
// // Optionally assign items immediately via `assign_items`.
// router.post('/plans/:planId/units', apiClientAuth, addIdleUnit)

// // ───────────────────────────────────────────────────────────────────────────────
// // MANUAL ASSIGN AN ITEM TO AN EXISTING PLAN UNIT
// // POST /plans/:planId/units/:unitId/assign
// router.post(
//   '/plans/:planId/units/:unitId/assign',
//   apiClientAuth,
//   manuallyAssign
// )

// // ───────────────────────────────────────────────────────────────────────────────
// // UNASSIGN A SINGLE ASSIGNMENT
// // DELETE /plans/:planId/assignments/:assignmentId
// router.delete(
//   '/plans/:planId/assignments/:assignmentId',
//   apiClientAuth,
//   unassign
// )

// // (If you prefer POST semantics, keep this alias too)
// // router.post('/unassign/:planId/:assignmentId', apiClientAuth, unassign)

// // ───────────────────────────────────────────────────────────────────────────────
// // UNASSIGN ALL ITEMS IN A PLAN (keeps the plan & units)
// // POST /plans/:planId/assignments/unassign-all
// router.post(
//   '/plans/:planId/assignments/unassign-all',
//   apiClientAuth,
//   unassignAll
// )

// // ───────────────────────────────────────────────────────────────────────────────
// // GET FULL PLAN SNAPSHOT (units, assignments, unassigned bucket)
// // GET /plans/:planId
// router.get('/plans/:planId', apiClientAuth, getFullPlan)

// // ───────────────────────────────────────────────────────────────────────────────
// // GET A SINGLE UNIT WITHIN A PLAN
// // GET /plans/:planId/units/:unitId
// router.get('/plans/:planId/units/:unitId', apiClientAuth, getPlanById)

// // e.g., in your router setup
// router.delete('/plans/:planId', apiClientAuth, deletePlan)

// export default router
