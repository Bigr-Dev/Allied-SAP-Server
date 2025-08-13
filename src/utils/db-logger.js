// utils/db-logger.js
import database from '../config/supabase.js'

/**
 * Log a failed/unsuccessful transaction to DB.
 * Use level: 'error' for exceptions or failed writes,
 * 'warn' for business-rule rejections (e.g., filtered out),
 * 'info' for notable but non-failing events.
 */
export async function logApiEvent({
  level = 'error',
  controller,
  action,
  route,
  method,
  status_code,
  http_status,
  message,
  error_code,
  error_detail,
  stack,
  correlation_id,
  user_identifier,
  client_ip,
  sales_order_number,
  customer_id,
  route_id,
  payload,
  meta,
}) {
  try {
    const row = {
      level,
      controller,
      action,
      route,
      method,
      status_code,
      http_status,
      message,
      error_code,
      error_detail,
      stack,
      correlation_id,
      user_identifier,
      client_ip,
      sales_order_number,
      customer_id,
      route_id,
      payload,
      meta,
    }

    // Trim large payloads if needed
    // if (row.payload && JSON.stringify(row.payload).length > 50000) { row.payload = { note: 'truncated' } }

    const { error } = await database.from('api_logs').insert([row])
    if (error) {
      // Last-resort console to avoid infinite loops
      // eslint-disable-next-line no-console
      console.error('DB log insert failed:', error.message)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('DB log insert threw:', e?.message)
  }
}

/**
 * Optional convenience: build from req/res + extras.
 */
export function buildLogFromReqRes(req, res, extras = {}) {
  const route = req?.originalUrl || req?.url
  const method = req?.method
  const client_ip =
    (req?.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim() ||
    req?.connection?.remoteAddress ||
    null
  const user_identifier = req?.user?.username || req?.user?.id || null
  const correlation_id =
    req?.headers?.['x-correlation-id'] || extras?.correlation_id

  return {
    route,
    method,
    client_ip,
    user_identifier,
    correlation_id,
    ...extras,
  }
}
