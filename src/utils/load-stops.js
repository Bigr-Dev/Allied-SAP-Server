// utils/load-stops.js
import { normaliseLocality, ensureRouteSuburb } from './locality-utils.js'

/**
 * Returns the load_stops.id for {load_id, route_id, locality}.
 * Ensures the referenced route_suburbs row exists (and adopts canonical values),
 * then inserts/gets the stop with that exact composite → prevents FK 23503.
 */
export async function getOrCreateStop(
  database,
  load_id,
  { route_id, suburb_name, city, province, postal_code, position = null }
) {
  // Resolve canonical parent (may adopt province/city/postal_code)
  const parent = await ensureRouteSuburb(database, {
    route_id,
    suburb_name,
    city,
    province,
    postal_code,
    position,
  })

  // Reuse existing stop if present for this load
  {
    const { data: existing, error } = await database
      .from('load_stops')
      .select('id')
      .eq('load_id', load_id)
      .eq('route_id', route_id)
      .eq('suburb_name', parent.suburb_name)
      .eq('city', parent.city)
      .eq('province', parent.province)
      .eq('postal_code', parent.postal_code)
      .maybeSingle()
    if (error) throw new Error(`load_stops select failed: ${error.message}`)
    if (existing?.id) return existing.id
  }

  // Insert new stop using the EXACT canonical composite
  const { data: inserted, error: insErr } = await database
    .from('load_stops')
    .insert([
      {
        load_id,
        route_id,
        suburb_name: parent.suburb_name,
        city: parent.city,
        province: parent.province,
        postal_code: parent.postal_code,
        position: parent.position ?? position ?? null,
        // planned_arrival / planned_departure if you have them at this stage
      },
    ])
    .select('id')
    .maybeSingle()

  if (insErr) throw new Error(`load_stops insert failed: ${insErr.message}`)
  return inserted.id
}
