# Task: Introduce v2 Domain Architecture Structure (Backend)

You are helping to reorganise the **Allied SAP Server API** backend into a clearer domain architecture while **preserving all existing behaviour and API contracts**.

Recent refactors introduced service modules and cleanup:

- `src/services/planning-service.js`
- `src/services/loads-service.js`
- `src/services/fleet-service.js`
- `src/services/validation-service.js`
- `src/utils/result.js`

Cleanup summary and refactor summary have already been applied:

- See `REFACTOR_SUMMARY.md` and `server-cleanup-summary.md` for context.

We now want to **formalise domain boundaries** and **move services into domain folders**, and centralise validation rules.

---

## 🎯 Goals

1. Introduce a **domain-based folder structure** under `src/domain/**`.
2. Move existing service modules into their appropriate domain folders, updating imports.
3. Centralise shared validation / assignment rules into one shared module.
4. Keep **all routes, controllers, and behaviour unchanged** externally.

Do **NOT** change:

- Any `/api/**` paths or HTTP methods.
- Request / response shapes.
- DB schema.

---

## 1. Create Domain Structure

Create the following directories (if they don’t already exist):

```txt
src/domain/
  planning/
  loads/
  fleet/
  master-data/
  auth/

src/shared/
  validation/
  errors/
  result/
```
