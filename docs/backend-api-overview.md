# Backend API Overview

This document provides a comprehensive overview of all backend API endpoints in the Allied SAP Server.

## Base URL

All API endpoints are prefixed with the server base URL. Client endpoints use `/api` and SAP integration endpoints use `/sap`.

## Authentication

### Client Authentication
- **Method**: Supabase JWT tokens
- **Header**: `Authorization: Bearer {access_token}`
- **Tokens obtained via**: `/api/login` endpoint
- **Token refresh via**: `/api/refresh` endpoint

### SAP Authentication
- **Method**: Custom JWT tokens
- **Header**: `Authorization: Bearer {sap_jwt_token}`
- **Tokens obtained via**: `/sap/login` endpoint

## Standard Response Format

All API responses follow a consistent format:

```json
{
  "timeStamp": "2024-01-01T12:00:00.000Z",
  "statusCode": 200,
  "httpStatus": "OK",
  "message": "Success message",
  "data": {},
  "success": true
}
```

## Error Handling

Error responses use the same format with appropriate status codes:
- **200**: Success
- **201**: Created
- **400**: Bad Request (validation errors)
- **401**: Unauthorized (authentication required)
- **404**: Not Found (resource doesn't exist)
- **409**: Conflict (duplicate resource)
- **500**: Internal Server Error

---

## Authentication Endpoints

### POST /api/login
**Description**: Authenticate user with email/password or username/password (legacy)

**Authentication**: Not required

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "string"
}
```

**Success Response (200)**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": 1640995200,
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

### POST /api/refresh
**Description**: Refresh access token using refresh token

**Authentication**: Not required

**Request Body**:
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### POST /api/logout
**Description**: Logout user and revoke session

**Authentication**: Not required

**Request Body**:
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "global": false
}
```

---

## Branch Management

### GET /api/branches
**Description**: Get all branches with user and vehicle counts

**Authentication**: Required

**Success Response (200)**:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Main Branch",
      "address": "123 Main St",
      "phone": "+1234567890",
      "email": "branch@company.com",
      "user_count": 5,
      "vehicle_count": 10,
      "created_at": "2024-01-01T12:00:00.000Z",
      "updated_at": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

### GET /api/branches/:id
**Description**: Get branch by ID

**Authentication**: Required

**Path Parameters**:
- `id` (string): Branch UUID

### POST /api/branches
**Description**: Create new branch

**Authentication**: Required

**Request Body**:
```json
{
  "name": "New Branch",
  "address": "456 Oak Ave",
  "phone": "+1987654321",
  "email": "newbranch@company.com"
}
```

### PUT /api/branches/:id
**Description**: Update branch by ID

**Authentication**: Required

### DELETE /api/branches/:id
**Description**: Delete branch by ID (only if no linked records)

**Authentication**: Required

---

## User Management

### GET /api/users
**Description**: Get all users

**Authentication**: Required

### GET /api/users/:id
**Description**: Get user by ID

**Authentication**: Required

### POST /api/users
**Description**: Create new user

**Authentication**: Required

**Request Body**:
```json
{
  "email": "newuser@company.com",
  "name": "Jane Smith",
  "role": "user",
  "branch_id": "uuid",
  "password": "securepassword"
}
```

### PUT /api/users/:id
**Description**: Update user by ID

**Authentication**: Required

### DELETE /api/users/:id
**Description**: Delete user by ID

**Authentication**: Required

---

## Customer Management

### GET /api/customers
**Description**: Get all customers

**Authentication**: Not required

### GET /api/customers/:id
**Description**: Get customer by ID

**Authentication**: Not required

### POST /api/customers
**Description**: Create new customer

**Authentication**: Not required

**Request Body**:
```json
{
  "name": "New Company",
  "bp_code": "BP002",
  "address": "456 Commerce Ave",
  "phone": "+1987654321",
  "email": "info@newcompany.com",
  "row_number": 1
}
```

### PUT /api/customers/:id
**Description**: Update customer by ID

**Authentication**: Not required

### DELETE /api/customers/:id
**Description**: Delete customer by ID

**Authentication**: Not required

---

## Driver Management

### GET /api/drivers
**Description**: Get all drivers with branch information

**Authentication**: Required

**Success Response (200)**:
```json
[
  {
    "id": "uuid",
    "branch_id": "uuid",
    "branch_name": "Main Branch",
    "name": "John",
    "last_name": "Driver",
    "phone": "+1234567890",
    "email": "john@company.com",
    "license": "DL123456",
    "license_code": "C1",
    "status": "active",
    "created_at": "2024-01-01T12:00:00.000Z"
  }
]
```

