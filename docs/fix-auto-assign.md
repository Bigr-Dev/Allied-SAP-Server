# Task: Make `autoAssignPlan()` behave like legacy `autoAssignLoads`

## 1. Goal

Update `autoAssignPlan` in `src/services/planning-service.js` so that it **behaves exactly like** the legacy `autoAssignLoads` controller in `controllers/planner/auto-assign-plan.js`, while keeping the new **service-style** structure (no `req/res`, returning data instead of sending HTTP responses).

The **external behaviour** of the `/api/plans/:planId/auto-assign` endpoint must remain identical to the legacy implementation.

---

## 2. Relevant Files

- Legacy reference (correct behaviour):  
  `controllers/planner/auto-assign-plan.js` – function `autoAssignLoads`
- New service implementation (needs work):  
  `src/services/planning-service.js` – function `autoAssignPlan(options)`

Do **not** change other service functions (`listPlans`, `getPlanById`, `bulkAssignOrders`, etc.).

---

## 3. Behaviour of the Legacy `autoAssignLoads`

Port **this behaviour** into the service:

1. **Inputs (from body):**

   - `plan_id` (required)
   - `branch_id` (optional branch filter)
   - `commit` (boolean; default `true`)
   - `max_units_per_customer_per_day` (default `2`)

2. **Plan fetch & validation**

   - Load `plans` row by `plan_id`.
   - If not found → `404`.
   - On DB error → `500`.

3. **Unassigned orders**

   - Query `v_unassigned_orders` filtered by `plan_id`.
   - Shape each row using `shapeOrderRow(...)` (same fields as legacy: ids, customer, branch, route, suburb, weight, quantities, etc.).
   - If `branch_id` filter is provided (and not `"all"`), filter orders to that branch.
   - If no candidate orders after filtering → return payload with:
     - `plan`
     - `units: []`
     - `assigned_orders: []`
     - `unassigned_orders: []`
     - `unassigned_units: []`

4. **Already-assigned loads for this plan**

   - Query `loads` where:
     - `assignment_plan_id = planId`
     - `assigned_unit_id IS NOT NULL`
   - Shape them with the same `shapeOrderRow`.
   - These are used to compute:
     - existing used capacity per unit
     - existing `routes_served`
     - `customerDayUnits`
     - `unitsPerRoute`

5. **Planned units**

   - Query `planned_units` by `plan_id`.
   - Filter to `status IS NULL OR status = 'active'`.
   - Each `planned_unit` is tied to a `vehicle_assignment`.

6. **Vehicle assignments, vehicles, drivers**

   - From all candidate orders, collect `branch_id`s.
   - Query `vehicle_assignments`:
     - `status = 'active'`
     - `branch_id IN (branches from candidate orders)`
   - Build:
     - `vaById` map
     - `availableAssignmentsByBranch` map
     - sets of `vehicleId` and `driverId`
   - Query `vehicles` with those ids and map them by `id`.
   - Query `drivers` with those ids and map them by `id`.

7. **Build current unit state**

   - For **each assigned load**, update:
     - `loadsByUnit[assigned_unit_id]`
     - `unitUsedWeight[unitId] += total_weight`
     - `routesServed[unitId].add(route_id)`
     - `customerDayUnits["customer_id|delivery_date"].add(unitId)`
     - `unitsPerRoute[route_id].add(unitId)`
   - For **each active planned unit**:

     - Look up its `vehicle_assignment` (`vaById`).
     - Resolve `vehicle`, `trailer`, `driver`.
     - **Business rule**: if `vehicle_type === 'horse'` and there is **no trailer**, skip this unit (not usable).
     - Compute capacity:
       - For horses: use `trailer.capacity`.
       - Otherwise: use `vehicle.capacity`.
       - Use `parseCapacityKg` from legacy controller to convert to kg.
     - `used_weight_kg` = sum from `unitUsedWeight`.
     - `remaining_capacity_kg` = `capacity_kg - used_weight_kg` (but not below 0; Infinity supported).
     - `routes_served` = `routesServed[planned_unit_id]` (Set).
     - Add to in-memory `units` array.
     - Track `usedVAIds`.

   - Remove all used vehicle assignments from `availableAssignmentsByBranch`.

