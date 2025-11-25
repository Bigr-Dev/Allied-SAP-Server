# Assignment Planner & Loads API Documentation

**NOTE: This file is deprecated. See [docs/backend-api-overview.md](backend-api-overview.md) for the latest API documentation.**

## Overview

The Assignment Planner system manages the allocation of delivery orders (loads) to vehicle units within delivery plans. It provides intelligent auto-assignment capabilities based on routes, capacity, and business rules, as well as manual assignment controls.

## Core Concepts

### Plans
- **Purpose**: Container for organizing delivery assignments within a date range
- **Scope**: Can cover all branches or specific branches
- **Status**: planning, active, completed, cancelled

### Planned Units
- **Purpose**: Represents a vehicle assignment (vehicle + driver + trailer) allocated to a plan
- **Status**: active, paused, out-of-service (oos)
- **Capacity**: Determined by vehicle type (horse uses trailer capacity, others use vehicle capacity)

### Loads/Orders
- **Purpose**: Delivery orders from SAP that need to be assigned to vehicles
- **Assignment**: Can be assigned to planned units within plans
- **Splitting**: Orders can be split across multiple units if needed

---

## Assignment Planner Controllers

### 1. Auto-Assign Plan (`POST /api/plans/auto-assign`)

**Purpose**: Intelligently assigns unassigned orders to planned units based on business rules.

#### Input
```json
{
  "plan_id": "uuid",                           // Required
  "branch_id": "uuid | 'all'",                // Optional filter
  "commit": false,                             // Preview vs commit
  "max_units_per_customer_per_day": 2         // Business rule limit
}
```

#### Business Rules
1. **Route Constraint**: Max 2 vehicles per route
2. **Vehicle Route Constraint**: 1 route per vehicle (no mixing)
3. **Customer Constraint**: Max N units per customer per day (default: 2)
4. **Capacity Constraint**: Respects vehicle/trailer weight limits
5. **Branch Matching**: Orders assigned to vehicles from same branch

#### Algorithm Flow
1. **Fetch Plan**: Validate plan exists and is accessible
2. **Get Unassigned Orders**: From `v_unassigned_orders` view filtered by plan
3. **Get Assigned Orders**: Already assigned orders for capacity calculations
4. **Get Planned Units**: Active vehicle assignments in the plan
5. **Get Vehicle Data**: Vehicles, trailers, drivers for capacity and details
6. **Build Current State**: Calculate used capacity, routes served, customer assignments
7. **Sort Orders**: By route → date → weight (heaviest first)
8. **Assignment Loop**: For each order, find best-fit unit or create new unit
9. **Auto-Create Units**: Add new planned units from available vehicle assignments
10. **Commit/Preview**: Either update database or return preview

#### Output (Preview Mode)
```json
{
  "statusCode": 200,
  "message": "Auto-assignment preview generated successfully",
  "data": {
    "plan": { /* plan details */ },
    "units": [
      {
        "planned_unit_id": "uuid",
        "vehicle_assignment_id": "uuid",
        "branch_id": "uuid",
        "vehicle_type": "truck|horse|bakkie",
        "driver": { /* driver details */ },
        "vehicle": { /* vehicle details */ },
        "trailer": { /* trailer details if horse */ },
        "capacity_kg": 5000,
        "used_weight_kg": 2500,
        "remaining_capacity_kg": 2500,
        "routes_served": ["route_id1"],
        "summary": {
          "total_orders": 3,
          "total_line_items": 15,
          "total_quantity": 100,
          "total_weight": 2500
        },
        "orders": [ /* assigned orders with lines */ ]
      }
    ],
    "assigned_orders": [ /* all assigned orders */ ],
    "unassigned_orders": [ /* orders that couldn't be assigned */ ],
    "unassigned_units": [ /* units with no orders */ ],
    "meta": {
      "committed": false,
      "assignments_created": 5,
      "max_units_per_customer_per_day": 2
    }
  }
}
```

#### Output (Commit Mode)
Same structure but with `committed: true` and database updated.

---

### 2. Add Plan (`POST /api/plans/add-plan`)

**Purpose**: Creates a new delivery plan.

#### Input
```json
{
  "plan_name": "Weekly Delivery Plan",        // Required
  "delivery_start": "2024-01-01",            // Required (YYYY-MM-DD)
  "delivery_end": "2024-01-07",              // Optional, defaults to start date
  "scope_all_branches": true,                // Optional, default true
  "notes": "Special instructions",           // Optional
  "status": "planning"                       // Optional, default 'planning'
}
```

#### Output
```json
{
  "statusCode": 201,
  "message": "Plan created",
  "data": {
    "plan": { /* created plan details */ },
    "units": [],
    "assigned_orders": [],
    "unassigned_orders": [],
    "unassigned_units": []
  }
}
```

---

### 3. Get Plans (`GET /api/plans`)

**Purpose**: Retrieves list of plans with optional filtering and aggregation.

