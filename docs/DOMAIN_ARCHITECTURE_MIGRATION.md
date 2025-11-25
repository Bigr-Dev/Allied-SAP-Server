<!-- # Domain Architecture Migration Guide

This document outlines the migration from the previous service-based structure to the new domain-based architecture.

## 🎯 Overview

The Allied SAP Server API has been reorganized into a cleaner domain architecture while preserving all existing behavior and API contracts.

## 📁 New Structure

```
src/
├── domain/                    # Domain-specific business logic
│   ├── planning/             # Planning domain
│   │   ├── planning-service.js
│   │   └── index.js
│   ├── loads/                # Loads/Orders domain
│   │   ├── loads-service.js
│   │   └── index.js
│   ├── fleet/                # Fleet management domain
│   │   ├── fleet-service.js
│   │   └── index.js
│   ├── master-data/          # Master data domain (placeholder)
│   │   └── index.js
│   ├── auth/                 # Authentication domain (placeholder)
│   │   └── index.js
│   └── index.js              # Centralized domain exports
├── shared/                   # Shared utilities across domains
│   ├── validation/           # Validation utilities
│   │   ├── validation-service.js
│   │   └── index.js
│   ├── result/               # Result pattern utilities
│   │   ├── result.js
│   │   └── index.js
│   ├── errors/               # Error handling (placeholder)
│   │   └── index.js
│   └── index.js              # Centralized shared exports
```

## 🔄 Migration Paths

### Services → Domains

| Old Path | New Path | Domain |
|----------|----------|---------|
| `src/services/planning-service.js` | `src/domain/planning/planning-service.js` | Planning |
| `src/services/loads-service.js` | `src/domain/loads/loads-service.js` | Loads |
| `src/services/fleet-service.js` | `src/domain/fleet/fleet-service.js` | Fleet |
| `src/services/validation-service.js` | `src/shared/validation/validation-service.js` | Shared |
| `src/utils/result.js` | `src/shared/result/result.js` | Shared |

### Import Updates

#### Planning Service
```javascript
// OLD
import * as planningService from '../services/planning-service.js'

// NEW
import * as planningService from '../domain/planning/index.js'
// OR use centralized domain exports
import { Planning } from '../domain/index.js'
```

#### Loads Service
```javascript
// OLD
import * as loadsService from '../services/loads-service.js'

// NEW
import * as loadsService from '../domain/loads/index.js'
// OR use centralized domain exports
import { Loads } from '../domain/index.js'
```

#### Fleet Service
```javascript
// OLD
import * as fleetService from '../services/fleet-service.js'

// NEW
import * as fleetService from '../domain/fleet/index.js'
// OR use centralized domain exports
import { Fleet } from '../domain/index.js'
```

#### Validation Service
```javascript
// OLD
import * as validationService from '../services/validation-service.js'

// NEW
import * as validationService from '../shared/validation/index.js'
// OR use centralized shared exports
import { Validation } from '../shared/index.js'
```

#### Result Utilities
```javascript
// OLD
import { Result, handleServiceResult } from '../utils/result.js'

// NEW
import { Result, handleServiceResult } from '../shared/result/index.js'
// OR use centralized shared exports
import { Result } from '../shared/index.js'
```

## ✅ Completed Migrations

The following files have been updated to use the new domain structure:

### Controllers
- ✅ `src/controllers/assignment-planner-controllers/add-idle-unit.js`
- ✅ `src/controllers/assignment-planner-controllers/add-plan.js`
- ✅ `src/controllers/assignment-planner-controllers/auto-assign-plan.js`
- ✅ `src/controllers/assignment-planner-controllers/bulk-assign.js`
- ✅ `src/controllers/assignment-planner-controllers/delete-plan.js`
- ✅ `src/controllers/assignment-planner-controllers/get-plan.js`
- ✅ `src/controllers/assignment-planner-controllers/get-plans.js`
- ✅ `src/controllers/assignment-planner-controllers/remove-planned-unit.js`
- ✅ `src/controllers/assignment-planner-controllers/set-unit-note.js`
- ✅ `src/controllers/assignment-planner-controllers/unassign-unit.js`

## 🔄 Backward Compatibility

To ensure a smooth transition, backward compatibility wrappers have been created:

- `src/services/planning-service.js` → Re-exports from `src/domain/planning/`
- `src/services/loads-service.js` → Re-exports from `src/domain/loads/`
- `src/services/fleet-service.js` → Re-exports from `src/domain/fleet/`
- `src/services/validation-service.js` → Re-exports from `src/shared/validation/`
- `src/utils/result.js` → Re-exports from `src/shared/result/`

These wrappers include deprecation notices and should be updated to use the new paths.

## 🚀 Benefits

1. **Clear Domain Boundaries**: Business logic is organized by domain responsibility
2. **Shared Utilities**: Common functionality is centralized in the shared layer
3. **Scalability**: Easy to add new domains and services
4. **Maintainability**: Clear separation of concerns
5. **Testability**: Domain services can be tested in isolation

## 📋 Next Steps

1. **Future Services**: New services should be added to appropriate domain folders
2. **Master Data Domain**: Implement customer, branch, route, and product services
3. **Auth Domain**: Implement authentication and authorization services
4. **Error Handling**: Implement centralized error handling in `src/shared/errors/`
5. **Remove Deprecated Files**: After full migration, remove backward compatibility wrappers

## 🔍 Validation

All existing API endpoints and behavior remain unchanged. The migration only affects internal code organization.

- ✅ All `/api/**` paths unchanged
- ✅ Request/response shapes unchanged
- ✅ Database schema unchanged
- ✅ Business logic preserved -->

# Task: Implement `autoAssignPlan` in `src/domain/planning/planning-service.js`

You have already migrated the Allied SAP Server API to a domain-based architecture and created:

- `src/domain/planning/planning-service.js`
- `src/shared/validation/validation-service.js` (capacity, branch, customer/day limits, etc.)
- Controllers under `src/controllers/assignment-planner-controllers/**` now call the planning service.

According to `REFACTOR_SUMMARY.md`, `autoAssignPlan(options)` in `planning-service.js` is currently a **placeholder** and does not implement the real auto-assignment algorithm.

According to the API documentation (`docs/backend-api-overview.md` and the older `docs/assignment-planner-and-loads-api.md`), the `/api/plans/auto-assign` endpoint must:

1. Fetch the plan and validate it exists.
2. Get unassigned orders from `v_unassigned_orders` for that plan.
3. Get already assigned orders for capacity calculations.
4. Get planned units for the plan.
5. Get vehicle assignments and related vehicle/driver/trailer data.
6. Build current state per unit (used capacity, routes served, customer/day counts).
7. Sort unassigned orders by route → delivery_date → weight (heaviest first).
8. For each order, select the best-fit unit based on:
   - Capacity (weight headroom, parsing via `validation-service.parseCapacityKg()` or consolidated capacity utilities)
   - Length/width and any dimension rules (if available)
   - Branch matching rules
   - Customer/day limits (`validateCustomerDayLimits`, etc.)
9. When no suitable existing unit is found, optionally auto-create a new planned unit from available vehicle assignments.
10. Support both:
    - **Preview mode**: compute assignments in memory and return the resulting structure without committing to DB.
    - **Commit mode**: persist assignments and new planned units to the database.

The endpoint contract `/api/plans/auto-assign` is documented in `docs/backend-api-overview.md` and `docs/client-api-endpoints.md` and must remain unchanged:

- Same path, method, request body, and response structure.
- Response includes:
  - `plan`
  - `units` with summary fields and orders
  - `assigned_orders`
  - `unassigned_orders`
  - `unassigned_units`
  - `meta` including `committed` flag and counts.

## Requirements

1. Implement `autoAssignPlan(options)` inside `src/domain/planning/planning-service.js` using the algorithm described above and any existing legacy implementation found in `old-code/` as a reference.
2. Reuse centralized validation logic from `src/shared/validation/validation-service.js` (or `shared/validation/assignment-rules.js` if present) instead of duplicating capacity/branch/customer limit logic.
3. Preserve existing behaviour as documented:
   - If there was a previous implementation in `old-code/auto-assign-plan.cleaned.js` or similar, match that behaviour as closely as possible.
4. Do NOT change:
   - `/api/plans/auto-assign` path or method.
   - Request/response payloads.
   - Database schema.

## Deliverables

- A fully implemented `autoAssignPlan(options)` function in `src/domain/planning/planning-service.js`.
- Any necessary helper functions local to the planning domain (e.g., to build plan state, select best unit).
- Optional: small, well-named helper functions within the planning domain to keep `autoAssignPlan` readable.
- No changes to public API contracts.