8. **Order sorting**

   - Build `ordersById` map from **both**:
     - `assignedLoads`
     - `candidateOrders`
   - Sort `candidateOrders` by:
     1. `route_id` (stringified) ascending
     2. `delivery_date` ascending
     3. `total_weight` **descending**

9. **Candidate unit selection per order**

   - Implement `findCandidateUnitsForOrder(order)` logic exactly as in legacy:
     - Only consider units in the same `branch_id` (if order has a branch).
     - Unit must have enough `remaining_capacity_kg >= order.total_weight`.
     - **Route rule**: 1 route per vehicle
       - If `routes_served` set is non-empty and does **not** contain `order.route_id`, skip.
     - **Customer/day rule**:
       - Key: `customer_id|delivery_date`.
       - Use `maxUnitsPerCustomerPerDay`.
       - If `custUnits.size >= maxUnitsPerCustomerPerDay` and this unit is not already in `custUnits`, skip.
     - Return:
       - `routeKey`, `routeSet`, `custKey`, `custUnits`, `candidates`, `weight`.

10. **Dynamic unit creation**

    - If `candidates` is empty for a given order:
      - Look up `availableAssignmentsByBranch[order.branch_id]`.
      - Filter out:
        - horses **without** trailers.
      - Take the first available `vehicle_assignment`:
        - Insert a new `planned_units` row:
          - `plan_id = planId`
          - `vehicle_assignment_id = va.id`
          - `status = 'active'`
        - Construct a new in-memory `unit` with:
          - correct `vehicle`, `trailer`, `driver`
          - `capacity_kg` based on effective capacity (trailer vs vehicle)
          - `used_weight_kg = 0`
          - `remaining_capacity_kg = capacity_kg`
          - `routes_served = new Set()`
        - Push it into `units`.
        - Mark this `vehicle_assignment` as used (update `usedVAIds` and branch pool).
        - Recalculate `candidateList` by calling `findCandidateUnitsForOrder(order)` again.

11. **Unit choice (best fit)**

    - From `candidateList`, pick the unit with **minimum non-negative residual**:
      - `residual = remaining_capacity_kg - orderWeight`
      - Choose the smallest `residual >= 0`.

12. **Update in-memory state after assigning**

    - For each assignment:
      - Push `{ planned_unit_id, order_id }` into `assignments`.
      - Update unit:
        - `used_weight_kg += orderWeight`
        - `remaining_capacity_kg = capacity_kg - used_weight_kg`
      - Add `route_id` to `unit.routes_served` and update `unitsPerRoute`.
      - Add `planned_unit_id` to `customerDayUnits[custKey]`.

13. **Commit to DB (when `commitFlag === true`)**

    - Group assignments by `planned_unit_id`.
    - For each group:
      - Update `loads`:
        - `assignment_plan_id = planId`
        - `assigned_unit_id = unitId`
        - `is_split = false`
      - Update `load_items`:
        - `assignment_plan_id = planId`
        - `assigned_unit_id = unitId`

14. **Attach line items for ALL orders in scope**

    - Query `load_items` for all `order_id`s in `ordersById`.
    - Build `linesByOrderId` map and attach `lines` to each order object.

15. **Build response payload**

    - Build `unitOrdersMap`:
      - Start with `assignedLoads` (existing DB assignments).
      - Add newly assigned orders from `assignments`.
    - Build `assignedOrdersMap` from all orders in `unitOrdersMap`.
    - `unassigned_orders` = `candidateOrders` where no assignment exists.
    - For each unit in `units`, build a unit payload:
      - Basic unit details: `planned_unit_id`, `plan_id`, `vehicle_assignment_id`, `branch_id`, `vehicle_type`, etc.
      - Nested `driver`, `vehicle`, `trailer` objects (subset of fields).
      - `capacity_kg`, `used_weight_kg`, `remaining_capacity_kg`.
      - `routes_served` as an array.
      - `summary`: `total_orders`, `total_line_items`, `total_quantity`, `total_weight`.
      - `orders`: the full list of orders assigned to that unit (with `lines`).
    - Compute `unassignedUnits` as units with no orders **but**:

      - In the current version, the response uses:
        - `unassigned_units: availableVehicleAssignments`
      - and each `availableVehicleAssignments` entry is a VA with nested `driver`, `vehicle`, `trailer`.

    - Final payload must be:

      ```js
      {
        plan,
        units: unitsPayload,
        assigned_orders: Array.from(assignedOrdersMap.values()),
        unassigned_orders: unassignedOrders,
        unassigned_units: availableVehicleAssignments,
        meta: {
          committed: commitFlag,
          assignments_created: assignments.length,
          max_units_per_customer_per_day: maxUnitsPerCustomerPerDay
        }
      }
      ```