#### Query Parameters
- `limit`: Number of plans to return (default: 50)
- `offset`: Pagination offset (default: 0)
- `order`: Sort order 'asc' or 'desc' (default: 'desc')
- `date_from`: Filter by delivery start date (YYYY-MM-DD)
- `date_to`: Filter by delivery end date (YYYY-MM-DD)
- `include_units`: Include unit IDs ('true'/'false')
- `include_counts`: Include summary counts ('true'/'false')
- `include_unassigned`: Include unassigned order counts ('true'/'false')

#### Output
```json
{
  "statusCode": 200,
  "message": "Plans fetched",
  "data": {
    "total": 25,
    "limit": 50,
    "offset": 0,
    "plans": [
      {
        "id": "uuid",
        "plan_name": "Weekly Plan",
        "delivery_start": "2024-01-01",
        "delivery_end": "2024-01-07",
        "status": "planning",
        "plan_unit_ids": ["uuid1", "uuid2"],     // if include_units=true
        "summary": {                             // if include_counts=true
          "units_count": 5,
          "orders_count": 25,
          "total_weight": 15000
        },
        "unassigned_count": 3                    // if include_unassigned=true
      }
    ]
  }
}
```

---

### 4. Get Plan (`GET /api/plans/:plan_id`)

**Purpose**: Retrieves detailed plan information with units and orders.

#### Output
```json
{
  "statusCode": 200,
  "message": "Plan fetched",
  "data": {
    "plan": { /* plan details */ },
    "units": [ /* detailed units with orders and lines */ ],
    "unassigned_orders": [ /* orders not assigned to any unit */ ]
  }
}
```

---

### 5. Add Idle Unit (`POST /api/plans/:plan_id/units`)

**Purpose**: Adds a vehicle assignment to a plan as a planned unit.

#### Input
```json
{
  "plan_id": "uuid",                          // Required (also in URL)
  "vehicle_assignment_id": "uuid",           // Required
  "status": "active",                        // Optional, default 'active'
  "notes": "Special instructions"            // Optional
}
```

#### Output
Returns updated plan payload with new unit included.

---

### 6. Bulk Assign (`POST /api/plans/:planId/bulk-assign`)

**Purpose**: Manually assigns multiple orders to specific planned units.

#### Input
```json
{
  "plan_id": "uuid",
  "assignments": [
    {
      "planned_unit_id": "uuid",
      "orders": [
        { "order_id": "uuid1" },
        { "order_id": "uuid2" }
      ]
    }
  ]
}
```

#### Validation
- Planned units must belong to the specified plan
- Orders must be unassigned and within plan date range
- Orders cannot be assigned to other plans

#### Output
Returns updated plan payload with new assignments.

---

### 7. Unassign (`POST /api/plans/:planId/unassign`)

**Purpose**: Removes order assignments from planned units.

#### Input
```json
{
  "plan_id": "uuid",
  "planned_unit_id": "uuid",
  "order_ids": ["uuid1", "uuid2"]            // Optional, if omitted unassigns all
}
```

#### Output
Returns updated plan payload with assignments removed.

---

### 8. Set Unit Note (`POST /api/plans/units/note`)

**Purpose**: Updates notes for a planned unit.

#### Input
```json
{
  "plan_id": "uuid",
  "planned_unit_id": "uuid",
  "note": "Updated instructions"
}
```

#### Output
Returns updated plan payload.

---

### 9. Remove Planned Unit (`POST /api/plans/units/remove`)

**Purpose**: Removes a planned unit from a plan (must be unassigned first).

#### Input
```json
{
  "plan_id": "uuid",
  "planned_unit_id": "uuid"
}
```

#### Output
Returns updated plan payload without the removed unit.

---

### 10. Delete Plan (`DELETE /api/plans/:planId`)

**Purpose**: Deletes a plan and all its planned units (unassigns all orders first).

#### Output
```json
{
  "statusCode": 200,
  "message": "Plan deleted"
}
```

---

## Loads Controller

### Get Loads (`GET /api/loads`)

**Purpose**: Retrieves hierarchical load data organized by branch → route → suburb → customer → orders.

#### Query Parameters
- `date`: Specific delivery date (YYYY-MM-DD)
- `from`: Start date range (YYYY-MM-DD)
- `to`: End date range (YYYY-MM-DD)
- `branch_id`: Filter by branch UUID
- `route_id`: Filter by route UUID
- `customer_name`: Filter by customer name (partial match)

#### Data Source
Uses `fn_loads_flat` database function that returns flattened load data with:
- Order headers (loads table)
- Order lines (load_items table)
- Assignment information (plan_id, unit_id, is_split)
- Geographic data (branch, route, suburb)
- Customer data

