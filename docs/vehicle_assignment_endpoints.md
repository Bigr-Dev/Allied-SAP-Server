# Vehicle Assignment API — Endpoints (updated)

## Auto Assign
**POST** `/api/auto-assign`
- Uses **RIGIDs** or **pre-linked HORSE↔TRAILER** only (trailer.assigned_to = horse.id).
- Never mutates `vehicles.assigned_to`.
- Enforces capacity + length + width, branch binding, and **≤2 trucks per customer/day**.

Body:
```json
{
  "date": "YYYY-MM-DD",
  "branch_id": "uuid?",
  "route_id": "uuid?",
  "route_name": "text?",
  "order_status": "planned|assigned|loaded|delivered|cancelled?",
  "capacityHeadroom": 0.1,
  "lengthBufferMm": 600,
  "widthBufferMm": 0,
  "maxLoadsPerVehicle": 6,
  "enforceSameBranch": true,
  "ignoreWidthIfMissing": true,
  "commit": false
}
```

## Manual Assign
**POST** `/api/loads/:id/assign-vehicle`  
Body (choose ONE path):
```json
{ "rigid_id": "uuid" }
```
or
```json
{ "horse_id": "uuid", "trailer_id": "uuid" }
```
Rules:
- Trailer **must already be linked** to the horse (`vehicles.assigned_to = horse.id`). If not, returns **409 Conflict**.
- The controller **does not** change the link.
- Validates branch match (if enabled), dimensions, capacity, and customer-cap.

## Unassign
**POST** `/api/loads/:id/unassign`
- Deletes assignment rows for the date, clears `loads.vehicle_id`.
- Sets vehicle status back to `available` **only** if the vehicle has **no other assignment rows for that date**.
- Does **not** change trailer↔horse links.

## Assignment Report by Date
**GET** `/api/vehicle-assignments?date=YYYY-MM-DD`

## Notes
- Multiple vehicles can be assigned to the **same route** (e.g., multiple loads across that route).
- To change trailer↔horse links, use your **fleet admin** tooling (outside of these endpoints).