### GET /api/drivers/:id
**Description**: Get driver by ID

**Authentication**: Required

### POST /api/drivers
**Description**: Create new driver

**Authentication**: Required

**Request Body**:
```json
{
  "branch_id": "uuid",
  "name": "Jane",
  "last_name": "Driver",
  "phone": "+1987654321",
  "email": "jane@company.com",
  "license": "DL789012",
  "license_code": "C1",
  "status": "active"
}
```

### PUT /api/drivers/:id
**Description**: Update driver by ID

**Authentication**: Required

### DELETE /api/drivers/:id
**Description**: Delete driver by ID

**Authentication**: Required

---

## Vehicle Management

### GET /api/vehicles
**Description**: Get all vehicles with branch information

**Authentication**: Required

**Success Response (200)**:
```json
[
  {
    "id": "uuid",
    "type": "rigid",
    "reg_number": "ABC123",
    "license_plate": "XYZ789",
    "model": "Truck Model",
    "capacity": "10000kg",
    "status": "active",
    "branch_id": "uuid",
    "branch_name": "Main Branch",
    "fleet_number": "FL001",
    "created_at": "2024-01-01T12:00:00.000Z"
  }
]
```

### GET /api/vehicles/:id
**Description**: Get vehicle by ID

**Authentication**: Required

### POST /api/vehicles
**Description**: Create new vehicle

**Authentication**: Required

**Request Body**:
```json
{
  "type": "rigid",
  "reg_number": "DEF456",
  "license_plate": "UVW012",
  "model": "New Truck Model",
  "capacity": "15000kg",
  "status": "active",
  "branch_id": "uuid",
  "fleet_number": "FL002"
}
```

### PUT /api/vehicles/:id
**Description**: Update vehicle by ID

**Authentication**: Required

### DELETE /api/vehicles/:id
**Description**: Delete vehicle by ID

**Authentication**: Required

---

## Route Management

### GET /api/routes
**Description**: Get all delivery routes

**Authentication**: Required

**Success Response (200)**:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Route A",
      "description": "Main city route",
      "branch_id": "uuid",
      "created_at": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

### GET /api/routes/:id
**Description**: Get route by ID

**Authentication**: Required

### POST /api/routes
**Description**: Create new route

**Authentication**: Required

**Request Body**:
```json
{
  "name": "New Route",
  "description": "Industrial area route",
  "branch_id": "uuid"
}
```

### PUT /api/routes/:id
**Description**: Update route by ID

**Authentication**: Required

### DELETE /api/routes/:id
**Description**: Delete route by ID

**Authentication**: Required

---

## Load Management

### GET /api/loads
**Description**: Get loads organized by branch, route, suburb, and customer

**Authentication**: Required

**Query Parameters**:
- `date` (string, optional): Filter by delivery date (YYYY-MM-DD)
- `from` (string, optional): Start date range (YYYY-MM-DD)
- `to` (string, optional): End date range (YYYY-MM-DD)
- `branch_id` (string, optional): Filter by branch ID
- `route_id` (string, optional): Filter by route ID
- `customer_name` (string, optional): Filter by customer name

