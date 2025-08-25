import database from '../config/supabase.js'
import { Response } from '../utils/classes.js'
import { buildLogFromReqRes, logApiEvent } from '../utils/db-logger.js'

// Import compatibility matrix
import { compatibilityMatrix } from '../utils/compatibilityMatrix.js'

/**
 * Extract prefix from item description (text before first space)
 * @param {string} description - Item description
 * @returns {string} - Extracted prefix
 */
function extractPrefix(description) {
  if (!description || typeof description !== 'string') return ''
  const trimmed = description.trim()
  const spaceIndex = trimmed.indexOf(' ')
  return spaceIndex > 0 ? trimmed.substring(0, spaceIndex).toUpperCase() : trimmed.toUpperCase()
}

/**
 * Check if two item types are compatible using the compatibility matrix
 * @param {string} typeA - First item type
 * @param {string} typeB - Second item type
 * @returns {boolean} - True if compatible
 */
function areCompatible(typeA, typeB) {
  if (!typeA || !typeB) return false
  if (typeA === typeB) return true
  
  // Both items must be compatible with each other
  // Check if typeA is compatible with typeB AND typeB is compatible with typeA
  const aCompatibleWithB = compatibilityMatrix[typeA]?.[typeB] ?? false
  const bCompatibleWithA = compatibilityMatrix[typeB]?.[typeA] ?? false
  
  return aCompatibleWithB && bCompatibleWithA
}

/**
 * Group load items by prefix and apply compatibility filtering
 * @param {Array} loadItems - Array of load items
 * @returns {Object} - Grouped and filtered items by prefix
 */
function groupItemsByPrefix(loadItems) {
  const groups = {}
  
  // First pass: group all items by prefix
  loadItems.forEach(item => {
    const prefix = extractPrefix(item.description)
    if (!prefix) return
    
    if (!groups[prefix]) {
      groups[prefix] = {
        prefix,
        items: [],
        totalQuantity: 0,
        totalWeight: 0
      }
    }
    
    // Store the full item with all context
    groups[prefix].items.push(item)
    groups[prefix].totalQuantity += Number(item.quantity) || 0
    groups[prefix].totalWeight += Number(item.weight) || 0
  })
  
  // Second pass: create compatibility groups
  const compatibilityGroups = []
  const processedPrefixes = new Set()
  const processedItems = new Set() // Track processed items to avoid duplicates
  
  Object.values(groups).forEach(group => {
    if (processedPrefixes.has(group.prefix)) return
    
    const compatibleGroup = {
      prefixes: [group.prefix],
      items: [...group.items],
      totalQuantity: group.totalQuantity,
      totalWeight: group.totalWeight,
      compatibleTypes: [group.prefix]
    }
    
    // Mark all items in this group as processed
    group.items.forEach(item => processedItems.add(item))
    processedPrefixes.add(group.prefix)
    
    // Find other compatible prefixes
    Object.values(groups).forEach(otherGroup => {
      if (otherGroup.prefix === group.prefix || processedPrefixes.has(otherGroup.prefix)) return
      
      // Check if all items in this group are compatible with the current group
      const isCompatible = otherGroup.items.every(item => {
        const otherPrefix = extractPrefix(item.description)
        return areCompatible(group.prefix, otherPrefix)
      })
      
      if (isCompatible) {
        // Only add items that haven't been processed yet
        const unprocessedItems = otherGroup.items.filter(item => !processedItems.has(item))
        
        if (unprocessedItems.length > 0) {
          // Check if each unprocessed item is compatible with ALL items already in the group
          const compatibleItems = unprocessedItems.filter(newItem => {
            const newItemPrefix = extractPrefix(newItem.description)
            
            // Check if this new item is compatible with ALL existing items in the group
            return compatibleGroup.items.every(existingItem => {
              const existingItemPrefix = extractPrefix(existingItem.description)
              return areCompatible(newItemPrefix, existingItemPrefix)
            })
          })
          
          if (compatibleItems.length > 0) {
            compatibleGroup.prefixes.push(otherGroup.prefix)
            compatibleGroup.items.push(...compatibleItems)
            compatibleGroup.totalQuantity += compatibleItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
            compatibleGroup.totalWeight += compatibleItems.reduce((sum, item) => sum + (Number(item.weight) || 0), 0)
            compatibleGroup.compatibleTypes.push(otherGroup.prefix)
            
            // Mark these items as processed
            compatibleItems.forEach(item => processedItems.add(item))
          }
        }
        
        processedPrefixes.add(otherGroup.prefix)
      }
    })
    
    compatibilityGroups.push(compatibleGroup)
  })
  
  return compatibilityGroups
}