#### Output Structure
```json
{
  "statusCode": 200,
  "message": "Loads fetched",
  "data": {
    "branches": [
      {
        "branch_id": "uuid",
        "branch_name": "Main Branch",
        "routes": [
          {
            "route_id": "uuid",
            "route_name": "Route A",
            "suburbs": [
              {
                "suburb_route_id": "uuid",
                "suburb_name": "Suburb 1",
                "address": "123 Main St",
                "customers": [
                  {
                    "customer_id": "uuid",
                    "customer_name": "Customer ABC",
                    "orders": [
                      {
                        "order_id": "uuid",
                        "sales_order_id": "uuid",
                        "sales_order_number": "SO-12345",
                        "delivery_date": "2024-01-01",
                        "totals": {
                          "items": 5,
                          "quantity": 100,
                          "weight": 2500
                        },
                        "status": "confirmed",
                        "sales_person_name": "John Doe",
                        "assignment_plan_id": "uuid",      // null if unassigned
                        "assigned_unit_id": "uuid",        // null if unassigned
                        "is_split": false,
                        "order_lines": [
                          {
                            "order_line_id": "uuid",
                            "description": "Product A",
                            "lip_channel_quantity": 10,
                            "quantity": 20,
                            "weight": 500,
                            "length": 6.0,
                            "ur_prod": "PROD001",
                            "send_to_production": true,
                            "assignment": "assigned"       // line-level assignment status
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

#### Hierarchical Organization
The loads are organized in a tree structure for efficient frontend consumption:
1. **Branch Level**: Groups by delivery branch
2. **Route Level**: Groups by delivery routes within branches
3. **Suburb Level**: Groups by suburbs within routes
4. **Customer Level**: Groups by customers within suburbs
5. **Order Level**: Individual orders with line items

#### Assignment Status Integration
- Orders show current assignment status (`assignment_plan_id`, `assigned_unit_id`)
- Split orders are flagged with `is_split: true`
- Line-level assignment status in `order_lines[].assignment`

---

## Common Data Structures

### Order/Load Object
```json
{
  "order_id": "uuid",
  "sales_order_id": "uuid",
  "sales_order_number": "SO-12345",
  "delivery_date": "2024-01-01",
  "branch_id": "uuid",
  "branch_name": "Main Branch",
  "route_id": "uuid",
  "route_name": "Route A",
  "suburb_route_id": "uuid",
  "suburb_name": "Suburb 1",
  "suburb_city": "City",
  "suburb_province": "Province",
  "suburb_postal_code": "12345",
  "customer_id": "uuid",
  "customer_name": "Customer ABC",
  "customer_bp_code": "BP001",
  "total_line_items": 5,
  "total_quantity": 100,
  "total_weight": 2500,
  "status": "confirmed",
  "sales_person_name": "John Doe",
  "address": "123 Customer St",
  "assignment_plan_id": "uuid",
  "assigned_unit_id": "uuid",
  "is_split": false,
  "lines": [ /* order line items */ ]
}
```

### Planned Unit Object
```json
{
  "planned_unit_id": "uuid",
  "plan_id": "uuid",
  "vehicle_assignment_id": "uuid",
  "branch_id": "uuid",
  "vehicle_type": "truck",
  "vehicle_id": "uuid",
  "trailer_id": "uuid",
  "driver_id": "uuid",
  "driver": {
    "id": "uuid",
    "name": "John",
    "last_name": "Driver",
    "phone": "+1234567890",
    "license": "DL123456"
  },
  "vehicle": {
    "id": "uuid",
    "reg_number": "REG123",
    "license_plate": "ABC123GP",
    "model": "Truck Model",
    "capacity": "5000kg"
  },
  "trailer": { /* trailer details if vehicle_type is 'horse' */ },
  "capacity_kg": 5000,
  "used_weight_kg": 2500,
  "remaining_capacity_kg": 2500,
  "routes_served": ["route_id1"],
  "notes": "Special instructions",
  "summary": {
    "total_orders": 3,
    "total_line_items": 15,
    "total_quantity": 100,
    "total_weight": 2500
  },
  "orders": [ /* assigned orders */ ]
}
```

---

## Error Handling

All endpoints use consistent error response format:

```json
{
  "statusCode": 400,
  "httpStatus": "Bad Request",
  "message": "Descriptive error message",
  "timeStamp": "2024-01-01T12:00:00.000Z",
  "success": false
}
```

Common error codes:
- `400`: Bad Request (missing/invalid parameters)
- `404`: Not Found (plan/unit/order not found)
- `409`: Conflict (business rule violations)
- `500`: Server Error (database/system errors)

---

## Database Views and Functions

### Key Views
- `v_unassigned_orders`: Orders not assigned to any plan
- `v_plan_units_summary`: Aggregated unit data with capacity and assignments
- `v_unit_orders`: Orders assigned to specific units

### Key Functions
- `fn_loads_flat`: Returns flattened load data for hierarchical organization

---

## Business Rules Summary

1. **Route Assignment**: Maximum 2 vehicles per route
2. **Vehicle Routes**: Each vehicle serves only one route at a time
3. **Customer Limits**: Configurable max units per customer per day
4. **Capacity Management**: Respects vehicle/trailer weight limits
5. **Branch Isolation**: Orders assigned within same branch
6. **Date Validation**: Orders must fall within plan date range
7. **Assignment Exclusivity**: Orders can only be assigned to one plan at a time