**Success Response (200)**:
```json
{
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
                "suburb_name": "Downtown",
                "address": "City Center",
                "customers": [
                  {
                    "customer_id": "uuid",
                    "customer_name": "ABC Company",
                    "orders": [
                      {
                        "order_id": "uuid",
                        "sales_order_number": "SO123456",
                        "delivery_date": "2024-01-15",
                        "totals": {
                          "items": 5,
                          "quantity": 100,
                          "weight": 500.5
                        },
                        "status": "open",
                        "assignment_plan_id": null,
                        "assigned_unit_id": null,
                        "is_split": false,
                        "order_lines": [
                          {
                            "order_line_id": "line_id",
                            "description": "Product A",
                            "quantity": 20,
                            "weight": 100.1,
                            "assignment": "unassigned"
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

---

## SAP Orders

### GET /api/orders
**Description**: Get sales orders with nested order lines

**Authentication**: Required

**Success Response (200)**:
```json
{
  "data": [
    {
      "id": "uuid",
      "sales_order_number": "SO123456",
      "customer_name": "ABC Company",
      "delivery_date": "2024-01-15",
      "status": "open",
      "order_lines": [
        {
          "id": "line_id",
          "description": "Product A",
          "quantity": 10,
          "weight": 100.5,
          "length": "2.5m"
        }
      ]
    }
  ]
}
```

---

## Assignment Planner

### GET /api/plans
**Description**: Get all assignment plans with optional detailed information

**Authentication**: Required

**Query Parameters**:
- `limit` (number, optional): Number of plans to return (default: 50)
- `offset` (number, optional): Number of plans to skip (default: 0)
- `order` (string, optional): Sort order 'asc' or 'desc' (default: 'desc')
- `date_from` (string, optional): Filter by delivery start date (YYYY-MM-DD)
- `date_to` (string, optional): Filter by delivery end date (YYYY-MM-DD)
- `include_units` (string, optional): Include unit IDs ('true'/'false')
- `include_counts` (string, optional): Include summary counts ('true'/'false')
- `include_unassigned` (string, optional): Include unassigned order count ('true'/'false')

**Success Response (200)**:
```json
{
  "data": {
    "total": 10,
    "limit": 50,
    "offset": 0,
    "plans": [
      {
        "id": "uuid",
        "plan_name": "Weekly Plan Jan 15-21",
        "delivery_start": "2024-01-15",
        "delivery_end": "2024-01-21",
        "scope_all_branches": true,
        "status": "planning",
        "notes": "Initial planning phase",
        "created_at": "2024-01-01T12:00:00.000Z",
        "updated_at": "2024-01-01T12:00:00.000Z",
        "plan_unit_ids": ["unit1", "unit2"],
        "summary": {
          "units_count": 5,
          "orders_count": 25,
          "total_weight": 2500.5
        },
        "unassigned_count": 3
      }
    ]
  }
}
```

### GET /api/plans/:plan_id
**Description**: Get detailed plan information including units, orders, and assignments

**Authentication**: Required

**Path Parameters**:
- `plan_id` (string): Plan UUID

**Success Response (200)**:
```json
{
  "data": {
    "plan": {
      "id": "uuid",
      "plan_name": "Weekly Plan Jan 15-21",
      "delivery_start": "2024-01-15",
      "delivery_end": "2024-01-21",
      "scope_all_branches": true,
      "status": "planning",
      "notes": "Initial planning phase"
    },
    "units": [
      {
        "planned_unit_id": "uuid",
        "plan_id": "uuid",
        "vehicle_assignment_id": "uuid",
        "vehicle_id": "uuid",
        "vehicle_type": "rigid",
        "driver_id": "uuid",
        "branch_id": "uuid",
        "vehicle": {
          "id": "uuid",
          "reg_number": "ABC123",
          "capacity": "10000kg"
        },
        "driver": {
          "id": "uuid",
          "name": "John Driver"
        },
        "status": "active",
        "notes": null,
        "summary": {
          "orders_assigned": 3,
          "total_weight": 750.5
        },
        "orders": []
      }
    ],
    "unassigned_orders": [],
    "unassigned_units": [],
    "assigned_orders": [],
    "unused_units": []
  }
}
```

### POST /api/plans/add-plan
**Description**: Create new assignment plan

**Authentication**: Required

**Request Body**:
```json
{
  "plan_name": "New Weekly Plan",
  "delivery_start": "2024-01-22",
  "delivery_end": "2024-01-28",
  "scope_all_branches": true,
  "notes": "Planning for next week",
  "status": "planning"
}
```

**Success Response (201)**:
```json
{
  "statusCode": 201,
  "message": "Plan created",
  "data": {
    "plan": {
      "id": "uuid",
      "plan_name": "New Weekly Plan",
      "delivery_start": "2024-01-22",
      "delivery_end": "2024-01-28"
    },
    "units": [],
    "unassigned_orders": [],
    "unassigned_units": [],
    "assigned_orders": []
  }
}
```

### POST /api/plans/:plan_id/units
**Description**: Add idle unit to plan

**Authentication**: Required

**Path Parameters**:
- `plan_id` (string): Plan UUID

**Request Body**:
```json
{
  "vehicle_assignment_id": "uuid"
}
```

### POST /api/plans/:planId/bulk-assign
**Description**: Bulk assign orders to units in a plan

**Authentication**: Required

**Path Parameters**:
- `planId` (string): Plan UUID

**Request Body**:
```json
{
  "plan_id": "uuid",
  "assignments": [
    {
      "planned_unit_id": "uuid",
      "orders": [
        {
          "order_id": "uuid",
          "stop_sequence": 1
        },
        {
          "order_id": "uuid",
          "stop_sequence": 2
        }
      ]
    }
  ]
}
```

### POST /api/plans/:planId/unassign
**Description**: Unassign orders from units

**Authentication**: Required

**Path Parameters**:
- `planId` (string): Plan UUID

**Request Body**:
```json
{
  "order_ids": ["uuid1", "uuid2"]
}
```

### POST /api/plans/auto-assign
**Description**: Auto-assign orders to units using optimization algorithm

**Authentication**: Required

**Request Body**:
```json
{
  "plan_id": "uuid",
  "branch_id": "uuid",
  "commit": false,
  "max_units_per_customer_per_day": 2
}
```

**Business Rules**:
1. **Route Constraint**: Max 2 vehicles per route
2. **Vehicle Route Constraint**: 1 route per vehicle (no mixing)
3. **Customer Constraint**: Max N units per customer per day (default: 2)
4. **Capacity Constraint**: Respects vehicle/trailer weight limits
5. **Branch Matching**: Orders assigned to vehicles from same branch

### DELETE /api/plans/:planId
**Description**: Delete assignment plan

**Authentication**: Required

**Path Parameters**:
- `planId` (string): Plan UUID

### POST /api/plans/units/note
**Description**: Set note for planned unit

**Authentication**: Required

**Request Body**:
```json
{
  "planned_unit_id": "uuid",
  "notes": "Unit requires maintenance check"
}
```

### POST /api/plans/units/remove
**Description**: Remove planned unit from plan

**Authentication**: Required

**Request Body**:
```json
{
  "planned_unit_id": "uuid"
}
```

---

## SAP Integration

### POST /sap/login
**Description**: Authenticate SAP system for data integration

**Authentication**: Not required

**Request Body**:
```json
{
  "username": "sap_user",
  "password": "sap_password"
}
```

**Success Response (200)**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### POST /sap/orders
**Description**: Upsert sales order from SAP system

**Authentication**: Required (SAP JWT token)

**Headers**:
- `Authorization`: Bearer {sap_jwt_token}

**Request Body**:
```json
{
  "SalesOrderNumber": "SO123456",
  "DocStatus": "O",
  "SendToDispatch": "Y",
  "sendToPlanning": "Y",
  "CustomerName": "ABC Company",
  "DeliveryDate": "2024-01-15",
  "OrderLines": [
    {
      "id": "line_id_1",
      "description": "Product A",
      "quantity": 10,
      "weight": 100.5,
      "length": "2.5m",
      "urProd": "A",
      "sendToProduction": "Y"
    }
  ]
}
```

**Success Response (200)**:
```json
{
  "statusCode": 200,
  "message": "Order SO123456 saved",
  "success": true
}
```

---

## Data Models

### Plan Object
```json
{
  "id": "uuid",
  "plan_name": "Weekly Plan",
  "delivery_start": "2024-01-01",
  "delivery_end": "2024-01-07",
  "scope_all_branches": true,
  "status": "planning",
  "notes": "Special instructions",
  "created_at": "2024-01-01T12:00:00.000Z",
  "updated_at": "2024-01-01T12:00:00.000Z"
}
```

### Planned Unit Object
```json
{
  "planned_unit_id": "uuid",
  "plan_id": "uuid",
  "vehicle_assignment_id": "uuid",
  "vehicle_id": "uuid",
  "vehicle_type": "rigid",
  "driver_id": "uuid",
  "branch_id": "uuid",
  "vehicle": {
    "id": "uuid",
    "reg_number": "ABC123",
    "capacity": "10000kg"
  },
  "driver": {
    "id": "uuid",
    "name": "John Driver"
  },
  "trailer": null,
  "status": "active",
  "notes": "Special instructions",
  "capacity_kg": 10000,
  "routes_served": ["Route A"],
  "summary": {
    "total_orders": 3,
    "total_items": 15,
    "total_quantity": 100,
    "total_weight": 2500
  },
  "orders": []
}
```

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
  "customer_id": "uuid",
  "customer_name": "Customer ABC",
  "total_line_items": 5,
  "total_quantity": 100,
  "total_weight": 2500,
  "status": "confirmed",
  "assignment_plan_id": "uuid",
  "assigned_unit_id": "uuid",
  "is_split": false,
  "lines": []
}
```

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