/**
 * Process suburbs data and group items by compatibility
 * @param {Array} suburbs - Array of suburb objects with load_orders
 * @returns {Object} - Processed suburbs with grouped items
 */
function processSuburbsData(suburbs) {
  if (!Array.isArray(suburbs)) return []
  
  return suburbs.map(suburb => {
    // Extract all load items from all orders in this suburb with full order context
    const allLoadItemsWithContext = []
    
    if (Array.isArray(suburb.load_orders)) {
      suburb.load_orders.forEach(order => {
        if (Array.isArray(order.load_items)) {
          order.load_items.forEach(item => {
            // Create item with full order context
            allLoadItemsWithContext.push({
              ...item,
              // Add order context
              load_id: order.id || order.load_id,
              customer_id: order.customer_id,
              order_status: order.order_status,
              customer_name: order.customer_name,
              delivery_date: order.delivery_date,
              dispatch_remarks: order.dispatch_remarks,
              sales_order_number: order.sales_order_number,
              // Calculate order totals
              total_weight: order.total_weight,
              total_quantity: order.total_quantity
            })
          })
        }
      })
    }
    
    // Group items by prefix and compatibility
    const groupedItems = groupItemsByPrefix(allLoadItemsWithContext)
    
    return {
      city: suburb.city,
      suburb_name: suburb.suburb_name,
      postal_code: suburb.postal_code,
      grouped_items: groupedItems,
      total_orders: suburb.load_orders?.length || 0,
      total_items: allLoadItemsWithContext.length
    }
  })
}

