# Allied Loads API Guide

## What is a Load

A **Load** represents a single route on a specific delivery date.  
It contains multiple **Stops**, each stop contains multiple **Orders**, and each order contains **Order Lines**.

---

## Data Model

### loads

| Field          | Description                                         |
| -------------- | --------------------------------------------------- |
| id             | UUID for load                                       |
| route_id       | Related route UUID                                  |
| branch_id      | Related branch UUID                                 |
| delivery_date  | Date of delivery (YYYY-MM-DD)                       |
| status         | planned / assigned / loaded / delivered / cancelled |
| vehicle_id     | Assigned vehicle UUID                               |
| driver_id      | Assigned driver UUID                                |
| route_name     | Human-readable route name                           |
| total_quantity | Sum of all item quantities in the load              |
| total_weight   | Sum of all item weights in the load                 |

### load_stops

| Field             | Description            |
| ----------------- | ---------------------- |
| id                | UUID for stop          |
| load_id           | Parent load UUID       |
| route_id          | Route UUID             |
| suburb_name       | Suburb                 |
| city              | City                   |
| province          | Province               |
| postal_code       | Postal code            |
| position          | Order of stop on route |
| planned_arrival   | ETA                    |
| planned_departure | ETD                    |

### load_orders

| Field              | Description             |
| ------------------ | ----------------------- |
| id                 | UUID for load order     |
| load_id            | Parent load UUID        |
| load_stop_id       | Parent stop UUID        |
| sales_order_number | Sales order number      |
| customer_id        | Related customer UUID   |
| customer_name      | Customer name           |
| order_status       | Current status          |
| dispatch_remarks   | Notes for dispatch      |
| total_quantity     | Total quantity in order |
| total_weight       | Total weight in order   |

### load_items

| Field         | Description            |
| ------------- | ---------------------- |
| id            | UUID for item          |
| load_order_id | Parent load order UUID |
| order_line_id | Order line ID from SAP |
| description   | Product description    |
| quantity      | Quantity               |
| weight        | Weight                 |
| length        | Length                 |
| ur_prod       | Production reference   |

---

## How Loads Are Created

1. SAP sends/updates a sales order to `POST /api/sap/upsertSalesOrder/:SalesOrderNumber`
2. Order + lines are stored
3. Route is resolved:
   - Prefer `sales_order_route` from order
   - Else use customer’s saved route
4. Stop suburb is matched from `route_suburbs` by city/postal code
5. Create/reuse **Load** for `{route, delivery_date}`
6. Create/reuse **Stop** for that suburb in Load
7. Create/update **Load Order** + **Load Items**
8. Recalculate totals

---

## Status Flow

`planned → assigned → loaded → delivered`  
`cancelled` can occur anytime.

---

## Endpoints

### 1. Upsert Order

POST /api/sap/upsertSalesOrder/:SalesOrderNumber
Body: SAP order JSON.  
Effect: Creates/updates Load allocations.

### 2. List Loads

GET /api/loads
Query params:

- `date` (YYYY-MM-DD)
- `route_id` (UUID)
- `route_name` (string)
- `status` (planned/assigned/loaded/delivered/cancelled)
- `includeItems` (true/false)
- `page` (default 1)
- `limit` (default 50, max 200)

**Example**
GET /api/loads?date=2025-08-12&route_name=EAST%20RAND&includeItems=true

---

## Request Examples

### Create/Update Order

```bash
curl -X POST https://your-host/api/sap/upsertSalesOrder/SO-TEST-001 \
  -H "Content-Type: application/json" \
  -d '{
    "SalesPersonName": "Jane Nkosi",
    "SalesOrderNumber": "SO-TEST-001",
    "DocStatus": "Open",
    "CustomerName": "Kemsteel Supplies",
    "DocumentDueDate": "12082025",
    "SendToDispatch": "Y",
    "SalesOrderCity": "Kempton Park",
    "SalesOrderZipCode": "1619",
    "SalesOrderRoute": "EAST RAND 04",
    "OrderStatus": "Ready for Delivery",
    "DispatchRemarks": "Gate access code 4321",
    "OrderLines": [
      { "Id": "OL-T001-1", "Description": "Lip Channel 100mm", "Quantity": 10, "Weight": 250.0, "Length": "6m", "SendToProduction": "No" }
    ]
  }'
```

Behaviour Notes
Unrouted orders: saved but not on Load → fix route/suburb mapping.
Stop resolution: by best matching suburb in route_suburbs.
Idempotency: Reposting same SO updates existing load order/items.
Clean up: Closed orders removed from Load.

App Contract
Guaranteed fields:
Load: id, route_name, delivery_date, status, total_quantity, total_weight
Stop: id, suburb_name, city, position
Order: id, sales_order_number, customer_name, total_quantity, total_weight, dispatch_remarks
Item: order_line_id, description, quantity, weight, length (if requested)
