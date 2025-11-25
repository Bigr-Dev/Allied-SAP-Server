/**
 * Validation Service - Centralizes shared constraints and validations
 */

/**
 * Parse capacity string into kg number
 * Examples: "10t" -> 10000, "8000" -> 8000, "8,000" -> 8000
 */
export function parseCapacityKg(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0

  const s = String(raw).trim().toLowerCase()
  if (!s) return 0

  // grab first numeric piece
  const match = s.match(/([\d.,]+)/)
  if (!match) return 0

  const numStr = match[1].replace(/,/g, '')
  const n = Number(numStr)
  if (!Number.isFinite(n)) return 0

  // simple unit handling
  if (s.includes('ton') || s.includes(' t')) return n * 1000
  if (s.includes('kg')) return n

  // default: assume kg
  return n
}

/**
 * Validate capacity constraints for vehicle assignment
 */
export function validateCapacityConstraints(orders, vehicleCapacityKg) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return { valid: true, totalWeight: 0, remainingCapacity: vehicleCapacityKg }
  }

  const totalWeight = orders.reduce((sum, order) => {
    return sum + (Number(order.total_weight) || 0)
  }, 0)

  const remainingCapacity = vehicleCapacityKg - totalWeight
  const valid = remainingCapacity >= 0

  return {
    valid,
    totalWeight,
    remainingCapacity,
    overweight: valid ? 0 : Math.abs(remainingCapacity)
  }
}

/**
 * Validate branch matching constraints
 */
export function validateBranchMatching(orders, vehicleBranchId, strictMode = true) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return { valid: true, conflicts: [] }
  }

  const conflicts = []
  
  for (const order of orders) {
    if (order.branch_id && String(order.branch_id) !== String(vehicleBranchId)) {
      conflicts.push({
        orderId: order.order_id || order.id,
        orderBranch: order.branch_id,
        vehicleBranch: vehicleBranchId,
        orderNumber: order.sales_order_number
      })
    }
  }

  return {
    valid: strictMode ? conflicts.length === 0 : true,
    conflicts,
    warningOnly: !strictMode && conflicts.length > 0
  }
}

/**
 * Validate customer/day limits (max units per customer per day)
 */
export function validateCustomerDayLimits(orders, maxUnitsPerCustomerPerDay = 2) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return { valid: true, violations: [] }
  }

  // Group orders by customer and delivery date
  const customerDayGroups = new Map()
  
  for (const order of orders) {
    const key = `${order.customer_id || 'unknown'}|${order.delivery_date || 'unknown'}`
    if (!customerDayGroups.has(key)) {
      customerDayGroups.set(key, {
        customerId: order.customer_id,
        customerName: order.customer_name,
        deliveryDate: order.delivery_date,
        orders: [],
        units: new Set()
      })
    }
    
    const group = customerDayGroups.get(key)
    group.orders.push(order)
    if (order.assigned_unit_id) {
      group.units.add(order.assigned_unit_id)
    }
  }

  const violations = []
  
  for (const [key, group] of customerDayGroups.entries()) {
    if (group.units.size > maxUnitsPerCustomerPerDay) {
      violations.push({
        customerId: group.customerId,
        customerName: group.customerName,
        deliveryDate: group.deliveryDate,
        unitsUsed: group.units.size,
        maxAllowed: maxUnitsPerCustomerPerDay,
        orderCount: group.orders.length
      })
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    maxUnitsPerCustomerPerDay
  }
}

/**
 * Validate route consistency (one route per vehicle)
 */
export function validateRouteConsistency(orders, allowMixedRoutes = false) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return { valid: true, routes: [], conflicts: [] }
  }

  const routes = new Set()
  const conflicts = []

  for (const order of orders) {
    if (order.route_id) {
      routes.add(order.route_id)
    }
  }

  if (!allowMixedRoutes && routes.size > 1) {
    const routeList = Array.from(routes)
    for (const order of orders) {
      if (order.route_id && routeList.indexOf(order.route_id) > 0) {
        conflicts.push({
          orderId: order.order_id || order.id,
          routeId: order.route_id,
          routeName: order.route_name,
          orderNumber: order.sales_order_number
        })
      }
    }
  }

  return {
    valid: allowMixedRoutes || routes.size <= 1,
    routes: Array.from(routes),
    conflicts,
    routeCount: routes.size
  }
}

/**
 * Validate delivery date constraints
 */
export function validateDeliveryDateConstraints(orders, planStartDate, planEndDate) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return { valid: true, violations: [] }
  }

  const violations = []

  for (const order of orders) {
    if (order.delivery_date) {
      const deliveryDate = order.delivery_date
      
      if (planStartDate && deliveryDate < planStartDate) {
        violations.push({
          orderId: order.order_id || order.id,
          orderNumber: order.sales_order_number,
          deliveryDate,
          planStartDate,
          violation: 'before_plan_start'
        })
      }
      
      if (planEndDate && deliveryDate > planEndDate) {
        violations.push({
          orderId: order.order_id || order.id,
          orderNumber: order.sales_order_number,
          deliveryDate,
          planEndDate,
          violation: 'after_plan_end'
        })
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations
  }
}

/**
 * Comprehensive validation for order assignment
 */
export function validateOrderAssignment(orders, vehicle, options = {}) {
  const {
    planStartDate,
    planEndDate,
    maxUnitsPerCustomerPerDay = 2,
    strictBranchMatching = true,
    allowMixedRoutes = false
  } = options

  const vehicleCapacityKg = parseCapacityKg(vehicle.capacity)
  
  const results = {
    capacity: validateCapacityConstraints(orders, vehicleCapacityKg),
    branchMatching: validateBranchMatching(orders, vehicle.branch_id, strictBranchMatching),
    customerLimits: validateCustomerDayLimits(orders, maxUnitsPerCustomerPerDay),
    routeConsistency: validateRouteConsistency(orders, allowMixedRoutes),
    deliveryDates: validateDeliveryDateConstraints(orders, planStartDate, planEndDate)
  }

  const allValid = Object.values(results).every(r => r.valid)
  const warnings = []
  const errors = []

  if (!results.capacity.valid) {
    errors.push(`Vehicle overweight by ${results.capacity.overweight}kg`)
  }

  if (!results.branchMatching.valid) {
    if (results.branchMatching.warningOnly) {
      warnings.push(`${results.branchMatching.conflicts.length} orders from different branches`)
    } else {
      errors.push(`Branch mismatch: ${results.branchMatching.conflicts.length} orders from different branches`)
    }
  }

  if (!results.customerLimits.valid) {
    errors.push(`Customer limit exceeded: ${results.customerLimits.violations.length} violations`)
  }

  if (!results.routeConsistency.valid) {
    errors.push(`Mixed routes: ${results.routeConsistency.routeCount} different routes`)
  }

  if (!results.deliveryDates.valid) {
    errors.push(`Date violations: ${results.deliveryDates.violations.length} orders outside plan window`)
  }

  return {
    valid: allValid,
    results,
    warnings,
    errors,
    summary: {
      totalOrders: orders.length,
      totalWeight: results.capacity.totalWeight,
      vehicleCapacity: vehicleCapacityKg,
      remainingCapacity: results.capacity.remainingCapacity
    }
  }
}