---

## 4. Problems in Current `autoAssignPlan` (Service)

The current implementation in `planning-service.js`:

- Only looks at **unassigned** orders and **available** vehicle assignments.
- Does **not**:
  - take existing `assigned` loads into account for capacity or routes.
  - use existing `planned_units` as capacity carriers.
  - create new `planned_units` records when new vehicles are needed.
  - build the full payload expected by the frontend (no `units` structure, `assigned_orders`, `unassigned_units` as available vehicle assignments, etc.).
- Adds new “tuning” options (`capacityHeadroom`, `lengthBufferMm`, `ignoreLengthIfMissing`, `strictBranchMatching`, `allowMixedRoutes`) that change behaviour compared to the legacy algorithm.

This is why the new version “does not work like the old one”.

---

## 5. Required Changes to `autoAssignPlan` (Service)

### 5.1. Align options with legacy inputs

Inside `autoAssignPlan(options)`:

- Support these inputs (matching legacy semantics):
  - `planId` ← maps to `plan_id`
  - `branchId` or `branch_id` (optional)
  - `commit` (boolean, default `true`)
  - `maxUnitsPerCustomerPerDay` (default `2`)
- You may keep the additional tuning options in the signature, but for now:
  - **Do not change behaviour** compared to legacy.
  - It is acceptable to ignore `capacityHeadroom`, `lengthBufferMm`, `ignoreLengthIfMissing`, `strictBranchMatching`, `allowMixedRoutes` until a v2 algorithm is explicitly introduced.

### 5.2. Port the legacy algorithm into the service

- Replace the current body of `autoAssignPlan` with an adaptation of `autoAssignLoads` that:
  - Uses **exactly** the same query logic, sorting, and constraints described in section 3.
  - Uses `database` directly (same as other service functions).
  - Does **not** use `req`/`res`.
  - Throws `Error` with `statusCode` where appropriate instead of sending HTTP responses.

### 5.3. Preserve helper behaviour

- Reuse the existing helper logic from the legacy controller:
  - `toNumber`
  - `asBool`
  - `parseCapacityKg`
  - `shapeOrderRow`
- Either:
  - Inline them into `planning-service.js` (as pure functions at the top), **or**
  - Move them to a shared util (e.g. `utils/assignment-utils.js`) and import them, but **do not** change their behaviour.

### 5.4. Commit / preview semantics

- When `commit === true`:
  - Perform the **same** `loads` and `load_items` updates as legacy, grouped by `planned_unit_id`.
- When `commit === false`:
  - Do **not** write to DB.
  - Still return the full computed payload based on in-memory assignments.

### 5.5. Return value (service → controller)

- `autoAssignPlan` must **return** the payload object (the same structure that legacy `autoAssignLoads` used as `Response.data`), not wrap it.
- The controller for `/api/plans/:planId/auto-assign` will:
  - Call `autoAssignPlan(options)` and
  - Wrap the result in the standard `Response` object and HTTP status.

### 5.6. Keep response shape stable for the frontend

- Ensure the returned payload matches the legacy shape exactly:

  ```js
  {
    plan,
    units: [...],
    assigned_orders: [...],
    unassigned_orders: [...],
    unassigned_units: [...], // available vehicle assignments
    meta: {
      committed: boolean,
      assignments_created: number,
      max_units_per_customer_per_day: number
    }
  }
  ```
