# Task: Codebase Cleanup, Dead Code Removal, Deduplication & Docs Consolidation

You are helping me **clean up the backend/server codebase** and **consolidate documentation**, WITHOUT changing any external API contracts.

The repository is a Node/Express-style server with controllers like:

- `src/controllers/client-auth-controller.js`
- `src/controllers/branch-controller.js`
- `src/controllers/user-controller.js`
- `src/controllers/customer-controller.js`
- `src/controllers/drivers-controller.js`
- `src/controllers/vehicles-controller.js`
- `src/controllers/routes-controller.js`
- `src/controllers/loads-controller.js`
- `src/controllers/assignment-planner-controllers/**`
- `src/controllers/vehicle-assignment-controllers/**` (e.g. auto-assign, manual assign, unassign)

Docs currently include multiple backend-related `.md` files such as:

- `assignment-planner-and-loads-api.md`
- `client-api-endpoints.md`
- `vehicle_assignment_endpoints.md`
- (and any other server API docs you find in the repo)

---

## 🎯 Overall Goal

1. **Remove dead/unused code** (files, functions, utils, helpers, middleware, etc.).
2. **Deduplicate logic** and keep the **most robust and efficient implementation**, updating references to reuse it.
3. **Consolidate server API docs** into a **single, up-to-date MD + TXT pair**, and remove superseded docs.

External API behaviour **must not change**:

- No route path changes.
- No HTTP method changes.
- No breaking changes to request/response shapes.

---

## 1. Scan the Entire Server for Unused Code

Do a **thorough static analysis** of the backend code to identify:

- Unused **files** (never imported / required anywhere).
- Unused **exports** within files (functions/classes/constants that are never imported).
- Unused **utilities/helpers** (e.g. in `src/lib`, `src/utils`, `src/services`, `src/helpers`).
- Unused **middleware**, **validators**, or **schemas**.

### Requirements

1. Look at:
   - ES modules (`import`/`export`).
   - CommonJS modules (`require`/`module.exports`).
2. Consider:
   - Route registrations / router mounting.
   - Any script entrypoints or CLI tools that might import modules (e.g. `scripts/**`).
3. If a module or function **might** be used dynamically (e.g. via `require(path)` with computed paths, or by external tooling):
   - Do **NOT** delete it automatically.
   - Instead, add a **code comment** at the top of the file like:
     ```js
     // NOTE: Candidate for cleanup: no direct static references found. Verify before removal.
     ```
4. For **clearly unused** items (no static references, no known dynamic usage), remove them.

### Output

- Produce a short Markdown report: `docs/server-cleanup-summary.md` containing:
  - A list of deleted files.
  - A list of deleted or inlined functions/utilities.
  - A list of “suspected unused but kept” files with the note above.

---

## 2. Find and Resolve Duplicate or Overlapping Code

Identify **duplicate or near-duplicate code** across the backend, especially in:

- Utility modules (`src/utils/**`, `src/lib/**`).
- Assignment/planning logic (capacity checks, branch checks, customer/day caps, etc.).
- Validation or formatting helpers.
- Any repeated logic between:
  - Assignment Planner endpoints under `/api/plans/**`.
  - Vehicle Assignment endpoints such as `/api/auto-assign`, `/api/loads/:id/assign-vehicle`, `/api/loads/:id/unassign`.

### Requirements

1. For each duplicated functionality (e.g. capacity checks, branch matching, customer/day caps):
   - Compare implementations.
   - Keep the version that is:
     - **Most correct** (handles more cases/edge cases).
     - **Most used** (or sits in the most central/appropriate module).
     - **Most efficient and readable**.
2. Extract the chosen implementation into a **single shared helper** (if not already centralised), for example:
   - `src/services/assignment-rules.js`
   - or another appropriate shared module if one already exists.
3. Refactor all call sites to use that shared implementation.
4. Remove the redundant versions.

### Constraints

- Behaviour must stay the same for all endpoints as per existing docs.
- If two versions behave differently and you are unsure which is “correct,”:
  - Prefer the behaviour that matches the **documented API** and/or **most critical path** (e.g. the main planner auto-assign).
  - Add a `TODO` comment noting that the older variant was removed/merged.

---

## 3. Consolidate Backend Docs into a Single Source of Truth

Currently, there are multiple Markdown docs that describe overlapping parts of the backend API, including:

- `assignment-planner-and-loads-api.md`
- `client-api-endpoints.md`
- `vehicle_assignment_endpoints.md`
- Possibly others related to server endpoints.

### Goal

Create **one single, consolidated, up-to-date documentation pair** for the backend API:

1. `docs/backend-api-overview.md`
2. `docs/backend-api-overview.txt`

Both files should describe the **same content** (Markdown vs plain text).

### What to Do

1. **Ignore outdated doc structures** and instead:
   - Scan the **actual codebase** (controllers, routes, middleware) to detect all client-facing server endpoints.
   - Generate a fresh, accurate description of:
     - Each endpoint (method + path).
     - Purpose / description.
     - Inputs (path params, query params, headers, request body).
     - Outputs (status codes, response body shape, error cases).
     - Auth requirements.
2. Compile this into a structured Markdown file:

   **`docs/backend-api-overview.md`**

   Suggested structure:

   ```md
   # Backend API Overview

   ## Authentication

   ### POST /api/login

   ...

   ## Branches

   ### GET /api/branches

   ...

   ## Users

   ...

   ## Customers

   ...

   ## Drivers

   ...

   ## Vehicles

   ...

   ## Routes

   ...

   ## Loads & Orders

   ...

   ## Assignment Planner

   ...

   ## Vehicle Assignment

   ...
   ```