/**
 * Get grouped routes with compatibility analysis
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getGroupedRoutes = async (req, res) => {
  try {
      // Query parameters for filtering
  const { 
    route, 
    route_name, 
    customer_name, 
    branch_id, 
    include_suburbs = 'true',
    include_items = 'true'
  } = req.query
    
    // Build query
    let query = database
      .from('routes_with_tree')
      .select('route_id, route_name, branch_id, branch_name, suburbs')
    
    // Apply filters
    if (route) {
      query = query.eq('route_id', route)
    }
    
    if (route_name) {
      query = query.ilike('route_name', `%${route_name}%`)
    }
    
    if (customer_name) {
      // Filter by customer name in the suburbs JSON
      query = query.contains('suburbs', [{ load_orders: [{ customer_name: customer_name }] }])
    }
    
    if (branch_id) {
      query = query.eq('branch_id', branch_id)
    }
    
    // Execute query
    const { data: routes, error } = await query
    
    if (error) {
      await logApiEvent({
        level: 'error',
        ...buildLogFromReqRes(req, res, {
          controller: 'groupedRoutesController',
          action: 'getGroupedRoutes',
          status_code: 500,
          http_status: 'Internal Server Error',
          message: 'Database query failed',
          error: error.message
        })
      })
      
      return res.status(500).json(
        new Response(500, 'Internal Server Error', 'Failed to fetch routes data')
      )
    }
    
    if (!routes || routes.length === 0) {
      return res.status(200).json(
        new Response(200, 'OK', 'No routes found', { routes: [] })
      )
    }
    
    // Process each route
    const processedRoutes = routes.map(route => {
      const routeData = {
        route_id: route.route_id,
        route_name: route.route_name,
        branch_id: route.branch_id,
        branch_name: route.branch_name
      }
      
      // Process suburbs data if requested
      if (include_suburbs === 'true' && route.suburbs) {
        const processedSuburbs = processSuburbsData(route.suburbs)
        routeData.suburbs = processedSuburbs
        
        // Calculate route totals
        const routeTotals = processedSuburbs.reduce((acc, suburb) => {
          acc.total_orders += suburb.total_orders
          acc.total_items += suburb.total_items
          acc.total_groups += suburb.grouped_items.length
          
          suburb.grouped_items.forEach(group => {
            acc.total_quantity += group.totalQuantity
            acc.total_weight += group.totalWeight
          })
          
          return acc
        }, { total_orders: 0, total_items: 0, total_groups: 0, total_quantity: 0, total_weight: 0 })
        
        routeData.totals = routeTotals
      }
      
      return routeData
    })
    
    // Log successful operation
    await logApiEvent({
      level: 'info',
      ...buildLogFromReqRes(req, res, {
        controller: 'groupedRoutesController',
        action: 'getGroupedRoutes',
        status_code: 200,
        http_status: 'OK',
        message: 'Successfully fetched grouped routes',
        routes_count: processedRoutes.length
      })
    })
    
    return res.status(200).json(
      new Response(200, 'OK', 'Routes retrieved successfully', {
        routes: processedRoutes,
        count: processedRoutes.length
      })
    )
    
  } catch (error) {
    await logApiEvent({
      level: 'error',
      ...buildLogFromReqRes(req, res, {
        controller: 'groupedRoutesController',
        action: 'getGroupedRoutes',
        status_code: 500,
        http_status: 'Internal Server Error',
        message: 'Unexpected error occurred',
        error: error.message,
        stack: error.stack
      })
    })
    
    return res.status(500).json(
      new Response(500, 'Internal Server Error', 'An unexpected error occurred')
    )
  }
}

/**
 * Get all items with full customer and order context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getAllItemsWithContext = async (req, res) => {
  try {
    // Query parameters for filtering
    const { 
      route, 
      route_name, 
      customer_name, 
      branch_id 
    } = req.query
    
    // Build query
    let query = database
      .from('routes_with_tree')
      .select('route_id, route_name, branch_id, branch_name, suburbs')
    
    // Apply filters
    if (route) {
      query = query.eq('route_id', route)
    }
    
    if (route_name) {
      query = query.ilike('route_name', `%${route_name}%`)
    }
    
    if (customer_name) {
      // Filter by customer name in the suburbs JSON
      query = query.contains('suburbs', [{ load_orders: [{ customer_name: customer_name }] }])
    }
    
    if (branch_id) {
      query = query.eq('branch_id', branch_id)
    }
    
    // Execute query
    const { data: routes, error } = await query
    
    if (error) {
      await logApiEvent({
        level: 'error',
        ...buildLogFromReqRes(req, res, {
          controller: 'groupedRoutesController',
          action: 'getAllItemsWithContext',
          status_code: 500,
          http_status: 'Internal Server Error',
          message: 'Database query failed',
          error: error.message
        })
      })
      
      return res.status(500).json(
        new Response(500, 'Internal Server Error', 'Failed to fetch routes data')
      )
    }
    
    if (!routes || routes.length === 0) {
      return res.status(200).json(
        new Response(200, 'OK', 'No routes found', { items: [] })
      )
    }
    
    // Extract all items with full context
    const allItemsWithContext = []
    
    routes.forEach(route => {
      if (Array.isArray(route.suburbs)) {
        route.suburbs.forEach(suburb => {
          if (Array.isArray(suburb.load_orders)) {
            suburb.load_orders.forEach(order => {
              if (Array.isArray(order.load_items)) {
                order.load_items.forEach(item => {
                  allItemsWithContext.push({
                    id: item.id,
                    load_id: order.id || order.load_id,
                    load_items: [item], // Keep as array for consistency
                    customer_id: order.customer_id,
                    order_status: order.order_status,
                    total_weight: order.total_weight,
                    total_quantity: order.total_quantity,
                    customer_name: order.customer_name,
                    delivery_date: order.delivery_date,
                    dispatch_remarks: order.dispatch_remarks,
                    sales_order_number: order.sales_order_number,
                    // Route context
                    route_id: route.route_id,
                    route_name: route.route_name,
                    branch_id: route.branch_id,
                    branch_name: route.branch_name,
                    // Suburb context
                    city: suburb.city,
                    suburb_name: suburb.suburb_name,
                    postal_code: suburb.postal_code
                  })
                })
              }
            })
          }
        })
      }
    })
    
    // Log successful operation
    await logApiEvent({
      level: 'info',
      ...buildLogFromReqRes(req, res, {
        controller: 'groupedRoutesController',
        action: 'getAllItemsWithContext',
        status_code: 200,
        http_status: 'OK',
        message: 'Successfully fetched all items with context',
        items_count: allItemsWithContext.length
      })
    })
    
    return res.status(200).json(
      new Response(200, 'OK', 'Items retrieved successfully', {
        items: allItemsWithContext,
        count: allItemsWithContext.length
      })
    )
    
  } catch (error) {
    await logApiEvent({
      level: 'error',
      ...buildLogFromReqRes(req, res, {
        controller: 'groupedRoutesController',
        action: 'getAllItemsWithContext',
        status_code: 500,
        http_status: 'Internal Server Error',
        message: 'Unexpected error occurred',
        error: error.message,
        stack: error.stack
      })
    })
    
    return res.status(500).json(
      new Response(500, 'Internal Server Error', 'An unexpected error occurred')
    )
  }
}
